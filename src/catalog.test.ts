import { describe, expect, it, vi } from 'vitest';
import { connectCatalog, fetchOnlineText, onlineUrl, parseCatalog } from './catalog';
import { emptyLibrary, exportLibrary, parseLibrary } from './library';

const address = 'https://example.org/music/catalog.json';
const manifest = { format: 'sotto-catalog', version: 1, title: 'Samples', scores: [{ id: 'piece', title: 'A piece', composer: 'Composer',
  file: 'piece.sotto.json', instruments: 'Piano', license: 'Public Domain', credit: 'Typesetter', source: 'https://example.org/original', sourceFile: 'piece-source.zip' }] };
describe('online catalogs', () => {
  it('resolves relative URLs and round-trips bookmarks, credits, favorites and settings IDs', () => {
    const catalog = parseCatalog(manifest, address);
    let library = connectCatalog(emptyLibrary(), catalog, address);
    const entry = library.entries[0];
    entry.favorite = true; entry.lastOpened = 123;
    const refreshed = parseCatalog({ ...manifest, scores: [{ ...manifest.scores[0], title: 'Corrected title', file: 'revision.sotto.json' }] }, address);
    library = connectCatalog(library, refreshed, address);
    expect(library.entries).toHaveLength(1);
    expect(library.entries[0]).toMatchObject({ id: entry.id, favorite: true, lastOpened: 123, title: 'Corrected title', online: { url: 'https://example.org/music/revision.sotto.json' } });
    const backup = exportLibrary(library);
    expect(backup).not.toContain('pages');
    expect(parseLibrary(backup)).toEqual(library);
    expect(library.folders[0].catalogUrl).toBe(address);
  });
  it('rejects executable links, credentials, duplicate IDs and invalid licenses', () => {
    for (const url of ['javascript:alert(1)', 'data:application/json,{}', 'file:///tmp/score', 'https://user:password@example.org/catalog', 'http://example.org/catalog']) expect(() => onlineUrl(url)).toThrow();
    expect(onlineUrl('http://localhost:4174/catalog.json')).toContain('localhost');
    expect(() => parseCatalog({ ...manifest, scores: [...manifest.scores, ...manifest.scores] }, address)).toThrow('Duplicate');
    expect(() => parseCatalog({ ...manifest, scores: [{ ...manifest.scores[0], license: '' }] }, address)).toThrow();
    expect(() => parseCatalog({ ...manifest, scores: [{ ...manifest.scores[0], sourceFile: 'javascript:alert(1)' }] }, address)).toThrow();
    expect(() => parseLibrary(JSON.stringify({ format: 'sotto-library', version: 1, entries: [], folders: [{ id: 'f', name: 'Bad', catalogUrl: 'javascript:alert(1)' }] }))).toThrow();
  });
  it('stops oversized streamed responses even without a content-length', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(200)); }, cancel }))));
    try { await expect(fetchOnlineText(address, 100)).rejects.toThrow('too large'); expect(cancel).toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
});
