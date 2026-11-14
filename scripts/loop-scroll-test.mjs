import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const chromeArgument = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: chromeArgument >= 0 ? process.argv[chromeArgument + 1] : process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => localStorage.setItem('sotto.countIn', 'false'));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('test-results', { recursive: true });
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4176/sotto/');
  await page.getByRole('heading', { name: 'Julia Florida', exact: true }).waitFor();
  // Two short bars on the first line, with the next line well below the viewport.
  const fixture = { format: 'sotto-score', version: 1, title: 'Loop boundary', composer: '', subtitle: '', description: '',
    beatsPerBar: 1, beatUnit: 1, bpm: 150, voices: [{ id: 'melody', name: 'Melody', color: '#31745e' }],
    bars: Array.from({ length: 4 }, (_, index) => ({ index, label: String(index + 1), start: index, duration: 1, meter: [1, 4] })),
    sequence: [0, 1, 2, 3],
    notes: Array.from({ length: 4 }, (_, index) => ({ id: `loop-${index}`, voice: 'melody', beat: index, duration: .9, midi: 60 + index, grace: 0, tie: false, measure: index, bar: index + 1 })),
    pages: ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">' + Array.from({ length: 4 }, (_, index) => `<g id="loop-${index}" class="score-note" data-voice="melody"><circle cx="${30 + index % 2 * 100}" cy="${30 + Math.floor(index / 2) * 200}" r="2"/></g>`).join('') + '</svg>'] };
  await page.locator('[data-score-input]').setInputFiles({ name: 'loop.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('heading', { name: 'Loop boundary', exact: true }).waitFor();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('combobox', { name: 'Loop end measure', exact: true }).selectOption('1');
  await page.getByRole('switch', { name: 'Practice loop', exact: true }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.waitForTimeout(500);
  const nextBar = await page.locator('#loop-2').boundingBox();
  const viewport = await page.locator('.score-scroller').boundingBox();
  assert.ok(nextBar.y > viewport.y + viewport.height, 'Next line is below view at this zoom');
  await page.evaluate(() => {
    window.loopBars = []; window.loopScrolls = [];
    const record = () => { const bar = document.querySelector('.current-bar-highlight.is-current'); if (bar) window.loopBars.push(Number(bar.dataset.barIndex)); };
    window.loopObserver = new MutationObserver(record);
    window.loopObserver.observe(document.querySelector('.score-pages'), { attributes: true, attributeFilter: ['class'], subtree: true });
    const scroller = document.querySelector('.score-scroller');
    const scrollTo = scroller.scrollTo.bind(scroller);
    scroller.scrollTo = options => { window.loopScrolls.push({ bar: Number(document.querySelector('.current-bar-highlight.is-current')?.dataset.barIndex), top: options.top }); scrollTo(options); };
  });
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  await page.waitForTimeout(6500);
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  const result = await page.evaluate(() => ({ bars: window.loopBars, scrolls: window.loopScrolls }));
  assert.ok(result.bars.filter((bar, index) => bar === 0 && result.bars[index - 1] === 1).length >= 4, 'Observed multiple loop wraps');
  assert.ok(result.bars.every(bar => bar <= 1), `Loop must never highlight the following line: ${result.bars}`);
  assert.ok(result.scrolls.every(scroll => scroll.bar <= 1), `Loop must never follow a bar past its end: ${JSON.stringify(result.scrolls)}`);
  const firstLine = await page.locator('#loop-0').boundingBox();
  assert.ok(firstLine.y >= viewport.y && firstLine.y < viewport.y + viewport.height, 'First-line loop stays visible');
  await page.screenshot({ path: 'test-results/loop-scroll.png' });
  await page.getByRole('switch', { name: 'Practice loop', exact: true }).click();
  await page.getByRole('slider', { name: 'Playback position', exact: true }).fill('2');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.current-bar-highlight.is-current').getAttribute('data-bar-index'), '2', 'Disabling loop restores navigation to the next line');
  const followed = await page.locator('#loop-2').boundingBox();
  assert.ok(followed.y >= viewport.y && followed.y < viewport.y + viewport.height, 'Normal following still scrolls to the next line');
  assert.deepEqual(errors, []);
  console.log('PASS: zoomed line-end loop never highlights or scrolls to the following bar; normal navigation still follows.');
} catch (error) {
  await page.screenshot({ path: 'test-results/loop-scroll-failure.png' });
  throw error;
} finally { await browser.close(); }
