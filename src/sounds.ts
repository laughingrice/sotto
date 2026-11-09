export const INSTRUMENTS = [
  { id: 'guitar', name: 'Nylon guitar · recorded' },
  { id: 'piano', name: 'Piano · recorded' },
  { id: 'violin', name: 'Violin · recorded' },
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
