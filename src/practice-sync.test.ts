import { expect, it } from 'vitest';
import { PracticeReplica, canonical, parsePracticeSync, projectPractice, type PracticeSnapshot } from './practice-sync';
const account = 'dbid:account';
const snapshot = (favorite = false, bpm?: number): PracticeSnapshot => ({ 'id:piece': { favorite, practice: bpm === undefined ? {} : { bpm } } });
const empty = () => ({ format: 'sotto-practice-sync' as const, version: 1 as const, accountId: account, songs: {} });
it('merges favorites and individual practice fields without replacing unrelated offline edits', () => {
  const computer = new PracticeReplica(account, 'computer', undefined, () => 100), tablet = new PracticeReplica(account, 'tablet', undefined, () => 110);
  computer.capture(snapshot()); tablet.capture(snapshot()); computer.merge(empty()); tablet.merge(empty());
  computer.capture(snapshot(true)); tablet.capture(snapshot(false, 80));
  const a = computer.document(), b = tablet.document(); computer.merge(b); tablet.merge(a);
  expect(computer.document()).toEqual(tablet.document());
  expect(computer.changes(snapshot())).toEqual(expect.arrayContaining([
    { itemId: 'id:piece', field: 'favorite', before: false, value: true },
    { itemId: 'id:piece', field: 'bpm', before: undefined, value: 80 },
  ]));
});
it('propagates unfavorite as an explicit change and resolves simultaneous edits deterministically', () => {
  const a = new PracticeReplica(account, 'a', undefined, () => 100), b = new PracticeReplica(account, 'b', undefined, () => 100);
  a.capture(snapshot(true, 90)); a.merge(empty()); b.capture(snapshot()); b.merge(a.document());
  const updates = b.changes(snapshot()); b.applied(updates); b.capture(snapshot(true, 90));
  a.capture(snapshot(false, 80)); b.capture(snapshot(true, 100));
  const first = a.document(), second = b.document(); a.merge(second); b.merge(first);
  expect(a.document()).toEqual(b.document()); expect(a.document().songs['id:piece'].favorite!.value).toBe(false);
  expect(a.document().songs['id:piece'].practice.bpm!.value).toBe(80);
});
it('does not overwrite existing cloud preferences with first-time defaults, and imports legacy settings only where missing', () => {
  const cloud = new PracticeReplica(account, 'first', undefined, () => 100); cloud.capture(snapshot(true, 75)); cloud.merge(empty());
  const fresh = new PracticeReplica(account, 'new', undefined, () => 200); fresh.capture(snapshot(false, 120)); fresh.merge(cloud.document());
  expect(fresh.document().songs['id:piece'].practice.bpm!.value).toBe(75); expect(fresh.document().songs['id:piece'].favorite!.value).toBe(true);
  const legacy = new PracticeReplica(account, 'old', undefined, () => 200); legacy.capture(snapshot(true, 88)); legacy.merge(empty());
  expect(legacy.document().songs['id:piece'].practice.bpm!.value).toBe(88);
  const untouched = new PracticeReplica(account, 'new'); untouched.capture(snapshot()); untouched.merge(empty()); expect(untouched.document().songs).toEqual({});
});
it('does not publish normalized score defaults or playhead changes as practice edits', () => {
  const replica = new PracticeReplica(account, 'computer'); replica.capture(snapshot());
  replica.loaded('id:piece', { bpm: 120, beat: 15, loop: false }); replica.capture({ 'id:piece': { favorite: false, practice: projectPractice({ bpm: 120, beat: 16, loop: false }) } });
  replica.merge(empty()); expect(replica.document().songs).toEqual({});
  replica.capture(snapshot(false, 90)); expect(replica.document().songs['id:piece'].practice.bpm!.value).toBe(90);
  expect(JSON.stringify(replica.document())).not.toContain('beat');
});
it('defers practice settings during playback while allowing favorite updates', () => {
  const replica = new PracticeReplica(account, 'a'); replica.capture(snapshot(true, 80)); replica.merge(empty());
  expect(replica.changes(snapshot(), new Set(['id:piece']))).toEqual([{ itemId: 'id:piece', field: 'favorite', before: false, value: true }]);
  expect(replica.changes(snapshot())).toHaveLength(2);
});
it('restores offline edits from its journal and advances beyond a remote clock without relying on device clock agreement', () => {
  const original = new PracticeReplica(account, 'a', undefined, () => 10000); original.capture(snapshot()); original.merge(empty()); original.capture(snapshot(true, 60));
  const restored = new PracticeReplica(account, 'b', original.save(), () => 1); restored.capture(snapshot(true, 61));
  expect(restored.document().songs['id:piece'].practice.bpm!.stamp[0]).toBeGreaterThan(original.document().songs['id:piece'].practice.bpm!.stamp[0]);
  expect(restored.document().songs['id:piece'].favorite!.value).toBe(true);
});
it('applies cloud changes without creating upload echoes and preserves edits made during an apply', () => {
  const remote = new PracticeReplica(account, 'a'); remote.capture(snapshot(true, 60)); remote.merge(empty());
  const local = new PracticeReplica(account, 'b'); local.capture(snapshot()); local.merge(remote.document());
  const changes = local.changes(snapshot()), before = canonical(local.document()); local.applied(changes); local.capture(snapshot(true, 60));
  expect(canonical(local.document())).toBe(before);
  local.capture(snapshot(true, 70)); local.applied(changes); local.capture(snapshot(true, 70));
  expect(local.document().songs['id:piece'].practice.bpm!.value).toBe(70);
});
it('rejects corrupt, foreign-account and unexpected settings fields without accepting score bodies or tokens', () => {
  expect(() => parsePracticeSync({ ...empty(), accountId: 'dbid:other' }, account)).toThrow();
  expect(() => parsePracticeSync({ ...empty(), songs: { 'id:one': { practice: { beat: { stamp: [1, 'x'], value: 3 } } } } }, account)).toThrow();
  expect(() => parsePracticeSync({ ...empty(), songs: { 'id:one': { practice: { bpm: { stamp: [1, 'x'], value: 'secret-token' } } } } }, account)).toThrow();
  const replica = new PracticeReplica(account, 'a'); replica.capture(snapshot(true, 80)); replica.merge(empty());
  const doc = { ...replica.document(), accessToken: 'secret-token', pages: '<svg>' };
  expect(JSON.stringify(parsePracticeSync(doc, account))).not.toMatch(/secret-token|pages|svg/);
});
