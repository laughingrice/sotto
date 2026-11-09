#!/usr/bin/env python3
"""Compile a trusted LilyPond score into a portable Sotto practice bundle.

Built-in example: python3 scripts/export_score.py
Other .ly file:   python3 scripts/export_score.py score.ly --title 'My piece'
MusicXML: first run musicxml2ly --output=score.ly score.musicxml, then export.
Requires LilyPond 2.26 and Python 3; no Python packages are needed.
"""
import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / 'scores' / 'julia-florida.ly'


def compile_score(source: Path, title: str, composer: str, output: Path, julia: bool,
                  beats_per_bar=None, beat_unit=None, bpm=None, transpose=None):
    beats_per_bar = beats_per_bar if beats_per_bar is not None else (3 if julia else 4)
    beat_unit = beat_unit if beat_unit is not None else (1.5 if julia else 1)
    bpm = bpm if bpm is not None else (44 if julia else 80)
    transpose = transpose if transpose is not None else (-12 if julia else 0)
    text = source.read_text()
    if '\\layout {' not in text:
        raise ValueError('The score needs an explicit \\layout { } block to install the exporter.')
    text = text.replace('\\layout {', '\\layout {\n  \\context { \\Voice \\consists #practice-engraver }', 1)
    text = '\\include "' + str(ROOT / 'scripts/practice-map.ily') + '"\n' + text
    with tempfile.TemporaryDirectory(prefix='sotto-export-') as temp:
        folder = Path(temp)
        (folder / 'score.ly').write_text(text)
        subprocess.run(['lilypond', '-I', str(source.parent), '-dbackend=svg', '-dno-point-and-click', '-o', 'score', 'score.ly'],
                       cwd=folder, check=True, capture_output=True, text=True)
        svg_paths = sorted(folder.glob('score*.svg'), key=lambda path: int(re.search(r'(\d+)\.svg$', path.name).group(1)) if re.search(r'(\d+)\.svg$', path.name) else 0)
        pages = [path.read_text() for path in svg_paths]
        notes = []
        for line in (folder / 'events.tsv').read_text().splitlines():
            identity, voice, beat, grace, pitch, duration, bar, tie = line.split('\t')
            notes.append(dict(id=identity, voice=voice or 'voice', beat=float(beat),
                              grace=float(grace), midi=round(float(pitch)) + transpose,
                              duration=float(duration), bar=int(bar), tie=tie == '1'))
    if not pages or not notes:
        raise ValueError('No pages or notes were exported.')
    measure_count = max(int((n['beat'] + 0.00001) // beats_per_bar) for n in notes) + 1
    bars = []
    for index in range(measure_count):
        members = [n for n in notes if int((n['beat'] + 0.00001) // beats_per_bar) == index]
        label = str(members[0]['bar']) if members else str(index + 1)
        if julia and index in (30, 31): label += ' · 1st'
        if julia and index in (32, 33): label += ' · 2nd'
        bars.append(dict(index=index, label=label))
    # Written: A(1–20), B(21–30), ending1(31–32), ending2(31–32), C(33–54), coda(55–59).
    # Return at D.C. to the beginning and jump to the coda BEFORE bar 18.
    sequence = (list(range(32)) + list(range(20, 30)) + list(range(32, 56))
                + list(range(17)) + list(range(56, 61))) if julia else list(range(measure_count))
    bundle = dict(format='sotto-score', version=1, title=title, composer=composer,
                  subtitle='Barcarola · solo guitar' if julia else 'Practice score',
                  beatsPerBar=beats_per_bar, beatUnit=beat_unit, bpm=bpm,
                  voices=[dict(id=v, name=name, color=color) for v, name, color in
                          [('melody', 'Melody', '#31745e'), ('middle', 'Inner voice', '#b47734'), ('bass', 'Bass', '#657db1')]] if julia else
                          [dict(id=v, name=v.title(), color='#31745e') for v in sorted({n['voice'] for n in notes})],
                  notes=notes, pages=pages, bars=bars, sequence=sequence,
                  description='Drop D tuning · sounds one octave below the written score' if julia else f'Written order · pitch offset {transpose:+d} semitones')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(bundle, separators=(',', ':')))
    print(f'Exported {len(notes)} noteheads, {len(pages)} pages, {measure_count} written bars → {output}')
    return bundle


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--title')
    parser.add_argument('--composer')
    parser.add_argument('--beats-per-bar', type=float, help='Bar duration in quarter notes (e.g. 3 for 6/8).')
    parser.add_argument('--beat-unit', type=float, help='Tempo pulse in quarter notes (e.g. 1.5 for dotted quarter).')
    parser.add_argument('--bpm', type=float)
    parser.add_argument('--transpose', type=int, help='Written-to-sounding MIDI semitones; -12 for conventional guitar notation.')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    julia = args.source.resolve() == DEFAULT_SOURCE.resolve()
    output = args.output or (ROOT / 'public/scores/julia-florida.sotto.json' if julia else args.source.with_suffix('.sotto.json'))
    try:
        compile_score(args.source.resolve(), args.title or ('Julia Florida' if julia else args.source.stem),
                      args.composer or ('Agustín Barrios' if julia else ''), output, julia,
                      args.beats_per_bar, args.beat_unit, args.bpm, args.transpose)
    except subprocess.CalledProcessError as exc:
        print(exc.stdout or '')
        print(exc.stderr or '')
        raise SystemExit(exc.returncode)
