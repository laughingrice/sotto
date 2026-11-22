import { noteMeasure, visualEventId, type Score } from './score';
type Box = { x: number; y: number; width: number; height: number };
type Staff = { box: Box; voices: Set<string>; notes: { voice: string; written: number; event: string }[]; system: number };
const NS = 'http://www.w3.org/2000/svg';
function bounds(element: SVGGraphicsElement, svg: SVGSVGElement): Box {
  const box = element.getBBox(), matrix = svg.getScreenCTM()!.inverse().multiply(element.getScreenCTM()!);
  const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
}
const center = (staff: Staff) => staff.box.y + staff.box.height / 2;
function staves(svg: SVGSVGElement, score: Score): Staff[] {
  const tagged = [...svg.querySelectorAll<SVGGraphicsElement>('.sotto-staff-geometry')].map(element => ({ box: bounds(element, svg), system: element.dataset.system }));
  let boxes = tagged.map(item => item.box);
  if (!boxes.length) {
    const lines = [...svg.querySelectorAll<SVGLineElement>('line')].map(element => bounds(element, svg))
      .filter(box => box.width > svg.viewBox.baseVal.width * .25 && box.height < .15).sort((a, b) => a.y - b.y);
    const groups: Box[][] = [];
    for (const line of lines) {
      const group = groups.find(group => Math.abs(group[0].x - line.x) < .2 && Math.abs(group[0].width - line.width) < .3 && line.y - group.at(-1)!.y < 1.8);
      if (group) group.push(line); else groups.push([line]);
    }
    boxes = groups.filter(group => group.length >= 4).map(group => ({ x: group[0].x, y: group[0].y, width: group[0].width, height: group.at(-1)!.y - group[0].y }));
  }
  const result: Staff[] = boxes.sort((a, b) => a.y - b.y).map((box, system) => ({ box, voices: new Set(), notes: [], system }));
  if (!result.length) return [];
  const explicitSystems = tagged.length > 0 && tagged.every(item => item.system !== undefined);
  if (explicitSystems) {
    const ids = [...new Set(tagged.map(item => item.system))];
    result.forEach(staff => { staff.system = ids.indexOf(tagged.find(item => item.box === staff.box)!.system); });
  }
  const notes = new Map(score.notes.map(note => [note.id, note]));
  for (const element of svg.querySelectorAll<SVGGraphicsElement>('.score-note')) {
    const note = notes.get(visualEventId(element)); if (!note) continue;
    const box = bounds(element, svg), y = box.y + box.height / 2;
    const closest = [...result].sort((a, b) => Math.abs(center(a) - y) - Math.abs(center(b) - y))[0];
    closest.notes.push({ voice: note.voice, written: noteMeasure(score, note), event: note.id });
  }
  // Staffs covering the same written measures belong to one engraved system.
  const sets = result.map(staff => new Set(staff.notes.map(note => note.written)));
  for (let a = 0; !explicitSystems && a < result.length; a++) for (let b = a + 1; b < result.length; b++) if ([...sets[a]].some(bar => sets[b].has(bar))) {
    const from = result[b].system, to = result[a].system;
    result.filter(staff => staff.system === from).forEach(staff => { staff.system = to; });
  }
  for (const system of new Set(result.map(staff => staff.system))) {
    const group = result.filter(staff => staff.system === system);
    for (const voice of score.voices) {
      const counts = group.map(staff => staff.notes.filter(note => note.voice === voice.id).length), max = Math.max(...counts);
      if (!max) continue;
      const best = counts.indexOf(max), events = new Set(group[best].notes.filter(note => note.voice === voice.id).map(note => note.event));
      group.forEach((staff, index) => {
        const duplicates = staff.notes.filter(note => note.voice === voice.id && events.has(note.event)).length;
        if (index === best || counts[index] > 0 && duplicates >= counts[index] * .5) staff.voices.add(voice.id);
      });
    }
  }
  // Rest-only staves inherit the corresponding staff's ownership from a
  // neighbouring system with the same number of staves.
  const systems = [...new Set(result.map(staff => staff.system))].map(id => result.filter(staff => staff.system === id));
  for (const system of systems) system.forEach((staff, index) => {
    if (!staff.voices.size) {
      const template = systems.find(other => other.length === system.length && other[index]?.voices.size);
      if (template) staff.voices = new Set(template[index].voices);
    }
  });
  return result;
}
/** Hide complete engraved staves and close their vertical space. Playback
 * remains the original score. Works with legacy flat LilyPond SVG as well as
 * the explicit staff anchors in Notes/Tabs/Both exports. */
export function layoutVisibleParts(root: HTMLElement, score: Score, hidden: ReadonlySet<string>) {
  const restore: (() => void)[] = [], shared = score.voices.map(voice => new Set([voice.id]));
  const measureAnchors = new Map<number, { svg: SVGSVGElement; box: Box }>();
  let detected = 0;
  for (const svg of root.querySelectorAll<SVGSVGElement>('.score-page svg')) {
    const staffs = staves(svg, score); detected += staffs.length;
    for (const staff of staffs) if (staff.voices.size > 1) {
      const related = shared.filter(group => [...staff.voices].some(voice => group.has(voice)));
      const union = new Set(related.flatMap(group => [...group]));
      related.forEach(group => { group.clear(); union.forEach(voice => group.add(voice)); });
    }
    const removed = staffs.filter(staff => staff.voices.size && [...staff.voices].every(voice => hidden.has(voice)));
    if (!removed.length) continue;
    const cuts = removed.map(staff => {
      const index = staffs.indexOf(staff), y = center(staff), previous = staffs[index - 1], next = staffs[index + 1];
      const top = previous ? (center(previous) + y) / 2 : y - (next ? center(next) - y : staff.box.height + 8) / 2;
      const bottom = next ? (center(next) + y) / 2 : y + (previous ? y - center(previous) : staff.box.height + 8) / 2;
      return { top, bottom, height: bottom - top };
    });
    const shift = (staff: Staff) => cuts.filter(cut => center(staff) > cut.top).reduce((sum, cut) => sum - cut.height, 0);
    const noteData = new Map(score.notes.map(note => [note.id, note]));
    const originalNotes = [...svg.querySelectorAll<SVGGraphicsElement>('.score-note')].flatMap(element => {
      const note = noteData.get(visualEventId(element)); return note ? [{ note, box: bounds(element, svg) }] : [];
    });
    const barlines = [...svg.querySelectorAll<SVGRectElement>('rect')].filter(element => Number(element.getAttribute('width')) < 1.2 && Number(element.getAttribute('ry') ?? 0) === 0).map(element => bounds(element, svg));
    // A visible part can rest for an entire bar. Retain horizontal timing from
    // the other parts, but place its highlight on the surviving staves.
    for (const bar of score.bars) {
      const notes = originalNotes.filter(item => noteMeasure(score, item.note) === bar.index); if (!notes.length) continue;
      const middle = notes[0].box.y + notes[0].box.height / 2;
      const owner = [...staffs].sort((a, b) => Math.abs(center(a) - middle) - Math.abs(center(b) - middle))[0];
      const visible = staffs.filter(staff => staff.system === owner.system && !removed.includes(staff)); if (!visible.length) continue;
      const minX = Math.min(...notes.map(item => item.box.x)), maxX = Math.max(...notes.map(item => item.box.x + item.box.width));
      const lines = barlines.filter(box => Math.abs(box.y + box.height / 2 - center(owner)) < 1);
      const left = lines.filter(box => box.x < minX).sort((a, b) => b.x - a.x)[0]?.x ?? owner.box.x;
      const right = lines.filter(box => box.x > maxX).sort((a, b) => a.x - b.x)[0]?.x ?? maxX + 2;
      const top = Math.min(...visible.map(staff => staff.box.y + shift(staff) - 3)), bottom = Math.max(...visible.map(staff => staff.box.y + staff.box.height + shift(staff) + 3));
      measureAnchors.set(bar.index, { svg, box: { x: left, y: top, width: right - left, height: bottom - top } });
    }
    const graphics = [...svg.children].filter((element): element is SVGGraphicsElement => element instanceof SVGGraphicsElement && !['defs', 'style'].includes(element.localName));
    const positions = graphics.map(element => ({ element, box: bounds(element, svg) }));
    const firstTop = staffs[0].box.y;
    for (const { element, box } of positions) {
      const y = box.y + box.height / 2, voice = element.getAttribute('data-voice') ?? element.querySelector('[data-voice]')?.getAttribute('data-voice');
      const candidates = voice ? staffs.filter(staff => staff.voices.has(voice)) : staffs;
      const owner = [...(candidates.length ? candidates : staffs)].sort((a, b) => Math.abs(center(a) - y) - Math.abs(center(b) - y))[0];
      // Preserve page titles/composer and the opening tempo above the system.
      const heading = !voice && box.y + box.height < firstTop - 3;
      const crossed = staffs.filter(staff => center(staff) >= box.y && center(staff) <= box.y + box.height);
      const crossStaff = !voice && box.width < 2.5 && box.height > 5 && crossed.length > 1 && crossed.some(staff => removed.includes(staff));
      if (!heading && (removed.includes(owner) || crossStaff)) {
        const old = element.getAttribute('style'), marker = element.getAttribute('data-part-hidden');
        element.style.display = 'none'; element.setAttribute('data-part-hidden', 'true');
        restore.push(() => { if (old === null) element.removeAttribute('style'); else element.setAttribute('style', old); if (marker === null) element.removeAttribute('data-part-hidden'); else element.setAttribute('data-part-hidden', marker); });
      } else if (!heading) {
        const dy = shift(owner);
        if (dy) {
          const wrapper = document.createElementNS(NS, 'g'); wrapper.setAttribute('transform', `translate(0 ${dy})`); wrapper.setAttribute('data-part-offset', String(dy));
          element.before(wrapper); wrapper.append(element); restore.push(() => { wrapper.before(element); wrapper.remove(); });
        }
      }
    }
    const original = svg.getAttribute('viewBox')!, box = svg.viewBox.baseVal;
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${Math.max(10, box.height - cuts.reduce((sum, cut) => sum + cut.height, 0))}`);
    restore.push(() => svg.setAttribute('viewBox', original));
  }
  const groups = score.voices.map(voice => [...(shared.find(group => group.has(voice.id)) ?? [voice.id])].sort());
  return { groups, detected, measureAnchors, dispose() { restore.reverse().forEach(fn => fn()); } };
}
