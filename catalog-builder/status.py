#!/usr/bin/env python3
"""Motor de estado de desarrollo de una ficha (Fase 2 - Anexo F).

Implementa las **6 reglas del Anexo F en orden estricto**: la primera regla que
se cumple gana.

======  ===========================================================  =============
Regla   Condición                                                    ``tag``
======  ===========================================================  =============
R1      Sin ninguna señal utilizable                                  ``nodata``
R2      ``maintenance == 'archived'`` o último cambio > 547 días      ``abandoned``
R3      ``development == 'experimental'``, ``isExperimental``,       ``experimental``
        ``releaseChannel == 'experimental'`` o sólo prereleases
R4      ``development == 'wip'``, canal alpha/beta/wip o             ``wip``
        ``availability == 'in-development'``
R5      ``reviews >= 5`` con ``recommended_ratio < 0.70`` o           ``bugs``
        ``bugReports >= 5``
R6      En otro caso                                                 ``playable``
======  ===========================================================  =============

Además calcula la **confianza** del veredicto:

* ``alta``  : ``reviews >= 30`` y datos recientes (≤ 30 días).
* ``media`` : ``reviews`` entre 5 y 29, o release verificada.
* ``baja``  : ``reviews < 5`` o datos de origen *stale* (> 30 días).

Las señales se recogen de forma defensiva desde ``maturity``, ``verification``,
``launch``, ``verifiedRelease``, ``playerFeedback``, ``status`` previo y
``raw`` (búsqueda de claves insensible a mayúsculas y anidada), de modo que el
motor funciona igual con fichas GameWave, Quiver o ya consolidadas.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:  # import como paquete (catalog-builder.status)
    from .models import (  # type: ignore[import-not-found]
        StatusCommunity,
        StatusInfo,
        StatusTag,
        UnifiedPort,
        as_bool,
        as_dict,
        as_float,
        as_int,
        as_list,
        as_str,
    )
except (ImportError, ValueError):  # import directo (catalog-builder en sys.path)
    from models import (  # type: ignore[no-redef]
        StatusCommunity,
        StatusInfo,
        StatusTag,
        UnifiedPort,
        as_bool,
        as_dict,
        as_float,
        as_int,
        as_list,
        as_str,
    )

__all__ = ['StatusEvaluator', 'evaluate_all', 'now_iso', 'REASON_TEXTS']

#: Textos exactos exigidos por el Anexo F.
REASON_TEXTS: Dict[str, str] = {
    'nodata': 'Sin datos suficientes para determinar el estado de desarrollo.',
    'abandoned': 'Archivado o sin cambios en más de 18 meses.',
    'experimental': 'Proyecto declarado experimental o sólo dispone de versiones preliminares.',
    'wip': 'El proyecto indica que sigue en desarrollo activo.',
    'playable': 'Versión publicada y comunidad conforme.',
}

#: Umbrales del Anexo F.
ABANDONED_DAYS = 547          # 18 meses
STALE_DAYS = 30               # datos de origen obsoletos
MIN_REVIEWS_BUGS = 5
MIN_RECOMMENDED_RATIO = 0.70
MIN_BUG_REPORTS = 5
CONFIDENCE_HIGH_REVIEWS = 30
CONFIDENCE_MEDIUM_REVIEWS = 5

#: Valores de ``development``/``maintenance`` que no aportan información.
_UNKNOWN_VALUES = frozenset({
    '', 'unknown', 'nd', 'n/a', 'na', 'none', 'null', 'other', '?', '-',
})

#: Claves candidatas (ya normalizadas) para cada señal.
_KEY_DEVELOPMENT = (
    'development', 'developmentstatus', 'devstage', 'devstatus', 'stage',
    'phase', 'projectstage', 'state',
)
_KEY_MAINTENANCE = (
    'maintenance', 'maintenancestatus', 'maintenancestate', 'activity',
    'activitystatus', 'maintained',
)
_KEY_EXPERIMENTAL = (
    'isexperimental', 'experimental', 'flagsexperimental', 'isexperimentalbuild',
)
_KEY_CHANNEL = (
    'releasechannel', 'channel', 'releasetrack', 'track', 'releasetype',
    'versionchannel',
)
_KEY_AVAILABILITY = (
    'availability', 'releasestatus', 'availabilitystatus', 'distributionstatus',
    'statuslabel',
)
_KEY_ARCHIVED = ('archived', 'isarchived', 'repositoryarchived', 'repoarchived')
_KEY_RELEASES = ('releases', 'versions', 'releasehistory', 'builds')
_KEY_LAST_CHANGE = (
    'lastchange', 'lastchanged', 'lastcommit', 'lastcommitat', 'lastcommitdate',
    'lastupdate', 'lastupdated', 'updatedat', 'pushedat', 'lastactivity',
    'lastactivityat', 'modifiedat', 'lastmodified', 'lastreleaseat',
    'lastrelease', 'releasedat', 'updated',
)
_KEY_REVIEWS = (
    'reviews', 'reviewcount', 'reviews_count', 'ratings', 'ratingcount',
    'votes', 'votecount', 'totalreviews',
)
_KEY_RECOMMENDED = (
    'recommended', 'recommendedcount', 'recommendations', 'upvotes',
    'positivevotes', 'likes',
)
_KEY_BUGS = (
    'bugreports', 'openbugs', 'bugs', 'brokenreports', 'reportbroken',
    'reportissues', 'issuereports',
)
_KEY_VERDICT = ('verdict', 'communityverdict', 'sentiment')


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def now_iso() -> str:
    """Marca temporal UTC ISO-8601 (segundos, sufijo ``Z``)."""

    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace('+00:00', 'Z')
    )


def _norm_key(value: Any) -> str:
    """Normaliza una clave de diccionario (minúsculas, sólo alfanuméricos)."""

    text = as_str(value)
    if not text:
        return ''
    return ''.join(ch for ch in text.lower() if ch.isalnum())


def _looks_unknown(value: Optional[str]) -> bool:
    if value is None:
        return True
    return value.strip().lower() in _UNKNOWN_VALUES


def _parse_datetime(value: Any) -> Optional[datetime]:
    """Interpreta fechas ISO-8601, ``YYYY-MM-DD`` o epoch (s/ms)."""

    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        number = float(value)
        if number > 1e11:  # milisegundos
            number /= 1000.0
        try:
            return datetime.fromtimestamp(number, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    text = as_str(value)
    if not text:
        return None
    candidate = text.strip()
    if candidate.endswith('Z'):
        candidate = candidate[:-1] + '+00:00'
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        for pattern in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y/%m/%d', '%d/%m/%Y'):
            try:
                parsed = datetime.strptime(candidate, pattern)
                break
            except ValueError:
                continue
        else:
            parsed = None  # type: ignore[assignment]
    if parsed is None:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _flatten_signals(sources: Iterable[Any]) -> Dict[str, Any]:
    """Aplana diccionarios anidados en ``{clave_normalizada: valor}``.

    El primer valor encontrado para una clave gana (las fuentes de mayor
    prioridad se pasan primero).
    """

    flat: Dict[str, Any] = {}

    def walk(value: Any, depth: int = 0) -> None:
        if depth > 4:
            return
        if isinstance(value, dict):
            for key, item in value.items():
                norm = _norm_key(key)
                if norm and norm not in flat and not isinstance(item, (dict, list)):
                    flat[norm] = item
                walk(item, depth + 1)
        elif isinstance(value, (list, tuple)):
            for item in list(value)[:50]:
                walk(item, depth + 1)

    for source in sources:
        if source is not None:
            walk(source)
    return flat


def _pick(flat: Dict[str, Any], keys: Sequence[str]) -> Any:
    for key in keys:
        if key in flat and flat[key] is not None:
            return flat[key]
    return None


def _ratio(recommended: Any, reviews: int, is_ratio: bool = False) -> float:
    """``recommended / reviews`` normalizado a ``[0, 1]``.

    * ``is_ratio``: el origen ya expresa una fracción (0..1).
    * Si el valor excede el número de reviews se interpreta como porcentaje.
    """

    value = as_float(recommended, 0.0)
    if value <= 0.0:
        return 0.0
    if is_ratio:
        return max(0.0, min(1.0, value))
    if reviews <= 0:
        return max(0.0, min(1.0, value / 100.0)) if value > 1.0 else max(0.0, min(1.0, value))
    if value > reviews:
        return max(0.0, min(1.0, value / 100.0))
    return max(0.0, min(1.0, value / float(reviews)))


# ---------------------------------------------------------------------------
# Señales extraídas de la ficha
# ---------------------------------------------------------------------------

@dataclass
class _Signals:
    development: Optional[str] = None
    maintenance: Optional[str] = None
    is_experimental: bool = False
    release_channel: Optional[str] = None
    availability: Optional[str] = None
    archived: bool = False
    prerelease_only: bool = False
    release_count: int = 0
    last_change: Optional[datetime] = None
    reviews: int = 0
    recommended_raw: float = 0.0
    recommended_is_ratio: bool = False
    bug_reports: int = 0
    verdict: Optional[str] = None
    has_verified_release: bool = False
    reviews_by_user: bool = False
    extra: Dict[str, Any] = field(default_factory=dict)

    #: Señales "duras" que impiden declarar ``nodata``.
    @property
    def has_signal(self) -> bool:
        return any((
            not _looks_unknown(self.development),
            not _looks_unknown(self.maintenance),
            self.archived,
            self.is_experimental,
            not _looks_unknown(self.release_channel),
            not _looks_unknown(self.availability),
            self.release_count > 0,
            self.last_change is not None,
            self.reviews > 0,
            self.bug_reports > 0,
            bool(as_str(self.verdict)),
            self.has_verified_release,
        ))


def _collect_signals(port: UnifiedPort) -> _Signals:
    """Extrae las señales del Anexo F desde todas las capas de la ficha."""

    previous_status = port.status if isinstance(port.status, StatusInfo) else None
    maturity = port.maturity
    if isinstance(maturity, str):
        maturity = {'development': maturity}

    flat = _flatten_signals([
        maturity,
        port.verification,
        port.launch,
        port.raw,
        as_dict(port.gameRef),
        as_dict(port.linux),
        as_dict(port.android),
        as_dict(previous_status.community) if previous_status is not None else None,
    ])

    signals = _Signals()

    development = as_str(_pick(flat, _KEY_DEVELOPMENT))
    if _looks_unknown(development) and previous_status is not None:
        development = as_str(previous_status.development)
    signals.development = None if _looks_unknown(development) else development

    maintenance = as_str(_pick(flat, _KEY_MAINTENANCE))
    if _looks_unknown(maintenance) and previous_status is not None:
        maintenance = as_str(previous_status.maintenance)
    signals.maintenance = None if _looks_unknown(maintenance) else maintenance

    signals.archived = as_bool(_pick(flat, _KEY_ARCHIVED), False) or (
        (signals.maintenance or '').strip().lower() in ('archived', 'unmaintained', 'abandoned')
    )
    signals.is_experimental = as_bool(_pick(flat, _KEY_EXPERIMENTAL), False) or (
        (signals.development or '').strip().lower() == 'experimental'
    )
    signals.release_channel = as_str(_pick(flat, _KEY_CHANNEL))
    signals.availability = as_str(_pick(flat, _KEY_AVAILABILITY))

    releases = as_list(_pick(flat, _KEY_RELEASES))
    if not releases and isinstance(port.raw, dict):
        # Las listas se pierden al aplanar (sólo se guardan escalares), por lo
        # que se consultan directamente en ``raw`` para detectar prereleases.
        for _key in ('releases', 'versions', 'releaseHistory', 'builds'):
            candidate = port.raw.get(_key)
            if isinstance(candidate, list) and candidate:
                releases = list(candidate)
                break
    release_dicts = [item for item in releases if isinstance(item, dict)]
    signals.release_count = len(releases)
    if release_dicts:
        flags = [as_bool(item.get('prerelease') or item.get('preRelease') or item.get('pre'), False)
                 for item in release_dicts]
        signals.prerelease_only = bool(flags) and all(flags)
    if not signals.release_count and isinstance(port.raw, dict):
        tag_name = port.raw.get('latestRelease') or port.raw.get('release')
        if isinstance(tag_name, dict):
            signals.release_count = 1
            signals.prerelease_only = as_bool(
                tag_name.get('prerelease') or tag_name.get('preRelease'), False
            )

    last_change = _parse_datetime(_pick(flat, _KEY_LAST_CHANGE))
    if last_change is None and port.verifiedRelease is not None:
        last_change = _parse_datetime(port.verifiedRelease.releasedAt)
    signals.last_change = last_change

    feedback = port.playerFeedback
    flat_reviews = as_int(_pick(flat, _KEY_REVIEWS), 0)
    flat_recommended = _pick(flat, _KEY_RECOMMENDED)
    reviews = max(0, flat_reviews)
    recommended = as_float(flat_recommended, 0.0)
    if isinstance(flat_recommended, float) and 0.0 < recommended <= 1.0:
        signals.recommended_is_ratio = True
    if feedback is not None:
        feedback_reviews = as_int(feedback.reviewCount, 0)
        feedback_recommended = as_float(feedback.recommended, 0.0)
        if feedback_reviews > 0:
            reviews = feedback_reviews
            recommended = feedback_recommended
            signals.recommended_is_ratio = False
            signals.reviews_by_user = True
        elif feedback_recommended > 0.0:
            recommended = feedback_recommended
            signals.recommended_is_ratio = False
            signals.reviews_by_user = True
    signals.reviews = max(0, reviews)
    signals.recommended_raw = max(0.0, recommended)

    bugs = as_int(_pick(flat, _KEY_BUGS), 0)
    if feedback is not None:
        reported = as_int(feedback.reportIssues, 0) + as_int(feedback.reportBroken, 0)
        bugs = max(bugs, reported)
    signals.bug_reports = max(0, bugs)

    verdict = as_str(_pick(flat, _KEY_VERDICT))
    if _looks_unknown(verdict) and previous_status is not None and previous_status.community is not None:
        verdict = as_str(previous_status.community.verdict)
    signals.verdict = None if _looks_unknown(verdict) else verdict

    signals.has_verified_release = port.verifiedRelease is not None and (
        bool(as_str(port.verifiedRelease.version)) or bool(as_str(port.verifiedRelease.releasedAt))
    )
    if not signals.has_verified_release:
        signals.has_verified_release = as_bool(
            as_dict(port.verification).get('verified'), False
        )
    return signals


def _project_age_days(signals: _Signals, now: datetime) -> Optional[float]:
    """Días desde el último cambio real del proyecto (R2), si se conoce."""

    if signals.last_change is None:
        return None
    delta = (now - signals.last_change).total_seconds() / 86400.0
    return max(0.0, delta)


def _data_age_days(port: UnifiedPort, signals: _Signals, now: datetime) -> Optional[float]:
    """Antigüedad (días) del dato más reciente conocido."""

    candidates: List[datetime] = []
    if signals.last_change is not None:
        candidates.append(signals.last_change)
    for ref in as_list(port.sources):
        parsed = _parse_datetime(getattr(ref, 'lastSeen', None))
        if parsed is not None:
            candidates.append(parsed)
    if port.status is not None:
        parsed = _parse_datetime(getattr(port.status, 'computedAt', None))
        if parsed is not None:
            candidates.append(parsed)
    if not candidates:
        return None
    newest = max(candidates)
    return max(0.0, (now - newest).total_seconds() / 86400.0)


# ---------------------------------------------------------------------------
# Evaluador
# ---------------------------------------------------------------------------

class StatusEvaluator:
    """Aplica las 6 reglas del Anexo F y calcula la confianza."""

    RULE_VERSION = '1.0.0'

    def __init__(self, rule_version: str = RULE_VERSION) -> None:
        self.rule_version = rule_version or self.RULE_VERSION

    # -- API pública ----------------------------------------------------
    def evaluate(
        self,
        port: UnifiedPort,
        now_iso: Optional[str] = None,
    ) -> StatusInfo:
        """Devuelve el :class:`StatusInfo` calculado para ``port``."""

        computed_at = as_str(now_iso) or globals()['now_iso']()
        now = _parse_datetime(computed_at) or datetime.now(timezone.utc)

        signals = _collect_signals(port)
        ratio = _ratio(
            signals.recommended_raw, signals.reviews, signals.recommended_is_ratio
        )
        community = StatusCommunity(
            verdict=signals.verdict or self._derive_verdict(ratio, signals.reviews),
            recommended=round(ratio, 4),
            reviews=signals.reviews,
            bugReports=signals.bug_reports,
            windowDays=(
                port.status.community.windowDays
                if isinstance(port.status, StatusInfo)
                and isinstance(port.status.community, StatusCommunity)
                else None
            ),
        )

        project_age = _project_age_days(signals, now)
        data_age = _data_age_days(port, signals, now)
        tag, reasons = self._apply_rules(signals, ratio, project_age)

        confidence = self._confidence(signals, data_age)
        return StatusInfo(
            tag=str(tag.value),
            development=signals.development or 'unknown',
            maintenance=signals.maintenance or ('archived' if signals.archived else 'unknown'),
            community=community,
            confidence=confidence,
            reasons=reasons,
            computedAt=computed_at,
            ruleVersion=self.rule_version,
            manualOverride=(
                port.status.manualOverride
                if isinstance(port.status, StatusInfo)
                else None
            ),
        )

    def evaluate_many(
        self,
        ports: Sequence[UnifiedPort],
        now_iso: Optional[str] = None,
        assign: bool = True,
    ) -> List[StatusInfo]:
        """Evalúa una colección (y opcionalmente asigna ``port.status``)."""

        results: List[StatusInfo] = []
        for port in ports or []:
            info = self.evaluate(port, now_iso=now_iso)
            if assign and isinstance(port, UnifiedPort):
                port.status = info
            results.append(info)
        return results

    # -- reglas ---------------------------------------------------------
    def _apply_rules(
        self,
        signals: _Signals,
        ratio: float,
        age_days: Optional[float],
    ) -> tuple:
        """Devuelve ``(tag, reasons)`` aplicando R1..R6 en orden estricto."""

        development = (signals.development or '').strip().lower()
        maintenance = (signals.maintenance or '').strip().lower()
        channel = (signals.release_channel or '').strip().lower()
        availability = (signals.availability or '').strip().lower()

        # R1 - sin señales utilizables.
        if not signals.has_signal:
            return StatusTag.NODATA, [REASON_TEXTS['nodata']]

        # R2 - archivado o sin cambios en más de 18 meses.
        stale_project = age_days is not None and age_days > ABANDONED_DAYS
        if signals.archived or maintenance == 'archived' or stale_project:
            reasons = [REASON_TEXTS['abandoned']]
            if signals.archived or maintenance == 'archived':
                reasons.append('El proyecto está archivado en su repositorio.')
            if stale_project and age_days is not None:
                reasons.append(
                    'Última señal de actividad hace {} días (> {}).'.format(
                        int(age_days), ABANDONED_DAYS
                    )
                )
            return StatusTag.ABANDONED, reasons

        # R3 - experimental.
        experimental = (
            development == 'experimental'
            or signals.is_experimental
            or channel == 'experimental'
            or (signals.prerelease_only and signals.release_count > 0)
        )
        if experimental:
            reasons = [REASON_TEXTS['experimental']]
            if development == 'experimental':
                reasons.append("development == 'experimental'.")
            if signals.is_experimental:
                reasons.append('La ficha declara isExperimental = true.')
            if channel == 'experimental':
                reasons.append("releaseChannel == 'experimental'.")
            if signals.prerelease_only and signals.release_count > 0:
                reasons.append('Todas las releases publicadas son preliminares.')
            return StatusTag.EXPERIMENTAL, reasons

        # R4 - en desarrollo activo.
        wip = (
            development == 'wip'
            or channel in ('alpha', 'beta', 'wip')
            or availability in ('in-development', 'indev', 'in_development', 'wip')
        )
        if wip:
            reasons = [REASON_TEXTS['wip']]
            if development == 'wip':
                reasons.append("development == 'wip'.")
            if channel in ('alpha', 'beta', 'wip'):
                reasons.append('Canal de release: {}.'.format(channel))
            if availability in ('in-development', 'indev', 'in_development', 'wip'):
                reasons.append("availability == 'in-development'.")
            return StatusTag.WIP, reasons

        # R5 - comunidad reporta problemas.
        low_ratio = signals.reviews >= MIN_REVIEWS_BUGS and ratio < MIN_RECOMMENDED_RATIO
        many_bugs = signals.bug_reports >= MIN_BUG_REPORTS
        if low_ratio or many_bugs:
            reason = (
                'Comunidad reporta problemas ({}% recomendado) o {} reportes de bugs.'
                .format(int(round(ratio * 100)), signals.bug_reports)
            )
            reasons = [reason]
            if low_ratio:
                reasons.append(
                    '{} reviews con {}% recomendado (< {}%).'.format(
                        signals.reviews,
                        int(round(ratio * 100)),
                        int(MIN_RECOMMENDED_RATIO * 100),
                    )
                )
            if many_bugs:
                reasons.append(
                    '{} reportes de bugs (>= {}).'.format(
                        signals.bug_reports, MIN_BUG_REPORTS
                    )
                )
            return StatusTag.BUGS, reasons

        # R6 - jugable.
        reasons = [REASON_TEXTS['playable']]
        if signals.reviews:
            reasons.append(
                '{} reviews con {}% recomendado.'.format(
                    signals.reviews, int(round(ratio * 100))
                )
            )
        if signals.has_verified_release:
            reasons.append('Existe una release verificada.')
        return StatusTag.PLAYABLE, reasons

    def _confidence(self, signals: _Signals, age_days: Optional[float]) -> str:
        """``alta`` / ``media`` / ``baja`` según volumen y frescura de datos."""

        is_stale = age_days is not None and age_days > STALE_DAYS
        reviews = signals.reviews

        if reviews >= CONFIDENCE_HIGH_REVIEWS and not is_stale:
            return 'alta'
        if reviews >= CONFIDENCE_MEDIUM_REVIEWS or signals.has_verified_release:
            return 'baja' if is_stale else 'media'
        return 'baja'

    @staticmethod
    def _derive_verdict(ratio: float, reviews: int) -> Optional[str]:
        if reviews <= 0:
            return None
        if ratio >= 0.85:
            return 'very-positive'
        if ratio >= MIN_RECOMMENDED_RATIO:
            return 'positive'
        if ratio >= 0.5:
            return 'mixed'
        return 'negative'


def evaluate_all(
    ports: Sequence[UnifiedPort],
    now_iso: Optional[str] = None,
    evaluator: Optional[StatusEvaluator] = None,
) -> List[UnifiedPort]:
    """Evalúa y asigna ``status`` a cada puerto (devuelve la misma lista)."""

    engine = evaluator or StatusEvaluator()
    for port in ports or []:
        if isinstance(port, UnifiedPort):
            port.status = engine.evaluate(port, now_iso=now_iso)
    return list(ports or [])
