export type VoiceSelection = string | readonly string[];
export const includesVoice = (selection: VoiceSelection, voice: string) => typeof selection === 'string' ? selection === 'all' || selection === voice : selection.includes(voice);
export const multipleVoices = (selection: VoiceSelection) => selection === 'all' || Array.isArray(selection) && selection.length !== 1;
export type PlaybackMode = 'all' | 'accompaniment';
export function mutedParts(ids: string[], muted: ReadonlySet<string>, solo: string | null, mode: PlaybackMode, practice: readonly string[]) {
  return new Set(ids.filter(id => muted.has(id) || solo !== null && solo !== id || mode === 'accompaniment' && practice.includes(id)));
}
