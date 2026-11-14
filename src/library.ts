import type { Score } from './score';
import type { PortablePreferences } from './preferences';
/** The library index stores references and metadata. A separate single slot
 * caches the last opened score for resuming when file access is unavailable. */
export type ReadHandle = {
  kind: 'file'; name: string; getFile(): Promise<File>;
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
  isSameEntry(other: ReadHandle): Promise<boolean>;
};
export type DirectoryHandle = {
  kind: 'directory'; name: string;
  values(): AsyncIterableIterator<ReadHandle | DirectoryHandle>;
  getDirectoryHandle(name: string): Promise<DirectoryHandle>;
  getFileHandle(name: string): Promise<ReadHandle>;
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
};
export type LibraryEntry = {
  id: string; name: string; title: string; composer: string;
  folderId?: string; path?: string; favorite: boolean; lastOpened?: number;
  handle?: ReadHandle; fileSize?: number; modified?: number;
};
export type LibraryFolder = { id: string; name: string; handle?: DirectoryHandle };
export type Library = { entries: LibraryEntry[]; folders: LibraryFolder[] };
export const emptyLibrary = (): Library => ({ entries: [], folders: [] });
export const filePickers = globalThis as unknown as {
  showOpenFilePicker?: (options: object) => Promise<ReadHandle[]>;
  showDirectoryPicker?: (options: object) => Promise<DirectoryHandle>;
};

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('sotto-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadLibrary(): Promise<Library> {
  const db = await database();
  try {
    return await new Promise<Library>((resolve, reject) => {
      const request = db.transaction('library').objectStore('library').get('index');
      request.onsuccess = () => resolve(request.result ?? emptyLibrary());
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function saveLibrary(library: Library) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('library', 'readwrite');
      transaction.objectStore('library').put(library, 'index');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Library could not be saved.'));
    });
  } finally { db.close(); }
}
export async function loadLastScore(): Promise<{ key: string; score: Score } | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('library').objectStore('library').get('last-score');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
let scoreWrites = Promise.resolve();
export function saveLastScore(key: string, score: Score): Promise<void> {
  // Keep one slot, and serialize writes so a slow save cannot replace a newer song.
  scoreWrites = scoreWrites.catch(() => {}).then(async () => {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('library', 'readwrite');
        transaction.objectStore('library').put({ key, score }, 'last-score');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Last score could not be saved.'));
      });
    } finally { db.close(); }
  });
  return scoreWrites;
}
export function exportLibrary(library: Library, settings?: PortablePreferences): string {
  return JSON.stringify({ format: 'sotto-library', version: 1, ...(settings ? { settings } : {}),
    folders: library.folders.map(({ id, name }) => ({ id, name })),
    entries: library.entries.map(({ handle: _handle, ...metadata }) => metadata),
  }, null, 2);
}
export function parseLibrary(text: string): Library {
  const value = JSON.parse(text);
  const validString = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 2000;
  if (value?.format !== 'sotto-library' || value.version !== 1 || !Array.isArray(value.entries) ||
      !Array.isArray(value.folders) || value.entries.length > 10000 || value.folders.length > 1000) throw new Error('This is not a Sotto library index.');
  const folders: LibraryFolder[] = value.folders.map((folder: LibraryFolder) => {
    if (!validString(folder.id) || !validString(folder.name)) throw new Error('Invalid folder bookmark.');
    return { id: folder.id, name: folder.name };
  });
  const entries: LibraryEntry[] = value.entries.map((entry: LibraryEntry) => {
    if (!validString(entry.id) || !validString(entry.name) || typeof entry.title !== 'string' || typeof entry.composer !== 'string' ||
        typeof entry.favorite !== 'boolean' || (entry.folderId !== undefined && !folders.some(folder => folder.id === entry.folderId)) ||
        (entry.folderId !== undefined && (typeof entry.path !== 'string' || !entry.path.split('/').every(part => validString(part) && part !== '.' && part !== '..'))) ||
        (entry.lastOpened !== undefined && (!Number.isFinite(entry.lastOpened) || entry.lastOpened < 0))) throw new Error('Invalid score bookmark.');
    return { id: entry.id, name: entry.name, title: entry.title, composer: entry.composer, favorite: entry.favorite,
      ...(entry.folderId ? { folderId: entry.folderId, path: entry.path } : {}),
      ...(entry.lastOpened !== undefined ? { lastOpened: entry.lastOpened } : {}),
    };
  });
  if (new Set(folders.map(folder => folder.id)).size !== folders.length || new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate library identifiers.');
  return { folders, entries };
}
export async function readEntry(entry: LibraryEntry, library: Library, requestPermission = true): Promise<File | null> {
  const folder = library.folders.find(folder => folder.id === entry.folderId);
  const reference = folder?.handle ?? entry.handle;
  if (!reference) return null;
  if (await reference.queryPermission({ mode: 'read' }) !== 'granted') {
    if (!requestPermission) return null;
    if (await reference.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('Read access was not granted. Reconnect the file or folder to try again.');
  }
  if (entry.folderId && entry.path && folder?.handle) {
    const parts = entry.path.split('/');
    let parent = folder.handle;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
    return (await parent.getFileHandle(parts.at(-1)!)).getFile();
  }
  return entry.handle?.getFile() ?? null;
}
export async function scanDirectory(handle: DirectoryHandle, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for await (const child of handle.values()) {
    if (child.name.startsWith('.')) continue;
    if (child.kind === 'directory') paths.push(...await scanDirectory(child, `${prefix}${child.name}/`));
    else if (child.name.endsWith('.sotto.json')) paths.push(`${prefix}${child.name}`);
    if (paths.length > 10000) throw new Error('Please connect a smaller score folder (up to 10,000 scores).');
  }
  return paths;
}
export type ScoreMetadata = { title: string; composer: string; fileSize: number; modified: number };
export async function readScoreMetadata(file: File): Promise<ScoreMetadata | null> {
  if (file.size > 15_000_000) return null;
  try {
    const value = JSON.parse(await file.text());
    if (value?.format !== 'sotto-score' || value.version !== 1 || typeof value.title !== 'string' || typeof value.composer !== 'string') return null;
    return { title: value.title, composer: value.composer, fileSize: file.size, modified: file.lastModified };
  } catch { return null; }
}
export async function folderMetadata(handle: DirectoryHandle, paths: string[], library: Library, folderId: string): Promise<Record<string, ScoreMetadata>> {
  const existing = new Map(library.entries.filter(entry => entry.folderId === folderId).map(entry => [entry.path, entry]));
  const metadata: Record<string, ScoreMetadata> = {};
  // Read one score at a time and retain only its metadata. Unchanged files do
  // not need their JSON read again on subsequent library refreshes.
  for (const path of paths) {
    try {
      const parts = path.split('/'); let parent = handle;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      const file = await (await parent.getFileHandle(parts.at(-1)!)).getFile();
      const previous = existing.get(path);
      if (previous?.fileSize === file.size && previous.modified === file.lastModified) continue;
      const value = await readScoreMetadata(file); if (value) metadata[path] = value;
    } catch { /* A file may disappear or be unavailable during a folder scan. */ }
  }
  return metadata;
}
export function connectFolder(library: Library, folder: LibraryFolder, paths: string[], metadata: Record<string, ScoreMetadata> = {}): Library {
  const entries = [...library.entries];
  const indexes = new Map(entries.flatMap((entry, index) => entry.folderId === folder.id ? [[entry.path, index] as const] : []));
  for (const path of paths) {
    const existing = indexes.get(path), details = metadata[path];
    if (existing !== undefined) { if (details) entries[existing] = { ...entries[existing], ...details }; continue; }
    const name = path.split('/').at(-1)!;
    indexes.set(path, entries.length);
    entries.push({ id: crypto.randomUUID(), name, title: details?.title ?? name.replace(/\.sotto\.json$/, '').replaceAll('-', ' '),
      composer: details?.composer ?? '', folderId: folder.id, path, favorite: false,
      ...(details ? { fileSize: details.fileSize, modified: details.modified } : {}) });
  }
  return { entries, folders: [...library.folders.filter(item => item.id !== folder.id), folder] };
}
