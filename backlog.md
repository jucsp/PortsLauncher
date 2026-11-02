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
- **Estado:** Completado (Tag v0.1.8) — Responsable: DeepSeek (Dev) / Claude (QA)
- **Objetivo:** Inyectar la versión de la aplicación en tiempo de build (sin valores hardcodeados) y hacer resiliente el diagnóstico de actualizaciones ante fallos de red o respuestas inválidas.
- **Criterios de Aceptación:**
  1. La versión mostrada en la UI proviene de la inyección en build.
  2. El diagnóstico de actualizaciones maneja errores sin interrumpir la aplicación.
  3. Suite de pruebas pasando al 100%.
