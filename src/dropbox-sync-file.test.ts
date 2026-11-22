import { expect, it, vi } from 'vitest';
import { DropboxSyncFile, PRACTICE_SYNC_PATH, SyncConflict } from './dropbox-sync-file';
import { PracticeReplica } from './practice-sync';
const account = 'dbid:account';
function document() { const replica = new PracticeReplica(account, 'computer', undefined, () => 100); replica.capture({ 'id:piece': { favorite: true, practice: { bpm: 80 } } }); replica.merge({ format: 'sotto-practice-sync', version: 1, accountId: account, songs: {} }); return replica.document(); }
const access = { token: vi.fn(async () => 'read-token'), writeToken: vi.fn(async () => 'sync-write-token') };
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
it('reads and conditionally writes only the dedicated sync file, with no score upload or expiring URL', async () => {
  const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    expect(options?.method).toBe('POST'); expect(options?.credentials).toBe('omit'); expect(options?.cache).toBe('no-store');
    const headers = options!.headers as Record<string, string>, args = JSON.parse(headers['Dropbox-API-Arg']);
    expect(args.path).toBe(PRACTICE_SYNC_PATH);
    if (String(url).endsWith('/download')) { expect(headers.Authorization).toBe('Bearer read-token'); return json(document(), 200, { 'Dropbox-API-Result': '{"rev":"rev1"}' }); }
    expect(String(url)).toBe('https://content.dropboxapi.com/2/files/upload'); expect(headers.Authorization).toBe('Bearer sync-write-token');
    expect(args).toMatchObject({ mode: { '.tag': 'update', update: 'rev1' }, autorename: false, strict_conflict: true, mute: true });
    expect(JSON.parse(options!.body as string)).toEqual(document());
    return json({ rev: 'rev2' });
  });
  const file = new DropboxSyncFile(access, account, request as typeof fetch), first = await file.read();
  expect(first?.rev).toBe('rev1'); expect(await file.write(first!.document, first!.rev)).toBe('rev2'); expect(request).toHaveBeenCalledTimes(2);
});
it('distinguishes a missing sync file from permissions and other path errors before creating it', async () => {
  const request = vi.fn().mockResolvedValueOnce(json({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, 409))
    .mockResolvedValueOnce(json({ error: { '.tag': 'path', path: { '.tag': 'not_file' } } }, 409))
    .mockResolvedValueOnce(json({}, 403));
  const file = new DropboxSyncFile(access, account, request);
  expect(await file.read()).toBeNull(); await expect(file.read()).rejects.toThrow('failed (409)'); await expect(file.read()).rejects.toThrow('denied');
});
it('uses create-if-absent and revision comparisons, reporting write conflicts without overwriting', async () => {
  const request = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const args = JSON.parse((options!.headers as Record<string, string>)['Dropbox-API-Arg']);
    expect(args.mode).toEqual({ '.tag': 'add' }); expect(args.strict_conflict).toBe(true); expect(args.autorename).toBe(false);
    return json({}, 409);
  });
  await expect(new DropboxSyncFile(access, account, request as typeof fetch).write(document())).rejects.toBeInstanceOf(SyncConflict);
});
it('supports the equivalent App Folder path without accepting any caller-selected upload path', async () => {
  const request = vi.fn(async (_url: unknown, options?: RequestInit) => {
    expect(JSON.parse((options!.headers as Record<string, string>)['Dropbox-API-Arg']).path).toBe('/practice-settings-v1.json');
    return json({ rev: 'next' });
  });
  await new DropboxSyncFile(access, account, request as typeof fetch, true).write(document());
});
it('rejects corrupt or foreign-account cloud data and validates the upload before requesting write access', async () => {
  const request = vi.fn(async () => json({ ...document(), accountId: 'dbid:other' }, 200, { 'Dropbox-API-Result': '{"rev":"old"}' }));
  const file = new DropboxSyncFile(access, account, request as typeof fetch);
  await expect(file.read()).rejects.toThrow('another account');
  const writes = access.writeToken.mock.calls.length;
  expect(() => file.write({ ...document(), accountId: 'dbid:other' })).toThrow(); expect(access.writeToken.mock.calls.length).toBe(writes);
});
