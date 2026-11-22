import { OneDriveClient, type CloudAccount } from './onedrive';
import type { IPublicClientApplication } from '@azure/msal-browser';
const KEY = 'sotto.oneDrive.clientId';
const SCOPES = ['Files.Read'];
let ready: Promise<IPublicClientApplication> | undefined;
export const oneDriveRedirectUri = () => new URL('redirect.html', new URL(import.meta.env.BASE_URL, location.href)).href;
export function oneDriveClientId() {
  try { return localStorage.getItem(KEY) || import.meta.env.VITE_ONEDRIVE_CLIENT_ID || ''; }
  catch { return import.meta.env.VITE_ONEDRIVE_CLIENT_ID || ''; }
}
export function configureOneDrive(value: string) {
  const id = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Use the Microsoft Application (client) ID, in GUID format. No client secret is needed.');
  localStorage.setItem(KEY, id); ready = undefined;
}
async function client() {
  if (!oneDriveClientId()) throw new Error('OneDrive needs a Microsoft application client ID. Open OneDrive setup in the library.');
  ready ??= (async () => {
    const { createStandardPublicClientApplication } = await import('@azure/msal-browser');
    const app = await createStandardPublicClientApplication({ auth: { clientId: oneDriveClientId(), authority: 'https://login.microsoftonline.com/consumers', redirectUri: oneDriveRedirectUri() }, cache: { cacheLocation: 'localStorage' } });
    const result = await app.handleRedirectPromise();
    const account = result?.account ?? app.getActiveAccount() ?? app.getAllAccounts()[0];
    if (account) app.setActiveAccount(account);
    return app;
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}
export const oneDriveAuth = {
  async account(): Promise<CloudAccount | null> {
    if (!oneDriveClientId()) return null;
    const app = await client(), account = app.getActiveAccount();
    return account ? { id: account.homeAccountId, label: account.username || account.name || 'Microsoft account' } : null;
  },
  async signIn() {
    const app = await client();
    const redirectStartPage = new URL(import.meta.env.BASE_URL, location.href).href + '#onedrive';
    await app.loginRedirect({ scopes: SCOPES, prompt: 'select_account', redirectStartPage });
  },
  async token(accountId: string) {
    const app = await client(), account = app.getActiveAccount();
    if (!account || account.homeAccountId !== accountId) throw new Error('Sign in to the Microsoft account used for this OneDrive folder. Your bookmarks are still saved.');
    try { return (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; }
    catch { throw new Error('OneDrive sign-in needs to be renewed. Use Sign in to OneDrive; your bookmarks are still saved.'); }
  },
  async disconnect() {
    const app = await client(); await app.clearCache(); app.setActiveAccount(null);
  },
};

export const oneDriveClient = new OneDriveClient(oneDriveAuth);
