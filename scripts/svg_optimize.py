"""Lossless SVG compaction for LilyPond scores; never rounds drawing coordinates."""
from collections import Counter
import gzip
import json
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'
XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'
TEXT_TAGS = {f'{{{SVG}}}{name}' for name in ('text', 'tspan', 'style', 'title', 'desc')}
SHARED_PATH_ATTRIBUTES = {'d', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'}
ET.register_namespace('', SVG)
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')


def compact_page(source, prefix, reserved, collapse_groups):
    root = ET.fromstring(source)
    path_tag, group_tag = f'{{{SVG}}}path', f'{{{SVG}}}g'
    # Leave named paths alone: another element may already reference them.
    candidates = [element for element in root.iter(path_tag)
                  if not len(element) and set(element.attrib) <= SHARED_PATH_ATTRIBUTES and element.get('d')]
    counts = Counter(element.get('d') for element in candidates)
    glyphs = {}
    definitions = ET.Element(f'{{{SVG}}}defs')
    for data, count in counts.items():
        if count < 2 or len(data) < 60:
            continue
        identity = f'{prefix}{len(glyphs)}'
        while identity in reserved:
            identity += '_'
        reserved.add(identity)
        glyphs[data] = identity
        ET.SubElement(definitions, path_tag, {'id': identity, 'd': data})
    for element in candidates:
        identity = glyphs.get(element.get('d'))
        if identity:
            element.tag = f'{{{SVG}}}use'
            del element.attrib['d']
            element.set('href', f'#{identity}')

    def compact(element, preserve_text=False):
        preserve_text = (preserve_text or element.get(XML_SPACE) == 'preserve' or
                         element.tag in TEXT_TAGS)
        if not preserve_text and element.text and not element.text.strip():
            element.text = None
        for index, child in enumerate(list(element)):
            compact(child, preserve_text)
            if not preserve_text and child.tail and not child.tail.strip():
                child.tail = None
            # Transfer only a plain transform wrapper. Annotated note groups,
            # inherited styles, text spacing and transform order stay intact.
            if (collapse_groups and not preserve_text and child.tag == group_tag and
                    len(child) == 1 and set(child.attrib) == {'transform'} and
                    not (child.text or '').strip() and not (child[0].tail or '').strip()):
                grandchild = child[0]
                transform = child.get('transform')
                if grandchild.get('transform'):
                    transform += ' ' + grandchild.get('transform')
                grandchild.set('transform', transform)
                grandchild.tail = child.tail
                element.remove(child)
                element.insert(index, grandchild)
    compact(root)
    if len(definitions):
        root.insert(0, definitions)
    return ET.tostring(root, encoding='unicode')


def encoded(bundle):
    return json.dumps(bundle, separators=(',', ':')).encode('utf-8')


def optimize_score(bundle):
    """Choose by actual gzip size, retaining the original if no candidate wins.

    Different pages share a document in the player, so glyph IDs must be unique
    across the entire score, including pre-existing IDs on other pages.
    """
    reserved = {element.get('id') for page in bundle['pages']
                for element in ET.fromstring(page).iter() if element.get('id')}
    best = bundle
    before = len(gzip.compress(encoded(bundle), mtime=0))
    best_size = before
    for collapse in (False, True):
        candidate = {**bundle, 'pages': [compact_page(page, f'sg{index}-', set(reserved), collapse)
                                       for index, page in enumerate(bundle['pages'])]}
        size = len(gzip.compress(encoded(candidate), mtime=0))
        if size < best_size:
            best, best_size = candidate, size
    print(f'SVG optimization: compressed bundle {before:,} → {best_size:,} bytes '
          f'({100 * (1 - best_size / before):.1f}% additional saving; drawing precision unchanged).')
    return best


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description='Optimize SVG inside an existing Sotto bundle without recompiling LilyPond.')
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, required=True, help='Destination .sotto (compressed) or legacy .sotto.json file.')
    args = parser.parse_args()
    data = args.source.read_bytes()
    bundle = json.loads(gzip.decompress(data) if data.startswith(b'\x1f\x8b') else data)
    if not isinstance(bundle, dict) or bundle.get('format') != 'sotto-score' or bundle.get('version') != 1 or not isinstance(bundle.get('pages'), list):
        parser.error('The input must be a Sotto score bundle.')
    result = encoded(optimize_score(bundle))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(result if args.output.suffix.lower() == '.json' else gzip.compress(result, mtime=0))
    print(f'Wrote {args.output} ({args.output.stat().st_size:,} bytes).')
