export type RecordedInstrument = 'guitar' | 'piano' | 'violin' | 'bass-electric' | 'drums';
export function isRecordedInstrument(value: string): value is RecordedInstrument {
  return value === 'guitar' || value === 'piano' || value === 'violin' || value === 'bass-electric' || value === 'drums';
}

type Manifest = { banks: Record<RecordedInstrument, Record<string, string>> };

/** Recorded banks are served by Sotto itself, never by a third-party CDN. */
export class RecordingLibrary {
  private manifest?: Promise<Manifest>;
  private banks = new Map<RecordedInstrument, Promise<Record<string, AudioBuffer>>>();

  load(instrument: RecordedInstrument, context: BaseAudioContext): Promise<Record<string, AudioBuffer>> {
    const existing = this.banks.get(instrument);
    if (existing) return existing;
    const pending = this.loadBank(instrument, context).catch(error => { this.banks.delete(instrument); throw error; });
    this.banks.set(instrument, pending);
    return pending;
  }

  private async loadBank(instrument: RecordedInstrument, context: BaseAudioContext) {
    const base = `${import.meta.env.BASE_URL}samples/`;
    this.manifest ??= fetch(`${base}manifest.json`).then(response => {
      if (!response.ok) throw new Error('Instrument sample list could not be loaded.');
      return response.json() as Promise<Manifest>;
    }).catch(error => { this.manifest = undefined; throw error; });
    const manifest = await this.manifest;
    const entries = await Promise.all(Object.entries(manifest.banks[instrument]).map(async ([note, path]) => {
      const response = await fetch(`${base}${path}`);
      if (!response.ok) throw new Error(`Could not load the ${instrument} recording for ${note}.`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (instrument !== 'drums') balanceRecording(buffer);
      return [note, buffer] as const;
    }));
    return Object.fromEntries(entries);
  }
}

/** Similar attack-window levels make A/B switching about timbre, not loudness. */
function balanceRecording(buffer: AudioBuffer) {
  const length = Math.min(buffer.length, Math.ceil(buffer.sampleRate * .5));
  let sum = 0, peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      peak = Math.max(peak, Math.abs(data[index]));
      if (index < length) sum += data[index] ** 2;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, length * buffer.numberOfChannels));
  if (rms === 0 || peak === 0) return;
  const gain = Math.min(3, .12 / rms, .9 / peak);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) data[index] *= gain;
  }
}
