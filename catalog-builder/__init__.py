"""catalog-builder - Indexador propio del catálogo unificado (Fase 2).

El nombre del directorio contiene un guion, por lo que el paquete debe
cargarse mediante ``importlib``::

    import importlib
    builder = importlib.import_module('catalog-builder')

o añadiendo el directorio a ``sys.path`` y usando imports planos.
"""

__version__ = '1.0.0'

__all__ = ['__version__']
