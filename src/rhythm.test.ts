import { describe, expect, it } from 'vitest';
import { calibrationOffset, estimateBackground, expectedAttacks, OnsetDetector, plotLookAhead, RhythmPass, attackCooldown, emptyStats, emptyTiming, mergeTiming, rhythmReview, traceColumns, traceLevel } from './rhythm';
import { makePerformance, type Score } from './score';
import { readFileSync } from 'node:fs';

describe('rhythm input and timing', () => {
  it('keeps look-ahead independent of plot length while reserving history', () => {
    expect(plotLookAhead(24, 4)).toBe(4);
    expect(plotLookAhead(48, 4)).toBe(4);
    expect(plotLookAhead(6, 16)).toBe(4);
    expect(plotLookAhead(24, 16)).toBe(16);
    expect(plotLookAhead(24, 0)).toBe(0);
  });
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
  it('does not let a duplicate pluck steal the following fast note', () => {
    const pass = new RhythmPass([0, .2, .4], .5, 0);
    expect(pass.attack(0).expectedBeat).toBe(0);
    expect(pass.attack(.04).kind).toBe('extra');
    expect(pass.attack(.2).expectedBeat).toBe(.2);
    expect(pass.attack(.4).expectedBeat).toBe(.4);
    pass.finish(.6);
    expect(pass.stats).toEqual({ onTime: 3, early: 0, late: 0, missed: 0, extra: 1 });
  });
  it('keeps matches in score order after missed notes instead of filling backwards', () => {
    const pass = new RhythmPass([0, 1, 2, 3], .5, 0);
    pass.attack(0); pass.attack(2);
    expect(pass.stats.missed).toBe(1);
    expect(pass.attack(1.1).kind).toBe('extra');
    expect(pass.attack(3).expectedBeat).toBe(3);
    expect(pass.stats.missed).toBe(1);
  });
  it('finalizes only the played interval and never counts a miss twice', () => {
    const pass = new RhythmPass([0, 1, 2, 3], .5, 0);
    pass.attack(0); pass.finish(1.5); pass.finish(1.5); pass.advance(1.5);
    expect(pass.stats.missed).toBe(1);
    expect(pass.attack(2).kind).toBe('on-time');
    const resumed = new RhythmPass([0, 1, 2, 3], .5, 2);
    resumed.finish(3);
    expect(resumed.stats.missed).toBe(1);
  });
  it('detects sixteenth-note attacks at 220 BPM using the score-based cooldown', () => {
    const gap = 60 / 220 / 4;
    const targets = Array.from({ length: 10 }, (_, i) => i * .25);
    const cooldown = attackCooldown(targets, 60 / 220);
    expect(cooldown).toBeLessThan(gap);
    expect(attackCooldown([], .5)).toBe(.085);
    const mixed = [0, 1, 2, 3, 3.1, 3.2, 4, 5, 6, 7, 8, 9, 10];
    expect(attackCooldown(mixed, .5, 3.1)).toBe(.035);
    expect(attackCooldown(mixed, .5, 9)).toBe(.085);
    expect(attackCooldown([0, .001, .002], .5)).toBe(.085);
    const detector = new OnsetDetector();
    const hits = [];
    for (let i = 0; i < 125; i++) {
      const time = i * .01, elapsed = time - .3;
      const age = elapsed < 0 || elapsed >= gap * 10 ? Infinity : elapsed % gap;
      const rms = .0003 + .15 * Math.exp(-age * 90);
      if (detector.push({ time, rms, peak: rms * 2 }, -42, cooldown)) hits.push(time);
    }
    expect(hits).toHaveLength(10);
  });
  it('separates consistent offset from variation and penalizes misses and extras', () => {
    const pass = new RhythmPass([0, 1, 2, 3, 4], .5, 0, 150);
    [90, 110, 90, 110].forEach((ms, i) => pass.attack(i + ms / 500));
    pass.finish(5); pass.attack(5);
    const review = rhythmReview(pass.stats, pass.timing);
    expect(review).toMatchObject({ matched: 4, expected: 5, assessed: 6, onTimePercent: 67, enoughTiming: true });
    expect(review.offsetMs).toBeCloseTo(100);
    expect(review.spreadMs).toBeCloseTo(10);
    expect(review.meanErrorMs).toBeCloseTo(100);
    const pooled = mergeTiming({ count: 1, sumMs: 100, squaredMs: 10000, absoluteMs: 100 },
      { count: 1, sumMs: -100, squaredMs: 10000, absoluteMs: 100 });
    const combined = rhythmReview({ ...emptyStats(), late: 1, early: 1 }, pooled);
    expect(combined.offsetMs).toBe(0); expect(combined.spreadMs).toBe(100); expect(combined.meanErrorMs).toBe(100);
    expect(rhythmReview(emptyStats(), emptyTiming())).toMatchObject({ onTimePercent: null, offsetMs: null, spreadMs: null, enoughTiming: false });
  });
  it('groups chord notes and excludes tied continuations and grace ornaments', () => {
    const score: Score = JSON.parse(readFileSync(new URL('../scripts/fixtures/julia-florida.sotto.json', import.meta.url), 'utf8'));
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
