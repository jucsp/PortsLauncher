# Especificación de Plugins — PortsLauncher

PortsLauncher incluye una arquitectura de plugins abierta y desacoplada diseñada para permitir que la comunidad extienda las capacidades del launcher: integración con herramientas de compilación, extractores de assets, lanzadores personalizados y proveedores de aprovisionamiento de datos personales.

> [!IMPORTANT]
> **Aviso Legal y de Seguridad:**
> PortsLauncher es un gestor de librerías y ejecutable neutro de código abierto. PortsLauncher **no distribuye, no aloja ni enlaza plugins de terceros**. Todo plugin instalado por el usuario corre bajo su exclusiva responsabilidad. Consulta [docs/LEGAL.md](LEGAL.md) para más detalles sobre las responsabilidades legales y términos de uso.

---

## 1. Ubicación de los Plugins

Los plugins se instalan localmente en el directorio de datos de usuario según la plataforma:

* **Linux:** `~/.local/share/portslauncher/plugins/`
* **Windows:** `%APPDATA%\PortsLauncher\plugins\`
* **macOS:** `~/Library/Application Support/PortsLauncher/plugins/`

Cada plugin debe residir dentro de su propio subdirectorio con el identificador del plugin como nombre de carpeta:

```text
~/.local/share/portslauncher/plugins/
├── mi-plugin-ejemplo/
│   ├── plugin.json
│   ├── icon.png
│   └── main.py
```

---

## 2. Manifiesto del Plugin (`plugin.json`)

Cada plugin debe contener obligatoriamente un archivo `plugin.json` en la raíz de su carpeta con la siguiente estructura:

```json
{
  "$schema": "https://portslauncher.org/schemas/plugin-v1.json",
  "id": "mi-plugin-ejemplo",
  "name": "Mi Plugin de Ejemplo",
  "version": "1.0.0",
  "description": "Herramienta de integración y extracción de assets personales para PortsLauncher.",
  "author": "Nombre o Alias",
  "homepage": "https://github.com/usuario/mi-plugin-ejemplo",
  "type": "asset-provider",
  "platforms": ["n64", "ps1", "ps2", "snes", "gba", "gcn", "pc"],
  "entrypoint": "main.py",
  "runtime": "python3",
  "capabilities": ["search", "provision"],
  "settings": [
    {
      "key": "backup_directory",
      "label": "Carpeta de volcados personales",
      "type": "directory",
      "default": "~/MisJuegos/Backups"
    }
  ]
}
```

### Campos del Manifiesto:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `id` | `string` | Sí | Identificador único en formato kebab-case (alfanumérico y guiones). |
| `name` | `string` | Sí | Nombre legible para mostrar en la interfaz del launcher. |
| `version` | `string` | Sí | Versión en formato semver (`X.Y.Z`). |
| `description` | `string` | Sí | Breve descripción de la funcionalidad del plugin. |
| `author` | `string` | No | Nombre o alias del creador. |
| `type` | `string` | Sí | Tipo de plugin: `asset-provider`, `builder`, `launcher-runner` o `general`. |
| `platforms` | `string[]` | No | Lista de plataformas de origen compatibles (`n64`, `ps1`, `ps2`, `snes`, etc.). |
| `entrypoint` | `string` | Sí | Archivo principal ejecutable relativo a la carpeta del plugin. |
| `runtime` | `string` | No | Entorno de ejecución: `python3`, `node`, `bash` o `binary` (por defecto `binary`/ejecución directa). |
| `capabilities` | `string[]` | Sí | Capacidades que soporta: `["search", "provision"]`. |

---

## 3. Protocolo de Comunicación (CLI / JSON)

Para garantizar total independencia de lenguajes de programación, PortsLauncher interactúa con los plugins ejecutando el `entrypoint` mediante comandos de línea de órdenes y recibiendo respuestas estructuradas en formato JSON a través del flujo estándar de salida (`stdout`).

### Comando 1: Verificación de Estado (`check`)
PortsLauncher ejecuta este comando al iniciar o escanear la carpeta de plugins para verificar dependencias locales.

```bash
python3 main.py check
```

**Respuesta esperada en `stdout`:**
```json
{
  "ok": true,
  "version": "1.0.0",
  "message": "Plugin operativo y listo."
}
```

---

### Comando 2: Búsqueda de Assets / Copias Legítimas (`search`)
PortsLauncher solicita buscar un activo o dump correspondiente a un título o plataforma.

```bash
python3 main.py search "Super Mario 64" --platform n64
```

**Argumentos pasados:**
* Primer argumento posicional: Título o término de búsqueda.
* `--platform`: Identificador de la plataforma de origen (`n64`, `ps1`, etc.).

**Respuesta esperada en `stdout`:**
```json
{
  "success": true,
  "results": [
    {
      "id": "asset-sm64-usa-v1",
      "title": "Super Mario 64 (USA)",
      "platform": "n64",
      "format": ".z64",
      "sizeBytes": 8388608,
      "sha1": "3ce607099631c77507e157201d8f7e8338807d94",
      "description": "Volcado personal verificado de cartucho original N64"
    }
  ]
}
```

---

### Comando 3: Aprovisionamiento o Extracción (`provision`)
PortsLauncher solicita aprovisionar, extraer o vincular el activo identificado hacia el directorio destino del juego.

```bash
python3 main.py provision "asset-sm64-usa-v1" --output "/home/usuario/.local/share/portslauncher/ports/sm64"
```

**Argumentos pasados:**
* Primer argumento posicional: Identificador del resultado devuelto en la búsqueda (`id`).
* `--output`: Ruta absoluta al directorio donde el port requiere que se deposite el activo.

**Eventos de progreso por `stdout` (Líneas JSON streaming):**
```json
{"type": "progress", "percent": 25, "status": "Leyendo volcado local..."}
{"type": "progress", "percent": 75, "status": "Extrayendo assets de audio y texturas..."}
{"type": "completed", "outputPath": "/home/usuario/.local/share/portslauncher/ports/sm64/baserom.us.z64", "sha1": "3ce607099631c77507e157201d8f7e8338807d94"}
```

---

## 4. Ejemplo Mínimo de Implementación en Python

A continuación, un ejemplo de plugin de referencia que escanea una carpeta local del usuario para encontrar respaldos personales:

```python
#!/usr/bin/env python3
"""
Ejemplo de Plugin para PortsLauncher: Escáner de Backups Locales.
"""
import sys
import json
import argparse
from pathlib import Path

def handle_check():
    print(json.dumps({"ok": True, "version": "1.0.0", "message": "Escáner local activo"}))

def handle_search(query: str, platform: str):
    # En un plugin real, busca en el directorio de backups del usuario
    results = []
    backup_dir = Path.home() / "MisJuegos" / "Backups"
    if backup_dir.exists():
        for file in backup_dir.rglob("*"):
            if query.lower() in file.stem.lower():
                results.append({
                    "id": str(file.resolve()),
                    "title": file.name,
                    "platform": platform or "other",
                    "format": file.suffix,
                    "sizeBytes": file.stat().st_size
                })
    
    print(json.dumps({"success": True, "results": results}))

def main():
    parser = argparse.ArgumentParser(description="Plugin PortsLauncher")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("check")
    
    search_p = subparsers.add_parser("search")
    search_p.add_argument("query", type=str)
    search_p.add_argument("--platform", type=str, default="")

    provision_p = subparsers.add_parser("provision")
    provision_p.add_argument("asset_id", type=str)
    provision_p.add_argument("--output", type=str, required=True)

    args = parser.parse_args()

    if args.command == "check":
        handle_check()
    elif args.command == "search":
        handle_search(args.query, args.platform)
    else:
        print(json.dumps({"error": f"Comando '{args.command}' no implementado"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
```

---

## 5. Buenas Prácticas y Seguridad

1. **Sin dependencias pesadas innecesarias:** Procura que el plugin utilice bibliotecas estándar (`sys`, `json`, `pathlib`, `hashlib`) para que el usuario no necesite configurar entornos virtuales complejos.
2. **Timeouts:** PortsLauncher establece un tiempo máximo de espera de 30 segundos para el comando `search` y 5 minutos para `provision`.
3. **Manejo de Errores Limpio:** Si ocurre un error, emite un objeto JSON con `{"success": false, "error": "Descripción del error"}` y código de salida `1` o superior.
