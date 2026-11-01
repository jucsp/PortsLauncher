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
const zlib = require('node:zlib');
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
 *
 * Se aceptan tres formas de binario publicado:
 *   · archivo comprimido (`.zip`, `.tar.gz`, `.tgz`, `.tar.xz`…),
 *   · AppImage suelto (`.AppImage`),
 *   · ejecutable suelto (`.run`, `.bin`, `.x86_64`, `.AppImage` o sin extensión).
 */
function scoreAsset(asset) {
  const n = String(asset && asset.name ? asset.name : '').toLowerCase();
  if (!n) return -1;

  /* Firma, checksum, notas de versión o manifiestos: nunca son el binario. */
  if (/\.(sha\d*|sig|asc|txt|sbom|json|md5)$/.test(n)) return -1;
  /* Paquetes de otros gestores: el launcher no los instala. */
  if (/\.(deb|rpm|dmg|msi|pkg|snap|flatpak)$/.test(n)) return -1;

  const isArchive = /\.(zip|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|tar|7z)$/.test(n);
  const isAppImage = n.endsWith('.appimage');
  const isBare = /\.(run|bin|x86_64|elf|exe)$/.test(n) || !n.includes('.');
  if (!isArchive && !isAppImage && !isBare) return -1;

  const platform = process.platform;
  const isWin = /win(dows|32|64)?\b|\.exe$/i.test(n);
  const isMac = /mac|darwin|osx/.test(n);
  const isLinux = /linux|appimage|x86_64|amd64|\.run$/.test(n);
  if (platform === 'linux' && (isWin || isMac)) return -1;
  if (platform === 'win32' && isLinux && !isWin) return -1;
  if (platform === 'darwin' && (isWin || /linux|appimage/.test(n))) return -1;

  let score = 1;
  if (platform === 'linux' && /linux/.test(n)) score += 4;
  if (platform === 'linux' && isLinux) score += 2;
  if (isAppImage) score += 3;
  if (/x86_64|amd64|x64/.test(n)) score += 2;
  if (/arm|aarch64/.test(n) && process.arch !== 'arm64') score -= 5;
  /* Volcado del código fuente subido como asset: último recurso frente a un
   * binario real, igual que el `zip` del repositorio. */
  if (/source|src[-_.]|code/.test(n)) score -= 6;
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

/* -------------------------------------------------------------------------- */
/* Descompresión                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resuelve una entrada de archivo dentro de `base` sin permitir que escape
 * (`../`, rutas absolutas). Devuelve `null` si la entrada es insegura.
 */
function safeEntry(base, entry) {
  const clean = String(entry || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean) return null;
  const target = path.resolve(base, clean);
  const root = path.resolve(base);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/** Desplazamiento del `End Of Central Directory` de un ZIP, o -1. */
function findEOCD(buf) {
  const first = Math.max(0, buf.length - 0xffff - 22);
  for (let index = buf.length - 22; index >= first; index -= 1) {
    if (buf.readUInt32LE(index) === 0x06054b50) return index;
  }
  return -1;
}

/**
 * Extrae un ZIP sin depender del binario `unzip`.
 *
 * `unzip` no existe en Windows y no está garantizado en un Linux mínimo, así
 * que se lee el directorio central y se infla cada entrada con `zlib`
 * (métodos «store» 0 e «inflate» 8, los que usan los releases). Las entradas
 * que escapan del destino (`../`, rutas absolutas) se descartan: protección
 * contra *zip slip*.
 */
function extractZip(file, dest) {
  const buf = fs.readFileSync(file);
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('ZIP no válido: falta el directorio central.');

  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let written = 0;

  for (let index = 0; index < total; index += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const rawName = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (compressedSize === 0xffffffff) {
      throw new Error('ZIP64 no soportado; usa el `.tar.gz` del release.');
    }

    const target = safeEntry(dest, rawName);
    if (!target) continue;
    if (rawName.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }

    /* Cabecera local: los tamaños del nombre y del extra pueden diferir. */
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const start =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`ZIP con compresión no soportada (método ${method}).`);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written += 1;
  }

  if (written === 0) throw new Error('El ZIP no contenía ficheros utilizables.');
}

/**
 * Sube un nivel el contenido cuando el archivo trae una única carpeta raíz.
 *
 * Los `archive/refs/heads/*.zip` de GitHub y la mayoría de releases envuelven
 * todo en `<repo>-<rama>/` o `<port>-<versión>/`. Sin esto, el ejecutable
 * quedaría un nivel por debajo de `installDir` y el perfil de lanzamiento
 * (`./<folder>`) no lo encontraría.
 */
function flattenSingleRoot(dir) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (items.length !== 1 || !items[0].isDirectory()) return;

  const root = path.join(dir, items[0].name);
  let inner;
  try {
    inner = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const entry of inner) {
    fs.renameSync(path.join(root, entry), path.join(dir, entry));
  }
  fs.rmSync(root, { recursive: true, force: true });
}

/** Extensiones que siempre se marcan como ejecutables. */
const EXEC_EXTENSIONS = new Set([
  'appimage',
  'sh',
  'bin',
  'run',
  'elf',
  'x86_64',
  'x64',
  'app',
  'command',
  'exe',
]);

/** ¿El fichero descomprimido es un ejecutable? (extensión, ELF, shebang…) */
function looksExecutable(file) {
  const base = path.basename(file);
  const ext = path.extname(base).replace(/^\./, '').toLowerCase();
  if (ext) return EXEC_EXTENSIONS.has(ext);

  /* Sin extensión: sólo si la cabecera es un ejecutable real. */
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4);
    const read = fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (read < 4) return false;
    if (head[0] === 0x7f && head.toString('ascii', 1, 4) === 'ELF') return true;
    if (head[0] === 0x23 && head[1] === 0x21) return true; /* #! */
    if (head[0] === 0xcf && head[1] === 0xfa && head[2] === 0xed && head[3] === 0xfe) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * `chmod 0o755` recursivo sobre los ejecutables de `dir`.
 *
 * Un AppImage o un binario extraído sin permiso de ejecución no arranca: es el
 * paso que hace que el port quede «listo para ejecutar». En Windows el permiso
 * no existe y la función es un no-op. Devuelve las rutas afectadas.
 */
function chmodExecutables(dir) {
  if (process.platform === 'win32') return [];
  const changed = [];

  const walk = (current) => {
    let items;
    try {
      items = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
        continue;
      }
      if (!item.isFile() || !looksExecutable(full)) continue;
      try {
        fs.chmodSync(full, 0o755);
        changed.push(full);
      } catch {
        /* Sistema de ficheros sin permisos POSIX: nada que hacer. */
      }
    }
  };

  walk(dir);
  return changed;
}

/**
 * Vuelca el archivo descargado en `dest` según su extensión.
 *
 * @returns `'zip' | 'tar' | '7z' | 'file'` o `null` si el formato no se
 *          reconoce (el llamante cae al siguiente método de instalación).
 */
async function extractInto(name, file, dest) {
  const n = String(name || '').toLowerCase();

  if (n.endsWith('.zip')) {
    extractZip(file, dest);
    return 'zip';
  }

  if (/\.(tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|tar)$/.test(n)) {
    const flag = n.endsWith('.tar.gz') || n.endsWith('.tgz')
      ? '-xzf'
      : n.endsWith('.tar.xz') || n.endsWith('.txz')
        ? '-xJf'
        : n.endsWith('.tar.bz2') || n.endsWith('.tbz2')
          ? '-xjf'
          : '-xf';
    await execFileAsync('tar', [flag, file, '-C', dest]);
    return 'tar';
  }

  if (n.endsWith('.7z')) {
    await execFileAsync('7z', ['x', '-y', file, `-o${dest}`]);
    return '7z';
  }

  /* Binario suelto: AppImage, `.run`, `.x86_64` o ejecutable sin extensión. */
  const target = path.join(dest, path.basename(name));
  fs.copyFileSync(file, target);
  return 'file';
}

/* -------------------------------------------------------------------------- */
/* Orígenes de instalación                                                    */
/* -------------------------------------------------------------------------- */

/** Consulta el último release del repo y elige el mejor asset para este SO. */
async function latestRelease(repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const ranked = (data.assets || [])
      .map((asset) => ({ asset, score: scoreAsset(asset) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score);
    return {
      version: typeof data.tag_name === 'string' ? data.tag_name : null,
      asset: ranked.length ? ranked[0].asset : null,
    };
  } catch {
    return null;
  }
}

/** Ramas probadas, en orden, cuando el release no trae binarios. */
const REPO_BRANCHES = ['main', 'master'];

/**
 * Descarga y extrae el ZIP del propio repositorio (`refs/heads/main.zip`).
 *
 * @returns `{ branch, kind }` o `null` si ninguna rama se pudo descargar.
 */
async function downloadRepoZip(repo, dest) {
  for (const branch of REPO_BRANCHES) {
    const tmp = path.join(
      os.tmpdir(),
      `portslauncher-${process.pid}-${Date.now()}-${branch}.zip`
    );
    try {
      await downloadTo(`https://github.com/${repo}/archive/refs/heads/${branch}.zip`, tmp);
      const wasEmpty = fs.readdirSync(dest).length === 0;
      extractZip(tmp, dest);
      if (wasEmpty) flattenSingleRoot(dest);
      return { branch, kind: 'zip' };
    } catch (error) {
      /* Rama inexistente (404) o ZIP ilegible: se prueba la siguiente. */
      console.warn(
        `[install] ${repo}@${branch} no se pudo bajar:`,
        error instanceof Error ? error.message : error
      );
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Instalación                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Instala un port en `LAUNCHER_HOME/ports/<folderName>` sin simulación.
 *
 * Cadena de métodos, en orden de preferencia:
 *   1. `release`   → asset binario del último release (zip/tar/AppImage/binario).
 *   2. `repo-zip`  → ZIP del repositorio (`refs/heads/main.zip`, luego `master`).
 *   3. `clone`     → `git clone --depth 1` como último recurso.
 *   4. `existing`  → la carpeta ya tenía contenido y ningún método pudo mejorarla.
 *   5. `folder`    → el port no declara repositorio (sólo se crean las carpetas).
 *
 * Siempre se devuelve la ruta física final (`installDir`), el método usado y,
 * cuando se conoce, la versión publicada del release.
 */
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
  if (!repo) return { installDir, method: 'folder', version: null, executables: [] };

  /* 1. Release con binarios precompilados ------------------------------- */
  const release = await latestRelease(repo);
  if (release && release.asset) {
    const asset = release.asset;
    const tmp = path.join(
      os.tmpdir(),
      `portslauncher-${process.pid}-${Date.now()}-${path.basename(String(asset.name))}`
    );
    try {
      await downloadTo(asset.browser_download_url, tmp);
      const wasEmpty = fs.readdirSync(installDir).length === 0;
      const kind = await extractInto(asset.name, tmp, installDir);
      if (kind) {
        if (wasEmpty) flattenSingleRoot(installDir);
        const executables = chmodExecutables(installDir);
        return {
          installDir,
          method: 'release',
          version: release.version,
          assetName: String(asset.name),
          archive: kind,
          executables,
        };
      }
    } catch (error) {
      /* Asset inservible (formato raro, fallo de red): se degrada al ZIP del
       * repositorio en vez de dejar el port «Broken». */
      console.warn(
        `[install] el release de ${repo} no se pudo usar:`,
        error instanceof Error ? error.message : error
      );
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /* 2. ZIP del repositorio ---------------------------------------------- */
  const zip = await downloadRepoZip(repo, installDir);
  if (zip) {
    return {
      installDir,
      method: 'repo-zip',
      version: release ? release.version : null,
      branch: zip.branch,
      archive: zip.kind,
      executables: chmodExecutables(installDir),
    };
  }

  /* 3. `git clone` ------------------------------------------------------ */
  if (fs.readdirSync(installDir).length > 0) {
    return {
      installDir,
      method: 'existing',
      version: release ? release.version : null,
      executables: chmodExecutables(installDir),
    };
  }
  await execFileAsync('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, installDir]);
  return {
    installDir,
    method: 'clone',
    version: release ? release.version : null,
    executables: chmodExecutables(installDir),
  };
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
 *
 * Cuerpo aceptado: `{ downloadUrl, assetName?, version?, execute? }`. Con
 * `execute: true` el instalador descargado se lanza en segundo plano de forma
 * desacoplada (`spawn` + `unref`), de modo que puede reemplazar la app en marcha;
 * la respuesta añade `executed: true` para que la UI lo confirme al usuario.
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

    /* El renderer puede pedir que, tras descargar, se lance el instalador. */
    const execute = Boolean(body && body.execute);

    await downloadTo(downloadUrl, targetPath);

    /* Un AppImage sin permiso de ejecución no arranca tras la descarga. */
    if (process.platform === 'linux' && fileName.toLowerCase().endsWith('.appimage')) {
      fs.chmodSync(targetPath, 0o755);
    }

    if (execute) {
      /* Lanzamiento desacoplado: el hijo sobrevive al proceso del launcher y el
       * instalador puede reemplazar la app en marcha sin bloquear la respuesta. */
      const { spawn } = require('node:child_process');
      try {
        const sub = spawn(targetPath, [], { detached: true, stdio: 'ignore' });
        sub.unref();
      } catch (e) {
        console.warn('No se pudo auto-lanzar:', e);
      }
      sendJSON(res, 200, {
        ok: true,
        path: targetPath,
        executed: true,
        message: 'Actualización iniciada: ' + targetPath,
      });
      return;
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
  chmodExecutables,
  createApiMiddleware,
  extractZip,
  handleApiRequest,
  handleSelfUpdate,
  installPort,
  looksExecutable,
  safeEntry,
  safeFolder,
  scoreAsset,
  sendJSON,
};
