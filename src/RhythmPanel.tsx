import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ChevronDown, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import type { Player } from './audio';
import { metronomeGrid, type ClickMode } from './sounds';
import { MicrophoneInput } from './microphone';
import { calibrationOffset, emptyStats, estimateBackground, expectedAttacks, OnsetDetector, RhythmPass, TRACE_HISTORY_SECONDS, LOOK_AHEAD_CHOICES, plotLookAhead, traceColumns, traceLevel, type Attack, type BackgroundLevel, type LevelFrame, type RhythmStats } from './rhythm';
import type { Performance, Score } from './score';

type Props = { visible: boolean; onHide(): void; player: Player; score: Score | null; performance: Performance | null;
  playing: boolean; bpm: number; clickMode: ClickMode; onMicState(active: boolean): void; prepareCalibration(): void; mutedVoices: ReadonlySet<string>; muteVoice(voice: string): void };
type Sample = LevelFrame;
type Dot = Attack & { time: number };
type Pass = { tracker: RhythmPass; origin: number; lastBeat: number; lastTime: number; endTime?: number };
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
  const [device, setDevice] = useState('');
  const [voice, setVoice] = useState('melody');
  const [delay, setDelay] = useState(() => setting('sotto.inputDelay', 0, -50, 600));
  const [gate, setGate] = useState(() => setting('sotto.inputGate', -42, -65, -20));
  const [plotWindow, setPlotWindow] = useState(() => { const saved = setting('sotto.plotWindow', 24, 6, 48); return [6, 12, 24, 48].includes(saved) ? saved : 24; });
  const [lookAhead, setLookAhead] = useState(() => setting('sotto.lookAhead', 4, 0, 40));
  const visibleLookAhead = plotLookAhead(plotWindow, lookAhead);
  const [traceBoost, setTraceBoost] = useState(() => setting('sotto.traceBoost', 12, 0, 36));
  const [highpass, setHighpass] = useState(() => setting('sotto.highpass', 0, 0, 150));
  const [lowpass, setLowpass] = useState(() => setting('sotto.lowpass', 4000, 0, 8000));
  const [captureInfo, setCaptureInfo] = useState('');
  const [background, setBackground] = useState<BackgroundLevel | null>(null);
  const [learningBaseline, setLearningBaseline] = useState(false);
  const [hideBackground, setHideBackground] = useState(() => { try { return localStorage.getItem('sotto.hideBackground') !== 'false'; } catch { return true; } });
  const [tolerance, setTolerance] = useState(() => setting('sotto.rhythmTolerance', 80, 25, 150));
  const [stats, setStats] = useState<RhythmStats>(emptyStats);
  const [lastAttack, setLastAttack] = useState<Attack | null>(null);
  const [level, setLevel] = useState(-90);
  const [clipped, setClipped] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const samples = useRef<Sample[]>([]);
  const dots = useRef<Dot[]>([]);
  const pass = useRef<Pass | null>(null);
  const completedPasses = useRef<Pass[]>([]);
  const completedStats = useRef<RhythmStats>(emptyStats());
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
  const beatGrid = useMemo(() => props.performance ? metronomeGrid(props.performance.measures, props.score?.beatUnit ?? 1, props.clickMode) : [], [props.performance, props.score?.beatUnit, props.clickMode]);
  const current = useRef({ ...props, enabled, delay, gate, tolerance, targets, plotWindow, visibleLookAhead, traceBoost, background, hideBackground, beatGrid });
  current.current = { ...props, enabled, delay, gate, tolerance, targets, plotWindow, visibleLookAhead, traceBoost, background, hideBackground, beatGrid };

  function reset() {
    pass.current = null; completedPasses.current = []; completedStats.current = emptyStats(); setLoopPasses(0); samples.current = []; dots.current = []; detector.current.reset();
    frozenTime.current = 0; setStats(emptyStats()); setLastAttack(null);
  }
  function beginBaseline(manual = false) {
    baselineCapture.current = { since: null, frames: [], manual };
    setBackground(null); setLearningBaseline(true);
    if (manual) { props.prepareCalibration(); setMessage('Listening to the background for two seconds. Keep your instrument quiet.'); }
  }
  function stop() {
    requestVersion.current++; baselineCapture.current = null; setLearningBaseline(false);
    window.clearTimeout(calibrationTimer.current); calibration.current = null;
    input.stop(); setEnabled(false); setBusy(false); setCalibrating(false); current.current.onMicState(false);
    levelPeak.current = 0; setLevel(-90); setClipped(false);
  }
  useEffect(() => {
    try { localStorage.setItem('sotto.inputDelay', String(delay)); localStorage.setItem('sotto.inputGate', String(gate)); localStorage.setItem('sotto.rhythmTolerance', String(tolerance)); } catch { /* Optional settings. */ }
    reset();
  }, [props.performance, actualVoice, props.bpm, delay, gate, tolerance]);
  useEffect(() => {
    try { localStorage.setItem('sotto.plotWindow', String(plotWindow)); localStorage.setItem('sotto.lookAhead', String(lookAhead)); localStorage.setItem('sotto.traceBoost', String(traceBoost)); localStorage.setItem('sotto.hideBackground', String(hideBackground)); } catch { /* Optional display preferences. */ }
  }, [plotWindow, lookAhead, traceBoost, hideBackground]);
  useEffect(() => {
    input.setFilters(highpass, lowpass);
    if (current.current.enabled) beginBaseline(); else { setBackground(null); baselineCapture.current = null; setLearningBaseline(false); }
    try { localStorage.setItem('sotto.highpass', String(highpass)); localStorage.setItem('sotto.lowpass', String(lowpass)); } catch { /* Optional input preferences. */ }
    reset();
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
      const onset = detector.current.push(frame, state.gate);
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
      levelPeak.current = Math.max(levelPeak.current, frame.rms);
      if (frame.peak >= .98) clipUntil.current = frame.time + .5;
      if (frame.time - latestLevelUpdate.current > .12) {
        latestLevelUpdate.current = frame.time;
        setLevel(Math.max(-90, 20 * Math.log10(Math.max(1e-5, levelPeak.current)))); levelPeak.current = 0;
        setClipped(frame.time < clipUntil.current);
        if (pass.current) setStats(Object.fromEntries(Object.entries(pass.current.tracker.stats).map(([key, value]) => [key, value + completedStats.current[key as keyof RhythmStats]])) as RhythmStats);
      }
      if (calibration.current) {
        if (onset) calibration.current.detected.push(frame.time);
        samples.current.push(frame); samples.current = samples.current.filter(sample => sample.time > frame.time - TRACE_HISTORY_SECONDS);
        return;
      }
      const time = frame.time - state.delay / 1000;
      const clock = state.player.clockAt(time);
      if (clock.active && (state.playing || pass.current)) {
        const secondsPerBeat = 60 / (state.bpm * (state.score?.beatUnit ?? 1));
        const previous = pass.current;
        if (!previous || clock.beat < previous.lastBeat - .05 ||
            Math.abs(clock.beat - previous.lastBeat - (time - previous.lastTime) / secondsPerBeat) > .25) {
          const loop = state.player.practiceLoop;
          const wrapped = previous && loop.enabled && clock.beat < previous.lastBeat &&
            previous.lastBeat > loop.end - .25 && clock.beat < loop.start + .25;
          if (wrapped) {
            previous.tracker.advance(loop.end + previous.tracker.windowMs / 1000 / secondsPerBeat);
            previous.endTime = previous.origin + loop.end * secondsPerBeat;
            completedPasses.current.push(previous);
            completedPasses.current = completedPasses.current.filter(take => take.endTime! > time - TRACE_HISTORY_SECONDS);
            for (const key of Object.keys(completedStats.current) as (keyof RhythmStats)[]) completedStats.current[key] += previous.tracker.stats[key];
            setLoopPasses(value => value + 1);
          } else {
            completedPasses.current = []; completedStats.current = emptyStats(); setLoopPasses(0);
            samples.current = []; dots.current = []; setStats(emptyStats()); setLastAttack(null);
          }
          pass.current = { tracker: new RhythmPass(loop.enabled ? state.targets.filter(beat => beat >= loop.start && beat < loop.end) : state.targets,
            secondsPerBeat, wrapped ? loop.start : Math.max(0, clock.beat - .1 / secondsPerBeat), state.tolerance),
            origin: time - clock.beat * secondsPerBeat, lastBeat: clock.beat, lastTime: time };
        }
        pass.current!.lastBeat = clock.beat; pass.current!.lastTime = time;
        pass.current!.tracker.advance(clock.beat);
        if (onset) {
          const attack = pass.current!.tracker.attack(clock.beat);
          dots.current.push({ ...attack, time }); setLastAttack(attack);
        }
      } else if (pass.current) {
        // Input can arrive after pause due to device latency. Finish consuming
        // frames from the active audio interval before freezing the graph.
        frozenTime.current = pass.current.lastTime;
        if (state.performance && pass.current.lastBeat >= state.performance.duration - .1) {
          pass.current.tracker.advance(state.performance.duration + pass.current.tracker.windowMs / 1000 / pass.current.tracker.secondsPerBeat);
        }
        return;
      }
      else if (onset) dots.current.push({ time, beat: 0, errorMs: null, kind: 'extra' });
      samples.current.push({ ...frame, time });
      samples.current = samples.current.filter(sample => sample.time > time - TRACE_HISTORY_SECONDS);
      dots.current = dots.current.filter(dot => dot.time > time - TRACE_HISTORY_SECONDS);
    };
    input.onEnded = message => { stop(); setMessage(message); };
    const hidden = () => { if (document.hidden) { stop(); setMessage('Microphone stopped while Sotto was in the background. Enable it again to continue.'); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { requestVersion.current++; input.onFrame = () => {}; input.onEnded = () => {}; input.stop(); window.clearTimeout(calibrationTimer.current); document.removeEventListener('visibilitychange', hidden); };
  }, [input]);

  useEffect(() => {
    if (!props.visible) return;
    let animation = 0;
    const draw = () => {
      const element = canvas.current;
      const context = element?.getContext('2d');
      if (element && context) {
        const width = element.clientWidth, height = element.clientHeight;
        const scale = window.devicePixelRatio || 1;
        if (element.width !== Math.round(width * scale) || element.height !== Math.round(height * scale)) { element.width = Math.round(width * scale); element.height = Math.round(height * scale); }
        context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, width, height);
        const state = current.current;
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
          // All notated beats plus audible subdivisions, independent of note attacks.
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
        const y = (value: number, band: 'rms' | 'peak') => baseline - traceLevel(value, state.traceBoost, state.hideBackground ? state.background?.[band] : undefined) * (height - 30);
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
      animation = requestAnimationFrame(draw);
    };
    animation = requestAnimationFrame(draw); return () => cancelAnimationFrame(animation);
  }, [props.visible, input]);

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
  const feedback = lastAttack ? lastAttack.kind === 'extra' ? 'Unmatched attack' : `${lastAttack.kind === 'on-time' ? 'On time' : lastAttack.kind === 'early' ? 'Early' : 'Late'} · ${Math.round(lastAttack.errorMs!)} ms` :
    enabled ? props.playing ? 'Listening for attacks…' : 'Play a few notes to check the input, then start the score.' : 'Enable the microphone to begin.';
  return <section className="rhythm-panel" aria-label="Microphone rhythm feedback" hidden={!props.visible}>
    <div className="rhythm-heading"><h2><Mic size={16}/> Rhythm feedback <span className="beta-label">PREVIEW</span></h2><button className={`quiet-button ${enabled ? 'mic-enabled' : ''}`} aria-label={busy ? 'Cancel microphone' : enabled ? 'Stop microphone' : 'Enable microphone'} onClick={() => busy || enabled ? stop() : void start()}>{enabled ? <MicOff size={15}/> : <Mic size={15}/>}<span>{busy ? 'Cancel' : enabled ? 'Stop mic' : 'Enable mic'}</span></button><button className="icon-button" aria-label="Hide rhythm feedback" onClick={props.onHide}><X size={16}/></button></div>
    <div className="rhythm-monitor"><div className="input-level" role="meter" aria-label="Microphone input level" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={Math.round(level)}><span style={{ width: `${Math.max(0, (level + 70) / 70 * 100)}%` }}/></div><span>{enabled ? `${Math.round(level)} dB` : 'Mic off'}</span><button className="baseline-button" aria-label="Learn microphone baseline" disabled={!enabled || busy || calibrating || learningBaseline} onClick={() => beginBaseline(true)}>{enabled && learningBaseline ? 'Learning baseline…' : 'Learn baseline'}</button>{background && <span className="baseline-readout">Background {Math.round(20 * Math.log10(background.rms))} dB</span>}<strong className={clipped ? 'clipped' : ''}>{clipped ? 'Input clipping—lower microphone gain.' : feedback}</strong></div>
    <canvas ref={canvas} data-window-seconds={plotWindow} data-trace-boost={traceBoost} data-background-rms={background?.rms} data-background-ready={!!background} data-hide-background={hideBackground} data-metronome-beats={beatGrid.length} data-downbeats={beatGrid.filter(click => click.accent === 'downbeat').length} data-lookahead-seconds={visibleLookAhead} role="img" aria-label="Microphone volume with score attacks and metronome beats"/>
    <div className="rhythm-footer"><div className="rhythm-stats" aria-label="Rhythm timing estimates" data-completed-loops={loopPasses} data-history-dots={dots.current.length} data-on-time={stats.onTime} data-early={stats.early} data-late={stats.late} data-missed={stats.missed} data-extra={stats.extra}><span>On time <strong>{stats.onTime}</strong></span><span>Early <strong>{stats.early}</strong></span><span>Late <strong>{stats.late}</strong></span><span>Missed <strong>{stats.missed}</strong></span><span>Unmatched <strong>{stats.extra}</strong></span></div><div className="rhythm-plot-controls"><label>Plot window<select aria-label="Rhythm plot window" value={plotWindow} onChange={event => setPlotWindow(Number(event.target.value))}>{[6, 12, 24, 48].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label><label>Look ahead<select aria-label="Rhythm look ahead" value={visibleLookAhead} onChange={event => setLookAhead(Number(event.target.value))}>{LOOK_AHEAD_CHOICES.filter(seconds => seconds <= plotWindow - 2).map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label><label>Trace boost<select aria-label="Microphone trace boost" value={traceBoost} onChange={event => setTraceBoost(Number(event.target.value))}>{[0, 6, 12, 18, 24, 30, 36].map(db => <option key={db} value={db}>+{db} dB</option>)}</select></label></div><div className="rhythm-legend"><span>Volume fill · peak outline · green dashed notes</span><span className="beat-legend">Red: solid bar starts · dashed beats</span><span>Dots: green on time · amber early · blue late · gray unmatched</span></div></div>
    {message && <p className="rhythm-message" role="status">{message}</p>}
    <details className="rhythm-options"><summary>Input, timing &amp; calibration <ChevronDown size={13}/></summary><div className="rhythm-fields">
      <label className="baseline-option"><input aria-label="Hide learned microphone background" type="checkbox" checked={hideBackground} onChange={event => setHideBackground(event.target.checked)}/>Hide learned background (display only)</label>
      <label>Practice voice<select aria-label="Rhythm practice voice" value={actualVoice} onChange={event => setVoice(event.target.value)} disabled={calibrating}>{props.score?.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}<option value="all">All voices</option></select></label>
      <button className={`quiet-button ${practiceMuted ? 'mic-enabled' : ''}`} aria-pressed={practiceMuted} onClick={() => props.muteVoice(actualVoice)} disabled={!practiceVoices.length || calibrating}>{practiceMuted ? <VolumeX size={15}/> : <Volume2 size={15}/>}<span>{practiceMuted ? 'Unmute' : 'Mute'} practice voice</span></button><span className="practice-mute-status" role="status">{actualVoice === 'all' ? 'All voices' : practiceVoices[0]?.name}: playback {practiceMuted ? 'muted' : 'on'}. Microphone is independent.</span>
      <label>Microphone<select aria-label="Microphone device" value={device} disabled={busy || calibrating} onChange={event => { setDevice(event.target.value); setDelay(0); if (enabled) void start(event.target.value); }}><option value="">System default</option>{devices.filter(item => item.deviceId).map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Input ${index + 1}`}</option>)}</select></label>
      <label>Input offset (ms)<input aria-label="Microphone timing offset" type="number" min="-50" max="600" step="5" value={delay} disabled={calibrating} onChange={event => setDelay(Math.min(600, Math.max(-50, Number(event.target.value))))}/></label>
      <label>Low-pass filter<select aria-label="Microphone low-pass filter" value={lowpass} disabled={calibrating} onChange={event => setLowpass(Number(event.target.value))}><option value={0}>Off</option><option value={2000}>2 kHz</option><option value={4000}>4 kHz</option><option value={8000}>8 kHz</option></select></label>
      <label>High-pass filter<select aria-label="Microphone high-pass filter" value={highpass} disabled={calibrating} onChange={event => setHighpass(Number(event.target.value))}><option value={0}>Off</option>{[20, 40, 80, 150].map(hz => <option key={hz} value={hz}>{hz} Hz</option>)}</select></label>
      <label>Attack gate ({gate} dB)<input aria-label="Microphone attack gate" type="range" min="-65" max="-20" value={gate} disabled={calibrating} onChange={event => setGate(Number(event.target.value))}/></label>
      <label>On-time tolerance (ms)<input aria-label="Rhythm timing tolerance" type="number" min="25" max="150" step="5" value={tolerance} disabled={calibrating} onChange={event => setTolerance(Math.min(150, Math.max(25, Number(event.target.value))))}/></label>
      <button className="quiet-button" disabled={!enabled || busy || calibrating || learningBaseline} onClick={calibrate}>{calibrating ? 'Calibrating…' : 'Calibrate speakers'}</button><button className="quiet-button" disabled={calibrating} onClick={reset}>Clear feedback</button>
    </div>{enabled && <p className="capture-processing">{captureInfo}</p>}<p>Capture requests noise suppression, echo cancellation and automatic gain off; the browser may not expose all settings. AirPods and Apple’s system Mic Mode can still process sound. If available in Control Center, try Standard or Wide Spectrum for music. A device’s built-in microphone can be selected while keeping AirPods for listening.</p><p>The baseline is measured during the first two seconds of input. Use Learn baseline with your instrument quiet to measure it again; this pauses playback and the metronome. Baseline cropping and trace boost affect only the drawing. Red lines show every notated beat and click subdivision: each bar starts with a solid line, followed by dashed beat lines. Look ahead is independent of the total plot window; the default shows 24 seconds total with 4 seconds ahead.</p><p>The 4 kHz low-pass reduces high-frequency noise before the volume plot and attack detector. The optional high-pass removes low rumble. Filters cannot recover sound already suppressed by the microphone. Trace boost changes only the drawing, not detection sensitivity.</p><p>Use headphones so Sotto’s playback does not trigger the microphone. Mute the voice you are playing. Timing estimates use detected attacks; they do not check pitches. Sustained or overlapping notes, strums and room noise can confuse this first detector.</p><p>A positive offset moves captured input earlier. Adjust it until attacks line up, or run speaker calibration in a quiet room. Calibration measures the current speaker/microphone route; headphones or Bluetooth can change the delay.</p><p>Feedback covers the current take. Loop repeats keep the recent graph and accumulate timing totals, so you can pause after a wrap to review earlier passes. Starting playback again, seeking or changing timing settings begins a new take. Pausing freezes the graph. Only level summaries are kept in memory; microphone audio is never recorded or uploaded.</p></details>
  </section>;
});
export default RhythmPanel;
