\version "2.26.0"
% Original CC0 four-bar technical fixture, not a transcription.
\header { title = "Bass · four-bar tab prototype" composer = "Sotto" subtitle = "Four strings · standard tuning · original CC0 exercise" tagline = ##f }
\paper { #(set-paper-size "letter") indent = 0 ragged-bottom = ##t ragged-last-bottom = ##t }
music = \absolute {
  \time 4/4 \tempo 4 = 100
  \repeat volta 2 {
    e,,4\4 g,,4\4 a,,4\3 b,,4\3 |
    <e,\2 g,\1>2 b,,2\3~ | \break
    b,,4\3 r4 d,4\3\glissando e,4\3 |
    R1 |
  }
}
\score { \new Staff = "bass" { \clef "bass_8" \new Voice = "bass" \music } \layout { } }
\score { \new Staff { \new Voice = "bass" \unfoldRepeats \music } \midi { } }
