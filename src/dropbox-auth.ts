import { DropboxClient, dropboxBytes, parseDropboxRef } from './dropbox';
import type { CloudAccount } from './onedrive';

const CONFIG = 'sotto.dropbox.appKey', SESSION = 'sotto.dropbox.session', PENDING = 'sotto.dropbox.pending';
export const DROPBOX_SCOPES = ['account_info.read', 'files.metadata.read', 'files.content.read'];
const WRITE_SCOPE = 'files.content.write', ACCESS_TYPE = 'sotto.dropbox.accessType';
type Session = { appKey: string; account: CloudAccount; accessToken: string; refreshToken: string; expiresAt: number; sync?: boolean };
let refresh: Promise<string> | undefined;
function authChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('sotto:dropbox-auth')); }
export const dropboxRedirectUri = () => new URL('dropbox-redirect.html', new URL(import.meta.env.BASE_URL, location.href)).href;
export function dropboxAppKey() {
  try { return localStorage.getItem(CONFIG) || import.meta.env.VITE_DROPBOX_APP_KEY || ''; }
  catch { return import.meta.env.VITE_DROPBOX_APP_KEY || ''; }
}
export function dropboxIsAppFolder() {
  try {
    if (localStorage.getItem(CONFIG)) return localStorage.getItem(ACCESS_TYPE) === 'app_folder' ||
      localStorage.getItem(ACCESS_TYPE) === null && localStorage.getItem(CONFIG) === import.meta.env.VITE_DROPBOX_APP_KEY && import.meta.env.VITE_DROPBOX_ACCESS_TYPE === 'app_folder';
    return import.meta.env.VITE_DROPBOX_ACCESS_TYPE === 'app_folder';
  } catch { return import.meta.env.VITE_DROPBOX_ACCESS_TYPE === 'app_folder'; }
}
export function configureDropbox(value: string, appFolder = false) {
  const key = value.trim();
  if (!/^[a-zA-Z0-9]{8,100}$/.test(key)) throw new Error('Enter the public Dropbox App key, not an App secret or access token.');
  if (key !== dropboxAppKey() || appFolder !== dropboxIsAppFolder()) { localStorage.removeItem(SESSION); sessionStorage.removeItem(PENDING); }
  localStorage.setItem(CONFIG, key);
  localStorage.setItem(ACCESS_TYPE, appFolder ? 'app_folder' : 'full');
  authChanged();
}
function session(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION) || 'null') as Session | null;
    if (!value || value.appKey !== dropboxAppKey() || typeof value.account?.label !== 'string' ||
        typeof value.accessToken !== 'string' || !value.accessToken || typeof value.refreshToken !== 'string' || !value.refreshToken || !Number.isFinite(value.expiresAt)) return null;
    parseDropboxRef({ accountId: value.account.id, itemId: '' }, true);
    return value;
  } catch { return null; }
}
function base64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
async function tokenRequest(body: URLSearchParams, sync = false): Promise<any> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body, signal: controller.signal,
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Dropbox authorization could not be renewed. Sign in again; your bookmarks are still saved.');
    const result = JSON.parse(new TextDecoder().decode(await dropboxBytes(response, 100000)));
    if (typeof result.access_token !== 'string' || !result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error('Dropbox returned an incomplete authorization response.');
    // Write permission is requested only by explicit settings-sync consent.
    const allowed = sync ? [...DROPBOX_SCOPES, WRITE_SCOPE] : DROPBOX_SCOPES;
    if (result.scope !== undefined && (typeof result.scope !== 'string' || result.scope.split(/\s+/).some((scope: string) => !allowed.includes(scope)))) throw new Error('Dropbox returned permissions beyond those requested by Sotto. Check the app permissions and sign in again.');
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Dropbox sign-in timed out. Try again.');
    throw error;
  } finally { clearTimeout(timer); }
}
export const dropboxAuth = {
  async account(): Promise<CloudAccount | null> { return session()?.account ?? null; },
  syncEnabled(accountId: string) {
    try { const value = session(); return value?.account.id === accountId && value.sync === true && localStorage.getItem(`sotto.dropbox.sync.enabled.${accountId}`) !== 'false'; }
    catch { return false; }
  },
  setSyncEnabled(accountId: string, enabled: boolean) { localStorage.setItem(`sotto.dropbox.sync.enabled.${accountId}`, String(enabled)); authChanged(); },
  canSync(accountId: string) { const value = session(); return value?.account.id === accountId && value.sync === true; },
  async signIn(sync = false) {
    if (!/^[a-zA-Z0-9]{8,100}$/.test(dropboxAppKey())) throw new Error('Set the public Dropbox App key in Dropbox app setup first.');
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(64))), state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, created: Date.now(), appKey: dropboxAppKey(), redirect: dropboxRedirectUri(), sync, appFolder: dropboxIsAppFolder() }));
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: dropboxAppKey(), response_type: 'code', redirect_uri: dropboxRedirectUri(),
      state, code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline', scope: (sync ? [...DROPBOX_SCOPES, WRITE_SCOPE] : DROPBOX_SCOPES).join(' '), force_reapprove: 'true' }).toString();
    location.assign(url.href);
  },
  async complete(url = new URL(location.href)) {
    // Strip the one-use authorization code before loading anything else.
    history.replaceState(null, '', location.pathname);
    let pending: any;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch { /* Invalid state is rejected below. */ }
    if (!pending || pending.state !== url.searchParams.get('state') || typeof pending.verifier !== 'string' ||
        pending.appKey !== dropboxAppKey() || pending.redirect !== dropboxRedirectUri() || pending.appFolder !== dropboxIsAppFolder() || !Number.isFinite(pending.created) ||
        Date.now() - pending.created > 600000 || pending.created > Date.now()) throw new Error('Dropbox sign-in expired or belongs to another browser tab. Return to Sotto and sign in again.');
    sessionStorage.removeItem(PENDING);
    if (url.searchParams.has('error')) throw new Error('Dropbox sign-in was cancelled or denied. Your bookmarks are still saved.');
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Dropbox did not return an authorization code. Sign in again.');
    const previous = localStorage.getItem(SESSION), appKey = dropboxAppKey();
    const sync = pending.sync === true;
    const result = await tokenRequest(new URLSearchParams({ client_id: appKey, code, grant_type: 'authorization_code', redirect_uri: dropboxRedirectUri(), code_verifier: pending.verifier }), sync);
    if (sync && (typeof result.scope !== 'string' || !result.scope.split(/\s+/).includes(WRITE_SCOPE))) throw new Error('Dropbox did not grant settings sync. Enable files.content.write on the app and try Enable sync again.');
    if (typeof result.refresh_token !== 'string' || !result.refresh_token) throw new Error('Dropbox did not grant persistent access. Sign in again.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    let account: CloudAccount;
    try { account = await dropboxClient.account(result.access_token, controller.signal); }
    finally { clearTimeout(timer); }
    if (result.account_id !== account.id) throw new Error('Dropbox returned an inconsistent account. Sign in again.');
    if (appKey !== dropboxAppKey() || previous !== localStorage.getItem(SESSION)) throw new Error('Dropbox connection changed in another tab. Return to Sotto and try again.');
    const value: Session = { appKey, account, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000, sync };
    localStorage.setItem(SESSION, JSON.stringify(value));
    if (sync) dropboxAuth.setSyncEnabled(account.id, true);
  },
  async token(accountId: string): Promise<string> {
    const value = session();
    if (!value || value.account.id !== accountId) throw new Error('Sign in to the Dropbox account used for this folder. Your bookmarks are still saved.');
    if (value.expiresAt > Date.now() + 60000) return value.accessToken;
    refresh ??= (async () => {
      const previous = localStorage.getItem(SESSION);
      const result = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: value.refreshToken, client_id: value.appKey }), value.sync === true);
      if (result.account_id && result.account_id !== value.account.id) throw new Error('Dropbox returned a different account. Sign in again.');
      if (previous !== localStorage.getItem(SESSION) || value.appKey !== dropboxAppKey()) throw new Error('Dropbox connection changed. Try again.');
      localStorage.setItem(SESSION, JSON.stringify({ ...value, accessToken: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 }));
      return result.access_token as string;
    })().finally(() => { refresh = undefined; });
    const token = await refresh;
    if (session()?.account.id !== accountId) throw new Error('Dropbox connection changed. Sign in again.');
    return token;
  },
  async writeToken(accountId: string) {
    if (!dropboxAuth.syncEnabled(accountId)) throw new Error('Enable Dropbox settings sync first. Local changes are kept.');
    return dropboxAuth.token(accountId);
  },
  async disconnect() { localStorage.removeItem(SESSION); sessionStorage.removeItem(PENDING); authChanged(); },
};
export const dropboxClient = new DropboxClient(dropboxAuth);
