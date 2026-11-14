import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { activeNotes, clockTime, makePerformance, measureAt, loopDisplayBeat, validateScore, type Score } from './score';

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
  it('uses explicit bar boundaries across meter changes, silent bars, pickups and repeats', () => {
    const mixed: Score = { ...score, beatsPerBar: 3, beatUnit: 1,
      bars: [
        { index: 0, label: '0', start: 0, duration: 1, meter: [3, 4] },
        { index: 1, label: '1', start: 1, duration: 3, meter: [3, 4] },
        { index: 2, label: '2', start: 4, duration: 4, meter: [4, 4] },
        { index: 3, label: '3', start: 8, duration: 4, meter: [4, 4] },
      ], sequence: [0, 1, 2, 1, 3],
      notes: [0, 1, 2].map((measure, index) => ({ ...score.notes[0], id: `note-${index}`, beat: [0, 1, 4][index], duration: 1, measure, tie: false })),
    };
    validateScore(mixed);
    const performance = makePerformance(mixed);
    expect(performance.measures.map(m => [m.start, m.end])).toEqual([[0, 1], [1, 4], [4, 8], [8, 11], [11, 15]]);
    expect(performance.notes.map(n => n.start)).toEqual([0, 1, 4, 8]);
    expect(performance.duration).toBe(15);
    expect(measureAt(performance, 4).meter).toEqual([4, 4]);
    expect(measureAt(performance, 8).written).toBe(1);
    const inferred = { ...mixed, notes: mixed.notes.map(({ measure: _measure, ...note }) => note) };
    expect(makePerformance(inferred).notes.map(n => n.start)).toEqual([0, 1, 4, 8]);
    expect(() => validateScore({ ...mixed, bars: mixed.bars.map((bar, index) => index === 2 ? { ...bar, start: 3 } : bar) })).toThrow();
  });
});

it('keeps loop display inside the selected bars until the clock wraps', () => {
  const performance = makePerformance(score);
  const start = performance.measures[1].start, end = performance.measures[3].end;
  expect(loopDisplayBeat(start + .5, start, end)).toBe(start + .5);
  for (const beat of [end, end + .001, end + .15]) {
    const display = loopDisplayBeat(beat, start, end);
    expect(display).toBeLessThan(end);
    expect(measureAt(performance, display).index).toBe(3);
    expect(activeNotes(performance, display).every(note => note.start < end)).toBe(true);
  }
  expect(loopDisplayBeat(start, start, end)).toBe(start);
  expect(loopDisplayBeat(start - .01, start, end)).toBe(start);
  expect(measureAt(performance, end).index).toBe(4); // Normal following still advances.
});

it('displays an old duplicated opening pickup as bar zero without renumbering full bars', () => {
  const pickup: Score = { ...score, beatsPerBar: 4, bars: [
    { index: 0, label: '1', start: 0, duration: .5, meter: [4, 4] },
    { index: 1, label: '1', start: .5, duration: 4, meter: [4, 4] },
    { index: 2, label: '2', start: 4.5, duration: 4, meter: [4, 4] },
  ], sequence: [0, 1, 2], notes: [] };
  expect(makePerformance(pickup).measures.map(bar => bar.label)).toEqual(['0', '1', '2']);
});
