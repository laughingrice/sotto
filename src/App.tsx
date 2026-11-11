import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, ChevronDown, CircleHelp, Ear, FileMusic, FolderOpen, Headphones, Mic, Minus, Music2, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Repeat2, RotateCcw, SlidersHorizontal, Volume2, VolumeX, X } from 'lucide-react';
import { Player } from './audio';
import RhythmPanel, { type RhythmControl } from './RhythmPanel';
import { LibraryPanel, type LibraryControl } from './LibraryPanel';
import { buildBarHighlights } from './bar-highlight';
import { activeNotes, cleanSvg, clockTime, makePerformance, measureAt, loopDisplayBeat, validateScore, type Score } from './score';
import { INSTRUMENTS, clickStep, isInstrument, type ClickMode, type InstrumentId } from './sounds';

const DEFAULT_SCORE = `${import.meta.env.BASE_URL}scores/julia-florida.sotto.json`;

export default function App() {
  const player = useMemo(() => new Player(), []);
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(0);
  const [bpm, setBpm] = useState(44);
  const [repeats, setRepeats] = useState(true);
  const [follow, setFollow] = useState(true);
  const [countIn, setCountIn] = useState(() => { try { return localStorage.getItem('sotto.countIn') === 'true'; } catch { return false; } });
  const [countingIn, setCountingIn] = useState(false);
  const [metronomeMode, setMetronomeMode] = useState<'off' | 'playback' | 'continuous'>('off');
  const metronome = metronomeMode !== 'off';
  const metronomeLabel = { off: 'Off', playback: 'Playback', continuous: 'Continuous' }[metronomeMode];
  const [metronomeStarting, setMetronomeStarting] = useState(false);
  const [clickVolume, setClickVolume] = useState(70);
  const [clickMode, setClickMode] = useState<ClickMode>('beat');
  const [clickCount, setClickCount] = useState(0);
  const [clickPulse, setClickPulse] = useState(false);
  const [clickAccent, setClickAccent] = useState('downbeat');
  const [soundSettings, setSoundSettings] = useState(false);
  const [soundLoading, setSoundLoading] = useState(false);
  const [instrument, setInstrument] = useState<InstrumentId>(() => {
    try { const saved = localStorage.getItem('sotto.instrument'); return isInstrument(saved) ? saved : 'guitar'; } catch { return 'guitar'; }
  });
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [loop, setLoop] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(3);
  const [zoom, setZoom] = useState(100);
  const [help, setHelp] = useState(false);
  const [rhythmVisible, setRhythmVisible] = useState(false);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [pitchOffset, setPitchOffset] = useState(0);
  const [starting, setStarting] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(() => {
    try { return localStorage.getItem('sotto.controlsCollapsed') === 'true'; } catch { return false; }
  });
  const libraryControl = useRef<LibraryControl>(null);
  const rhythmControl = useRef<RhythmControl>(null);
  const scoreRoot = useRef<HTMLDivElement>(null);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const noteElements = useRef(new Map<string, SVGElement>());
  const readyInstrument = useRef(instrument);
  const previousActive = useRef(new Set<string>());
  const barElements = useRef(new Map<number, SVGRectElement>());
  const previousBar = useRef<SVGRectElement | null>(null);
  const lastFollowed = useRef(-1);
  const performance = useMemo(() => score ? makePerformance(score, repeats) : null, [score, repeats]);
  const pages = useMemo(() => score?.pages.map(cleanSvg) ?? [], [score]);
  const displayBeat = loop && performance ? loopDisplayBeat(beat, performance.measures[loopStart]?.start ?? 0, performance.measures[loopEnd]?.end ?? performance.duration) : beat;
  const measure = performance ? measureAt(performance, displayBeat) : null;
  const active = useMemo(() => performance ? activeNotes(performance, displayBeat) : [], [performance, displayBeat]);
  const effectivelyMuted = useMemo(() => new Set(score?.voices.filter(voice => muted.has(voice.id) || (solo !== null && solo !== voice.id)).map(voice => voice.id)), [score, muted, solo]);
  useEffect(() => {
    try { localStorage.setItem('sotto.controlsCollapsed', String(controlsCollapsed)); } catch { /* Storage can be unavailable in private browsing. */ }
    lastFollowed.current = -1;
  }, [controlsCollapsed]);

  const changeZoom = (next: number) => {
    const scroller = scrollRoot.current;
    const sheet = scoreRoot.current?.getBoundingClientRect();
    if (scroller && sheet?.width && sheet.height) {
      const viewport = scroller.getBoundingClientRect();
      zoomAnchor.current = {
        x: (viewport.left + scroller.clientWidth / 2 - sheet.left) / sheet.width,
        y: (viewport.top + scroller.clientHeight / 2 - sheet.top) / sheet.height,
      };
    }
    const value = Math.max(50, Math.min(250, next));
    if (value <= 100 && scroller) scroller.scrollLeft = 0;
    if (playing) lastFollowed.current = -1;
    setZoom(value);
  };

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const scroller = scrollRoot.current;
    const sheet = scoreRoot.current?.getBoundingClientRect();
    if (!anchor || !scroller || !sheet) return;
    const viewport = scroller.getBoundingClientRect();
    // Keep the part being read in view while changing the actual SVG size.
    scroller.scrollTo({
      left: zoom <= 100 ? 0 : scroller.scrollLeft + sheet.left + anchor.x * sheet.width - viewport.left - scroller.clientWidth / 2,
      top: scroller.scrollTop + sheet.top + anchor.y * sheet.height - viewport.top - scroller.clientHeight / 2,
      behavior: 'instant',
    });
    zoomAnchor.current = null;
  }, [zoom]);

  const openScore = useCallback((value: unknown) => {
    validateScore(value);
    // Sanitize before accepting a bundle; reject malformed SVG immediately.
    value.pages.forEach(cleanSvg);
    player.pause(); setPlaying(false); setLoop(false); setLoopStart(0); setLoopEnd(Math.min(3, value.bars.length - 1));
    setMuted(new Set()); setSolo(null); setVolumes({}); setBeat(0); setBpm(value.bpm); setScore(value); setPitchOffset(0); setError('');
    lastFollowed.current = -1;
  }, [player]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(DEFAULT_SCORE, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('The example score could not be loaded.'); return response.json();
    }).then(openScore).catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); });
    return () => { controller.abort(); player.dispose(); };
  }, [openScore, player]);

  useEffect(() => {
    if (!score || !performance) return;
    player.load(score, performance); setPlaying(false); setBeat(0); setLoop(false);
    setLoopStart(0); setLoopEnd(Math.min(3, performance.measures.length - 1));
    player.onEnded = () => { setPlaying(false); setBeat(performance.duration - .001); };
  }, [score, performance, player]);
  useEffect(() => player.setPitchOffset(pitchOffset), [pitchOffset, player]);
  useEffect(() => player.tempo(bpm), [bpm, player, performance]);
  useEffect(() => {
    player.onSoundLoading = setSoundLoading;
    player.onError = error => setError(`Sound could not be loaded: ${error.message}`);
    return () => { player.onSoundLoading = () => {}; player.onError = () => {}; };
  }, [player]);
  useEffect(() => {
    let current = true;
    setSoundLoading(true);
    void player.setInstrument(instrument).then(() => {
      if (!current) return;
      readyInstrument.current = instrument;
      try { localStorage.setItem('sotto.instrument', instrument); } catch { /* Optional preference. */ }
    }).catch(error => {
      if (!current) return;
      setError(`Sound could not be loaded: ${error.message}`);
      setInstrument(readyInstrument.current);
    }).finally(() => { if (current) setSoundLoading(false); });
    return () => { current = false; };
  }, [player, instrument]);
  useEffect(() => player.setMetronomeOptions(clickVolume / 100, clickMode), [player, clickVolume, clickMode]);
  useEffect(() => {
    let timer = 0;
    player.onMetronomeTick = (count, accent) => {
      setClickCount(count); setClickAccent(accent); setClickPulse(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setClickPulse(false), 100);
    };
    return () => { window.clearTimeout(timer); player.onMetronomeTick = () => {}; };
  }, [player]);
  useEffect(() => {
    for (const voice of score?.voices ?? []) {
      player.mute(voice.id, effectivelyMuted.has(voice.id));
      player.volume(voice.id, volumes[voice.id] ?? 1);
    }
  }, [score, effectivelyMuted, volumes, player, performance]);
  useEffect(() => {
    if (!performance) return;
    const start = performance.measures[loopStart]?.start ?? 0;
    const end = performance.measures[loopEnd]?.end ?? performance.duration;
    player.loop(loop, start, end); setBeat(player.beat);
  }, [loop, loopStart, loopEnd, performance, player]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const update = () => { setCountingIn(player.countingIn); setBeat(player.beat); frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, player]);

  useEffect(() => {
    const elements = new Map<string, SVGElement>();
    scoreRoot.current?.querySelectorAll<SVGElement>('.score-note').forEach(element => {
      elements.set(element.id, element);
      const voice = score?.voices.find(voice => voice.id === element.dataset.voice);
      element.style.setProperty('--note-color', voice?.color ?? '#31745e');
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', `Seek to ${voice?.name.toLowerCase() ?? 'score'} note`);
    });
    noteElements.current = elements; previousActive.current.clear();
    barElements.current = score && scoreRoot.current ? buildBarHighlights(scoreRoot.current, score) : new Map();
    previousBar.current = null;
  }, [pages, score]);

  useEffect(() => {
    for (const element of noteElements.current.values()) element.classList.toggle('voice-muted', effectivelyMuted.has(element.dataset.voice ?? ''));
  }, [effectivelyMuted, pages]);
  useEffect(() => {
    const ids = new Set(active.filter(note => !effectivelyMuted.has(note.voice)).map(note => note.id));
    for (const id of previousActive.current) if (!ids.has(id)) noteElements.current.get(id)?.classList.remove('is-active');
    for (const id of ids) noteElements.current.get(id)?.classList.add('is-active');
    previousActive.current = ids;
    const currentBar = measure ? barElements.current.get(measure.written) : undefined;
    if (currentBar !== previousBar.current) {
      previousBar.current?.classList.remove('is-current');
      currentBar?.classList.add('is-current');
      previousBar.current = currentBar ?? null;
    }
    if (!follow || !measure || measure.index === lastFollowed.current) return;
    const anchor = currentBar ?? active.map(note => noteElements.current.get(note.id)).find(Boolean);
    const scroller = scrollRoot.current;
    if (anchor && scroller) {
      const bounds = anchor.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      const outsideY = bounds.top < viewport.top + 50 || bounds.bottom > viewport.bottom - 50;
      const outsideX = bounds.left < viewport.left + 15 || bounds.right > viewport.right - 15;
      if (outsideY || outsideX) {
        scroller.scrollTo({
          top: outsideY ? scroller.scrollTop + bounds.top - viewport.top - viewport.height * .25 : scroller.scrollTop,
          left: outsideX ? scroller.scrollLeft + bounds.left - viewport.left - Math.max(15, (scroller.clientWidth - bounds.width) / 2) : scroller.scrollLeft,
          behavior: 'smooth',
        });
      }
      lastFollowed.current = measure.index;
    }
  }, [active, effectivelyMuted, follow, measure, zoom, controlsCollapsed]);

  const togglePlay = useCallback(async () => {
    if (starting || !performance) return;
    if (playing) { player.pause(); setPlaying(false); setBeat(player.beat); return; }
    setStarting(true); setError('');
    try { await player.play(countIn); setCountingIn(player.countingIn); setPlaying(true); }
    catch (reason) { setError(`Audio could not start: ${reason instanceof Error ? reason.message : 'please try again'}`); }
    finally { setStarting(false); }
  }, [player, playing, starting, performance, countIn]);
  const toggleMetronome = useCallback(async () => {
    if (metronomeStarting) return;
    setMetronomeStarting(true);
    try { const next = metronomeMode === 'off' ? 'playback' : metronomeMode === 'playback' ? 'continuous' : 'off'; await player.setMetronome(next !== 'off', next === 'continuous'); setMetronomeMode(next); }
    catch (reason) { setError(`Metronome could not start: ${reason instanceof Error ? reason.message : 'please try again'}`); }
    finally { setMetronomeStarting(false); }
  }, [player, metronomeMode, metronomeStarting]);

  const seek = useCallback((position: number) => {
    if (!performance) return;
    if (loop && (position < performance.measures[loopStart].start || position >= performance.measures[loopEnd].end)) setLoop(false);
    player.seek(Math.min(position, performance.duration - .001)); setBeat(player.beat);
    lastFollowed.current = -1;
  }, [player, loop, loopStart, loopEnd, performance]);
  const restart = useCallback(() => seek(loop && performance ? performance.measures[loopStart].start : 0), [seek, loop, performance, loopStart]);
  const stepMeasure = useCallback((direction: number) => {
    if (!performance || !measure) return;
    seek(performance.measures[Math.max(0, Math.min(performance.measures.length - 1, measure.index + direction))].start);
  }, [performance, measure, seek]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (help || soundSettings || libraryVisible) { if (event.key === 'Escape') { setHelp(false); setSoundSettings(false); setLibraryVisible(false); } return; }
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || target.closest('textarea,[contenteditable=true],input:not([type=range]):not([type=checkbox]):not([type=button])')) return;
      // Reserve transport keys even after a button, slider or checkbox gains
      // focus. Prevent the browser's Space-to-click behavior on that control.
      if (['Space', 'ArrowRight', 'ArrowLeft'].includes(event.code)) {
        event.preventDefault(); event.stopPropagation();
        if (event.code === 'Space') { if (!event.repeat) void togglePlay(); }
        else stepMeasure(event.code === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (target.closest('input,select,button')) return;
      if (event.key.toLowerCase() === 'r') restart();
      if (event.key.toLowerCase() === 'm') void toggleMetronome();
      if (event.key.toLowerCase() === 'c') setControlsCollapsed(value => !value);
    };
    document.addEventListener('keydown', keydown, true); return () => document.removeEventListener('keydown', keydown, true);
  }, [togglePlay, stepMeasure, restart, help, soundSettings, libraryVisible, toggleMetronome]);

  const scoreClick = (event: React.MouseEvent) => {
    const element = (event.target as Element).closest('.score-note');
    if (!element || !performance) return;
    const candidates = performance.notes.filter(note => note.id === element.id);
    const next = candidates.find(note => note.start >= beat - .05) ?? candidates[0];
    if (next) seek(next.start);
  };
  function downloadBundle() {
    if (!score) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(score)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = href; link.download = `${score.title.toLowerCase().replaceAll(' ', '-')}.sotto.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  const fullDuration = performance ? clockTime(performance.duration, bpm, score?.beatUnit ?? 1.5) : '0:00';
  const labelFor = (index: number) => {
    const item = performance?.measures[index];
    return item ? `${item.label}${item.occurrence > 1 ? ` · pass ${item.occurrence}` : ''}` : '';
  };

  return <div className={`app ${controlsCollapsed ? 'controls-collapsed' : ''}`}>
    <header className="app-header">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label="Sotto home"><span className="brand-symbol"><Music2 size={24}/></span><span>sotto<span className="brand-dot">.</span></span></a>
      <span className="header-divider"/><span className="header-caption">A little practice, every day.</span>
      <div className="header-actions"><span className="version">v0.2</span><button className="quiet-button open-button" aria-label="Open score" title="Open score" onClick={() => libraryControl.current?.chooseFile()}><FolderOpen size={17}/><span>Open score</span></button><button className="quiet-button library-button" aria-label="Score library" title="Score library" onClick={() => setLibraryVisible(true)}><BookOpen size={17}/><span>Library</span></button><button className="quiet-button save-button" aria-label="Save score" title="Save score" onClick={downloadBundle} disabled={!score}><ArrowDownToLine size={17}/><span>Save score</span></button><button className="quiet-button controls-toggle" aria-label={controlsCollapsed ? 'Show controls' : 'Hide controls'} aria-expanded={!controlsCollapsed} aria-controls="practice-settings playback-panel" title={`${controlsCollapsed ? 'Show' : 'Hide'} controls (C)`} onClick={() => setControlsCollapsed(value => !value)}>{controlsCollapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}<span>{controlsCollapsed ? 'Show controls' : 'Hide controls'}</span></button><button className="icon-button" aria-label="Help and keyboard shortcuts" onClick={() => setHelp(true)}><CircleHelp size={20}/></button></div>

    </header>

    <div className="workspace">
      <aside className="sidebar" id="practice-settings" hidden={controlsCollapsed} aria-label="Practice settings">
        <div className="section-label">YOUR PRACTICE ROOM</div>
        <div className="selected-piece"><div className="piece-icon"><FileMusic size={23}/></div><div className="selected-piece-details"><h1>{score?.title ?? 'Loading score…'}</h1><span>{score?.composer ?? 'Preparing your music'}</span><span className="piece-subtitle">{score?.subtitle}</span></div><Check size={15} className="selected-check"/></div>

        <div className="sidebar-section">
          <div className="section-heading"><h2>Voices</h2><span className="subtle">{score?.voices.length ?? 3} parts</span></div>
          <p className="section-description">Make room for the part you’re playing.</p>
          <div className="voice-list">{score?.voices.map(voice => <div className={`voice-card ${effectivelyMuted.has(voice.id) ? 'is-muted' : ''}`} key={voice.id} style={{ '--voice-color': voice.color } as React.CSSProperties}>
            <div className="voice-heading"><span className="voice-dot"/><strong>{voice.name}</strong><button className={`solo-button ${solo === voice.id ? 'selected' : ''}`} aria-pressed={solo === voice.id} aria-label={`Solo ${voice.name.toLowerCase()}`} onClick={() => setSolo(current => current === voice.id ? null : voice.id)}>Solo</button><button className="voice-mute" aria-label={`${muted.has(voice.id) ? 'Unmute' : 'Mute'} ${voice.name.toLowerCase()}`} aria-pressed={muted.has(voice.id)} onClick={() => setMuted(current => { const next = new Set(current); if (next.has(voice.id)) next.delete(voice.id); else next.add(voice.id); return next; })}>{effectivelyMuted.has(voice.id) ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button></div>
            <input aria-label={`${voice.name} volume`} className="voice-slider" type="range" min="0" max="100" value={Math.round((volumes[voice.id] ?? 1) * 100)} onChange={event => setVolumes(current => ({ ...current, [voice.id]: Number(event.target.value) / 100 }))}/>
          </div>)}</div>
          {(solo || muted.size > 0) && <button className="text-button restore-voices" onClick={() => { setSolo(null); setMuted(new Set()); }}>Restore all voices</button>}
        </div>

        <div className="sidebar-section loop-section">
          <div className="section-heading"><h2><Repeat2 size={17}/> Practice loop</h2><button className={`switch ${loop ? 'on' : ''}`} role="switch" aria-checked={loop} aria-label="Practice loop" onClick={() => setLoop(current => !current)}><span/></button></div>
          <p className="section-description">Stay with a phrase until it feels right.</p>
          <div className="loop-range"><label>FROM<select aria-label="Loop start measure" value={loopStart} onChange={event => { const next = Number(event.target.value); setLoopStart(next); if (next > loopEnd) setLoopEnd(next); }}>{performance?.measures.map(m => <option key={m.index} value={m.index}>Bar {labelFor(m.index)}</option>)}</select><ChevronDown size={13}/></label><span className="loop-to">→</span><label>TO<select aria-label="Loop end measure" value={loopEnd} onChange={event => { const next = Number(event.target.value); setLoopEnd(next); if (next < loopStart) setLoopStart(next); }}>{performance?.measures.map(m => <option key={m.index} value={m.index}>Bar {labelFor(m.index)}</option>)}</select><ChevronDown size={13}/></label></div>
          <label className="checkbox-row"><input type="checkbox" checked={repeats} onChange={event => setRepeats(event.target.checked)}/><span>Follow repeats &amp; jumps</span></label>
        </div>

        <button className="listening-card listening-launch" aria-label="Open rhythm feedback" onClick={() => setRhythmVisible(true)}><div className="listening-icon"><Mic size={18}/></div><div><strong>A listening ear</strong><p>Microphone rhythm feedback.<br/>Listen, line up, try again.</p></div></button>
        <div className="sidebar-footer"><span className="local-dot"/> Your scores stay on this device.</div>
      </aside>

      <main className="practice-main">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17}/></button></div>}

        <section className="score-frame" aria-label="Interactive sheet music">
          <div className="score-toolbar"><div className="score-status">{controlsCollapsed && <div className="compact-transport" role="group" aria-label="Compact practice controls"><button className="icon-button" aria-label="Restart" title="Restart (R)" onClick={restart} disabled={!score}><RotateCcw size={15}/></button><button className="icon-button" aria-label="Previous measure" title="Previous measure (←)" onClick={() => stepMeasure(-1)} disabled={!score}><ArrowLeft size={15}/></button><button className="compact-play" aria-label={playing ? 'Pause playback' : 'Play score'} onClick={() => void togglePlay()} disabled={!score || starting || (soundLoading && !playing)}>{playing ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}</button><button className="icon-button" aria-label="Next measure" title="Next measure (→)" onClick={() => stepMeasure(1)} disabled={!score}><ArrowRight size={15}/></button><button className={`icon-button compact-listen ${microphoneActive ? 'mic-active' : ''}`} aria-label={microphoneActive ? 'Stop listening' : 'Start listening'} aria-pressed={microphoneActive} title={microphoneActive ? 'Stop microphone listening' : 'Start microphone rhythm feedback'} onClick={() => { if (!microphoneActive) setRhythmVisible(true); rhythmControl.current?.toggleMicrophone(); }}><Ear size={16}/></button><button className={`compact-metronome ${metronome ? 'enabled' : ''} ${clickPulse && metronome ? 'is-ticking' : ''}`} aria-label="Metronome" aria-pressed={metronome} data-mode={metronomeMode} title={`Metronome: ${metronomeLabel} (M)`} disabled={metronomeStarting} onClick={() => void toggleMetronome()}><AudioLines size={15}/><span>{metronomeLabel}</span></button></div>}<span className={`status-dot ${playing ? 'playing' : ''}`}/><span className="ready-label">{playing ? countingIn ? 'Count in…' : 'Playing' : 'Ready when you are'}</span>{controlsCollapsed && <span className="compact-piece-title">{score?.title}</span>}{loop && <span className="loop-badge"><Repeat2 size={12}/> Loop on</span>}</div><div className="score-tools"><label className="follow-control" title="Follow score"><input aria-label="Follow score" type="checkbox" checked={follow} onChange={event => { setFollow(event.target.checked); lastFollowed.current = -1; }}/><span>Follow score</span></label><span className="tool-divider"/><button className={`icon-button rhythm-toggle ${microphoneActive ? 'mic-active' : ''}`} aria-label="Rhythm feedback" aria-expanded={rhythmVisible} title={microphoneActive ? 'Microphone on · rhythm feedback' : 'Microphone rhythm feedback'} onClick={() => setRhythmVisible(value => !value)}><Mic size={16}/></button><button className="icon-button sound-settings-button" aria-label="Sound and metronome settings" title="Instrument and metronome settings" onClick={() => setSoundSettings(true)}><SlidersHorizontal size={16}/></button><button className="icon-button" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => changeZoom(zoom - 10)}><Minus size={15}/></button><button className="zoom-label" aria-label="Fit score to width" title="Fit score to width (100%)" onClick={() => changeZoom(100)}>{zoom}%</button><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 250} onClick={() => changeZoom(zoom + 10)}><Plus size={15}/></button></div></div>
          <div className="score-scroller" ref={scrollRoot}><div className="score-pages" ref={scoreRoot} style={{ '--score-zoom': zoom / 100 } as React.CSSProperties} onClick={scoreClick}>
            {!score && <div className="loading-score"><Music2 size={32}/><p>Putting your music on the stand…</p></div>}
            {pages.map((page, index) => <div key={`${score?.title}-${index}`} className="score-page" aria-label={`Score page ${index + 1}`}><span className="page-number">{String(index + 1).padStart(2, '0')}</span><div dangerouslySetInnerHTML={{ __html: page }}/></div>)}
          </div><div className="score-end"><Music2 size={16}/><span>A good place to begin again.</span></div></div>
          <div className="score-footnote"><span>Click a note to start there.</span><span>{score?.description}</span></div>
        </section>

        <RhythmPanel ref={rhythmControl} visible={rhythmVisible} onHide={() => setRhythmVisible(false)} player={player} score={score} performance={performance} playing={playing} bpm={bpm} clickMode={clickMode} onMicState={setMicrophoneActive}
          prepareCalibration={() => { player.pause(); setPlaying(false); setBeat(player.beat); void player.setMetronome(false); setMetronomeMode('off'); }}
          mutedVoices={effectivelyMuted} muteVoice={voice => {
            const selected = score?.voices.filter(item => voice === 'all' || item.id === voice) ?? [];
            const restore = selected.every(item => effectivelyMuted.has(item.id));
            setMuted(current => { const next = new Set(current); selected.forEach(item => { if (restore) next.delete(item.id); else next.add(item.id); }); return next; });
            if (restore && solo && selected.some(item => item.id !== solo)) setSolo(null);
          }}/>

        <section className="player" id="playback-panel" aria-label="Playback controls" hidden={controlsCollapsed}>
          <div className="progress-row"><span>{clockTime(displayBeat, bpm, score?.beatUnit ?? 1.5)}</span><div className="progress-wrap">{loop && performance && <div className="loop-highlight" style={{ left: `${performance.measures[loopStart].start / performance.duration * 100}%`, width: `${(performance.measures[loopEnd].end - performance.measures[loopStart].start) / performance.duration * 100}%` }}/>}<input aria-label="Playback position" type="range" min="0" max={performance?.duration ?? 1} step="0.01" value={displayBeat} style={{ '--progress': `${displayBeat / (performance?.duration || 1) * 100}%` } as React.CSSProperties} onChange={event => seek(Number(event.target.value))}/></div><span>{fullDuration}</span></div>
          <div className="transport-row"><div className="transport-buttons"><button className="icon-button restart-button" aria-label="Restart" title="Restart (R)" onClick={restart} disabled={!score}><RotateCcw size={18}/></button><button className="icon-button" aria-label="Previous measure" title="Previous measure (←)" onClick={() => stepMeasure(-1)} disabled={!score}><ArrowLeft size={18}/></button><button className="play-button" aria-label={playing ? 'Pause playback' : 'Play score'} onClick={() => void togglePlay()} disabled={!score || starting || (soundLoading && !playing)}>{playing ? <Pause size={23} fill="currentColor"/> : <Play size={23} fill="currentColor"/>}</button><button className="icon-button" aria-label="Next measure" title="Next measure (→)" onClick={() => stepMeasure(1)} disabled={!score}><ArrowRight size={18}/></button><div className="measure-readout"><span>BAR</span><strong>{measure?.label.split(' · ')[0] ?? '1'}<small> / {score?.bars.at(-1)?.label ?? '59'}</small></strong>{measure && measure.occurrence > 1 && <span className="pass-label">pass {measure.occurrence}</span>}</div></div>
            <div className="tempo-control"><label htmlFor="tempo">TEMPO</label><div><button className="icon-button" aria-label="Slower" onClick={() => setBpm(value => Math.max(15, value - 1))}><Minus size={14}/></button><strong>{bpm}<span>BPM</span></strong><button className="icon-button" aria-label="Faster" onClick={() => setBpm(value => Math.min(150, value + 1))}><Plus size={14}/></button></div><input id="tempo" aria-label="Tempo" type="range" min="15" max="150" value={bpm} onChange={event => setBpm(Number(event.target.value))}/><button className="tempo-reset" title="Reset to score tempo" onClick={() => setBpm(score?.bpm ?? 44)}>{Math.round(bpm / (score?.bpm ?? 44) * 100)}%</button></div>
            <button className={`metronome-button ${metronome ? 'enabled' : ''} ${clickPulse && metronome ? 'is-ticking' : ''}`} data-tick-count={clickCount} data-accent={clickAccent} aria-label="Metronome" aria-pressed={metronome} data-mode={metronomeMode} title={`Metronome: ${metronomeLabel} (M)`} disabled={metronomeStarting} onClick={() => void toggleMetronome()}><AudioLines size={19}/><span>Metronome</span><span className="metronome-state">{metronomeLabel}</span></button>
          </div>
        <div className="player-meta"><span className="keyboard-hint"><kbd>space</kbd> play / pause</span><span className="instrument-hint"><Headphones size={13}/> {INSTRUMENTS.find(item => item.id === instrument)?.name} · playback.</span></div>
        </section>

      </main>
    </div>

    <LibraryPanel ref={libraryControl} visible={libraryVisible} onClose={() => setLibraryVisible(false)} onOpen={openScore} onError={setError}/>

    {soundSettings && <div className="modal-backdrop" onClick={() => setSoundSettings(false)}><section className="help-modal sound-modal" role="dialog" aria-modal="true" aria-labelledby="sound-title" onClick={event => event.stopPropagation()}><button className="icon-button modal-close" aria-label="Close sound settings" onClick={() => setSoundSettings(false)} autoFocus><X size={20}/></button><div className="eyebrow">PLAYBACK</div><h2 id="sound-title">Sound &amp; metronome</h2>
      <label className="settings-field">Instrument<select aria-label="Playback instrument" disabled={soundLoading} aria-busy={soundLoading} value={instrument} onChange={event => setInstrument(event.target.value as InstrumentId)}>{INSTRUMENTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p className="settings-note">Nylon guitar, piano and violin use recorded instruments. Marimba, organ and flute are synthesized. All are bundled for offline playback. Changing the instrument changes the sound for all voices, keeping the score’s pitches.</p>
      {soundLoading && <p className="settings-note" role="status">Loading instrument recordings…</p>}
      <p className="settings-note"><a href={`${import.meta.env.BASE_URL}samples/ATTRIBUTION.md`} target="_blank" rel="noopener noreferrer">Recording credits and licenses</a></p>
      <label className="settings-field">Playback octave<select aria-label="Playback octave" value={pitchOffset} onChange={event => setPitchOffset(Number(event.target.value))}><option value={-12}>One octave lower (−12)</option><option value={0}>As exported</option><option value={12}>One octave higher (+12)</option></select></label>
      <p className="settings-note">Use “As exported” when LilyPond already transposes the guitar. An additional −12 would lower it twice. This adjustment lasts until another score is opened.</p>
      <div className="metronome-setting-heading"><h3>Metronome</h3><button className="quiet-button" aria-label="Metronome mode" data-mode={metronomeMode} disabled={metronomeStarting} onClick={() => void toggleMetronome()}>{metronomeLabel}</button><span className={`settings-beat-light ${clickPulse && metronome ? 'lit' : ''}`} data-accent={clickAccent}/></div>
      <p className="settings-note">Cycle Off → Playback → Continuous. Playback clicks only with the score; Continuous also clicks while paused. The first beat of each bar is accented.</p>
      <label className="settings-field count-in-option"><span>One-bar count-in</span><input aria-label="One-bar count-in" type="checkbox" checked={countIn} onChange={event => { setCountIn(event.target.checked); try { localStorage.setItem('sotto.countIn', String(event.target.checked)); } catch { /* Optional preference. */ } }}/></label>
      <p className="settings-note">Count one full bar before each Play, using the starting bar’s meter and tempo. Clicks sound even with the metronome off. Pause cancels the count-in.</p>
      <label className="settings-field">Pulse<select aria-label="Metronome pulse" value={clickMode} onChange={event => setClickMode(event.target.value as ClickMode)}><option value="beat">Beat · {Math.round((measure ? measure.end - measure.start : score?.beatsPerBar ?? 3) / (score?.beatUnit ?? 1.5))} clicks per bar</option><option value="subdivision">Subdivision · {Math.round((measure ? measure.end - measure.start : score?.beatsPerBar ?? 3) / clickStep(score?.beatUnit ?? 1.5, 'subdivision'))} clicks per bar</option></select></label>
      <label className="settings-field click-volume-label">Click volume <span>{clickVolume}%</span><input aria-label="Metronome volume" type="range" min="0" max="100" value={clickVolume} onChange={event => setClickVolume(Number(event.target.value))}/></label>
      <button className="primary-button" onClick={() => setSoundSettings(false)}>Back to the music <ArrowRight size={16}/></button>
    </section></div>}

    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="icon-button modal-close" aria-label="Close help" onClick={() => setHelp(false)} autoFocus><X size={20}/></button><div className="eyebrow">SOTTO · VERSION 0.2</div><h2 id="help-title">Find your own tempo.</h2><p>Play the score, slow down a phrase, or mute your part and play along with the other voices. Click a note to move there.</p><div className="help-shortcuts"><span><kbd>space</kbd> Play / pause</span><span><kbd>←</kbd> <kbd>→</kbd> Previous / next bar</span><span><kbd>R</kbd> Restart</span><span><kbd>M</kbd> Metronome</span></div><h3>Bringing another score</h3><p>Open a <code>.sotto.json</code> bundle created by the included LilyPond exporter. Use Library to bookmark files or folders and mark favorites; export its index to back them up. MusicXML can first be converted with <code>musicxml2ly</code>. Use the microphone icon for volume and attack-timing feedback. Direct PDF recognition, raw MIDI import and pitch assessment are not implemented yet.</p><h3>Playback details</h3><p>The example follows both endings and D.C. al Coda. Guitar pitches sound an octave below the notation. Tempo is measured in dotted-quarter beats; expressive tempo changes and harmonic overtones are not modelled yet.</p><button className="primary-button" onClick={() => setHelp(false)}>Back to the music <ArrowRight size={16}/></button></section></div>}
  </div>;
}
