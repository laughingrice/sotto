"""Exercise real PDF cropping and evidence output when image tools are present."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

SCRIPTS=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SCRIPTS))
import compare_pages
READY=bool(importlib.util.find_spec('PIL') and shutil.which('pdftoppm'))


@unittest.skipUnless(READY,'comparison tests require Pillow and Poppler')
class ComparisonValidation(unittest.TestCase):
    def config(self, root):
        example=SCRIPTS.parent/'assets'/'capricho-05-08'
        cfg=json.loads((example/'comparison.json').read_text())
        for key in ('original','corrected'):
            cfg[key]['pdf']=str(example/cfg[key]['pdf'])
        path=root/'comparison.json';path.write_text(json.dumps(cfg))
        return path,cfg

    def test_real_pdf_comparison_records_matching_input_hashes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);path,cfg=self.config(root);out=root/'compare.png'
            compare_pages.make_comparison(path,out,dpi=90,width=1000)
            e=json.loads(out.with_suffix('.evidence.json').read_text())
            self.assertEqual(e['image_sha256'],hashlib.sha256(out.read_bytes()).hexdigest())
            self.assertEqual(e['original']['sha256'],hashlib.sha256(Path(cfg['original']['pdf']).read_bytes()).hexdigest())
            self.assertEqual(e['uncertainties'],[])

    def test_out_of_page_crop_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);path,cfg=self.config(root)
            cfg['original']['crops']=[[0,0,10000,10000]];path.write_text(json.dumps(cfg))
            with self.assertRaisesRegex(ValueError,'outside PDF page'):
                compare_pages.make_comparison(path,root/'compare.png',dpi=90,width=1000)

    def test_uncertainties_cannot_be_silently_omitted(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);path,cfg=self.config(root)
            del cfg['uncertainties'];path.write_text(json.dumps(cfg))
            with self.assertRaisesRegex(ValueError,'uncertainties'):
                compare_pages.make_comparison(path,root/'compare.png',dpi=90,width=1000)


if __name__=='__main__':unittest.main()
