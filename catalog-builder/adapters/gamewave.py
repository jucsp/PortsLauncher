#!/usr/bin/env python3
"""Adaptador GameWave -> UnifiedPort (Fase 2, Anexo B).

Convierte una ficha del ``catalog.json`` de GameWave en una ficha del catálogo
unificado. Características:

* Limpia el sufijo comercial ``· GameWave Build`` del nombre.
* Aplica cuarentena de enlaces: cualquier campo listado en
  ``quarantinedLinkFields`` se anula (también dentro de ``raw``).
* Normaliza plataformas al vocabulario cerrado de :mod:`models`.
* Resuelve la estrategia de instalación (Anexo D.2).
* Preserva los campos no mapeados en ``raw`` para no perder fidelidad.
* Registra la procedencia en ``sources`` (``SourceRef``).
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_ROOT = os.path.dirname(_HERE)
for _path in (_PKG_ROOT, _HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)

try:  # import como paquete: catalog-builder.adapters.gamewave
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
        normalize_source_platform,
        normalize_target_platforms,
    )
except (ImportError, ValueError):  # import directo: adapters/gamewave.py
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
        normalize_source_platform,
        normalize_target_platforms,
    )

__all__ = ['GameWaveAdapter', 'adapt_many', 'now_iso']

#: Sufijos comerciales a eliminar del nombre visible.
_NAME_SUFFIX_RE = re.compile(
    r'\s*(?:[·•\-\u2013\u2014|:]\s*)?GameWave\s+Build\s*$',
    re.IGNORECASE,
)

#: Campos consumidos de forma nativa por el adaptador. Todo lo demás se
#: preserva en ``UnifiedPort.raw``.
_HANDLED_FIELDS = frozenset({
    'id', 'slug', 'name', 'project',
    'sourcePlatform', 'platform', 'console', 'system', 'originalPlatform',
    'platforms', 'targetPlatforms', 'supportedOS', 'os',
    'distribution', 'availability', 'releaseChannel', 'release_channel',
    'repository', 'repo', 'repositorySource',
    'assetHints', 'releaseAssetFilter',
    'folderName', 'iconUrl', 'coverUrl',
    'requiresUserFiles', 'gameData', 'installRecipe', 'modSupport', 'preserve',
    'linux', 'android', 'maturity', 'verification', 'visible', 'enabled',
    'quarantinedLinkFields', 'relations', 'gameRef', 'setupFiles',
    'aiLevel', 'playerFeedback', 'feedback',
    'verifiedRelease', 'launch', 'romProfile',
    'tags', 'gameNames', 'aliases', 'searchAliases',
    'status',
})

_VALID_ROM_BINDINGS = frozenset(RomBinding.values())


def now_iso() -> str:
    """Marca temporal UTC en formato ISO-8601 (segundos)."""

    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace('+00:00', 'Z')
    )


def _clean_name(value: Any) -> str:
    """Elimina el sufijo ``· GameWave Build`` y normaliza espacios."""

    text = as_str(value) or ''
    previous = None
    while previous != text:
        previous = text
        text = _NAME_SUFFIX_RE.sub('', text).strip()
        text = text.strip(' \t·•-–—|:')
    return re.sub(r'\s{2,}', ' ', text).strip()


def _dedupe(values: List[str]) -> List[str]:
    result: List[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


class GameWaveAdapter:
    """Adaptador de fichas GameWave (``catalog.json``) al modelo unificado."""

    SOURCE = 'gamewave'

    def __init__(self, now: Optional[str] = None) -> None:
        """``now`` permite fijar ``lastSeen`` de forma determinista en tests."""

        self._now = now

    # -- helpers ----------------------------------------------------------
    def _last_seen(self) -> str:
        if isinstance(self._now, str) and self._now.strip():
            return self._now.strip()
        if callable(self._now):  # compatibilidad con relojes inyectados
            return str(self._now())
        return now_iso()

    @staticmethod
    def _player_feedback(value: Any) -> Optional[PlayerFeedback]:
        data = as_dict(value)
        if not data:
            return None
        return PlayerFeedback(
            recommended=as_int(data.get('recommended'), 0),
            reportIssues=as_int(data.get('reportIssues'), 0),
            reportBroken=as_int(data.get('reportBroken'), 0),
            reviewCount=as_int(data.get('reviewCount'), 0),
        )

    @staticmethod
    def _verified_release(value: Any) -> Optional[VerifiedRelease]:
        data = as_dict(value)
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
    def _asset_hints(value: Any, quarantine_all: bool = False) -> AssetHints:
        if quarantine_all:
            return AssetHints()
        data = as_dict(value)
        return AssetHints(
            windows=as_str(data.get('windows')),
            linux=as_str(data.get('linux')),
            android=as_str(data.get('android')),
        )

    @staticmethod
    def _rom_profile(value: Any, setup_files: List[dict]) -> RomProfile:
        data = as_dict(value)
        binding = as_str(data.get('binding')) or ('place' if setup_files else 'in-app')
        if binding not in _VALID_ROM_BINDINGS:
            binding = 'in-app'
        return RomProfile(
            binding=binding,
            destination=as_str(data.get('destination')),
            extensions=[str(ext) for ext in as_list(data.get('extensions')) if as_str(ext)],
            accepted=[item for item in as_list(data.get('accepted')) if isinstance(item, dict)],
            notes=as_str(data.get('notes')),
        )

    # -- API pública ------------------------------------------------------
    def adapt(
        self,
        app_dict: dict,
        catalog_version: Optional[str] = None,
    ) -> UnifiedPort:
        """Convierte una ficha GameWave en :class:`UnifiedPort`."""

        app = as_dict(app_dict)

        quarantined = _dedupe([
            str(field).strip()
            for field in as_list(app.get('quarantinedLinkFields'))
            if as_str(field)
        ])
        quarantined_set = set(quarantined)

        def clean(key: str, default: Any = None) -> Any:
            value = app.get(key, default)
            if key in quarantined_set:
                return None
            return value

        raw_id = as_str(app.get('id'))
        slug = as_str(clean('slug'))
        name = _clean_name(clean('name'))
        pid = raw_id or slug or name or 'gamewave:unknown'
        name = name or pid

        source_platform = normalize_source_platform(
            clean('sourcePlatform')
            or clean('platform')
            or clean('console')
            or clean('system')
            or clean('originalPlatform')
        )

        targets_raw = (
            clean('platforms')
            or clean('targetPlatforms')
            or clean('os')
        )
        target_platforms = normalize_target_platforms(as_list(targets_raw))
        supported_os = normalize_target_platforms(as_list(clean('supportedOS')))

        distribution = as_str(clean('distribution')) or 'external'
        repository = as_str(clean('repository')) or as_str(clean('repo'))
        repository_source = as_str(clean('repositorySource'))
        asset_hints = self._asset_hints(
            app.get('assetHints'), quarantine_all='assetHints' in quarantined_set
        )
        release_asset_filter = as_str(clean('releaseAssetFilter'))
        availability = as_str(clean('availability'))
        release_channel = as_str(
            clean('releaseChannel') or clean('release_channel')
        )

        requires_user_files: Dict[str, Any] = {'es': None, 'en': None}
        ruf = as_dict(clean('requiresUserFiles'))
        if ruf:
            requires_user_files.update(ruf)

        setup_files = [
            item for item in as_list(clean('setupFiles')) if isinstance(item, dict)
        ]

        install_strategy = determine_install_strategy(
            distribution,
            repository,
            asset_hints,
            release_asset_filter,
            availability,
            release_channel,
        )

        tags = [str(tag) for tag in as_list(clean('tags')) if as_str(tag)]
        game_names = [str(n) for n in as_list(clean('gameNames')) if as_str(n)]
        if name and name not in game_names:
            game_names.insert(0, name)

        aliases = [str(a) for a in as_list(clean('aliases')) if as_str(a)]
        aliases += [str(a) for a in as_list(clean('searchAliases')) if as_str(a)]
        search_aliases = _dedupe(
            [name, slug or '', pid] + aliases + game_names
            + [as_str(clean('folderName')) or '']
        )

        external_id = raw_id or pid
        sources = [
            SourceRef(
                source=self.SOURCE,
                externalId=str(external_id),
                lastSeen=self._last_seen(),
                catalogVersion=catalog_version,
            )
        ]

        # Cuarentena efectiva: sólo los campos que realmente traían valor.
        effective_quarantine = [
            field for field in quarantined if as_str(app.get(field))
        ]

        # ``visible``: ``visible`` explícito > ``enabled`` de GameWave > True.
        visible_value = clean('visible')
        if visible_value is None:
            visible_value = clean('enabled')
        visible = as_bool(visible_value, True)

        raw: Dict[str, Any] = {}
        for key, value in app.items():
            if key in _HANDLED_FIELDS:
                continue
            raw[key] = None if key in quarantined_set else value

        return UnifiedPort(
            pid=pid,
            name=name,
            project=as_str(clean('project')),
            sourcePlatform=source_platform,
            targetPlatforms=target_platforms,
            distribution=distribution,
            repository=repository,
            repositorySource=repository_source,
            assetHints=asset_hints,
            releaseAssetFilter=release_asset_filter,
            folderName=as_str(clean('folderName')),
            iconUrl=as_str(clean('iconUrl')),
            coverUrl=as_str(clean('coverUrl')),
            requiresUserFiles=requires_user_files,
            gameData=clean('gameData'),
            installRecipe=as_dict(clean('installRecipe')) or None,
            modSupport=clean('modSupport'),
            preserve=[str(item) for item in as_list(clean('preserve')) if as_str(item)],
            linux=as_dict(clean('linux')),
            android=as_dict(clean('android')),
            maturity=clean('maturity'),
            verification=as_dict(clean('verification')),
            visible=visible,
            quarantinedLinkFields=effective_quarantine,
            relations=as_dict(clean('relations')),
            gameRef=as_dict(clean('gameRef')),
            setupFiles=setup_files,
            aiLevel=as_str(clean('aiLevel')) or 'none',
            playerFeedback=self._player_feedback(clean('playerFeedback') or clean('feedback')),
            supportedOS=supported_os,
            verifiedRelease=self._verified_release(clean('verifiedRelease')),
            launch=as_dict(clean('launch')),
            installStrategy=install_strategy,
            romProfile=self._rom_profile(app.get('romProfile'), setup_files),
            sources=sources,
            status=self._status(app.get('status')),
            tags=tags,
            gameNames=game_names,
            searchAliases=search_aliases,
            raw=raw,
        )

    # Alias cómodo para integraciones que esperan ``to_unified``.
    def to_unified(
        self,
        app_dict: dict,
        catalog_version: Optional[str] = None,
    ) -> UnifiedPort:
        return self.adapt(app_dict, catalog_version=catalog_version)


def adapt_many(
    apps: List[dict],
    catalog_version: Optional[str] = None,
    adapter: Optional[GameWaveAdapter] = None,
) -> List[UnifiedPort]:
    """Adapta una lista de fichas GameWave."""

    engine = adapter or GameWaveAdapter()
    return [engine.adapt(app, catalog_version=catalog_version) for app in apps or []]
