import { barTiming, noteMeasure, visualEventId, type Score } from './score';
import { feedbackX, type BeatAnchor, type FeedbackTake } from './score-feedback';
import type { Attack } from './rhythm';
import { includesVoice, type VoiceSelection } from './parts';

const NS = 'http://www.w3.org/2000/svg';
const make = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};
export type FeedbackLane = { written: number; element: SVGGElement; drawing: SVGGElement; grid: SVGGElement; anchors: BeatAnchor[];
  x: number; width: number; height: number; duration: number };
type Bounds = { x: number; y: number; width: number; height: number };
function boundsInPage(element: SVGGraphicsElement, svg: SVGSVGElement): Bounds {
  // Inactive bar rectangles use display:none, so rendered bounds are zero.
  if (element.classList.contains('current-bar-highlight')) return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(element.getAttribute(key))])) as Bounds;
  const rect = element.getBoundingClientRect(), inverse = svg.getScreenCTM()!.inverse();
  const a = new DOMPoint(rect.left, rect.top).matrixTransform(inverse), b = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

/** Insert real space below each engraved system, preserving note IDs and SVG
 * coordinates. All transforms/viewBoxes are restored when the view is closed. */
export function buildFeedbackLanes(root: HTMLElement, score: Score, bars: Map<number, SVGRectElement>, voice: VoiceSelection) {
  const lanes: FeedbackLane[] = [], restore: (() => void)[] = [];
  const elements = new Map<string, SVGGraphicsElement>();
  root.querySelectorAll<SVGGraphicsElement>('.score-note').forEach(element => { if (!element.closest('[data-part-hidden]') && !elements.has(visualEventId(element))) elements.set(visualEventId(element), element); });
  for (const svg of root.querySelectorAll<SVGSVGElement>('.score-page svg')) {
    const boxes = new Map<SVGGraphicsElement, Bounds>();
    const boxOf = (element: SVGGraphicsElement) => { if (!boxes.has(element)) boxes.set(element, boundsInPage(element, svg)); return boxes.get(element)!; };
    const measures = [...bars].filter(([, rect]) => rect.ownerSVGElement === svg).map(([written, rect]) => ({ written, rect, box: boxOf(rect) }));
    if (!measures.length) continue;
    const rows: { top: number; bottom: number; measures: typeof measures }[] = [];
    for (const item of measures.sort((a, b) => a.box.y - b.box.y)) {
      // Highlight padding can overlap the adjacent system. Compare centers,
      // rather than merging every vertically overlapping padded rectangle.
      const row = rows.find(row => Math.abs(item.box.y + item.box.height / 2 - (row.top + row.bottom) / 2) < Math.min(item.box.height, row.bottom - row.top) * .45);
      if (row) { row.top = Math.min(row.top, item.box.y); row.bottom = Math.max(row.bottom, item.box.y + item.box.height); row.measures.push(item); }
      else rows.push({ top: item.box.y, bottom: item.box.y + item.box.height, measures: [item] });
    }
    const graphics = [...svg.children].filter((element): element is SVGGraphicsElement => element instanceof SVGGraphicsElement && !element.hasAttribute('data-part-hidden') && !['defs', 'style'].includes(element.localName));
    const ink: Bounds[] = [];
    const collectInk = (element: SVGGraphicsElement) => {
      if (['g', 'a'].includes(element.localName)) { for (const child of element.children) if (child instanceof SVGGraphicsElement) collectInk(child); }
      else ink.push(boxOf(element));
    };
    graphics.forEach(collectInk);
    const partitions = rows.slice(0, -1).map((row, i) => (row.bottom + rows[i + 1].top) / 2);
    const cuts = rows.map((row, i) => {
      let bottom = row.bottom;
      // Include dynamics, fingerings and stems belonging to this system.
      for (const box of ink) {
        const center = box.y + box.height / 2;
        if (center >= (partitions[i - 1] ?? -Infinity) && center < (partitions[i] ?? Infinity) && box.y < row.bottom + 4) bottom = Math.max(bottom, box.y + box.height);
      }
      return Math.min(bottom + 1, partitions[i] ?? bottom + 1);
    });
    const gap = 9, height = 7;
    const moves: { element: SVGGraphicsElement; dy: number }[] = [];
    function collect(element: SVGGraphicsElement) {
      const box = boxOf(element);
      const before = cuts.filter(cut => box.y >= cut - .001).length;
      const after = cuts.filter(cut => box.y + box.height > cut + .001).length;
      if (before !== after && element.children.length && !['text', 'use'].includes(element.localName)) {
        for (const child of element.children) if (child instanceof SVGGraphicsElement) collect(child);
      } else {
        // Small text (especially a next-system bar number) can straddle a
        // padded system boundary. Keep it with the side containing its center.
        const shifts = before === after ? before : cuts.filter(cut => box.y + box.height / 2 >= cut).length;
        if (shifts) moves.push({ element, dy: shifts * gap });
      }
    }
    graphics.forEach(collect);
    // Compute note anchors before moving any engraving.
    for (const [i, row] of rows.entries()) for (const measure of row.measures) {
      const timing = barTiming(score, measure.written);
      const notes = score.notes.filter(note => noteMeasure(score, note) === measure.written && !note.grace);
      const visible = notes.filter(note => { const element = elements.get(note.id); return element && svg.contains(element); });
      const selected = visible.filter(note => includesVoice(voice, note.voice));
      const positions = new Map<number, number[]>();
      for (const note of selected.length ? selected : visible) {
        const element = elements.get(note.id);
        if (!(element instanceof SVGGraphicsElement) || !svg.contains(element)) continue;
        const box = boxOf(element), beat = note.beat - timing.start;
        positions.set(beat, [...(positions.get(beat) ?? []), box.x + box.width / 2]);
      }
      const anchors = [...positions].sort(([a], [b]) => a - b).map(([beat, xs]) => ({ beat, x: Math.min(...xs) }));
      if (!anchors.length || anchors[0].beat > 0) anchors.unshift({ beat: 0, x: measure.box.x });
      anchors.push({ beat: timing.duration, x: measure.box.x + measure.box.width });
      // A notehead group may include a stem; keep anchors ordered horizontally.
      anchors.forEach((anchor, j) => { if (j) anchor.x = Math.max(anchor.x, anchors[j - 1].x); });
      const element = make('g', { class: 'score-feedback-lane', transform: `translate(0 ${cuts[i] + i * gap + 1})`, 'data-bar-index': measure.written, role: 'img', 'aria-label': `Playing feedback for bar ${score.bars[measure.written].label}` });
      element.append(make('rect', { x: measure.box.x, width: measure.box.width, height, rx: .5, fill: '#f1f5ec' }));
      const grid = make('g'), drawing = make('g'); element.append(grid, drawing);
      lanes.push({ written: measure.written, element, drawing, grid, anchors, x: measure.box.x, width: measure.box.width, height, duration: timing.duration });
    }
    for (const { element, dy } of moves) {
      const parent = element.parentElement!;
      const matrix = parent instanceof SVGGraphicsElement ? parent.getScreenCTM()! : svg.getScreenCTM()!;
      const screen = svg.getScreenCTM()!, inverse = matrix.inverse();
      const a = new DOMPoint(screen.e, screen.f).matrixTransform(inverse), b = new DOMPoint(screen.e + screen.c * dy, screen.f + screen.d * dy).matrixTransform(inverse);
      const wrapper = make('g', { transform: `translate(${b.x - a.x} ${b.y - a.y})` });
      element.before(wrapper); wrapper.append(element);
      restore.push(() => { wrapper.before(element); wrapper.remove(); });
    }
    const viewBox = svg.getAttribute('viewBox')!, box = svg.viewBox.baseVal;
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height + cuts.length * gap}`);
    restore.push(() => svg.setAttribute('viewBox', viewBox));
    for (const lane of lanes.filter(lane => !lane.element.parentNode)) svg.append(lane.element);
  }
  return { lanes, dispose() { lanes.forEach(lane => lane.element.remove()); restore.reverse().forEach(fn => fn()); } };
}

const colors: Record<Attack['kind'], string> = { 'on-time': '#327257', early: '#b17b27', late: '#597eae', extra: '#92998c' };
export function drawFeedbackLane(lane: FeedbackLane, takes: FeedbackTake[], level: (value: number, band: 'rms' | 'peak') => number,
  expected: number[], clicks: { beat: number; accent: string }[], position?: number) {
  const { drawing, grid, height, anchors } = lane;
  const x = (beat: number) => feedbackX(anchors, beat);
  grid.replaceChildren();
  for (const beat of expected) grid.append(make('path', { d: `M${x(beat)} .5V${height - .5}`, stroke: '#809574', 'stroke-width': .12, 'stroke-dasharray': '.4 .4' }));
  for (const click of clicks) grid.append(make('path', { d: `M${x(click.beat)} 0V${height}`, stroke: '#b64e4e', 'stroke-width': .13, ...(click.accent === 'downbeat' ? {} : { 'stroke-dasharray': '.5 .5' }) }));
  drawing.replaceChildren();
  lane.element.dataset.visits = String(takes.length);
  lane.element.dataset.feedbackPoints = String(takes.reduce((sum, take) => sum + take.points.size, 0));
  lane.element.dataset.feedbackAttacks = String(takes.reduce((sum, take) => sum + take.attacks.length, 0));
  lane.element.dataset.feedbackPitches = String(takes.reduce((sum, take) => sum + take.pitches.size, 0));
  const pitchMarks = make('g', { class: 'score-feedback-pitch-marks' });
  takes.forEach((take, index) => {
    const age = takes.length - 1 - index, opacity = age ? .38 * .65 ** (age - 1) : 1;
    const group = make('g', { opacity, 'data-history-age': age });
    const points = [...take.points.values()].sort((a, b) => a.beat - b.beat);
    const y = (value: number, band: 'rms' | 'peak') => height - .5 - level(value, band) * (height - 2);
    if (points.length) {
      const line = (band: 'rms' | 'peak') => points.map((point, j) => `${j ? 'L' : 'M'}${x(point.beat).toFixed(3)} ${y(point[band], band).toFixed(3)}`).join('');
      group.append(make('path', { d: `${line('rms')}L${x(points.at(-1)!.beat)} ${height - .5}L${x(points[0].beat)} ${height - .5}Z`, fill: '#82ac75', 'fill-opacity': .45 }));
      group.append(make('path', { d: line('peak'), fill: 'none', stroke: age ? '#789573' : '#285d40', 'stroke-width': .18 }));
    }
    for (const attack of take.attacks) {
      const dot = make('circle', { cx: x(attack.position), cy: 1, r: attack.source === 'legato' ? .4 : .32,
        fill: attack.source === 'legato' ? '#fff' : colors[attack.kind], stroke: colors[attack.kind], 'stroke-width': attack.source === 'legato' ? .2 : 0,
        'data-attack-source': attack.source ?? 'energy' });
      const title = make('title'); title.textContent = `${attack.source === 'legato' ? 'Pitch change · ' : ''}${attack.errorMs === null ? 'Unmatched attack' : `${attack.kind}: ${Math.round(attack.errorMs)} ms`}`; dot.append(title); group.append(dot);
    }
    for (const pitch of take.pitches.values()) {
      // Keep judgments above every trace/history fill and the playhead. Use
      // vector marks with a light backing so dense waveforms and font choices
      // cannot obscure the green check or red cross.
      const mark = make('g', { transform: `translate(${x(pitch.beat)} ${height - 1.2})`, opacity,
        'data-pitch-result': pitch.matching ? 'matching' : 'different', role: 'img',
        'aria-label': pitch.matching ? 'Matching pitch' : 'Different pitch' });
      const title = make('title'); title.textContent = pitch.matching ? 'Matching pitch' : 'Different pitch';
      mark.append(title, make('circle', { r: 1.05, fill: '#fff', 'fill-opacity': .95 }),
        make('path', { d: pitch.matching ? 'M-.55 0L-.15 .45L.6-.5' : 'M-.45-.45L.45 .45M-.45 .45L.45-.45',
          fill: 'none', stroke: pitch.matching ? '#327257' : '#ad4f4f', 'stroke-width': .26,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      pitchMarks.append(mark);
    }
    drawing.append(group);
  });
  if (position !== undefined) {
    lane.element.dataset.position = String(position);
    drawing.append(make('path', { class: 'score-feedback-playhead', d: `M${x(position)} 0V${height}`,
      stroke: '#285d40', 'stroke-width': .2 }));
  } else delete lane.element.dataset.position;
  drawing.append(pitchMarks);
}
