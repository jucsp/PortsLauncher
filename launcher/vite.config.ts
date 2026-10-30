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
