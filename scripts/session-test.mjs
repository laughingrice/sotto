import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const browser = await chromium.launch({ headless: true, executablePath: arg('--chrome') || process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.permissionRequests = 0; window.micRequests = 0; window.instrumentStarts = 0; window.clickStarts = 0;
  navigator.mediaDevices.getUserMedia = async () => { window.micRequests++; throw new Error('Unexpected microphone start'); };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) { if (Math.abs((this.buffer?.duration ?? 0) - .035) < .0001) window.clickStarts++; if (this.buffer?.duration > .1 && !this.loop) window.instrumentStarts++; return start.apply(this, args); };
});
const fixture = JSON.parse(await readFile(new URL('../public/scores/julia-florida.sotto.json', import.meta.url), 'utf8'));
const heading = title => page.getByRole('heading', { name: title, exact: true, includeHidden: true }).waitFor({ state: 'attached' });
const button = name => page.getByRole('button', { name, exact: true });
const slider = name => page.getByRole('slider', { name, exact: true });
const select = name => page.getByRole('combobox', { name, exact: true });
const openSettings = () => button('Sound and metronome settings').click();
const closeSettings = () => button('Back to the music').click();
const openBook = async title => {
  await button('Score library').click();
  await page.locator('.library-entry').filter({ has: button(`Favorite ${title}`) }).locator('.library-open').click();
};
await mkdir('test-results', { recursive: true });
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4176/sotto/'); await heading('Julia Florida');
  await page.evaluate(async fixture => {
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('practice-a.sotto.json', { create: true });
    const writer = await file.createWritable(); await writer.write(JSON.stringify({ ...fixture, title: 'Practice A' })); await writer.close();
    window.showOpenFilePicker = async () => [file];
  }, fixture);
  await button('Open score').click(); await heading('Practice A');
  await slider('Tempo').fill('63');
  await page.getByRole('checkbox', { name: 'Follow repeats & jumps', exact: true }).uncheck();
  await select('Loop start measure').selectOption('5'); await select('Loop end measure').selectOption('8');
  await page.getByRole('switch', { name: 'Practice loop', exact: true }).click();
  await slider('Playback position').fill('21');
  await button('Mute bass').click(); await button('Solo melody').click(); await slider('Melody volume').fill('55');
  await page.getByRole('checkbox', { name: 'Follow score', exact: true }).uncheck();
  for (let i = 0; i < 3; i++) await button('Zoom in').click();
  await openSettings();
  await select('Playback instrument').selectOption('piano');
  await select('Playback octave').selectOption('-12');
  await select('Metronome pulse').selectOption('subdivision'); await slider('Metronome volume').fill('38');
  await page.getByRole('checkbox', { name: 'One-bar count-in', exact: true }).check();
  await button('Metronome mode').click(); await button('Metronome mode').click(); await closeSettings();
  await button('Rhythm feedback').click(); await page.locator('.rhythm-options summary').click();
  await select('Rhythm practice voice').selectOption('bass');
  await button('Hide controls').click();
  await page.waitForTimeout(650);
  await page.reload(); await heading('Practice A');
  assert.equal(await button('Show controls').count(), 1, 'Collapsed controls are remembered');
  assert.equal(await button('Fit score to width').innerText(), '130%');
  assert.equal(await button('Metronome').getAttribute('data-mode'), 'continuous');
  assert.ok(await page.locator('.rhythm-panel').isVisible());
  assert.deepEqual(await page.evaluate(() => [window.instrumentStarts, window.micRequests, window.clickStarts]), [0, 0, 0], 'Resume never starts audio or the microphone');
  await button('Show controls').click();
  assert.equal(await slider('Tempo').inputValue(), '63');
  assert.equal(await slider('Playback position').inputValue(), '21');
  assert.equal(await select('Loop start measure').inputValue(), '5'); assert.equal(await select('Loop end measure').inputValue(), '8');
  assert.equal(await page.getByRole('switch', { name: 'Practice loop', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal(await page.getByRole('checkbox', { name: 'Follow repeats & jumps', exact: true }).isChecked(), false);
  assert.equal(await page.getByRole('checkbox', { name: 'Follow score', exact: true }).isChecked(), false);
  assert.equal(await button('Unmute bass').getAttribute('aria-pressed'), 'true');
  assert.equal(await button('Solo melody').getAttribute('aria-pressed'), 'true'); assert.equal(await slider('Melody volume').inputValue(), '55');
  await page.locator('.rhythm-options summary').click(); assert.equal(await select('Rhythm practice voice').inputValue(), 'bass');
  await openSettings();
  for (const [name, value] of [['Playback instrument', 'piano'], ['Playback octave', '-12'], ['Metronome pulse', 'subdivision']]) assert.equal(await select(name).inputValue(), value);
  assert.equal(await slider('Metronome volume').inputValue(), '38');
  assert.equal(await page.getByRole('checkbox', { name: 'One-bar count-in', exact: true }).isChecked(), true); await closeSettings();
  // An accessible source file wins over the cached copy, while keeping its practice settings.
  await page.evaluate(async fixture => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle('practice-a.sotto.json');
    const writer = await file.createWritable(); await writer.write(JSON.stringify({ ...fixture, title: 'Practice A updated' })); await writer.close();
  }, fixture);
  await page.reload(); await heading('Practice A updated'); assert.equal(await slider('Tempo').inputValue(), '63');
  // A revoked/prompting handle must not request permission during startup; use the cache.
  await page.addInitScript(() => {
    FileSystemFileHandle.prototype.queryPermission = async () => 'prompt';
    FileSystemFileHandle.prototype.requestPermission = async () => { window.permissionRequests++; return 'granted'; };
  });
  await page.evaluate(async fixture => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle('practice-a.sotto.json');
    const writer = await file.createWritable(); await writer.write(JSON.stringify({ ...fixture, title: 'Practice A newest' })); await writer.close();
  }, fixture);
  await page.reload(); await heading('Practice A updated');
  assert.equal(await page.evaluate(() => window.permissionRequests), 0, 'Startup never prompts for file access');
  // A second song replaces the sole cache slot, but gets its own practice settings.
  await page.evaluate(() => { window.showOpenFilePicker = undefined; });
  await page.locator('[data-score-input]').setInputFiles({ name: 'practice-b.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixture, title: 'Practice B' })) });
  await heading('Practice B'); assert.equal(await slider('Tempo').inputValue(), String(fixture.bpm));
  assert.equal(await page.getByRole('switch', { name: 'Practice loop', exact: true }).getAttribute('aria-checked'), 'false');
  await slider('Tempo').fill('91'); await slider('Playback position').fill('9');
  await openBook('Practice A updated'); await heading('Practice A newest');
  assert.equal(await slider('Tempo').inputValue(), '63'); assert.equal(await slider('Playback position').inputValue(), '21');
  await openSettings(); assert.equal(await select('Playback octave').inputValue(), '-12'); await closeSettings();
  await openBook('Practice B'); await heading('Practice B'); assert.equal(await slider('Tempo').inputValue(), '91');
  await page.waitForTimeout(650);
  const stored = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('sotto-library'); request.onsuccess = () => resolve(request.result); });
    const values = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').getAll(); request.onsuccess = () => resolve(request.result); }); db.close();
    return { caches: values.filter(value => value.score).map(value => value.score.title), indexHasScore: values.filter(value => value.entries).some(value => JSON.stringify(value).includes('<svg')) };
  });
  assert.deepEqual(stored, { caches: ['Practice B'], indexHasScore: false }, 'Exactly one song is cached; the library index stays metadata-only');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.context().setOffline(true); await page.reload(); await heading('Practice B');
  assert.equal(await slider('Tempo').inputValue(), '91'); assert.equal(await slider('Playback position').inputValue(), '9');
  assert.deepEqual(await page.evaluate(() => [window.instrumentStarts, window.micRequests, window.permissionRequests, window.clickStarts]), [0, 0, 0, 0]);
  await page.screenshot({ path: 'test-results/resumed-practice.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: last-song cache, fresh linked files, quiet/offline resume, per-song practice state, general preferences, and a single cached score.');
} catch (error) { await page.screenshot({ path: 'test-results/session-failure.png' }); throw error; }
finally { await browser.close(); }
