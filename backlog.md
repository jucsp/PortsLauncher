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
