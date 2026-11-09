% Export notehead identities, timing and voice membership with the SVG.
% The original score does not need individual note annotations.
#(define practice-port (open-output-file "events.tsv"))
#(define practice-counter 0)
#(define (practice-beats moment)
   (* 4.0 (/ (ly:moment-main-numerator moment)
             (ly:moment-main-denominator moment))))
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
