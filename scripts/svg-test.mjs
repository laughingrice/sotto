import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const optimizedDirectory = arg('--optimized-dir');
const originalDirectory = arg('--original-dir') || new URL('../public/scores/samples/', import.meta.url).pathname;
if (!optimizedDirectory) throw new Error('Pass --optimized-dir with optimized .sotto files; public samples supply the baseline.');
const browser = await chromium.launch({ headless: true, executablePath: arg('--chrome') || process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const rendering = await browser.newPage({ viewport: { width: 1200, height: 2000 }, reducedMotion: 'reduce' });
const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
async function render(svg) {
  await rendering.setContent(`<style>${styles}html,body{height:auto;overflow:visible;display:block;margin:0;padding:0}.score-page{width:1000px;margin:0}</style><div class="score-page"><div>${svg}</div></div>`);
  await rendering.evaluate(() => document.fonts.ready);
  return rendering.locator('.score-page').screenshot({ animations: 'disabled' });
}
const errors = []; page.on('pageerror', error => errors.push(error.message));
const catalog = JSON.parse(await readFile(new URL('../public/scores/samples/catalog.json', import.meta.url), 'utf8'));
await mkdir('test-results/svg', { recursive: true });
async function load(bundle, name) {
  await page.locator('[data-score-input]').setInputFiles({ name: `${name}.sotto.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await page.getByRole('heading', { name: bundle.title, exact: true }).waitFor();
  await page.waitForFunction(expected => document.querySelectorAll('.score-note').length === expected, bundle.notes.length);
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const svg of document.querySelectorAll('.score-page svg')) {
      const notes = [...svg.querySelectorAll('.score-note')];
      notes.slice(0, 3).forEach(note => note.classList.add('is-active'));
      notes.slice(3, 6).forEach(note => note.classList.add('voice-muted'));
    }
  });
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const box = element => {
      const rect = element.getBBox(), matrix = element.getCTM();
      return [rect.x, rect.y, rect.width, rect.height, matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
    };
    return {
      pages: [...document.querySelectorAll('.score-page svg')].map(svg => svg.outerHTML),
      notes: [...document.querySelectorAll('.score-note')].map(note => ({ id: note.id, voice: note.dataset.voice, box: box(note) })),
      bars: [...document.querySelectorAll('.current-bar-highlight')].map(box),
      broken: [...document.querySelectorAll('use')].filter(use => !document.getElementById(use.getAttribute('href')?.slice(1))).length,
      ids: [...document.querySelectorAll('.score-page [id]')].map(node => node.id),
    };
  });
}
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4179/sotto/');
  await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  let pages = 0;
  for (const item of catalog.scores) {
    const original = JSON.parse(gunzipSync(await readFile(`${originalDirectory}/${item.file}`)));
    const optimized = JSON.parse(gunzipSync(await readFile(`${optimizedDirectory}/${item.file}`)));
    assert.deepEqual({ ...optimized, pages: [] }, { ...original, pages: [] }, 'All musical metadata stays identical');
    const before = await load(original, `${item.id}-original`);
    const images = [];
    for (const svg of before.pages) images.push(await render(svg));
    // Change the title so waiting also guarantees React has opened this version.
    const after = await load({ ...optimized, title: `${original.title} · optimized` }, `${item.id}-optimized`);
    assert.equal(after.broken, 0); assert.equal(new Set(after.ids).size, after.ids.length, 'No SVG IDs collide across pages');
    for (const key of ['notes', 'bars']) {
      assert.equal(before[key].length, after[key].length, `${item.id}: ${key} count`);
      for (let i = 0; i < before[key].length; i++) {
        const a = before[key][i], b = after[key][i];
        if (key === 'notes') { assert.equal(a.id, b.id); assert.equal(a.voice, b.voice); }
        const av = a.box ?? a, bv = b.box ?? b;
        assert.ok(av.every((n, j) => Math.abs(n - bv[j]) < .0001), `${item.id}: ${key} geometry ${i} differs: ${av} vs ${bv}`);
      }
    }
    for (let i = 0; i < original.pages.length; i++) {
      const current = await render(after.pages[i]);
      if (!images[i].equals(current)) {
        await writeFile(`test-results/svg/${item.id}-${i}-before.png`, images[i]);
        await writeFile(`test-results/svg/${item.id}-${i}-after.png`, current);
        throw new Error(`${item.id} page ${i + 1}: rendered pixels differ; comparison images saved.`);
      }
      pages++;
    }
    const seekNote = optimized.notes.find(note => note.beat > 0);
    const noteElement = page.locator(`[id="${seekNote.id}"]`);
    const glyph = noteElement.locator('use').first();
    await (await glyph.count() ? glyph : noteElement).click();
    assert.ok(Number(await page.getByRole('slider', { name: 'Playback position', exact: true }).inputValue()) > 0, 'Clicking rendered glyphs still seeks');
    console.log(`PASS ${item.id}: ${original.pages.length} identical page images, note geometry, bar highlights and resolved glyph references.`);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${pages} pages across ten scores, including colored active notes and muted voices.`);
} finally { await browser.close(); }
