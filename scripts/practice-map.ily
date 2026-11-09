% Export notehead identities, timing and voice membership with the SVG.
% The original score does not need individual note annotations.
#(define practice-port (open-output-file "events.tsv"))
#(define practice-counter 0)
#(define practice-measure-port (open-output-file "measures.tsv"))
#(define practice-written-port (open-output-file "written-events.tsv"))
#(define practice-played-port (open-output-file "played-events.tsv"))
#(define practice-played-measure-port (open-output-file "played-measures.tsv"))
#(define (practice-origin event)
   (let ((location (ly:input-file-line-char-column (ly:event-property event 'origin))))
     (format #f "~a:~a:~a" (car location) (cadr location) (caddr location))))
#(define (practice-event context event port)
   (format port "~a\t~a\t~a\t~a\n" (practice-beats (ly:context-current-moment context))
     (ly:context-id context) (practice-origin event)
     (practice-beats (ly:duration->moment (ly:event-property event 'duration))))
   (force-output port))
#(define (practice-beats moment)
   (if (number? moment) (* 4.0 moment)
     (* 4.0 (/ (ly:moment-main-numerator moment)
               (ly:moment-main-denominator moment)))))
% Read Timing after its translators have advanced, including silent bars,
% pickups and changes of meter. Keep the final moment to end the last bar.
#(define (practice-write-timing context port)
         (let* ((moment (ly:context-current-moment context))
                (position (ly:context-property context 'measurePosition ZERO-MOMENT))
                (length (ly:context-property context 'measureLength (ly:make-moment 1)))
                (meter (ly:context-property context 'timeSignatureFraction '(4 . 4))))
           (format port "~a\t~a\t~a\t~a\t~a\t~a\t~a\n"
             (practice-beats moment) (practice-beats position)
             (practice-beats length) (ly:context-property context 'currentBarNumber 1)
             (car meter) (cdr meter) (if (ly:context-property context 'timing #t) 1 0))
           (force-output port)))
#(define practice-timing-engraver
   (lambda (context)
     (make-engraver
       ((stop-translation-timestep engraver)
         (practice-write-timing context practice-measure-port)))))
#(define practice-timing-performer
   (lambda (context)
     (make-performer
       ((stop-translation-timestep performer)
         (practice-write-timing context practice-played-measure-port)))))
#(define practice-event-performer
   (lambda (context)
     (make-performer
       (listeners
         ((note-event performer event) (practice-event context event practice-played-port))
         ((rest-event performer event) (practice-event context event practice-played-port))
         ((multi-measure-rest-event performer event) (practice-event context event practice-played-port))))))
#(define practice-engraver
   (lambda (context)
     (let ((pending '()) (tied #f))
       (make-engraver
         (listeners
           ((tie-event engraver event) (set! tied #t))
           ((note-event engraver event) (practice-event context event practice-written-port))
           ((rest-event engraver event) (practice-event context event practice-written-port))
           ((multi-measure-rest-event engraver event) (practice-event context event practice-written-port)))
         (acknowledgers
           ((note-head-interface engraver grob source-engraver)
             (let* ((event (ly:grob-property grob 'cause))
                    (pitch (ly:event-property event 'pitch))
                    (duration (ly:event-property event 'duration))
                    (moment (ly:context-current-moment context))
                    (score (ly:context-find context 'Score))
                    (bar (ly:context-property score 'currentBarNumber 1))
                    (voice (ly:context-id context))
                    (id (format #f "practice-note-~a" practice-counter))
                    (grace (* 4.0 (/ (ly:moment-grace-numerator moment)
                                     (ly:moment-grace-denominator moment)))))
               (set! practice-counter (+ practice-counter 1))
               (ly:grob-set-property! grob 'output-attributes
                 `((id . ,id) (class . "score-note") (data-voice . ,voice)))
               (set! pending (cons
                 (list id voice (practice-beats moment) grace
                   (+ 60 (ly:pitch-semitones pitch))
                   (practice-beats (ly:duration->moment duration)) bar)
                 pending)))))
         ((stop-translation-timestep engraver)
           (for-each
             (lambda (row)
               (display (string-join (map (lambda (value) (format #f "~a" value))
                 (append row (list (if tied 1 0)))) "\t") practice-port)
               (newline practice-port)) (reverse pending))
           (force-output practice-port)
           (set! pending '())
           (set! tied #f))))))

% Capture parsed music before LilyPond renders it. Reuse the exact same music
% objects/source locations to link an unfolded performance to printed measures.
#(define practice-scores '())
#(define (practice-capture score)
   (if (ly:score? score) (set! practice-scores (append practice-scores (list score)))))
#(define practice-original-score-handler toplevel-score-handler)
#(define toplevel-score-handler
   (lambda (score) (practice-capture score) (practice-original-score-handler score)))
#(define practice-original-book-score-handler book-score-handler)
#(define book-score-handler
   (lambda (book score) (practice-capture score) (practice-original-book-score-handler book score)))
#(define practice-original-bookpart-score-handler bookpart-score-handler)
#(define bookpart-score-handler
   (lambda (book score) (practice-capture score) (practice-original-bookpart-score-handler book score)))

practiceMidi = \midi {
  \context { \Score \consists #practice-timing-performer }
  \context { \Voice \consists #practice-event-performer }
}
#(define (practice-export-playback)
   (let* ((midi-scores (filter (lambda (score)
                   (any (lambda (output) (eq? (ly:output-def-lookup output 'output-def-kind #f) 'midi))
                     (ly:score-output-defs score))) practice-scores))
          (choices (if (null? midi-scores) practice-scores midi-scores)))
     (if (not (= (length choices) 1))
       (ly:error "Sotto needs one engraved score and at most one MIDI playback score."))
     (ly:run-translator
       ;; Parsed scores cache lengths before repeats have been unfolded.
       ;; Clear those caches on the copy or interpretation can stop early.
       (music-map (lambda (music)
           (set! (ly:music-property music 'length) '()) music)
         (unfold-repeats '() (ly:music-deep-copy (ly:score-music (car choices)))))
       practiceMidi)))
