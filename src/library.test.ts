import { describe, expect, it, vi } from 'vitest';
import { connectFolder, emptyLibrary, exportLibrary, parseLibrary, scanDirectory, directoryTree, readEntry, type DirectoryHandle, type Library } from './library';

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

it('enumerates arbitrarily nested score paths without touching score files', async () => {
  const getFile = vi.fn(async () => { throw new Error('A scan must not open a file'); });
  const leaf = { name: 'piece.sotto.json', kind: 'file', getFile };
  const directory = (name: string, children: unknown[]) => ({ kind: 'directory', name, async *values() { yield* children; } });
  const root = directory('Scores', [directory('Violin', [directory('Vivaldi', [directory('Book 1', [directory('Spring', [directory('Movements', [leaf])])])])])]) as unknown as DirectoryHandle;
  const paths = await scanDirectory(root);
  expect(paths).toEqual(['Violin/Vivaldi/Book 1/Spring/Movements/piece.sotto.json']);
  expect(getFile).not.toHaveBeenCalled();
  const library = connectFolder(emptyLibrary(), { id: 'f', name: 'Scores', handle: root }, paths);
  const tree = directoryTree(library.entries, library.folders);
  let node = tree.directories[0];
  for (const name of ['Scores', 'Violin', 'Vivaldi', 'Book 1', 'Spring', 'Movements']) {
    expect(node.name).toBe(name); expect(node.count).toBe(1);
    if (node.children.length) node = node.children[0];
  }
  expect(node.entries[0].title).toBe('piece');
  expect(node.entries[0].composer).toBe('');
  expect(tree.loose).toEqual([]);
});
it('preserves learned metadata and favorites when refreshing filenames', () => {
  const folder = { id: 'f', name: 'Scores' };
  const first = connectFolder(emptyLibrary(), folder, ['Violin/Vivaldi/spring.sotto.json']);
  Object.assign(first.entries[0], { title: 'Spring for two violins', composer: 'Vivaldi', favorite: true, lastOpened: 123 });
  const refreshed = connectFolder(first, folder, ['Violin/Vivaldi/spring.sotto.json', 'Guitar/Tarrega/marieta.sotto.json']);
  expect(refreshed.entries[0]).toEqual(first.entries[0]);
  expect(refreshed.entries[1]).toMatchObject({ title: 'marieta', composer: '' });
  const backup = parseLibrary(exportLibrary(refreshed));
  expect(backup.entries[0].path).toBe('Violin/Vivaldi/spring.sotto.json');
  expect(directoryTree(backup.entries, backup.folders).directories[0].count).toBe(2);
});
it('opens the selected nested file through its full relative path', async () => {
  const file = new File(['score'], 'piece.sotto.json');
  const getFile = vi.fn(async () => file);
  const getDirectoryHandle = vi.fn(async (_name: string) => handle);
  const handle = { queryPermission: async () => 'granted', getDirectoryHandle,
    getFileHandle: async () => ({ getFile }) } as unknown as DirectoryHandle;
  const library = connectFolder(emptyLibrary(), { id: 'f', name: 'Scores', handle }, ['Violin/Vivaldi/Book/Pieces/piece.sotto.json']);
  expect(await readEntry(library.entries[0], library)).toBe(file);
  expect(getDirectoryHandle.mock.calls.map(call => call[0])).toEqual(['Violin', 'Vivaldi', 'Book', 'Pieces']);
  expect(getFile).toHaveBeenCalledOnce();
});
