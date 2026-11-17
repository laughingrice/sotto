import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
const argument = process.argv.indexOf('--chrome');
const executablePath = argument >= 0 ? process.argv[argument + 1] : process.env.CHROME_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const source = JSON.parse(gunzipSync(await readFile(new URL('../public/scores/samples/adelita.sotto', import.meta.url))).toString());
const heading = title => page.getByRole('heading', { name: title, exact: true });
async function upload(title, compressed, name) {
  const bytes = Buffer.from(JSON.stringify({ ...source, title }));
  await page.locator('[data-score-input]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: compressed ? gzipSync(bytes) : bytes });
  await heading(title).waitFor();
  assert.equal(await page.locator('.score-note').count(), source.notes.length);
}
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4179/sotto/');
  await heading('Étude Op. 60 No. 1').waitFor();
  await upload('Legacy import', false, 'legacy.sotto.json');
  await upload('Compressed import', true, 'compressed.sotto');
  await upload('Detected by content', true, 'renamed.json');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save score', exact: true }).click()]);
  assert.ok(download.suggestedFilename().endsWith('.sotto'));
  const saved = await readFile(await download.path());
  assert.deepEqual([...saved.subarray(0, 2)], [0x1f, 0x8b]);
  const restored = JSON.parse(gunzipSync(saved));
  assert.equal(restored.title, 'Detected by content');
  assert.deepEqual(restored.provenance, source.provenance);
  await upload('Another piece', false, 'other.sotto.json');
  await page.locator('[data-score-input]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/gzip', buffer: saved });
  await heading('Detected by content').waitFor();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('sotto-library'); r.onsuccess = () => resolve(r.result); });
    const cached = await new Promise(resolve => { const r = db.transaction('library').objectStore('library').get('last-score'); r.onsuccess = () => resolve(r.result); }); db.close();
    if (!(cached?.data instanceof Blob) || cached.score) return false;
    const score = JSON.parse(await new Response(cached.data.stream().pipeThrough(new DecompressionStream('gzip'))).text());
    return score.title === 'Detected by content';
  });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.context().setOffline(true); await page.reload();
  await heading('Detected by content').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: legacy and gzip imports, content detection, compressed Save/Open, provenance and compressed offline resume.');
} finally { await browser.close(); }
