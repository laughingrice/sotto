import { makePerformance, type Score } from './score';
import type { ClickMode } from './sounds';

export type MetronomeMode = 'off' | 'playback' | 'continuous';
export type Preferences = { zoom: number; follow: boolean; clickVolume: number; clickMode: ClickMode; metronomeMode: MetronomeMode; rhythmVisible: boolean };
export type PracticeSettings = { bpm: number; beat: number; repeats: boolean; loop: boolean; loopStart: number; loopEnd: number;
  muted: string[]; solo: string | null; volumes: Record<string, number>; pitchOffset: number; practiceVoice: string };
const read = (key: string): Record<string, unknown> => {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
};
const number = (value: unknown, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
const boolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
export function remember(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } }
export function lastScore(): string | null { const value = read('sotto.session'); return typeof value.score === 'string' ? value.score : null; }
export function rememberScore(score: string) { remember('sotto.session', { score }); }
export function loadPreferences(): Preferences {
  const value = read('sotto.preferences');
  return { zoom: number(value.zoom, 100, 50, 250), follow: boolean(value.follow, true), clickVolume: number(value.clickVolume, 70, 0, 100),
    clickMode: value.clickMode === 'subdivision' ? 'subdivision' : 'beat',
    metronomeMode: value.metronomeMode === 'playback' || value.metronomeMode === 'continuous' ? value.metronomeMode : 'off', rhythmVisible: boolean(value.rhythmVisible, false) };
}
export function loadPractice(key: string, score: Score): PracticeSettings {
  const value = read(`sotto.practice.${key}`);
  const repeats = boolean(value.repeats, true), performance = makePerformance(score, repeats);
  const voice = (id: unknown): id is string => typeof id === 'string' && score.voices.some(item => item.id === id);
  const loopStart = Math.floor(number(value.loopStart, 0, 0, performance.measures.length - 1));
  const loopEnd = Math.floor(number(value.loopEnd, Math.min(3, performance.measures.length - 1), loopStart, performance.measures.length - 1));
  const loop = boolean(value.loop, false);
  const volumes = Object.fromEntries(score.voices.flatMap(item => {
    const saved = value.volumes && typeof value.volumes === 'object' ? (value.volumes as Record<string, unknown>)[item.id] : undefined;
    return typeof saved === 'number' && Number.isFinite(saved) ? [[item.id, number(saved, 1, 0, 1)]] : [];
  }));
  const beat = number(value.beat, 0, 0, Math.max(0, performance.duration - .001));
  return { bpm: number(value.bpm, score.bpm, 15, 300), beat: loop ? Math.max(performance.measures[loopStart].start, Math.min(beat, performance.measures[loopEnd].end - .001)) : beat,
    repeats, loop, loopStart, loopEnd, muted: Array.isArray(value.muted) ? value.muted.filter(voice) : [], solo: voice(value.solo) ? value.solo : null, volumes,
    pitchOffset: value.pitchOffset === -12 || value.pitchOffset === 12 ? value.pitchOffset : 0,
    practiceVoice: value.practiceVoice === 'all' || voice(value.practiceVoice) ? value.practiceVoice : score.voices.find(item => item.id === 'melody')?.id ?? score.voices[0]?.id ?? 'all' };
}
export function savePractice(key: string, value: PracticeSettings) { remember(`sotto.practice.${key}`, value); }
