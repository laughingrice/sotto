\version "2.26.0"
% Original CC0 four-bar technical fixture, not a transcription.
% Event tags identify individual chord tones across all display views.
sottoView = #'both
\header { title = "Guitar · four-bar tab prototype" composer = "Sotto" subtitle = "Standard tuning · original CC0 exercise" tagline = ##f }
\paper { #(set-paper-size "letter") indent = 0 ragged-bottom = ##t ragged-last-bottom = ##t }
music = \absolute {
  \time 4/4 \tempo 4 = 100
  \repeat volta 2 {
    \tag #'g-01 e,4\6 \tag #'g-02 g,4\6 \tag #'g-03 a,4\5 \tag #'g-04 b,4\5 |
    <\tag #'g-05 e\4 \tag #'g-06 g\3 \tag #'g-07 b\2>2 \tag #'g-08 b,2\5~ | #(if (eq? sottoView 'tabs) #{ \pageBreak #} #{ \break #})
    \tag #'g-09 b,4\5 r4 \tag #'g-10 d4\5\glissando \tag #'g-11 e4\5 |
    R1 |
  }
}
\score {
  \new StaffGroup <<
    #(if (memq sottoView '(notation both)) #{ \new Staff { \clef "treble_8" \new Voice = "guitar" \music } #} #{ {} #})
    #(if (memq sottoView '(tabs both)) #{ \new TabStaff \with { stringTunings = #guitar-tuning } { \tabFullNotation \new TabVoice = "guitar" \music } #} #{ {} #})
  >>
  \layout { }
}
% Exactly one playback part, independent of how many representations are drawn.
\score { \new Staff { \new Voice = "guitar" \unfoldRepeats \music } \midi { } }
