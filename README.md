# Sotto v0.1

A local web practice player, starting with Julia Florida. React + TypeScript + Vite, Tone.js/Web Audio, and LilyPond SVG engraving. No accounts, external soundfonts, or cloud uploads.

## Deploy to GitHub Pages

The repository includes a workflow that tests, builds, and publishes the static app. No LilyPond installation or server is needed for deployment: the compiled example score is already included.

1. Open [repository Settings → Pages](https://github.com/laughingrice/sotto/settings/pages).
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open [Actions → Deploy Sotto to GitHub Pages](https://github.com/laughingrice/sotto/actions/workflows/pages.yml), select **Run workflow**, choose **main**, and run it.
4. Once the deployment finishes, visit **https://laughingrice.github.io/sotto/**.

Subsequent pushes to `main` test and deploy automatically. Before Pages is enabled, the workflow still builds and tests successfully and skips publication. The `v0.1` tag records the first release.

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
- Playback with simultaneous active-note highlighting and automatic scrolling.
- Click-to-seek, pause/resume, restart, previous/next bar, and scrubber.
- Tempo control measured in dotted-quarter beats for Julia Florida.
- Piece details in the settings panel; Open and Save score together in the top bar.
- Hide/show all practice controls to give the score the full viewport, with a compact play/pause button. The setting is remembered and playback continues while controls are hidden.
- Voice mute, solo, and independent volume.
- Phrase loops and metronome.
- Both alternate endings, repeated section, and D.C. al Coda for the example.
- Guitar playback one octave below the written notation, including low D2.
- Self-contained synthesized plucked-string tone, generated in the browser.
- Save/open portable `.sotto.json` bundles. Imported SVG is sanitized before rendering.

Keyboard: **Space** play/pause, **←/→** previous/next bar, **R** restart, **M** metronome, **C** hide/show controls. Keyboard shortcuts do not interfere with focused controls.

## Rebuild the score

The editable example source is `scores/julia-florida.ly`. LilyPond 2.26 and Python 3 are needed only for importing/compiling scores; the browser player needs neither.

```sh
npm run export:score
```

The exporter installs a small custom engraver that writes note IDs, durations, voices, ties, score positions and measure numbers while LilyPond renders SVG. It produces `public/scores/julia-florida.sotto.json`. There is no image-to-note guessing or MIDI-to-SVG coordinate matching.

The browser expands the example's performance order separately from the printed page. Repeated performances reference the same notehead IDs. Ties sustain one audio event while highlighting each successive written note. The audio transport is the master clock for both sound and visuals.

### Other LilyPond / MusicXML scores

The v0.1 **Open score** button accepts prepared bundles, not raw LilyPond, MIDI, or PDF. Import/compilation runs locally from the command line:

```sh
musicxml2ly --output=my-score.ly my-score.musicxml
python3 scripts/export_score.py my-score.ly \
  --title "My score" --composer "Composer" \
  --beats-per-bar 4 --beat-unit 1 --bpm 80 --transpose 0 \
  --output my-score.sotto.json
```

Then open the resulting bundle in the app. Use `--transpose -12` for guitar written in the conventional treble octave, `--beats-per-bar 3 --beat-unit 1.5` for a 6/8 score with dotted-quarter tempo. These flags describe playback; they do not change engraving.

The exporter currently requires a single score, an explicit `\layout { }` block, named voices for meaningful part controls, and a constant meter. Julia Florida's repeat/jump sequence is configured explicitly. Other scores currently play in written order; arbitrary repeat navigation, tempo maps, changing meters, and transposing-instrument metadata need a more general importer. Export only LilyPond files you trust, since the compiler executes Scheme.

## Validation

```sh
npm test
npm run build
node scripts/browser-test.mjs
# Against a running production preview, including offline reload/playback:
node scripts/browser-test.mjs --production
```

The browser checks use Playwright Chromium (`npx playwright install chromium`); optionally set `CHROME_PATH` to an existing Chromium executable and `BASE_URL` to a preview/deployed URL. `node scripts/browser-test.mjs --pages` tests the `/sotto/` preview including offline playback. They exercise real audio-buffer scheduling, note highlighting, seek/pause, mute/solo, tempo, loop wrapping, repeats, invalid imports, SVG sanitization and responsive layouts. Captures go in `test-results/`.

## Scope and next steps

This is an editable v0.1 prototype. Microphone rhythm/pitch assessment, PDF optical recognition, raw MIDI import, direct browser MusicXML/LilyPond conversion, natural-guitar sampling, expressive tempo changes, and harmonic-specific sounding pitches are not implemented. Grace notes have a short fixed playback interpretation. Page engraving is fixed; zoom and automatic scrolling are available, but notation does not yet reflow to the tablet width.

Next: validate on the target iPad, simplify the practice engraving/reflow, add a general score import pipeline, then microphone attack timing with latency calibration. Pitch checking and score following can be layered onto the existing event/voice model afterwards.
