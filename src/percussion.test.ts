import { describe, expect, it } from 'vitest';
import { DRUM_KEYS } from './drum-kit';
import { playbackMidi, makePerformance, validateScore, type Score } from './score';

describe('percussion playback', () => {
  it('maps General MIDI drum keys to explicit acoustic one-shots', () => {
    expect([36, 38, 42, 46, 49, 51].map(midi => DRUM_KEYS[midi])).toEqual(['kick', 'snare', 'hihat-closed', 'hihat-open', 'crash', 'ride']);
    expect(DRUM_KEYS[60]).toBeUndefined();
  });

  it('keeps simultaneous percussion separate from pitched playback and octave changes', () => {
    const score: Score = {
      format: 'sotto-score', version: 1, title: 'Bass and drums', composer: '', subtitle: '', description: '',
      beatsPerBar: 4, beatUnit: 1, bpm: 80, pages: ['<svg></svg>'],
      voices: [{ id: 'bass', name: 'Bass', color: 'green' }, { id: 'drums', name: 'Drums', color: 'blue', percussion: true }],
      bars: [{ index: 0, label: '1', start: 0, duration: 4, meter: [4, 4] }], sequence: [0],
      notes: [{ id: 'bass', voice: 'bass', beat: 0, grace: 0, midi: 40, duration: .5, bar: 1, tie: false },
        ...[36, 38, 42, 46].map((midi, i) => ({ id: `drum-${i}`, voice: 'drums', beat: i * .5, grace: 0, midi, duration: .5, bar: 1, tie: false, percussion: true }))],
    };
    validateScore(score);
    expect(score.voices.map(v => [v.id, !!v.percussion])).toEqual([['bass', false], ['drums', true]]);
    const performance = makePerformance(score);
    expect(performance.duration).toBe(4);
    const drums = performance.sounds.filter(note => note.percussion);
    const bass = performance.sounds.filter(note => !note.percussion);
    expect(bass).toHaveLength(1);
    expect(drums).toHaveLength(4);
    expect(bass[0].start).toBe(drums[0].start);
    expect(bass[0].midi).toBe(40);
    expect(new Set(drums.map(note => note.midi))).toEqual(new Set([36, 38, 42, 46]));
    for (const offset of [-12, 12]) {
      expect(playbackMidi(bass[0], offset)).toBe(40 + offset);
      for (const drum of drums) expect(playbackMidi(drum, offset)).toBe(drum.midi);
    }
  });
});
