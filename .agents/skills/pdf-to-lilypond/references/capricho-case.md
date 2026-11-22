# Capricho arabe: checked passage and incomplete full score

This local example comes from the user's three-page Classical Guitar Shed edition of Francisco Tarrega's *Capricho arabe*. The supplied edition is copyright 2018 Allen Mathews LLC. Preserve its provenance; bundled source material is the user's local working reference, not a public-domain or redistribution claim about this edition.

## What the example contains

`assets/capricho-05-08/` is a frozen four-measure passage:

- `original-page.pdf`: unmodified first source page, extracted from the archived PDF.
- `checked.ly`, `checked.pdf`, `checked.midi`: current four-measure notation and its render/playback.
- `measures.json`: independent duration assertions for every named music/annotation voice, for both print and MIDI tags.
- `comparison.json`, `comparison.png`, `comparison.evidence.json`: repeatable source crop coordinates and visual evidence.
- `review.json`: exact artifact hashes, assistant checks and scoped user confirmations.

The example preserves the user's newer small circled `6 = D` header notation. Its custom wide, short paper is for a four-measure review only; the live score's user-selected Letter paper is not changed. The example has the source's line break before 8 so the end-of-7 grace endpoint is easy to inspect.

## Verification scope

Assistant-reviewed: pitches, rhythms, accidentals, absence of ties and single musical voice in 5-8, plus slides/strings/fingerings. The explicit `inner` and `bass` contexts are inactive skips in this passage; they are not additional sounding parts. Separate named annotation contexts carry string-range lines.

User-confirmed only:

- **7:** the final written E3 slides **up to Bb3 before the barline**.
- **8:** written Bb3 is followed by A3.

The user first said D, then withdrew it and explicitly chose the PDF's Bb3 for both positions. The half-note/quarter-note rhythm in 8 was checked by the assistant, not explicitly approved by the user. No entire measure or four-measure group is marked fully user-verified. There are no unresolved readings identified for this group after that clarification. Do not imply the full piece is checked.

## Mistakes this example is meant to prevent

| Passage | Earlier failure | Correct treatment |
|---|---|---|
| 5 | Started at D in the wrong register | Written A3 dotted quarter, C#4/E4/G4 eighths; G4 slides to Bb4 in 6. |
| 6 | F-to-E release substituted for slide from A | Bb4 eighth; A4 eighth slides to small E5 endpoint inside 6; rearticulated E5 dotted quarter; D5 eighth. |
| End of 7 | Leading grace migrated to 8 or looked like a release | `afterGrace` on final E3, explicit slide UP to Bb3 inside 7, with no invented release slur. |
| 7 strings | Fifth string started late; return changes unclear | String 5 starts on G4; string 4 on open D4; string 5 returns on C#4; string 6 starts on G3 and carries the final slide. |
| Annotation timing | Stop event placed on the wrong skip | Post-events apply at a skip's onset; fill the rest of each bar explicitly. |
| MIDI | Short after-grace caused a programming error despite a zero exit code | Tagged short measured playback subdivisions preserve total duration; print keeps true after-grace notation. |

## Reproduce it

From the project root (use the bundled Python for Pillow if system Python lacks it):

```sh
skill=.agents/skills/pdf-to-lilypond
example="$skill/assets/capricho-05-08"
python3 "$skill/scripts/validate_score.py" "$example/checked.ly" \
  --manifest "$example/measures.json" --report /tmp/capricho-example-duration.json
python3 "$skill/scripts/validate_review.py" "$example/review.json"
```

To rebuild without changing the frozen artifacts, copy this example directory to a temporary workspace, run `lilypond -dno-point-and-click -o checked checked.ly` there, regenerate the comparison using `compare_pages.py`, inspect the output and refresh hashes only after reviewing the changes. Recompiled PDF metadata may change hashes even if notation looks identical.

## Live full-score audit, as of 2026-11-09

The live files remain under `scores/capricho-arabe/`. Consult its `error-log.txt` and `review/verification-status.json` for correction history and pending user reviews. They remain authoritative for that live score; the skill example is a snapshot.

A manifest for the live score's current measure variables is included at `assets/capricho-all-measures.json`:

```sh
skill=.agents/skills/pdf-to-lilypond
python3 "$skill/scripts/validate_score.py" scores/capricho-arabe/capricho-arabe.ly \
  --manifest "$skill/assets/capricho-all-measures.json" --report /tmp/capricho-full-duration.json
```

This audit is **expected to fail on the captured live state**: annotation voice `ritOne` in 18 and `ritTwo` in 39 each have length **31/32**, while their bars require 1. All declared musical voices balanced. These annotation shortages were discovered while authoring the skill; the live score was left unchanged. Add the missing skip only when working on those measures, then recheck placement and the full duration manifest. Do not shorten the expected bar length to make the validator pass.

Other known user-reported issues still require source comparison:

- 14: slur should cover the first two third-quarter notes, not the return to the third. Recheck pitch names rather than assuming the user's informal E/G names match the present code.
- 15: missing middle slide down to G.
- 16: the two intended dashed gestures still need endpoint/voice review; two objects alone do not prove correct grouping.
- 23: final group should be eighth + sixteenth + sixteenth; current code has sixteenth + eighth + sixteenth.
- 28: missing slide and incorrect slur endpoints.
- 29: slide too short; establish whether the musical target or graphical padding is wrong.
- 30: start slide too short and end slide missing.

Carry these into their four-measure groups. Do not silently apply or mark them verified while using this skill as an example.
