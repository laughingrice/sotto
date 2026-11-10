import * as Tone from 'tone';
import { RecordingLibrary, isRecordedInstrument } from './recordings';
import { measureAt, type Performance, type Score } from './score';
import { clickAccent, clickStep, metronomePattern, type ClickMode, type InstrumentId } from './sounds';

/** Audio and UI share the Web Audio transport clock, not a JavaScript interval. */
export class Player {
  private instruments = new Map<string, Tone.Sampler | Tone.PolySynth<Tone.Synth>>();
  private muted = new Set<string>();
  private volumes = new Map<string, number>();
  private clicks?: Record<'downbeat' | 'beat' | 'subdivision', AudioBuffer>;
  private clickSources = new Set<AudioBufferSourceNode>();
  private clickGain?: Tone.Gain;
  private standaloneClock?: Tone.Clock;
  private clickEventIds: number[] = [];
  private pitchOffset = 0;
  private clickCounter = 0;
  private instrumentId: InstrumentId = 'guitar';
  private metronomeOn = false;
  private clickVolume = .7;
  private clickMode: ClickMode = 'beat';
  private performance?: Performance;
  private score?: Score;
  private master?: Tone.Gain;
  private initialized = false;
  private recordings = new RecordingLibrary();
  private rebuildVersion = 0;
  private loopBounds = { enabled: false, start: 0, end: 0 };
  private captureStart = Infinity;
  private captureEnd = -Infinity;
  onEnded: () => void = () => {};
  onSoundLoading: (loading: boolean) => void = () => {};
  onError: (error: Error) => void = () => {};
  onMetronomeTick: (count: number, accent: string) => void = () => {};

  get beat() { return Number(Tone.getTransport().ticks) / Tone.getTransport().PPQ; }
  get playing() { return this.initialized && Tone.getTransport().state === 'started'; }
  clockAt(time: number) {
    return { active: this.initialized && time >= this.captureStart && time < this.captureEnd,
      beat: Tone.getTransport().getTicksAtTime(Math.max(0, time)) / Tone.getTransport().PPQ };
  }

  private async initialize() {
    await Tone.start();
    if (this.initialized) return;
    this.master = new Tone.Gain(.75).toDestination();
    this.clickGain = new Tone.Gain(this.clickVolume).connect(this.master);
    const context = Tone.getContext().rawContext;
    const createClick = (frequency: number, strength: number) => {
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .035), context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index++) {
        const time = index / context.sampleRate;
        const snap = Math.sin(index * 1.975) * Math.exp(-time * 550) * .15;
        samples[index] = strength * (Math.sin(2 * Math.PI * frequency * time) * Math.exp(-time * 150) + snap) * Math.min(1, time / .0006);
      }
      return buffer;
    };
    this.clicks = { downbeat: createClick(1800, .9), beat: createClick(1100, .7), subdivision: createClick(800, .4) };
    this.standaloneClock = new Tone.Clock(time => {
      const beat = this.standaloneClock!.getTicksAtTime(time) * this.metronomeStep;
      this.playClick(time, beat);
    }, this.clickFrequency);
    this.initialized = true;
    this.schedule();
  }

  private async makeInstruments(instrument: InstrumentId = this.instrumentId) {
    if (!this.score || !this.master) return;
    const version = ++this.rebuildVersion;
    const voices = this.score.voices;
    const next = new Map<string, Tone.Sampler | Tone.PolySynth<Tone.Synth>>();
    this.onSoundLoading(true);
    try {
      if (isRecordedInstrument(instrument)) {
        const buffers = await this.recordings.load(instrument, Tone.getContext().rawContext);
        if (version !== this.rebuildVersion) return;
        for (const voice of voices) {
          next.set(voice.id, new Tone.Sampler({
            urls: buffers,
            attack: instrument === 'violin' ? .025 : .002,
            release: instrument === 'violin' ? .18 : .16,
            curve: 'exponential',
          }).connect(this.master));
        }
      } else {
        const profiles = {
          marimba: { partials: [1, 0, .12, .55, 0, 0, 0, 0, .08], attack: .001, decay: .45, sustain: 0, release: .12 },
          organ: { partials: [1, .25, .5, .12, .18, .08], attack: .012, decay: .03, sustain: .8, release: .08 },
          flute: { partials: [1, .13, .04, .015], attack: .06, decay: .1, sustain: .75, release: .13 },
        };
        const profile = profiles[instrument];
        for (const voice of voices) {
          next.set(voice.id, new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'custom', partials: profile.partials },
            envelope: { attack: profile.attack, decay: profile.decay, sustain: profile.sustain, release: profile.release },
          }).connect(this.master));
        }
      }
      // Keep the previous instrument available until every new sample is ready.
      this.release();
      this.instruments.forEach(previous => previous.dispose());
      this.instruments = next;
      this.instrumentId = instrument;
      voices.forEach(voice => this.applyVolume(voice.id));
    } catch (error) {
      next.forEach(sound => sound.dispose());
      throw error;
    } finally {
      if (version === this.rebuildVersion) this.onSoundLoading(false);
    }
  }

  load(score: Score, performance: Performance) {
    this.pause(); this.score = score; this.performance = performance;
    this.muted.clear(); this.volumes.clear();
    if (this.initialized) void this.makeInstruments().catch(error => this.onError(error));
    this.schedule(); this.seek(0); this.tempo(score.bpm);
  }

  setPerformance(performance: Performance) {
    this.pause(); this.performance = performance; this.schedule(); this.seek(0);
  }

  private schedule() {
    const transport = Tone.getTransport();
    transport.cancel();
    if (!this.performance || !this.score) return;
    const ppq = transport.PPQ;
    for (const note of this.performance.sounds) {
      transport.schedule(time => {
        if (!this.muted.has(note.voice)) {
          this.instruments.get(note.voice)?.triggerAttackRelease(
            Tone.Frequency(note.midi + this.pitchOffset, 'midi').toNote(),
            Math.max(.025, ((this.loopBounds.enabled ? Math.min(note.end, this.loopBounds.end) : note.end) - note.start) * 60 / transport.bpm.value), time, .72);
        }
      }, `${Math.round(note.start * ppq)}i`);
    }
    this.clickEventIds = [];
    this.scheduleMetronome();
    transport.schedule(time => {
      this.captureEnd = time;
      transport.pause(time);
      Tone.getDraw().schedule(() => { this.release(); this.onEnded(); this.syncStandalone(); }, time);
    }, `${Math.round(this.performance.duration * ppq)}i`);
  }

  async play() {
    await this.initialize();
    if (!this.performance) return;
    if (!this.instruments.size) await this.makeInstruments();
    if (this.beat >= this.performance.duration - .01) this.seek(0);
    const now = Tone.now() + .06;
    this.captureStart = now; this.captureEnd = Infinity;
    this.stopStandalone();
    const beat = this.beat;
    // Resume sustained notes when starting inside a beat or after pausing.
    for (const note of this.performance.sounds) {
      if (note.start < beat - .001 && note.end > beat && !this.muted.has(note.voice)) {
        this.instruments.get(note.voice)?.triggerAttackRelease(Tone.Frequency(note.midi + this.pitchOffset, 'midi').toNote(), (note.end - beat) * 60 / Tone.getTransport().bpm.value, now, .65);
      }
    }
    Tone.getTransport().start(now);
  }

  private release() { this.instruments.forEach(instrument => instrument.releaseAll()); }
  pause(standalone = true) {
    this.captureEnd = Tone.now();
    Tone.getTransport().pause();
    if (this.initialized) this.release();
    if (standalone) this.syncStandalone();
  }
  seek(beat: number) {
    const wasPlaying = this.playing;
    this.pause(false);
    Tone.getTransport().ticks = Math.round(Math.max(0, beat) * Tone.getTransport().PPQ);
    if (wasPlaying) void this.play();
    else this.syncStandalone();
  }
  tempo(bpm: number) {
    Tone.getTransport().bpm.value = bpm * (this.score?.beatUnit ?? 1.5);
    if (this.standaloneClock) this.standaloneClock.frequency.value = this.clickFrequency;
  }
  loop(enabled: boolean, start: number, end: number) {
    this.loopBounds = { enabled, start, end };
    const transport = Tone.getTransport();
    transport.loopStart = `${Math.round(start * transport.PPQ)}i`;
    transport.loopEnd = `${Math.round(end * transport.PPQ)}i`;
    transport.loop = enabled;
    if (enabled && (this.beat < start || this.beat >= end)) this.seek(start);
  }
  private applyVolume(voice: string) {
    const instrument = this.instruments.get(voice);
    const level = { guitar: -8, piano: -8, violin: -10, marimba: -14, organ: -18, flute: -15 }[this.instrumentId];
    if (instrument) instrument.volume.value = this.muted.has(voice) ? -Infinity : level + 20 * Math.log10(Math.max(.001, this.volumes.get(voice) ?? 1));
  }
  mute(voice: string, muted: boolean) {
    if (muted) { this.muted.add(voice); this.instruments.get(voice)?.releaseAll(); }
    else this.muted.delete(voice);
    this.applyVolume(voice);
  }
  volume(voice: string, volume: number) { this.volumes.set(voice, volume); this.applyVolume(voice); }
  setPitchOffset(semitones: number) {
    this.pitchOffset = semitones;
    if (this.initialized) this.release();
  }
  async setInstrument(instrument: InstrumentId) {
    if (this.instrumentId === instrument) return;
    if (!this.initialized) { this.instrumentId = instrument; return; }
    await this.makeInstruments(instrument);
    // Revoice held notes after loading, without seeking or restarting the clock.
    if (this.playing && this.performance) {
      const beat = this.beat;
      for (const note of this.performance.sounds) {
        if (note.start < beat && note.end > beat && !this.muted.has(note.voice)) {
          this.instruments.get(note.voice)?.triggerAttackRelease(Tone.Frequency(note.midi + this.pitchOffset, 'midi').toNote(), (note.end - beat) * 60 / Tone.getTransport().bpm.value, Tone.now(), .65);
        }
      }
    }
  }
  private get metronomeStep() { return clickStep(this.score?.beatUnit ?? 1.5, this.clickMode); }
  private get clickFrequency() { return Tone.getTransport().bpm.value / (60 * this.metronomeStep); }
  private playAccent(time: number, accent: 'downbeat' | 'beat' | 'subdivision') {
    if (!this.metronomeOn || !this.clicks || !this.clickGain) return;
    // A separate one-shot source for each click avoids reusing a Player's
    // future state timeline when seeking or switching clocks rapidly.
    const source = Tone.getContext().rawContext.createBufferSource();
    source.buffer = this.clicks[accent];
    Tone.connect(source, this.clickGain);
    this.clickSources.add(source);
    source.onended = () => { source.disconnect(); this.clickSources.delete(source); };
    source.start(time);
    const count = ++this.clickCounter;
    Tone.getDraw().schedule(() => this.onMetronomeTick(count, accent), time);
  }
  private playClick(time: number, beat: number) {
    if (!this.metronomeOn || !this.clicks) return;
    const measure = this.performance ? measureAt(this.performance, this.beat) : undefined;
    const accent = clickAccent(beat, measure ? measure.end - measure.start : this.score?.beatsPerBar ?? 3, this.score?.beatUnit ?? 1.5);
    this.playAccent(time, accent);
  }
  private scheduleMetronome() {
    const transport = Tone.getTransport();
    this.clickEventIds.forEach(id => transport.clear(id));
    this.clickEventIds = [];
    if (!this.performance || !this.score) return;
    for (const click of metronomePattern(this.performance.measures, this.score.beatUnit, this.clickMode)) {
      this.clickEventIds.push(transport.schedule(time => {
        this.playAccent(time, click.accent);
      }, `${Math.round(click.beat * transport.PPQ)}i`));
    }
  }
  private stopStandalone() {
    this.standaloneClock?.stop(Tone.immediate());
    this.clickSources.forEach(source => source.stop(Tone.immediate()));
    this.clickSources.clear();
  }
  private syncStandalone() {
    if (!this.initialized || !this.standaloneClock) return;
    if (this.metronomeOn && !this.playing) {
      this.standaloneClock.frequency.value = this.clickFrequency;
      if (this.standaloneClock.state !== 'started') this.standaloneClock.start(Tone.now() + .03);
    } else this.stopStandalone();
  }
  async setMetronome(enabled: boolean) {
    if (enabled) await this.initialize();
    this.metronomeOn = enabled;
    this.syncStandalone();
  }
  setMetronomeOptions(volume: number, mode: ClickMode) {
    this.clickVolume = Math.max(0, Math.min(1, volume));
    this.clickGain?.gain.setValueAtTime(this.clickVolume, Tone.immediate());
    if (this.clickMode !== mode) {
      this.clickMode = mode;
      this.scheduleMetronome();
      if (this.standaloneClock) this.standaloneClock.frequency.value = this.clickFrequency;
      // A new subdivision begins on an accented beat when practising alone.
      if (this.metronomeOn && !this.playing) { this.stopStandalone(); this.syncStandalone(); }
    }
  }
  dispose() {
    this.rebuildVersion++;
    this.metronomeOn = false;
    this.pause(); Tone.getTransport().cancel();
    this.instruments.forEach(instrument => instrument.dispose()); this.instruments.clear();
    this.standaloneClock?.dispose();
    this.clickGain?.dispose(); this.master?.dispose();
  }
}
