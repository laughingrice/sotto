import DropboxPanel from './DropboxPanel';
import { dropboxClient } from './dropbox-auth';
import { connectDropbox } from './dropbox';
import { useDropboxSync } from './useDropboxSync';
import OneDrivePanel from './OneDrivePanel';
import { oneDriveClient } from './onedrive-auth';
import { connectOneDrive } from './onedrive';
import { isScoreFile, readScoreFile, fileAccessError } from './score-file';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, FolderOpen, Globe, Star, Trash2, X } from 'lucide-react';
import { connectCatalog, fetchCatalog, fetchOnlineBytes, onlineUrl, SAMPLE_CATALOG } from './catalog';
import { lastScore, rememberScore, exportPreferences, importPreferences, parsePreferences } from './preferences';
import { validateScore, type Score } from './score';
import { connectFolder, emptyLibrary, exportLibrary, filePickers, directoryTree, loadLastScore, loadLibrary, parseLibrary, readEntry, saveLibrary, scanDirectory,
  type Library, type LibraryDirectory, type LibraryEntry, type LibraryFolder, type ReadHandle } from './library';

export type LibraryControl = { chooseFile(): void; restoreLastScore(isCurrent?: () => boolean): Promise<boolean>; reconnectLastScore(): void };
export const LibraryPanel = forwardRef<LibraryControl, { visible: boolean; onClose(): void; onOpen(value: unknown, key: string): void; onResumeNeeded(title: string): void; onBeforeBackup(): void; onSettingsImported(): void; onError(message: string): void;
  activeKey: string; practiceBusy: boolean; onPracticeSynced(keys: string[]): void }>(
function LibraryPanel({ visible, onClose, onOpen, onResumeNeeded, onBeforeBackup, onSettingsImported, onError, activeKey, practiceBusy, onPracticeSynced }, ref) {
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const current = useRef(library);
  const ready = useRef<Promise<void>>(Promise.resolve());
  const writes = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [search, setSearch] = useState('');
  const cloudScan = useRef<AbortController | null>(null);
  const latestOpen = useRef(0);
  const [cloudPrompt, setCloudPrompt] = useState(0);
  const [dropboxPrompt, setDropboxPrompt] = useState(0);
  const [catalogAddress, setCatalogAddress] = useState('');
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const indexInput = useRef<HTMLInputElement>(null);
  const reconnectEntry = useRef<string | undefined>(undefined);
  const reconnectFolder = useRef<string | undefined>(undefined);
  const syncNotify = useRef<(() => void) | null>(null);
  // Files selected through Safari's picker last only for this page session.
  const sessionFiles = useRef(new Map<string, File>());

  useEffect(() => {
    ready.current = loadLibrary().then(value => { current.current = value; setLibrary(value); })
      .catch(() => { setMessage('Browser storage is unavailable. Files still open, but bookmarks cannot be remembered here.'); });
  }, []);
  function commit(update: (library: Library) => Library, notify = true) {
    const write = writes.current.catch(() => {}).then(async () => {
      await ready.current;
      const next = update(current.current);
      await saveLibrary(next);
      current.current = next; setLibrary(next);
      if (notify) syncNotify.current?.();
      const retained = new Set(next.entries.map(entry => entry.id));
      for (const id of sessionFiles.current.keys()) if (!retained.has(id) || next.entries.find(entry => entry.id === id)?.oneDrive || next.entries.find(entry => entry.id === id)?.dropbox || next.entries.find(entry => entry.id === id)?.online) sessionFiles.current.delete(id);
    });
    writes.current = write;
    return write;
  }
  const settingsSync = useDropboxSync({ library: current, ready, commit, flush: onBeforeBackup, activeKey, practiceBusy, onPracticeSynced });
  syncNotify.current = settingsSync.libraryChanged;
  function report(error: unknown) {
    const text = error instanceof Error ? error.message : 'The file could not be opened.';
    setMessage(text); onError(text);
  }
  async function accept(file: File, handle?: ReadHandle, entryId?: string, isCurrent = () => true, allowRename = false, close = true) {
    await ready.current;
    const expected = current.current.entries.find(entry => entry.id === entryId);
    if (expected && expected.name !== file.name && !allowRename) throw new Error(`Please select ${expected.name} to reconnect this bookmark. Use Add score for another piece.`);
    let score: Score;
    try { score = await readScoreFile(file); }
    catch (error) {
      const access = fileAccessError(error, file.name);
      if (access && entryId) {
        sessionFiles.current.delete(entryId);
        setUnavailable(previous => ({ ...previous, [entryId]: access.message }));
      }
      throw access ?? error;
    }
    let existing = current.current.entries.find(entry => entry.id === entryId);
    if (!existing && handle) {
      for (const entry of current.current.entries) {
        if (entry.handle && await handle.isSameEntry(entry.handle)) { existing = entry; break; }
      }
    }
    if (!existing && !handle) existing = current.current.entries.find(entry => !entry.folderId && !entry.handle && entry.name === file.name);
    const entry: LibraryEntry = { ...(existing ?? { id: crypto.randomUUID(), favorite: false }),
      name: file.name, title: score.title, composer: score.composer, fileSize: file.size, modified: file.lastModified, lastOpened: Date.now(),
      ...(handle ? { handle } : {}),
    };
    if (!isCurrent()) return false;
    onOpen(score, `library:${entry.id}`);
    // Finish the navigation before the asynchronous bookmark write. A late
    // save must not close a library that the user has already reopened.
    if (close) onClose();
    if (!entry.oneDrive && !entry.dropbox && !entry.online) sessionFiles.current.set(entry.id, file);
    else sessionFiles.current.delete(entry.id);
    try { await commit(library => ({ ...library, entries: [...library.entries.filter(item => item.id !== entry.id),
      { ...entry, favorite: library.entries.find(item => item.id === entry.id)?.favorite ?? entry.favorite }] })); }
    catch { setMessage('Score opened, but the bookmark could not be saved. Export your library index before closing.');
      current.current = { ...current.current, entries: [...current.current.entries.filter(item => item.id !== entry.id), entry] }; setLibrary(current.current); }
    setUnavailable(previous => { const next = { ...previous }; delete next[entry.id]; return next; });
    return true;
  }
  async function chooseFile(entryId?: string) {
    const version = ++latestOpen.current;
    reconnectEntry.current = entryId;
    if (!filePickers.showOpenFilePicker) { input.current?.click(); return; }
    setBusy(true); setMessage('');
    let choosing = true;
    try {
      const [handle] = await filePickers.showOpenFilePicker({ multiple: false, types: [{ description: 'Sotto score', accept: { 'application/octet-stream': ['.sotto'], 'application/json': ['.json'] } }] });
      choosing = false;
      if (handle) await accept(await handle.getFile(), handle, entryId, () => latestOpen.current === version);
    } catch (error) { if (!(choosing && error instanceof DOMException && error.name === 'AbortError')) report(error); }
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
        if (entry.dropbox && navigator.onLine) {
          const folder = current.current.folders.find(folder => folder.id === entry.folderId);
          if (folder?.dropbox) return await accept(await dropboxClient.file(folder.dropbox, entry.dropbox.itemId), undefined, entry.id, isCurrent, true, false);
        }
        if (entry.oneDrive && navigator.onLine) {
          const folder = current.current.folders.find(folder => folder.id === entry.folderId);
          if (folder?.oneDrive) return await accept(await oneDriveClient.file(folder.oneDrive, entry.oneDrive.itemId), undefined, entry.id, isCurrent, true, false);
        }
        if (entry.online && navigator.onLine) {
          const text = await fetchOnlineBytes(entry.online.url, 15_000_000, undefined, 5000);
          return await accept(new File([text], entry.name, { type: 'application/json' }), undefined, entry.id, isCurrent, false, false);
        }
        const file = await readEntry(entry, current.current, false);
        if (file) return await accept(file, entry.handle, entry.id, isCurrent, false, false);
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
      if (entry.dropbox || entry.oneDrive || entry.online || entry.handle || current.current.folders.find(folder => folder.id === entry.folderId)?.handle) void openEntry(entry);
      else void chooseFile(entry.id);
    },
  }));
  async function openEntry(entry: LibraryEntry) {
    const version = ++latestOpen.current;
    const isCurrent = () => latestOpen.current === version;
    if (entry.oneDrive || entry.dropbox) {
      setBusy(true); setMessage('');
      try {
        const folder = current.current.folders.find(folder => folder.id === entry.folderId);
        const file = entry.dropbox && folder?.dropbox ? await dropboxClient.file(folder.dropbox, entry.dropbox.itemId) :
          entry.oneDrive && folder?.oneDrive ? await oneDriveClient.file(folder.oneDrive, entry.oneDrive.itemId) : null;
        if (!file) throw new Error('Reconnect this cloud folder.');
        await accept(file, undefined, entry.id, isCurrent, true);
      } catch (error) {
        if (!isCurrent()) return;
        const cached = await loadLastScore().catch(() => null);
        if (!navigator.onLine && cached?.key === `library:${entry.id}`) {
          try { validateScore(cached.score); onOpen(cached.score, cached.key); onClose(); } catch (invalid) { report(invalid); }
        } else { report(error); if (/sign.in|account|client id|app key|authorization/i.test(error instanceof Error ? error.message : '')) (entry.dropbox ? setDropboxPrompt : setCloudPrompt)(value => value + 1); }
      } finally { if (isCurrent()) setBusy(false); }
      return;
    }
    if (entry.online) {
      setBusy(true); setMessage('');
      try {
        const text = await fetchOnlineBytes(entry.online.url, 15_000_000);
        await accept(new File([text], entry.name, { type: 'application/json' }), undefined, entry.id, isCurrent);
      } catch (error) {
        if (!isCurrent()) return;
        const cached = await loadLastScore().catch(() => null);
        if (cached?.key === `library:${entry.id}`) {
          try { validateScore(cached.score); onOpen(cached.score, cached.key); onClose(); }
          catch (invalid) { report(invalid); }
        } else report(new Error(`This score could not be downloaded. Check your connection and the library host’s CORS permissions. Only the last opened song is available offline. ${error instanceof Error ? error.message : ''}`));
      } finally { if (isCurrent()) setBusy(false); }
      return;
    }
    if (!entry.handle && !current.current.folders.find(folder => folder.id === entry.folderId)?.handle) {
      const file = sessionFiles.current.get(entry.id);
      if (file) {
        setBusy(true); setMessage('');
        try { await accept(file, undefined, entry.id, isCurrent); } catch (error) { report(error); }
        finally { if (isCurrent()) setBusy(false); }
        return;
      }
      if (entry.folderId) {
        const text = 'This browser needs the folder to be reconnected before it can read this score.';
        setUnavailable(previous => ({ ...previous, [entry.id]: text })); report(new Error(text)); return;
      }
      void chooseFile(entry.id); return;
    }
    setBusy(true); setMessage('');
    try {
      const file = await readEntry(entry, current.current);
      if (!file) throw new Error('Reconnect this file or its folder.');
      await accept(file, entry.handle, entry.id, isCurrent);
    } catch (error) {
      const access = fileAccessError(error, entry.name);
      if (access) { sessionFiles.current.delete(entry.id); setUnavailable(previous => ({ ...previous, [entry.id]: access.message })); }
      report(access ?? error);
    }
    finally { if (isCurrent()) setBusy(false); }
  }
  function clearFolderErrors(id: string) {
    const ids = new Set(current.current.entries.filter(entry => entry.folderId === id).map(entry => entry.id));
    setUnavailable(previous => Object.fromEntries(Object.entries(previous).filter(([entryId]) => !ids.has(entryId))));
  }
  async function chooseFolder(id?: string) {
    reconnectFolder.current = id;
    if (!filePickers.showDirectoryPicker) { folderInput.current?.click(); return; }
    setBusy(true); setMessage('');
    let choosing = true;
    try {
      const handle = await filePickers.showDirectoryPicker({ mode: 'read' });
      choosing = false;
      await ready.current;
      const folder = { id: id ?? crypto.randomUUID(), name: handle.name, handle };
      const paths = await scanDirectory(handle);
      await commit(library => connectFolder(library, folder, paths));
      clearFolderErrors(folder.id);
    } catch (error) { if (!(choosing && error instanceof DOMException && error.name === 'AbortError')) report(error); }
    finally { setBusy(false); reconnectFolder.current = undefined; }
  }
  async function refreshFolder(folder: LibraryFolder, request = true) {
    if (folder.dropbox) {
      if (!request) return;
      setBusy(true); setMessage('');
      const controller = new AbortController(); cloudScan.current = controller;
      try {
        const ref = folder.dropbox;
        const files = await dropboxClient.scan(ref, controller.signal, (folders, count) => setMessage(`Listing ${folders} folders · ${count} scores…`));
        let removed = 0;
        await commit(library => {
          const connected = library.folders.find(item => item.id === folder.id);
          if (controller.signal.aborted || !connected?.dropbox || JSON.stringify(connected.dropbox) !== JSON.stringify(ref)) return library;
          const present = new Set(files.map(file => file.id));
          removed = library.entries.filter(entry => entry.folderId === folder.id && !present.has(entry.dropbox?.itemId ?? '')).length;
          return connectDropbox(library, folder.name, ref, files);
        });
        setMessage(controller.signal.aborted ? 'Dropbox refresh cancelled. Existing bookmarks kept.' : `Refreshed ${folder.name}.${removed ? ` Removed ${removed} missing score bookmarks.` : ''}`);
      } catch (error) {
        if (controller.signal.aborted) setMessage('Dropbox refresh cancelled. Existing bookmarks kept.');
        else { report(error); if (/sign.in|account|app key|authorization/i.test(error instanceof Error ? error.message : '')) setDropboxPrompt(value => value + 1); }
      } finally { if (cloudScan.current === controller) cloudScan.current = null; setBusy(false); }
      return;
    }
    if (folder.oneDrive) {
      if (!request) return; // Background panel opens must not download metadata or prompt sign-in.
      setBusy(true); setMessage('');
      try {
        const controller = new AbortController(); cloudScan.current = controller;
        const files = await oneDriveClient.scan(folder.oneDrive, controller.signal, (folders, count) => setMessage(`Listing ${folders} folders · ${count} scores…`)), ref = folder.oneDrive;
        let removed = 0;
        await commit(library => {
          const connected = library.folders.find(item => item.id === folder.id);
          if (controller.signal.aborted || !connected?.oneDrive || JSON.stringify(connected.oneDrive) !== JSON.stringify(ref)) return library;
          const present = new Set(files.map(file => file.id));
          removed = library.entries.filter(entry => entry.folderId === folder.id && !present.has(entry.oneDrive?.itemId ?? '')).length;
          return connectOneDrive(library, folder.name, ref, files);
        });
        setMessage(`Refreshed ${folder.name}.${removed ? ` Removed ${removed} missing score bookmarks.` : ''}`);
      } catch (error) {
        if (cloudScan.current?.signal.aborted) setMessage('OneDrive refresh cancelled. Existing bookmarks kept.');
        else { report(error); if (/sign.in|account|client id|app key|authorization/i.test(error instanceof Error ? error.message : '')) setCloudPrompt(value => value + 1); }
      }
      finally { cloudScan.current = null; setBusy(false); }
      return;
    }
    if (folder.catalogUrl) { if (request) await connectOnline(folder.catalogUrl); return; }
    if (!folder.handle) { if (request) void chooseFolder(folder.id); return; }
    setBusy(true); if (request) setMessage('');
    try {
      if (await folder.handle.queryPermission({ mode: 'read' }) !== 'granted') {
        if (!request) return;
        if (await folder.handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('Folder access needs permission. Use Reconnect to choose the folder again.');
      }
      const paths = await scanDirectory(folder.handle);
      let removed = 0;
      await commit(library => {
        const connected = library.folders.find(item => item.id === folder.id);
        // A completed scan must not resurrect a removed or reconnected folder.
        if (!connected || connected.handle !== folder.handle) return library;
        const next = connectFolder(library, connected, paths);
        // Count removed paths separately from newly discovered files.
        const present = new Set(paths);
        removed = library.entries.filter(entry => entry.folderId === folder.id && !present.has(entry.path ?? '')).length;
        return next;
      });
      if (request) setMessage(`Refreshed ${folder.name}.${removed ? ` Removed ${removed} missing score bookmark${removed === 1 ? '' : 's'}.` : ''}`);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  // Quietly reconcile added and removed files when the panel opens, provided permission is
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
    return () => { cancelled = true; cloudScan.current?.abort(); };
  }, [visible]);
  async function connectOnline(address: string) {
    setBusy(true); setMessage('');
    try {
      const url = onlineUrl(address, location.href), catalog = await fetchCatalog(url);
      await commit(library => connectCatalog(library, catalog, url));
      setMessage(`${catalog.title}: ${catalog.scores.length} scores. Music downloads only when opened.`);
      setCatalogAddress('');
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  const folderNames = new Map(library.folders.map(folder => [folder.id, folder.name]));
  const entries = library.entries.filter(entry => (!favoritesOnly || entry.favorite) &&
    `${entry.title} ${entry.composer} ${folderNames.get(entry.folderId ?? '') ?? ''} ${entry.path ?? entry.name}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastOpened ?? 0) - (a.lastOpened ?? 0) || a.title.localeCompare(b.title));
  const tree = directoryTree(entries, library.folders);
  const filtering = !!search.trim() || favoritesOnly;
  const renderEntry = (entry: LibraryEntry) => <div className="library-entry" key={entry.id}>
        <div className="library-entry-content"><button className="library-open" disabled={busy} onClick={() => void openEntry(entry)}><strong>{entry.title}</strong><span>{entry.composer}</span><small>{entry.online ? `${entry.online.instruments} · ${entry.online.license}` : `${folderNames.get(entry.folderId ?? '') ?? ''}${entry.folderId ? '/' : ''}${entry.path ?? entry.name}`}</small></button>
        {unavailable[entry.id] && <div className="library-access-warning"><span>{unavailable[entry.id]}</span><button className="text-button" disabled={busy} onClick={() => entry.folderId ? void chooseFolder(entry.folderId) : void chooseFile(entry.id)}>{entry.folderId ? 'Reconnect folder' : 'Reconnect file'}</button></div>}
        {entry.online && <details className="online-score-credits"><summary>Source &amp; credits</summary><p>{entry.online.description}</p><p>{entry.online.credit} · {entry.online.licenseUrl ? <a href={entry.online.licenseUrl} target="_blank" rel="noreferrer">{entry.online.license}</a> : entry.online.license}</p><div>{entry.online.source && <a href={entry.online.source} target="_blank" rel="noreferrer">Original edition</a>}{entry.online.sourceFile && <a href={entry.online.sourceFile} target="_blank" rel="noreferrer">LilyPond source</a>}</div></details>}</div>
        <button className={`icon-button favorite-button ${entry.favorite ? 'selected' : ''}`} disabled={busy} aria-label={`Favorite ${entry.title}`} aria-pressed={entry.favorite} onClick={() => void change(library => ({ ...library, entries: library.entries.map(item => item.id === entry.id ? { ...item, favorite: !item.favorite } : item) }))}><Star size={17} fill={entry.favorite ? 'currentColor' : 'none'}/></button>
        <button className="icon-button" disabled={busy} aria-label={`Remove ${entry.title} bookmark`} onClick={() => void change(library => ({ ...library, entries: library.entries.filter(item => item.id !== entry.id) }))}><Trash2 size={16}/></button>
      </div>;
  const renderDirectory = (directory: LibraryDirectory): ReactNode => {
    const expanded = filtering || (expandedDirectories[directory.id] ?? directory.depth === 0);
    return <details className="library-directory" key={directory.id} open={expanded}
    onToggle={event => {
      if (filtering) return;
      const open = event.currentTarget.open;
      setExpandedDirectories(previous => previous[directory.id] === open ? previous : { ...previous, [directory.id]: open });
    }}>
    <summary data-directory-path={directory.path} title={directory.path || directory.name}><ChevronRight size={14}/><FolderOpen size={16}/><span>{directory.name}</span><small>{directory.count}</small></summary>
    {expanded && <div className="library-directory-children">{directory.children.map(renderDirectory)}{directory.entries.map(renderEntry)}</div>}
  </details>;
  };
  async function change(update: (library: Library) => Library) { try { await commit(update); } catch (error) { report(error); } }
  return <>
    {/* iOS file providers may disable unknown extensions when accept is set.
        Let the user select a file, then validate its contents in readScoreFile. */}
    <input ref={input} data-score-input aria-label="Open score file" type="file" className="visually-hidden" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) { const version = ++latestOpen.current; setBusy(true); void accept(file, undefined, reconnectEntry.current, () => latestOpen.current === version).catch(report).finally(() => { setBusy(false); reconnectEntry.current = undefined; }); }
    }}/>
    {visible && <div className="modal-backdrop" onClick={onClose}><section className="help-modal library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title" onClick={event => event.stopPropagation()}>
      <button className="icon-button modal-close" aria-label="Close library" onClick={onClose} autoFocus><X size={20}/></button>
      <div className="eyebrow">YOUR MUSIC</div><h2 id="library-title">Score library</h2>
      <p className="settings-note">Browse folders at any depth. Scans list filenames; titles and composers are learned when you open a score.</p>
      <div className="sample-library-intro"><div><strong>Try the sample library</strong><p>Openly licensed guitar, piano and violin scores, ready to play.</p></div><button className="quiet-button" disabled={busy} onClick={() => void connectOnline(SAMPLE_CATALOG)}><Globe size={16}/>Sample scores</button></div>
      <div className="sample-library-intro"><div><strong>Notes &amp; tabs prototype</strong><p>Original four-bar guitar and bass exercises with linked display views.</p></div><button className="quiet-button" disabled={busy} onClick={() => void connectOnline(`${import.meta.env.BASE_URL}scores/prototypes/catalog.json`)}>Tab prototypes</button></div>
      <div className="library-actions"><button className="quiet-button" disabled={busy} onClick={() => void chooseFile()}><FolderOpen size={16}/> Add score</button><button className="quiet-button" disabled={busy} onClick={() => void chooseFolder()}>Connect folder</button>
        <button className="quiet-button" disabled={busy} onClick={() => {
          onBeforeBackup();
          const settings = exportPreferences(current.current.entries.map(entry => `library:${entry.id}`));
          const href = URL.createObjectURL(new Blob([exportLibrary(current.current, settings)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = href; link.download = 'sotto-library.json'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
        }}>Export backup</button><button className="quiet-button" disabled={busy} onClick={() => indexInput.current?.click()}>Import backup</button></div>
      <p className="settings-note">Backups include library references and practice settings, not sheet music.</p>
      {message && <p className="library-message" role="status">{message}</p>}
      {busy && <p role="status">Loading library…</p>}{busy && cloudScan.current && <button className="text-button" onClick={() => cloudScan.current?.abort()}>Cancel cloud refresh</button>}
      {!filePickers.showDirectoryPicker && <p className="settings-note">This browser provides temporary file selections. A page reload or cloud-provider change may require reconnecting the folder; desktop Chrome/Edge can remember supported directory handles.</p>}
      <details className="library-help"><summary>Connect an online library</summary><form className="online-library-form" onSubmit={event => { event.preventDefault(); void connectOnline(catalogAddress); }}><label>Catalog URL<input type="url" aria-label="Online library catalog URL" placeholder="https://example.org/scores/catalog.json" value={catalogAddress} onChange={event => setCatalogAddress(event.target.value)} required/></label><button className="quiet-button" type="submit" disabled={busy}>Connect online library</button></form><p className="settings-note">Use a public Sotto catalog.json served over HTTPS. Other hosts must allow cross-origin requests (CORS). A OneDrive sharing-page link is not a catalog URL.</p></details>
      {settingsSync.enabled && <p className="settings-note" role="status">Dropbox settings: {settingsSync.error || settingsSync.status} <button className="text-button" disabled={settingsSync.working} onClick={settingsSync.syncNow}>Sync now</button></p>}
      <DropboxPanel sync={settingsSync} busy={busy} requestOpen={dropboxPrompt} localFolders={library.folders.filter(folder => !folder.oneDrive && !folder.dropbox && !folder.catalogUrl)} onBusy={setBusy} onConnect={async (name, ref, files, reuseFolderId, signal) => {
        await commit(library => signal?.aborted ? library : connectDropbox(library, name, ref, files, reuseFolderId));
        setMessage(`${name}: ${files.length} Dropbox score bookmarks. Music downloads only when opened.`);
      }}/>
      <OneDrivePanel busy={busy} requestOpen={cloudPrompt} localFolders={library.folders.filter(folder => !folder.oneDrive && !folder.dropbox && !folder.catalogUrl)} onBusy={setBusy} onConnect={async (name, ref, files, reuseFolderId, signal) => {
        await commit(library => signal?.aborted ? library : connectOneDrive(library, name, ref, files, reuseFolderId));
        setMessage(`${name}: ${files.length} OneDrive score bookmarks. Music downloads only when opened.`);
      }}/>
      <div className="library-filters"><input aria-label="Search library" placeholder="Find a score…" value={search} onChange={event => setSearch(event.target.value)}/><label className="checkbox-row"><input type="checkbox" checked={favoritesOnly} onChange={event => setFavoritesOnly(event.target.checked)}/>Favorites</label></div>
      <div className="library-list">{tree.loose.map(renderEntry)}{tree.directories.map(renderDirectory)}{!entries.length && <p className="settings-note">{library.entries.length ? 'No matching scores.' : 'Add a score or connect a folder containing .sotto or .sotto.json files.'}</p>}</div>
      {!!library.folders.length && <h3>Connected folders</h3>}
      {library.folders.map(folder => <div className="library-folder" key={folder.id}><span>{folder.catalogUrl || folder.oneDrive || folder.dropbox ? <Globe size={16}/> : <FolderOpen size={16}/>} {folder.name}</span>{(folder.handle || folder.catalogUrl || folder.oneDrive || folder.dropbox) && <button className="text-button" disabled={busy} onClick={() => void refreshFolder(folder)}>Refresh</button>}{!folder.catalogUrl && !folder.oneDrive && !folder.dropbox && <button className="text-button" disabled={busy} onClick={() => void chooseFolder(folder.id)}>Reconnect</button>}<button className="icon-button" disabled={busy} aria-label={`Remove ${folder.name} folder bookmark`} onClick={() => void change(library => ({ entries: library.entries.filter(entry => entry.folderId !== folder.id), folders: library.folders.filter(item => item.id !== folder.id) }))}><Trash2 size={16}/></button></div>)}
      <details className="library-help"><summary>Library storage &amp; backups</summary>
      <p className="settings-note">Keep your scores in a folder of your choice, including a synced OneDrive folder. Browse nested folders at any depth. Scans list filenames without opening score files; titles and composers are remembered when you open a piece. The library stores bookmarks and favorites. Only the last opened song is cached for resuming; opening another replaces that copy.</p>
      {!filePickers.showDirectoryPicker && <p className="settings-note">Your last song can reopen from its cached copy. Other scores may require you to reselect files or reconnect a folder after reopening Sotto. On iPad, choose a score through Files → OneDrive. Chrome/Edge on desktop can remember file and folder access. A picker may call the selection “Upload”; Sotto reads it locally and does not send it anywhere.</p>}
      <p className="settings-note">Save a backup to OneDrive to transfer favorites, library references, general preferences and per-song practice settings. Import on the other device, then reconnect the folders. Cached sheet music and microphone device/calibration are excluded. Import merges songs and replaces saved settings for matching songs.</p>
      <p className="settings-note">Refreshing removes bookmarks for missing files after a complete scan; failed scans keep the existing listing. Removing a bookmark leaves the original file untouched. Reconnecting uses the selected folder’s relative paths. File access may need permission again; bookmarks do not sync automatically.</p>
      </details>
      <input ref={folderInput} type="file" className="visually-hidden" aria-label="Connect score folder" {...{ webkitdirectory: '', directory: '' }} multiple onChange={event => {
        const selected = Array.from(event.target.files ?? []); event.target.value = '';
        if (!selected.length) return; // An empty selection can mean Cancel.
        const files = selected.filter(file => isScoreFile(file.name));
        setBusy(true);
        void (async () => {
          await ready.current;
          const folder = { id: reconnectFolder.current ?? crypto.randomUUID(), name: selected[0].webkitRelativePath.split('/')[0] || 'Scores' };
          const paths = files.map(file => file.webkitRelativePath.split('/').slice(1).join('/') || file.name);
          await commit(library => {
            const next = connectFolder(library, folder, paths);
            files.forEach((file, i) => { const entry = next.entries.find(entry => entry.folderId === folder.id && entry.path === paths[i])!; sessionFiles.current.set(entry.id, file); });
            return next;
          });
          clearFolderErrors(folder.id);
          if (!files.length) setMessage('This folder contains no Sotto scores. Removed its missing score bookmarks.');
        })().catch(report).finally(() => { setBusy(false); reconnectFolder.current = undefined; });
      }}/>
      <input ref={indexInput} type="file" accept=".json" className="visually-hidden" aria-label="Import library backup" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setBusy(true);
        void (async () => {
          if (file.size > 15_000_000) throw new Error('Please select a library backup smaller than 15 MB.');
          const text = await file.text();
          const imported = parseLibrary(text);
          const settings = parsePreferences(JSON.parse(text).settings, imported.entries.map(entry => `library:${entry.id}`));
          await ready.current;
          // Merge metadata; retain this device's handles for matching IDs.
          const merge = <T extends { id: string }>(old: T[], added: T[]) => [...old.filter(item => !added.some(next => next.id === item.id)), ...added.map(item => ({ ...old.find(previous => previous.id === item.id), ...item }))];
          await commit(library => ({ entries: merge(library.entries, imported.entries), folders: merge(library.folders, imported.folders) }));
          if (settings) { importPreferences(settings); onSettingsImported(); }
          setMessage(settings ? 'Library and settings restored. Sign in again for Dropbox or OneDrive; reconnect local score files or folders on a new device.' : 'Library index imported. Sign in for Dropbox or OneDrive folders; reconnect local folders on this device.');
        })().catch(report).finally(() => setBusy(false));
      }}/>
    </section></div>}
  </>;
});
