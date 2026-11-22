import { includesVoice, multipleVoices, type VoiceSelection } from './parts';
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
export type PitchTarget = { kind: 'note'; key: string; midi: number; beat: number }
  | { kind: 'notes'; key: string; midis: number[]; beat: number }
  | { kind: 'rest' | 'transition' | 'chord' | 'percussion' };

/** Require a stable target throughout the analysis window. Individual voices
 * score a single pitch; All accepts one heard member of the sounding pitch set.
 * This is not polyphonic chord recognition. Transitions stay unscored. */
export function targetPitch(notes: PerformanceNote[], voice: VoiceSelection, beat: number, windowBeats: number, offset = 0): PitchTarget {
  const left = beat - windowBeats / 2, right = beat + windowBeats / 2;
  const sounding = notes.filter(note => includesVoice(voice, note.voice) && !note.grace && note.start < right && note.end > left);
  if (!sounding.length) return { kind: 'rest' };
  const active = sounding.filter(note => !note.percussion);
  if (!active.length || (!multipleVoices(voice) && sounding.some(note => note.percussion))) return { kind: 'percussion' };
  if (multipleVoices(voice)) {
    if (active.some(note => note.start > left + 1e-6 || note.end < right - 1e-6)) return { kind: 'transition' };
    // Detect the played pitch independently, then test membership of this
    // stable sounding set. This never claims that a complete chord was heard.
    return { kind: 'notes', key: active.map(note => `${note.id}@${note.start}`).sort().join('|'),
      midis: [...new Set(active.map(note => note.midi + offset))].sort((a, b) => a - b),
      beat: Math.max(...active.map(note => note.start)) };
  }
  if (new Set(active.map(note => note.midi)).size > 1) {
    const sounding = active.filter(note => note.start <= beat && note.end > beat);
    return { kind: new Set(sounding.map(note => note.midi)).size > 1 ? 'chord' : 'transition' };
  }
  const held = active.filter(note => note.start <= left + 1e-6 && note.end >= right - 1e-6);
  if (held.length !== active.length) return { kind: 'transition' };
  const note = held[0];
  return { kind: 'note', key: `${note.id}@${note.start}`, midi: note.midi + offset, beat: note.start };
}

type Votes = { last: number; streak: number; matching: number; different: number; judgment?: keyof PitchStats };
/** Count a target once, with two consistent, clear frames before a vote.
 * Later stable frames can revise the majority; silence never becomes a wrong note. */
export class PitchPass {
  readonly stats = emptyPitchStats();
  private notes = new Map<string, Votes>();
  judgment(key: string) { return this.notes.get(key)?.judgment; }
  push(target: PitchTarget, frame: PitchFrame, gateDb: number): void {
    if ((target.kind !== 'note' && target.kind !== 'notes') || frame.frequency === null || !Number.isFinite(frame.frequency) || frame.frequency <= 0 || frame.clarity < .9 || frame.rms < 10 ** (gateDb / 20)) return;
    const heard = Math.round(frequencyMidi(frame.frequency));
    const votes = this.notes.get(target.key) ?? { last: heard, streak: 0, matching: 0, different: 0 };
    votes.streak = votes.last === heard ? votes.streak + 1 : 1; votes.last = heard;
    this.notes.set(target.key, votes);
    if (votes.streak < 2) return;
    const expected = target.kind === 'notes' ? target.midis : [target.midi];
    votes[expected.some(midi => heard === Math.round(midi)) ? 'matching' : 'different']++;
    const judgment = votes.matching >= votes.different ? 'matching' : 'different';
    if (votes.judgment === judgment) return;
    if (votes.judgment) this.stats[votes.judgment]--;
    this.stats[judgment]++; votes.judgment = judgment;
  }
}
