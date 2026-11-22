#!/usr/bin/env python3
"""Check explicit voice lengths using LilyPond's own music tree; compile strictly.

Python stdlib + LilyPond. The input is trusted executable LilyPond code: includes
and Scheme run normally. Outputs are isolated in a temporary directory unless
--build-dir is supplied. This is structural validation, not optical pitch proof.
"""
import argparse
from fractions import Fraction
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


def load_manifest(path):
    data = json.loads(path.read_text())
    if data.get('schema_version') != 1:
        raise ValueError('manifest schema_version must be 1')
    tags = data.get('tags', ['print', 'midi'])
    if not tags or any(not re.fullmatch(r'[A-Za-z][\w-]*', x) for x in tags):
        raise ValueError('tags must be nonempty LilyPond symbols')
    measures = data.get('measures', [])
    if not measures:
        raise ValueError('manifest needs measures')
    seen = set()
    for m in measures:
        label = str(m['number'])
        if label in seen:
            raise ValueError(f'duplicate measure number {label}')
        seen.add(label)
        if not re.fullmatch(r'[A-Za-z][A-Za-z_-]*', m['variable']):
            raise ValueError(f'invalid LilyPond variable: {m["variable"]}')
        expected = Fraction(m.get('expected_duration', m.get('meter', '0')))
        if expected <= 0:
            raise ValueError(f'measure {label}: expected duration must be positive')
        if m.get('unmetered') and not m.get('exception_reason'):
            raise ValueError(f'measure {label}: explain its unmetered duration')
        if 'meter' in m and expected != Fraction(m['meter']) and not m.get('exception_reason'):
            raise ValueError(f'measure {label}: pickup/short bar needs exception_reason')
        voices = m.get('voices', {})
        if not voices or 'music' not in voices.values():
            raise ValueError(f'measure {label}: declare at least one music Voice')
        for name, role in voices.items():
            if not name or not re.fullmatch(r'[A-Za-z0-9_-]+', name):
                raise ValueError(f'measure {label}: invalid Voice name {name!r}')
            if role not in ('music', 'annotation'):
                raise ValueError(f'measure {label}: role must be music or annotation')
    return data


def quote(value):
    return json.dumps(str(value), ensure_ascii=False)


def run_validation(source, manifest, build_dir, lilypond='lilypond', timeout=120):
    data = load_manifest(manifest)
    source = source.resolve()
    build_dir.mkdir(parents=True, exist_ok=True)
    wrapper = build_dir / 'duration-audit.ly'
    helper = Path(__file__).with_name('measure_audit.ily').resolve()
    chunks = [r'\version "2.26.0"', f'\\include {quote(source)}', f'\\include {quote(helper)}']
    expected_checks = set()
    for m in data['measures']:
        duration = Fraction(m.get('expected_duration', m.get('meter')))
        ids = '(' + ' '.join(quote(v) for v in m['voices']) + ')'
        annotations = '(' + ' '.join(quote(v) for v, role in m['voices'].items() if role == 'annotation') + ')'
        for tag in data.get('tags', ['print', 'midi']):
            expected_checks.add((str(m['number']), tag))
            chunks.append(
                f'#(audit-measure {quote(m["number"])} #{{ \\{m["variable"]} #}} '
                f'{duration.numerator} {duration.denominator} \'{ids} \'{annotations} \'{tag})')
    wrapper.write_text('\n'.join(chunks) + '\n')
    executable = shutil.which(lilypond)
    if not executable:
        raise ValueError(f'LilyPond executable not found: {lilypond}')
    command = [executable, '-dno-print-pages', '-dno-point-and-click', '-o',
               str(build_dir / 'audit'), str(wrapper)]
    proc = subprocess.run(command, cwd=source.parent, capture_output=True, text=True,
                          timeout=timeout)
    log = proc.stdout + '\n' + proc.stderr
    (build_dir / 'lilypond.log').write_text(log)
    rows, errors, checks = [], [], {}
    for line in log.splitlines():
        if not line.startswith('PDF2LY\t'):
            continue
        values = line.split('\t')
        kind = values[1]
        if kind == 'VOICE' and len(values) == 7:
            rows.append(dict(measure=values[2], tag=values[3], voice=values[4],
                             actual=values[5], expected=values[6]))
        elif kind == 'ERROR':
            errors.append('\t'.join(values[2:]))
        elif kind == 'MEASURE' and len(values) == 5:
            checks[(values[2], values[3])] = values[4]
    # LilyPond can print Scheme and MIDI programming errors yet exit zero.
    diagnostics = [line.strip() for line in log.splitlines()
                   if re.search(r'\b(?:warning|error|fatal error|programming error):', line, re.I)]
    missing = expected_checks - checks.keys()
    if missing:
        errors.append(f'missing completed audit records: {sorted(missing)}')
    if proc.returncode:
        errors.append(f'LilyPond exit status {proc.returncode}')
    return dict(ok=not errors and not diagnostics and
                all(v == 'PASS' for v in checks.values()), source=str(source),
                manifest=str(manifest.resolve()), measures=len(data['measures']),
                tags=data.get('tags', ['print', 'midi']), voice_checks=rows,
                errors=errors, diagnostics=diagnostics,
                limitations=['Exact durations and explicit voices checked; musical pitch accuracy, '
                             'ties/slurs/slide endpoints and visual placement require source comparison.'])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source', type=Path)
    ap.add_argument('--manifest', required=True, type=Path)
    ap.add_argument('--report', required=True, type=Path)
    ap.add_argument('--build-dir', type=Path)
    ap.add_argument('--lilypond', default='lilypond')
    ap.add_argument('--timeout', type=int, default=120)
    args = ap.parse_args()
    try:
        if args.build_dir:
            result = run_validation(args.source, args.manifest, args.build_dir.resolve(),
                                    args.lilypond, args.timeout)
        else:
            with tempfile.TemporaryDirectory(prefix='pdf2ly-') as tmp:
                result = run_validation(args.source, args.manifest, Path(tmp),
                                        args.lilypond, args.timeout)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, ZeroDivisionError, subprocess.TimeoutExpired) as exc:
        result = dict(ok=False, errors=[str(exc)])
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(('PASS' if result['ok'] else 'FAIL') + ': ' + str(args.report))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
