% Export notehead identities, timing and voice membership with the SVG.
% The original score does not need individual note annotations.
#(define practice-port (open-output-file "events.tsv"))
#(define practice-counter 0)
#(define practice-measure-port (open-output-file "measures.tsv"))
#(define practice-written-port (open-output-file "written-events.tsv"))
#(define practice-played-port (open-output-file "played-events.tsv"))
#(define practice-played-measure-port (open-output-file "played-measures.tsv"))
#(define (practice-voice-id context)
   (let* ((id (ly:context-id context))
          (staff (ly:context-find context 'Staff)))
     ;; LilyPond numbers anonymous polyphonic voices independently per staff.
     ;; Keep their identities distinct in multi-instrument and piano scores.
     (if (and staff (or (string-null? id) (string->number id)))
         (string-append (ly:context-id staff) ":" id)
         id)))
#(define (practice-origin event)
   (let ((location (ly:input-file-line-char-column (ly:event-property event 'origin))))
     (format #f "~a:~a:~a" (car location) (cadr location) (caddr location))))
#(define (practice-event context event port)
   (format port "~a\t~a\t~a\t~a\n" (practice-beats (ly:context-current-moment context))
     (practice-voice-id context) (practice-origin event)
     (practice-beats (ly:duration->moment (ly:event-property event 'duration))))
   (force-output port))
#(define (practice-beats moment)
   (if (number? moment) (* 4.0 moment)
     (* 4.0 (/ (ly:moment-main-numerator moment)
               (ly:moment-main-denominator moment)))))
% Drum note events carry drum-type instead of pitch. Use the same mapping as
% LilyPond's MIDI performer, including a score's custom drumPitchTable.
#(define (practice-midi-pitch context event)
   (let* ((drum (ly:event-property event 'drum-type))
          (pitch (if (symbol? drum)
                     (hashq-ref (ly:context-property context 'drumPitchTable
                                  (alist->hash-table midiDrumPitches)) drum)
                     (ly:event-property event 'pitch)))
          (transposition (ly:context-property context 'instrumentTransposition))
          (octaves (or (assoc-ref (ly:event-property event 'tweaks) '(#t details sotto-sounding-octaves))
                       (assoc-ref (ly:event-property event 'tweaks) '(details sotto-sounding-octaves)) 0)))
     (if (not (and (integer? octaves) (<= -2 octaves 2)))
         (ly:error "Sounding octave correction must be an integer from -2 to 2."))
     (if (not (ly:pitch? pitch))
         (ly:error "Sotto cannot resolve MIDI pitch for note ~a" drum))
     (+ 60 (ly:pitch-semitones pitch)
        (if (and (not (symbol? drum)) (ly:pitch? transposition))
            (ly:pitch-semitones transposition) 0)
        (if (symbol? drum) 0 (* 12 octaves)))))
% Export parsed header/tempo values, so includes, variables and markup work.
#(define practice-tempo-port (open-output-file "tempos.jsonl"))
#(define (practice-json-string value port)
   (write-char #\" port)
   (for-each (lambda (c)
     (case c
       ((#\") (display "\\\"" port))
       ((#\\) (display "\\\\" port))
       ((#\newline) (display "\\n" port))
       ((#\return) (display "\\r" port))
       ((#\tab) (display "\\t" port))
       (else (if (< (char->integer c) 32)
                 (format port "\\u~4,'0x" (char->integer c))
                 (write-char c port))))) (string->list value))
   (write-char #\" port))
#(define (practice-write-tempo context event)
   (let* ((unit (ly:event-property event 'tempo-unit))
          (count (ly:event-property event 'metronome-count))
          (bpm (cond ((number? count) count)
                     ((number-pair? count) (/ (+ (car count) (cdr count)) 2))
                     (else #f))))
     (format practice-tempo-port "{\"beat\":~a,\"unit\":~a,\"bpm\":~a,\"text\":"
       (practice-beats (ly:context-current-moment context))
       (if (ly:duration? unit) (practice-beats (ly:duration->moment unit)) "null")
       (if bpm (exact->inexact bpm) "null"))
     (practice-json-string (markup->string (ly:event-property event 'text)) practice-tempo-port)
     (display "}\n" practice-tempo-port)
     (force-output practice-tempo-port)))
#(define practice-header-scopes '())
#(define (practice-write-header score midi-quarter-bpm)
   (let* ((headers (assq-ref practice-header-scopes score))
          (port (open-output-file "header.json")))
     (display "{" port)
     (for-each (lambda (field)
       (if (not (eq? field 'title)) (display "," port))
       (practice-json-string (symbol->string field) port)
       (display ":" port)
       (practice-json-string (markup->string (ly:modules-lookup headers field)) port))
       '(title composer subtitle))
     (format port ",\"midiQuarterBpm\":~a}\n" (or midi-quarter-bpm "null"))
     (close-output-port port)))

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
       (listeners
         ((tempo-change-event engraver event) (practice-write-tempo context event)))
       ((stop-translation-timestep engraver)
         (practice-write-timing context practice-measure-port)))))
#(define practice-timing-performer
   (lambda (context)
     (make-performer
       (listeners
         ((tempo-change-event performer event) (practice-write-tempo context event)))
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
                    (percussion (symbol? (ly:event-property event 'drum-type)))
                    (duration (ly:event-property event 'duration))
                    (moment (ly:context-current-moment context))
                    (score (ly:context-find context 'Score))
                    (bar (ly:context-property score 'currentBarNumber 1))
                    (voice (practice-voice-id context))
                    (id (format #f "practice-note-~a" practice-counter))
                    (grace (* 4.0 (/ (ly:moment-grace-numerator moment)
                                     (ly:moment-grace-denominator moment)))))
               (set! practice-counter (+ practice-counter 1))
               (ly:grob-set-property! grob 'output-attributes
                 `((id . ,id) (class . "score-note") (data-voice . ,voice)))
               (set! pending (cons
                 (list id voice (practice-beats moment) grace
                   (practice-midi-pitch context event)
                   (practice-beats (ly:duration->moment duration)) bar
                   (if percussion 1 0))
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
#(define (practice-capture score . books)
   (if (ly:score? score)
     (begin
       (set! practice-scores (append practice-scores (list score)))
       (set! practice-header-scopes
         (acons score (filter module?
           (append (list (ly:score-header score))
             (map ly:book-header (append books (filter ly:book?
               (list (ly:parser-lookup '$current-bookpart) (ly:parser-lookup '$current-book)))))
             (list (ly:parser-lookup '$defaultheader)))) practice-header-scopes)))))
#(define practice-original-score-handler toplevel-score-handler)
#(define toplevel-score-handler
   (lambda (score) (practice-capture score) (practice-original-score-handler score)))
#(define practice-original-book-score-handler book-score-handler)
#(define book-score-handler
   (lambda (book score) (practice-capture score book) (practice-original-book-score-handler book score)))
#(define practice-original-bookpart-score-handler bookpart-score-handler)
#(define bookpart-score-handler
   (lambda (book score) (practice-capture score book) (practice-original-bookpart-score-handler book score)))

practiceMidi = \midi {
  \context { \Score \consists #practice-timing-performer }
  \context { \Voice \consists #practice-event-performer }
  \context { \DrumVoice \consists #practice-event-performer }
}
% A MIDI block can set its initial tempo without a visible tempo event.
% Explicit assignments precede the inherited Score default in property-ops.
#(define (practice-midi-quarter-bpm score)
   (any (lambda (output)
     (and (eq? (ly:output-def-lookup output 'output-def-kind #f) 'midi)
       (let* ((context (ly:output-def-lookup output 'Score))
              (ops (ly:context-def-lookup context 'property-ops))
              (tempos (filter (lambda (op)
                (and (eq? (car op) 'assign) (eq? (cadr op) 'tempoWholesPerMinute))) ops)))
         (and (> (length tempos) 1)
           (practice-beats (caddar tempos)))))) (ly:score-output-defs score)))
#(define (practice-export-playback)
   (let* ((midi-scores (filter (lambda (score)
                   (any (lambda (output) (eq? (ly:output-def-lookup output 'output-def-kind #f) 'midi))
                     (ly:score-output-defs score))) practice-scores))
          (choices (if (null? midi-scores) practice-scores midi-scores)))
     (if (not (= (length choices) 1))
       (ly:error "Sotto needs one engraved score and at most one MIDI playback score."))
     (let ((engraved (filter (lambda (score)
                (any (lambda (output) (eq? (ly:output-def-lookup output 'output-def-kind #f) 'layout))
                  (ly:score-output-defs score))) practice-scores)))
       (practice-write-header (if (pair? engraved) (car engraved) (car practice-scores))
         (practice-midi-quarter-bpm (car choices))))
     (ly:run-translator
       ;; Parsed scores cache lengths before repeats have been unfolded.
       ;; Clear those caches on the copy or interpretation can stop early.
       (music-map (lambda (music)
           (set! (ly:music-property music 'length) '()) music)
         (unfold-repeats '() (ly:music-deep-copy (ly:score-music (car choices)))))
       practiceMidi)))
