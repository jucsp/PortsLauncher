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

