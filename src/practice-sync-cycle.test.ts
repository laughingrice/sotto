import { expect, it } from 'vitest';
import { PracticeReplica, canonical, type PracticeSnapshot, type PracticeSyncDocument } from './practice-sync';
import { SyncConflict, type PracticeSyncFile } from './dropbox-sync-file';
import { syncPracticeCycle, type PracticeSyncAdapter } from './practice-sync-cycle';
const account = 'dbid:account';
const snapshot = (favorite = false, bpm?: number): PracticeSnapshot => ({ 'id:piece': { favorite, practice: bpm === undefined ? {} : { bpm } } });
const empty = (): PracticeSyncDocument => ({ format: 'sotto-practice-sync', version: 1, accountId: account, songs: {} });
function local(initial: PracticeSnapshot, writer: string) {
  let state = structuredClone(initial), saved: unknown;
  const replica = new PracticeReplica(account, writer);
  const adapter: PracticeSyncAdapter = { flush() {}, snapshot: async () => structuredClone(state), blockedSongs: () => new Set(), persist: async value => { saved = value; },
    apply: async changes => { for (const change of changes) {
      if (change.field === 'favorite') state[change.itemId].favorite = change.value as boolean;
      else (state[change.itemId].practice as any)[change.field] = change.value;
    } return changes; } };
  return { replica, adapter, state: () => state, change: (next: PracticeSnapshot) => { state = next; replica.capture(next); }, saved: () => saved };
}
function remote(initial: PracticeSyncDocument | null = null) {
  let document = initial && structuredClone(initial), version = document ? 1 : 0, writes = 0;
  const file: PracticeSyncFile = {
    read: async () => document ? { document: structuredClone(document), rev: String(version) } : null,
    write: async (next, rev) => {
      if (rev !== (document ? String(version) : undefined)) throw new SyncConflict();
      document = structuredClone(next); version++; writes++; return String(version);
    },
  };
  return { file, document: () => document!, writes: () => writes, set: (next: PracticeSyncDocument) => { document = next; version++; } };
}
it('round-trips favorites and settings between two devices and does not re-upload an unchanged document', async () => {
  const computer = local(snapshot(true, 80), 'computer'), tablet = local(snapshot(), 'tablet'), cloud = remote();
  await syncPracticeCycle(computer.replica, cloud.file, computer.adapter);
  await syncPracticeCycle(tablet.replica, cloud.file, tablet.adapter);
  expect(tablet.state()).toEqual(snapshot(true, 80)); const writes = cloud.writes();
  await syncPracticeCycle(tablet.replica, cloud.file, tablet.adapter); expect(cloud.writes()).toBe(writes);
  tablet.change(snapshot(false, 90)); await syncPracticeCycle(tablet.replica, cloud.file, tablet.adapter); await syncPracticeCycle(computer.replica, cloud.file, computer.adapter);
  expect(computer.state()).toEqual(snapshot(false, 90)); expect(computer.saved()).toBeTruthy();
});
it('re-reads and merges after another device wins a conditional write instead of losing unrelated changes', async () => {
  const computer = local(snapshot(), 'computer'), tablet = local(snapshot(), 'tablet'), cloud = remote();
  await syncPracticeCycle(computer.replica, cloud.file, computer.adapter); await syncPracticeCycle(tablet.replica, cloud.file, tablet.adapter);
  computer.change(snapshot(true)); tablet.change(snapshot(false, 70));
  const write = cloud.file.write; let interrupted = false;
  const racing: PracticeSyncFile = { read: cloud.file.read, write: async (...args) => {
    if (!interrupted) { interrupted = true; await syncPracticeCycle(tablet.replica, cloud.file, tablet.adapter); }
    return write(...args);
  } };
  await syncPracticeCycle(computer.replica, racing, computer.adapter);
  expect(cloud.document().songs['id:piece'].favorite!.value).toBe(true); expect(cloud.document().songs['id:piece'].practice.bpm!.value).toBe(70);
});
it('retains offline edits and changes made during upload for the next sync', async () => {
  const computer = local(snapshot(), 'computer'), cloud = remote();
  await syncPracticeCycle(computer.replica, cloud.file, computer.adapter); computer.change(snapshot(true, 80));
  const write = cloud.file.write;
  const slow: PracticeSyncFile = { read: cloud.file.read, write: async (...args) => { computer.change(snapshot(true, 90)); return write(...args); } };
  expect((await syncPracticeCycle(computer.replica, slow, computer.adapter)).pending).toBe(true);
  await syncPracticeCycle(computer.replica, cloud.file, computer.adapter); expect(cloud.document().songs['id:piece'].practice.bpm!.value).toBe(90);
  computer.change(snapshot(false, 100));
  await expect(syncPracticeCycle(computer.replica, { read: async () => { throw new Error('offline'); }, write }, computer.adapter)).rejects.toThrow('offline');
  expect(computer.state()).toEqual(snapshot(false, 100)); expect(computer.saved()).toBeTruthy();
});
it('keeps incoming practice changes pending during playback and applies them after pause without echo', async () => {
  const first = local(snapshot(true, 80), 'first'), cloud = remote(); await syncPracticeCycle(first.replica, cloud.file, first.adapter);
  const playing = local(snapshot(false, 120), 'second'); playing.adapter.blockedSongs = () => new Set(['id:piece']);
  await syncPracticeCycle(playing.replica, cloud.file, playing.adapter); expect(playing.state()).toEqual(snapshot(true, 120));
  const before = canonical(playing.replica.document()); playing.adapter.blockedSongs = () => new Set();
  const applied = await playing.adapter.apply(playing.replica.changes(playing.state())); playing.replica.applied(applied);
  expect(playing.state()).toEqual(snapshot(true, 80)); expect(canonical(playing.replica.document())).toBe(before);
});
