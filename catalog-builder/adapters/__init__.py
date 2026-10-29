"""Adaptadores de fuentes -> UnifiedPort (Fase 2).

Expone:

* :class:`GameWaveAdapter` (``catalog.json`` de GameWave, Anexo B).
* :class:`QuiverAdapter` (cards de ``/api/v1/apps`` de Quiver, Anexo B2).
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_ROOT = os.path.dirname(_HERE)
for _path in (_PKG_ROOT, _HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)

try:  # paquete
    from .gamewave import GameWaveAdapter, adapt_many as adapt_many_gamewave
    from .quiver import QuiverAdapter, adapt_many as adapt_many_quiver
except (ImportError, ValueError):  # imports planos
    from gamewave import GameWaveAdapter, adapt_many as adapt_many_gamewave  # type: ignore[no-redef]
    from quiver import QuiverAdapter, adapt_many as adapt_many_quiver  # type: ignore[no-redef]

__all__ = [
    'GameWaveAdapter',
    'QuiverAdapter',
    'adapt_many_gamewave',
    'adapt_many_quiver',
]
