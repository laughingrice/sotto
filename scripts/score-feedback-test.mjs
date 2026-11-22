import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const i = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: i < 0 ? process.env.CHROME_PATH : process.argv[i + 1] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => { errors.push(error.message); console.log(error.stack); });
const button = name => page.getByRole('button', { name, exact: true });
const select = name => page.getByRole('combobox', { name, exact: true });
await page.addInitScript(() => {
  localStorage.setItem('sotto.countIn', 'false');
  const NativeContext = window.AudioContext;
  window.contexts = [];
  // Fast-note fixture uses fixed analysis windows; do not inherit a host's
  // low-rate Bluetooth/communications route for this synthetic input test.
  window.AudioContext = class extends NativeContext { constructor(options) { super({ ...options, sampleRate: 48000 }); window.contexts.push(this); } };
  navigator.mediaDevices.getUserMedia = async () => {
    const context = window.contexts.findLast(context => context.state === 'running');
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 261.6256; gain.gain.value = .0001;
    oscillator.connect(gain); gain.connect(destination); oscillator.start();
    window.micGain = gain;
    window.pulse = setInterval(() => {
      if (!window.playNotes) return;
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(.0001, now);
      gain.gain.linearRampToValueAtTime(window.testVolume ?? .12, now + .003);
      // Leave enough sustained input for two complete pitch windows even
      // when the worker is briefly delayed by concurrent browser tests.
      gain.gain.setValueAtTime(window.testVolume ?? .12, now + .20);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .25);
    }, 280);
    return destination.stream;
  };
});
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4179/sotto/');
  await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  const original = await page.locator('.score-page svg').first().getAttribute('viewBox');
  await button('Rhythm feedback').click();
  assert.equal(await select('Feedback placement').inputValue(), 'score');
  assert.equal(await select('Feedback history').inputValue(), '1');
  await page.locator('.score-feedback-lane').first().waitFor();
  assert.ok(await page.locator('.score-feedback-lane').count() > 8);
  assert.notEqual(await page.locator('.score-page svg').first().getAttribute('viewBox'), original);
  // No cumulative transforms when switching views repeatedly.
  for (let n = 0; n < 3; n++) {
    await select('Feedback placement').selectOption('timeline');
    assert.equal(await page.locator('.score-page svg').first().getAttribute('viewBox'), original);
    assert.equal(await page.locator('.score-feedback-lane').count(), 0);
    await select('Feedback placement').selectOption('score');
  }
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/score-feedback-engraving.png' });
  // Two staves per system, including an enclosing transformed group. Bar
  // spacing is deliberately nonuniform, and the second system needs shifting.
  const notes = Array.from({ length: 16 }, (_, n) => ({ id: `feedback-note-${n}`, voice: n % 2 ? 'lower' : 'upper',
    beat: Math.floor(n / 2), duration: .9, grace: 0, midi: 60, bar: Math.floor(n / 8) + 1, measure: Math.floor(n / 8), tie: false }));
  const fixture = { format: 'sotto-score', version: 1, title: 'Feedback ensemble', composer: '', subtitle: '', description: '', beatsPerBar: 4, beatUnit: 1, bpm: 220,
    voices: [{ id: 'upper', name: 'Upper', color: '#31745e' }, { id: 'lower', name: 'Lower', color: '#597eae' }], notes,
    bars: [0, 1].map(index => ({ index, label: String(index + 1), start: index * 4, duration: 4, meter: [4, 4] })), sequence: [0, 1],
    pages: [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 110"><g transform="translate(2 2)">${notes.map((note, n) => `<g class="score-note" id="${note.id}" data-voice="${note.voice}"><circle cx="${[12, 32, 65, 98][Math.floor(n / 2) % 4]}" cy="${18 + Math.floor(n / 8) * 45 + (n % 2) * 12}" r="1"/></g>`).join('')}</g></svg>`] };
  await page.locator('[data-score-input]').setInputFiles({ name: 'feedback.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('heading', { name: fixture.title, exact: true }).waitFor();
  assert.equal(await page.locator('.score-feedback-lane').count(), 2);
  await page.locator('.rhythm-options summary').click();
  await page.getByRole('checkbox', { name: 'Check pitch for single notes', exact: true }).check();
  await button('Enable microphone').click(); await button('Stop microphone').waitFor();
  await page.waitForFunction(() => document.querySelector('.rhythm-panel canvas').dataset.backgroundReady === 'true');
  await page.locator('.rhythm-options summary').click();
  await select('Loop end measure').selectOption('0'); await page.getByRole('switch', { name: 'Practice loop', exact: true }).click();
  await page.evaluate(() => { window.playNotes = true; });
  await button('Play score').click();
  const lane = page.locator('.score-feedback-lane[data-bar-index="0"]');
  await lane.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.score-feedback-lane').dataset.visits === '2');
  assert.equal(await lane.locator('[data-history-age="1"]').getAttribute('opacity'), '0.38');
  await page.waitForFunction(() => !!document.querySelector('[data-pitch-result]'));
  await select('Feedback history').selectOption('5');
  await page.waitForFunction(() => Number(document.querySelector('.rhythm-stats').dataset.completedLoops) >= 6);
  await button('Pause playback').click(); await page.waitForTimeout(500); // Drain scheduled audio plus the legato merge buffer.
  assert.equal(await lane.locator('[data-history-age]').count(), 6);
  const snapshot = await lane.innerHTML(); await page.waitForTimeout(250); assert.equal(await lane.innerHTML(), snapshot, 'Pause freezes score feedback');
  const geometry = await page.evaluate(() => {
    const lane = document.querySelector('.score-feedback-lane'), bar = document.querySelector('.current-bar-highlight');
    const next = document.getElementById('feedback-note-8');
    return { below: lane.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom,
      beforeNext: lane.getBoundingClientRect().bottom < next.getBoundingClientRect().top };
  });
  assert.deepEqual(geometry, { below: true, beforeNext: true }, 'Lane has reserved space below both staves and before next system');
  await page.screenshot({ path: 'test-results/score-feedback-history.png' });
  await button('Hide rhythm feedback').click();
  assert.ok(await lane.isVisible(), 'Score feedback remains visible while mic runs with panel hidden');
  await button('Zoom in').click();
  assert.ok(await lane.isVisible());
  await button('Rhythm feedback').click();
  await select('Feedback history').selectOption('0');
  await page.waitForFunction(() => document.querySelectorAll('.score-feedback-lane[data-bar-index="0"] [data-history-age]').length === 1);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({ path: 'test-results/score-feedback-tablet.png' });
  await page.locator('.rhythm-options summary').click(); await button('Clear feedback').click();
  await page.waitForFunction(() => !document.querySelector('.score-feedback-lane [data-history-age]'));
  assert.deepEqual(errors, []);
  console.log('PASS: score-aligned feedback, reserved system spacing, reversible layout, persistent pitch, six faded visits, frozen pause, hidden panel, zoom and tablet.');
} catch (error) {
  await page.screenshot({ path: 'test-results/score-feedback-failure.png' });
  console.log(await page.locator('.rhythm-panel').innerText());
  throw error;
} finally { await browser.close(); }
