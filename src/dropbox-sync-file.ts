import { dropboxBytes } from './dropbox';
import { parsePracticeSync, type PracticeSyncDocument } from './practice-sync';

// Callers cannot supply an upload path. Full Dropbox access writes only to
// this dedicated file; App Folder registrations use a root-relative equivalent.
export const PRACTICE_SYNC_PATH = '/Apps/Sotto/practice-settings-v1.json';
export const MAX_SYNC_BYTES = 5_000_000;
export type SyncFileVersion = { document: PracticeSyncDocument; rev: string };
export interface PracticeSyncFile {
  read(signal?: AbortSignal): Promise<SyncFileVersion | null>;
  write(document: PracticeSyncDocument, previousRev?: string, signal?: AbortSignal): Promise<string>;
}
export class SyncConflict extends Error { constructor() { super('Settings changed on another device. Merging and retrying.'); } }
type SyncAccess = { token(accountId: string): Promise<string>; writeToken(accountId: string): Promise<string> };
function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{1,128}$/.test(value)) throw new Error('Dropbox returned an invalid sync-file revision.');
  return value;
}
export class DropboxSyncFile implements PracticeSyncFile {
  constructor(private access: SyncAccess, private accountId: string, private request: typeof fetch = globalThis.fetch.bind(globalThis), private appFolder = false) {}
  private path() { return this.appFolder ? '/practice-settings-v1.json' : PRACTICE_SYNC_PATH; }
  private async run<T>(write: boolean, signal: AbortSignal | undefined, action: (token: string, signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    try { return await action(await (write ? this.access.writeToken(this.accountId) : this.access.token(this.accountId)), controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'Settings sync cancelled. Local changes are kept.' : 'Dropbox settings sync timed out. Local changes are kept.');
      if (error instanceof TypeError) throw new Error('Cannot reach Dropbox. Local settings will sync when you reconnect.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  private check(response: Response) {
    if (response.status === 401) throw new Error('Settings sync sign-in expired. Reconnect Dropbox; local changes are kept.');
    if (response.status === 403) throw new Error('Dropbox denied settings sync. Check the app permissions and enable sync again.');
    if (response.status === 429 || response.status >= 500) throw new Error('Dropbox is temporarily unavailable. Local settings are kept for the next sync.');
    if (!response.ok) throw new Error(`Dropbox settings sync failed (${response.status}). Local changes are kept.`);
  }
  read(signal?: AbortSignal) {
    return this.run(false, signal, async (token, abort) => {
      const response = await this.request('https://content.dropboxapi.com/2/files/download', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: this.path() }) },
        signal: abort, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (response.status === 409) {
        const error = JSON.parse(new TextDecoder().decode(await dropboxBytes(response, 100000)));
        if (error?.error?.['.tag'] === 'path' && error.error.path?.['.tag'] === 'not_found') return null;
      }
      this.check(response);
      const metadata = JSON.parse(response.headers.get('Dropbox-API-Result') || '{}');
      const rev = revision(metadata.rev);
      const document = parsePracticeSync(JSON.parse(new TextDecoder().decode(await dropboxBytes(response, MAX_SYNC_BYTES))), this.accountId);
      return { document, rev };
    });
  }
  write(document: PracticeSyncDocument, previousRev?: string, signal?: AbortSignal) {
    const data = JSON.stringify(parsePracticeSync(document, this.accountId));
    if (new TextEncoder().encode(data).length > MAX_SYNC_BYTES) return Promise.reject(new Error('Settings sync exceeds its 5 MB limit. Local settings were kept.'));
    if (previousRev !== undefined) revision(previousRev);
    return this.run(true, signal, async (token, abort) => {
      const response = await this.request('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({
          path: this.path(), mode: previousRev ? { '.tag': 'update', update: previousRev } : { '.tag': 'add' },
          autorename: false, strict_conflict: true, mute: true,
        }) }, body: data, signal: abort, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (response.status === 409) throw new SyncConflict();
      this.check(response);
      return revision(JSON.parse(new TextDecoder().decode(await dropboxBytes(response, 100000))).rev);
    });
  }
}
