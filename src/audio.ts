import * as Tone from 'tone';
import type { Performance, Score } from './score';
import { clickAccent, clickStep, type ClickMode, type InstrumentId } from './sounds';

/** Audio and UI share the Web Audio transport clock, not a JavaScript interval. */
export class Player {
  private instruments = new Map<string, Tone.Sampler | Tone.PolySynth<Tone.Synth>>();
  private muted = new Set<string>();
  private volumes = new Map<string, number>();
  private clicks?: Record<'downbeat' | 'beat' | 'subdivision', Tone.Player>;
  private clickGain?: Tone.Gain;
  private standaloneClock?: Tone.Clock;
  private clickEventId?: number;
  private clickCounter = 0;
  private instrumentId: InstrumentId = 'guitar';
  private metronomeOn = false;
  private clickVolume = .7;
  private clickMode: ClickMode = 'beat';
  private performance?: Performance;
  private score?: Score;
  private master?: Tone.Gain;
  private initialized = false;
  private loopBounds = { enabled: false, start: 0, end: 0 };
  onEnded: () => void = () => {};
  onMetronomeTick: (count: number, accent: string) => void = () => {};

  get beat() { return Number(Tone.getTransport().ticks) / Tone.getTransport().PPQ; }
  get playing() { return this.initialized && Tone.getTransport().state === 'started'; }

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
      return new Tone.Player({ url: buffer, fadeOut: .003 }).connect(this.clickGain!);
    };
    this.clicks = { downbeat: createClick(1800, .9), beat: createClick(1100, .7), subdivision: createClick(800, .4) };
    this.standaloneClock = new Tone.Clock(time => {
      const beat = this.standaloneClock!.getTicksAtTime(time) * this.metronomeStep;
      this.playClick(time, beat);
    }, this.clickFrequency);
    this.initialized = true;
    this.makeInstruments();
    this.schedule();
  }

  private makeInstruments() {
    if (!this.score || !this.master) return;
    this.instruments.forEach(instrument => instrument.dispose()); this.instruments.clear();
    if (this.instrumentId !== 'guitar') {
      const profiles = {
        piano: { partials: [1, .55, .3, .15, .08, .04], attack: .003, decay: 1.1, sustain: .04, release: .2, volume: -15 },
        marimba: { partials: [1, 0, .12, .55, 0, 0, 0, 0, .08], attack: .001, decay: .45, sustain: 0, release: .12, volume: -14 },
        organ: { partials: [1, .25, .5, .12, .18, .08], attack: .012, decay: .03, sustain: .8, release: .08, volume: -18 },
        flute: { partials: [1, .13, .04, .015], attack: .06, decay: .1, sustain: .75, release: .13, volume: -15 },
      };
      const profile = profiles[this.instrumentId];
      for (const voice of this.score.voices) {
        const synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'custom', partials: profile.partials },
          envelope: { attack: profile.attack, decay: profile.decay, sustain: profile.sustain, release: profile.release },
          volume: profile.volume,
        }).connect(this.master);
        this.instruments.set(voice.id, synth);
        this.applyVolume(voice.id);
      }
      return;
    }
    const context = Tone.getContext().rawContext;
    const buffers: Record<number, Tone.ToneAudioBuffer> = {};
    for (const midi of new Set(this.score.notes.map(note => note.midi))) {
      const rate = context.sampleRate;
      const buffer = context.createBuffer(1, Math.ceil(rate * 3), rate);
      const channel = buffer.getChannelData(0);
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      // Small self-contained plucked-string sample bank: no external soundfonts.
      for (let i = 0; i < channel.length; i++) {
        const t = i / rate;
        let amplitude = 0;
        for (let harmonic = 1; harmonic <= 7; harmonic++) {
          if (frequency * harmonic >= rate / 2) break;
          amplitude += Math.sin(2 * Math.PI * frequency * harmonic * t) * Math.exp(-t * (.9 + harmonic * .7)) / harmonic ** 1.7;
        }
        channel[i] = amplitude * .45 * Math.min(1, t / .004);
      }
      buffers[midi] = new Tone.ToneAudioBuffer(buffer);
    }
    for (const voice of this.score.voices) {
      const sampler = new Tone.Sampler({ urls: buffers, attack: .002, release: .12, volume: -5 }).connect(this.master);
      this.instruments.set(voice.id, sampler);
      this.applyVolume(voice.id);
    }
  }

  load(score: Score, performance: Performance) {
    this.pause(); this.score = score; this.performance = performance;
    this.muted.clear(); this.volumes.clear();
    if (this.initialized) this.makeInstruments();
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
            Tone.Frequency(note.midi, 'midi').toNote(),
            Math.max(.025, ((this.loopBounds.enabled ? Math.min(note.end, this.loopBounds.end) : note.end) - note.start) * 60 / transport.bpm.value), time, .72);
        }
      }, `${Math.round(note.start * ppq)}i`);
    }
    this.clickEventId = undefined;
    this.scheduleMetronome();
    transport.schedule(time => {
      transport.pause(time);
      Tone.getDraw().schedule(() => { this.release(); this.onEnded(); this.syncStandalone(); }, time);
    }, `${Math.round(this.performance.duration * ppq)}i`);
  }

  async play() {
    await this.initialize();
    if (!this.performance) return;
    if (this.beat >= this.performance.duration - .01) this.seek(0);
    const now = Tone.now() + .06;
    this.stopStandalone();
    const beat = this.beat;
    // Resume sustained notes when starting inside a beat or after pausing.
    for (const note of this.performance.sounds) {
      if (note.start < beat - .001 && note.end > beat && !this.muted.has(note.voice)) {
        this.instruments.get(note.voice)?.triggerAttackRelease(Tone.Frequency(note.midi, 'midi').toNote(), (note.end - beat) * 60 / Tone.getTransport().bpm.value, now, .65);
      }
    }
    Tone.getTransport().start(now);
  }

  private release() { this.instruments.forEach(instrument => instrument.releaseAll()); }
  pause(standalone = true) {
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
    const level = { guitar: -5, piano: -15, marimba: -14, organ: -18, flute: -15 }[this.instrumentId];
    if (instrument) instrument.volume.value = this.muted.has(voice) ? -Infinity : level + 20 * Math.log10(Math.max(.001, this.volumes.get(voice) ?? 1));
  }
  mute(voice: string, muted: boolean) {
    if (muted) { this.muted.add(voice); this.instruments.get(voice)?.releaseAll(); }
    else this.muted.delete(voice);
    this.applyVolume(voice);
  }
  volume(voice: string, volume: number) { this.volumes.set(voice, volume); this.applyVolume(voice); }
  setInstrument(instrument: InstrumentId) {
    if (this.instrumentId === instrument) return;
    this.release(); this.instrumentId = instrument;
    if (this.initialized) {
      this.makeInstruments();
      // Revoice notes already held at the current position, without seeking.
      if (this.playing && this.performance) {
        const beat = this.beat;
        for (const note of this.performance.sounds) {
          if (note.start < beat && note.end > beat && !this.muted.has(note.voice)) {
            this.instruments.get(note.voice)?.triggerAttackRelease(Tone.Frequency(note.midi, 'midi').toNote(), (note.end - beat) * 60 / Tone.getTransport().bpm.value, Tone.now(), .65);
          }
        }
      }
    }
  }
  private get metronomeStep() { return clickStep(this.score?.beatUnit ?? 1.5, this.clickMode); }
  private get clickFrequency() { return Tone.getTransport().bpm.value / (60 * this.metronomeStep); }
  private playClick(time: number, beat: number) {
    if (!this.metronomeOn || !this.clicks) return;
    const accent = clickAccent(beat, this.score?.beatsPerBar ?? 3, this.score?.beatUnit ?? 1.5);
    this.clicks[accent].start(time);
    const count = ++this.clickCounter;
    Tone.getDraw().schedule(() => this.onMetronomeTick(count, accent), time);
  }
  private scheduleMetronome() {
    const transport = Tone.getTransport();
    if (this.clickEventId !== undefined) transport.clear(this.clickEventId);
    this.clickEventId = transport.scheduleRepeat(time => {
      this.playClick(time, transport.getTicksAtTime(time) / transport.PPQ);
    }, `${Math.round(this.metronomeStep * transport.PPQ)}i`);
  }
  private stopStandalone() {
    this.standaloneClock?.stop(Tone.immediate());
    if (this.clicks) Object.values(this.clicks).forEach(click => click.stop(Tone.immediate()));
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
    this.metronomeOn = false;
    this.pause(); Tone.getTransport().cancel();
    this.instruments.forEach(instrument => instrument.dispose()); this.instruments.clear();
    this.standaloneClock?.dispose();
    if (this.clicks) Object.values(this.clicks).forEach(click => click.dispose());
    this.clickGain?.dispose(); this.master?.dispose();
  }
}
