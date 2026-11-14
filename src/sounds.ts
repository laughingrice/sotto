export const INSTRUMENTS = [
  { id: 'guitar', name: 'Nylon guitar · recorded' },
  { id: 'piano', name: 'Piano · recorded' },
  { id: 'violin', name: 'Violin · recorded' },
  { id: 'bass-electric', name: 'Electric bass · recorded' },
  { id: 'drums', name: 'Acoustic drums · recorded' },
  { id: 'marimba', name: 'Marimba' },
  { id: 'organ', name: 'Organ' },
  { id: 'flute', name: 'Flute' },
] as const;
export type InstrumentId = typeof INSTRUMENTS[number]['id'];
export type ClickMode = 'beat' | 'subdivision';

export function isInstrument(value: unknown): value is InstrumentId {
  return INSTRUMENTS.some(instrument => instrument.id === value);
}
export function clickStep(beatUnit: number, mode: ClickMode): number {
  if (mode === 'beat') return beatUnit;
  // Compound meters divide the dotted-quarter pulse into three eighths.
  return beatUnit === 1.5 ? .5 : beatUnit / 2;
}
export function clickAccent(beat: number, beatsPerBar: number, beatUnit: number): 'downbeat' | 'beat' | 'subdivision' {
  const nearMultiple = (value: number, divisor: number) => Math.abs(value / divisor - Math.round(value / divisor)) < .001;
  if (nearMultiple(beat, beatsPerBar)) return 'downbeat';
  return nearMultiple(beat, beatUnit) ? 'beat' : 'subdivision';
}

export function metronomePattern(measures: { start: number; end: number }[], beatUnit: number, mode: ClickMode) {
  return measures.flatMap(measure => {
    const clicks: { beat: number; accent: ReturnType<typeof clickAccent> }[] = [];
    for (let offset = 0; offset < measure.end - measure.start - 1e-6; offset += clickStep(beatUnit, mode)) {
      clicks.push({ beat: measure.start + offset, accent: clickAccent(offset, measure.end - measure.start, beatUnit) });
    }
    return clicks;
  });
}

/** A complete lead-in bar, using the local meter rather than the score's first meter. */
export function countInPattern(measure: { start: number; end: number; meter?: [number, number] } | undefined, beatsPerBar: number, beatUnit: number) {
  const meter = measure?.meter;
  const duration = meter ? meter[0] * 4 / meter[1] : measure ? measure.end - measure.start : beatsPerBar;
  const pulse = meter ? (meter[1] === 8 && meter[0] >= 6 && meter[0] % 3 === 0 ? 1.5 : 4 / meter[1]) : beatUnit;
  return { duration, clicks: metronomePattern([{ start: 0, end: duration }], pulse, 'beat') };
}

type NamedVoice = { id: string; name: string; percussion?: boolean; instrument?: string; midiInstrument?: string };
export function inferInstrument(voice: NamedVoice, context?: { title?: string; subtitle?: string; voices: NamedVoice[] }): InstrumentId | undefined {
  const explicit = voice.instrument ?? voice.midiInstrument;
  if (isInstrument(explicit)) return explicit;
  const name = `${explicit ?? ''} ${voice.id} ${voice.name}`.toLowerCase().replace(/[_-]/g, ' ');
  if (voice.percussion || /\b(drums?|drumset|drumkit|percussion|hihat|hi hat|snare|kick)\b/.test(name)) return 'drums';
  if (/\bviolin/.test(name)) return 'violin';
  if (/\b(bass guitar|electric bass|slap bass|finger(?:ed)? bass)\b/.test(name)) return 'bass-electric';
  const bassContext = context?.voices.some(item => item.percussion || /drum|percussion/i.test(`${item.id} ${item.name}`)) || /bass/i.test(`${context?.title ?? ''} ${context?.subtitle ?? ''}`);
  if (bassContext && /\bbass\b/.test(name) && !/clarinet|bassoon/.test(name)) return 'bass-electric';
  if (/\b(piano|keyboard)\b/.test(name)) return 'piano';
  if (/\bguitar\b/.test(name)) return 'guitar';
  for (const item of ['marimba', 'organ', 'flute'] as const) if (name.includes(item)) return item;
  return undefined;
}
export function voiceInstrument(voice: NamedVoice, fallback: InstrumentId, overrides: Record<string, InstrumentId>, context?: { title?: string; subtitle?: string; voices: NamedVoice[] }): InstrumentId {
  return (isInstrument(overrides[voice.id]) ? overrides[voice.id] : undefined) ?? inferInstrument(voice, context) ?? fallback;
}
