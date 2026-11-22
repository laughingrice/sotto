import type { PitchFrame } from './pitch';
import * as Tone from 'tone';
import type { LevelFrame } from './rhythm';

const modules = new WeakMap<AudioWorklet, Promise<void>>();
async function loadProcessor(worklet: AudioWorklet | undefined) {
  if (!worklet) throw new Error('This browser does not support microphone analysis with AudioWorklet. Try a current Safari, Chrome or Edge over HTTPS.');
  let pending = modules.get(worklet);
  if (!pending) {
    pending = worklet.addModule(`${import.meta.env.BASE_URL}rhythm-worklet.js?v=2`).catch(error => { modules.delete(worklet); throw error; });
    modules.set(worklet, pending);
  }
  await pending;
}

export class MicrophoneInput {
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private sink?: GainNode;
  private highpass?: BiquadFilterNode;
  private lowpass?: BiquadFilterNode;
  private filter = { highpass: 0, lowpass: 4000 };
  private version = 0;
  private pitchEnabled = false;
  private pitchEpoch = 0;
  private pitchWorker?: Worker;
  private pitchBusy = false;
  onPitch: (frame: PitchFrame) => void = () => {};
  onPitchError: (message: string) => void = () => {};
  setPitchTracking(enabled: boolean) {
    this.pitchEnabled = enabled;
    this.pitchWorker?.terminate(); this.pitchWorker = undefined; this.pitchBusy = false;
    const epoch = ++this.pitchEpoch;
    if (!this.worklet) return;
    if (enabled) {
      try {
        const worker = new Worker(new URL('./pitch-worker.ts', import.meta.url), { type: 'module' });
        this.pitchWorker = worker;
        worker.onmessage = ({ data }) => {
          if (this.pitchWorker !== worker || data.epoch !== this.pitchEpoch) return;
          this.pitchBusy = false;
          if (this.pitchEnabled) this.onPitch(data as PitchFrame);
        };
        worker.onerror = event => { event.preventDefault(); if (this.pitchWorker !== worker) return; this.setPitchTracking(false); this.onPitchError('Pitch analysis stopped. Rhythm feedback still works; turn pitch checking on again to retry.'); };
      } catch { this.pitchEnabled = false; this.onPitchError('This browser could not start pitch analysis. Rhythm feedback still works.'); }
    }
    this.worklet.port.postMessage({ type: 'pitch', enabled: this.pitchEnabled, epoch });
  }
  private pulses = new Set<AudioBufferSourceNode>();
  onFrame: (frame: LevelFrame) => void = () => {};
  onEnded: (message: string) => void = () => {};
  get time() { return Tone.immediate(); }
  get settings() { return this.stream?.getAudioTracks()[0]?.getSettings(); }
  setFilters(highpass: number, lowpass: number) {
    this.filter = { highpass, lowpass };
    this.wireFilters();
  }
  private wireFilters() {
    if (!this.source || !this.worklet || !this.highpass || !this.lowpass) return;
    this.source.disconnect(); this.highpass.disconnect(); this.lowpass.disconnect();
    let tail: AudioNode = this.source;
    if (this.filter.highpass > 0) {
      this.highpass.frequency.value = this.filter.highpass; tail.connect(this.highpass); tail = this.highpass;
    }
    if (this.filter.lowpass > 0) {
      this.lowpass.frequency.value = Math.min(this.filter.lowpass, this.lowpass.context.sampleRate * .45);
      tail.connect(this.lowpass); tail = this.lowpass;
    }
    tail.connect(this.worklet);
  }
  async start(deviceId = '') {
    this.stop();
    const version = this.version;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost. Use the deployed Sotto site on your tablet.');
    await Tone.start();
    if (version !== this.version) return false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 1, ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    } });
    if (version !== this.version) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream;
    try {
      const context = Tone.getContext();
      if (context.rawContext.state !== 'running') await (context.rawContext as AudioContext).resume();
      await loadProcessor(context.rawContext.audioWorklet);
      if (version !== this.version) return false;
      const source = (context.rawContext as AudioContext).createMediaStreamSource(stream);
      this.source = source;
      this.worklet = context.createAudioWorkletNode('sotto-level', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.highpass = context.rawContext.createBiquadFilter(); this.highpass.type = 'highpass'; this.highpass.Q.value = Math.SQRT1_2;
      this.lowpass = context.rawContext.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.Q.value = Math.SQRT1_2;
      this.sink = context.rawContext.createGain(); this.sink.gain.value = 0;
      this.wireFilters(); this.worklet.connect(this.sink); this.sink.connect(context.rawContext.destination);
      this.worklet.port.onmessage = ({ data }) => {
        if (version !== this.version) return;
        if (data.type !== 'pitch') { this.onFrame(data as LevelFrame); return; }
        if (!this.pitchEnabled || !this.pitchWorker || this.pitchBusy || data.epoch !== this.pitchEpoch) return;
        this.pitchBusy = true;
        this.pitchWorker.postMessage(data, [data.samples.buffer]);
      };
      this.setPitchTracking(this.pitchEnabled);
      this.worklet.onprocessorerror = () => { this.stop(); this.onEnded('The microphone processor stopped. Enable the microphone again to retry.'); };
      stream.getAudioTracks().forEach(track => { track.onended = () => { this.stop(); this.onEnded('Microphone access ended. Enable the microphone to reconnect.'); }; });
      return true;
    } catch (error) { if (version !== this.version) { stream.getTracks().forEach(track => track.stop()); return false; } this.stop(); throw error; }
  }
  calibrationPulses() {
    const context = Tone.getContext().rawContext;
    const buffer = context.createBuffer(1, Math.round(context.sampleRate * .04), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const time = i / context.sampleRate;
      samples[i] = .3 * Math.sin(2 * Math.PI * 1600 * time) * Math.exp(-time * 130) * Math.min(1, time / .001);
    }
    const times = Array.from({ length: 6 }, (_, i) => context.currentTime + .5 + i * .8);
    times.forEach(time => {
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      source.onended = () => { source.disconnect(); this.pulses.delete(source); };
      this.pulses.add(source); source.start(time);
    });
    return times;
  }
  cancelCalibration() { this.pulses.forEach(source => source.stop()); this.pulses.clear(); }
  stop() {
    this.version++; this.pitchEpoch++;
    this.pitchWorker?.terminate(); this.pitchWorker = undefined; this.pitchBusy = false;
    this.cancelCalibration();
    this.worklet?.port.close(); this.worklet?.disconnect(); this.worklet = undefined;
    this.source?.disconnect(); this.source = undefined; this.sink?.disconnect(); this.sink = undefined;
    this.highpass?.disconnect(); this.highpass = undefined; this.lowpass?.disconnect(); this.lowpass = undefined;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
  }
}
