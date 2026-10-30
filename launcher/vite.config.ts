import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Configuración de Vite para PortsLauncher (Fase 3).
 *
 * - `root: '.'`      -> el índice es `launcher/index.html`.
 * - `publicDir`      -> assets estáticos servidos tal cual (`/public`).
 * - `build.outDir`   -> salida de producción en `launcher/dist`.
 * - `plugins`        -> proxy de desarrollo hacia SteamGridDB (`/api/steamgrid/*`).
 */

/* -------------------------------------------------------------------------- */
/* Proxy SteamGridDB (solo desarrollo / preview)                              */
/* -------------------------------------------------------------------------- */

/** Base de la API pública v2 de SteamGridDB. */
const STEAMGRID_API = 'https://www.steamgriddb.com/api/v2';

/** Prefijo que el proxy expone al navegador. */
const STEAMGRID_PREFIX = '/api/steamgrid/';

/** Nombre de la variable buscada en el entorno y en el fichero local. */
const STEAMGRID_KEY_NAME = 'STEAMGRID_API_KEY';

/** Fichero de credenciales del usuario (`~/.steamgrid_credentials.env`). */
const STEAMGRID_CREDENTIALS = path.join(os.homedir(), '.steamgrid_credentials.env');

/**
 * Lee `STEAMGRID_API_KEY=...` del fichero de credenciales.
 *
 * Admite líneas comentadas, `export VAR=valor` y valores entrecomillados.
 * Devuelve `null` si el fichero no existe, no se puede leer o no contiene la
 * clave: el proxy responderá 503 con un mensaje explicativo.
 */
function keyFromFile(file: string): string | null {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?STEAMGRID_API_KEY\s*=\s*(.*)$/);
      if (!match) continue;
      const value = match[1].trim().replace(/^['"]|['"]$/g, '').trim();
      if (value) return value;
    }
  } catch {
    /* Fichero ausente o ilegible: seguimos con el resto de fuentes. */
  }
  return null;
}

/** Clave de API: primero `process.env`, después el fichero del usuario. */
function steamgridKey(): string | null {
  const env = process.env[STEAMGRID_KEY_NAME];
  if (typeof env === 'string' && env.trim()) return env.trim();
  return keyFromFile(STEAMGRID_CREDENTIALS);
}

/** Respuesta JSON uniforme (status + `Content-Type: application/json`). */
function sendJSON(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Middleware `connect` que reenvía `/api/steamgrid/<endpoint>[?query]` a
 * `https://www.steamgriddb.com/api/v2/<endpoint>[?query]` con la cabecera
 * `Authorization: Bearer <clave>`.
 *
 * El navegador nunca ve la clave: vive en el proceso de Vite.
 */
async function steamgridProxy(
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
): Promise<void> {
  const url = req.url ?? '';
  if (!url.startsWith(STEAMGRID_PREFIX)) {
    next();
    return;
  }

  const apiKey = steamgridKey();
  if (!apiKey) {
    sendJSON(res, 503, {
      success: false,
      error:
        `Falta ${STEAMGRID_KEY_NAME}. Expórtala en el entorno o guárdala en ` +
        `${STEAMGRID_CREDENTIALS} como ${STEAMGRID_KEY_NAME}=<tu-clave>.`,
    });
    return;
  }

  const rest = url.slice(STEAMGRID_PREFIX.length);
  const cut = rest.indexOf('?');
  const endpoint = (cut >= 0 ? rest.slice(0, cut) : rest).replace(/^\/+/, '');
  const query = cut >= 0 ? rest.slice(cut) : '';

  if (!endpoint || !/^[A-Za-z0-9/_.,%-]+$/.test(endpoint)) {
    sendJSON(res, 400, { success: false, error: 'Endpoint de SteamGridDB no válido.' });
    return;
  }

  try {
    const upstream = await fetch(`${STEAMGRID_API}/${endpoint}${query}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    const body = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body && body.trim() ? body : '{}');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJSON(res, 502, { success: false, error: `SteamGridDB no responde: ${detail}` });
  }
}

/** Plugin que enchufa el proxy tanto en `vite` como en `vite preview`. */
function steamgridProxyPlugin(): Plugin {
  return {
    name: 'portshub-steamgrid-proxy',
    configureServer(server) {
      server.middlewares.use(steamgridProxy);
    },
    configurePreviewServer(server) {
      server.middlewares.use(steamgridProxy);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Configuración                                                              */
/* -------------------------------------------------------------------------- */

export default defineConfig({
  root: '.',
  publicDir: 'public',

  plugins: [steamgridProxyPlugin()],

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
