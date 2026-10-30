/* ==========================================================================
 * PortsLauncher · electron/api.cjs
 *
 * Backend local compartido por los tres modos de ejecución:
 *   · `vite` (desarrollo)      → plugin de `launcher/vite.config.ts`
 *   · `vite preview`           → mismo plugin
 *   · app empaquetada Electron → servidor HTTP propio de `electron/main.cjs`
 *
 * Rutas servidas:
 *   POST /api/install                    → descarga el release del port o clona el repo.
 *   POST /api/launcher/self-update       → guarda el instalador de una versión nueva en ~/Downloads.
 *   GET  /api/steamgrid/<api>            → proxy con la clave del usuario o del servidor.
 *
 * Es CommonJS a propósito: Electron lo carga con `require()` y Vite lo hace
 * con `createRequire()` desde su configuración ESM. Un solo fichero evita que
 * las dos rutas de ejecución se comporten distinto.
 * ========================================================================== */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/* -------------------------------------------------------------------------- */
/* Configuración                                                              */
/* -------------------------------------------------------------------------- */

/** Base de la API pública v2 de SteamGridDB. */
const STEAMGRID_API = 'https://www.steamgriddb.com/api/v2';

/** Prefijo que el proxy expone al navegador. */
const STEAMGRID_PREFIX = '/api/steamgrid/';

/** Nombre de la variable buscada en el entorno y en el fichero local. */
const STEAMGRID_KEY_NAME = 'STEAMGRID_API_KEY';

/** Fichero de credenciales del usuario (`~/.steamgrid_credentials.env`). */
const STEAMGRID_CREDENTIALS = path.join(os.homedir(), '.steamgrid_credentials.env');

/** Raíz de datos del launcher: `~/PortsLauncher`. */
const LAUNCHER_HOME = path.join(os.homedir(), 'PortsLauncher');

/** Cabecera común para las llamadas salientes a GitHub. */
const USER_AGENT = 'PortsLauncher';

/* -------------------------------------------------------------------------- */
/* Utilidades HTTP                                                            */
/* -------------------------------------------------------------------------- */

/** Respuesta JSON uniforme (status + `Content-Type: application/json`). */
function sendJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** Lee y parsea el cuerpo JSON de la petición (máx. 64 KiB). */
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
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
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('JSON no válido.'));
      }
    });
    req.on('error', reject);
  });
}

/* -------------------------------------------------------------------------- */
/* Proxy SteamGridDB                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lee `STEAMGRID_API_KEY=...` del fichero de credenciales.
 *
 * Admite líneas comentadas, `export VAR=valor` y valores entrecomillados.
 * Devuelve `null` si el fichero no existe, no se puede leer o no contiene la
 * clave: el proxy responderá 503 con un mensaje explicativo.
 */
function keyFromFile(file) {
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
function steamgridKey() {
  const env = process.env[STEAMGRID_KEY_NAME];
  if (typeof env === 'string' && env.trim()) return env.trim();
  return keyFromFile(STEAMGRID_CREDENTIALS);
}

/** Clave que envía el navegador en la cabecera `x-steamgrid-key`. */
function headerKey(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reenvía `/api/steamgrid/<endpoint>[?query]` a
 * `https://www.steamgriddb.com/api/v2/<endpoint>[?query]` con la cabecera
 * `Authorization: Bearer <clave>`.
 *
 * Orden de resolución de la clave:
 *   1. `x-steamgrid-key` (clave personal del usuario, enviada por el frontend).
 *   2. `STEAMGRID_API_KEY` del entorno del proceso.
 *   3. `~/.steamgrid_credentials.env`.
 *
 * `__status` responde si hay clave disponible en el servidor sin llamar a la
 * API: el modal «Ajustar arte» lo usa para avisar de que falta configurarla.
 */
async function steamgridProxy(req, res) {
  const url = req.url || '';
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
      configured: !!serverKey,
      client: !!header,
    });
    return;
  }

  /* Prioridad: cabecera del navegador → entorno → fichero de credenciales. */
  const apiKey = header || serverKey;

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
   * ampersands: una lista blanca estricta los rechazaría antes de llegar a la
   * API. Solo se bloquea lo peligroso: travesía (`..`) y caracteres de control
   * (inyección de cabeceras / corte de línea). */
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

/* -------------------------------------------------------------------------- */
/* Instalación real de ports                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Puntúa un asset de release para el SO actual. Devuelve -1 si no es
 * utilizable (otro sistema operativo, firma, checksum, instalador…).
 */
function scoreAsset(asset) {
  const n = String(asset && asset.name ? asset.name : '').toLowerCase();
  const archive = /\.(zip|tar\.gz|tgz|appimage)$/.test(n);
  if (!archive) return -1;
  if (/\.(sha\d*|sig|asc|txt|sbom)$/.test(n)) return -1;
  const platform = process.platform;
  const isWin = /win(dows|32|64)?\b|\.exe/.test(n);
  const isMac = /mac|darwin|osx/.test(n);
  const isLinux = /linux|appimage|x86_64|amd64/.test(n);
  if (platform === 'linux' && (isWin || isMac)) return -1;
  if (platform === 'win32' && isLinux && !isWin) return -1;
  if (platform === 'darwin' && (isWin || /linux|appimage/.test(n))) return -1;
  let score = 1;
  if (platform === 'linux' && /linux/.test(n)) score += 4;
  if (platform === 'linux' && n.endsWith('.appimage')) score += 3;
  if (/x86_64|amd64|x64/.test(n)) score += 2;
  if (/arm|aarch64/.test(n) && process.arch !== 'arm64') score -= 5;
  return score;
}

/** Descarga `url` a `file` siguiendo redirecciones. */
async function downloadTo(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status}).`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Valida el `folderName` (sin rutas, sin ocultos, sin `..`). */
function safeFolder(folder) {
  const value = String(folder || '');
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value.startsWith('.')) {
    throw new Error('folderName no válido.');
  }
  return value;
}

/** Instala el port: último release empaquetado o, si no hay, `git clone`. */
async function installPort(body) {
  const folder = safeFolder(body && body.folderName);
  const repo = body && body.repo ? String(body.repo) : null;
  if (repo !== null && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    throw new Error('repo no válido.');
  }

  /* El destino se fija en el servidor: `dest` solo es informativo. */
  const installDir = path.join(LAUNCHER_HOME, 'ports', folder);
  const romsDir = path.join(LAUNCHER_HOME, 'roms', folder);
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(romsDir, { recursive: true });
  if (!repo) return { installDir, method: 'folder' };

  let asset = null;
  try {
    const rel = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    });
    if (rel.ok) {
      const data = await rel.json();
      const ranked = (data.assets || [])
        .map((a) => ({ a, score: scoreAsset(a) }))
        .filter((x) => x.score >= 0)
        .sort((x, y) => y.score - x.score);
      asset = ranked.length ? ranked[0].a : null;
    }
  } catch {
    asset = null;
  }

  if (asset) {
    const tmp = path.join(
      os.tmpdir(),
      `portslauncher-${process.pid}-${Date.now()}-${path.basename(asset.name)}`
    );
    try {
      await downloadTo(asset.browser_download_url, tmp);
      const lower = String(asset.name).toLowerCase();
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

/** Atiende `POST /api/install`. */
async function handleInstall(req, res) {
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

/* -------------------------------------------------------------------------- */
/* Auto-actualización del launcher                                            */
/* -------------------------------------------------------------------------- */

/**
 * Descarga el instalador de una versión nueva del launcher en `~/Downloads`.
 *
 * Origen permitido: el release oficial vive en GitHub, así que el cliente sólo
 * puede pedir URLs de `github.com` (descarga) o `objects.githubusercontent.com`
 * (redirección del CDN de assets). Cualquier otro host se rechaza para que esta
 * ruta no se convierta en un descargador arbitrario desde el renderer.
 *
 * El nombre del fichero pasa por `path.basename`: aunque el cuerpo venga del
 * frontend, no puede escapar de `~/Downloads` con `../`.
 */
async function handleSelfUpdate(req, res) {
  if (req.method !== 'POST') {
    sendJSON(res, 405, { ok: false, error: 'Usa POST.' });
    return;
  }
  try {
    const body = await readJSON(req);
    const downloadUrl = String((body && body.downloadUrl) || '').trim();
    if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com)\//i.test(downloadUrl)) {
      throw new Error(
        'downloadUrl no válido: sólo se admiten enlaces de github.com u objects.githubusercontent.com.'
      );
    }

    const downloadsDir = path.join(os.homedir(), 'Downloads');
    fs.mkdirSync(downloadsDir, { recursive: true });

    const version = body && body.version ? String(body.version).trim() : '';
    const fallback = `PortsLauncher-${version || 'update'}${
      process.platform === 'win32' ? '.exe' : '.AppImage'
    }`;
    const requested = body && body.assetName ? path.basename(String(body.assetName)) : '';
    /* `basename` puede devolver '' o '.' si el asset venía mal formado. */
    const fileName = requested && requested !== '.' && requested !== '..' ? requested : fallback;
    const targetPath = path.join(downloadsDir, fileName);

    await downloadTo(downloadUrl, targetPath);

    /* Un AppImage sin permiso de ejecución no arranca tras la descarga. */
    if (process.platform === 'linux' && fileName.toLowerCase().endsWith('.appimage')) {
      fs.chmodSync(targetPath, 0o755);
    }

    sendJSON(res, 200, {
      ok: true,
      path: targetPath,
      fileName,
      message: 'Actualización descargada en ' + targetPath,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJSON(res, 500, { ok: false, error: detail });
  }
}

/* -------------------------------------------------------------------------- */
/* Enrutador                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Atiende una petición si corresponde a `/api/…`.
 *
 * @returns `true` si la petición quedó resuelta, `false` si no es asunto suyo
 *          y el llamante (Vite o el servidor estático) debe continuar.
 */
async function handleApiRequest(req, res) {
  const url = (req.url || '').split('?')[0];
  if (url === '/api/install') {
    await handleInstall(req, res);
    return true;
  }
  if (url === '/api/launcher/self-update') {
    await handleSelfUpdate(req, res);
    return true;
  }
  if (url.startsWith(STEAMGRID_PREFIX)) {
    await steamgridProxy(req, res);
    return true;
  }
  if (url === '/api/health') {
    sendJSON(res, 200, { ok: true, app: 'portslauncher', home: LAUNCHER_HOME });
    return true;
  }
  return false;
}

/**
 * Middleware estilo `connect` para Vite (`configureServer` / `configurePreviewServer`).
 *
 * Llama a `next()` sin tocar nada cuando la ruta no es de la API, de modo que
 * el servidor de Vite sigue sirviendo el frontend con normalidad.
 */
function createApiMiddleware() {
  return function apiMiddleware(req, res, next) {
    const url = (req.url || '').split('?')[0];
    const isApi =
      url === '/api/install' ||
      url === '/api/launcher/self-update' ||
      url === '/api/health' ||
      url.startsWith(STEAMGRID_PREFIX);
    if (!isApi) {
      next();
      return;
    }
    handleApiRequest(req, res).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      try {
        sendJSON(res, 500, { ok: false, error: detail });
      } catch {
        /* Respuesta ya enviada: nada que hacer. */
      }
    });
  };
}

module.exports = {
  LAUNCHER_HOME,
  STEAMGRID_PREFIX,
  createApiMiddleware,
  handleApiRequest,
  handleSelfUpdate,
  installPort,
  safeFolder,
  sendJSON,
};
