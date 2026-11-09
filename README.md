# Sotto v0.2

A local web practice player, starting with Julia Florida. React + TypeScript + Vite, Tone.js/Web Audio, and LilyPond SVG engraving. No accounts or cloud uploads. The bundled instrument recordings, synthesized timbres, and metronome work offline.

**New piece? Start with [Prepare a new score](#prepare-a-new-score).**

## Deploy to GitHub Pages

The repository includes a workflow that tests, builds, and publishes the static app. No LilyPond installation or server is needed for deployment: the compiled example score is already included.

1. Open [repository Settings → Pages](https://github.com/laughingrice/sotto/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open [Actions → Deploy Sotto to GitHub Pages](https://github.com/laughingrice/sotto/actions/workflows/pages.yml), select **Run workflow**, choose **main**, and run it.
4. Once the deployment finishes, visit **https://laughingrice.github.io/sotto/**.

Subsequent pushes to `main` test and deploy automatically. Before Pages is enabled, the workflow still builds and tests successfully and skips publication. The `v0.1` tag records the first release; `v0.2` includes full-bar highlighting, expanded score/zoom controls, an accented standalone metronome, and recorded nylon-guitar, piano and violin playback.

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

The production build includes a service worker that caches the app, built-in score, and synthesizer code for offline use on a secure origin (HTTPS or localhost). A plain HTTP LAN address works for online playback but does not enable service workers or future microphone access. Deploy the `dist/` folder to an HTTPS static host for installable, offline tablet use.

## Included

- Actual LilyPond SVG pages with individual notehead IDs and voice membership.
- Playback with a full-bar highlight, simultaneous active-note highlighting, and automatic scrolling. Bar highlights also work with existing score bundles.
- Click-to-seek, pause/resume, restart, previous/next bar, and scrubber.
- Tempo control measured in dotted-quarter beats for Julia Florida.
- Piece details in the settings panel; Open and Save score together in the top bar.
- Hide/show all practice controls to give the score the full viewport, with a compact play/pause button. The setting is remembered and playback continues while controls are hidden.
- The score panel fills the available browser width. Zoom ranges from 50–250%; click the percentage to fit the page to the available width again. Enlarged pages can be panned horizontally, and Follow score keeps the current bar in view in both directions.
- Voice mute, solo, and independent volume.
- Phrase loops and an accented metronome with beat/subdivision choice and independent click volume. It can click while the score is paused or follow playback.
- Both alternate endings, repeated section, and D.C. al Coda for the example.
- Guitar playback one octave below the written notation, including low D2.
- Instrument selection: recorded nylon guitar, piano and violin, plus synthesized marimba, organ and flute. The recordings are bundled with the app, balanced in level, and cached for offline use.
- Save/open portable `.sotto.json` bundles. Imported SVG is sanitized before rendering.
- Meter changes use exported bar timing for playback, navigation, highlights, and metronome accents.
- A persistent library of file/folder bookmarks, favorites, and a portable index; imported score contents are never duplicated into browser storage.

Keyboard: **Space** play/pause, **←/→** previous/next bar, **R** restart, **M** metronome, **C** hide/show controls. Keyboard shortcuts do not interfere with focused controls.

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

The open score itself lasts for the current session; reload starts with Julia Florida. **Library** remembers score bookmarks and favorites across reloads so you can reopen them without maintaining another copy. See the library workflow below.

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

The browser caches the built-in bundle for offline use; the cache is not the original or only copy. **Open score** reads a `.sotto.json` file locally and remembers a bookmark in Library. It does not upload anything to GitHub or to a server, and a page reload returns to the built-in example. Keep your bundle file as the original; **Save score** downloads a separate copy only when requested.

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

## Library without duplicate score files

1. Keep `.sotto.json` files in your preferred folder, such as a locally synced **OneDrive/Scores** folder.
2. Open **Library → Connect folder**, choose that folder, and open a score from the list. Subfolders are included. **Open score / Add score** can bookmark individual files instead.
3. Use the star to mark pieces you are working on; **Favorites** filters the list. Search matches title, composer, and relative path. Recently opened scores appear first within each favorites group.
4. Use **Refresh / reconnect** to discover newly added files. Opening a linked score reads its current contents from disk, including changes made outside Sotto. If the file moved or permission expired, reconnect the folder/file.
5. Choose **Export index** and save `sotto-library.json` in OneDrive. This small metadata file preserves folder labels, relative paths, favorites, and recents, **not score contents or browser permissions**. Import it on another device, then reconnect each folder. Index imports merge by bookmark ID; exporting/importing is manual, not live synchronization.

Desktop Chrome/Edge can store read-only file/directory handles in IndexedDB; permissions may need granting again. A OneDrive folder must be available through the local file picker (and the selected files downloaded by OneDrive when needed). No OneDrive account integration is required. Safari/iPad and other browsers without these pickers retain metadata only: reselect the score or reconnect a folder after reopening the app. On iPad, select OneDrive through the Files picker; folder selection depends on the browser/provider. Bookmark metadata is local to this browser and site address; export the index for backup or transfer. Clearing browser storage removes the index/handles but never deletes the original files. Bookmarks and permissions are not a backup of the score files themselves.

No imported score JSON is stored in IndexedDB, localStorage, or the service-worker cache. Only the bundled example and app assets are cached for offline use. Linked scores require the original file to remain accessible. Removing a library entry or folder removes its bookmarks only.

## Instruments, metronome, and SoundFonts

Open **Sound and metronome settings** (the sliders icon above the score) to select an instrument or configure the click.

- The six instruments work offline: **recorded nylon guitar, piano and violin**, plus **synthesized marimba, organ and flute**. Instrument choice is remembered on this browser and changes all voices together; mute/solo/volume remain independent. Switching waits for recordings to finish loading and keeps the previous sound available until then. The pitches stay unchanged; notes outside a recording bank’s range use pitch-shifted samples.
- Toggle the **Metronome** button, or use **M**. It starts even while the score is paused; while the score plays, clicks are scheduled on the same audio clock as the notes. Pausing the score returns to standalone clicks. Turning the metronome off stops them.
- The first click of each bar is stronger/higher. **Beat** gives two dotted-quarter clicks per bar in 6/8; **Subdivision** gives six eighth-note clicks. In 4/4, these give four/eight clicks respectively.
- **Click volume** is independent of voice volumes and muting. A visible pulse follows the click.

Nylon guitar, piano and violin now use Tone.js samplers with actual recordings, rather than generated waveforms. There is currently **no `.sf2`/`.sf3` SoundFont loader or SoundFont selection menu**. Those files require a SoundFont engine rather than just changing the synthesizer preset. A General MIDI SoundFont would allow its available instrument programs (typically the 128 GM programs and percussion), subject to what the font includes. Candidate engine: [SpessaSynth](https://github.com/spessasus/spessasynth_lib). Imported SoundFonts would remain on-device; network sample libraries would need explicit download/cache behavior.

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
# Actual click scheduling, accents, subdivisions, instruments and offline audio:
node scripts/sound-test.mjs
# File/folder bookmarks, fresh reads, favorites, backup/import, and fallback:
node scripts/library-test.mjs
```

The browser checks use Playwright Chromium (`npx playwright install chromium`); optionally set `CHROME_PATH` to an existing Chromium executable and `BASE_URL` to a preview/deployed URL. `node scripts/browser-test.mjs --pages` tests the `/sotto/` preview including offline playback. They exercise real audio-buffer scheduling, note highlighting, seek/pause, mute/solo, tempo, loop wrapping, repeats, invalid imports, SVG sanitization and responsive layouts. Captures go in `test-results/`.

## Roadmap and current limits

Next work, in practical order:

1. **Library refinements:** automatic/shared index synchronization and optional direct cloud integration; the initial reference-based library and portable favorites index are available now.
2. **SoundFonts and per-voice instruments:** load an SF2/SF3 font locally and select its presets; allow violin melody over guitar accompaniment. Retain the bundled recordings and lightweight synths.
3. **More general import:** derive tempo and instrument transposition automatically, support tempo changes, and simplify preparation. Measure timing, meter changes, structured repeats and explicit LilyPond MIDI playback order are already derived during export; Julia Florida retains its explicit jump map.
4. **Microphone rhythm feedback:** calibrate input/output latency, detect note attacks, and compare them to a fixed-tempo reference. Validate on actual iPad/Safari hardware.
5. **Pitch feedback and following:** start with single-note melody/bass practice, then overlapping guitar notes/chords and following a freely varying tempo.

Current limits: fixed tempo and pulse unit for imported scores; grace notes use a short fixed interpretation; harmonic-specific sounding pitches and expressive tempo changes are not modelled; notation zooms/scrolls but does not reflow; direct browser MusicXML/LilyPond compilation, raw MIDI import, PDF recognition, and microphone assessment are not implemented. Export only LilyPond files you trust, since the compiler executes Scheme.

## Recording credits and maintenance

The 29 MP3 recordings (about 6.4 MB total) come from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments), assembled/edited by Nicholaus P. Brosowsky and distributed under **CC BY 3.0**. Upstream credits quartertone/Freesound for nylon guitar and VSCO/Versilian Studios for piano and violin. Full attribution, source revision, original notices, and file hashes are under [public/samples](public/samples/ATTRIBUTION.md); credits are also linked from the sound settings. The app serves these files from its own deployment, with no third-party sample requests during playback.

Refresh the pinned, unchanged source recordings only when needed:

```sh
python3 scripts/fetch-samples.py
```

A normal checkout/build already includes them. The service worker precaches all three banks so an instrument first selected offline can still load. Runtime gain matching balances the sampled instruments; attack/release envelopes and pitch interpolation are applied during playback.
