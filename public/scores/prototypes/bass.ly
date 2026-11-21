\version "2.26.0"
% Original CC0 four-bar technical fixture, not a transcription.
sottoView = #'both
\header { title = "Bass · four-bar tab prototype" composer = "Sotto" subtitle = "Four strings · standard tuning · original CC0 exercise" tagline = ##f }
\paper { #(set-paper-size "letter") indent = 0 ragged-bottom = ##t ragged-last-bottom = ##t }
music = \absolute {
  \time 4/4 \tempo 4 = 100
  \repeat volta 2 {
    \tag #'b-01 e,,4\4 \tag #'b-02 g,,4\4 \tag #'b-03 a,,4\3 \tag #'b-04 b,,4\3 |
    <\tag #'b-05 e,\2 \tag #'b-06 g,\1>2 \tag #'b-07 b,,2\3~ | #(if (eq? sottoView 'tabs) #{ \pageBreak #} #{ \break #})
    \tag #'b-08 b,,4\3 r4 \tag #'b-09 d,4\3\glissando \tag #'b-10 e,4\3 |
    R1 |
  }
}
\score {
  \new StaffGroup <<
    #(if (memq sottoView '(notation both)) #{ \new Staff { \clef "bass_8" \new Voice = "bass" \music } #} #{ {} #})
    #(if (memq sottoView '(tabs both)) #{ \new TabStaff \with { stringTunings = #bass-tuning } { \tabFullNotation \new TabVoice = "bass" \music } #} #{ {} #})
  >>
  \layout { }
}
\score { \new Staff { \new Voice = "bass" \unfoldRepeats \music } \midi { } }
