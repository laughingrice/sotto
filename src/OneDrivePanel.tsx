import { useEffect, useRef, useState } from 'react';
import { Cloud, FolderOpen } from 'lucide-react';
import { configureOneDrive, oneDriveAuth, oneDriveClientId, oneDriveRedirectUri, oneDriveClient } from './onedrive-auth';
import type { CloudAccount, CloudFile, CloudItem, OneDriveFolderRef } from './onedrive';
type Crumb = { name: string; ref: OneDriveFolderRef };
export default function OneDrivePanel({ busy, requestOpen, localFolders, onBusy, onConnect }: { busy: boolean; requestOpen: number; localFolders: { id: string; name: string }[]; onBusy(value: boolean): void;
  onConnect(name: string, ref: OneDriveFolderRef, files: CloudFile[], reuseFolderId?: string, signal?: AbortSignal): Promise<void> }) {
  const [expanded, setExpanded] = useState(() => location.hash === '#onedrive');
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [clientId, setClientId] = useState(oneDriveClientId);
  const [message, setMessage] = useState('');
  const [crumbs, setCrumbs] = useState<Crumb[]>([]), [items, setItems] = useState<CloudItem[]>([]);
  const [reuseFolderId, setReuseFolderId] = useState('');
  const [scanning, setScanning] = useState(false);
  const controller = useRef<AbortController | null>(null), mounted = useRef(true), ownsBusy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void oneDriveAuth.account().then(value => { if (mounted.current) setAccount(value); }).catch(error => { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Microsoft sign-in could not be restored.'); });
    if (location.hash === '#onedrive') history.replaceState(null, '', location.pathname + location.search);
    return () => { mounted.current = false; controller.current?.abort(); if (ownsBusy.current) onBusy(false); };
  }, []);
  useEffect(() => { if (requestOpen) setExpanded(true); }, [requestOpen]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    ownsBusy.current = true; onBusy(true); setMessage('');
    const abort = new AbortController(); controller.current = abort;
    try { await action(abort.signal); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'OneDrive could not be opened.'); }
    finally { if (mounted.current) { ownsBusy.current = false; onBusy(false); setScanning(false); } }
  }
  async function browse(next: Crumb[], signal: AbortSignal) {
    const children = await oneDriveClient.children(next.at(-1)!.ref, signal);
    if (!signal.aborted && mounted.current) { setCrumbs(next); setItems(children); }
  }
  const selected = crumbs.at(-1);
  return <details className="library-help cloud-panel onedrive-panel" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><Cloud size={16}/> Connect OneDrive Personal</summary>
    <p className="settings-note">Sign in to browse your own OneDrive folder on this device. Nested folders are supported. Refresh reads filenames only; music downloads when opened. Only the last song is cached.</p>
    {!account && <details className="cloud-setup" open={!oneDriveClientId()}><summary>OneDrive app setup</summary>
      <p className="settings-note">Sotto needs a Microsoft app registration that supports personal Microsoft accounts, with delegated Files.Read permission. Configure this exact Single-page application callback. A client secret is not needed.</p>
      <label>Application (client) ID<input aria-label="OneDrive application client ID" value={clientId} placeholder="00000000-0000-0000-0000-000000000000" onChange={event => setClientId(event.target.value)}/></label>
      <label>SPA callback URL<input aria-label="OneDrive callback URL" readOnly value={oneDriveRedirectUri()}/></label>
      <p className="settings-note"><a href="https://learn.microsoft.com/en-us/graph/auth-register-app-v2" target="_blank" rel="noreferrer">Microsoft app registration instructions</a>. The publisher can supply the public client ID for everyone; this browser’s override is not included in backups.</p>
    </details>}
    <div className="library-actions">
      {!account ? <button className="quiet-button" disabled={busy || !clientId.trim()} onClick={() => void run(async () => {
        if (clientId.trim() !== oneDriveClientId()) configureOneDrive(clientId);
        await oneDriveAuth.signIn();
      })}>Sign in to OneDrive</button> : <>
        <span className="settings-note">{account.label}</span>
        <button className="quiet-button" disabled={busy} onClick={() => void run(async signal => {
          const root = await oneDriveClient.root(account.id, signal);
          await browse([{ name: 'My OneDrive', ref: root.ref }], signal);
        })}><FolderOpen size={15}/>Browse OneDrive folders</button>
        <button className="text-button" disabled={busy} onClick={() => void run(() => oneDriveAuth.signIn())}>Sign in again / switch account</button>
        <button className="text-button" disabled={busy} onClick={() => void run(async () => { await oneDriveAuth.disconnect(); setAccount(null); setCrumbs([]); setItems([]); })}>Disconnect sign-in</button>
      </>}
    </div>
    {selected && <div className="cloud-browser">
      <nav aria-label="OneDrive folder path">{crumbs.map((crumb, index) => <button key={crumb.ref.itemId} className="text-button" disabled={busy} onClick={() => void run(signal => browse(crumbs.slice(0, index + 1), signal))}>{index ? ' / ' : ''}{crumb.name}</button>)}</nav>
      <div className="cloud-folders onedrive-folders" aria-label="OneDrive folders">{items.filter(item => item.kind === 'folder').map(item => <button className="quiet-button" key={item.id} disabled={busy} onClick={() => void run(signal => browse([...crumbs, { name: item.name, ref: { ...selected.ref, itemId: item.id } }], signal))}><FolderOpen size={15}/>{item.name}</button>)}</div>
      <p className="settings-note">{items.filter(item => item.kind === 'file' && /\.sotto(?:\.json)?$/i.test(item.name)).length} score files in this folder. Connecting includes every nested subfolder.</p>
      {localFolders.length > 0 && <label className="cloud-reuse">Reuse existing bookmarks<select aria-label="Reuse local folder bookmarks" value={reuseFolderId} disabled={busy} onChange={event => setReuseFolderId(event.target.value)}><option value="">Create a new OneDrive library</option>{localFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><small>Select your matching local score folder to preserve favorites and practice settings by relative path. This changes bookmarks, not files.</small></label>}
      <button className="quiet-button" disabled={busy} onClick={() => void run(async signal => {
        setScanning(true);
        const files = await oneDriveClient.scan(selected.ref, signal, (folders, count) => { if (mounted.current) setMessage(`Listing ${folders} folders · ${count} scores…`); });
        if (signal.aborted || !mounted.current) return;
        await onConnect(selected.name, selected.ref, files, reuseFolderId || undefined, signal);
        if (mounted.current) { setMessage(`${selected.name}: ${files.length} score bookmarks connected.`); setReuseFolderId(''); setExpanded(false); }
      })}>Connect this OneDrive folder</button>
    </div>}
    {scanning && <button className="text-button" onClick={() => controller.current?.abort()}>Cancel OneDrive scan</button>}
    {message && <p className="library-message" role="status">{message}</p>}
    <p className="settings-note">Microsoft grants read-only access to your files; Sotto browses only where you navigate and scans the folder you connect. No OneDrive files are changed. Shared-folder shortcuts and public sharing URLs are not supported in this first connection. Sign-in may need renewal; saved folder bookmarks do not need to be selected again.</p>
  </details>;
}
