type OutputClock = {
  currentTime: number; state?: string; baseLatency?: number; outputLatency?: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
};
function outputClock(context: OutputClock): OutputClock {
  const wrapper = context as OutputClock & { _nativeAudioContext?: OutputClock; _nativeContext?: OutputClock };
  const native = wrapper._nativeAudioContext ?? wrapper._nativeContext;
  return native && Number.isFinite(native.currentTime) ? native : context;
}
const latency = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value!) : 0;

/** Estimate the audio position reaching the output device at this animation frame.
 * Tone 15's standardized-audio-context wrapper does not forward output timestamps
 * or outputLatency. Feature-check its native context, then fall back gracefully
 * if a future adapter/browser exposes neither. Scheduling stays on the old clock.
 */
export function audibleContextTime(context: OutputClock, nowMs = performance.now()): number {
  const output = outputClock(context);
  const current = output.currentTime;
  if (output.state && output.state !== 'running') return current;
  try {
    const stamp = output.getOutputTimestamp?.();
    if (stamp && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime) &&
        stamp.contextTime! >= 0 && stamp.contextTime! <= current && stamp.performanceTime! > 0 &&
        nowMs >= stamp.performanceTime! && nowMs - stamp.performanceTime! < 1000) {
      return Math.max(0, Math.min(current, stamp.contextTime! + (nowMs - stamp.performanceTime!) / 1000));
    }
  } catch { /* The device clock may not be ready immediately after resuming. */ }
  return Math.max(0, current - latency(output.baseLatency) - latency(output.outputLatency));
}

export function audioOutputDelay(context: OutputClock): number {
  const output = outputClock(context);
  const reported = latency(output.baseLatency) + latency(output.outputLatency);
  // Before the first hardware buffer arrives, the audible position is clamped
  // to zero. That must not shorten the first click's visual delay.
  return output.currentTime < reported ? reported : Math.max(0, output.currentTime - audibleContextTime(context));
}
