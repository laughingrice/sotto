import { frequencyMidi, type PitchFrame } from './pitch';

/** Confirmation is delayed, but the timestamp is between the last old pitch
 * and first new pitch. No expected score pitches enter this detector. */
export class LegatoDetector {
  private stable?: { midi: number; time: number };
  private candidate?: { midi: number; first: number; last: number; count: number };
  private lastTime = -Infinity;
  private energyAt = -Infinity;
  reset() { this.stable = undefined; this.candidate = undefined; this.lastTime = -Infinity; this.energyAt = -Infinity; }
  energy(time: number) {
    // A pluck already supplies its attack. Establish a fresh pitch baseline
    // from windows wholly after it instead of counting its pitch change again.
    this.energyAt = time; this.stable = undefined; this.candidate = undefined;
    this.lastTime = Math.max(this.lastTime, time);
  }
  push(frame: PitchFrame, gateDb: number): number | null {
    if (frame.time <= this.lastTime) return null;
    this.lastTime = frame.time;
    if (frame.time - frame.windowSeconds / 2 < this.energyAt) return null;
    if (this.stable && frame.time - this.stable.time > .24) this.stable = undefined;
    if (frame.frequency === null || frame.clarity < .94 || frame.rms < 10 ** (gateDb / 20)) {
      this.candidate = undefined; return null;
    }
    const midi = frequencyMidi(frame.frequency);
    if (!Number.isFinite(midi)) return null;
    if (this.stable && Math.abs(midi - this.stable.midi) < .55) {
      this.stable = { midi: this.stable.midi * .8 + midi * .2, time: frame.time };
      this.candidate = undefined; return null;
    }
    // Require a settled pitch rather than counting the semitones crossed by
    // a slide. A slide can contribute one event after its destination settles.
    if (Math.abs(midi - Math.round(midi)) > .35) { this.candidate = undefined; return null; }
    const candidate = this.candidate;
    if (!candidate || Math.abs(midi - candidate.midi) > .35 || frame.time - candidate.last > .12) {
      this.candidate = { midi, first: frame.time, last: frame.time, count: 1 }; return null;
    }
    candidate.count++; candidate.last = frame.time;
    if (candidate.count < 2 || candidate.last - candidate.first < .025) return null;
    const previous = this.stable;
    this.stable = { midi: candidate.midi, time: frame.time }; this.candidate = undefined;
    if (!previous || Math.abs(candidate.midi - previous.midi) < .8) return null;
    // Ringing strings can make the detector switch to an overtone. Avoid
    // claiming these ambiguous changes as legato; energy attacks still work.
    const interval = Math.abs(candidate.midi - previous.midi);
    if ([12, 12 * Math.log2(3), 24].some(harmonic => Math.abs(interval - harmonic) < .4)) return null;
    return (previous.time + candidate.first) / 2;
  }
}

export const LEGATO_LOOKBACK = .28;
export type OnsetSource = 'energy' | 'legato';
export type TimedOnset<T> = { time: number; source: OnsetSource; value: T };
/** Merge asynchronous evidence in audio-time order, preferring a pluck's
 * precise energy timestamp. Never borrow the next score note for a duplicate. */
export class OnsetFusion<T> {
  private pending: TimedOnset<T>[] = [];
  private energy: number[] = [];
  private through = -Infinity;
  reset() { this.pending = []; this.energy = []; this.through = -Infinity; }
  push(event: TimedOnset<T>) {
    if (event.time <= this.through) return false;
    if (event.source === 'energy') {
      this.energy.push(event.time);
      this.energy = this.energy.filter(time => time > event.time - 1);
      this.pending = this.pending.filter(item => item.source !== 'legato' || Math.abs(item.time - event.time) > .06);
    } else if (this.energy.some(time => Math.abs(time - event.time) <= .06)) return false;
    this.pending.push(event); return true;
  }
  flush(through: number) {
    if (through <= this.through) return [];
    this.through = through;
    const ready = this.pending.filter(event => event.time <= through).sort((a, b) => a.time - b.time);
    this.pending = this.pending.filter(event => event.time > through);
    return ready;
  }
}
