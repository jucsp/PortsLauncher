#!/usr/bin/env python3
"""Modelo canónico del catálogo unificado (Fase 2 - catalog-builder).

Contenido
---------
* Enumeraciones cerradas: ``StatusTag``, ``InstallStrategy``, ``RomBinding``.
* Dataclasses del contrato: ``SourceRef``, ``StatusCommunity``, ``StatusInfo``,
  ``AssetHints``, ``PlayerFeedback``, ``VerifiedRelease``, ``RomProfile``,
  ``UnifiedPort``.
* Normalizadores de plataformas (vocabulario cerrado) y resolución de la
  estrategia de instalación (Anexo D.2).

Doble modo de importación
-------------------------
::

    from catalog_builder.models import UnifiedPort   # paquete (via importlib)
    from models import UnifiedPort                   # módulo suelto / sys.path

El nombre del directorio (``catalog-builder``) contiene un guion, de modo que
el paquete no es importable con la sintaxis ``import`` normal; por eso este
módulo garantiza que su propio directorio esté en ``sys.path`` para que los
adaptadores puedan hacer ``from models import ...`` como fallback.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
if _MODULE_DIR not in sys.path:
    sys.path.insert(0, _MODULE_DIR)

try:  # Python >= 3.11
    from enum import StrEnum  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - Python < 3.11

    class StrEnum(str, Enum):  # type: ignore[no-redef]
        """Fallback mínimo de ``enum.StrEnum`` para Python < 3.11."""

        def __str__(self) -> str:  # noqa: D105
            return str(self.value)

        def __format__(self, format_spec: str) -> str:  # noqa: D105
            return format(str(self.value), format_spec)


__all__ = [
    'StatusTag',
    'InstallStrategy',
    'RomBinding',
    'SourceRef',
    'StatusCommunity',
    'StatusInfo',
    'AssetHints',
    'PlayerFeedback',
    'VerifiedRelease',
    'RomProfile',
    'UnifiedPort',
    'SOURCE_PLATFORM_VOCAB',
    'TARGET_PLATFORM_VOCAB',
    'normalize_source_platform',
    'normalize_target_platform',
    'normalize_target_platforms',
    'determine_install_strategy',
    'is_valid_sha1',
    'as_list',
    'as_dict',
    'as_str',
    'as_bool',
    'as_int',
    'as_float',
    'key_of',
]


# ---------------------------------------------------------------------------
# Enumeraciones cerradas
# ---------------------------------------------------------------------------

class StatusTag(StrEnum):
    """Veredicto global de estado de una ficha."""

    PLAYABLE = 'playable'
    BUGS = 'bugs'
    WIP = 'wip'
    EXPERIMENTAL = 'experimental'
    ABANDONED = 'abandoned'
    NODATA = 'nodata'

    @classmethod
    def values(cls) -> Tuple[str, ...]:
        return tuple(member.value for member in cls)


class InstallStrategy(StrEnum):
    """Cómo se obtiene e instala un port (Anexo D.2)."""

    RELEASE_ARCHIVE = 'release-archive'
    RELEASE_APPIMAGE = 'release-appimage'
    RELEASE_INSTALLER = 'release-installer'
    WINDOWS_VIA_PROTON = 'windows-via-proton'
    SOURCE_ONLY = 'source-only'
    EXTERNAL = 'external'
    RECIPE = 'recipe'
    NEEDS_CHOICE = 'needsChoice'

    @classmethod
    def values(cls) -> Tuple[str, ...]:
        return tuple(member.value for member in cls)


class RomBinding(StrEnum):
    """Momento en el que el port consume el ROM del usuario."""

    PLACE = 'place'
    ARG = 'arg'
    CONFIG = 'config'
    IN_APP = 'in-app'

    @classmethod
    def values(cls) -> Tuple[str, ...]:
        return tuple(member.value for member in cls)


# ---------------------------------------------------------------------------
# Dataclasses del contrato
# ---------------------------------------------------------------------------

@dataclass
class SourceRef:
    """Procedencia de una ficha (permite fusionar varias fuentes)."""

    source: str
    externalId: str
    lastSeen: str
    catalogVersion: Optional[str] = None


@dataclass
class StatusCommunity:
    """Agregado de señales de la comunidad para el motor de estado."""

    verdict: Optional[str] = None
    recommended: float = 0.0
    reviews: int = 0
    bugReports: int = 0
    windowDays: Optional[int] = None


@dataclass
class StatusInfo:
    """Estado calculado por el motor de reglas (Fase 3)."""

    tag: str
    development: str
    maintenance: str
    community: StatusCommunity
    confidence: str
    reasons: List[str]
    computedAt: str
    ruleVersion: str = '1.0.0'
    manualOverride: Optional[dict] = None


@dataclass
class AssetHints:
    """Pistas sobre el naming de los assets de release por plataforma."""

    windows: Optional[str] = None
    linux: Optional[str] = None
    android: Optional[str] = None


@dataclass
class PlayerFeedback:
    """Feedback agregado de jugadores (estrellas / reportes)."""

    recommended: int = 0
    reportIssues: int = 0
    reportBroken: int = 0
    reviewCount: int = 0


@dataclass
class VerifiedRelease:
    """Release que ha sido verificado por el indexador."""

    version: Optional[str] = None
    releasedAt: Optional[str] = None
    prerelease: bool = False
    pinned: bool = False


@dataclass
class RomProfile:
    """Perfil de consumo del ROM / ficheros del usuario."""

    binding: str = 'in-app'
    destination: Optional[str] = None
    extensions: List[str] = field(default_factory=list)
    accepted: List[dict] = field(default_factory=list)
    notes: Optional[str] = None


@dataclass
class UnifiedPort:
    """Ficha unificada del catálogo (contrato Fase 2)."""

    pid: str
    name: str
    project: Optional[str] = None
    sourcePlatform: str = 'other'
    targetPlatforms: List[str] = field(default_factory=list)
    distribution: str = 'external'
    repository: Optional[str] = None
    repositorySource: Optional[str] = None
    assetHints: AssetHints = field(default_factory=AssetHints)
    releaseAssetFilter: Optional[str] = None
    folderName: Optional[str] = None
    iconUrl: Optional[str] = None
    coverUrl: Optional[str] = None
    requiresUserFiles: dict = field(default_factory=lambda: {'es': None, 'en': None})
    gameData: Optional[Any] = None
    installRecipe: Optional[dict] = None
    modSupport: Optional[Any] = None
    preserve: List[str] = field(default_factory=list)
    linux: dict = field(default_factory=dict)
    android: dict = field(default_factory=dict)
    maturity: Any = None
    verification: dict = field(default_factory=dict)
    visible: bool = True
    quarantinedLinkFields: List[str] = field(default_factory=list)
    relations: dict = field(default_factory=dict)
    gameRef: dict = field(default_factory=dict)
    setupFiles: List[dict] = field(default_factory=list)
    aiLevel: str = 'none'
    playerFeedback: Optional[PlayerFeedback] = None
    supportedOS: List[str] = field(default_factory=list)
    verifiedRelease: Optional[VerifiedRelease] = None
    launch: dict = field(default_factory=dict)
    installStrategy: str = 'external'
    romProfile: RomProfile = field(default_factory=RomProfile)
    sources: List[SourceRef] = field(default_factory=list)
    status: Optional[StatusInfo] = None
    tags: List[str] = field(default_factory=list)
    gameNames: List[str] = field(default_factory=list)
    searchAliases: List[str] = field(default_factory=list)
    raw: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Utilidades de coerción defensiva (compartidas con los adaptadores)
# ---------------------------------------------------------------------------

def as_dict(value: Any) -> dict:
    return dict(value) if isinstance(value, dict) else {}


def as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return list(value)
    return [value]


def as_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'y', 'si', 'sí', 'on')
    return default


def as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def is_valid_sha1(value: Any) -> Optional[str]:
    """Devuelve el SHA-1 normalizado (40 hex minúsculas) o ``None``."""

    text = as_str(value)
    if not text:
        return None
    text = text.strip().lower()
    if len(text) != 40:
        return None
    if not all(ch in '0123456789abcdef' for ch in text):
        return None
    return text


# ---------------------------------------------------------------------------
# Normalización de plataformas
# ---------------------------------------------------------------------------

SOURCE_PLATFORM_VOCAB: Tuple[str, ...] = (
    'n64', 'snes', 'nes', 'md', 'gba', 'gb', 'nds', 'n3ds', 'nsw',
    'psp', 'ps1', 'ps2', 'gcn', 'xbox', 'x360', 'pc', 'other',
)

TARGET_PLATFORM_VOCAB: Tuple[str, ...] = (
    'windows', 'linux', 'android', 'macos', 'ios', 'switch', 'web', 'other',
)


def key_of(value: Any) -> str:
    """Normaliza una etiqueta para usarla como clave de búsqueda."""

    if value is None:
        return ''
    text = str(value).strip().lower()
    if not text:
        return ''
    text = text.replace('&', ' and ')
    text = text.replace('(', ' ').replace(')', ' ')
    text = re.sub(r'[\.\-_/\\,;:+*#]+', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


_SOURCE_ALIASES: Dict[str, str] = {}


def _reg_source(target: str, *aliases: str) -> None:
    for alias in aliases:
        key = key_of(alias)
        if key:
            _SOURCE_ALIASES.setdefault(key, target)


# n64
_reg_source(
    'n64',
    'n64', 'nintendo 64', 'nintendo64', 'nintendo 64dd', 'n64dd', '64dd',
    'nintendo 64 disk drive', 'iQue Player', 'ique',
)
# snes
_reg_source(
    'snes',
    'snes', 'super nintendo', 'super nes', 'super nintendo entertainment system',
    'sfc', 'super famicom', 'super famicom sfc', 'super nintendo (snes)',
)
# nes
_reg_source(
    'nes',
    'nes', 'nintendo entertainment system', 'famicom', 'fc', 'fds',
    'famicom disk system', 'nes classic', 'nes classic edition',
    'famicom mini', 'nintendo famicom', 'famicom network system',
)
# md (Mega Drive / Genesis)
_reg_source(
    'md',
    'md', 'mega drive', 'megadrive', 'sega mega drive', 'sega megadrive',
    'genesis', 'sega genesis', 'mega drive genesis', 'sega mega drive genesis',
    'mega drive ii', 'sega mega drive ii', 'mega drive 2',
)
# gba
_reg_source(
    'gba',
    'gba', 'game boy advance', 'gameboy advance', 'gba sp',
    'game boy advance sp', 'gameboy advance sp', 'game boy micro',
)
# gb (incluye Game Boy Color)
_reg_source(
    'gb',
    'gb', 'game boy', 'gameboy', 'game boy color', 'gameboy color', 'gbc',
    'game boy pocket', 'gb pocket', 'game boy light', 'super game boy',
)
# nds
_reg_source(
    'nds',
    'nds', 'nintendo ds', 'ds', 'dsi', 'nintendo dsi', 'ds lite',
    'nintendo ds lite', 'dsi xl', 'nintendo dsi xl', 'nintendo ds family',
)
# n3ds
_reg_source(
    'n3ds',
    'n3ds', '3ds', 'nintendo 3ds', 'new 3ds', 'new nintendo 3ds', '2ds',
    'nintendo 2ds', 'new 2ds', 'new nintendo 2ds', '3ds xl',
    'nintendo 3ds xl', 'new 3ds xl', 'nintendo 3ds family',
)
# nsw
_reg_source(
    'nsw',
    'nsw', 'switch', 'nintendo switch', 'ns', 'switch oled',
    'nintendo switch oled', 'switch lite', 'nintendo switch lite',
)
# psp
_reg_source(
    'psp',
    'psp', 'playstation portable', 'sony psp', 'psp go', 'psp 1000', 'psp 3000',
)
# ps1
_reg_source(
    'ps1',
    'ps1', 'psx', 'ps one', 'playstation', 'playstation 1', 'sony playstation',
    'ps', 'playstation one', 'sony playstation 1', 'psone',
)
# ps2
_reg_source('ps2', 'ps2', 'playstation 2', 'sony playstation 2', 'ps 2')
# gcn
_reg_source(
    'gcn',
    'gcn', 'gc', 'ngc', 'gamecube', 'game cube', 'nintendo gamecube',
    'nintendo game cube', 'dolphin',
)
# xbox (clásica)
_reg_source('xbox', 'xbox', 'xbox classic', 'original xbox', 'microsoft xbox', 'xbox 1')
# xbox 360
_reg_source('x360', 'x360', 'xbox 360', 'xbox360', 'microsoft xbox 360', 'x360 arcade')
# pc (todo lo de escritorio / ordenador)
_reg_source(
    'pc',
    'pc', 'p c', 'windows', 'win', 'win32', 'win64', 'microsoft windows',
    'dos', 'ms dos', 'msdos', 'pc dos', 'linux', 'gnu linux', 'ubuntu', 'debian',
    'mac', 'macos', 'mac os', 'mac os x', 'osx', 'os x', 'desktop',
    'steam', 'itch io', 'itchio', 'microsoft dos',
)
# other (explícito: plataformas fuera del vocabulario cerrado)
_reg_source(
    'other',
    'arcade', 'mame', 'fbneo', 'fba', 'coin op', 'neogeo', 'neo geo', 'neo geo cd',
    'neo geo pocket', 'neo geo pocket color', 'ngp', 'ngpc',
    'wii', 'nintendo wii', 'wii u', 'wiiu', 'nintendo wii u', 'wiiware',
    'saturn', 'sega saturn', 'dreamcast', 'sega dreamcast', 'sega cd', 'sega 32x',
    '32x', 'master system', 'sega master system', 'game gear', 'sega game gear',
    'sg 1000', 'sega sg 1000', 'sg1000',
    'ps3', 'playstation 3', 'ps4', 'playstation 4', 'ps5', 'playstation 5',
    'ps vita', 'vita', 'playstation vita', 'sony playstation vita',
    'xbox one', 'xbox series', 'xbox series x', 'xbox series s', 'xbox series x s',
    'atari 2600', 'atari 5200', 'atari 7800', 'atari lynx', 'atari jaguar',
    'atari st', 'atari 8 bit', 'commodore 64', 'c64', 'commodore amiga', 'amiga',
    'amiga cd32', 'cd32', 'zx spectrum', 'spectrum', 'msx', 'msx2',
    'wonderswan', 'wonderswan color', 'intellivision', 'colecovision', '3do',
    'philips cd i', 'cd i', 'virtual boy', 'pokemon mini',
    'turbografx 16', 'turbografx16', 'pc engine', 'pc engine cd', 'pc fx',
    'mobile', 'android', 'ios', 'iphone', 'ipad', 'web', 'browser', 'flash',
    'html5', 'java me', 'j2me', 'pico 8', 'tic 80', 'multiplatform', 'multi platform',
    'multiple', 'various', 'unknown', 'other', 'n a', 'na', 'none', 'null',
    'unity', 'godot', 'webgl', 'wasm', 'scratch',
)

# Variantes compactas (sin espacios) generadas automáticamente.
for _alias, _target in list(_SOURCE_ALIASES.items()):
    _compact = _alias.replace(' ', '')
    if _compact and _compact != _alias:
        _SOURCE_ALIASES.setdefault(_compact, _target)


def _lookup_source(text: Optional[str]) -> Optional[str]:
    key = key_of(text)
    if not key:
        return None
    if key in _SOURCE_ALIASES:
        return _SOURCE_ALIASES[key]
    compact = key.replace(' ', '')
    if compact in _SOURCE_ALIASES:
        return _SOURCE_ALIASES[compact]
    return None


def normalize_source_platform(raw_val: Optional[str]) -> str:
    """Mapea la plataforma de origen al vocabulario cerrado.

    Acepta los valores usados por GameWave (``Nintendo 64``, ``PSX``,
    ``Mega Drive``, ``GBC``...) y por Quiver (``Super Nintendo``, ``PC``...).
    Devuelve siempre uno de ``SOURCE_PLATFORM_VOCAB``; lo desconocido cae en
    ``'other'``.
    """

    if raw_val is None:
        return 'other'

    text = str(raw_val).strip()
    if not text:
        return 'other'

    hit = _lookup_source(text)
    if hit:
        return hit

    # Valores compuestos: "N64 / NDS", "PS1, PSP", "SNES or NES"...
    for part in re.split(r'[,;/|+]|\bor\b|\band\b', text, flags=re.IGNORECASE):
        hit = _lookup_source(part)
        if hit:
            return hit

    # Último intento: quitar paréntesis y anotaciones tipo "N64 (USA)".
    stripped = re.sub(r'\([^)]*\)', ' ', text)
    hit = _lookup_source(stripped)
    if hit:
        return hit

    return 'other'


_TARGET_ALIASES: Dict[str, str] = {}


def _reg_target(target: str, *aliases: str) -> None:
    for alias in aliases:
        key = key_of(alias)
        if key:
            _TARGET_ALIASES.setdefault(key, target)


_reg_target(
    'windows',
    'windows', 'win', 'win32', 'win64', 'windows 10', 'windows 11',
    'windows 7', 'windows 8', 'microsoft windows', 'pc', 'desktop',
    'windows pc', 'win 10', 'win 11',
)
_reg_target(
    'linux',
    'linux', 'gnu linux', 'ubuntu', 'debian', 'fedora', 'arch', 'arch linux',
    'steamos', 'steam os', 'steam deck', 'steamdeck', 'flatpak', 'appimage',
    'app image', 'linux x86 64', 'linux x64',
)
_reg_target(
    'android',
    'android', 'apk', 'android apk', 'android tv', 'termux', 'android arm',
    'android arm64', 'android x86',
)
_reg_target(
    'macos',
    'macos', 'mac os', 'mac os x', 'osx', 'os x', 'mac', 'darwin',
    'apple macos', 'macbook', 'imac', 'macos x',
)
_reg_target('ios', 'ios', 'iphone', 'ipad', 'ipados', 'apple ios', 'ios ipados')
_reg_target(
    'switch',
    'switch', 'nsw', 'nintendo switch', 'switch lite', 'nintendo switch lite',
)
_reg_target(
    'web',
    'web', 'browser', 'html5', 'html', 'wasm', 'webassembly', 'webgl',
    'javascript', 'js', 'pwa', 'navegador',
)
_reg_target('other', 'other', 'unknown', 'n a', 'na', 'none', 'null', 'any', 'all')

for _alias, _target in list(_TARGET_ALIASES.items()):
    _compact = _alias.replace(' ', '')
    if _compact and _compact != _alias:
        _TARGET_ALIASES.setdefault(_compact, _target)


def normalize_target_platform(raw_val: str) -> str:
    """Mapea una plataforma de destino al vocabulario cerrado de destino."""

    if raw_val is None:
        return 'other'

    text = str(raw_val).strip()
    if not text:
        return 'other'

    key = key_of(text)
    if key in _TARGET_ALIASES:
        return _TARGET_ALIASES[key]

    compact = key.replace(' ', '')
    if compact in _TARGET_ALIASES:
        return _TARGET_ALIASES[compact]

    for part in re.split(r'[,;/|+]|\bor\b|\band\b', text, flags=re.IGNORECASE):
        part_key = key_of(part)
        if part_key in _TARGET_ALIASES:
            return _TARGET_ALIASES[part_key]

    # Heurística de contención ('darwin' ya está registrado explícitamente).
    if 'windows' in key or key.startswith('win') or ' win' in key:
        return 'windows'
    if 'linux' in key or 'steam deck' in key or 'steamdeck' in key:
        return 'linux'
    if 'android' in key:
        return 'android'
    if 'mac' in key or 'osx' in key:
        return 'macos'
    if 'ios' in key or 'iphone' in key or 'ipad' in key:
        return 'ios'
    if 'switch' in key:
        return 'switch'
    if 'web' in key or 'browser' in key:
        return 'web'
    return 'other'


def normalize_target_platforms(platforms: List[str]) -> List[str]:
    """Normaliza y deduplica preservando el orden de aparición."""

    result: List[str] = []
    for value in as_list(platforms):
        normalized = normalize_target_platform(value)
        if normalized not in result:
            result.append(normalized)
    return result


# ---------------------------------------------------------------------------
# Estrategia de instalación (Anexo D.2)
# ---------------------------------------------------------------------------

_EXTERNAL_DISTRIBUTIONS = ('external', 'external launcher', 'external link')
_EXTERNAL_AVAILABILITY = (
    'external', 'external launcher', 'external link', 'download unverified',
    'unverified', 'store', 'external store', 'external only', 'manual external',
)
_RECIPE_DISTRIBUTIONS = ('recipe', 'recipe based', 'manual recipe', 'manual', 'script')
_SOURCE_DISTRIBUTIONS = ('source only', 'source', 'source code', 'build from source')
_SOURCE_CHANNELS = ('source', 'source only', 'source code', 'tags', 'main', 'master')
_CHOICE_AVAILABILITY = ('needs choice', 'needschoice', 'choice', 'multiple', 'multi', 'various')

_INSTALLER_TOKENS = (
    '.msi', '.msix', '.dmg', '.pkg', '.deb', '.rpm', '.snap', '.appx',
    'setup', 'installer', 'install ', '-install', 'installateur',
)
_ARCHIVE_TOKENS = (
    '.zip', '.7z', '.rar', '.tar', '.tgz', '.txz', '.gz', '.xz', '.bz2',
    'archive', 'portable', 'noinstall', 'no install',
)


def _hint_value(asset_hints: Any, key: str) -> Optional[str]:
    if isinstance(asset_hints, AssetHints):
        value = getattr(asset_hints, key, None)
    elif isinstance(asset_hints, dict):
        value = asset_hints.get(key)
    else:
        value = getattr(asset_hints, key, None) if asset_hints is not None else None
    return as_str(value)


def determine_install_strategy(
    distribution: str,
    repository: Optional[str],
    asset_hints: AssetHints,
    release_asset_filter: Optional[str],
    availability: Optional[str],
    release_channel: Optional[str],
) -> str:
    """Resuelve la ``InstallStrategy`` aplicando el Anexo D.2.

    Reglas (en orden de precedencia):

    R1. ``availability``/``distribution`` externa o no verificable -> external.
    R2. Distribución por receta propia -> recipe.
    R3. Sólo código fuente (distribución o canal) -> source-only.
    R4. El usuario debe elegir entre varias opciones -> needsChoice.
    R5. Sin repositorio, sin assets y sin filtro -> external.
    R6. Assets AppImage -> release-appimage.
    R7. Assets instalables (.msi/.dmg/.pkg/setup...) -> release-installer.
    R8. Assets empaquetados (.zip/.7z/.tar.*) -> release-archive.
    R9. Sólo build de Windows (sin Linux/Android) -> windows-via-proton.
    R10. Repositorio con releases -> release-archive.
    Fallback -> external.
    """

    dist = key_of(distribution)
    avail = key_of(availability)
    channel = key_of(release_channel)
    repo = as_str(repository)
    asset_filter = as_str(release_asset_filter)

    hints = (
        asset_hints if isinstance(asset_hints, AssetHints)
        else AssetHints(
            windows=_hint_value(asset_hints, 'windows'),
            linux=_hint_value(asset_hints, 'linux'),
            android=_hint_value(asset_hints, 'android'),
        )
    )
    hint_windows = as_str(hints.windows)
    hint_linux = as_str(hints.linux)
    hint_android = as_str(hints.android)

    # R1
    if avail in _EXTERNAL_AVAILABILITY or dist in _EXTERNAL_DISTRIBUTIONS:
        return InstallStrategy.EXTERNAL.value
    # R2
    if dist in _RECIPE_DISTRIBUTIONS:
        return InstallStrategy.RECIPE.value
    # R3
    if dist in _SOURCE_DISTRIBUTIONS or channel in _SOURCE_CHANNELS:
        return InstallStrategy.SOURCE_ONLY.value
    # R4
    if avail in _CHOICE_AVAILABILITY or channel in _CHOICE_AVAILABILITY:
        return InstallStrategy.NEEDS_CHOICE.value
    # R5
    if not repo and not any((hint_windows, hint_linux, hint_android)) and not asset_filter:
        return InstallStrategy.EXTERNAL.value

    probe = ' '.join(
        part.lower() for part in (asset_filter, hint_linux, hint_windows, hint_android) if part
    )

    # R6
    if 'appimage' in probe or 'app image' in probe:
        return InstallStrategy.RELEASE_APPIMAGE.value
    # R7
    if any(token in probe for token in _INSTALLER_TOKENS):
        return InstallStrategy.RELEASE_INSTALLER.value
    # R8
    if any(token in probe for token in _ARCHIVE_TOKENS):
        return InstallStrategy.RELEASE_ARCHIVE.value
    # R9
    if hint_windows and not hint_linux and not hint_android:
        return InstallStrategy.WINDOWS_VIA_PROTON.value
    # R10
    if repo:
        return InstallStrategy.RELEASE_ARCHIVE.value
    return InstallStrategy.EXTERNAL.value
