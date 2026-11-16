#!/usr/bin/env python3
"""Rebuild the curated public-domain library from vendored Mutopia sources.

Requires LilyPond 2.26; does not access the network. Originals are preserved.
"""
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile
from export_score import compile_score

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
]


def braced(text, start):
    """Extract these sources' balanced music blocks (including nested voices)."""
    opening = text.index('{', start)
    depth = 1
    for index in range(opening + 1, len(text)):
        if text[index] == '{': depth += 1
        elif text[index] == '}': depth -= 1
        if not depth: return text[opening + 1:index], index + 1
    raise ValueError('Unbalanced music block')


def prepare(identity, folder):
    paths = sorted(folder.rglob('*.ly'))
    for path in paths:
        # This file already uses explicit relative anchors; the obsolete
        # pre-2.4 compatibility switch blocks convert-ly unnecessarily.
        path.write_text(path.read_text().replace("#(ly:set-option 'old-relative)", ''))
        result = subprocess.run(['convert-ly', str(path)], capture_output=True, text=True, check=True)
        path.write_text(result.stdout)
    source = folder / ('concerto-in-d-minor-lys/score.ly' if identity == 'double-concerto' else paths[0].name)
    text = source.read_text()
    # Consistent page size; preserve the editions' credits and musical content.
    prefix = text[:text.index('\\book {') if identity == 'greensleeves' else text.index('\\score {')]
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


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    entries = []
    for identity, number, title, composer, instruments, credit, bpm, pulse in PIECES:
        with tempfile.TemporaryDirectory(prefix='sotto-sample-') as directory:
            folder = Path(directory)
            shutil.copytree(SOURCES / identity, folder, dirs_exist_ok=True)
            adapted = prepare(identity, folder)
            output = DEST / f'{identity}.sotto.json'
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
                      'guitarMelody': 'Guitar · melody', 'guitarBass': 'Guitar · bass', 'SoloViolinI': 'Solo violin I', 'SoloViolinII': 'Solo violin II',
                      'ViolinI': 'Orchestra · violin I', 'ViolinII': 'Orchestra · violin II', 'Continuo': 'Continuo (cello register)'}
            for voice in bundle['voices']: voice['name'] = labels.get(voice['id'], voice['name'])
            instrument = 'piano' if instruments == 'Piano' else 'violin' if 'Violin' in instruments else 'guitar'
            for voice in bundle['voices']:
                voice['instrument'] = instrument
                # Sotto currently lacks viola/cello samples: use its sustained
                # string timbre without changing the exported pitch register.
                if identity == 'double-concerto': voice['instrument'] = 'violin'
            bundle['subtitle'] = instruments + ' · Mutopia public-domain edition'
            if identity == 'double-concerto':
                bundle['description'] = 'First movement · six independent string parts; viola and continuo use violin timbre.'
            elif identity == 'lagrima':
                bundle['description'] = 'Guitar duo · synchronized section repeats and D.S. al Fine playback.'
            else: bundle['description'] = 'Public-domain Mutopia edition · prepared for Sotto'
            bundle['provenance'] = dict(source=f'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id={number}', license='Public Domain', credit=credit)
            output.write_text(json.dumps(bundle, separators=(',', ':')))
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
            entries.append(dict(id=identity, title=title, composer=composer, instruments=instruments,
                file=output.name, bytes=output.stat().st_size, source=bundle['provenance']['source'],
                license='Public Domain', credit=credit, sourceFile=f'{identity}-source.zip', description=bundle['description']))
    (DEST / 'catalog.json').write_text(json.dumps(dict(format='sotto-catalog', version=1, title='Sotto sample scores', scores=entries), ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__': main()
