#!/usr/bin/env python3
"""Pruebas del motor de estado (Fase 2 - Anexo F).

Se verifica, regla por regla y en orden estricto:

======  ==============================================  =============
Regla   Condición                                        ``tag``
======  ==============================================  =============
R1      Sin señales utilizables                          ``nodata``
R2      Archivado o último cambio > 547 días             ``abandoned``
R3      Experimental / sólo prereleases                  ``experimental``
R4      ``wip`` / canal alpha-beta / in-development      ``wip``
R5      reviews >= 5 con < 70% recomendado o bugs >= 5   ``bugs``
R6      En otro caso                                    ``playable``
======  ==============================================  =============

Además se comprueba la confianza (``alta``/``media``/``baja``) y que
``reasons[]`` incluya la explicación de la regla ganadora.
"""

from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path

TEST_DIR = Path(__file__).resolve().parent
BUILDER_DIR = TEST_DIR.parent
PROJECT_ROOT = BUILDER_DIR.parent
for p in (str(PROJECT_ROOT), str(BUILDER_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

NOW = '2026-06-01T00:00:00Z'
RECENT = '2026-05-20T00:00:00Z'
OLD = '2024-01-01T00:00:00Z'          # > 547 días antes de NOW
SLIGHTLY_OLD = '2026-03-01T00:00:00Z'  # ~92 días: stale para la confianza


def _import(name: str):
    try:
        return importlib.import_module(name)
    except ImportError:
        return importlib.import_module('catalog-builder.{}'.format(name))


models = _import('models')
status = _import('status')

UnifiedPort = models.UnifiedPort
SourceRef = models.SourceRef
PlayerFeedback = models.PlayerFeedback
VerifiedRelease = models.VerifiedRelease
StatusEvaluator = status.StatusEvaluator
REASON_TEXTS = status.REASON_TEXTS


def make_port(pid: str = 'p', **kwargs) -> UnifiedPort:
    kwargs.setdefault('name', pid)
    return UnifiedPort(pid=pid, **kwargs)


class TestStatusEvaluator(unittest.TestCase):
    """Las seis reglas del Anexo F, en orden estricto."""

    def setUp(self) -> None:
        self.evaluator = StatusEvaluator()

    def evaluate(self, port: UnifiedPort):
        return self.evaluator.evaluate(port, now_iso=NOW)

    # -- R1: nodata ------------------------------------------------------
    def test_rule1_nodata_without_signals(self) -> None:
        info = self.evaluate(make_port('r1'))

        self.assertEqual(info.tag, 'nodata')
        self.assertEqual(info.reasons[0], REASON_TEXTS['nodata'])
        self.assertEqual(info.confidence, 'baja')
        self.assertEqual(info.development, 'unknown')
        self.assertEqual(info.ruleVersion, '1.0.0')
        self.assertEqual(info.computedAt, NOW)

    def test_rule1_ignores_unknown_literals(self) -> None:
        port = make_port(
            'r1b',
            maturity={'development': 'unknown', 'maintenance': 'n/a'},
            raw={'verdict': 'unknown'},
        )
        self.assertEqual(self.evaluate(port).tag, 'nodata')

    # -- R2: abandoned ---------------------------------------------------
    def test_rule2_archived(self) -> None:
        port = make_port('r2', maturity={'development': 'stable', 'maintenance': 'archived'})
        info = self.evaluate(port)

        self.assertEqual(info.tag, 'abandoned')
        self.assertEqual(info.reasons[0], REASON_TEXTS['abandoned'])
        self.assertEqual(info.maintenance, 'archived')

    def test_rule2_archived_flag(self) -> None:
        port = make_port('r2b', raw={'archived': True, 'development': 'stable'})
        self.assertEqual(self.evaluate(port).tag, 'abandoned')

    def test_rule2_stale_last_commit(self) -> None:
        port = make_port(
            'r2c',
            maturity={'development': 'stable', 'maintenance': 'active'},
            raw={'lastCommit': OLD},
        )
        info = self.evaluate(port)

        self.assertEqual(info.tag, 'abandoned')
        self.assertTrue(any('547' in reason for reason in info.reasons))

    def test_rule2_boundary_recent_commit_not_abandoned(self) -> None:
        port = make_port(
            'r2d',
            maturity={'development': 'stable', 'maintenance': 'active'},
            raw={'lastCommit': RECENT},
            playerFeedback=PlayerFeedback(recommended=9, reviewCount=10),
        )
        self.assertEqual(self.evaluate(port).tag, 'playable')

    def test_rule2_wins_over_rule3(self) -> None:
        port = make_port(
            'r2e',
            maturity={'development': 'experimental', 'maintenance': 'archived'},
        )
        self.assertEqual(self.evaluate(port).tag, 'abandoned')

    # -- R3: experimental ------------------------------------------------
    def test_rule3_development_experimental(self) -> None:
        port = make_port('r3', maturity={'development': 'experimental'})
        info = self.evaluate(port)

        self.assertEqual(info.tag, 'experimental')
        self.assertEqual(info.reasons[0], REASON_TEXTS['experimental'])

    def test_rule3_is_experimental_flag(self) -> None:
        port = make_port('r3b', raw={'isExperimental': True, 'development': 'stable'})
        self.assertEqual(self.evaluate(port).tag, 'experimental')

    def test_rule3_release_channel_experimental(self) -> None:
        port = make_port('r3c', raw={'releaseChannel': 'experimental', 'development': 'stable'})
        self.assertEqual(self.evaluate(port).tag, 'experimental')

    def test_rule3_prerelease_only(self) -> None:
        port = make_port(
            'r3d',
            raw={
                'development': 'stable',
                'releases': [{'version': '0.1.0', 'prerelease': True},
                             {'version': '0.2.0', 'prerelease': True}],
            },
        )
        self.assertEqual(self.evaluate(port).tag, 'experimental')

    def test_rule3_prerelease_and_stable_release_is_not_experimental(self) -> None:
        port = make_port(
            'r3e',
            raw={
                'development': 'stable',
                'releases': [{'version': '1.0.0', 'prerelease': False},
                             {'version': '1.1.0-beta', 'prerelease': True}],
            },
            playerFeedback=PlayerFeedback(recommended=20, reviewCount=20),
        )
        self.assertEqual(self.evaluate(port).tag, 'playable')

    def test_rule3_wins_over_rule4(self) -> None:
        port = make_port(
            'r3f',
            maturity={'development': 'experimental', 'releaseChannel': 'beta'},
        )
        self.assertEqual(self.evaluate(port).tag, 'experimental')

    # -- R4: wip ---------------------------------------------------------
    def test_rule4_development_wip(self) -> None:
        port = make_port('r4', maturity={'development': 'wip'})
        info = self.evaluate(port)

        self.assertEqual(info.tag, 'wip')
        self.assertEqual(info.reasons[0], REASON_TEXTS['wip'])

    def test_rule4_release_channel_beta(self) -> None:
        port = make_port('r4b', raw={'development': 'stable', 'releaseChannel': 'beta'})
        self.assertEqual(self.evaluate(port).tag, 'wip')

    def test_rule4_release_channel_alpha(self) -> None:
        port = make_port('r4c', raw={'releaseChannel': 'alpha'})
        self.assertEqual(self.evaluate(port).tag, 'wip')

    def test_rule4_availability_in_development(self) -> None:
        port = make_port('r4d', raw={'availability': 'in-development'})
        self.assertEqual(self.evaluate(port).tag, 'wip')

    def test_rule4_wins_over_rule5(self) -> None:
        port = make_port(
            'r4e',
            maturity={'development': 'wip'},
            playerFeedback=PlayerFeedback(recommended=1, reviewCount=20),
        )
        self.assertEqual(self.evaluate(port).tag, 'wip')

    # -- R5: bugs --------------------------------------------------------
    def test_rule5_low_recommended_ratio(self) -> None:
        port = make_port(
            'r5',
            maturity={'development': 'stable'},
            playerFeedback=PlayerFeedback(recommended=5, reviewCount=10),
        )
        info = self.evaluate(port)

        self.assertEqual(info.tag, 'bugs')
        self.assertIn('50% recomendado', info.reasons[0])
        self.assertEqual(info.community.reviews, 10)
        self.assertAlmostEqual(info.community.recommended, 0.5, places=4)

    def test_rule5_many_bug_reports(self) -> None:
        port = make_port(
            'r5b',
            playerFeedback=PlayerFeedback(
                recommended=2, reviewCount=2, reportIssues=3, reportBroken=2
            ),
        )
        info = self.evaluate(port)

        self.assertEqual(info.tag, 'bugs')
        self.assertEqual(info.community.bugReports, 5)

    def test_rule5_explicit_bug_reports(self) -> None:
        port = make_port('r5c', raw={'bugReports': 7, 'development': 'stable'})
        self.assertEqual(self.evaluate(port).tag, 'bugs')

    def test_rule5_requires_minimum_reviews(self) -> None:
        # 4 reviews con 0% recomendado NO dispara R5 (reviews < 5).
        port = make_port(
            'r5d',
            playerFeedback=PlayerFeedback(recommended=0, reviewCount=4),
        )
        self.assertEqual(self.evaluate(port).tag, 'playable')

    # -- R6: playable ----------------------------------------------------
    def test_rule6_playable(self) -> None:
        port = make_port(
            'r6',
            maturity={'development': 'stable', 'maintenance': 'active'},
            playerFeedback=PlayerFeedback(recommended=46, reviewCount=50),
            verifiedRelease=VerifiedRelease(version='1.0.0', releasedAt=RECENT),
        )
        info = self.evaluate(port)

        self.assertEqual(info.tag, 'playable')
        self.assertEqual(info.reasons[0], REASON_TEXTS['playable'])
        self.assertTrue(any('reviews' in reason for reason in info.reasons))

    def test_rule6_ratio_boundary(self) -> None:
        # 70% justo: no dispara R5.
        port = make_port(
            'r6b', playerFeedback=PlayerFeedback(recommended=7, reviewCount=10)
        )
        self.assertEqual(self.evaluate(port).tag, 'playable')

    # -- confianza -------------------------------------------------------
    def test_confidence_alta(self) -> None:
        port = make_port(
            'c1',
            playerFeedback=PlayerFeedback(recommended=28, reviewCount=30),
            sources=[SourceRef(source='gamewave', externalId='c1', lastSeen=RECENT)],
        )
        self.assertEqual(self.evaluate(port).confidence, 'alta')

    def test_confidence_media(self) -> None:
        port = make_port(
            'c2',
            playerFeedback=PlayerFeedback(recommended=8, reviewCount=10),
            sources=[SourceRef(source='gamewave', externalId='c2', lastSeen=RECENT)],
        )
        self.assertEqual(self.evaluate(port).confidence, 'media')

    def test_confidence_media_with_verified_release(self) -> None:
        port = make_port(
            'c3',
            verifiedRelease=VerifiedRelease(version='1.0.0', releasedAt=RECENT),
            sources=[SourceRef(source='gamewave', externalId='c3', lastSeen=RECENT)],
        )
        self.assertEqual(self.evaluate(port).confidence, 'media')

    def test_confidence_baja_few_reviews(self) -> None:
        port = make_port(
            'c4',
            playerFeedback=PlayerFeedback(recommended=1, reviewCount=2),
            sources=[SourceRef(source='gamewave', externalId='c4', lastSeen=RECENT)],
        )
        self.assertEqual(self.evaluate(port).confidence, 'baja')

    def test_confidence_baja_stale(self) -> None:
        port = make_port(
            'c5',
            maturity={'development': 'stable', 'maintenance': 'active'},
            playerFeedback=PlayerFeedback(recommended=35, reviewCount=40),
            sources=[SourceRef(source='gamewave', externalId='c5', lastSeen=SLIGHTLY_OLD)],
        )
        info = self.evaluate(port)
        self.assertEqual(info.tag, 'playable')
        self.assertEqual(info.confidence, 'baja')

    # -- contrato del StatusInfo -----------------------------------------
    def test_status_info_contract(self) -> None:
        info = self.evaluate(make_port('r6c',
                                       maturity={'development': 'stable',
                                                 'maintenance': 'active'},
                                       playerFeedback=PlayerFeedback(recommended=9,
                                                                     reviewCount=10)))
        self.assertIsInstance(info, models.StatusInfo)
        self.assertEqual(info.ruleVersion, '1.0.0')
        self.assertEqual(info.computedAt, NOW)
        self.assertTrue(info.reasons)
        self.assertTrue(all(isinstance(reason, str) and reason for reason in info.reasons))
        self.assertIsInstance(info.community, models.StatusCommunity)
        self.assertIn(info.tag, models.StatusTag.values())

    def test_evaluate_many_assigns_status(self) -> None:
        ports = [make_port('m1'), make_port('m2', maturity={'development': 'wip'})]
        infos = self.evaluator.evaluate_many(ports, now_iso=NOW)

        self.assertEqual(len(infos), 2)
        self.assertEqual([info.tag for info in infos], ['nodata', 'wip'])
        self.assertIs(ports[0].status, infos[0])
        self.assertIs(ports[1].status, infos[1])


if __name__ == '__main__':
    unittest.main(verbosity=2)
