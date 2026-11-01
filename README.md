# Ports Launcher (PortsHub)

> **Launcher de escritorio/web para ports nativos de juegos retro.** Un catálogo unificado,
> verificable y reproducible de puertos, recompilaciones y source-ports, con un indexador propio
> que no depende de servicios externos y una interfaz arcade que se ve igual de bien en un CRT
> imaginario que en un monitor 4K.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  PORTSHUB · índice 1.0.0 · sha256:506dc84c…aea7d4                        │
│  1.166 ports · 49 fusiones consolidadas · 196 tests · 0 deps Python      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Índice

1. [Qué es Ports Launcher](#1-qué-es-ports-launcher)
2. [Arquitectura del proyecto](#2-arquitectura-del-proyecto)
3. [Inicio rápido](#3-inicio-rápido)
4. [Las 5 vistas del catálogo](#4-las-5-vistas-del-catálogo)
5. [Los 16 estilos de medios retro](#5-los-16-estilos-de-medios-retro)
6. [Métricas del MVP](#6-métricas-del-mvp)
7. [Calidad y pruebas](#7-calidad-y-pruebas)
8. [Decisiones de diseño](#8-decisiones-de-diseño)
9. [Limitaciones conocidas y hoja de ruta](#9-limitaciones-conocidas-y-hoja-de-ruta)
10. [Créditos y atribución](#10-créditos-y-atribución)
11. [Ecosistema de Plugins (docs/PLUGINS.md)](docs/PLUGINS.md)
12. [Aviso Legal y Propiedad Intelectual (docs/LEGAL.md)](docs/LEGAL.md)

---

## 1. Qué es Ports Launcher

**PortsHub** resuelve un problema muy concreto: los ports de juegos retro están dispersos en
cientos de repositorios de GitHub, listados en sitios comunitarios que cambian de formato, y cada
uno se instala a su manera (un `.zip` con un `.exe`, un AppImage, un instalador de Windows que hay
que correr bajo Proton, un proyecto que sólo compila desde fuentes…). Encontrar *qué existe*,
saber *si funciona* y *cómo se instala* es hoy un trabajo manual de arqueología.

El proyecto ataca eso en dos mitades independientes y desacopladas:

| Mitad | Qué hace | Tecnología |
| --- | --- | --- |
| **Indexador** (`catalog-builder/`) | Ingesta catálogos comunitarios de origen, normaliza, deduplica, evalúa estado y emite un índice único con hash semántico | Python 3.10+ **stdlib puro** |
| **Launcher** (`launcher/`) | Explora el índice con 5 vistas, gestiona la biblioteca local, instala y lanza ports | Vite + TypeScript, **DOM vanilla modular** |

Ninguna de las dos mitades necesita la otra para funcionar: el indexador produce un JSON estático
que cualquiera puede consumir; el launcher puede apuntar a cualquier índice publicado.

**Principios rectores**

- **Offline y cortés.** El indexador trabaja sobre fixtures locales extraídas de HAR. No hace
  scraping en vivo, no martillea APIs ajenas y no requiere red para construir el catálogo.
- **Determinista.** Mismo input → mismo output, byte a byte. El índice lleva un `semanticHash`
  calculado sobre contenido normalizado que permite detectar cambios reales frente a ruido.
- **Sin dependencias innecesarias.** 0 paquetes de terceros en Python; 3 devDependencies en el
  frontend (Vite, TypeScript, Vitest) y ni un solo framework de UI.
- **Trazabilidad.** Cada port conserva sus `sources[]` de origen, la regla que determinó su estado
  y las razones textuales de esa decisión.
- **Seguridad por defecto.** Los enlaces sospechosos se ponen en cuarentena en lugar de
  propagarse al cliente.

---

## 2. Arquitectura del proyecto

### 2.1 Vista de capas

```
                    ┌───────────────────────────────────────────────┐
                    │  fixtures/  (HAR extraídos → JSON estático)   │
                    │  catálogo primario         1.173 fichas      │
                    │  catálogo complementario     148 fichas      │
                    └───────────────────┬───────────────────────────┘
                                        │
        ╔═══════════════════════════════▼═══════════════════════════════╗
        ║  CAPA 1 · INDEXADOR  (catalog-builder/ · Python stdlib puro)  ║
        ║                                                               ║
        ║  adapters/ · catálogo primario ──┐                            ║
        ║  adapters/ · catálogo secundario ┴─► models.UnifiedPort       ║
        ║                              │  (vocabulario cerrado:          ║
        ║                              │   17 plataformas, 8 estrategias)║
        ║                              ▼                                ║
        ║                        dedup.py  ──► technical key + pid      ║
        ║                              │      fusión consolidada         ║
        ║                              ▼                                ║
        ║                       status.py  ──► 6 reglas + confianza     ║
        ║                              │                                ║
        ║                        builder.py ──► hash semántico SHA-256  ║
        ╚═══════════════════════════════╤═══════════════════════════════╝
                                        │
                        data/ports.index.json  ·  data/report.md
                                        │
                                 (copia a public/data/)
                                        │
        ╔═══════════════════════════════▼═══════════════════════════════╗
        ║  CAPA 2 · LAUNCHER  (launcher/ · Vite + TS vanilla)           ║
        ║                                                               ║
        ║  services/catalogService.ts ── índice en memoria, búsqueda,   ║
        ║  services/libraryService.ts ── localStorage, ajustes          ║
        ║  services/installerService.ts ─ máquina de estados D.3        ║
        ║                     │                                         ║
        ║                     ▼                                         ║
        ║  components/  Sidebar · Toolbar · Posters · BigGrid ·         ║
        ║               Shelves · List · Table · Modales · Drawer       ║
        ║                     │                                         ║
        ║                     ▼                                         ║
        ║  styles/  tokens.css → media.css → layout.css                 ║
        ║           (sistema de diseño «Arcade Nocturno»)               ║
        ╚═══════════════════════════════════════════════════════════════╝
                                        │
        ╔═══════════════════════════════▼═══════════════════════════════╗
        ║  CAPA 3 · HERRAMIENTAS  (tools/ · fixtures/)                  ║
        ║  extract_har.py · test_fixtures.py                            ║
        ╚═══════════════════════════════════════════════════════════════╝
```

### 2.2 Indexador propio, offline y cortés — `catalog-builder/`

Todo el pipeline es **Python 3.10+ estándar puro**: `json`, `re`, `hashlib`, `dataclasses`,
`enum`, `argparse`, `datetime`, `unicodedata`. Cero `pip install`.

La materia prima son dos **catálogos comunitarios de origen**, ingeridos cada uno por su propio
adaptador. Aquí se les llama por su papel en el pipeline —no por su marca— y el contrato público del
proyecto es el índice resultante, no los ficheros crudos de terceros:

| Adaptador | Papel | Fichas | Fuerte en |
| --- | --- | --- | --- |
| `adapters/` · **catálogo primario** | Fuente principal del catálogo | 1.173 | plataformas de origen, ficheros de usuario, recetas de instalación |
| `adapters/` · **catálogo secundario** | Fuente complementaria | 148 | `setupFiles` con SHA-1, releases verificadas, feedback de comunidad |

**Adaptador del catálogo primario** — Ingesta las 1.173 fichas del catálogo principal:

- Limpieza del sufijo decorativo de build que añade el catálogo (` · <Build>`) con regex (tolerante
  a `·`, `-`, `|`, `—`).
- **Cuarentena de URLs/assets sospechosos**: cualquier campo listado en
  `quarantinedLinkFields` (`androidUrl`, `windowsUrl`, `downloadUrl`, `projectUrl`, …) se anula
  antes de salir del adaptador y se elimina también de `raw`, de modo que un enlace envenenado no
  llega nunca al cliente. Se registra qué campos se neutralizaron.
- Mapeo de plataformas de origen al vocabulario cerrado, `enabled → visible`, `assetHints`,
  `installRecipe`, `linux`/`android`, `setupFiles`, `aiLevel`, `playerFeedback`…
- Los campos que el modelo no conoce **no se descartan**: se preservan en `raw` para no perder
  información en futuras versiones del contrato.

**Adaptador del catálogo secundario** — Ingesta las 148 fichas del catálogo complementario:

- `catalogId` (o `slug`, o `id`) como `externalId`, que es la clave de emparejamiento con el
  catálogo primario.
- **Validación SHA-1** de `setupFiles`: sólo se aceptan hashes de 40 hex (`^[0-9a-f]{40}$`),
  normalizados a minúsculas; los inválidos se descartan y quedan registrados como aviso, sin
  romper la ingesta.
- `romProfile` con `binding='place'` cuando hay ficheros de setup, `playerFeedback`,
  `verifiedRelease`, `aiLevel`, `launch`…

**`dedup.py`** — Motor determinista de consolidación:

- **Clave técnica**: `source::owner/repo::discriminador` cuando hay repositorio (el discriminador
  es el filtro de assets, la carpeta o el nombre), o `distribution::plataforma::carpeta|nombre`
  cuando es externo. Esto permite que un mismo repo con varias fichas (el caso real de
  `spacestate1/namco22-decompile` y sus 5 variantes) **no se colapse** en un único port.
- **Emparejamiento cruzado entre catálogos** por 4 vías: repositorio idéntico, `folderName`
  normalizado, `projectName` contra el nombre del repo, o nombre + plataforma exactos.
- **`pid` determinista** y URL-friendly (`owner-repo-discriminador`, minúsculas, sin diacríticos).
- Fusión con reglas de precedencia explícitas (ver §8).

**`status.py`** — Evaluación de estado y confianza en **6 reglas en orden estricto**, la primera que
se cumple gana:

| # | Tag | Condición |
| --- | --- | --- |
| 1 | `nodata` | Sin ninguna señal utilizable (ni desarrollo, ni reviews, ni release verificada, ni mantenimiento) |
| 2 | `abandoned` | `maintenance == archived` **o** último cambio > 547 días (18 meses) |
| 3 | `experimental` | `development == experimental`, flag `isExperimental`, canal `experimental` o **todas** las releases son prerelease |
| 4 | `wip` | `development == wip`, canal `alpha`/`beta`/`wip` o `availability == in-development` |
| 5 | `bugs` | ≥5 reviews con <70 % de recomendación, **o** ≥5 reportes de bugs |
| 6 | `playable` | Resto: release publicada y comunidad conforme |

La **confianza** (`alta` / `media` / `baja`) se deriva del volumen de reviews (≥30, 5–29, <5) y de
la frescura del dato (>30 días sin actualizar degrada a `baja`). Cada `StatusInfo` incluye las
`reasons[]` en texto legible, `computedAt` y `ruleVersion`, para que la UI pueda explicar *por qué*
un port está etiquetado como está.

**`builder.py`** — Orquestador y CLI:

```bash
python3 catalog-builder/builder.py --offline            # o simplemente: make build-index
cd catalog-builder && python3 -m builder --offline      # también válido
```

> `python3 -m catalog-builder.builder` **no** es una invocación válida en CPython (el guion no es
> legal en un nombre de módulo). El `Makefile` lo intenta y cae automáticamente a la ejecución
> directa del script, así que `make build-index` funciona en cualquier caso.

**Hash semántico.** Sobre los ports normalizados se calcula un SHA-256 de JSON canónico
(`sort_keys`, separadores compactos) **excluyendo campos volátiles** (`coverUrl`, `coverSource`,
`generatedAt`, `computedAt`, `lastSeen`, bitácoras internas). Dos ejecuciones sobre los mismos
fixtures producen exactamente el mismo `semanticHash`; un cambio real de contenido lo cambia.
El índice actual: `sha256:506dc84c563ae2bff924ab434a0c07e8e567447e687e2d6652e58252d0aea7d4`.

**Salidas**

- `data/ports.index.json` — `{ version, schemaVersion, generatedAt, semanticHash, stats, ports[] }`
- `data/report.md` — informe legible: totales, desglose por plataforma, por `status.tag`, por
  estrategia, por distribución, tabla de las 49 fusiones consolidadas y repositorios multi-ficha.

### 2.3 Launcher desktop/web — `launcher/`

**Vite + TypeScript puro, DOM vanilla modular.** Sin React, sin Vue, sin Svelte, sin librería de
componentes. La razón es de peso: el launcher tiene que arrancar en menos de un segundo, caber en
un binario ligero y no arrastrar 300 KB de runtime para pintar tarjetas.

**Arquitectura desacoplada en 3 anillos**

1. **Servicios** (`src/services/`) — toda la lógica, cero DOM.
   - `catalogService.ts` — carga del índice con 5 rutas candidatas y **degradación segura** (si
     todas fallan, la UI arranca con catálogo vacío y un mensaje accionable en vez de una
     pantalla en blanco), índices auxiliares `byPid` y blob de búsqueda sin diacríticos,
     `search()` con filtros y 5 modos de orden, `getDevTagInfo()` que produce
     `{ tag, text, color, glyph, why, pct, conf }`.
   - `libraryService.ts` — estado local en `localStorage` bajo la clave `portshub-library-v1`,
     con sonda real de escritura y **fallback a memoria** si el almacenamiento no está disponible
     (modo privado, cuota llena); saneado defensivo de cada ficha y cada ajuste al leer; eventos de
     cambio y sincronización entre pestañas.
   - `installerService.ts` — máquina de estados de instalación según Anexo D.3, con progreso,
     cancelación y validación de ROM (extensión + hash SHA-1 vía WebCrypto).
   - `types.ts` — contrato TypeScript **derivado del `asdict()` real** del indexador, para que no
     existan dos verdades sobre la forma del índice.
2. **Componentes** (`src/components/`) — funciones que devuelven **strings HTML** y delegan los
   eventos por `data-pid`/`data-act`; un único `delegatePortEvents()` sirve a las 5 vistas.
3. **Estilos** (`src/styles/`) — sistema de diseño **Arcade Nocturno** en 3 capas:
   `tokens.css` (variables: paleta, tipografías, colores por plataforma y por estado) →
   `media.css` (16 siluetas de cartucho/disco en CSS puro) → `layout.css` (estructura de la UI,
   vistas, modales, responsividad).

**Detalles de UI**

- Navegación lateral fija de 248 px → riel de 76 px a ≤1100 px → oculta a ≤720 px con barra
  inferior móvil.
- Atajo de teclado `/` para enfocar el buscador.
- Ajustes persistentes: estilo de medio (`single`/`auto`/mapa por plataforma), vista preferida,
  destino Linux/Windows, directorio de instalación, directorio de ROMs y modo de ROM
  (`link`/`copy`/`external`).
- `prefers-reduced-motion` y `prefers-contrast` respetados en todo el sistema.

### 2.4 Herramientas y fixtures — `tools/`, `fixtures/`

- **`tools/extract_har.py`** — extractor reproducible de HAR → JSON estático: neutraliza
  cabeceras, ordena claves y fija un formato estable, de modo que regenerar fixtures produce
  diffs mínimos y auditables.
- **`tools/test_fixtures.py`** — 9 validadores de integridad de las fixtures: totales, tipos de
  fuente, conteos por pestaña, metadatos de seguridad y presencia de `apps[]` en los ficheros de
  emuladores y webgames.
- **`fixtures/`** — un directorio por catálogo de origen: el primario (`catalog.json`, versiones
  fechadas, `emulators.json`, `webgames.json`) y el secundario con su paginación completa
  (`apps_all_pages.json` + `page_01..09.json`).

### 2.5 Estructura de directorios

```
PortsLauncher/
├── Makefile                     # orquestación de todo el ciclo
├── catalog-builder/             # CAPA 1 · indexador (Python stdlib puro)
│   ├── __init__.py              # __version__ = '1.0.0'
│   ├── models.py                # UnifiedPort y vocabularios cerrados + normalizadores
│   ├── adapters/                # un módulo por catálogo de origen
│   │   ├── (primario)           # Anexo B  · 1.173 fichas
│   │   └── (secundario)         # Anexo B2 · 148 fichas
│   ├── dedup.py                 # clave técnica, emparejamiento, merge, pid
│   ├── status.py                # 6 reglas + confianza
│   ├── builder.py               # CLI, hash semántico, índice y reporte
│   └── tests/                   # 106 tests (unittest)
├── launcher/                    # CAPA 2 · launcher (Vite + TS)
│   ├── index.html               # #app · fuentes con fallbacks locales
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── electron/                # main.cjs (ventana) · api.cjs (backend local)
│   ├── build/                   # icon.svg · icon.png de empaquetado
│   ├── src/
│   │   ├── main.ts
│   │   ├── styles/              # tokens.css · media.css · layout.css · app.css
│   │   ├── services/            # catalog · library · installer · update · types
│   │   ├── components/          # Sidebar · Toolbar · 5 vistas · modales · drawer
│   │   └── ui/                  # render · modelo · medios · estado
│   ├── tests/                   # 81 tests (Vitest)
│   └── public/data/             # ports.index.json servido en runtime
├── tools/                       # CAPA 3 · extractor + validadores
├── fixtures/                    # HAR → JSON (un directorio por catálogo)
└── data/                        # ports.index.json + report.md generados
```

### 2.6 Backend local — `launcher/electron/`

La app de escritorio (Electron) no simula nada: sirve la UI desde un proceso principal que además
expone un **backend HTTP local** (`electron/api.cjs`), compartido literalmente con `vite` y
`vite preview` para que el comportamiento no diverja entre desarrollo y binario empaquetado.

| Ruta | Qué hace |
| --- | --- |
| `POST /api/install` | Descarga el release del port (o clona el repo), extrae el artefacto en disco y marca el ejecutable |
| `POST /api/launch` | Lanza el port con `spawn` desacoplado y **confirma** el evento `spawn` antes de responder |
| `POST /api/report-error` | Escribe un reporte técnico en `~/PortsLauncher/logs/*.log` |
| `POST /api/open-path` | Abre un `.log` o la carpeta de plugins en el SO (lista blanca de rutas) |
| `POST /api/launcher/self-update` | Guarda el instalador de una versión nueva en `~/Downloads` |
| `GET /api/steamgrid/<api>` | Proxy de carátulas con la clave del usuario o del servidor |

La ventana carga la UI con `contextIsolation: true`, `sandbox: true` y `nodeIntegration: false`; el
renderer sólo habla HTTP contra `127.0.0.1`, en un puerto efímero que asigna el propio proceso
principal. Los enlaces externos no navegan dentro de la app: `setWindowOpenHandler` los deriva a
`shell.openExternal`, es decir, al **navegador predeterminado del sistema**.

---

## 3. Inicio rápido

### 3.1 Prerrequisitos

| Requisito | Versión mínima | Notas |
| --- | --- | --- |
| **Node.js** | ≥ 18 | Necesario para Vite 5 y Vitest 2 |
| **Python** | ≥ 3.10 | Sólo stdlib; no hay `requirements.txt` a propósito |
| **Make** | cualquiera | GNU Make o BSD Make (`make -n` para inspeccionar) |

Comprobación rápida:

```bash
node --version    # v18.0.0 o superior
python3 --version # 3.10 o superior
make --version
```

### 3.2 Los cuatro comandos que importan

```bash
# 1) Instalar dependencias del launcher y preparar directorios
make setup

# 2) Ver el launcher AHORA en http://localhost:5173
make dev          # servidor de desarrollo con HMR
# o, para servir la build de producción:
make preview      # http://localhost:5173

# 3) Regenerar el índice desde las fixtures (offline) y publicarlo
make build-index  # data/ports.index.json → launcher/public/data/ports.index.json

# 4) Ejecutar las 196 pruebas automatizadas (las 3 suites)
make test
```

**Ruta completa desde cero**

```bash
git clone <repo> && cd PortsLauncher
make setup          # npm install + mkdir -p data launcher/public/data
make build-index    # genera el índice y el reporte; ~1 s, sin red
make test           # 196 tests: 9 fixtures + 106 indexador + 81 launcher
make build          # índice + build de producción en launcher/dist
make preview        # sirve la build en http://localhost:5173
```

> Si ya hay un `launcher/public/data/ports.index.json` en el repo, `make dev` funciona incluso sin
> haber ejecutado `make build-index`. Y si el índice no está, el launcher **no se rompe**: arranca
> en modo degradado con un aviso que indica exactamente qué comando ejecutar.

### 3.3 Comandos Make disponibles

| Comando | Qué hace |
| --- | --- |
| `make` / `make help` | Lista todos los comandos con descripción y colores ANSI |
| `make setup` | Versiones de `python3`/`node`/`npm`, `npm --prefix launcher install`, crea `data/` y `launcher/public/data/` |
| `make extract-fixtures` | Regenera los JSON de fixtures desde los HAR con `tools/extract_har.py` |
| `make test-fixtures` | 9 tests de integridad de fixtures (`unittest`) |
| `make test-builder` | 106 tests del indexador (`unittest discover -s catalog-builder/tests -v`) |
| `make test-launcher` | 81 tests del frontend (`vitest run`) |
| `make test` | **Las 3 suites** + reporte unificado con totales y PASS/FAIL por suite |
| `make build-index` | `builder.py --offline` + copia del índice a `launcher/public/data/` |
| `make build-launcher` | `npm --prefix launcher run build` → `launcher/dist` |
| `make build` | `build-index` y `build-launcher`, con verificación de artefactos |
| `make dev` | Servidor Vite en el puerto 5173 |
| `make preview` | Preview de la build en el puerto 5173 |

Los logs de `make test` quedan en `.test-out/` (`1-fixtures.log`, `2-builder.log`,
`3-launcher.log`) para diagnóstico cuando algo falla.

---

## 4. Las 5 vistas del catálogo

Todas las vistas comparten el mismo contrato de datos (`PortItem[]`), el mismo delegado de eventos
(`data-pid` + `data-act`) y el mismo chip de desarrollo y píldora de estado. Cambiar de vista no
recarga el catálogo: sólo se repinta el contenedor.

| Vista | Nombre | Estado | Funcionalidad y características |
| --- | --- | --- | --- |
| **Posters** | Carátulas | ✅ 100 % implementado · operativo | Rejilla de tarjetas **3:4** con `coverUrl` o carátula generativa determinista (`art(c, p)`: FNV-1a del `pid` → degradados y monograma con los colores de la plataforma). Cada tarjeta lleva tag de plataforma, chip de desarrollo, título, versión, píldora de estado, **botón primario de acción** (Instalar / Jugar / Falta ROM / Actualizar) y **⚙** si el port está en la biblioteca. Hover con glow del color neón de la plataforma. |
| **Big Grid** | Banner / Grilla Grande | ✅ 100 % implementado · operativo | Tarjetas **16:9** tipo banner, con degradado oscuro inferior e izquierdo sobre el arte, `coverUrl` real o arte generativo, tags de plataforma y desarrollo, título grande, metadatos (proyecto · estrategia · versión) y botón de acción. Pensada para explorar de un vistazo con texto legible sobre imagen. |
| **Shelves** | Estantería de Medios Retro | ✅ 100 % implementado · operativo | Estanterías agrupadas por plataforma (`.shelves` → `.shelf`), con **repisa de neón**. Cada ítem muestra el **medio físico real** en el estilo configurado (los 16 de §5), nombre centrado a 2 líneas y un **pie uniforme de 32 px** con el chip de estado y el botón ⚙ a su lado. Scroll horizontal con `scroll-snap`; es la vista que hace «sonar» el proyecto. |
| **List** | Lista Compacta | ✅ 100 % implementado · operativo | Filas `.lrow` con miniatura **56×56**, título, proyecto, estrategia de instalación, chip de desarrollo, píldora de estado, botón de acción y ⚙. Densidad alta sin perder legibilidad; acciones reveladas al hover/focus. Ideal para revisar cientos de ports de golpe. |
| **Table** | Tabla Detallada | ✅ 100 % implementado · operativo | Tabla `.tbl` **ordenable** con columnas Port · Plataforma · Estrategia · Desarrollo · Estado · Acción · ⚙. Encabezados clicables (alternan asc/desc, `aria-sort` correcto), `thead` sticky y wrapper con scroll. Es la vista de auditoría: ordenar por estado revela de inmediato cuántos ports están en `bugs` o `nodata`. |

Selector en la barra superior (`.seg`) con 5 botones; la vista elegida se persiste en los ajustes.

---

## 5. Los 16 estilos de medios retro

Todos los medios están dibujados **en CSS puro**: ni una imagen, ni un SVG, ni un sprite. Cada
silueta es un contenedor `.media` con 9 spans opcionales (`.body`, `.grill`, `.label`, `.notch`,
`.slot`, `.umd`, `.hole`, `.shine`, `.flag`) de los que cada estilo activa sólo los que necesita.
Tamaño por `--w`/`--h`, zoom fino por `--mz` (`.sz-s`, `.sz-m`, `.sz-l`, `.sz-xl`), doble
`drop-shadow` y glow por plataforma al hover.

| Estilo | Plataforma | Tipo | Dimensiones | Silueta | Rasgos visuales característicos |
| --- | --- | --- | --- | --- | --- |
| `n64` | Nintendo 64 | Cartucho | 138 × 120 | `polygon()` con dos lengüetas superiores y base biselada | Cuerpo gris-azulado en diagonal, rejilla superior, etiqueta azul con filete verde lima, ranura inferior |
| `snes` | Super Nintendo | Cartucho | 128 × 120 | `polygon()` de arco superior + radios 14/8 px | Franja violeta superior, etiqueta con banda, rejilla de ventilación |
| `nes` | NES | Cartucho | 122 × 120 | `polygon()` rectangular | Franja roja, estrías laterales, etiqueta negra, muesca inferior |
| `md` | Mega Drive | Cartucho | 126 × 120 | `polygon()` cuadrado biselado | Etiqueta roja intensa, asa superior, slot de ranura |
| `gba` | Game Boy Advance | Cartucho | 108 × 116 | `polygon()` con **esquina superior izquierda recortada** | Diagonal neón, etiqueta clara, muesca inferior |
| `gb` | Game Boy | Cartucho | 100 × 116 | `polygon()` estrecho de esquinas vivas | Cuerpo verde, LCD con **scanlines**, etiqueta rugosa, slot inferior |
| `nds` | Nintendo DS | Tarjeta | 116 × 116 | `polygon()` octogonal con esquinas superiores biseladas | Cuerpo bajo, filete magenta, etiqueta centrada |
| `n3ds` | Nintendo 3DS | Tarjeta | 120 × 112 | `polygon()` con **pestaña superior derecha** | Lengüeta lateral, filete rojo, etiqueta pequeña |
| `nsw` | Nintendo Switch | Tarjeta | 96 × 112 | `polygon()` mini con **muesca inferior derecha** | Rojo Switch, rejilla diagonal, etiqueta con borde |
| `psp` | PSP | UMD | 116 × 116 | `polygon()` de carcasa cuadrada + **ventana circular** | Ventana UMD con `conic-gradient` iridiscente, agujero central, slot de lengüeta |
| `cd` | Genérico | Disco | 116 × 116 | `border-radius: 50%` | Iridiscencia plateada completa (`conic-gradient`), hub y agujero central |
| `ps1` | PlayStation | Disco | 116 × 116 | `border-radius: 50%` | Disco negro con etiqueta plateada y anillo de licencia |
| `gcn` | GameCube | Disco | **94 × 94** (miniDVD 80 mm) | `border-radius: 50%` | Índigo translúcido, brillo especular, hub reducido |
| `xbox` | Xbox | Disco | 116 × 116 | `border-radius: 50%` | Verde translúcido, anillo interior claro, etiqueta pequeña |
| `ps2` | PlayStation 2 | Disco | 116 × 116 | `border-radius: 50%` | CD-ROM azul con franja de datos y anillo claro |
| `x360` | Xbox 360 | Disco | 116 × 116 | `border-radius: 50%` | Disco claro con anillo lima característico |

**Estratos comunes**

- **Insignia de aviso** (`.flag`): desplazada `-9px`, círculo de **24 px**, borde de `2px` en
  color `--bg` (para que «recorte» visualmente el medio), texto `13px/800` en `#14041A`. Variantes
  por `data-kind`: `warn` (falta ROM), `danger` (roto), `info` (actualizable), `ok` (listo).
- **Modos especiales**: `.is-ghost` (medio desaturado para port no instalado, con badge legible) y
  `.is-empty` (placeholder rayado para plataformas sin medio asociado).
- **Accesibilidad**: todo el sistema de medios respeta `prefers-reduced-motion` (sin transiciones)
  y `prefers-contrast`, y los medios son decorativos (`aria-hidden`) porque el nombre del juego
  siempre está presente como texto.

Selección del estilo: en ajustes se elige `single` (un estilo para todo), `auto` (derivado de la
plataforma de origen) o un `mediaMap` explícito plataforma → estilo.

---

## 6. Métricas del MVP

### 6.1 Catálogo

| Métrica | Valor |
| --- | --- |
| **Puertos unificados consolidados** | **1.166** |
| Fichas catálogo primario de entrada | 1.173 |
| Fichas catálogo secundario de entrada | 148 |
| Adaptadas a `UnifiedPort` | 1.321 |
| **Fusiones cruzadas completas** | **49** |
| **Colapsos por clave técnica idéntica** | **103** |
| Sólo catálogo primario | 1.021 |
| Sólo catálogo secundario | 96 |
| Repositorios únicos | 952 |
| Repositorios multi-ficha | 1 (5 fichas preservadas) |
| Puertos con `setupFiles` y SHA-1 validado | 9 |
| Puertos con release verificada | 143 |
| Enlaces en cuarentena | 0 |
| Fichas con `visible = false` | 160 |
| `semanticHash` del índice | `sha256:506dc84c563ae2bff924ab434a0c07e8e567447e687e2d6652e58252d0aea7d4` |

**De dónde sale 1.166.** 1.173 fichas del catálogo primario + 148 del catálogo secundario = **1.321
fichas adaptadas**. Tras la deduplicación quedan **1.166 ports** = 1.021 sólo del catálogo primario
+ 96 sólo del catálogo secundario + 49 que existen en ambas fuentes y se consolidan en un único port
con las dos procedencias en `sources[]`. En el camino se absorben 103 fichas por clave técnica
idéntica (mismo repo y mismo discriminador) y 49 por emparejamiento cruzado; `report.md` publica
todos esos contadores, así que la cuenta se puede recomputar en lugar de creerse.

**Distribución por estado** (reglas de §2.2): `experimental` 628 · `nodata` 376 · `playable` 148 ·
`bugs` 8 · `abandoned` 6.

**Distribución por plataforma de origen** (top): `pc` 294 · `other` 217 · `ps1` 199 · `x360` 133 ·
`n64` 108 · `gba` 31 · `gcn` 31 · `snes` 31 · `ps2` 25 · `nes` 21 · `xbox` 21 · `nsw` 16 ·
`psp` 16 · `gb` 12 · `md` 4 · `nds` 4 · `n3ds` 3.

### 6.2 Calidad

| Métrica | Valor |
| --- | --- |
| **Tests automatizados superados** | **196 / 196 (100 %)** |
| Tests de fixtures (`tools/test_fixtures.py`) | 9 |
| Tests del indexador (`catalog-builder/tests/`) | 106 |
| Tests del launcher (`launcher/tests/`, Vitest) | 81 |
| Dependencias externas en Python | **0** (stdlib puro) |
| Estilos de medios físicos en CSS puro | **16** (sin imágenes ni SVG) |
| Frameworks de UI en el frontend | **0** (DOM vanilla modular) |
| DevDependencies del frontend | 3 (`vite`, `typescript`, `vitest`) |

---

## 7. Calidad y pruebas

```bash
make test          # las 3 suites + reporte unificado
make test-builder  # sólo indexador, con -v
make test-launcher # sólo frontend
```

**`tools/test_fixtures.py` (9 tests)** — guardianes de las fixtures: totales y estado del catálogo
fechado, tipos de fuente, repos y `enabled` de GitHub, conteos por pestaña, metadatos de seguridad,
y la estructura `{ apps: [...] }` de `emulators.json` (88 entradas) y `webgames.json` (200).

**`catalog-builder/tests/` (106 tests)** — cuatro módulos:

- `test_adapters.py` — limpieza de sufijo, cuarentena de URLs, mapeo de plataformas (23 casos),
  `enabled → visible`, validación SHA-1, `romProfile.binding`, `playerFeedback`, `verifiedRelease`,
  y ejecución contra las fixtures reales.
- `test_dedup.py` — estabilidad de la clave técnica, los 5 casos de repo multi-ficha que **no**
  deben colapsarse, precedencias de `merge_ports`, uniones sin duplicados, `generate_pid`
  URL-friendly con entradas adversas (tildes, `™`, emoji, signos).
- `test_status.py` — las 6 reglas en orden estricto (incluyendo pruebas de que una regla anterior
  gana a una posterior), fronteras de los umbrales (70 %, 5 reviews, 547 días, 30 días) y contrato
  de `StatusInfo`.
- `test_builder.py` — ejecución offline con fixtures sintéticas en `tempfile`, estructura exacta
  del índice, coherencia de `stats`, ausencia de enlaces en cuarentena, y **determinismo**:
  dos ejecuciones → mismo `semanticHash` y mismo número de puertos, con independencia de los
  campos volátiles.

**`launcher/tests/` (81 tests)** —

- `catalogService.test.ts` — carga con `fetch` stubbeado y degradación segura, búsqueda con
  diacríticos/tags/aliases/proyecto, AND por tokens, filtros por plataforma/desarrollo/destino/
  estrategia/estado de biblioteca, los 5 modos de orden, `getDevTagInfo` y agregados.
- `libraryService.test.ts` — estado inicial seguro, persistencia con almacén falso (incluido fallo
  de cuota), saneado de datos corruptos, transiciones de estado, manejo de ROM, conteos,
  import/export y reseteo.

---

## 8. Decisiones de diseño

**Por qué un indexador propio y no consumir la fuente en vivo.**
Depender del sitio de turno significa que el día que cambie su HTML o su API, el launcher deja de
funcionar para todos. Un índice estático + hash semántico convierte el catálogo en un **artefacto
versionable**: se puede revisar en un diff, auditar y servir desde un CDN sin tocar el cliente.

**Por qué el vocabulario cerrado de plataformas.**
Las distintas fuentes de catálogo nombran las plataformas de 71 maneras distintas. Normalizar a 17
valores (`n64`, `snes`, `nes`, `md`, `gba`, `gb`, `nds`, `n3ds`, `nsw`, `psp`, `ps1`, `ps2`, `gcn`,
`xbox`, `x360`, `pc`, `other`) hace que filtros, contadores, colores y siluetas de medio sean
**finitos y verificables**, en lugar de un `string` libre que hay que adivinar en cada vista.

**Por qué la clave técnica no usa el nombre del juego.**
Dos ports del mismo juego para la misma plataforma son legítimamente dos fichas distintas (distinta
recompilación, distinto repo, distinto mantenedor). La clave incluye repositorio **y** discriminador
(filtro de assets / carpeta / nombre) para que la deduplicación fusione duplicados reales y no
proyectos hermanos.

**Precedencias de consolidación entre catálogos.**
`sourcePlatform` y `requiresUserFiles` los decide la fuente primaria (es más rica en datos de
plataforma y de ficheros de usuario); `setupFiles` con SHA-1 y `playerFeedback` los decide la fuente
secundaria (es la que los publica verificados); `targetPlatforms`, `tags`, `searchAliases` y
`gameNames` se **unen** sin duplicados; para portada se elige la de mayor resolución declarada;
`romProfile` pasa a `binding = place` en cuanto hay hashes verificados; y entre dos estrategias de
instalación gana la más específica (`release-appimage` > `release-archive` > … > `needsChoice` >
`external`).

**Por qué el estado es una función pura y ordenada.**
Un port puede cumplir varias condiciones a la vez (experimental *y* con bugs). Un orden estricto y
documentado hace el resultado **explicable**: el `StatusInfo` incluye la regla ganadora, el texto de
la razón y la versión de reglas, así que cuando una etiqueta sorprende, la UI puede justificarla.

**Por qué no hay framework en el frontend.**
Las 5 vistas son listas con el mismo contrato de datos. Un `render() → string` + delegación de
eventos por atributos resuelve el 100 % de los casos sin estado reactivo, sin reconciliación y sin
dependencias. El coste es disciplina (nada de listeners ad-hoc dentro del HTML), y el beneficio es
un bundle mínimo y un arranque instantáneo.

**Por qué la biblioteca tiene fallback en memoria.**
`localStorage` falla más de lo que parece: modo privado, cuota llena, políticas de terceros. El
servicio detecta con una escritura de sonda, cae a memoria y expone `isPersistent()` para que la UI
avise en lugar de perder silenciosamente las instalaciones del usuario.

---

## 9. Limitaciones conocidas y hoja de ruta

**Limitaciones actuales (honestas)**

- El **instalador es una simulación**: implementa la máquina de estados completa (progreso,
  cancelación, transiciones, `NeedsRom`/`Ready`), pero todavía no descarga ni extrae artefactos
  reales. Es el siguiente paso natural y no requiere cambios en la UI.
- La estrategia de instalación del índice actual es `external` en el 100 % de los ports: el
  catálogo enlaza al proyecto original en lugar de alojar binarios.
- La validación de ROM comprueba extensión y, opcionalmente, SHA-1 con WebCrypto; no valida
  cabeceras internas del fichero (iNES, N64 `.z64`) ni parches.
- `fetch` de catálogo sólo soporta carga estática; no hay actualización incremental ni delta.
- El CSS usa `color-mix()` y `conic-gradient` (navegadores de 2023 en adelante).

**Hoja de ruta**

1. Instalador real: descarga con `fetch` + streaming, verificación SHA-256, extracción de archivos
   (zip/tar) y ejecución con perfil de lanzamiento por port (Proton/Wine para `windows-via-proton`).
2. Actualizaciones: comparación `installedVersion` vs `verifiedRelease.version` con canal
   estable/prerelease y `pinnedVersion` por juego (la UI ya muestra el estado `UpdateAvailable`).
3. Ampliar fuentes del indexador (más catálogos comunitarios) reutilizando el mismo contrato
   `UnifiedPort`, y publicar el índice con firma.
4. Empaquetado del launcher como aplicación de escritorio (Tauri/Electron) reutilizando el mismo
   `dist/` sin cambios de código.
5. Accesibilidad: auditoría completa con teclado y lector de pantalla en las 5 vistas.

---

## 10. Créditos y atribución

- **Catálogos comunitarios**: origen de los datos de catálogo (fichas, metadatos, versiones y
  feedback de comunidad). Este proyecto **no aloja binarios**: enlaza a los repositorios y
  releases originales de cada autor, y todos los ports pertenecen a sus respectivos creadores.
- Las marcas, nombres de consola y logotipos referenciados pertenecen a sus titulares; los medios
  retro de este proyecto son **interpretaciones gráficas en CSS**, no reproducciones oficiales.
- Tipografías: *Chakra Petch*, *DM Sans* y *JetBrains Mono* (Google Fonts, licencias SIL OFL), con
  fallbacks locales y de sistema.
- El código del indexador y del launcher se distribuye para uso personal y educativo; respeta las
  licencias de cada port al instalarlo.

---

## 11. Ecosistema de Plugins

PortsLauncher cuenta con una especificación abierta para la integración de herramientas y extensiones externas (compilación, extracción y aprovisionamiento de assets locales).

Consulta la guía técnica completa en [docs/PLUGINS.md](docs/PLUGINS.md).

---

## 12. Aviso Legal y Términos de Uso

PortsLauncher es un gestor de librerías para puertos de código abierto que no distribuye, no aloja ni incentiva la descarga de contenido con copyright. Consulta los términos legales completos en [docs/LEGAL.md](docs/LEGAL.md).

---

<sub>PortsHub · índice `1.0.0` · esquema `1.0.0` · 1.166 ports · 196 tests · hecho con Python stdlib
y CSS a mano.</sub>
