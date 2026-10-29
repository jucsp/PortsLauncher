#!/usr/bin/env python3
"""Adaptador Quiver -> UnifiedPort (Fase 2, Anexo B2).

Convierte una *card* de Quiver Launcher (``/api/v1/apps``) en una ficha del
catálogo unificado. Características:

* ``externalId`` = ``catalogId`` -> ``slug`` -> ``id`` (en ese orden).
* ``pid`` = ``catalogId`` cuando existe (permite fusionar con la ficha de
  GameWave); si no, se sintetiza ``quiver:<slug|id>``.
* ``setupFiles`` se sanea: sólo se conservan hashes SHA-1 válidos (40 hex) en
  ``accepted``; el resto se descarta y se anota en ``raw['_adapterWarnings']``.
* ``playerFeedback``, ``verifiedRelease``, ``aiLevel``, ``launch`` y
  ``romProfile`` (``binding='place'`` cuando hay ``setupFiles``).
* Preserva los campos no mapeados en ``raw``.
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_ROOT = os.path.dirname(_HERE)
for _path in (_PKG_ROOT, _HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)

try:  # import como paquete: catalog-builder.adapters.quiver
    from ..models import (  # type: ignore[import-not-found]
        AssetHints,
        PlayerFeedback,
        RomBinding,
        RomProfile,
        SourceRef,
        StatusCommunity,
        StatusInfo,
        UnifiedPort,
        VerifiedRelease,
        as_bool,
        as_dict,
        as_float,
        as_int,
        as_list,
        as_str,
        determine_install_strategy,
        is_valid_sha1,
        normalize_source_platform,
        normalize_target_platforms,
    )
except (ImportError, ValueError):  # import directo: adapters/quiver.py
    from models import (  # type: ignore[no-redef]
        AssetHints,
        PlayerFeedback,
        RomBinding,
        RomProfile,
        SourceRef,
        StatusCommunity,
        StatusInfo,
        UnifiedPort,
        VerifiedRelease,
        as_bool,
        as_dict,
        as_float,
        as_int,
        as_list,
        as_str,
        determine_install_strategy,
        is_valid_sha1,
        normalize_source_platform,
        normalize_target_platforms,
    )

__all__ = ['QuiverAdapter', 'adapt_many', 'sanitize_setup_files', 'now_iso']

_VALID_ROM_BINDINGS = frozenset(RomBinding.values())

#: Extensiones reconocidas en los ``setupFiles`` (para ``romProfile``).
_ROM_EXTENSIONS = (
    '.n64', '.z64', '.v64',
    '.sfc', '.smc', '.fig',
    '.nes', '.fds',
    '.md', '.gen', '.bin', '.smd',
    '.gba', '.agb', '.gb', '.gbc', '.sgb',
    '.nds', '.dsi',
    '.3ds', '.cci', '.cxi', '.cia',
    '.nsp', '.xci',
    '.iso', '.gcm', '.rvz', '.wbfs', '.dol', '.elf',
    '.cso', '.pbp', '.chd', '.cue',
    '.xbe', '.xiso',
    '.rom', '.zip', '.7z',
)

#: Campos consumidos de forma nativa; el resto se preserva en ``raw``.
_HANDLED_FIELDS = frozenset({
    'id', 'slug', 'catalogId', 'name', 'title', 'project', 'author', 'developer',
    'sourcePlatform', 'platform', 'console', 'system', 'originalPlatform',
    'platforms', 'targetPlatforms', 'supportedOS', 'os',
    'distribution', 'availability', 'installType', 'releaseChannel',
    'repository', 'repo', 'repositorySource',
    'assetHints', 'releaseAssetFilter', 'folderName', 'iconUrl', 'icon',
    'coverUrl', 'cover', 'media',
    'requiresUserFiles', 'gameData', 'installRecipe', 'modSupport', 'modSources',
    'preserve', 'linux', 'android', 'maturity', 'verification', 'visible', 'hidden',
    'quarantinedLinkFields', 'relations', 'gameRef',
    'setupFiles', 'launcher', 'preferredExecutables', 'aiLevel',
    'playerFeedback', 'feedback', 'recommended', 'reportIssues', 'reportBroken',
    'reviewCount', 'verifiedRelease', 'verified', 'launch', 'romProfile',
    'rom', 'aliases', 'searchAliases', 'tags', 'gameNames',
    'status',
})


def now_iso() -> str:
    """Marca temporal UTC en formato ISO-8601 (segundos)."""

    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace('+00:00', 'Z')
    )


def sanitize_setup_files(
    raw_files: Any,
) -> Tuple[List[dict], List[str]]:
    """Sanea ``setupFiles`` validando los SHA-1 declarados en ``accepted``.

    Acepta ``accepted`` como lista de hashes en crudo o como lista de dicts
    (``{'sha1': '...'}`` / ``{'sha': '...'}`` / ``{'hash': '...'}``, con
    metadatos adicionales que se preservan).

    Devuelve ``(ficheros_limpios, avisos)``.
    """

    clean_files: List[dict] = []
    warnings: List[str] = []

    for index, item in enumerate(as_list(raw_files)):
        if not isinstance(item, dict):
            warnings.append(f'setupFiles[{index}] descartado: no es un objeto')
            continue

        entry = {key: value for key, value in item.items() if key != 'accepted'}
        accepted: List[dict] = []
        rejected = 0

        for raw_accepted in as_list(item.get('accepted')):
            if isinstance(raw_accepted, dict):
                sha1 = is_valid_sha1(
                    raw_accepted.get('sha1')
                    or raw_accepted.get('sha')
                    or raw_accepted.get('hash')
                )
                if sha1:
                    record = dict(raw_accepted)
                    record['sha1'] = sha1
                    accepted.append(record)
                else:
                    rejected += 1
            else:
                sha1 = is_valid_sha1(raw_accepted)
                if sha1:
                    accepted.append({'sha1': sha1})
                else:
                    rejected += 1

        entry['accepted'] = accepted
        clean_files.append(entry)

        if rejected:
            label = as_str(item.get('name')) or as_str(item.get('url')) or f'#{index}'
            warnings.append(
                f'setupFiles {label}: {rejected} hash(es) SHA-1 descartado(s)'
            )

    return clean_files, warnings


def _dedupe(values: List[str]) -> List[str]:
    result: List[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


def _extract_extensions(names: List[str]) -> List[str]:
    found: List[str] = []
    for name in names:
        lowered = name.lower()
        for ext in _ROM_EXTENSIONS:
            if lowered.endswith(ext) and ext not in found:
                found.append(ext)
    return found


class QuiverAdapter:
    """Adaptador de cards Quiver (``/api/v1/apps``) al modelo unificado."""

    SOURCE = 'quiver'

    def __init__(self, now: Optional[str] = None) -> None:
        self._now = now

    # -- helpers ----------------------------------------------------------
    def _last_seen(self) -> str:
        if isinstance(self._now, str) and self._now.strip():
            return self._now.strip()
        if callable(self._now):
            return str(self._now())
        return now_iso()

    @staticmethod
    def _player_feedback(card: dict) -> Optional[PlayerFeedback]:
        data = as_dict(card.get('playerFeedback') or card.get('feedback'))
        if not data:
            # Fallback: contadores sueltos en la propia card.
            if not any(
                key in card
                for key in ('recommended', 'reportIssues', 'reportBroken', 'reviewCount')
            ):
                return None
            data = card
        return PlayerFeedback(
            recommended=as_int(data.get('recommended'), 0),
            reportIssues=as_int(data.get('reportIssues'), 0),
            reportBroken=as_int(data.get('reportBroken'), 0),
            reviewCount=as_int(data.get('reviewCount'), 0),
        )

    @staticmethod
    def _verified_release(card: dict) -> Optional[VerifiedRelease]:
        data = as_dict(card.get('verifiedRelease'))
        verified = card.get('verified')
        if not data:
            if isinstance(verified, dict):
                data = verified
            elif verified is not None:
                data = {
                    'version': card.get('version'),
                    'releasedAt': card.get('releasedAt') or card.get('updatedAt'),
                    'pinned': as_bool(verified, False),
                }
        if not data:
            return None
        return VerifiedRelease(
            version=as_str(data.get('version')),
            releasedAt=as_str(data.get('releasedAt')) or as_str(data.get('publishedAt')),
            prerelease=as_bool(data.get('prerelease'), False),
            pinned=as_bool(data.get('pinned'), False),
        )

    @staticmethod
    def _community(value: Any) -> StatusCommunity:
        data = as_dict(value)
        window = data.get('windowDays')
        return StatusCommunity(
            verdict=as_str(data.get('verdict')),
            recommended=as_float(data.get('recommended'), 0.0),
            reviews=as_int(data.get('reviews'), 0),
            bugReports=as_int(data.get('bugReports'), 0),
            windowDays=as_int(window, 0) if window is not None else None,
        )

    @classmethod
    def _status(cls, value: Any) -> Optional[StatusInfo]:
        data = as_dict(value)
        if not data:
            return None
        return StatusInfo(
            tag=as_str(data.get('tag')) or 'nodata',
            development=as_str(data.get('development')) or 'unknown',
            maintenance=as_str(data.get('maintenance')) or 'unknown',
            community=cls._community(data.get('community')),
            confidence=as_str(data.get('confidence')) or 'low',
            reasons=[str(reason) for reason in as_list(data.get('reasons')) if as_str(reason)],
            computedAt=as_str(data.get('computedAt')) or '',
            ruleVersion=as_str(data.get('ruleVersion')) or '1.0.0',
            manualOverride=as_dict(data.get('manualOverride')) or None,
        )

    @staticmethod
    def _rom_profile(
        raw_profile: Any,
        setup_files: List[dict],
        fallback_extensions: List[str],
    ) -> RomProfile:
        data = as_dict(raw_profile)
        binding = as_str(data.get('binding')) or ('place' if setup_files else 'in-app')
        if binding not in _VALID_ROM_BINDINGS:
            binding = 'in-app'

        extensions = [str(ext) for ext in as_list(data.get('extensions')) if as_str(ext)]
        for ext in fallback_extensions:
            if ext not in extensions:
                extensions.append(ext)

        accepted = [item for item in as_list(data.get('accepted')) if isinstance(item, dict)]
        if not accepted:
            for file_entry in setup_files:
                for acc in as_list(file_entry.get('accepted')):
                    if isinstance(acc, dict):
                        accepted.append(acc)

        notes = as_str(data.get('notes'))
        if not notes and setup_files:
            notes = 'Requiere ficheros del usuario (ROM) colocados manualmente.'

        return RomProfile(
            binding=binding,
            destination=as_str(data.get('destination')),
            extensions=extensions,
            accepted=accepted,
            notes=notes,
        )

    # -- API pública ------------------------------------------------------
    def adapt(self, card_dict: dict) -> UnifiedPort:
        """Convierte una card Quiver en :class:`UnifiedPort`."""

        card = as_dict(card_dict)
        launcher = as_dict(card.get('launcher'))

        quarantined = _dedupe([
            str(field).strip()
            for field in as_list(card.get('quarantinedLinkFields'))
            if as_str(field)
        ])
        quarantined_set = set(quarantined)

        def clean(key: str, default: Any = None) -> Any:
            value = card.get(key, default)
            if key in quarantined_set:
                return None
            return value

        raw_id = as_str(card.get('id'))
        slug = as_str(clean('slug'))
        catalog_id = as_str(clean('catalogId'))
        external_id = catalog_id or slug or raw_id or 'unknown'
        pid = catalog_id or (
            f'quiver:{slug or raw_id}' if (slug or raw_id) else 'quiver:unknown'
        )

        name = as_str(clean('name')) or as_str(clean('title')) or slug or pid

        # setupFiles: pueden venir en la card o dentro de 'launcher'.
        raw_setup_files = clean('setupFiles') or launcher.get('setupFiles')
        setup_files, warnings = sanitize_setup_files(raw_setup_files)

        setup_names = [
            as_str(entry.get('name')) or as_str(entry.get('url')) or ''
            for entry in setup_files
        ]
        fallback_extensions = _extract_extensions([n for n in setup_names if n])

        source_platform = normalize_source_platform(
            clean('sourcePlatform')
            or clean('platform')
            or clean('console')
            or clean('system')
            or clean('originalPlatform')
        )

        target_platforms = normalize_target_platforms(as_list(
            clean('platforms') or clean('targetPlatforms') or launcher.get('platforms')
        ))
        supported_os = normalize_target_platforms(as_list(
            clean('supportedOS') or clean('os') or clean('platform')
        ))

        repository = (
            as_str(clean('repository'))
            or as_str(clean('repo'))
            or as_str(launcher.get('repository'))
        )
        repository_source = as_str(clean('repositorySource')) or (
            'quiver' if repository else None
        )

        download_url = (
            as_str(launcher.get('downloadUrl'))
            or as_str(clean('downloadUrl'))
            or as_str(launcher.get('url'))
        )
        distribution = as_str(clean('distribution')) or as_str(clean('installType'))
        if not distribution:
            if repository:
                distribution = 'github'
            elif download_url:
                distribution = 'release-archive'
            else:
                distribution = 'external'

        asset_hints_raw = clean('assetHints') or launcher.get('assetHints')
        asset_hints_data = as_dict(asset_hints_raw)
        asset_hints = AssetHints(
            windows=as_str(asset_hints_data.get('windows')),
            linux=as_str(asset_hints_data.get('linux')),
            android=as_str(asset_hints_data.get('android')),
        )

        release_asset_filter = as_str(clean('releaseAssetFilter'))
        availability = as_str(clean('availability'))
        release_channel = as_str(clean('releaseChannel'))

        install_strategy = determine_install_strategy(
            distribution,
            repository,
            asset_hints,
            release_asset_filter,
            availability,
            release_channel,
        )

        requires_user_files: Dict[str, Any] = {'es': None, 'en': None}
        ruf = as_dict(clean('requiresUserFiles'))
        if ruf:
            requires_user_files.update(ruf)
        elif setup_files:
            requires_user_files['es'] = 'ROM original del juego'
            requires_user_files['en'] = 'Original game ROM'

        mod_support = (
            clean('modSupport')
            or clean('modSources')
            or launcher.get('mods')
        )

        launch = as_dict(clean('launch')) or as_dict(launcher.get('launch'))
        preferred_executables = [
            str(executable)
            for executable in as_list(
                clean('preferredExecutables') or launcher.get('preferredExecutables')
            )
            if as_str(executable)
        ]
        if preferred_executables:
            launch.setdefault('preferredExecutables', preferred_executables)

        verification = as_dict(clean('verification'))
        if 'verified' in card:
            verification.setdefault('verified', as_bool(card.get('verified'), False))

        tags = [str(tag) for tag in as_list(clean('tags')) if as_str(tag)]
        game_names = [str(n) for n in as_list(clean('gameNames')) if as_str(n)]
        if name and name not in game_names:
            game_names.insert(0, name)

        aliases = [str(a) for a in as_list(clean('aliases')) if as_str(a)]
        aliases += [str(a) for a in as_list(clean('searchAliases')) if as_str(a)]
        search_aliases = _dedupe(
            [name, slug or '', catalog_id or '', external_id] + aliases + game_names
        )

        visible = True
        if 'hidden' in card:
            visible = not as_bool(card.get('hidden'), False)
        visible = as_bool(clean('visible'), visible)

        raw: Dict[str, Any] = {}
        for key, value in card.items():
            if key in _HANDLED_FIELDS:
                continue
            raw[key] = None if key in quarantined_set else value
        if warnings:
            raw['_adapterWarnings'] = list(warnings)

        effective_quarantine = [
            field for field in quarantined if as_str(card.get(field))
        ]

        return UnifiedPort(
            pid=pid,
            name=name,
            project=as_str(
                clean('project') or clean('author') or clean('developer')
            ),
            sourcePlatform=source_platform,
            targetPlatforms=target_platforms,
            distribution=distribution,
            repository=repository,
            repositorySource=repository_source,
            assetHints=asset_hints,
            releaseAssetFilter=release_asset_filter,
            folderName=as_str(clean('folderName')) or slug,
            iconUrl=as_str(clean('iconUrl') or clean('icon') or as_dict(clean('media')).get('icon')),
            coverUrl=as_str(clean('coverUrl') or clean('cover') or as_dict(clean('media')).get('cover')),
            requiresUserFiles=requires_user_files,
            gameData=clean('gameData'),
            installRecipe=as_dict(clean('installRecipe') or launcher.get('installRecipe')) or None,
            modSupport=mod_support,
            preserve=[
                str(item)
                for item in as_list(clean('preserve') or launcher.get('preserve'))
                if as_str(item)
            ],
            linux=as_dict(clean('linux')),
            android=as_dict(clean('android')),
            maturity=clean('maturity'),
            verification=verification,
            visible=visible,
            quarantinedLinkFields=effective_quarantine,
            relations=as_dict(clean('relations')),
            gameRef=as_dict(clean('gameRef')),
            setupFiles=setup_files,
            aiLevel=as_str(clean('aiLevel')) or 'none',
            playerFeedback=self._player_feedback(card),
            supportedOS=supported_os,
            verifiedRelease=self._verified_release(card),
            launch=launch,
            installStrategy=install_strategy,
            romProfile=self._rom_profile(
                clean('romProfile') or card.get('rom'), setup_files, fallback_extensions
            ),
            sources=[
                SourceRef(
                    source=self.SOURCE,
                    externalId=str(external_id),
                    lastSeen=self._last_seen(),
                    catalogVersion=None,
                )
            ],
            status=self._status(clean('status')),
            tags=tags,
            gameNames=game_names,
            searchAliases=search_aliases,
            raw=raw,
        )

    def to_unified(self, card_dict: dict) -> UnifiedPort:
        """Alias de :meth:`adapt` para integraciones genéricas."""

        return self.adapt(card_dict)


def adapt_many(
    cards: List[dict],
    adapter: Optional[QuiverAdapter] = None,
) -> List[UnifiedPort]:
    """Adapta una lista de cards Quiver."""

    engine = adapter or QuiverAdapter()
    return [engine.adapt(card) for card in cards or []]
