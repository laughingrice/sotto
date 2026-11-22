# Marieta: short slides and shared unison heads

The user's two-page score is archived at `scores/marieta/source/original.pdf` in this project. The current canonical score is `scores/marieta/marieta.ly`; the saved 1–4 proof and scoped evidence are under `scores/marieta/review/01-04/`. Consult current error/review records before resuming: the initial whole-score proofread missed musical and annotation errors.

## Lessons actually demonstrated

- **3, incoming high B5:** a long C6-to-B5 line crossed the intervening B4/E5 chord. The user clarified that the slide should be a short approach starting graphically after that chord. Keep a native Glissando but shorten its bounds near B5. The prior C6 remains a layout/pitch anchor, not user confirmation of a continuous slide beginning at C6's onset. Other short incoming source strokes require their own endpoint review.
- **3 into 4:** the final B5 slides up to a small E6 endpoint, followed by a rearticulated main E6. Moving the endpoint to `\afterGrace` and removing the automatic release slur corrected the earlier mistake. The later quarter-to-dotted-eighth E6 tie is a different gesture. The source small-E-to-main-E arc remains unclear; do not erase that recorded uncertainty merely because later layout was approved.
- **2, beat 3:** the scan has two E5 voices: dotted-eighth melody and quarter-note inner voice. Default engraving showed adjacent heads that looked consecutive. This one-event override produces the requested single head and opposing stems while preserving both parsed durations:

  ```lilypond
  \once \override Staff.NoteCollision.merge-differently-dotted = ##t
  ```

  Apply it at the simultaneous event in the current named Voice contexts. A clean compile alone does not show whether both stems survived; inspect the render.
- **Rests:** the user approved moving actual rests into clear space. Keep the rests and musical voices, choose local positions, then inspect nearby bass notes, ornaments and fingerings. A position useful in one bar can collide with a held bass in the next.

The tested short-arrival helper in the live source changes native `Glissando.left-bound-info`: it derives the right endpoint with `ly:line-spanner::calc-right-bound-info`, then sets the left X a few staff spaces before it. Return fresh association pairs with `acons`; mutating a returned immutable pair with `assoc-set!` caused a Guile error. The source's 2.5-space length is a local choice, not a universal guitar-slide length. Do not invent hidden starting notes solely to draw a short stroke.

## Confirmation scope

The user explicitly confirmed the shared-notehead appearance with “great, looks good, you can update the skill and move on.” This confirms that layout detail in measure 2. Earlier they approved improved rest placement and requested the short incoming B5 slide. These statements are not full-measure approval of all five core aspects and do not verify later groups. The general “basically good” feedback must not become blanket full-score verification.

Measures 5 onward are reviewed in subsequent groups, with their own comparisons, duration manifests, uncertainties and user feedback. Do not freeze unfinished readings into this skill as fact.
