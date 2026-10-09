"""Download the 200 PDF links observed on the official ABM page, 2026-10-09.
No third-party question banks. The six corrected links override the default paths.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import urlopen
import json
import time

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://xn--90adear.xn--p1ai/upload/site1000/folder/original/'
PREFIX = 'avtovladeltsam/fees/abm-2023/'
OVERRIDES = {
    (3, 1): BASE + '%D0%AD%D0%BA%D0%B7_%D0%B1%D0%B8%D0%BB%D0%B5%D1%82%D1%8B/abm/3_1-5.pdf.pdf',
    (4, 6): BASE + PREFIX + '4_6-10.pdf_1.pdf',
    (20, 6): 'https://xn--90adear.xn--p1ai/upload/site95/folder/original/20_%D0%B1%D0%B8%D0%BB%D0%B5%D1%82_6_-10_%D0%B8%D1%81%D0%BF%D1%80.pdf.pdf',
    (28, 11): BASE + '%D0%AD%D0%BA%D0%B7%D0%B0%D0%BC%D0%B5%D0%BD%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%BD%D1%8B%D0%B5_%D0%B1%D0%B8%D0%BB%D0%B5%D1%82%D1%8B/28_11-15_1.pdf.pdf',
    (33, 6): BASE + '%D0%AD%D0%BA%D0%B7_%D0%B1%D0%B8%D0%BB%D0%B5%D1%82%D1%8B/abm/33_6-10.pdf.pdf',
    (33, 11): BASE + '%D0%AD%D0%BA%D0%B7_%D0%B1%D0%B8%D0%BB%D0%B5%D1%82%D1%8B/abm/33_11-15.pdf.pdf',
}


def main():
    folder = ROOT / 'sources'
    folder.mkdir(exist_ok=True)
    manifest = []
    for ticket in range(1, 41):
        for first in (1, 6, 11, 16):
            filename = f'{ticket}_{first}-{first+4}.pdf'
            manifest.append({'ticket': ticket, 'first': first, 'file': filename,
                             'url': OVERRIDES.get((ticket, first), BASE + PREFIX + filename + '.pdf')})
        manifest.append({'ticket': ticket, 'first': None, 'file': f'{ticket}_comments.pdf',
                         'url': BASE + PREFIX + f'comments/{ticket}-komment-abm-2023.pdf.pdf'})
    (folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

    def download(item):
        target = folder / item['file']
        if target.exists() and target.read_bytes().startswith(b'%PDF'):
            return
        for retry in range(3):
            try:
                with urlopen(item['url'], timeout=30) as response:
                    data = response.read()
                if not data.startswith(b'%PDF'):
                    raise ValueError('Not a PDF: ' + item['file'])
                target.write_bytes(data)
                return
            except Exception:
                if retry == 2:
                    raise
                time.sleep(1)

    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(download, item): item for item in manifest}
        for count, future in enumerate(as_completed(futures), 1):
            try:
                future.result()
            except Exception as exc:
                failures.append((futures[future]['file'], str(exc)))
            if count % 25 == 0:
                print(f'{count}/200 PDFs downloaded; failures={len(failures)}', flush=True)
    if failures:
        print(json.dumps(failures))
        raise SystemExit(1)
    print('All 200 official PDFs downloaded.', flush=True)


if __name__ == '__main__':
    main()
