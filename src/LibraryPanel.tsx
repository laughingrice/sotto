import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FolderOpen, Star, Trash2, X } from 'lucide-react';
import { lastScore, rememberScore } from './preferences';
import { validateScore } from './score';
import { connectFolder, emptyLibrary, exportLibrary, filePickers, loadLastScore, loadLibrary, parseLibrary, readEntry, saveLibrary, scanDirectory,
  type Library, type LibraryEntry, type LibraryFolder, type ReadHandle } from './library';

export type LibraryControl = { chooseFile(): void; restoreLastScore(isCurrent?: () => boolean): Promise<boolean>; reconnectLastScore(): void };
export const LibraryPanel = forwardRef<LibraryControl, { visible: boolean; onClose(): void; onOpen(value: unknown, key: string): void; onResumeNeeded(title: string): void; onError(message: string): void }>(
function LibraryPanel({ visible, onClose, onOpen, onResumeNeeded, onError }, ref) {
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const current = useRef(library);
  const ready = useRef<Promise<void>>(Promise.resolve());
  const writes = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const indexInput = useRef<HTMLInputElement>(null);
  const reconnectEntry = useRef<string | undefined>(undefined);
  const reconnectFolder = useRef<string | undefined>(undefined);
  // Files selected through Safari's picker last only for this page session.
  const sessionFiles = useRef(new Map<string, File>());

  useEffect(() => {
    ready.current = loadLibrary().then(value => { current.current = value; setLibrary(value); })
      .catch(() => { setMessage('Browser storage is unavailable. Files still open, but bookmarks cannot be remembered here.'); });
  }, []);
  function commit(update: (library: Library) => Library) {
    const write = writes.current.catch(() => {}).then(async () => {
      await ready.current;
      const next = update(current.current);
      await saveLibrary(next);
      current.current = next; setLibrary(next);
    });
    writes.current = write;
    return write;
  }
  function report(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const text = error instanceof Error ? error.message : 'The file could not be opened.';
    setMessage(text); onError(text);
  }
  async function accept(file: File, handle?: ReadHandle, entryId?: string, isCurrent = () => true) {
    await ready.current;
    const expected = current.current.entries.find(entry => entry.id === entryId);
    if (expected && expected.name !== file.name) throw new Error(`Please select ${expected.name} to reconnect this bookmark. Use Add score for another piece.`);
    if (file.size > 15_000_000) throw new Error('Please use a score bundle smaller than 15 MB.');
    const score: unknown = JSON.parse(await file.text());
    validateScore(score);
    let existing = current.current.entries.find(entry => entry.id === entryId);
    if (!existing && handle) {
      for (const entry of current.current.entries) {
        if (entry.handle && await handle.isSameEntry(entry.handle)) { existing = entry; break; }
      }
    }
    if (!existing && !handle) existing = current.current.entries.find(entry => !entry.folderId && !entry.handle && entry.name === file.name);
    const entry: LibraryEntry = { ...(existing ?? { id: crypto.randomUUID(), favorite: false }),
      name: file.name, title: score.title, composer: score.composer, lastOpened: Date.now(),
      ...(handle ? { handle } : {}),
    };
    if (!isCurrent()) return false;
    onOpen(score, `library:${entry.id}`);
    sessionFiles.current.set(entry.id, file);
    try { await commit(library => ({ ...library, entries: [...library.entries.filter(item => item.id !== entry.id),
      { ...entry, favorite: library.entries.find(item => item.id === entry.id)?.favorite ?? entry.favorite }] })); }
    catch { setMessage('Score opened, but the bookmark could not be saved. Export your library index before closing.');
      current.current = { ...current.current, entries: [...current.current.entries.filter(item => item.id !== entry.id), entry] }; setLibrary(current.current); }
    onClose(); return true;
  }
  async function chooseFile(entryId?: string) {
    reconnectEntry.current = entryId;
    if (!filePickers.showOpenFilePicker) { input.current?.click(); return; }
    setBusy(true); setMessage('');
    try {
      const [handle] = await filePickers.showOpenFilePicker({ multiple: false, types: [{ description: 'Sotto score', accept: { 'application/json': ['.json'] } }] });
      if (handle) await accept(await handle.getFile(), handle, entryId);
    } catch (error) { report(error); }
    finally { setBusy(false); reconnectEntry.current = undefined; }
  }
  async function restoreLastScore(isCurrent = () => true) {
    await ready.current;
    const saved = lastScore();
    const entry = saved?.startsWith('library:') ? current.current.entries.find(item => item.id === saved.slice(8)) :
      saved ? undefined : [...current.current.entries].filter(item => item.lastOpened).sort((a, b) => b.lastOpened! - a.lastOpened!)[0];
    if (entry) {
      if (!saved) rememberScore(`library:${entry.id}`);
      try {
        const file = await readEntry(entry, current.current, false);
        if (file) return await accept(file, entry.handle, entry.id, isCurrent);
      } catch { /* Fall back to the one cached song when the source is unavailable. */ }
    }
    try {
      const cached = await loadLastScore();
      if (isCurrent() && cached && (!saved || cached.key === saved)) { validateScore(cached.score); onOpen(cached.score, cached.key); return true; }
    } catch { /* Storage can be unavailable or contain an incompatible score. */ }
    if (isCurrent() && entry) onResumeNeeded(entry.title);
    return false;
  }
  useImperativeHandle(ref, () => ({ chooseFile: () => { void chooseFile(); }, restoreLastScore,
    reconnectLastScore: () => {
      const saved = lastScore();
      const entry = current.current.entries.find(item => `library:${item.id}` === saved);
      if (!entry) return;
      if (entry.handle || current.current.folders.find(folder => folder.id === entry.folderId)?.handle) void openEntry(entry);
      else void chooseFile(entry.id);
    },
  }));
  async function openEntry(entry: LibraryEntry) {
    if (!entry.handle && !current.current.folders.find(folder => folder.id === entry.folderId)?.handle) {
      const file = sessionFiles.current.get(entry.id);
      if (file) { try { await accept(file, undefined, entry.id); } catch (error) { report(error); } return; }
      if (entry.folderId) { setMessage('Reconnect this score’s folder below, then open the score again.'); return; }
      void chooseFile(entry.id); return;
    }
    setBusy(true); setMessage('');
    try {
      const file = await readEntry(entry, current.current);
      if (!file) throw new Error('Reconnect this file or its folder.');
      await accept(file, entry.handle, entry.id);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function chooseFolder(id?: string) {
    reconnectFolder.current = id;
    if (!filePickers.showDirectoryPicker) { folderInput.current?.click(); return; }
    setBusy(true); setMessage('');
    try {
      const handle = await filePickers.showDirectoryPicker({ mode: 'read' });
      await ready.current;
      const folder = { id: id ?? crypto.randomUUID(), name: handle.name, handle };
      const paths = await scanDirectory(handle);
      await commit(library => connectFolder(library, folder, paths));
    } catch (error) { report(error); }
    finally { setBusy(false); reconnectFolder.current = undefined; }
  }
  async function refreshFolder(folder: LibraryFolder, request = true) {
    if (!folder.handle) { if (request) void chooseFolder(folder.id); return; }
    setBusy(true); if (request) setMessage('');
    try {
      if (await folder.handle.queryPermission({ mode: 'read' }) !== 'granted') {
        if (!request) return;
        if (await folder.handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('Folder access needs permission. Use Reconnect to choose the folder again.');
      }
      const paths = await scanDirectory(folder.handle);
      await commit(library => {
        const connected = library.folders.find(item => item.id === folder.id);
        // A completed scan must not resurrect a removed or reconnected folder.
        return connected && connected.handle === folder.handle ? connectFolder(library, connected, paths) : library;
      });
      if (request) setMessage(`Refreshed ${folder.name}.`);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  // Quietly discover added files when the panel opens, provided permission is
  // already granted. Only an explicit click may request permission or a picker.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void ready.current.then(async () => {
      for (const folder of current.current.folders) {
        if (cancelled) break;
        if (folder.handle) await refreshFolder(folder, false);
      }
    });
    return () => { cancelled = true; };
  }, [visible]);
  const entries = library.entries.filter(entry => (!favoritesOnly || entry.favorite) &&
    `${entry.title} ${entry.composer} ${entry.path ?? entry.name}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastOpened ?? 0) - (a.lastOpened ?? 0) || a.title.localeCompare(b.title));
  async function change(update: (library: Library) => Library) { try { await commit(update); } catch (error) { report(error); } }
  return <>
    <input ref={input} data-score-input aria-label="Open score file" type="file" accept=".json,.sotto.json" className="visually-hidden" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) { setBusy(true); void accept(file, undefined, reconnectEntry.current).catch(report).finally(() => { setBusy(false); reconnectEntry.current = undefined; }); }
    }}/>
    {visible && <div className="modal-backdrop" onClick={onClose}><section className="help-modal library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title" onClick={event => event.stopPropagation()}>
      <button className="icon-button modal-close" aria-label="Close library" onClick={onClose} autoFocus><X size={20}/></button>
      <div className="eyebrow">YOUR MUSIC</div><h2 id="library-title">Score library</h2>
      <p className="settings-note">Keep your scores in a folder of your choice, including a synced OneDrive folder. The library stores bookmarks and favorites. Only the last opened song is cached for resuming; opening another replaces that copy.</p>
      {!filePickers.showDirectoryPicker && <p className="settings-note">Your last song can reopen from its cached copy. Other scores may require you to reselect files or reconnect a folder after reopening Sotto. On iPad, choose a score through Files → OneDrive. Chrome/Edge on desktop can remember file and folder access. A picker may call the selection “Upload”; Sotto reads it locally and does not send it anywhere.</p>}
      <div className="library-actions"><button className="quiet-button" disabled={busy} onClick={() => void chooseFile()}><FolderOpen size={16}/> Add score</button><button className="quiet-button" disabled={busy} onClick={() => void chooseFolder()}>Connect folder</button>
        <button className="quiet-button" disabled={busy} onClick={() => {
          const href = URL.createObjectURL(new Blob([exportLibrary(current.current)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = href; link.download = 'sotto-library.json'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
        }}>Export index</button><button className="quiet-button" disabled={busy} onClick={() => indexInput.current?.click()}>Import index</button></div>
      <p className="settings-note">Export the small index to OneDrive to back up favorites. Import it on another device, then reconnect the folders there.</p>
      {message && <p className="library-message" role="status">{message}</p>}
      {busy && <p role="status">Reading files…</p>}
      <div className="library-filters"><input aria-label="Search library" placeholder="Find a score…" value={search} onChange={event => setSearch(event.target.value)}/><label className="checkbox-row"><input type="checkbox" checked={favoritesOnly} onChange={event => setFavoritesOnly(event.target.checked)}/>Favorites</label></div>
      <div className="library-list">{entries.map(entry => <div className="library-entry" key={entry.id}>
        <button className="library-open" disabled={busy} onClick={() => void openEntry(entry)}><strong>{entry.title}</strong><span>{entry.composer}</span><small>{library.folders.find(folder => folder.id === entry.folderId)?.name}{entry.folderId ? '/' : ''}{entry.path ?? entry.name}</small></button>
        <button className={`icon-button favorite-button ${entry.favorite ? 'selected' : ''}`} disabled={busy} aria-label={`Favorite ${entry.title}`} aria-pressed={entry.favorite} onClick={() => void change(library => ({ ...library, entries: library.entries.map(item => item.id === entry.id ? { ...item, favorite: !item.favorite } : item) }))}><Star size={17} fill={entry.favorite ? 'currentColor' : 'none'}/></button>
        <button className="icon-button" disabled={busy} aria-label={`Remove ${entry.title} bookmark`} onClick={() => void change(library => ({ ...library, entries: library.entries.filter(item => item.id !== entry.id) }))}><Trash2 size={16}/></button>
      </div>)}{!entries.length && <p className="settings-note">{library.entries.length ? 'No matching scores.' : 'Add a score or connect a folder containing .sotto.json files.'}</p>}</div>
      {!!library.folders.length && <h3>Folders</h3>}
      {library.folders.map(folder => <div className="library-folder" key={folder.id}><span><FolderOpen size={16}/> {folder.name}</span>{folder.handle && <button className="text-button" disabled={busy} onClick={() => void refreshFolder(folder)}>Refresh</button>}<button className="text-button" disabled={busy} onClick={() => void chooseFolder(folder.id)}>Reconnect</button><button className="icon-button" disabled={busy} aria-label={`Remove ${folder.name} folder bookmark`} onClick={() => void change(library => ({ entries: library.entries.filter(entry => entry.folderId !== folder.id), folders: library.folders.filter(item => item.id !== folder.id) }))}><Trash2 size={16}/></button></div>)}
      <p className="settings-note">Removing a bookmark leaves the original file untouched. Reconnecting uses the selected folder’s relative paths. File access may need permission again; bookmarks do not sync automatically.</p>
      <input ref={folderInput} type="file" className="visually-hidden" aria-label="Connect score folder" {...{ webkitdirectory: '', directory: '' }} multiple onChange={event => {
        const files = Array.from(event.target.files ?? []).filter(file => file.name.endsWith('.sotto.json')); event.target.value = '';
        if (!files.length) { setMessage('No .sotto.json files were selected.'); return; }
        setBusy(true);
        void (async () => {
          await ready.current;
          const folder = { id: reconnectFolder.current ?? crypto.randomUUID(), name: files[0].webkitRelativePath.split('/')[0] || 'Scores' };
          const paths = files.map(file => file.webkitRelativePath.split('/').slice(1).join('/') || file.name);
          await commit(library => {
            const next = connectFolder(library, folder, paths);
            files.forEach((file, i) => { const entry = next.entries.find(entry => entry.folderId === folder.id && entry.path === paths[i])!; sessionFiles.current.set(entry.id, file); });
            return next;
          });
        })().catch(report).finally(() => { setBusy(false); reconnectFolder.current = undefined; });
      }}/>
      <input ref={indexInput} type="file" accept=".json" className="visually-hidden" aria-label="Import library index" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setBusy(true);
        void (async () => {
          if (file.size > 5_000_000) throw new Error('Please select a library index smaller than 5 MB.');
          const imported = parseLibrary(await file.text()); await ready.current;
          // Merge metadata; retain this device's handles for matching IDs.
          const merge = <T extends { id: string }>(old: T[], added: T[]) => [...old.filter(item => !added.some(next => next.id === item.id)), ...added.map(item => ({ ...old.find(previous => previous.id === item.id), ...item }))];
          await commit(library => ({ entries: merge(library.entries, imported.entries), folders: merge(library.folders, imported.folders) }));
          setMessage('Index imported. Reconnect its folders on this device to open the scores.');
        })().catch(report).finally(() => setBusy(false));
      }}/>
    </section></div>}
  </>;
});
