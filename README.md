# Sotto v0.3

A local web practice player, starting with Julia Florida. React + TypeScript + Vite, Tone.js/Web Audio, and LilyPond SVG engraving. No accounts or cloud uploads. The bundled instrument recordings, synthesized timbres, and metronome work offline.

**New piece? Start with [Prepare a new score](#prepare-a-new-score).**

## Deploy to GitHub Pages

The repository includes a workflow that tests, builds, and publishes the static app. No LilyPond installation or server is needed for deployment: the compiled example score is already included.

1. Open [repository Settings → Pages](https://github.com/laughingrice/sotto/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open [Actions → Deploy Sotto to GitHub Pages](https://github.com/laughingrice/sotto/actions/workflows/pages.yml), select **Run workflow**, choose **main**, and run it.
4. Once the deployment finishes, visit **https://laughingrice.github.io/sotto/**.

Subsequent pushes to `main` test and deploy automatically. Before Pages is enabled, the workflow still builds and tests successfully and skips publication. The `v0.1` tag records the first release; `v0.2` includes full-bar highlighting, expanded score/zoom controls, an accented standalone metronome, and recorded nylon-guitar, piano and violin playback. The `v0.3` release adds a persistent file/folder library, improved repeat and meter handling, microphone rhythm feedback with baseline learning and loop history, compact practice controls, a one-bar count-in, and Off/Playback/Continuous metronome modes.

To preview the same `/sotto/` deployment path locally:

```sh
npm run build:pages
npm run preview -- --base=/sotto/ --port 4174
```

Open `http://localhost:4174/sotto/`. Asset URLs, the example score, web app manifest, and offline service worker all support the repository subdirectory.

On iPad, open the deployed HTTPS site in Safari and use **Share → Add to Home Screen** for a standalone view. Let it load online once before using it offline.

## Run

Requires Node.js 22.12+ (or a supported newer version).

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. On a tablet on the same Wi-Fi, open Vite's **Network** URL. Your computer must remain on and the server must keep running. Actual iPad/Safari hardware has not yet been tested.

For an optimized build:

```sh
npm run build
npm run preview -- --port 4173
```

The production build includes a service worker that caches the app, built-in score, and synthesizer code for offline use on a secure origin (HTTPS or localhost). A plain HTTP LAN address works for online playback but does not enable service workers or microphone access. Deploy the `dist/` folder to an HTTPS static host for installable, offline tablet use.

## Included

- Actual LilyPond SVG pages with individual notehead IDs and voice membership.
- Playback with a full-bar highlight, simultaneous active-note highlighting, and automatic scrolling. Bar highlights also work with existing score bundles.
- Click-to-seek, pause/resume, restart, previous/next bar, and scrubber.
- Tempo control measured in dotted-quarter beats for Julia Florida.
- Piece details in the settings panel; Open and Save score together in the top bar.
- Hide/show all practice controls to give the score the full viewport, with compact restart, previous/next bar, play/pause and listening buttons. The ear button starts/stops the microphone directly; the microphone icon still shows/hides the feedback strip. The setting is remembered and playback continues while controls are hidden.
- The score panel fills the available browser width. Zoom ranges from 50–250%; click the percentage to fit the page to the available width again. Enlarged pages can be panned horizontally, and Follow score keeps the current bar in view in both directions.
- Voice mute, solo, and independent volume.
- Tempo controls reach 220 BPM; imported scores with a faster saved/original tempo remain supported.
- Phrase loops and an accented metronome with beat/subdivision choice and independent click volume. It can click while the score is paused or follow playback.
- Both alternate endings, repeated section, and D.C. al Coda for the example.
- Guitar playback one octave below the written notation, including low D2.
- Instrument selection: recorded nylon guitar, piano and violin, plus synthesized marimba, organ and flute. The recordings are bundled with the app, balanced in level, and cached for offline use.
- Save/open portable `.sotto.json` bundles. Imported SVG is sanitized before rendering.
- Meter changes use exported bar timing for playback, navigation, highlights, and metronome accents.
- A persistent library of file/folder bookmarks, favorites, and a portable settings backup; the last opened song alone is cached for resuming. Granted folder handles are refreshed when Library opens, with separate Refresh and Reconnect actions.
- Microphone rhythm preview: a volume trace, expected/detected attack markers, early/late estimates, input offset and optional speaker calibration. No microphone audio is recorded or uploaded.

Keyboard: **Space** play/pause, **←/→** previous/next bar, **R** restart, **M** metronome, **C** hide/show controls. Space and Left/Right remain transport keys after clicking buttons, checkboxes, sliders or score controls. Holding Space does not repeatedly toggle playback. Text-entry fields and open dialogs keep their normal keyboard behavior; modified browser shortcuts are left alone.

## Prepare a new score

You need **LilyPond 2.26 (including `musicxml2ly`) and Python 3** on the computer preparing the score. Node.js is only needed to run/build Sotto itself. Preparation is local; GitHub Pages does not run LilyPond.

### 1. Get editable notation

- **LilyPond (`.ly`):** use it directly.
- **MusicXML (`.musicxml`, `.xml`, or `.mxl`):** convert it first:

  ```sh
  musicxml2ly --output=my-score.ly my-score.musicxml
  ```

- **PDF:** first transcribe or recognize it into LilyPond/MusicXML and proofread it. The app does not recognize PDF sheet music yet.

The LilyPond file needs a single engraved score (a separate MIDI score is fine), named voices for useful voice controls, and an explicit `\layout { }` block. Start by compiling the `.ly` file normally to catch notation errors.

### 2. Export the player bundle

From this repository's root, for a **quarter-note pulse** (including scores that change meter):

```sh
python3 scripts/export_score.py my-score.ly \
  --title "My score" --composer "Composer" \
  --beat-unit 1 --bpm 80 \
  --output my-score.sotto.json
```

Always pass the `.ly` source path for a custom piece. Omitting it is reserved for rebuilding Julia Florida with no options; custom titles or output paths without a source are rejected. Renaming a bundle does not change its engraved pages, notes or parts. Named voices on separate staves (for example, Violin I and Violin II) export as independent parts, in score order, with separate colors and mute/solo/volume controls.

For **6/8 guitar**, with a dotted-quarter pulse:

```sh
python3 scripts/export_score.py my-score.ly \
  --title "My score" --composer "Composer" \
  --beat-unit 1.5 --bpm 44 \
  --output my-score.sotto.json
```

| Option | Meaning |
| --- | --- |
| `--beats-per-bar` | Deprecated and ignored. Actual bar starts, durations, and time signatures come from LilyPond’s Timing context, including meter changes and pickups. |
| `--beat-unit` | Tempo pulse in quarter-note units: 1 for a quarter, 1.5 for a dotted quarter. This also sets the metronome beat. |
| `--bpm` | Number of those pulses per minute. |
| `--transpose` | Additional semitone offset **after** LilyPond’s `\transpose`. Defaults to 0 for imported pieces. Use -12 only when the exported pitches are still in the written guitar octave. |

The export contains SVG score pages, notehead identities, note timings, voices, ties, bar numbers, and playback metadata in one portable file. No separate PDF, MIDI, or audio file is needed. Playback instrument selection changes the timbre. Sound settings also offer a temporary playback-octave adjustment for older bundles.

**Capricho Árabe:** this source already wraps its music in `\transpose c c,`, lowering it once. Export it with **`--transpose 0`** (or omit that option); -12 would lower it twice. A guitar clef alone does not establish whether the source pitches have already been transposed. The exporter reads compiled pitches rather than guessing from the instrument name. Meter changes are automatic: the opening eight bars are 3/4, bar 9 starts 4/4, and the final cadenza retains its actual five-quarter duration. Re-export older bundles to obtain the new timing metadata; changing the player alone cannot recover missing boundaries reliably.

### 3. Open it on any device

Transfer `my-score.sotto.json` to the tablet using Files, AirDrop, or a file-sharing service, open Sotto, and choose **Open score**. Select the bundle. This reads it locally; it does not upload the file. You can also use **Save score** to download a copy.

The last song is cached for resuming across reloads; **Library** remembers the other score bookmarks and favorites. See the library workflow below.

### Rebuild the included example

The editable example is `scores/julia-florida.ly`. After editing it:

```sh
npm run export:score
```

This regenerates `public/scores/julia-florida.sotto.json`. The exporter installs a custom engraver that writes note IDs, durations, voices, ties, score positions and measure numbers while LilyPond renders SVG. Repeated performances reference the same notehead IDs. For new pieces, the exporter unfolds LilyPond’s structured repeats and uses the source locations of notes/rests to map each playback measure back to its printed measure.

### Where scores are stored, and what “Open” means

The example is committed to this repository in two forms:

- `scores/julia-florida.ly`: editable notation source.
- `public/scores/julia-florida.sotto.json`: rendered SVG pages, note timings, voices, metadata, and playback sequence. This is what the deployed app downloads.

The browser caches the built-in bundle for offline use; the cache is not the original or only copy. **Open score** reads a `.sotto.json` file locally and remembers a bookmark in Library. It does not upload anything to GitHub or to a server, and a page reload resumes your last song. Keep your bundle file as the original; **Save score** downloads a separate copy only when requested.

To publish a different built-in score for everyone, commit its `.ly` source under `scores/` and its bundle under `public/scores/`, then change `DEFAULT_SCORE` in `src/App.tsx` to that bundle's URL, using `import.meta.env.BASE_URL` as the prefix. Push to `main`; GitHub Actions rebuilds and deploys. Simply adding a file to the repo does not list it in the app: the personal Library lists files/folders you choose, rather than scanning the deployed repository.

The exporter requires a single engraved score, an explicit `\layout { }` block, and named voices for meaningful part controls. It reads actual measure timing from LilyPond, including changing meters, silent measures, pickups, and a final cadenza. The exporter unfolds structured repeats (including nested repeats and alternate endings). If there is a MIDI score, it uses that score’s music for playback order; otherwise it unfolds the engraved score. Printed and MIDI versions must share named voices and underlying measure definitions so source locations can link them reliably. Ambiguous mappings fail explicitly. Tempo maps and `\transposition` instrument metadata still need a more general importer. Julia Florida retains its existing explicit navigation map. Export only LilyPond files you trust, since the compiler executes Scheme.

### Repeats, D.S. and coda

Use LilyPond’s structured repeats (`\repeat volta` and `\alternative`) for repeated sections. The exporter unfolds them automatically. For D.S./D.C./coda navigation, encode the return in the music performed by LilyPond; a text-only `\markup` does not define a jump. A separate MIDI score is supported, with music assembled from the **same measure variables and named voices** as the printed score:

```lilypond
printedMusic = { \intro \mainSection \development \codaMusic }
playbackMusic = { \intro \mainSection \development \returnToSegno \codaMusic }
\score { \new Staff { \printedMusic } \layout { } }
\score { \unfoldRepeats \new Staff { \playbackMusic } \midi { } }
```

The named voices live inside those shared section/measure variables. `returnToSegno` should reuse the intended original measures and stop at the intended To Coda point; do not re-enter a separate copy of their notes. Capricho Árabe already defines this explicitly: its 45 written measures yield 73 playback measures, including the repeated introduction, both alternate endings, D.S. return and coda. Re-export older bundles and reopen the regenerated file. Keep **Follow repeats & jumps** checked to use that sequence; unchecking it plays each written measure once. The sequence controls playback, highlighting, looping and bar navigation together.

## Library and last-song resume

1. Keep `.sotto.json` files in your preferred folder, such as a locally synced **OneDrive/Scores** folder.
2. Open **Library → Connect folder**, choose that folder, and open a score from the list. Subfolders appear as expandable directories with no fixed nesting limit, for example `Violin/Vivaldi/Book 1/Pieces/Spring/`. **Open score / Add score** can bookmark individual files instead.
3. Use the star to mark pieces you are working on; **Favorites** filters the list. Search matches filenames, known titles/composers and full folder paths. Search and Favorites reveal matching scores throughout the folder tree. Recently opened scores appear first within each favorites group.
4. Library automatically scans remembered folder handles when it opens if read permission is already granted. Connect, Reconnect and Refresh enumerate directory names and relative file paths only; they do not open or parse score files. Unopened scores use their filenames. Title/composer metadata is learned when a score is opened and preserved on later scans. This avoids requesting every cloud-hosted score just to browse the library. Native folder handles permit directory-only enumeration; fallback file pickers are controlled by the browser/cloud provider. **Refresh** rescans that same handle; it requests permission only when necessary and does not reopen a folder picker. **Reconnect** explicitly chooses a folder again. Opening a linked score reads its current contents from disk, including changes made outside Sotto. Browsers without directory handles still require reselection; the browser may label its local picker “Upload”, but Sotto does not upload the selected files.
5. Choose **Export backup** and save `sotto-library.json` in OneDrive. This small JSON file preserves folder labels, relative paths, favorites, recents, general preferences and each bookmarked song’s practice settings. On another computer, choose **Library → Import backup**, then reconnect the score files or folders. Existing bookmarks merge by ID; imported settings replace saved values for matching songs, while other songs stay intact. Preferences apply immediately, with playback/microphone stopped. Older metadata-only library indexes remain importable. Export/import is manual, not live synchronization.

Desktop Chrome/Edge can store read-only file/directory handles in IndexedDB; permissions may need granting again. A OneDrive folder must be available through the local file picker (and the selected files downloaded by OneDrive when needed). No OneDrive account integration is required. Safari/iPad and other browsers without these pickers can resume the last cached song; other pieces require reselection or reconnecting their folder. On iPad, select OneDrive through the Files picker; folder selection depends on the browser/provider. Bookmark metadata is local to this browser and site address; export the index for backup or transfer. Clearing browser storage removes the index/handles but never deletes the original files. Bookmarks and permissions are not a backup of the score files themselves.

Only **one imported song** is cached in IndexedDB, in a single replaceable slot. Opening another song replaces that copy; the library index remains metadata and references, with no growing collection of cached scores. On startup, Sotto reads the last linked file afresh when read permission is already granted, otherwise it uses the cached copy without a permission prompt. This works offline and on browsers that cannot retain file access. To load edits when access is unavailable, reopen/reconnect the original file. The app, example and instrument assets also remain available through the service-worker cache. Removing a library bookmark leaves the original file untouched.

Sotto remembers general preferences (instrument, zoom, follow score, control visibility, feedback-panel visibility, count-in, metronome mode/pulse/volume, and microphone input/filter/timing/display choices). Each song separately remembers tempo, bar position, repeat order, loop range and enablement, mute/solo/voice volumes, practice voice and playback octave. Settings are checked against the current score when reopening, so shortened scores or changed voice IDs do not leave invalid controls. Playback and microphone input always reopen paused; a saved Continuous metronome mode starts after Play or a metronome click. Rhythm results and microphone audio are not persisted.

These settings and the one-song resume copy are local to this browser and site address. The portable backup includes practice settings and common preferences, but excludes the cached score, file-access permissions, microphone device ID and device-specific input-delay calibration. Keep the source score files in OneDrive or another backed-up folder; reconnecting their imported bookmarks restores the associated practice settings. Clearing site storage removes them, but never changes files in OneDrive or another source folder. Browser account sync does not provide application-level synchronization of this site storage. A future sync feature can exchange this same small settings/index format through a shared file or cloud service; it need not copy the full score library.

## Instruments, metronome, and SoundFonts

Open **Sound and metronome settings** (the sliders icon above the score) to select an instrument or configure the click.

- The six instruments work offline: **recorded nylon guitar, piano and violin**, plus **synthesized marimba, organ and flute**. Instrument choice is remembered on this browser and changes all voices together; mute/solo/volume remain independent. Switching waits for recordings to finish loading and keeps the previous sound available until then. The pitches stay unchanged; notes outside a recording bank’s range use pitch-shifted samples.
- Toggle the **Metronome** button, or use **M**. It cycles **Off → Playback → Continuous**. Playback clicks only with the score; Continuous also clicks while paused. Clicks share the notes’ audio clock. The same mode button remains visible with controls hidden. Enable the separate **One-bar count-in** option to count before each Play, even with continuous clicks off.
- The first click of each bar is stronger/higher. **Beat** gives two dotted-quarter clicks per bar in 6/8; **Subdivision** gives six eighth-note clicks. In 4/4, these give four/eight clicks respectively.
- **Click volume** is independent of voice volumes and muting. A visible pulse follows the click.

Nylon guitar, piano and violin now use Tone.js samplers with actual recordings, rather than generated waveforms. There is currently **no `.sf2`/`.sf3` SoundFont loader or SoundFont selection menu**. Those files require a SoundFont engine rather than just changing the synthesizer preset. A General MIDI SoundFont would allow its available instrument programs (typically the 128 GM programs and percussion), subject to what the font includes. Candidate engine: [SpessaSynth](https://github.com/spessasus/spessasynth_lib). Imported SoundFonts would remain on-device; network sample libraries would need explicit download/cache behavior.

## Microphone rhythm feedback (preview)

1. Open the **microphone icon** above the score, then choose **Enable mic**. Permission is requested only after that click. This requires HTTPS (the deployed site) or localhost; ordinary HTTP on your Wi-Fi address cannot access the microphone.
2. Use headphones and select the voice you are practicing under **Input, timing & calibration**. Choose **Mute practice voice** so the accompaniment can continue. The button shows its muted state and changes to **Unmute practice voice** to restore playback. With **All voices**, it mutes/restores all parts; the microphone is controlled separately. Otherwise speakers, metronome clicks and other voices may be detected as your playing. An input selector is populated after microphone permission is granted.
3. **One-bar count-in** in **Sound & metronome** is on by default; an explicit off choice is remembered. Each Play counts a complete bar at the starting meter and tempo, even when the metronome is off; Pause cancels it. The count-in preference is saved. Opening pickups are labeled bar 0, followed by the first full bar 1; older bundles with duplicate opening 1 labels are also displayed correctly. The metronome cycles **Off → Playback → Continuous**: Playback clicks only with the score, Continuous also clicks while paused. Its mode button stays visible with controls hidden, alongside restart, previous/next bar, play/pause and listening. Start the score. **Space** starts/pauses it and **Left/Right** jump bars even when a practice button retains focus. The plot defaults to a **24-second window**, one quarter of the original scroll speed. Choose 6, 12, 24 or 48 seconds using **Plot window**. Filled volume and a stronger peak outline preserve short attacks even when several audio windows share one pixel. **Trace boost** defaults to +12 dB and changes only drawing height, not audio, the attack gate or timing results. Choose **Look ahead** independently of **Plot window**. The default is **24 seconds total with 4 seconds ahead** (20 seconds of history). A shorter window limits the visible look-ahead to reserve at least two seconds of history; expanding it restores the saved preference. Red metronome lines follow **Pulse** in Sound & metronome: in 6/8, **Beat** shows two lines on the first and fourth eighths; **Subdivision** shows all six. Each bar’s first beat is solid red and the other beats are dashed red; green dashed lines show the selected voice’s expected attacks. These beat references are visible during score playback even with the click muted. Dots show detected attacks: green on time, amber early, blue late. Gray dots are unmatched. The timing readout gives an estimated signed error in milliseconds, with a default ±80 ms on-time tolerance.
4. Adjust **Input offset** to move delayed input earlier (positive values). For an optional automatic estimate, play **Calibrate speakers** through speakers in a quiet room; the app pauses playback/metronome, emits six clicks and estimates their round-trip delay through the microphone. Inconsistent or insufficient detections are rejected. Changing to headphones, Bluetooth, another microphone or a different audio route can change the delay; adjust for the route you actually practice with. Calibration is an alignment estimate, not a measurement of human timing accuracy.
5. The analysis path defaults to a **4 kHz low-pass**; select Off, 2, 4 or 8 kHz as needed. An optional high-pass (Off, 20, 40, 80 or 150 Hz) can remove rumble and starts **off**. These filters affect both the graph and detector and changing them begins a new take. They cannot separate in-band background noise or recover sound already suppressed by the microphone. If quiet plucks are missed, lower **Attack gate**; raise it if room noise produces detections. Lower the hardware input gain if clipping is shown. The timing tolerance is adjustable from 25–150 ms. A chord is one expected attack; tied continuations and grace ornaments are excluded from the initial target list.
6. The first two seconds of microphone input learn the background level; keep the instrument quiet for that initial sample. The plot then crops most of that baseline away and expands the activity above it; this is a **display-only** adjustment. Use **Learn baseline** with the instrument quiet to measure it again (playback and metronome pause for this), and use **Hide learned background** in settings to compare against the absolute-level plot. Relearn after the room/background changes. Baselines are learned afresh for a new microphone session or filter setting and are not persisted. Attack gates and timing scores are unchanged by baseline cropping.
7. Pausing freezes the last take’s graph while the input meter remains live. Loop wraps preserve the volume trace, attack dots and reference grid for the recent passes (up to about 50 seconds in memory); timing totals accumulate across the loop session. Pause after a wrap to inspect how the previous pass went. A new playback run, manual seek, voice/tempo change or timing-setting change starts a fresh take. The rhythm footer combines stats, centered plot controls and the legend. Gaps between frames are compact, and instrument/keyboard hints live inside the playback controls. Hide the strip to give more room to the score; its microphone icon stays highlighted while input is active. **Stop mic** releases the microphone tracks. Backgrounding Sotto stops input and requires re-enabling it on return.

Audio is processed locally in an AudioWorklet using 10 ms level windows and audio-clock timestamps. Up to about 50 seconds of level/onset summaries are kept in memory; raw audio is never recorded, persisted or uploaded. Input gate, tolerance, offset, filters and plot display preferences are remembered locally. The worklet is included in the offline app cache; the browser still controls microphone permission.

The app requests browser echo cancellation, noise suppression and automatic gain control off and shows the values the browser reports (or “not reported”). This does not establish that AirPods/OS processing is off. Apple’s system Mic Mode is not exposed as a browser control: if available, choose **Standard** or **Wide Spectrum** in Control Center instead of Voice Isolation. Availability depends on the device, OS and app. Another useful comparison is selecting the built-in device microphone in Sotto while keeping AirPods for playback. [Apple’s microphone modes](https://support.apple.com/101993), [browser capture settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings).

This is an energy-based attack detector and fixed-tempo reference, not pitch recognition or automatic score following. It is best suited to one clear practice voice. Sustained notes, legato, quiet attacks over ringing strings, strumming, dense passages and room noise can cause missing/extra detections. “Missed” means an expected attack had no matching detection, not proof that a note was omitted. Actual guitar/microphone combinations and physical iPad/Safari behavior still need testing. The browser regression tests use generated input with a known delay and do not open a physical microphone.

## Validation

```sh
npm test
python3 scripts/test_export_score.py # also requires LilyPond
npm run build
node scripts/browser-test.mjs
# Against a running production preview, including offline reload/playback:
node scripts/browser-test.mjs --production
# Ultrawide sizing, zoom, panning, and fit-to-width regression checks:
node scripts/layout-test.mjs
# Zoomed line-end loops stay within the selected bars:
node scripts/loop-scroll-test.mjs
# Actual click scheduling, accents, subdivisions, instruments and offline audio:
node scripts/sound-test.mjs
# File/folder bookmarks, fresh reads, favorites, backup/import, and fallback:
node scripts/library-test.mjs
# Arbitrary folder depth, filename-only scans, nested search and opening one file:
node scripts/library-folders-test.mjs
# Last-song caching, saved settings, fresh linked reads and offline resume:
node scripts/session-test.mjs
# Export/restore settings and library references into a separate browser profile:
node scripts/backup-test.mjs
# Verify an exported ensemble bundle, its independent parts and violin playback:
node scripts/score-load-test.mjs --score path/to/piece.sotto.json
# Focused-control shortcuts, generated microphone input, timing and calibration:
node scripts/rhythm-test.mjs
```

The browser checks use Playwright Chromium (`npx playwright install chromium`); optionally set `CHROME_PATH` to an existing Chromium executable and `BASE_URL` to a preview/deployed URL. `node scripts/browser-test.mjs --pages` tests the `/sotto/` preview including offline playback. They exercise real audio-buffer scheduling, note highlighting, seek/pause, mute/solo, tempo, loop wrapping, repeats, invalid imports, SVG sanitization and responsive layouts. Captures go in `test-results/`.

## Roadmap and current limits

Next work, in practical order:

1. **Library refinements:** automatic/shared backup synchronization and optional direct cloud integration; the initial reference-based library and portable library/settings backup are available now.
2. **SoundFonts and per-voice instruments:** load an SF2/SF3 font locally and select its presets; allow violin melody over guitar accompaniment. Retain the bundled recordings and lightweight synths.
3. **More general import:** derive tempo and instrument transposition automatically, support tempo changes, and simplify preparation. Measure timing, meter changes, structured repeats and explicit LilyPond MIDI playback order are already derived during export; Julia Florida retains its explicit jump map.
4. **Improve microphone rhythm feedback:** validate the preview on actual guitar and iPad/Safari hardware, improve detection of overlapping/legato attacks, and refine device-specific latency calibration. The level trace, onset matching, manual offset and speaker alignment are implemented.
5. **Pitch feedback and following:** start with single-note melody/bass practice, then overlapping guitar notes/chords and following a freely varying tempo.

Current limits: fixed tempo and pulse unit for imported scores; grace notes use a short fixed interpretation; harmonic-specific sounding pitches and expressive tempo changes are not modelled; notation zooms/scrolls but does not reflow; direct browser MusicXML/LilyPond compilation, raw MIDI import, PDF recognition and microphone pitch assessment are not implemented. Rhythm feedback is an initial energy-based estimate that needs physical-device validation. Export only LilyPond files you trust, since the compiler executes Scheme.

## Recording credits and maintenance

The 29 MP3 recordings (about 6.4 MB total) come from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments), assembled/edited by Nicholaus P. Brosowsky and distributed under **CC BY 3.0**. Upstream credits quartertone/Freesound for nylon guitar and VSCO/Versilian Studios for piano and violin. Full attribution, source revision, original notices, and file hashes are under [public/samples](public/samples/ATTRIBUTION.md); credits are also linked from the sound settings. The app serves these files from its own deployment, with no third-party sample requests during playback.

Refresh the pinned, unchanged source recordings only when needed:

```sh
python3 scripts/fetch-samples.py
```

A normal checkout/build already includes them. The service worker precaches all three banks so an instrument first selected offline can still load. Runtime gain matching balances the sampled instruments; attack/release envelopes and pitch interpolation are applied during playback.
