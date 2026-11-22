import { useEffect, useRef, useState } from 'react';
import { Cloud, FolderOpen } from 'lucide-react';
import { configureDropbox, dropboxAuth, dropboxAppKey, dropboxRedirectUri, dropboxClient, dropboxIsAppFolder } from './dropbox-auth';
import type { DropboxSyncView } from './useDropboxSync';
import type { CloudAccount, CloudFile, CloudItem } from './onedrive';
import type { DropboxRef } from './dropbox';
type Crumb = { name: string; ref: DropboxRef };
export default function DropboxPanel({ busy, requestOpen, localFolders, onBusy, onConnect, sync }: { busy: boolean; requestOpen: number; localFolders: { id: string; name: string }[]; onBusy(value: boolean): void; sync: DropboxSyncView;
  onConnect(name: string, ref: DropboxRef, files: CloudFile[], reuseFolderId?: string, signal?: AbortSignal): Promise<void> }) {
  const [expanded, setExpanded] = useState(() => location.hash === '#dropbox');
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [appKey, setAppKey] = useState(dropboxAppKey);
  const [message, setMessage] = useState('');
  const [crumbs, setCrumbs] = useState<Crumb[]>([]), [items, setItems] = useState<CloudItem[]>([]);
  const [reuseFolderId, setReuseFolderId] = useState('');
  const [scanning, setScanning] = useState(false);
  const controller = useRef<AbortController | null>(null), mounted = useRef(true), ownsBusy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void dropboxAuth.account().then(value => { if (mounted.current) setAccount(value); }).catch(error => { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Dropbox sign-in could not be restored.'); });
    if (location.hash === '#dropbox') history.replaceState(null, '', location.pathname + location.search);
    return () => { mounted.current = false; controller.current?.abort(); if (ownsBusy.current) onBusy(false); };
  }, []);
  useEffect(() => { if (requestOpen) setExpanded(true); }, [requestOpen]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    ownsBusy.current = true; onBusy(true); setMessage('');
    const abort = new AbortController(); controller.current = abort;
    try { await action(abort.signal); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Dropbox could not be opened.'); }
    finally { if (mounted.current) { ownsBusy.current = false; onBusy(false); setScanning(false); } }
  }
  async function browse(next: Crumb[], signal: AbortSignal) {
    const children = await dropboxClient.children(next.at(-1)!.ref, signal);
    if (!signal.aborted && mounted.current) { setCrumbs(next); setItems(children); }
  }
  const selected = crumbs.at(-1);
  return <details className="library-help cloud-panel dropbox-panel" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><Cloud size={16}/> Connect Dropbox</summary>
    <p className="settings-note">Sign in to browse your own Dropbox folder on this device. Nested folders are supported. Refresh reads filenames only; music downloads when opened. Only the last song is cached.</p>
    {!account && <details className="cloud-setup" open={!dropboxAppKey()}><summary>Dropbox app setup</summary>
      <p className="settings-note">Register a Scoped access / Full Dropbox app with account_info.read, files.metadata.read and files.content.read. Optional settings sync also needs files.content.write. Enable public clients (PKCE) and add this exact redirect URI. No credit card or App secret is needed.</p>
      <label>App key<input aria-label="Dropbox App key" value={appKey} placeholder="Public Dropbox App key" onChange={event => setAppKey(event.target.value)}/></label>
      <label>Redirect URI<input aria-label="Dropbox callback URL" readOnly value={dropboxRedirectUri()}/></label>
      <p className="settings-note"><a href="https://www.dropbox.com/developers/apps/create" target="_blank" rel="noreferrer">Dropbox App Console</a>. The publisher can supply the public App key for everyone; this browser’s override is not included in backups.</p>
    </details>}
    <div className="library-actions">
      {!account ? <button className="quiet-button" disabled={busy || !appKey.trim()} onClick={() => void run(async () => {
        if (appKey.trim() !== dropboxAppKey()) configureDropbox(appKey);
        await dropboxAuth.signIn();
      })}>Sign in to Dropbox</button> : <>
        <span className="settings-note">{account.label}</span>
        <button className="quiet-button" disabled={busy} onClick={() => void run(async signal => {
          await browse([{ name: 'My Dropbox', ref: { accountId: account.id, itemId: '' } }], signal);
        })}><FolderOpen size={15}/>Browse Dropbox folders</button>
        <button className="text-button" disabled={busy} onClick={() => void run(() => dropboxAuth.signIn(sync.enabled))}>Sign in again / switch account</button>
        <button className="text-button" disabled={busy} onClick={() => void run(async () => { await dropboxAuth.disconnect(); setAccount(null); setCrumbs([]); setItems([]); })}>Disconnect sign-in</button>
      </>}
    </div>
    {account && <div className="cloud-sync">
      <strong>Favorites &amp; practice settings sync</strong>
      <p className="settings-note">Syncs Dropbox-linked scores by file ID, including tempo, loops, practice voice, instrument choices and favorites. Each device keeps its playhead, screen preferences and microphone calibration. Changes merge by setting; the newer change wins when both devices edit the same setting. Incoming practice settings wait until playback is paused.</p>
      <div className="library-actions">{sync.enabled ? <>
        <button className="quiet-button" disabled={busy || sync.working} onClick={sync.syncNow}>Sync settings now</button>
        <button className="text-button" disabled={busy} onClick={sync.disable}>Disable settings sync</button>
      </> : <button className="quiet-button" disabled={busy || sync.working} onClick={() => void run(() => sync.enable())}>Enable settings sync</button>}</div>
      <p className="settings-note" role="status">{sync.error || sync.status}{sync.lastSynced ? ` Last checked ${new Date(sync.lastSynced).toLocaleTimeString()}.` : ''}</p>
      <p className="settings-note">Enabling sync asks for files.content.write. {dropboxIsAppFolder() ? 'Access is limited by Dropbox to this app’s folder; Sotto writes only practice-settings-v1.json there.' : 'Dropbox grants write access across the account; Sotto’s upload code writes only /Apps/Sotto/practice-settings-v1.json.'} Score files, audio, sign-in tokens and microphone data are never uploaded. The same Dropbox account and connected score files are needed on each device.</p>
    </div>}
    {selected && <div className="cloud-browser">
      <nav aria-label="Dropbox folder path">{crumbs.map((crumb, index) => <button key={crumb.ref.itemId} className="text-button" disabled={busy} onClick={() => void run(signal => browse(crumbs.slice(0, index + 1), signal))}>{index ? ' / ' : ''}{crumb.name}</button>)}</nav>
      <div className="cloud-folders dropbox-folders" aria-label="Dropbox folders">{items.filter(item => item.kind === 'folder').map(item => <button className="quiet-button" key={item.id} disabled={busy} onClick={() => void run(signal => browse([...crumbs, { name: item.name, ref: { ...selected.ref, itemId: item.id } }], signal))}><FolderOpen size={15}/>{item.name}</button>)}</div>
      <p className="settings-note">{items.filter(item => item.kind === 'file' && /\.sotto(?:\.json)?$/i.test(item.name)).length} score files in this folder. Connecting includes every nested subfolder.</p>
      {localFolders.length > 0 && <label className="cloud-reuse">Reuse existing bookmarks<select aria-label="Reuse local folder bookmarks" value={reuseFolderId} disabled={busy} onChange={event => setReuseFolderId(event.target.value)}><option value="">Create a new Dropbox library</option>{localFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><small>Select your matching local score folder to preserve favorites and practice settings by relative path. This changes bookmarks, not files.</small></label>}
      <button className="quiet-button" disabled={busy} onClick={() => void run(async signal => {
        setScanning(true);
        const files = await dropboxClient.scan(selected.ref, signal, (folders, count) => { if (mounted.current) setMessage(`Listing ${folders} folders · ${count} scores…`); });
        if (signal.aborted || !mounted.current) return;
        await onConnect(selected.name, selected.ref, files, reuseFolderId || undefined, signal);
        if (mounted.current) { setMessage(`${selected.name}: ${files.length} score bookmarks connected.`); setReuseFolderId(''); setExpanded(false); }
      })}>Connect this Dropbox folder</button>
    </div>}
    {scanning && <button className="text-button" onClick={() => controller.current?.abort()}>Cancel Dropbox scan</button>}
    {message && <p className="library-message" role="status">{message}</p>}
    <p className="settings-note">Score browsing requests read-only account, metadata and content permissions. {dropboxIsAppFolder() ? 'Dropbox restricts access to the app’s folder.' : 'Full Dropbox authorizes reading across your account.'} Sotto lists where you navigate and scans the folder you connect. Optional settings sync writes only its dedicated JSON file. Public sharing links and team spaces are not supported. Sign-in is renewed automatically while permitted; folder bookmarks survive a sign-in renewal.</p>
  </details>;
}
