"""Structural safeguards; svg-test.mjs checks actual browser rendering."""
import copy
import gzip
import json
from pathlib import Path
import unittest
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from svg_optimize import SVG, compact_page, encoded, optimize_score

PATH = 'M0 -46c0 91 116 182 217 182c63 0 109 -35 109 -90c0 -87 -110 -182 -220 -182c-67 0 -106 39 -106 90z'


class SvgTests(unittest.TestCase):
    def test_shares_only_geometry_and_preserves_note_identity_styles_and_transform_order(self):
        source = f'''<svg xmlns="{SVG}" viewBox="0 0 100 100">
          <g id="note" class="score-note" data-voice="bass">
            <g transform="translate(2,3)"><path d="{PATH}" transform="scale(.004,-.004)" fill="red"/></g>
          </g>
          <path d="{PATH}" transform="translate(4,5)" fill="blue"/>
          <path id="named-path" d="{PATH}"/>
          <text><tspan>  A  B  </tspan></text>
        </svg>'''
        root = ET.fromstring(compact_page(source, 'sg0-', set(), True))
        definitions = root.find(f'{{{SVG}}}defs')
        self.assertEqual(len(definitions), 1)
        self.assertEqual(definitions[0].get('d'), PATH)
        note = next(e for e in root.iter() if e.get('id') == 'note')
        self.assertEqual(note.get('data-voice'), 'bass')
        self.assertEqual(note.get('class'), 'score-note')
        use = note[0]
        self.assertEqual(use.tag, f'{{{SVG}}}use')
        self.assertEqual(use.get('transform'), 'translate(2,3) scale(.004,-.004)')
        self.assertEqual(use.get('fill'), 'red')
        self.assertEqual(root.find(f'{{{SVG}}}use').get('fill'), 'blue')
        named = next(e for e in root.iter() if e.get('id') == 'named-path')
        self.assertEqual(named.tag, f'{{{SVG}}}path')
        self.assertEqual(root.find(f'.//{{{SVG}}}tspan').text, '  A  B  ')
        self.assertEqual(root.get('viewBox'), '0 0 100 100')

    def test_generated_ids_avoid_existing_ids_and_keep_existing_local_references(self):
        source = f'''<svg xmlns="{SVG}"><defs><path id="existing" d="M0 0L1 1"/></defs>
          <use href="#existing"/><path d="{PATH}"/><path d="{PATH}"/></svg>'''
        root = ET.fromstring(compact_page(source, 'sg0-', {'sg0-0'}, False))
        glyph = root.find(f'{{{SVG}}}defs')[0]
        self.assertNotEqual(glyph.get('id'), 'sg0-0')
        self.assertTrue(any(e.get('href') == '#existing' for e in root.iter()))
        identities = [e.get('id') for e in root.iter() if e.get('id')]
        self.assertEqual(len(identities), len(set(identities)))

    def test_never_grows_compressed_bundle_or_modifies_music_and_is_idempotent(self):
        fixture = Path(__file__).parent / 'fixtures/julia-florida.sotto.json'
        original = json.loads(fixture.read_text())
        snapshot = copy.deepcopy(original)
        optimized = optimize_score(original)
        self.assertEqual(original, snapshot)
        self.assertEqual({**optimized, 'pages': []}, {**original, 'pages': []})
        self.assertLess(len(gzip.compress(encoded(optimized))), len(gzip.compress(encoded(original))))
        self.assertEqual(optimize_score(optimized), optimized)
        # IDs remain unique even though multiple SVG pages share the DOM.
        ids = [e.get('id') for page in optimized['pages'] for e in ET.fromstring(page).iter() if e.get('id')]
        self.assertEqual(len(ids), len(set(ids)))

    def test_cli_accepts_legacy_and_compressed_files_and_preserves_metadata(self):
        original = json.loads((Path(__file__).parent / 'fixtures/julia-florida.sotto.json').read_text())
        with tempfile.TemporaryDirectory() as temp:
            source, output, legacy = (Path(temp) / name for name in ('score.sotto.json', 'score.sotto', 'copy.sotto.json'))
            source.write_bytes(encoded(original))
            for src, dst in [(source, output), (output, legacy)]:
                result = subprocess.run([sys.executable, str(Path(__file__).with_name('svg_optimize.py')), str(src), '--output', str(dst)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            optimized = json.loads(gzip.decompress(output.read_bytes()))
            self.assertEqual(json.loads(legacy.read_bytes()), optimized)
            self.assertEqual({**optimized, 'pages': []}, {**original, 'pages': []})
            self.assertEqual(json.loads(source.read_bytes()), original)

    def test_small_scores_can_retain_original_when_optimization_would_cost_more(self):
        bundle = {'pages': [f'<svg xmlns="{SVG}"><path d="M0 0L1 1"/></svg>']}
        self.assertEqual(optimize_score(bundle), bundle)


if __name__ == '__main__':
    unittest.main()
