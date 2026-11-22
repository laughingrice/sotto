#!/usr/bin/env python3
"""Check saved review evidence and structured, narrowly scoped user approval.

Does not authenticate user statements, read pitches from images or prove that
musical content corresponds. Literal local LilyPond includes must be hash-listed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ASPECTS = {'pitches', 'durations', 'accidentals', 'ties', 'voices', 'slurs',
           'slides', 'fingerings', 'strings', 'barres', 'layout', 'navigation', 'midi'}
CORE = {'pitches', 'durations', 'accidentals', 'ties', 'voices'}
REQUIRED = {'original', 'lilypond', 'rendered', 'comparison', 'comparison_evidence'}


def literal_includes(text):
    """Read include directives outside comments/strings, not musical syntax."""
    i, result = 0, []
    while i < len(text):
        if text.startswith('%{', i):
            end = text.find('%}', i+2)
            if end < 0:
                raise ValueError('unterminated LilyPond block comment')
            i = end+2
        elif text[i] == '%':
            end = text.find('\n', i)
            i = len(text) if end < 0 else end+1
        elif text[i] == '"':
            i += 1
            while i < len(text):
                if text[i] == '\\':
                    i += 2
                elif text[i] == '"':
                    i += 1; break
                else:
                    i += 1
        elif text.startswith('\\include', i) and (i+8 == len(text) or not text[i+8].isalpha()):
            i += 8
            while i < len(text) and text[i].isspace():
                i += 1
            if i == len(text) or text[i] != '"':
                raise ValueError('nonliteral \\include is not supported by review hashing; use literal local includes')
            i += 1; name = []
            while i < len(text) and text[i] != '"':
                if text[i] == '\\' and i+1 < len(text) and text[i+1] in ('\\', '"'):
                    i += 1
                name.append(text[i]); i += 1
            if i == len(text):
                raise ValueError('unterminated include filename')
            result.append(''.join(name)); i += 1
        else:
            i += 1
    return result


def validate(path):
    data = json.loads(path.read_text())
    errors = []
    if data.get('schema_version') != 1:
        errors.append('schema_version must be 1')
    group = data.get('group', [])
    if not isinstance(group, list) or not group:
        errors.append('group must be a nonempty list')
        group = []
    group_ids = {str(x) for x in group}
    if len(group_ids) != len(group):
        errors.append('duplicate measures in group')
    uncertainties = data.get('uncertainties')
    if not isinstance(uncertainties, list):
        errors.append('uncertainties must be explicit, including [] when none')
        uncertainties = []
    unresolved = set()
    for u in uncertainties:
        if not isinstance(u, dict) or not all(u.get(k) for k in ('measure', 'aspect', 'question')):
            errors.append('each uncertainty needs measure, aspect and question')
            continue
        unresolved.add(str(u['measure']))
        if str(u['measure']) not in group_ids or u['aspect'] not in ASPECTS:
            errors.append('uncertainty must identify a group measure and known aspect')
    artifacts = data.get('artifacts', {})
    if not REQUIRED <= artifacts.keys():
        errors.append('artifacts must include ' + ', '.join(sorted(REQUIRED)))
    registered, refs = {}, {}
    for name, artifact in artifacts.items():
        if not isinstance(artifact, dict) or not artifact.get('path'):
            errors.append(f'{name}: artifact needs path and sha256')
            continue
        file = (path.parent / artifact['path']).resolve()
        refs[name] = file
        if not file.is_file():
            errors.append(f'{name}: missing file {file}')
        else:
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            registered[file] = digest
            if digest != artifact.get('sha256'):
                errors.append(f'{name}: hash missing or changed; re-review and refresh evidence')
    # Check local include files too; changing a dependency changes the notation
    # even when the primary .ly file remains byte-identical.
    library = data.get('system_includes', [])
    allowed_system = {x['name'] for x in library if x.get('name') and x.get('reason')}
    visited = set()

    def visit(file):
        if file in visited or not file.is_file():
            return
        visited.add(file)
        for name in literal_includes(file.read_text()):
            dependency = (file.parent / name).resolve()
            if dependency.is_file():
                if dependency not in registered:
                    errors.append(f'unhashed local include: {dependency}')
                visit(dependency)
            elif name not in allowed_system:
                errors.append(f'include not found or not explicitly documented as system library: {name}')
    if refs.get('lilypond'):
        visit(refs['lilypond'])
    # Link the saved comparison to these exact PDF/image inputs. Pixel meanings
    # and measure crop choice remain a human visual check.
    if REQUIRED <= refs.keys() and all(refs[k].is_file() for k in REQUIRED):
        ev = json.loads(refs['comparison_evidence'].read_text())
        for key, role in [('original', 'original'), ('corrected', 'rendered')]:
            if ev.get(key, {}).get('sha256') != registered[refs[role]]:
                errors.append(f'comparison evidence does not refer to current {role} PDF')
        if ev.get('uncertainties') != uncertainties:
            errors.append('comparison uncertainty list differs from current review')
        if ev.get('image_sha256') != registered[refs['comparison']]:
            errors.append('comparison evidence does not refer to current comparison image')
    measures = data.get('measures', [])
    if not measures:
        errors.append('no measure review records')
    numbers = [str(m['number']) for m in measures]
    if len(numbers) != len(set(numbers)):
        errors.append('duplicate measure review records')
    if set(numbers) != group_ids:
        errors.append('group and measure records differ')
    full, pitch = [], []
    for m in measures:
        label = str(m['number'])
        for flag in ['assistant_review_complete', 'full_measure_user_verified']:
            if type(m.get(flag)) is not bool:
                errors.append(f'{label}: {flag} must be a boolean')
        checked = set(m.get('assistant_checked', []))
        if not checked <= ASPECTS:
            errors.append(f'{label}: unknown assistant_checked aspect')
        if m.get('assistant_review_complete') and not CORE <= checked:
            errors.append(f'{label}: complete assistant review requires all five core aspects')
        verified = m.get('user_verified', [])
        full_events = []
        for event in verified:
            aspects = event.get('aspects', [])
            extent = event.get('extent')
            event_measures = event.get('measure_numbers', [])
            if not event.get('evidence') or not event.get('scope') or not re.fullmatch(
                    r'\d{4}-\d{2}-\d{2}', event.get('date', '')):
                errors.append(f'{label}: user verification needs date, exact scope and evidence')
            if not isinstance(aspects, list) or not aspects or not set(aspects) <= ASPECTS:
                errors.append(f'{label}: user verification needs a list of known aspects')
                continue
            if extent not in ('detail', 'full_measure'):
                errors.append(f'{label}: verification extent must be detail or full_measure')
            if not isinstance(event_measures, list) or label not in {str(x) for x in event_measures}:
                errors.append(f'{label}: verification explicitly applies to other/no measures')
                continue
            if 'pitches' in aspects:
                pitch.append(m['number'])
            if extent == 'full_measure':
                if not CORE <= set(aspects):
                    errors.append(f'{label}: full-measure event must cover all five core aspects')
                else:
                    full_events.append(event)
        if m.get('full_measure_user_verified'):
            if not full_events:
                errors.append(f'{label}: full approval cannot be inferred from pitch-only/detail confirmation')
            if label in unresolved:
                errors.append(f'{label}: full approval conflicts with unresolved uncertainty')
            full.append(m['number'])
    return dict(ok=not errors, errors=errors, full_measure_user_verified=full,
                pitch_user_confirmed=list(dict.fromkeys(pitch)), uncertainties=uncertainties,
                limitations=['Structured scope and artifact integrity checked; evidence statements, '
                             'musical correspondence and non-include Scheme file dependencies need human review.'])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('review', type=Path)
    ap.add_argument('--report', type=Path)
    args = ap.parse_args()
    try:
        result = validate(args.review.resolve())
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        result = dict(ok=False, errors=[str(exc)])
    rendered = json.dumps(result, indent=2) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered)
    print(rendered, end='')
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
