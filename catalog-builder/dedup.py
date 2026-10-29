#!/usr/bin/env python3
"""Motor de deduplicación y consolidación de puertos (Fase 2).

Responsabilidades
-----------------
* ``build_technical_key``: clave técnica estable que decide qué fichas son la
  *misma* ficha técnica. Soporta repositorios multi-ficha (mismo ``owner/repo``
  con varios ``folderName``/``name``, p. ej. ``spacestate1/namco22-decompile``
  con 5 fichas: ``namco22-timecris``, ``namco22-tc2``, ...) porque el
  discriminador forma parte de la clave y por tanto **no** se colapsan.
* Heurística de emparejamiento Quiver <-> GameWave: Quiver no siempre expone
  ``repository`` en la tarjeta de listado, así que se acepta coincidencia por
  ``repository``, por ``folderName`` normalizado, por ``projectName`` contra el
  nombre del repo de GameWave o por nombre normalizado + ``sourcePlatform``.
* ``merge_ports``: consolidación con reglas de precedencia (E2-S3)
  preservando la procedencia en ``sources[]``.
* ``generate_pid``: identificador determinista, limpio y URL-friendly.
* ``Deduplicator``: orquestación completa (clave técnica -> heurística ->
  ``pid`` único -> ``sources[]`` fusionados).

Doble modo de importación
-------------------------
``from ..models import ...`` cuando se usa como paquete y ``from models import``
cuando se ejecuta con el directorio ``catalog-builder/`` en ``sys.path`` (el
nombre del directorio contiene un guion, por lo que no es importable con la
sintaxis ``import`` normal).
"""

from __future__ import annotations

import copy
import json
import os
import re
import sys
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:  # import como paquete (catalog-builder.dedup)
    from .models import (  # type: ignore[import-not-found]
        AssetHints,
        PlayerFeedback,
        RomProfile,
        SourceRef,
        StatusInfo,
        UnifiedPort,
        as_bool,
        as_dict,
        as_float,
        as_int,
        as_list,
        as_str,
        is_valid_sha1,
    )
except (ImportError, ValueError):  # import directo (catalog-builder en sys.path)
    from models import (  # type: ignore[no-redef]
        AssetHints,
        PlayerFeedback,
        RomProfile,
        SourceRef,
        StatusInfo,
        UnifiedPort,
        as_bool,
        as_dict,
        as_float,
        as_int,
        as_list,
        as_str,
        is_valid_sha1,
    )

__all__ = [
    'SOURCE_GAMEWAVE',
    'SOURCE_QUIVER',
    'build_technical_key',
    'merge_ports',
    'generate_pid',
    'slugify',
    'Deduplicator',
    'deduplicate',
]

#: Identificadores de fuente reconocidos.
SOURCE_GAMEWAVE = 'gamewave'
SOURCE_QUIVER = 'quiver'

#: Especificidad de cada estrategia de instalación: mayor = más concreta.
#: ``needsChoice`` es el resultado menos informativo (el motor no ha podido
#: decidir), por eso queda por debajo de cualquier estrategia resuelta.
_STRATEGY_SPECIFICITY: Dict[str, int] = {
    'releaseappimage': 8,
    'releaseinstaller': 7,
    'releasearchive': 6,
    'windowsviaproton': 5,
    'recipe': 4,
    'sourceonly': 3,
    'needschoice': 2,
    'external': 1,
}

#: Preferencia de ``aiLevel`` (mayor = más información sobre el uso de IA).
_AI_LEVEL_RANK: Dict[str, int] = {
    'generated': 3,
    'generated-ai': 3,
    'assisted': 2,
    'assisted-ai': 2,
    'none': 1,
}

#: Nombres de campo que nunca deben perder información al fusionar ``raw``.
_RAW_PRIORITY_KEYS = ('projectName', 'project', 'slug', 'catalogId')


# ---------------------------------------------------------------------------
# Utilidades de texto
# ---------------------------------------------------------------------------

def slugify(value: Any) -> str:
    """Normaliza a ``[a-z0-9-]`` (ASCII plegado, guiones colapsados)."""

    text = as_str(value) or ''
    if not text:
        return ''
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    text = re.sub(r'-{2,}', '-', text)
    return text.strip('-')


def _token(value: Any) -> str:
    """Forma compacta sin separadores, usada para comparar nombres."""

    return slugify(value).replace('-', '')


def _dedupe(values: Iterable[Any]) -> List[Any]:
    """Deduplica preservando el orden de primera aparición."""

    result: List[Any] = []
    seen: Set[str] = set()
    for value in values or []:
        if value is None:
            continue
        if isinstance(value, str):
            key = value.strip()
            if not key:
                continue
        else:
            try:
                key = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
            except (TypeError, ValueError):
                key = repr(value)
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def _is_filled(value: Any) -> bool:
    """``True`` si el valor aporta información real."""

    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) > 0
    return True


def _repo_key(repository: Optional[str]) -> str:
    """Normaliza ``owner/repo`` para comparaciones."""

    text = as_str(repository) or ''
    if not text:
        return ''
    text = text.strip().lower()
    text = re.sub(r'^https?://(www\.)?github\.com/', '', text)
    text = re.sub(r'\.git$', '', text)
    text = text.strip('/')
    text = re.sub(r'\s+', '', text)
    return text


def _repo_short_name(repository: Optional[str]) -> str:
    """Devuelve el nombre del repositorio (último segmento de ``owner/repo``)."""

    key = _repo_key(repository)
    if not key:
        return ''
    return key.split('/')[-1]


def _source_names(port: UnifiedPort) -> Set[str]:
    return {
        (as_str(ref.source) or '').lower()
        for ref in as_list(port.sources)
        if ref is not None and as_str(ref.source)
    }


def _has_source(port: UnifiedPort, name: str) -> bool:
    return name in _source_names(port)


# ---------------------------------------------------------------------------
# Clave técnica
# ---------------------------------------------------------------------------

def _discriminator(port: UnifiedPort) -> str:
    """Discriminador de la clave técnica (asset filter > carpeta > nombre)."""

    for candidate in (port.releaseAssetFilter, port.folderName, port.name):
        text = as_str(candidate)
        if text:
            return re.sub(r'\s+', ' ', text.strip().lower())
    return ''


def build_technical_key(port: UnifiedPort) -> str:
    """Clave técnica estable de una ficha.

    * Con repositorio: ``<source>::<owner/repo>::<discriminador>``.
    * Sin repositorio: ``<distribution>::<sourcePlatform>::<carpeta|nombre>``.

    El discriminador es lo que permite que un repositorio multi-ficha
    (``spacestate1/namco22-decompile``) produzca claves distintas para
    ``namco22-timecris``, ``namco22-tc2``, etc. y por tanto **no** se colapse.
    """

    if port is None:
        return ''

    repository = _repo_key(port.repository)
    if repository:
        source = (as_str(port.repositorySource) or 'github').strip().lower()
        return '{}::{}::{}'.format(source, repository, _discriminator(port))

    distribution = (as_str(port.distribution) or 'external').strip().lower()
    platform = (as_str(port.sourcePlatform) or 'other').strip().lower()
    fallback = port.folderName or port.name or ''
    return '{}::{}::{}'.format(
        distribution,
        platform,
        re.sub(r'\s+', ' ', str(fallback).strip().lower()),
    )


# ---------------------------------------------------------------------------
# Heurística de emparejamiento Quiver <-> GameWave
# ---------------------------------------------------------------------------

def _project_names(port: UnifiedPort) -> List[str]:
    """Nombres de proyecto declarados por una ficha Quiver."""

    names: List[str] = []
    for value in (
        as_dict(port.raw).get('projectName'),
        as_dict(port.raw).get('project'),
        as_dict(port.raw).get('repoName'),
        as_dict(port.raw).get('repositoryName'),
        port.project,
        as_dict(port.raw).get('slug'),
        port.folderName,
        port.name,
    ):
        text = as_str(value)
        if text:
            names.append(text)
    return _dedupe(names)


def _quiver_matches(q: UnifiedPort, gw: UnifiedPort) -> Optional[int]:
    """Prioridad de emparejamiento (1 = mejor) o ``None`` si no emparejan."""

    q_repo = _repo_key(q.repository)
    gw_repo = _repo_key(gw.repository)

    # (a) Coincidencia directa de repositorio. Si ambos declaran repositorio y
    #     difieren, se descarta el emparejamiento para evitar falsos positivos.
    if q_repo and gw_repo:
        return 1 if q_repo == gw_repo else None

    # (b) ``folderName`` normalizado.
    q_folder = slugify(q.folderName)
    gw_folder = slugify(gw.folderName)
    if q_folder and gw_folder and q_folder == gw_folder:
        return 2

    # (c) ``projectName`` de Quiver == nombre del repo en GameWave
    #     (ConkerBFDReloaded == DahSidiAbdallah/ConkerBFDReloaded).
    gw_repo_name = _repo_short_name(gw.repository)
    if gw_repo_name and len(gw_repo_name) >= 3:
        for candidate in _project_names(q):
            token = _token(candidate)
            if len(token) >= 3 and token == _token(gw_repo_name):
                return 3

    # (d) Nombre normalizado idéntico + misma plataforma de origen.
    q_name = _token(q.name)
    gw_name = _token(gw.name)
    if q_name and q_name == gw_name and len(q_name) >= 3:
        q_platform = (as_str(q.sourcePlatform) or 'other').lower()
        gw_platform = (as_str(gw.sourcePlatform) or 'other').lower()
        if q_platform == gw_platform or 'other' in (q_platform, gw_platform):
            return 4

    return None


class _MatchIndex:
    """Índice de candidatos GameWave para emparejar fichas Quiver."""

    def __init__(self, candidates: Dict[int, UnifiedPort]) -> None:
        self.candidates: Dict[int, UnifiedPort] = dict(candidates)

    def find(self, port: UnifiedPort) -> Optional[int]:
        best: Optional[Tuple[int, int]] = None
        for idx, candidate in self.candidates.items():
            priority = _quiver_matches(port, candidate)
            if priority is None:
                continue
            if best is None or priority < best[0] or (
                priority == best[0] and idx < best[1]
            ):
                best = (priority, idx)
        return None if best is None else best[1]

    def update(self, idx: int, port: UnifiedPort) -> None:
        if idx in self.candidates:
            self.candidates[idx] = port


# ---------------------------------------------------------------------------
# Fusión
# ---------------------------------------------------------------------------

def _merge_sources(
    left: Sequence[SourceRef],
    right: Sequence[SourceRef],
) -> List[SourceRef]:
    """Une procedencias sin duplicar ``(source, externalId)``."""

    merged: List[SourceRef] = []
    seen: Dict[Tuple[str, str], SourceRef] = {}
    for ref in list(left or []) + list(right or []):
        if ref is None:
            continue
        key = (as_str(ref.source) or '', as_str(ref.externalId) or '')
        if key in seen:
            current = seen[key]
            if not as_str(current.catalogVersion) and as_str(ref.catalogVersion):
                current.catalogVersion = ref.catalogVersion
            if not as_str(current.lastSeen) and as_str(ref.lastSeen):
                current.lastSeen = ref.lastSeen
            continue
        clone = SourceRef(
            source=ref.source,
            externalId=ref.externalId,
            lastSeen=ref.lastSeen,
            catalogVersion=ref.catalogVersion,
        )
        seen[key] = clone
        merged.append(clone)
    return merged


def _merge_dicts(primary: Any, secondary: Any) -> Dict[str, Any]:
    """Fusiona diccionarios dando prioridad a ``primary``."""

    base = copy.deepcopy(as_dict(primary))
    for key, value in as_dict(secondary).items():
        if key not in base or not _is_filled(base.get(key)):
            base[key] = copy.deepcopy(value)
    return base


def _merge_requires_user_files(gw: UnifiedPort, alt: UnifiedPort) -> Dict[str, Any]:
    """``requiresUserFiles``: GameWave prevalece si trae texto."""

    result: Dict[str, Any] = {'es': None, 'en': None}
    for port in (gw, alt):
        data = as_dict(port.requiresUserFiles)
        for lang in ('es', 'en'):
            if not _is_filled(result.get(lang)) and _is_filled(data.get(lang)):
                result[lang] = data.get(lang)
        for key, value in data.items():
            if key not in result and value is not None:
                result[key] = copy.deepcopy(value)
    return result


def _cover_score(url: Optional[str]) -> int:
    """Heurística de resolución declarada en la URL (mayor = mejor)."""

    text = as_str(url) or ''
    if not text:
        return 0
    score = 0
    for match in re.finditer(r'[?&](?:w|width)=(\d{2,5})', text):
        score = max(score, int(match.group(1)))
    for match in re.finditer(r'(\d{2,5})x(\d{2,5})', text):
        score = max(score, int(match.group(1)) * int(match.group(2)))
    for match in re.finditer(r'(?:^|[/_-])(\d{3,4})\.(?:png|jpe?g|webp)$', text):
        score = max(score, int(match.group(1)))
    return score


def _pick_cover(quiver_side: Optional[UnifiedPort], gw: UnifiedPort, alt: UnifiedPort) -> Optional[str]:
    """Portada: preferir Quiver si existe o si declara mayor resolución."""

    candidates: List[str] = []
    if quiver_side is not None and as_str(quiver_side.coverUrl):
        candidates.append(as_str(quiver_side.coverUrl) or '')
    for port in (gw, alt):
        url = as_str(port.coverUrl)
        if url:
            candidates.append(url)
    candidates = [c for c in _dedupe(candidates) if c]
    if not candidates:
        return None
    best = candidates[0]
    best_score = _cover_score(best)
    for url in candidates[1:]:
        score = _cover_score(url)
        if score > best_score:
            best, best_score = url, score
    return best


def _setup_files_with_sha1(files: Any) -> bool:
    """``True`` si hay ``setupFiles`` con al menos un SHA-1 válido en ``accepted``."""

    for entry in as_list(files):
        if not isinstance(entry, dict):
            continue
        for item in as_list(entry.get('accepted')):
            if isinstance(item, dict):
                if is_valid_sha1(item.get('sha1') or item.get('sha') or item.get('hash')):
                    return True
            elif is_valid_sha1(item):
                return True
    return False


def _prefer_setup_files(
    quiver_side: Optional[UnifiedPort],
    gw: UnifiedPort,
    alt: UnifiedPort,
) -> List[dict]:
    """``setupFiles``: Quiver prevalece (es la fuente que verifica SHA-1)."""

    if quiver_side is not None and _setup_files_with_sha1(quiver_side.setupFiles):
        return copy.deepcopy(list(quiver_side.setupFiles))
    if quiver_side is not None and as_list(quiver_side.setupFiles):
        return copy.deepcopy(list(quiver_side.setupFiles))
    for port in (gw, alt):
        files = as_list(port.setupFiles)
        if files:
            return copy.deepcopy(list(files))
    return []


def _accepted_entries(port: Optional[UnifiedPort]) -> List[dict]:
    """Extrae los ``accepted`` de ``setupFiles`` y ``romProfile``."""

    if port is None:
        return []
    entries: List[dict] = []
    for item in as_list((port.romProfile or RomProfile()).accepted):
        if isinstance(item, dict):
            entries.append(copy.deepcopy(item))
    for setup in as_list(port.setupFiles):
        if not isinstance(setup, dict):
            continue
        for item in as_list(setup.get('accepted')):
            if isinstance(item, dict):
                entries.append(copy.deepcopy(item))
            elif is_valid_sha1(item):
                entries.append({'sha1': is_valid_sha1(item)})
    return entries


def _merge_rom_profile(
    quiver_side: Optional[UnifiedPort],
    gw: UnifiedPort,
    alt: UnifiedPort,
) -> RomProfile:
    """``romProfile``: unión con ``binding='place'`` si hay SHA-1 verificado."""

    primary = quiver_side.romProfile if quiver_side is not None else gw.romProfile
    profile = copy.deepcopy(primary or RomProfile())

    for port in (gw, alt):
        other = port.romProfile or RomProfile()
        if not as_str(profile.destination) and as_str(other.destination):
            profile.destination = other.destination
        profile.extensions = _dedupe(list(profile.extensions or []) + list(other.extensions or []))
        if not as_str(profile.notes) and as_str(other.notes):
            profile.notes = other.notes
        if not as_str(profile.binding) and as_str(other.binding):
            profile.binding = other.binding

    accepted: List[dict] = []
    for port in (quiver_side, gw, alt):
        accepted.extend(_accepted_entries(port))
    deduped: List[dict] = []
    seen: Set[str] = set()
    for entry in accepted:
        key = is_valid_sha1(entry.get('sha1') or entry.get('sha') or entry.get('hash')) or json.dumps(
            entry, sort_keys=True, ensure_ascii=False, default=str
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(entry)
    if deduped:
        profile.accepted = deduped

    has_sha1 = _setup_files_with_sha1(quiver_side.setupFiles if quiver_side else None) or any(
        _setup_files_with_sha1(port.setupFiles) for port in (gw, alt)
    )
    if has_sha1:
        profile.binding = 'place'
    if not as_str(profile.binding):
        profile.binding = 'in-app'
    return profile


def _strategy_score(value: Any) -> int:
    key = re.sub(r'[^a-z0-9]', '', (as_str(value) or '').lower())
    return _STRATEGY_SPECIFICITY.get(key, 0)


def _most_specific_strategy(primary: Any, secondary: Any) -> str:
    """Prioriza la estrategia más específica (``external`` < ... < appimage)."""

    first = as_str(primary) or 'external'
    second = as_str(secondary) or 'external'
    return second if _strategy_score(second) > _strategy_score(first) else first


def _best_ai_level(primary: Any, secondary: Any) -> str:
    first = as_str(primary) or 'none'
    second = as_str(secondary) or 'none'
    first_rank = _AI_LEVEL_RANK.get(first.strip().lower(), 0)
    second_rank = _AI_LEVEL_RANK.get(second.strip().lower(), 0)
    return second if second_rank > first_rank else first


def _merge_verified_release(
    quiver_side: Optional[UnifiedPort],
    gw: UnifiedPort,
    alt: UnifiedPort,
) -> Optional[Any]:
    """``verifiedRelease``: Quiver prevalece; se completan huecos del otro lado."""

    primary = None
    for port in (quiver_side, gw, alt):
        if port is not None and port.verifiedRelease is not None:
            primary = port.verifiedRelease
            break
    if primary is None:
        return None

    result = copy.deepcopy(primary)
    for port in (quiver_side, gw, alt):
        if port is None or port.verifiedRelease is None:
            continue
        other = port.verifiedRelease
        if not as_str(result.version) and as_str(other.version):
            result.version = other.version
        if not as_str(result.releasedAt) and as_str(other.releasedAt):
            result.releasedAt = other.releasedAt
        if as_str(result.version) and as_str(other.version) and result.version == other.version:
            result.prerelease = bool(result.prerelease) and bool(other.prerelease)
            result.pinned = bool(result.pinned) or bool(other.pinned)
    return result


def _merge_raw(primary: Any, secondary: Any) -> Dict[str, Any]:
    """Fusiona ``raw`` conservando trazas de ambas fuentes."""

    base = copy.deepcopy(as_dict(primary))
    other = as_dict(secondary)
    for key, value in other.items():
        if key not in base or not _is_filled(base.get(key)):
            base[key] = copy.deepcopy(value)
    for key in _RAW_PRIORITY_KEYS:
        if key in other and key not in base:
            base[key] = copy.deepcopy(other[key])
    warnings = list(as_list(base.get('_adapterWarnings'))) + list(
        as_list(other.get('_adapterWarnings'))
    )
    warnings = _dedupe([str(item) for item in warnings if as_str(item)])
    if warnings:
        base['_adapterWarnings'] = warnings
    return base


def merge_ports(base: UnifiedPort, other: UnifiedPort) -> UnifiedPort:
    """Fusiona dos fichas en una sola aplicando las reglas E2-S3.

    * ``sourcePlatform``: GameWave prevalece si es válido (``!= 'other'``).
    * ``requiresUserFiles``: GameWave prevalece si trae texto.
    * ``setupFiles`` / ``playerFeedback``: Quiver prevalece.
    * ``targetPlatforms``, ``tags``, ``searchAliases``, ``gameNames``: unión sin
      duplicados preservando orden.
    * ``iconUrl`` / ``coverUrl``: Quiver si existe o si declara más resolución.
    * ``romProfile``: ``binding='place'`` + ``accepted`` cuando hay SHA-1.
    * ``installStrategy``: la más específica.
    * ``sources[]``: unión de procedencias sin duplicar.
    """

    if base is None and other is None:
        raise ValueError('merge_ports requiere al menos un puerto')
    if other is None:
        return copy.deepcopy(base)
    if base is None:
        return copy.deepcopy(other)

    left = copy.deepcopy(base)
    right = copy.deepcopy(other)

    left_sources = _source_names(left)
    right_sources = _source_names(right)

    gamewave_side: Optional[UnifiedPort]
    if SOURCE_GAMEWAVE in left_sources:
        gamewave_side = left
    elif SOURCE_GAMEWAVE in right_sources:
        gamewave_side = right
    else:
        gamewave_side = None

    quiver_side: Optional[UnifiedPort]
    if SOURCE_QUIVER in left_sources:
        quiver_side = left
    elif SOURCE_QUIVER in right_sources:
        quiver_side = right
    else:
        quiver_side = None

    gw = gamewave_side or left
    alt = right if gw is left else left

    merged = copy.deepcopy(gw)
    merged.sources = _merge_sources(left.sources, right.sources)

    # -- identidad ------------------------------------------------------
    merged.pid = as_str(gw.pid) or as_str(alt.pid) or as_str(gw.name) or 'port'
    merged.name = as_str(gw.name) or as_str(alt.name) or ''
    merged.project = as_str(gw.project) or as_str(alt.project)

    # -- plataformas ----------------------------------------------------
    gw_platform = (as_str(gw.sourcePlatform) or 'other').lower()
    alt_platform = (as_str(alt.sourcePlatform) or 'other').lower()
    merged.sourcePlatform = gw_platform if gw_platform != 'other' else alt_platform
    merged.targetPlatforms = _dedupe(
        list(as_list(gw.targetPlatforms)) + list(as_list(alt.targetPlatforms))
    )
    merged.supportedOS = _dedupe(
        list(as_list(gw.supportedOS)) + list(as_list(alt.supportedOS))
    )

    # -- distribución ---------------------------------------------------
    gw_dist = (as_str(gw.distribution) or 'external').lower()
    alt_dist = (as_str(alt.distribution) or 'external').lower()
    merged.distribution = gw_dist if gw_dist != 'external' else alt_dist
    merged.repository = as_str(gw.repository) or as_str(alt.repository)
    merged.repositorySource = as_str(gw.repositorySource) or as_str(alt.repositorySource)
    merged.releaseAssetFilter = as_str(gw.releaseAssetFilter) or as_str(alt.releaseAssetFilter)
    merged.folderName = as_str(gw.folderName) or as_str(alt.folderName)

    gw_hints = gw.assetHints or AssetHints()
    alt_hints = alt.assetHints or AssetHints()
    merged.assetHints = AssetHints(
        windows=as_str(gw_hints.windows) or as_str(alt_hints.windows),
        linux=as_str(gw_hints.linux) or as_str(alt_hints.linux),
        android=as_str(gw_hints.android) or as_str(alt_hints.android),
    )

    # -- medios ---------------------------------------------------------
    quiver_icon = quiver_side.iconUrl if quiver_side is not None else None
    merged.iconUrl = (
        as_str(quiver_icon) or as_str(gw.iconUrl) or as_str(alt.iconUrl)
    )
    merged.coverUrl = _pick_cover(quiver_side, gw, alt)

    # -- ficheros del usuario, datos y recetas --------------------------
    merged.requiresUserFiles = _merge_requires_user_files(gw, alt)
    merged.gameData = gw.gameData if _is_filled(gw.gameData) else alt.gameData
    merged.installRecipe = as_dict(gw.installRecipe) or as_dict(alt.installRecipe) or None
    merged.modSupport = gw.modSupport if _is_filled(gw.modSupport) else alt.modSupport
    merged.preserve = _dedupe(list(as_list(gw.preserve)) + list(as_list(alt.preserve)))
    merged.linux = _merge_dicts(gw.linux, alt.linux)
    merged.android = _merge_dicts(gw.android, alt.android)
    merged.maturity = gw.maturity if _is_filled(gw.maturity) else alt.maturity
    merged.verification = _merge_dicts(gw.verification, alt.verification)
    merged.visible = bool(gw.visible) and bool(alt.visible)
    merged.quarantinedLinkFields = _dedupe(
        list(as_list(gw.quarantinedLinkFields)) + list(as_list(alt.quarantinedLinkFields))
    )
    merged.relations = _merge_dicts(gw.relations, alt.relations)
    merged.gameRef = _merge_dicts(gw.gameRef, alt.gameRef)

    # -- ROM y setup ----------------------------------------------------
    merged.setupFiles = _prefer_setup_files(quiver_side, gw, alt)
    merged.romProfile = _merge_rom_profile(quiver_side, gw, alt)

    # -- feedback y releases -------------------------------------------
    merged.aiLevel = _best_ai_level(gw.aiLevel, alt.aiLevel)
    quiver_feedback: Optional[PlayerFeedback] = (
        quiver_side.playerFeedback if quiver_side is not None else None
    )
    gw_feedback = gw.playerFeedback or alt.playerFeedback
    merged.playerFeedback = copy.deepcopy(quiver_feedback or gw_feedback)
    merged.verifiedRelease = _merge_verified_release(quiver_side, gw, alt)

    # -- ejecución ------------------------------------------------------
    merged.launch = _merge_dicts(gw.launch, alt.launch)
    merged.installStrategy = _most_specific_strategy(
        gw.installStrategy, alt.installStrategy
    )

    # -- estado y búsqueda ----------------------------------------------
    merged.status = copy.deepcopy(gw.status or alt.status)
    merged.tags = _dedupe(list(as_list(gw.tags)) + list(as_list(alt.tags)))
    merged.gameNames = _dedupe(list(as_list(gw.gameNames)) + list(as_list(alt.gameNames)))
    merged.searchAliases = _dedupe(
        list(as_list(gw.searchAliases)) + list(as_list(alt.searchAliases))
    )
    merged.raw = _merge_raw(gw.raw, alt.raw)
    return merged


# ---------------------------------------------------------------------------
# Identificador determinista
# ---------------------------------------------------------------------------

def generate_pid(port: UnifiedPort) -> str:
    """``pid`` determinista, limpio y URL-friendly.

    * Con repositorio: ``{owner}-{repo}-{discriminador}``.
    * Sin repositorio: ``{nombre}-{proyecto|plataforma}``.
    """

    if port is None:
        return 'port'

    repository = _repo_key(port.repository)
    if repository:
        parts = repository.split('/')
        if len(parts) >= 2:
            owner, repo_name = parts[0], parts[1]
        else:
            owner, repo_name = '', parts[0]
        discriminator_source = as_str(port.releaseAssetFilter) or as_str(port.folderName) or ''
        if not discriminator_source:
            name_slug = slugify(port.name)
            if name_slug and name_slug not in (
                slugify(repo_name),
                slugify('-'.join(part for part in (owner, repo_name) if part)),
            ):
                discriminator_source = as_str(port.name) or ''
        pid = '-'.join(
            part
            for part in (
                slugify(owner),
                slugify(repo_name),
                slugify(discriminator_source),
            )
            if part
        )
        return pid or 'port'

    tail = as_str(port.project) or as_str(port.sourcePlatform) or ''
    pid = '-'.join(
        part for part in (slugify(port.name), slugify(tail)) if part
    )
    return pid or 'port'


def _unique_pid(candidate: str, used: Dict[str, int]) -> str:
    base = candidate or 'port'
    if base not in used:
        return base
    index = used[base] + 1
    while '{}-{}'.format(base, index) in used:
        index += 1
    return '{}-{}'.format(base, index)


# ---------------------------------------------------------------------------
# Deduplicador
# ---------------------------------------------------------------------------

class Deduplicator:
    """Consolida una lista de :class:`UnifiedPort` en fichas únicas."""

    def __init__(self, enable_quiver_matching: bool = True) -> None:
        self.enable_quiver_matching = bool(enable_quiver_matching)
        self.last_stats: Dict[str, Any] = {}

    # -- API pública ----------------------------------------------------
    def deduplicate(self, ports: Sequence[UnifiedPort]) -> List[UnifiedPort]:
        items = [copy.deepcopy(port) for port in (ports or []) if isinstance(port, UnifiedPort)]

        # 1) Agrupación por clave técnica (preserva orden de primera aparición).
        groups: Dict[str, List[UnifiedPort]] = {}
        order: List[str] = []
        for port in items:
            key = build_technical_key(port)
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append(port)

        consolidated: List[UnifiedPort] = []
        technical_collapsed = 0
        for key in order:
            group = groups[key]
            merged = group[0]
            for extra in group[1:]:
                merged = merge_ports(merged, extra)
                technical_collapsed += 1
            consolidated.append(merged)

        # 2) Emparejamiento heurístico Quiver <-> GameWave.
        cross_merged = 0
        if self.enable_quiver_matching:
            consolidated, cross_merged = self._match_quiver(consolidated)

        # 3) ``pid`` determinista y único.
        consolidated = self._assign_pids(consolidated)

        self.last_stats = {
            'input': len(items),
            'output': len(consolidated),
            'groups': len(order),
            'technicalCollapsed': technical_collapsed,
            'quiverMerged': cross_merged,
        }
        return consolidated

    def __call__(self, ports: Sequence[UnifiedPort]) -> List[UnifiedPort]:
        return self.deduplicate(ports)

    # -- interno --------------------------------------------------------
    def _match_quiver(
        self, ports: List[UnifiedPort]
    ) -> Tuple[List[UnifiedPort], int]:
        candidates: Dict[int, UnifiedPort] = {}
        for idx, port in enumerate(ports):
            if _has_source(port, SOURCE_GAMEWAVE):
                candidates[idx] = port
        if not candidates:
            return ports, 0

        index = _MatchIndex(candidates)
        consumed: Set[int] = set()
        merged_count = 0

        for idx, port in enumerate(ports):
            if idx in consumed:
                continue
            names = _source_names(port)
            if SOURCE_GAMEWAVE in names or SOURCE_QUIVER not in names:
                continue
            target_idx = index.find(port)
            if target_idx is None or target_idx in consumed:
                continue
            ports[target_idx] = merge_ports(ports[target_idx], port)
            index.update(target_idx, ports[target_idx])
            consumed.add(idx)
            merged_count += 1

        return [port for idx, port in enumerate(ports) if idx not in consumed], merged_count

    @staticmethod
    def _assign_pids(ports: List[UnifiedPort]) -> List[UnifiedPort]:
        used: Dict[str, int] = {}
        result: List[UnifiedPort] = []
        for port in ports:
            pid = _unique_pid(generate_pid(port), used)
            used[pid] = 1
            port.pid = pid
            result.append(port)
        return result


def deduplicate(ports: Sequence[UnifiedPort]) -> List[UnifiedPort]:
    """Atajo funcional equivalente a ``Deduplicator().deduplicate(ports)``."""

    return Deduplicator().deduplicate(ports)
