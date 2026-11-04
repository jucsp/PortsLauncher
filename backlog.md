# Product Backlog — PortsLauncher

## HU-01: Eliminación de Siembra Simulada y Modo Producción por defecto
- **Objetivo:** Eliminar `seedLibrary` en `launcher/src/main.ts` y cualquier inicialización de ports falsos en memoria. Si no hay ports instalados, la biblioteca arranca limpia y vacía.
- **Capa:** Frontend (`launcher/src/main.ts`, `launcher/src/ui/model.ts`).
- **Criterios de Aceptación:**
  1. Al arrancar sin ports instalados, la biblioteca muestra 0 ports instalados y no fuerza los 5 ports emblemáticos.
  2. Tests unitarios actualizados y pasando al 100%.

## HU-02: Pipeline de Instalación Real de Ports (Releases / ZIP / Repo)
- **Objetivo:** El botón de instalación debe comunicarse con el backend real (`/api/install`), descargar el release (.zip, .tar.gz, .appimage) o clonar el repo, extraer en `~/PortsLauncher/ports/<folderName>` y dar permisos de ejecución.
- **Capa:** Backend (`launcher/electron/api.cjs`) y Frontend (`launcher/src/main.ts`, `launcher/src/services/installerService.ts`).
- **Criterios de Aceptación:**
  1. La instalación en UI invoca la API real y no un bucle de simulación con sleep.
  2. Permite cancelar la instalación limpiamente.
  3. Tests unitarios pasando.

## HU-03: Botón para Abrir Repositorio en Navegador Real
- **Objetivo:** Quitar todos los toasts de "Abriría el repositorio en una pestaña nueva (simulado)". En Electron o navegador, abrir directamente la URL externa en el navegador del usuario usando `window.open` o endpoint / handler de Electron `shell.openExternal`.
- **Capa:** Frontend (`launcher/src/main.ts`, `launcher/src/ui/render.ts`) y Backend (`launcher/electron/api.cjs` si se requiere endpoint o IPC).
- **Criterios de Aceptación:**
  1. Los botones "Abrir en GitHub" y acciones de repositorio abren el navegador real con la URL de GitHub.
  2. Cero menciones a "(simulado)".

## HU-04: Manejo de Errores, Reporte Técnico y Notificación Interactiva
- **Objetivo:** Ante cualquier error en instalación o ejecución, generar un reporte técnico en `~/PortsLauncher/logs/error-<pid>-<timestamp>.txt`. Mostrar un modal interactivo con el mensaje claro, la ruta donde quedó el reporte y dos botones: "Abrir reporte" (abre el log en el visor del sistema o editor) y "Cerrar".
- **Capa:** Backend (`launcher/electron/api.cjs`), Frontend (`launcher/src/main.ts`, `launcher/src/ui/`).
- **Criterios de Aceptación:**
  1. Reporte técnico generado en disco con detalles de entorno, error, stack trace y comando.
  2. Modal de error interactivo con opción de abrir el reporte o cerrar.

## HU-05: Sistema de Plugins Real y Sin Mockups
- **Objetivo:** Eliminar `defaultAddons()` con plugins de ejemplo/mock. Implementar detección real escaneando la carpeta de plugins (`~/.local/share/portslauncher/plugins/` o `~/PortsLauncher/plugins/`), leyendo los `plugin.json` existentes.
- **Capa:** Frontend / Backend (`launcher/src/services/libraryService.ts`, `launcher/electron/api.cjs`, `launcher/src/main.ts`).
- **Criterios de Aceptación:**
  1. No hay addons simulados ni mockups en fábrica.
  2. Si hay carpetas con `plugin.json` válidos en el directorio de plugins, se listan y reconocen.

## HU-06: Saneamiento de Documentación README
- **Objetivo:** Quitar toda alusión o mención a Quiver o GameWave del `README.md`, dejando una documentación limpia enfocada en PortsLauncher.
- **Capa:** Documentación (`README.md`).
- **Criterios de Aceptación:**
  1. `grep -i -E "quiver|gamewave" README.md` devuelve 0 resultados.
  2. La redacción y tablas mantienen coherencia técnica.

## HU-07: Addon Vimm's Vault para Provisión de ROMs (Opción A Asistida)
- **Objetivo:** Construir desde cero el addon `vimm-vault` en `~/PortsLauncher/plugins/vimm-vault/` conforme a `docs/PLUGINS.md`. Debe permitir buscar ROMs exactas en Vimm (por nombre, región como USA y versión como 1.0) y coordinar el aprovisionamiento hacia el directorio del port correspondiente.
- **Capa:** Addon / Plugins (`~/PortsLauncher/plugins/vimm-vault/`).
- **Criterios de Aceptación:**
  1. `plugin.json` estructurado con `$schema`, `type: "asset-provider"` y capacidades `["search", "provision"]`.
  2. `python3 main.py check` responde JSON con estado operativo sin dependencias externas complejas.
  3. `python3 main.py search "<titulo>" --platform <plataforma>` devuelve JSON estructurado con títulos, versiones (ej. 1.0), regiones (USA, Europa, Japón) y Vault IDs.
  4. Soporta filtrado de versión y región exacta.
  5. `provision` coordina la apertura en navegador para resolución de Turnstile y monitoreo/colocación en `--output`.
  6. Suite de pruebas ejecutada con 5-10 casos de test reales y limpieza total de archivos temporales.

## HU-08: Sincronización Bidireccional de Biblioteca y Persistencia en ports.json
- **Objetivo:** Persistir la biblioteca real en disco en `~/PortsLauncher/ports.json` de forma bidireccional y elevar la versión del paquete a 0.1.6. Al iniciar, el launcher hidrata la biblioteca leyendo `ports.json` para que los ports existentes y los instalados manualmente aparezcan en la interfaz sin depender únicamente del localStorage.
- **Capa:** Backend (`launcher/electron/api.cjs`) y Frontend/Servicio (`launcher/src/services/libraryService.ts`, `launcher/src/main.ts`, `launcher/package.json`).
- **Criterios de Aceptación:**
  1. `package.json` declara versión `0.1.6`.
  2. `GET /api/library` lee `~/PortsLauncher/ports.json` y `POST /api/library` guarda cambios.
  3. Al iniciar, `init()` hidrata `libraryService` desde disco.
  4. Los ports instalados manualmente en disco con sus PIDs reales se visualizan en la interfaz como instalados y listos.

## HU-09: Persistencia de Ajustes (SteamGrid API Key, Onboarding) y Progreso de Descarga de Arte
- **Objetivo:** Persistir `onboardingDone` y la API Key de SteamGridDB de forma permanente en `~/PortsLauncher/ports.json` y en `~/.steamgrid_credentials.env`. Evitar que el asistente inicial vuelva a pedir la clave en cada arranque si ya se completó o si la clave ya existe en disco. Persistir además el progreso del motor de sincronización de carátulas (`autoSyncTried`) y priorizar los ports instalados en la biblioteca.
- **Capa:** Backend (`launcher/electron/api.cjs`) y Frontend (`launcher/src/main.ts`, `launcher/src/services/libraryService.ts`).
- **Criterios de Aceptación:**
  1. `saveState()` sincroniza siempre los ajustes con `libraryService` y disco (`ports.json`).
  2. `init()` fusiona los ajustes de disco (`onboardingDone`, `steamgridApiKey`, `steamgridAutoSync`) y no vuelve a mostrar el asistente tras completarse.
  3. La clave se sincroniza y almacena también en `~/.steamgrid_credentials.env` vía `POST /api/steamgrid/__save-key`.
  4. El progreso de descarga de imágenes persiste los juegos intentados en almacenamiento local y atiende primero los ports instalados de la biblioteca.

## HU-10: Robustez del Servidor Estático en Electron (readFile y blindaje statSync)
- **Objetivo:** Eliminar el uso de `fs.createReadStream` en `serveStatic()` de `main.cjs` que provocaba fallos `Uncaught Exception: ENOENT` sobre archivos virtuales dentro de `app.asar`. Migrar a `fs.readFile` con control explícito de errores (404/500) y blindar la llamada a `statSync` en un bloque `try/catch`.
- **Capa:** Backend Electron (`launcher/electron/main.cjs`).
- **Criterios de Aceptación:**
  1. `serveStatic` no usa streams sin listener de error.
  2. Todo fallo de lectura de archivos estáticos dentro o fuera de `app.asar` responde con código HTTP y no mata el proceso principal de Electron.
## HU-11: Integración y Ejecución de Addons desde la Interfaz de Usuario
- **Contexto de Negocio:** El usuario cuenta con addons instalados (ej. Vimm's Vault para Nintendo 64), pero en la interfaz gráfica del port o asistente de ROM no existe un mecanismo para ejecutarlos; obligaba al usuario a usar la terminal manualmente. Un addon debe integrarse transparentemente en PortsLauncher para buscar y aprovisionar ROMs con un solo clic.
- **Objetivo:**
  1. Backend: Implementar endpoints en `launcher/electron/api.cjs` (`POST /api/plugins/search` y `POST /api/plugins/provision`) para invocar el ejecutable de los plugins activos de forma desacoplada y segura.
  2. Frontend: En la vista de detalle del port y en el Asistente de ROMs (`RomAssistantModal.ts` / `main.ts` / `render.ts`), cuando un port requiera ROM o el usuario configure la ROM y exista un plugin activo con capacidad `search`/`provision` para la plataforma del port:
     - Mostrar un botón o sección interactiva con el addon (ej: "Buscar ROM con Vimm's Vault").
     - Mostrar resultados de búsqueda con selector de versión/región.
     - Permitir iniciar el aprovisionamiento, mostrando el progreso en la UI mientras el plugin coordina la descarga y coloca el archivo en el directorio del port.
- **Capa:** Backend (`launcher/electron/api.cjs`), Frontend (`launcher/src/components/RomAssistantModal.ts`, `launcher/src/main.ts`, `launcher/src/ui/render.ts`, `launcher/src/services/types.ts`).
- **Criterios de Aceptación:**
  1. `POST /api/plugins/search` ejecuta `python3 <dir>/main.py search "<q>" --platform <plat>` y devuelve la lista de resultados en formato JSON.
  2. `POST /api/plugins/provision` ejecuta `python3 <dir>/main.py provision "<asset_id>" --output "<dir>"` y retorna el resultado (outputPath y sha1).
  3. En la ficha del juego o asistente de ROMs, el usuario puede buscar y aprovisionar la ROM directamente sin salir de PortsLauncher.
  4. Suite de pruebas pasando al 100%.


## HU-12: Versión Dinámica e Inyectada en Build y Diagnóstico Resiliente de Actualizaciones
- **Estado:** Completado (Tag v0.1.9) — Responsable: DeepSeek (Dev) / Claude (QA)
- **Objetivo:** Inyectar la versión de la aplicación en tiempo de build (sin valores hardcodeados) y hacer resiliente el diagnóstico de actualizaciones ante fallos de red o respuestas inválidas.
- **Criterios de Aceptación:**
  1. La versión mostrada en la UI proviene de la inyección en build.
  2. El diagnóstico de actualizaciones maneja errores sin interrumpir la aplicación.
  3. Suite de pruebas pasando al 100%.

## HU-13: Soporte Universal de ROMs, Búsqueda Limpia de Addons y Ejecución Fiable de Ports
- **Contexto de Negocio:**
  El usuario detectó que ports comunitarios como 2 Ship 2 Harkinian muestran "Este port no necesita ROM", cuando todos los ports necesitan su ROM para extraer o vincular assets. Además, el addon de búsqueda de ROMs fallaba porque se buscaba el nombre del port en lugar del nombre del juego, y el botón Jugar no abría el port debido a argumentos con `{rom}` no sustituidos y falta de enlace de ROM en el directorio del port.
- **Objetivo:**
  1. Universalizar el requerimiento de ROM: en `ui/model.ts` y en la UI, todos los ports solicitan y gestionan ROM sin excepciones. Inferir extensiones por plataforma si no vienen explícitas.
  2. Extraer el nombre limpio del juego para búsquedas de addons (ej. tomar lo que está entre paréntesis o remover nombres de port de descompilación).
  3. Sustituir `{rom}` por la ruta real en `launchReal` / `handleLaunch`, crear enlace simbólico de la ROM en la carpeta del port si se requiere para su ejecución, y detectar fallos tempranos de proceso.
  4. Parsear cadenas de proyectos serializadas como diccionarios de Python (`{'key': '...', 'name': '...'}`) en `projectOf()`.
- **Capa:** Frontend (`launcher/src/ui/model.ts`, `launcher/src/main.ts`) y Backend (`launcher/electron/api.cjs`).
- **Criterios de Aceptación:**
## HU-14: Instalación y Actualización Real del Launcher con Soporte de Elevación (pkexec/UAC) y Reinicio Limpio
- **Contexto de Negocio:**
  Al pulsar actualizar en la aplicación, el launcher descargaba el binario en ~/Downloads y notificaba "Lanzando actualización", pero no reemplazaba la instalación existente ni cerraba la instancia previa. Si el launcher está instalado en una ruta de sistema (ej. /opt/PortsLauncher) o en espacio de usuario (~/.local/share/PortsLauncher o AppImage), la actualización debe sustituir físicamente la versión instalada, solicitar autorización mediante elevación nativa (pkexec en Linux / UAC en Windows) si la ruta requiere permisos administrativos, y reiniciar automáticamente la aplicación en la nueva versión.
- **Objetivo:**
  1. Detectar el destino de instalación real: `process.env.APPIMAGE` si se ejecuta como AppImage, o `path.dirname(process.execPath)` si se ejecuta instalado.
  2. Comprobar permisos de escritura en la ruta de destino. Si es de usuario (ej. ~/.local/share/PortsLauncher), aplicar reemplazo directo sin elevar. Si requiere permisos de root (ej. /opt/PortsLauncher), solicitar autenticación gráfica con `pkexec` (Linux) o `Start-Process -Verb RunAs` (Windows).
  3. En Linux con AppImage: extraer el contenido actualizado (`--appimage-extract`) para actualizar carpetas instaladas, o reemplazar el fichero AppImage si corre en modo portable. Actualizar también el acceso directo `.desktop` del usuario si existe.
  4. Script de transición desacoplado: esperar que el PID actual cierre, reemplazar archivos atómicamente, arrancar la nueva versión y cerrar la instancia anterior mediante `app.quit()`.
  5. UI reactiva: mostrar estados claros (Descargando → Instalando / Solicitando autorización → Reiniciando).
- **Capa:** Backend (`launcher/electron/api.cjs`, `launcher/electron/main.cjs`) y Frontend (`launcher/src/main.ts`, `launcher/src/ui/render.ts`).
- **Criterios de Aceptación:**
  1. Al pulsar actualizar, la instalación existente se actualiza efectivamente en disco.
  2. Si la ruta requiere root, se solicita autenticación gráfica (`pkexec`) al usuario de forma transparente.
  3. Si la ruta es de usuario, se actualiza silenciosamente sin pedir sudo innecesario.
  4. La aplicación se reinicia en la versión descargada (0.1.10).
  5. Suite de pruebas pasando al 100%.

## HU-15: Soporte de Provisión Multi-archivo y Carpetas para ROMs (.cue + .bin, .gdi, directorios)
- **Contexto de Negocio:**
  Muchos juegos clásicos (PlayStation 1, Saturn, Sega CD, Dreamcast, PC CD-ROM) no consisten en un único archivo, sino en conjuntos multi-archivo como hojas de índice `.cue` acompañadas de una o más pistas `.bin` de datos y audio, archivos `.gdi` con múltiples pistas, o incluso carpetas completas de datos de juego y BIOS. Actualmente, el asistente de ROMs solo permite seleccionar un único archivo y el backend únicamente enlaza/copia ese archivo solitario, dejando atrás los `.bin` y provocando que el port o recompilador falle al no encontrar las pistas de audio o datos. Se requiere permitir la selección y arrastre de múltiples archivos o una carpeta completa, así como la vinculación/copia inteligente de todos los archivos asociados en la carpeta del port.
- **Objetivo:**
  1. Frontend: Permitir arrastrar múltiples archivos o carpetas al dropzone de ROMs, y habilitar selección múltiple (`multiple`) y selección de carpeta (`webkitdirectory`) en el diálogo de selección.
  2. Detección Inteligente: Cuando se aportan múltiples archivos, detectar automáticamente el descriptor principal de lanzamiento (`.cue`, `.gdi`, `.m3u`, `.iso`, etc.), registrarlo como archivo principal de ROM y mostrar en la UI los archivos complementarios incluidos (ej. "+2 pistas .bin detectadas").
  3. Backend (`linkRomForLaunch` en `api.cjs`):
     - Si la ROM es un archivo `.cue` o `.gdi`, analizar sus pistas referenciadas (`FILE "..." BINARY`) y crear enlaces simbólicos (o copias) en `installDir` para cada pista `.bin`/datos compañera que resida en el mismo directorio.
     - Si la entrada es un directorio, enlazar o copiar el contenido del directorio en `installDir` o registrar la carpeta.
  4. Modo de copia: Copiar todos los archivos asociados a la carpeta del port si se elige "Copiar a la carpeta del port".
  5. Versionado e Incremento: Actualizar la versión a v0.1.12 en `launcher/package.json`.
- **Capa:** Frontend (`launcher/src/components/RomAssistantModal.ts`, `launcher/src/main.ts`) y Backend (`launcher/electron/api.cjs`).
- **Criterios de Aceptación:**
  1. El usuario puede arrastrar múltiples archivos (`.cue` + `.bin`) o una carpeta completa al asistente de ROM.
  2. Al lanzar un port con `.cue`, tanto el `.cue` como sus archivos `.bin` asociados quedan enlazados o disponibles en el directorio de ejecución del port.
  3. `make test` supera todas las pruebas (100% verde).

## HU-16: Actualizador Nativo con Detección de Distro (.rpm/.deb), Progreso Visual y Auto-instalación con Polkit
- **Contexto de Negocio:**
  En lugar de redirigir al navegador para descargar manualmente un archivo AppImage genérico, el lanzador debe permitir la actualización integral desde la propia app. Debe detectar si el sistema anfitrión es Fedora/RHEL (.rpm), Debian/Ubuntu (.deb) o Windows (.exe) (usando AppImage solo como fallback en distros no soportadas o no paquetizadas), descargar el instalador adecuado mostrando una barra de progreso visual interactiva en tiempo real, e iniciar automáticamente la instalación solicitando la contraseña del usuario mediante el agente gráfico de PolicyKit (PackageKit pkcon o pkexec) de ser necesario.
- **Objetivo:**
  1. Backend (api.cjs):
     - Detección de plataforma y distro Linux (/etc/os-release) para determinar formato preferente: Fedora/RHEL/CentOS/openSUSE -> 'rpm'; Ubuntu/Debian/Mint/Pop -> 'deb'; Windows -> 'exe'; Otros -> 'appimage'.
     - Exponer endpoint o información de formato nativo (o detección integrada).
     - Soporte de streaming o reporte de progreso de descarga hacia el frontend (SSE o polling/stream de bytes descargados y totales).
     - Instalador nativo para paquetes RPM (mediante pkcon install-local --plain --allow-untrusted o pkexec rpm/dnf) y DEB (pkcon o pkexec apt/dpkg).
  2. Frontend (updateService.ts, render.ts, main.ts):
     - El botón debe decir 'Actualizar a vX.Y.Z' en lugar de 'Descargar...'.
     - Selección de asset nativo (.rpm para Fedora, etc.) en lugar de asumir .appimage por defecto.
     - Barra de progreso visual con porcentaje y estado ('Descargando 45%...', 'Instalando actualización...', 'Solicitando credenciales...').
     - Eliminar cualquier redirección o window.open al navegador.
  3. Bump de versión: Actualizar a v0.1.13 en launcher/package.json.
- **Capa:** Backend (launcher/electron/api.cjs) y Frontend (launcher/src/services/updateService.ts, launcher/src/ui/render.ts, launcher/src/main.ts).
- **Criterios de Aceptación:**
  1. La comprobación de actualización identifica el instalador .rpm en Fedora/KDE.
  2. Al pulsar 'Actualizar', no se abre el navegador; se inicia la descarga directa con barra de progreso visible.
  3. Al terminar la descarga, se inicia la instalación automática solicitando contraseña de administrador si se requiere.
  4. make test supera el 100% de las pruebas existentes y nuevas.

## HU-17: Normalización de launch y enriquecimiento de romProfile en catalog-builder
- **Contexto de Negocio:**
  Al ingestar datos de catálogos comunitarios (como Quiver o Recomp.fyi), campos como `launch.preferredExecutables` a veces se serializaban como cadenas erróneas de Python (ej: `["{'windows': ['...']}"]`) y `romProfile` quedaba con arrays de extensiones vacíos `[]` a pesar de tratarse de consolas con formatos de disco bien conocidos (PS1, N64) o ports de recompilación que exigen versiones específicas de ROM y volcados de BIOS. El catalog builder debe sanitizar la estructura de ejecución y enriquecer automáticamente el perfil de ROM para guiar con precisión al usuario.
- **Objetivo:**
  1. En `catalog-builder/adapters/quiver.py`:
     - Sanitizar `preferredExecutables`: si los elementos son diccionarios o strings que representan diccionarios Python/JSON, desempaquetar y normalizar a nombres de archivo limpios o mapas de plataforma válidos, evitando serializaciones corruptas como `str(dict)`.
  2. En `catalog-builder/` (adaptadores y deduplicador):
     - Enriquecer `romProfile`: si el port pertenece a una plataforma conocida (PS1, N64, etc.) o framework conocido (PSXRecomp, N64Recomp) y no declara extensiones:
       - Poblar extensiones válidas de la plataforma (ej. PS1: `.cue`, `.bin`, `.chd`, `.iso`, `.pbp`).
       - Indicar notas claras en `romProfile.notes` señalando la necesidad de ROM específica según la documentación del autor y BIOS requerida.
  3. Tests unitarios en `catalog-builder/tests/` validando la sanitización de `launch` y el enriquecimiento de `romProfile`.
- **Capa:** Catalog Builder (`catalog-builder/adapters/quiver.py`, `catalog-builder/models.py`, `catalog-builder/tests/`).
- **Criterios de Aceptación:**
  1. Ningún puerto en `ports.index.json` contiene strings de diccionarios Python en `preferredExecutables`.
  2. Ports de consolas reconocidas sin extensiones declaradas reciben las extensiones estándar de su plataforma.
  3. Tests unitarios de catalog-builder pasando al 100%.

## HU-18: Disclaimer de Compatibilidad, Enlace a Documentación y Gestión de Ejecutables en Launcher
- **Contexto de Negocio:**
  Cada source port empaqueta sus ejecutables, dependencias y argumentos de ROM de manera única según el criterio del autor de GitHub. El usuario necesita un aviso claro (disclaimer) en el launcher explicando que el ejecutable y los parámetros pueden variar y que se debe consultar la documentación oficial, acompañado de un acceso directo al repositorio del autor. Además, la selección de ROM debe persistir en `ports.json` de manera infalible y el launcher debe reconocer binarios compilados en carpetas de build (como `build-release/`).
- **Objetivo:**
  1. **Disclaimer Informativo y Enlace a Documentación:**
     - En `launcher/src/components/DetailModal.ts` (sección de Requisitos / Instalación): incorporar un bloque de aviso destacado indicando que el ejecutable y los parámetros de ROM pueden variar según el repositorio y recomendando revisar la documentación del autor, con un botón interactivo para abrir el repositorio o documentación oficial.
     - En `launcher/src/components/RomAssistantModal.ts` y en el modal de ROMs de `launcher/src/main.ts`: mostrar el mismo aviso de compatibilidad con botón directo a la documentación del autor.
  2. **Persistencia de ROM en `ports.json`:**
     - En `launcher/src/main.ts` (`saveRom`), sincronizar explícitamente con `libraryService.setRom(id, romPath, romMode, true)` para que la ROM seleccionada quede persistida en `~/PortsLauncher/ports.json` y no se borre al actualizar o recargar.
  3. **Detección Avanzada de Ejecutables en `api.cjs`:**
     - En `launcher/electron/api.cjs` (`findMainExecutable`), contemplar ejecutables generados en subcarpetas de compilación como `build-release/` priorizándolos frente a asistentes de setup ya finalizados.
  4. **Bump de versión:**
     - Incrementar versión a `0.1.14` en `launcher/package.json`.
- **Capa:** Frontend (`launcher/src/components/DetailModal.ts`, `launcher/src/components/RomAssistantModal.ts`, `launcher/src/main.ts`, `launcher/package.json`) y Backend (`launcher/electron/api.cjs`).
- **Criterios de Aceptación:**
  1. El disclaimer y botón a la documentación del autor aparecen visibles y funcionales en el detalle del port y en el asistente de ROM.
  2. La ROM guardada se persiste en `~/PortsLauncher/ports.json`.
  3. `make test` supera el 100% de las pruebas (fixtures + indexador + launcher).


## HU-19: Corrección de Auto-instalador Nativo (pkcon no interactivo, captura de logs y fallback a pkexec)
- **Contexto de Negocio:**
  En Fedora y otras distribuciones Linux que utilizan PackageKit (`pkcon`), el auto-actualizador fallaba silenciosamente tras descargar el paquete `.rpm`, relanzando la versión vieja. Esto ocurría porque `pkcon install-local` se ejecutaba sin `-y`, esperando confirmación por stdin en un proceso desacoplado sin terminal interactiva, provocando que `pkcon` abortara de inmediato. Además, la salida del comando no se guardaba en el log y no había un mecanismo de respaldo con `pkexec`.
- **Objetivo:**
  1. En `launcher/electron/api.cjs` (`resolveInstallerCommand`):
     - Anteponer `-y`, `--plain` y `--allow-untrusted` al subcomando `install-local` para garantizar ejecución no interactiva.
     - Configurar comandos de respaldo (`fallbackCommand` y `fallbackArgs`) para reintentar automáticamente con `pkexec rpm -Uvh --replacepkgs` (o `pkexec apt-get install -y` en Debian/Ubuntu).
  2. En `launcher/electron/api.cjs` (`buildPosixWaitScript`):
     - Redirigir `stdout` y `stderr` a `$LOG` (`self-update.log`) con protección `</dev/null` y registrar códigos de retorno `$rc` reales.
     - Ejecutar el reintento de instalación con `pkexec` si `pkcon` termina con código de error.
  3. En `launcher/tests/selfUpdate.test.ts`:
     - Añadir y actualizar suites de prueba unitarias cubriendo las banderas no interactivas, redirecciones y secuencia de reintento.
  4. Versionado:
     - Bump de versión a `0.1.15` en `launcher/package.json`.
- **Capa:** Backend (`launcher/electron/api.cjs`, `launcher/tests/selfUpdate.test.ts`, `launcher/package.json`).
- **Criterios de Aceptación:**
  1. El paquete se instala de forma no interactiva con `pkcon` y, en caso de fallo, reintenta con `pkexec`.
  2. Toda la salida y códigos de error se registran detalladamente en `~/PortsLauncher/logs/self-update.log`.
  3. La suite de pruebas pasa al 100% (417 tests).

## HU-20: Selector y Explorador de Ejecutable Multiplataforma y Argumentos Opcionales
- **Contexto de Negocio:**
  En la configuración avanzada del port (drawer del engranaje ⚙), los usuarios debían escribir manualmente la ruta del binario ejecutable (ej. `./DinoCrisis`). Para mejorar la experiencia de usuario y evitar errores tipográficos en cualquier sistema operativo (Linux, Windows, macOS), se requiere poder seleccionar el ejecutable directamente desde una lista de binarios detectados en la carpeta del port o abrir el explorador de archivos nativo mediante un botón «Examinar…». Asimismo, el campo de argumentos debe ser explícitamente opcional (sin forzar `--rom {rom}` cuando el juego no lo requiere).
- **Objetivo:**
  1. Backend (`launcher/electron/api.cjs`):
     - Implementar `listPortExecutables(dir, hint)` con soporte para carpetas secundarias de compilación (`build-release/`, `build/`).
     - Exponer endpoint `GET /api/port-executables` para devolver la lista de binarios candidatos detectados ordenados por relevancia.
  2. Frontend (`launcher/src/main.ts` y `launcher/src/ui/model.ts`):
     - En `toGame`: no forzar `--rom {rom}` por defecto; dejar `args` vacío si el port o biblioteca no especifican argumentos.
     - En el drawer de configuración ⚙: añadir botón «Examinar…» que activa el selector de archivos del SO, normaliza la ruta a formato relativo multiplataforma `./rel/path` si reside dentro de la carpeta del port, y selector desplegable para escoger entre los ejecutables detectados en el directorio.
     - Campo de argumentos etiquetado como `(opcional)` con su correspondiente placeholder.
  3. Pruebas:
     - 14 nuevas pruebas unitarias en `launcher/tests/api.test.ts` y `launcher/tests/model.test.ts` cubriendo la detección de ejecutables, enrutado de la API y argumentos opcionales. Total: 431 pruebas superadas al 100%.
  4. Versionado:
     - Incremento de versión a `0.1.16` en `launcher/package.json`.
- **Capa:** Backend (`launcher/electron/api.cjs`, `launcher/tests/api.test.ts`) y Frontend (`launcher/src/main.ts`, `launcher/src/ui/model.ts`, `launcher/tests/model.test.ts`).
- **Criterios de Aceptación:**
  1. El usuario puede escoger el ejecutable desde el desplegable de binarios detectados o con el botón «Examinar…» sin tener que escribir la ruta a mano.
  2. Los argumentos son opcionales y no se impone `--rom {rom}` a ports que no lo necesitan.
  3. `make test` pasa al 100% (431 tests en verde).
