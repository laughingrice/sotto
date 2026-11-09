#!/usr/bin/env python3
"""Vendor a small, reproducible selection of CC-BY 3.0 instrument recordings.

Run only when refreshing bundled samples. The app never fetches this external
repository: it loads the committed MP3s from Sotto's own deployment.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import re
import urllib.request

REVISION = '622c2f1c32c8cfce4158ddc3eb26e518ddef37e5'
BASE = f'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/{REVISION}/'
DESTINATION = Path(__file__).resolve().parent.parent / 'public' / 'samples'
CHOICES = {
    'guitar': ('guitar-nylon', ['D2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'E5', 'A5']),
    'piano': ('piano', ['C2', 'F#2', 'C3', 'F#3', 'C4', 'F#4', 'C5', 'F#5', 'C6']),
    'violin': ('violin', ['A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6']),
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
        data = fetch(source)
        output = DESTINATION / target
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
        return {'path': target, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    with ThreadPoolExecutor(max_workers=6) as pool:
        files = sorted(pool.map(download, jobs), key=lambda item: item['path'])
    manifest = {'source': 'https://github.com/nbrosowsky/tonejs-instruments', 'revision': REVISION,
                'license': 'CC-BY-3.0', 'banks': banks, 'files': files}
    (DESTINATION / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (DESTINATION / 'UPSTREAM-LICENSE.md').write_bytes(fetch('LICENSE.md'))
    (DESTINATION / 'UPSTREAM-SOURCES.txt').write_bytes(fetch('sample-source-info.txt'))
    print(f'Vendored {len(files)} original MP3 recordings, {sum(item["bytes"] for item in files):,} bytes.')
