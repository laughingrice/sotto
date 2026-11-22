import { PitchDetector } from 'pitchy';
import type { PitchFrame } from './pitch';

/** About 85 ms at common rates, without a huge window on low-rate devices. */
export const shortPitchWindow = (rate: number) => 2 ** Math.ceil(Math.log2(rate * .075));

/** Runs in a worker; only estimates leave it, and sample windows are discarded. */
export class PitchAnalysis {
  private detectors = new Map<number, PitchDetector<Float32Array>>();
  private estimate(samples: Float32Array, sampleRate: number, time: number): PitchFrame {
    let energy = 0, peak = 0;
    for (const value of samples) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
    const rms = Math.sqrt(energy / samples.length);
    const frame: PitchFrame = { time, windowSeconds: samples.length / sampleRate, frequency: null, clarity: 0, rms };
    if (rms < .0001 || peak >= .98) return frame;
    let detector = this.detectors.get(samples.length);
    if (!detector) {
      detector = PitchDetector.forFloat32Array(samples.length);
      detector.clarityThreshold = .95;
      this.detectors.set(samples.length, detector);
    }
    const [frequency, clarity] = detector.findPitch(samples, sampleRate);
    return { ...frame, clarity, frequency: Number.isFinite(frequency) && frequency >= 30 && frequency <= 4000 && clarity >= .9 ? frequency : null };
  }
  analyze(samples: Float32Array, sampleRate: number, time: number): PitchFrame {
    const shortLength = Math.min(samples.length, shortPitchWindow(sampleRate));
    // Prefer recent short windows: fast notes and transitions must not inherit
    // the longer window's delay or be scored against the wrong score position.
    const shortTime = time + (samples.length - shortLength) / (2 * sampleRate);
    const recent = this.estimate(samples.subarray(samples.length - shortLength), sampleRate, shortTime);
    if (samples.length === shortLength || (recent.frequency !== null && recent.frequency >= 160)) return recent;
    const longer = this.estimate(samples, sampleRate, time);
    if (longer.frequency === null || longer.frequency >= 160) return recent;
    if (recent.frequency === null) return longer;
    const ratio = recent.frequency / longer.frequency;
    // A strong second/third harmonic can hide a low fundamental. Accept a
    // longer-window correction only when its periodicity is equally clear;
    // never choose the score's expected pitch to resolve the ambiguity.
    const harmonic = Math.round(ratio);
    const lowerFundamental = harmonic >= 2 && harmonic <= 4 && Math.abs(12 * Math.log2(ratio / harmonic)) < .3;
    if ((lowerFundamental && longer.clarity >= recent.clarity - .01) || longer.clarity > recent.clarity + .03) return longer;
    return recent;
  }
}
