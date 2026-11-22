import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const KEY = 'testAppKey123';
const account = { id: 'dbid:account', label: 'person@example.test' };
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; }
const json = (value: unknown) => new Response(JSON.stringify(value));
beforeEach(() => {
  vi.resetModules(); vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('location', { href: 'https://laughingrice.github.io/sotto/', pathname: '/sotto/dropbox-redirect.html', assign: vi.fn() });
  vi.stubGlobal('history', { replaceState: vi.fn() }); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected test request'); }));
  vi.stubEnv('BASE_URL', '/sotto/'); vi.stubEnv('VITE_DROPBOX_APP_KEY', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function begin() {
  const module = await import('./dropbox-auth'); module.configureDropbox(KEY); await module.dropboxAuth.signIn();
  return { ...module, authUrl: new URL((location.assign as any).mock.calls[0][0]) };
}
function seed(expiresAt = Date.now() + 3600000) { localStorage.setItem('sotto.dropbox.appKey', KEY); localStorage.setItem('sotto.dropbox.session', JSON.stringify({ appKey: KEY, account, accessToken: 'private-access', refreshToken: 'private-refresh', expiresAt })); }
it('requires configuration and constructs PKCE S256 with only read scopes and an offline grant, without a client secret', async () => {
  const { dropboxAuth, configureDropbox } = await import('./dropbox-auth');
  expect(await dropboxAuth.account()).toBeNull(); await expect(dropboxAuth.signIn()).rejects.toThrow('App key'); expect(() => configureDropbox('invalid-key!')).toThrow();
  const { authUrl, DROPBOX_SCOPES } = await begin();
  expect(authUrl.origin).toBe('https://www.dropbox.com');
  expect(authUrl.searchParams.get('scope')).toBe(DROPBOX_SCOPES.join(' ')); expect(authUrl.searchParams.get('token_access_type')).toBe('offline'); expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authUrl.searchParams.get('redirect_uri')).toBe('https://laughingrice.github.io/sotto/dropbox-redirect.html'); expect(authUrl.searchParams.has('client_secret')).toBe(false);
  const pending = JSON.parse(sessionStorage.getItem('sotto.dropbox.pending')!);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.verifier));
  expect(authUrl.searchParams.get('code_challenge')).toBe(Buffer.from(digest).toString('base64url'));
});
it('validates one-use callback state before exchanging codes and strips authorization data from history', async () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request); const { dropboxAuth, authUrl } = await begin();
  await expect(dropboxAuth.complete(new URL('https://laughingrice.github.io/sotto/dropbox-redirect.html?code=secret&state=bad'))).rejects.toThrow('expired'); expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(json({ access_token: 'private-access', refresh_token: 'private-refresh', account_id: account.id, expires_in: 14400, scope: 'account_info.read files.metadata.read files.content.read' })).mockResolvedValueOnce(json({ account_id: account.id, email: account.label }));
  const callback = new URL('https://laughingrice.github.io/sotto/dropbox-redirect.html?code=one-use'); callback.searchParams.set('state', authUrl.searchParams.get('state')!);
  await dropboxAuth.complete(callback);
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/sotto/dropbox-redirect.html');
  const body = request.mock.calls[0][1].body as URLSearchParams;
  expect(body.get('code_verifier')).toBeTruthy(); expect(body.has('client_secret')).toBe(false);
  expect(await dropboxAuth.account()).toEqual(account); expect(await dropboxAuth.token(account.id)).toBe('private-access');
  await expect(dropboxAuth.complete(callback)).rejects.toThrow('expired'); expect(request).toHaveBeenCalledTimes(2);
});
it('silently refreshes once across simultaneous requests and preserves the refresh credential', async () => {
  seed(Date.now() - 1000); const request = vi.fn(async () => json({ access_token: 'fresh-access', expires_in: 14400 })); vi.stubGlobal('fetch', request);
  const { dropboxAuth } = await import('./dropbox-auth');
  expect(await Promise.all([dropboxAuth.token(account.id), dropboxAuth.token(account.id)])).toEqual(['fresh-access', 'fresh-access']);
  expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][1].body.get('refresh_token')).toBe('private-refresh'); expect(request.mock.calls[0][1].body.has('client_secret')).toBe(false);
  expect(JSON.parse(localStorage.getItem('sotto.dropbox.session')!).refreshToken).toBe('private-refresh');
});
it('rejects wrong accounts and write scopes, and disconnect cannot be undone by an in-flight refresh', async () => {
  seed(Date.now() - 1000); const { dropboxAuth } = await import('./dropbox-auth'); const request = vi.fn(); vi.stubGlobal('fetch', request);
  await expect(dropboxAuth.token('dbid:other')).rejects.toThrow('account used'); expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(json({ access_token: 'bad', expires_in: 100, scope: 'files.content.write' }));
  await expect(dropboxAuth.token(account.id)).rejects.toThrow('beyond');
  let resolve!: (value: Response) => void; request.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  const pending = dropboxAuth.token(account.id); await vi.waitFor(() => expect(resolve).toBeDefined()); await dropboxAuth.disconnect(); resolve(json({ access_token: 'late', expires_in: 100 }));
  await expect(pending).rejects.toThrow('changed'); expect(await dropboxAuth.account()).toBeNull(); expect(localStorage.getItem('sotto.dropbox.session')).toBeNull();
});
it('reports denied, stale and expired authorizations without navigating or losing bookmarks', async () => {
  const { dropboxAuth, authUrl } = await begin(); vi.stubGlobal('fetch', vi.fn());
  const callback = new URL('https://laughingrice.github.io/sotto/dropbox-redirect.html?error=access_denied'); callback.searchParams.set('state', authUrl.searchParams.get('state')!);
  await expect(dropboxAuth.complete(callback)).rejects.toThrow('cancelled'); expect(fetch).not.toHaveBeenCalled();
  seed(Date.now() - 1000); vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
  await expect(dropboxAuth.token(account.id)).rejects.toThrow('renewed'); expect(await dropboxAuth.account()).toEqual(account);
  expect(location.assign).toHaveBeenCalledTimes(1);
});
