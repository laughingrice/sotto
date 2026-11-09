% Export notehead identities, timing and voice membership with the SVG.
% The original score does not need individual note annotations.
#(define practice-port (open-output-file "events.tsv"))
#(define practice-counter 0)
#(define practice-measure-port (open-output-file "measures.tsv"))
#(define (practice-beats moment)
   (if (number? moment) (* 4.0 moment)
     (* 4.0 (/ (ly:moment-main-numerator moment)
               (ly:moment-main-denominator moment)))))
% Read Timing after its translators have advanced, including silent bars,
% pickups and changes of meter. Keep the final moment to end the last bar.
#(define practice-timing-engraver
   (lambda (context)
     (make-engraver
       ((stop-translation-timestep engraver)
         (let* ((moment (ly:context-current-moment context))
                (position (ly:context-property context 'measurePosition ZERO-MOMENT))
                (length (ly:context-property context 'measureLength (ly:make-moment 1)))
                (meter (ly:context-property context 'timeSignatureFraction '(4 . 4))))
           (format practice-measure-port "~a\t~a\t~a\t~a\t~a\t~a\t~a\n"
             (practice-beats moment) (practice-beats position)
             (practice-beats length) (ly:context-property context 'currentBarNumber 1)
             (car meter) (cdr meter) (if (ly:context-property context 'timing #t) 1 0))
           (force-output practice-measure-port))))))
#(define practice-engraver
   (lambda (context)
     (let ((pending '()) (tied #f))
       (make-engraver
         (listeners ((tie-event engraver event) (set! tied #t)))
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
