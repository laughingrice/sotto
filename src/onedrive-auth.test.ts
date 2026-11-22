import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ create: vi.fn(), app: {
  handleRedirectPromise: vi.fn(), getActiveAccount: vi.fn(), getAllAccounts: vi.fn(), setActiveAccount: vi.fn(),
  acquireTokenSilent: vi.fn(), loginRedirect: vi.fn(), clearCache: vi.fn(),
} }));
vi.mock('@azure/msal-browser', () => ({ createStandardPublicClientApplication: sdk.create }));
const ID = '11111111-2222-3333-4444-555555555555';
const account = { homeAccountId: 'personal-account', username: 'person@example.test' };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal('location', new URL('https://laughingrice.github.io/sotto/'));
  vi.stubEnv('BASE_URL', '/sotto/'); vi.stubEnv('VITE_ONEDRIVE_CLIENT_ID', '');
  sdk.create.mockResolvedValue(sdk.app); sdk.app.handleRedirectPromise.mockResolvedValue(null);
  sdk.app.getActiveAccount.mockReturnValue(account); sdk.app.getAllAccounts.mockReturnValue([account]);
  sdk.app.acquireTokenSilent.mockResolvedValue({ accessToken: 'mock-access-token' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('does not initialize authentication for people who have not configured OneDrive', async () => {
  const { oneDriveAuth } = await import('./onedrive-auth');
  expect(await oneDriveAuth.account()).toBeNull(); expect(sdk.create).not.toHaveBeenCalled();
});
it('uses the official consumer-account SPA flow, only Files.Read, and a base-aware bridge callback', async () => {
  const { configureOneDrive, oneDriveAuth, oneDriveRedirectUri } = await import('./onedrive-auth');
  configureOneDrive(ID);
  await Promise.all([oneDriveAuth.account(), oneDriveAuth.account()]);
  expect(sdk.create).toHaveBeenCalledTimes(1); expect(sdk.app.handleRedirectPromise).toHaveBeenCalledTimes(1);
  expect(sdk.create.mock.calls[0][0]).toMatchObject({ auth: { clientId: ID, authority: 'https://login.microsoftonline.com/consumers', redirectUri: 'https://laughingrice.github.io/sotto/redirect.html' } });
  expect(oneDriveRedirectUri()).toBe('https://laughingrice.github.io/sotto/redirect.html');
  expect(await oneDriveAuth.token(account.homeAccountId)).toBe('mock-access-token');
  expect(sdk.app.acquireTokenSilent).toHaveBeenCalledWith({ scopes: ['Files.Read'], account });
  await oneDriveAuth.signIn();
  expect(sdk.app.loginRedirect).toHaveBeenCalledWith({ scopes: ['Files.Read'], prompt: 'select_account', redirectStartPage: 'https://laughingrice.github.io/sotto/#onedrive' });
});
it('rejects another account and expired authorization without automatic login navigation', async () => {
  const { configureOneDrive, oneDriveAuth } = await import('./onedrive-auth'); configureOneDrive(ID);
  await expect(oneDriveAuth.token('another-account')).rejects.toThrow('Microsoft account used');
  expect(sdk.app.acquireTokenSilent).not.toHaveBeenCalled();
  sdk.app.acquireTokenSilent.mockRejectedValue(new Error('interaction_required'));
  await expect(oneDriveAuth.token(account.homeAccountId)).rejects.toThrow('renewed');
  expect(sdk.app.loginRedirect).not.toHaveBeenCalled();
});
it('clears only app sign-in state on disconnect and validates the public client ID', async () => {
  const { configureOneDrive, oneDriveAuth } = await import('./onedrive-auth');
  expect(() => configureOneDrive('not-an-id')).toThrow('client'); configureOneDrive(ID);
  await oneDriveAuth.disconnect(); expect(sdk.app.clearCache).toHaveBeenCalled(); expect(sdk.app.setActiveAccount).toHaveBeenLastCalledWith(null);
});
