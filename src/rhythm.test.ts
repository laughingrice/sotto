import { describe, expect, it } from 'vitest';
import { calibrationOffset, estimateBackground, expectedAttacks, OnsetDetector, RhythmPass, traceColumns, traceLevel } from './rhythm';
import { makePerformance, type Score } from './score';
import { readFileSync } from 'node:fs';

describe('rhythm input and timing', () => {
  it('learns background without brief plucks lifting the floor, and crops it visually', () => {
    const frames = Array.from({ length: 200 }, (_, i) => ({ time: i / 100,
      rms: i % 20 === 0 ? .2 : .005, peak: i % 20 === 0 ? .5 : .015 }));
    const floor = estimateBackground(frames);
    expect(floor).toEqual({ rms: .005, peak: .015 });
    expect(traceLevel(.005, 12, floor.rms)).toBe(0);
    expect(traceLevel(.006, 12, floor.rms)).toBe(0);
    expect(traceLevel(.02, 12, floor.rms)).toBeGreaterThan(.5);
    expect(traceLevel(.1, 12, floor.rms)).toBeGreaterThan(traceLevel(.02, 12, floor.rms));
    expect(Number.isFinite(traceLevel(0, 12, estimateBackground([]).rms))).toBe(true);
  });
  it('keeps short peaks visible when many input windows share a screen pixel', () => {
    const columns = traceColumns([
      { time: 10.001, rms: .001, peak: .002 },
      { time: 10.002, rms: .1, peak: .5 },
      { time: 10.003, rms: .001, peak: .002 },
      { time: -1, rms: 1, peak: 1 },
    ], 0, 24, 300);
    expect(columns).toEqual([{ x: 125, rms: .1, peak: .5 }]);
    expect(traceLevel(.001, 12)).toBeGreaterThan(traceLevel(.001, 0));
    expect(traceLevel(1, 36)).toBe(1);
    expect(traceLevel(0, 0)).toBe(0);
  });
  it('detects separate plucks, ignores quiet input and suppresses ringing', () => {
    const detector = new OnsetDetector();
    const hits: number[] = [];
    for (let i = 0; i < 200; i++) {
      const time = i / 100;
      const age = time < .5 ? Infinity : time < 1.2 ? time - .5 : time - 1.2;
      const rms = .0003 + .1 * Math.exp(-age * 18);
      if (detector.push({ time, rms, peak: rms * 2 }, -42)) hits.push(time);
    }
    expect(hits).toEqual([.5, 1.2]);
  });
  it('matches each attack once and distinguishes early, late, missed and extra', () => {
    const pass = new RhythmPass([0, 1, 2, 3], .5, 0, 60);
    expect(pass.attack(.02).kind).toBe('on-time');
    expect(pass.attack(.04).kind).toBe('extra');
    expect(pass.attack(.8).kind).toBe('early');
    expect(pass.attack(2.25).kind).toBe('late');
    pass.advance(3.5);
    expect(pass.stats).toEqual({ onTime: 1, early: 1, late: 1, missed: 1, extra: 1 });
  });
  it('does not penalize notes before a seek or resume, and applies a calibrated offset', () => {
    const pass = new RhythmPass([0, 1, 2, 3, 4], .5, 3, 50);
    // A pluck captured 120 ms late is on time after compensating the input.
    const capturedSeconds = 1.5 + .12;
    expect(pass.attack((capturedSeconds - .12) / .5).errorMs).toBeCloseTo(0);
    pass.advance(4.6);
    expect(pass.stats.missed).toBe(1);
  });
  it('groups chord notes and excludes tied continuations and grace ornaments', () => {
    const score: Score = JSON.parse(readFileSync(new URL('../public/scores/julia-florida.sotto.json', import.meta.url), 'utf8'));
    const performance = makePerformance(score);
    const attacks = expectedAttacks(performance, 'melody');
    expect(new Set(attacks).size).toBe(attacks.length);
    const tied = performance.notes.find(note => note.tie && note.voice === 'melody')!;
    const sound = performance.sounds.find(note => note.id === tied.id)!;
    expect(sound.end).toBeGreaterThan(tied.end);
    expect(attacks).toContain(tied.start);
    const fixture = { ...performance, sounds: [
      { ...sound, start: 0, grace: 0 }, { ...sound, start: 0, grace: 0 }, { ...sound, start: .5, grace: -.1 },
    ] };
    expect(expectedAttacks(fixture, 'all')).toEqual([0]);
  });
  it('estimates stable round-trip alignment and rejects absent or inconsistent clicks', () => {
    const clicks = [1, 2, 3, 4, 5, 6];
    expect(calibrationOffset(clicks, [1.12, 2.123, 3.119, 4.121, 5.12, 6.122])).toBeCloseTo(121, 0);
    expect(() => calibrationOffset(clicks, [])).toThrow('Too few');
    expect(() => calibrationOffset(clicks, [1.01, 2.2, 3.4, 4.1, 5.5, 6.3])).toThrow('inconsistent');
  });
});
