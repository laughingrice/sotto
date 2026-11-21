% Prototype-only adapter. Event tags are assigned in the shared source music,
% before it is reused by Staff and TabStaff. Never use engraving order as ID.
#(define prototype-port (open-output-file "visuals.tsv"))
#(define prototype-systems (make-hash-table))
#(define prototype-system-counter 0)
#(define (prototype-system-id grob)
   (let* ((system (ly:grob-system grob))
          (known (hashq-ref prototype-systems system)))
     (if known known
       (let ((id (number->string prototype-system-counter)))
         (set! prototype-system-counter (+ prototype-system-counter 1))
         (hashq-set! prototype-systems system id) id))))
#(define prototype-staff-engraver
   (lambda (context)
     (make-engraver
       (acknowledgers
         ((staff-symbol-interface engraver grob source)
           (ly:grob-set-property! grob 'after-line-breaking
             (lambda (piece)
               (ly:grob-set-property! piece 'output-attributes
                 `((class . "sotto-staff-geometry")
                   (data-system . ,(prototype-system-id piece)))))))
         ((bar-line-interface engraver grob source)
           (let ((boundary (- (ly:context-property context 'currentBarNumber 1) 1)))
             (ly:grob-set-property! grob 'after-line-breaking
               (lambda (piece)
                 (ly:grob-set-property! piece 'output-attributes
                   `((class . "sotto-bar-boundary") (data-boundary . ,(number->string boundary))
                     (data-system . ,(prototype-system-id piece))))))))))))
#(define prototype-note-engraver
   (lambda (context)
     (let ((pending '()) (tied #f))
       (make-engraver
         (listeners
           ((tie-event engraver event) (set! tied #t))
           ((note-event engraver event) (practice-event context event practice-written-port))
           ((rest-event engraver event) (practice-event context event practice-written-port))
           ((multi-measure-rest-event engraver event) (practice-event context event practice-written-port)))
         (acknowledgers
           ((note-head-interface engraver grob source)
             (let* ((event (ly:grob-property grob 'cause))
                    (tags (ly:event-property event 'tags))
                    (identity (if (= (length tags) 1) (symbol->string (car tags))
                                (ly:error "Every prototype note needs one semantic event tag.")))
                    (voice (practice-voice-id context))
                    (tab (eq? (grob::name grob) 'TabNoteHead))
                    (kind (if tab "tabs" "notation"))
                    (string-event (find (lambda (item) (number? (if (ly:music? item) (ly:music-property item 'string-number) (ly:event-property item 'string-number))))
                                       (ly:event-property event 'articulations)))
                    (string (if tab
                      ;; Tab engravers consume string post-events. Record the
                      ;; actual rendered string, then compare with Staff data.
                      (inexact->exact (round (/ (- (+ 1 (length (ly:context-property context 'stringTunings))) (ly:grob-property grob 'staff-position)) 2)))
                      (if string-event (if (ly:music? string-event) (ly:music-property string-event 'string-number) (ly:event-property string-event 'string-number)) 0))))
               (ly:grob-set-property! grob 'output-attributes
                 `((id . ,(if tab (string-append "tabs-" identity) identity)) (class . "score-note")
                   (data-event-id . ,identity) (data-voice . ,voice) (data-representation . ,kind)))
               (set! pending (cons
                 (list identity voice (practice-beats (ly:context-current-moment context))
                   (practice-midi-pitch context event)
                   (practice-beats (ly:duration->moment (ly:event-property event 'duration)))
                   string kind) pending)))))
         ((stop-translation-timestep engraver)
           (for-each (lambda (row)
             (display (string-join (map (lambda (item) (format #f "~a" item)) (append row (list (if tied 1 0)))) "\t") prototype-port)
             (newline prototype-port)) (reverse pending))
           (force-output prototype-port) (set! pending '()) (set! tied #f))))))
