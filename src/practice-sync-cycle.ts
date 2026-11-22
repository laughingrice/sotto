import { canonical, PracticeReplica, type PracticeChange, type PracticeReplicaState, type PracticeSnapshot } from './practice-sync';
import { SyncConflict, type PracticeSyncFile } from './dropbox-sync-file';
export type PracticeSyncAdapter = {
  flush(): void;
  snapshot(): Promise<PracticeSnapshot>;
  blockedSongs(): Set<string>;
  apply(changes: PracticeChange[]): Promise<PracticeChange[]>;
  persist(state: PracticeReplicaState): Promise<void>;
};
export async function syncPracticeCycle(replica: PracticeReplica, file: PracticeSyncFile, adapter: PracticeSyncAdapter, signal?: AbortSignal) {
  const capture = async () => { adapter.flush(); replica.capture(await adapter.snapshot()); await adapter.persist(replica.save()); };
  await capture();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new Error('Settings sync cancelled. Local changes kept.');
    const remote = await file.read(signal);
    // Include edits made while the remote file was being downloaded.
    await capture();
    replica.merge(remote?.document ?? { format: 'sotto-practice-sync', version: 1, accountId: replica.document().accountId, songs: {} });
    await adapter.persist(replica.save());
    const changes = replica.changes(await adapter.snapshot(), adapter.blockedSongs());
    const applied = await adapter.apply(changes);
    replica.applied(applied);
    await capture();
    const document = replica.document();
    const deferred = replica.changes(await adapter.snapshot()).some(change => change.field !== 'favorite' && adapter.blockedSongs().has(change.itemId));
    if (remote && canonical(document) === canonical(remote.document)) return { pending: false, deferred, applied: applied.length };
    if (signal?.aborted) throw new Error('Settings sync cancelled. Local changes kept.');
    try {
      await file.write(document, remote?.rev, signal);
      await capture();
      return { pending: canonical(document) !== canonical(replica.document()), deferred, applied: applied.length };
    } catch (error) { if (!(error instanceof SyncConflict)) throw error; }
  }
  throw new Error('Another device is updating settings. Local changes are kept; try Sync now again shortly.');
}
