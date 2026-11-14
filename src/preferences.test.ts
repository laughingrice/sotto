import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadPractice, loadPreferences, loadCountIn, lastScore, remember, rememberScore, savePractice, exportPreferences, importPreferences, parsePreferences } from './preferences';
import type { Score } from './score';
const score: Score = { format: 'sotto-score', version: 1, title: 'Test', composer: '', subtitle: '', description: '', bpm: 80, beatUnit: 1, beatsPerBar: 4,
  voices: [{ id: 'melody', name: 'Melody', color: '#000' }], notes: [], pages: ['<svg/>'],
  bars: [0, 1, 2].map(index => ({ index, label: String(index + 1), start: index * 4, duration: 4 })), sequence: [0, 1, 2] };
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
it('remembers general preferences and the last song without storing score contents', () => {
  remember('sotto.preferences', { zoom: 150, follow: false, clickVolume: 32, clickMode: 'subdivision', metronomeMode: 'continuous', rhythmVisible: true });
  expect(loadPreferences()).toEqual({ zoom: 150, follow: false, clickVolume: 32, clickMode: 'subdivision', metronomeMode: 'continuous', rhythmVisible: true });
  rememberScore('library:abc'); expect(lastScore()).toBe('library:abc');
  expect(localStorage.getItem('sotto.session')).not.toContain('notes');
});
it('keeps practice settings separate per song and fits them to a changed score', () => {
  const saved = { ...loadPractice('one', score), bpm: 65, beat: 9, loop: true, loopStart: 1, loopEnd: 2, muted: ['melody'], solo: 'melody', volumes: { melody: .4 }, pitchOffset: -12, practiceVoice: 'all' };
  savePractice('one', saved);
  expect(loadPractice('one', score)).toEqual(saved);
  expect(loadPractice('two', score)).toMatchObject({ bpm: 80, beat: 0, loop: false, muted: [], pitchOffset: 0 });
  const shortened = { ...score, bars: score.bars.slice(0, 1), sequence: [0], voices: [{ id: 'bass', name: 'Bass', color: '#000' }] };
  expect(loadPractice('one', shortened)).toMatchObject({ beat: 3.999, loopStart: 0, loopEnd: 0, muted: [], solo: null, volumes: {} });
});
it('falls back safely for corrupt or unavailable browser storage', () => {
  localStorage.setItem('sotto.preferences', '{broken');
  expect(loadPreferences().zoom).toBe(100);
  remember('sotto.practice.bad', { bpm: 'fast', beat: -100, loopEnd: 999, pitchOffset: 200, muted: ['unknown'], volumes: { melody: -10 } });
  expect(loadPractice('bad', score)).toMatchObject({ bpm: 80, beat: 0, loopEnd: 2, pitchOffset: 0, muted: [], volumes: { melody: 0 } });
  remember('sotto.practice.partial', { loopStart: 2 });
  expect(loadPractice('partial', score)).toMatchObject({ loopStart: 2, loopEnd: 2 });
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Unavailable'); }, setItem: () => { throw new Error('Unavailable'); } });
  expect(loadPreferences().clickMode).toBe('beat');
  expect(() => savePractice('one', loadPractice('one', score))).not.toThrow();
});

it('backs up song settings and portable preferences, excluding score data and device calibration', () => {
  const saved = { ...loadPractice('library:one', score), bpm: 62, loop: true, loopStart: 1, loopEnd: 2, beat: 5, muted: ['melody'] };
  savePractice('library:one', saved); savePractice('library:other', { ...saved, bpm: 90 });
  rememberScore('library:one');
  localStorage.setItem('sotto.instrument', 'violin'); localStorage.setItem('sotto.inputDelay', '180'); localStorage.setItem('sotto.inputDevice', 'source-mic');
  const backup = exportPreferences(['library:one']);
  expect(backup.songs).toEqual({ 'library:one': saved });
  expect(backup.options).toEqual({ 'sotto.instrument': 'violin' });
  expect(JSON.stringify(backup)).not.toMatch(/pages|notes|source-mic|inputDelay/);
  localStorage.setItem('sotto.inputDelay', '25'); localStorage.setItem('sotto.inputDevice', 'target-mic');
  savePractice('library:one', { ...saved, bpm: 100 });
  importPreferences(parsePreferences(JSON.parse(JSON.stringify(backup)), ['library:one'])!);
  expect(loadPractice('library:one', score)).toEqual(saved);
  expect(loadPractice('library:other', score).bpm).toBe(90);
  expect(localStorage.getItem('sotto.inputDelay')).toBe('25'); expect(localStorage.getItem('sotto.inputDevice')).toBe('target-mic');
  expect(lastScore()).toBe('library:one');
});
it('accepts older indexes and validates the whole backup before importing settings', () => {
  expect(parsePreferences(undefined, [])).toBeUndefined();
  const backup = exportPreferences([]);
  expect(() => parsePreferences({ ...backup, options: { 'sotto.inputDevice': 'foreign-mic' } }, [])).toThrow();
  expect(() => parsePreferences({ ...backup, options: { toString: 'anything' } }, [])).toThrow();
  expect(() => parsePreferences({ ...backup, songs: { 'library:unknown': {} } }, [])).toThrow();
  expect(() => parsePreferences({ ...backup, songs: { 'builtin:julia-florida': { volumes: { melody: 200 } } } }, [])).toThrow();
  expect(() => parsePreferences({ ...backup, general: { ...backup.general, clickMode: ['beat'] } }, [])).toThrow();
  expect(loadPreferences().zoom).toBe(100);
});

it('enables count-in by default and preserves an explicit off preference', () => {
  expect(loadCountIn()).toBe(true);
  localStorage.setItem('sotto.countIn', 'false'); expect(loadCountIn()).toBe(false);
  localStorage.setItem('sotto.countIn', 'true'); expect(loadCountIn()).toBe(true);
});

it('persists and ports per-part instruments while discarding unknown parts and instruments', () => {
  const saved = { ...loadPractice('library:one', score), instruments: { melody: 'bass-electric' as const } };
  savePractice('library:one', saved);
  expect(loadPractice('library:one', score).instruments).toEqual({ melody: 'bass-electric' });
  const backup = exportPreferences(['library:one']);
  expect(parsePreferences(backup, ['library:one'])?.songs['library:one'].instruments).toEqual({ melody: 'bass-electric' });
  remember('sotto.practice.library:one', { instruments: { melody: 'bad', unknown: 'drums' } });
  expect(loadPractice('library:one', score).instruments).toEqual({});
});
