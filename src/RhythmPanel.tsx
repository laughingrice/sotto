import { PitchPass, addPitchStats, emptyPitchStats, frequencyMidi, pitchName, pitchGate, targetPitch, type PitchTarget, type PitchStats } from './pitch';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronDown, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import type { Player } from './audio';
import { metronomePattern, type ClickMode } from './sounds';
import { MicrophoneInput } from './microphone';
import { calibrationOffset, emptyStats, estimateBackground, expectedAttacks, OnsetDetector, RhythmPass, TRACE_HISTORY_SECONDS, LOOK_AHEAD_CHOICES, plotLookAhead, traceColumns, traceLevel, type Attack, type BackgroundLevel, type LevelFrame, type RhythmStats, type TimingMoments, emptyTiming, mergeTiming, rhythmReview, attackCooldown } from './rhythm';
import { measureAt, barTiming, type Performance, type Score } from './score';
import { AdaptiveTrace, adaptiveTraceLevel, ScoreFeedbackHistory } from './score-feedback';
import { drawFeedbackLane, type FeedbackLane } from './score-feedback-layout';

type Props = { visible: boolean; onHide(): void; player: Player; score: Score | null; performance: Performance | null;
  feedbackView: 'score' | 'timeline'; onFeedbackView(view: 'score' | 'timeline'): void; feedbackLanes: RefObject<FeedbackLane[]>;
  practiceVoice: string; onPracticeVoice(voice: string): void; playing: boolean; bpm: number; clickMode: ClickMode; onMicState(active: boolean): void; prepareCalibration(): void; pitchOffset: number; instruments: Readonly<Record<string, string>>; mutedVoices: ReadonlySet<string>; muteVoice(voice: string): void };
type Sample = LevelFrame;
type Dot = Attack & { time: number };
type Pass = { tracker: RhythmPass; pitch: PitchPass; origin: number; capturedAt: number; lastBeat: number; lastTime: number; endTime?: number; finished?: boolean };
const setting = (key: string, fallback: number, min: number, max: number) => {
  try { const stored = localStorage.getItem(key); const value = stored === null ? fallback : Number(stored); return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; } catch { return fallback; }
};

export type RhythmControl = { toggleMicrophone(): void };
const RhythmPanel = forwardRef<RhythmControl, Props>(function RhythmPanel(props, ref) {
  const input = useMemo(() => new MicrophoneInput(), []);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [calibrating, setCalibrating] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState(() => { try { return localStorage.getItem('sotto.inputDevice') ?? ''; } catch { return ''; } });
  const voice = props.practiceVoice;
  const [delay, setDelay] = useState(() => setting('sotto.inputDelay', 0, -50, 600));
  const [gate, setGate] = useState(() => setting('sotto.inputGate', -42, -65, -20));
  const [plotWindow, setPlotWindow] = useState(() => { const saved = setting('sotto.plotWindow', 24, 6, 48); return [6, 12, 24, 48].includes(saved) ? saved : 24; });
  const [lookAhead, setLookAhead] = useState(() => setting('sotto.lookAhead', 4, 0, 40));
  const visibleLookAhead = plotLookAhead(plotWindow, lookAhead);
  const [traceBoost, setTraceBoost] = useState(() => setting('sotto.traceBoost', 12, 0, 36));
  const [feedbackHistory, setFeedbackHistory] = useState(() => Math.round(setting('sotto.feedbackHistory', 1, 0, 5)));
  const [adaptiveRange, setAdaptiveRange] = useState(() => { try { return localStorage.getItem('sotto.adaptiveRange') !== 'false'; } catch { return true; } });
  const scoreFeedback = useRef(new ScoreFeedbackHistory());
  const adaptive = useRef(new AdaptiveTrace());
  const [highpass, setHighpass] = useState(() => setting('sotto.highpass', 0, 0, 150));
  const [lowpass, setLowpass] = useState(() => setting('sotto.lowpass', 4000, 0, 8000));
  const [pitchEnabled, setPitchEnabled] = useState(() => { try { return localStorage.getItem('sotto.pitchCheck') === 'true'; } catch { return false; } });
  const [pitchStats, setPitchStats] = useState<PitchStats>(emptyPitchStats);
  const [pitchReading, setPitchReading] = useState<{ frequency: number | null; target: PitchTarget | null } | null>(null);
  const completedPitch = useRef<PitchStats>(emptyPitchStats());
  const [captureInfo, setCaptureInfo] = useState('');
  const [background, setBackground] = useState<BackgroundLevel | null>(null);
  const [learningBaseline, setLearningBaseline] = useState(false);
  const [hideBackground, setHideBackground] = useState(() => { try { return localStorage.getItem('sotto.hideBackground') !== 'false'; } catch { return true; } });
  const [tolerance, setTolerance] = useState(() => setting('sotto.rhythmTolerance', 80, 25, 150));
  const [stats, setStats] = useState<RhythmStats>(emptyStats);
  const [timing, setTiming] = useState<TimingMoments>(emptyTiming);
  const [lastLoop, setLastLoop] = useState<ReturnType<typeof rhythmReview> | null>(null);
  const [lastAttack, setLastAttack] = useState<Attack | null>(null);
  const [level, setLevel] = useState(-90);
  const [clipped, setClipped] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const samples = useRef<Sample[]>([]);
  const dots = useRef<Dot[]>([]);
  const pass = useRef<Pass | null>(null);
  const completedPasses = useRef<Pass[]>([]);
  const completedStats = useRef<RhythmStats>(emptyStats());
  const completedTiming = useRef<TimingMoments>(emptyTiming());
  const [loopPasses, setLoopPasses] = useState(0);
  const detector = useRef(new OnsetDetector());
  const calibration = useRef<{ times: number[]; detected: number[] } | null>(null);
  const calibrationTimer = useRef(0);
  const frozenTime = useRef(0);
  const latestLevelUpdate = useRef(-Infinity);
  const clipUntil = useRef(0);
  const levelPeak = useRef(0);
  const requestVersion = useRef(0);
  const baselineCapture = useRef<{ since: number | null; frames: LevelFrame[]; manual: boolean } | null>(null);
  const actualVoice = voice === 'all' || props.score?.voices.some(item => item.id === voice) ? voice : props.score?.voices[0]?.id ?? 'all';
  const practiceVoices = props.score?.voices.filter(item => actualVoice === 'all' || item.id === actualVoice) ?? [];
  const practiceMuted = practiceVoices.length > 0 && practiceVoices.every(item => props.mutedVoices.has(item.id));
  const targets = useMemo(() => props.performance ? expectedAttacks(props.performance, actualVoice) : [], [props.performance, actualVoice]);
  const beatGrid = useMemo(() => props.performance ? metronomePattern(props.performance.measures, props.score?.beatUnit ?? 1, props.clickMode) : [], [props.performance, props.score?.beatUnit, props.clickMode]);
  const current = useRef({ ...props, enabled, delay, gate, tolerance, targets, plotWindow, visibleLookAhead, traceBoost, background, hideBackground, beatGrid, pitchEnabled, actualVoice, feedbackHistory, adaptiveRange, calibrating });
  current.current = { ...props, enabled, delay, gate, tolerance, targets, plotWindow, visibleLookAhead, traceBoost, background, hideBackground, beatGrid, pitchEnabled, actualVoice, feedbackHistory, adaptiveRange, calibrating };

  function reset(clearScore = false) {
    if (clearScore) {
      scoreFeedback.current.clear();
      for (const lane of props.feedbackLanes.current) { lane.drawing.replaceChildren(); lane.element.dataset.visits = '0'; }
    } else scoreFeedback.current.beginPass();
    pass.current = null; completedPasses.current = []; completedStats.current = emptyStats(); setLoopPasses(0); samples.current = []; dots.current = []; detector.current.reset();
    completedPitch.current = emptyPitchStats(); setPitchStats(emptyPitchStats()); setPitchReading(null);
    frozenTime.current = 0; setStats(emptyStats()); setTiming(emptyTiming()); completedTiming.current = emptyTiming(); setLastLoop(null); setLastAttack(null);
  }
  function refreshStats() {
    const tracker = pass.current?.tracker;
    if (!tracker) return;
    setStats(Object.fromEntries(Object.entries(tracker.stats).map(([key, value]) => [key, value + completedStats.current[key as keyof RhythmStats]])) as RhythmStats);
    setTiming(mergeTiming(completedTiming.current, tracker.timing));
  }
  function beginBaseline(manual = false) {
    baselineCapture.current = { since: null, frames: [], manual };
    setBackground(null); setLearningBaseline(true); adaptive.current.reset();
    if (manual) { props.prepareCalibration(); setMessage('Listening to the background for two seconds. Keep your instrument quiet.'); }
  }
  function stop() {
    requestVersion.current++; baselineCapture.current = null; setLearningBaseline(false);
    window.clearTimeout(calibrationTimer.current); calibration.current = null;
    if (pass.current && !pass.current.finished) {
      pass.current.tracker.finish(pass.current.lastBeat); pass.current.finished = true; refreshStats();
    }
    input.stop(); setEnabled(false); setBusy(false); setCalibrating(false); current.current.onMicState(false);
    levelPeak.current = 0; setLevel(-90); setClipped(false);
  }
  useEffect(() => {
    try { localStorage.setItem('sotto.inputDelay', String(delay)); localStorage.setItem('sotto.inputGate', String(gate)); localStorage.setItem('sotto.rhythmTolerance', String(tolerance)); } catch { /* Optional settings. */ }
    reset(true);
  }, [props.performance, actualVoice, props.bpm, props.pitchOffset, delay, gate, tolerance]);
  useEffect(() => {
    input.setPitchTracking(pitchEnabled);
    completedPitch.current = emptyPitchStats(); setPitchStats(emptyPitchStats()); setPitchReading(null);
    if (pass.current) pass.current.pitch = new PitchPass();
    try { localStorage.setItem('sotto.pitchCheck', String(pitchEnabled)); } catch { /* Optional preference. */ }
  }, [pitchEnabled, input]);
  useEffect(() => {
    try { localStorage.setItem('sotto.plotWindow', String(plotWindow)); localStorage.setItem('sotto.lookAhead', String(lookAhead)); localStorage.setItem('sotto.traceBoost', String(traceBoost)); localStorage.setItem('sotto.hideBackground', String(hideBackground)); } catch { /* Optional display preferences. */ }
  }, [plotWindow, lookAhead, traceBoost, hideBackground]);
  useEffect(() => {
    try { localStorage.setItem('sotto.feedbackView', props.feedbackView); localStorage.setItem('sotto.feedbackHistory', String(feedbackHistory)); localStorage.setItem('sotto.adaptiveRange', String(adaptiveRange)); } catch { /* Optional display preferences. */ }
  }, [props.feedbackView, feedbackHistory, adaptiveRange]);
  useEffect(() => { try { localStorage.setItem('sotto.inputDevice', device); } catch { /* Optional input preference. */ } }, [device]);
  useEffect(() => {
    input.setFilters(highpass, lowpass);
    if (current.current.enabled) beginBaseline(); else { setBackground(null); baselineCapture.current = null; setLearningBaseline(false); }
    try { localStorage.setItem('sotto.highpass', String(highpass)); localStorage.setItem('sotto.lowpass', String(lowpass)); } catch { /* Optional input preferences. */ }
    reset(true);
  }, [input, highpass, lowpass]);
  useEffect(() => {
    if (props.playing) {
      if (calibration.current) {
        window.clearTimeout(calibrationTimer.current); calibration.current = null; input.cancelCalibration(); setCalibrating(false);
        setMessage('Calibration stopped when playback started. Run it while the score and metronome are paused.');
      }
      reset();
    }
    else if (pass.current) frozenTime.current = input.time;
  }, [props.playing]);
  useEffect(() => {
    input.onFrame = frame => {
      const state = current.current;
      const time = frame.time - state.delay / 1000;
      const clock = state.player.clockAt(time);
      const secondsPerBeat = 60 / (state.bpm * (state.score?.beatUnit ?? 1));
      const cooldown = clock.active && !calibration.current ? attackCooldown(state.targets, secondsPerBeat, clock.beat) : .085;
      const onset = detector.current.push(frame, state.gate, cooldown);
      const learning = baselineCapture.current;
      if (learning && !calibration.current) {
        learning.since ??= frame.time;
        learning.frames.push(frame);
        if (frame.time - learning.since >= 2 && learning.frames.length >= 100) {
          const learned = estimateBackground(learning.frames);
          setBackground(learned); setLearningBaseline(false); baselineCapture.current = null;
          if (learning.manual) setMessage('');
        }
      }
      if (!learning && !calibration.current && (clock.active || !pass.current)) adaptive.current.push(frame, state.background?.peak);
      levelPeak.current = Math.max(levelPeak.current, frame.rms);
      if (frame.peak >= .98) clipUntil.current = frame.time + .5;
      if (frame.time - latestLevelUpdate.current > .12) {
        latestLevelUpdate.current = frame.time;
        setLevel(Math.max(-90, 20 * Math.log10(Math.max(1e-5, levelPeak.current)))); levelPeak.current = 0;
        setClipped(frame.time < clipUntil.current);
        if (pass.current) refreshStats();
      }
      if (calibration.current) {
        if (onset) calibration.current.detected.push(frame.time);
        samples.current.push(frame); samples.current = samples.current.filter(sample => sample.time > frame.time - TRACE_HISTORY_SECONDS);
        return;
      }
      if (clock.active && (state.playing || pass.current)) {
        const previous = pass.current;
        if (!previous || clock.beat < previous.lastBeat - .05 ||
            Math.abs(clock.beat - previous.lastBeat - (time - previous.lastTime) / secondsPerBeat) > .25) {
          const loop = state.player.practiceLoop;
          const wrapped = previous && loop.enabled && clock.beat < previous.lastBeat &&
            previous.lastBeat > loop.end - .25 && clock.beat < loop.start + .25;
          if (wrapped) {
            previous.tracker.finish(loop.end);
            setLastLoop(rhythmReview(previous.tracker.stats, previous.tracker.timing));
            completedPitch.current = addPitchStats(completedPitch.current, previous.pitch.stats);
            completedTiming.current = mergeTiming(completedTiming.current, previous.tracker.timing);
            previous.endTime = previous.origin + loop.end * secondsPerBeat;
            completedPasses.current.push(previous);
            completedPasses.current = completedPasses.current.filter(take => take.endTime! > time - TRACE_HISTORY_SECONDS);
            for (const key of Object.keys(completedStats.current) as (keyof RhythmStats)[]) completedStats.current[key] += previous.tracker.stats[key];
            setLoopPasses(value => value + 1);
          } else {
            completedPasses.current = []; completedStats.current = emptyStats(); setLoopPasses(0);
            completedPitch.current = emptyPitchStats(); setPitchStats(emptyPitchStats()); setPitchReading(null);
            samples.current = []; dots.current = []; setStats(emptyStats()); setTiming(emptyTiming()); completedTiming.current = emptyTiming(); setLastLoop(null); setLastAttack(null);
          }
          pass.current = { pitch: new PitchPass(), tracker: new RhythmPass(loop.enabled ? state.targets.filter(beat => beat >= loop.start && beat < loop.end) : state.targets,
            secondsPerBeat, wrapped ? loop.start : Math.max(0, clock.beat - .1 / secondsPerBeat), state.tolerance),
            origin: time - clock.beat * secondsPerBeat, capturedAt: time, lastBeat: clock.beat, lastTime: time };
          scoreFeedback.current.beginPass();
        }
        pass.current!.lastBeat = clock.beat; pass.current!.lastTime = time;
        pass.current!.tracker.advance(clock.beat);
        const attack = onset ? pass.current!.tracker.attack(clock.beat) : undefined;
        if (attack) {
          dots.current.push({ ...attack, time }); setLastAttack(attack);
        }
        if (state.performance) scoreFeedback.current.push(measureAt(state.performance, clock.beat), clock.beat, frame, attack);
      } else if (pass.current) {
        // Input can arrive after pause due to device latency. Finish consuming
        // frames from the active audio interval before freezing the graph.
        frozenTime.current = pass.current.lastTime;
        if (!pass.current.finished) {
          const end = Math.min(state.performance?.duration ?? Infinity, Math.max(pass.current.lastBeat, clock.beat));
          pass.current.tracker.finish(end); pass.current.finished = true; refreshStats();
        }
        return;
      }
      else if (onset) dots.current.push({ time, beat: 0, errorMs: null, kind: 'extra' });
      samples.current.push({ ...frame, time });
      samples.current = samples.current.filter(sample => sample.time > time - TRACE_HISTORY_SECONDS);
      dots.current = dots.current.filter(dot => dot.time > time - TRACE_HISTORY_SECONDS);
    };
    input.onPitch = frame => {
      const state = current.current;
      if (!state.pitchEnabled || !state.enabled || calibration.current || baselineCapture.current || !state.performance) return;
      const gate = pitchGate(state.gate, state.background?.rms);
      const frequency = frame.rms >= 10 ** (gate / 20) ? frame.frequency : null;
      const time = frame.time - state.delay / 1000;
      const clock = state.player.clockAt(time), take = pass.current;
      if (!clock.active) {
        if (!take) setPitchReading({ frequency, target: null });
        return;
      }
      if (!take || take.finished) return;
      const secondsPerBeat = 60 / (state.bpm * (state.score?.beatUnit ?? 1));
      // A late worker response from an earlier loop/seek cannot score this take.
      if (time - frame.windowSeconds / 2 < take.capturedAt - .001) return;
      const target: PitchTarget = state.instruments[state.actualVoice] === 'drums' ? { kind: 'percussion' } : targetPitch(state.performance.sounds, state.actualVoice, clock.beat, frame.windowSeconds / secondsPerBeat, state.pitchOffset);
      setPitchReading({ frequency, target });
      take.pitch.push(target, frame, gate);
      if (target.kind === 'note') {
        const judgment = take.pitch.judgment(target.key);
        if (judgment) scoreFeedback.current.pitch(measureAt(state.performance, target.beat), target.key, target.beat, judgment === 'matching');
      }
      setPitchStats(addPitchStats(completedPitch.current, take.pitch.stats));
    };
    input.onPitchError = message => { setPitchEnabled(false); setMessage(message); };
    input.onEnded = message => { stop(); setMessage(message); };
    const hidden = () => { if (document.hidden) { stop(); setMessage('Microphone stopped while Sotto was in the background. Enable it again to continue.'); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { requestVersion.current++; input.onFrame = () => {}; input.onPitch = () => {}; input.onPitchError = () => {}; input.onEnded = () => {}; input.stop(); window.clearTimeout(calibrationTimer.current); document.removeEventListener('visibilitychange', hidden); };
  }, [input]);

  useEffect(() => {
    let animation = 0;
    let lastDraw = -Infinity;
    const draw = (stamp: number) => {
      animation = requestAnimationFrame(draw);
      if (stamp - lastDraw < 50) return;
      lastDraw = stamp;
      const state = current.current;
      const level = (value: number, band: 'rms' | 'peak') => state.adaptiveRange
        ? adaptiveTraceLevel(value, state.traceBoost, state.hideBackground ? state.background?.[band] : undefined, adaptive.current.ceilingDb)
        : traceLevel(value, state.traceBoost, state.hideBackground ? state.background?.[band] : undefined);
      if (state.feedbackView === 'score' && state.score && state.performance) {
        const viewport = document.querySelector('.score-scroller')?.getBoundingClientRect();
        for (const lane of state.feedbackLanes.current) {
          const box = lane.element.getBoundingClientRect();
          if (viewport && (box.bottom < viewport.top || box.top > viewport.bottom || box.right < viewport.left || box.left > viewport.right)) continue;
          const timing = barTiming(state.score, lane.written);
          const measure = state.performance.measures.find(item => item.written === lane.written);
          const expected = measure ? state.targets.filter(beat => beat >= measure.start && beat < measure.end).map(beat => beat - measure.start) : [];
          const clicks = measure ? state.beatGrid.filter(click => click.beat >= measure.start && click.beat < measure.end).map(click => ({ ...click, beat: click.beat - measure.start })) : [];
          drawFeedbackLane(lane, scoreFeedback.current.visible(lane.written, state.feedbackHistory), level, expected.filter(beat => beat < timing.duration), clicks);
          lane.element.dataset.ceilingDb = adaptive.current.ceilingDb.toFixed(1);
        }
      }
      if (!state.visible || (state.feedbackView !== 'timeline' && !state.calibrating)) return;
      const element = canvas.current;
      const context = element?.getContext('2d');
      if (element && context) {
        const width = element.clientWidth, height = element.clientHeight;
        const scale = window.devicePixelRatio || 1;
        if (element.width !== Math.round(width * scale) || element.height !== Math.round(height * scale)) { element.width = Math.round(width * scale); element.height = Math.round(height * scale); }
        context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, width, height);
        const now = !state.playing && pass.current && frozenTime.current ? frozenTime.current : input.time;
        const span = state.plotWindow, future = state.visibleLookAhead, history = span - future;
        const left = now - history;
        const x = (time: number) => (time - left) / span * width;
        context.fillStyle = '#f4f7ed'; context.fillRect(0, 0, width, height);
        context.font = '10px system-ui';
        for (let offset = Math.ceil(-history / (span / 6)) * (span / 6); offset <= future; offset += span / 6) {
          const position = x(now + offset);
          context.strokeStyle = '#dfe6d5'; context.beginPath(); context.moveTo(position, 0); context.lineTo(position, height - 16); context.stroke();
          context.fillStyle = '#7e8b73'; context.textAlign = position > width - 25 ? 'right' : 'left';
          context.fillText(`${offset > 0 ? '+' : ''}${offset}s`, position + (position > width - 25 ? -3 : 3), height - 4);
        }
        for (const take of [...completedPasses.current, ...(pass.current ? [pass.current] : [])]) {
          const takeStart = take.origin + take.tracker.startBeat * take.tracker.secondsPerBeat;
          const takeEnd = take.endTime ?? (state.player.practiceLoop.enabled ? take.origin + state.player.practiceLoop.end * take.tracker.secondsPerBeat : Infinity);
          // Use the same beat/subdivision pattern as the audible metronome.
          for (const click of state.beatGrid) {
            const time = take.origin + click.beat * take.tracker.secondsPerBeat;
            if (time < left || time > left + span || time < takeStart - .01 || time >= takeEnd - .001) continue;
            context.strokeStyle = '#b64e4e';
            context.lineWidth = click.accent === 'downbeat' ? 1.3 : .9;
            context.setLineDash(click.accent === 'downbeat' ? [] : [4, 4]);
            context.beginPath(); context.moveTo(x(time), 0); context.lineTo(x(time), height - 18); context.stroke();
          }
          context.setLineDash([]); context.lineWidth = 1;
          context.strokeStyle = '#809574'; context.setLineDash([3, 3]);
          for (const beat of take.tracker.expected) {
            if (beat < take.tracker.startBeat - .015) continue;
            const time = take.origin + beat * take.tracker.secondsPerBeat;
            if (time < left || time > left + span || time < takeStart - .01 || time >= takeEnd - .001) continue;
            context.beginPath(); context.moveTo(x(time), 5); context.lineTo(x(time), height - 18); context.stroke();
          }
          context.setLineDash([]);
        }
        const columns = traceColumns(samples.current, left, span, width);
        const baseline = height - 20;
        const y = (value: number, band: 'rms' | 'peak') => baseline - level(value, band) * (height - 30);
        if (columns.length) {
          // Fill the volume envelope and preserve each pixel's maximum peak.
          // The visual boost never changes the input or onset detector.
          context.beginPath(); context.moveTo(columns[0].x, baseline);
          columns.forEach(column => context.lineTo(column.x, y(column.rms, 'rms')));
          context.lineTo(columns.at(-1)!.x, baseline); context.closePath();
          context.fillStyle = '#82ac7580'; context.fill();
          context.beginPath(); context.strokeStyle = '#285d40'; context.lineWidth = 1.8;
          columns.forEach((column, i) => {
            const top = Math.min(y(column.peak, 'peak'), y(column.rms, 'rms'));
            if (i) context.lineTo(column.x, top); else context.moveTo(column.x, top);
          });
          context.stroke();
        }
        context.lineWidth = 1;
        for (const dot of dots.current) {
          if (dot.time < left || dot.time > left + span) continue;
          context.fillStyle = { 'on-time': '#327257', early: '#b17b27', late: '#597eae', extra: '#92998c' }[dot.kind];
          context.beginPath(); context.arc(x(dot.time), 10, 4, 0, Math.PI * 2); context.fill();
        }
        context.strokeStyle = '#315e47'; context.beginPath(); context.moveTo(x(now), 0); context.lineTo(x(now), height - 17); context.stroke();
      }
    };
    animation = requestAnimationFrame(draw); return () => cancelAnimationFrame(animation);
  }, [input]);

  async function start(nextDevice = device) {
    const version = ++requestVersion.current;
    setBusy(true); setMessage(''); reset(); beginBaseline();
    try {
      const started = await input.start(nextDevice);
      if (version !== requestVersion.current) return;
      setEnabled(started); props.onMicState(started);
      if (started) {
        const settings = input.settings;
        const reported = (value: boolean | undefined) => value === undefined ? 'not reported' : value ? 'on' : 'off';
        setCaptureInfo(`Browser reports: noise suppression ${reported(settings?.noiseSuppression)} · echo cancellation ${reported(settings?.echoCancellation)} · automatic gain ${reported(settings?.autoGainControl)}`);
        const found = await navigator.mediaDevices.enumerateDevices();
        if (version === requestVersion.current) setDevices(found.filter(device => device.kind === 'audioinput'));
      }
    } catch (error) {
      if (version !== requestVersion.current) return;
      stop();
      const name = error instanceof DOMException ? error.name : '';
      setMessage(name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser’s site settings, then try again.' :
        name === 'NotFoundError' ? 'No microphone was found. Connect an input device and try again.' : error instanceof Error ? error.message : 'The microphone could not start.');
    } finally { if (version === requestVersion.current) setBusy(false); }
  }
  function calibrate() {
    props.prepareCalibration(); reset(); detector.current.reset();
    calibration.current = { times: input.calibrationPulses(), detected: [] };
    setCalibrating(true); setMessage('Listening for six speaker clicks. Keep the room quiet.');
    calibrationTimer.current = window.setTimeout(() => {
      const result = calibration.current; calibration.current = null; setCalibrating(false);
      if (!result) return;
      try { const offset = calibrationOffset(result.times, result.detected); setDelay(offset); setMessage(`Speaker/microphone alignment: ${offset} ms. Changing the audio route may require another adjustment.`); }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Calibration did not complete.'); }
    }, 5300);
  }
  useImperativeHandle(ref, () => ({ toggleMicrophone: () => { if (enabled || busy) stop(); else void start(); } }));
  const review = rhythmReview(stats, timing);
  const offsetLabel = review.offsetMs === null ? '—' : Math.abs(review.offsetMs) < .5 ? 'Centered' : `${Math.abs(Math.round(review.offsetMs))} ms ${review.offsetMs < 0 ? 'early' : 'late'}`;
  const heardMidi = pitchReading?.frequency ? frequencyMidi(pitchReading.frequency) : null;
  const pitchTarget = pitchReading?.target;
  const pitchMatches = heardMidi !== null && pitchTarget?.kind === 'note' ? Math.round(heardMidi) === Math.round(pitchTarget.midi) : null;
  const pitchPrompt = !enabled ? 'Enable mic to check pitch.' :
    learningBaseline ? 'Learning background: keep your instrument quiet.' :
    calibrating ? 'Pitch checking paused for calibration.' :
    props.player.countingIn ? 'Count-in: pitch scoring starts with the score.' : pitchTarget?.kind === 'choose-voice' ? 'Choose one practice voice to compare pitches.' :
    pitchTarget?.kind === 'chord' ? 'Chord or overlapping pitches: not scored.' :
    pitchTarget?.kind === 'percussion' ? 'Percussion is not pitch-scored.' :
    pitchTarget?.kind === 'transition' ? 'Between notes: not scored.' :
    pitchTarget?.kind === 'rest' ? 'Score rest: not pitch-scored.' :
    !pitchReading || heardMidi === null ? 'Waiting for a clear, sustained note…' :
    !pitchTarget ? 'Input check: start playback to compare with the score.' : null;
  const pitchCents = heardMidi !== null && pitchTarget?.kind === 'note' ? Math.round((heardMidi - pitchTarget.midi) * 100) : null;
  const feedback = lastAttack ? lastAttack.kind === 'extra' ? 'Unmatched attack' : `${lastAttack.kind === 'on-time' ? 'On time' : lastAttack.kind === 'early' ? 'Early' : 'Late'} · ${Math.round(lastAttack.errorMs!)} ms` :
    enabled ? props.playing ? 'Listening for attacks…' : 'Play a few notes to check the input, then start the score.' : 'Enable the microphone to begin.';
  return <section className="rhythm-panel" aria-label="Microphone rhythm feedback" hidden={!props.visible}>
    <div className="rhythm-heading"><h2><Mic size={16}/> Rhythm feedback <span className="beta-label">PREVIEW</span></h2><button className={`quiet-button ${enabled ? 'mic-enabled' : ''}`} aria-label={busy ? 'Cancel microphone' : enabled ? 'Stop microphone' : 'Enable microphone'} onClick={() => busy || enabled ? stop() : void start()}>{enabled ? <MicOff size={15}/> : <Mic size={15}/>}<span>{busy ? 'Cancel' : enabled ? 'Stop mic' : 'Enable mic'}</span></button><button className="icon-button" aria-label="Hide rhythm feedback" onClick={props.onHide}><X size={16}/></button></div>
    <div className="rhythm-monitor"><div className="input-level" role="meter" aria-label="Microphone input level" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={Math.round(level)}><span style={{ width: `${Math.max(0, (level + 70) / 70 * 100)}%` }}/></div><span>{enabled ? `${Math.round(level)} dB` : 'Mic off'}</span><button className="baseline-button" aria-label="Learn microphone baseline" disabled={!enabled || busy || calibrating || learningBaseline} onClick={() => beginBaseline(true)}>{enabled && learningBaseline ? 'Learning baseline…' : 'Learn baseline'}</button>{background && <span className="baseline-readout">Background {Math.round(20 * Math.log10(background.rms))} dB</span>}<strong className={clipped ? 'clipped' : ''}>{clipped ? 'Input clipping—lower microphone gain.' : feedback}</strong></div>
    {pitchEnabled && <div className={`pitch-feedback ${pitchMatches === true ? 'pitch-matching' : pitchMatches === false ? 'pitch-different' : ''}`} role="group" aria-label="Pitch feedback" data-heard-midi={heardMidi ?? ''} data-expected-midi={pitchTarget?.kind === 'note' ? pitchTarget.midi : ''} data-matching={pitchStats.matching} data-different={pitchStats.different}>
      <span>Pitch estimate <strong>{heardMidi === null ? '—' : pitchName(heardMidi)}</strong></span>
      {pitchTarget?.kind === 'note' && <span>Expected <strong>{pitchName(pitchTarget.midi)}</strong></span>}
      <span>{pitchPrompt ?? (pitchMatches ? `Matching note · ${pitchCents} cents` : 'Different note')}</span>
      <span className="pitch-totals">Checked: {pitchStats.matching} matching · {pitchStats.different} different</span>
    </div>}
    <canvas ref={canvas} hidden={props.feedbackView !== 'timeline' && !calibrating} data-window-seconds={plotWindow} data-trace-boost={traceBoost} data-background-rms={background?.rms} data-background-ready={!!background} data-hide-background={hideBackground} data-metronome-beats={beatGrid.length} data-downbeats={beatGrid.filter(click => click.accent === 'downbeat').length} data-lookahead-seconds={visibleLookAhead} role="img" aria-label="Microphone volume with score attacks and metronome beats"/>
    <div className="rhythm-footer"><div className="rhythm-stats" aria-label="Rhythm timing estimates" data-completed-loops={loopPasses} data-history-dots={dots.current.length} data-on-time={stats.onTime} data-early={stats.early} data-late={stats.late} data-missed={stats.missed} data-extra={stats.extra}><span>On time <strong>{stats.onTime}</strong></span><span>Early <strong>{stats.early}</strong></span><span>Late <strong>{stats.late}</strong></span><span>Missed <strong>{stats.missed}</strong></span><span>Unmatched <strong>{stats.extra}</strong></span></div><div className="rhythm-plot-controls"><label>Feedback<select aria-label="Feedback placement" value={props.feedbackView} onChange={event => props.onFeedbackView(event.target.value as 'score' | 'timeline')}><option value="score">Under score</option><option value="timeline">Timeline</option></select></label>{props.feedbackView === 'score' && <label>Previous attempts<select aria-label="Feedback history" value={feedbackHistory} onChange={event => setFeedbackHistory(Number(event.target.value))}>{[0, 1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count === 0 ? 'None' : count}</option>)}</select></label>}<label className={props.feedbackView === 'score' ? 'timeline-only-control' : ''}>Plot window<select aria-label="Rhythm plot window" value={plotWindow} onChange={event => setPlotWindow(Number(event.target.value))}>{[6, 12, 24, 48].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label><label className={props.feedbackView === 'score' ? 'timeline-only-control' : ''}>Look ahead<select aria-label="Rhythm look ahead" value={visibleLookAhead} onChange={event => setLookAhead(Number(event.target.value))}>{LOOK_AHEAD_CHOICES.filter(seconds => seconds <= plotWindow - 2).map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label><label>Trace boost<select aria-label="Microphone trace boost" value={traceBoost} onChange={event => setTraceBoost(Number(event.target.value))}>{[0, 6, 12, 18, 24, 30, 36].map(db => <option key={db} value={db}>+{db} dB</option>)}</select></label></div><div className="rhythm-legend"><span>Volume fill · peak outline · green dashed notes</span><span className="beat-legend">Red: solid bar starts · dashed beats</span><span>Dots: green on time · amber early · blue late · gray unmatched</span>{props.feedbackView === 'score' && <span>Faded: previous attempts · ✓ / ×: pitch match / different</span>}</div></div>
    {review.assessed > 0 && <details className="rhythm-review" open={!props.playing}>
      <summary><span>Take review</span><strong>{review.onTimePercent}% on time</strong><span>{review.matched} / {review.expected} expected attacks matched</span></summary>
      <div className="rhythm-review-metrics" role="group" aria-label="Rhythm take review" data-assessed={review.assessed} data-offset-ms={review.offsetMs ?? ''} data-spread-ms={review.spreadMs ?? ''}>
        <span title="Mean signed timing error after input-offset correction; device latency can contribute.">Average offset <strong>{review.enoughTiming ? offsetLabel : '—'}</strong></span>
        <span title="Standard deviation of matched timing errors: lower means more consistent timing, even if consistently early or late.">Timing spread <strong>{review.enoughTiming ? `${Math.round(review.spreadMs!)} ms` : '—'}</strong></span>
        <span title="Mean absolute distance from the expected score attacks.">Average error <strong>{review.enoughTiming ? `${Math.round(review.meanErrorMs!)} ms` : '—'}</strong></span>
        {lastLoop && <span>Last loop <strong>{lastLoop.onTimePercent}% on time · {lastLoop.matched}/{lastLoop.expected} matched</strong></span>}
      </div>
      <p>{review.enoughTiming ? 'On-time percentage includes missed and unmatched attacks. Calibrate input timing before interpreting the offset.' : 'Play at least four matched attacks for timing averages. Missed and unmatched attacks count toward the on-time percentage.'}</p>
    </details>}
    {message && <p className="rhythm-message" role="status">{message}</p>}
    <details className="rhythm-options"><summary>Input, timing &amp; calibration <ChevronDown size={13}/></summary><div className="rhythm-fields">
      <label className="baseline-option"><input type="checkbox" aria-label="Adaptive trace range" checked={adaptiveRange} onChange={event => setAdaptiveRange(event.target.checked)}/>Adaptive trace range (display only)</label>
      <label className="baseline-option"><input type="checkbox" aria-label="Check pitch for single notes" checked={pitchEnabled} disabled={calibrating} onChange={event => setPitchEnabled(event.target.checked)}/>Check pitch (single notes)</label>
      <label className="baseline-option"><input aria-label="Hide learned microphone background" type="checkbox" checked={hideBackground} onChange={event => setHideBackground(event.target.checked)}/>Hide learned background (display only)</label>
      <label>Practice voice<select aria-label="Rhythm practice voice" value={actualVoice} onChange={event => props.onPracticeVoice(event.target.value)} disabled={calibrating}>{props.score?.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}<option value="all">All voices</option></select></label>
      <button className={`quiet-button ${practiceMuted ? 'mic-enabled' : ''}`} aria-pressed={practiceMuted} onClick={() => props.muteVoice(actualVoice)} disabled={!practiceVoices.length || calibrating}>{practiceMuted ? <VolumeX size={15}/> : <Volume2 size={15}/>}<span>{practiceMuted ? 'Unmute' : 'Mute'} practice voice</span></button><span className="practice-mute-status" role="status">{actualVoice === 'all' ? 'All voices' : practiceVoices[0]?.name}: playback {practiceMuted ? 'muted' : 'on'}. Microphone is independent.</span>
      <label>Microphone<select aria-label="Microphone device" value={device} disabled={busy || calibrating} onChange={event => { setDevice(event.target.value); setDelay(0); if (enabled) void start(event.target.value); }}><option value="">System default</option>{devices.filter(item => item.deviceId).map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Input ${index + 1}`}</option>)}</select></label>
      <label>Input offset (ms)<input aria-label="Microphone timing offset" type="number" min="-50" max="600" step="5" value={delay} disabled={calibrating} onChange={event => setDelay(Math.min(600, Math.max(-50, Number(event.target.value))))}/></label>
      <label>Low-pass filter<select aria-label="Microphone low-pass filter" value={lowpass} disabled={calibrating} onChange={event => setLowpass(Number(event.target.value))}><option value={0}>Off</option><option value={2000}>2 kHz</option><option value={4000}>4 kHz</option><option value={8000}>8 kHz</option></select></label>
      <label>High-pass filter<select aria-label="Microphone high-pass filter" value={highpass} disabled={calibrating} onChange={event => setHighpass(Number(event.target.value))}><option value={0}>Off</option>{[20, 40, 80, 150].map(hz => <option key={hz} value={hz}>{hz} Hz</option>)}</select></label>
      <label>Attack gate ({gate} dB)<input aria-label="Microphone attack gate" type="range" min="-65" max="-20" value={gate} disabled={calibrating} onChange={event => setGate(Number(event.target.value))}/></label>
      <label>On-time tolerance (ms)<input aria-label="Rhythm timing tolerance" type="number" min="25" max="150" step="5" value={tolerance} disabled={calibrating} onChange={event => setTolerance(Math.min(150, Math.max(25, Number(event.target.value))))}/></label>
      <button className="quiet-button" disabled={!enabled || busy || calibrating || learningBaseline} onClick={calibrate}>{calibrating ? 'Calibrating…' : 'Calibrate speakers'}</button><button className="quiet-button" disabled={calibrating} onClick={() => reset(true)}>Clear feedback</button>
    </div>{enabled && <p className="capture-processing">{captureInfo}</p>}<p>Capture requests noise suppression, echo cancellation and automatic gain off; the browser may not expose all settings. AirPods and Apple’s system Mic Mode can still process sound. If available in Control Center, try Standard or Wide Spectrum for music. A device’s built-in microphone can be selected while keeping AirPods for listening.</p><p>The baseline is measured during the first two seconds of input. Use Learn baseline with your instrument quiet to measure it again; this pauses playback and the metronome. Adaptive trace range follows recent playing levels, adding headroom quickly for louder notes and recovering slowly for quiet passages. Silence does not increase gain. It does not change recording gain, the learned noise floor, or attack/pitch detection. Baseline cropping and trace boost also affect only the drawing. Red lines follow the metronome Pulse setting: Beat gives two lines in 6/8 (first and fourth eighths), while Subdivision gives all six. Each bar starts solid; the remaining lines are dashed. Look ahead is independent of the total plot window; the default shows 24 seconds total with 4 seconds ahead.</p><p>The 4 kHz low-pass reduces high-frequency noise before the volume plot and attack detector. The optional high-pass removes low rumble. Filters cannot recover sound already suppressed by the microphone. Trace boost changes only the drawing, not detection sensitivity.</p><p>Use headphones so Sotto’s playback does not trigger the microphone. Mute the voice you are playing. Timing estimates use detected attacks. Optional pitch checking compares one sustained note at a time with the selected practice voice, including playback-octave adjustment. It waits for two consistent, clear estimates above the Attack gate and 6 dB above learned background; chords, transitions, short notes and unclear input stay unscored. It uses A4 = 440 Hz and counts matching semitones; cents show tuning difference. Use headphones and play only your selected part. Pitch analysis stays on-device; brief sample windows are discarded after processing, and only results remain in memory. The detector adapts its cooldown to the nearby score attacks. Matching follows score order; a second attack closest to a consumed note is unmatched instead of taking the next note. Take review separates average offset from timing spread, so consistently late input is distinguished from uneven timing. Input latency can contribute to the offset; calibrate before judging it. Sustained or overlapping notes, strums and room noise can confuse this first detector.</p><p>A positive offset moves captured input earlier. Adjust it until attacks line up, or run speaker calibration in a quiet room. Calibration measures the current speaker/microphone route; headphones or Bluetooth can change the delay.</p><p>Under score places a trace beneath each engraved system, aligned to note positions. Previous attempts fade behind the latest visit to each bar; choose zero to five previous attempts (one by default). Repeats, practice loops and restarting playback preserve these traces until Clear feedback, a different score/voice or detection settings change. Pitch checks stay on the score as ✓ or × after a stable judgment. The optional Timeline retains its scrolling window and separate Look ahead. Timing totals cover the current take: loop repeats accumulate totals, while restarting or seeking begins a new take. Pausing freezes captured feedback. Pausing freezes the graph. Only level/pitch summaries are retained; microphone audio is never recorded or uploaded.</p></details>
  </section>;
});
export default RhythmPanel;
