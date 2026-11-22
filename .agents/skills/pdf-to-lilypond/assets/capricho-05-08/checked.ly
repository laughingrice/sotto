\version "2.26.0"
\language "nederlands"
% Local checked example from the user's Classical Guitar Shed PDF.
% Source edition copyright 2018 Allen Mathews LLC; composer Francisco Tarrega.
% Assistant-reviewed 5-8; user confirmed only the pitch details of 7-8.
% Pitches are written octave; transpose once at staff boundary for guitar MIDI.
\header {
  title = "Capricho árabe"
  subtitle = "Serenata · Guitar"
  composer = "Francisco Tárrega (1852–1909)"
  tagline = ##f
  
  % Assign the markup directly to a field like meter
  meter = \markup {
    \general-align #Y #CENTER {
      \circle \fontsize #-2 "6"
      \hspace #0.2
      \tiny "= D"
    }
  }
}
#(set-global-staff-size 18)
\paper { paper-width = 225\mm paper-height = 140\mm
 left-margin = 5\mm right-margin = 5\mm top-margin = 5\mm bottom-margin = 5\mm
 ragged-bottom = ##t }
% Native guitar fingerings: p=1, i=2, m=3, a=4.
rp = \rightHandFinger #1
ri = \rightHandFinger #2
rm = \rightHandFinger #3
ra = \rightHandFinger #4
barreLabel = #(define-music-function (label) (markup?) #{
  \textSpannerUp
  \override TextSpanner.style = #'line
  \override TextSpanner.staff-padding = #5
  \override TextSpanner.bound-details.left.text = \markup { \upright #label }
  \override TextSpanner.bound-details.right.text = \markup { \draw-line #'(0 . -0.8) }
  \override TextSpanner.bound-details.left-broken.text = ##f
  \override TextSpanner.bound-details.right.padding = #0.2
#})
stringLabel = #(define-music-function (label) (string?) #{
  \textSpannerDown
  \override TextSpanner.style = #'line
  \override TextSpanner.staff-padding = #3
  \override TextSpanner.bound-details.left.text = \markup { \upright \circle #label }
  \override TextSpanner.bound-details.right.text = ##f
  \override TextSpanner.bound-details.left-broken.text = ##f
#})
tempoSpan = #(define-music-function (label) (string?) #{
  \textSpannerDown
  \override TextSpanner.style = #'dashed-line
  \override TextSpanner.staff-padding = #6
  \override TextSpanner.bound-details.left.text = \markup { \italic #label }
  \override TextSpanner.bound-details.right.text = ##f
  \override TextSpanner.bound-details.left-broken.text = ##f
#})

% Source measure 5
% User verification: Not explicitly verified by user.
mE = <<
  \context Voice = "melody" { \voiceOne a4.-0 cis'8-3 e'8-1 g'8-4\glissando | }
  \context Voice = "inner" { \voiceFour \override Rest.staff-position = #2 s2. | }
  \context Voice = "bass" { \voiceTwo s2. | }
  \context Voice = "stringRange540x5" { s1*1/2 \stringLabel "4" s1*1/4\startTextSpan }
>>
% Source measure 6
% User verification: Not explicitly verified by user.
mF = <<
  \context Voice = "melody" { \voiceOne bes'8-4 \tag #'print { \afterGrace 7/8 a'8-3\glissando { \once \override Flag.stroke-style = #"grace" e''8-3 } } \tag #'midi { a'16.-3 e''32-3 } e''4. d''8-2 | }
  \context Voice = "inner" { \voiceFour \override Rest.staff-position = #2 s2. | }
  \context Voice = "bass" { \voiceTwo s2. | }
  \context Voice = "stringRange540x5" { s1*3/4 }
>>
% Short after-grace slide endpoints use explicit measured subdivision in MIDI.
% Review 5-8: confirmed E3-to-Bb3 slide at the end of 7; Bb3 half, A3 quarter in 8.
% Source measure 7
% User verification: Pitch endpoint USER-VERIFIED: final E3 slides up to Bb3 within m.7. String changes await user verification.
mG = <<
  \context Voice = "melody" { \voiceOne \tuplet 6/4 { cis''16-1^\ri d''-2^\ra e''-4^\rm d''-2^\ri cis''-1^\ra bes'-2^\rm } \tuplet 6/4 { a'16-1^\ri c''!-4^\ra bes'-2^\rm a'-1^\ri g'-4^\ra f'-2^\rm } e'32-1^\ri d'-0_\4^\ra cis'-4^\rm bes-1^\ri a-0^\ra g-4^\rm f-2^\ri \tag #'print { \afterGrace 7/8 e32-1^\ra\glissando { \once \override Flag.stroke-style = #"grace" bes8-2 } } \tag #'midi { e64-1 bes64-2 } | }
  \context Voice = "inner" { \voiceFour \override Rest.staff-position = #2 s2. | }
  \context Voice = "bass" { \voiceTwo s2. | }
  \context Voice = "stringRange540x5" { s1*5/12 s1*1/3\stopTextSpan }
  \context Voice = "stringRange7511x24" { s1*5/12 \stringLabel "5" s1*11/96\startTextSpan s1*7/32\stopTextSpan }
  \context Voice = "stringRange7621x32" { s1*21/32 \stringLabel "6" s1*23/256\startTextSpan s1*1/256\stopTextSpan  }
  \context Voice = "stringReturnFive" { s1*9/16 \stringLabel "5" s1*3/32\startTextSpan s1*3/32\stopTextSpan }
>>
% Source measure 8
% User verification: Pitch sequence USER-VERIFIED: Bb3 then A3. Durations checked by assistant; not explicitly approved by user.
mH = <<
  \context Voice = "melody" { \voiceOne bes2-2^\rm a4-1^\ri | }
  \context Voice = "inner" { \voiceFour \override Rest.staff-position = #2 s2. | }
  \context Voice = "bass" { \voiceTwo s2. | }
  \context Voice = "stringRange860" {  \stringLabel "6" s1*23/32\startTextSpan s1*1/32\stopTextSpan  }
>>

guitarSetup = { \clef "treble_8" \key d \minor \time 3/4 }
exampleMusic = { \mE \mF \mG \break \mH }
\score {
 \new Staff
 \transpose c c, { \guitarSetup \set Score.currentBarNumber = #5
  \keepWithTag #'print \exampleMusic \bar "||" }
 \layout { indent = 0 ragged-last = ##t }
}
\score {
 \new Staff \with { midiInstrument = "acoustic guitar (nylon)" }
 \transpose c c, { \guitarSetup \keepWithTag #'midi \exampleMusic }
 \midi { \tempo 4 = 80 }
}
