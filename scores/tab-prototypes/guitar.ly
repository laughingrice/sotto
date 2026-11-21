\version "2.26.0"
% Original CC0 four-bar technical fixture, not a transcription.
\header { title = "Guitar · four-bar tab prototype" composer = "Sotto" subtitle = "Standard tuning · original CC0 exercise" tagline = ##f }
\paper { #(set-paper-size "letter") indent = 0 ragged-bottom = ##t ragged-last-bottom = ##t }
music = \absolute {
  \time 4/4 \tempo 4 = 100
  \repeat volta 2 {
    e,4\6 g,4\6 a,4\5 b,4\5 |
    <e\4 g\3 b\2>2 b,2\5~ | \break
    b,4\5 r4 d4\5\glissando e4\5 |
    R1 |
  }
}
\score { \new Staff = "guitar" { \clef "treble_8" \new Voice = "guitar" \music } \layout { } }
% Exactly one playback part, independent of how many representations are drawn.
\score { \new Staff { \new Voice = "guitar" \unfoldRepeats \music } \midi { } }
