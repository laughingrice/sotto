% Tab string choices added 2026-11-21: existing anchors preserved; hidden additions inferred.
% Review: scores/fingering-review-2026-11-21/julia-florida/fingerings.json
\version "2.26.0"
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

% Source guide-slide strokes: keep the arrival/finger without inventing a start note.
#(define (julia-guide-event direction finger)
  (make-music 'FingeringEvent 'digit finger
    'tags (list (if (> direction 0) 'sotto-guide-up 'sotto-guide-down))
    'tweaks (list (cons 'stencil
      (lambda (grob)
        (ly:stencil-add (grob-interpret-markup grob (number->string finger))
          (make-line-stencil 0.09 -0.8 (* -0.24 direction) -0.15 (* 0.24 direction))))))))
guideUp = #(define-event-function (finger) (integer?) (julia-guide-event 1 finger))
guideDown = #(define-event-function (finger) (integer?) (julia-guide-event -1 finger))

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

#(define (julia-note-detail event grob key)
 (or (assoc-ref (ly:event-property event 'tweaks) (list #t 'details key))
     (assoc-ref (ly:event-property event 'tweaks) (list 'details key))
     (assoc-ref (ly:grob-property grob 'details) key)))
#(define julia-slide-engraver
 (lambda (context)
  (let ((pending (make-hash-table)))
   (make-engraver
    (acknowledgers
     ((note-head-interface engraver grob source)
      (let* ((event (ly:grob-property grob 'cause))
       (start (julia-note-detail event grob 'julia-slide-start))
       (end (julia-note-detail event grob 'julia-slide-end)))
       (if start
        (let ((span (ly:engraver-make-grob engraver 'Glissando event)))
         (ly:grob-set-parent! span Y grob)
         (ly:grob-set-property! span 'after-line-breaking #f)
         (ly:grob-set-property! span 'bound-details '((left . ((padding . 0.1) (attach-dir . 1))) (right . ((padding . 0.1) (attach-dir . -1)))))
         (ly:grob-set-property! span 'style 'line)
         (ly:grob-set-property! span 'thickness 1.6)
         (ly:spanner-set-bound! span LEFT grob)
         (hash-set! pending start span)))
       (if end
        (let ((span (hash-ref pending end)))
         (if span
          (begin (ly:spanner-set-bound! span RIGHT grob)
           (ly:engraver-announce-end-grob engraver span event)
           (hash-remove! pending end))
          (ly:error "Unmatched Julia slide endpoint: ~a" end)))))))
    ((finalize engraver)
     (if (> (hash-count (const #t) pending) 0)
      (ly:error "Julia has an unfinished source slide.")))))))

fingeringsToChords =
#(define-music-function (music) (ly:music?)
  (map-some-music
   (lambda (m)
     (cond
      ((music-is-of-type? m 'event-chord) m)
      ((and (music-is-of-type? m 'note-event)
            (any (lambda (art) (music-is-of-type? art 'fingering-event))
                 (ly:music-property m 'articulations)))
       (let* ((arts (ly:music-property m 'articulations))
              (in-chord (filter (lambda (a)
                                  (or (music-is-of-type? a 'fingering-event)
                                      (music-is-of-type? a 'string-number-event)))
                                arts))
              (out-chord (filter (lambda (a)
                                   (not (or (music-is-of-type? a 'fingering-event)
                                            (music-is-of-type? a 'string-number-event))))
                                 arts)))
         (ly:music-set-property! m 'articulations in-chord)
         (make-music 'EventChord
                     'elements (list m)
                     'articulations out-chord)))
      (else #f)))
   music))


% One source measure per variable; all three musical voices fill 6/8.


% Source measure 1
juliaBarA = <<
  \context Voice = "melody" { \voiceOne \tempo 4. = 42 - 46
  \mark \markup { \circle "6" "= D" }
  
  r4. <\tweak details.julia-slide-end #'first g'\tweak stencil ##f \4-1 cs''\tweak stencil ##f \3 a''\tweak stencil ##f \1-2>4.^\markup\italic "a / i" | }
  \context Voice = "middle" { \voiceTwo \once \override Rest.staff-position = #-2 r8 a8\tweak stencil ##f \5_\markup\italic "p" \tweak details.julia-slide-start #'first fs'8\tweak stencil ##f \4-1_\markup\italic "p" s4. | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 \once \override Rest.staff-position = #-10 r4. | }
>>

% Source measure 2
juliaBarB = <<
  \context Voice = "melody" { \voiceOne r4. a''8\tweak stencil ##f \1^\markup\italic "a" b''8\tweak stencil ##f \1^\markup\italic "m" a''8\tweak stencil ##f \1^\markup\italic "a" | }
  \context Voice = "middle" { \voiceTwo r8 a8\tweak stencil ##f \5 \tweak details.julia-slide-start #'second fs'8\tweak stencil ##f \4 <\tweak details.julia-slide-end #'second g'\tweak stencil ##f \4-1 cs''\tweak stencil ##f \3>4._\markup\italic "poco rit." | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 3
juliaBarC = <<
  \context Voice = "melody" { \voiceOne \acciaccatura { fs'8\tweak stencil ##f \4-1( } a'4.)\4^\markup\italic "a tempo"
    a'8\tweak stencil ##f \4^\markup\italic "i" b'8\tweak stencil ##f \4-3^\markup\italic "m" a'8\tweak stencil ##f \4 | }
  \context Voice = "middle" { \voiceTwo c'8\rest a8\tweak stencil ##f \5 fs'8 \5-3 g'4.\tweak stencil ##f \5-\tweak extra-offset #'(0 . -1)-4_\markup\italic "p" | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 4
juliaBarD = <<
  \context Voice = "melody" { \voiceOne a'4.\tweak stencil ##f \4 a'8\tweak stencil ##f \4^\markup\italic "p" b'8\tweak stencil ##f \2-0 cs''8-1\2 | }
  \context Voice = "middle" { \voiceTwo c'8\rest a8\tweak stencil ##f \5 fs'8\tweak stencil ##f \5 g'4.\tweak stencil ##f \3-\tweak extra-offset #'(0 . -1)-0_\markup\italic "i" | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 5
juliaBarE = <<
  \context Voice = "melody" { \voiceOne \break
  
  d''4.\tweak stencil ##f \2 \startBarre \markup { "Piv." \fraction 3 3 "III" } d''8\tweak stencil ##f \2^\markup\italic "m / i" e''8\tweak stencil ##f \2-4^\markup\italic "a" d''8\tweak stencil ##f \2 | }
  \context Voice = "middle" { \voiceTwo r8 d'8\tweak stencil ##f \4-0_\markup\italic "p" a'8\tweak stencil ##f \3-1 as'4.\tweak stencil ##f \3\guideUp #1 | }
  \context Voice = "bass" { \voiceFour fs4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 6
juliaBarF = <<
  \context Voice = "melody" { \voiceOne d''4.\tweak stencil ##f \2 d''8\tweak stencil ##f \2^\markup\italic "m / i" e''8\tweak stencil ##f \2-4^\markup\italic "a" d''8\tweak stencil ##f \2\guideDown #3 \stopTextSpan | }
  \context Voice = "middle" { \voiceTwo r8 d'8\tweak stencil ##f \4-0_\markup\italic "p" b'8\tweak stencil ##f \3_\markup\italic "i" c''4.\guideUp #3 \3 | }
  \context Voice = "bass" { \voiceFour g4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 7
juliaBarG = <<
  \context Voice = "melody" { \voiceOne g''4.\tweak stencil ##f \1-4^\markup\italic "a" fs''8\tweak stencil ##f \1^\markup\italic "m / i" e''8\tweak stencil ##f \1^\markup\italic "a" g''8\tweak stencil ##f \1^\markup\italic "m" | }
  \context Voice = "middle" { \voiceTwo r8 g'8\tweak stencil ##f \4^\markup\italic "i" d''8\tweak stencil ##f \2^\markup\italic "m" d''4.\tweak stencil ##f \2 | }
  \context Voice = "bass" { \voiceFour b4.\tweak stencil ##f \5-1 s4. | }
>>

% Source measure 8
juliaBarH = <<
  \context Voice = "melody" { \voiceOne \startBarre \markup { \fraction 5 5 "II" }
  fs''4.\tweak stencil ##f \1^\markup\italic "a" b'8\tweak stencil ##f \3-4^\markup\italic "i" cs''8\tweak stencil ##f \2 d''8\tweak stencil ##f \2\stopTextSpan | }
  \context Voice = "middle" { \voiceTwo r8 fs'8\tweak stencil ##f \4_\markup\italic "p" d''8\tweak stencil ##f \2^\markup\italic "m" b4.\rest | }
  \context Voice = "bass" { \voiceFour b4.\tweak stencil ##f \5-1 s4. | }
>>

% Source measure 9
juliaBarI = <<
  \context Voice = "melody" { \voiceOne \break
  
  e''4.\tweak stencil ##f \1-0^\markup { "Piv." \italic "a" }
    e''8\tweak stencil ##f \2\guideUp #2 fs''8\tweak stencil ##f \2-4 d''8\tweak stencil ##f \3-1 | }
  \context Voice = "middle" { \voiceTwo r8 fs'8\tweak stencil ##f \4-3_\markup\italic "p" d''8\tweak stencil ##f \2-2^\markup\italic "m" gs'4.\tweak stencil ##f \4\guideUp #3 | }
  \context Voice = "bass" { \voiceFour b4.\tweak stencil ##f \5 s4. | }
>>

% Source measure 10
juliaBarJ = <<
  \context Voice = "melody" { \voiceOne \acciaccatura { e''8\tweak stencil ##f \3\guideUp #1 } e''8\tweak stencil ##f \3 b'8-4\4 d''8\tweak stencil ##f \4\guideDown #4
    cs''8-3\4 b'8\tweak stencil ##f \4-1 \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #12 a'8-4\5^"h.XII" | }
  \context Voice = "middle" { \voiceTwo s4. g'4.\tweak stencil ##f \3-0_\markup\italic "i" | }
  \context Voice = "bass" { \voiceFour a4.\tweak stencil ##f \5-0 s4. | }
>>

% Source measure 11
juliaBarK = <<
  \context Voice = "melody" { \voiceOne \acciaccatura { fs'8\tweak stencil ##f \5-1( } a'4.)\4 a'8\tweak stencil ##f \4 b'8\tweak stencil ##f \4 a'8\tweak stencil ##f \4 | }
  \context Voice = "middle" { \voiceTwo r8 a8\tweak stencil ##f \5 fs'8\tweak stencil ##f \5 g'4.\tweak stencil ##f \5-4 | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 12
juliaBarL = <<
  \context Voice = "melody" { \voiceOne a'4.\tweak stencil ##f \4-1 a'8\tweak stencil ##f \4 b'8\tweak stencil ##f \2-0 cs''8\tweak stencil ##f \2 | }
  \context Voice = "middle" { \voiceTwo r8 a8\tweak stencil ##f \5 fs'8\tweak stencil ##f \5 g'4.\tweak stencil ##f \3-\tweak extra-offset #'(0 . -1)-0 | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 13
juliaBarM = <<
  \context Voice = "melody" { \voiceOne \break
  
  d''4.\tweak stencil ##f \2\guideUp #2 \startBarre \markup { "Piv." \fraction 3 3 "III" }
    d''8\tweak stencil ##f \2-1 e''8\tweak stencil ##f \2 d''8\tweak stencil ##f \2\stopTextSpan | }
  \context Voice = "middle" { \voiceTwo r8 d'8\tweak stencil ##f \4 a'8\tweak stencil ##f \3-1 c''4.\tweak stencil ##f \3-3 | }
  \context Voice = "bass" { \voiceFour fs4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 14
juliaBarN = <<
  \context Voice = "melody" { \voiceOne b''4.\tweak stencil ##f \1-4^\markup\italic "a" e''8\tweak stencil ##f \1-0^\markup\italic "a"
    fs''8\tweak stencil ##f \2-2^\markup\italic "m" g''8\tweak stencil ##f \2-3^\markup\italic "i" | }
  \context Voice = "middle" { \voiceTwo r8 d'8\tweak stencil ##f \4-0_\markup\italic "p" b'8\tweak stencil ##f \2-0^\markup\italic "m" c''4.-1\3 | }
  \context Voice = "bass" { \voiceFour g4.\tweak stencil ##f \6-2 s4. | }
>>

% Source measure 15
juliaBarO = <<
  \context Voice = "melody" { \voiceOne \acciaccatura { a''8\tweak stencil ##f \2 } a''4.\tweak stencil ##f \2\guideUp #2 ^\markup { \fraction 5 3 "IX" }^\markup\italic "m"
    \startBarre \markup { \fraction 5 5 "VII" }
    b''8\tweak stencil ##f \1 cs'''8\tweak stencil ##f \1 d'''8\tweak stencil ##f \1\stopTextSpan | }
  \context Voice = "middle" { \voiceTwo c''8\rest cs''8\tweak stencil ##f \4_\markup\italic "p" e''8\tweak stencil ##f \3^\markup\italic "i" <e'\tweak stencil ##f \5 d''\tweak stencil ##f \3 g''\tweak stencil ##f \2\guideDown #2 >4. | }
  \context Voice = "bass" { \voiceFour f'4.\tweak stencil ##f \5-1 s4. | }
>>

% Source measure 16
juliaBarP = <<
  \context Voice = "melody" { \voiceOne a''4.\tweak stencil ##f \1 b''8\tweak stencil ##f \1-1 cs'''8\tweak stencil ##f \1 d'''8\tweak stencil ##f \1-4 | }
  \context Voice = "middle" { \voiceTwo cs''8\tweak stencil ##f \3 d''8\tweak stencil ##f \3-4 cs''8\tweak stencil ##f \3 <g'\tweak stencil ##f \3-0 b'\tweak stencil ##f \2-0>4._\markup\italic "rit." | }
  \context Voice = "bass" { \voiceFour fs'4.-1\4 s4. | }
>>

% Source measure 17
juliaBarQ = <<
  \context Voice = "melody" { \voiceOne \break
  
  \acciaccatura { a''8\tweak stencil ##f \1\guideDown #4 } a''4.\tweak stencil ##f \1 \acciaccatura { cs''16\tweak stencil ##f \2( d''16\tweak stencil ##f \2) } a''4.\tweak stencil ##f \1 | }
  \context Voice = "middle" { \voiceTwo e''8\tweak stencil ##f \2-3 d''8\tweak stencil ##f \2 b'8\tweak stencil ##f \2 <g'\tweak stencil ##f \3 cs''\tweak stencil ##f \2>8 b'8\tweak stencil ##f \2-0 cs''8\tweak stencil ##f \2 | }
  \context Voice = "bass" { \voiceFour <a\tweak stencil ##f \5 fs'\tweak stencil ##f \4-2>4. s4. | }
>>

% Source measure 18
juliaBarR = <<
  \context Voice = "melody" { \voiceOne \mark \markup { \musicglyph "scripts.coda" \italic "a tempo" }
  <fs'\tweak stencil ##f \4-3 d''\tweak stencil ##f \2-2 a''\tweak stencil ##f \1-4>4. a''8\tweak stencil ##f \1-2 b''8\tweak stencil ##f \1-4 a''8\tweak stencil ##f \1\guideDown #4 | }
  \context Voice = "middle" { \voiceTwo b8\rest a8\tweak stencil ##f \5 fs'8\tweak stencil ##f \4-1 <g'\tweak stencil ##f \4\guideUp #1 cs''\tweak stencil ##f \3>4. | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 19
juliaBarS = <<
  \context Voice = "melody" { \voiceOne <fs'\tweak stencil ##f \4 d''\tweak stencil ##f \2 a''\tweak stencil ##f \1>4. \startBarre \markup { \fraction 3 3 "II" } cs''4.\tweak stencil ##f \2 | }
  \context Voice = "middle" { \voiceTwo b8\rest a8\tweak stencil ##f \5 fs'8\tweak stencil ##f \4 a'8\tweak stencil ##f \3 b'8\tweak stencil ##f \3 a'8\tweak stencil ##f \3 | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 g'4.\tweak stencil ##f \4-4 | }
>>

% Source measure 20
juliaBarT = <<
  \context Voice = "melody" { \voiceOne d''4.\tweak stencil ##f \2 <as'\tweak stencil ##f \3 cs''\tweak stencil ##f \2>4.\stopTextSpan \break | }
  \context Voice = "middle" { \voiceTwo a'8.\tweak stencil ##f \3 b'16\tweak stencil ##f \3[ a'8\tweak stencil ##f \3] fs'8\tweak stencil ##f \4_\markup\italic "poco rall." g'8\tweak stencil ##f \4-4 fs'8\tweak stencil ##f \4 | }
  \context Voice = "bass" { \voiceFour fs'4.\tweak stencil ##f \4 s4. | }
>>

% Source measure 21
juliaBarU = <<
  \context Voice = "melody" { \voiceOne fs'4\tweak stencil ##f \4^\markup\italic "a tempo" b'8\tweak stencil ##f \2-0^\markup\italic "a"
    g'4\tweak stencil ##f \3-0^\markup\italic "m" b'8\tweak stencil ##f \2-0 | }
  \context Voice = "middle" { \voiceTwo d'8\tweak stencil ##f \5-4(_\markup\italic "p" b8\tweak stencil ##f \5) r8 e'8\tweak stencil ##f \4-4(_\markup\italic "p" cs'8\tweak stencil ##f \5\guideUp #1 ) r8 | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 22
juliaBarV = <<
  \context Voice = "melody" { \voiceOne fs'4\tweak stencil ##f \4 b'8\tweak stencil ##f \2 g'4\tweak stencil ##f \3 b'8\tweak stencil ##f \3 | }
  \context Voice = "middle" { \voiceTwo d'8\tweak stencil ##f \5( b8\tweak stencil ##f \5) r8 e'8\tweak stencil ##f \4( cs'8\tweak stencil ##f \5) r8 | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 23
juliaBarW = <<
  \context Voice = "melody" { \voiceOne fs'4\tweak stencil ##f \4-3 b'8\tweak stencil ##f \2~ \startBarre \markup { "Piv." \fraction 5 3 "II" }
    b'8\tweak stencil ##f \2^\markup\italic "a" a'8\tweak stencil ##f \3-1^\markup\italic "m" g'8\tweak stencil ##f \3 | }
  \context Voice = "middle" { \voiceTwo d'8\tweak stencil ##f \5-4( b8\tweak stencil ##f \5-1) r8 <cs'\tweak stencil ##f \5-3 e'\tweak stencil ##f \4-2>4. | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 24
juliaBarX = <<
  \context Voice = "melody" { \voiceOne fs'8\tweak stencil ##f \4-2^\markup\italic "i" g'8\tweak stencil ##f \4-4( e'8\tweak stencil ##f \4-1) fs'8\tweak stencil ##f \4\stopTextSpan
    as'8\tweak stencil ##f \3 \startBarre \markup { \fraction 2 2 "II" } cs''8\tweak stencil ##f \2 | }
  \context Voice = "middle" { \voiceTwo d'4.\tweak stencil ##f \5\guideUp #3 cs'4.\tweak stencil ##f \5-3 | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 25
juliaBarY = <<
  \context Voice = "melody" { \voiceOne \break
  
  fs''4\tweak stencil ##f \1^\markup\italic "m" fs''8\tweak stencil ##f \1\stopTextSpan^\markup\italic "a"
    d''8\tweak stencil ##f \2^\markup\italic "m" \startBarre \markup { \fraction 1 6 "II" }
    fs''8\tweak stencil ##f \2^\markup\italic "a" d''8\tweak stencil ##f \2\stopTextSpan | }
  \context Voice = "middle" { \voiceTwo r8 fs'4\tweak stencil ##f \4-3~ <fs'\tweak stencil ##f \4 b'\tweak stencil ##f \3>4. | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 26
juliaBarZ = <<
  \context Voice = "melody" { \voiceOne e''4\tweak stencil ##f \1-0^\markup { "Piv." \italic "a" } e''8\tweak stencil ##f \1^\markup\italic "a"
    cs''8\tweak stencil ##f \2-2^\markup\italic "m / i" e''8\tweak stencil ##f \2^\markup\italic "a" cs''8\tweak stencil ##f \2^\markup\italic "m" | }
  \context Voice = "middle" { \voiceTwo r8 g'8\tweak stencil ##f \3-0^\markup\italic "i" s8 b'4.\tweak stencil ##f \3 | }
  \context Voice = "bass" { \voiceFour e4.\tweak stencil ##f \6-1 s4. | }
>>

% Source measure 27
juliaBarAA = <<
  \context Voice = "melody" { \voiceOne d''4\tweak stencil ##f \2\guideUp #2 ^\markup\italic "a" d''8\tweak stencil ##f \2^\markup\italic "m"
    b'8\tweak stencil ##f \2-0^\markup\italic "i" \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #12 b''8-4\2^"h.XII" \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #12 g''8-4\3 | }
  \context Voice = "middle" { \voiceTwo r8 fs'8\tweak stencil ##f \4 d''8\tweak stencil ##f \2 b4.\rest | }
  \context Voice = "bass" { \voiceFour fs4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 28
juliaBarAB = <<
  \context Voice = "melody" { \voiceOne <b'\tweak stencil ##f \3 e''\tweak stencil ##f \2-2>4^\markup { \fraction 5 3 "IV" } r8 b'8\tweak stencil ##f \2-0 e''8\tweak stencil ##f \1-0
    \startBarre \markup { \fraction 3 3 "III" } g''8\tweak stencil ##f \1 | }
  \context Voice = "middle" { \voiceTwo cs'8\tweak stencil ##f \5 e'8\tweak stencil ##f \5-4(_\markup\italic "p" g'8\tweak stencil ##f \4\guideUp #4 ) b4.\rest| }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 29
juliaBarAC = <<
  \context Voice = "melody" { \voiceOne \break
  
  g''4.\tweak stencil ##f \1 fs''8-4\2 e''8\tweak stencil ##f \2\guideDown #4 g''8\tweak stencil ##f \1-2\stopTextSpan | }
  \context Voice = "middle" { \voiceTwo r8 d'8\tweak stencil ##f \4-0_\markup\italic "p" bf'8\tweak stencil ##f \3^\markup\italic "i" r4. | }
  \context Voice = "bass" { \voiceFour g4.\tweak stencil ##f \6-2_\markup\italic "p" s4. | }
>>

% Source measure 30
juliaBarAD = <<
  \context Voice = "melody" { \voiceOne fs''4.\tweak stencil ##f \1\guideDown #2 b'8\tweak stencil ##f \2 cs''8\tweak stencil ##f \2-1 d''8\tweak stencil ##f \2-3 | }
  \context Voice = "middle" { \voiceTwo r8 d'8\tweak stencil ##f \4 e'8\tweak stencil ##f \4 fs'4\tweak stencil ##f \4-4 r8 | }
  \context Voice = "bass" { \voiceFour a4.\tweak stencil ##f \5 s4. | }
>>

% Source measure 31a
juliaBarAE = <<
  \context Voice = "melody" { \voiceOne e''4.\tweak stencil ##f \2-4 \startBarre \markup { \fraction 4 3 "II" } cs''4.\tweak stencil ##f \2-1 | }
  \context Voice = "middle" { \voiceTwo r8 g'8\tweak stencil ##f \4-3^\markup\italic "i" b'8\tweak stencil ##f \3-2^\markup\italic "m"
    r8 e'8\tweak stencil ##f \4 b'8\tweak stencil ##f \3-2 | }
  \context Voice = "bass" { \voiceFour e4.\tweak stencil ##f \6-1 g4.\tweak stencil ##f \6-3 | }
>>

% Source measure 32a
juliaBarAF = <<
  \context Voice = "melody" { \voiceOne cs''8\tweak stencil ##f \2 as'8\tweak stencil ##f \3\guideDown #2 fs'8\tweak stencil ##f \4\stopTextSpan fs'4.\tweak stencil ##f \4 | }
  \context Voice = "middle" { \voiceTwo s4. as8\tweak stencil ##f \5-1 b8\tweak stencil ##f \5\guideUp #1 cs'8\tweak stencil ##f \5 | }
  \context Voice = "bass" { \voiceFour fs4.\tweak stencil ##f \6\guideDown #3 s4. | }
>>

% Source measure 31b
juliaBarAG = <<
  \context Voice = "melody" { \voiceOne \set Score.currentBarNumber = #31
  e''4.\tweak stencil ##f \1 fs''4.\tweak stencil ##f \1-3 | }
  \context Voice = "middle" { \voiceTwo r8 gs'8\tweak stencil ##f \3 d''8\tweak stencil ##f \2 r8 g'8\tweak stencil ##f \3 cs''8\tweak stencil ##f \2-2 | }
  \context Voice = "bass" { \voiceFour e4.\tweak stencil ##f \6-2 a4.\tweak stencil ##f \5 | }
>>

% Source measure 32b
juliaBarAH = <<
  \context Voice = "melody" { \voiceOne <fs'\tweak stencil ##f \4-3 d''\tweak stencil ##f \2\guideUp #2 >4. r4.  \break | }
  \context Voice = "middle" { \voiceTwo fs'8\tweak stencil ##f \4 a8\tweak stencil ##f \5 b8\tweak stencil ##f \5-1 fs8\tweak stencil ##f \6-3 a8\tweak stencil ##f \5-0 d'8\tweak stencil ##f \4-0 | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 33
juliaBarAI = <<
  \context Voice = "melody" { \voiceOne r8 e''8\tweak stencil ##f \1-0 a''8-2\2 r4 e'''8\tweak stencil ##f \1-4^\markup\italic "a / i" | }
  \context Voice = "middle" { \voiceTwo r8 cs''8-3\4 g''8\tweak stencil ##f \3-4 r8 a'8-2\5 g''8\tweak stencil ##f \3-3 | }
  \context Voice = "bass" { \voiceFour fs'4.-1\5 d'4.-1\6 | }
>>

% Source measure 34
juliaBarAJ = <<
  \context Voice = "melody" { \voiceOne \startBarre \markup { \fraction 3 3 "VII" }
  d'''8\tweak stencil ##f \1\guideDown #4 cs'''8\tweak stencil ##f \1( b''8\tweak stencil ##f \1)\stopTextSpan
    \startBarre \markup { \fraction 3 3 "V" }
    a''8\tweak stencil ##f \1 g''8\tweak stencil ##f \2-4 fs''8\tweak stencil ##f \2\guideDown #4 \stopTextSpan | }
  \context Voice = "middle" { \voiceTwo r8 fs''4\tweak stencil ##f \2 c''4.\tweak stencil ##f \3-1 | }
  \context Voice = "bass" { \voiceFour d'4.\tweak stencil ##f \4-0 ds'4.\tweak stencil ##f \5 | }
>>

% Source measure 35
juliaBarAK = <<
  \context Voice = "melody" { \voiceOne \startBarre \markup { \fraction 4 4 "II" }
  g''16\tweak stencil ##f \1( fs''16\tweak stencil ##f \1) e''8\tweak stencil ##f \2-4 b'8\tweak stencil ##f \2-0\stopTextSpan
    \acciaccatura { cs''16\tweak stencil ##f \2\guideUp #1 ( d''16\tweak stencil ##f \2) } cs''8\tweak stencil ##f \2 b'8\tweak stencil ##f \2-0 a'8\tweak stencil ##f \3-1 | }
  \context Voice = "middle" { \voiceTwo b'4\tweak stencil ##f \3 r8 g'8\tweak stencil ##f \3 s4 | }
  \context Voice = "bass" { \voiceFour e'4\tweak stencil ##f \4 s8 a4\tweak stencil ##f \5 r8 | }
>>

% Source measure 36
juliaBarAL = <<
  \context Voice = "melody" { \voiceOne b'4.\tweak stencil ##f \3-4 b'8\tweak stencil ##f \3-2 cs''8\tweak stencil ##f \3-4 a'8\tweak stencil ##f \3 | }
  \context Voice = "middle" { \voiceTwo r8 a8\tweak stencil ##f \5-0 fs'8\tweak stencil ##f \4\guideUp #3 g'4.\tweak stencil ##f \4-3 | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 37
juliaBarAM = <<
  \context Voice = "melody" { \voiceOne b'4.\tweak stencil ##f \3-4 b'8\tweak stencil ##f \3-2 cs''8\tweak stencil ##f \3-4 a'8\tweak stencil ##f \3-1 | }
  \context Voice = "middle" { \voiceTwo r8 a8\tweak stencil ##f \5 fs'8\tweak stencil ##f \4\guideUp #3 es'4.\tweak stencil ##f \4-1 | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 38
juliaBarAN = <<
  \context Voice = "melody" { \voiceOne fs'4.\tweak stencil ##f \4-4 <d'\tweak stencil ##f \5\guideUp #3 es'\tweak stencil ##f \4>4. | }
  \context Voice = "middle" { \voiceTwo fs8\tweak stencil ##f \6 a8\tweak stencil ##f \5 cs'8\tweak stencil ##f \5-3 s4. | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 39
juliaBarAO = <<
  \context Voice = "melody" { \voiceOne \break
  
  fs'4.\tweak stencil ##f \4 es'8\tweak stencil ##f \4 fs'8\tweak stencil ##f \4 gs'8\tweak stencil ##f \3-4 | }
  \context Voice = "middle" { \voiceTwo fs8\tweak stencil ##f \6 a8\tweak stencil ##f \5 cs'8\tweak stencil ##f \5 d'4\tweak stencil ##f \5 r8 | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 40
juliaBarAP = <<
  \context Voice = "melody" { \voiceOne \startBarre \markup { \fraction 3 3 "II" }
  a'4\tweak stencil ##f \3 fs''8\tweak stencil ##f \1\stopTextSpan es''4.\tweak stencil ##f \1-2 | }
  \context Voice = "middle" { \voiceTwo r8 cs'8\tweak stencil ##f \5 a'8\tweak stencil ##f \3 b'4.\tweak stencil ##f \2-0 | }
  \context Voice = "bass" { \voiceFour fs4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 41
juliaBarAQ = <<
  \context Voice = "melody" { \voiceOne \startBarre \markup { \fraction 3 3 "II" }
  fs''4.\tweak stencil ##f \1 es''8\tweak stencil ##f \1-2\stopTextSpan fs''8\tweak stencil ##f \1\guideUp #2 gs''8\tweak stencil ##f \1 | }
  \context Voice = "middle" { \voiceTwo r8 cs'8\tweak stencil ##f \5 a'8\tweak stencil ##f \3 b'4.\tweak stencil ##f \2-0 | }
  \context Voice = "bass" { \voiceFour fs4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 42
juliaBarAR = <<
  \context Voice = "melody" { \voiceOne fs''4.\tweak stencil ##f \1^\markup\italic "a" es''4.\tweak stencil ##f \1 | }
  \context Voice = "middle" { \voiceTwo d'8\tweak stencil ##f \4 \startBarre \markup { \fraction 3 3 "I" } gs'8\tweak stencil ##f \3^\markup\italic "i" bs'8\tweak stencil ##f \2^\markup\italic "m" cs'8\tweak stencil ##f \5 gs'8\tweak stencil ##f \3 cs''8\tweak stencil ##f \2\stopTextSpan | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 43
juliaBarAS = <<
  \context Voice = "melody" { \voiceOne \break
  
  r4. e''8\tweak stencil ##f \1-0^\markup\italic "a" fs''8-3\2^\markup\italic "m" g''8\tweak stencil ##f \1^\markup\italic "i" | }
  \context Voice = "middle" { \voiceTwo as8\tweak stencil ##f \5-1 g'8\tweak stencil ##f \4^\markup\italic "i" cs''8\tweak stencil ##f \3^\markup\italic "m" r4. | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 44
juliaBarAT = <<
  \context Voice = "melody" { \voiceOne \acciaccatura { d''8\tweak stencil ##f \2 } d''4.\tweak stencil ##f \2\guideDown #2 ^\markup\italic "m" r4. | }
  \context Voice = "middle" { \voiceTwo b8\tweak stencil ##f \5 fs'8\tweak stencil ##f \4-3_\markup\italic "p" b'8\tweak stencil ##f \3-4 a8\tweak stencil ##f \5 f'8\tweak stencil ##f \4-1 b'8\tweak stencil ##f \2 | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 45
juliaBarAU = <<
  \context Voice = "melody" { \voiceOne r4. e''8-2\2 f''8\tweak stencil ##f \2-4 d''8\tweak stencil ##f \3\guideDown #4 | }
  \context Voice = "middle" { \voiceTwo r8 e'8-4\5 b'8\tweak stencil ##f \2-0 r4. | }
  \context Voice = "bass" { \voiceFour \acciaccatura { fs8\tweak stencil ##f \6 } gs4.\tweak stencil ##f \6\guideUp #3 ~ gs4\tweak stencil ##f \6 r8 | }
>>

% Source measure 46
juliaBarAV = <<
  \context Voice = "melody" { \voiceOne c''4.\tweak stencil ##f \3-1^\markup\italic "m" c''8\tweak stencil ##f \3^\markup\italic "m" e''8\tweak stencil ##f \1-0^\markup\italic "a" a''8\tweak stencil ##f \1-2~^\markup\italic "m" | }
  \context Voice = "middle" { \voiceTwo r8 e'8\tweak stencil ##f \5_\markup\italic "p" a'8\tweak stencil ##f \4^\markup\italic "i" r4. | }
  \context Voice = "bass" { \voiceFour a4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 47
juliaBarAW = <<
  \context Voice = "melody" { \voiceOne \break
  
  a''8\tweak stencil ##f \1 a''8\tweak stencil ##f \1 b''8\tweak stencil ##f \1 \acciaccatura { a''16\tweak stencil ##f \1-2( b''16\tweak stencil ##f \1-4) }
    a''8\tweak stencil ##f \2^\markup\italic "m" e''8\tweak stencil ##f \1^\markup\italic "i" b'8\tweak stencil ##f \2-0 | }
  \context Voice = "middle" { \voiceTwo s4. <b'\tweak stencil ##f \4-1 f''\tweak stencil ##f \3-1>4. | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 48
juliaBarAX = <<
  \context Voice = "melody" { \voiceOne r8 e'8\tweak stencil ##f \4 a'8\tweak stencil ##f \3 c''8\tweak stencil ##f \3 e''8\tweak stencil ##f \2 a''8\tweak stencil ##f \1~ | }
  \context Voice = "middle" { \voiceTwo s4. s4. | }
  \context Voice = "bass" { \voiceFour a4.\tweak stencil ##f \5-0 r4. | }
>>

% Source measure 49
juliaBarAY = <<
  \context Voice = "melody" { \voiceOne a''8\tweak stencil ##f \1 a''8\tweak stencil ##f \1 b''8\tweak stencil ##f \1 \acciaccatura { a''16\tweak stencil ##f \1( b''16\tweak stencil ##f \1) } a''8\tweak stencil ##f \2 e''8\tweak stencil ##f \1 b'8\tweak stencil ##f \2 | }
  \context Voice = "middle" { \voiceTwo s4. <b'\tweak stencil ##f \4 f''\tweak stencil ##f \3>4. | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 50
juliaBarAZ = <<
  \context Voice = "melody" { \voiceOne a8\tweak stencil ##f \5 e'8\tweak stencil ##f \5 a'8\tweak stencil ##f \4 \startBarre \markup { \fraction 6 6 "V" } c''8\tweak stencil ##f \3 e''8\tweak stencil ##f \1-0 a''8\tweak stencil ##f \1-1 \break | }
  \context Voice = "middle" { \voiceTwo s4. s4. | }
  \context Voice = "bass" { \voiceFour a4.\tweak stencil ##f \6 r4. | }
>>

% Source measure 51
juliaBarBA = <<
  \context Voice = "melody" { \voiceOne \break
  
  g8\tweak stencil ##f \6 e'8\tweak stencil ##f \5 a'8\tweak stencil ##f \4 cs''8\tweak stencil ##f \3 e''8\tweak stencil ##f \2\stopTextSpan
    \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #19 a''8\4^\markup\center-column { "RH" "h.XIX" } | }
  \context Voice = "middle" { \voiceTwo s4. s4. | }
  \context Voice = "bass" { \voiceFour g4.\tweak stencil ##f \6 r4. | }
>>

% Source measure 52
juliaBarBB = <<
  \context Voice = "melody" { \voiceOne \startBarre \markup { \fraction 6 6 "IV" }
  fs8\tweak stencil ##f \6 ef'8\tweak stencil ##f \5 a'8\tweak stencil ##f \4 c''8\tweak stencil ##f \3 ef''8\tweak stencil ##f \2\stopTextSpan
    \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #19 a''8\4^\markup\center-column { "RH" "h.XIX" } | }
  \context Voice = "middle" { \voiceTwo s4. s4. | }
  \context Voice = "bass" { \voiceFour fs4.\tweak stencil ##f \6 r4. | }
>>

% Source measure 53
juliaBarBC = <<
  \context Voice = "melody" { \voiceOne \startBarre \markup { \fraction 6 6 "III" }
  f8\tweak stencil ##f \6 d'8\tweak stencil ##f \4 g'8\tweak stencil ##f \3 b'8\tweak stencil ##f \2 d''8\tweak stencil ##f \2\stopTextSpan
    \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #19 a''8\4^\markup\center-column { "RH" "h.XIX" } | }
  \context Voice = "middle" { \voiceTwo s4._\markup\italic "rall. assai" s4. | }
  \context Voice = "bass" { \voiceFour f4.\tweak stencil ##f \6 r4. | }
>>

% Source measure 54
juliaBarBD = <<
  \context Voice = "melody" { \voiceOne \startBarre \markup { \fraction 6 6 "II" }
  e8\tweak stencil ##f \6 cs'8\tweak stencil ##f \5-2 g'8\tweak stencil ##f \4-4 b'8\tweak stencil ##f \3-3 cs''8\tweak stencil ##f \2\stopTextSpan
    \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #19 a''8\4\fermata^\markup\center-column { "RH" "h.XIX" }  \textEndMark \markup\italic "D.C. al Coda"
   \break | }
  \context Voice = "middle" { \voiceTwo s4. s4.\fermata | }
  \context Voice = "bass" { \voiceFour e4.\tweak stencil ##f \6-1 r4. | }
>>

% Source measure 55
juliaBarBE = <<
  \context Voice = "melody" { \voiceOne \mark \markup { \musicglyph "scripts.coda" "Coda" }
  <fs'\tweak stencil ##f \4-3 d''\tweak stencil ##f \2-2 a''\tweak stencil ##f \1-4>4. \startBarre \markup { \fraction 4 4 "V" }
    a''8\tweak stencil ##f \1 b''8\tweak stencil ##f \1-4 a''8\tweak stencil ##f \1\stopTextSpan | }
  \context Voice = "middle" { \voiceTwo r8 a8\tweak stencil ##f \5 fs'8\tweak stencil ##f \4-1 <g'\tweak stencil ##f \4\guideUp #1 cs''\tweak stencil ##f \3 e''\tweak stencil ##f \2>4. | }
  \context Voice = "bass" { \voiceFour d4.\tweak stencil ##f \6 s4. | }
>>

% Source measure 56
juliaBarBF = <<
  \context Voice = "melody" { \voiceOne a''4.\tweak stencil ##f \1-3 r4. | }
  \context Voice = "middle" { \voiceTwo d8\tweak stencil ##f \6 fs8\tweak stencil ##f \6 a8\tweak stencil ##f \5 d'8\tweak stencil ##f \4-0 fs'8-1\5 \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #12 a'8-4\5^"h.XII" | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 57
juliaBarBG = <<
  \context Voice = "melody" { \voiceOne \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #12 d''8-4\4 \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #9 fs''8\6^"h.IX"
    \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #7 a''8\4 \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #7 d'''8\3^"h.VII"
    \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-touch-fret #7 fs'''8\2
    \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-sounding-octaves #1 \tweak details.sotto-base-fret #10 \tweak details.sotto-touch-fret #22 a''8-3\2^\markup\center-column { "8va" "a.h." } | }
  \context Voice = "middle" { \voiceTwo s2. | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 58
juliaBarBH = <<
  \context Voice = "melody" { \voiceOne \once \override NoteHead.style = #'harmonic-black \tweak details.sotto-base-fret #3 \tweak details.sotto-touch-fret #15 d'''4.-4\2^"a.h."\p
    <\tweak details.sotto-touch-fret #4 \tweak style #'harmonic-black fs''-4\6 \tweak details.sotto-touch-fret #7 \tweak style #'harmonic-black a''-7\4 \tweak details.sotto-touch-fret #7 \tweak style #'harmonic-black d'''-7\3>4.\arpeggio\pp^"h." | }
  \context Voice = "middle" { \voiceTwo s2. | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

% Source measure 59
juliaBarBI = <<
  \context Voice = "melody" { \voiceOne <\tweak details.sotto-touch-fret #12 \tweak style #'harmonic d'\6 \tweak details.sotto-touch-fret #12 \tweak style #'harmonic d''\4>2.\ppp | }
  \context Voice = "middle" { \voiceTwo s2. | }
  \context Voice = "bass" { \voiceFour s2. | }
>>

\score {
 \new Staff = "guitar" \with {
  instrumentName = "Guitar" midiInstrument = "acoustic guitar (nylon)"
  \override StringNumber.font-size = #-2
  \override Fingering.font-size = #-5
 } \fingeringsToChords {
   \global \mergeDifferentlyDottedOn \mergeDifferentlyHeadedOn 
   \juliaBarA \juliaBarB \juliaBarC \juliaBarD \juliaBarE \juliaBarF \juliaBarG \juliaBarH \juliaBarI \juliaBarJ \juliaBarK \juliaBarL \juliaBarM \juliaBarN \juliaBarO \juliaBarP \juliaBarQ \juliaBarR \juliaBarS \juliaBarT \bar ".|:" \repeat volta 2 { \juliaBarU \juliaBarV \juliaBarW \juliaBarX \juliaBarY \juliaBarZ \juliaBarAA \juliaBarAB \juliaBarAC \juliaBarAD } \alternative { { \juliaBarAE \juliaBarAF } { \juliaBarAG \juliaBarAH } } \juliaBarAI \juliaBarAJ \juliaBarAK \juliaBarAL \juliaBarAM \juliaBarAN \juliaBarAO \juliaBarAP \juliaBarAQ \juliaBarAR \juliaBarAS \juliaBarAT \juliaBarAU \juliaBarAV \juliaBarAW \juliaBarAX \juliaBarAY \juliaBarAZ \juliaBarBA \juliaBarBB \juliaBarBC \juliaBarBD \juliaBarBE \juliaBarBF \juliaBarBG \juliaBarBH \juliaBarBI \bar "|."
 }
 \layout {
    indent = 0
    \context {
      \Voice
      fingeringOrientations = #'(left)
      \override Fingering.staff-padding = #'()
      \override Fingering.add-stem-support = ##t
      \override Fingering.padding = #0.35
    }
    \context {
      \Score
      barNumberVisibility = #first-bar-number-invisible-save-broken-bars
      \override BarNumber.break-visibility = ##(#f #f #t)
      \override BarNumber.font-size = #0
      \override BarNumber.stencil = #(make-stencil-boxer 0.1 0.4 ly:text-interface::print)
      \override RehearsalMark.self-alignment-X = #LEFT
    }
    \context { \Staff \override TextSpanner.staff-padding = #4 \consists #julia-slide-engraver }
    \context { \TabStaff \consists #julia-slide-engraver }
  }
    \midi {}
}
\markup \small \column {
  \line { "RH h.XIX: right-hand-only harmonics.  a.h.: artificial harmonics." }
  \line { "Sixth string tuned to D. Guitar notation sounds one octave below written pitch." }
}
