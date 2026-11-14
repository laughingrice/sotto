import { makePerformance, type Score } from './score';
import { isInstrument, type ClickMode, type InstrumentId } from './sounds';

export type MetronomeMode = 'off' | 'playback' | 'continuous';
export type Preferences = { zoom: number; follow: boolean; clickVolume: number; clickMode: ClickMode; metronomeMode: MetronomeMode; rhythmVisible: boolean };
export type PracticeSettings = { bpm: number; beat: number; repeats: boolean; loop: boolean; loopStart: number; loopEnd: number;
  muted: string[]; solo: string | null; volumes: Record<string, number>; pitchOffset: number; practiceVoice: string; instruments?: Record<string, InstrumentId> };
const read = (key: string): Record<string, unknown> => {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
};
const number = (value: unknown, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
const boolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
export function remember(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } }
export function loadCountIn(): boolean { try { return localStorage.getItem('sotto.countIn') !== 'false'; } catch { return true; } }
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
    ...(value.instruments && typeof value.instruments === 'object' ? { instruments: Object.fromEntries(Object.entries(value.instruments).filter(([id, instrument]) => voice(id) && isInstrument(instrument))) as Record<string, InstrumentId> } : {}),
    pitchOffset: value.pitchOffset === -12 || value.pitchOffset === 12 ? value.pitchOffset : 0,
    practiceVoice: value.practiceVoice === 'all' || voice(value.practiceVoice) ? value.practiceVoice : score.voices.find(item => item.id === 'melody')?.id ?? score.voices[0]?.id ?? 'all' };
}
export function savePractice(key: string, value: PracticeSettings) { remember(`sotto.practice.${key}`, value); }

// Portable preferences intentionally omit input device IDs and route-specific latency.
const portableOptions: Record<string, (value: string) => boolean> = {
  'sotto.instrument': isInstrument,
  ...Object.fromEntries(['countIn', 'controlsCollapsed', 'hideBackground'].map(key => [`sotto.${key}`, (value: string) => value === 'true' || value === 'false'])),
  ...Object.fromEntries(Object.entries({ inputGate: [-65, -20], rhythmTolerance: [25, 150], plotWindow: [6, 48], lookAhead: [0, 40], traceBoost: [0, 36], highpass: [0, 150], lowpass: [0, 8000] })
    .map(([key, [min, max]]) => [`sotto.${key}`, (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max])),
};
export type PortablePreferences = { version: 1; general: Preferences; options: Record<string, string>; songs: Record<string, Partial<PracticeSettings>>; lastSong?: string };
export function exportPreferences(songKeys: string[]): PortablePreferences {
  const keys = new Set(['builtin:julia-florida', ...songKeys]);
  const songs = Object.fromEntries([...keys].flatMap(key => {
    const value = read(`sotto.practice.${key}`);
    return Object.keys(value).length ? [[key, value]] : [];
  }));
  const options = Object.fromEntries(Object.entries(portableOptions).flatMap(([key, valid]) => {
    try { const value = localStorage.getItem(key); return value !== null && valid(value) ? [[key, value]] : []; } catch { return []; }
  }));
  const last = lastScore();
  // Run exported records through the same field whitelist used for imports.
  return parsePreferences({ version: 1, general: loadPreferences(), options, songs, ...(last && keys.has(last) ? { lastSong: last } : {}) }, songKeys)!;
}
export function parsePreferences(value: unknown, songKeys: string[]): PortablePreferences | undefined {
  if (value === undefined) return undefined; // Older library indexes remain valid.
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const invalid = () => new Error('Invalid saved settings in this backup.');
  if (!record(value) || value.version !== 1 || !record(value.general) || !record(value.options) || !record(value.songs)) throw invalid();
  const source = value.general;
  if (typeof source.zoom !== 'number' || !Number.isFinite(source.zoom) || source.zoom < 50 || source.zoom > 250 ||
      typeof source.follow !== 'boolean' || typeof source.rhythmVisible !== 'boolean' ||
      typeof source.clickVolume !== 'number' || !Number.isFinite(source.clickVolume) || source.clickVolume < 0 || source.clickVolume > 100 ||
      (source.clickMode !== 'beat' && source.clickMode !== 'subdivision') || (source.metronomeMode !== 'off' && source.metronomeMode !== 'playback' && source.metronomeMode !== 'continuous')) throw invalid();
  const general: Preferences = { zoom: source.zoom, follow: source.follow, rhythmVisible: source.rhythmVisible,
    clickVolume: source.clickVolume, clickMode: source.clickMode as ClickMode, metronomeMode: source.metronomeMode as MetronomeMode };
  const options = Object.fromEntries(Object.entries(value.options).map(([key, item]) => {
    if (!Object.hasOwn(portableOptions, key) || typeof item !== 'string' || !portableOptions[key](item)) throw invalid();
    return [key, item];
  }));
  const allowed = new Set(['builtin:julia-florida', ...songKeys]);
  const id = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 2000;
  const numeric: Record<string, [number, number]> = { bpm: [15, 300], beat: [0, 1e9], loopStart: [0, 1e7], loopEnd: [0, 1e7] };
  const songs = Object.fromEntries(Object.entries(value.songs).map(([key, item]) => {
    if (!allowed.has(key) || !record(item)) throw invalid();
    const saved: Record<string, unknown> = {};
    for (const [field, [min, max]] of Object.entries(numeric)) {
      const number = item[field];
      if (number === undefined) continue;
      if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || (field.startsWith('loop') && !Number.isInteger(number))) throw invalid();
      saved[field] = number;
    }
    for (const field of ['repeats', 'loop']) if (item[field] !== undefined) { if (typeof item[field] !== 'boolean') throw invalid(); saved[field] = item[field]; }
    if (item.muted !== undefined) { if (!Array.isArray(item.muted) || item.muted.length > 1000 || !item.muted.every(id)) throw invalid(); saved.muted = item.muted; }
    if (item.solo !== undefined) { if (item.solo !== null && !id(item.solo)) throw invalid(); saved.solo = item.solo; }
    if (item.practiceVoice !== undefined) { if (!id(item.practiceVoice)) throw invalid(); saved.practiceVoice = item.practiceVoice; }
    if (item.pitchOffset !== undefined) { if (![-12, 0, 12].includes(item.pitchOffset as number)) throw invalid(); saved.pitchOffset = item.pitchOffset; }
    if (item.instruments !== undefined) {
      if (!record(item.instruments) || Object.keys(item.instruments).length > 1000) throw invalid();
      saved.instruments = Object.fromEntries(Object.entries(item.instruments).map(([voice, instrument]) => {
        if (!id(voice) || !isInstrument(instrument)) throw invalid();
        return [voice, instrument];
      }));
    }
    if (item.volumes !== undefined) {
      if (!record(item.volumes) || Object.keys(item.volumes).length > 1000) throw invalid();
      saved.volumes = Object.fromEntries(Object.entries(item.volumes).map(([voice, level]) => {
        if (!id(voice) || typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) throw invalid();
        return [voice, level];
      }));
    }
    return [key, saved as Partial<PracticeSettings>];
  }));
  if (value.lastSong !== undefined && (typeof value.lastSong !== 'string' || !allowed.has(value.lastSong))) throw invalid();
  return { version: 1, general, options, songs, ...(typeof value.lastSong === 'string' ? { lastSong: value.lastSong } : {}) };
}
export function importPreferences(value: PortablePreferences) {
  // The parser validates the entire backup before any settings are changed.
  localStorage.setItem('sotto.preferences', JSON.stringify(value.general));
  for (const [key, option] of Object.entries(value.options)) localStorage.setItem(key, option);
  for (const [key, settings] of Object.entries(value.songs)) localStorage.setItem(`sotto.practice.${key}`, JSON.stringify(settings));
  if (value.lastSong) localStorage.setItem('sotto.session', JSON.stringify({ score: value.lastSong }));
}
