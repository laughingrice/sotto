import { describe, expect, it } from 'vitest';
import { clickAccent, clickStep, INSTRUMENTS, isInstrument, countInPattern, metronomePattern } from './sounds';

describe('metronome pulse and accents', () => {
  it('plots the selected pulse in compound meter and keeps bar starts accented', () => {
    const compound = [{ start: 0, end: 3 }];
    expect(metronomePattern(compound, 1.5, 'beat')).toEqual([
      { beat: 0, accent: 'downbeat' }, { beat: 1.5, accent: 'beat' },
    ]);
    const subdivisions = metronomePattern(compound, 1.5, 'subdivision');
    expect(subdivisions.map(click => click.beat)).toEqual([0, .5, 1, 1.5, 2, 2.5]);
    expect(subdivisions.filter(click => click.accent === 'downbeat')).toHaveLength(1);
  });
  it('uses two dotted-quarter beats or six eighth-note subdivisions in 6/8', () => {
    expect(clickStep(1.5, 'beat')).toBe(1.5);
    expect(clickStep(1.5, 'subdivision')).toBe(.5);
    expect([0, .5, 1, 1.5, 2, 2.5, 3].map(beat => clickAccent(beat, 3, 1.5)))
      .toEqual(['downbeat', 'subdivision', 'subdivision', 'beat', 'subdivision', 'subdivision', 'downbeat']);
  });
  it('uses four quarter beats or eight subdivisions in 4/4', () => {
    expect(clickStep(1, 'beat')).toBe(1);
    expect(clickStep(1, 'subdivision')).toBe(.5);
    expect(clickAccent(0, 4, 1)).toBe('downbeat');
    expect(clickAccent(.5, 4, 1)).toBe('subdivision');
    expect(clickAccent(3, 4, 1)).toBe('beat');
    expect(clickAccent(4, 4, 1)).toBe('downbeat');
  });
  it('keeps the accent at bar boundaries despite transport rounding', () => {
    expect(clickAccent(2.9999999, 3, 1.5)).toBe('downbeat');
    expect(clickAccent(4.5000001, 3, 1.5)).toBe('beat');
  });
  it('restarts the accent at each actual bar across 3/4 to 4/4, including a pickup', () => {
    const measures = [{ start: 0, end: 1 }, { start: 1, end: 4 }, { start: 4, end: 8 }, { start: 8, end: 12 }];
    const pattern = metronomePattern(measures, 1, 'beat');
    expect(pattern.filter(click => click.accent === 'downbeat').map(click => click.beat)).toEqual([0, 1, 4, 8]);
    expect(pattern.map(click => click.beat)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(metronomePattern(measures, 1, 'subdivision').filter(click => click.accent === 'subdivision')).toHaveLength(12);
  });
});
describe('synthesized timbres', () => {
  it('offers six validated choices, including recorded violin and rejects arbitrary preferences', () => {
    expect(INSTRUMENTS).toHaveLength(6);
    for (const instrument of INSTRUMENTS) expect(isInstrument(instrument.id)).toBe(true);
    expect(isInstrument('unknown-font')).toBe(false);
    expect(isInstrument(null)).toBe(false);
  });
});

it('counts a full bar in the starting meter, including meter changes and pickups', () => {
  const triple = countInPattern({ start: 0, end: 3, meter: [3, 4] }, 4, 1.5);
  expect(triple.duration).toBe(3);
  expect(triple.clicks.map(click => click.beat)).toEqual([0, 1, 2]);
  expect(countInPattern({ start: 3, end: 7, meter: [4, 4] }, 3, 1).clicks).toHaveLength(4);
  expect(countInPattern({ start: 0, end: .5, meter: [6, 8] }, 3, 1.5).duration).toBe(3);
  expect(countInPattern({ start: 0, end: 3, meter: [6, 8] }, 3, 1.5).clicks.map(click => click.beat)).toEqual([0, 1.5]);
});
