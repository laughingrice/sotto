import { describe, expect, it, vi } from 'vitest';
import { connectFolder, emptyLibrary, exportLibrary, parseLibrary, readScoreMetadata, folderMetadata, type DirectoryHandle, type Library } from './library';

describe('portable reference library', () => {
  it('exports metadata and favorites without score contents or access handles', () => {
    const library: Library = {
      folders: [{ id: 'folder', name: 'OneDrive Scores', handle: { kind: 'directory' } as never }],
      entries: [{ id: 'score', name: 'piece.sotto.json', title: 'Piece', composer: 'Composer',
        folderId: 'folder', path: 'Guitar/piece.sotto.json', favorite: true, lastOpened: 100,
        handle: { kind: 'file' } as never }],
    };
    const text = exportLibrary(library);
    expect(text).not.toContain('handle');
    expect(text).not.toContain('pages');
    const restored = parseLibrary(text);
    expect(restored.entries[0].favorite).toBe(true);
    expect(restored.entries[0].path).toBe('Guitar/piece.sotto.json');
    expect(restored.folders[0].handle).toBeUndefined();
  });
  it('refreshes folders by relative path without losing favorites or duplicating entries', () => {
    const folder = { id: 'scores', name: 'Scores' };
    const first = connectFolder(emptyLibrary(), folder, ['piece.sotto.json']);
    first.entries[0].favorite = true;
    const refreshed = connectFolder(first, folder, ['piece.sotto.json', 'Other/new.sotto.json']);
    expect(refreshed.entries).toHaveLength(2);
    expect(refreshed.entries[0].favorite).toBe(true);
    expect(refreshed.folders).toHaveLength(1);
  });
  it('rejects traversal paths and non-library files, and discards injected handles', () => {
    const value = { format: 'sotto-library', version: 1, folders: [{ id: 'f', name: 'Scores' }], entries: [
      { id: 's', name: 'piece.sotto.json', title: 'Piece', composer: '', favorite: false, folderId: 'f', path: '../piece.sotto.json' },
    ] };
    expect(() => parseLibrary(JSON.stringify(value))).toThrow();
    value.entries[0].path = 'piece.sotto.json';
    expect(parseLibrary(JSON.stringify(value)).entries).toHaveLength(1);
    expect(() => parseLibrary('{"format":"sotto-score"}')).toThrow();
  });
});

it('loads titles and composers when connecting a folder, while preserving bookmarks and favorites', async () => {
  const folder = { id: 'f', name: 'Scores' };
  const file = new File([JSON.stringify({ format: 'sotto-score', version: 1, title: 'Spring for two violins', composer: 'Vivaldi', pages: ['large score'] })], 'spring.sotto.json', { lastModified: 100 });
  const metadata = await readScoreMetadata(file);
  expect(metadata).toEqual({ title: 'Spring for two violins', composer: 'Vivaldi', fileSize: file.size, modified: 100 });
  const first = connectFolder(emptyLibrary(), folder, [file.name]); first.entries[0].favorite = true;
  const refreshed = connectFolder(first, folder, [file.name], { [file.name]: metadata! });
  expect(refreshed.entries[0]).toMatchObject({ id: first.entries[0].id, favorite: true, title: 'Spring for two violins', composer: 'Vivaldi' });
  expect(JSON.stringify(refreshed)).not.toContain('large score');
  const text = vi.spyOn(file, 'text');
  const handle = { getFileHandle: async () => ({ getFile: async () => file }) } as unknown as DirectoryHandle;
  expect(await folderMetadata(handle, [file.name], refreshed, folder.id)).toEqual({});
  expect(text).not.toHaveBeenCalled();
  expect(await readScoreMetadata(new File(['invalid JSON'], 'invalid.sotto.json'))).toBeNull();
});
