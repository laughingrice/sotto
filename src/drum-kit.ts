import * as Tone from 'tone';

/** General MIDI key mapping: samples are one-shots, never repitched notes. */
export const DRUM_KEYS: Record<number, string> = {
  35: 'kick', 36: 'kick', 37: 'sidestick', 38: 'snare', 39: 'snare', 40: 'snare',
  41: 'tom-low', 43: 'tom-low', 45: 'tom-low', 47: 'tom-high', 48: 'tom-high', 50: 'tom-high',
  42: 'hihat-closed', 44: 'hihat-pedal', 46: 'hihat-open',
  49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash', 51: 'ride', 53: 'ride-bell', 59: 'ride',
};
export class RecordedDrumKit {
  private output: Tone.Volume;
  readonly volume: Tone.Volume['volume'];
  private sources = new Map<AudioBufferSourceNode, { midi: number; gain: GainNode }>();
  constructor(private buffers: Record<string, AudioBuffer>, destination: Tone.Gain) {
    this.output = new Tone.Volume().connect(destination); this.volume = this.output.volume;
  }
  triggerAttackRelease(note: string, _duration: number, time: number, velocity = .72) {
    const midi = Math.round(Tone.Frequency(note).toMidi());
    const buffer = this.buffers[DRUM_KEYS[midi]];
    if (!buffer) return; // Unsupported percussion stays silent rather than becoming a pitched drum.
    if (midi === 42 || midi === 44) {
      for (const [source, hit] of this.sources) if (hit.midi === 46) {
        hit.gain.gain.setValueAtTime(hit.gain.gain.value, time);
        hit.gain.gain.linearRampToValueAtTime(0, time + .02); source.stop(time + .025);
      }
    }
    const context = Tone.getContext().rawContext;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.value = velocity; source.connect(gain); Tone.connect(gain, this.output);
    this.sources.set(source, { midi, gain });
    source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); };
    source.start(time);
  }
  releaseAll() {
    for (const source of this.sources.keys()) source.stop(Tone.immediate());
    this.sources.clear();
  }
  dispose() { this.releaseAll(); this.output.dispose(); }
}
