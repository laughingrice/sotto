"""Integration checks for the LilyPond timing exporter. Requires LilyPond."""
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path
from export_score import compile_score


class ExportTests(unittest.TestCase):
    def export(self, music):
        with tempfile.TemporaryDirectory(prefix='sotto-navigation-') as temp:
            source = Path(temp) / 'fixture.ly'
            source.write_text('\\version "2.26.0"\n' + music)
            return compile_score(source, 'Fixture', '', Path(temp) / 'out.json', False)

    def test_custom_export_requires_a_source_instead_of_relabeling_julia(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('export_score.py')), '--title', 'Spring', '--output', 'spring.sotto.json'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Provide the .ly source path', result.stderr)

    def test_two_named_violin_parts_export_separately_in_score_order(self):
        bundle = self.export(r'''
\score { \new StaffGroup <<
  \new Staff { \new Voice = "violinIvoice" { \time 4/4 \partial 8 e''8 | \repeat volta 2 { gis''1 | a''1 | } } }
  \new Staff { \new Voice = "violinIIvoice" { \time 4/4 \partial 8 e''8 | \repeat volta 2 { e''1 | fis''1 | } } }
>> \layout { } }
''')
        self.assertEqual([voice['name'] for voice in bundle['voices']], ['Violin I', 'Violin II'])
        self.assertEqual([voice['id'] for voice in bundle['voices']], ['violinIvoice', 'violinIIvoice'])
        self.assertEqual(len({voice['color'] for voice in bundle['voices']}), 2)
        self.assertEqual(len(bundle['notes']), 6)
        self.assertEqual(bundle['sequence'], [0, 1, 2, 1, 2])
        self.assertEqual(bundle['bars'][0]['duration'], .5)
        self.assertEqual([bar['label'] for bar in bundle['bars']], ['0', '1', '2'])
        self.assertEqual(bundle['notes'][0]['midi'], 76)  # E5, with no guitar octave shift.
        self.assertTrue(all(note['id'] in ''.join(bundle['pages']) for note in bundle['notes']))

    def test_bass_transposition_and_native_drum_voice_export_together(self):
        bundle = self.export(r'''
\score { \new StaffGroup <<
  \new Staff { \clef bass \transposition c
    \new Voice = "bass" { \repeat volta 2 { e4 e'4 d4 d'4 | } } }
  \new DrumStaff { \new DrumVoice = "drums" \drummode {
    \repeat volta 2 { <bd hh>8 hh sn hh bd hh sn hho | } } }
>> \layout { } \midi { } }
''')
        bass = [note for note in bundle['notes'] if note['voice'] == 'bass']
        drums = [note for note in bundle['notes'] if note['voice'] == 'drums']
        self.assertEqual([note['midi'] for note in bass], [40, 52, 38, 50])
        self.assertEqual([note['midi'] for note in drums], [36, 42, 42, 38, 42, 36, 42, 38, 46])
        self.assertTrue(all(note.get('percussion') is True for note in drums))
        self.assertTrue(all('percussion' not in note for note in bass))
        self.assertEqual(bundle['voices'][1]['percussion'], True)
        self.assertEqual(bundle['sequence'], [0, 0])
        self.assertTrue(all(note['id'] in ''.join(bundle['pages']) for note in drums))

    def test_custom_drum_mapping_and_global_transpose_leave_percussion_unshifted(self):
        with tempfile.TemporaryDirectory(prefix='sotto-drums-') as temp:
            source = Path(temp) / 'fixture.ly'
            source.write_text(r'''\version "2.26.0"
\score { \new StaffGroup <<
  \new Staff { \new Voice = "melody" { c'1 } }
  \new DrumStaff \with {
    drumPitchTable = #(alist->hash-table `((bassdrum . ,(ly:make-pitch -3 6 0))))
  } { \new DrumVoice = "drums" \drummode { bd1 } }
>> \layout { } }
''')
            bundle = compile_score(source, 'Fixture', '', Path(temp) / 'out.json', False, transpose=-12)
            self.assertEqual({note['voice']: note['midi'] for note in bundle['notes']}, {'melody': 48, 'drums': 35})

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
