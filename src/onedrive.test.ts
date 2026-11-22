import { describe, expect, it, vi } from 'vitest';
import { OneDriveClient, connectOneDrive, graphUrl, parseOneDriveFolder, type CloudFile } from './onedrive';
import { emptyLibrary, exportLibrary, parseLibrary } from './library';
const ref = { driveId: 'drive', itemId: 'scores', accountId: 'personal-account' };
const item = (id: string, name: string, folder = false) => ({ id, name, ...(folder ? { folder: {} } : { file: {} }), size: 100 });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const file = (id: string, path: string): CloudFile => ({ id, path, name: path.split('/').at(-1)!, kind: 'file', size: 100 });

describe('OneDrive reference library', () => {
  it('lists pages and arbitrary nested folders without opening file contents', async () => {
    const token = vi.fn(async () => 'test-token');
    const request = vi.fn(async (address: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(address));
      expect(options?.headers).toEqual({ Authorization: 'Bearer test-token' });
      expect(options?.cache).toBe('no-store');
      if (url.searchParams.get('page') === '2') return json({ value: [item('extra', 'second.sotto')] });
      const id = url.pathname.split('/').at(-2);
      if (id === 'scores') return json({ value: [item('guitar', 'Guitar', true), item('pdf', 'original.pdf')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/scores/children?page=2' });
      if (id === 'guitar') return json({ value: [item('composer', 'Composer', true)] });
      if (id === 'composer') return json({ value: [item('book', 'Book', true)] });
      return json({ value: [item('piece', 'piece.sotto.json')] });
    });
    const files = await new OneDriveClient({ token }, request as typeof fetch).scan(ref);
    expect(files.map(file => file.path).sort()).toEqual(['Guitar/Composer/Book/piece.sotto.json', 'second.sotto']);
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls.every(([url]) => String(url).includes('/children'))).toBe(true);
    expect(token).toHaveBeenCalledWith(ref.accountId);
  });
  it('downloads only an opened score and never sends the bearer token to its download host', async () => {
    const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (String(url).startsWith('https://graph.microsoft.com/')) return json({ ...item('piece', 'piece.sotto'), '@microsoft.graph.downloadUrl': 'https://download.example/temporary-secret' });
      expect(options?.headers).toBeUndefined(); expect(options?.credentials).toBe('omit'); expect(options?.cache).toBe('no-store');
      return new Response('score bytes');
    });
    const result = await new OneDriveClient({ token: async () => 'private-token' }, request as typeof fetch).file(ref, 'piece');
    expect(result.name).toBe('piece.sotto'); expect(await result.text()).toBe('score bytes');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('keeps IDs, learned metadata, favorites and practice keys across renames/moves, and removes deleted files', () => {
    const first = connectOneDrive(emptyLibrary(), 'Scores', ref, [file('one', 'Old/piece.sotto'), file('deleted', 'gone.sotto')]);
    Object.assign(first.entries[0], { favorite: true, title: 'Learned title', composer: 'Composer', lastOpened: 123 });
    const next = connectOneDrive(first, 'Scores', ref, [file('one', 'New/renamed.sotto')]);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({ id: first.entries[0].id, title: 'Learned title', favorite: true, composer: 'Composer', path: 'New/renamed.sotto', lastOpened: 123 });
    expect(connectOneDrive(emptyLibrary(), 'Scores', ref, [file('one', 'New/renamed.sotto')]).entries[0].id).toBe(first.entries[0].id);
    expect(connectOneDrive(next, 'Scores', ref, []).entries).toEqual([]);
  });
  it('explicitly migrates local bookmarks by path while retaining IDs/settings keys and removing handles', () => {
    const local = { folders: [{ id: 'local-folder', name: 'Scores', handle: {} as never }], entries: [{ id: 'local-piece', folderId: 'local-folder', name: 'piece.sotto', path: 'Book/piece.sotto', title: 'My title', composer: 'Composer', favorite: true, handle: {} as never }] };
    const next = connectOneDrive(local, 'Scores', ref, [file('remote-item', 'Book/piece.sotto')], 'local-folder');
    expect(next.entries[0]).toMatchObject({ id: 'local-piece', title: 'My title', favorite: true, oneDrive: { itemId: 'remote-item' } });
    expect(next.entries[0].handle).toBeUndefined(); expect(next.folders[0].handle).toBeUndefined();
    expect(next.folders[0].id).toBe('local-folder');
    expect(() => connectOneDrive(local, 'Scores', ref, [], 'unknown')).toThrow();
  });
  it('backs up only portable references, with no tokens, expiring links or score bodies', () => {
    const library = connectOneDrive(emptyLibrary(), 'Scores', ref, [file('one', 'piece.sotto')]);
    Object.assign(library.folders[0].oneDrive!, { accessToken: 'secret-token' });
    Object.assign(library.entries[0].oneDrive!, { downloadUrl: 'secret-url' });
    const text = exportLibrary(library);
    expect(text).not.toMatch(/secret|accessToken|downloadUrl|pages/);
    const restored = parseLibrary(text);
    expect(restored.folders[0].oneDrive).toEqual(ref);
    expect(restored.entries[0].oneDrive).toEqual({ driveId: 'drive', itemId: 'one' });
  });
  it('rejects mismatched references and pagination that could leak a token', async () => {
    expect(() => graphUrl('https://other.example/steal')).toThrow();
    expect(() => graphUrl('https://user:pass@graph.microsoft.com/v1.0/me')).toThrow();
    expect(() => parseOneDriveFolder({ ...ref, itemId: '../evil' })).toThrow();
    const library = connectOneDrive(emptyLibrary(), 'Scores', ref, [file('one', 'piece.sotto')]);
    library.entries[0].oneDrive!.driveId = 'another-drive';
    expect(() => parseLibrary(exportLibrary(library))).toThrow();
    const request = vi.fn(async () => json({ value: [], '@odata.nextLink': 'https://other.example/steal' }));
    await expect(new OneDriveClient({ token: async () => 'secret' }, request).scan(ref)).rejects.toThrow('Invalid OneDrive API');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('fails incomplete scans instead of returning a partial listing for destructive refresh', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ value: [item('one', 'one.sotto')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/page2' })).mockResolvedValueOnce(json({}, 503));
    await expect(new OneDriveClient({ token: async () => 'token' }, request).scan(ref)).rejects.toThrow('current listing was kept');
  });
  it('binds the browser-native fetch receiver and supports cancelling metadata scans', async () => {
    vi.stubGlobal('fetch', function(this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(json({ value: [] }));
    });
    try { expect(await new OneDriveClient({ token: async () => 't' }).scan(ref)).toEqual([]); }
    finally { vi.unstubAllGlobals(); }
    const request = vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const abort = new AbortController();
    const pending = new OneDriveClient({ token: async () => 't' }, request as typeof fetch).scan(ref, abort.signal);
    await vi.waitFor(() => expect(request).toHaveBeenCalled()); abort.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('rejects looping pagination and excessive downloads', async () => {
    const address = 'https://graph.microsoft.com/v1.0/drives/drive/items/scores/children';
    const repeat = vi.fn(async () => json({ value: [], '@odata.nextLink': address }));
    await expect(new OneDriveClient({ token: async () => 't' }, repeat).scan(ref)).rejects.toThrow('pagination did not finish');
    const request = vi.fn().mockResolvedValueOnce(json({ ...item('one', 'one.sotto'), '@microsoft.graph.downloadUrl': 'https://download.example/file' })).mockResolvedValueOnce(new Response('x', { headers: { 'Content-Length': '15000001' } }));
    await expect(new OneDriveClient({ token: async () => 't' }, request).file(ref, 'one')).rejects.toThrow('too large');
  });
});
