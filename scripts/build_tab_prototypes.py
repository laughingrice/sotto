#!/usr/bin/env python3
"""Build only the two original four-bar tab fixtures; not a general tab exporter.

python3 scripts/build_tab_prototypes.py --instrument guitar --instrument bass
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path
from export_score import read_measures, playback_sequence, write_bundle
from svg_optimize import compact_page

ROOT = Path(__file__).resolve().parent.parent
PROFILES = {'guitar': dict(id='guitar-6', tuning=[64, 59, 55, 50, 45, 40], instrument='guitar'),
            'bass': dict(id='bass-4', tuning=[43, 38, 33, 28], instrument='bass-electric')}


def build(instrument, output, views=('notation', 'tabs', 'both')):
    profile = PROFILES[instrument]
    source = ROOT / 'scores/tab-prototypes' / f'{instrument}.ly'
    music = source.read_text()
    canonical, renderings, sequence, bars = {}, {}, None, None
    for view in views:
        text = music.replace("sottoView = #'both", f"sottoView = #'{view}")
        text = text.replace('\\layout { }', r'''\layout {
          \context { \Score \consists #practice-timing-engraver }
          \context { \Voice \consists #prototype-note-engraver }
          \context { \TabVoice \consists #prototype-note-engraver }
          \context { \Staff \consists #prototype-staff-engraver }
          \context { \TabStaff \consists #prototype-staff-engraver }
        }''')
        includes = ''.join(f'\\include "{ROOT / "scripts" / name}"\n' for name in ('practice-map.ily', 'tab-prototype-map.ily'))
        with tempfile.TemporaryDirectory(prefix='sotto-tab-') as temp:
            folder = Path(temp)
            (folder / 'score.ly').write_text(includes + text + '\n#(practice-export-playback)\n')
            result = subprocess.run(['lilypond', '--svg', '-dno-point-and-click', '-o', 'score', 'score.ly'], cwd=folder, capture_output=True, text=True)
            # Existing shared timing adapter uses this compatibility property.
            diagnostics = result.stderr.replace("warning: the property 'timeSignatureFraction' is deprecated; use 'timeSignature'", '')
            if result.returncode or 'programming error:' in diagnostics or 'warning:' in diagnostics:
                raise ValueError(result.stderr)
            current = {}
            for row in (folder / 'visuals.tsv').read_text().splitlines():
                identity, voice, beat, midi, duration, string, representation, tie = row.split('\t')
                midi, string = int(float(midi)), int(string)
                if not 1 <= string <= len(profile['tuning']):
                    raise ValueError(f'{identity}: explicit string required for {instrument}\n{result.stdout}')
                fret = midi - profile['tuning'][string - 1]
                if not 0 <= fret <= 24:
                    raise ValueError(f'{identity}: impossible string/fret ({string}/{fret}), check octave/tuning')
                note = dict(id=identity, voice=voice, beat=float(beat), grace=0, midi=midi, duration=float(duration),
                            bar=int(float(beat) // 4) + 1, measure=int(float(beat) // 4), tie=tie == '1',
                            string=string, fret=fret)
                if identity in current and current[identity] != note:
                    raise ValueError(f'{identity}: notation and tablature disagree')
                current[identity] = note
            if canonical and current != canonical:
                raise ValueError('Switching views changed musical events')
            canonical = current
            bars = read_measures((folder / 'measures.tsv').read_text())
            played = read_measures((folder / 'played-measures.tsv').read_text())
            current_sequence = playback_sequence(bars, played, (folder / 'written-events.tsv').read_text(), (folder / 'played-events.tsv').read_text())
            if sequence and current_sequence != sequence:
                raise ValueError('Switching views changed repeats')
            sequence = current_sequence
            paths = sorted(folder.glob('score*.svg'))
            pages = [compact_page(path.read_text(), f'{view}-{i}-', set(), True) for i, path in enumerate(paths)]
            renderings[view] = dict(pages=pages)
            header = json.loads((folder / 'header.json').read_text())
            print(f'{instrument}/{view}: {len(current)} unique events, {len(pages)} pages, {len(sequence)} performed bars')
    bundle = dict(format='sotto-score', version=1, title=header['title'], composer='Sotto', subtitle=header['subtitle'],
                  description='Four-bar tab prototype · original CC0 exercise', bpm=100, beatUnit=1, beatsPerBar=4,
                  voices=[dict(id=instrument, name=instrument.title(), color='#31745e', instrument=profile['instrument'])],
                  parts=[dict(id=instrument, voices=[instrument], profile=profile['id'], tuning=profile['tuning'], capo=0)],
                  notes=sorted(canonical.values(), key=lambda note: (note['beat'], note['id'])), bars=bars, sequence=sequence,
                  pages=renderings.get('notation', next(iter(renderings.values())))['pages'], renderings=renderings)
    output.mkdir(parents=True, exist_ok=True)
    write_bundle(output / f'{instrument}.sotto', bundle)
    # Share the same editable source that produced all three renderings.
    (output / f'{instrument}.ly').write_text(music)
    return bundle


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instrument', action='append', choices=PROFILES, required=True)
    parser.add_argument('--views', default='notation,tabs,both')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/scores/prototypes')
    args = parser.parse_args()
    views = args.views.split(',')
    if not views or len(set(views)) != len(views) or any(view not in ('notation', 'tabs', 'both') for view in views):
        parser.error('--views must contain unique choices from notation,tabs,both')
    for instrument in dict.fromkeys(args.instrument):
        build(instrument, args.output, views)
