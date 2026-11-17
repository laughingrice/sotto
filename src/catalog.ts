import { scoreFileStem } from './score-file';
import type { Library, LibraryEntry, LibraryFolder } from './library';

export const SAMPLE_CATALOG = `${import.meta.env.BASE_URL}scores/samples/catalog.json`;
export type OnlineScore = { url: string; instruments: string; license: string; licenseUrl?: string; credit: string; source?: string; sourceFile?: string; description: string };
export type Catalog = { title: string; scores: { id: string; title: string; composer: string; online: OnlineScore }[] };
const string = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
export function onlineUrl(value: unknown, base?: string): string {
  if (!string(value, 1500)) throw new Error('Please use an HTTPS URL for the online library.');
  const url = new URL(value, base);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Online libraries require HTTPS (or localhost for development).');
  url.hash = '';
  return url.href;
}
export function parseOnlineScore(value: unknown): OnlineScore {
  const item = value as OnlineScore;
  if (!item || !string(item.instruments) || !string(item.license) || !string(item.credit) || typeof item.description !== 'string' || item.description.length > 4000) throw new Error('Invalid online score metadata.');
  return { url: onlineUrl(item.url), instruments: item.instruments, license: item.license, credit: item.credit, description: item.description,
    ...(item.licenseUrl !== undefined ? { licenseUrl: onlineUrl(item.licenseUrl) } : {}),
    ...(item.source !== undefined ? { source: onlineUrl(item.source) } : {}), ...(item.sourceFile !== undefined ? { sourceFile: onlineUrl(item.sourceFile) } : {}) };
}
export function parseCatalog(value: unknown, address: string): Catalog {
  const url = onlineUrl(address), data = value as { format?: string; version?: number; title?: string; scores?: Record<string, unknown>[] };
  if (data?.format !== 'sotto-catalog' || data.version !== 1 || !string(data.title) || !Array.isArray(data.scores) || data.scores.length > 10000) throw new Error('This is not a Sotto online catalog. Choose its catalog.json URL.');
  const scores = data.scores.map(item => {
    if (!item || !string(item.id, 150) || !/^[a-zA-Z0-9_-]+$/.test(item.id) || !string(item.title) || typeof item.composer !== 'string' || item.composer.length > 2000) throw new Error('Invalid online catalog entry.');
    return { id: item.id, title: item.title, composer: item.composer, online: parseOnlineScore({ ...item, description: item.description ?? '', url: onlineUrl(item.file, url),
      ...(item.source !== undefined ? { source: onlineUrl(item.source, url) } : {}), ...(item.sourceFile !== undefined ? { sourceFile: onlineUrl(item.sourceFile, url) } : {}) }) };
  });
  if (new Set(scores.map(score => score.id)).size !== scores.length) throw new Error('Duplicate score IDs in online catalog.');
  return { title: data.title, scores };
}
export async function fetchOnlineBytes(address: string, maxBytes: number, signal?: AbortSignal, timeoutMs = 20000): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    // Existing sample bookmarks keep their IDs/settings across the format migration.
    let url = onlineUrl(address);
    if (typeof location !== 'undefined') {
      const samples = new URL('scores/samples/', new URL(import.meta.env.BASE_URL, location.href)).href;
      if (url.startsWith(samples) && url.endsWith('.sotto.json')) url = url.slice(0, -5);
    }
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!response.ok) throw new Error(`Online library request failed (${response.status}).`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Online library file is too large.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('This browser cannot read the online library response.');
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > maxBytes) { await reader.cancel(); throw new Error('Online library file is too large.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    chunks.forEach(chunk => { combined.set(chunk, offset); offset += chunk.length; });
    return combined;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Online library request timed out. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function fetchOnlineText(address: string, maxBytes: number, signal?: AbortSignal, timeoutMs = 20000): Promise<string> {
  return new TextDecoder().decode(await fetchOnlineBytes(address, maxBytes, signal, timeoutMs));
}
export async function fetchCatalog(url: string): Promise<Catalog> {
  try { return parseCatalog(JSON.parse(await fetchOnlineText(url, 2_000_000)), url); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('This URL did not return a JSON catalog. Use the direct catalog.json URL, rather than a sharing page.');
    if (error instanceof TypeError) throw new Error('Cannot reach this online library. Check the URL, internet connection and host’s CORS permissions.');
    throw error;
  }
}
export function connectCatalog(library: Library, catalog: Catalog, url: string): Library {
  const address = onlineUrl(url), existing = library.folders.find(folder => folder.catalogUrl === address);
  const folder: LibraryFolder = { id: existing?.id ?? crypto.randomUUID(), name: catalog.title, catalogUrl: address };
  const entries: LibraryEntry[] = catalog.scores.map(item => {
    const name = `${item.id}${new URL(item.online.url).pathname.endsWith('.sotto') ? '.sotto' : '.sotto.json'}`, old = library.entries.find(entry => entry.folderId === folder.id && scoreFileStem(entry.name) === item.id);
    return { ...old, id: old?.id ?? crypto.randomUUID(), name, title: item.title, composer: item.composer, favorite: old?.favorite ?? false,
      folderId: folder.id, path: `${item.online.instruments.replaceAll('/', ' & ')}/${name}`, online: item.online };
  });
  return { folders: [...library.folders.filter(item => item.id !== folder.id), folder], entries: [...library.entries.filter(item => item.folderId !== folder.id), ...entries] };
}
