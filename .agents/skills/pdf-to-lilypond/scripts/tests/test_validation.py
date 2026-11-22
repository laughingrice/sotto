"""Regression tests: run with python3 -m unittest discover -s scripts/tests -v."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import validate_score
import validate_review


@unittest.skipUnless(shutil.which('lilypond'), 'requires LilyPond')
class MusicValidation(unittest.TestCase):
    def audit(self, music, voices=None, tags=None, extra=None, tail=''):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            source = p/'test.ly'
            source.write_text('\\version "2.26.0"\nmA = '+music+'\n'+tail)
            measure = dict(number=1, variable='mA', meter='3/4',
                           voices=voices or {'melody':'music', 'bass':'music'})
            if extra:
                measure.update(extra)
            manifest = p/'manifest.json'
            manifest.write_text(json.dumps(dict(schema_version=1, tags=tags or ['print','midi'],
                                                measures=[measure])))
            return validate_score.run_validation(source, manifest, p/'build')

    def test_short_inner_voice_is_not_hidden_by_long_melody(self):
        result = self.audit(r'<< \context Voice = "melody" { c\'2. } \context Voice = "bass" { c4 } >>'.replace("\\'", "'"))
        self.assertFalse(result['ok'])
        self.assertTrue(any('bass length 1/4; expected 3/4' in x for x in result['errors']))

    def test_tuplets_graces_inheritance_and_simultaneous_voices(self):
        music = r'''<< \context Voice = "melody" {
         \tuplet 6/4 { c'16 d' e' d' c' b } \afterGrace c'2 { d'16 }
        } \context Voice = "bass" { c2. } >>'''
        self.assertTrue(self.audit(music)['ok'])

    def test_anonymous_polyphony_cannot_hide_in_named_voice(self):
        r = self.audit(r'\context Voice = "melody" << { c2. } \\ { c4 } >>',
                       voices={'melody':'music'})
        self.assertFalse(r['ok'])

    def test_anonymous_annotation_cannot_be_omitted_from_manifest(self):
        r=self.audit(r'<< \context Voice = "melody" { c2. } { s4^\markup "V" } >>',
                     voices={'melody':'music'})
        self.assertFalse(r['ok'])
        self.assertTrue(any('outside an explicit Voice' in x for x in r['errors']))

    def test_anonymous_annotation_cannot_hide_inside_music_voice(self):
        r=self.audit(r'\context Voice = "melody" << { c2. } { s4^\markup "V" } >>',
                     voices={'melody':'music'})
        self.assertFalse(r['ok'])
        self.assertTrue(any('anonymous simultaneous' in x for x in r['errors']))

    def test_nested_named_voice_must_become_sibling(self):
        r = self.audit(r'\context Voice = "melody" << { c2. } \context Voice = "child" { c2. } >>',
                       voices={'melody':'music','child':'music'})
        self.assertFalse(r['ok'])
        self.assertTrue(any('nested Voice' in x for x in r['errors']))

    def test_midi_only_duration_error_is_detected(self):
        music = r'''<< \context Voice = "melody" {
         \tag #'print { c'2. } \tag #'midi { c'2 }
        } \context Voice = "bass" { c2. } >>'''
        r = self.audit(music)
        self.assertFalse(r['ok'])
        self.assertTrue(any('midi' in x and 'length 1/2' in x for x in r['errors']))

    def test_named_voices_are_required(self):
        self.assertFalse(self.audit(r"{ c'2. }")['ok'])

    def test_note_outside_otherwise_valid_voices_fails(self):
        r = self.audit(r'''<< { e'2. } \context Voice = "melody" { c'2. }
                           \context Voice = "bass" { c2. } >>''')
        self.assertFalse(r['ok'])
        self.assertTrue(any('outside an explicit Voice' in x for x in r['errors']))

    def test_annotation_cannot_hide_sounding_notes(self):
        r = self.audit(r'''<< \context Voice = "melody" { c'2. }
                         \context Voice = "labels" { e'2. } >>''',
                       voices={'melody':'music','labels':'annotation'})
        self.assertFalse(r['ok'])
        self.assertTrue(any('annotation Voice labels contains' in x for x in r['errors']))

    def test_short_annotation_voice_fails(self):
        r = self.audit(r'''<< \context Voice = "melody" { c'2. }
                         \context Voice = "labels" { s2 s8. s32 } >>''',
                       voices={'melody':'music','labels':'annotation'})
        self.assertFalse(r['ok'])
        self.assertTrue(any('labels length 23/32' in x for x in r['errors']))

    def test_pickup_exception_and_unmetered_reason(self):
        music = r'''<< \context Voice = "melody" { c'8 } \context Voice = "bass" { s8 } >>'''
        self.assertTrue(self.audit(music, extra=dict(expected_duration='1/8',
                        exception_reason='Source pickup'))['ok'])
        with self.assertRaises(ValueError):
            self.audit(music, extra=dict(expected_duration='1/8', unmetered=True))

    def test_unknown_voice_is_not_silently_ignored(self):
        r = self.audit(r'''<< \context Voice = "melody" { c'2. }
                         \context Voice = "bass" { c2. }
                         \context Voice = "extra" { s2. } >>''')
        self.assertTrue(any('undeclared Voice extra' in x for x in r['errors']))

    def test_bar_warning_fails_even_when_voice_lengths_pass(self):
        r = self.audit(r'<< \context Voice = "melody" { c2. } \context Voice = "bass" { c2. } >>',
                       tail=r'\score { \new Staff { \time 3/4 c4 | c2. } \layout {} }')
        self.assertFalse(r['ok'])
        self.assertTrue(any('bar check failed' in x for x in r['diagnostics']))

    def test_checked_capricho_example(self):
        root = SCRIPTS.parent/'assets'/'capricho-05-08'
        with tempfile.TemporaryDirectory() as d:
            r = validate_score.run_validation(root/'checked.ly', root/'measures.json', Path(d))
        self.assertTrue(r['ok'], r)
        self.assertEqual(len(r['voice_checks']), 38)


class ReviewValidation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        artifact = self.root/'test.txt';artifact.write_text('fixture = { c4 }')
        ref = dict(path='test.txt',sha256=hashlib.sha256(artifact.read_bytes()).hexdigest())
        self.data = dict(schema_version=1,group=[7],uncertainties=[],
          artifacts={k:copy.deepcopy(ref) for k in ['original','lilypond','rendered','comparison','comparison_evidence']},
          measures=[dict(number=7,assistant_review_complete=True,
            assistant_checked=sorted(validate_review.CORE),full_measure_user_verified=False,
            user_verified=[dict(aspects=['pitches'],extent='detail',measure_numbers=[7],scope='E slides up to Bb',
                                evidence='User: "E up to Bb"',date='2026-11-08')])])

        digest = ref['sha256']
        evidence = self.root/'comparison.evidence.json'
        evidence.write_text(json.dumps(dict(original={'sha256':digest},corrected={'sha256':digest},image_sha256=digest,uncertainties=[])))
        self.data['artifacts']['comparison_evidence']=dict(path=evidence.name,sha256=hashlib.sha256(evidence.read_bytes()).hexdigest())

    def tearDown(self):
        self.tmp.cleanup()

    def review(self):
        p=self.root/'review.json';p.write_text(json.dumps(self.data));return validate_review.validate(p)

    def test_partial_user_confirmation_stays_partial(self):
        r=self.review();self.assertTrue(r['ok']);self.assertEqual(r['full_measure_user_verified'],[])
        self.assertEqual(r['pitch_user_confirmed'],[7])

    def test_pitch_confirmation_cannot_approve_whole_measure(self):
        self.data['measures'][0]['full_measure_user_verified']=True
        self.assertFalse(self.review()['ok'])

    def test_changed_artifact_invalidates_review_evidence(self):
        (self.root/'test.txt').write_text('changed')
        self.assertFalse(self.review()['ok'])

    def test_uncertainty_list_must_be_explicit(self):
        del self.data['uncertainties'];self.assertFalse(self.review()['ok'])

    def test_verification_cannot_be_assigned_to_wrong_measure(self):
        self.data['measures'][0]['user_verified'][0]['measure_numbers']=[8]
        self.assertFalse(self.review()['ok'])

    def test_full_approval_conflicts_with_uncertainty(self):
        m=self.data['measures'][0];m['full_measure_user_verified']=True
        event=m['user_verified'][0];event['extent']='full_measure';event['aspects']=sorted(validate_review.CORE)
        self.data['uncertainties']=[dict(measure=7,aspect='durations',question='Dotted or plain?')]
        self.assertFalse(self.review()['ok'])

    def test_full_measure_extent_still_requires_all_core_aspects(self):
        m=self.data['measures'][0];m['full_measure_user_verified']=True
        m['user_verified'][0]['extent']='full_measure'
        self.assertFalse(self.review()['ok'])

    def test_local_include_must_be_hashed(self):
        file=self.root/'test.txt';file.write_text('\\include "notes.ily"')
        (self.root/'notes.ily').write_text("notes = { c4 }")
        self.data['artifacts']['lilypond']['sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
        self.assertFalse(self.review()['ok'])

    def test_comparison_must_match_current_inputs(self):
        p=self.root/'comparison.evidence.json';e=json.loads(p.read_text());e['original']['sha256']='0'*64
        p.write_text(json.dumps(e))
        self.data['artifacts']['comparison_evidence']['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
        self.assertFalse(self.review()['ok'])

    def test_missing_quote_or_evidence_fails(self):
        del self.data['measures'][0]['user_verified'][0]['evidence']
        self.assertFalse(self.review()['ok'])


if __name__ == '__main__':
    unittest.main()
