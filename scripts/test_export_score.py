"""Integration checks for the LilyPond timing exporter. Requires LilyPond."""
import tempfile
import unittest
from pathlib import Path
from export_score import compile_score


class ExportTests(unittest.TestCase):
    def test_pickup_meter_change_silence_transpose_tuplet_and_cadenza(self):
        with tempfile.TemporaryDirectory(prefix='sotto-check-') as temp:
            source = Path(temp) / 'fixture.ly'
            source.write_text(r'''\version "2.26.0"
\score {
  \new Staff \transpose c c, \new Voice = "melody" {
    \time 3/4 \partial 4 c'4 | d'2. | R2. |
    \time 4/4 \tuplet 3/2 { e'4 f' g' } a'2 |
    \cadenzaOn c'2. d'2 \bar "|."
  }
  \layout { }
}''')
            bundle = compile_score(source, 'Fixture', '', Path(temp) / 'out.json', False)
            self.assertEqual([bar['start'] for bar in bundle['bars']], [0, 1, 4, 7, 11])
            self.assertEqual([bar['duration'] for bar in bundle['bars']], [1, 3, 3, 4, 5])
            self.assertEqual([bar['meter'] for bar in bundle['bars']], [[3, 4]] * 3 + [[4, 4]] * 2)
            self.assertEqual(bundle['notes'][0]['midi'], 48)  # c' lowered by LilyPond once.
            self.assertEqual({note['measure'] for note in bundle['notes']}, {0, 1, 3, 4})
            self.assertAlmostEqual(bundle['notes'][2]['duration'], 2 / 3, places=5)


if __name__ == '__main__':
    unittest.main()
