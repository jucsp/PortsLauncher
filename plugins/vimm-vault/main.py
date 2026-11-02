#!/usr/bin/env python3
"""Vimm's Vault ROM Provider — plugin de PortsLauncher.

Proveedor *asistido* que permite buscar títulos en The Vault de Vimm's Lair y
abrir su página oficial en el navegador para que el usuario descargue su propia
copia. El plugin NO aloja, distribuye ni descarga ROMs por sí mismo: únicamente
enlaza a la ficha oficial y, opcionalmente, organiza el archivo que el usuario
haya descargado manualmente.

Implementa el protocolo descrito en ``docs/PLUGINS.md``:

* ``check``      -> estado del plugin.
* ``search``     -> busca títulos y devuelve JSON con los resultados.
* ``provision``  -> abre la ficha en el navegador y organiza el archivo descargado.

Toda la salida de máquina se emite como líneas JSON por ``stdout``; los mensajes
humanos van a ``stderr`` para no romper el parseo del launcher.
"""

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

# --------------------------------------------------------------------------- #
# Constantes
# --------------------------------------------------------------------------- #

VERSION = "1.0.0"
BASE_URL = "https://vimm.net"
SEARCH_ENDPOINT = "https://vimm.net/vault/?p=list&q={query}"
DETAIL_URL = BASE_URL + "/vault/{vid}"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Lista blanca ESTRICTA de extensiones aceptadas al organizar una descarga.
# Cualquier otro archivo que aparezca en el directorio de descargas se ignora
# (evita mover documentos, capturas o descargas ajenas del usuario).
ROM_EXTENSIONS = {
    # Nintendo 64
    ".z64", ".n64", ".v64",
    # Super Nintendo
    ".sfc", ".smc",
    # NES
    ".nes",
    # Game Boy / Advance / DS
    ".gba", ".gb", ".nds",
    # Discos y formatos ópticos
    ".bin", ".cue", ".iso", ".chd",
    # Archivos comprimidos
    ".7z", ".zip",
}

# Extensiones de descarga en curso que conviene ignorar.
PARTIAL_EXTENSIONS = {".crdownload", ".part", ".partial", ".download", ".tmp", ".opdownload"}

# --------------------------------------------------------------------------- #
# Mapeo de plataformas: vocabulario de Vimm -> vocabulario de PortsLauncher
# --------------------------------------------------------------------------- #

# Clave normalizada (minúsculas, espacios) -> identificador de PortsLauncher.
PLATFORM_MAP = {
    # Nintendo
    "nintendo entertainment system": "nes",
    "nes": "nes",
    "famicom": "nes",
    "nintendo": "nes",
    "super nintendo": "snes",
    "super nes": "snes",
    "snes": "snes",
    "super famicom": "snes",
    "nintendo 64": "n64",
    "n64": "n64",
    "game boy": "gb",
    "gb": "gb",
    "game boy color": "gb",
    "gbc": "gb",
    "game boy advance": "gba",
    "gba": "gba",
    "nintendo ds": "nds",
    "nds": "nds",
    "ds": "nds",
    "nintendo 3ds": "n3ds",
    "3ds": "n3ds",
    "n3ds": "n3ds",
    "gamecube": "gcn",
    "nintendo gamecube": "gcn",
    "gcn": "gcn",
    "wii": "wii",
    "nintendo wii": "wii",
    "wii u": "wiiu",
    "wiiu": "wiiu",
    "virtual boy": "other",
    "switch": "nsw",
    "nintendo switch": "nsw",
    # SEGA
    "genesis": "genesis",
    "sega genesis": "genesis",
    "mega drive": "genesis",
    "megadrive": "genesis",
    "md": "genesis",
    "master system": "genesis",
    "sega master system": "genesis",
    "game gear": "genesis",
    "sega cd": "other",
    "sega 32x": "other",
    "saturn": "other",
    "dreamcast": "dc",
    # Sony
    "playstation": "ps1",
    "ps1": "ps1",
    "psx": "ps1",
    "sony playstation": "ps1",
    "playstation 2": "ps2",
    "ps2": "ps2",
    "playstation 3": "ps3",
    "ps3": "ps3",
    "playstation portable": "psp",
    "psp": "psp",
    # Microsoft
    "xbox": "xbox",
    "microsoft xbox": "xbox",
    "xbox 360": "x360",
    "x360": "x360",
    # Otros / genéricos
    "atari 2600": "other",
    "atari 5200": "other",
    "atari 7800": "other",
    "turboGrafx-16".lower(): "other",
    "turbografx-16": "other",
    "turboGrafx-CD".lower(): "other",
    "turbografx-cd": "other",
    "cd-i": "other",
    "jaguar": "other",
    "jaguar cd": "other",
    "lynx": "other",
}

# Variantes sin espacios (por si el nombre llega como "supernintendo", "ps2", etc.).
PLATFORM_MAP_NOSPACE = {k.replace(" ", ""): v for k, v in PLATFORM_MAP.items()}

# Identificadores canónicos que ya habla PortsLauncher (se aceptan tal cual).
CANONICAL_PLATFORMS = {
    "n64", "snes", "nes", "md", "gba", "gb", "nds", "n3ds", "nsw", "psp",
    "ps1", "ps2", "ps3", "ps4", "gcn", "wii", "wiiu", "xbox", "x360",
    "xbone", "dc", "vita", "pc", "genesis", "other",
}

# Alias aceptados en el argumento --platform -> identificador canónico.
PLATFORM_ALIASES = {
    "md": "genesis",
    "mega drive": "genesis",
    "megadrive": "genesis",
    "sega genesis": "genesis",
    "psx": "ps1",
    "psone": "ps1",
    "gbc": "gb",
    "3ds": "n3ds",
    "super nintendo": "snes",
    "super nes": "snes",
    "famicom": "nes",
    "nintendo 64": "n64",
    "game boy": "gb",
    "game boy advance": "gba",
    "game boy color": "gb",
    "nintendo ds": "nds",
    "nintendo 3ds": "n3ds",
    "playstation": "ps1",
    "playstation 2": "ps2",
    "playstation 3": "ps3",
    "playstation portable": "psp",
    "xbox 360": "x360",
}

# Etiquetas legibles para la descripción del resultado.
PLATFORM_LABELS = {
    "n64": "Nintendo 64",
    "snes": "Super Nintendo",
    "nes": "NES",
    "gb": "Game Boy",
    "gba": "Game Boy Advance",
    "nds": "Nintendo DS",
    "n3ds": "Nintendo 3DS",
    "gcn": "GameCube",
    "wii": "Wii",
    "wiiu": "Wii U",
    "nsw": "Nintendo Switch",
    "genesis": "Genesis / Mega Drive",
    "ps1": "PlayStation",
    "ps2": "PlayStation 2",
    "ps3": "PlayStation 3",
    "psp": "PSP",
    "xbox": "Xbox",
    "x360": "Xbox 360",
    "dc": "Dreamcast",
    "pc": "PC",
    "other": "Otros",
}

# Formato/envoltorio por defecto sugerido según plataforma.
FORMAT_MAP = {
    "n64": ".z64",
    "snes": ".sfc",
    "nes": ".nes",
    "gb": ".gb",
    "gba": ".gba",
    "nds": ".nds",
    "n3ds": ".3ds",
    "gcn": ".iso",
    "wii": ".iso",
    "wiiu": ".wud",
    "nsw": ".nsp",
    "genesis": ".md",
    "ps1": ".bin",
    "ps2": ".iso",
    "ps3": ".iso",
    "psp": ".iso",
    "xbox": ".iso",
    "x360": ".iso",
    "dc": ".gdi",
}
DEFAULT_FORMAT = ".rom"

# --------------------------------------------------------------------------- #
# Mapeo de regiones (nombres de banderas y atributos title)
# --------------------------------------------------------------------------- #

REGION_MAP = {
    "usa": "USA",
    "us": "USA",
    "u": "USA",
    "united states": "USA",
    "united states of america": "USA",
    "america": "USA",
    "canada": "Canada",
    "europe": "Europe",
    "eur": "Europe",
    "e": "Europe",
    "japan": "Japan",
    "jp": "Japan",
    "j": "Japan",
    "world": "World",
    "w": "World",
    "australia": "Australia",
    "brazil": "Brazil",
    "korea": "Korea",
    "china": "China",
    "taiwan": "Taiwan",
    "germany": "Germany",
    "france": "France",
    "spain": "Spain",
    "italy": "Italy",
    "netherlands": "Netherlands",
    "sweden": "Sweden",
    "russia": "Russia",
    "korea (south)": "Korea",
}

# Conjunto de palabras de región para validar el fallback por paréntesis.
REGION_WORDS = set(REGION_MAP.keys())

# --------------------------------------------------------------------------- #
# Expresiones regulares de parseo HTML
# --------------------------------------------------------------------------- #

TAG_RE = re.compile(r"<[^>]+>")
ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
CELL_RE = re.compile(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", re.IGNORECASE | re.DOTALL)
IMG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
ANCHOR_RE = re.compile(
    r"<a\b[^>]*href\s*=\s*[\"']([^\"']*)[\"'][^>]*>(.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
ATTR_RE = re.compile(r"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*[\"']([^\"']*)[\"']")

# Patrones para extraer el identificador numérico de la ficha.
ID_PATTERNS = (
    re.compile(r"/vault/(\d+)", re.IGNORECASE),
    re.compile(r"/vault/\?p=details&(?:amp;)?id=(\d+)", re.IGNORECASE),
    re.compile(r"[?&]id=(\d+)", re.IGNORECASE),
)

VERSION_FULLMATCH = re.compile(r"v?(\d+(?:\.\d+)+[a-z]?)", re.IGNORECASE)
VERSION_INLINE = re.compile(r"\bv(\d+(?:\.\d+)+[a-z]?)\b", re.IGNORECASE)

# Identificador de activo aceptado: ``vault-<digitos>`` o ``<digitos>``.
ASSET_ID_RE = re.compile(r"(?:vault-)?([0-9]+)", re.IGNORECASE)

# Título de la ficha (para validar el nombre del archivo descargado).
TITLE_TAG_RE = re.compile(r"<title\b[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
HEADING_RE = re.compile(r"<h[12]\b[^>]*>(.*?)</h[12]>", re.IGNORECASE | re.DOTALL)
TITLE_SUFFIX_RE = re.compile(r"\s*[|\-\u2013\u2014]\s*vimm['\u2019]?s\s+lair.*$", re.IGNORECASE)
PAREN_TAG_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")

# Palabras sin valor discriminante al comparar títulos.
TITLE_STOPWORDS = {
    "the", "and", "for", "with", "version", "edition", "usa", "eur", "jpn",
    "rom", "dvd", "disc", "disk",
}

# --------------------------------------------------------------------------- #
# Utilidades de texto
# --------------------------------------------------------------------------- #

def strip_tags(value):
    """Elimina etiquetas HTML y normaliza espacios/entidades."""
    if not value:
        return ""
    text = TAG_RE.sub(" ", value)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_token(value):
    """Normaliza un token de sistema (alt/title/nombre de archivo)."""
    if not value:
        return ""
    token = urllib.parse.unquote(str(value)).strip().lower()
    token = token.replace("\\", "/").split("/")[-1]
    token = re.sub(r"\.(png|gif|jpe?g|svg|ico|webp)$", "", token)
    token = token.replace("_", " ").replace("-", " ")
    token = re.sub(r"\s+", " ", token).strip()
    return token


def normalize_system(value):
    """Traduce un nombre de sistema de Vimm a la clave de PortsLauncher."""
    token = normalize_token(value)
    if not token:
        return None
    if token in PLATFORM_MAP:
        return PLATFORM_MAP[token]
    compact = token.replace(" ", "")
    if compact in PLATFORM_MAP_NOSPACE:
        return PLATFORM_MAP_NOSPACE[compact]
    return None


def normalize_platform_arg(value):
    """Normaliza el argumento --platform de la CLI a una clave canónica."""
    if not value:
        return None
    token = value.strip().lower()
    if token in PLATFORM_ALIASES:
        return PLATFORM_ALIASES[token]
    if token in CANONICAL_PLATFORMS:
        return token
    mapped = normalize_system(token)
    return mapped or token


def normalize_region(value):
    """Traduce el nombre de una bandera o atributo title a una región legible."""
    if not value:
        return ""
    token = normalize_token(value)
    if not token:
        return ""
    lowered = token.lower().strip()
    if lowered in REGION_MAP:
        return REGION_MAP[lowered]
    compact = lowered.replace(" ", "")
    if compact in REGION_MAP:
        return REGION_MAP[compact]
    # Nombre desconocido: devolver con formato Title Case legible.
    return token.title()


def title_tokens(value):
    """Extrae las palabras significativas de un título o nombre de archivo."""
    if not value:
        return set()
    cleaned = PAREN_TAG_RE.sub(" ", str(value))
    cleaned = re.sub(r"\.\w{1,5}$", "", cleaned)
    tokens = re.findall(r"[a-z0-9]+", cleaned.lower())
    return {t for t in tokens if len(t) >= 3 and t not in TITLE_STOPWORDS}


def matches_expected_title(filename, expected_title):
    """Comprueba que el archivo corresponda al título esperado de la ficha.

    Si no hay título de referencia (por ejemplo, la ficha no pudo consultarse),
    no se puede discriminar por nombre y se acepta el archivo: la validación de
    extensión sigue aplicándose.
    """
    expected = title_tokens(expected_title)
    if not expected:
        return True
    return expected.issubset(title_tokens(filename))


def sanitize_asset_id(asset_id):
    """Valida y normaliza el identificador de activo.

    Solo se aceptan las formas ``vault-<digitos>`` o ``<digitos>``. Cualquier
    otro valor (rutas relativas, ``..``, URLs, separadores) se rechaza.
    """
    if asset_id is None:
        return None
    candidate = str(asset_id).strip()
    if not candidate or len(candidate) > 32:
        return None
    if ".." in candidate or "/" in candidate or "\\" in candidate:
        return None
    match = ASSET_ID_RE.fullmatch(candidate)
    if not match:
        return None
    return match.group(1)


# --------------------------------------------------------------------------- #
# Descarga / parseo de la página de resultados
# --------------------------------------------------------------------------- #

def fetch_html(url, timeout=25):
    """Descarga HTML con cabeceras de navegador y decodifica según el charset."""
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": BASE_URL + "/vault/",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def fetch_expected_title(url, timeout=10):
    """Obtiene el título de la ficha para validar el nombre de la descarga."""
    try:
        page_html = fetch_html(url, timeout=timeout)
    except Exception:  # noqa: BLE001 - best effort: sin red no hay validación.
        return ""
    for pattern in (TITLE_TAG_RE, HEADING_RE):
        match = pattern.search(page_html)
        if not match:
            continue
        title = strip_tags(match.group(1))
        title = TITLE_SUFFIX_RE.sub("", title).strip()
        if title:
            return title
    return ""


def detect_id(row_html):
    """Extrae el id numérico de la ficha presente en una fila."""
    for pattern in ID_PATTERNS:
        match = pattern.search(row_html)
        if match:
            return match.group(1)
    return None


def detect_title(row_html, vid):
    """Extrae el título asociado al enlace /vault/<id>."""
    target = str(vid)
    best = ""
    for href, inner in ANCHOR_RE.findall(row_html):
        id_match = re.search(r"/vault/(\d+)", href, re.IGNORECASE)
        if not id_match or id_match.group(1) != target:
            continue
        text = strip_tags(inner)
        if text and len(text) > len(best):
            best = text
    if best:
        return best
    # Fallback: primer ancla numérica con texto textual.
    for href, inner in ANCHOR_RE.findall(row_html):
        if re.search(r"/vault/\d+", href, re.IGNORECASE):
            text = strip_tags(inner)
            if text and len(text) > 1 and not text.lower().startswith(("download", "manual")):
                return text
    return ""


def detect_platform(row_html):
    """Detecta la plataforma REAL de la fila a partir de iconos o del texto.

    Devuelve ``None`` cuando la fila no declara sistema. No se usa la pista del
    usuario (``--platform``) como sustituto: hacerlo etiquetaría juegos de otros
    sistemas con la plataforma solicitada (ver hallazgo H1).
    """
    # 1) Iconos de sistema (alt / title / src), ignorando banderas de región.
    for img_tag in IMG_RE.findall(row_html):
        attrs = {m.group(1).lower(): m.group(2) for m in ATTR_RE.finditer(img_tag)}
        src = attrs.get("src", "")
        if "flag" in src.lower():
            continue
        for key in ("alt", "title", "src"):
            mapped = normalize_system(attrs.get(key, ""))
            if mapped:
                return mapped
    # 2) Texto de las celdas: solo cuenta una coincidencia exacta y corta, para
    #    no confundir un título de juego con el nombre de un sistema.
    for cell in CELL_RE.findall(row_html):
        text = strip_tags(cell)
        if not text or len(text) > 40:
            continue
        mapped = normalize_system(text)
        if mapped:
            return mapped
    return None


def detect_region(row_html, title):
    """Detecta la región a partir de las banderas (flags/) y su atributo title."""
    flag_img = re.search(r"<img\b[^>]*flags/[^>]*>", row_html, re.IGNORECASE | re.DOTALL)
    if flag_img:
        tag = flag_img.group(0)
        for attr in ("title", "alt"):
            attr_match = re.search(attr + r"\s*=\s*[\"']([^\"']+)[\"']", tag, re.IGNORECASE)
            if attr_match:
                region = normalize_region(attr_match.group(1))
                if region:
                    return region
        file_match = re.search(r"flags/([^\"'\s/>]+)", tag, re.IGNORECASE)
        if file_match:
            return normalize_region(file_match.group(1))
    # Cualquier referencia a flags/ en la fila.
    file_match = re.search(r"flags/([^\"'\s/>]+)", row_html, re.IGNORECASE)
    if file_match:
        return normalize_region(file_match.group(1))
    # Fallback: sufijo entre paréntesis del título, tipo "(USA)".
    if title:
        paren = re.search(r"\(([^()]+)\)\s*$", title)
        if paren and paren.group(1).strip().lower() in REGION_WORDS:
            return normalize_region(paren.group(1))
    return ""


def detect_version(row_html):
    """Extrae la versión de la fila (celda dedicada, clase version o 'vX.Y')."""
    for cell in CELL_RE.findall(row_html):
        text = strip_tags(cell)
        if not text:
            continue
        match = VERSION_FULLMATCH.fullmatch(text)
        if match:
            return match.group(1)
    # Celda con clase "version".
    class_match = re.search(
        r"class\s*=\s*[\"'][^\"']*version[^\"']*[\"'][^>]*>(.*?)</",
        row_html,
        re.IGNORECASE | re.DOTALL,
    )
    if class_match:
        text = strip_tags(class_match.group(1))
        match = VERSION_INLINE.search(text)
        if match:
            return match.group(1)
    # Último recurso: patrón "v1.2" en el texto.
    match = VERSION_INLINE.search(strip_tags(row_html))
    if match:
        return match.group(1)
    return ""


def parse_results(page_html):
    """Parsea la tabla de resultados y devuelve filas normalizadas.

    ``platform`` puede ser ``None`` si la fila no declara sistema; en ese caso
    el filtro por plataforma la descartará en lugar de asignarle una incorrecta.
    """
    rows = ROW_RE.findall(page_html)
    if not rows:
        # Sin estructura de tabla: tratamos todo el documento como una fila
        # para, al menos, extraer enlaces /vault/<id>.
        rows = [page_html]

    results = []
    seen = set()
    for row in rows:
        vid = detect_id(row)
        if not vid:
            continue
        title = detect_title(row, vid)
        platform = detect_platform(row)
        region = detect_region(row, title)
        version = detect_version(row)
        key = (vid, region, version)
        if key in seen:
            continue
        seen.add(key)
        results.append(
            {
                "raw_id": vid,
                "title": title,
                "platform": platform,
                "region": region,
                "version": version,
            }
        )
    return results


def build_result(entry):
    """Convierte una fila parseada al objeto de resultado del protocolo."""
    # Sin pista del usuario: si la fila no declara plataforma, es "other".
    platform = entry["platform"] or "other"
    fmt = FORMAT_MAP.get(platform, DEFAULT_FORMAT)
    label = PLATFORM_LABELS.get(platform, platform.upper())
    bits = [label]
    if entry["region"]:
        bits.append(entry["region"])
    if entry["version"]:
        bits.append("v" + entry["version"])
    description = "ROM de {title} · {bits} (The Vault, Vimm's Lair)".format(
        title=entry["title"] or ("Vimm Vault #" + entry["raw_id"]),
        bits=" · ".join(bits),
    )
    return {
        "id": "vault-" + entry["raw_id"],
        "title": entry["title"] or ("Vimm Vault #" + entry["raw_id"]),
        "platform": platform,
        "format": fmt,
        "url": DETAIL_URL.format(vid=entry["raw_id"]),
        "description": description,
        "version": entry["version"],
        "region": entry["region"],
    }


# --------------------------------------------------------------------------- #
# Filtros de búsqueda
# --------------------------------------------------------------------------- #

def apply_filters(results, platform, region, version):
    """Aplica los filtros --platform / --region / --version sobre los resultados."""
    filtered = results

    if platform:
        # Coincidencia estricta sobre la plataforma DETECTADA en el HTML.
        wanted = normalize_platform_arg(platform)
        filtered = [r for r in filtered if normalize_platform_arg(r["platform"]) == wanted]

    if region:
        wanted_region = normalize_region(region) or region.strip()
        needle = wanted_region.lower()
        filtered = [
            r for r in filtered
            if r["region"] and needle in r["region"].lower()
        ]

    if version:
        wanted_version = version.strip().lstrip("vV")
        filtered = [
            r for r in filtered
            if r["version"]
            and (
                r["version"].lstrip("vV") == wanted_version
                or r["version"].lstrip("vV").startswith(wanted_version)
            )
        ]

    return filtered


# --------------------------------------------------------------------------- #
# Comandos
# --------------------------------------------------------------------------- #

def emit(payload):
    """Escribe un objeto JSON como una línea en stdout."""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(message):
    """Mensaje humano por stderr (no contamina el flujo JSON de stdout)."""
    sys.stderr.write(str(message) + "\n")
    sys.stderr.flush()


def handle_check():
    emit(
        {
            "ok": True,
            "version": VERSION,
            "message": "Vimm Vault Provider listo",
        }
    )


def handle_search(query, platform=None, region=None, version=None):
    """Ejecuta la búsqueda en The Vault y devuelve los resultados filtrados."""
    url = SEARCH_ENDPOINT.format(query=urllib.parse.quote_plus(query))
    try:
        page_html = fetch_html(url)
    except urllib.error.HTTPError as exc:
        # Vimm responde 404 cuando la búsqueda no arroja resultados: no es un
        # error del plugin, es una búsqueda vacía (ver hallazgo H2).
        if exc.code == 404:
            emit({"success": True, "results": []})
            return 0
        emit({"success": False, "error": "No se pudo consultar Vimm's Lair: {}".format(exc)})
        return 1
    except Exception as exc:  # noqa: BLE001 - se reporta como JSON de error.
        emit({"success": False, "error": "No se pudo consultar Vimm's Lair: {}".format(exc)})
        return 1

    entries = parse_results(page_html)
    results = [build_result(entry) for entry in entries]
    results = apply_filters(results, platform, region, version)
    emit({"success": True, "results": results})
    return 0


def sha1_of(path, chunk_size=1 << 20):
    """Calcula el SHA-1 de un archivo leyéndolo por bloques."""
    digest = hashlib.sha1()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(chunk_size), b""):
            digest.update(block)
    return digest.hexdigest()


def candidate_download_dirs(explicit_dir=None):
    """Devuelve los directorios donde buscar la descarga del usuario."""
    candidates = []
    env_dir = os.environ.get("VIMM_DOWNLOAD_DIR")
    if env_dir:
        candidates.append(Path(env_dir).expanduser())
    home = Path.home()
    candidates.append(home / "Downloads")
    candidates.append(home / "Descargas")
    if explicit_dir:
        candidates.append(Path(explicit_dir).expanduser())

    deduped = []
    seen = set()
    for directory in candidates:
        try:
            resolved = directory.resolve()
        except OSError:
            resolved = directory
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        if directory.exists() and directory.is_dir():
            deduped.append(directory)
    return deduped


def snapshot_files(directory):
    """Fotografía el estado (nombre -> mtime) de los archivos de un directorio."""
    snap = {}
    try:
        for path in directory.iterdir():
            if not path.is_file():
                continue
            try:
                snap[path] = path.stat().st_mtime
            except OSError:
                continue
    except OSError:
        pass
    return snap


def collect_new_files(directory, snap, since_ts):
    """Devuelve archivos nuevos o modificados desde ``since_ts``."""
    found = []
    try:
        for path in directory.iterdir():
            if not path.is_file():
                continue
            if path.suffix.lower() in PARTIAL_EXTENSIONS:
                continue
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            is_new = path not in snap or mtime > snap.get(path, 0) + 0.5
            if is_new and mtime >= since_ts - 2:
                found.append(path)
    except OSError:
        pass
    return found


def safe_mtime(path):
    """mtime defensivo: 0.0 si el archivo desapareció o no es accesible."""
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def pick_best_file(files, expected_title=""):
    """Elige el archivo descargado válido más reciente.

    Solo se aceptan las extensiones de la lista blanca ROM_EXTENSIONS, archivos
    no vacíos y, cuando se conoce el título de la ficha, nombres que coincidan
    con él. Cualquier otro archivo del directorio se ignora (ver hallazgo H3).
    """
    if not files:
        return None
    usable = []
    for path in files:
        if path.suffix.lower() not in ROM_EXTENSIONS:
            continue
        try:
            if path.stat().st_size <= 0:
                continue
        except OSError:
            continue
        if not matches_expected_title(path.name, expected_title):
            continue
        usable.append(path)
    if not usable:
        return None
    return max(usable, key=safe_mtime)


def unique_destination(directory, filename):
    """Construye una ruta destino sin sobrescribir archivos existentes."""
    destination = directory / filename
    if not destination.exists():
        return destination
    stem = destination.stem
    suffix = destination.suffix
    counter = 1
    while True:
        candidate = directory / "{}-{}{}".format(stem, counter, suffix)
        if not candidate.exists():
            return candidate
        counter += 1


def handle_provision(asset_id, output_dir, timeout=None, keep_source=False):
    """Abre la ficha en el navegador y organiza la descarga detectada."""
    # H4: validación estricta del identificador antes de construir cualquier ruta
    # o URL. Se rechazan '..', separadores, URLs y cualquier carácter extraño.
    vid = sanitize_asset_id(asset_id)
    if not vid:
        emit(
            {
                "success": False,
                "error": (
                    "asset_id inválido: se esperaba 'vault-<dígitos>' o '<dígitos>' "
                    "(recibido: {!r})".format(str(asset_id)[:80])
                ),
            }
        )
        return 1

    page_url = DETAIL_URL.format(vid=vid)
    out_path = Path(output_dir).expanduser()

    # Creamos el directorio de salida pronto para poder monitorizarlo también
    # junto al directorio de descargas del navegador.
    try:
        out_path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        emit({"success": False, "error": "No se pudo crear el directorio de salida: {}".format(exc)})
        return 1

    expected_title = fetch_expected_title(page_url)

    emit(
        {
            "type": "progress",
            "percent": 20,
            "status": "Abriendo Vimm's Lair en navegador...",
        }
    )

    download_dirs = candidate_download_dirs(output_dir)
    snaps = {directory: snapshot_files(directory) for directory in download_dirs}
    start_ts = time.time()

    opened = False
    try:
        opened = webbrowser.open(page_url)
    except Exception as exc:  # noqa: BLE001
        log("No se pudo abrir el navegador automáticamente: {}".format(exc))
    if not opened:
        log("Abre manualmente esta URL en tu navegador: {}".format(page_url))

    # Tiempo de espera: corto en modo no interactivo para no bloquear al launcher.
    interactive = sys.stdin.isatty()
    if timeout is not None:
        wait_seconds = max(0, int(timeout))
    elif interactive:
        wait_seconds = 180
    else:
        wait_seconds = 6

    emit(
        {
            "type": "progress",
            "percent": 45,
            "status": "Esperando descarga en el navegador...",
        }
    )

    deadline = start_ts + wait_seconds
    found = None
    while time.time() < deadline:
        for directory, snap in snaps.items():
            candidates = collect_new_files(directory, snap, start_ts)
            found = pick_best_file(candidates, expected_title)
            if found:
                break
        if found:
            break
        time.sleep(1.0)

    if found:
        emit(
            {
                "type": "progress",
                "percent": 80,
                "status": "Archivo detectado, moviendo a la carpeta de salida...",
            }
        )
        try:
            out_path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            emit({"success": False, "error": "No se pudo crear el directorio de salida: {}".format(exc)})
            return 1

        try:
            if found.parent.resolve() == out_path.resolve():
                destination = found
            else:
                destination = unique_destination(out_path, found.name)
                if keep_source:
                    shutil.copy2(str(found), str(destination))
                else:
                    shutil.move(str(found), str(destination))
        except OSError as exc:
            emit({"success": False, "error": "No se pudo mover el archivo descargado: {}".format(exc)})
            return 1

        try:
            checksum = sha1_of(destination)
        except OSError as exc:
            emit({"success": False, "error": "No se pudo calcular el SHA-1: {}".format(exc)})
            return 1

        emit(
            {
                "type": "completed",
                "outputPath": str(destination),
                "sha1": checksum,
            }
        )
        return 0

    # Sin archivo válido detectado: NO se declara éxito. Se informa de forma
    # explícita que la descarga manual del usuario es imprescindible.
    mode = "interactivo" if interactive else "no interactivo"
    status = (
        "No se detectó ninguna ROM descargada (modo {}). ".format(mode)
        + "Abre {} en el navegador, descarga el archivo y colócalo en {}.".format(page_url, out_path)
    )
    log(status)
    emit(
        {
            "type": "error",
            "error": (
                "No se detectó descarga de ROM. Se requiere descarga manual asistida "
                "desde el enlace del navegador."
            ),
            "url": page_url,
        }
    )
    return 1


# --------------------------------------------------------------------------- #
# Punto de entrada / CLI
# --------------------------------------------------------------------------- #

def build_parser():
    parser = argparse.ArgumentParser(
        prog="vimm-vault",
        description="Vimm's Vault ROM Provider para PortsLauncher",
    )
    parser.add_argument("--version", action="version", version=VERSION)

    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("check", help="Verifica el estado del plugin")

    search_parser = subparsers.add_parser("search", help="Busca títulos en The Vault")
    search_parser.add_argument("query", type=str, help="Título o término de búsqueda")
    search_parser.add_argument("--platform", type=str, default=None, help="Filtra por plataforma")
    search_parser.add_argument("--region", type=str, default=None, help="Filtra por región (ej: USA)")
    search_parser.add_argument("--version", dest="game_version", type=str, default=None, help="Filtra por versión (ej: 1.0)")

    provision_parser = subparsers.add_parser("provision", help="Abre la ficha y organiza la descarga")
    provision_parser.add_argument("asset_id", type=str, help="Identificador vault-<id>")
    provision_parser.add_argument("--output", type=str, required=True, help="Directorio de salida")
    provision_parser.add_argument("--timeout", type=int, default=None, help="Segundos de espera de descarga")
    provision_parser.add_argument(
        "--copy",
        action="store_true",
        help="Copia el archivo validado en lugar de moverlo",
    )

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            handle_check()
            return 0
        if args.command == "search":
            return handle_search(args.query, args.platform, args.region, args.game_version)
        if args.command == "provision":
            return handle_provision(
                args.asset_id,
                args.output,
                getattr(args, "timeout", None),
                getattr(args, "copy", False),
            )

        emit({"success": False, "error": "Comando no especificado o desconocido"})
        return 1
    except BrokenPipeError:
        return 0
    except Exception as exc:  # noqa: BLE001 - error controlado en formato JSON.
        emit({"success": False, "error": "Error inesperado: {}".format(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
