import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const browser = await chromium.launch({ headless: true, executablePath: arg('--chrome') || process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [], uploads = [];
page.on('pageerror', error => { errors.push(error.message); console.log(error.stack); });
page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()); });
await page.addInitScript(() => {
  // Replace getUserMedia before the app loads: this test never opens a real
  // microphone. All input is generated in the playback AudioContext.
  window.testContexts = [];
  const NativeContext = window.AudioContext;
  window.AudioContext = class extends NativeContext {
    constructor(...args) { super(...args); window.testContexts.push(this); }
  };
  window.testInputDelay = .12;
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.denyMicrophone) throw new DOMException('Denied for test', 'NotAllowedError');
    const context = window.testContexts.findLast(context => context.state === 'running');
    const destination = context.createMediaStreamDestination();
    window.testMicDestination = destination;
    window.testMicTrack = destination.stream.getTracks()[0];
    if (window.holdMicrophone) return new Promise(resolve => { window.resolveMicrophone = () => resolve(destination.stream); });
    return destination.stream;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    const destination = window.testMicDestination;
    const instrument = window.injectPerformance && this.buffer?.duration > .1;
    const calibration = window.injectCalibration && Math.abs((this.buffer?.duration ?? 0) - .04) < .0001;
    const time = Number(args[0] ?? this.context.currentTime);
    if (destination && destination.context === this.context && window.testMicTrack.readyState === 'live' &&
        (instrument || calibration) && time - (window.lastInjectedTime ?? -Infinity) > .07) {
      window.lastInjectedTime = time;
      const buffer = this.context.createBuffer(1, Math.round(this.context.sampleRate * .025), this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = .5 * Math.sin(2 * Math.PI * 1200 * i / this.context.sampleRate) * Math.exp(-i / this.context.sampleRate * 150);
      const pulse = this.context.createBufferSource(); pulse.buffer = buffer; pulse.connect(destination);
      pulse.onended = () => pulse.disconnect(); pulse.start(time + window.testInputDelay);
    }
    return start.apply(this, args);
  };
});
await mkdir('test-results', { recursive: true });
const play = () => page.getByRole('button', { name: 'Play score', exact: true });
const pause = () => page.getByRole('button', { name: 'Pause playback', exact: true });
const controls = page.locator('.rhythm-stats');
const ready = () => page.getByRole('heading', { name: 'Julia Florida', exact: true }).waitFor();
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:5175/'); await ready();
  await page.getByRole('button', { name: 'Mute bass', exact: true }).click();
  await page.keyboard.press('Space'); await pause().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Unmute bass', exact: true }).getAttribute('aria-pressed'), 'true', 'Space does not re-click the last mute button');
  await page.keyboard.press('Space'); await play().waitFor();
  await page.getByRole('button', { name: 'Faster', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.current-bar-highlight.is-current').getAttribute('data-bar-index'), '1', 'Arrow works after clicking tempo button');
  await page.getByRole('slider', { name: 'Tempo', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('slider', { name: 'Tempo', exact: true }).inputValue(), '45', 'Arrow does not move the focused slider');
  assert.equal(await page.locator('.current-bar-highlight.is-current').getAttribute('data-bar-index'), '2');
  const follow = page.getByRole('checkbox', { name: 'Follow score', exact: true });
  await follow.focus(); await page.keyboard.press('Space'); await pause().waitFor();
  assert.equal(await follow.isChecked(), true, 'Space does not toggle a focused checkbox');
  await page.keyboard.press('Space'); await play().waitFor();
  await page.getByRole('button', { name: 'Score library', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search library', exact: true }).fill('two');
  await page.keyboard.press('Space');
  assert.equal(await page.getByRole('textbox', { name: 'Search library', exact: true }).inputValue(), 'two ', 'Text entry retains Space');
  await page.keyboard.press('Escape');
  const notes = Array.from({ length: 32 }, (_, i) => ({ id: `test-note-${i}`, voice: 'melody', beat: i,
    grace: 0, midi: 60, duration: .4, bar: Math.floor(i / 4) + 1, measure: Math.floor(i / 4), tie: false }));
  const fixture = { format: 'sotto-score', version: 1, title: 'Rhythm test', composer: '', subtitle: 'Synthetic test',
    beatsPerBar: 4, beatUnit: 1, bpm: 120, description: 'Even quarter notes', voices: [{ id: 'melody', name: 'Melody', color: '#31745e' }], notes,
    pages: [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 75">${notes.map((note, i) => `<g id="${note.id}" class="score-note" data-voice="melody"><circle cx="${10 + (i % 16) * 11}" cy="${20 + Math.floor(i / 16) * 28}" r="1"/></g>`).join('')}</svg>`],
    bars: Array.from({ length: 8 }, (_, index) => ({ index, label: String(index + 1), start: index * 4, duration: 4, meter: [4, 4] })), sequence: Array.from({ length: 8 }, (_, i) => i) };
  await page.locator('[data-score-input]').setInputFiles({ name: 'rhythm.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('heading', { name: 'Rhythm test', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Rhythm feedback', exact: true }).click();
  await page.locator('.rhythm-options summary').click();
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await page.getByRole('button', { name: 'Stop microphone', exact: true }).waitFor();
  await page.evaluate(() => { window.injectPerformance = true; });
  await play().click();
  await page.waitForFunction(() => Number(document.querySelector('.rhythm-stats').dataset.late) >= 3);
  assert.ok(Number(await page.getByRole('meter', { name: 'Microphone input level', exact: true }).getAttribute('aria-valuenow')) > -90, 'Real worklet receives generated audio');
  await pause().click(); await page.waitForTimeout(300);
  const frozen = await controls.getAttribute('data-late');
  await page.waitForTimeout(300); assert.equal(await controls.getAttribute('data-late'), frozen, 'Paused results stay frozen');
  await page.getByRole('spinbutton', { name: 'Microphone timing offset', exact: true }).fill('120');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await play().click();
  await page.waitForFunction(() => Number(document.querySelector('.rhythm-stats').dataset.onTime) >= 3);
  await page.screenshot({ path: 'test-results/rhythm-desktop.png' });
  await page.getByRole('combobox', { name: 'Rhythm practice voice', exact: true }).selectOption('all');
  assert.equal(await page.getByRole('combobox', { name: 'Rhythm practice voice', exact: true }).inputValue(), 'all');
  await pause().click();
  await page.evaluate(() => { window.injectPerformance = false; window.injectCalibration = true; });
  await page.getByRole('button', { name: 'Calibrate speakers', exact: true }).click();
  await page.getByText(/Speaker\/microphone alignment:/).waitFor();
  const offset = Number(await page.getByRole('spinbutton', { name: 'Microphone timing offset', exact: true }).inputValue());
  assert.ok(Math.abs(offset - 120) < 45, `Calibration recovers injected 120 ms delay (measured ${offset} ms)`);
  await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testMicTrack.readyState), 'ended', 'Stop releases the input track');
  await page.evaluate(() => { window.denyMicrophone = true; });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await page.getByText(/Microphone permission was denied/).waitFor();
  await page.evaluate(() => { window.denyMicrophone = false; window.holdMicrophone = true; window.resolveMicrophone = undefined; });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await page.waitForFunction(() => typeof window.resolveMicrophone === 'function');
  await page.getByRole('button', { name: 'Cancel microphone', exact: true }).click();
  await page.evaluate(() => window.resolveMicrophone());
  await page.waitForFunction(() => window.testMicTrack.readyState === 'ended');
  assert.equal(await page.getByRole('button', { name: 'Enable microphone', exact: true }).count(), 1, 'Late permission completion cannot restart a canceled input');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.locator('.rhythm-options').evaluate(element => element.open = false);
  await page.screenshot({ path: 'test-results/rhythm-tablet.png' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Rhythm view fits a tablet');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/rhythm-phone.png' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'Phone has no page overflow');
  if (process.env.CHECK_OFFLINE) {
    await page.context().setOffline(true); await page.reload(); await ready();
    await page.getByRole('button', { name: 'Rhythm feedback', exact: true }).click();
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
    await page.context().setOffline(false);
  }
  assert.deepEqual(errors, []); assert.deepEqual(uploads, [], 'No microphone audio is uploaded');
  console.log('PASS: focused-control transport shortcuts; worklet input, late/on-time detection, offset, calibration, stop/denial/cancel, and responsive rhythm feedback.');
} catch (error) {
  console.log('Browser errors:', errors);
  await page.screenshot({ path: 'test-results/rhythm-failure.png' });
  throw error;
} finally { await browser.close(); }
