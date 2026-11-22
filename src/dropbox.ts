import { isScoreFile, scoreFileStem, MAX_SCORE_BYTES } from './score-file';
import type { CloudAccount, CloudFile, CloudItem, CloudAccess } from './onedrive';
import type { Library, LibraryEntry } from './library';

export type DropboxRef = { accountId: string; itemId: string };
export function parseDropboxRef(value: unknown, root = false): DropboxRef {
  const ref = value as DropboxRef;
  if (!ref || typeof ref.accountId !== 'string' || !/^dbid:[A-Za-z0-9_-]{1,200}$/.test(ref.accountId) ||
      typeof ref.itemId !== 'string' || !(root && ref.itemId === '') && !/^id:[A-Za-z0-9_-]{1,200}$/.test(ref.itemId)) throw new Error('Invalid Dropbox bookmark.');
  return { accountId: ref.accountId, itemId: ref.itemId };
}
export async function dropboxBytes(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Dropbox response exceeds the size limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser cannot read the Dropbox response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error('Dropbox response exceeds the size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
/** Fixed API routes only: a pagination cursor never becomes a URL. */
export async function dropboxRequest(route: string, token: string, body: unknown, signal?: AbortSignal, request: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Response> {
  if (!['files/list_folder', 'files/list_folder/continue', 'files/get_metadata', 'files/download', 'users/get_current_account'].includes(route)) throw new Error('Unsupported Dropbox operation.');
  const download = route === 'files/download';
  // Dropbox-API-Arg is an HTTP header; escape Unicode filenames if ever used.
  const arg = JSON.stringify(body).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const response = await request(`https://${download ? 'content' : 'api'}.dropboxapi.com/2/${route}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(download ? { 'Dropbox-API-Arg': arg } : { 'Content-Type': 'application/json' }) },
    ...(download ? {} : { body: arg }), signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
  });
  if (response.status === 401) throw new Error('Dropbox sign-in expired. Sign in again; your folder bookmarks are still saved.');
  if (response.status === 403) throw new Error('Dropbox denied access. Check the app’s three read permissions and sign in again.');
  if (response.status === 409) throw new Error('This Dropbox item is unavailable or changed during the scan. Try Refresh again. Existing bookmarks were kept.');
  if (response.status === 429 || response.status >= 500) throw new Error('Dropbox is temporarily unavailable or limiting requests. Try again later; existing bookmarks were kept.');
  if (!response.ok) throw new Error(`Dropbox request failed (${response.status}). Existing bookmarks were kept.`);
  return response;
}
function item(raw: any): CloudItem & { fullPath: string } {
  if (!raw || !/^id:[A-Za-z0-9_-]{1,200}$/.test(raw.id) || !['file', 'folder'].includes(raw['.tag']) ||
      typeof raw.name !== 'string' || !raw.name || /[/\\\x00-\x1f]/.test(raw.name) || ['.', '..'].includes(raw.name) ||
      typeof raw.path_display !== 'string' || !raw.path_display.startsWith('/') || raw.path_display.split('/').slice(1).some((part: string) => !part || ['.', '..'].includes(part) || /[\\\x00-\x1f]/.test(part))) throw new Error('Dropbox returned invalid file metadata.');
  const modified = Date.parse(raw.server_modified);
  return { id: raw.id, name: raw.name, kind: raw['.tag'], fullPath: raw.path_display,
    ...(Number.isFinite(raw.size) && raw.size >= 0 ? { size: raw.size } : {}), ...(Number.isFinite(modified) ? { modified } : {}) };
}
export class DropboxClient {
  constructor(private access: CloudAccess, private request: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private async run<T>(accountId: string, signal: AbortSignal | undefined, action: (token: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    try { return await action(await this.access.token(accountId), controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'Dropbox operation cancelled. Existing bookmarks kept.' : 'Dropbox request timed out. Existing bookmarks kept.');
      if (error instanceof TypeError) throw new Error('Cannot reach Dropbox. Check your connection and try again.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  private json(ref: DropboxRef, route: string, body: unknown, signal?: AbortSignal): Promise<any> {
    return this.run(ref.accountId, signal, async (token, abort) => JSON.parse(new TextDecoder().decode(await dropboxBytes(await dropboxRequest(route, token, body, abort, this.request), 4_000_000))));
  }
  async account(token: string, signal?: AbortSignal): Promise<CloudAccount> {
    const raw = JSON.parse(new TextDecoder().decode(await dropboxBytes(await dropboxRequest('users/get_current_account', token, null, signal, this.request), 100000)));
    parseDropboxRef({ accountId: raw.account_id, itemId: '' }, true);
    return { id: raw.account_id, label: typeof raw.email === 'string' ? raw.email : 'Dropbox account' };
  }
  private async list(ref: DropboxRef, recursive: boolean, signal?: AbortSignal, progress = (_folders: number, _files: number) => {}) {
    parseDropboxRef(ref, true);
    const prefix = ref.itemId ? item(await this.json(ref, 'files/get_metadata', { path: ref.itemId }, signal)).fullPath + '/' : '/';
    let page = await this.json(ref, 'files/list_folder', { path: ref.itemId, recursive, include_deleted: false, include_non_downloadable_files: false, limit: 1000 }, signal);
    const cursors = new Set<string>(), found = new Map<string, CloudFile>(); let folders = 0, count = 0;
    while (true) {
      if (!Array.isArray(page.entries) || typeof page.has_more !== 'boolean') throw new Error('Dropbox returned an incomplete folder listing. Existing bookmarks kept.');
      for (const raw of page.entries) {
        if (++count > 100000) throw new Error('Please connect a smaller Dropbox folder (up to 100,000 items).');
        const entry = item(raw);
        if (!entry.fullPath.toLowerCase().startsWith(prefix.toLowerCase())) throw new Error('The Dropbox folder moved during the scan. Refresh again; existing bookmarks kept.');
        const path = entry.fullPath.slice(prefix.length);
        if (path.split('/').some(part => part.startsWith('.'))) continue;
        if (entry.kind === 'folder') folders++;
        if (!recursive || entry.kind === 'file' && isScoreFile(entry.name)) { const { fullPath: _path, ...metadata } = entry; found.set(entry.id, { ...metadata, path }); }
        if (found.size > (recursive ? 10000 : 20000)) throw new Error('Please connect a smaller Dropbox folder.');
      }
      progress(folders, found.size);
      if (!page.has_more) break;
      if (typeof page.cursor !== 'string' || !page.cursor || cursors.has(page.cursor) || cursors.size >= 1000) throw new Error('Dropbox pagination did not finish. Existing bookmarks kept.');
      cursors.add(page.cursor);
      page = await this.json(ref, 'files/list_folder/continue', { cursor: page.cursor }, signal);
    }
    return [...found.values()];
  }
  async children(ref: DropboxRef, signal?: AbortSignal): Promise<CloudItem[]> {
    return (await this.list(ref, false, signal)).sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
  }
  scan(ref: DropboxRef, signal?: AbortSignal, progress?: (folders: number, files: number) => void) { return this.list(ref, true, signal, progress); }
  file(ref: DropboxRef, itemId: string, signal?: AbortSignal): Promise<File> {
    parseDropboxRef(ref, true); parseDropboxRef({ ...ref, itemId });
    return this.run(ref.accountId, signal, async (token, abort) => {
      const response = await dropboxRequest('files/download', token, { path: itemId }, abort, this.request);
      const metadata = item({ ...JSON.parse(response.headers.get('Dropbox-API-Result') || '{}'), '.tag': 'file' });
      if (metadata.id !== itemId || !isScoreFile(metadata.name)) throw new Error('Dropbox did not return the requested Sotto score.');
      const data = await dropboxBytes(response, MAX_SCORE_BYTES);
      return new File([data], metadata.name, { lastModified: metadata.modified ?? Date.now() });
    });
  }
}
export function connectDropbox(library: Library, name: string, ref: DropboxRef, files: CloudFile[], reuseFolderId?: string): Library {
  ref = parseDropboxRef(ref, true);
  const existing = library.folders.find(folder => folder.dropbox?.accountId === ref.accountId && folder.dropbox.itemId === ref.itemId);
  const local = reuseFolderId ? library.folders.find(folder => folder.id === reuseFolderId) : undefined;
  if (reuseFolderId && (!local || local.dropbox || local.oneDrive || local.catalogUrl || existing && existing.id !== reuseFolderId)) throw new Error('Choose an unconnected local folder to reuse its bookmarks.');
  const id = existing?.id ?? local?.id ?? `dropbox-folder:${ref.accountId}:${ref.itemId}`;
  const entries: LibraryEntry[] = files.map(file => {
    const old = library.entries.find(entry => entry.folderId === id && (entry.dropbox?.itemId === file.id || local && entry.path === file.path));
    const { handle: _handle, online: _online, oneDrive: _oneDrive, ...metadata } = old ?? {};
    return { ...metadata, id: old?.id ?? `dropbox:${ref.accountId}:${ref.itemId}:${file.id}`, folderId: id, path: file.path, name: file.name,
      title: old?.title ?? scoreFileStem(file.name).replaceAll('-', ' '), composer: old?.composer ?? '', favorite: old?.favorite ?? false,
      dropbox: { accountId: ref.accountId, itemId: file.id }, fileSize: file.size, modified: file.modified };
  });
  return { folders: [...library.folders.filter(folder => folder.id !== id), { id, name, dropbox: ref }], entries: [...library.entries.filter(entry => entry.folderId !== id), ...entries] };
}
