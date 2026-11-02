import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createRequire } from 'node:module';

/**
 * Configuración de Vite para PortsLauncher.
 *
 * - `root: '.'`      -> el índice es `launcher/index.html`.
 * - `publicDir`      -> assets estáticos servidos tal cual (`/public`).
 * - `build.outDir`   -> salida de producción en `launcher/dist`.
 * - `plugins`        -> backend local compartido con la app de Electron.
 *
 * El backend (`POST /api/install`, `/api/steamgrid/*`) ya NO vive aquí: se
 * trasladó a `electron/api.cjs` para que `vite dev`, `vite preview` y la app
 * empaquetada de Electron sirvan exactamente las mismas rutas con el mismo
 * código. Este fichero sólo lo enchufa como middleware.
 */

/** `require` en un módulo ESM (el paquete es `"type": "module"`). */
const nodeRequire = createRequire(import.meta.url);

/**
 * Versión real del launcher, leída de `launcher/package.json` en el momento de
 * configurar el build.
 *
 * Se inyecta en el bundle como `__APP_VERSION__` (ver `define` más abajo) para
 * que la UI no tenga que hardcodearla: antes `Sidebar.ts` decía `1.0.0` y
 * `updateService.ts` decía `0.1.0`, así que la pantalla mentía aunque se
 * compilara una versión nueva. `createRequire` (no `import … from
 * './package.json'`) evita depender de import attributes en este fichero, que
 * esbuild procesa sin empaquetar.
 */
const pkg = nodeRequire('./package.json') as { version?: unknown };

/** Versión normalizada (`0.1.8`); `0.0.0` si el manifiesto no la declara. */
const APP_VERSION = String(pkg.version ?? '').trim() || '0.0.0';

/** Forma mínima del módulo compartido que consume este fichero. */
interface ApiModule {
  createApiMiddleware: () => (
    req: unknown,
    res: unknown,
    next: (err?: unknown) => void
  ) => void;
}

/** Carga perezosa: `vite build` no levanta servidor y no debe tocar la API. */
function loadApi(): ApiModule {
  return nodeRequire('./electron/api.cjs') as ApiModule;
}

/**
 * Enchufa el backend local tanto en `vite` como en `vite preview`.
 *
 * La carga de `electron/api.cjs` ocurre dentro de los ganchos del servidor, no
 * al evaluar la configuración: así `vite build` (que sólo compila) nunca
 * depende de que el módulo del backend esté presente.
 */
function localApiPlugin(): Plugin {
  const attach = (middlewares: { use: (fn: unknown) => void }): void => {
    middlewares.use(loadApi().createApiMiddleware());
  };

  return {
    name: 'portshub-local-api',
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',

  /**
   * Constantes sustituidas en tiempo de build/transform.
   *
   * `__APP_VERSION__` sale del `package.json` real, de modo que basta con
   * `npm version`/editar el manifiesto para que la barra lateral, los Ajustes y
   * el comprobador de actualizaciones muestren la versión instalada de verdad.
   * Vitest reutiliza esta configuración, así que los tests también reciben el
   * valor inyectado (y `updateService` mantiene un fallback si no llegara).
   */
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },

  plugins: [localApiPlugin()],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'esnext',
    sourcemap: true,
    cssCodeSplit: true,
    minify: 'esbuild',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1200,
  },

  server: {
    port: 5173,
    strictPort: false,
    open: false,
    host: true,
  },

  preview: {
    port: 4173,
    strictPort: false,
    open: false,
  },

  optimizeDeps: {
    include: [],
  },
});
