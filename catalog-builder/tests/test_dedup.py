#!/usr/bin/env python3
"""Pruebas del motor de deduplicación y consolidación (Fase 2).

Cubre:

* :func:`build_technical_key` (claves estables y discriminadores);
* repositorios multi-ficha (``spacestate1/namco22-decompile``) que **no** deben
  colapsarse;
* heurística de emparejamiento Quiver <-> GameWave;
* :func:`merge_ports` con las precedencias del contrato (E2-S3);
* :func:`generate_pid` (determinista y URL-friendly).
"""

from __future__ import annotations

import copy
import importlib
import re
import sys
import unittest
from pathlib import Path

TEST_DIR = Path(__file__).resolve().parent
BUILDER_DIR = TEST_DIR.parent
PROJECT_ROOT = BUILDER_DIR.parent
for p in (str(PROJECT_ROOT), str(BUILDER_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

NOW = '2026-01-01T00:00:00Z'
VALID_SHA1 = 'a' * 40
PID_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')


def _import(name: str):
    try:
        return importlib.import_module(name)
    except ImportError:
        return importlib.import_module('catalog-builder.{}'.format(name))


models = _import('models')
dedup = _import('dedup')

UnifiedPort = models.UnifiedPort
SourceRef = models.SourceRef
RomProfile = models.RomProfile
PlayerFeedback = models.PlayerFeedback

build_technical_key = dedup.build_technical_key
merge_ports = dedup.merge_ports
generate_pid = dedup.generate_pid
Deduplicator = dedup.Deduplicator


def gw_ref(external_id: str) -> SourceRef:
    return SourceRef(source='gamewave', externalId=str(external_id), lastSeen=NOW)


def qv_ref(external_id: str) -> SourceRef:
    return SourceRef(source='quiver', externalId=str(external_id), lastSeen=NOW)


# ---------------------------------------------------------------------------
# Clave técnica
# ---------------------------------------------------------------------------

class TestTechnicalKey(unittest.TestCase):
    """``build_technical_key`` debe ser estable y discriminante."""

    def test_same_repo_and_discriminator_equal(self) -> None:
        left = UnifiedPort(
            pid='a',
            name='Namco22 Time Crisis',
            repository='spacestate1/namco22-decompile',
            folderName='namco22-timecris',
        )
        right = UnifiedPort(
            pid='b',
            name='Namco22 Time Crisis',
            repository='SpaceState1/Namco22-Decompile',
            folderName='namco22-timecris',
        )
        self.assertEqual(
            build_technical_key(left),
            'github::spacestate1/namco22-decompile::namco22-timecris',
        )
        self.assertEqual(build_technical_key(left), build_technical_key(right))

    def test_different_discriminator_differs(self) -> None:
        tc1 = UnifiedPort(
            pid='a',
            name='Namco22 Time Crisis',
            repository='spacestate1/namco22-decompile',
            folderName='namco22-timecris',
        )
        tc2 = UnifiedPort(
            pid='b',
            name='Namco22 Time Crisis II',
            repository='spacestate1/namco22-decompile',
            folderName='namco22-tc2',
        )
        self.assertNotEqual(build_technical_key(tc1), build_technical_key(tc2))

    def test_release_asset_filter_wins_over_folder(self) -> None:
        port = UnifiedPort(
            pid='a',
            name='Port',
            repository='owner/repo',
            releaseAssetFilter='Port-Linux.AppImage',
            folderName='carpeta',
        )
        self.assertEqual(
            build_technical_key(port),
            'github::owner/repo::port-linux.appimage',
        )

    def test_repository_source_used(self) -> None:
        port = UnifiedPort(
            pid='a',
            name='Port',
            repository='owner/repo',
            repositorySource='gitlab',
            folderName='carpeta',
        )
        self.assertEqual(build_technical_key(port), 'gitlab::owner/repo::carpeta')

    def test_without_repository(self) -> None:
        port = UnifiedPort(
            pid='a',
            name='Some Port',
            distribution='external',
            sourcePlatform='snes',
            folderName='SomeFolder',
        )
        self.assertEqual(build_technical_key(port), 'external::snes::somefolder')


# ---------------------------------------------------------------------------
# Multi-ficha
# ---------------------------------------------------------------------------

class TestMultiRepository(unittest.TestCase):
    """Un repositorio con varias fichas no debe colapsarse."""

    FOLDERS = (
        'namco22-timecris',
        'namco22-tc2',
        'namco22-tc3',
        'namco22-tc4',
        'namco22-tc5',
    )

    def _ports(self):
        return [
            UnifiedPort(
                pid='p{}'.format(index),
                name='Namco22 {}'.format(folder),
                sourcePlatform='ps1',
                distribution='github',
                repository='spacestate1/namco22-decompile',
                folderName=folder,
                sources=[gw_ref(index)],
            )
            for index, folder in enumerate(self.FOLDERS)
        ]

    def test_keys_are_distinct(self) -> None:
        keys = {build_technical_key(port) for port in self._ports()}
        self.assertEqual(len(keys), 5)

    def test_deduplicator_keeps_all_five(self) -> None:
        engine = Deduplicator()
        result = engine.deduplicate(self._ports())

        self.assertEqual(len(result), 5)
        self.assertEqual(
            sorted(port.folderName for port in result), sorted(self.FOLDERS)
        )
        self.assertEqual(len({port.pid for port in result}), 5)
        self.assertEqual(engine.last_stats['technicalCollapsed'], 0)
        self.assertEqual(engine.last_stats['input'], 5)
        self.assertEqual(engine.last_stats['output'], 5)

    def test_identical_key_collapses(self) -> None:
        ports = self._ports()[:2]
        ports[1].folderName = ports[0].folderName
        ports[1].name = ports[0].name

        engine = Deduplicator()
        result = engine.deduplicate(ports)

        self.assertEqual(len(result), 1)
        self.assertEqual(engine.last_stats['technicalCollapsed'], 1)
        self.assertEqual(len(result[0].sources), 2)
        self.assertEqual(
            {ref.externalId for ref in result[0].sources}, {'0', '1'}
        )


# ---------------------------------------------------------------------------
# Fusión (E2-S3)
# ---------------------------------------------------------------------------

class TestMergePorts(unittest.TestCase):
    """Precedencias de ``merge_ports``."""

    def _gamewave(self) -> UnifiedPort:
        return UnifiedPort(
            pid='gw',
            name='Conker BFD Reloaded',
            sourcePlatform='n64',
            targetPlatforms=['windows', 'linux'],
            repository='DahSidiAbdallah/ConkerBFDReloaded',
            distribution='github',
            requiresUserFiles={'es': 'ROM de N64', 'en': 'N64 ROM'},
            setupFiles=[{'name': 'gw.zip', 'accepted': []}],
            playerFeedback=PlayerFeedback(recommended=0, reviewCount=1),
            tags=['n64', 'multiplayer'],
            gameNames=['Conker BFD Reloaded'],
            searchAliases=['conker'],
            installStrategy='external',
            sources=[gw_ref('gw-1')],
        )

    def _quiver(self) -> UnifiedPort:
        return UnifiedPort(
            pid='gw-1',
            name='Conker BFD',
            sourcePlatform='snes',
            targetPlatforms=['windows', 'android'],
            distribution='external',
            requiresUserFiles={'es': 'ROM original del juego', 'en': 'Original ROM'},
            setupFiles=[
                {
                    'name': 'conker.z64',
                    'destination': 'roms/n64/',
                    'accepted': [{'sha1': VALID_SHA1}],
                }
            ],
            romProfile=RomProfile(
                binding='place',
                destination='roms/n64/',
                accepted=[{'sha1': VALID_SHA1}],
            ),
            playerFeedback=PlayerFeedback(recommended=25, reviewCount=30),
            tags=['port'],
            gameNames=['Conker BFD'],
            searchAliases=['conker', 'bfd'],
            installStrategy='release-appimage',
            sources=[qv_ref('gw-1')],
        )

    def test_sources_preserved(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(len(merged.sources), 2)
        self.assertEqual(
            {ref.source for ref in merged.sources}, {'gamewave', 'quiver'}
        )

    def test_sources_order_independent(self) -> None:
        direct = merge_ports(self._gamewave(), self._quiver())
        reverse = merge_ports(self._quiver(), self._gamewave())
        self.assertEqual(
            {ref.source for ref in reverse.sources}, {'gamewave', 'quiver'}
        )
        self.assertEqual(reverse.sourcePlatform, direct.sourcePlatform)
        self.assertEqual(reverse.requiresUserFiles, direct.requiresUserFiles)
        self.assertEqual(reverse.setupFiles, direct.setupFiles)

    def test_source_platform_gamewave_wins(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(merged.sourcePlatform, 'n64')

    def test_source_platform_falls_back_when_other(self) -> None:
        gamewave = self._gamewave()
        gamewave.sourcePlatform = 'other'
        merged = merge_ports(gamewave, self._quiver())
        self.assertEqual(merged.sourcePlatform, 'snes')

    def test_requires_user_files_gamewave_wins(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(merged.requiresUserFiles['es'], 'ROM de N64')
        self.assertEqual(merged.requiresUserFiles['en'], 'N64 ROM')

    def test_setup_files_quiver_wins(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(len(merged.setupFiles), 1)
        self.assertEqual(merged.setupFiles[0]['name'], 'conker.z64')
        self.assertEqual(
            merged.setupFiles[0]['accepted'][0]['sha1'], VALID_SHA1
        )

    def test_player_feedback_quiver_wins(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(merged.playerFeedback.reviewCount, 30)
        self.assertEqual(merged.playerFeedback.recommended, 25)

    def test_target_platforms_union(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(merged.targetPlatforms, ['windows', 'linux', 'android'])
        self.assertEqual(len(merged.targetPlatforms), len(set(merged.targetPlatforms)))

    def test_lists_union_without_duplicates(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(merged.tags, ['n64', 'multiplayer', 'port'])
        self.assertEqual(merged.gameNames, ['Conker BFD Reloaded', 'Conker BFD'])
        self.assertEqual(merged.searchAliases, ['conker', 'bfd'])

    def test_rom_profile_binding_place_with_sha1(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(merged.romProfile.binding, 'place')
        self.assertEqual(merged.romProfile.destination, 'roms/n64/')
        self.assertIn(
            VALID_SHA1,
            [item.get('sha1') for item in merged.romProfile.accepted],
        )

    def test_install_strategy_most_specific(self) -> None:
        merged = merge_ports(self._gamewave(), self._quiver())
        self.assertEqual(merged.installStrategy, 'release-appimage')

    def test_quarantine_union(self) -> None:
        gamewave = self._gamewave()
        gamewave.quarantinedLinkFields = ['downloadUrl']
        quiver = self._quiver()
        quiver.quarantinedLinkFields = ['windowsUrl', 'downloadUrl']
        merged = merge_ports(gamewave, quiver)
        self.assertEqual(merged.quarantinedLinkFields, ['downloadUrl', 'windowsUrl'])


# ---------------------------------------------------------------------------
# Heurística Quiver <-> GameWave
# ---------------------------------------------------------------------------

class TestQuiverMatching(unittest.TestCase):
    """Emparejamiento por repository / folderName / projectName / nombre."""

    def _gamewave_conker(self) -> UnifiedPort:
        return UnifiedPort(
            pid='gw-1',
            name='Conker BFD Reloaded',
            sourcePlatform='n64',
            distribution='github',
            repository='DahSidiAbdallah/ConkerBFDReloaded',
            folderName='ConkerBFDReloaded',
            sources=[gw_ref('gw-1')],
        )

    def test_match_by_project_name(self) -> None:
        quiver = UnifiedPort(
            pid='q-1',
            name='Conker BFD',
            sourcePlatform='n64',
            folderName='conker-bfd',
            raw={'projectName': 'ConkerBFDReloaded'},
            sources=[qv_ref('q-1')],
        )
        result = Deduplicator().deduplicate([self._gamewave_conker(), quiver])

        self.assertEqual(len(result), 1)
        self.assertEqual(
            {ref.source for ref in result[0].sources}, {'gamewave', 'quiver'}
        )
        self.assertEqual(result[0].name, 'Conker BFD Reloaded')

    def test_match_by_repository(self) -> None:
        quiver = UnifiedPort(
            pid='q-2',
            name='Otro nombre',
            repository='DahSidiAbdallah/ConkerBFDReloaded',
            sources=[qv_ref('q-2')],
        )
        result = Deduplicator().deduplicate([self._gamewave_conker(), quiver])
        self.assertEqual(len(result), 1)

    def test_match_by_folder_name(self) -> None:
        quiver = UnifiedPort(
            pid='q-3',
            name='Nombre distinto',
            folderName='ConkerBFDReloaded',
            sources=[qv_ref('q-3')],
        )
        result = Deduplicator().deduplicate([self._gamewave_conker(), quiver])
        self.assertEqual(len(result), 1)

    def test_different_repositories_not_merged(self) -> None:
        gamewave = self._gamewave_conker()
        quiver = UnifiedPort(
            pid='q-4',
            name='Conker BFD Reloaded',
            repository='otroOwner/otroRepo',
            folderName='conker-bfd-reloaded',
            sources=[qv_ref('q-4')],
        )
        result = Deduplicator().deduplicate([gamewave, quiver])
        self.assertEqual(len(result), 2)

    def test_matching_can_be_disabled(self) -> None:
        quiver = UnifiedPort(
            pid='q-5',
            name='Conker BFD',
            raw={'projectName': 'ConkerBFDReloaded'},
            sources=[qv_ref('q-5')],
        )
        result = Deduplicator(enable_quiver_matching=False).deduplicate(
            [self._gamewave_conker(), quiver]
        )
        self.assertEqual(len(result), 2)


# ---------------------------------------------------------------------------
# pid determinista
# ---------------------------------------------------------------------------

class TestGeneratePid(unittest.TestCase):
    """``generate_pid`` debe ser determinista, limpio y URL-friendly."""

    def test_with_repository(self) -> None:
        port = UnifiedPort(
            pid='',
            name='Ship of Harkinian',
            repository='HarbourMasters/Shipwright',
            folderName='Shipwright',
        )
        self.assertEqual(
            generate_pid(port), 'harbourmasters-shipwright-shipwright'
        )

    def test_without_repository(self) -> None:
        port = UnifiedPort(
            pid='', name='Some Port', project='DahSidi Abdallah'
        )
        self.assertEqual(generate_pid(port), 'some-port-dahsidi-abdallah')

    def test_without_project_uses_source_platform(self) -> None:
        port = UnifiedPort(pid='', name='Some Port', sourcePlatform='snes')
        self.assertEqual(generate_pid(port), 'some-port-snes')

    def test_url_friendly(self) -> None:
        samples = [
            UnifiedPort(
                pid='',
                name='Pokémon™ Legends: Arceus (Port)',
                repository='Owner Name/Repo.Name',
                folderName='Repo.Name v2!',
            ),
            UnifiedPort(pid='', name='Juego Ñandú — Edición 2026'),
            UnifiedPort(pid='', name='@@@'),
        ]
        for port in samples:
            pid = generate_pid(port)
            self.assertTrue(pid)
            self.assertRegex(pid, PID_RE)
            self.assertEqual(pid, pid.lower())

    def test_deterministic_and_stable(self) -> None:
        port = UnifiedPort(
            pid='x',
            name='Conker BFD Reloaded',
            repository='DahSidiAbdallah/ConkerBFDReloaded',
            folderName='ConkerBFDReloaded',
        )
        first = generate_pid(port)
        second = generate_pid(copy.deepcopy(port))
        self.assertEqual(first, second)
        self.assertEqual(first, generate_pid(port))

    def test_deduplicator_assigns_unique_pids(self) -> None:
        ports = [
            UnifiedPort(
                pid='',
                name='Mismo Nombre',
                distribution='external',
                sourcePlatform='other',
                folderName='mismo',
                sources=[qv_ref('a')],
            ),
            UnifiedPort(
                pid='',
                name='Mismo Nombre',
                distribution='external',
                sourcePlatform='other',
                folderName='mismo-2',
                sources=[qv_ref('b')],
            ),
        ]
        engine = Deduplicator()
        result = engine.deduplicate(ports)

        self.assertEqual(len(result), 2)
        pids = [port.pid for port in result]
        self.assertEqual(len(set(pids)), 2)
        for pid in pids:
            self.assertRegex(pid, PID_RE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
