#!/usr/bin/env python3
"""Render explicit PDF regions side by side. Requires Poppler and Pillow.

Config paths are relative to the config file; crops use PDF points (72/inch),
with TOP-LEFT origin: [x, y, width, height]. Repeated crops are stacked, useful
when four measures span two source systems. Does not align or verify notes.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys


def render_regions(config, spec, dpi, directory):
    from PIL import Image, ImageChops
    pdf = (config.parent / spec['pdf']).resolve()
    if not pdf.is_file():
        raise ValueError(f'missing PDF: {pdf}')
    page = spec.get('page', 1)
    if not isinstance(page, int) or page < 1:
        raise ValueError('page must be a positive integer')
    executable = shutil.which('pdftoppm')
    if not executable:
        raise ValueError('pdftoppm not found; install Poppler or use bundled runtime')
    prefix = directory / 'page'
    subprocess.run([executable, '-f', str(page), '-l', str(page), '-singlefile',
                    '-r', str(dpi), '-png', str(pdf), str(prefix)], check=True,
                   capture_output=True, text=True, timeout=60)
    with Image.open(prefix.with_suffix('.png')) as raw:
        page_image = raw.convert('RGB')
    crops = spec.get('crops')
    if not crops:
        crops = [None]
    if not isinstance(crops, list):
        raise ValueError('crops must be a list')
    images = []
    for crop in crops:
        if crop is None:
            image = page_image.copy()
        else:
            if len(crop) != 4 or any(not math.isfinite(float(x)) for x in crop):
                raise ValueError('crop must be four finite numbers')
            x, y, w, h = (float(v) * dpi / 72 for v in crop)
            if x < 0 or y < 0 or w <= 0 or h <= 0 or x+w > page_image.width+1 or y+h > page_image.height+1:
                raise ValueError(f'crop falls outside PDF page: {crop}')
            image = page_image.crop(tuple(round(v) for v in (x, y, x+w, y+h)))
        if spec.get('trim_white', False):
            box = ImageChops.difference(image, Image.new('RGB', image.size, 'white')).getbbox()
            if box:
                image = image.crop(box)
        images.append(image)
    return images, {'pdf': str(pdf), 'page': page, 'crops': crops,
                    'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest()}


def make_comparison(config, output, dpi=180, width=3200):
    from PIL import Image, ImageDraw, ImageFont
    data = json.loads(config.read_text())
    if not isinstance(data.get('uncertainties'), list):
        raise ValueError('config must explicitly include uncertainties (or [])')
    with tempfile.TemporaryDirectory(prefix='pdf2ly-compare-') as temp:
        directory = Path(temp)
        left, original = render_regions(config, data['original'], dpi, directory)
        right, corrected = render_regions(config, data['corrected'], dpi, directory)
    margin, gap = 40, 70
    column = (width - 2*margin - gap)//2
    columns = []
    # Rescale each column uniformly; never stretch individual notes to align them.
    for regions in (left, right):
        scale = column / max(image.width for image in regions)
        columns.append([im.resize((round(im.width*scale), round(im.height*scale)),
                                  Image.Resampling.LANCZOS) for im in regions])
    height = 140 + max(sum(im.height+30 for im in col) for col in columns)
    font = ImageFont.load_default(size=28)
    title_font = ImageFont.load_default(size=38)
    # Long uncertainty notes belong in the evidence JSON and final reply, not a
    # clipped raster footer. The graphic records how many remain.
    canvas = Image.new('RGB', (width, height+85), 'white')
    draw = ImageDraw.Draw(canvas)
    draw.text((margin, 20), data.get('title', 'Score comparison'), font=title_font, fill='#182838')
    for x, col, label in [(margin, columns[0], 'Original PDF'),
                           (margin+column+gap, columns[1], 'Corrected LilyPond')]:
        draw.text((x, 85), label, font=font, fill='#182838')
        y = 140
        for image in col:
            canvas.paste(image, (x, y)); y += image.height+30
    draw.line((width//2, 85, width//2, height), fill='#c4cbd3', width=2)
    draw.text((margin, height+20), f"Unresolved readings: {len(data['uncertainties'])} (see evidence JSON)",
              font=font, fill='#182838')
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)
    original['pdf'] = os.path.relpath(original['pdf'], output.parent)
    corrected['pdf'] = os.path.relpath(corrected['pdf'], output.parent)
    evidence = dict(original=original, corrected=corrected,
                    uncertainties=data['uncertainties'],
                    image_sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                    note='Human must inspect pitches, notation, endpoints and page layout; this script only renders.')
    output.with_suffix('.evidence.json').write_text(json.dumps(evidence, indent=2)+'\n')
    return output


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('config', type=Path)
    ap.add_argument('--output', required=True, type=Path)
    ap.add_argument('--dpi', type=int, default=180)
    ap.add_argument('--width', type=int, default=3200)
    args = ap.parse_args()
    try:
        if args.dpi < 72 or args.width < 800:
            raise ValueError('dpi must be >=72 and width >=800')
        print(make_comparison(args.config.resolve(), args.output.resolve(), args.dpi, args.width))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        print(f'FAIL: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
