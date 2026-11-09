\version "2.24.3"
\language "english"

% Julia Florida, Agustin Barrios: transcription of the two supplied pages.
% Pitches use the guitar's conventional written octave (sounds one octave lower).
% The sixth string is tuned to D. All measure comments follow the printed scan:
% its second ending reuses numbers 31 and 32.
% Harmonics retain the source's written pitches and diamond noteheads.
% RH h.XIX = right-hand-only harmonic; a.h. = artificial harmonic.

\header {
  title = "Julia Florida"
  subtitle = "Barcarola"
  composer = "Agustín Barrios (1885–1944)"
  tagline = ##f
}
\paper {
  #(set-paper-size "a4")
  top-margin = 12\mm
  bottom-margin = 12\mm
  left-margin = 13\mm
  right-margin = 13\mm
  ragged-last-bottom = ##f
}
#(set-global-staff-size 17)

startBarre = #(define-music-function (label music) (markup? ly:music?) #{
  \once \override TextSpanner.bound-details.left.text = #label
  \once \override TextSpanner.bound-details.right.text =
    \markup \draw-line #'(0 . -0.6)
  \once \override TextSpanner.bound-details.left-broken.text = ##f
  \once \override TextSpanner.style = #'line
  \once \override TextSpanner.dash-fraction = #1
  #music \startTextSpan
#})
global = {
  \key d \major \time 6/8 \clef treble
  \set fingeringOrientations = #'(left)
  \set stringNumberOrientations = #'(up)
}

melodyA = {
  \tempo 4. = 42 - 46
  \mark \markup { \circle "6" "= D" }
  % 1–4
  r4. <g'-1 cs'' a''-2>4.^\markup\italic "a / i" |
  r4. a''8^\markup\italic "a" b''8^\markup\italic "m" a''8^\markup\italic "a" |
  \acciaccatura fs'8 a'4.\4^\markup\italic "a tempo"
    a'8^\markup\italic "i" b'8-3^\markup\italic "m" a'8 |
  a'4. a'8^\markup\italic "p" b'8-0 cs''8-1\2 |
  \break
  % 5–8
  d''4. \startBarre \markup { "Piv." \fraction 3 3 "III" } d''8^\markup\italic "m / i" e''8-4^\markup\italic "a" d''8 |
  d''4. d''8^\markup\italic "m / i" e''8-4^\markup\italic "a" d''8-3\stopTextSpan |
  g''4.-4^\markup\italic "a" fs''8^\markup\italic "m / i" e''8^\markup\italic "a" g''8^\markup\italic "m" |
  \startBarre \markup { \fraction 5 5 "II" }
  fs''4.^\markup\italic "a" b'8-4^\markup\italic "i" cs''8 d''8\stopTextSpan |
  \break
  % 9–12
  e''4.-0^\markup { "Piv." \italic "a" }
    e''8-2 fs''8-4 d''8-1
  |
  \acciaccatura e''8 e''8 b'8-4\4 d''8-4
    cs''8-3\4 b'8-1 \once \override NoteHead.style = #'harmonic-black a'8-4\5^"h.XII" |
  \acciaccatura fs'8 a'4.\4 a'8 b'8 a'8 |
  a'4.-1 a'8 b'8-0 cs''8 |
  \break
  % 13–16
  d''4.-2 \startBarre \markup { "Piv." \fraction 3 3 "III" }
    d''8-1 e''8 d''8\stopTextSpan |
  b''4.-4^\markup\italic "a" e''8-0^\markup\italic "a"
    fs''8-2^\markup\italic "m" g''8-3^\markup\italic "i" |
  \acciaccatura a''8 a''4.-2^\markup { \fraction 5 3 "IX" }^\markup\italic "m"
    \startBarre \markup { \fraction 5 5 "VII" }
    b''8 cs'''8 d'''8\stopTextSpan |
  a''4. b''8-1 cs'''8 d'''8-4 |
  \break
  % 17–20
  \acciaccatura a''8 a''4. \acciaccatura { cs''16( d''16) } a''4. |
  \mark \markup { \musicglyph "scripts.coda" \italic "a tempo" }
  <fs'-3 d''-2 a''-4>4. a''8-2 b''8-4 a''8-4 |
  <fs' d'' a''>4. \startBarre \markup { \fraction 3 3 "II" }
    cs''8 b'8 a'8 |
  <a' d''>8. b'16[ a'8] <as' c''>4.\stopTextSpan |
  \bar "||" \break
}

melodyB = {
  % 21–24
  fs'4^\markup\italic "a tempo" b'8-0^\markup\italic "a"
    g'4-0^\markup\italic "m" b'8-0 |
  fs'4 b'8 g'4 b'8 |
  fs'4 b'8~ \startBarre \markup { "Piv." \fraction 5 3 "II" }
    b'8^\markup\italic "a" a'8^\markup\italic "m" g'8-4 |
  fs'8-2^\markup\italic "i" g'8-4( e'8-1) fs'8\stopTextSpan
    as'8 \startBarre \markup { \fraction 2 2 "II" } b'8 |
  \break
  % 25–28
  fs''4^\markup\italic "m" fs''8\stopTextSpan^\markup\italic "a"
    d''8^\markup\italic "m" \startBarre \markup { \fraction 1 6 "II" }
    fs''8^\markup\italic "a" d''8\stopTextSpan |
  e''4-0^\markup { "Piv." \italic "a" } e''8^\markup\italic "a"
    b'8-2^\markup\italic "m / i" e''8^\markup\italic "a" b'8^\markup\italic "m" |
  d''4-2^\markup\italic "a" d''8^\markup\italic "m"
    a'8-0^\markup\italic "i" \once \override NoteHead.style = #'harmonic-black a''8-4\2^"h.XII" \once \override NoteHead.style = #'harmonic-black fs''8-4\3 |
  <a' d''-2>4^\markup { \fraction 5 3 "IV" } r8 a'8-0 e''8-0
    \startBarre \markup { \fraction 3 3 "III" } g''8 |
  \break
  % 29–30
  g''4. fs''8-4\2 e''8-4 g''8-2\stopTextSpan |
  fs''4.-2 a'8 b'8-1 cs''8-3 |
}
melodyFirst = {
  % First ending (31a–32a)
  e''4.-4 \startBarre \markup { \fraction 4 3 "II" } cs''4.-1 |
  cs''8 as'8-2 fs'8\stopTextSpan fs'4. |
}
melodySecond = {
  % Second ending: restore the measure numbers printed in the source.
  \set Score.currentBarNumber = #31
  e''4. fs''4.-3 |
  <fs'-3 d''-2>4. r4. |
  \break
}
melodyC = {
  % 33–34
  r8 e''8-0 a''8-2\2 r4 e'''8-4^\markup\italic "a / i" |
  \startBarre \markup { \fraction 3 3 "VII" }
  d'''8-4 cs'''8( b''8)\stopTextSpan
    \startBarre \markup { \fraction 3 3 "V" }
    a''8 g''8-4 fs''8-4\stopTextSpan |
  % 35–38
  \startBarre \markup { \fraction 4 4 "II" }
  g''16( fs''16) e''8-4 b'8-0\stopTextSpan
    \acciaccatura { cs''16( d''16) } cs''8 b'8-0 a'8-1 |
  b'4.-4 b'8-2 cs''8-4 a'8 |
  b'4.-4 b'8-2 cs''8-4 a'8-1 |
  fs'4.-4 <d' es'>4. |
  \break
  % 39–42
  fs'4. es'8 fs'8 gs'8-4 |
  \startBarre \markup { \fraction 3 3 "II" }
  a'4 fs''8\stopTextSpan es''4.-2 |
  \startBarre \markup { \fraction 3 3 "II" }
  fs''4. es''8-2\stopTextSpan fs''8-2 gs''8 |
  fs''4.^\markup\italic "a" es''4. |
  \break
  % 43–46
  r4. e''8-0^\markup\italic "a" fs''8-3\2^\markup\italic "m" g''8^\markup\italic "i" |
  \acciaccatura d''8 d''4.-2^\markup\italic "m" r4. |
  r4. e''8-2\2 f''8-4 d''8-4 |
  c''4.-1^\markup\italic "m" c''8^\markup\italic "m" e''8-0^\markup\italic "a" a''8-2~^\markup\italic "m" |
  \break
  % 47–50
  a''8 a''8 b''8 \acciaccatura { a''16-2( b''16-4) }
    a''8^\markup\italic "m" e''8^\markup\italic "i" b'8-0 |
  r8 e'8 a'8 c''8 e''8 a''8~ |
  a''8 a''8 b''8 \acciaccatura { a''16( b''16) } a''8 e''8 b'8 |
  e'8 a'8 d''8 f''8 \startBarre \markup { \fraction 6 6 "V" }
    e''8-0 a''8-1 |
  \break
  % 51–54: the high diamond notes are the printed RH harmonics.
  g8 e'8 a'8 cs''8 e''8\stopTextSpan
    \once \override NoteHead.style = #'harmonic-black a''8\4^\markup\center-column { "RH" "h.XIX" } |
  \startBarre \markup { \fraction 6 6 "IV" }
  fs8 ef'8 a'8 c''8 ef''8\stopTextSpan
    \once \override NoteHead.style = #'harmonic-black a''8\4^\markup\center-column { "RH" "h.XIX" } |
  \startBarre \markup { \fraction 6 6 "III" }
  f8 d'8 g'8 b'8 d''8\stopTextSpan
    \once \override NoteHead.style = #'harmonic-black a''8\4^\markup\center-column { "RH" "h.XIX" } |
  \startBarre \markup { \fraction 6 6 "II" }
  e8 b8-2 g'8-4 b'8-3 cs''8\stopTextSpan
    \once \override NoteHead.style = #'harmonic-black a''8\4\fermata^\markup\center-column { "RH" "h.XIX" } |
  \textEndMark \markup\italic "D.C. al Coda"
  \bar "||" \break
}
melodyCoda = {
  % 55–59
  \mark \markup { \musicglyph "scripts.coda" "Coda" }
  <fs'-3 d''-2 a''-4>4. \startBarre \markup { \fraction 4 4 "V" }
    a''8 b''8-4 a''8\stopTextSpan |
  a''4.-3 r4. |
  \once \override NoteHead.style = #'harmonic-black d''8-4\4 \once \override NoteHead.style = #'harmonic-black fs''8\6^"h.IX"
    \once \override NoteHead.style = #'harmonic-black a''8\4 \once \override NoteHead.style = #'harmonic-black d'''8\3^"h.VII"
    \once \override NoteHead.style = #'harmonic-black fs'''8\2^\markup\center-column { "8va" "a.h." }
    \once \override NoteHead.style = #'harmonic-black a''8-3\2 |
  \once \override NoteHead.style = #'harmonic-black d'''4.-4\p
    <\tweak style #'harmonic-black fs''-4\6 \tweak style #'harmonic-black a''-7\4 \tweak style #'harmonic-black d'''-7\3>4.\arpeggio\pp^"h." |
  <\tweak style #'harmonic d'\6 \tweak style #'harmonic d''\4>2.\ppp \bar "|."
}

middleA = {
  % 1–4
  r8 a8_\markup\italic "p" fs'8-1_\markup\italic "p" s4. |
  r8 a8 fs'8 <g' cs''>4._\markup\italic "poco rit." |
  r8 a8 fs'8-3\5 g'4.-4_\markup\italic "p" |
  r8 a8 fs'8 g'4.-0_\markup\italic "i" |
  % 5–8
  r8 d'8-0_\markup\italic "p" a'8-1 as'4.-1 |
  r8 d'8-0_\markup\italic "p" b'8_\markup\italic "i" c''4.-3\3 |
  r8 g'8-1^\markup\italic "i" d''8^\markup\italic "m" d''4. |
  r8 fs'8_\markup\italic "p" d''8^\markup\italic "m" r4. |
  % 9–12
  r8 fs'8-3_\markup\italic "p" cs''8-2^\markup\italic "m" gs'4.-3 |
  s4. g'4.-0_\markup\italic "i" |
  r8 a8 fs'8 g'4.-4 |
  r8 a8 fs'8 g'4.-0 |
  % 13–16
  r8 d'8 a'8-1 c''4.-3 |
  r8 d'8-0_\markup\italic "p" b'8-0^\markup\italic "m" c''4.-1\3 |
  r8 cs''8_\markup\italic "p" e''8^\markup\italic "i" <e' d'' g''-2>4. |
  cs''8 d''8-4 cs''8 <g'-0 b'-0>4._\markup\italic "rit." |
  % 17–20
  e''8-3 d''8 b'8 <g' cs''>8 b'8-0 cs''8 |
  r8 a8 fs'8-1 <g'-1 cs''>4. |
  r8 a8 fs'8 g'4.-4 |
  fs'4. fs'8_\markup\italic "poco rall." g'8-4 fs'8 |
}
middleB = {
  % 21–24
  d'8-4(_\markup\italic "p" b8) r8 e'8-4(_\markup\italic "p" cs'8-1) r8 |
  d'8( b8) r8 e'8( cs'8) r8 |
  d'8( b8) r8 <cs'-3 e'>4. |
  d'4.-3 cs'4.-3 |
  % 25–28
  r8 fs'4-3~ <fs' a'>4. |
  r8 g'8-0^\markup\italic "i" s8 a'4. |
  r8 fs'8 d''8 r4. |
  cs'8 e'8-4(_\markup\italic "p" g'8-4) r4. |
  % 29–30
  r8 d'8-0_\markup\italic "p" bf'8^\markup\italic "i" r4. |
  r8 d'8 fs'8 a'4-4 r8 |
}
middleFirst = {
  r8 g'8-3^\markup\italic "i" b'8-2^\markup\italic "m"
    r8 e'8 b'8-2 |
  s4. as8-1 b8-1 cs'8 |
}
middleSecond = {
  r8 gs'8 d''8 r8 g'8 cs''8-2 |
  d8 a8 b8-1 fs8-3 a8-0 d'8-0 |
}
middleC = {
  % 33–34
  r8 c''8-3\4 g''8-4 r8 a'8-2\5 g''8-3 |
  r8 fs''4 c''4.-1 |
  % 35–38
  b'4 r8 g'8 s4 |
  r8 a8-0 fs'8-3 g'4.-3 |
  r8 a8 fs'8 es'4.-1 |
  fs8 a8 cs'8-3 s4. |
  % 39–42
  fs8 a8 cs'8 d'4 r8 |
  r8 cs'8 a'8 b'4.-0 |
  r8 cs'8 a'8 b'4.-0 |
  d'8 \startBarre \markup { \fraction 3 3 "I" } gs'8^\markup\italic "i" bs'8^\markup\italic "m" cs'8 gs'8 cs''8\stopTextSpan |
  % 43–46
  as8-1 g'8^\markup\italic "i" cs''8^\markup\italic "m" r4. |
  b8 fs'8-3_\markup\italic "p" b'8-4 a8 f'8-1 b'8 |
  r8 e'8-4\5 b'8-0 r4 r8 |
  r8 e'8_\markup\italic "p" a'8^\markup\italic "i" r4. |
  % 47–50
  s4. <b'-1 f''-1>4. |
  s4. r4. |
  s4. <b' f''>4. |
  s4. r4. |
  % 51–54
  s4. r4. | s4. r4. |
  s4._\markup\italic "rall. assai" r4. |
  s4. r4.\fermata |
}
middleCoda = {
  r8 a8 fs'8-1 <g'-1 cs'' e''>4. |
  d8 fs8 a8 d'8-0 fs'8-1\5 \once \override NoteHead.style = #'harmonic-black a'8-4\5^"h.XII" |
  s2. | s2. | s2. |
}

bassA = {
  d4. r4. | d4. s4. | d4. s4. | d4. s4. |
  fs4. s4. | g4. s4. | b4.-1 s4. | b4.-1 s4. |
  b4. s4. | a4.-0 s4. | d4. s4. | d4. s4. |
  fs4. s4. | g4.-2 s4. | f'4.-1 s4. | fs'4.-1\4 s4. |
  <a fs'-2>4. s4. | d4. s4. |
  d4. s4. | s2. |
}
bassB = {
  s2. | s2. | s2. | s2. |
  d4. s4. | e4.-1 s4. | fs4. s4. | s2. |
  g4.-2_\markup\italic "p" s4. | a4. s4. |
}
bassFirst = { e4.-1 g4.-3 | fs4.-3 s4. | }
bassSecond = { e4.-2 a4. | d4. s4. | }
bassC = {
  f'4.-1\5 d'4.-1\6 | d'4.-0 ds'4. |
  e'4 s8 a4 r8 | d4. s4. | d4. s4. | s2. |
  s2. | fs4. s4. | fs4. s4. | s2. |
  s2. | s2. |
  \acciaccatura fs8 gs4.-3~ gs4 s8 |
  a4. s4. |
  e4. s4. | a4.-0 s4. | e4. s4. | a4. s4. |
  g4. s4. | fs4. s4. | f4. s4. | e4.-1 s4. |
}
bassCoda = { d4. s4. | s2. | s2. | s2. | s2. | }

\score {
  \new Staff \with {
    instrumentName = "Guitar"
    \override StringNumber.font-size = #-2
    \override Fingering.font-size = #-2
  } <<
    \global
    \mergeDifferentlyDottedOn
    \mergeDifferentlyHeadedOn
    \new Voice = "melody" {
      \voiceOne
      \melodyA
      \bar ".|:"
      \repeat volta 2 { \melodyB }
      \alternative { { \melodyFirst } { \melodySecond } }
      \melodyC \melodyCoda
    }
    \new Voice = "middle" {
      \voiceTwo
      \override Rest.staff-position = #-2
      \middleA
      \repeat volta 2 { \middleB }
      \alternative { { \middleFirst } { \middleSecond } }
      \middleC \middleCoda
    }
    \new Voice = "bass" {
      \voiceFour
      \override Rest.staff-position = #-6
      \bassA
      \repeat volta 2 { \bassB }
      \alternative { { \bassFirst } { \bassSecond } }
      \bassC \bassCoda
    }
  >>
  \layout {
    indent = 0
    \context {
      \Score
      barNumberVisibility = #first-bar-number-invisible-save-broken-bars
      \override BarNumber.break-visibility = ##(#f #f #t)
      \override BarNumber.font-size = #0
      \override BarNumber.stencil = #(make-stencil-boxer 0.1 0.4 ly:text-interface::print)
      \override RehearsalMark.self-alignment-X = #LEFT
    }
    \context { \Staff \override TextSpanner.staff-padding = #4 }
  }
  \midi { }
}
\markup \small \column {
  \line { "RH h.XIX: right-hand-only harmonics.  a.h.: artificial harmonics." }
  \line { "Sixth string tuned to D. Guitar notation sounds one octave below written pitch." }
}
