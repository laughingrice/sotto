import { selectPartInstrument } from './parts-controls.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const browser = await chromium.launch({ headless: true, executablePath: arg('--chrome') || process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const errors = [], uploads = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()); });
function fakeMicrophone() {
  localStorage.setItem('sotto.countIn', 'false');
  localStorage.setItem('sotto.pitchCheck', 'false');
  window.pitchWorkers = 0; window.pitchIndex = 0;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); this.isPitchWorker = String(args[0]).includes('pitch-worker'); if (this.isPitchWorker) window.pitchWorkers++; }
    terminate() { if (this.isPitchWorker && !this.wasTerminated) { window.pitchWorkers--; this.wasTerminated = true; } super.terminate(); }
  };
  const contexts = [], NativeContext = window.AudioContext;
  window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); contexts.push(this); } };
  function tone(context, destination, midi, time, duration) {
    const buffer = context.createBuffer(1, Math.round(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0), frequency = 440 * 2 ** ((midi - 69) / 12);
    for (let i = 0; i < samples.length; i++) {
      const age = i / context.sampleRate, phase = 2 * Math.PI * frequency * age;
      samples[i] = (.06 * Math.sin(phase) + .18 * Math.sin(phase * 2) + .08 * Math.sin(phase * 3)) * Math.min(1, age / .01, (duration - age) / .03);
    }
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination);
    source.isInjectedPitch = true; source.onended = () => source.disconnect(); source.start(time);
  }
  navigator.mediaDevices.getUserMedia = async () => {
    const context = contexts.findLast(context => context.state === 'running');
    const destination = context.createMediaStreamDestination();
    window.pitchDestination = destination; window.pitchTrack = destination.stream.getTracks()[0];
    window.holdPitch = midi => tone(context, destination, midi, context.currentTime + .05, .7);
    return destination.stream;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    if (window.injectPitch && !this.isInjectedPitch && !this.loop && this.buffer?.duration > .1 && window.pitchTrack?.readyState === 'live') {
      const index = window.pitchIndex++;
      const midi = [40, 45, 50, 55][index % 4] + (index % 2 ? 1 : 0);
      tone(this.context, window.pitchDestination, midi, Number(args[0]) + .12, .4);
    }
    return start.apply(this, args);
  };
}
await page.addInitScript(fakeMicrophone);
await mkdir('test-results', { recursive: true });
const base = process.env.BASE_URL || 'http://localhost:4179/sotto/';
const button = name => page.getByRole('button', { name, exact: true });
const pitch = page.getByRole('group', { name: 'Pitch feedback', exact: true });
const notes = Array.from({ length: 16 }, (_, i) => ({ id: `pitch-note-${i}`, voice: 'solo', midi: [40, 45, 50, 55][i % 4], beat: i, duration: .9, bar: Math.floor(i / 4) + 1, measure: Math.floor(i / 4), grace: 0, tie: false }));
const svg = items => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 65">${items.map((n, i) => `<g id="${n.id}" class="score-note" data-voice="solo"><circle cx="${10 + i % 8 * 22}" cy="${18 + Math.floor(i / 8) * 25}" r="1"/></g>`).join('')}</svg>`;
const score = { format: 'sotto-score', version: 1, title: 'Pitch practice test', composer: '', subtitle: 'Single-note test', description: 'Alternating matching/different input', beatsPerBar: 4, beatUnit: 1, bpm: 120, voices: [{ id: 'solo', name: 'Solo', color: '#31745e', instrument: 'guitar' }], notes, pages: [svg(notes)], bars: [0, 1, 2, 3].map(i => ({ index: i, label: String(i + 1), start: i * 4, duration: 4, meter: [4, 4] })), sequence: [0, 1, 2, 3] };
try {
  await page.goto(base); await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  await page.locator('[data-score-input]').setInputFiles({ name: 'pitch-test.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)) });
  await page.getByRole('heading', { name: score.title, exact: true }).waitFor();
  await button('Rhythm feedback').click(); await page.locator('.rhythm-options summary').click();
  await button('Enable microphone').click(); await button('Stop microphone').waitFor();
  assert.equal(await page.evaluate(() => window.pitchWorkers), 0, 'Pitch analysis is opt-in');
  await page.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).check();
  await page.getByRole('spinbutton', { name: 'Microphone timing offset', exact: true }).fill('120');
  await page.waitForFunction(() => document.querySelector('.rhythm-panel canvas').dataset.backgroundReady === 'true');
  await page.evaluate(() => window.holdPitch(40));
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('.pitch-feedback').dataset.heardMidi) - 40) < .1);
  assert.ok(!(await pitch.innerText()).includes('Different note'), 'Paused input checks have no imaginary expected note');
  assert.equal(await pitch.getAttribute('data-matching'), '0');
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.injectPitch = true; window.pitchIndex = 0; });
  await button('Play score').click();
  await page.waitForFunction(() => { const p = document.querySelector('.pitch-feedback'); return Number(p.dataset.matching) >= 3 && Number(p.dataset.different) >= 3; });
  await button('Pause playback').click(); await page.waitForTimeout(300);
  const frozen = [await pitch.getAttribute('data-matching'), await pitch.getAttribute('data-different')];
  await page.waitForTimeout(300);
  assert.deepEqual([await pitch.getAttribute('data-matching'), await pitch.getAttribute('data-different')], frozen, 'Paused pitch scores freeze');
  await page.getByRole('combobox', { name: 'Loop end measure', exact: true }).selectOption('0');
  await page.getByRole('switch', { name: 'Practice loop', exact: true }).click();
  await button('Restart').click(); await page.evaluate(() => { window.pitchIndex = 0; }); await button('Play score').click();
  await page.waitForFunction(() => Number(document.querySelector('.rhythm-stats').dataset.completedLoops) >= 2);
  await button('Pause playback').click(); await page.waitForTimeout(300);
  assert.ok(Number(await pitch.getAttribute('data-matching')) >= 3 && Number(await pitch.getAttribute('data-different')) >= 3, 'Pitch summaries accumulate across loops');
  await page.screenshot({ path: 'test-results/pitch-review.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'Pitch feedback fits portrait phone layout');
  await page.screenshot({ path: 'test-results/pitch-phone.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const chordNotes = [note => ({ ...note, id: 'chord-low', beat: 0, duration: 4, midi: 40, bar: 1, measure: 0 }), note => ({ ...note, id: 'chord-high', beat: 0, duration: 4, midi: 44, bar: 1, measure: 0 })].map(make => make(notes[0]));
  const chord = { ...score, title: 'Chord pitch test', notes: chordNotes, pages: [svg(chordNotes)], bars: score.bars.slice(0, 1), sequence: [0] };
  await page.locator('[data-score-input]').setInputFiles({ name: 'chord.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(chord)) });
  await page.getByRole('heading', { name: chord.title, exact: true }).waitFor();
  await page.evaluate(() => { window.pitchIndex = 0; }); await button('Play score').click();
  await page.getByText('Chord or overlapping pitches: not scored.', { exact: true }).waitFor();
  assert.equal(await pitch.getAttribute('data-matching'), '0'); assert.equal(await pitch.getAttribute('data-different'), '0');
  await button('Pause playback').click();
  await selectPartInstrument(page, 'Solo', 'drums');
  await button('Play score').click();
  await page.getByText('Percussion is not pitch-scored.', { exact: true }).waitFor();
  assert.equal(await pitch.getAttribute('data-different'), '0');
  await button('Pause playback').click();
  await page.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).uncheck();
  assert.equal(await page.evaluate(() => window.pitchWorkers), 0, 'Disabling pitch stops its worker');
  await page.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).check();
  await button('Stop microphone').click(); assert.equal(await page.evaluate(() => window.pitchWorkers), 0, 'Stopping mic terminates pitch processing');
  assert.equal(await page.evaluate(() => window.pitchTrack.readyState), 'ended');
  // A new profile has never enabled pitch: its first enable must work offline.
  const offline = await browser.newPage(); offline.on('pageerror', error => errors.push(error.message)); await offline.addInitScript(fakeMicrophone);
  await offline.goto(base); await offline.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  await offline.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await offline.waitForFunction(() => !!navigator.serviceWorker.controller);
  await offline.context().setOffline(true);
  await offline.getByRole('button', { name: 'Rhythm feedback', exact: true }).click();
  await offline.locator('.rhythm-options summary').click();
  await offline.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).check();
  await offline.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await offline.getByRole('button', { name: 'Stop microphone', exact: true }).waitFor();
  await offline.waitForFunction(() => document.querySelector('.rhythm-panel canvas').dataset.backgroundReady === 'true');
  await offline.evaluate(() => window.holdPitch(55));
  await offline.waitForFunction(() => Math.abs(Number(document.querySelector('.pitch-feedback').dataset.heardMidi) - 55) < .1);
  await offline.getByRole('button', { name: 'Stop microphone', exact: true }).click();
  // A worker failure must leave microphone/rhythm capture available.
  await offline.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).uncheck();
  await offline.evaluate(() => { window.Worker = class { constructor() { throw new Error('Simulated worker unavailable'); } }; });
  await offline.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await offline.getByRole('button', { name: 'Stop microphone', exact: true }).waitFor();
  await offline.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).check();
  await offline.getByText('This browser could not start pitch analysis. Rhythm feedback still works.', { exact: true }).waitFor();
  assert.equal(await offline.getByRole('button', { name: 'Stop microphone', exact: true }).count(), 1);
  assert.equal(await offline.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).isChecked(), false);
  await offline.getByRole('button', { name: 'Stop microphone', exact: true }).click();

  await offline.close();
  assert.deepEqual(errors, []); assert.deepEqual(uploads, [], 'No microphone data is uploaded');
  console.log('PASS: opt-in real-worklet pitch detection, matching/wrong notes, frozen/loop summaries, worker cleanup and first use offline.');
} catch (error) { await page.screenshot({ path: 'test-results/pitch-failure.png' }); console.log('Browser errors:', errors); throw error; }
finally { await browser.close(); }
