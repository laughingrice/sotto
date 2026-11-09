import { describe, expect, it } from 'vitest';
import { connectFolder, emptyLibrary, exportLibrary, parseLibrary, type Library } from './library';

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
