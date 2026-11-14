#!/usr/bin/env python3
"""Vendor pinned CC-BY 3.0 melodic recordings and CC0 acoustic drum one-shots.

Run only when refreshing bundled samples. The app never fetches this external
repository: it loads the committed MP3s from Sotto's own deployment.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import re
import urllib.request
import subprocess
import tempfile

REVISION = '622c2f1c32c8cfce4158ddc3eb26e518ddef37e5'
BASE = f'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/{REVISION}/'
DESTINATION = Path(__file__).resolve().parent.parent / 'public' / 'samples'
CHOICES = {
    'guitar': ('guitar-nylon', ['D2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'E5', 'A5']),
    'piano': ('piano', ['C2', 'F#2', 'C3', 'F#3', 'C4', 'F#4', 'C5', 'F#5', 'C6']),
    'bass-electric': ('bass-electric', ['C#1', 'E1', 'G1', 'A#1', 'E2', 'G2', 'A#2', 'E3', 'E4']),
    'violin': ('violin', ['A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6']),
}

DRUM_REVISION = '9f04cf9a734527edfbb0a4eee1f674e45bbf71bc'
DRUM_BASE = f'https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/{DRUM_REVISION}/'
DRUMS = {
    'kick': 'Samples/kickmic/kick/kickmic_kick_snon_vl4_rr1.flac',
    'snare': 'Samples/mid/snare/mid_snare_center_vl8.flac',
    'sidestick': 'Samples/mid/snare/mid_snare_crossstick_vl8.flac',
    'hihat-closed': 'Samples/mid/hh/mid_hh_closed_vl3_rr1.flac',
    'hihat-open': 'Samples/mid/hh/mid_hh_open_vl3_rr1.flac',
    'hihat-pedal': 'Samples/mid/hh/mid_hh_pedal_vl3_rr1.flac',
    'tom-high': 'Samples/mid/htom/mid_htom_center_vl8.flac',
    'tom-low': 'Samples/mid/ltom/mid_ltom_center_vl8.flac',
    'crash': 'Samples/mid/crash/mid_crash_crash_vl3_rr1.flac',
    'ride': 'Samples/mid/ride/mid_ride_ride_vl3_rr1.flac',
    'ride-bell': 'Samples/mid/ride/mid_ride_bell_vl3_rr1.flac',
}


def fetch(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as response:
        return response.read()


if __name__ == '__main__':
    library = fetch('Tonejs-Instruments.js').decode()
    jobs, banks = [], {}
    for instrument, (source, notes) in CHOICES.items():
        block = re.search(r"    '" + re.escape(source) + r"': \{(.*?)\n    \}", library, re.S).group(1)
        available = dict(re.findall(r"'([^']+)': '([^']+)'", block))
        banks[instrument] = {}
        for note in notes:
            name = available[note].replace('.[mp3|ogg]', '.mp3')
            target = f'{instrument}/{name}'
            jobs.append((f'samples/{source}/{name}', target))
            banks[instrument][note] = target

    def download(job):
        source, target = job
        output = DESTINATION / target
        output.parent.mkdir(parents=True, exist_ok=True)
        data = output.read_bytes() if output.exists() else fetch(source)
        output.write_bytes(data)
        return {'path': target, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    with ThreadPoolExecutor(max_workers=6) as pool:
        files = sorted(pool.map(download, jobs), key=lambda item: item['path'])
    banks['drums'] = {}
    for name, source in DRUMS.items():
        path = f'drums/{name}.mp3'
        output = DESTINATION / path
        output.parent.mkdir(parents=True, exist_ok=True)
        if not output.exists():
            with urllib.request.urlopen(DRUM_BASE + source, timeout=60) as response:
                original = response.read()
            with tempfile.TemporaryDirectory(prefix='sotto-drums-') as temp:
                flac = Path(temp) / 'source.flac'; flac.write_bytes(original)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(flac), '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '128k', str(output)], check=True)
        data = output.read_bytes()
        files.append({'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'source': source})
        banks['drums'][name] = path
    files.sort(key=lambda item: item['path'])
    with urllib.request.urlopen(DRUM_BASE + 'LICENSE', timeout=60) as response:
        (DESTINATION / 'DRUMS-LICENSE.txt').write_bytes(response.read())
    manifest = {'source': 'https://github.com/nbrosowsky/tonejs-instruments', 'revision': REVISION,
                'license': 'CC-BY-3.0', 'drumSource': {'url': 'https://github.com/sfzinstruments/virtuosity_drums', 'revision': DRUM_REVISION, 'license': 'CC0-1.0', 'conversion': 'Mono 44.1 kHz 128 kbps MP3'}, 'banks': banks, 'files': files}
    (DESTINATION / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (DESTINATION / 'UPSTREAM-LICENSE.md').write_bytes(fetch('LICENSE.md'))
    (DESTINATION / 'UPSTREAM-SOURCES.txt').write_bytes(fetch('sample-source-info.txt'))
    print(f'Vendored {len(files)} bundled recordings, {sum(item["bytes"] for item in files):,} bytes.')
