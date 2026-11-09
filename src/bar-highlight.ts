import { noteMeasure, type Score } from './score';

type Box = { x: number; y: number; width: number; height: number };
type LocatedMeasure = { index: number; svg: SVGSVGElement; box: Box; staffY: number };
const NS = 'http://www.w3.org/2000/svg';

/** Convert rendered geometry back into the page's SVG coordinates. */
function boxInPage(element: SVGGraphicsElement, svg: SVGSVGElement): Box | null {
  const matrix = svg.getScreenCTM();
  const bounds = element.getBoundingClientRect();
  if (!matrix || bounds.width === 0 || bounds.height === 0) return null;
  const inverse = matrix.inverse();
  const first = new DOMPoint(bounds.left, bounds.top).matrixTransform(inverse);
  const last = new DOMPoint(bounds.right, bounds.bottom).matrixTransform(inverse);
  return { x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y };
}

/** Derive measure rectangles from existing note IDs and LilyPond barlines.
 * This also works with bundles exported before bar highlighting was added.
 * Rectangles live inside the SVG, so they scale with zoom without drift.
 */
export function buildBarHighlights(root: HTMLElement, score: Score): Map<number, SVGRectElement> {
  root.querySelectorAll('.current-bar-highlight').forEach(element => element.remove());
  const result = new Map<number, SVGRectElement>();
  const elements = new Map(Array.from(root.querySelectorAll<SVGGraphicsElement>('.score-note')).map(element => [element.id, element]));
  const pages = Array.from(root.querySelectorAll<SVGSVGElement>('.score-page svg'));
  const lines = new Map<SVGSVGElement, Box[]>();
  for (const svg of pages) {
    // LilyPond draws barlines as square-cornered, thin, full-staff rectangles.
    // Stems have rounded corners and must not be mistaken for bar boundaries.
    lines.set(svg, Array.from(svg.querySelectorAll<SVGRectElement>('rect'))
      .filter(rect => Number(rect.getAttribute('width')) < 1.2 &&
        Math.abs(Number(rect.getAttribute('height')) - 4) < .01 &&
        Number(rect.getAttribute('ry') ?? 0) === 0)
      .map(rect => boxInPage(rect, svg)).filter((box): box is Box => box !== null));
  }
  const measures: LocatedMeasure[] = [];
  for (const bar of score.bars) {
    const notes = score.notes.filter(note => noteMeasure(score, note) === bar.index);
    const geometry = notes.flatMap(note => {
      const element = elements.get(note.id);
      const svg = element?.ownerSVGElement;
      if (!element || !svg) return [];
      const box = boxInPage(element, svg);
      return box ? [{ svg, box }] : [];
    });
    if (!geometry.length) continue;
    const svg = geometry[0].svg;
    const boxes = geometry.filter(item => item.svg === svg).map(item => item.box);
    const minX = Math.min(...boxes.map(box => box.x));
    const maxX = Math.max(...boxes.map(box => box.x + box.width));
    const minY = Math.min(...boxes.map(box => box.y));
    const maxY = Math.max(...boxes.map(box => box.y + box.height));
    const centers = boxes.map(box => box.y + box.height / 2).sort((a, b) => a - b);
    const middleY = centers[Math.floor(centers.length / 2)];
    const barlines = lines.get(svg) ?? [];
    const nearest = [...barlines].sort((a, b) => Math.abs(a.y + a.height / 2 - middleY) - Math.abs(b.y + b.height / 2 - middleY))[0];
    const staffY = nearest ? nearest.y + nearest.height / 2 : middleY;
    const sameStaff = barlines.filter(box => Math.abs(box.y + box.height / 2 - staffY) < .1);
    const leftLine = sameStaff.filter(box => box.x < minX).sort((a, b) => b.x - a.x)[0];
    const rightLine = sameStaff.filter(box => box.x > maxX).sort((a, b) => a.x - b.x)[0];
    const left = leftLine?.x ?? minX - 2;
    const right = rightLine?.x ?? maxX + 2;
    const top = Math.min(staffY - 6, minY - 2.5);
    const bottom = Math.max(staffY + 6, maxY + 2.5);
    measures.push({ index: bar.index, svg, staffY, box: { x: left, y: top, width: right - left, height: bottom - top } });
  }
  for (const measure of measures) {
    // Keep the highlight height consistent across each system, including the
    // bass ledger lines and high melody notes, rather than jumping in height.
    const row = measures.filter(other => other.svg === measure.svg && Math.abs(other.staffY - measure.staffY) < .1);
    const top = Math.min(...row.map(other => other.box.y));
    const bottom = Math.max(...row.map(other => other.box.y + other.box.height));
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', 'current-bar-highlight');
    rect.setAttribute('data-bar-index', String(measure.index));
    rect.setAttribute('x', String(measure.box.x));
    rect.setAttribute('y', String(top));
    rect.setAttribute('width', String(measure.box.width));
    rect.setAttribute('height', String(bottom - top));
    rect.setAttribute('rx', '1');
    rect.setAttribute('aria-hidden', 'true');
    measure.svg.prepend(rect);
    result.set(measure.index, rect);
  }
  return result;
}
