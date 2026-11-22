import { isScoreFile, scoreFileStem } from './score-file';
import type { Library, LibraryEntry, LibraryFolder } from './library';

export type OneDriveItemRef = { driveId: string; itemId: string };
export type OneDriveFolderRef = OneDriveItemRef & { accountId: string };
export type CloudItem = { id: string; name: string; kind: 'folder' | 'file'; size?: number; modified?: number };
export type CloudFile = CloudItem & { path: string };
export type CloudAccount = { id: string; label: string };
export type CloudAccess = { token(accountId: string): Promise<string> };
const GRAPH = 'https://graph.microsoft.com/v1.0/';
const SELECT = 'id,name,folder,file,size,lastModifiedDateTime,remoteItem';
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9!._-]{1,256}$/.test(value);
export function parseOneDriveItem(value: unknown): OneDriveItemRef {
  const item = value as OneDriveItemRef;
  if (!item || !identifier(item.driveId) || !identifier(item.itemId)) throw new Error('Invalid OneDrive item bookmark.');
  return { driveId: item.driveId, itemId: item.itemId };
}
export function parseOneDriveFolder(value: unknown): OneDriveFolderRef {
  const item = value as OneDriveFolderRef, ref = parseOneDriveItem(value);
  if (typeof item.accountId !== 'string' || !item.accountId || item.accountId.length > 1000) throw new Error('Invalid OneDrive account bookmark.');
  return { ...ref, accountId: item.accountId };
}
export function graphUrl(path: string) {
  const url = new URL(path, GRAPH);
  if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password) throw new Error('Invalid OneDrive API address.');
  return url.href;
}
function cloudItem(raw: unknown): CloudItem | null {
  const item = raw as Record<string, unknown>;
  if (!item || !identifier(item.id) || typeof item.name !== 'string' || !item.name || item.name.length > 1000 || /[/\\\x00-\x1f]/.test(item.name) || ['.', '..'].includes(item.name)) throw new Error('OneDrive returned invalid file metadata.');
  if (item.remoteItem) return null; // Shared shortcuts require different permissions/routing.
  if (!item.folder && !item.file) return null;
  const modified = typeof item.lastModifiedDateTime === 'string' ? Date.parse(item.lastModifiedDateTime) : NaN;
  return { id: item.id, name: item.name, kind: item.folder ? 'folder' : 'file',
    ...(typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 ? { size: item.size } : {}),
    ...(Number.isFinite(modified) ? { modified } : {}) };
}
async function bytes(response: Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('OneDrive file is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser cannot read the OneDrive response.');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new Error('OneDrive file is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
/** Metadata only during browsing/refresh. No download URLs are stored. */
export class OneDriveClient {
  constructor(private access: CloudAccess, private request: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private async json(path: string, accountId: string, signal?: AbortSignal): Promise<Record<string, any>> {
    const url = graphUrl(path), token = await this.access.token(accountId);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    try {
      const response = await this.request(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
      if (response.status === 401) throw new Error('OneDrive sign-in expired. Sign in again; your folder bookmarks are still saved.');
      if (response.status === 403) throw new Error('OneDrive did not grant read access. Sign in with the folder’s account and allow Files.Read.');
      if (response.status === 404) throw new Error('This OneDrive item is no longer available. Refresh its folder to remove missing bookmarks.');
      if (response.status === 429 || response.status === 503) throw new Error('OneDrive is temporarily limiting requests. Wait a moment and refresh again; the current listing was kept.');
      if (!response.ok) throw new Error(`OneDrive request failed (${response.status}). The current listing was kept.`);
      return JSON.parse(new TextDecoder().decode(await bytes(response, 4_000_000)));
    } catch (error) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'OneDrive operation cancelled. The current listing was kept.' : 'OneDrive request timed out. The current listing was kept.');
      if (error instanceof TypeError) throw new Error('Cannot reach OneDrive. Check your internet connection and try again.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async root(accountId: string, signal?: AbortSignal): Promise<{ ref: OneDriveFolderRef; item: CloudItem }> {
    const drive = await this.json('me/drive?$select=id,driveType', accountId, signal);
    if (!identifier(drive.id) || drive.driveType !== 'personal') throw new Error('Connect a OneDrive Personal account for this library.');
    const raw = await this.json(`drives/${encodeURIComponent(drive.id)}/root?$select=${SELECT}`, accountId, signal), item = cloudItem(raw);
    if (!item || item.kind !== 'folder') throw new Error('OneDrive did not return a root folder.');
    return { ref: { driveId: drive.id, itemId: item.id, accountId }, item };
  }
  async children(ref: OneDriveFolderRef, signal?: AbortSignal): Promise<CloudItem[]> {
    parseOneDriveFolder(ref);
    let next: string | undefined = `drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}/children?$select=${SELECT}&$top=200`;
    const seen = new Set<string>(), ids = new Set<string>(), items: CloudItem[] = [];
    while (next) {
      const url = graphUrl(next);
      if (seen.has(url) || seen.size >= 1000) throw new Error('OneDrive folder pagination did not finish. The current listing was kept.');
      seen.add(url);
      const page = await this.json(url, ref.accountId, signal);
      if (!Array.isArray(page.value)) throw new Error('OneDrive returned an incomplete folder listing.');
      for (const raw of page.value) { const item = cloudItem(raw); if (item && !item.name.startsWith('.') && !ids.has(item.id)) { ids.add(item.id); items.push(item); } }
      if (items.length > 20000) throw new Error('Please choose a smaller OneDrive folder.');
      if (page['@odata.nextLink'] !== undefined && typeof page['@odata.nextLink'] !== 'string') throw new Error('OneDrive returned invalid pagination.');
      next = page['@odata.nextLink'];
    }
    return items.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
  }
  async scan(ref: OneDriveFolderRef, signal?: AbortSignal, progress: (folders: number, files: number) => void = () => {}) {
    const pending = [{ ref, prefix: '' }], visited = new Set<string>(), fileIds = new Set<string>(), files: CloudFile[] = [];
    while (pending.length) {
      const folder = pending.pop()!;
      if (visited.has(folder.ref.itemId)) continue; visited.add(folder.ref.itemId);
      if (visited.size > 10000) throw new Error('Please choose a smaller OneDrive folder (up to 10,000 subfolders).');
      for (const item of await this.children(folder.ref, signal)) {
        const path = `${folder.prefix}${item.name}`;
        if (item.kind === 'folder') pending.push({ ref: { ...ref, itemId: item.id }, prefix: `${path}/` });
        else if (isScoreFile(item.name) && !fileIds.has(item.id)) { fileIds.add(item.id); files.push({ ...item, path }); }
        if (files.length > 10000) throw new Error('Please choose a smaller OneDrive folder (up to 10,000 scores).');
      }
      progress(visited.size, files.length);
    }
    return files;
  }
  async file(ref: OneDriveFolderRef, itemId: string, signal?: AbortSignal): Promise<File> {
    parseOneDriveFolder(ref);
    if (!identifier(itemId)) throw new Error('Invalid OneDrive score bookmark.');
    const raw = await this.json(`drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(itemId)}?$select=${SELECT},@microsoft.graph.downloadUrl`, ref.accountId, signal);
    const item = cloudItem(raw), address = raw['@microsoft.graph.downloadUrl'];
    if (!item || item.kind !== 'file' || !isScoreFile(item.name) || typeof address !== 'string') throw new Error('OneDrive did not return a downloadable Sotto score.');
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('OneDrive returned an invalid download URL.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    try {
      // A short-lived Graph download URL is preauthenticated. Never send the
      // Microsoft bearer token to this separate host or persist/cache the URL.
      const response = await this.request(url.href, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`The OneDrive score could not be downloaded (${response.status}). Refresh and try again.`);
      const data = await bytes(response, 15_000_000);
      return new File([data], item.name, { lastModified: item.modified ?? Date.now() });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'OneDrive download cancelled.' : 'OneDrive download timed out.');
      if (error instanceof TypeError) throw new Error('Cannot download this OneDrive score. Check your connection and try again.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}
export function connectOneDrive(library: Library, name: string, ref: OneDriveFolderRef, files: CloudFile[], reuseFolderId?: string): Library {
  ref = parseOneDriveFolder(ref);
  const existing = library.folders.find(folder => folder.oneDrive?.driveId === ref.driveId && folder.oneDrive.itemId === ref.itemId && folder.oneDrive.accountId === ref.accountId);
  const local = reuseFolderId ? library.folders.find(folder => folder.id === reuseFolderId) : undefined;
  if (reuseFolderId && (!local || local.oneDrive || local.dropbox || local.catalogUrl || (existing && existing.id !== reuseFolderId))) throw new Error('Choose an unconnected local folder to reuse its bookmarks.');
  const id = existing?.id ?? local?.id ?? `onedrive-folder:${ref.driveId}:${ref.itemId}`;
  const folder: LibraryFolder = { id, name, oneDrive: ref };
  const entries: LibraryEntry[] = files.map(file => {
    const old = library.entries.find(entry => entry.folderId === id && (entry.oneDrive?.itemId === file.id || (local && entry.path === file.path)));
    const { handle: _handle, online: _online, ...metadata } = old ?? {};
    return { ...metadata, id: old?.id ?? `onedrive:${ref.driveId}:${ref.itemId}:${file.id}`, folderId: id, path: file.path, name: file.name,
      title: old?.title ?? scoreFileStem(file.name).replaceAll('-', ' '), composer: old?.composer ?? '', favorite: old?.favorite ?? false,
      oneDrive: { driveId: ref.driveId, itemId: file.id }, fileSize: file.size, modified: file.modified };
  });
  return { folders: [...library.folders.filter(item => item.id !== id), folder], entries: [...library.entries.filter(entry => entry.folderId !== id), ...entries] };
}
