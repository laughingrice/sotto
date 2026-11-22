import { describe, expect, it } from 'vitest';
import { LegatoDetector, OnsetFusion, LEGATO_LOOKBACK } from './legato';
import { PitchAnalysis } from './pitch-detect';
import { OnsetDetector } from './rhythm';
import type { PitchFrame } from './pitch';
const frame = (time: number, midi: number | null, extra = {}): PitchFrame => ({ time, frequency: midi === null ? null : 440 * 2 ** ((midi - 69) / 12), rms: .1, clarity: .99, windowSeconds: .085, ...extra });

describe('legato rhythm', () => {
  it('confirms hammer-ons and pull-offs at their transition time, not confirmation time', () => {
    const detector = new LegatoDetector();
    expect(detector.push(frame(0, 40), -42)).toBeNull();
    expect(detector.push(frame(.04, 40), -42)).toBeNull();
    detector.push(frame(.08, 40), -42);
    expect(detector.push(frame(.12, 42), -42)).toBeNull();
    expect(detector.push(frame(.16, 42), -42)).toBeCloseTo(.1);
    detector.push(frame(.2, 42), -42);
    detector.push(frame(.24, 40), -42);
    expect(detector.push(frame(.28, 40), -42)).toBeCloseTo(.22);
  });
  it('ignores vibrato, isolated glitches, quiet input, rests and harmonic flips', () => {
    const detector = new LegatoDetector(); let time = 0;
    const send = (midi: number | null, extra = {}) => { const result = detector.push(frame(time, midi, extra), -42); time += .04; return result; };
    expect(send(55)).toBeNull(); expect(send(55)).toBeNull();
    for (let i = 0; i < 30; i++) expect(send(55 + .3 * Math.sin(i))).toBeNull();
    expect(send(57)).toBeNull(); expect(send(55)).toBeNull();
    expect(send(57, { clarity: .7 })).toBeNull(); expect(send(57, { rms: .0001 })).toBeNull();
    for (let i = 0; i < 10; i++) expect(send(null)).toBeNull();
    expect(send(60)).toBeNull(); expect(send(60)).toBeNull();
    expect(send(72)).toBeNull(); expect(send(72)).toBeNull();
    expect(send(60)).toBeNull(); expect(send(60)).toBeNull();
  });
  it('uses a fresh baseline after a pluck, even when its new pitch arrives late', () => {
    const detector = new LegatoDetector();
    detector.push(frame(.8, 55), -42); detector.push(frame(.84, 55), -42);
    detector.energy(1);
    for (const time of [1.01, 1.04, 1.08, 1.12, 1.16]) expect(detector.push(frame(time, 57), -42)).toBeNull();
    detector.push(frame(1.2, 59), -42);
    expect(detector.push(frame(1.24, 59), -42)).toBeCloseTo(1.18);
  });
  it('merges a pluck and delayed pitch change without merging separate fast plucks', () => {
    for (const order of ['energy-first', 'legato-first']) {
      const fusion = new OnsetFusion<string>();
      const energy = { time: 1, source: 'energy' as const, value: 'pluck' };
      const pitch = { time: 1.025, source: 'legato' as const, value: 'same note' };
      if (order === 'energy-first') { fusion.push(energy); fusion.push(pitch); }
      else { fusion.push(pitch); fusion.push(energy); }
      fusion.push({ time: 1.07, source: 'energy', value: 'next fast pluck' });
      fusion.push({ time: 1.3, source: 'legato', value: 'hammer-on' });
      expect(fusion.flush(1.07)).toEqual([energy, { time: 1.07, source: 'energy', value: 'next fast pluck' }]);
      expect(fusion.flush(1.5)).toEqual([{ time: 1.3, source: 'legato', value: 'hammer-on' }]);
      expect(fusion.push(pitch)).toBe(false);
    }
  });
  it('keeps a delayed pre-loop event with its old attempt and flushes chronologically', () => {
    const fusion = new OnsetFusion<number>();
    fusion.push({ time: 2.01, source: 'energy', value: 2 });
    fusion.push({ time: 1.9, source: 'legato', value: 1 });
    expect(fusion.flush(2.1 - LEGATO_LOOKBACK)).toEqual([]);
    expect(fusion.flush(2.4 - LEGATO_LOOKBACK).map(event => event.value)).toEqual([1, 2]);
    fusion.reset(); expect(fusion.push({ time: 0, source: 'energy', value: 3 })).toBe(true);
  });
  it('recovers actual constant-volume low-string pitch changes that the energy detector misses', () => {
    const rate = 48000, length = rate * 2, samples = new Float32Array(length); let phase = 0;
    for (let i = 0; i < length; i++) {
      const time = i / rate, midi = time < .5 ? 40 : time < .9 ? 42 : time < 1.3 ? 40 : 43;
      phase += 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) / rate;
      samples[i] = .12 * Math.sin(phase);
    }
    const detector = new LegatoDetector(), analysis = new PitchAnalysis(), hits: number[] = [];
    for (let end = 8192; end < length; end += 1920) {
      const result = analysis.analyze(samples.subarray(end - 8192, end), rate, (end - 4096) / rate);
      const at = detector.push(result, -42); if (at !== null) hits.push(at);
    }
    expect(hits).toHaveLength(3);
    for (const [i, expected] of [.5, .9, 1.3].entries()) expect(Math.abs(hits[i] - expected)).toBeLessThan(.07);
    const energy = new OnsetDetector(); let energyHits = 0;
    for (let time = 0; time < 2; time += .01) if (energy.push({ time, rms: .085, peak: .12 })) energyHits++;
    expect(energyHits).toBe(0);
  });
});
