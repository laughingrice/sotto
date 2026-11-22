import { parsePreferences, type PracticeSettings, type Preferences } from './preferences';

// Playhead, screen preferences and microphone calibration belong to the device.
export const PRACTICE_SYNC_FIELDS = ['bpm', 'repeats', 'loop', 'loopStart', 'loopEnd', 'muted', 'solo', 'volumes', 'pitchOffset', 'practiceVoice', 'instruments'] as const;
export type PracticeField = typeof PRACTICE_SYNC_FIELDS[number];
export type SyncedPractice = Partial<Pick<PracticeSettings, PracticeField>>;
export type Stamp = [number, string];
type Register = { stamp: Stamp; value: unknown };
export type SongRegisters = { favorite?: Register; practice: Partial<Record<PracticeField, Register>> };
export type PracticeSyncDocument = { format: 'sotto-practice-sync'; version: 1; accountId: string; songs: Record<string, SongRegisters> };
export type PracticeSnapshot = Record<string, { favorite: boolean; practice: SyncedPractice }>;
export type PracticeChange = { itemId: string; field: PracticeField | 'favorite'; before: unknown; value: unknown };
export type PracticeReplicaState = { version: 1; clock: number; document: PracticeSyncDocument; observed: PracticeSnapshot; seeds: PracticeSnapshot };
const GENERAL: Preferences = { zoom: 100, follow: true, rhythmVisible: false, clickVolume: 70, clickMode: 'beat', metronomeMode: 'off' };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const itemId = (id: string) => /^id:[A-Za-z0-9_-]{1,200}$/.test(id);
const accountId = (id: string) => /^dbid:[A-Za-z0-9_-]{1,200}$/.test(id);
const clone = <T>(value: T): T => structuredClone(value);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
export function projectPractice(value: Partial<PracticeSettings>): SyncedPractice {
  return Object.fromEntries(PRACTICE_SYNC_FIELDS.filter(field => value[field] !== undefined).map(field => [field, clone(value[field])])) as SyncedPractice;
}
function parsePractice(value: unknown): SyncedPractice {
  if (!record(value) || Object.keys(value).some(field => !PRACTICE_SYNC_FIELDS.includes(field as PracticeField))) throw new Error('Invalid practice settings in the Dropbox sync file.');
  const result = parsePreferences({ version: 1, general: GENERAL, options: {}, songs: { synced: value } }, ['synced'])!;
  return projectPractice(result.songs.synced);
}
function parseRegister(value: unknown): Register {
  if (!record(value) || !Array.isArray(value.stamp) || value.stamp.length !== 2 || !Number.isSafeInteger(value.stamp[0]) || value.stamp[0] < 1 ||
      typeof value.stamp[1] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.stamp[1]) || value.value === undefined) throw new Error('Invalid change stamp in the Dropbox sync file.');
  return { stamp: [value.stamp[0], value.stamp[1]], value: clone(value.value) };
}
export function parsePracticeSync(value: unknown, expectedAccount: string): PracticeSyncDocument {
  if (!accountId(expectedAccount) || !record(value) || value.format !== 'sotto-practice-sync' || value.version !== 1 || value.accountId !== expectedAccount ||
      !record(value.songs) || Object.keys(value.songs).length > 10000) throw new Error('This Dropbox sync file has an unsupported format or belongs to another account. Local settings were kept.');
  const songs: Record<string, SongRegisters> = {};
  for (const [id, song] of Object.entries(value.songs)) {
    if (!itemId(id) || !record(song) || !record(song.practice) || Object.keys(song.practice).some(field => !PRACTICE_SYNC_FIELDS.includes(field as PracticeField))) throw new Error('Invalid song in the Dropbox sync file.');
    const practice = Object.fromEntries(Object.entries(song.practice).map(([field, register]) => [field, parseRegister(register)])) as SongRegisters['practice'];
    const values = parsePractice(Object.fromEntries(Object.entries(practice).map(([field, register]) => [field, register!.value])));
    for (const field of PRACTICE_SYNC_FIELDS) if (practice[field]) practice[field]!.value = values[field];
    const favorite = song.favorite === undefined ? undefined : parseRegister(song.favorite);
    if (favorite && typeof favorite.value !== 'boolean') throw new Error('Invalid favorite in the Dropbox sync file.');
    songs[id] = { practice, ...(favorite ? { favorite } : {}) };
  }
  return { format: 'sotto-practice-sync', version: 1, accountId: expectedAccount, songs };
}
function parseSnapshot(value: unknown): PracticeSnapshot {
  if (!record(value) || Object.keys(value).length > 10000) throw new Error('Invalid local sync journal.');
  return Object.fromEntries(Object.entries(value).map(([id, song]) => {
    if (!itemId(id) || !record(song) || typeof song.favorite !== 'boolean') throw new Error('Invalid local sync journal.');
    return [id, { favorite: song.favorite, practice: parsePractice(song.practice) }];
  }));
}
function winner(a: Register | undefined, b: Register | undefined): Register | undefined {
  if (!a) return b; if (!b) return a;
  const order = a.stamp[0] - b.stamp[0] || (a.stamp[1] === b.stamp[1] ? 0 : a.stamp[1] > b.stamp[1] ? 1 : -1);
  // The value tie-break also makes recovery deterministic for duplicated journals.
  return order > 0 || !order && canonical(a.value) >= canonical(b.value) ? a : b;
}
/** Per-field last-write-wins registers. Merging unrelated offline edits never
 * replaces the rest of a song or library. No score payload or credentials. */
export class PracticeReplica {
  private state: PracticeReplicaState;
  private generation = 0;
  constructor(private account: string, private writer: string, saved?: unknown, private now = () => Date.now()) {
    if (!accountId(account) || !/^[A-Za-z0-9_-]{1,128}$/.test(writer)) throw new Error('Invalid sync identity.');
    this.state = { version: 1, clock: 0, document: { format: 'sotto-practice-sync', version: 1, accountId: account, songs: {} }, observed: {}, seeds: {} };
    if (saved !== undefined) {
      if (!record(saved) || saved.version !== 1 || !Number.isSafeInteger(saved.clock) || saved.clock < 0) throw new Error('Invalid local sync journal.');
      this.state = { version: 1, clock: saved.clock, document: parsePracticeSync(saved.document, account), observed: parseSnapshot(saved.observed), seeds: parseSnapshot(saved.seeds) };
      this.advance();
    }
  }
  private advance() {
    for (const song of Object.values(this.state.document.songs)) for (const register of [song.favorite, ...Object.values(song.practice)]) if (register) this.state.clock = Math.max(this.state.clock, register.stamp[0]);
  }
  private change(id: string, field: PracticeChange['field'], value: unknown) {
    this.generation++;
    this.state.clock = Math.max(this.now(), this.state.clock + 1);
    if (!Number.isSafeInteger(this.state.clock)) throw new Error('The sync change clock exceeded its limit.');
    const song = this.state.document.songs[id] ??= { practice: {} };
    const register: Register = { stamp: [this.state.clock, this.writer], value: clone(value) };
    if (field === 'favorite') song.favorite = register; else song.practice[field] = register;
  }
  capture(snapshot: PracticeSnapshot, favoritesOnly = false) {
    for (const [id, source] of Object.entries(snapshot)) {
      const previous = this.state.observed[id];
      const current = previous && favoritesOnly ? { ...source, practice: previous.practice } : source;
      if (!previous) { this.state.observed[id] = clone(current); this.state.seeds[id] = clone(current); this.generation++; continue; }
      if (canonical(current) === canonical(previous)) continue;
      this.generation++;
      if (current.favorite !== previous.favorite) this.change(id, 'favorite', current.favorite);
      for (const field of PRACTICE_SYNC_FIELDS) if (current.practice[field] !== undefined && canonical(current.practice[field]) !== canonical(previous.practice[field])) this.change(id, field, current.practice[field]);
      this.state.observed[id] = clone(current);
    }
  }
  loaded(id: string, settings: Partial<PracticeSettings>) {
    // Saving normalized defaults after opening a score is not a user edit.
    if (this.state.observed[id] && canonical(this.state.observed[id].practice) !== canonical(projectPractice(settings))) {
      this.state.observed[id].practice = projectPractice(settings); this.generation++;
    }
  }
  merge(remote: PracticeSyncDocument) {
    this.generation++;
    remote = parsePracticeSync(remote, this.account);
    for (const [id, incoming] of Object.entries(remote.songs)) {
      const local = this.state.document.songs[id] ??= { practice: {} };
      local.favorite = clone(winner(local.favorite, incoming.favorite));
      for (const field of PRACTICE_SYNC_FIELDS) {
        const register = winner(local.practice[field], incoming.practice[field]);
        if (register) local.practice[field] = clone(register);
      }
    }
    this.advance();
    // First-time legacy settings fill missing fields. Existing cloud values
    // take precedence, so a newly connected device cannot erase them with defaults.
    for (const [id, seed] of Object.entries(this.state.seeds)) {
      if (!seed.favorite && !Object.keys(seed.practice).length) continue;
      const song = this.state.document.songs[id] ??= { practice: {} };
      if (!song.favorite && seed.favorite) this.change(id, 'favorite', true);
      for (const field of PRACTICE_SYNC_FIELDS) if (!song.practice[field] && seed.practice[field] !== undefined) this.change(id, field, seed.practice[field]);
    }
    this.state.seeds = {};
  }
  changes(snapshot: PracticeSnapshot, blockedSongs = new Set<string>()): PracticeChange[] {
    const changes: PracticeChange[] = [];
    for (const [id, current] of Object.entries(snapshot)) {
      const song = this.state.document.songs[id]; if (!song) continue;
      if (song.favorite && song.favorite.value !== current.favorite) changes.push({ itemId: id, field: 'favorite', before: current.favorite, value: clone(song.favorite.value) });
      if (blockedSongs.has(id)) continue;
      for (const field of PRACTICE_SYNC_FIELDS) if (song.practice[field] && canonical(song.practice[field]!.value) !== canonical(current.practice[field])) changes.push({ itemId: id, field, before: clone(current.practice[field]), value: clone(song.practice[field]!.value) });
    }
    return changes;
  }
  applied(changes: PracticeChange[]) {
    if (changes.length) this.generation++;
    for (const change of changes) {
      const observed = this.state.observed[change.itemId]; if (!observed) continue;
      if (change.field === 'favorite') { if (observed.favorite === change.before) observed.favorite = change.value as boolean; }
      else if (canonical(observed.practice[change.field]) === canonical(change.before)) (observed.practice as Record<string, unknown>)[change.field] = clone(change.value);
    }
  }
  document() { return parsePracticeSync(this.state.document, this.account); }
  save(): PracticeReplicaState { return clone(this.state); }
  revision() { return this.generation; }
}
