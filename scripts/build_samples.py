#!/usr/bin/env python3
"""Rebuild the curated openly licensed library from vendored Mutopia sources.

Requires LilyPond 2.26; does not access the network. Originals are preserved.
"""
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile
from export_score import compile_score, write_bundle

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / 'scores/samples'
DEST = ROOT / 'public/scores/samples'
PIECES = [
    ('carcassi', 13, 'Étude Op. 60 No. 1', 'Matteo Carcassi', 'Guitar', 'Jeff Covey', 100, 1),
    ('invention-2', 58, 'Invention No. 2 · BWV 773', 'Johann Sebastian Bach', 'Piano', 'Allen Garvin', 80, 1),
    ('invention-8', 61, 'Invention No. 8 · BWV 779', 'Johann Sebastian Bach', 'Piano', 'Allen Garvin', 90, 1),
    ('double-concerto', 3, 'Double Violin Concerto · I. Vivace', 'Johann Sebastian Bach', 'Violins & strings', 'David Chan', 100, 1),
    ('entertainer', 263, 'The Entertainer', 'Scott Joplin', 'Piano', 'Chris Sawer; revised by Simon Albrecht', 72, 1),
    ('lagrima', 2103, 'Lágrima · guitar duo', 'Francisco Tárrega', 'Two guitars', 'Jeffrey Olson (arranger and typesetter)', 60, 1),
    ('greensleeves', 1730, 'Greensleeves to a Ground with Division', 'Anonymous', 'Violin', 'Allen Garvin', 80, 2),
    ('adelita', 808, 'Adelita · solo guitar', 'Francisco Tárrega', 'Guitar', 'Stewart Holmes', 70, 1),
    ('claro-de-luna', 2074, 'Claro de Luna · Moonlight Sonata', 'Ludwig van Beethoven · arranged by Francisco Tárrega', 'Guitar', 'Jeffrey Olson', 60, 1),
    ('recuerdos', 810, 'Recuerdos de la Alhambra', 'Francisco Tárrega', 'Guitar', 'Stewart Holmes', 74, 1),
]
LICENSES = {
    'adelita': ('CC BY-SA 2.5', 'https://creativecommons.org/licenses/by-sa/2.5/', 'Copyright © 2006'),
    'recuerdos': ('CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', 'Copyright © 2009'),
}


def braced(text, start):
    """Extract these sources' balanced music blocks (including nested voices)."""
    opening = text.index('{', start)
    depth = 1
    for index in range(opening + 1, len(text)):
        if text[index] == '{': depth += 1
        elif text[index] == '}': depth -= 1
        if not depth: return text[opening + 1:index], index + 1
    raise ValueError('Unbalanced music block')


def split_bars(body, count):
    """Split at a bar check, skipping quoted bar styles and comments."""
    quoted = comment = escaped = False
    for index, char in enumerate(body):
        if comment:
            if char == '\n': comment = False
        elif quoted:
            if char == '"' and not escaped: quoted = False
            escaped = char == '\\' and not escaped
        elif char == '%': comment = True
        elif char == '"': quoted = True
        elif char == '|':
            count -= 1
            if count == 0: return body[:index + 1], body[index + 1:]
    raise ValueError('Not enough bar checks')


def tagged_parts(prefix, variable, sections):
    start = re.search(r'\b' + variable + r'\s*=', prefix).start()
    opening = prefix.index('{', start)
    _, end = braced(prefix, start)
    tagged = '\n'.join("\\tag #'" + tag + ' { ' + music + '\n}' for tag, music in sections)
    return prefix[:opening + 1] + '\n' + tagged + '\n}' + prefix[end:]


def prepare(identity, folder):
    paths = sorted(folder.rglob('*.ly'))
    for path in paths:
        # This file already uses explicit relative anchors; the obsolete
        # pre-2.4 compatibility switch blocks convert-ly unnecessarily.
        original = path.read_text().replace("#(ly:set-option 'old-relative)", '')
        if identity == 'claro-de-luna':
            original = original.replace('(barre location str music)', '(parser location str music)')
            original = original.replace('% had to include RestEvent for this piece', '; had to include RestEvent for this piece')
            original = re.sub(r'\\capo(\d+)', lambda match: '\\capo #' + match[1] + ' ', original)
        if identity == 'recuerdos':
            # Obsolete beaming-only settings become \musicLength expressions
            # in convert-ly, which would change the following inherited note
            # duration from 32nds to quarters. Remove these obsolete settings
            # before conversion; the written tremolo durations stay untouched.
            original = re.sub(r'\\set Score\.beatLength\s*=\s*#\(ly:make-moment 1 (?:4|16)\)', '', original)
        path.write_text(original)
        result = subprocess.run(['convert-ly', str(path)], capture_output=True, text=True, check=True)
        path.write_text(result.stdout)
    source = folder / 'concerto-in-d-minor-lys/score.ly' if identity == 'double-concerto' else paths[0]
    text = source.read_text()
    # Consistent page size; preserve the editions' credits and musical content.
    if identity in ('adelita', 'recuerdos'):
        prefix = text[:text.index('thescore =')]
    else:
        prefix = text[:re.search(r'\\book\s*\{' if identity == 'greensleeves' else r'\\score\s*\{', text).start()]
    if identity == 'carcassi':
        score = r'''\score {
  \new Staff = "guitar" << \transposition c \global
    \new Voice = "guitarMelody" { \voiceOne \melody }
    \new Voice = "guitarBass" { \voiceTwo \bass }
  >>
  \layout { } \midi { }
}'''
    elif identity.startswith('invention'):
        score = r'''\score { \new PianoStaff <<
  \new Staff = "right" \new Voice = "pianoRight" \voiceone
  \new Staff = "left" \new Voice = "pianoLeft" \voicetwo
>> \layout { } \midi { } }'''
    elif identity == 'entertainer':
        score = r'''\score { \new PianoStaff <<
  \new Staff = "up" \new Voice = "pianoRight" \top
  \new Dynamics \dyn
  \new Staff = "down" \new Voice = "pianoLeft" \bottom
>> \layout { } \midi { } }'''
    elif identity == 'double-concerto':
        # One movement per bundle: do not concatenate unrelated timing streams.
        body, _ = braced(text, text.index('\\score {'))
        score = '\\score {' + body + '}'
        score = score.replace('\\layout {}', '\\layout { }')
        labels = {'SoloViolinI': 'Solo violin I', 'SoloViolinII': 'Solo violin II', 'ViolinI': 'Violin I', 'ViolinII': 'Violin II', 'Viola': 'Viola', 'Continuo': 'Continuo'}
        score = re.sub(r'\\context Voice = (\w+) \{', lambda match:
            f'\\new Staff = "{match[1]}Staff" \\with {{ instrumentName = "{labels[match[1]]}" shortInstrumentName = "{labels[match[1]]}" }} \\new Voice = "{match[1]}" {{', score)
    elif identity == 'greensleeves':
        # The second original score prints an eight-bar ground separately, not
        # an accompaniment spanning the variations. Keep the complete violin part.
        score = r'''\score {
  \new Staff = "violin" \new Voice = "violin" \violin
  \layout { } \midi { }
}'''
    elif identity == 'claro-de-luna':
        score = r'''\score { \new Staff = "guitar" <<
  \transposition c \clef treble \time 4/4 \key d \minor
  \mergeDifferentlyHeadedOn \mergeDifferentlyDottedOn
  \new Voice = "guitarArpeggio" \upperVoice
  \new Voice = "guitarBass" \lowerVoice
  \new Voice = "guitarInner" \middleVoice
>> \layout { } \midi { } }'''
    elif identity == 'adelita':
        # Old forced breaks in several simultaneous voices can strand the
        # appoggiatura on a system of its own in current LilyPond.
        prefix = prefix.replace('\\pageBreak', '').replace('\\break', '')
        for variable in ['top', 'bass', 'middle']:
            body, _ = braced(prefix, re.search(r'\b' + variable + r'\s*=', prefix).start())
            a, b = split_bars(body, 8)
            a, b = [re.sub(r'\\bar\s*"[^"]*"', '', part) for part in [a, b]]
            prefix = tagged_parts(prefix, variable, [('A', a), ('B', b)])
        def part(variable, suffix=''):
            return "\\repeat volta 2 { \\keepWithTag #'A \\" + variable + " } \\repeat volta 2 { \\keepWithTag #'B \\" + variable + ' } ' + suffix
        def music(returning=False):
            voices = '\n'.join('\\new Voice = "' + name + '" { ' + direction + ' ' + part(variable, "\\keepWithTag #'A \\" + variable if returning else '') + ' }' for name, direction, variable in [
                ('guitarMelody', '\\voiceOne', 'top'), ('guitarBass', '\\voiceTwo', 'bass'), ('guitarInner', '\\voiceFour', 'middle')])
            return '\\new Staff = "guitar" { \\clef "treble_8" \\time 3/4 \\key e \\minor << ' + voices + ('' if returning else '\\new Voice = "markings" { \\voiceThree << \\dynamics \\\\ \\barring >> }') + ' >> }'
        score = '\\score {' + music() + '\\layout { } }\n\\score {' + music(True) + '\\midi { } }'
    elif identity == 'recuerdos':
        for variable in ['top', 'pedal', 'bottom']:
            body, _ = braced(prefix, re.search(r'\b' + variable + r'\s*=', prefix).start())
            repeat_at = body.index('\\repeat volta 2')
            intro = re.sub(r'\\bar\s*"[^"]*"', '', body[:repeat_at]).replace('\\key a \\major', '')
            repeated, end = braced(body, repeat_at)
            endings, end = braced(body, body.index('\\alternative', end))
            first, first_end = braced(endings, 0)
            second, _ = braced(endings, first_end)
            prefix = tagged_parts(prefix, variable, [('A', intro), ('B', '\\key a \\major ' + repeated), ('first', first), ('second', second), ('coda', body[end:])])
        def part(variable, returning=False):
            get = lambda tag: "\\keepWithTag #'" + tag + ' \\' + variable + ' '
            first_run = '\\repeat volta 2 { ' + get('A') + '} \\repeat volta 2 { ' + get('B') + '} \\alternative { {' + get('first') + '} {' + get('second') + '} } '
            return first_run + (get('A') + get('B') if returning else '') + get('coda')
        def music(returning=False):
            voices = '\n'.join('\\new Voice = "' + name + '" { ' + direction + ' ' + part(variable, returning) + ' }' for name, direction, variable in [
                ('guitarTremolo', '\\voiceOne', 'top'), ('guitarBass', '\\voiceTwo', 'pedal'), ('guitarInner', '\\voiceFour', 'bottom')])
            return '\\new Staff = "guitar" { \\clef "treble_8" \\time 3/4 \\key c \\major << ' + voices + ('' if returning else '\\new Voice = "markings" { \\voiceThree << \\dynamics \\\\ \\fingering \\\\ \\barring >> }') + ' >> }'
        score = '\\score {' + music() + '\\layout { } }\n\\score {' + music(True) + '\\midi { } }'
    elif identity == 'lagrima':
        # The source repeats only Guitar II; explicitly synchronize both parts
        # and encode its printed D.S. al Fine return for playback.
        upper_start = prefix.index('upperVoice =')
        upper, _ = braced(prefix, upper_start)
        upper_a, upper_b = upper.split('\\key e \\minor', 1)
        lower_start = prefix.index('lowerVoice =')
        lower, _ = braced(prefix, lower_start)
        lower_a, end = braced(lower, lower.index('\\repeat volta 2'))
        lower_b, _ = braced(lower, lower.index('\\repeat volta 2', end))
        prefix += '\nupperA = \\transpose c c\' {' + upper_a + '}\nupperB = \\transpose c c\' { \\key e \\minor ' + upper_b + '}\n'
        prefix += '\nlowerA = \\transpose c c\' { \\key e \\major ' + lower_a + '}\nlowerB = \\transpose c c\' { \\key e \\minor ' + lower_b + '}\n'
        music = r'''\new StaffGroup <<
  \new Staff = "guitarI" \with { instrumentName = "Guitar I" } {
    \transposition c \time 3/4
    \new Voice = "guitarI" { \repeat volta 2 \upperA \repeat volta 2 \upperB SUFFIXUP }
  }
  \new Staff = "guitarII" \with { instrumentName = "Guitar II" } {
    \transposition c \time 3/4
    \new Voice = "guitarII" { \repeat volta 2 \lowerA \repeat volta 2 \lowerB SUFFIXLOW }
  }
>>'''
        score = '\\score {' + music.replace('SUFFIXUP', '').replace('SUFFIXLOW', '') + '\\layout { } }\n'
        score += '\\score {' + music.replace('SUFFIXUP', '\\upperA').replace('SUFFIXLOW', '\\lowerA') + '\\midi { } }'
    else: raise ValueError(identity)
    source.write_text(prefix + '\n\\paper { #(set-paper-size "a4") }\n' + score + '\n')
    return source


def main(identities=None):
    DEST.mkdir(parents=True, exist_ok=True)
    entries = {entry['id']: entry for entry in json.loads((DEST / 'catalog.json').read_text())['scores']} if identities else {}
    for identity, number, title, composer, instruments, credit, bpm, pulse in PIECES:
        if identities and identity not in identities: continue
        with tempfile.TemporaryDirectory(prefix='sotto-sample-') as directory:
            folder = Path(directory)
            shutil.copytree(SOURCES / identity, folder, dirs_exist_ok=True)
            adapted = prepare(identity, folder)
            output = DEST / f'{identity}.sotto'
            bundle = compile_score(adapted, title, composer, output, False, beat_unit=pulse, bpm=bpm)
            groups = {'up:1': 'pianoRight', 'up:2': 'pianoRight', 'down:1': 'pianoLeft', 'down:2': 'pianoLeft'} if identity == 'entertainer' else {
                'guitarI:1': 'guitarI', 'guitarI:2': 'guitarI', 'guitarII:1': 'guitarII', 'guitarII:2': 'guitarII'} if identity == 'lagrima' else {}
            for note in bundle['notes']: note['voice'] = groups.get(note['voice'], note['voice'])
            for old, new in groups.items(): bundle['pages'] = [page.replace(f'data-voice="{old}"', f'data-voice="{new}"') for page in bundle['pages']]
            bundle['voices'] = [voice for voice in bundle['voices'] if voice['id'] not in groups]
            if identity == 'double-concerto':
                order = ['SoloViolinI', 'SoloViolinII', 'ViolinI', 'ViolinII', 'Viola', 'Continuo']
                bundle['voices'].sort(key=lambda voice: order.index(voice['id']))
            for index, voice in enumerate(bundle['voices']): voice['color'] = ['#31745e', '#657db1', '#b47734', '#8b648e', '#a45b57', '#447e91'][index % 6]
            labels = {'guitarI': 'Guitar I', 'guitarII': 'Guitar II', 'pianoRight': 'Piano · right hand', 'pianoLeft': 'Piano · left hand',
                      'guitarMelody': 'Guitar · melody', 'guitarBass': 'Guitar · bass', 'guitarInner': 'Guitar · inner voice', 'guitarArpeggio': 'Guitar · arpeggios', 'guitarTremolo': 'Guitar · tremolo', 'SoloViolinI': 'Solo violin I', 'SoloViolinII': 'Solo violin II',
                      'ViolinI': 'Orchestra · violin I', 'ViolinII': 'Orchestra · violin II', 'Continuo': 'Continuo (cello register)'}
            for voice in bundle['voices']: voice['name'] = labels.get(voice['id'], voice['name'])
            instrument = 'piano' if instruments == 'Piano' else 'violin' if 'Violin' in instruments else 'guitar'
            for voice in bundle['voices']:
                voice['instrument'] = instrument
                # Sotto currently lacks viola/cello samples: use its sustained
                # string timbre without changing the exported pitch register.
                if identity == 'double-concerto': voice['instrument'] = 'violin'
            license_name, license_url, copyright_notice = LICENSES.get(identity, ('Public Domain', 'https://www.mutopiaproject.org/legal.html', 'Public-domain edition'))
            changes = 'LilyPond syntax updated; named practice voices, sounding pitches and playback order prepared for Sotto.'
            bundle['subtitle'] = instruments + ' · Mutopia · ' + license_name
            if identity == 'double-concerto':
                bundle['description'] = 'First movement · six independent string parts; viola and continuo use violin timbre.'
            elif identity == 'lagrima':
                bundle['description'] = 'Guitar duo · synchronized section repeats and D.S. al Fine playback.'
            elif identity == 'claro-de-luna': bundle['description'] = 'Beethoven’s Moonlight Sonata, first movement · Tárrega’s solo-guitar arrangement · drop D tuning.'
            elif identity == 'adelita': bundle['description'] = 'Solo guitar · section repeats and D.C. al Fine playback (A A B B A).'
            elif identity == 'recuerdos': bundle['description'] = 'Solo guitar tremolo · repeats, alternate endings and D.C. al Coda playback.'
            else: bundle['description'] = 'Mutopia edition · prepared for Sotto'
            bundle['provenance'] = dict(source=f'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id={number}', license=license_name, licenseUrl=license_url, credit=credit, copyright=copyright_notice, changes=changes)
            write_bundle(output, bundle)
            # Ship adapted, rebuildable source with includes plus unchanged
            # originals so provenance does not depend on GitHub UI or hotlinks.
            with zipfile.ZipFile(DEST / f'{identity}-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
                def include(name, content):
                    info = zipfile.ZipInfo(str(name), date_time=(2026, 11, 16, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, content)
                for path in sorted(folder.rglob('*.ly')): include(f'adapted/{path.relative_to(folder)}', path.read_bytes())
                for path in sorted((SOURCES / identity).rglob('*.ly')): include(f'original/{path.relative_to(SOURCES / identity)}', path.read_bytes())
                include('README.md', (SOURCES / 'README.md').read_bytes())
                include('LICENSE.txt', f'{title}\n{composer}\n{copyright_notice}\nEdition/typesetting: {credit}\nSource: {bundle["provenance"]["source"]}\nLicense: {license_name}\n{license_url}\n\nSotto adaptation: {changes}\n' + (f'This adapted edition and its Sotto bundle are distributed under {license_name}.\n' if identity in LICENSES else 'Sotto-specific additions are dedicated under CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/\n'))
            entries[identity] = dict(id=identity, title=title, composer=composer, instruments=instruments,
                file=output.name, bytes=output.stat().st_size, source=bundle['provenance']['source'],
                license=license_name, licenseUrl=license_url, credit=credit, sourceFile=f'{identity}-source.zip', description=bundle['description'] + ' ' + changes)
    (DEST / 'catalog.json').write_text(json.dumps(dict(format='sotto-catalog', version=1, title='Sotto sample scores', scores=[entries[piece[0]] for piece in PIECES if piece[0] in entries]), ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pieces', nargs='*', choices=[piece[0] for piece in PIECES])
    main(parser.parse_args().pieces or None)
