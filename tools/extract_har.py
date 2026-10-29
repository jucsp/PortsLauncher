import os
import sys
import json
import base64
import gzip
import zlib
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = BASE_DIR / 'Documentación'
FIXTURES_DIR = BASE_DIR / 'fixtures'
GW_FIXTURES_DIR = FIXTURES_DIR / 'gamewave'
QUIVER_FIXTURES_DIR = FIXTURES_DIR / 'quiver'


def decode_content(content_dict):
    text = content_dict.get('text', '')
    encoding = content_dict.get('encoding', '').lower()
    if not text:
        return None
    raw_bytes = None
    if encoding == 'base64':
        raw_bytes = base64.b64decode(text)
    else:
        raw_bytes = text.encode('utf-8')

    if raw_bytes.startswith(b'\x1f\x8b'):
        try:
            raw_bytes = gzip.decompress(raw_bytes)
        except Exception:
            pass
    elif raw_bytes.startswith(b'x') and len(raw_bytes) > 2:
        try:
            raw_bytes = zlib.decompress(raw_bytes)
        except Exception:
            pass

    try:
        decoded_text = raw_bytes.decode('utf-8')
    except UnicodeDecodeError:
        decoded_text = text

    try:
        return json.loads(decoded_text)
    except json.JSONDecodeError:
        return None


def extract_gamewave(har_path):
    print(f'Procesando GameWave HAR: {har_path.name}')
    with open(har_path, 'r', encoding='utf-8') as f:
        har = json.load(f)

    entries = har.get('log', {}).get('entries', [])
    extracted = {}
    for entry in entries:
        url = entry.get('request', {}).get('url', '')
        content = entry.get('response', {}).get('content', {})
        if '/ports/catalog.json' in url:
            data = decode_content(content)
            if data:
                extracted['catalog'] = data
        elif '/ports/emulators.json' in url:
            data = decode_content(content)
            if data:
                extracted['emulators'] = data
        elif '/ports/webgames.json' in url:
            data = decode_content(content)
            if data:
                extracted['webgames'] = data
    return extracted


def extract_quiver(har_path):
    print(f'Procesando Quiver HAR: {har_path.name}')
    with open(har_path, 'r', encoding='utf-8') as f:
        har = json.load(f)

    entries = har.get('log', {}).get('entries', [])
    pages = []
    for entry in entries:
        url = entry.get('request', {}).get('url', '')
        content = entry.get('response', {}).get('content', {})
        if '/api/v1/apps' in url:
            data = decode_content(content)
            if data:
                pages.append({'url': url, 'data': data})
    return pages


def main():
    GW_FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    QUIVER_FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    # 1. GameWave 2026-10-22
    gw_har_22 = DOCS_DIR / 'gamewave.digital_Archive [26-10-22 22-46-28].har'
    if gw_har_22.exists():
        data_22 = extract_gamewave(gw_har_22)
        if 'catalog' in data_22:
            v = data_22['catalog'].get('catalogVersion', '2026.10.22.1')
            out = GW_FIXTURES_DIR / f'catalog-{v}.json'
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(data_22['catalog'], f, indent=2, ensure_ascii=False)
            print(f'  Guardado: {out.name} ({len(data_22["catalog"].get("apps", []))} apps)')
        if 'emulators' in data_22:
            out = GW_FIXTURES_DIR / 'emulators-2026.10.22.1.json'
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(data_22['emulators'], f, indent=2, ensure_ascii=False)
            print(f'  Guardado: {out.name}')
        if 'webgames' in data_22:
            out = GW_FIXTURES_DIR / 'webgames.json'
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(data_22['webgames'], f, indent=2, ensure_ascii=False)
            print(f'  Guardado: {out.name}')

    # 2. GameWave 2026-10-28 (catalogVersion 2026.10.24.3)
    gw_har_24 = None
    for cand in [
        DOCS_DIR / 'gamewave.digital_Archive [26-10-28 14-43-05].har',
        DOCS_DIR / 'gamewave.digital_Archive [26-10-24 14-43-05].har'
    ]:
        if cand.exists():
            gw_har_24 = cand
            break

    if gw_har_24:
        data_24 = extract_gamewave(gw_har_24)
        if 'catalog' in data_24:
            v = data_24['catalog'].get('catalogVersion', '2026.10.24.3')
            out_v = GW_FIXTURES_DIR / f'catalog-{v}.json'
            out_latest = GW_FIXTURES_DIR / 'catalog.json'
            with open(out_v, 'w', encoding='utf-8') as f:
                json.dump(data_24['catalog'], f, indent=2, ensure_ascii=False)
            with open(out_latest, 'w', encoding='utf-8') as f:
                json.dump(data_24['catalog'], f, indent=2, ensure_ascii=False)
            print(f'  Guardado: {out_v.name} y {out_latest.name} ({len(data_24["catalog"].get("apps", []))} apps)')
        if 'emulators' in data_24:
            out = GW_FIXTURES_DIR / 'emulators.json'
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(data_24['emulators'], f, indent=2, ensure_ascii=False)
            print(f'  Guardado: {out.name}')

    # 3. Quiver
    quiver_har = DOCS_DIR / 'quiverlauncher.com_Archive [26-10-28 14-50-00].har'
    if quiver_har.exists():
        quiver_pages = extract_quiver(quiver_har)
        all_pages_payloads = []
        unique_apps = []
        seen_ids = set()

        for idx, item in enumerate(quiver_pages, start=1):
            page_data = item['data']
            all_pages_payloads.append({'url': item['url'], 'response': page_data})
            page_file = QUIVER_FIXTURES_DIR / f'page_{idx:02d}.json'
            with open(page_file, 'w', encoding='utf-8') as f:
                json.dump(page_data, f, indent=2, ensure_ascii=False)

            items = page_data.get('items', [])
            for app in items:
                app_id = app.get('id') or app.get('slug')
                if app_id and app_id not in seen_ids:
                    seen_ids.add(app_id)
                    unique_apps.append(app)

        with open(QUIVER_FIXTURES_DIR / 'apps_all_pages.json', 'w', encoding='utf-8') as f:
            json.dump(all_pages_payloads, f, indent=2, ensure_ascii=False)
        with open(QUIVER_FIXTURES_DIR / 'apps_unique.json', 'w', encoding='utf-8') as f:
            json.dump(unique_apps, f, indent=2, ensure_ascii=False)
        print(f'  Guardadas {len(quiver_pages)} páginas, apps_all_pages.json y apps_unique.json ({len(unique_apps)} apps únicas)')

    print('Extracción completada con éxito.')

if __name__ == '__main__':
    main()
