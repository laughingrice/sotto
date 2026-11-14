import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const browser = await chromium.launch({ headless: true, executablePath: arg('--chrome') || process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const fixture = JSON.parse(await readFile(new URL('../public/scores/julia-florida.sotto.json', import.meta.url), 'utf8'));
const button = name => page.getByRole('button', { name, exact: true });
const paths = ['Violin/Vivaldi/Book 1/Pieces/Spring/spring.sotto.json', 'Guitar/Tarrega/Book 2/marieta.sotto.json'];
await mkdir('test-results', { recursive: true });
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4176/sotto/');
  await page.getByRole('heading', { name: 'Julia Florida', exact: true }).waitFor();
  await page.evaluate(async ({ fixture, paths }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Cloud scores', { create: true });
    for (const path of paths) {
      const parts = path.split('/'); let directory = root;
      for (const name of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(name, { create: true });
      const file = await directory.getFileHandle(parts.at(-1), { create: true }); const writer = await file.createWritable();
      await writer.write(JSON.stringify({ ...fixture, title: path.startsWith('Violin') ? 'Spring for two violins' : 'Marieta', composer: path.startsWith('Violin') ? 'Vivaldi' : 'Tarrega' })); await writer.close();
    }
    window.showDirectoryPicker = async () => root;
    window.scoreFileReads = [];
    const getFile = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = function (...args) { window.scoreFileReads.push(this.name); return getFile.apply(this, args); };
  }, { fixture, paths });
  await button('Score library').click(); await button('Connect folder').click(); await button('Refresh').waitFor();
  assert.deepEqual(await page.evaluate(() => window.scoreFileReads), [], 'Connect enumerates names without opening/downloading any score file');
  const leaf = button('Favorite spring');
  assert.equal(await leaf.isVisible(), false, 'Nested folders start collapsed');
  for (const path of ['Violin', 'Violin/Vivaldi', 'Violin/Vivaldi/Book 1', 'Violin/Vivaldi/Book 1/Pieces', 'Violin/Vivaldi/Book 1/Pieces/Spring']) {
    await page.locator(`summary[data-directory-path="${path}"]`).click();
  }
  await leaf.waitFor();
  assert.equal(await button('Favorite Spring for two violins').count(), 0, 'Unopened files use their filename, not fetched metadata');
  const springRow = page.locator('.library-entry').filter({ has: leaf });
  await springRow.locator('.library-open').click(); await page.getByRole('heading', { name: 'Spring for two violins', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.scoreFileReads), ['spring.sotto.json'], 'Opening one score touches only its file');
  await button('Score library').click(); await button('Favorite Spring for two violins').click();
  await button('Refresh').click(); await page.getByText('Refreshed Cloud scores.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.scoreFileReads), ['spring.sotto.json'], 'Refresh does not reread even known scores');
  assert.equal(await button('Favorite Spring for two violins').getAttribute('aria-pressed'), 'true');
  const search = page.getByRole('textbox', { name: 'Search library', exact: true });
  await search.fill('marieta'); await button('Favorite marieta').waitFor();
  assert.equal(await button('Favorite Spring for two violins').count(), 0);
  await search.fill('Vivaldi'); await button('Favorite Spring for two violins').waitFor();
  await search.fill(''); await page.getByRole('checkbox', { name: 'Favorites', exact: true }).check();
  assert.equal(await page.locator('.library-entry').count(), 1, 'Favorites searches across folder levels');
  await page.getByRole('checkbox', { name: 'Favorites', exact: true }).uncheck();
  const [download] = await Promise.all([page.waitForEvent('download'), button('Export backup').click()]);
  const text = await readFile(await download.path(), 'utf8'), backup = JSON.parse(text);
  assert.deepEqual(backup.entries.map(entry => entry.path).sort(), [...paths].sort());
  assert.ok(!text.includes('<svg') && !text.includes('"notes"'), 'Nested library backup remains references and settings only');
  // A browser without directory handles receives paths but must not parse files on connect.
  await page.evaluate(fixture => {
    window.showDirectoryPicker = undefined; window.scoreTextReads = 0;
    const read = File.prototype.text;
    File.prototype.text = function (...args) { if (this.name.endsWith('.sotto.json')) window.scoreTextReads++; return read.apply(this, args); };
    const file = new File([JSON.stringify({ ...fixture, title: 'Fallback piece', composer: 'Composer' })], 'fallback.sotto.json');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Fallback scores/Violin/Composer/Book/Pieces/fallback.sotto.json' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('[aria-label="Connect score folder"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixture);
  await search.fill('fallback'); await button('Favorite fallback').waitFor();
  assert.equal(await page.evaluate(() => window.scoreTextReads), 0, 'Fallback folder connection also avoids all score reads');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Deep folder tree fits phone width');
  await button('Favorite fallback').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/library-nested-phone.png' });
  await page.locator('.library-entry').filter({ has: button('Favorite fallback') }).locator('.library-open').click();
  await page.getByRole('heading', { name: 'Fallback piece', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.scoreTextReads), 1, 'Fallback metadata is learned only when opening the file');
  await page.setViewportSize({ width: 1440, height: 1000 }); await button('Score library').click();
  await search.fill('fallback'); await button('Favorite Fallback piece').waitFor();
  await page.screenshot({ path: 'test-results/library-nested.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: five folder levels, lazy filename discovery, opening only the selected file, metadata/favorite retention, nested search, portable paths and phone layout.');
} catch (error) { await page.screenshot({ path: 'test-results/library-folders-failure.png' }); throw error; }
finally { await browser.close(); }
