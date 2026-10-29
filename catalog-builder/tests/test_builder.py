#!/usr/bin/env python3
"""Pruebas del orquestador ``builder`` (Fase 2).

Verifica:

* ejecución en modo ``--offline`` con fixtures locales;
* generación de ``data/ports.index.json`` y ``data/report.md``;
* estructura del índice (``version`` semver, ``schemaVersion``,
  ``semanticHash``, ``stats``, ``ports``);
* determinismo del hash semántico entre ejecuciones;
* exclusión de campos volátiles del hash semántico.
"""

from __future__ import annotations

import contextlib
import importlib
import io
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TEST_DIR = Path(__file__).resolve().parent
BUILDER_DIR = TEST_DIR.parent
PROJECT_ROOT = BUILDER_DIR.parent
for p in (str(PROJECT_ROOT), str(BUILDER_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

SEMVER_RE = re.compile(r'^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?$')
HASH_RE = re.compile(r'^sha256:[0-9a-f]{64}$')
VALID_SHA1 = 'a' * 40

REAL_GW_FIXTURE = PROJECT_ROOT / 'fixtures' / 'gamewave' / 'catalog.json'
REAL_QUIVER_FIXTURE = PROJECT_ROOT / 'fixtures' / 'quiver' / 'apps_unique.json'


def _import(name: str):
    try:
        return importlib.import_module(name)
    except ImportError:
        return importlib.import_module('catalog-builder.{}'.format(name))


builder = _import('builder')

GW_CATALOG = {
    'catalogVersion': '2026.10.24.3',
    'apps': [
        {
            'id': 'gw-1',
            'name': 'Ship of Harkinian · GameWave Build',
            'sourcePlatform': 'Nintendo 64',
            'platforms': ['Windows', 'Linux'],
            'enabled': True,
            'distribution': 'github',
            'repository': 'HarbourMasters/Shipwright',
            'folderName': 'Shipwright',
            'maturity': {'development': 'stable', 'maintenance': 'active'},
            'playerFeedback': {'reviewCount': 40, 'recommended': 36},
            'tags': ['n64'],
            'downloadUrl': 'https://evil.example/payload.zip',
            'quarantinedLinkFields': ['downloadUrl'],
        },
        {
            'id': 'gw-2',
            'name': 'Broken Port',
            'sourcePlatform': 'PlayStation',
            'platforms': ['Windows'],
            'enabled': False,
            'distribution': 'external',
            'availability': 'external-launcher',
        },
    ],
}

QUIVER_CATALOG = [
    {
        'id': 'q-1',
        'catalogId': 'gw-1',
        'slug': 'soh',
        'name': 'Ship of Harkinian',
        'projectName': 'Shipwright',
        'folderName': 'soh',
        'sourcePlatform': 'Nintendo 64',
        'platforms': ['Linux'],
        'setupFiles': [
            {'name': 'rom.z64', 'accepted': [{'sha1': VALID_SHA1}]},
        ],
        'playerFeedback': {'reviewCount': 60, 'recommended': 57},
        'verifiedRelease': {'version': '1.0.0', 'releasedAt': '2026-05-01T00:00:00Z'},
        'aiLevel': 'assisted',
    },
]


class TestBuilder(unittest.TestCase):
    """Orquestador y salidas del catálogo."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix='catalog-builder-test-'))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)

        self.gw_fixture = self.tmp / 'gw_catalog.json'
        self.quiver_fixture = self.tmp / 'quiver_apps.json'
        with open(self.gw_fixture, 'w', encoding='utf-8') as handle:
            json.dump(GW_CATALOG, handle, ensure_ascii=False)
        with open(self.quiver_fixture, 'w', encoding='utf-8') as handle:
            json.dump(QUIVER_CATALOG, handle, ensure_ascii=False)

        self.out_dir = self.tmp / 'data'

    # -- helpers ---------------------------------------------------------
    def run_builder(self, out_dir: Path) -> int:
        argv = [
            '--offline',
            '--out-dir', str(out_dir),
            '--gw-fixture', str(self.gw_fixture),
            '--quiver-fixture', str(self.quiver_fixture),
        ]
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            return builder.main(argv)

    def read_index(self, out_dir: Path) -> dict:
        with open(out_dir / 'ports.index.json', 'r', encoding='utf-8') as handle:
            return json.load(handle)

    # -- ejecución -------------------------------------------------------
    def test_offline_run_creates_outputs(self) -> None:
        code = self.run_builder(self.out_dir)

        self.assertEqual(code, 0)
        self.assertTrue((self.out_dir / 'ports.index.json').is_file())
        self.assertTrue((self.out_dir / 'report.md').is_file())

    def test_missing_fixture_returns_error_code(self) -> None:
        argv = [
            '--offline',
            '--out-dir', str(self.tmp / 'nope'),
            '--gw-fixture', str(self.tmp / 'no-existe.json'),
            '--quiver-fixture', str(self.quiver_fixture),
        ]
        stderr = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
            code = builder.main(argv)

        self.assertEqual(code, 2)
        self.assertIn('error', stderr.getvalue().lower())

    # -- estructura del índice -------------------------------------------
    def test_index_structure(self) -> None:
        self.assertEqual(self.run_builder(self.out_dir), 0)
        index = self.read_index(self.out_dir)

        self.assertEqual(
            set(index.keys()),
            {'version', 'schemaVersion', 'generatedAt', 'semanticHash', 'stats', 'ports'},
        )
        self.assertRegex(index['version'], SEMVER_RE)
        self.assertRegex(index['schemaVersion'], SEMVER_RE)
        self.assertRegex(index['semanticHash'], HASH_RE)
        self.assertIsInstance(index['stats'], dict)
        self.assertIsInstance(index['ports'], list)
        self.assertGreaterEqual(len(index['ports']), 1)

        for port in index['ports']:
            self.assertIsInstance(port, dict)
            self.assertIn('pid', port)
            self.assertIn('name', port)
            self.assertIn('sources', port)
            self.assertTrue(port['pid'])
            self.assertTrue(port['sources'])

    def test_stats_metrics(self) -> None:
        self.assertEqual(self.run_builder(self.out_dir), 0)
        stats = self.read_index(self.out_dir)['stats']

        self.assertEqual(stats['totalPorts'], 2)
        self.assertEqual(stats['fusedGamewaveQuiver'], 1)
        self.assertEqual(stats['gamewaveOnly'], 1)
        self.assertEqual(stats['quiverOnly'], 0)
        self.assertEqual(stats['invisible'], 1)          # gw-2 (enabled=false)
        self.assertEqual(stats['withSetupFiles'], 1)
        self.assertEqual(sum(stats['byStatusTag'].values()), stats['totalPorts'])
        self.assertEqual(sum(stats['bySourcePlatform'].values()), stats['totalPorts'])
        self.assertEqual(sum(stats['byInstallStrategy'].values()), stats['totalPorts'])

    def test_fused_port_keeps_both_sources(self) -> None:
        self.assertEqual(self.run_builder(self.out_dir), 0)
        ports = self.read_index(self.out_dir)['ports']

        fused = [
            port for port in ports
            if {ref['source'] for ref in port['sources']} == {'gamewave', 'quiver'}
        ]
        self.assertEqual(len(fused), 1)
        self.assertEqual(fused[0]['name'], 'Ship of Harkinian')
        self.assertEqual(fused[0]['sourcePlatform'], 'n64')
        self.assertEqual(fused[0]['requiresUserFiles']['es'], 'ROM original del juego')
        self.assertEqual(fused[0]['playerFeedback']['reviewCount'], 60)
        self.assertEqual(fused[0]['setupFiles'][0]['name'], 'rom.z64')
        self.assertEqual(fused[0]['romProfile']['binding'], 'place')

    def test_quarantined_links_not_leaked_to_index(self) -> None:
        self.assertEqual(self.run_builder(self.out_dir), 0)
        payload = (self.out_dir / 'ports.index.json').read_text(encoding='utf-8')
        self.assertNotIn('evil.example', payload)

    def test_status_assigned(self) -> None:
        self.assertEqual(self.run_builder(self.out_dir), 0)
        ports = self.read_index(self.out_dir)['ports']

        for port in ports:
            self.assertIsNotNone(port['status'])
            self.assertIn(port['status']['tag'], {'playable', 'bugs', 'wip',
                                                  'experimental', 'abandoned', 'nodata'})
            self.assertEqual(port['status']['ruleVersion'], '1.0.0')

    # -- informe ---------------------------------------------------------
    def test_report_markdown(self) -> None:
        self.assertEqual(self.run_builder(self.out_dir), 0)
        report = (self.out_dir / 'report.md').read_text(encoding='utf-8')
        index = self.read_index(self.out_dir)

        self.assertIn('# Catálogo unificado', report)
        self.assertIn('## Resumen', report)
        self.assertIn('| Métrica | Valor |', report)
        self.assertIn('status.tag', report)
        self.assertIn(index['semanticHash'], report)
        self.assertIn('installStrategy', report)
        self.assertIn('|', report)

    # -- determinismo ----------------------------------------------------
    def test_semantic_hash_deterministic_across_runs(self) -> None:
        first_dir = self.tmp / 'run-1'
        second_dir = self.tmp / 'run-2'

        self.assertEqual(self.run_builder(first_dir), 0)
        self.assertEqual(self.run_builder(second_dir), 0)

        first = self.read_index(first_dir)
        second = self.read_index(second_dir)

        self.assertEqual(first['semanticHash'], second['semanticHash'])
        self.assertEqual(len(first['ports']), len(second['ports']))
        self.assertEqual(first['stats']['totalPorts'], second['stats']['totalPorts'])
        self.assertEqual(
            [port['pid'] for port in first['ports']],
            [port['pid'] for port in second['ports']],
        )

    def test_semantic_hash_ignores_volatile_fields(self) -> None:
        ports_a, _ = builder.build_catalog(
            GW_CATALOG['apps'], QUIVER_CATALOG,
            catalog_version='2026.10.24.3', now='2026-01-01T00:00:00Z',
        )
        ports_b, _ = builder.build_catalog(
            GW_CATALOG['apps'], QUIVER_CATALOG,
            catalog_version='2026.10.24.3', now='2026-01-02T00:00:00Z',
        )

        self.assertEqual(len(ports_a), len(ports_b))
        self.assertEqual(
            builder.semantic_hash(ports_a), builder.semantic_hash(ports_b)
        )
        self.assertRegex(builder.semantic_hash(ports_a), HASH_RE)

    def test_semantic_hash_changes_with_content(self) -> None:
        ports_a, _ = builder.build_catalog(
            GW_CATALOG['apps'], QUIVER_CATALOG, now='2026-01-01T00:00:00Z'
        )
        modified = json.loads(json.dumps(GW_CATALOG['apps']))
        modified[1]['name'] = 'Otro nombre distinto'
        ports_b, _ = builder.build_catalog(
            modified, QUIVER_CATALOG, now='2026-01-01T00:00:00Z'
        )

        self.assertNotEqual(
            builder.semantic_hash(ports_a), builder.semantic_hash(ports_b)
        )

    # -- fixtures reales --------------------------------------------------
    @unittest.skipUnless(
        REAL_GW_FIXTURE.exists() and REAL_QUIVER_FIXTURE.exists(),
        'fixtures reales no disponibles',
    )
    def test_real_fixtures_offline(self) -> None:
        out_dir = self.tmp / 'real'
        argv = [
            '--offline',
            '--out-dir', str(out_dir),
            '--gw-fixture', str(REAL_GW_FIXTURE),
            '--quiver-fixture', str(REAL_QUIVER_FIXTURE),
        ]
        with contextlib.redirect_stdout(io.StringIO()):
            code = builder.main(argv)

        self.assertEqual(code, 0)
        index = self.read_index(out_dir)

        self.assertRegex(index['semanticHash'], HASH_RE)
        self.assertGreater(index['stats']['totalPorts'], 1000)
        self.assertGreater(index['stats']['fusedGamewaveQuiver'], 0)
        self.assertTrue((out_dir / 'report.md').is_file())


if __name__ == '__main__':
    unittest.main(verbosity=2)
