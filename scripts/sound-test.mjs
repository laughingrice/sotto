import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const chromeArgument = process.argv.indexOf('--chrome');
const chromePath = process.env.CHROME_PATH || (chromeArgument >= 0 ? process.argv[chromeArgument + 1] : undefined);
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('sotto.countIn', 'false');
  window.clickEvents = []; window.instrumentEvents = []; window.oscillatorStarts = 0;
  const sourceStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (this.buffer && Math.abs(this.buffer.duration - .035) < .0001) {
      const samples = this.buffer.getChannelData(0);
      let peak = 0, high = 0, low = 0;
      for (let index = 0; index < samples.length; index++) {
        peak = Math.max(peak, Math.abs(samples[index]));
        high += samples[index] * Math.sin(2 * Math.PI * 1800 * index / this.buffer.sampleRate);
        low += samples[index] * Math.sin(2 * Math.PI * 1100 * index / this.buffer.sampleRate);
      }
      window.clickEvents.push({ time: args[0], peak, accented: high > low });
    }
    if (this.buffer && this.buffer.duration > .1) {
      const data = this.buffer.getChannelData(0);
      const length = Math.min(data.length, Math.floor(this.buffer.sampleRate * .5));
      let sum = 0, fingerprint = 0;
      for (let index = 0; index < length; index++) { sum += data[index] ** 2; fingerprint += data[index] * ((index % 37) + 1); }
      window.instrumentEvents.push({ time: args[0], duration: this.buffer.duration, rms: Math.sqrt(sum / length), fingerprint });
    }
    return sourceStart.apply(this, args);
  };
  const oscillatorStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...args) { window.oscillatorStarts++; return oscillatorStart.apply(this, args); };
});
await mkdir('test-results', { recursive: true });
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4174/sotto/');
  await page.getByRole('heading', { name: 'Julia Florida', exact: true }).waitFor();
  await page.getByRole('slider', { name: 'Tempo', exact: true }).fill('120');
  await page.getByRole('button', { name: 'Metronome', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Metronome"]').dataset.mode === 'playback');
  assert.equal(await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('data-mode'), 'playback');
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.clickEvents.length), 0, 'Playback mode stays silent while paused');
  await page.getByRole('button', { name: 'Metronome', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('data-mode'), 'continuous');
  await page.waitForFunction(() => window.clickEvents.length >= 3);
  let events = await page.evaluate(() => window.clickEvents);
  assert.ok(events.length >= 3, 'Standalone metronome schedules audible click buffers');
  assert.ok(events.every(event => event.peak > .1), 'Click buffers have a nontrivial signal');
  assert.ok(events[0].accented && !events[1].accented && events[2].accented, 'Downbeats alternate with regular beats in 6/8');
  assert.ok(Math.abs(events[1].time - events[0].time - .5) < .01, '120 BPM clicks use the audio clock');
  assert.equal(Number(await page.getByRole('slider', { name: 'Playback position', exact: true }).inputValue()), 0, 'Standalone clicks do not advance the score');
  assert.ok(Number(await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('data-tick-count')) >= 2, 'Visual pulse follows audible clicks');
  await page.getByRole('button', { name: 'Sound and metronome settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Metronome pulse', exact: true }).selectOption('subdivision');
  await page.waitForTimeout(850);
  events = await page.evaluate(() => window.clickEvents);
  const tail = events.slice(-4);
  for (let index = 1; index < tail.length; index++) assert.ok(Math.abs(tail[index].time - tail[index - 1].time - 1 / 6) < .015, 'Subdivisions are three times faster than dotted-quarter beats');
  await page.getByRole('slider', { name: 'Metronome volume', exact: true }).fill('45');
  await page.getByRole('combobox', { name: 'Playback instrument', exact: true }).selectOption('piano');
  await page.getByRole('combobox', { name: 'Playback instrument', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[aria-label="Playback instrument"]').disabled);
  assert.equal(await page.getByRole('combobox', { name: 'Playback instrument', exact: true }).locator('option').count(), 8);
  await page.screenshot({ path: 'test-results/sound-settings.png' });
  await page.getByRole('button', { name: 'Metronome mode', exact: true }).click();
  await page.getByRole('button', { name: 'Close sound settings', exact: true }).click();
  await page.waitForTimeout(200);
  const stoppedCount = (await page.evaluate(() => window.clickEvents)).length;
  await page.waitForTimeout(400);
  assert.equal((await page.evaluate(() => window.clickEvents)).length, stoppedCount, 'Turning the metronome off stops the click stream');
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => window.instrumentEvents)).length > 0, 'Recorded piano schedules decoded audio recordings');
  for (const instrument of ['violin', 'organ', 'flute', 'marimba', 'guitar']) {
    await page.getByRole('button', { name: 'Sound and metronome settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Playback instrument', exact: true }).selectOption(instrument);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Playback instrument"]').disabled);
    await page.getByRole('button', { name: 'Close sound settings', exact: true }).click();
    await page.getByRole('button', { name: 'Pause playback', exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'Metronome', exact: true }).click();
  await page.waitForTimeout(550);
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('data-mode'), 'playback');
  const pausedClicks = await page.evaluate(() => window.clickEvents.length);
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.clickEvents.length), pausedClicks, 'Playback mode stops clicks with the score');
  await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
  await page.getByRole('button', { name: 'Metronome', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('data-mode'), 'continuous', 'Compact metronome cycles modes');
  await page.waitForFunction(count => window.clickEvents.length > count, pausedClicks);
  await page.getByRole('button', { name: 'Metronome', exact: true }).click();
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
  await page.getByRole('button', { name: 'Sound and metronome settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Playback instrument', exact: true }).selectOption('violin');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Playback instrument"]').disabled);
  await page.getByRole('button', { name: 'Close sound settings', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.context().setOffline(true); await page.reload();
  await page.getByRole('heading', { name: 'Julia Florida', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sound and metronome settings', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Playback instrument', exact: true }).inputValue(), 'violin', 'Recorded violin choice is remembered offline');
  await page.getByRole('button', { name: 'Metronome mode', exact: true }).click();
  await page.getByRole('button', { name: 'Metronome mode', exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => window.clickEvents)).length > 0, 'Metronome works offline');
  await page.getByRole('button', { name: 'Close sound settings', exact: true }).click();
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  await page.getByRole('button', { name: 'Pause playback', exact: true }).waitFor();
  await page.waitForFunction(() => window.instrumentEvents.length > 0);
  assert.ok((await page.evaluate(() => window.instrumentEvents)).some(event => event.rms > .01), 'Recorded violin is decoded and played while offline');
  assert.deepEqual(errors, []);
  console.log('PASS: audible accented standalone clicks, audio-clock tempo, subdivisions, volume UI, instrument choices, live switching, and offline metronome/preferences.');
} catch (error) {
  console.log('Browser errors:', errors);
  console.log('Click events:', await page.evaluate(() => window.clickEvents));
  console.log('Metronome state:', await page.getByRole('button', { name: 'Metronome', exact: true }).getAttribute('aria-pressed').catch(() => 'not available'));
  await page.screenshot({ path: 'test-results/sound-failure.png' }); throw error;
} finally { await browser.close(); }
