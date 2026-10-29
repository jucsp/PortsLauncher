#!/usr/bin/env python3
"""CLI y orquestador del indexador propio (Fase 2).

Flujo
-----
1. Carga los JSON de GameWave (``catalog.json``) y Quiver (``apps_unique.json``).
2. Adapta cada ficha con :class:`GameWaveAdapter` / :class:`QuiverAdapter`.
3. Deduplica y consolida con :class:`Deduplicator`.
4. Evalúa el estado de cada puerto con :class:`StatusEvaluator`.
5. Calcula el hash semántico SHA-256 sobre los puertos normalizados excluyendo
   campos volátiles (``coverUrl``, ``coverSource``, ``generatedAt``, marcas de
   tiempo y bitácoras internas).
6. Escribe ``<out-dir>/ports.index.json``.
7. Escribe ``<out-dir>/report.md`` con las métricas.

Uso
---
::

    python3 catalog-builder/builder.py --offline
    python3 catalog-builder/builder.py --offline --out-dir data \\
        --gw-fixture fixtures/gamewave/catalog.json \\
        --quiver-fixture fixtures/quiver/apps_unique.json

    # equivalente en "modo módulo" (el directorio contiene un guion, por lo que
    # ``python3 -m catalog-builder.builder`` no es importable tal cual):
    cd catalog-builder && python3 -m builder --offline --out-dir ../data
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter, OrderedDict
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:  # import como paquete (catalog-builder.builder)
    from . import __version__ as PACKAGE_VERSION  # type: ignore[import-not-found]
    from .adapters.gamewave import GameWaveAdapter
    from .adapters.quiver import QuiverAdapter
    from .dedup import Deduplicator
    from .models import UnifiedPort
    from .status import StatusEvaluator
except (ImportError, ValueError):  # import directo (catalog-builder en sys.path)
    PACKAGE_VERSION = '1.0.0'
    try:  # lee ``__version__`` del __init__.py del paquete sin importarlo
        with open(os.path.join(_HERE, '__init__.py'), 'r', encoding='utf-8') as _handle:
            for _line in _handle:
                if _line.startswith('__version__'):
                    PACKAGE_VERSION = _line.split('=', 1)[1].strip().strip('\'"')
                    break
    except OSError:  # pragma: no cover - ejecución aislada
        pass
    from adapters.gamewave import GameWaveAdapter  # type: ignore[no-redef]
    from adapters.quiver import QuiverAdapter  # type: ignore[no-redef]
    from dedup import Deduplicator  # type: ignore[no-redef]
    from models import UnifiedPort  # type: ignore[no-redef]
    from status import StatusEvaluator  # type: ignore[no-redef]

__all__ = [
    'build_catalog',
    'write_outputs',
    'main',
    'load_gamewave',
    'load_quiver',
    'semantic_hash',
]

#: Raíz del proyecto (``catalog-builder/`` cuelga de ella).
BASE_DIR = Path(__file__).resolve().parent.parent

DEFAULT_OUT_DIR = 'data'
DEFAULT_GW_FIXTURE = Path('fixtures') / 'gamewave' / 'catalog.json'
DEFAULT_QUIVER_FIXTURE = Path('fixtures') / 'quiver' / 'apps_unique.json'

#: Endpoints usados en modo online (sólo si se omite ``--offline``).
GAMEWAVE_URL = 'https://gamewave.digital/ports/catalog.json'
QUIVER_URL = 'https://quiverlauncher.com/api/v1/apps'

SCHEMA_VERSION = '1.0.0'
INDEX_FILENAME = 'ports.index.json'
REPORT_FILENAME = 'report.md'
HTTP_TIMEOUT = 20

#: Campos volátiles excluidos del hash semántico.
VOLATILE_KEYS = frozenset({
    'coverUrl',
    'coverSource',
    'generatedAt',
    'computedAt',
    'lastSeen',
    'updatedAt',
    'buildTime',
    'durationMs',
})

#: Prefijos de claves internas (bitácoras) excluidas del hash.
VOLATILE_PREFIXES = ('_log', '_adapterWarnings', '_debug', '_trace')


# ---------------------------------------------------------------------------
# Carga de datos
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> Any:
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def _fetch_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={'User-Agent': 'catalog-builder/1.0'})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:  # noqa: S310
        return json.loads(response.read().decode('utf-8'))


def load_gamewave(
    path: Optional[Path] = None,
    offline: bool = True,
    url: str = GAMEWAVE_URL,
) -> Tuple[List[dict], Optional[str], str]:
    """Devuelve ``(apps, catalogVersion, origen)``."""

    if not offline:
        try:
            payload = _fetch_json(url)
            apps = payload.get('apps', []) if isinstance(payload, dict) else list(payload or [])
            version = payload.get('catalogVersion') if isinstance(payload, dict) else None
            return list(apps or []), version, url
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as exc:
            print('[aviso] Descarga GameWave fallida ({}); se usa el fixture.'.format(exc))

    target = Path(path) if path is not None else DEFAULT_GW_FIXTURE
    if not target.is_absolute():
        target = BASE_DIR / target
    if not target.exists():
        raise FileNotFoundError('Fixture GameWave no encontrado: {}'.format(target))
    payload = _read_json(target)
    if isinstance(payload, dict):
        apps = payload.get('apps', [])
        version = payload.get('catalogVersion')
    else:
        apps, version = payload, None
    return list(apps or []), version, str(target)


def _flatten_quiver(payload: Any) -> List[dict]:
    """Acepta ``apps_unique.json``, páginas ``apps_all_pages.json`` o ``{items}``."""

    if isinstance(payload, dict):
        for key in ('apps', 'items', 'data', 'results'):
            value = payload.get(key)
            if isinstance(value, list):
                return _flatten_quiver(value)
        return [payload] if payload else []

    cards: List[dict] = []
    for item in payload or []:
        if not isinstance(item, dict):
            continue
        # Formato de páginas: {'url': ..., 'data'|'response': {...}}
        nested = None
        for key in ('data', 'response', 'payload'):
            if isinstance(item.get(key), (dict, list)):
                nested = item[key]
                break
        if nested is not None and not item.get('id') and not item.get('slug'):
            cards.extend(_flatten_quiver(nested))
            continue
        cards.append(item)
    return cards


def load_quiver(
    path: Optional[Path] = None,
    offline: bool = True,
    url: str = QUIVER_URL,
) -> Tuple[List[dict], str]:
    """Devuelve ``(cards, origen)``."""

    if not offline:
        try:
            payload = _fetch_json(url)
            return _flatten_quiver(payload), url
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as exc:
            print('[aviso] Descarga Quiver fallida ({}); se usa el fixture.'.format(exc))

    target = Path(path) if path is not None else DEFAULT_QUIVER_FIXTURE
    if not target.is_absolute():
        target = BASE_DIR / target
    if not target.exists():
        raise FileNotFoundError('Fixture Quiver no encontrado: {}'.format(target))
    return _flatten_quiver(_read_json(target)), str(target)


# ---------------------------------------------------------------------------
# Hash semántico
# ---------------------------------------------------------------------------

def _is_volatile(key: Any) -> bool:
    text = str(key)
    if text in VOLATILE_KEYS:
        return True
    return text.startswith(VOLATILE_PREFIXES)


def _canonical(value: Any) -> Any:
    """Normaliza una estructura para el hash (sin campos volátiles)."""

    if is_dataclass(value) and not isinstance(value, type):
        value = asdict(value)
    if isinstance(value, dict):
        return OrderedDict(
            (str(key), _canonical(item))
            for key, item in sorted(value.items(), key=lambda kv: str(kv[0]))
            if not _is_volatile(key)
        )
    if isinstance(value, (list, tuple)):
        return [_canonical(item) for item in value]
    if isinstance(value, set):
        return sorted(_canonical(item) for item in value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def semantic_hash(ports: Sequence[UnifiedPort]) -> str:
    """SHA-256 determinista sobre los puertos normalizados."""

    payload = [_canonical(asdict(port)) for port in ports]
    serialized = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')
    )
    return 'sha256:' + hashlib.sha256(serialized.encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------------

def _status_tag(port: UnifiedPort) -> str:
    tag = getattr(port.status, 'tag', None) if port.status is not None else None
    text = str(tag) if tag is not None else 'unknown'
    return text or 'unknown'


def _sources_of(port: UnifiedPort) -> set:
    return {
        str(getattr(ref, 'source', '') or '').lower()
        for ref in (port.sources or [])
    }


def compute_stats(ports: Sequence[UnifiedPort], extra: Optional[dict] = None) -> Dict[str, Any]:
    """Construye el bloque ``stats`` del índice."""

    by_platform = Counter(port.sourcePlatform or 'other' for port in ports)
    by_status = Counter(_status_tag(port) for port in ports)
    by_strategy = Counter(port.installStrategy or 'external' for port in ports)
    by_distribution = Counter(port.distribution or 'external' for port in ports)

    fused = 0
    gamewave_only = 0
    quiver_only = 0
    for port in ports:
        sources = _sources_of(port)
        has_gw = 'gamewave' in sources
        has_qv = 'quiver' in sources
        if has_gw and has_qv:
            fused += 1
        elif has_gw:
            gamewave_only += 1
        elif has_qv:
            quiver_only += 1

    repo_counter: Counter = Counter()
    for port in ports:
        if port.repository:
            repo_counter[port.repository.strip().lower()] += 1
    multi_repos = [
        {'repository': repo, 'count': count}
        for repo, count in sorted(repo_counter.items(), key=lambda kv: (-kv[1], kv[0]))
        if count > 1
    ]

    stats: Dict[str, Any] = {
        'totalPorts': len(ports),
        'bySourcePlatform': dict(sorted(by_platform.items(), key=lambda kv: (-kv[1], kv[0]))),
        'byStatusTag': dict(sorted(by_status.items(), key=lambda kv: (-kv[1], kv[0]))),
        'byInstallStrategy': dict(sorted(by_strategy.items(), key=lambda kv: (-kv[1], kv[0]))),
        'byDistribution': dict(sorted(by_distribution.items(), key=lambda kv: (-kv[1], kv[0]))),
        'fusedGamewaveQuiver': fused,
        'gamewaveOnly': gamewave_only,
        'quiverOnly': quiver_only,
        'uniqueRepositories': len(repo_counter),
        'multiRepositories': multi_repos,
        'multiRepositoryCount': len(multi_repos),
        'quarantinedLinks': sum(len(port.quarantinedLinkFields or []) for port in ports),
        'withSetupFiles': sum(1 for port in ports if port.setupFiles),
        'withVerifiedRelease': sum(1 for port in ports if port.verifiedRelease is not None),
        'invisible': sum(1 for port in ports if not port.visible),
    }
    if extra:
        stats.update(extra)
    return stats


# ---------------------------------------------------------------------------
# Informe
# ---------------------------------------------------------------------------

def _md_table(headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> List[str]:
    lines = [
        '| ' + ' | '.join(str(header) for header in headers) + ' |',
        '|' + '|'.join(['---'] * len(headers)) + '|',
    ]
    for row in rows:
        lines.append('| ' + ' | '.join(str(cell) for cell in row) + ' |')
    return lines


def render_report(
    ports: Sequence[UnifiedPort],
    stats: Dict[str, Any],
    digest: str,
    generated_at: str,
    meta: Optional[dict] = None,
) -> str:
    """Genera ``report.md`` con las métricas exigidas."""

    meta = meta or {}
    lines: List[str] = []
    lines.append('# Catálogo unificado — informe de construcción')
    lines.append('')
    lines.append('- **Generado:** {}'.format(generated_at))
    lines.append('- **Versión:** {} (schema {})'.format(
        meta.get('version', SCHEMA_VERSION), meta.get('schemaVersion', SCHEMA_VERSION)
    ))
    lines.append('- **Hash semántico:** `{}`'.format(digest))
    lines.append('- **Modo:** {}'.format('offline (fixtures)' if meta.get('offline') else 'online'))
    lines.append('- **Fuente GameWave:** `{}`'.format(meta.get('gamewaveSource', '—')))
    lines.append('- **Fuente Quiver:** `{}`'.format(meta.get('quiverSource', '—')))
    if meta.get('catalogVersion'):
        lines.append('- **catalogVersion GameWave:** `{}`'.format(meta['catalogVersion']))
    lines.append('')

    lines.append('## Resumen')
    lines.append('')
    summary_rows = [
        ('Puertos totales', stats.get('totalPorts', 0)),
        ('Fichas GameWave de entrada', meta.get('gamewaveInput', '—')),
        ('Fichas Quiver de entrada', meta.get('quiverInput', '—')),
        ('Puertos fusionados GameWave + Quiver', stats.get('fusedGamewaveQuiver', 0)),
        ('Solo GameWave', stats.get('gamewaveOnly', 0)),
        ('Solo Quiver', stats.get('quiverOnly', 0)),
        ('Colapsos por clave técnica', meta.get('technicalCollapsed', 0)),
        ('Repositorios únicos', stats.get('uniqueRepositories', 0)),
        ('Repositorios multi-ficha', stats.get('multiRepositoryCount', 0)),
        ('Puertos con setupFiles', stats.get('withSetupFiles', 0)),
        ('Puertos con release verificada', stats.get('withVerifiedRelease', 0)),
        ('Enlaces en cuarentena', stats.get('quarantinedLinks', 0)),
        ('Fichas ocultas (visible=false)', stats.get('invisible', 0)),
    ]
    lines.extend(_md_table(('Métrica', 'Valor'), summary_rows))
    lines.append('')

    lines.append('## Puertos por plataforma de origen')
    lines.append('')
    lines.extend(_md_table(
        ('Plataforma', 'Puertos'),
        list((stats.get('bySourcePlatform') or {}).items()),
    ))
    lines.append('')

    lines.append('## Puertos por estado (status.tag)')
    lines.append('')
    lines.extend(_md_table(
        ('Estado', 'Puertos'),
        list((stats.get('byStatusTag') or {}).items()),
    ))
    lines.append('')

    lines.append('## Puertos por estrategia de instalación')
    lines.append('')
    lines.extend(_md_table(
        ('installStrategy', 'Puertos'),
        list((stats.get('byInstallStrategy') or {}).items()),
    ))
    lines.append('')

    lines.append('## Puertos por distribución')
    lines.append('')
    lines.extend(_md_table(
        ('distribution', 'Puertos'),
        list((stats.get('byDistribution') or {}).items()),
    ))
    lines.append('')

    fused_ports = [
        port for port in ports
        if {'gamewave', 'quiver'}.issubset(_sources_of(port))
    ]
    lines.append('## Puertos fusionados GameWave + Quiver ({})'.format(len(fused_ports)))
    lines.append('')
    if fused_ports:
        rows = []
        for port in sorted(fused_ports, key=lambda item: item.pid)[:200]:
            rows.append((
                '`{}`'.format(port.pid),
                port.name,
                port.sourcePlatform,
                ', '.join(sorted(_sources_of(port))),
            ))
        lines.extend(_md_table(('pid', 'Nombre', 'Plataforma origen', 'Fuentes'), rows))
        if len(fused_ports) > 200:
            lines.append('')
            lines.append('_Mostrando 200 de {} fusiones._'.format(len(fused_ports)))
    else:
        lines.append('_Sin fusiones GameWave + Quiver._')
    lines.append('')

    multi = stats.get('multiRepositories') or []
    lines.append('## Repositorios multi-ficha verificados ({})'.format(len(multi)))
    lines.append('')
    if multi:
        rows = []
        for entry in multi:
            repo = entry['repository']
            pids = [
                '`{}`'.format(port.pid)
                for port in ports
                if (port.repository or '').strip().lower() == repo
            ]
            rows.append((repo, entry['count'], ', '.join(pids[:10])))
        lines.extend(_md_table(('Repositorio', 'Fichas', 'PIDs'), rows))
    else:
        lines.append('_Ningún repositorio agrupa más de una ficha._')
    lines.append('')

    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Orquestación
# ---------------------------------------------------------------------------

def build_catalog(
    gw_apps: Sequence[dict],
    quiver_cards: Sequence[dict],
    catalog_version: Optional[str] = None,
    now: Optional[str] = None,
) -> Tuple[List[UnifiedPort], dict]:
    """Adapta, deduplica y evalúa. Devuelve ``(puertos, metadatos)``."""

    stamp = now or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')

    gw_adapter = GameWaveAdapter(now=stamp)
    qv_adapter = QuiverAdapter(now=stamp)

    ports: List[UnifiedPort] = []
    for app in gw_apps or []:
        if isinstance(app, dict):
            ports.append(gw_adapter.adapt(app, catalog_version=catalog_version))
    for card in quiver_cards or []:
        if isinstance(card, dict):
            ports.append(qv_adapter.adapt(card))

    deduplicator = Deduplicator()
    ports = deduplicator.deduplicate(ports)

    evaluator = StatusEvaluator()
    evaluator.evaluate_many(ports, now_iso=stamp, assign=True)

    meta = dict(deduplicator.last_stats)
    meta['gamewaveInput'] = len([app for app in gw_apps or [] if isinstance(app, dict)])
    meta['quiverInput'] = len([card for card in quiver_cards or [] if isinstance(card, dict)])
    meta['generatedAt'] = stamp
    return ports, meta


def write_outputs(
    ports: Sequence[UnifiedPort],
    out_dir: Path,
    meta: Optional[dict] = None,
) -> Dict[str, Any]:
    """Escribe ``ports.index.json`` y ``report.md``. Devuelve el índice."""

    meta = meta or {}
    generated_at = meta.get('generatedAt') or (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    )
    digest = semantic_hash(ports)
    stats = compute_stats(ports)

    index = OrderedDict()
    index['version'] = meta.get('version', SCHEMA_VERSION)
    index['schemaVersion'] = meta.get('schemaVersion', SCHEMA_VERSION)
    index['generatedAt'] = generated_at
    index['semanticHash'] = digest
    index['stats'] = stats
    index['ports'] = [asdict(port) for port in ports]

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    index_path = out_dir / INDEX_FILENAME
    with open(index_path, 'w', encoding='utf-8') as handle:
        json.dump(index, handle, indent=2, ensure_ascii=False)
        handle.write('\n')

    report_meta = dict(meta)
    report_meta.setdefault('version', index['version'])
    report_meta.setdefault('schemaVersion', index['schemaVersion'])
    report = render_report(ports, stats, digest, generated_at, report_meta)
    report_path = out_dir / REPORT_FILENAME
    with open(report_path, 'w', encoding='utf-8') as handle:
        handle.write(report)
        if not report.endswith('\n'):
            handle.write('\n')

    return {
        'index': index,
        'indexPath': str(index_path),
        'reportPath': str(report_path),
        'semanticHash': digest,
        'stats': stats,
    }


def _resolve_out_dir(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (BASE_DIR / path).resolve()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='catalog-builder',
        description='Construye data/ports.index.json y data/report.md (Fase 2).',
    )
    parser.add_argument('--offline', action='store_true',
                        help='No realiza peticiones HTTP: usa únicamente fixtures locales.')
    parser.add_argument('--out-dir', default=DEFAULT_OUT_DIR,
                        help='Directorio de salida (por defecto: data).')
    parser.add_argument('--gw-fixture', default=None,
                        help='Ruta al catalog.json de GameWave '
                             '(por defecto: fixtures/gamewave/catalog.json).')
    parser.add_argument('--quiver-fixture', default=None,
                        help='Ruta al JSON de Quiver '
                             '(por defecto: fixtures/quiver/apps_unique.json).')
    parser.add_argument('--gw-url', default=GAMEWAVE_URL,
                        help='Endpoint GameWave para el modo online.')
    parser.add_argument('--quiver-url', default=QUIVER_URL,
                        help='Endpoint Quiver para el modo online.')
    parser.add_argument('--no-quiver-matching', action='store_true',
                        help='Desactiva la heurística de emparejamiento Quiver <-> GameWave.')
    parser.add_argument('--version', action='version',
                        version='catalog-builder {}'.format(PACKAGE_VERSION))
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    offline = bool(args.offline)
    out_dir = _resolve_out_dir(args.out_dir)

    try:
        gw_apps, catalog_version, gw_source = load_gamewave(
            Path(args.gw_fixture) if args.gw_fixture else None,
            offline=offline,
            url=args.gw_url,
        )
        quiver_cards, qv_source = load_quiver(
            Path(args.quiver_fixture) if args.quiver_fixture else None,
            offline=offline,
            url=args.quiver_url,
        )
    except FileNotFoundError as exc:
        print('[error] {}'.format(exc), file=sys.stderr)
        return 2
    except (json.JSONDecodeError, OSError) as exc:
        print('[error] No se pudo leer un fixture: {}'.format(exc), file=sys.stderr)
        return 2

    print('[info] GameWave: {} fichas ({})'.format(len(gw_apps), gw_source))
    print('[info] Quiver: {} fichas ({})'.format(len(quiver_cards), qv_source))
    if catalog_version:
        print('[info] catalogVersion: {}'.format(catalog_version))

    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')

    gw_adapter = GameWaveAdapter(now=stamp)
    qv_adapter = QuiverAdapter(now=stamp)

    ports: List[UnifiedPort] = []
    for app in gw_apps:
        if isinstance(app, dict):
            ports.append(gw_adapter.adapt(app, catalog_version=catalog_version))
    for card in quiver_cards:
        if isinstance(card, dict):
            ports.append(qv_adapter.adapt(card))
    print('[info] Adaptados: {} puertos'.format(len(ports)))

    deduplicator = Deduplicator(enable_quiver_matching=not args.no_quiver_matching)
    ports = deduplicator.deduplicate(ports)
    print('[info] Tras deduplicación: {} puertos '
          '(fusiones cruzadas: {}, colapsos por clave: {})'.format(
              len(ports),
              deduplicator.last_stats.get('quiverMerged', 0),
              deduplicator.last_stats.get('technicalCollapsed', 0),
          ))

    evaluator = StatusEvaluator()
    evaluator.evaluate_many(ports, now_iso=stamp, assign=True)

    meta = dict(deduplicator.last_stats)
    meta.update({
        'version': PACKAGE_VERSION or SCHEMA_VERSION,
        'schemaVersion': SCHEMA_VERSION,
        'generatedAt': stamp,
        'offline': offline,
        'gamewaveSource': gw_source,
        'quiverSource': qv_source,
        'catalogVersion': catalog_version,
        'gamewaveInput': len(gw_apps),
        'quiverInput': len(quiver_cards),
    })

    result = write_outputs(ports, out_dir, meta)
    stats = result['stats']
    print('[ok] {}'.format(result['indexPath']))
    print('[ok] {}'.format(result['reportPath']))
    print('[ok] hash semántico: {}'.format(result['semanticHash']))
    print('[ok] puertos: {} | fusionados GW+Quiver: {} | estados: {}'.format(
        stats['totalPorts'],
        stats['fusedGamewaveQuiver'],
        ', '.join('{}={}'.format(tag, count) for tag, count in stats['byStatusTag'].items()),
    ))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
