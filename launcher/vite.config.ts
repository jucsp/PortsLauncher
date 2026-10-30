import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

/** Clave de API del servidor: `process.env`, después el fichero del usuario. */
function steamgridKey(): string | null {
  const env = process.env[STEAMGRID_KEY_NAME];
  if (typeof env === 'string' && env.trim()) return env.trim();
  return keyFromFile(STEAMGRID_CREDENTIALS);
}

/**
 * Clave que envía el navegador en la cabecera `x-steamgrid-key`.
 *
 * El launcher permite al usuario pegar su clave **personal** en Ajustes: viaja
 * en esta cabecera hasta el proxy, que la reenvía a SteamGridDB como
 * `Authorization: Bearer …`. Nunca se registra en logs.
 */
function headerKey(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
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
 * Orden de resolución de la clave:
 *   1. `x-steamgrid-key` (clave personal del usuario, enviada por el frontend).
 *   2. `STEAMGRID_API_KEY` del entorno del proceso de Vite.
 *   3. `~/.steamgrid_credentials.env`.
 *
 * `__status` responde si hay clave disponible en el servidor sin llamar a la
 * API: el modal «Ajustar arte» lo usa para avisar de que falta configurarla.
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

  const rest = url.slice(STEAMGRID_PREFIX.length);
  const cut = rest.indexOf('?');
  const endpoint = (cut >= 0 ? rest.slice(0, cut) : rest).replace(/^\/+/, '');
  const query = cut >= 0 ? rest.slice(cut) : '';

  const header = headerKey(req.headers['x-steamgrid-key']);
  const serverKey = steamgridKey();

  /* Sonda de configuración: no necesita clave, solo informa de si existe. */
  if (endpoint === '__status') {
    sendJSON(res, 200, {
      success: true,
      /* `configured` = hay clave en el servidor (entorno o fichero). */
      configured: !!serverKey,
      /* `client` = el navegador envió una clave personal en la cabecera. */
      client: !!header,
    });
    return;
  }

  /* Prioridad: cabecera del navegador → entorno → fichero de credenciales. */
  const apiKey = header ?? serverKey;

  if (!apiKey) {
    sendJSON(res, 503, {
      success: false,
      error:
        'Falta la clave de SteamGridDB. Pégala en Ajustes → Integraciones y Arte ' +
        `o define ${STEAMGRID_KEY_NAME} en el entorno / ${STEAMGRID_CREDENTIALS}.`,
    });
    return;
  }

  /* Los títulos del catálogo llevan paréntesis, dos puntos, apóstrofes y
   * ampersands («search/autocomplete/Zelda%3A%20Majora's%20Mask»,
   * «…/%28Zelda%3A%20Twilight%20Princess%29»): la antigua lista blanca de
   * caracteres los rechazaba con un 400 antes de llegar a la API. Ahora solo se
   * bloquea lo peligroso: travesía de directorios (`..`) y caracteres de
   * control (inyección de cabeceras / corte de línea). */
  if (!endpoint || endpoint.includes('..') || /[\r\n\x00]/.test(endpoint)) {
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
/* Instalación real (`/api/install`, solo desarrollo / preview)               */
/* -------------------------------------------------------------------------- */

const execFileAsync = promisify(execFile);

/** Raíz de datos del launcher: `~/PortsLauncher`. */
const LAUNCHER_HOME = path.join(os.homedir(), 'PortsLauncher');

interface InstallRequest {
  pid?: string;
  repo?: string | null;
  name?: string;
  folderName?: string;
  dest?: string;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

/** Lee y parsea el cuerpo JSON de la petición (máx. 64 KiB). */
function readJSON(req: IncomingMessage): Promise<InstallRequest> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) {
        reject(new Error('Cuerpo demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as InstallRequest);
      } catch {
        reject(new Error('JSON no válido.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Puntúa un asset de release para el SO actual. Devuelve -1 si no es
 * utilizable (otro sistema operativo, firma, checksum, instalador…).
 */
function scoreAsset(asset: GithubAsset): number {
  const n = asset.name.toLowerCase();
  const archive = /\.(zip|tar\.gz|tgz|appimage)$/.test(n);
  if (!archive) return -1;
  if (/\.(sha\d*|sig|asc|txt|sbom)$/.test(n)) return -1;
  const platform = process.platform;
  const isWin = /win(dows|32|64)?\b|\.exe/.test(n);
  const isMac = /mac|darwin|osx/.test(n);
  const isLinux = /linux|appimage|x86_64|amd64/.test(n);
  if (platform === 'linux' && (isWin || isMac)) return -1;
  if (platform === 'win32' && (isLinux && !isWin)) return -1;
  if (platform === 'darwin' && (isWin || /linux|appimage/.test(n))) return -1;
  let score = 1;
  if (platform === 'linux' && /linux/.test(n)) score += 4;
  if (platform === 'linux' && n.endsWith('.appimage')) score += 3;
  if (/x86_64|amd64|x64/.test(n)) score += 2;
  if (/arm|aarch64/.test(n) && process.arch !== 'arm64') score -= 5;
  return score;
}

/** Descarga `url` a `file` siguiendo redirecciones. */
async function downloadTo(url: string, file: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'PortsLauncher' } });
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status}).`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Instala el port: último release empaquetado o, si no hay, `git clone`. */
async function installPort(body: InstallRequest): Promise<{ installDir: string; method: string }> {
  const folder = body.folderName ?? '';
  if (!/^[A-Za-z0-9._-]+$/.test(folder) || folder.startsWith('.')) {
    throw new Error('folderName no válido.');
  }
  const repo = body.repo ?? null;
  if (repo !== null && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    throw new Error('repo no válido.');
  }

  /* El destino se fija en el servidor: `dest` solo es informativo. */
  const installDir = path.join(LAUNCHER_HOME, 'ports', folder);
  const romsDir = path.join(LAUNCHER_HOME, 'roms', folder);
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(romsDir, { recursive: true });
  if (!repo) return { installDir, method: 'folder' };

  let asset: GithubAsset | null = null;
  try {
    const rel = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PortsLauncher' },
    });
    if (rel.ok) {
      const data = (await rel.json()) as { assets?: GithubAsset[] };
      const ranked = (data.assets ?? [])
        .map((a) => ({ a, score: scoreAsset(a) }))
        .filter((x) => x.score >= 0)
        .sort((x, y) => y.score - x.score);
      asset = ranked[0]?.a ?? null;
    }
  } catch {
    asset = null;
  }

  if (asset) {
    const tmp = path.join(os.tmpdir(), `portslauncher-${process.pid}-${Date.now()}-${path.basename(asset.name)}`);
    try {
      await downloadTo(asset.browser_download_url, tmp);
      const lower = asset.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        await execFileAsync('unzip', ['-o', tmp, '-d', installDir]);
      } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        await execFileAsync('tar', ['-xzf', tmp, '-C', installDir]);
      } else {
        const target = path.join(installDir, path.basename(asset.name));
        fs.copyFileSync(tmp, target);
        fs.chmodSync(target, 0o755);
      }
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return { installDir, method: 'release' };
  }

  /* Sin release empaquetado: clon superficial en la carpeta del port. */
  const empty = fs.readdirSync(installDir).length === 0;
  if (!empty) return { installDir, method: 'existing' };
  await execFileAsync('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, installDir]);
  return { installDir, method: 'clone' };
}

/** Middleware `POST /api/install`. */
async function installMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
): Promise<void> {
  const url = (req.url ?? '').split('?')[0];
  if (url !== '/api/install') {
    next();
    return;
  }
  if (req.method !== 'POST') {
    sendJSON(res, 405, { ok: false, error: 'Usa POST.' });
    return;
  }
  try {
    const body = await readJSON(req);
    const result = await installPort(body);
    sendJSON(res, 200, { ok: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJSON(res, 500, { ok: false, error: detail });
  }
}

/** Plugin que enchufa `/api/install` tanto en `vite` como en `vite preview`. */
function installPlugin(): Plugin {
  return {
    name: 'portshub-install',
    configureServer(server) {
      server.middlewares.use(installMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(installMiddleware);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Configuración                                                              */
/* -------------------------------------------------------------------------- */

export default defineConfig({
  root: '.',
  publicDir: 'public',

  plugins: [steamgridProxyPlugin(), installPlugin()],

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
