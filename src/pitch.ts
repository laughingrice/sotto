import type { PerformanceNote } from './score';

export type PitchFrame = { time: number; windowSeconds: number; frequency: number | null; clarity: number; rms: number };
export type PitchStats = { matching: number; different: number };
export const emptyPitchStats = (): PitchStats => ({ matching: 0, different: 0 });
export const addPitchStats = (a: PitchStats, b: PitchStats): PitchStats => ({ matching: a.matching + b.matching, different: a.different + b.different });
/** Pitch needs headroom over the learned room floor, independently of plot cropping. */
export const pitchGate = (gateDb: number, backgroundRms?: number) => Math.max(gateDb, backgroundRms ? 20 * Math.log10(Math.max(1e-5, backgroundRms)) + 6 : -Infinity);
export const frequencyMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export function pitchName(midi: number): string {
  const note = Math.round(midi);
  return `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}
export type PitchTarget = { kind: 'note'; key: string; midi: number } | { kind: 'choose-voice' | 'rest' | 'transition' | 'chord' | 'percussion' };

/** Require one sustained sounding pitch throughout the analysis window.
 * Mixed transitions, chords and notes too short for the window stay unscored. */
export function targetPitch(notes: PerformanceNote[], voice: string, beat: number, windowBeats: number, offset = 0): PitchTarget {
  if (voice === 'all') return { kind: 'choose-voice' };
  const left = beat - windowBeats / 2, right = beat + windowBeats / 2;
  const active = notes.filter(note => note.voice === voice && !note.grace && note.start < right && note.end > left);
  if (!active.length) return { kind: 'rest' };
  if (active.some(note => note.percussion)) return { kind: 'percussion' };
  if (new Set(active.map(note => note.midi)).size > 1) {
    const sounding = active.filter(note => note.start <= beat && note.end > beat);
    return { kind: new Set(sounding.map(note => note.midi)).size > 1 ? 'chord' : 'transition' };
  }
  const held = active.filter(note => note.start <= left + 1e-6 && note.end >= right - 1e-6);
  if (held.length !== active.length) return { kind: 'transition' };
  const note = held[0];
  return { kind: 'note', key: `${note.id}@${note.start}`, midi: note.midi + offset };
}

type Votes = { last: number; streak: number; matching: number; different: number; judgment?: keyof PitchStats };
/** Count a target once, with two consistent, clear frames before a vote.
 * Later stable frames can revise the majority; silence never becomes a wrong note. */
export class PitchPass {
  readonly stats = emptyPitchStats();
  private notes = new Map<string, Votes>();
  push(target: PitchTarget, frame: PitchFrame, gateDb: number): void {
    if (target.kind !== 'note' || frame.frequency === null || !Number.isFinite(frame.frequency) || frame.frequency <= 0 || frame.clarity < .9 || frame.rms < 10 ** (gateDb / 20)) return;
    const heard = Math.round(frequencyMidi(frame.frequency));
    const votes = this.notes.get(target.key) ?? { last: heard, streak: 0, matching: 0, different: 0 };
    votes.streak = votes.last === heard ? votes.streak + 1 : 1; votes.last = heard;
    this.notes.set(target.key, votes);
    if (votes.streak < 2) return;
    votes[heard === Math.round(target.midi) ? 'matching' : 'different']++;
    const judgment = votes.matching >= votes.different ? 'matching' : 'different';
    if (votes.judgment === judgment) return;
    if (votes.judgment) this.stats[votes.judgment]--;
    this.stats[judgment]++; votes.judgment = judgment;
  }
}
