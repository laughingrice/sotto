import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, ChevronDown, CircleHelp, FileMusic, FolderOpen, Headphones, Mic, Minus, Music2, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Repeat2, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { Player } from './audio';
import { activeNotes, cleanSvg, clockTime, makePerformance, measureAt, validateScore, type Score } from './score';

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
  const [metronome, setMetronome] = useState(false);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [loop, setLoop] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(3);
  const [zoom, setZoom] = useState(100);
  const [help, setHelp] = useState(false);
  const [starting, setStarting] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(() => {
    try { return localStorage.getItem('sotto.controlsCollapsed') === 'true'; } catch { return false; }
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const scoreRoot = useRef<HTMLDivElement>(null);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const noteElements = useRef(new Map<string, SVGElement>());
  const previousActive = useRef(new Set<string>());
  const lastFollowed = useRef(-1);
  const performance = useMemo(() => score ? makePerformance(score, repeats) : null, [score, repeats]);
  const pages = useMemo(() => score?.pages.map(cleanSvg) ?? [], [score]);
  const measure = performance ? measureAt(performance, beat) : null;
  const active = useMemo(() => performance ? activeNotes(performance, beat) : [], [performance, beat]);
  const effectivelyMuted = useMemo(() => new Set(score?.voices.filter(voice => muted.has(voice.id) || (solo !== null && solo !== voice.id)).map(voice => voice.id)), [score, muted, solo]);
  useEffect(() => {
    try { localStorage.setItem('sotto.controlsCollapsed', String(controlsCollapsed)); } catch { /* Storage can be unavailable in private browsing. */ }
    lastFollowed.current = -1;
  }, [controlsCollapsed]);

  const openScore = useCallback((value: unknown) => {
    validateScore(value);
    // Sanitize before accepting a bundle; reject malformed SVG immediately.
    value.pages.forEach(cleanSvg);
    player.pause(); setPlaying(false); setLoop(false); setLoopStart(0); setLoopEnd(Math.min(3, value.bars.length - 1));
    setMuted(new Set()); setSolo(null); setVolumes({}); setBeat(0); setBpm(value.bpm); setScore(value); setError('');
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
  useEffect(() => player.tempo(bpm), [bpm, player, performance]);
  useEffect(() => { player.metronome = metronome; }, [player, metronome]);
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
    const update = () => { setBeat(player.beat); frame = requestAnimationFrame(update); };
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
  }, [pages, score]);

  useEffect(() => {
    for (const element of noteElements.current.values()) element.classList.toggle('voice-muted', effectivelyMuted.has(element.dataset.voice ?? ''));
  }, [effectivelyMuted, pages]);
  useEffect(() => {
    const ids = new Set(active.filter(note => !effectivelyMuted.has(note.voice)).map(note => note.id));
    for (const id of previousActive.current) if (!ids.has(id)) noteElements.current.get(id)?.classList.remove('is-active');
    for (const id of ids) noteElements.current.get(id)?.classList.add('is-active');
    previousActive.current = ids;
    if (!follow || !measure || measure.index === lastFollowed.current) return;
    const anchor = active.map(note => noteElements.current.get(note.id)).find(Boolean);
    const scroller = scrollRoot.current;
    if (anchor && scroller) {
      const bounds = anchor.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      if (bounds.top < viewport.top + 80 || bounds.bottom > viewport.bottom - 90) {
        scroller.scrollTo({ top: scroller.scrollTop + bounds.top - viewport.top - viewport.height * .35, behavior: 'smooth' });
      }
      lastFollowed.current = measure.index;
    }
  }, [active, effectivelyMuted, follow, measure]);

  const togglePlay = useCallback(async () => {
    if (starting || !performance) return;
    if (playing) { player.pause(); setPlaying(false); setBeat(player.beat); return; }
    setStarting(true); setError('');
    try { await player.play(); setPlaying(true); }
    catch (reason) { setError(`Audio could not start: ${reason instanceof Error ? reason.message : 'please try again'}`); }
    finally { setStarting(false); }
  }, [player, playing, starting, performance]);

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
      if (help) { if (event.key === 'Escape') setHelp(false); return; }
      if ((event.target as HTMLElement).closest('input,select,textarea,button')) return;
      if (event.code === 'Space') { event.preventDefault(); void togglePlay(); }
      if (event.code === 'ArrowRight') { event.preventDefault(); stepMeasure(1); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); stepMeasure(-1); }
      if (event.key.toLowerCase() === 'r') restart();
      if (event.key.toLowerCase() === 'm') setMetronome(value => !value);
      if (event.key.toLowerCase() === 'c') setControlsCollapsed(value => !value);
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [togglePlay, stepMeasure, restart, help]);

  const scoreClick = (event: React.MouseEvent) => {
    const element = (event.target as Element).closest('.score-note');
    if (!element || !performance) return;
    const candidates = performance.notes.filter(note => note.id === element.id);
    const next = candidates.find(note => note.start >= beat - .05) ?? candidates[0];
    if (next) seek(next.start);
  };
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 15_000_000) throw new Error('Please use a score bundle smaller than 15 MB.');
      openScore(JSON.parse(await file.text()));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open that score.'); }
    if (fileInput.current) fileInput.current.value = '';
  }
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
      <div className="header-actions"><span className="version">v0.1</span><button className="quiet-button open-button" aria-label="Open score" title="Open score" onClick={() => fileInput.current?.click()}><FolderOpen size={17}/><span>Open score</span></button><button className="quiet-button save-button" aria-label="Save score" title="Save score" onClick={downloadBundle} disabled={!score}><ArrowDownToLine size={17}/><span>Save score</span></button><button className="quiet-button controls-toggle" aria-label={controlsCollapsed ? 'Show controls' : 'Hide controls'} aria-expanded={!controlsCollapsed} aria-controls="practice-settings playback-panel" title={`${controlsCollapsed ? 'Show' : 'Hide'} controls (C)`} onClick={() => setControlsCollapsed(value => !value)}>{controlsCollapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}<span>{controlsCollapsed ? 'Show controls' : 'Hide controls'}</span></button><button className="icon-button" aria-label="Help and keyboard shortcuts" onClick={() => setHelp(true)}><CircleHelp size={20}/></button></div>
      <input ref={fileInput} type="file" accept=".json,.sotto.json" className="visually-hidden" onChange={event => void importFile(event.target.files?.[0])}/>
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
          <label className="checkbox-row"><input type="checkbox" checked={repeats} onChange={event => setRepeats(event.target.checked)}/><span>Follow repeats &amp; D.C.</span></label>
        </div>

        <div className="listening-card"><div className="listening-icon"><Mic size={18}/></div><div><strong>A listening ear</strong><p>Rhythm and pitch feedback.<br/>Coming in a later version.</p></div></div>
        <div className="sidebar-footer"><span className="local-dot"/> Your scores stay on this device.</div>
      </aside>

      <main className="practice-main">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17}/></button></div>}

        <section className="score-frame" aria-label="Interactive sheet music">
          <div className="score-toolbar"><div className="score-status">{controlsCollapsed && <button className="compact-play" aria-label={playing ? 'Pause playback' : 'Play score'} onClick={() => void togglePlay()} disabled={!score || starting}>{playing ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}</button>}<span className={`status-dot ${playing ? 'playing' : ''}`}/><span className="ready-label">{playing ? 'Playing' : 'Ready when you are'}</span>{controlsCollapsed && <span className="compact-piece-title">{score?.title}</span>}{loop && <span className="loop-badge"><Repeat2 size={12}/> Loop on</span>}</div><div className="score-tools"><label className="follow-control"><input type="checkbox" checked={follow} onChange={event => { setFollow(event.target.checked); lastFollowed.current = -1; }}/><span>Follow score</span></label><span className="tool-divider"/><button className="icon-button" aria-label="Zoom out" disabled={zoom <= 75} onClick={() => setZoom(value => Math.max(75, value - 10))}><Minus size={15}/></button><span className="zoom-label">{zoom}%</span><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 150} onClick={() => setZoom(value => Math.min(150, value + 10))}><Plus size={15}/></button></div></div>
          <div className="score-scroller" ref={scrollRoot}><div className="score-pages" ref={scoreRoot} style={{ '--score-zoom': zoom / 100 } as React.CSSProperties} onClick={scoreClick}>
            {!score && <div className="loading-score"><Music2 size={32}/><p>Putting your music on the stand…</p></div>}
            {pages.map((page, index) => <div key={`${score?.title}-${index}`} className="score-page" aria-label={`Score page ${index + 1}`}><span className="page-number">{String(index + 1).padStart(2, '0')}</span><div dangerouslySetInnerHTML={{ __html: page }}/></div>)}
          </div><div className="score-end"><Music2 size={16}/><span>A good place to begin again.</span></div></div>
          <div className="score-footnote"><span>Click a note to start there.</span><span>{score?.description}</span></div>
        </section>

        <section className="player" id="playback-panel" aria-label="Playback controls" hidden={controlsCollapsed}>
          <div className="progress-row"><span>{clockTime(beat, bpm, score?.beatUnit ?? 1.5)}</span><div className="progress-wrap">{loop && performance && <div className="loop-highlight" style={{ left: `${performance.measures[loopStart].start / performance.duration * 100}%`, width: `${(performance.measures[loopEnd].end - performance.measures[loopStart].start) / performance.duration * 100}%` }}/>}<input aria-label="Playback position" type="range" min="0" max={performance?.duration ?? 1} step="0.01" value={beat} style={{ '--progress': `${beat / (performance?.duration || 1) * 100}%` } as React.CSSProperties} onChange={event => seek(Number(event.target.value))}/></div><span>{fullDuration}</span></div>
          <div className="transport-row"><div className="transport-buttons"><button className="icon-button restart-button" aria-label="Restart" title="Restart (R)" onClick={restart} disabled={!score}><RotateCcw size={18}/></button><button className="icon-button" aria-label="Previous measure" title="Previous measure (←)" onClick={() => stepMeasure(-1)} disabled={!score}><ArrowLeft size={18}/></button><button className="play-button" aria-label={playing ? 'Pause playback' : 'Play score'} onClick={() => void togglePlay()} disabled={!score || starting}>{playing ? <Pause size={23} fill="currentColor"/> : <Play size={23} fill="currentColor"/>}</button><button className="icon-button" aria-label="Next measure" title="Next measure (→)" onClick={() => stepMeasure(1)} disabled={!score}><ArrowRight size={18}/></button><div className="measure-readout"><span>BAR</span><strong>{measure?.label.split(' · ')[0] ?? '1'}<small> / {score?.bars.at(-1)?.label ?? '59'}</small></strong>{measure && measure.occurrence > 1 && <span className="pass-label">pass {measure.occurrence}</span>}</div></div>
            <div className="tempo-control"><label htmlFor="tempo">TEMPO</label><div><button className="icon-button" aria-label="Slower" onClick={() => setBpm(value => Math.max(15, value - 1))}><Minus size={14}/></button><strong>{bpm}<span>BPM</span></strong><button className="icon-button" aria-label="Faster" onClick={() => setBpm(value => Math.min(150, value + 1))}><Plus size={14}/></button></div><input id="tempo" aria-label="Tempo" type="range" min="15" max="150" value={bpm} onChange={event => setBpm(Number(event.target.value))}/><button className="tempo-reset" title="Reset to score tempo" onClick={() => setBpm(score?.bpm ?? 44)}>{Math.round(bpm / (score?.bpm ?? 44) * 100)}%</button></div>
            <button className={`metronome-button ${metronome ? 'enabled' : ''}`} aria-label="Metronome" aria-pressed={metronome} title="Metronome (M)" onClick={() => setMetronome(value => !value)}><AudioLines size={19}/><span>Metronome</span><span className="metronome-state">{metronome ? 'ON' : 'OFF'}</span></button>
          </div>
        </section>
        <div className="below-player" hidden={controlsCollapsed}><span><Headphones size={13}/> A soft plucked tone. Headphones welcome.</span><span className="keyboard-hint"><kbd>space</kbd> play / pause</span></div>
      </main>
    </div>

    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="icon-button modal-close" aria-label="Close help" onClick={() => setHelp(false)} autoFocus><X size={20}/></button><div className="eyebrow">SOTTO · VERSION 0.1</div><h2 id="help-title">Find your own tempo.</h2><p>Play the score, slow down a phrase, or mute your part and play along with the other voices. Click a note to move there.</p><div className="help-shortcuts"><span><kbd>space</kbd> Play / pause</span><span><kbd>←</kbd> <kbd>→</kbd> Previous / next bar</span><span><kbd>R</kbd> Restart</span><span><kbd>M</kbd> Metronome</span></div><h3>Bringing another score</h3><p>Open a <code>.sotto.json</code> bundle created by the included LilyPond exporter. MusicXML can first be converted with <code>musicxml2ly</code>. Direct PDF recognition, raw MIDI import, and microphone feedback are outside v0.1.</p><h3>Playback details</h3><p>The example follows both endings and D.C. al Coda. Guitar pitches sound an octave below the notation. Tempo is measured in dotted-quarter beats; expressive tempo changes and harmonic overtones are not modelled yet.</p><button className="primary-button" onClick={() => setHelp(false)}>Back to the music <ArrowRight size={16}/></button></section></div>}
  </div>;
}
