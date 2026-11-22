import { expect, it, vi } from 'vitest';
import { includesVoice, mutedParts } from './parts';
import { expectedAttacks } from './rhythm';
import { targetPitch } from './pitch';
import { makePerformance, type Score } from './score';
import { exportPreferences, loadPractice } from './preferences';
const score = { format: 'sotto-score', version: 1, title: 'Parts test', composer: '', subtitle: '', bpm: 100, beatsPerBar: 4, beatUnit: 1, description: '', pages: ['<svg/>'],
  voices: ['a', 'b', 'c'].map(id => ({ id, name: id, color: '#000' })), bars: [{ index: 0, label: '1' }], sequence: [0],
  notes: ['a', 'b', 'c'].map((voice, i) => ({ id: voice, voice, beat: i === 2 ? 2 : 0, grace: 0, midi: 60 + i * 4, duration: 2, bar: 1, tie: false })) } as Score;
it('mutes all selected practice parts for accompaniment without involving score visibility', () => {
  expect([...mutedParts(['a', 'b', 'c'], new Set(), null, 'accompaniment', ['a', 'c'])]).toEqual(['a', 'c']);
  expect([...mutedParts(['a', 'b', 'c'], new Set(), null, 'all', ['a', 'c'])]).toEqual([]);
  expect([...mutedParts(['a', 'b', 'c'], new Set(['b']), 'a', 'all', [])]).toEqual(['b', 'c']);
});
it('targets the union of the chosen parts, excluding all other instruments', () => {
  const performance = makePerformance(score);
  expect(expectedAttacks(performance, ['a', 'b'])).toEqual([0]);
  expect(expectedAttacks(performance, ['b', 'c'])).toEqual([0, 2]);
  expect(expectedAttacks(performance, [])).toEqual([]);
  expect(targetPitch(performance.sounds, ['a', 'b'], .5, .1)).toMatchObject({ kind: 'notes', midis: [60, 64] });
  expect(targetPitch(performance.sounds, ['b'], .5, .1)).toMatchObject({ kind: 'note', midi: 64 });
  expect(targetPitch(performance.sounds, [], .5, .1)).toEqual({ kind: 'rest' });
  expect(includesVoice('all', 'c')).toBe(true);
});
it('migrates old practice selection and round-trips the new part choices through portable backups', () => {
  const values = new Map<string, string>([['sotto.practice.piece', JSON.stringify({ practiceVoice: 'b', hiddenVoices: ['a', 'b', 'c'] })]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  try {
    expect(loadPractice('piece', score)).toMatchObject({ practiceVoices: ['b'], hiddenVoices: [], playbackMode: 'all' });
    values.set('sotto.practice.piece', JSON.stringify({ practiceVoices: ['a', 'c', 'removed'], hiddenVoices: ['b'], playbackMode: 'accompaniment' }));
    expect(loadPractice('piece', score)).toMatchObject({ practiceVoices: ['a', 'c'], hiddenVoices: ['b'], playbackMode: 'accompaniment' });
    expect(exportPreferences(['piece']).songs.piece).toMatchObject({ practiceVoices: ['a', 'c', 'removed'], hiddenVoices: ['b'], playbackMode: 'accompaniment' });
  } finally { vi.unstubAllGlobals(); }
});
