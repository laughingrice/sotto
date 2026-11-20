import type { Attack, LevelFrame } from './rhythm';
import type { Measure } from './score';

export type FeedbackPoint = { beat: number; rms: number; peak: number };
export type FeedbackTake = { visit: string; points: Map<number, FeedbackPoint>; attacks: (Attack & { position: number })[];
  pitches: Map<string, { beat: number; matching: boolean }> };

/** Small, score-positioned summaries, not audio. Six visits allow five ghosts.
 * Bin envelopes by bar position so a long held note cannot grow storage forever. */
export class ScoreFeedbackHistory {
  readonly bars = new Map<number, FeedbackTake[]>();
  private run = 0;
  beginPass() { this.run++; }
  clear() { this.bars.clear(); this.beginPass(); }
  private take(measure: Measure) {
    const visit = `${this.run}:${measure.index}`;
    const takes = this.bars.get(measure.written) ?? [];
    if (takes.at(-1)?.visit !== visit) {
      takes.push({ visit, points: new Map(), attacks: [], pitches: new Map() });
      if (takes.length > 6) takes.shift();
      this.bars.set(measure.written, takes);
    }
    return takes.at(-1)!;
  }
  push(measure: Measure, beat: number, frame: LevelFrame, attack?: Attack) {
    const take = this.take(measure), position = Math.max(0, Math.min(measure.end - measure.start, beat - measure.start));
    const bin = Math.min(255, Math.floor(position / (measure.end - measure.start) * 256));
    const previous = take.points.get(bin);
    take.points.set(bin, { beat: previous?.beat ?? position, rms: Math.max(previous?.rms ?? 0, frame.rms), peak: Math.max(previous?.peak ?? 0, frame.peak) });
    if (attack && take.attacks.length < 256) take.attacks.push({ ...attack, position });
  }
  pitch(measure: Measure, key: string, beat: number, matching: boolean) {
    this.take(measure).pitches.set(key, { beat: beat - measure.start, matching });
  }
  visible(written: number, history: number) {
    return (this.bars.get(written) ?? []).slice(-(history + 1));
  }
}

export type BeatAnchor = { beat: number; x: number };
/** Engraved spacing is nonlinear: interpolate between actual notehead anchors. */
export function feedbackX(anchors: BeatAnchor[], beat: number) {
  if (beat <= anchors[0].beat) return anchors[0].x;
  for (let i = 1; i < anchors.length; i++) {
    if (beat <= anchors[i].beat) {
      const a = anchors[i - 1], b = anchors[i];
      return a.x + (b.x - a.x) * (beat - a.beat) / (b.beat - a.beat);
    }
  }
  return anchors.at(-1)!.x;
}

/** Fast headroom recovery, slow gain recovery. Silence never pumps the gain.
 * This changes display scaling only; attack/pitch gates keep their raw levels. */
export class AdaptiveTrace {
  ceilingDb = -30;
  private frames: { time: number; db: number }[] = [];
  private lastEstimate: number | null = null;
  reset() { this.frames = []; this.lastEstimate = null; this.ceilingDb = -30; }
  push(frame: LevelFrame, backgroundPeak = 1e-5) {
    this.frames = this.frames.filter(item => item.time > frame.time - 4);
    if (frame.peak < backgroundPeak * 2 || frame.peak < 1e-5) return;
    this.frames.push({ time: frame.time, db: 20 * Math.log10(frame.peak) });
    if (this.lastEstimate !== null && frame.time - this.lastEstimate < .1 && this.frames.length > 1) return;
    const dt = this.lastEstimate === null ? .1 : Math.max(0, Math.min(.2, frame.time - this.lastEstimate));
    this.lastEstimate = frame.time;
    // Re-estimate at most every 100 ms, rather than for each audio block.
    const values = this.frames.filter((_, i) => i % 4 === 0).map(item => item.db).sort((a, b) => a - b);
    const target = Math.min(0, Math.max(20 * Math.log10(backgroundPeak) + 15, values[Math.floor((values.length - 1) * .95)] + 6));
    if (this.frames.length === 1) this.ceilingDb = target;
    else if (target > this.ceilingDb) this.ceilingDb = Math.min(target, this.ceilingDb + dt * 60);
    else this.ceilingDb = Math.max(target, this.ceilingDb - dt * 3);
  }
}
export function adaptiveTraceLevel(amplitude: number, boostDb: number, background: number | undefined, ceilingDb: number) {
  const floor = Math.max(1e-5, background ?? 1e-4);
  const above = Math.max(0, amplitude / floor - 10 ** (3 / 20));
  const range = Math.max(15, ceilingDb - 20 * Math.log10(floor));
  return Math.max(0, Math.min(1, 20 * Math.log10(1 + above) / range * 10 ** ((boostDb - 12) / 40)));
}
