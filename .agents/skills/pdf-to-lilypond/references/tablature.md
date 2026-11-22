# Guitar and bass tablature for Sotto

Use this reference when a source contains guitar/bass tabs or the user explicitly requests tab output. Violin fingering/tab conventions are not supported. Work from one canonical music transcription; do not enter a second independently editable copy for the tablature.

## Read the physical instrument first

Record the part, string count, actual open-string pitches, capo and octave convention before interpreting fret numbers. String 1 is the top tab line, normally the highest-pitched string in these profiles. A printed fret is relative to the capo when a capo is used. Do not infer tuning solely from a guitar/bass playback sound or assume every six-string score is standard tuning.

When the source supplies tabs, preserve its string choice on **each chord tone and each note**, including tied continuations and grace notes. Use native string post-events (`e,4\6`, `<e\4 g\3 b\2>2`). Left-hand finger numbers (`-1` etc.) are not string numbers. For ordinary fretted notes, verify:

` sounding MIDI pitch = open-string MIDI pitch + capo + fret `

Check the source's written-to-sounding transposition before applying this equation. Prefer sounding-pitch music with `treble_8` for guitar or `bass_8` for bass; preserve an existing correct transposition scheme rather than lowering it again. Export supports native `\transposition` and the existing explicit `--transpose` correction. A capo flag records the physical setup; it does not transpose the source automatically.

If staff notation and tab disagree, retain both readings in the error/review record with measure, voice, string/fret and candidate pitch. Resolve from evidence or user clarification; do not silently alter a fret to make the two agree. If the tab has no rhythm, use aligned staff notation where available and identify any unresolved durations. Do not invent missing rhythms or fingering.

If only notation is present, pitch alone does not determine a string. The exporter deliberately requires explicit strings for selected tab parts. Obtain/review a fingering arrangement as a separate task; do not silently accept LilyPond's automatic string selection as source evidence.

## Canonical LilyPond structure

Give every physical part a named `Staff`, and its musical layers globally unique named `Voice` IDs. Several voices can share one guitar/bass part. Keep the existing per-measure variables and duration manifests; generated `TabVoice` copies are displays, not extra musical voices in the manifest.

This runnable two-measure example shows the naming and pitch/string convention:

```lilypond
\version "2.26.0"
\header { title = "Exercise" composer = "Composer" }
\paper { #(set-paper-size "letter") }
mOne = { \new Voice = "guitarLead" { e,4\6 g,4\6 a,4\5 b,4\5 } }
mTwo = { \context Voice = "guitarLead" { <e\4 g\3 b\2>1 } }
\score {
  \new Staff = "guitar" { \clef "treble_8" \time 4/4 \mOne | \mTwo | }
  \layout { }
}
```

The canonical score contains conventional `Staff` music, not a manually duplicated `TabStaff` or conditional view code. No manually assigned SVG/event tags are required. The exporter assigns event identities before making the visual copies. Includes, named variables, print/MIDI tags and explicit playback navigation remain in the canonical music. Keep a single MIDI/performance part per instrument; adding a visual tab staff must never add an audible instrument.

## Opt-in export (from the Sotto project root)

```sh
# Standard six-string guitar; export Notes, Tabs and Both.
python3 scripts/export_score.py scores/piece/piece.ly --tab-part guitar=guitar-6

# Four-string bass. Drums/other unselected staves retain normal notation.
python3 scripts/export_score.py scores/piece/piece.ly --tab-part bass=bass-4

# Select more than one physical part; bass-5 is also supported.
python3 scripts/export_score.py scores/piece/piece.ly \
  --tab-part guitar=guitar-6 --tab-part bass=bass-5

# Drop D: CLI tuning is LOW TO HIGH; bundle string order is the reverse.
python3 scripts/export_score.py scores/piece/piece.ly \
  --tab-part guitar=guitar-6 --tab-tuning guitar=D2,A2,D3,G3,B3,E4

# Source pitches must already include the sounding effect of capo 2.
python3 scripts/export_score.py scores/piece/piece.ly \
  --tab-part guitar=guitar-6 --tab-capo guitar=2 --views notation,tabs,both
```

`guitar`/`bass` on the left of `=` must match the canonical Staff ID exactly; the profile is independent of the part's label and playback sound. The current profiles support up to fret 24. Overrides for tuning/capo must name a selected part. Sources without tab flags retain the established notation-only export workflow.

Tab export allows natural pagination by default, relaxing forced page turns while retaining explicit system breaks. Avoid copying page counts or forced page breaks merely to imitate the PDF. Use `--keep-page-breaks` only for deliberately retained source page turns. Let each view have its own spacing/page layout; synchronization is by musical events and measures, never page number or pixel position.

## Validation and handoff

Apply the skill's four existing review gates to the canonical music. Additionally:

- Compare source and generated string/fret for each four-measure review group, including chord-tone association, open strings, tied continuations, grace endpoints and rests. A mathematically consistent generated tab is not proof it matches the source.
- Export the requested views. The exporter rejects missing strings, impossible frets, conflicting overlaps on a string, unknown parts/profiles, and disagreement between visual copies. It compares written timing, repeats and all event data between views; warnings/errors must be resolved rather than bypassed.
- Inspect Notes, Tabs and Both against the source. Check rhythm stems/beams, ties, slides, hammer-ons/pull-offs, bends, harmonics, muting and labels. Retain native notation; do not remove a source technique merely to pass validation. Complex harmonics/bends may need further support because a touch/base fret and the sounding pitch can differ: report that limitation rather than applying the ordinary-fret equation blindly.
- Verify sounding octave, single playback stream, click/tap seeking and retained microphone feedback across view switches. Review a loop and silent measures too. A matching microphone pitch does not prove the requested string/fret was used.
- Preserve the source fret/string evidence and any unresolved conflict in the scoped review record. Keep source PDF, canonical `.ly`, requested PDF/MIDI, `.sotto` bundle and comparison artifacts together. Include the exact exporter command with instrument/tuning/capo options in the handoff.

Slide relationships remain engraved but are not realized as continuous slide audio. Do not claim slide playback, bend trajectories, harmonic-touch verification or fingering detection from this export. Existing source-specific print/MIDI differences still need independent review.
