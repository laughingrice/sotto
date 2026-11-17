import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const chromeArgument = process.argv.indexOf('--chrome');
const executablePath = process.env.CHROME_PATH || (chromeArgument >= 0 ? process.argv[chromeArgument + 1] : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.BASE_URL || 'http://localhost:4174/sotto/';
const heading = name => page.getByRole('heading', { name, exact: true });
await mkdir('test-results', { recursive: true });
try {
  await page.goto(base);
  await heading('Étude Op. 60 No. 1').waitFor();
  await page.getByRole('button', { name: 'Next measure', exact: true }).click();
  const position = await page.getByRole('slider', { name: 'Playback position', exact: true }).inputValue();
  const helpButton = page.getByRole('button', { name: 'Help and keyboard shortcuts' });
  await helpButton.click();
  await heading('Sotto help').waitFor();
  await heading('Start practicing').waitFor();
  assert.equal(new URL(page.url()).hash, '#help');
  await page.getByRole('navigation', { name: 'Help topics' }).getByRole('button', { name: 'Parts & instruments' }).click();
  await heading('Parts & instruments').waitFor();
  assert.equal(new URL(page.url()).hash, '#help/sounds');
  await page.screenshot({ path: 'test-results/help-desktop.png' });
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.app').getByRole('button', { name: 'Pause playback', includeHidden: true }).count(), 0, 'Help keys do not start the score');
  const search = page.getByRole('textbox', { name: 'Search help' });
  await search.fill('latency');
  await heading('Microphone rhythm and pitch feedback').waitFor();
  await search.fill('no-such-feature');
  await heading('No matching topics').waitFor();
  await page.getByRole('button', { name: 'Show all topics' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.waitForURL(base);
  assert.equal(await page.getByRole('slider', { name: 'Playback position', exact: true }).inputValue(), position, 'Reading help preserves the playback position');
  assert.equal(await helpButton.evaluate(element => document.activeElement === element), true, 'Closing help restores keyboard focus');
  await helpButton.click();
  await heading('Sotto help').waitFor();
  await page.goBack();
  assert.equal(await page.getByRole('dialog').count(), 0, 'Browser Back returns to music');

  await page.goto(`${base}#help/preparing`);
  await heading('Prepare a new score').waitFor();
  await page.getByText('Exporter command', { exact: true }).click();
  assert.equal((await page.locator('.guide-article pre').innerText()).trim(), 'python3 scripts/export_score.py path/to/piece.ly', 'Exporter command is copyable and uses automatic metadata');
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.getByRole('combobox', { name: 'Help topic', exact: true }).selectOption('microphone');
    assert.ok(await page.locator('.guide-page').evaluate(element => element.scrollWidth <= innerWidth), 'Help fits narrow screens');
    const content = page.locator('.guide-article');
    await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.ok(await content.evaluate(element => element.scrollTop > 0), 'Long help topics scroll independently');
    const closeBox = await page.getByRole('button', { name: 'Close help' }).boundingBox();
    assert.ok(closeBox && closeBox.y >= 0 && closeBox.y + closeBox.height <= 900, 'Close stays reachable while reading');
    await content.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `test-results/help-${width}.png` });
  }
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await heading('Microphone rhythm and pitch feedback').waitFor();
  await page.getByRole('button', { name: 'Close help' }).click();
  await page.waitForURL(base);
  await helpButton.click();
  await heading('Start practicing').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: help topics/search, keyboard isolation, focus/position restore, direct links, browser Back, tablet/phone layout and offline help.');
} catch (error) {
  await page.screenshot({ path: 'test-results/help-failure.png' });
  throw error;
} finally { await browser.close(); }
