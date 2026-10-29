#!/usr/bin/env python3
"""Pruebas unitarias de los adaptadores GameWave y Quiver (Fase 2).

Cubre el Anexo B (GameWave) y el Anexo B2 (Quiver):

* preservación de campos desconocidos en ``raw``;
* cuarentena de URLs (``quarantinedLinkFields``);
* limpieza del sufijo ``· GameWave Build``;
* normalización de plataformas de origen y destino;
* ``enabled`` -> ``visible``;
* ``catalogId``/``slug``/``id`` -> ``externalId`` y ``SourceRef``;
* validación SHA-1 de ``setupFiles`` y ``romProfile.binding='place'``;
* ``playerFeedback`` y ``verifiedRelease``.
"""

from __future__ import annotations

import importlib
import json
import re
import sys
import unittest
from dataclasses import asdict
from pathlib import Path

TEST_DIR = Path(__file__).resolve().parent
BUILDER_DIR = TEST_DIR.parent
PROJECT_ROOT = BUILDER_DIR.parent
for p in (str(PROJECT_ROOT), str(BUILDER_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

NOW = '2026-01-01T00:00:00Z'
VALID_SHA1 = 'a' * 40
UPPER_SHA1 = 'A' * 40

GW_FIXTURE = PROJECT_ROOT / 'fixtures' / 'gamewave' / 'catalog.json'
QUIVER_FIXTURE = PROJECT_ROOT / 'fixtures' / 'quiver' / 'apps_unique.json'


def _import(name: str):
    """Importa ``name`` como módulo plano y, si falla, como subpaquete."""

    try:
        return importlib.import_module(name)
    except ImportError:
        return importlib.import_module('catalog-builder.{}'.format(name))


models = _import('models')
gamewave_module = _import('adapters.gamewave')
quiver_module = _import('adapters.quiver')

GameWaveAdapter = gamewave_module.GameWaveAdapter
QuiverAdapter = quiver_module.QuiverAdapter
SOURCE_VOCAB = models.SOURCE_PLATFORM_VOCAB
TARGET_VOCAB = models.TARGET_PLATFORM_VOCAB


# ---------------------------------------------------------------------------
# GameWave (Anexo B)
# ---------------------------------------------------------------------------

class TestGameWaveAdapter(unittest.TestCase):
    """Adaptador de ``catalog.json`` de GameWave."""

    def setUp(self) -> None:
        self.adapter = GameWaveAdapter(now=NOW)

    # -- raw ------------------------------------------------------------
    def test_unknown_fields_preserved_in_raw(self) -> None:
        app = {
            'id': 'p1',
            'name': 'Test Port',
            'sourcePlatform': 'Nintendo 64',
            'steamAppId': 1234,
            'mysteryFlag': True,
            'unknownObject': {'a': 1},
        }
        port = self.adapter.adapt(app)

        self.assertEqual(port.raw.get('steamAppId'), 1234)
        self.assertIs(port.raw.get('mysteryFlag'), True)
        self.assertEqual(port.raw.get('unknownObject'), {'a': 1})
        # Los campos consumidos no se duplican en ``raw``.
        for consumed in ('id', 'name', 'sourcePlatform'):
            self.assertNotIn(consumed, port.raw)

    def test_no_unknown_fields_means_empty_raw(self) -> None:
        port = self.adapter.adapt({'id': 'p', 'name': 'Port'})
        self.assertEqual(port.raw, {})

    # -- cuarentena ------------------------------------------------------
    def test_quarantined_links_are_nulled(self) -> None:
        app = {
            'id': 'p2',
            'name': 'Port',
            'sourcePlatform': 'Nintendo 64',
            'distribution': 'github',
            'repository': 'owner/repo',
            'androidUrl': 'https://evil.example/android.apk',
            'windowsUrl': 'https://evil.example/win.zip',
            'downloadUrl': 'https://evil.example/download',
            'projectUrl': 'https://evil.example/project',
            'quarantinedLinkFields': [
                'androidUrl', 'windowsUrl', 'downloadUrl', 'projectUrl',
            ],
        }
        port = self.adapter.adapt(app)

        self.assertEqual(
            sorted(port.quarantinedLinkFields),
            ['androidUrl', 'downloadUrl', 'projectUrl', 'windowsUrl'],
        )
        for field in ('androidUrl', 'windowsUrl', 'downloadUrl', 'projectUrl'):
            self.assertIn(field, port.raw)
            self.assertIsNone(port.raw[field], '{} debería anularse'.format(field))

        serialized = json.dumps(asdict(port), ensure_ascii=False, default=str)
        self.assertNotIn('evil.example', serialized)

    def test_quarantined_non_url_fields(self) -> None:
        app = {
            'id': 'p3',
            'name': 'Port',
            'repository': 'owner/repo',
            'releaseAssetFilter': 'linux.zip',
            'quarantinedLinkFields': ['repository', 'releaseAssetFilter'],
        }
        port = self.adapter.adapt(app)

        self.assertIsNone(port.repository)
        self.assertIsNone(port.releaseAssetFilter)
        self.assertEqual(
            sorted(port.quarantinedLinkFields), ['releaseAssetFilter', 'repository']
        )

    def test_asset_hints_quarantine(self) -> None:
        app = {
            'id': 'p4',
            'name': 'Port',
            'assetHints': {'windows': 'https://evil.example/win.zip', 'linux': 'ok.AppImage'},
            'quarantinedLinkFields': ['assetHints'],
        }
        port = self.adapter.adapt(app)

        self.assertIsNone(port.assetHints.windows)
        self.assertIsNone(port.assetHints.linux)

    def test_quarantine_only_reports_fields_with_value(self) -> None:
        app = {
            'id': 'p5',
            'name': 'Port',
            'downloadUrl': None,
            'quarantinedLinkFields': ['downloadUrl', 'androidUrl'],
        }
        port = self.adapter.adapt(app)
        self.assertEqual(port.quarantinedLinkFields, [])

    # -- nombre ----------------------------------------------------------
    def test_name_suffix_cleaned(self) -> None:
        cases = {
            'Ship of Harkinian · GameWave Build': 'Ship of Harkinian',
            'SM64 - GameWave Build': 'SM64',
            'Portal 64 | GameWave Build': 'Portal 64',
            'Zelda: OoT — GameWave Build': 'Zelda: OoT',
            'Plain Name': 'Plain Name',
        }
        for raw, expected in cases.items():
            port = self.adapter.adapt({'id': 'x', 'name': raw, 'sourcePlatform': 'N64'})
            self.assertEqual(port.name, expected, 'entrada: {!r}'.format(raw))
            self.assertNotIn('GameWave Build', port.name)

    # -- plataformas -----------------------------------------------------
    def test_source_platform_vocabulary(self) -> None:
        cases = {
            'Nintendo 64': 'n64',
            'N64': 'n64',
            'Super Nintendo': 'snes',
            'Super Nintendo Entertainment System': 'snes',
            'NES': 'nes',
            'Mega Drive': 'md',
            'Genesis': 'md',
            'Game Boy Advance': 'gba',
            'Game Boy Color': 'gb',
            'Nintendo DS': 'nds',
            'Nintendo 3DS': 'n3ds',
            'Nintendo Switch': 'nsw',
            'PSP': 'psp',
            'PlayStation': 'ps1',
            'PSX': 'ps1',
            'PlayStation 2': 'ps2',
            'GameCube': 'gcn',
            'Xbox': 'xbox',
            'Xbox 360': 'x360',
            'PC': 'pc',
            'Arcade': 'other',
            'Plataforma Inexistente': 'other',
            '': 'other',
            None: 'other',
        }
        for raw, expected in cases.items():
            app = {'id': 'sp', 'name': 'Port'}
            if raw is not None:
                app['sourcePlatform'] = raw
            port = self.adapter.adapt(app)
            self.assertEqual(
                port.sourcePlatform, expected, 'entrada: {!r}'.format(raw)
            )
            self.assertIn(port.sourcePlatform, SOURCE_VOCAB)

    def test_target_platforms_normalized(self) -> None:
        app = {
            'id': 'tp',
            'name': 'Port',
            'platforms': ['Windows', 'Linux', 'Android', 'macOS', 'Switch', 'iOS', 'Web'],
        }
        port = self.adapter.adapt(app)
        self.assertEqual(
            port.targetPlatforms,
            ['windows', 'linux', 'android', 'macos', 'switch', 'ios', 'web'],
        )
        self.assertTrue(set(port.targetPlatforms) <= set(TARGET_VOCAB))

    def test_target_platforms_deduplicated(self) -> None:
        app = {
            'id': 'tp2',
            'name': 'Port',
            'platforms': ['Windows', 'win', 'Linux', 'linux', 'Android'],
        }
        port = self.adapter.adapt(app)
        self.assertEqual(port.targetPlatforms, ['windows', 'linux', 'android'])

    def test_windows_maps_to_windows(self) -> None:
        port = self.adapter.adapt(
            {'id': 'tp3', 'name': 'Port', 'platforms': ['Windows 11']}
        )
        self.assertEqual(port.targetPlatforms, ['windows'])

    # -- visibilidad -----------------------------------------------------
    def test_enabled_maps_to_visible(self) -> None:
        self.assertFalse(
            self.adapter.adapt({'id': 'a', 'name': 'A', 'enabled': False}).visible
        )
        self.assertTrue(
            self.adapter.adapt({'id': 'b', 'name': 'B', 'enabled': True}).visible
        )
        self.assertTrue(self.adapter.adapt({'id': 'c', 'name': 'C'}).visible)
        # ``visible`` explícito gana sobre ``enabled``.
        self.assertFalse(
            self.adapter.adapt(
                {'id': 'd', 'name': 'D', 'visible': False, 'enabled': True}
            ).visible
        )
        # ``enabled`` no se filtra a ``raw``.
        self.assertNotIn(
            'enabled',
            self.adapter.adapt({'id': 'e', 'name': 'E', 'enabled': False}).raw,
        )

    # -- procedencia -----------------------------------------------------
    def test_source_ref_gamewave(self) -> None:
        port = self.adapter.adapt({'id': 42, 'name': 'Port'}, catalog_version='2026.10.24.3')

        self.assertEqual(len(port.sources), 1)
        ref = port.sources[0]
        self.assertEqual(ref.source, 'gamewave')
        self.assertEqual(ref.externalId, '42')
        self.assertEqual(ref.catalogVersion, '2026.10.24.3')
        self.assertEqual(ref.lastSeen, NOW)

    def test_install_strategy_stack(self) -> None:
        base = {
            'id': 's1',
            'name': 'Port',
            'platforms': ['Windows'],
            'repository': 'owner/repo',
            'distribution': 'github',
        }
        appimage = dict(base, assetHints={'linux': 'Port.AppImage'})
        archive = dict(base, releaseAssetFilter='Port-windows.zip')
        installer = dict(base, releaseAssetFilter='Port-setup.msi')
        external = dict(
            base, distribution='external', availability='external-launcher'
        )
        source_only = dict(base, distribution='source-only')

        self.assertEqual(self.adapter.adapt(appimage).installStrategy, 'release-appimage')
        self.assertEqual(self.adapter.adapt(archive).installStrategy, 'release-archive')
        self.assertEqual(self.adapter.adapt(installer).installStrategy, 'release-installer')
        self.assertEqual(self.adapter.adapt(external).installStrategy, 'external')
        self.assertEqual(self.adapter.adapt(source_only).installStrategy, 'source-only')

    # -- fixture real ----------------------------------------------------
    @unittest.skipUnless(GW_FIXTURE.exists(), 'fixtures/gamewave/catalog.json no disponible')
    def test_real_fixture(self) -> None:
        with open(GW_FIXTURE, 'r', encoding='utf-8') as handle:
            payload = json.load(handle)
        apps = payload.get('apps') or []
        self.assertGreater(len(apps), 100)

        version = payload.get('catalogVersion')
        ports = [
            self.adapter.adapt(app, catalog_version=version) for app in apps[:60]
        ]
        self.assertEqual(len(ports), 60)
        for port in ports:
            self.assertTrue(port.name)
            self.assertNotIn('GameWave Build', port.name)
            self.assertEqual(port.sources[0].source, 'gamewave')
            self.assertEqual(port.sources[0].catalogVersion, version)
            self.assertIn(port.sourcePlatform, SOURCE_VOCAB)


# ---------------------------------------------------------------------------
# Quiver (Anexo B2)
# ---------------------------------------------------------------------------

class TestQuiverAdapter(unittest.TestCase):
    """Adaptador de cards de Quiver."""

    def setUp(self) -> None:
        self.adapter = QuiverAdapter(now=NOW)

    # -- identidad -------------------------------------------------------
    def test_catalog_id_maps_to_external_id(self) -> None:
        card = {'id': 'q-1', 'catalogId': 'gw-1', 'slug': 'soh', 'name': 'SoH'}
        port = self.adapter.adapt(card)

        self.assertEqual(port.sources[0].source, 'quiver')
        self.assertEqual(port.sources[0].externalId, 'gw-1')
        self.assertEqual(port.pid, 'gw-1')
        self.assertEqual(port.sources[0].lastSeen, NOW)

    def test_slug_fallback(self) -> None:
        port = self.adapter.adapt({'id': 'q-2', 'slug': 'my-slug', 'name': 'My'})
        self.assertEqual(port.sources[0].externalId, 'my-slug')
        self.assertEqual(port.folderName, 'my-slug')

    def test_id_fallback(self) -> None:
        port = self.adapter.adapt({'id': 'q-3', 'name': 'Solo id'})
        self.assertEqual(port.sources[0].externalId, 'q-3')
        self.assertEqual(port.sources[0].source, 'quiver')

    # -- setupFiles / romProfile -----------------------------------------
    def test_setup_files_sha1_validation(self) -> None:
        card = {
            'id': 'q-4',
            'name': 'Port',
            'setupFiles': [
                {
                    'name': 'rom.z64',
                    'url': 'https://example.com/rom.z64',
                    'accepted': [VALID_SHA1, 'no-es-un-hash', 'x' * 40, UPPER_SHA1],
                }
            ],
        }
        port = self.adapter.adapt(card)

        self.assertEqual(len(port.setupFiles), 1)
        accepted = port.setupFiles[0]['accepted']
        self.assertEqual(len(accepted), 2)
        for item in accepted:
            self.assertRegex(item['sha1'], r'^[0-9a-f]{40}$')
        self.assertEqual([item['sha1'] for item in accepted], [VALID_SHA1, VALID_SHA1])
        # Los hashes descartados se registran como aviso, no se pierden en silencio.
        self.assertTrue(port.raw.get('_adapterWarnings'))

    def test_setup_files_from_launcher_block(self) -> None:
        card = {
            'id': 'q-5',
            'name': 'Port',
            'launcher': {
                'setupFiles': [
                    {'name': 'rom.sfc', 'accepted': [{'sha1': VALID_SHA1}]},
                ]
            },
        }
        port = self.adapter.adapt(card)
        self.assertEqual(len(port.setupFiles), 1)
        self.assertEqual(port.setupFiles[0]['accepted'][0]['sha1'], VALID_SHA1)

    def test_rom_profile_place_when_setup_files(self) -> None:
        card = {
            'id': 'q-6',
            'name': 'Port',
            'setupFiles': [
                {
                    'name': 'rom.z64',
                    'destination': 'roms/',
                    'accepted': [{'sha1': VALID_SHA1}],
                }
            ],
            'romProfile': {'destination': 'roms/n64/', 'extensions': ['.z64']},
        }
        port = self.adapter.adapt(card)

        self.assertEqual(port.romProfile.binding, 'place')
        self.assertEqual(port.romProfile.destination, 'roms/n64/')
        self.assertIn('.z64', port.romProfile.extensions)
        self.assertEqual(
            [item.get('sha1') for item in port.romProfile.accepted], [VALID_SHA1]
        )

    def test_rom_profile_in_app_without_setup_files(self) -> None:
        port = self.adapter.adapt({'id': 'q-7', 'name': 'Port'})
        self.assertEqual(port.romProfile.binding, 'in-app')
        self.assertEqual(port.romProfile.accepted, [])

    # -- feedback y releases ---------------------------------------------
    def test_player_feedback(self) -> None:
        card = {
            'id': 'q-8',
            'name': 'Port',
            'playerFeedback': {
                'recommended': 30,
                'reportIssues': 2,
                'reportBroken': 1,
                'reviewCount': 40,
            },
        }
        feedback = self.adapter.adapt(card).playerFeedback

        self.assertIsNotNone(feedback)
        self.assertEqual(feedback.recommended, 30)
        self.assertEqual(feedback.reportIssues, 2)
        self.assertEqual(feedback.reportBroken, 1)
        self.assertEqual(feedback.reviewCount, 40)

    def test_player_feedback_loose_counters(self) -> None:
        card = {'id': 'q-9', 'name': 'Port', 'recommended': 5, 'reviewCount': 8}
        feedback = self.adapter.adapt(card).playerFeedback

        self.assertIsNotNone(feedback)
        self.assertEqual(feedback.recommended, 5)
        self.assertEqual(feedback.reviewCount, 8)
        self.assertEqual(feedback.reportIssues, 0)

    def test_player_feedback_absent(self) -> None:
        self.assertIsNone(self.adapter.adapt({'id': 'q-10', 'name': 'Port'}).playerFeedback)

    def test_verified_release(self) -> None:
        card = {
            'id': 'q-11',
            'name': 'Port',
            'verifiedRelease': {
                'version': '1.2.3',
                'releasedAt': '2025-05-01T00:00:00Z',
                'prerelease': False,
                'pinned': True,
            },
        }
        release = self.adapter.adapt(card).verifiedRelease

        self.assertIsNotNone(release)
        self.assertEqual(release.version, '1.2.3')
        self.assertEqual(release.releasedAt, '2025-05-01T00:00:00Z')
        self.assertFalse(release.prerelease)
        self.assertTrue(release.pinned)

    def test_verified_release_from_boolean(self) -> None:
        card = {
            'id': 'q-12',
            'name': 'Port',
            'verified': True,
            'version': '0.9.0',
            'releasedAt': '2025-01-02T00:00:00Z',
        }
        release = self.adapter.adapt(card).verifiedRelease

        self.assertIsNotNone(release)
        self.assertEqual(release.version, '0.9.0')
        self.assertEqual(release.releasedAt, '2025-01-02T00:00:00Z')
        self.assertTrue(release.pinned)
        self.assertFalse(release.prerelease)

    def test_verified_release_absent(self) -> None:
        self.assertIsNone(self.adapter.adapt({'id': 'q-13', 'name': 'P'}).verifiedRelease)

    # -- otros mapeos ----------------------------------------------------
    def test_ai_level_and_launch(self) -> None:
        card = {
            'id': 'q-14',
            'name': 'Port',
            'aiLevel': 'assisted',
            'preferredExecutables': ['SoH.exe'],
        }
        port = self.adapter.adapt(card)
        self.assertEqual(port.aiLevel, 'assisted')
        self.assertEqual(port.launch.get('preferredExecutables'), ['SoH.exe'])

    def test_hidden_maps_to_visible(self) -> None:
        self.assertFalse(self.adapter.adapt({'id': 'q-15', 'name': 'P', 'hidden': True}).visible)
        self.assertTrue(self.adapter.adapt({'id': 'q-16', 'name': 'P', 'hidden': False}).visible)

    def test_mod_sources_and_unknown_raw(self) -> None:
        card = {
            'id': 'q-17',
            'name': 'Port',
            'modSources': [{'name': 'HD textures'}],
            'weirdField': {'x': 1},
        }
        port = self.adapter.adapt(card)
        self.assertEqual(port.modSupport, [{'name': 'HD textures'}])
        self.assertEqual(port.raw.get('weirdField'), {'x': 1})

    # -- fixture real ----------------------------------------------------
    @unittest.skipUnless(QUIVER_FIXTURE.exists(), 'fixtures/quiver/apps_unique.json no disponible')
    def test_real_fixture(self) -> None:
        with open(QUIVER_FIXTURE, 'r', encoding='utf-8') as handle:
            cards = json.load(handle)
        self.assertIsInstance(cards, list)
        self.assertGreater(len(cards), 100)

        ports = [self.adapter.adapt(card) for card in cards]
        self.assertEqual(len(ports), len(cards))

        for port in ports:
            self.assertTrue(port.pid)
            self.assertTrue(port.name)
            self.assertIn(port.sourcePlatform, SOURCE_VOCAB)
            self.assertEqual(port.sources[0].source, 'quiver')
            self.assertRegex(port.sources[0].externalId, r'.+')
            # Los SHA-1 aceptados siempre tienen 40 hex.
            for setup in port.setupFiles:
                for item in setup.get('accepted') or []:
                    self.assertRegex(item.get('sha1', ''), r'^[0-9a-f]{40}$')


if __name__ == '__main__':
    unittest.main(verbosity=2)
