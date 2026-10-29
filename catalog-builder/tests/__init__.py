"""Suite de pruebas de ``catalog-builder`` (Fase 2).

Los módulos de prueba se pueden ejecutar de varias formas::

    python3 -m unittest discover -s catalog-builder/tests -t catalog-builder/tests
    python3 catalog-builder/tests/test_dedup.py -v
    cd catalog-builder && python3 -m unittest discover -s tests -v

Cada archivo inserta ``PROJECT_ROOT`` y el directorio ``catalog-builder`` en
``sys.path`` para permitir ambos modos de importación.
"""
