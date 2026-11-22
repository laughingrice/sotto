import { setPracticeParts } from './parts-controls.mjs';
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const i = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: i < 0 ? process.env.CHROME_PATH : process.argv[i + 1] });
const errors = [];
let activePage;
function fakeMicrophone() {
  localStorage.setItem('sotto.countIn', 'false'); localStorage.setItem('sotto.pitchCheck', 'true');
  const contexts = [], NativeContext = window.AudioContext;
  window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); contexts.push(this); } };
  window.starts = []; window.mediaRequests = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    window.mediaRequests++;
    const context = contexts.findLast(context => context.state === 'running');
    const destination = context.createMediaStreamDestination(); window.destination = destination;
    return destination.stream;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    if (!this.injected && !this.loop && this.buffer?.duration > .1) {
      const index = window.starts.length, time = Number(args[0] ?? this.context.currentTime);
      window.starts.push(time);
      if (window.destination && window.inject && window.midi?.length) {
        const midi = window.midi[index % window.midi.length], context = this.context;
        const duration = .24, frequency = 440 * 2 ** ((midi - 69) / 12);
        const buffer = context.createBuffer(1, Math.round(context.sampleRate * duration), context.sampleRate), samples = buffer.getChannelData(0);
        for (let n = 0; n < samples.length; n++) {
          const age = n / context.sampleRate, phase = 2 * Math.PI * frequency * age;
          samples[n] = (.16 * Math.sin(phase) + .04 * Math.sin(phase * 2)) * Math.min(1, age / .003, (duration - age) / .02);
        }
        const source = context.createBufferSource(); source.buffer = buffer; source.injected = true;
        source.connect(window.destination); source.start(time); source.onended = () => source.disconnect();
      }
    }
    return start.apply(this, args);
  };
}
await mkdir('test-results', { recursive: true });
try {
  for (const instrument of ['guitar', 'bass']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); activePage = page;
    page.on('pageerror', error => { errors.push(error.message); console.log(error.stack); });
    await page.addInitScript(fakeMicrophone);
    const score = JSON.parse(gunzipSync(await readFile(new URL(`../public/scores/prototypes/${instrument}.sotto`, import.meta.url))));
    const button = name => page.getByRole('button', { name, exact: true });
    const select = page.getByRole('combobox', { name: 'Score notation view', exact: true });
    const lane = () => page.locator('.score-feedback-lane[data-bar-index="0"]');
    await page.goto(process.env.BASE_URL || 'http://localhost:4179/sotto/');
    await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
    assert.equal(await select.count(), 0, 'Legacy scores stay notation-only');
    await button('Score library').click(); await button('Tab prototypes').click();
    await page.getByRole('textbox', { name: 'Search library', exact: true }).fill(score.title);
    await page.locator('.library-open').filter({ hasText: score.title }).click();
    await page.getByRole('heading', { name: score.title, exact: true }).waitFor();
    await page.getByRole('slider', { name: 'Tempo', exact: true }).fill('180');
    for (const view of ['tabs', 'both', 'notation']) {
      await select.selectOption(view);
      assert.equal(await page.locator('.current-bar-highlight').count(), 4, 'Silent fourth bar has a highlight in every view');
      assert.equal(await page.locator('.score-note').count(), score.notes.length * (view === 'both' ? 2 : 1));
      assert.equal(await page.locator('.score-page').count(), 1, 'Natural pagination fits both systems on one page in every view');
      await page.locator(`[data-event-id="${score.notes[0].id}"]`).first().click();
      assert.equal(Number(await page.getByRole('slider', { name: 'Playback position', exact: true }).inputValue()), 0);
    }
    await button('Rhythm feedback').click(); await page.locator('.rhythm-options summary').click();
    await button('Enable microphone').click(); await button('Stop microphone').waitFor();
    await page.waitForFunction(() => document.querySelector('.rhythm-panel canvas').dataset.backgroundReady === 'true');
    await setPracticeParts(page, 'all');
    await page.locator('.rhythm-options summary').click();
    const sounding = score.notes.filter(note => note.beat !== 8); // The tied continuation is not reattacked.
    await page.evaluate(midi => { window.midi = [...midi, ...midi]; window.starts = []; window.inject = true; }, sounding.map(note => note.midi));
    await button('Play score').click();
    for (const view of ['tabs', 'both', 'notation', 'both']) {
      await page.waitForTimeout(350);
      const before = Number(await page.getByRole('slider', { name: 'Playback position', exact: true }).inputValue());
      await select.selectOption(view);
      assert.ok(await button('Pause playback').isVisible(), 'View switch keeps playback running');
      const after = Number(await page.getByRole('slider', { name: 'Playback position', exact: true }).inputValue());
      assert.ok(after >= before - .05, 'View switch never seeks backward');
      await page.waitForFunction(({ expected, notes }) => {
        const active = [...document.querySelectorAll('.score-note.is-active')];
        if (!active.length) return false;
        const counts = new Map(); active.forEach(note => counts.set(note.dataset.eventId, (counts.get(note.dataset.eventId) ?? 0) + 1));
        const beat = Number(document.querySelector('[aria-label="Playback position"]').value);
        const expectedIds = notes.filter(note => [0, 16].some(offset => beat >= note.beat + offset && beat < note.beat + offset + note.duration)).map(note => note.id).sort();
        return [...counts.values()].every(count => count === expected) && JSON.stringify([...counts.keys()].sort()) === JSON.stringify(expectedIds) &&
          Number(document.querySelector('.current-bar-highlight.is-current').dataset.barIndex) === Math.floor(beat / 4) % 4;
      }, { expected: view === 'both' ? 2 : 1, notes: score.notes });
    }
    await button('Play score').waitFor({ timeout: 20000 });
    assert.equal(await page.evaluate(() => window.starts.length), sounding.length * 2, 'Both draws twice but schedules every sounding event exactly once');
    assert.equal(await page.evaluate(() => window.mediaRequests), 1, 'Changing views does not restart microphone capture');
    await page.waitForTimeout(400);
    const extraAttacks = await page.locator('.score-feedback-lane circle').evaluateAll(nodes => nodes.filter(node => node.textContent.includes('Unmatched')).map(node => ({ source: node.dataset.attackSource, x: node.getAttribute('cx'), text: node.textContent })));
    assert.ok(extraAttacks.every(attack => attack.source !== 'legato'), 'Legato must not add duplicate pluck attacks: ' + JSON.stringify(extraAttacks));
    const pitch = page.locator('.pitch-feedback');
    assert.ok(Number(await pitch.getAttribute('data-matching')) > 0, 'Real worklet checks generated input against canonical sounding pitches');
    assert.ok(await page.locator('[data-pitch-result="matching"] path').count() > 0, 'Correct notes leave visible green vector checks');
    await page.getByRole('combobox', { name: 'Loop end measure', exact: true }).selectOption('0');
    await page.getByRole('switch', { name: 'Practice loop', exact: true }).click(); await button('Restart').click();
    await page.evaluate(midi => { window.midi = midi; window.starts = []; }, score.notes.slice(0, 4).map(note => note.midi + 1));
    await button('Play score').click();
    await page.waitForFunction(() => Number(document.querySelector('.rhythm-stats').dataset.completedLoops) >= 2);
    await button('Pause playback').click(); await page.waitForTimeout(350);
    await lane().scrollIntoViewIfNeeded();
    const snapshot = async () => {
      await page.waitForTimeout(120);
      return page.evaluate(() => {
        const lane = document.querySelector('.score-feedback-lane[data-bar-index="0"]');
        return { visits: lane.dataset.visits, points: lane.dataset.feedbackPoints, attacks: lane.dataset.feedbackAttacks, pitches: lane.dataset.feedbackPitches,
          position: lane.dataset.position,
          matching: document.querySelector('.pitch-feedback').dataset.matching, different: document.querySelector('.pitch-feedback').dataset.different,
          onTime: document.querySelector('.rhythm-stats').dataset.onTime, late: document.querySelector('.rhythm-stats').dataset.late };
      });
    };
    const frozen = await snapshot(); assert.equal(frozen.visits, '2'); assert.ok(Number(frozen.points) > 0);
    for (const view of ['notation', 'tabs', 'both']) {
      await select.selectOption(view); await lane().scrollIntoViewIfNeeded();
      assert.deepEqual(await snapshot(), frozen, 'View switches preserve faded histories and timing/pitch judgments');
      assert.equal(await lane().locator('.score-feedback-playhead').count(), 1, 'Captured position remains visible after pausing and changing views');
      assert.ok(await lane().locator('[data-pitch-result="different"] path').count() > 0, 'Incorrect notes leave red crosses in every view');
      assert.equal(await lane().locator(':scope > g:last-child > .score-feedback-pitch-marks:last-child').count(), 1, 'Pitch markers are painted above traces and the playhead');
      assert.equal(await lane().locator('[data-history-age="1"]').getAttribute('opacity'), '0.38');
      assert.ok(await page.evaluate(() => {
        const lane = document.querySelector('.score-feedback-lane[data-bar-index="0"]').getBoundingClientRect();
        const barNumber = [...document.querySelectorAll('.score-page text')].find(text => text.textContent.trim() === '3' && text.getBoundingClientRect().left < lane.left);
        return barNumber && barNumber.getBoundingClientRect().top >= lane.bottom - 1;
      }), 'The next system bar number stays below the preceding feedback lane');
      await page.screenshot({ path: `test-results/tab-${instrument}-${view}.png` });
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    await select.selectOption('tabs'); await lane().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/tab-${instrument}-tablet.png` });
    // A paused take must freeze judgments, but not freeze the independent
    // tuner at its last note. Include nylon low E and drop D below G2.
    const judgments = await pitch.getAttribute('data-matching') + '/' + await pitch.getAttribute('data-different');
    await page.evaluate(() => {
      const context = window.destination.context;
      window.liveOscillator = context.createOscillator(); window.liveGain = context.createGain();
      window.liveGain.gain.value = .12;
      window.liveOscillator.connect(window.liveGain); window.liveGain.connect(window.destination); window.liveOscillator.start();
    });
    for (const midi of [45, 43, 40, 38, 45]) {
      await page.evaluate(midi => { window.liveOscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12); }, midi);
      await page.waitForFunction(midi => {
        const panel = document.querySelector('.pitch-feedback');
        return panel.dataset.targetKind === 'input' && Math.abs(Number(panel.dataset.heardMidi) - midi) < .2;
      }, midi);
      assert.equal(await pitch.getAttribute('data-matching') + '/' + await pitch.getAttribute('data-different'), judgments, 'Paused tuner never changes pitch judgments');
    }
    await page.evaluate(() => { window.liveGain.gain.value = .002; window.liveOscillator.frequency.value = 82.4069; });
    await page.waitForFunction(() => {
      const panel = document.querySelector('.pitch-feedback');
      return Math.abs(Number(panel.dataset.heardMidi) - 40) < .2 && panel.textContent.includes('Below scoring gate');
    });
    await page.evaluate(() => window.liveOscillator.stop());
    await button('Stop microphone').click(); await page.close();
    console.log(`PASS ${instrument}: general exporter, natural one-page layouts, one playback stream, linked highlights/seek, silent bar, All voices pitch judgments, frozen history, live low-string tuner after pause, quiet-input readout, repeat loops and tablet.`);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  if (activePage && !activePage.isClosed()) { await activePage.screenshot({ path: 'test-results/tab-failure.png' }); console.log((await activePage.locator('body').innerText()).slice(-2500)); }
  throw error;
} finally { await browser.close(); }
