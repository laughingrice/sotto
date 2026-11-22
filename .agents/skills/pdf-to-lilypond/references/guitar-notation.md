# Guitar notation decisions

## Written pitch and playback

Determine whether definitions contain conventional written guitar pitches or sounding pitches. Do not transpose twice. The Capricho example enters written pitches, then uses `\transpose c c,` at the staff boundary with `\clef "treble_8"`, yielding the same visible written staff positions and MIDI one octave lower. Another consistent approach is valid; document it. Dropping string 6 to D does not transpose every note and does not by itself retune MIDI or tablature. If creating TAB, set its tuning independently and verify open strings.

Use `midiInstrument = "acoustic guitar (nylon)"` for the current classical guitar preference. Standard MIDI does not synthesize a continuous slide from a `\glissando`; endpoint note events alone are not proof of an audible pitch bend. Realize repeat/alternative/D.S./coda playback explicitly when print navigation is not unfolded automatically.

Preserve the current project header preference (copied in the example):

```lilypond
meter = \markup {
  \general-align #Y #CENTER {
    \circle \fontsize #-2 "6"
    \hspace #0.2
    \tiny "= D"
  }
}
```

This is a compact tuning indication, not the musical time signature. Preserve the surrounding header/layout and the user's paper choice. Do not replace it with an unsolicited tuning subtitle.

## Slides and grace endpoints

- Use a real `\glissando` from the source note to the intended landing pitch. Keep it in that musical voice. Where landing on a chord, verify `glissandoMap` source/target indices against the visible result; map the intended chord tone, not just the first.
- A leading `\acciaccatura` can migrate to the following bar or imply a release gesture. For a small endpoint belonging to the preceding note/bar, use `\afterGrace` and inspect the barline. Add a slashed flag explicitly when the source has one; do not add an automatic slur unless present.
- In Capricho 7, the final **written E3 slides UP to small Bb3 inside 7**; 8 rearticulates Bb3, then A3. The user corrected their earlier “D” suggestion. Do not resurrect the withdrawn reading.
- An after-grace on a very short note produced a real MIDI timing/programming error in this work. If it recurs, keep the correct print notation and use a separate tagged, short measured MIDI realization with the same total bar duration. Verify both tag alternatives. Do not alter print duration to conceal a MIDI bug.

## Voices, harmonics and performance marks

- Held bass notes and moving treble notes have independent durations, even on one staff. Reallocate a note between explicit voices when necessary to preserve a slur's actual endpoints; document why. Check resulting unisons/stems and playback.
- Decide whether harmonic diamonds show touch positions, sounding pitches or an edition-specific convention before assigning playback. String/fret labels are useful evidence, not permission to raise all harmonics by an octave.
- Left-hand fingerings use `-0`…`-4`; strings use native `\1`…`\6`; right-hand `p i m a` use `\rightHandFinger` numbers 1…4. Use explicit post-event direction when needed. Inspect chord-tone association, not just whether a number exists somewhere nearby.
- Give barré fractions their literal source meaning (strings covered) and retain Roman-numeral fret position. Use independent annotation voices for concurrent brackets/string lines/accel./rit. labels, with full-measure skips and correct event times.
- Restore dashed slurs with the right endpoints, independent of barré spans. Distinguish a guitar slide line from a tenuto/accent. Preserve source beam counts in small ornaments: a two-beam grace pair is sixteenths, not thirty-seconds merely because it looks small.

## Incoming slides, unisons and rests

- A short incoming portamento is not automatically a line drawn all the way from the preceding melody note. Establish the landing pitch and whether the source fixes a starting pitch. Preserve a short arrival gesture when requested; do not promote a geometric anchor into an asserted continuous musical slide. Inspect its start relative to intervening chords. See the tested Marieta case below.
- `\appoggiatura`/`\acciaccatura` can add an automatic slur beyond an explicitly slurred grace group. For an internal grace-group slur only, use `\grace { ... ( ... ) }` with explicit endpoints. For a slide, use `\glissando`; do not substitute an automatic grace-to-main-note slur.
- Opposed stems on one source head can represent two simultaneous unison voices with different durations. Enter both voices independently. If LilyPond displaces their heads because of different dotting, use a local `\once \override Staff.NoteCollision.merge-differently-dotted = ##t` at that event to obtain one shared head with both stems. Do not combine the durations or delete a voice to improve appearance.
- Keep actual rests, but remove forced positions that cause collisions. Choose a local `Rest.staff-position` and, where needed, a small `Rest.extra-offset` after checking melody, bass and fingering clearances. Use a skip only for an inactive layer, not to hide a source rest.
- Native finger/string events must attach to the intended chord tone. A one-note chord can keep a low note's LH fingering beside its head; place its RH/string events inside the angle brackets too, e.g. `<c'-3_\rp_\5>8`. Putting these events after a one-note chord can silently omit them even with a clean compile. Inspect the actual symbols.

The specific user-confirmed shared-E appearance and remaining scope are documented in [marieta-case.md](marieta-case.md); they do not constitute approval of the full transcription.
