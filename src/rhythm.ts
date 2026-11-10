import type { Performance } from './score';

export type LevelFrame = { time: number; rms: number; peak: number };
export const TRACE_HISTORY_SECONDS = 50;

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
export function traceLevel(amplitude: number, boostDb: number) {
  const db = 20 * Math.log10(Math.max(amplitude, 1e-6)) + boostDb;
  return Math.max(0, Math.min(1, (db + 70) / 70));
}
export type Attack = { beat: number; errorMs: number | null; kind: 'on-time' | 'early' | 'late' | 'extra' };
export type RhythmStats = { onTime: number; early: number; late: number; missed: number; extra: number };
export const emptyStats = (): RhythmStats => ({ onTime: 0, early: 0, late: 0, missed: 0, extra: 0 });

/** Energy-rise detector. Timestamps come from the audio thread, not UI timers.
 * Refractory time suppresses a single pluck's ringing; the gate excludes noise.
 * This first detector does not separate simultaneous instruments or pitches. */
export class OnsetDetector {
  private envelope = 0;
  private previous = 0;
  private last = -Infinity;
  private frames = 0;
  reset() { this.envelope = 0; this.previous = 0; this.last = -Infinity; this.frames = 0; }
  push(frame: LevelFrame, gateDb = -42): boolean {
    const floor = 10 ** (gateDb / 20);
    const attack = frame.rms >= floor && frame.rms > Math.max(floor, this.envelope) * 1.65 &&
      frame.rms - this.previous > floor * .25 && frame.time - this.last >= .085 && this.frames > 2;
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
  readonly stats = emptyStats();
  readonly windowMs: number;
  constructor(readonly expected: number[], readonly secondsPerBeat: number, readonly startBeat: number, readonly toleranceMs = 80) {
    this.windowMs = Math.max(200, toleranceMs * 2);
  }
  advance(beat: number) {
    this.expected.forEach((target, index) => {
      if (target >= this.startBeat - .015 && (beat - target) * this.secondsPerBeat * 1000 > this.windowMs && !this.used.has(index) && !this.expired.has(index)) {
        this.expired.add(index); this.stats.missed++;
      }
    });
  }
  attack(beat: number): Attack {
    let best = -1, distance = Infinity;
    this.expected.forEach((target, index) => {
      if (target < this.startBeat - .015 || this.used.has(index) || this.expired.has(index)) return;
      const delta = Math.abs((beat - target) * this.secondsPerBeat * 1000);
      if (delta <= this.windowMs && delta < distance) { best = index; distance = delta; }
    });
    if (best < 0) { this.stats.extra++; return { beat, errorMs: null, kind: 'extra' }; }
    this.used.add(best);
    const errorMs = (beat - this.expected[best]) * this.secondsPerBeat * 1000;
    const kind = Math.abs(errorMs) <= this.toleranceMs ? 'on-time' : errorMs < 0 ? 'early' : 'late';
    this.stats[kind === 'on-time' ? 'onTime' : kind]++;
    return { beat, errorMs, kind };
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
