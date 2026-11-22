import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const i = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: i < 0 ? process.env.CHROME_PATH : process.argv[i + 1] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('sotto.countIn', 'false'); localStorage.setItem('sotto.pitchCheck', 'false');
  const Context = window.AudioContext, contexts = [];
  window.AudioContext = class extends Context { constructor(options) { super({ ...options, sampleRate: 48000 }); contexts.push(this); } };
  navigator.mediaDevices.getUserMedia = async () => {
    const context = contexts.findLast(context => context.state === 'running');
    const destination = context.createMediaStreamDestination();
    window.oscillator = context.createOscillator(); window.gain = context.createGain();
    window.gain.gain.value = .0001; window.oscillator.connect(window.gain); window.gain.connect(destination); window.oscillator.start();
    return destination.stream;
  };
  const start = AudioBufferSourceNode.prototype.start;
  window.noteStarts = 0;
  AudioBufferSourceNode.prototype.start = function(...args) {
    if (window.inject && !this.loop && this.buffer?.duration > .1) {
      const midi = [40, 43, 40, 45][window.noteStarts++ % 4], time = Number(args[0] ?? this.context.currentTime);
      window.oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), time);
      // One volume rise at the start; every later note is frequency only.
      window.gain.gain.setValueAtTime(.15, time);
    }
    return start.apply(this, args);
  };
});
const notes = [40, 43, 40, 45].map((midi, beat) => ({ id: `legato-${beat}`, voice: 'guitar', beat, duration: 1, grace: 0, midi, bar: 1, measure: 0, tie: false }));
function engraving(view) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80">${(view === 'both' ? ['notation', 'tabs'] : [view]).map((kind, staff) => {
    const y = 20 + staff * 22;
    return `<g class="sotto-staff-geometry" data-system="0">${Array.from({ length: kind === 'tabs' ? 6 : 5 }, (_, n) => `<path d="M10 ${y + n}H150" stroke="black" stroke-width=".15"/>`).join('')}</g>${notes.map((note, n) => `<g class="score-note" id="${kind}-${n}" data-event-id="${note.id}" data-voice="guitar"><circle cx="${25 + n * 30}" cy="${y + 2}" r="1"/></g>`).join('')}`;
  }).join('')}<g class="sotto-bar-boundary" data-system="0" data-boundary="1"><rect x="150" y="20" width=".15" height="${view === 'both' ? 27 : 5}"/></g></svg>`;
}
const score = { format: 'sotto-score', version: 1, title: 'Legato regression', composer: '', subtitle: '', description: '', bpm: 100, beatsPerBar: 4, beatUnit: 1,
  voices: [{ id: 'guitar', name: 'Guitar', color: '#31745e', instrument: 'guitar' }], notes,
  bars: [{ index: 0, label: '1', start: 0, duration: 4, meter: [4, 4] }], sequence: [0], pages: [engraving('notation')],
  renderings: Object.fromEntries(['notation', 'tabs', 'both'].map(view => [view, { pages: [engraving(view)] }])) };
const button = name => page.getByRole('button', { name, exact: true });
const select = name => page.getByRole('combobox', { name, exact: true });
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4179/sotto/');
  await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  await page.locator('[data-score-input]').setInputFiles({ name: 'legato.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)) });
  await page.getByRole('heading', { name: score.title, exact: true }).waitFor();
  await button('Rhythm feedback').click();
  assert.equal(await page.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).isChecked(), false);
  await page.locator('.rhythm-options summary').click();
  assert.equal(await page.getByRole('checkbox', { name: 'Detect legato rhythm', exact: true }).isChecked(), true);
  await page.locator('.rhythm-options summary').click();
  await button('Enable microphone').click(); await button('Stop microphone').waitFor();
  await page.waitForFunction(() => document.querySelector('.rhythm-panel canvas').dataset.backgroundReady === 'true');
  await page.getByRole('switch', { name: 'Practice loop', exact: true }).click();
  await page.evaluate(() => { window.inject = true; window.noteStarts = 0; });
  await button('Play score').click();
  await page.waitForFunction(() => Number(document.querySelector('.rhythm-stats').dataset.completedLoops) >= 3, { timeout: 20000 });
  await button('Pause playback').click(); await page.waitForTimeout(450);
  const stats = await page.locator('.rhythm-stats').evaluate(node => ({ ...node.dataset }));
  assert.ok(Number(stats.legatoAttacks) >= 7, JSON.stringify(stats));
  assert.ok(Number(stats.onTime) >= 8, JSON.stringify(stats));
  assert.ok(Number(stats.extra) <= 1, 'Legato and energy do not double-count the initial pluck');
  assert.equal(await page.locator('.pitch-feedback').count(), 0, 'Legato does not require pitch scoring to be enabled');
  const lane = page.locator('.score-feedback-lane');
  let frozen;
  for (const view of ['notation', 'tabs', 'both']) {
    await select('Score notation view').selectOption(view); await lane.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    assert.ok(await lane.locator('[data-attack-source="legato"]').count() >= 3, 'Outlined legato attacks survive view switching');
    const current = await lane.evaluate(node => ({ visits: node.dataset.visits, attacks: node.dataset.feedbackAttacks, points: node.dataset.feedbackPoints }));
    if (!frozen) frozen = current; else assert.deepEqual(current, frozen);
    assert.equal(current.visits, '2');
  }
  await page.waitForTimeout(200); assert.deepEqual(await page.locator('.rhythm-stats').evaluate(node => ({ ...node.dataset })), stats);
  await page.setViewportSize({ width: 768, height: 1024 }); await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/legato-both-tablet.png' });
  await page.locator('.rhythm-options summary').click();
  await page.getByRole('checkbox', { name: 'Detect legato rhythm', exact: true }).uncheck();
  assert.equal(await page.evaluate(() => localStorage.getItem('sotto.legatoRhythm')), 'false');
  await page.locator('.rhythm-options summary').click();
  await page.evaluate(() => { window.gain.gain.value = .0001; window.noteStarts = 0; });
  await button('Restart').click(); await page.waitForTimeout(300); await button('Play score').click();
  await page.waitForFunction(() => Number(document.querySelector('.rhythm-stats').dataset.completedLoops) >= 1);
  await button('Pause playback').click(); await page.waitForTimeout(350);
  assert.equal(await page.locator('.rhythm-stats').getAttribute('data-legato-attacks'), '0');
  assert.ok(Number(await page.locator('.rhythm-stats').getAttribute('data-missed')) >= 2, 'Energy-only mode misses constant-volume changes');
  await button('Stop microphone').click(); assert.deepEqual(errors, []);
  console.log('PASS: constant-volume hammer-ons/pull-offs, energy fusion, loop boundaries/history, Notes/Tabs/Both, pause, tablet and remembered opt-out without pitch scoring.');
} catch (error) { console.log(await page.locator('.rhythm-panel').innerText()); throw error; }
finally { await browser.close(); }
