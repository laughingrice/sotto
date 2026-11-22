import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const index = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: index < 0 ? process.env.CHROME_PATH : process.argv[index + 1] });
const score = await readFile(new URL('../public/scores/prototypes/guitar.sotto', import.meta.url));
let renamed = false, deleted = false, failed = false, downloads = 0;
const errors = [], calls = [];
async function setup(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED', request.url(), request.failure()?.errorText));
  page.on('console', message => { if(message.type()==='error') console.log('BROWSER ERROR',message.text()); });
  await page.route('**/src/onedrive-auth.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import {OneDriveClient} from '/src/onedrive.ts';
    export const oneDriveClientId=()=> '11111111-2222-3333-4444-555555555555';
    export const oneDriveRedirectUri=()=>location.origin+'/redirect.html';
    export const configureOneDrive=()=>{};
    export const oneDriveAuth={
      account:async()=>localStorage.getItem('mock-auth')==='off'?null:{id:'account',label:'Personal account'},
      token:async(id)=>{if(id!=='account'||localStorage.getItem('mock-auth')==='off')throw new Error('Sign in to the Microsoft account used for this OneDrive folder.');return 'mock-access-token'},
      disconnect:async()=>localStorage.setItem('mock-auth','off'),signIn:async()=>{localStorage.removeItem('mock-auth');location.hash='onedrive';location.reload()}
    };export const oneDriveClient=new OneDriveClient(oneDriveAuth);
  ` }));
  await page.route('https://graph.microsoft.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization', 'Access-Control-Allow-Methods':'GET, OPTIONS', 'Content-Type': 'application/json' };
    if (request.method() === 'OPTIONS') return route.fulfill({ headers });
    calls.push(url.href);
    assert.equal(request.headers().authorization, 'Bearer mock-access-token');
    const item = (id, name, folder = false) => ({ id, name, ...(folder ? { folder: {} } : { file: {} }), size: 100 });
    let data;
    if (url.pathname.endsWith('/me/drive')) data = { id: 'DRIVE', driveType: 'personal' };
    else if (url.pathname.endsWith('/root')) data = item('ROOT', 'OneDrive', true);
    else if (url.pathname.includes('/ROOT/children')) data = { value: [item('SCORES', 'Scores', true)] };
    else if (url.pathname.includes('/SCORES/children')) data = { value: [item('GUITAR', 'Guitar', true)] };
    else if (url.pathname.includes('/GUITAR/children')) data = { value: [item('COMPOSER', 'Composer', true)] };
    else if (url.pathname.includes('/COMPOSER/children')) data = { value: [item('BOOK', 'Book', true)] };
    else if (url.pathname.includes('/BOOK/children')) data = { value: [item('FILE1', renamed ? 'renamed.sotto' : 'piece.sotto'), ...(!deleted ? [item('FILE2', 'second.sotto')] : [])], ...(failed ? { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/incomplete-page' } : {}) };
    else if (url.pathname.endsWith('/incomplete-page')) return route.fulfill({ status: 503, headers, body: '{}' });
    else if (url.pathname.endsWith('/FILE1') || url.pathname.endsWith('/FILE2')) data = { ...item(url.pathname.split('/').at(-1), url.pathname.endsWith('/FILE1') ? (renamed ? 'renamed.sotto' : 'piece.sotto') : 'second.sotto'), '@microsoft.graph.downloadUrl': 'https://download.example/temporary-score-token' };
    else throw new Error(`Unexpected Graph request: ${url}`);
    await route.fulfill({ headers, body: JSON.stringify(data) });
  });
  await page.route('https://download.example/**', route => {
    assert.equal(route.request().headers().authorization, undefined, 'Bearer tokens never leave Graph');
    downloads++;
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream' }, body: score });
  });
}
let context, page;
try {
  context = await browser.newContext({ viewport: { width: 768, height: 1024 } }); page = await context.newPage(); await setup(page); page.setDefaultTimeout(15000);
  await page.goto(process.env.BASE_URL || 'http://localhost:4174/');
  const button = name => page.getByRole('button', { name, exact: true });
  await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  await button('Score library').click();
  const local = { format: 'sotto-library', version: 1, folders: [{ id: 'local-folder', name: 'Local Scores' }], entries: [
    { id: 'old-piece', folderId: 'local-folder', path: 'Guitar/Composer/Book/piece.sotto', name: 'piece.sotto', title: 'piece', composer: '', favorite: false },
    { id: 'old-second', folderId: 'local-folder', path: 'Guitar/Composer/Book/second.sotto', name: 'second.sotto', title: 'second', composer: '', favorite: false },
  ] };
  await page.getByLabel('Import library backup', { exact: true }).setInputFiles({ name: 'local.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(local)) });
  await page.getByText(/Library index imported/).waitFor();
  await page.evaluate(() => localStorage.setItem('sotto.practice.library:old-piece', JSON.stringify({ bpm: 77 })));
  await page.locator('.onedrive-panel>summary').click();
  await button('Browse OneDrive folders').click(); await page.locator('.onedrive-folders').getByRole('button', { name: 'Scores', exact: true }).click();
  await page.getByRole('combobox', { name: 'Reuse local folder bookmarks', exact: true }).selectOption('local-folder');
  await button('Connect this OneDrive folder').click();
  await page.getByText('Scores: 2 OneDrive score bookmarks. Music downloads only when opened.', { exact: true }).waitFor();
  assert.equal(downloads, 0, 'Connecting lists metadata only');
  const expand = async () => { await page.getByRole('textbox', { name: 'Search library', exact: true }).fill('sotto'); };
  // The tree mounts children lazily, so expand each nested level.
  await expand();
  await page.getByRole('button', { name: 'Favorite piece', exact: true }).click();
  await page.locator('.library-open').filter({ hasText: 'piece' }).click();
  await page.getByRole('heading', { name: 'Guitar · four-bar tab prototype', exact: true }).waitFor();
  assert.equal(downloads, 1);
  assert.equal(await page.locator('.tempo-control strong').innerText(), '77BPM', 'Migration preserves the existing per-song settings key');
  await button('Faster').click();
  await button('Score library').click();
  const refresh = page.locator('.library-folder').filter({ hasText: 'Scores' }).getByRole('button', { name: 'Refresh', exact: true });
  failed = true; await refresh.click(); await page.locator('.library-message').filter({ hasText: /temporarily limiting requests/ }).first().waitFor();
  assert.equal(await page.locator('.library-open').count(), 2, 'Incomplete refresh preserves the previous index');
  failed = false; renamed = true; deleted = true; await refresh.click();
  await page.getByText('Refreshed Scores. Removed 1 missing score bookmarks.', { exact: true }).waitFor();
  assert.equal(await page.locator('.library-open').count(), 1);
  assert.equal(downloads, 1, 'Refresh never downloads score bodies');
  assert.equal(await page.locator('.favorite-button').getAttribute('aria-pressed'), 'true', 'Rename preserves favorite');
  const download = page.waitForEvent('download'); await button('Export backup').click();
  const backup = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(backup.folders[0].oneDrive.itemId, 'SCORES');
  assert.equal(backup.entries[0].oneDrive.itemId, 'FILE1');
  assert.equal(backup.entries[0].id, 'old-piece', 'Local bookmark migrated instead of being duplicated');
  assert.equal(backup.entries[0].path, 'Guitar/Composer/Book/renamed.sotto');
  assert.ok(!/mock-access-token|temporary-score-token|downloadUrl|pages|11111111/.test(JSON.stringify(backup)));
  const key = `library:${backup.entries[0].id}`;
  assert.equal(backup.settings.songs[key].bpm, 78);
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/onedrive-library-tablet.png' });
  // A new browser/device has no file handles or music cache. Import its small
  // backup, sign in and open the same stable item reference.
  await context.close(); context = await browser.newContext({ viewport: { width: 768, height: 1024 } }); page = await context.newPage(); await setup(page); page.setDefaultTimeout(15000);
  await page.goto(process.env.BASE_URL || 'http://localhost:4174/');
  await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor(); await button('Score library').click();
  await page.getByLabel('Import library backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByText(/Library and settings restored/).waitFor();
  await expand();
  await page.locator('.library-open').click();
  await page.getByRole('heading', { name: 'Guitar · four-bar tab prototype', exact: true }).waitFor();
  assert.equal(await page.locator('.tempo-control strong').innerText(), '78BPM');
  assert.equal(downloads, 2);
  await button('Score library').click(); await page.evaluate(() => localStorage.setItem('mock-auth', 'off'));
  await page.locator('.library-open').click();
  await page.locator('.library-message').filter({ hasText: 'Sign in to the Microsoft account used for this OneDrive folder.' }).first().waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Guitar · four-bar tab prototype', exact: true }).count(), 1, 'Failed cloud reads never silently replace the score');
  assert.equal(downloads, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: metadata-only nested scan, on-demand download, token isolation, rename/favorites, failed/successful refresh cleanup, portable settings/IDs and explicit expired sign-in on tablet. Microsoft OAuth itself is mocked.');
} catch (error) { if (page && !page.isClosed()) { console.log((await page.locator('body').innerText()).slice(-5000)); await mkdir('test-results', { recursive: true }); await page.screenshot({path:'test-results/onedrive-failure.png'}); } throw error; } finally { await browser.close(); }
