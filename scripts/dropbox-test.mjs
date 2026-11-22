import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const index = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: index < 0 ? process.env.CHROME_PATH : process.argv[index + 1] });
const score = await readFile(new URL('../public/scores/prototypes/guitar.sotto', import.meta.url));
const base = process.env.BASE_URL || 'http://localhost:4174/';
let renamed = false, deleted = false, failed = false, downloads = 0, refreshes = 0, authorizations = 0;
const errors = [], calls = [];
const metadata = (id, path, folder = false) => ({ id: `id:${id}`, name: path.split('/').at(-1), path_display: path, '.tag': folder ? 'folder' : 'file', size: score.length });
async function setup(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://www.dropbox.com/oauth2/authorize*', async route => {
    authorizations++;
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(url.searchParams.get('scope'), 'account_info.read files.metadata.read files.content.read'); assert.equal(url.searchParams.get('token_access_type'), 'offline');
    assert.ok(!url.searchParams.has('client_secret'));
    const callback = new URL(url.searchParams.get('redirect_uri')); callback.searchParams.set('code', 'one-use-test-code'); callback.searchParams.set('state', url.searchParams.get('state'));
    await route.fulfill({ status: 302, headers: { Location: callback.href } });
  });
  await page.route('https://*.dropboxapi.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type,dropbox-api-arg', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'Dropbox-API-Result', 'Content-Type': 'application/json' };
    if (request.method() === 'OPTIONS') return route.fulfill({ headers });
    assert.equal(request.method(), 'POST'); calls.push(url.pathname);
    if (url.pathname === '/oauth2/token') {
      const args = new URLSearchParams(request.postData()); assert.ok(!args.has('client_secret')); assert.equal(args.get('client_id'), 'testAppKey123');
      const isRefresh = args.get('grant_type') === 'refresh_token';
      if (isRefresh) { refreshes++; assert.equal(args.get('refresh_token'), 'mock-refresh-token'); }
      else { assert.equal(args.get('code'), 'one-use-test-code'); assert.ok(args.get('code_verifier')); }
      return route.fulfill({ headers, body: JSON.stringify({ access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expires_in: 14400, account_id: 'dbid:account', scope: 'account_info.read files.metadata.read files.content.read' }) });
    }
    assert.equal(request.headers().authorization, 'Bearer mock-access-token');
    if (url.pathname === '/2/files/download') {
      assert.equal(JSON.parse(request.headers()['dropbox-api-arg']).path, 'id:one'); downloads++;
      return route.fulfill({ headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Result': JSON.stringify(metadata('one', '/Scores/Guitar/Composer/Book/' + (renamed ? 'renamed.sotto' : 'piece.sotto'))) }, body: score });
    }
    const args = request.postDataJSON(); let data;
    if (url.pathname === '/2/users/get_current_account') data = { account_id: 'dbid:account', email: 'person@example.test' };
    else if (url.pathname === '/2/files/list_folder') {
      assert.equal(args.include_deleted, false); assert.equal(args.recursive, false);
      if (args.path === '') data = { entries: [metadata('scores', '/Scores', true)], has_more: false };
      else if (args.path === 'id:scores') data = { entries: [metadata('scores', '/PreviousLocation/Scores', true), metadata('guitar', '/DifferentMount/Guitar', true)], has_more: false };
      else if (args.path === 'id:guitar') data = { entries: [metadata('composer', '/NoSharedPrefix/Composer', true)], has_more: false };
      else if (args.path === 'id:composer') data = { entries: [metadata('book', '/AnotherLocation/Book', true)], has_more: false };
      else if (args.path === 'id:book') data = { entries: [metadata('one', '/DifferentMount/' + (renamed ? 'renamed.sotto' : 'piece.sotto')), ...(!deleted ? [metadata('two', '/DifferentMount/second.sotto')] : [])], has_more: failed, cursor: 'page-two' };
      else throw new Error(`Unexpected Dropbox folder ${args.path}`);
    } else if (url.pathname === '/2/files/list_folder/continue') return route.fulfill({ status: 503, headers, body: '{}' });
    else throw new Error(`Unexpected Dropbox endpoint ${url}`);
    await route.fulfill({ headers, body: JSON.stringify(data) });
  });
}
let context, page;
try {
  context = await browser.newContext({ viewport: { width: 768, height: 1024 } }); page = await context.newPage(); await setup(page); page.setDefaultTimeout(15000);
  const button = name => page.getByRole('button', { name, exact: true });
  const ready = () => page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  async function login() {
    const panel = page.locator('.dropbox-panel');
    if (await panel.getAttribute('open') === null) await panel.locator('summary').first().click();
    await page.getByRole('textbox', { name: 'Dropbox App key', exact: true }).fill('testAppKey123');
    await button('Sign in to Dropbox').click();
    await page.locator('.dropbox-panel').getByRole('button', { name: 'Browse Dropbox folders', exact: true }).waitFor();
    assert.ok(!page.url().includes('code=')); assert.equal(await page.evaluate(() => sessionStorage.getItem('sotto.dropbox.pending')), null);
  }
  await page.goto(base); await ready(); await button('Score library').click();
  const local = { format: 'sotto-library', version: 1, folders: [{ id: 'local', name: 'Local Scores' }], entries: [
    { id: 'old-piece', folderId: 'local', path: 'Guitar/Composer/Book/piece.sotto', name: 'piece.sotto', title: 'piece', composer: '', favorite: false },
    { id: 'old-second', folderId: 'local', path: 'Guitar/Composer/Book/second.sotto', name: 'second.sotto', title: 'second', composer: '', favorite: false },
  ] };
  await page.getByLabel('Import library backup', { exact: true }).setInputFiles({ name: 'local.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(local)) });
  await page.getByText(/Library index imported/).waitFor(); await page.evaluate(() => localStorage.setItem('sotto.practice.library:old-piece', JSON.stringify({ bpm: 77 })));
  await login();
  await button('Browse Dropbox folders').click(); await page.locator('.dropbox-folders').getByRole('button', { name: 'Scores', exact: true }).click();
  await page.locator('.dropbox-panel').getByRole('combobox', { name: 'Reuse local folder bookmarks', exact: true }).selectOption('local');
  await button('Connect this Dropbox folder').click(); await page.getByText('Scores: 2 Dropbox score bookmarks. Music downloads only when opened.', { exact: true }).waitFor(); assert.equal(downloads, 0);
  const expand = () => page.getByRole('textbox', { name: 'Search library', exact: true }).fill('sotto'); await expand();
  await button('Favorite piece').click(); await page.locator('.library-open').filter({ hasText: 'piece' }).click();
  await page.getByRole('heading', { name: 'Guitar · four-bar tab prototype', exact: true }).waitFor(); assert.equal(downloads, 1); assert.equal(await page.locator('.tempo-control strong').innerText(), '77BPM');
  await button('Faster').click(); await button('Score library').click();
  const refresh = () => page.locator('.library-folder').filter({ hasText: 'Scores' }).getByRole('button', { name: 'Refresh', exact: true });
  failed = true; await refresh().click(); await page.locator('.library-message').filter({ hasText: /temporarily unavailable/ }).first().waitFor(); assert.equal(await page.locator('.library-open').count(), 2);
  failed = false; renamed = true; deleted = true;
  await page.evaluate(() => { const key = 'sotto.dropbox.session', value = JSON.parse(localStorage.getItem(key)); value.expiresAt = 0; localStorage.setItem(key, JSON.stringify(value)); });
  await refresh().click(); await page.getByText('Refreshed Scores. Removed 1 missing score bookmarks.', { exact: true }).waitFor();
  assert.equal(refreshes, 1); assert.equal(await page.locator('.library-open').count(), 1); assert.equal(downloads, 1); assert.equal(await page.locator('.favorite-button').getAttribute('aria-pressed'), 'true');
  const download = page.waitForEvent('download'); await button('Export backup').click(); const backup = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(backup.folders[0].dropbox.itemId, 'id:scores'); assert.equal(backup.entries[0].id, 'old-piece'); assert.equal(backup.entries[0].path, 'Guitar/Composer/Book/renamed.sotto'); assert.equal(backup.settings.songs['library:old-piece'].bpm, 78);
  assert.ok(!/mock-access-token|mock-refresh-token|testAppKey123|person@example|pages/.test(JSON.stringify(backup)));
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/dropbox-library-tablet.png' });
  await page.reload(); await page.getByRole('heading', { name: 'Guitar · four-bar tab prototype', exact: true }).waitFor(); assert.equal(downloads, 2); assert.equal(authorizations, 1, 'Reload reuses authorization without another picker or login');
  await context.close(); context = await browser.newContext({ viewport: { width: 768, height: 1024 } }); page = await context.newPage(); await setup(page); page.setDefaultTimeout(15000);
  await page.goto(base); await ready(); await button('Score library').click();
  await page.getByLabel('Import library backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await page.getByText(/Library and settings restored/).waitFor(); await expand();
  await page.locator('.library-open').click(); await page.locator('.library-message').filter({ hasText: 'Sign in to the Dropbox account used for this folder.' }).first().waitFor(); assert.equal(downloads, 2);
  await login(); await expand(); await page.getByRole('heading', { name: 'Guitar · four-bar tab prototype', exact: true }).waitFor(); assert.equal(await page.locator('.tempo-control strong').innerText(), '78BPM'); assert.equal(downloads, 3);
  await button('Disconnect sign-in').click(); await page.locator('.library-open').click(); await page.locator('.library-message').filter({ hasText: 'Sign in to the Dropbox account used for this folder.' }).first().waitFor(); assert.equal(downloads, 3);
  // iOS fallback: no extension filter; compressed .sotto still validates/opens.
  await context.close(); context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); page = await context.newPage(); await setup(page);
  await page.goto(base); await ready(); assert.equal(await page.locator('[data-score-input]').getAttribute('accept'), null);
  await page.locator('[data-score-input]').setInputFiles({ name: 'phone.sotto', mimeType: 'application/octet-stream', buffer: score }); await page.getByRole('heading', { name: 'Guitar · four-bar tab prototype', exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.ok(calls.every(path => /oauth2\/token|users\/get_current_account|files\/(list_folder|list_folder\/continue|get_metadata|download)$/.test(path)));
  console.log('PASS: real PKCE/callback implementation with simulated Dropbox, persistent reload/renewal, nested metadata-only scan, on-demand download, local migration/settings, rename/deletion, failed refresh, portable backup, disconnect and unrestricted phone picker. Actual Dropbox consent and iOS Files require device verification.');
} catch (error) {
  if (page && !page.isClosed()) { console.log((await page.locator('body').innerText()).slice(-5000)); await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/dropbox-failure.png' }); }
  throw error;
} finally { await browser.close(); }
