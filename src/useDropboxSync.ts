import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { dropboxAuth, dropboxIsAppFolder } from './dropbox-auth';
import { DropboxSyncFile } from './dropbox-sync-file';
import { canonical, PracticeReplica, projectPractice, type PracticeChange, type PracticeSnapshot, type SyncedPractice } from './practice-sync';
import { syncPracticeCycle, type PracticeSyncAdapter } from './practice-sync-cycle';
import { exportPreferences, subscribePractice } from './preferences';
import { loadPracticeJournal, savePracticeJournal, type Library } from './library';
import type { CloudAccount } from './onedrive';
type Options = { library: MutableRefObject<Library>; ready: MutableRefObject<Promise<void>>;
  commit(update: (library: Library) => Library, notify?: boolean): Promise<void>; flush(): void;
  activeKey: string; practiceBusy: boolean; onPracticeSynced(keys: string[]): void };
export type DropboxSyncView = { account: CloudAccount | null; enabled: boolean; working: boolean; status: string; error: string; lastSynced?: number;
  syncNow(): void; enable(): Promise<void>; disable(): void; libraryChanged(): void };
export function useDropboxSync(options: Options): DropboxSyncView {
  const latest = useRef(options); latest.current = options;
  const [generation, setGeneration] = useState(0);
  const [view, setView] = useState({ account: null as CloudAccount | null, enabled: false, working: false, status: 'Settings sync is off.', error: '', lastSynced: undefined as number | undefined });
  const actions = useRef<{ sync(): void; changed(): void; applyPending(): void } | null>(null);
  useEffect(() => {
    const changed = () => setGeneration(value => value + 1);
    const storage = (event: StorageEvent) => { if (!event.key || event.key.startsWith('sotto.dropbox.')) changed(); };
    window.addEventListener('sotto:dropbox-auth', changed); window.addEventListener('storage', storage);
    return () => { window.removeEventListener('sotto:dropbox-auth', changed); window.removeEventListener('storage', storage); };
  }, []);
  useEffect(() => {
    let disposed = false, replica: PracticeReplica | undefined, account: CloudAccount | null = null;
    let localQueue = Promise.resolve(), syncTimer: ReturnType<typeof setTimeout> | undefined, interval: ReturnType<typeof setInterval> | undefined;
    let inFlight: Promise<void> | undefined, lastSavedRevision = -1;
    const controller = new AbortController();
    const enabled = () => !!account && dropboxAuth.syncEnabled(account.id);
    const status = (update: Partial<typeof view>) => { if (!disposed) setView(previous => ({ ...previous, ...update })); };
    const report = (error: unknown) => status({ working: false, error: error instanceof Error ? error.message : 'Settings sync failed. Local settings are kept.', status: 'Settings sync needs attention.' });
    function entries() { return latest.current.library.current.entries.filter(entry => entry.dropbox?.accountId === account?.id); }
    function snapshot(): PracticeSnapshot {
      const linked = entries().sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0)), preferences = exportPreferences(linked.map(entry => `library:${entry.id}`));
      const result: PracticeSnapshot = {};
      for (const entry of linked) {
        const id = entry.dropbox!.itemId, practice = projectPractice(preferences.songs[`library:${entry.id}`] ?? {});
        if (!result[id]) result[id] = { favorite: entry.favorite, practice };
        else { result[id].favorite ||= entry.favorite; if (!Object.keys(result[id].practice).length) result[id].practice = practice; }
      }
      return result;
    }
    async function persist() {
      if (!replica || !account || replica.revision() === lastSavedRevision) return;
      const revision = replica.revision(); await savePracticeJournal(account.id, replica.save()); lastSavedRevision = revision;
    }
    function schedule() {
      if (!enabled() || disposed || syncTimer) return;
      syncTimer = setTimeout(() => { syncTimer = undefined; void sync(); }, 1500);
    }
    function enqueue(action: () => void | Promise<void>) {
      localQueue = localQueue.then(async () => { if (!disposed && replica) { await action(); await persist(); } }).catch(report);
      return localQueue;
    }
    const unsubscribe = subscribePractice(event => {
      void enqueue(() => {
        const entry = entries().find(entry => `library:${entry.id}` === event.key); if (!entry || !replica) return;
        const id = entry.dropbox!.itemId;
        if (event.kind === 'load') {
          replica.loaded(id, event.settings);
        } else {
          const before = replica.revision();
          replica.capture({ [id]: { favorite: entries().some(item => item.dropbox!.itemId === id && item.favorite), practice: projectPractice(event.settings) } });
          if (replica.revision() !== before) { status({ status: enabled() ? 'Settings changes waiting to sync…' : 'Settings sync is off.' }); schedule(); }
        }
      });
    });
    const adapter: PracticeSyncAdapter = {
      flush: () => latest.current.flush(),
      snapshot: async () => { await latest.current.ready.current; await localQueue; return snapshot(); },
      blockedSongs: () => {
        const entry = entries().find(entry => `library:${entry.id}` === latest.current.activeKey);
        return new Set(latest.current.practiceBusy && entry ? [entry.dropbox!.itemId] : []);
      },
      persist: async () => persist(),
      apply: async changes => {
        if (disposed || !enabled()) return [];
        const applied: PracticeChange[] = [], favorites = changes.filter(change => change.field === 'favorite');
        if (favorites.length) await latest.current.commit(library => {
          if (disposed || !enabled()) return library;
          const appliedIds = new Set<string>();
          const next = library.entries.map(entry => {
            const change = favorites.find(change => entry.dropbox && entry.dropbox.accountId === account?.id && entry.dropbox.itemId === change.itemId);
            if (!change || entry.favorite !== change.before) return entry;
            if (!appliedIds.has(change.itemId)) { applied.push(change); appliedIds.add(change.itemId); }
            return { ...entry, favorite: change.value as boolean };
          });
          return { ...library, entries: next };
        }, false);
        if (disposed || !enabled()) return applied;
        const syncedKeys = new Set<string>(), accepted = new Set<string>(), blocked = adapter.blockedSongs();
        for (const entry of entries()) {
          if (blocked.has(entry.dropbox!.itemId)) continue;
          const key = `library:${entry.id}`, settings = exportPreferences([key]).songs[key] ?? {}, practice = projectPractice(settings);
          let changed = false;
          for (const change of changes.filter(change => change.field !== 'favorite' && change.itemId === entry.dropbox!.itemId)) {
            const field = change.field as keyof SyncedPractice;
            if (canonical(practice[field]) !== canonical(change.before)) continue;
            (settings as Record<string, unknown>)[field] = change.value; changed = true;
            const id = change.itemId + ':' + field;
            if (!accepted.has(id)) { applied.push(change); accepted.add(id); }
          }
          if (changed) { localStorage.setItem(`sotto.practice.${key}`, JSON.stringify(settings)); syncedKeys.add(key); }
        }
        if (syncedKeys.size) latest.current.onPracticeSynced([...syncedKeys]);
        return applied;
      },
    };
    async function applyPending() {
      if (!replica || !enabled() || disposed) return;
      await localQueue;
      const changes = replica.changes(snapshot(), adapter.blockedSongs());
      if (!changes.length) return;
      replica.applied(await adapter.apply(changes)); await persist();
      status({ status: 'Favorites and practice settings are up to date.' });
    }
    async function sync() {
      if (disposed || !replica || !account || !enabled()) return;
      if (!navigator.onLine) { status({ status: 'Offline · settings changes saved on this device.', error: '', working: false }); return; }
      if (inFlight) return inFlight;
      status({ working: true, error: '', status: 'Syncing favorites and practice settings…' });
      inFlight = (async () => {
        try {
          const result = await syncPracticeCycle(replica!, new DropboxSyncFile(dropboxAuth, account!.id, undefined, dropboxIsAppFolder()), adapter, controller.signal);
          status({ working: false, error: '', lastSynced: Date.now(), status: result.pending ? 'New changes waiting to sync…' : result.deferred ? 'Synced · practice changes will apply when paused.' : 'Favorites and practice settings are up to date.' });
          if (result.pending) schedule();
        } catch (error) { if (!disposed) report(error); }
        finally { inFlight = undefined; }
      })();
      return inFlight;
    }
    actions.current = { sync: () => { void sync(); }, changed: () => { void enqueue(() => { if (replica) { replica.capture(snapshot(), true); schedule(); } }); }, applyPending: () => { void applyPending().catch(report); } };
    const foreground = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('online', foreground); window.addEventListener('focus', foreground); document.addEventListener('visibilitychange', foreground);
    void (async () => {
      try {
        account = await dropboxAuth.account();
        if (!account || disposed) { if (!disposed) status({ account: null, enabled: false, working: false, error: '', status: 'Settings sync is off.' }); return; }
        await latest.current.ready.current;
        const saved = await loadPracticeJournal(account.id); if (disposed) return;
        replica = new PracticeReplica(account.id, crypto.randomUUID(), saved);
        replica.capture(snapshot()); await persist();
        status({ account, enabled: enabled(), working: false, error: '', status: enabled() ? 'Connecting settings sync…' : 'Settings sync is off.' });
        if (enabled()) { void sync(); interval = setInterval(() => { void sync(); }, 30000); }
      } catch (error) { report(error); }
    })();
    return () => {
      disposed = true; controller.abort(); unsubscribe(); if (syncTimer) clearTimeout(syncTimer); if (interval) clearInterval(interval);
      actions.current = null; window.removeEventListener('online', foreground); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground);
    };
  }, [generation]);
  useEffect(() => { if (!options.practiceBusy) actions.current?.applyPending(); }, [options.practiceBusy, options.activeKey]);
  return { ...view, syncNow: () => actions.current?.sync(), libraryChanged: () => actions.current?.changed(),
    enable: async () => {
      const account = await dropboxAuth.account(); if (!account) throw new Error('Sign in to Dropbox first.');
      if (dropboxAuth.canSync(account.id)) dropboxAuth.setSyncEnabled(account.id, true); else await dropboxAuth.signIn(true);
    },
    disable: () => { if (view.account) dropboxAuth.setSyncEnabled(view.account.id, false); },
  };
}
