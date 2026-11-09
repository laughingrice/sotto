"""Integration checks for the LilyPond timing exporter. Requires LilyPond."""
import tempfile
import unittest
from pathlib import Path
from export_score import compile_score


class ExportTests(unittest.TestCase):
    def export(self, music):
        with tempfile.TemporaryDirectory(prefix='sotto-navigation-') as temp:
            source = Path(temp) / 'fixture.ly'
            source.write_text('\\version "2.26.0"\n' + music)
            return compile_score(source, 'Fixture', '', Path(temp) / 'out.json', False)

    def test_repeats_alternate_endings_and_silent_measures_without_midi_block(self):
        bundle = self.export(r'''
\score {
  \new Voice = "melody" {
    \time 3/4
    \repeat volta 2 { c'2. | R2. | }
    \alternative { { d'2. | } { e'2. | } }
    \time 4/4 f'1 | }
  \layout { }
}''')
        self.assertEqual(bundle['sequence'], [0, 1, 2, 0, 1, 3, 4])
        self.assertEqual([bar['duration'] for bar in bundle['bars']], [3, 3, 3, 3, 4])

    def test_explicit_midi_ds_return_and_coda_map_to_the_original_identical_pitches(self):
        bundle = self.export(r'''
first = { c'1 | }
segno = { c'1 | }
toCoda = { c'1 | }
middle = { c'1 | }
codaMusic = { c'1 | }
\score { \new Voice = "melody" {
  \first \segno \toCoda \middle \codaMusic
} \layout { } }
\score { \new Voice = "melody" {
  \first \segno \toCoda \middle \segno \toCoda \codaMusic
} \midi { } }''')
        self.assertEqual(bundle['sequence'], [0, 1, 2, 3, 1, 2, 4])
        self.assertEqual(len(bundle['notes']), 5)

    def test_nested_repeats_and_long_silent_rest(self):
        bundle = self.export(r'''
\book { \score { \new Voice = "melody" {
  \repeat volta 2 { c'1 | \repeat volta 2 { d'1 | } R1*2 | }
} \layout { } } }''')
        self.assertEqual(bundle['sequence'], [0, 1, 1, 2, 3, 0, 1, 1, 2, 3])

    def test_ambiguous_shared_printed_measures_fail_instead_of_silently_guessing(self):
        with self.assertRaisesRegex(ValueError, 'Cannot uniquely map playback bar'):
            self.export(r'''
riff = { c'1 | }
\score { \new Voice = "melody" { \riff \riff } \layout { } }''')

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
