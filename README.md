# Sotto v0.5

A local web practice player, starting with a public-domain Carcassi guitar study and ten ready-to-play openly licensed samples. React + TypeScript + Vite, Tone.js/Web Audio, and LilyPond SVG engraving. No accounts or cloud uploads. The bundled instrument recordings, synthesized timbres, and metronome work offline.

**New piece? Start with [Prepare a new score](#prepare-a-new-score).**

For the player’s features and step-by-step practice workflows, choose **? Help** in the top bar or open the [Sotto practice guide](https://laughingrice.github.io/sotto/#help). The searchable guide covers playback, per-part instruments, loops, metronome/count-in, screen space, folder libraries, backups, microphone rhythm feedback, score preparation and troubleshooting. It works offline after the app has cached and uses a topic selector on smaller screens. Each topic explains where to find its controls and how to use them.

## Notes / tabs prototype

The `v0.5` tag is the reference point **before** tablature prototype changes. In the current app, choose **Library → Tab prototypes**, search for guitar or bass, and open either original four-bar exercise. The **Show** selector above the score switches **Notes / Tabs / Both** during playback or paused review. The tab-only layout deliberately uses two pages; notation and combined views use one. Noteheads and tab numbers share semantic event IDs but have distinct SVG IDs. Switching views preserves playback, loops and microphone feedback, including faded attempts and pitch marks. Tap either representation to seek.

Both exercises contain single notes, a chord, a cross-bar tie, a slide, a silent fourth bar and a four-bar repeat. Guitar uses six-string EADGBE; bass uses four-string EADG. Canonical MIDI values are sounding pitches (low E2 = 40 for guitar, E1 = 28 for bass). Each bundle has one performance regardless of view. String/fret metadata is independent of the playback sound. Slides are drawn with native LilyPond endpoints; continuous slide audio and string-choice detection are not implemented.

Rebuild the **prototype fixtures only** with LilyPond 2.26 and Python:

```sh
python3 scripts/build_tab_prototypes.py --instrument guitar --instrument bass
```

The instrument flag is required. `--views notation,tabs,both` selects renderings; `--output <directory>` changes the destination. Sources are in `scores/tab-prototypes/`; bundles, their editable sources and a separate catalog are in `public/scores/prototypes/`. These original exercises are dedicated under CC0. No existing full pieces were converted. The general `export_score.py` workflow and PDF transcription skill are unchanged pending review of this prototype; this builder is not a general tab importer or automatic fingering generator. Violin is deferred.

Prototype geometry uses exported StaffSymbol/system and BarLine markers, covering four/six tab strings, paired staves and silent measures. Legacy bundles retain their existing geometry fallback. The optional `renderings` field extends version-1 bundles while `pages` remains the compatible default rendering. The two compressed bundles are about 10 KB and 9 KB; only the opened song is retained by the existing resume cache.

Verify the views with generated microphone input:

```sh
BASE_URL=http://localhost:4179/sotto/ node scripts/tab-prototype-test.mjs
```

## Deploy to GitHub Pages

The repository includes a workflow that tests, builds, and publishes the static app. No LilyPond installation or server is needed for deployment: the compiled example score is already included.

1. Open [repository Settings → Pages](https://github.com/laughingrice/sotto/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open [Actions → Deploy Sotto to GitHub Pages](https://github.com/laughingrice/sotto/actions/workflows/pages.yml), select **Run workflow**, choose **main**, and run it.
4. Once the deployment finishes, visit **https://laughingrice.github.io/sotto/**.

Subsequent pushes to `main` test and deploy automatically. Before Pages is enabled, the workflow still builds and tests successfully and skips publication. The `v0.1` tag records the first release; `v0.2` includes full-bar highlighting, expanded score/zoom controls, an accented standalone metronome, and recorded nylon-guitar, piano and violin playback. The `v0.3` release adds a persistent file/folder library, improved repeat and meter handling, microphone rhythm feedback with baseline learning and loop history, compact practice controls, a one-bar count-in, and Off/Playback/Continuous metronome modes.

The `v0.4` release adds last-song and per-song settings persistence with portable backups, nested folder libraries, per-part bass/drum playback, a searchable help page and ten openly licensed sample scores with online catalogs. It also aligns visual timing with audible output, introduces compressed `.sotto` bundles and lossless SVG optimization, and reads LilyPond headers and starting tempos automatically. Extracted titles include subtitles to distinguish passages from the same book.

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
- Score highlights and metronome flashes follow the estimated audible output clock, compensating for scheduling look-ahead and device output latency when reported by the browser. Audio scheduling and microphone timing use their original clocks.
- Tempo control uses the exported pulse, including dotted-quarter and half-note beats.
- Piece details in the settings panel; Open and Save score together in the top bar.
- Hide/show all practice controls to give the score the full viewport, with compact restart, previous/next bar, play/pause and listening buttons. The ear button starts/stops the microphone directly; the microphone icon still shows/hides the feedback strip. The setting is remembered and playback continues while controls are hidden.
- The score panel fills the available browser width. Zoom ranges from 50–250%; click the percentage to fit the page to the available width again. Enlarged pages can be panned horizontally, and Follow score keeps the current bar in view in both directions.
- Voice mute, solo, and independent volume.
- Tempo controls reach 220 BPM; imported scores with a faster saved/original tempo remain supported.
- Phrase loops and an accented metronome with beat/subdivision choice and independent click volume. It can click while the score is paused or follow playback.
- Structured repeats, alternate endings and explicitly encoded D.S./D.C./coda playback order.
- Guitar transposition to sounding pitch; percussion keeps its drum keys.
- Instrument selection: recorded nylon guitar, piano, violin, electric bass and acoustic drums, plus synthesized marimba, organ and flute. The recordings are bundled with the app, balanced in level, and cached for offline use.
- Save/open portable, losslessly gzip-compressed `.sotto` bundles. Legacy uncompressed `.sotto.json` files still open. Imported SVG is sanitized before rendering.
- Meter changes use exported bar timing for playback, navigation, highlights, and metronome accents.
- A persistent library of file/folder bookmarks, favorites, and a portable settings backup; the last opened song alone is cached for resuming. Granted folder handles are refreshed when Library opens, with separate Refresh and Reconnect actions.
- Microphone feedback preview: a volume trace, expected/detected attack markers, take/loop timing reviews, optional single-note pitch checks, input offset and speaker calibration. No microphone audio is recorded or uploaded.

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

From this repository’s root, the usual command is:

```sh
python3 scripts/export_score.py my-score.ly
```

This creates `my-score.sotto` beside the source. Title, composer and subtitle come from the parsed LilyPond headers, including includes, variables, markup and score/book header overrides. The extracted title is `Title -- Subtitle` when a nonblank subtitle is defined, otherwise just `Title`; this distinguishes passages sharing a book title. An explicit `--title` overrides the whole combined title. The starting tempo uses an opening numeric `\tempo` marking (including dotted-note units and range midpoints), or an explicit numeric tempo in the MIDI block. Text-only tempo markings use the midpoint of an approximate range: Adagio 71, Andante 92, Moderato 114, Allegro 144 and Presto 184 BPM. These are practice defaults based on [Skoove’s tempo ranges](https://www.skoove.com/blog/wp-content/uploads/2021/04/Italian-tempo-markings.pdf), not exact performance prescriptions. Finite fallback ranges for the open-ended Larghissimo and Prestissimo markings are 15–24 and 200–240.

Without a numeric pulse, the meter supplies the beat unit: for example, a quarter note in 4/4 and a dotted quarter in 6/8, 9/8 or 12/8. Unrecognized/missing opening tempos fall back to 80 BPM (the legacy Julia export uses 44). The exporter prints the chosen starting tempo and its source. It currently exports one starting tempo; later tempo changes remain visible in the notation but do not change playback speed.

To override the source metadata and use a **quarter-note pulse**:

```sh
python3 scripts/export_score.py my-score.ly \
  --title "My score" --composer "Composer" \
  --beat-unit 1 --bpm 80 \
  --output my-score.sotto
```

Always pass the `.ly` source path for a custom piece. With no arguments, the exporter rebuilds the public sample library; custom titles or output paths without a source are rejected. Renaming a bundle does not change its engraved pages, notes or parts. Named voices on separate staves (for example, Violin I and Violin II) export as independent parts, in score order, with separate colors and mute/solo/volume controls.

For an explicit **6/8 guitar** practice tempo, with a dotted-quarter pulse:

```sh
python3 scripts/export_score.py my-score.ly \
  --title "My score" --composer "Composer" \
  --beat-unit 1.5 --bpm 44 \
  --output my-score.sotto
```

| Option | Meaning |
| --- | --- |
| `--title`, `--composer` | Override the parsed LilyPond header values. Omit these to use the source metadata. |
| `--beats-per-bar` | Deprecated and ignored. Actual bar starts, durations, and time signatures come from LilyPond’s Timing context, including meter changes and pickups. |
| `--beat-unit` | Override the tempo pulse in quarter-note units: 1 for a quarter, 1.5 for a dotted quarter. This also sets the metronome beat. When only the pulse is overridden, a numeric source tempo is converted to preserve playback speed. |
| `--bpm` | Override the number of selected pulses per minute. Otherwise use the opening source tempo or tempo-word midpoint. |
| `--transpose` | Additional semitone offset **after** LilyPond’s `\transpose` and `\transposition` instrument metadata. Percussion is never shifted. Defaults to 0 for imported pieces. Use -12 only when the exported pitches are still in the written guitar octave. |

The export contains SVG score pages, notehead identities, note timings, voices, ties, bar numbers, and playback metadata in one portable file. No separate PDF, MIDI, or audio file is needed. Playback instrument selection changes the timbre. Sound settings also offer a temporary playback-octave adjustment for older bundles.

**Capricho Árabe:** this source already wraps its music in `\transpose c c,`, lowering it once. Export it with **`--transpose 0`** (or omit that option); -12 would lower it twice. A guitar clef alone does not establish whether the source pitches have already been transposed. The exporter reads compiled pitches rather than guessing from the instrument name. Meter changes are automatic: the opening eight bars are 3/4, bar 9 starts 4/4, and the final cadenza retains its actual five-quarter duration. Re-export older bundles to obtain the new timing metadata; changing the player alone cannot recover missing boundaries reliably.

### 3. Open it on any device

The exporter writes gzip-compressed JSON, preserving SVG drawing precision and score metadata. SVG optimization runs automatically: repeated glyph paths become shared definitions, formatting whitespace is removed and plain transform wrappers are collapsed without changing transform order. Text spacing, note IDs and voice attributes are retained. The exporter compares actual gzip sizes and keeps the original if optimization would make the bundle larger. Use `--no-optimize-svg` to export the original LilyPond SVG for comparison. An explicit output name ending in `.json` produces legacy uncompressed JSON: if an older command still uses `--output my-score.sotto.json`, change it to `--output my-score.sotto` to enable compression. The exporter reports the format and byte count after writing. Save score and the single-song resume cache also use compression. Existing `.sotto.json` files remain supported; open one and choose **Save score** to get a compressed copy. Library/settings backups remain ordinary JSON.

You can also optimize an existing bundle without recompiling its LilyPond source:

```sh
python3 scripts/svg_optimize.py old-score.sotto --output optimized-score.sotto
# Uncompressed .sotto.json inputs are also accepted.
```

SVG optimization is performed by these Python tools. Browser **Save score** compresses the SVG already in the opened file; re-export or run the command above to optimize an older score. The ten public samples total 675,092 bytes after SVG optimization, down from 845,334 with gzip alone (20.1% less) and 11,163,861 before compression. Browser comparisons verified identical pixels on all 41 pages, including active and muted note styling.

Transfer `my-score.sotto` to the tablet using Files, AirDrop, or a file-sharing service, open Sotto, and choose **Open score**. Select the bundle. This reads it locally; it does not upload the file. You can also use **Save score** to download a copy.

When reopening an existing bookmark, Sotto keeps your saved practice BPM. Click the percentage button below the tempo slider (**Reset to score tempo**) to use the newly exported score tempo.

The last song is cached for resuming across reloads; **Library** remembers the other score bookmarks and favorites. See the library workflow below.

### Rebuild the public samples

The source editions and credits are under `scores/samples/`. Rebuild all ten with LilyPond 2.26, `convert-ly` and Python 3:

```sh
python3 scripts/build_samples.py
# equivalent: npm run export:score
```

This preserves the original sources, updates working copies for current LilyPond syntax, prepares independent practice parts and writes `.sotto` bundles, downloadable source archives and `catalog.json` under `public/scores/samples/`. Carcassi’s Étude Op. 60 No. 1 is the default. Most sample editions are designated public domain by Mutopia; solo Adelita is CC BY-SA 2.5 and Recuerdos de la Alhambra is CC BY-SA 3.0. Adapted editions retain those licenses; original credits remain in the engraving, source archives and catalog. See `scores/samples/README.md` for provenance and adaptation details.

Julia Florida is no longer served by the app. Its existing regression fixture lives outside `public/`; locally opened scores and saved settings continue to work. The legacy LilyPond source can still be exported explicitly for personal use, with output beside the source by default.

### Where scores are stored, and what “Open” means

The public sample library uses:

- `scores/samples/`: unchanged original LilyPond editions.
- `scripts/build_samples.py`: reproducible adaptations and exports.
- `public/scores/samples/catalog.json`: lightweight titles, instruments, source/license credits and relative bundle URLs.
- `public/scores/samples/*.sotto`: rendered notation, timing and playback order.

Only the small default Carcassi score is precached with the app for offline startup. Connecting a catalog downloads its metadata, not all its scores. Opening a piece downloads that bundle and replaces the one-song resume cache. Service-worker Cache Storage does not accumulate other score bundles or source archives. Catalog metadata, favorites and per-song settings are included in library backups; score files are not.

**Open score** still reads local `.sotto` files without uploading them. Keep personal/copyrighted editions outside `public/`: Vite publishes everything in that directory. **Save score** downloads a separate copy.

### Host an online library

For a small public collection, keep sources and generated bundles in Git and serve the catalog/bundles through the existing GitHub Pages deployment. The starter collection is small enough to host alongside the app; no extra service or account is needed. A larger independently updated library can live in its own Pages repository or an HTTPS object-storage bucket. For another origin, configure CORS to allow `GET` from Sotto’s origin (or `*` for a public library). Serve JSON directly, without authentication or a sharing-page wrapper. OneDrive remains useful for the personal local/synced-folder workflow; its public sharing pages are not a static catalog host.

Open **Library → Sample scores** for the included collection, or **Connect an online library** and paste a catalog URL. Online catalog connections persist and transfer in backups. Refresh re-reads a catalog while preserving favorites and practice settings for stable entry IDs. A catalog controls which entries it lists; removing one from the catalog removes that bookmark on refresh.

Example `catalog.json` (relative paths resolve against the catalog URL):

```json
{
  "format": "sotto-catalog",
  "version": 1,
  "title": "My public library",
  "scores": [{
    "id": "study-1",
    "title": "Study No. 1",
    "composer": "Composer",
    "instruments": "Guitar",
    "file": "study-1.sotto",
    "license": "Public Domain",
    "credit": "Edition/typesetter credit",
    "source": "https://example.org/original-edition",
    "sourceFile": "study-1-source.zip",
    "description": "Optional notes about the edition or adaptation"
  }]
}
```

Use stable alphanumeric IDs (`-` and `_` allowed), check redistribution rights for each edition, and preserve its attribution/license requirements. Sotto validates the catalog structure and links; it cannot verify a host’s legal claims. There are no credentials or cloud sign-in flows in this first online-library implementation.

The exporter requires a single engraved score, an explicit `\layout { }` block, and named voices for meaningful part controls. It reads actual measure timing from LilyPond, including changing meters, silent measures, pickups, and a final cadenza. The exporter unfolds structured repeats (including nested repeats and alternate endings). If there is a MIDI score, it uses that score’s music for playback order; otherwise it unfolds the engraved score. Printed and MIDI versions must share named voices and underlying measure definitions so source locations can link them reliably. Ambiguous mappings fail explicitly. Tempo maps still need a more general importer. Instrument `\transposition` metadata is applied to exported sounding pitches. Drum noteheads use LilyPond’s General MIDI drum mapping (or a custom `drumPitchTable`), retain a separate voice, and play through the bundled recorded acoustic drum kit. Per-voice instrument selectors can override automatic name/metadata detection; octave changes apply to pitched notes without changing percussion keys. Julia Florida retains its existing explicit navigation map. Export only LilyPond files you trust, since the compiler executes Scheme.

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

1. Keep `.sotto` files in your preferred folder, such as a locally synced **OneDrive/Scores** folder.
2. Open **Library → Connect folder**, choose that folder, and open a score from the list. Subfolders appear as expandable directories with no fixed nesting limit, for example `Violin/Vivaldi/Book 1/Pieces/Spring/`. **Open score / Add score** can bookmark individual files instead.
3. Use the star to mark pieces you are working on; **Favorites** filters the list. Search matches filenames, known titles/composers and full folder paths. Search and Favorites reveal matching scores throughout the folder tree. Recently opened scores appear first within each favorites group.
4. Library automatically scans remembered folder handles when it opens if read permission is already granted. A successful folder refresh also removes bookmarks whose files are no longer present, including when the folder becomes empty; failed or incomplete scans leave the index intact. This removes references only, keeps metadata/favorites for surviving paths and leaves practice settings, the open score and original files untouched. Connect, Reconnect and Refresh enumerate directory names and relative file paths only; they do not open or parse score files. Unopened scores use their filenames. Title/composer metadata is learned when a score is opened and preserved on later scans. This avoids requesting every cloud-hosted score just to browse the library. Native folder handles permit directory-only enumeration; fallback file pickers are controlled by the browser/cloud provider. **Refresh** rescans that same handle; it requests permission only when necessary and does not reopen a folder picker. **Reconnect** explicitly chooses a folder again. Opening a linked score reads its current contents from disk, including changes made outside Sotto. Browsers without directory handles still require reselection; the browser may label its local picker “Upload”, but Sotto does not upload the selected files.
5. Choose **Export backup** and save `sotto-library.json` in OneDrive. This small JSON file preserves folder labels, relative paths, favorites, recents, general preferences and each bookmarked song’s practice settings. On another computer, choose **Library → Import backup**, then reconnect the score files or folders. Existing bookmarks merge by ID; imported settings replace saved values for matching songs, while other songs stay intact. Preferences apply immediately, with playback/microphone stopped. Older metadata-only library indexes remain importable. Export/import is manual, not live synchronization.

Desktop Chrome/Edge can store read-only file/directory handles in IndexedDB; permissions may need granting again. A OneDrive folder must be available through the local file picker (and the selected files downloaded by OneDrive when needed). No OneDrive account integration is required. Safari/iPad and other browsers without these pickers can resume the last cached song; other pieces require reselection or reconnecting their folder. On iPad, select OneDrive through the Files picker; folder selection depends on the browser/provider. Bookmark metadata is local to this browser and site address; export the index for backup or transfer. Clearing browser storage removes the index/handles but never deletes the original files. Bookmarks and permissions are not a backup of the score files themselves.

If a selected file becomes unreadable, Library displays an error beside its bookmark with a **Reconnect file/folder** action. Stalled score reads time out after 20 seconds. Picker cancellation stays quiet; a file-provider read failure does not. In browsers using temporary file selections, a page reload loses those selections. The last cached song can still resume, but opening a demo replaces that one-song cache; returning to another local piece then requires reconnecting its source. A direct Microsoft-account/OneDrive folder connection is not implemented yet; ordinary sharing links cannot be entered as online catalog URLs.

Only **one imported song** is cached in IndexedDB, in a single replaceable slot. Opening another song replaces that copy; the library index remains metadata and references, with no growing collection of cached scores. On startup, Sotto reads the last linked file afresh when read permission is already granted, otherwise it uses the cached copy without a permission prompt. This works offline and on browsers that cannot retain file access. To load edits when access is unavailable, reopen/reconnect the original file. The app, example and instrument assets also remain available through the service-worker cache. Removing a library bookmark leaves the original file untouched.

Sotto remembers general preferences (instrument, zoom, follow score, control visibility, feedback-panel visibility, count-in, metronome mode/pulse/volume, and microphone input/filter/timing/display choices). Each song separately remembers tempo, bar position, repeat order, loop range and enablement, mute/solo/voice volumes, practice voice and playback octave. Settings are checked against the current score when reopening, so shortened scores or changed voice IDs do not leave invalid controls. Playback and microphone input always reopen paused; a saved Continuous metronome mode starts after Play or a metronome click. Rhythm results and microphone audio are not persisted.

These settings and the one-song resume copy are local to this browser and site address. The portable backup includes practice settings and common preferences, but excludes the cached score, file-access permissions, microphone device ID and device-specific input-delay calibration. Keep the source score files in OneDrive or another backed-up folder; reconnecting their imported bookmarks restores the associated practice settings. Clearing site storage removes them, but never changes files in OneDrive or another source folder. Browser account sync does not provide application-level synchronization of this site storage. A future sync feature can exchange this same small settings/index format through a shared file or cloud service; it need not copy the full score library.

## Instruments, metronome, and SoundFonts

Open **Sound and metronome settings** (the sliders icon above the score) to select an instrument or configure the click.

- Eight choices work offline: **recorded nylon guitar, piano, violin, electric bass and acoustic drums**, plus **synthesized marimba, organ and flute**. Each voice has a **Sound** selector. **Auto** recognizes instrument names/IDs and optional `instrument`/`midiInstrument` metadata; a bass part alongside drums is treated as bass guitar, while Julia Florida’s bass register keeps the default guitar sound. The global instrument is the fallback for unrecognized parts. Explicit per-part choices, mute/solo and volume are saved per song and included in portable backups. Switching waits for recordings to finish loading and keeps the previous sound available until then. The pitches stay unchanged; notes outside a recording bank’s range use pitch-shifted samples.
- Toggle the **Metronome** button, or use **M**. It cycles **Off → Playback → Continuous**. Playback clicks only with the score; Continuous also clicks while paused. Clicks share the notes’ audio clock. The same mode button remains visible with controls hidden. Enable the separate **One-bar count-in** option to count before each Play, even with continuous clicks off.
- The first click of each bar is stronger/higher. **Beat** gives two dotted-quarter clicks per bar in 6/8; **Subdivision** gives six eighth-note clicks. In 4/4, these give four/eight clicks respectively.
- **Click volume** is independent of voice volumes and muting. A visible pulse follows the click.

The melodic recorded choices use Tone.js samplers. Acoustic drums use recorded one-shots mapped to General MIDI keys, with no repitching, duration truncation or octave shift, plus open-hi-hat choking. The kit covers kick, snare/sidestick, hi-hats, toms, crash and ride/bell; unsupported percussion keys are silent. Choose **Electric bass** for the bass part and **Acoustic drums** for the accompanying part, then mute the bass to practice with the drums. There is currently **no `.sf2`/`.sf3` SoundFont loader or SoundFont selection menu**. Those files require a SoundFont engine rather than just changing the synthesizer preset. A General MIDI SoundFont would allow its available instrument programs (typically the 128 GM programs and percussion), subject to what the font includes. Candidate engine: [SpessaSynth](https://github.com/spessasus/spessasynth_lib). Imported SoundFonts would remain on-device; network sample libraries would need explicit download/cache behavior.

## Microphone rhythm feedback (preview)

1. Open the **microphone icon** above the score, then choose **Enable mic**. Permission is requested only after that click. This requires HTTPS (the deployed site) or localhost; ordinary HTTP on your Wi-Fi address cannot access the microphone.
2. Use headphones and select the voice you are practicing under **Input, timing & calibration**. Choose **Mute practice voice** so the accompaniment can continue. The button shows its muted state and changes to **Unmute practice voice** to restore playback. With **All voices**, it mutes/restores all parts; the microphone is controlled separately. Otherwise speakers, metronome clicks and other voices may be detected as your playing. An input selector is populated after microphone permission is granted.
3. **One-bar count-in** in **Sound & metronome** is on by default; an explicit off choice is remembered. Each Play counts a complete bar at the starting meter and tempo, even when the metronome is off; Pause cancels it. The count-in preference is saved. Opening pickups are labeled bar 0, followed by the first full bar 1; older bundles with duplicate opening 1 labels are also displayed correctly. The metronome cycles **Off → Playback → Continuous**: Playback clicks only with the score, Continuous also clicks while paused. Its mode button stays visible with controls hidden, alongside restart, previous/next bar, play/pause and listening. Start the score. **Space** starts/pauses it and **Left/Right** jump bars even when a practice button retains focus. The default **Feedback → Under score** view inserts a volume/peak trace below each engraved system and aligns it to notehead spacing. Detected attacks stay at their played positions; stable pitch judgments remain as ✓ (matching) or × (different) beneath notes. **Previous attempts** defaults to one faded prior visit per written bar and supports None through five; this covers notated repeats, loops and restarts. Pause freezes the traces. **Clear feedback**, another score/voice or a detection-setting change clears them. Only bounded level/attack/pitch summaries are held in memory; these results are not stored in backups. Choose **Feedback → Timeline** for the original scrolling graph. Its plot defaults to a **24-second window**, one quarter of the original scroll speed. Choose 6, 12, 24 or 48 seconds using **Plot window**. Filled volume and a stronger peak outline preserve short attacks even when several audio windows share one pixel. **Adaptive trace range** is on by default under **Input, timing & calibration**. It follows recent playing levels with fast headroom adjustment and slow recovery for quiet passages; silence does not raise the gain. This is display normalization, independent of microphone gain, learned background and the attack/pitch gates. Disable it to use the earlier fixed scale. **Trace boost** defaults to +12 dB and changes only drawing height, not audio, the attack gate or timing results. Choose **Look ahead** independently of **Plot window**. The default is **24 seconds total with 4 seconds ahead** (20 seconds of history). A shorter window limits the visible look-ahead to reserve at least two seconds of history; expanding it restores the saved preference. Red metronome lines follow **Pulse** in Sound & metronome: in 6/8, **Beat** shows two lines on the first and fourth eighths; **Subdivision** shows all six. Each bar’s first beat is solid red and the other beats are dashed red; green dashed lines show the selected voice’s expected attacks. These beat references are visible during score playback even with the click muted. Dots show detected attacks: green on time, amber early, blue late. Gray dots are unmatched. The timing readout gives an estimated signed error in milliseconds, with a default ±80 ms on-time tolerance.
4. Adjust **Input offset** to move delayed input earlier (positive values). For an optional automatic estimate, play **Calibrate speakers** through speakers in a quiet room; the app pauses playback/metronome, emits six clicks and estimates their round-trip delay through the microphone. Inconsistent or insufficient detections are rejected. Changing to headphones, Bluetooth, another microphone or a different audio route can change the delay; adjust for the route you actually practice with. Calibration is an alignment estimate, not a measurement of human timing accuracy.
5. The analysis path defaults to a **4 kHz low-pass**; select Off, 2, 4 or 8 kHz as needed. An optional high-pass (Off, 20, 40, 80 or 150 Hz) can remove rumble and starts **off**. These filters affect both the graph and detector and changing them begins a new take. They cannot separate in-band background noise or recover sound already suppressed by the microphone. If quiet plucks are missed, lower **Attack gate**; raise it if room noise produces detections. Lower the hardware input gain if clipping is shown. The timing tolerance is adjustable from 25–150 ms. A chord is one expected attack; tied continuations and grace ornaments are excluded from the initial target list.
6. The first two seconds of microphone input learn the background level; keep the instrument quiet for that initial sample. The plot then crops most of that baseline away and expands the activity above it; this is a **display-only** adjustment. Use **Learn baseline** with the instrument quiet to measure it again (playback and metronome pause for this), and use **Hide learned background** in settings to compare against the absolute-level plot. Relearn after the room/background changes. Baselines are learned afresh for a new microphone session or filter setting and are not persisted. Attack gates and timing scores are unchanged by baseline cropping.
7. Pausing freezes the last take’s graph while the input meter remains live. Loop wraps preserve the volume trace, attack dots and reference grid for the recent passes (up to about 50 seconds in memory); timing totals accumulate across the loop session. Pause after a wrap to inspect how the previous pass went. A new playback run, manual seek, voice/tempo change or timing-setting change starts a fresh take. The rhythm footer combines stats, centered plot controls and the legend. Gaps between frames are compact, and instrument/keyboard hints live inside the playback controls. Hide the strip to give more room to the score; its microphone icon stays highlighted while input is active. **Stop mic** releases the microphone tracks. Backgrounding Sotto stops input and requires re-enabling it on return.

Audio is processed locally in an AudioWorklet using 10 ms level windows and audio-clock timestamps. If pitch checking is enabled, transient 4096-sample windows (8192 above 64 kHz) are analyzed in a separate local worker, using [Pitchy’s McLeod pitch detector](https://github.com/ianprime0509/pitchy). These brief processing buffers are never saved or uploaded; only note-level pitch summaries are retained for review. The detector handles 30–4000 Hz with A4 = 440 Hz; actual usable range depends on the microphone and signal. Worker code is precached for first use offline, and disabling pitch or stopping the microphone terminates that worker. Up to about 50 seconds of level/onset summaries are kept in memory; raw audio is never recorded, persisted or uploaded. Input gate, tolerance, offset, filters and plot display preferences are remembered locally. The worklet is included in the offline app cache; the browser still controls microphone permission.

The app requests browser echo cancellation, noise suppression and automatic gain control off and shows the values the browser reports (or “not reported”). This does not establish that AirPods/OS processing is off. Apple’s system Mic Mode is not exposed as a browser control: if available, choose **Standard** or **Wide Spectrum** in Control Center instead of Voice Isolation. Availability depends on the device, OS and app. Another useful comparison is selecting the built-in device microphone in Sotto while keeping AirPods for playback. [Apple’s microphone modes](https://support.apple.com/101993), [browser capture settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings).

**Take review** appears below the plot after there are assessed attacks and opens when you pause. It shows matched versus assessed score attacks and an on-time percentage: on-time detections divided by matched + missed + unmatched attacks. Future notes beyond a pause do not count as missed. After at least four matches, it also shows average signed offset (early/late), timing spread (standard deviation around that average) and average absolute error. These separate a consistent delay from uneven timing; device latency may contribute to the offset, so calibrate before interpreting it. Loop totals retain a bounded timing summary across every pass, and **Last loop** reports the most recently completed pass separately. Clear feedback, a new playback run, a seek or a timing-setting change resets the review.

Matching stays in score order. A repeated detection closest to an already consumed note is unmatched rather than stealing the next note. The detector’s cooldown adapts to nearby expected attacks (35–85 ms) instead of always suppressing every attack within 85 ms. Generated-audio browser tests exercise sixteenths at 220 BPM, known input delays, paused summaries and repeated loops. These are controlled tests; they do not establish accuracy for a particular instrument or room.

For **single-note pitch feedback**, open **Input, timing & calibration** and enable **Check pitch (single notes)** (off by default). Select one practice voice, use headphones and mute that part’s playback. The compact readout shows the estimated note, expected sounding note, matching/different note and cents offset. Playback-octave adjustment is included. Counts require two consistent estimates with at least 0.9 clarity, above the Attack gate and 6 dB above the learned background. Keep the instrument quiet during the initial two-second baseline capture; pitch scoring waits until it finishes. Baseline cropping itself remains display-only. Pitch checks count each assessed score target once and accumulate across loops; pause freezes the results. These counts cover only stable, assessed targets, not every note: silence, clipping, noise, chords, percussion, transitions and notes too short to isolate stay unscored. Before starting a take, the input readout can check a held note without judging it against the score. The option is remembered and included in settings backups. Dependency license notices ship in `public/THIRD-PARTY-LICENSES.txt`.

Rhythm still uses an energy-based attack detector and fixed-tempo reference; there is no automatic score following. It is best suited to one clear practice voice. Sustained notes, legato, quiet attacks over ringing strings, strumming, dense passages and room noise can cause missing/extra detections. “Missed” means an expected attack had no matching detection, not proof that a note was omitted. Actual guitar/microphone combinations and physical iPad/Safari behavior still need testing. The browser regression tests use generated input with a known delay and do not open a physical microphone.

## Validation

```sh
npm test
python3 scripts/test_export_score.py # also requires LilyPond
python3 scripts/test_svg_optimize.py
# Compare candidate SVGs with original bundles, including pixels and bar/note geometry:
node scripts/svg-test.mjs --original-dir /path/to/originals --optimized-dir /path/to/candidates
npm run build
node scripts/browser-test.mjs
# Against a running production preview, including offline reload/playback:
node scripts/browser-test.mjs --production
# Ultrawide sizing, zoom, panning, and fit-to-width regression checks:
node scripts/layout-test.mjs
# Zoomed line-end loops stay within the selected bars:
node scripts/loop-scroll-test.mjs
# Score-positioned traces, faded repeat history, multi-staff spacing, pitch markers and tablet layout:
node scripts/score-feedback-test.mjs
# Actual click scheduling, accents, subdivisions, instruments and offline audio:
node scripts/sound-test.mjs
# Compare rendered instrument/click attacks and output-aligned highlights at 100 BPM:
node scripts/timing-test.mjs --instrument bass-electric --check-visual
# Optionally use a local 4/4, quarter-pulse piece with attacks on the opening beats:
node scripts/timing-test.mjs --instrument bass-electric --score path/to/piece.sotto.json --check-visual
# Bass/drum identification, per-part recordings, muting, backups and offline playback:
node scripts/part-instruments-test.mjs --score path/to/bass-and-drums.sotto.json
# File/folder bookmarks, fresh reads, favorites, backup/import, and fallback:
node scripts/library-test.mjs
# Arbitrary folder depth, filename-only scans, nested search and opening one file:
node scripts/library-folders-test.mjs
# Compressed/legacy imports, Save/Open and compressed offline resume:
node scripts/compression-test.mjs
# On-demand public catalog, licensing and old online bookmark compatibility:
node scripts/catalog-test.mjs
# Last-song caching, saved settings, fresh linked reads and offline resume:
node scripts/session-test.mjs
# Export/restore settings and library references into a separate browser profile:
node scripts/backup-test.mjs
# Verify an exported ensemble bundle, its independent parts and violin playback:
node scripts/score-load-test.mjs --score path/to/piece.sotto.json
# Focused-control shortcuts, generated microphone input, timing and calibration:
node scripts/rhythm-test.mjs
# Single-note pitch: worker pipeline, wrong notes, chords/percussion, loops and first use offline:
node scripts/pitch-test.mjs
```

The browser checks use Playwright Chromium (`npx playwright install chromium`); optionally set `CHROME_PATH` to an existing Chromium executable and `BASE_URL` to a preview/deployed URL. `node scripts/browser-test.mjs --pages` tests the `/sotto/` preview including offline playback. They exercise real audio-buffer scheduling, note highlighting, seek/pause, mute/solo, tempo, loop wrapping, repeats, invalid imports, SVG sanitization and responsive layouts. Captures go in `test-results/`.

## Roadmap and current limits

Next work, in practical order:

1. **Library refinements:** automatic/shared backup synchronization and optional direct cloud integration; the initial reference-based library and portable library/settings backup are available now.
2. **SoundFonts and richer kits:** load an SF2/SF3 font locally and select its presets; expand drum articulations/velocity layers. Per-voice recorded instruments are implemented. Retain the bundled recordings and lightweight synths.
3. **More general import:** derive tempo and instrument transposition automatically, support tempo changes, and simplify preparation. Measure timing, meter changes, structured repeats and explicit LilyPond MIDI playback order are already derived during export; Julia Florida retains its explicit jump map.
4. **Improve microphone rhythm feedback:** validate the preview on actual guitar and iPad/Safari hardware, improve detection of overlapping/legato attacks, and refine device-specific latency calibration. The level trace, ordered onset matching, adaptive cooldown, take/loop summaries, manual offset and speaker alignment are implemented. Optional confidence-gated single-note pitch checking is implemented; next validate it with real instruments and investigate legato and polyphonic/chord feedback.
5. **Pitch feedback and following:** start with single-note melody/bass practice, then overlapping guitar notes/chords and following a freely varying tempo.

Current limits: fixed tempo and pulse unit for imported scores; grace notes use a short fixed interpretation; harmonic-specific sounding pitches and expressive tempo changes are not modelled; notation zooms/scrolls but does not reflow; direct browser MusicXML/LilyPond compilation, raw MIDI import, PDF recognition and microphone pitch assessment are not implemented. Rhythm feedback is an initial energy-based estimate that needs physical-device validation. Export only LilyPond files you trust, since the compiler executes Scheme.

## Recording credits and maintenance

The melodic banks contain 38 original MP3 recordings from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments), assembled/edited by Nicholaus P. Brosowsky and distributed under **CC BY 3.0**. Upstream credits quartertone/Freesound for nylon guitar, Karoryfer for electric bass, and VSCO/Versilian Studios for piano and violin. Another 11 acoustic drum hits come from [Virtuosity Drums](https://versilian-studios.com/virtuosity-drums/) under **CC0 1.0**; these FLAC recordings were converted to mono MP3. The 49 bundled files total about 10.4 MB. Full attribution, source revision, original notices, and file hashes are under [public/samples](public/samples/ATTRIBUTION.md); credits are also linked from the sound settings. The app serves these files from its own deployment, with no third-party sample requests during playback.

Refresh the pinned sample subsets only when needed (`ffmpeg` is required to rebuild the converted drum files):

```sh
python3 scripts/fetch-samples.py
```

A normal checkout/build already includes them. The service worker precaches all five banks so an instrument first selected offline can still load. Runtime gain matching balances the sampled instruments; attack/release envelopes and pitch interpolation are applied during playback.

The `v0.5` reference release records score-aligned microphone feedback, faded previous attempts, persistent single-note pitch marks, adaptive trace scaling, and explicit library reconnection errors. It precedes the notation/tablature switching prototype.
