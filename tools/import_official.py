"""Extract official questions, answer keys and original raster illustrations.
Run with the bundled Python (pdfplumber, pypdf and Pillow required).
Keep original commentary and editable personal explanations together.
"""
import json
import re
from pathlib import Path
import pdfplumber
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]


def normalized(text):
    text = re.sub(r'\(cid:(?:2|4|25|30)\)', '-', text)
    text = re.sub(r'([а-яёА-ЯЁ])-\s*\n\s*([а-яёА-ЯЁ])', r'\1\2', text)
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'\s+([.,;:?!])', r'\1', text)
    return text


def chars_without_spaces(page):
    return page.filter(lambda obj: obj.get('object_type') != 'char' or obj.get('text') != ' ')


def comments(ticket):
    with pdfplumber.open(ROOT / 'sources' / f'{ticket}_comments.pdf') as doc:
        chunks = []
        for page in doc.pages:
            page = chars_without_spaces(page)
            body_chars = [c for c in page.chars if 60 <= c['top'] < page.height-20]
            occupied = [(x, sum(c['x0'] <= x < c['x1'] for c in body_chars)) for x in range(275,336)]
            minimum = min(n for _,n in occupied)
            runs = []
            for x,n in occupied:
                if n == minimum:
                    if runs and x == runs[-1][-1]+1:
                        runs[-1].append(x)
                    else:
                        runs.append([x])
            gutter = max(runs,key=len)
            split = sum(gutter)/len(gutter)
            for left, right in ((0, split), (split, page.width)):
                column = page.filter(lambda obj: obj.get('object_type') != 'char' or left <= obj['x0'] < right)
                chunks.append(column.crop((left, 60, right, page.height - 20)).extract_text(x_tolerance=1.4) or '')
    text = '\n'.join(chunks)
    starts = list(re.finditer(r'^\s*(\d{1,2})\.\s*(?=[А-ЯЁA-Z«])', text, re.M))
    result = {}
    for index, match in enumerate(starts):
        number = int(match[1])
        body = text[match.end():starts[index+1].start() if index+1 < len(starts) else len(text)]
        answer = re.search(r'[ОO]\s*т\s*в\s*е\s*т\s*[—–-]\s*([1-4З])', body)
        if not answer or number in result:
            raise ValueError(f'Cannot extract answer: {ticket}/{number}')
        prose = normalized(body[:answer.start()])
        rule = re.findall(r'\(п\.?\s*[^)]+\)', prose)
        result[number] = {'correct': answer[1].replace('З','3'), 'text': prose, 'rule': '; '.join(rule)}
    if set(result) != set(range(1, 21)):
        raise ValueError(f'Expected 20 comments, got {len(result)}: ticket {ticket}')
    return result


def main():
    image_folder = ROOT / 'public' / 'images'
    image_folder.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / 'sources' / 'manifest.json').read_text(encoding='utf-8'))
    questions = []
    explanations = {}
    source_commentary = {}
    content = ROOT / 'public' / 'content'
    existing = json.loads((content / 'explanations.json').read_text(encoding='utf-8')) if (content / 'explanations.json').exists() else {}
    overrides = json.loads((ROOT / 'content' / 'transcription-overrides.json').read_text(encoding='utf-8'))
    marker_corrections = json.loads((ROOT / 'content' / 'choice-marker-corrections.json').read_text(encoding='utf-8'))
    for ticket in range(1, 41):
        keys = comments(ticket)
        for first in (1, 6, 11, 16):
            filename = f'{ticket}_{first}-{first+4}.pdf'
            file = ROOT / 'sources' / filename
            pdf = PdfReader(file)
            images = {name.strip('/'): item.image for name, item in pdf.pages[0].images.items()}
            with pdfplumber.open(file) as doc:
                page = doc.pages[0]
                markers = [w for w in page.extract_words(x_tolerance=1) if w['text'] in [str(n) for n in range(first,first+5)]
                           and w['x0'] > 500 and w['height'] >= 9.5 and w['top'] > 100]
                markers.sort(key=lambda w:w['top'])
                for offset in range(5):
                    number = first + offset
                    key = f'ab-{ticket:02}-{number:02}'
                    top, bottom = 50 + offset * 136.063, 186 + offset * 136.063
                    if len(markers) == 5:
                        top = max(30, markers[0]['top']-124) if offset == 0 else markers[offset-1]['bottom']+4
                        bottom = markers[offset]['bottom']+4
                    cleaned = chars_without_spaces(page)
                    # The large question number in the right lower corner is decorative.
                    cleaned = cleaned.filter(lambda obj: not (obj.get('object_type') == 'char'
                        and obj.get('x0', 0) > 500 and obj.get('top', 0) > bottom - 22
                        and obj.get('top', 0) < bottom and obj.get('size', 0) >= 9.5))
                    override = overrides.get(filename, [None]*5)[offset]
                    if override:
                        raw = override['text'] + '\n' + '\n'.join(f'{i}. {a}' for i,a in enumerate(override['answers'],1))
                    else:
                        raw = cleaned.crop((50, top, min(550,page.width), bottom)).extract_text(x_tolerance=1.3) or ''
                    if key in marker_corrections:
                        fix = marker_corrections[key]
                        if fix['from'] not in raw:
                            raise ValueError('Choice marker correction no longer matches: ' + key)
                        raw = raw.replace(fix['from'], fix['to'], 1)
                    matches = list(re.finditer(r'(?<!\S)([1-4])\.(?:\s+|(?=[А-ЯЁA-Zа-яёa-z«]))\s*', raw))
                    if len(matches) not in (2, 3, 4):
                        raise ValueError(f'Cannot extract choices: {key}: {raw}')
                    prompt = normalized(raw[:matches[0].start()])
                    answers = [{'id': m[1], 'text': normalized(raw[m.end():matches[i+1].start() if i+1 < len(matches) else len(raw)])}
                               for i, m in enumerate(matches)]
                    answers.sort(key=lambda a:a['id'])
                    if [a['id'] for a in answers] != [str(i) for i in range(1, len(answers)+1)]:
                        raise ValueError('Nonsequential choices: ' + key)
                    illustrations = [im for im in page.images if top <= im['top'] < bottom and im['width'] > 40]
                    image = None
                    if override and override['crop']:
                        page.crop(tuple(override['crop'])).to_image(resolution=190).original.convert('RGB').save(image_folder / (key+'.webp'), 'WEBP', lossless=True, method=6)
                        image = '/images/' + key + '.webp'
                    elif illustrations and not override:
                        if len(illustrations) == 1:
                            image_object = images[illustrations[0]['name']].convert('RGB')
                        else:
                            bounds = (min(im['x0'] for im in illustrations), min(im['top'] for im in illustrations),
                                      max(im['x1'] for im in illustrations), max(im['bottom'] for im in illustrations))
                            image_object = page.crop(bounds).to_image(resolution=170).original.convert('RGB')
                        image_object.save(image_folder / (key + '.webp'), 'WEBP', lossless=True, method=6)
                        image = '/images/' + key + '.webp'
                    source = next(m['url'] for m in manifest if m['file'] == filename)
                    questions.append({'id': key, 'ticket': ticket, 'number': number,
                        'block': f'ticket-{ticket:02}-group-{(first-1)//5+1}',
                        'theme': (first-1)//5+1,
                        'topic': ['Основы движения, терминология и обязанности', 'Сигналы и манёвры',
                                  'Движение, остановка и перекрёстки', 'Безопасность, ответственность и первая помощь'][(first-1)//5],
                        'text': prompt, 'image': image, 'answers': answers,
                        'correct_id': keys[number]['correct'], 'source_url': source})
                    source_commentary[key] = keys[number]
                    explanations[key] = {'ticket': ticket, 'question': number,
                        'original': {'text': keys[number]['text'], 'rule': keys[number]['rule']},
                        'my': existing.get(key, {}).get('my', {'text': '', 'rule': ''})}
        print(f'Ticket {ticket}: questions and illustrations extracted.', flush=True)
    catalog = {'mode': 'ab', 'revision': 'official-page-2026-10-09-v1',
               'source_url': 'https://госавтоинспекция.рф/mens/avtovladeltsam/abm/',
               'terms_url': 'https://госавтоинспекция.рф/mens/avtovladeltsam/abm/#copyright',
               'verified_at': '2026-10-09', 'questions': questions}
    (content / 'questions.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    (content / 'explanations.json').write_text(json.dumps(explanations, ensure_ascii=False, indent=2), encoding='utf-8')
    (ROOT / 'sources' / 'commentary.json').write_text(json.dumps(source_commentary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Imported {len(questions)} official questions.', flush=True)


if __name__ == '__main__':
    main()
