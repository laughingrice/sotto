import type { Performance } from './score';

export type LevelFrame = { time: number; rms: number; peak: number };
export const TRACE_HISTORY_SECONDS = 50;
export const LOOK_AHEAD_CHOICES = [0, 1, 2, 4, 6, 8, 12, 16, 24, 32, 40];
export function plotLookAhead(span: number, requested: number) {
  // Keep at least two seconds of history without losing the user's preference
  // when temporarily switching to a shorter plot window.
  return LOOK_AHEAD_CHOICES.filter(seconds => seconds <= Math.min(requested, span - 2)).at(-1) ?? 0;
}

/** Preserve the loudest short transient in each screen column when zoomed out. */
export function traceColumns(samples: LevelFrame[], left: number, span: number, width: number) {
  const columns = new Map<number, { x: number; rms: number; peak: number }>();
  for (const sample of samples) {
    if (sample.time < left || sample.time > left + span || width <= 0) continue;
    const x = Math.min(Math.ceil(width) - 1, Math.floor((sample.time - left) / span * width));
    const previous = columns.get(x);
    columns.set(x, { x, rms: Math.max(previous?.rms ?? 0, sample.rms), peak: Math.max(previous?.peak ?? 0, sample.peak) });
  }
  return [...columns.values()].sort((a, b) => a.x - b.x);
}
export type BackgroundLevel = { rms: number; peak: number };
export function estimateBackground(frames: LevelFrame[]): BackgroundLevel {
  const percentile = (key: 'rms' | 'peak') => {
    const values = frames.map(frame => frame[key]).filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    if (!values.length) return 1e-5;
    // Short attacks don't determine the floor. A small display margin below
    // then removes most quiet fluctuations without changing detection.
    return Math.max(1e-5, values[Math.floor((values.length - 1) * .6)]);
  };
  return { rms: percentile('rms'), peak: percentile('peak') };
}
export function traceLevel(amplitude: number, boostDb: number, background?: number) {
  if (background !== undefined) {
    const aboveFloor = Math.max(0, amplitude / Math.max(1e-5, background) - 10 ** (3 / 20));
    return Math.min(1, 20 * Math.log10(1 + aboveFloor * 10 ** (boostDb / 20)) / 36);
  }
  const db = 20 * Math.log10(Math.max(amplitude, 1e-6)) + boostDb;
  return Math.max(0, Math.min(1, (db + 70) / 70));
}
export type Attack = { beat: number; expectedBeat?: number; errorMs: number | null; kind: 'on-time' | 'early' | 'late' | 'extra'; source?: 'energy' | 'legato' };
export type RhythmStats = { onTime: number; early: number; late: number; missed: number; extra: number };
export const emptyStats = (): RhythmStats => ({ onTime: 0, early: 0, late: 0, missed: 0, extra: 0 });

export type TimingMoments = { count: number; sumMs: number; squaredMs: number; absoluteMs: number };
export const emptyTiming = (): TimingMoments => ({ count: 0, sumMs: 0, squaredMs: 0, absoluteMs: 0 });
export function mergeTiming(a: TimingMoments, b: TimingMoments): TimingMoments {
  return { count: a.count + b.count, sumMs: a.sumMs + b.sumMs,
    squaredMs: a.squaredMs + b.squaredMs, absoluteMs: a.absoluteMs + b.absoluteMs };
}
export function rhythmReview(stats: RhythmStats, timing: TimingMoments) {
  const matched = stats.onTime + stats.early + stats.late;
  const expected = matched + stats.missed;
  const assessed = expected + stats.extra;
  const offsetMs = timing.count ? timing.sumMs / timing.count : null;
  return { matched, expected, assessed,
    onTimePercent: assessed ? Math.round(100 * stats.onTime / assessed) : null,
    offsetMs,
    meanErrorMs: timing.count ? timing.absoluteMs / timing.count : null,
    spreadMs: offsetMs === null ? null : Math.sqrt(Math.max(0, timing.squaredMs / timing.count - offsetMs ** 2)),
    enoughTiming: timing.count >= 4,
  };
}
/** Suppress ringing without masking quick subdivisions. Never below 35 ms. */
export function attackCooldown(expected: number[], secondsPerBeat: number, beat?: number) {
  let first = 1, end = expected.length;
  if (beat !== undefined) {
    let low = 0, high = expected.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (expected[middle] < beat) low = middle + 1; else high = middle;
    }
    first = Math.max(1, low - 2); end = Math.min(expected.length, low + 3);
  }
  let shortest = Infinity;
  for (let i = first; i < end; i++) {
    const gap = (expected[i] - expected[i - 1]) * secondsPerBeat;
    if (gap > .015) shortest = Math.min(shortest, gap);
  }
  return Math.max(.035, Math.min(.085, shortest * .55));
}

/** Energy-rise detector. Timestamps come from the audio thread, not UI timers.
 * Refractory time suppresses a single pluck's ringing; the gate excludes noise.
 * This first detector does not separate simultaneous instruments or pitches. */
export class OnsetDetector {
  private envelope = 0;
  private previous = 0;
  private last = -Infinity;
  private frames = 0;
  reset() { this.envelope = 0; this.previous = 0; this.last = -Infinity; this.frames = 0; }
  push(frame: LevelFrame, gateDb = -42, cooldown = .085): boolean {
    const floor = 10 ** (gateDb / 20);
    const attack = frame.rms >= floor && frame.rms > Math.max(floor, this.envelope) * 1.65 &&
      frame.rms - this.previous > floor * .25 && frame.time - this.last >= cooldown && this.frames > 2;
    this.envelope = this.envelope * .82 + frame.rms * .18;
    this.previous = frame.rms; this.frames++;
    if (attack) this.last = frame.time;
    return attack;
  }
}

/** Chords count as one attack. Tied continuations and ornamental grace notes
 * are not extra expected attacks in the first rhythm-feedback version. */
export function expectedAttacks(performance: Performance, voice: string): number[] {
  const beats = performance.sounds.filter(note => !note.grace && (voice === 'all' || note.voice === voice))
    .map(note => note.start).sort((a, b) => a - b);
  return beats.filter((beat, index) => !index || beat - beats[index - 1] > .015);
}

export class RhythmPass {
  private used = new Set<number>();
  private expired = new Set<number>();
  private lastMatched = -1;
  private nextDeadline = 0;
  readonly stats = emptyStats();
  readonly timing = emptyTiming();
  readonly windowMs: number;
  constructor(readonly expected: number[], readonly secondsPerBeat: number, readonly startBeat: number, readonly toleranceMs = 80) {
    this.windowMs = Math.max(200, toleranceMs * 2);
  }
  private miss(index: number) {
    if (!this.used.has(index) && !this.expired.has(index)) {
      this.expired.add(index); this.stats.missed++;
    }
  }
  advance(beat: number) {
    while (this.nextDeadline < this.expected.length) {
      const index = this.nextDeadline;
      const target = this.expected[index];
      if ((beat - target) * this.secondsPerBeat * 1000 <= this.windowMs) break;
      if (target >= this.startBeat - .015) this.miss(index);
      this.nextDeadline++;
    }
  }
  /** Close only the played interval; future notes after pause are not misses. */
  finish(endBeat: number) {
    for (let i = 0; i < this.expected.length && this.expected[i] < endBeat - 1e-6; i++) {
      if (this.expected[i] >= this.startBeat - .015) this.miss(i);
    }
  }
  attack(beat: number): Attack {
    // Find the nearest score position INCLUDING consumed positions. Otherwise
    // ringing near an already matched note can steal the next expected note.
    let low = 0, high = this.expected.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.expected[middle] < beat) low = middle + 1; else high = middle;
    }
    let best = -1, distance = Infinity;
    for (const index of [low - 1, low]) {
      const target = this.expected[index];
      if (target === undefined || target < this.startBeat - .015) continue;
      const delta = Math.abs((beat - target) * this.secondsPerBeat * 1000);
      if (delta <= this.windowMs && delta < distance) { best = index; distance = delta; }
    }
    if (best < 0 || best <= this.lastMatched || this.used.has(best) || this.expired.has(best)) {
      this.stats.extra++; return { beat, errorMs: null, kind: 'extra' };
    }
    for (let i = this.lastMatched + 1; i < best; i++) {
      if (this.expected[i] >= this.startBeat - .015) this.miss(i);
    }
    this.lastMatched = best; this.used.add(best);
    const errorMs = (beat - this.expected[best]) * this.secondsPerBeat * 1000;
    const kind = Math.abs(errorMs) <= this.toleranceMs ? 'on-time' : errorMs < 0 ? 'early' : 'late';
    this.stats[kind === 'on-time' ? 'onTime' : kind]++;
    this.timing.count++; this.timing.sumMs += errorMs;
    this.timing.squaredMs += errorMs ** 2; this.timing.absoluteMs += Math.abs(errorMs);
    return { beat, expectedBeat: this.expected[best], errorMs, kind };
  }
}

export function calibrationOffset(expected: number[], detected: number[]): number {
  const used = new Set<number>();
  const delays: number[] = [];
  for (const time of expected) {
    const index = detected.findIndex((attack, i) => !used.has(i) && attack >= time - .015 && attack <= time + .6);
    if (index >= 0) { used.add(index); delays.push((detected[index] - time) * 1000); }
  }
  if (delays.length < Math.max(4, expected.length - 2)) throw new Error('Too few calibration clicks were heard. Try speakers in a quiet room, raise the volume, or adjust the offset manually.');
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const center = median(delays);
  const deviations = delays.map(delay => Math.abs(delay - center));
  if (median(deviations) > 25) throw new Error('Calibration timing was inconsistent. Try again in a quiet room or adjust the offset manually.');
  const good = delays.filter(delay => Math.abs(delay - center) <= 50);
  if (good.length < 4) throw new Error('Calibration needs at least four consistent clicks.');
  return Math.max(-50, Math.min(600, Math.round(median(good))));
}
