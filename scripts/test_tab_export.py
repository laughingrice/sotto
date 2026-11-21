"""Real LilyPond integration tests for opt-in tablature exports."""
import gzip
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from export_score import compile_score
from tab_export import assignments, tab_settings


class TabExportTests(unittest.TestCase):
    def export(self, text, parts=None, **kwargs):
        with tempfile.TemporaryDirectory(prefix='sotto-tab-test-') as temp:
            source = Path(temp) / 'piece.ly'
            source.write_text('\\version "2.26.0"\n' + text)
            return compile_score(source, None, None, Path(temp) / 'out.sotto', False,
                                 tab_parts=parts or {'guitar': 'guitar-6'}, **kwargs)

    @staticmethod
    def guitar(music):
        return r'\header { title = "Tabs" subtitle = "A passage" composer = "Composer" } \score { \new Staff = "guitar" { \clef "treble_8" \new Voice = "lead" { ' + music + r' } } \layout { } }'

    def test_numeric_metadata_source_strings_native_frets_and_legacy_default(self):
        score = self.export(self.guitar(r'\time 4/4 \tempo 4 = 96 e,4\6 g,4\6 a,4\5 b,4\5 | R1 |'))
        self.assertEqual((score['title'], score['composer'], score['bpm']), ('Tabs -- A passage', 'Composer', 96))
        self.assertEqual(score['sequence'], [0, 1])
        self.assertEqual([(n['midi'], n['string'], n['fret']) for n in score['notes']], [(40, 6, 0), (43, 6, 3), (45, 5, 0), (47, 5, 2)])
        self.assertEqual(set(score['renderings']), {'notation', 'tabs', 'both'})
        for view, rendering in score['renderings'].items():
            svg = ''.join(rendering['pages'])
            self.assertNotIn('textedit:', svg)
            for note in score['notes']:
                self.assertEqual(svg.count(f'data-event-id="{note["id"]}"'), 2 if view == 'both' else 1)
                self.assertIn(f'id="{note["id"]}"', ''.join(score['pages']))
            self.assertIn('data-boundary="2"', svg)

    def test_octaves_native_transposition_and_explicit_offset(self):
        native = self.export(self.guitar(r"\transposition c e1\6 |"))
        self.assertEqual((native['notes'][0]['midi'], native['notes'][0]['fret']), (40, 0))
        manual = self.export(self.guitar(r'e1\6 |'), transpose=-12)
        self.assertEqual((manual['notes'][0]['midi'], manual['notes'][0]['fret']), (40, 0))

    def test_drop_d_and_capo_use_sounding_pitch_without_transposing_twice(self):
        dropped = self.export(self.guitar(r'd,1\6 |'), tab_tunings={'guitar': 'D2,A2,D3,G3,B3,E4'})
        self.assertEqual((dropped['notes'][0]['midi'], dropped['notes'][0]['fret']), (38, 0))
        self.assertEqual(dropped['parts'][0]['tuning'][-1], 38)
        capo = self.export(self.guitar(r'fis,1\6 |'), tab_capos={'guitar': '2'})
        self.assertEqual((capo['notes'][0]['midi'], capo['notes'][0]['fret']), (42, 0))
        self.assertEqual(capo['parts'][0]['capo'], 2)

    def test_includes_pickup_changing_meter_grace_repeats_and_multiple_voices(self):
        # Chord/post-events, rational timing and distinct source voices all
        # survive copied Staff/TabStaff rendering and unfolded playback.
        text = r'''
\score { \new Staff = "guitar" { \clef "treble_8" \time 3/4 \partial 4
  << \new Voice = "lead" { \voiceOne e'4\1 } \new Voice = "low" { \voiceTwo e,4\6 } >>
  \repeat volta 2 {
    \time 3/4
    << \context Voice = "lead" { \grace { fis'16\1 } g'2.\1 } \context Voice = "low" { e,2.\6 } >> |
    \time 4/4
    << \context Voice = "lead" { a'2\1~ a'2\1 } \context Voice = "low" { e,1\6 } >> |
  }
} \layout { } }
'''
        score = self.export(text)
        self.assertEqual([bar['duration'] for bar in score['bars']], [1, 3, 4])
        self.assertEqual(score['sequence'], [0, 1, 2, 1, 2])
        self.assertEqual(set(score['parts'][0]['voices']), {'lead', 'low'})
        self.assertTrue(any(note['grace'] != 0 for note in score['notes']))
        self.assertTrue(any(note['tie'] for note in score['notes']))

    def test_bass_and_drums_and_five_string_profile(self):
        score = self.export(r'''
\score { <<
  \new Staff = "bass" { \clef "bass_8" \new Voice = "bassLine" { e,,2\4 g,,2\4 | } }
  \new DrumStaff = "kit" { \new DrumVoice = "drums" \drummode { bd4 sn bd sn | } }
>> \layout { } }
''', parts={'bass': 'bass-4'})
        self.assertEqual(len(score['notes']), 6)
        self.assertEqual(sum(bool(note.get('percussion')) for note in score['notes']), 4)
        self.assertEqual(score['notes'][0]['midi'], 28)
        for view, rendering in score['renderings'].items():
            svg = ''.join(rendering['pages'])
            for note in score['notes']:
                self.assertEqual(svg.count(f'data-event-id="{note["id"]}"'), 2 if view == 'both' and note['voice'] == 'bassLine' else 1)
        five = self.export(r'\score { \new Staff = "bass" { \clef "bass_8" \new Voice = "lowB" { b,,,1\5 | } } \layout { } }', parts={'bass': 'bass-5'})
        self.assertEqual((five['notes'][0]['midi'], five['notes'][0]['fret']), (23, 0))

    def test_partial_chord_ties_and_string_continuity(self):
        score = self.export(self.guitar(r"<e'\1~ b\2>2 <e'\1 b\2>2 |"))
        first = [note for note in score['notes'] if note['beat'] == 0]
        self.assertEqual({note['midi']: note['tie'] for note in first}, {64: True, 59: False})
        with self.assertRaisesRegex(ValueError, 'tied note changes string'):
            self.export(self.guitar(r"e'2\1~ e'2\2 |"))

    def test_two_selected_parts_and_duplicate_voice_names(self):
        text = r'''\score { <<
          \new Staff = "guitar" { \new Voice = "guitarLead" { e,1\6 | } }
          \new Staff = "bass" { \new Voice = "bassLine" { e,,1\4 | } }
        >> \layout { } }'''
        score = self.export(text, parts={'guitar': 'guitar-6', 'bass': 'bass-4'})
        self.assertEqual([part['voices'] for part in score['parts']], [['guitarLead'], ['bassLine']])
        self.assertEqual([voice['instrument'] for voice in score['voices']], ['guitar', 'bass-electric'])
        self.assertEqual(len(score['notes']), 2)
        with self.assertRaisesRegex(ValueError, 'Voice ID.*shared by different parts'):
            self.export(text.replace('guitarLead', 'lead').replace('bassLine', 'lead'), parts={'guitar': 'guitar-6', 'bass': 'bass-4'})

    def test_source_page_breaks_are_natural_unless_explicitly_kept(self):
        text = self.guitar(r'e,1\6 | \pageBreak g,1\6 |')
        natural = self.export(text)
        self.assertTrue(all(len(view['pages']) == 1 for view in natural['renderings'].values()))
        deliberate = self.export(text, keep_page_breaks=True, views=['both'])
        self.assertEqual(len(deliberate['renderings']['both']['pages']), 2)
        self.assertEqual(natural['notes'], deliberate['notes'])

    def test_failures_do_not_invent_missing_strings_or_impossible_fingerings(self):
        for music, pattern in [(r'e,1 |', 'explicit string'), (r'e,1\1 |', 'cannot use string'),
                               (r'<e,\6 g,\6>1 |', 'overlapping notes reuse string')]:
            with self.subTest(music=music), self.assertRaisesRegex(ValueError, pattern):
                self.export(self.guitar(music))
        with self.assertRaisesRegex(ValueError, 'Named Staff not found'):
            self.export(self.guitar(r'e,1\6'), parts={'wrong': 'guitar-6'})
        with self.assertRaisesRegex(ValueError, 'Unsupported tab profile'):
            self.export(self.guitar(r'e,1\6'), parts={'guitar': 'piano'})

    def test_cli_includes_and_views_subset_with_no_manual_event_tags(self):
        with tempfile.TemporaryDirectory(prefix='sotto-tab-cli-') as temp:
            folder = Path(temp)
            (folder / 'music.ily').write_text(r'melody = { e,1\6 | }')
            source = folder / 'piece.ly'
            source.write_text(r'\version "2.26.0" \include "music.ily" \book { \score { \new Staff = "guitar" { \new Voice = "lead" \melody } \layout { } } }')
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('export_score.py')), str(source), '--tab-part', 'guitar=guitar-6', '--views', 'tabs'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            score = json.loads(gzip.decompress(source.with_suffix('.sotto').read_bytes()))
            self.assertEqual(set(score['renderings']), {'tabs'})
            self.assertIn('data-representation="notation"', score['pages'][0])
            self.assertNotIn('sotto-event', source.read_text())

    def test_option_validation(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            assignments(['guitar=guitar-6', 'guitar=bass-4'], '--tab-part')
        with self.assertRaisesRegex(ValueError, 'needs 6'):
            tab_settings({'guitar': 'guitar-6'}, {'guitar': 'E2,A2,D3,G3'})
        with self.assertRaisesRegex(ValueError, 'matching --tab-part'):
            tab_settings({'guitar': 'guitar-6'}, capos={'bass': '2'})
        with self.assertRaisesRegex(ValueError, 'integer'):
            tab_settings({'guitar': 'guitar-6'}, capos={'guitar': '2.5'})


if __name__ == '__main__':
    unittest.main()
