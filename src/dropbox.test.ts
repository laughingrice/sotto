import { describe, expect, it, vi } from 'vitest';
import { DropboxClient, connectDropbox, dropboxRequest, parseDropboxRef } from './dropbox';
import { emptyLibrary, exportLibrary, parseLibrary } from './library';
import type { CloudFile } from './onedrive';
const ref = { accountId: 'dbid:account', itemId: 'id:scores' };
const raw = (id: string, path: string, folder = false) => ({ id: `id:${id}`, name: path.split('/').at(-1), path_display: path, '.tag': folder ? 'folder' : 'file', size: 100 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const file = (id: string, path: string): CloudFile => ({ id: `id:${id}`, name: path.split('/').at(-1)!, path, kind: 'file' });
const access = { token: async () => 'test-token' };
describe('Dropbox library', () => {
  it('scans arbitrary nested folders with metadata-only pagination and fixed authenticated endpoints', async () => {
    const request = vi.fn(async (address: string | URL | Request, options?: RequestInit) => {
      expect(String(address)).toMatch(/^https:\/\/api.dropboxapi.com\/2\/files\//);
      expect(options?.method).toBe('POST'); expect(options?.cache).toBe('no-store'); expect(options?.credentials).toBe('omit');
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
      const args = JSON.parse(options?.body as string);
      if (String(address).endsWith('get_metadata')) { expect(args.path).toBe(ref.itemId); return json(raw('scores', '/Scores', true)); }
      if (String(address).endsWith('list_folder')) {
        expect(args.recursive).toBe(true); expect(args.include_deleted).toBe(false);
        return json({ entries: [raw('guitar', '/Scores/Guitar', true), raw('one', '/Scores/Guitar/Composer/Book/piece.sotto'), raw('pdf', '/Scores/original.pdf')], cursor: 'opaque-cursor', has_more: true });
      }
      expect(args).toEqual({ cursor: 'opaque-cursor' });
      return json({ entries: [raw('two', '/Scores/Bass/second.sotto.json'), raw('hidden', '/Scores/.hidden/hidden.sotto')], has_more: false });
    });
    const files = await new DropboxClient(access, request as typeof fetch).scan(ref);
    expect(files.map(item => item.path)).toEqual(['Guitar/Composer/Book/piece.sotto', 'Bass/second.sotto.json']);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('browses root and downloads only the selected stable file ID with uncached content', async () => {
    const request = vi.fn(async (address: string | URL | Request, options?: RequestInit) => {
      if (String(address).includes('content.dropboxapi.com')) {
        expect(options?.body).toBeUndefined(); expect((options?.headers as any)['Dropbox-API-Arg']).toBe('{"path":"id:one"}');
        return new Response('music bytes', { headers: { 'Dropbox-API-Result': JSON.stringify(raw('one', '/Scores/renamed.sotto')) } });
      }
      expect(JSON.parse(options?.body as string).path).toBe('');
      return json({ entries: [raw('scores', '/Scores', true)], has_more: false });
    });
    const client = new DropboxClient(access, request as typeof fetch);
    expect((await client.children({ ...ref, itemId: '' }))[0].kind).toBe('folder');
    const result = await client.file(ref, 'id:one');
    expect(result.name).toBe('renamed.sotto'); expect(await result.text()).toBe('music bytes'); expect(request).toHaveBeenCalledTimes(2);
  });
  it('preserves identity and learned metadata after moves/renames and removes absent files only from the index', () => {
    const first = connectDropbox(emptyLibrary(), 'Scores', ref, [file('one', 'old.sotto'), file('two', 'gone.sotto')]);
    Object.assign(first.entries[0], { title: 'Learned title', composer: 'Composer', favorite: true, lastOpened: 42 });
    const next = connectDropbox(first, 'Scores', ref, [file('one', 'Book/new.sotto')]);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({ id: first.entries[0].id, path: 'Book/new.sotto', title: 'Learned title', composer: 'Composer', favorite: true, lastOpened: 42 });
    expect(connectDropbox(next, 'Scores', ref, []).entries).toEqual([]);
  });
  it('migrates matching local paths without losing practice keys and exports only whitelisted cloud references', () => {
    const local = { folders: [{ id: 'local', name: 'Scores', handle: {} as never }], entries: [{ id: 'local-piece', folderId: 'local', name: 'one.sotto', path: 'Book/one.sotto', title: 'Title', composer: '', favorite: true, handle: {} as never }] };
    const next = connectDropbox(local, 'Scores', ref, [file('one', 'Book/one.sotto')], 'local');
    expect(next.entries[0].id).toBe('local-piece'); expect(next.entries[0].handle).toBeUndefined(); expect(next.folders[0].handle).toBeUndefined();
    Object.assign(next.folders[0].dropbox!, { accessToken: 'private-token' }); Object.assign(next.entries[0].dropbox!, { refreshToken: 'private-token' });
    const text = exportLibrary(next);
    expect(text).not.toMatch(/private-token|accessToken|refreshToken|pages/);
    expect(parseLibrary(text).folders[0].dropbox).toEqual(ref);
    expect(() => connectDropbox(next, 'Other', { ...ref, itemId: 'id:other' }, [], 'local')).toThrow('unconnected local');
    next.entries[0].dropbox!.accountId = 'dbid:someoneElse';
    expect(() => parseLibrary(exportLibrary(next))).toThrow('Dropbox score');
  });
  it('fails partial, looping and cancelled scans instead of exposing an incomplete replacement listing', async () => {
    const metadata = () => json(raw('scores', '/Scores', true));
    const partial = vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(json({ entries: [raw('one', '/Scores/one.sotto')], cursor: 'next', has_more: true })).mockResolvedValueOnce(json({}, 503));
    await expect(new DropboxClient(access, partial).scan(ref)).rejects.toThrow('bookmarks were kept');
    const loop = vi.fn().mockResolvedValueOnce(metadata()).mockImplementation(async () => json({ entries: [], cursor: 'same', has_more: true }));
    await expect(new DropboxClient(access, loop).scan(ref)).rejects.toThrow('pagination');
    const abort = new AbortController();
    const request = vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const promise = new DropboxClient(access, request as typeof fetch).scan(ref, abort.signal);
    await vi.waitFor(() => expect(request).toHaveBeenCalled()); abort.abort(); await expect(promise).rejects.toThrow('cancelled');
  });
  it('rejects malformed bookmarks, unexpected metadata/downloads and any non-read API route', async () => {
    expect(() => parseDropboxRef({ ...ref, itemId: '../bad' })).toThrow();
    const request = vi.fn(async () => json({}));
    await expect(dropboxRequest('files/delete_v2', 'token', {}, undefined, request)).rejects.toThrow('Unsupported'); expect(request).not.toHaveBeenCalled();
    const oversized = vi.fn(async () => new Response('x', { headers: { 'Dropbox-API-Result': JSON.stringify(raw('one', '/Scores/one.sotto')), 'Content-Length': '15000001' } }));
    await expect(new DropboxClient(access, oversized).file(ref, 'id:one')).rejects.toThrow('size limit');
    const wrong = vi.fn(async () => new Response('x', { headers: { 'Dropbox-API-Result': JSON.stringify(raw('other', '/Scores/one.sotto')) } }));
    await expect(new DropboxClient(access, wrong).file(ref, 'id:one')).rejects.toThrow('requested');
    const moved = vi.fn().mockResolvedValueOnce(json(raw('scores', '/Scores', true))).mockResolvedValueOnce(json({ entries: [raw('one', '/Other/one.sotto')], has_more: false }));
    await expect(new DropboxClient(access, moved).scan(ref)).rejects.toThrow('moved during');
  });
});
