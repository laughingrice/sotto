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

The LilyPond file needs a single score, named voices for useful voice controls, and an explicit `\layout { }` block. Start by compiling the `.ly` file normally to catch notation errors.

### 2. Export the player bundle

From this repository's root, for **4/4 guitar**:

```sh
python3 scripts/export_score.py my-score.ly \
  --title "My score" --composer "Composer" \
  --beats-per-bar 4 --beat-unit 1 --bpm 80 --transpose -12 \
  --output my-score.sotto.json
```

For **6/8 guitar**, with a dotted-quarter pulse:

```sh
python3 scripts/export_score.py my-score.ly \
  --title "My score" --composer "Composer" \
  --beats-per-bar 3 --beat-unit 1.5 --bpm 44 --transpose -12 \
  --output my-score.sotto.json
```

| Option | Meaning |
| --- | --- |
| `--beats-per-bar` | Bar length in quarter-note units: 4 for 4/4, 3 for 3/4 or 6/8. |
| `--beat-unit` | Tempo pulse in quarter-note units: 1 for a quarter, 1.5 for a dotted quarter. This also sets the metronome beat. |
| `--bpm` | Number of those pulses per minute. |
| `--transpose` | Written-to-sounding semitones: -12 for conventional guitar treble notation, 0 for concert-pitch piano. |

The export contains SVG score pages, notehead identities, note timings, voices, ties, bar numbers, and playback metadata in one portable file. No separate PDF, MIDI, or audio file is needed. Playback instrument selection changes the timbre; it does not alter the score's pitch mapping or transposition.

### 3. Open it on any device

Transfer `my-score.sotto.json` to the tablet using Files, AirDrop, or a file-sharing service, open Sotto, and choose **Open score**. Select the bundle. This reads it locally; it does not upload the file. You can also use **Save score** to download a copy.

Opening a bundle lasts for the current session. Reloading currently returns to Julia Florida. Keep the bundle so you can reopen it; a persistent multi-score library is on the roadmap.

### Rebuild the included example

The editable example is `scores/julia-florida.ly`. After editing it:

```sh
npm run export:score
```

This regenerates `public/scores/julia-florida.sotto.json`. The exporter installs a custom engraver that writes note IDs, durations, voices, ties, score positions and measure numbers while LilyPond renders SVG. The player expands Julia Florida's repeat/coda order separately; repeated performances reference the same notehead IDs.

### Where scores are stored, and what “Open” means

The example is committed to this repository in two forms:

- `scores/julia-florida.ly`: editable notation source.
- `public/scores/julia-florida.sotto.json`: rendered SVG pages, note timings, voices, metadata, and playback sequence. This is what the deployed app downloads.

The browser caches the built-in bundle for offline use; the cache is not the original or only copy. **Open score** reads a `.sotto.json` file locally for the current session. It does not upload anything to GitHub or to a server, and a page reload returns to the built-in example. Keep your bundle file to reopen it later; **Save score** downloads a copy.

To publish a different built-in score for everyone, commit its `.ly` source under `scores/` and its bundle under `public/scores/`, then change `DEFAULT_SCORE` in `src/App.tsx` to that bundle's URL, using `import.meta.env.BASE_URL` as the prefix. Push to `main`; GitHub Actions rebuilds and deploys. Simply adding a file to the repo does not list it in the app: a multi-score library is not implemented yet.

The exporter currently requires a single score, an explicit `\layout { }` block, named voices for meaningful part controls, and a constant meter. Julia Florida's repeat/jump sequence is configured explicitly. Other scores currently play in written order; arbitrary repeat navigation, tempo maps, changing meters, and transposing-instrument metadata need a more general importer. Export only LilyPond files you trust, since the compiler executes Scheme.

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
npm run build
node scripts/browser-test.mjs
# Against a running production preview, including offline reload/playback:
node scripts/browser-test.mjs --production
# Ultrawide sizing, zoom, panning, and fit-to-width regression checks:
node scripts/layout-test.mjs
# Actual click scheduling, accents, subdivisions, instruments and offline audio:
node scripts/sound-test.mjs
```

The browser checks use Playwright Chromium (`npx playwright install chromium`); optionally set `CHROME_PATH` to an existing Chromium executable and `BASE_URL` to a preview/deployed URL. `node scripts/browser-test.mjs --pages` tests the `/sotto/` preview including offline playback. They exercise real audio-buffer scheduling, note highlighting, seek/pause, mute/solo, tempo, loop wrapping, repeats, invalid imports, SVG sanitization and responsive layouts. Captures go in `test-results/`.

## Roadmap and current limits

Next work, in practical order:

1. **Persistent score library:** keep imported pieces across reloads, choose between scores, and manage offline copies.
2. **SoundFonts and per-voice instruments:** load an SF2/SF3 font locally and select its presets; allow violin melody over guitar accompaniment. Retain the bundled recordings and lightweight synths.
3. **More general import:** derive meter, tempo, transposition and repeat navigation automatically, support tempo/meter changes, and simplify preparation. Julia Florida's repeat/jump sequence is currently configured explicitly; other exports play in written order.
4. **Microphone rhythm feedback:** calibrate input/output latency, detect note attacks, and compare them to a fixed-tempo reference. Validate on actual iPad/Safari hardware.
5. **Pitch feedback and following:** start with single-note melody/bass practice, then overlapping guitar notes/chords and following a freely varying tempo.

Current limits: constant meter and fixed tempo for imported scores; grace notes use a short fixed interpretation; harmonic-specific sounding pitches and expressive tempo changes are not modelled; notation zooms/scrolls but does not reflow; direct browser MusicXML/LilyPond compilation, raw MIDI import, PDF recognition, and microphone assessment are not implemented. Export only LilyPond files you trust, since the compiler executes Scheme.

## Recording credits and maintenance

The 29 MP3 recordings (about 6.4 MB total) come from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments), assembled/edited by Nicholaus P. Brosowsky and distributed under **CC BY 3.0**. Upstream credits quartertone/Freesound for nylon guitar and VSCO/Versilian Studios for piano and violin. Full attribution, source revision, original notices, and file hashes are under [public/samples](public/samples/ATTRIBUTION.md); credits are also linked from the sound settings. The app serves these files from its own deployment, with no third-party sample requests during playback.

Refresh the pinned, unchanged source recordings only when needed:

```sh
python3 scripts/fetch-samples.py
```

A normal checkout/build already includes them. The service worker precaches all three banks so an instrument first selected offline can still load. Runtime gain matching balances the sampled instruments; attack/release envelopes and pitch interpolation are applied during playback.
