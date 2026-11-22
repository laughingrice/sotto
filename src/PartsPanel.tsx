import { Eye, EyeOff, Volume2, VolumeX } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Voice } from './score';
import type { PlaybackMode } from './parts';
import { INSTRUMENTS, isInstrument, type InstrumentId } from './sounds';
type Props = { voices: Voice[]; practice: readonly string[]; hidden: readonly string[]; groups: string[][]; mode: PlaybackMode;
  muted: ReadonlySet<string>; solo: string | null; instruments: Record<string, InstrumentId>; resolved: Record<string, InstrumentId>; volumes: Record<string, number>; soundLoading: boolean;
  onPractice(ids: string[]): void; onHidden(ids: string[]): void; onMode(mode: PlaybackMode): void; onMute(id: string): void; onSolo(id: string): void;
  onInstrument(id: string, instrument: InstrumentId | null): void; onVolume(id: string, volume: number): void };
export default function PartsPanel(props: Props) {
  const group = (id: string) => props.groups.find(group => group.includes(id)) ?? [id];
  const showPractice = () => props.onHidden(props.voices.filter(voice => !group(voice.id).some(id => props.practice.includes(id))).map(voice => voice.id));
  const customPlayback = props.solo !== null || [...props.muted].some(id => props.mode !== 'accompaniment' || !props.practice.includes(id));
  return <div className="parts-panel">
    <div className="parts-playback"><label>Play<select aria-label="Parts playback" value={customPlayback ? 'custom' : props.mode} onChange={event => { if (event.target.value !== 'custom') props.onMode(event.target.value as PlaybackMode); }}><option value="all">All parts</option><option value="accompaniment">Accompaniment · except practice parts</option>{customPlayback && <option value="custom" disabled>Custom · mute / solo</option>}</select></label></div>
    <div className="parts-presets"><button className="text-button" disabled={!props.hidden.length} onClick={() => props.onHidden([])}>Show all parts</button><button className="text-button" disabled={!props.practice.length} onClick={showPractice}>Show practice parts</button><span>{props.practice.length} selected for practice</span></div>
    <div className="voice-list parts-list">{props.voices.map(voice => {
      const hidden = props.hidden.includes(voice.id), staff = group(voice.id);
      const lastStaff = props.voices.every(item => props.hidden.includes(item.id) || staff.includes(item.id));
      return <div className={`voice-card ${props.muted.has(voice.id) ? 'is-muted' : ''} ${hidden ? 'part-is-hidden' : ''}`} key={voice.id} style={{ '--voice-color': voice.color } as CSSProperties}>
        <div className="voice-heading"><span className="voice-dot"/><strong>{voice.name}</strong>
          <button className={`solo-button ${props.solo === voice.id ? 'selected' : ''}`} aria-pressed={props.solo === voice.id} aria-label={`Solo ${voice.name.toLowerCase()}`} onClick={() => props.onSolo(voice.id)}>Solo</button>
          <button className="voice-mute" aria-label={`${props.muted.has(voice.id) ? 'Unmute' : 'Mute'} ${voice.name.toLowerCase()}`} aria-pressed={props.muted.has(voice.id)} onClick={() => props.onMute(voice.id)}>{props.muted.has(voice.id) ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button>
          <button className="part-visibility" aria-label={`${hidden ? 'Show' : 'Hide'} ${voice.name} staff`} aria-pressed={!hidden} disabled={!hidden && lastStaff} title={staff.length > 1 ? 'Voices sharing an engraved staff are shown or hidden together.' : !hidden && lastStaff ? 'Keep at least one staff visible.' : hidden ? 'Show this staff' : 'Hide this staff'} onClick={() => props.onHidden(hidden ? props.hidden.filter(id => !staff.includes(id)) : [...new Set([...props.hidden, ...staff])])}>{hidden ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
        </div>
        <div className="part-practice-row"><label><input type="checkbox" data-practice-voice={voice.id} aria-label={`Practice ${voice.name}`} checked={props.practice.includes(voice.id)} onChange={event => props.onPractice(event.target.checked ? [...props.practice, voice.id] : props.practice.filter(id => id !== voice.id))}/>Practice</label><span>{hidden ? 'Hidden' : 'Shown'} · {props.muted.has(voice.id) ? 'Muted' : 'Sound on'}</span></div>
        <details className="part-sound"><summary>Sound &amp; volume</summary>
          <label className="voice-instrument">Sound<select aria-label={`${voice.name} instrument`} value={props.instruments[voice.id] ?? 'auto'} disabled={props.soundLoading} onChange={event => props.onInstrument(voice.id, isInstrument(event.target.value) ? event.target.value : null)}><option value="auto">Auto · {INSTRUMENTS.find(item => item.id === props.resolved[voice.id])?.name}</option>{INSTRUMENTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <input aria-label={`${voice.name} volume`} className="voice-slider" type="range" min="0" max="100" value={Math.round((props.volumes[voice.id] ?? 1) * 100)} onChange={event => props.onVolume(voice.id, Number(event.target.value) / 100)}/>
        </details>
      </div>;
    })}</div>
    <p className="parts-hint">Practice selects microphone targets. Sound and visibility are independent. Voices sharing a staff hide together.</p>
  </div>;
}
