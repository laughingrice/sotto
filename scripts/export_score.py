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


def read_measures(rows):
    """Use LilyPond's Timing context, never divide time by a fixed meter."""
    boundaries = {}
    final = 0
    cadenza_start = None
    for line in rows.splitlines():
        beat, position, length, label, numerator, denominator, timing = line.split('\t')
        beat, position, length = float(beat), float(position), float(length)
        final = max(final, beat)
        start = 0 if position < 0 else max(0, round(beat - position, 8))
        if timing == '0':
            if cadenza_start is None:
                cadenza_start = start
            start = cadenza_start
        else:
            cadenza_start = None
        # Cadenza timing remains in the current measure; its actual end is
        # provided by the final score moment instead of the nominal meter.
        boundaries.setdefault(start, dict(label=label, meter=[int(numerator), int(denominator)]))
    starts = sorted(start for start in boundaries if start < final - 1e-6)
    return [dict(index=i, start=start, duration=(starts[i + 1] if i + 1 < len(starts) else final) - start,
                 **boundaries[start]) for i, start in enumerate(starts)]


def compile_score(source: Path, title: str, composer: str, output: Path, julia: bool,
                  beats_per_bar=None, beat_unit=None, bpm=None, transpose=None):
    beat_unit = beat_unit if beat_unit is not None else (1.5 if julia else 1)
    bpm = bpm if bpm is not None else (44 if julia else 80)
    transpose = transpose if transpose is not None else (-12 if julia else 0)
    text = source.read_text()
    if '\\layout {' not in text:
        raise ValueError('The score needs an explicit \\layout { } block to install the exporter.')
    text = text.replace('\\layout {', '\\layout {\n  \\context { \\Score \\consists #practice-timing-engraver }\n  \\context { \\Voice \\consists #practice-engraver }', 1)
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
        bars = read_measures((folder / 'measures.tsv').read_text())
    if not pages or not notes:
        raise ValueError('No pages or notes were exported.')
    if not bars:
        raise ValueError('No measure timing was exported.')
    beats_per_bar = bars[0]['meter'][0] * 4 / bars[0]['meter'][1]
    for bar in bars:
        if julia and bar['index'] in (30, 31): bar['label'] += ' · 1st'
        if julia and bar['index'] in (32, 33): bar['label'] += ' · 2nd'
    for note in notes:
        bar = next(bar for bar in reversed(bars) if note['beat'] >= bar['start'] - 1e-6)
        note['measure'] = bar['index']
    measure_count = len(bars)
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
    parser.add_argument('--beats-per-bar', type=float, help='Deprecated: measure boundaries are read from LilyPond Timing.')
    parser.add_argument('--beat-unit', type=float, help='Tempo pulse in quarter notes (e.g. 1.5 for dotted quarter).')
    parser.add_argument('--bpm', type=float)
    parser.add_argument('--transpose', type=int, help='Additional semitone offset after LilyPond transposition (default 0, built-in Julia -12). Do not lower already transposed guitar pitches twice.')
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
