"""Opt-in guitar/bass renderings of parsed canonical Staff music."""
import json
import os
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

PROFILES = {
    'guitar-6': dict(tuning=[64, 59, 55, 50, 45, 40], instrument='guitar', maxFret=24),
    'bass-4': dict(tuning=[43, 38, 33, 28], instrument='bass-electric', maxFret=24),
    'bass-5': dict(tuning=[43, 38, 33, 28, 23], instrument='bass-electric', maxFret=24),
}


def assignments(values, label):
    result = {}
    for value in values or []:
        if '=' not in value:
            raise ValueError(f'{label} expects PART=value, for example guitar=guitar-6')
        part, value = value.split('=', 1)
        if not part or not value or part in result:
            raise ValueError(f'Empty or duplicate part in {label}: {part!r}')
        result[part] = value
    return result


def parse_tuning(text):
    pitches = []
    for value in text.split(','):
        match = re.fullmatch(r'([A-Ga-g])([#b]?)(-?\d+)', value.strip())
        if not match:
            raise ValueError('Tuning uses comma-separated scientific pitches, low to high, e.g. E2,A2,D3,G3,B3,E4')
        name, accidental, octave = match.groups()
        midi = (int(octave) + 1) * 12 + {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[name.upper()] + {'': 0, '#': 1, 'b': -1}[accidental]
        if not 0 <= midi <= 127:
            raise ValueError('Tuning pitch is outside MIDI range')
        pitches.append(midi)
    return list(reversed(pitches))  # Bundle/LilyPond order: string 1 first.


def tab_settings(parts, tunings=None, capos=None):
    tunings, capos = tunings or {}, capos or {}
    if (tunings.keys() | capos.keys()) - parts.keys():
        raise ValueError('Tuning/capo overrides require a matching --tab-part')
    result = {}
    for part, name in parts.items():
        name = {'guitar': 'guitar-6', 'bass': 'bass-4'}.get(name, name)
        if name not in PROFILES:
            raise ValueError(f'Unsupported tab profile {name!r}; choose guitar-6, bass-4 or bass-5')
        profile = PROFILES[name]
        tuning = parse_tuning(tunings[part]) if part in tunings else profile['tuning'][:]
        if len(tuning) != len(profile['tuning']):
            raise ValueError(f'{part}: {name} needs {len(profile["tuning"])} tuning pitches')
        try:
            capo = int(capos.get(part, 0))
        except (ValueError, TypeError):
            raise ValueError(f'{part}: capo must be an integer from 0 to 12') from None
        if not 0 <= capo <= 12 or any(pitch + capo > 127 for pitch in tuning):
            raise ValueError(f'{part}: invalid capo/tuning')
        result[part] = dict(id=part, profile=name, tuning=tuning, capo=capo, instrument=profile['instrument'], maxFret=profile['maxFret'])
    return result


def scheme(value):
    if isinstance(value, bool):
        return '#t' if value else '#f'
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return '(' + ' '.join(scheme(item) for item in value) + ')'
    return str(value)


def geometry_pages(pages, bars):
    from svg_optimize import SVG
    boundaries = [bar['start'] for bar in bars] + [bars[-1]['start'] + bars[-1]['duration']]
    result = []
    for page in pages:
        root = ET.fromstring(page)
        for element in root.iter():
            if element.get('class') == 'sotto-bar-boundary':
                beat = float(element.attrib.pop('data-boundary-beat'))
                index = next((i for i, start in enumerate(boundaries) if abs(start - beat) < 1e-5), None)
                if index is None:
                    raise ValueError(f'Cannot map barline at beat {beat} to written measures')
                element.set('data-boundary', str(index))
        ET.register_namespace('', SVG)
        result.append(ET.tostring(root, encoding='unicode'))
    return result


def compile_with_tabs(source, title, composer, output, *, parts, views=None, tunings=None, capos=None,
                      beat_unit=None, bpm=None, transpose=0, optimize_svg=True, keep_page_breaks=False, julia=False):
    from export_score import read_measures, playback_sequence, starting_tempo, voice_labels, write_bundle
    from svg_optimize import compact_page
    settings = tab_settings(parts, tunings, capos)
    views = views or ['notation', 'tabs', 'both']
    if not views or len(set(views)) != len(views) or any(view not in ('notation', 'tabs', 'both') for view in views):
        raise ValueError('--views uses unique choices from notation,tabs,both')
    text = source.read_text()
    if '\\layout {' not in text:
        raise ValueError('The score needs an explicit \\layout { } block to install the exporter.')
    layout = r'''\layout {
      \context { \Score \consists #practice-timing-engraver }
      \context { \Voice \consists #sotto-note-engraver }
      \context { \TabVoice \consists #sotto-note-engraver }
      \context { \DrumVoice \consists #sotto-note-engraver }
      \context { \Staff \consists #sotto-staff-engraver }
      \context { \TabStaff \consists #sotto-staff-engraver }
      \context { \DrumStaff \consists #sotto-staff-engraver }
    '''
    text = text.replace('\\layout {', layout, 1)
    helper = Path(__file__).resolve().parent
    canonical, renderings, sequence, canonical_bars = {}, {}, None, None
    # Always analyze notation first, including when only tab SVG is requested.
    for view in dict.fromkeys(['notation', *views]):
        config = f'''#(define sotto-view '{view})
#(define sotto-keep-page-breaks {scheme(keep_page_breaks)})
#(define sotto-tab-settings '({' '.join(f'({scheme(part)} {scheme(setting["profile"])} {scheme([p + setting["capo"] for p in setting["tuning"]])})' for part, setting in settings.items())}))
#(define sotto-pitches '({' '.join(f'({scheme(identity)} . {note["midi"]})' for identity, note in canonical.items())}))
'''
        view_text = text
        if view != 'notation' and not keep_page_breaks:
            # A fixed print page count can squeeze a full extra tab staff into
            # the original pages even after explicit page breaks are relaxed.
            view_text = re.sub(r'\bpage-count\s*=\s*\d+', '', view_text)
        wrapper = f'\\include {scheme(str(helper / "practice-map.ily"))}\n' + config + f'\\include {scheme(str(helper / "tab-export.ily"))}\n' + view_text + '\n#(sotto-export-playback)\n'
        with tempfile.TemporaryDirectory(prefix='sotto-tabs-') as temp:
            folder = Path(temp)
            (folder / 'cache').mkdir()
            (folder / 'score.ly').write_text(wrapper)
            process = subprocess.run(['lilypond', '-I', str(source.parent), '--svg', '-dno-point-and-click', '-o', 'score', 'score.ly'], cwd=folder, capture_output=True, text=True,
                env={**os.environ, 'XDG_CACHE_HOME': str(folder / 'cache')})
            # LilyPond can favor fewer pages even below its own minimum page
            # spacing. Relax that choice by limiting systems, not page count.
            # Other warnings still fail; never accept a compressed tab page.
            limit = None
            while view != 'notation' and not keep_page_breaks and 'compressing over-full page' in process.stderr and not process.returncode:
                page_counts = [len(set(re.findall(r'data-system="([^"]+)"', path.read_text()))) for path in folder.glob('score*.svg')]
                next_limit = min(max(page_counts, default=1) - 1, limit - 1 if limit else 1000)
                if next_limit < 1:
                    break
                limit = next_limit
                (folder / 'score.ly').write_text(wrapper + f'\n\\paper {{ max-systems-per-page = #{limit} }}\n')
                for path in folder.glob('score*.svg'):
                    path.unlink()
                process = subprocess.run(['lilypond', '-I', str(source.parent), '--svg', '-dno-point-and-click', '-o', 'score', 'score.ly'], cwd=folder, capture_output=True, text=True,
                    env={**os.environ, 'XDG_CACHE_HOME': str(folder / 'cache')})
            # Shared 2.24/2.26 Timing compatibility warning is not musical.
            diagnostics = process.stderr.replace("warning: the property 'timeSignatureFraction' is deprecated; use 'timeSignature'", '')
            if process.returncode or re.search(r'\b(?:warning|error|programming error):', diagnostics):
                raise ValueError('Tab export failed:\n' + process.stderr)
            bars = read_measures((folder / 'measures.tsv').read_text())
            if not bars:
                raise ValueError('No written measure timing was exported')
            if julia:
                for bar in bars:
                    if bar['index'] in (30, 31):
                        bar['label'] += ' · 1st'
                    if bar['index'] in (32, 33):
                        bar['label'] += ' · 2nd'
            current = {}
            voice_parts = {}
            for line in (folder / 'visuals.jsonl').read_text().splitlines():
                raw = json.loads(line)
                identity, part, voice = raw['id'], raw.pop('part'), raw['voice']
                if voice in voice_parts and voice_parts[voice] != part:
                    raise ValueError(f'Voice ID {voice!r} is shared by different parts; give each Voice a globally unique name')
                voice_parts[voice] = part
                tab, fret_text = raw.pop('tab'), raw.pop('fretText')
                sounding_octaves = raw.pop('soundingOctaves', 0)
                if isinstance(sounding_octaves, bool) or not isinstance(sounding_octaves, int) or not -2 <= sounding_octaves <= 2:
                    raise ValueError('Sounding octave correction must be an integer from -2 to 2')
                touch = raw.pop('touchFret', False)
                base = raw.pop('baseFret', False)
                guide = raw.pop('slideIn', 0)
                if guide not in (-1, 0, 1):
                    raise ValueError('Incoming guide slide direction must be -1, 0 or 1')
                if guide:
                    raw['slideIn'] = guide
                if touch is not False:
                    if not isinstance(touch, int) or not 0 <= touch <= 24:
                        raise ValueError('Harmonic touch fret must be an integer from 0 to 24')
                    raw['touchFret'] = touch
                if base is not False:
                    if not isinstance(base, int) or not 0 <= base <= 24 or touch is False or touch != base + 12:
                        raise ValueError('Octave artificial harmonic requires a base fret and touch fret exactly 12 frets higher')
                    raw['baseFret'], raw['harmonicKind'] = base, 'artificial'
                if part in settings and abs(raw['midi'] - round(raw['midi'])) > 1e-5:
                    raise ValueError(f'{part}: fractional pitches need explicit bend/touch-fret support; ordinary tab frets must be integers')
                raw['midi'] = round(raw['midi']) + (0 if tab or raw['percussion'] else transpose)
                if not 0 <= raw['midi'] <= 127:
                    raise ValueError('Sounding pitch is outside MIDI range')
                measure = next(bar for bar in reversed(bars) if raw['beat'] >= bar['start'] - 1e-6)
                raw['measure'], raw['bar'] = measure['index'], int(measure['label']) if measure['label'].isdigit() else measure['index'] + 1
                if not raw['percussion']:
                    raw.pop('percussion')
                if part in settings:
                    setting = settings[part]
                    string = raw['string']
                    if not isinstance(string, int) or not 1 <= string <= len(setting['tuning']):
                        raise ValueError(f'{part}, bar {measure["label"]}, voice {voice}: explicit string required for note at beat {raw["beat"]}')
                    fret = raw['midi'] - setting['tuning'][string - 1] - setting['capo']
                    if touch is not False:
                        fret = touch
                    if base is not False:
                        fret = base
                        if raw['midi'] != setting['tuning'][string - 1] + setting['capo'] + base + 12:
                            raise ValueError('Artificial harmonic sounding pitch disagrees with its stopped base and octave touch')
                    if not 0 <= fret <= setting['maxFret']:
                        raise ValueError(f'{part}, bar {measure["label"]}: pitch {raw["midi"]} cannot use string {string} (fret {fret}); check tuning/octave/capo')
                    raw['fret'] = fret
                    expected_text = f'{base}<{touch}>' if base is not False else str(fret)
                    actual_text = fret_text.strip('() ') if base is not False else fret_text.strip('() <>')
                    if guide:
                        expected_text = ('/' if guide > 0 else '\\') + expected_text
                    if tab and actual_text != expected_text:
                        raise ValueError(f'{part}: rendered fret {fret_text!r} disagrees with sounding pitch/string ({fret})')
                else:
                    raw.pop('string')
                if identity in current and current[identity] != raw:
                    raise ValueError(f'{identity}: notation and tab representations disagree')
                current[identity] = raw
            if not current:
                raise ValueError('No notes were exported')
            if canonical and current != canonical:
                identity = next(identity for identity in canonical.keys() | current.keys() if canonical.get(identity) != current.get(identity))
                before, after = canonical.get(identity, {}), current.get(identity, {})
                fields = {key: (before.get(key), after.get(key)) for key in before.keys() | after.keys() if before.get(key) != after.get(key)}
                raise ValueError(f'{view}: rendering changed notes, strings, timing or ties ({identity}: {fields})')
            if not canonical:
                # Physically impossible collisions include sustained notes on
                # a string reused by another voice. Tied same-pitch continuation
                # is legal; a chord cannot put different pitches on one string.
                for part in settings:
                    notes = [note for note in current.values() if voice_parts[note['voice']] == part]
                    active, previous = {}, {}
                    for note in sorted(notes, key=lambda note: (note['beat'], note['grace'])):
                        if note['grace']:
                            continue
                        string, midi, beat = note['string'], note['midi'], note['beat']
                        held = {pitch: end for pitch, end in active.get(string, {}).items() if end > beat + 1e-5}
                        if any(pitch != midi for pitch in held):
                            raise ValueError(f'{part}: overlapping notes reuse string {string} at beat {beat}')
                        held[midi] = max(held.get(midi, 0), beat + note['duration'])
                        active[string] = held
                        key = (note['voice'], midi)
                        prior = previous.get(key)
                        if prior and prior['tie'] and abs(prior['beat'] + prior['duration'] - beat) < 1e-5 and prior['string'] != string:
                            raise ValueError(f'{part}: tied note changes string at beat {beat}; use a slide/slur or correct the string')
                        previous[key] = note
                canonical = current
                canonical_bars = bars
            played = read_measures((folder / 'played-measures.tsv').read_text())
            navigation = playback_sequence(bars, played, (folder / 'written-events.tsv').read_text(), (folder / 'played-events.tsv').read_text())
            if julia:
                # Same source-specific D.C./coda route as the legacy export.
                navigation = list(range(32)) + list(range(20, 30)) + list(range(32, 56)) + list(range(17)) + list(range(56, 61))
            if sequence is not None and (navigation != sequence or bars != canonical_bars):
                raise ValueError('Rendering changed meter, written measures or playback navigation')
            sequence = navigation
            paths = sorted(folder.glob('score*.svg'), key=lambda path: int(re.search(r'(\d+)\.svg$', path.name).group(1)) if re.search(r'(\d+)\.svg$', path.name) else 0)
            pages = geometry_pages([path.read_text() for path in paths], bars)
            if optimize_svg:
                reserved = {element.get('id') for page in pages for element in ET.fromstring(page).iter() if element.get('id')}
                pages = [compact_page(page, f'{view}-{i}-', reserved, True) for i, page in enumerate(pages)]
            renderings[view] = dict(pages=pages)
            header = json.loads((folder / 'header.json').read_text())
            tempos = [json.loads(line) for line in (folder / 'tempos.jsonl').read_text().splitlines()]
        print(f'{view}: {len(current)} unique notes, {len(pages)} pages, {len(sequence)} playback bars')
    unit, rate = starting_tempo(tempos, bars[0]['meter'], False, beat_unit, bpm, header.get('midiQuarterBpm'))
    notes = sorted(canonical.values(), key=lambda note: (note['beat'], note['grace'], note['id']))
    voices = voice_labels(notes)
    part_records = []
    for part, setting in settings.items():
        ids = list(dict.fromkeys(note['voice'] for note in notes if voice_parts[note['voice']] == part))
        if not ids:
            raise ValueError(f'{part}: selected part contains no pitched notes')
        part_records.append({key: setting[key] for key in ('id', 'profile', 'tuning', 'capo')} | dict(voices=ids))
        for voice in voices:
            if voice['id'] in ids:
                voice['instrument'] = setting['instrument']
    name = (header.get('title') or '').strip() or source.stem
    if (header.get('subtitle') or '').strip():
        name += ' -- ' + header['subtitle'].strip()
    bundle = dict(format='sotto-score', version=1, title=title if title is not None else name,
        composer=composer if composer is not None else header.get('composer', ''), subtitle=header.get('subtitle', ''),
        bpm=rate, beatUnit=unit, beatsPerBar=bars[0]['meter'][0] * 4 / bars[0]['meter'][1],
        voices=voices, parts=part_records, notes=notes, bars=bars, sequence=sequence,
        pages=renderings['notation']['pages'], renderings={view: renderings[view] for view in views},
        description='Guitar/bass tablature · shared performance · ' + ('source page breaks' if keep_page_breaks else 'natural pagination'))
    output.parent.mkdir(parents=True, exist_ok=True)
    write_bundle(output, bundle)
    return bundle
