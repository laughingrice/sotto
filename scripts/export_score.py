#!/usr/bin/env python3
"""Compile a trusted LilyPond score into a portable Sotto practice bundle.

Built-in example: python3 scripts/export_score.py
Other .ly file:   python3 scripts/export_score.py score.ly --title 'My piece'
MusicXML: first run musicxml2ly --output=score.ly score.musicxml, then export.
Requires LilyPond 2.26 and Python 3; no Python packages are needed.
"""
import argparse
from collections import defaultdict
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
        if start == 0 and position < 0 and label == '1':
            label = '0'  # An opening pickup precedes the first full bar.
        # Cadenza timing remains in the current measure; its actual end is
        # provided by the final score moment instead of the nominal meter.
        boundaries.setdefault(start, dict(label=label, meter=[int(numerator), int(denominator)]))
    starts = sorted(start for start in boundaries if start < final - 1e-6)
    return [dict(index=i, start=start, duration=(starts[i + 1] if i + 1 < len(starts) else final) - start,
                 **boundaries[start]) for i, start in enumerate(starts)]


def read_events(rows):
    events = []
    for row in rows.splitlines():
        beat, voice, origin, duration = row.split('\t')
        events.append(dict(beat=float(beat), voice=voice, origin=origin, duration=float(duration)))
    return events


def playback_sequence(bars, played_bars, written_events, played_events):
    """Link an unfolded LilyPond performance to printed bars by source origin.

    Pitches alone cannot distinguish identical phrases. Source locations stay
    attached to parsed notes/rests through unfolding and explicit D.S. returns.
    Long rests can anchor otherwise silent measures as well.
    """
    origins = defaultdict(list)
    for event in read_events(written_events):
        origins[(event['voice'], event['origin'])].append(event)
    sequence = []
    events = read_events(played_events)
    for played in played_bars:
        candidates = set(range(len(bars)))
        anchored = False
        for event in events:
            if event['beat'] >= played['start'] + played['duration'] - 1e-6:
                continue
            if event['beat'] < played['start'] - 1e-6 and event['beat'] + event['duration'] <= played['start'] + 1e-6:
                continue
            matches = origins.get((event['voice'], event['origin']))
            if not matches:
                # Print/MIDI tags may spell an ornament differently; map via
                # the other notes and rests in that same measure.
                continue
            starts = [match['beat'] - (event['beat'] - played['start']) for match in matches]
            possible = {bar['index'] for bar in bars if any(abs(bar['start'] - start) < 1e-5 for start in starts)
                        and abs(bar['duration'] - played['duration']) < 1e-5}
            candidates &= possible
            anchored = True
        if not anchored or len(candidates) != 1:
            raise ValueError(f"Cannot uniquely map playback bar {played['index'] + 1} to the printed score "
                             f"({len(candidates) if anchored else 0} candidates). Keep named voices and distinct "
                             "measure definitions shared by the printed and MIDI music; ambiguous navigation is not exported.")
        sequence.append(candidates.pop())
    if not sequence:
        raise ValueError('The LilyPond playback contains no measures.')
    return sequence


def voice_labels(notes):
    """Keep score order, preserve roman numerals, and distinguish parts by color."""
    colors = ['#31745e', '#657db1', '#b47734', '#8b648e', '#a45b57']
    voices = []
    for index, identity in enumerate(dict.fromkeys(note['voice'] for note in notes)):
        label = re.sub(r'(?i)(?:[ _-]?voice)$', '', identity) or identity
        label = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', label).replace('_', ' ').replace('-', ' ')
        label = label[:1].upper() + label[1:]
        voices.append(dict(id=identity, name=label, color=colors[index % len(colors)]))
        if any(note.get('percussion') for note in notes if note['voice'] == identity):
            voices[-1]['percussion'] = True
    return voices


def compile_score(source: Path, title: str, composer: str, output: Path, julia: bool,
                  beats_per_bar=None, beat_unit=None, bpm=None, transpose=None):
    beat_unit = beat_unit if beat_unit is not None else (1.5 if julia else 1)
    bpm = bpm if bpm is not None else (44 if julia else 80)
    transpose = transpose if transpose is not None else (-12 if julia else 0)
    text = source.read_text()
    if '\\layout {' not in text:
        raise ValueError('The score needs an explicit \\layout { } block to install the exporter.')
    text = text.replace('\\layout {', '\\layout {\n  \\context { \\Score \\consists #practice-timing-engraver }\n  \\context { \\Voice \\consists #practice-engraver }\n  \\context { \\DrumVoice \\consists #practice-engraver }', 1)
    text = '\\include "' + str(ROOT / 'scripts/practice-map.ily') + '"\n' + text + '\n#(practice-export-playback)\n'
    with tempfile.TemporaryDirectory(prefix='sotto-export-') as temp:
        folder = Path(temp)
        (folder / 'score.ly').write_text(text)
        compilation = subprocess.run(['lilypond', '-I', str(source.parent), '-dbackend=svg', '-dno-point-and-click', '-o', 'score', 'score.ly'],
                                     cwd=folder, check=True, capture_output=True, text=True)
        if 'programming error:' in compilation.stderr:
            raise ValueError('LilyPond reported an internal error; no partial playback will be exported.\n' + compilation.stderr)
        svg_paths = sorted(folder.glob('score*.svg'), key=lambda path: int(re.search(r'(\d+)\.svg$', path.name).group(1)) if re.search(r'(\d+)\.svg$', path.name) else 0)
        pages = [path.read_text() for path in svg_paths]
        notes = []
        for line in (folder / 'events.tsv').read_text().splitlines():
            identity, voice, beat, grace, pitch, duration, bar, percussion, tie = line.split('\t')
            is_drum = percussion == '1'
            notes.append(dict(id=identity, voice=voice or 'voice', beat=float(beat),
                              grace=float(grace), midi=round(float(pitch)) + (0 if is_drum else transpose),
                              duration=float(duration), bar=int(bar), tie=tie == '1'))
            if is_drum:
                notes[-1]['percussion'] = True
        bars = read_measures((folder / 'measures.tsv').read_text())
        played_bars = read_measures((folder / 'played-measures.tsv').read_text())
        written_events = (folder / 'written-events.tsv').read_text()
        played_events = (folder / 'played-events.tsv').read_text()
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
                + list(range(17)) + list(range(56, 61))) if julia else playback_sequence(bars, played_bars, written_events, played_events)
    bundle = dict(format='sotto-score', version=1, title=title, composer=composer,
                  subtitle='Barcarola · solo guitar' if julia else 'Practice score',
                  beatsPerBar=beats_per_bar, beatUnit=beat_unit, bpm=bpm,
                  voices=[dict(id=v, name=name, color=color) for v, name, color in
                          [('melody', 'Melody', '#31745e'), ('middle', 'Inner voice', '#b47734'), ('bass', 'Bass', '#657db1')]] if julia else
                          voice_labels(notes),
                  notes=notes, pages=pages, bars=bars, sequence=sequence,
                  description='Drop D tuning · sounds one octave below the written score' if julia else
                              f'LilyPond playback order · pitch offset {transpose:+d} semitones')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(bundle, separators=(',', ':')))
    print(f'Exported {len(notes)} noteheads, {len(pages)} pages, {measure_count} written bars, {len(sequence)} playback bars → {output}')
    return bundle


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path, help='Source .ly file; omit only to rebuild the built-in Julia Florida example.')
    parser.add_argument('--title')
    parser.add_argument('--composer')
    parser.add_argument('--beats-per-bar', type=float, help='Deprecated: measure boundaries are read from LilyPond Timing.')
    parser.add_argument('--beat-unit', type=float, help='Tempo pulse in quarter notes (e.g. 1.5 for dotted quarter).')
    parser.add_argument('--bpm', type=float)
    parser.add_argument('--transpose', type=int, help='Additional semitone offset after LilyPond transposition (default 0, built-in Julia -12). Do not lower already transposed guitar pitches twice.')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.source is None:
        if any(value is not None for value in (args.title, args.composer, args.output, args.beats_per_bar, args.beat_unit, args.bpm, args.transpose)):
            parser.error('Provide the .ly source path when exporting a custom score. Omitting the source exports Julia Florida; changing the title or output does not change the music.')
        args.source = DEFAULT_SOURCE
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
    except ValueError as exc:
        raise SystemExit(str(exc))
