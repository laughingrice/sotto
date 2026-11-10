/* Only short-window level summaries leave the audio thread. No recording. */
class SottoLevelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0; this.peak = 0; this.count = 0;
    this.window = Math.round(sampleRate * .01);
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] ?? []) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length || !channels[0].length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.sum += sample * sample; this.peak = Math.max(this.peak, Math.abs(sample)); this.count++;
      if (this.count >= this.window) {
        this.port.postMessage({ time: (currentFrame + i + 1 - this.count / 2) / sampleRate,
          rms: Math.sqrt(this.sum / this.count), peak: this.peak });
        this.sum = 0; this.peak = 0; this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('sotto-level', SottoLevelProcessor);
