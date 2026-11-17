# Public sample editions

These ten editions were downloaded from the Mutopia Project on 2026-11-16. Eight are designated **Public Domain** by Mutopia and their typesetters. Stewart Holmes’s solo Adelita edition is **CC BY-SA 2.5** and his Recuerdos de la Alhambra edition is **CC BY-SA 3.0**. Their adapted editions and Sotto bundles retain those licenses, with original notices, attribution, license links and modification notices. This directory preserves the downloaded LilyPond files unchanged. The original headers retain the edition source and credits. Mutopia’s explanation of its public-domain dedications and other licenses: https://www.mutopiaproject.org/legal.html.

| Edition | Mutopia ID | Contributor |
| --- | --- | --- |
| Carcassi, Étude Op. 60 No. 1 | [13](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=13) | Jeff Covey |
| Bach, Invention No. 2, BWV 773 | [58](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=58) | Allen Garvin |
| Bach, Invention No. 8, BWV 779 | [61](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=61) | Allen Garvin |
| Bach, Double Violin Concerto, BWV 1043 | [3](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=3) | David Chan |
| Joplin, The Entertainer | [263](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263) | Chris Sawer; revision by Simon Albrecht |
| Tárrega, Lágrima, arranged for two guitars | [2103](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2103) | Jeffrey Olson |
| Tárrega, Adelita (solo guitar) | [808](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=808) | Stewart Holmes · [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) |
| Beethoven, Claro de Luna (Moonlight Sonata), arranged by Tárrega | [2074](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2074) | Jeffrey Olson · Public Domain |
| Tárrega, Recuerdos de la Alhambra (solo guitar) | [810](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=810) | Stewart Holmes · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| Anonymous, Greensleeves to a Ground with Division | [1730](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1730) | Allen Garvin |

## Rebuild and adaptations

Run `python3 scripts/build_samples.py` from the repository root with LilyPond 2.26, `convert-ly` and Python 3 installed. It makes temporary working copies, updates syntax, and exports the public bundles and catalog under `public/scores/samples/`. The generated source archives include both adapted and original files. No network access is needed to rebuild.

Adaptations are implemented in the build script:

- Use named practice parts and current LilyPond syntax. Preserve original contributor credits in the notation. Tempo settings are practice defaults, not editorial tempo claims.
- Carcassi: combine print and playback definitions, name melody/bass voices and apply the source’s guitar transposition to sounding pitches.
- Inventions: name the right and left hand. In No. 8, remove the obsolete `old-relative` compatibility option; initial sounding pitches were compared with Mutopia’s original MIDI.
- Double Concerto: include the complete first movement (Vivace), with six independent string parts. Sotto currently uses violin samples for viola and continuo as well, at their exported pitches; this timbre limitation is disclosed in the catalog.
- The Entertainer: use a shared printed/playback score with unfolded performance repeats; group temporary nested notation voices into the appropriate piano hand.
- Lágrima: synchronize the two repeated sections in both guitar parts and encode the printed D.S. al Fine return (A A B B A). Keep two practice parts, including their nested notation voices. This is the credited duo arrangement, not a solo-guitar edition.
- Adelita: retain three independently controllable guitar voices and the original engraving credits; encode the printed section repeats and D.C. al Fine (A A B B A). Let current LilyPond choose line breaks to keep appoggiaturas with their main notes. Preserve the CC BY-SA 2.5 edition license.
- Claro de Luna: identify Beethoven as composer and Tárrega as arranger; retain its three guitar voices, drop-D sounding pitches and barre markings. Repair the old capo music-function signature and numeric call syntax for modern LilyPond. This is the Moonlight Sonata’s first movement arranged for guitar.
- Recuerdos: retain the full written tremolo, bass and inner voices; turn the initial printed repeat barline into a structured repeat and encode the D.C. al Coda return. Remove obsolete beaming-only beatLength settings before syntax conversion so they cannot change inherited tremolo durations. Preserve CC BY-SA 3.0 and the original 2009 edition notice.
- Greensleeves: include the complete violin variations. The original separately printed eight-bar ground is not attached as a full-length accompaniment. Its pulse is a half note.

Except for the two ShareAlike editions above, Sotto-specific music adaptations and catalog metadata in this collection are dedicated under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Adelita and Recuerdos adaptations instead remain under their respective CC BY-SA licenses. This CC0 statement applies only to our other additions; original edition designations and credits are preserved separately. It does not relicense unrelated scores elsewhere in this repository.

The bundles retain score notes and source-defined rhythms rather than synthesized trill/ornament realizations or expressive tempo maps. Compiler timing/export checks and playback inspection do not replace editorial proofreading against historical sources.
