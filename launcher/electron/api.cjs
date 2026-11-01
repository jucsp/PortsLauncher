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
 *   POST /api/launch                     → ejecuta el port instalado (spawn desacoplado).
 *   POST /api/report-error               → escribe un reporte técnico en `~/PortsLauncher/logs`.
 *   POST /api/open-path                  → abre un archivo/carpeta de `~/PortsLauncher` en el SO.
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
const { execFile, spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
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

/**
 * Descarga `url` a `file` siguiendo redirecciones.
 *
 * Se escribe en streaming: con `arrayBuffer()` un asset de port de cientos de
 * MB (o más) quedaba entero en memoria antes de tocar el disco, que es el mismo
 * vector de OOM que sufría la extracción.
 */
async function downloadTo(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status}).`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
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

/** Tope de bytes descomprimidos por archivo (protección anti *zip bomb*). */
const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024 * 1024; /* 4 GB */

/**
 * `true` si el SO trae un `unzip` utilizable.
 *
 * Se resuelve una sola vez por proceso. En Windows no hay `unzip` de serie y se
 * mantiene el lector ZIP propio; en Linux/macOS casi siempre está y evitar el
 * camino que carga el archivo entero en memoria.
 */
let systemUnzip = null;

async function hasSystemUnzip() {
  if (systemUnzip !== null) return systemUnzip;
  systemUnzip = false;
  if (process.platform !== 'win32') {
    try {
      await execFileAsync('unzip', ['-v'], { timeout: 10_000 });
      systemUnzip = true;
    } catch {
      systemUnzip = false;
    }
  }
  return systemUnzip;
}

/** Suma de los ficheros regulares de `dir` (0 si no existe o no se puede leer). */
function dirBytes(dir) {
  let total = 0;
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const item of items) {
    const full = path.join(dir, item.name);
    try {
      if (item.isDirectory()) total += dirBytes(full);
      else if (item.isFile()) total += fs.statSync(full).size;
    } catch {
      /* Entrada ilegible (enlace roto, permisos): se ignora el tamaño. */
    }
  }
  return total;
}

/**
 * Extrae un ZIP en `dest`.
 *
 * En Linux/macOS delega en el `unzip` del sistema: escribe en streaming al
 * disco, mientras que el lector propio (`extractZipSync`) carga el archivo
 * completo con `readFileSync` y lo infla de forma síncrona. Con assets de port
 * de cientos de MB eso significaba `ERR_FS_FILE_TOO_LARGE`/OOM y el bucle de
 * eventos congelado durante la descompresión. En Windows, donde no existe
 * `unzip`, se conserva el lector propio.
 *
 * Ambos caminos respetan `MAX_EXTRACTED_BYTES`: un archivo manipulado (*zip
 * bomb*) no debe llenar el disco ni agotar la memoria.
 *
 * @throws si el ZIP es ilegible o el resultado excede el tope de bytes.
 */
async function extractZip(file, dest) {
  if (await hasSystemUnzip()) {
    const before = dirBytes(dest);
    await execFileAsync('unzip', ['-qq', '-o', file, '-d', dest], { timeout: 10 * 60 * 1000 });
    if (dirBytes(dest) - before > MAX_EXTRACTED_BYTES) {
      throw new Error('El contenido descomprimido supera el límite de 4 GB.');
    }
    return;
  }

  extractZipSync(file, dest);
}

/**
 * Extrae un ZIP sin depender del binario `unzip`.
 *
 * `unzip` no existe en Windows, así que se lee el directorio central y se infla
 * cada entrada con `zlib` (métodos «store» 0 e «inflate» 8, los que usan los
 * releases). Las entradas que escapan del destino (`../`, rutas absolutas) se
 * descartan: protección contra *zip slip*. El presupuesto de bytes se recorta
 * entrada a entrada para que una única entrada bomba falle en `zlib` en vez de
 * en el asignador del sistema.
 */
function extractZipSync(file, dest) {
  const buf = fs.readFileSync(file);
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('ZIP no válido: falta el directorio central.');

  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let written = 0;
  let extracted = 0;

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
    else if (method === 8) {
      /* `maxOutputLength` corta la inflada dentro de zlib: sin él, una entrada
       * bomba se materializa entera en RAM antes de poder medirla. */
      const budget = MAX_EXTRACTED_BYTES - extracted;
      data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, budget) });
    } else throw new Error(`ZIP con compresión no soportada (método ${method}).`);

    extracted += data.length;
    if (extracted > MAX_EXTRACTED_BYTES) {
      throw new Error('El contenido descomprimido supera el límite de 4 GB.');
    }

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

  /* Sin extensión: sólo si la cabecera es un ejecutable real. El descriptor se
   * libera en `finally`: un fallo entre `openSync` y la lectura (permisos, I/O)
   * dejaba el `fd` abierto en el camino de excepción. */
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4);
    const read = fs.readSync(fd, head, 0, 4, 0);
    if (read < 4) return false;
    if (head[0] === 0x7f && head.toString('ascii', 1, 4) === 'ELF') return true;
    if (head[0] === 0x23 && head[1] === 0x21) return true; /* #! */
    if (head[0] === 0xcf && head[1] === 0xfa && head[2] === 0xed && head[3] === 0xfe) return true;
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* Descriptor ya cerrado o inválido: no hay nada que liberar. */
      }
    }
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
    await extractZip(file, dest);
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
 * Nombres de primer nivel de `dir` (vacío si el directorio no existe).
 *
 * Es la foto que permite distinguir, tras un fallo, lo que creó el intento de
 * instalación de lo que ya estaba antes.
 */
function snapshotDir(dir) {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

/**
 * Borra de `dir` todo lo que no estuviera en `before`.
 *
 * Si la extracción se rompe a mitad (CRC, formato no soportado, disco lleno),
 * la carpeta queda con ficheros corruptos. Dejarlos provoca dos fallos: el port
 * parece instalado y el frontend lo marca «listo», y el siguiente método de la
 * cascada ve el destino «no vacío» y responde `method: 'existing'` sobre basura.
 *
 * Sólo se purga lo añadido por el intento fallido: si el usuario ya tenía una
 * instalación válida ahí, se conserva intacta.
 */
function purgeNewEntries(dir, before) {
  let items;
  try {
    items = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of items) {
    if (before.has(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `[install] no se pudo limpiar el residuo ${name}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

/**
 * Descarga y extrae el ZIP del propio repositorio (`refs/heads/main.zip`).
 *
 * Cada intento fallido purga lo que haya escrito antes de probar la siguiente
 * rama, para que el destino no quede mezclado.
 *
 * @returns `{ branch, kind }` o `null` si ninguna rama se pudo descargar.
 */
async function downloadRepoZip(repo, dest) {
  for (const branch of REPO_BRANCHES) {
    const tmp = path.join(
      os.tmpdir(),
      `portslauncher-${process.pid}-${Date.now()}-${branch}.zip`
    );
    const before = snapshotDir(dest);
    try {
      await downloadTo(`https://github.com/${repo}/archive/refs/heads/${branch}.zip`, tmp);
      const wasEmpty = before.size === 0;
      await extractZip(tmp, dest);
      if (wasEmpty) flattenSingleRoot(dest);
      return { branch, kind: 'zip' };
    } catch (error) {
      /* Rama inexistente (404) o ZIP ilegible: se borra lo extraído y se pasa
       * a la siguiente rama. */
      purgeNewEntries(dest, before);
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
 * Todo método que falla a mitad purga lo que escribió (`purgeNewEntries`), de
 * modo que el destino nunca queda con archivos corruptos ni provoca un
 * `existing` falso en el siguiente intento.
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

  /* Foto previa: cualquier método que falle a mitad purga lo añadido, de modo
   * que un fallo no se confunda con una instalación existente. */
  const before = snapshotDir(installDir);

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
      const wasEmpty = before.size === 0;
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
      /* Asset inservible (formato raro, fallo de red): se borra lo extraído y
       * se degrada al ZIP del repositorio en vez de dejar el port «Broken». */
      purgeNewEntries(installDir, before);
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
  /* Los intentos fallidos purgaron lo que escribieron, así que un destino con
   * contenido aquí es una instalación previa real, no un residuo de extracción:
   * `existing` vuelve a ser una respuesta fiable. */
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
/* Diagnóstico: reportes técnicos y apertura de rutas                         */
/* -------------------------------------------------------------------------- */

/** Carpeta de reportes técnicos: `~/PortsLauncher/logs`. */
const LOGS_DIR = path.join(LAUNCHER_HOME, 'logs');

/** Raíz de ports instalados: `~/PortsLauncher/ports`. */
const PORTS_DIR = path.join(LAUNCHER_HOME, 'ports');

/** Crea `dir` (recursivo e idempotente) y lo devuelve. */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Versión del launcher (la del `package.json` del paquete, cacheada). */
let launcherVersionCache = null;

function launcherVersion() {
  if (launcherVersionCache !== null) return launcherVersionCache;
  launcherVersionCache = 'desconocida';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (pkg && typeof pkg.version === 'string') launcherVersionCache = pkg.version;
  } catch {
    /* Build sin `package.json` legible: la versión queda como desconocida. */
  }
  return launcherVersionCache;
}

/** Trozo de nombre de archivo seguro (`Mario 64` → `Mario-64`). */
function safeSegment(value, fallback) {
  const clean = String(value ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return clean || fallback;
}

/** Marca temporal apta para nombre de archivo (`2024-05-01T12-30-00-000Z`). */
function fileStamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Serializa los detalles del reporte sin lanzar si hay referencias circulares. */
function describeDetails(details) {
  if (details === null || details === undefined) return '(sin detalles)';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return '(los detalles no se pudieron serializar)';
  }
}

/**
 * Escribe un reporte técnico en `~/PortsLauncher/logs/error-<pid>-<fecha>.log`.
 *
 * El log es texto plano a propósito: el usuario tiene que poder abrirlo con
 * cualquier editor (y el botón «Abrir reporte» lo hace con el visor del sistema)
 * y enviarlo tal cual. Se incluye el entorno completo porque la mayoría de
 * fallos de instalación dependen del SO, la arquitectura o la versión de Node.
 *
 * @param {{ pid?: string, name?: string, action?: string,
 *           error?: unknown, stack?: string | null, details?: unknown }} input
 * @returns {string} ruta absoluta del reporte escrito.
 */
function writeErrorReport(input) {
  const data = input && typeof input === 'object' ? input : {};
  const pid = data.pid === null || data.pid === undefined ? '' : String(data.pid);
  const name = data.name === null || data.name === undefined ? '' : String(data.name);
  const action = String(data.action || 'desconocida');
  const error = data.error;
  let message;
  if (error instanceof Error) message = error.message;
  else if (typeof error === 'string' && error) message = error;
  else if (error === null || error === undefined) message = 'Error desconocido';
  else message = String(error);
  const stack =
    (typeof data.stack === 'string' && data.stack) ||
    (error instanceof Error && typeof error.stack === 'string' ? error.stack : '') ||
    '(no disponible)';

  ensureDir(LOGS_DIR);

  /* Dos fallos en el mismo milisegundo no deben sobrescribirse. */
  const stamp = fileStamp(new Date());
  const head = `error-${safeSegment(pid, 'sin-id')}-${stamp}`;
  let file = path.join(LOGS_DIR, `${head}.log`);
  for (let n = 2; fs.existsSync(file) && n < 1000; n += 1) {
    file = path.join(LOGS_DIR, `${head}-${n}.log`);
  }

  const lines = [
    'PortsLauncher · Reporte técnico',
    '='.repeat(64),
    '',
    `Fecha:          ${new Date().toISOString()}`,
    `Acción:         ${action}`,
    `Port:           ${name || '(sin nombre)'}`,
    `ID del port:    ${pid || '(sin id)'}`,
    '',
    '-- Entorno ----------------------------------------------------',
    `Sistema:        ${process.platform} (${os.type()} ${os.release()})`,
    `Distribución:   ${(() => { try { return os.version(); } catch { return '(desconocida)'; } })()}`,
    `Arquitectura:   ${process.arch}`,
    `Equipo:         ${os.hostname()}`,
    `Node:           ${process.versions.node}`,
    `Electron:       ${process.versions.electron || 'no (servidor de desarrollo)'}`,
    `Launcher:       v${launcherVersion()}`,
    `Directorio:     ${LAUNCHER_HOME}`,
    '',
    '-- Causa ------------------------------------------------------',
    String(message),
    '',
    '-- Pila de ejecución ------------------------------------------',
    String(stack),
    '',
    '-- Detalles ---------------------------------------------------',
    describeDetails(data.details),
    '',
  ];

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

/** `POST /api/report-error` → guarda el reporte y devuelve su ruta. */
async function handleReportError(req, res) {
  if (req.method !== 'POST') {
    sendJSON(res, 405, { ok: false, error: 'Usa POST.' });
    return;
  }
  try {
    const body = await readJSON(req);
    /* Se acepta el reporte plano o envuelto en `report` para no atar el
     * contrato del frontend a una única forma. */
    const payload = body && typeof body.report === 'object' && body.report ? body.report : body || {};
    const logPath = writeErrorReport(payload);
    sendJSON(res, 200, { ok: true, logPath });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[report-error] no se pudo escribir el reporte:', detail);
    sendJSON(res, 500, { ok: false, error: detail });
  }
}

/**
 * Módulo `shell` de Electron, o `null` fuera de Electron.
 *
 * `electron/api.cjs` también se carga desde `vite dev` (Node puro), donde
 * `require('electron')` devuelve la ruta del binario y no el objeto de la API:
 * se comprueba `shell.openPath` antes de usarlo.
 */
function electronShell() {
  try {
    const electron = require('electron');
    if (electron && electron.shell && typeof electron.shell.openPath === 'function') {
      return electron.shell;
    }
  } catch {
    /* Fuera de Electron o sin el paquete instalado. */
  }
  return null;
}

/** Abre `target` con el gestor de archivos / visor predeterminado del SO. */
async function openInSystem(target) {
  const shell = electronShell();
  if (shell) {
    /* `shell.openPath` resuelve con '' cuando todo va bien y con el mensaje de
     * error en caso contrario: no rechaza la promesa. */
    const problem = await shell.openPath(target);
    if (problem) throw new Error(problem);
    return 'electron';
  }
  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', target], { timeout: 15_000 });
    return 'start';
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  await execFileAsync(command, [target], { timeout: 15_000 });
  return command;
}

/**
 * `POST /api/open-path` → abre un archivo o carpeta con la app del sistema.
 *
 * Sólo se admiten rutas dentro de `~/PortsLauncher`: el endpoint lo invoca el
 * renderer y, sin esta cota, cualquier inyección en la UI podría abrir
 * documentos arbitrarios del usuario con su visor predeterminado. Las URLs
 * externas siguen su propio camino (`window.open` → `shell.openExternal`).
 */
async function handleOpenPath(req, res) {
  if (req.method !== 'POST') {
    sendJSON(res, 405, { ok: false, error: 'Usa POST.' });
    return;
  }
  try {
    const body = await readJSON(req);
    const raw = String((body && body.path) || '').trim();
    if (!raw) throw new Error('Falta la ruta a abrir.');

    const expanded = raw.replace(/^~(?=$|[\\/])/, os.homedir());
    const target = path.resolve(expanded);
    const root = path.resolve(LAUNCHER_HOME);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Sólo se pueden abrir rutas dentro de ${root}.`);
    }
    if (!fs.existsSync(target)) throw new Error(`La ruta no existe: ${target}`);

    const via = await openInSystem(target);
    sendJSON(res, 200, { ok: true, path: target, via });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJSON(res, 500, { ok: false, error: detail });
  }
}

/* -------------------------------------------------------------------------- */
/* Lanzamiento de ports instalados                                            */
/* -------------------------------------------------------------------------- */

/** Extensiones que se consideran ejecutables de un port, por plataforma. */
const LAUNCH_EXTS =
  process.platform === 'win32'
    ? new Set(['.exe', '.bat', '.cmd'])
    : new Set(['.appimage', '.sh', '.run', '.bin', '.x86_64', '.command']);

/** Ficheros que acompañan al port pero nunca son el ejecutable. */
const NOT_EXECUTABLE = /^(readme|license|licence|copying|changelog|contributing|makefile|cmakelists|dockerfile|\.)/i;

/**
 * Reúne los ficheros de `dir` (hasta `remaining` niveles) en `out`.
 *
 * Se ignoran los ocultos (`.git`, `.github`…) y se acota el total para que un
 * árbol enorme no bloquee el servidor local.
 */
function collectFiles(dir, remaining, out) {
  if (remaining < 0 || out.length >= 4000) return;
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (out.length >= 4000) return;
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      collectFiles(full, remaining - 1, out);
      continue;
    }
    if (item.isFile()) out.push(full);
  }
}

/**
 * Puntúa un fichero como candidato a ejecutable principal del port.
 *
 * Gana el que el usuario declaró en el engranaje (`hint`), después el binario
 * nativo de la plataforma (AppImage/`.exe`), después el que se llama como la
 * carpeta del port y, por último, cualquier ELF o script con shebang. Se penaliza
 * la profundidad: el ejecutable suele estar en la raíz del port.
 */
function launchScore(file, base, hint) {
  const baseName = path.basename(file).toLowerCase();
  const ext = path.extname(baseName);
  const folderName = path.basename(base).toLowerCase();
  const relative = path.relative(base, file);
  const depth = relative.split(path.sep).length - 1;

  const launchable = LAUNCH_EXTS.has(ext) || looksExecutable(file);
  if (!launchable) return -1;
  if (NOT_EXECUTABLE.test(baseName)) return -1;

  let score = 0;
  if (hint) {
    const wanted = path.basename(String(hint).replace(/\\/g, '/')).toLowerCase();
    if (wanted && wanted === baseName) score += 100;
  }
  if (LAUNCH_EXTS.has(ext)) score += 40;
  if (process.platform === 'linux' && ext === '.appimage') score += 30;
  if (process.platform === 'win32' && ext === '.exe') score += 30;
  if (process.platform !== 'win32' && ext === '.exe') score -= 20;
  if (baseName.replace(/\.[^.]+$/, '') === folderName) score += 12;
  score -= depth * 4;
  return score;
}

/**
 * Localiza el ejecutable principal del port dentro de `dir`.
 *
 * @returns {{ file: string, relative: string } | null}
 */
function findMainExecutable(dir, hint) {
  const files = [];
  collectFiles(dir, 2, files);

  let best = null;
  for (const file of files) {
    const score = launchScore(file, dir, hint);
    if (score < 0) continue;
    if (!best || score > best.score) best = { file, score };
  }
  if (!best) return null;
  return { file: best.file, relative: path.relative(dir, best.file) };
}

/** Atiende `POST /api/launch` y, si algo falla, deja el reporte escrito. */
async function handleLaunch(req, res) {
  if (req.method !== 'POST') {
    sendJSON(res, 405, { ok: false, error: 'Usa POST.' });
    return;
  }

  let body = {};
  try {
    body = await readJSON(req);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJSON(res, 400, { ok: false, error: detail });
    return;
  }

  const pid = body && body.pid ? String(body.pid) : '';
  const name = body && body.name ? String(body.name) : '';

  /** Responde con el error y su reporte: el frontend abre el modal con la ruta. */
  const fail = (error, extra) => {
    const detail = error instanceof Error ? error.message : String(error);
    let logPath = null;
    try {
      logPath = writeErrorReport({
        pid,
        name,
        action: 'launch',
        error,
        details: Object.assign({ folderName: body && body.folderName }, extra || {}),
      });
    } catch (writeError) {
      console.error(
        '[launch] no se pudo escribir el reporte:',
        writeError instanceof Error ? writeError.message : writeError
      );
    }
    sendJSON(res, 500, { ok: false, error: detail, logPath });
  };

  try {
    const folder = safeFolder(body && body.folderName);
    const installDir = path.join(PORTS_DIR, folder);

    if (!fs.existsSync(installDir) || !fs.statSync(installDir).isDirectory()) {
      fail(
        new Error(`El port no está instalado en ${installDir}. Instálalo de nuevo desde el catálogo.`),
        { installDir, reason: 'missing-install' }
      );
      return;
    }

    const hint = body && body.exe ? String(body.exe) : '';
    const found = findMainExecutable(installDir, hint);
    if (!found) {
      let listing = [];
      try {
        listing = fs.readdirSync(installDir).slice(0, 12);
      } catch {}
      fail(
        new Error(
          `No se encontró un ejecutable en ${installDir}. ` +
            `Contenido: ${listing.length ? listing.join(', ') : '(carpeta vacía)'}.`
        ),
        { installDir, reason: 'no-executable', listing }
      );
      return;
    }

    /* En Linux un binario sin permiso de ejecución no arranca; el pipeline de
     * instalación ya hace `chmod`, pero un port copiado a mano puede no tenerlo. */
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(found.file, 0o755);
      } catch {
        /* Sistema de ficheros sin permisos POSIX. */
      }
    }

    const args = String((body && body.args) || '')
      .split(/\s+/)
      .filter(Boolean);

    /* Desacoplado: el port sobrevive al cierre del launcher y no comparte
     * consola con él (`stdio: 'ignore'`). */
    const child = spawn(found.file, args, {
      cwd: installDir,
      detached: true,
      stdio: 'ignore',
    });
    /* `spawn` devuelve el error (ENOENT/EACCES) por evento, no lanzando: sin
     * este manejador el fallo sería un `uncaughtException` del proceso. */
    child.on('error', (error) => {
      console.warn('[launch] el port falló al arrancar:', error.message);
    });
    child.unref();

    sendJSON(res, 200, {
      ok: true,
      path: found.file,
      relative: found.relative,
      installDir,
      pid: child.pid ?? null,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(error instanceof Error ? error : new Error(detail), { reason: 'launch-exception' });
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
  if (url === '/api/report-error') {
    await handleReportError(req, res);
    return true;
  }
  if (url === '/api/open-path') {
    await handleOpenPath(req, res);
    return true;
  }
  if (url === '/api/launch') {
    await handleLaunch(req, res);
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
      url === '/api/report-error' ||
      url === '/api/open-path' ||
      url === '/api/launch' ||
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
  LOGS_DIR,
  PORTS_DIR,
  STEAMGRID_PREFIX,
  chmodExecutables,
  createApiMiddleware,
  extractZip,
  findMainExecutable,
  handleApiRequest,
  handleLaunch,
  handleOpenPath,
  handleReportError,
  handleSelfUpdate,
  installPort,
  looksExecutable,
  openInSystem,
  safeEntry,
  safeFolder,
  scoreAsset,
  sendJSON,
  writeErrorReport,
};
