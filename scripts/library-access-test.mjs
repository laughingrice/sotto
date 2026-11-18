import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const i = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: i >= 0 ? process.argv[i + 1] : process.env.CHROME_PATH });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const source = JSON.parse(await readFile(new URL('./fixtures/julia-florida.sotto.json', import.meta.url), 'utf8'));
const fixture = { ...source, title: 'Personal folder score' };
const button = name => page.getByRole('button', { name, exact: true });
const heading = name => page.getByRole('heading', { name, exact: true });
async function selectFolder() {
  await page.evaluate(fixture => {
    const file = new File([JSON.stringify(fixture)], 'personal.sotto.json', { type: 'application/json' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Shared scores/personal.sotto.json' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('[aria-label="Connect score folder"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixture);
}
await page.addInitScript(() => {
  window.showOpenFilePicker = undefined; window.showDirectoryPicker = undefined;
  const read = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = function(...args) {
    if (this.name === 'personal.sotto.json' && window.expiredFile) return Promise.reject(new DOMException('Cloud provider selection expired', 'AbortError'));
    return read.apply(this, args);
  };
});
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4179/sotto/'); await heading('Étude Op. 60 No. 1').waitFor();
  await button('Score library').click(); await selectFolder(); await button('Favorite personal').waitFor();
  await page.locator('.library-open').filter({ hasText: 'personal' }).click(); await heading(fixture.title).waitFor();
  await button('Score library').click(); await button('Favorite Personal folder score').click();
  await button('Sample scores').click(); await page.getByRole('textbox', { name: 'Search library' }).fill('The Entertainer');
  await page.locator('.library-open').click(); await heading('The Entertainer').waitFor();
  await button('Score library').click(); await page.getByRole('textbox', { name: 'Search library' }).fill(fixture.title);
  await page.evaluate(() => { window.expiredFile = true; });
  await page.locator('.library-open').click();
  await page.getByRole('status').filter({ hasText: 'can no longer read' }).waitFor();
  await page.locator('.library-access-warning').getByRole('button', { name: 'Reconnect folder' }).waitFor();
  await heading('The Entertainer').waitFor();
  await page.evaluate(() => { document.querySelector('[aria-label="Connect score folder"]').click = () => {}; window.expiredFile = false; });
  await page.locator('.library-access-warning').getByRole('button', { name: 'Reconnect folder' }).click();
  await selectFolder();
  await page.locator('.library-access-warning').waitFor({ state: 'hidden' });
  assert.equal(await button('Favorite Personal folder score').getAttribute('aria-pressed'), 'true');
  await page.locator('.library-open').click(); await heading(fixture.title).waitFor();
  // Across a reload fallback handles are gone. After a demo replaces the one
  // cached song, the cloud file must explain reconnection rather than do nothing.
  await page.reload(); await heading(fixture.title).waitFor(); await button('Score library').click();
  await page.getByRole('textbox', { name: 'Search library' }).fill('The Entertainer');
  await page.locator('.library-open').click(); await heading('The Entertainer').waitFor();
  await button('Score library').click(); await page.getByRole('textbox', { name: 'Search library' }).fill(fixture.title);
  await page.locator('.library-open').click();
  await page.getByRole('status').filter({ hasText: 'needs the folder to be reconnected' }).waitFor();
  await page.locator('.library-access-warning').getByRole('button', { name: 'Reconnect folder' }).waitFor();
  // Only cancellation of the actual native picker remains silent.
  await page.evaluate(() => { window.showOpenFilePicker = async () => { throw new DOMException('User canceled picker', 'AbortError'); }; });
  await button('Add score').click(); await button('Add score').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.library-message'));
  assert.deepEqual(errors, []);
  console.log('PASS: expired cloud File AbortError is visible, direct folder reconnect preserves favorites, missing session access is explained after demo switch, and picker cancel stays quiet.');
} finally { await browser.close(); }
