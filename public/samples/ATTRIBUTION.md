# Instrument recording credits

Sotto includes selected, unmodified MP3 recordings from **tonejs-instruments**,
edited and assembled by **Nicholaus P. Brosowsky**:

- Project: https://github.com/nbrosowsky/tonejs-instruments
- Revision: `622c2f1c32c8cfce4158ddc3eb26e518ddef37e5`
- Sample license: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**
- License text: https://creativecommons.org/licenses/by/3.0/
- Upstream license notice: [UPSTREAM-LICENSE.md](UPSTREAM-LICENSE.md)
- Original source notes: [UPSTREAM-SOURCES.txt](UPSTREAM-SOURCES.txt)

The upstream library credits these original sources:

- Nylon guitar: **quartertone**, “ClassicalGuitar MultiSampled,” Freesound pack 11573:
  https://freesound.org/people/quartertone/packs/11573/
- Piano and violin: **VSCO / Versilian Studios Community Edition**:
  http://vis.versilstudios.net/vsco-community.html

Sotto selected 29 recordings and renamed their containing directories. The MP3
files are otherwise unchanged. During playback, Sotto adjusts gain, applies
attack/release envelopes, and repitches the nearest recording when necessary.
The selection, sizes, and SHA-256 hashes are listed in [manifest.json](manifest.json).
No endorsement by the recording creators is implied.

Refresh this subset using `python3 scripts/fetch-samples.py` from the repository.
The application serves its own bundled files and does not contact the upstream
sample host during playback.
