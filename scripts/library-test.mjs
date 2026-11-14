import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const browser = await chromium.launch({ headless: true, executablePath: option('--chrome') || process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const fixture = JSON.parse(await readFile(new URL('../public/scores/julia-florida.sotto.json', import.meta.url), 'utf8'));
fixture.title = 'Library fixture';
const inputScore = page.locator('[data-score-input]');
const ready = () => page.getByRole('heading', { name: 'Julia Florida', exact: true }).waitFor();
const openLibrary = () => page.getByRole('button', { name: 'Score library', exact: true }).click();
await mkdir('test-results', { recursive: true });
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:5175/'); await ready();
  // Use real structured-cloneable browser file handles in IndexedDB. The
  // test picker selects an isolated fixture, never the user's directories.
  await page.evaluate(async fixture => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('OneDrive test Scores', { create: true });
    const file = await directory.getFileHandle('fixture.sotto.json', { create: true });
    const writer = await file.createWritable(); await writer.write(JSON.stringify(fixture)); await writer.close();
    window.showOpenFilePicker = async () => [file];
    window.showDirectoryPicker = async () => directory;
  }, fixture);
  await page.getByRole('button', { name: 'Open score', exact: true }).click();
  await page.getByRole('heading', { name: 'Library fixture', exact: true }).waitFor();
  await openLibrary();
  await page.getByRole('button', { name: 'Favorite Library fixture', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.favorite-button')?.getAttribute('aria-pressed') === 'true');
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
  // Refresh must reuse the existing handle, never call the directory picker.
  await page.evaluate(async fixture => {
    window.showDirectoryPicker = async () => { throw new Error('Refresh opened the picker'); };
    const root = await navigator.storage.getDirectory(); const directory = await root.getDirectoryHandle('OneDrive test Scores');
    const file = await directory.getFileHandle('added.sotto.json', { create: true });
    const writer = await file.createWritable(); await writer.write(JSON.stringify({ ...fixture, title: 'Added score' })); await writer.close();
  }, fixture);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Favorite Added score', exact: true }).waitFor();
  // IDB contains references, not File/Blob objects or the SVG/notes payload.
  const stored = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('sotto-library'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const state = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('index'); request.onsuccess = () => resolve(request.result); }); db.close();
    return { json: JSON.stringify(state), handle: state.entries.some(entry => entry.handle instanceof FileSystemFileHandle), folder: state.folders[0].handle instanceof FileSystemDirectoryHandle };
  });
  assert.ok(stored.handle && stored.folder, 'Real file/folder handles survive IndexedDB storage');
  assert.ok(stored.json.length < 5000 && !stored.json.includes('<svg') && !stored.json.includes('"notes"'), 'Only a small reference index is stored');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup', exact: true }).click()]);
  const index = await readFile(await download.path(), 'utf8');
  assert.ok(index.length < 5000 && !index.includes('handle') && !index.includes('<svg'));
  assert.equal(JSON.parse(index).entries.filter(entry => entry.favorite).length, 1);
  await page.reload(); await page.getByRole('heading', { name: 'Library fixture', exact: true }).waitFor(); await openLibrary();
  assert.equal(await page.locator('.favorite-button.selected').getAttribute('aria-pressed'), 'true', 'Favorites persist across reloads');
  // The next panel open refreshes silently when permission is already granted.
  await page.keyboard.press('Escape');
  await page.evaluate(async fixture => {
    const root = await navigator.storage.getDirectory(); const directory = await root.getDirectoryHandle('OneDrive test Scores');
    const file = await directory.getFileHandle('automatic.sotto.json', { create: true });
    const writer = await file.createWritable(); await writer.write(JSON.stringify({ ...fixture, title: 'Automatic score' })); await writer.close();
  }, fixture);
  await openLibrary(); await page.getByRole('button', { name: 'Favorite Automatic score', exact: true }).waitFor();

  // A file changed by another application is read afresh, rather than from
  // a saved JSON/Blob snapshot.
  await page.evaluate(async fixture => {
    const root = await navigator.storage.getDirectory(); const directory = await root.getDirectoryHandle('OneDrive test Scores');
    const file = await directory.getFileHandle('fixture.sotto.json'); const writer = await file.createWritable();
    fixture.title = 'Updated on disk'; await writer.write(JSON.stringify(fixture)); await writer.close();
  }, fixture);
  await page.locator('.library-entry').filter({ has: page.locator('.favorite-button.selected') }).locator('.library-open').click();
  await page.getByRole('heading', { name: 'Updated on disk', exact: true }).waitFor();
  await openLibrary();
  await page.locator('.library-entry').filter({ has: page.locator('.favorite-button.selected') }).getByRole('button', { name: 'Remove Updated on disk bookmark', exact: true }).click();
  await page.locator('.favorite-button.selected').waitFor({ state: 'hidden' });
  assert.ok(await page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('OneDrive test Scores')).getFileHandle('fixture.sotto.json')).getFile().then(file => file.size > 0)), 'Removing bookmarks leaves the file intact');
  await page.keyboard.press('Escape');

  // Safari-style fallback reopens the single cached song; bookmarks still
  // require reselection to refresh from the source file.
  await page.evaluate(() => { window.showOpenFilePicker = undefined; window.showDirectoryPicker = undefined; });
  await inputScore.setInputFiles({ name: 'fallback.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixture, title: 'Fallback score' })) });
  await page.getByRole('heading', { name: 'Fallback score', exact: true }).waitFor();
  await page.reload(); await page.getByRole('heading', { name: 'Fallback score', exact: true }).waitFor(); await openLibrary();
  await page.evaluate(() => { window.showOpenFilePicker = undefined; });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.library-entry').filter({ has: page.getByRole('button', { name: 'Favorite Fallback score', exact: true }) }).locator('.library-open').click();
  await (await chooserPromise).setFiles({ name: 'fallback.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixture, title: 'Fallback score' })) });
  await page.getByRole('heading', { name: 'Fallback score', exact: true }).waitFor();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  // The fallback folder picker also reads metadata before opening a score.
  await openLibrary();
  await page.evaluate(fixture => {
    const file = new File([JSON.stringify({ ...fixture, title: 'Spring for two violins', composer: 'Vivaldi' })], 'spring.sotto.json');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Fallback scores/spring.sotto.json' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('[aria-label="Connect score folder"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixture);
  const spring = page.locator('.library-entry').filter({ has: page.getByRole('button', { name: 'Favorite Spring for two violins', exact: true }) });
  await spring.waitFor(); assert.ok((await spring.innerText()).includes('Vivaldi'), 'Fallback reconnect reads title and composer before opening the piece');
  await page.keyboard.press('Escape');
  // Hold an automatic directory scan across an index import. The later scan
  // must merge into the imported metadata instead of overwriting favorites.
  await page.evaluate(() => {
    window.testLibraryCommits = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args);
      if (this.name === 'library') this.transaction.addEventListener('complete', () => window.testLibraryCommits++);
      return result;
    };
    const values = FileSystemDirectoryHandle.prototype.values;
    window.holdDirectoryScan = true;
    FileSystemDirectoryHandle.prototype.values = async function* () {
      if (window.holdDirectoryScan && this.name === 'OneDrive test Scores') {
        await new Promise(resolve => { window.resumeDirectoryScan = () => { window.holdDirectoryScan = false; resolve(); }; });
      }
      yield* values.call(this);
    };
  });
  await openLibrary();
  await page.waitForFunction(() => typeof window.resumeDirectoryScan === 'function');
  await page.getByLabel('Import library backup', { exact: true }).setInputFiles({ name: 'sotto-library.json', mimeType: 'application/json', buffer: Buffer.from(index) });
  await page.getByText('Library and settings restored. Reconnect the score files or folders on a new device.', { exact: true }).waitFor();
  await page.evaluate(() => window.resumeDirectoryScan());
  await page.waitForFunction(() => window.testLibraryCommits >= 2);
  await page.getByRole('checkbox', { name: 'Favorites', exact: true }).check();
  assert.equal(await page.locator('.library-entry').count(), 1, 'Portable index restores favorites');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Library fits a phone');
  await page.screenshot({ path: 'test-results/library-phone.png' });
  await page.keyboard.press('Escape');

  if (option('--score')) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const score = JSON.parse(await readFile(option('--score'), 'utf8'));
    await inputScore.setInputFiles({ name: 'mixed-meter.sotto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)) });
    await page.getByRole('heading', { name: score.title, exact: true }).waitFor();
    const geometry = await page.evaluate(bars => {
      const notes = [...document.querySelectorAll('.score-note')];
      return [...document.querySelectorAll('.current-bar-highlight')].map(rect => {
        rect.style.display = 'inline';
        const index = Number(rect.getAttribute('data-bar-index')); const bar = bars[index];
        const bounds = rect.getBoundingClientRect();
        const members = notes.filter(element => bar.ids.includes(element.id)).map(element => element.getBoundingClientRect());
        rect.style.display = '';
        return { index, height: Number(rect.getAttribute('height')), contains: members.every(note => note.left >= bounds.left - 1 && note.right <= bounds.right + 1 && note.top >= bounds.top - 1 && note.bottom <= bounds.bottom + 1) };
      });
    }, score.bars.map(bar => ({ ids: score.notes.filter(note => note.measure === bar.index).map(note => note.id) })));
    assert.equal(geometry.length, score.bars.length, 'Every Capricho bar has a rectangle');
    assert.ok(geometry.every(bar => bar.contains), 'Highlights contain only their actual measure notes, including first rows');
    assert.ok(geometry.every(bar => bar.height < 30), 'No highlight bridges neighboring systems');
    let expectedPosition = 0;
    for (let index = 0; index < Math.min(9, score.sequence.length); index++) {
      const written = score.sequence[index];
      const position = Number(await page.getByRole('slider', { name: 'Playback position', exact: true }).inputValue());
      assert.equal(position, expectedPosition, `Playback bar ${index + 1} uses its cumulative start`);
      assert.equal(await page.locator('.current-bar-highlight.is-current').getAttribute('data-bar-index'), String(written));
      expectedPosition += score.bars[written].duration;
      await page.getByRole('button', { name: 'Next measure', exact: true }).click();
    }
    const duration = score.sequence.reduce((sum, written) => sum + score.bars[written].duration, 0);
    assert.equal(Number(await page.getByRole('slider', { name: 'Playback position', exact: true }).getAttribute('max')), duration);
    let position = 0;
    for (let index = 0; index < score.sequence.length; index++) {
      const written = score.sequence[index];
      if (index && written !== score.sequence[index - 1] + 1) {
        await page.getByRole('slider', { name: 'Playback position', exact: true }).fill(String(position));
        assert.equal(await page.locator('.current-bar-highlight.is-current').getAttribute('data-bar-index'), String(written), 'Repeat and D.S./coda jumps highlight the original printed bar');
      }
      position += score.bars[written].duration;
    }
    await page.getByRole('checkbox', { name: 'Follow repeats & jumps', exact: true }).uncheck();
    assert.equal(await page.getByRole('combobox', { name: 'Loop start measure' }).locator('option').count(), score.bars.length);
    await page.getByRole('checkbox', { name: 'Follow repeats & jumps', exact: true }).check();
    assert.equal(await page.getByRole('combobox', { name: 'Loop start measure' }).locator('option').count(), score.sequence.length);
    await page.getByRole('button', { name: 'Sound and metronome settings', exact: true }).click();
    assert.equal(await page.getByLabel('Playback octave', { exact: true }).inputValue(), '0');
    await page.getByLabel('Playback octave', { exact: true }).selectOption('12');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/capricho-bars.png' });
    console.log('PASS: mixed-meter bar navigation, per-system highlight geometry, and octave selection.');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: file/folder reference persistence, fresh disk reads, favorites, portable backup/import, fallback reconnection, and phone layout.');
} catch (error) {
  console.log('Browser errors:', errors);
  await page.screenshot({ path: 'test-results/library-failure.png' });
  throw error;
} finally { await browser.close(); }
