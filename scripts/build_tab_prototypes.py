#!/usr/bin/env python3
"""Rebuild the original guitar/bass examples through the general tab exporter.

python3 scripts/build_tab_prototypes.py --instrument guitar --instrument bass
"""
import argparse
from pathlib import Path
from export_score import compile_score

ROOT = Path(__file__).resolve().parent.parent
PROFILES = {'guitar': 'guitar-6', 'bass': 'bass-4'}


def build(instrument, output, views=('notation', 'tabs', 'both')):
    source = ROOT / 'scores/tab-prototypes' / f'{instrument}.ly'
    output.mkdir(parents=True, exist_ok=True)
    bundle = compile_score(source, f'{instrument.title()} · four-bar tab prototype', 'Sotto', output / f'{instrument}.sotto', False,
                           tab_parts={instrument: PROFILES[instrument]}, views=list(views))
    (output / f'{instrument}.ly').write_text(source.read_text())
    return bundle


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instrument', action='append', choices=PROFILES, required=True)
    parser.add_argument('--views', default='notation,tabs,both')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/scores/prototypes')
    args = parser.parse_args()
    for instrument in dict.fromkeys(args.instrument):
        build(instrument, args.output, args.views.split(','))
