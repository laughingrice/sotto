import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { activeNotes, clockTime, makePerformance, measureAt, validateScore, type Score } from './score';

const score: Score = JSON.parse(readFileSync(new URL('../public/scores/julia-florida.sotto.json', import.meta.url), 'utf8'));

describe('performance order and note mapping', () => {
  it('exports every notehead and all three independent voices', () => {
    validateScore(score);
    expect(score.notes).toHaveLength(500);
    expect(new Set(score.notes.map(note => note.voice))).toEqual(new Set(['melody', 'middle', 'bass']));
    const svg = score.pages.join('');
    for (const note of score.notes) expect(svg).toContain(`id="${note.id}"`);
    expect(score.notes[0].midi).toBe(38); // Guitar low D3 written → D2 sounding.
  });
  it('takes the first ending, repeats B, takes the second ending, then executes D.C. al Coda', () => {
    const performance = makePerformance(score);
    const written = performance.measures.map(measure => measure.written);
    expect(written.slice(0, 32)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(written.slice(32, 42)).toEqual(Array.from({ length: 10 }, (_, i) => i + 20));
    expect(written.slice(42, 66)).toEqual(Array.from({ length: 24 }, (_, i) => i + 32));
    expect(written.slice(66, 83)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(written.slice(83)).toEqual([56, 57, 58, 59, 60]);
    expect(performance.duration).toBe(264);
    expect(performance.measures[32].occurrence).toBe(2);
    expect(performance.measures[66].label).toBe('1');
    expect(performance.measures[83].label).toBe('55');
  });
  it('keeps score identities across repeated appearances and sustains ties', () => {
    const performance = makePerformance(score);
    const tied = performance.notes.find(note => note.tie)!;
    expect(tied).toBeDefined();
    const sounding = performance.sounds.find(note => note.id === tied.id && note.start === tied.start)!;
    expect(sounding.end).toBeGreaterThan(tied.end);
    const firstNote = performance.notes[0];
    expect(performance.notes.filter(note => note.id === firstNote.id)).toHaveLength(2);
    expect(activeNotes(performance, .1).map(note => note.id)).toContain(firstNote.id);
    expect(activeNotes(performance, .6).some(note => note.voice === 'middle')).toBe(true);
  });
  it('can play the written order without repeats and finds measures at boundaries', () => {
    const performance = makePerformance(score, false);
    expect(performance.measures).toHaveLength(61);
    expect(measureAt(performance, 3).index).toBe(1);
    expect(measureAt(performance, 999).index).toBe(60);
    expect(clockTime(66, 44, 1.5)).toBe('1:00');
  });
  it('rejects corrupt or incompatible imports', () => {
    expect(() => validateScore({ ...score, sequence: [999] })).toThrow();
    expect(() => validateScore({ ...score, notes: [{ ...score.notes[0], midi: NaN }] })).toThrow();
    expect(() => validateScore({ ...score, beatsPerBar: 0 })).toThrow();
    expect(() => validateScore({ format: 'midi' })).toThrow();
  });
});
