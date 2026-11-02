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
 *   POST /api/launch                     → ejecuta el port instalado (spawn desacoplado y confirmado).
 *   POST /api/report-error               → escribe un reporte técnico en `~/PortsLauncher/logs`.
 *   POST /api/open-path                  → abre un reporte `.log` o la carpeta de plugins en el SO.
 *   POST /api/launcher/self-update       → guarda el instalador de una versión nueva en ~/Downloads.
 *   GET  /api/library                    → lee la biblioteca de `~/PortsLauncher/ports.json`.
 *   POST /api/library                    → guarda la biblioteca en `~/PortsLauncher/ports.json`.
 *   GET  /api/plugins                    → plugins `asset-provider` instalados en disco.
 *   POST /api/plugins/search             → busca assets ejecutando el plugin (capacidad `search`).
 *   POST /api/plugins/provision          → aprovisiona un asset con el plugin (capacidad `provision`).
 *   GET  /api/steamgrid/__status         → informa de la clave disponible y la devuelve.
 *   POST /api/steamgrid/__save-key       → guarda la clave en ~/.steamgrid_credentials.env.
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

/**
 * Lee y parsea el cuerpo JSON de la petición.
 *
 * El tope por defecto son 64 KiB (suficiente para cualquier cuerpo de control).
 * `maxBytes` permite subirlo en las rutas que reciben documentos completos: la
 * biblioteca (`ports.json`) crece con cada port instalado y con 64 KiB se
 * rechazaría una biblioteca grande destruyendo la petición a mitad de envío.
 */
function readJSON(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
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

/* -------------------------------------------------------------------------- */
/* Credenciales: guardado de la clave personal                                */
/* -------------------------------------------------------------------------- */

/** Tope del cuerpo de `__save-key` (la clave ronda las decenas de bytes). */
const STEAMGRID_KEY_BODY_LIMIT = 8 * 1024;

/** Caracteres prohibidos en la clave: romperían el `.env` y las cabeceras. */
const UNSAFE_KEY_CHARS = /[\r\n\x00]/;

/**
 * Escribe `STEAMGRID_API_KEY` en `~/.steamgrid_credentials.env`.
 *
 * Conserva el resto del fichero (comentarios y otras variables) y sustituye
 * solo las líneas de la clave, de modo que el fichero sigue siendo un `.env`
 * válido para el usuario. Una clave vacía **borra** la línea: así se puede
 * limpiar la credencial desde Ajustes.
 *
 * La escritura es atómica (temporal + `rename`) para que un corte a mitad no
 * deje el `.env` truncado, y el fichero queda con permisos `0600` porque es un
 * secreto. Devuelve la clave realmente almacenada (`''` si se borró).
 */
function writeSteamgridKey(key) {
  const value = String(key || '').trim();
  if (UNSAFE_KEY_CHARS.test(value)) {
    throw new Error('La clave contiene caracteres no válidos.');
  }

  let lines = [];
  try {
    lines = fs.readFileSync(STEAMGRID_CREDENTIALS, 'utf8').split(/\r?\n/);
  } catch {
    /* Sin fichero previo: se crea desde cero. */
  }

  const kept = lines.filter((line) => !/^\s*(?:export\s+)?STEAMGRID_API_KEY\s*=/.test(line));
  if (value) kept.push(`${STEAMGRID_KEY_NAME}=${value}`);
  const body = `${kept.join('\n').replace(/\n+$/, '')}\n`;

  fs.mkdirSync(path.dirname(STEAMGRID_CREDENTIALS), { recursive: true });
  const tmp = `${STEAMGRID_CREDENTIALS}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, STEAMGRID_CREDENTIALS);
  try {
    fs.chmodSync(STEAMGRID_CREDENTIALS, 0o600);
  } catch {
    /* Windows no entiende permisos POSIX: se ignora. */
  }
  return value;
}

/**
 * `POST /api/steamgrid/__save-key` — persiste la clave del usuario en disco.
 *
 * El frontend lo llama al editar la clave en Ajustes y al terminar el
 * asistente, para que la credencial sobreviva en `~/.steamgrid_credentials.env`
 * y no dependa solo de `ports.json`. Responde `{ ok, path, configured }`; el
 * `key` nunca se devuelve (no hace falta y evita filtrarlo en un log).
 */
async function handleSteamgridSaveKey(req, res) {
  let body;
  try {
    body = await readJSON(req, STEAMGRID_KEY_BODY_LIMIT);
  } catch (error) {
    sendJSON(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const raw = body && typeof body === 'object' ? body.key : '';
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    sendJSON(res, 400, { ok: false, error: '`key` debe ser una cadena.' });
    return;
  }

  try {
    const stored = writeSteamgridKey(typeof raw === 'string' ? raw : '');
    sendJSON(res, 200, {
      ok: true,
      path: STEAMGRID_CREDENTIALS,
      configured: !!stored,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJSON(res, 500, { ok: false, error: `No se pudo guardar la clave: ${detail}` });
  }
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

  /* Sonda de configuración: no necesita clave, solo informa de si existe.
   * Devuelve también la clave (`key`) para que el frontend pueda
   * autodetectarla y rellenar los ajustes cuando aún no la tenía guardada. */
  if (endpoint === '__status') {
    sendJSON(res, 200, {
      success: true,
      configured: !!serverKey,
      client: !!header,
      key: serverKey || '',
    });
    return;
  }

  /* Persistencia de la clave personal en `~/.steamgrid_credentials.env`.
   * Va antes del 503 para que se pueda guardar la clave cuando todavía no hay
   * ninguna configurada (que es justo el caso en el que se llama). */
  if (endpoint === '__save-key') {
    if (req.method !== 'POST') {
      sendJSON(res, 405, { ok: false, error: 'Usa POST para guardar la clave.' });
      return;
    }
    await handleSteamgridSaveKey(req, res);
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

/* -------------------------------------------------------------------------- */
/* Biblioteca del usuario: `~/PortsLauncher/ports.json`                       */
/* -------------------------------------------------------------------------- */

/**
 * Fichero de biblioteca del usuario: `~/PortsLauncher/ports.json`.
 *
 * Es la fuente de verdad de la biblioteca (qué ports hay instalados, su ROM,
 * el arte personalizado y los ajustes). El frontend lo lee al arrancar con
 * `GET /api/library` y lo reescribe con `POST /api/library` en cada cambio; el
 * `localStorage` queda como caché para cuando el backend no está disponible
 * (por ejemplo un `dist` servido sin la API).
 */
const LIBRARY_FILE = path.join(LAUNCHER_HOME, 'ports.json');

/** Tope del cuerpo de `POST /api/library` (una biblioteca puede ser grande). */
const LIBRARY_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Forma mínima de un `ports.json` aceptable: objeto con `games` como objeto.
 *
 * El saneado fino (estados válidos, ajustes dentro de rango, arte correcto) lo
 * hace `libraryService` en el renderer; aquí solo se rechaza lo que no es una
 * biblioteca, para no escribir basura encima de la del usuario.
 */
function isLibraryPayload(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !!value.games &&
    typeof value.games === 'object' &&
    !Array.isArray(value.games)
  );
}

/**
 * Lee `~/PortsLauncher/ports.json`.
 *
 * @returns La biblioteca ya parseada, o `null` si el fichero no existe, está
 *          vacío, no es JSON o no tiene forma de biblioteca.
 */
function readLibraryFile() {
  let raw;
  try {
    raw = fs.readFileSync(LIBRARY_FILE, 'utf8');
  } catch {
    return null;
  }
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return isLibraryPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Escribe la biblioteca de forma atómica (`tmp` + `rename`).
 *
 * Un `writeFileSync` directo sobre `ports.json` deja el fichero truncado si el
 * proceso muere a mitad: el arranque siguiente leería una biblioteca corrupta y
 * la daría por perdida. Con `rename` el reemplazo es atómico en el mismo
 * sistema de ficheros.
 *
 * @returns Número de bytes escritos.
 */
function writeLibraryFile(library) {
  ensureDir(LAUNCHER_HOME);
  const body = JSON.stringify(library, null, 2);
  const tmp = path.join(
    LAUNCHER_HOME,
    `.ports.json.${process.pid}.${Date.now().toString(36)}.tmp`
  );
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, LIBRARY_FILE);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* El temporal pudo no llegar a crearse: nada que limpiar. */
    }
    throw error;
  }
  return Buffer.byteLength(body, 'utf8');
}

/**
 * `GET /api/library`  → biblioteca leída de `~/PortsLauncher/ports.json`.
 * `POST /api/library` → guarda la biblioteca recibida en ese mismo fichero.
 *
 * El GET responde 200 siempre que la ruta sea válida, incluso sin fichero
 * (`exists: false`, `library: null`): el frontend distingue «no hay nada
 * todavía» de «el backend falló» por el código de estado, no por el cuerpo.
 *
 * El POST acepta el documento plano o envuelto en `{ library: … }`.
 */
async function handleLibrary(req, res) {
  if (req.method === 'GET') {
    try {
      const library = readLibraryFile();
      sendJSON(res, 200, {
        ok: true,
        path: LIBRARY_FILE,
        exists: library !== null,
        library,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJSON(res, 500, { ok: false, error: detail });
    }
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJSON(req, LIBRARY_MAX_BYTES);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJSON(res, 400, { ok: false, error: detail });
      return;
    }

    /* Se admite el documento plano y la forma envuelta para no atar el
     * contrato del frontend a una sola representación. */
    const library =
      body && typeof body.library === 'object' && body.library && !Array.isArray(body.library)
        ? body.library
        : body;

    if (!isLibraryPayload(library)) {
      sendJSON(res, 400, {
        ok: false,
        error: 'ports.json no válido: se esperaba un objeto con `games`.',
      });
      return;
    }

    try {
      const bytes = writeLibraryFile(library);
      sendJSON(res, 200, { ok: true, path: LIBRARY_FILE, bytes });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[library] no se pudo escribir ports.json:', detail);
      sendJSON(res, 500, { ok: false, error: detail });
    }
    return;
  }

  sendJSON(res, 405, { ok: false, error: 'Usa GET o POST.' });
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

/**
 * Ejecuta un comando del sistema tolerando sus códigos de salida.
 *
 * `explorer.exe` termina con `1` incluso cuando abre la ventana correctamente,
 * así que un exit code distinto de 0 no es prueba de fallo. Sólo se propaga el
 * error cuando el binario no existe o no se pudo lanzar: en ese caso
 * `error.code` es una cadena (`ENOENT`, `EACCES`…). Un número es el código de
 * salida del proceso y se ignora.
 */
async function execTolerant(command, args) {
  try {
    await execFileAsync(command, args, { timeout: 15_000 });
  } catch (error) {
    if (error && typeof error.code === 'string') throw error;
  }
}

/**
 * Abre `target` con el gestor de archivos / visor predeterminado del SO.
 *
 * En Windows no se usa `cmd.exe /c start`: `cmd` interpretaría metacaracteres
 * del path (`&`, `|`, `^`, `%`, paréntesis) y `start` ejecutaría cualquier
 * binario o script que se le pase. Se invocan directamente `notepad.exe` para
 * los reportes `.log` y `explorer.exe` para carpetas (y para cualquier otro
 * fichero, que `explorer` delega en su aplicación asociada). Ambos reciben la
 * ruta como argumento literal, sin shell intermedio.
 */
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
    const isDir = fs.statSync(target).isDirectory();
    if (!isDir && path.extname(target).toLowerCase() === '.log') {
      await execTolerant('notepad.exe', [target]);
      return 'notepad';
    }
    await execTolerant('explorer.exe', [target]);
    return 'explorer';
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  await execFileAsync(command, [target], { timeout: 15_000 });
  return command;
}

/**
 * Ruta canónica para comparar contra la lista blanca.
 *
 * Resuelve los enlaces simbólicos del tramo que ya existe y recompone el resto:
 * así un directorio aún no creado sigue siendo comparable (realpath falla sobre
 * rutas inexistentes) y un `~` que el sistema resuelve de otra forma —macOS
 * `/var` → `/private/var`— no provoca falsos rechazos. Sin esto, un symlink
 * colocado en `logs/` apuntando fuera del árbol pasaría la comprobación de
 * prefijo.
 */
function canonicalPath(target) {
  let current = target;
  const tail = [];
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
  return target;
}

/**
 * `POST /api/open-path` → abre un archivo o carpeta con la app del sistema.
 *
 * Lista blanca estricta, porque el endpoint lo invoca el renderer y sin cota
 * cualquier inyección en la UI podría abrir —o ejecutar, vía `start`— documentos
 * arbitrarios del usuario:
 *   · ficheros `*.log` de `~/PortsLauncher/logs`;
 *   · la carpeta de plugins, o cualquier carpeta contenida en ella.
 * Todo lo demás se rechaza, incluido el resto de `~/PortsLauncher` (los ports
 * descargados viven ahí y contienen binarios y scripts no confiables). Las URLs
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
    const target = canonicalPath(path.resolve(expanded));

    /* `PLUGINS_DIR` y `LEGACY_PLUGINS_DIR` se declaran más abajo en el módulo:
     * aquí ya están inicializadas porque esta función sólo se ejecuta en
     * runtime, cuando la evaluación del módulo ha terminado. */
    const logsRoot = canonicalPath(path.resolve(LOGS_DIR));
    const pluginRoots = [
      canonicalPath(path.resolve(PLUGINS_DIR)),
      canonicalPath(path.resolve(LEGACY_PLUGINS_DIR)),
    ].filter((root, index, all) => all.indexOf(root) === index);

    const inLogs = target !== logsRoot && target.startsWith(logsRoot + path.sep);
    const inPlugins = pluginRoots.some(
      (root) => target === root || target.startsWith(root + path.sep)
    );

    if (inLogs) {
      /* Un `.log` renombrado a `.exe`/`.sh` dentro de logs sería un binario
       * abrible: se exige la extensión exacta y no se delega en el visor
       * predeterminado para cualquier otra cosa. */
      if (path.extname(target).toLowerCase() !== '.log') {
        throw new Error('Sólo se pueden abrir reportes técnicos (.log) de la carpeta de logs.');
      }
    } else if (!inPlugins) {
      throw new Error(
        `Sólo se pueden abrir reportes de ${logsRoot} o la carpeta de plugins ${pluginRoots[0]}.`
      );
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

/** Marcador que los perfiles de lanzamiento usan para la ruta de la ROM. */
const ROM_PLACEHOLDER = '{rom}';

/** Extensiones que el launcher reconoce como ROM (para avisar, no para bloquear). */
const ROM_FILE_EXTS = new Set([
  '.z64',
  '.n64',
  '.v64',
  '.sfc',
  '.smc',
  '.nes',
  '.gba',
  '.gb',
  '.gbc',
  '.nds',
  '.bin',
  '.cue',
  '.iso',
  '.chd',
  '.7z',
  '.zip',
]);

/**
 * Ventana de gracia tras el `spawn` para detectar un cierre inmediato.
 *
 * Sin ella, un binario que muere a los 50 ms (ROM incompatible, librería
 * ausente, argumento inválido) devolvía 200 y la UI decía «en ejecución» sin
 * que se abriera ninguna ventana. Se espera de forma acotada para no retrasar
 * un lanzamiento correcto más de lo razonable.
 */
const EARLY_EXIT_WINDOW_MS = 1200;

/**
 * Normaliza los argumentos de lanzamiento.
 *
 * Acepta el array ya resuelto por el frontend (`resolveLaunchArgs`) y, por
 * compatibilidad con clientes antiguos, la cadena separada por espacios.
 *
 * @returns {string[]}
 */
function buildLaunchArgs(raw) {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value)).filter((value) => value !== '');
  }
  return String(raw || '')
    .split(/\s+/)
    .filter(Boolean);
}

/** Últimas `max` letras de un log, o `''` si no se puede leer. */
function readLogTail(file, max) {
  if (!file) return '';
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.length > max ? text.slice(-max) : text;
  } catch {
    return '';
  }
}

/** Primera línea útil (preferentemente un error) del stderr de un port. */
function firstUsefulLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const hit =
    lines.find((line) => /error|failed|denied|no such|cannot|abort|not found/i.test(line)) ?? lines[0];
  return hit.slice(0, 300);
}

/**
 * Enlaza la ROM del usuario dentro de la carpeta del port (HU-13).
 *
 * Los ports de descompilación (`2ship.appimage`) buscan la ROM en su propio
 * `cwd`: si el usuario la tiene en `~/Descargas`, el binario arranca y se cierra
 * sin mensaje. Se crea un enlace simbólico dentro de `installDir` (mismo nombre
 * de archivo) y, si el sistema no permite enlaces, se copia.
 *
 * Se acepta cualquier fichero regular existente: la validación de extensión es
 * cosa del `romProfile`, y bloquear aquí impediría formatos que el índice aún
 * no declara.
 *
 * @returns {string | null} ruta que debe recibir `{rom}`, o `null` si no hay.
 */
function linkRomForLaunch(rawRomPath, installDir) {
  const value = String(rawRomPath || '').trim();
  if (!value) return null;

  let source = '';
  try {
    source = path.resolve(value);
  } catch {
    return null;
  }

  let isFile = false;
  try {
    const stat = fs.statSync(source);
    isFile = stat.isFile() && stat.size > 0;
  } catch (error) {
    console.warn(
      '[launch] romPath ignorado (no existe):',
      source,
      error instanceof Error ? error.message : error
    );
    return null;
  }
  if (!isFile) {
    console.warn('[launch] romPath ignorado (no es un archivo con contenido):', source);
    return null;
  }

  const base = path.basename(source);
  if (!base || base === '.' || base === '..') return null;
  if (path.extname(base) && !ROM_FILE_EXTS.has(path.extname(base).toLowerCase())) {
    /* No se bloquea: hay ports con formatos propios, pero deja rastro. */
    console.warn('[launch] la ROM declarada tiene una extensión no habitual:', base);
  }

  /* Ya está en la carpeta del port: no hay nada que enlazar. */
  if (path.resolve(path.dirname(source)) === path.resolve(installDir)) return source;

  const target = path.join(installDir, base);

  /**
   * ¿El enlace de `linkPath` apunta ya a `expected`?
   *
   * `readlinkSync` puede devolver una ruta relativa, y `source` no viene
   * canonicalizado, así que se comparan las rutas resueltas y, si no coinciden,
   * el `realpath` de ambas (el usuario puede haber elegido la ROM a través de
   * otro enlace). Cualquier fallo se trata como «no coincide».
   */
  const sameTarget = (linkPath, expected) => {
    let current = '';
    try {
      current = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    } catch {
      return false;
    }
    if (current === expected) return true;
    try {
      return fs.realpathSync(current) === fs.realpathSync(expected);
    } catch {
      return false;
    }
  };

  let existing = null;
  try {
    existing = fs.lstatSync(target);
  } catch {
    /* No existe: se crea abajo. */
  }

  if (existing) {
    if (existing.isSymbolicLink()) {
      /* Enlace vigente y correcto: se reutiliza tal cual. */
      if (sameTarget(target, source)) return target;
      /* Enlace huérfano (destino borrado) o que apunta a otra ROM con el mismo
       * nombre de archivo: se elimina para no lanzar el juego equivocado y se
       * recrea más abajo con el nuevo destino. */
      try {
        fs.unlinkSync(target);
        console.warn('[launch] enlace previo de la ROM reemplazado:', target, '→', source);
      } catch (error) {
        console.warn(
          '[launch] no se pudo reemplazar el enlace previo de la ROM; se usará la ruta original:',
          error instanceof Error ? error.message : error
        );
        return source;
      }
    } else if (existing.isFile()) {
      /* Copia anterior (sistemas de ficheros sin enlaces): se reutiliza. */
      return target;
    } else {
      console.warn('[launch] ya existe una entrada no-archivo con el nombre de la ROM:', target);
      return source;
    }
  }

  try {
    fs.symlinkSync(source, target);
    return target;
  } catch (error) {
    console.warn(
      '[launch] no se pudo crear el enlace simbólico, se copia la ROM:',
      error instanceof Error ? error.message : error
    );
  }

  try {
    fs.copyFileSync(source, target);
    return target;
  } catch (error) {
    console.warn(
      '[launch] no se pudo copiar la ROM; se usará la ruta original:',
      error instanceof Error ? error.message : error
    );
    return source;
  }
}

/**
 * Espera `ms` a que el hijo termine.
 *
 * @returns {Promise<{code: number | null, signal: string | null} | null>} `null`
 *   si sigue vivo al agotarse la ventana.
 */
function waitForEarlyExit(child, ms) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    /* Declaraciones de función (hoisted) para que `finish` pueda referirse a
     * `onExit` y a `timer` sin depender del orden de inicialización. */
    function finish(value) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(value);
    }
    function onExit(code, signal) {
      finish({ code, signal });
    }
    timer = setTimeout(() => finish(null), ms);
    child.once('exit', onExit);
  });
}

/** Abre un fichero de log para el stderr del port. */
function openLaunchLog(name) {
  try {
    ensureDir(LOGS_DIR);
    const file = path.join(LOGS_DIR, `launch-${safeSegment(name, 'port')}-${fileStamp(new Date())}.log`);
    return { file, fd: fs.openSync(file, 'w') };
  } catch (error) {
    console.warn(
      '[launch] no se pudo abrir el log de salida del port:',
      error instanceof Error ? error.message : error
    );
    return { file: null, fd: null };
  }
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

    /* --- ROM del port (HU-13) ------------------------------------------- */
    /* La ROM se enlaza dentro de `installDir` para que los binarios que la
     * buscan en su `cwd` la encuentren, y `{rom}` se sustituye tanto si el
     * frontend ya lo hizo (array resuelto) como si llega en crudo. */
    const linkedRom = linkRomForLaunch(body && body.romPath, installDir);
    const rawArgs = buildLaunchArgs(body && body.args);
    /* Un perfil con `{rom}` que llega sin ROM válida no debe ejecutarse: el
     * binario recibiría el literal `{rom}` y moriría sin mensaje útil (o, peor,
     * abriría el port sin juego). Se corta con 400 antes del `spawn`. */
    if (!linkedRom && rawArgs.some((token) => token.includes(ROM_PLACEHOLDER))) {
      sendJSON(res, 400, {
        ok: false,
        error: 'El port requiere una ROM pero no se ha configurado ninguna válida.',
        reason: 'missing-rom',
        romPath: body && body.romPath ? String(body.romPath) : null,
        installDir,
      });
      return;
    }
    const args = rawArgs
      .map((token) => (linkedRom ? token.split(ROM_PLACEHOLDER).join(linkedRom) : token))
      .filter((token) => token !== '');

    /* Desacoplado: el port sobrevive al cierre del launcher. El stderr va a un
     * archivo (no a un pipe) para no dejar handles vivos en el proceso
     * principal y poder leerlo si el binario muere nada más arrancar. */
    const launchLog = openLaunchLog(body && body.name ? body.name : found.relative);
    const child = spawn(found.file, args, {
      cwd: installDir,
      detached: true,
      stdio: ['ignore', 'ignore', launchLog.fd === null ? 'ignore' : launchLog.fd],
    });
    if (launchLog.fd !== null) {
      /* El hijo ya tiene su propia copia del descriptor. */
      try {
        fs.closeSync(launchLog.fd);
      } catch {
        /* Sin consecuencias: el fd se cierra al salir el proceso. */
      }
    }

    /* `spawn` no lanza: el fallo de arranque (ENOENT, EACCES, ELF de otra
     * arquitectura, shebang sin intérprete) llega por el evento `error`. Si se
     * respondiera 200 de inmediato, el usuario vería el port como «en
     * ejecución» y el fallo quedaría sólo en la consola, sin reporte.
     * Se espera al primer `spawn` o `error` antes de contestar. */
    try {
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } catch (error) {
      child.removeAllListeners();
      fail(error instanceof Error ? error : new Error(String(error)), {
        reason: 'spawn-error',
        installDir,
        exe: found.file,
        args,
        rom: linkedRom,
        stderr: readLogTail(launchLog.file, 2000),
        stderrFile: launchLog.file,
      });
      return;
    }

    /* Cierre inmediato: el binario arrancó pero murió antes de abrir ventana
     * (ROM incompatible, librería ausente, argumento inválido). Se reporta el
     * código y el stderr en vez de decir «en ejecución». */
    const early = await waitForEarlyExit(child, EARLY_EXIT_WINDOW_MS);
    const stderrTail = readLogTail(launchLog.file, 2000);
    if (early && (early.signal !== null || (early.code !== null && early.code !== 0))) {
      child.removeAllListeners();
      const code = early.code === null || early.code === undefined ? 'desconocido' : early.code;
      const signal = early.signal ? `, señal ${early.signal}` : '';
      const detail = firstUsefulLine(stderrTail);
      fail(
        new Error(
          `El port se cerró inmediatamente tras arrancar (código ${code}${signal}).` +
            (detail ? ` Salida del binario: ${detail}` : ' El binario no dejó ningún mensaje.')
        ),
        {
          reason: 'early-exit',
          code: early.code,
          signal: early.signal,
          installDir,
          exe: found.file,
          args,
          rom: linkedRom,
          stderr: stderrTail,
          stderrFile: launchLog.file,
        }
      );
      return;
    }

    /* Ya en marcha: un `error` posterior no debe convertirse en
     * `uncaughtException` del proceso principal. */
    child.on('error', (error) => {
      console.warn('[launch] el port falló tras arrancar:', error.message);
    });
    child.unref();

    sendJSON(res, 200, {
      ok: true,
      path: found.file,
      relative: found.relative,
      installDir,
      pid: child.pid ?? null,
      rom: linkedRom,
      args,
      /* El binario terminó por su cuenta dentro de la ventana de gracia. */
      exitedEarly: !!early,
      stderrFile: launchLog.file,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(error instanceof Error ? error : new Error(detail), { reason: 'launch-exception' });
  }
}

/* -------------------------------------------------------------------------- */
/* Plugins (addons) del usuario                                               */
/* -------------------------------------------------------------------------- */

/**
 * Carpeta de plugins del launcher: `~/PortsLauncher/plugins`.
 *
 * Cada plugin es una carpeta con un `plugin.json` en su raíz. El launcher no
 * inventa plugins: si la carpeta está vacía, la lista llega vacía a la UI.
 */
const PLUGINS_DIR = path.join(LAUNCHER_HOME, 'plugins');

/**
 * Carpeta heredada que también se escanea.
 *
 * Es la ruta que documentaba la sección de Addons (`~/.local/share/portslauncher/
 * plugins`) antes de unificar los datos en `~/PortsLauncher`. Se lee en modo
 * compatibilidad para no perder los plugins ya instalados allí.
 */
const LEGACY_PLUGINS_DIR = path.join(os.homedir(), '.local', 'share', 'portslauncher', 'plugins');

/** Tope de carpetas de plugin leídas por escaneo (evita bloquear el servidor). */
const MAX_PLUGINS = 200;

/** Crea la carpeta de plugins al arrancar; un fallo aquí no debe tumbar la API. */
function ensurePluginsDir() {
  try {
    return ensureDir(PLUGINS_DIR);
  } catch (error) {
    console.warn('[plugins] no se pudo crear la carpeta de plugins:', error);
    return PLUGINS_DIR;
  }
}

ensurePluginsDir();

/** Cadena recortada y no vacía, o `null`. */
function textOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Lee el `plugin.json` de `dir` y lo normaliza.
 *
 * @returns El manifiesto listo para la UI, o `null` si no hay manifiesto válido.
 */
function readPluginManifest(dir) {
  const manifestPath = path.join(dir, 'plugin.json');
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`[plugins] plugin.json ilegible en ${dir}:`, error);
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  /* El `id` es obligatorio en la práctica: sin él no hay forma estable de
   * activar/desactivar el plugin, así que se cae al nombre de la carpeta. */
  const id = textOrNull(parsed.id) ?? textOrNull(parsed.slug) ?? path.basename(dir);
  const name = textOrNull(parsed.name) ?? textOrNull(parsed.title) ?? id;
  if (!id || !name) return null;

  return {
    id,
    name,
    version: textOrNull(parsed.version) ?? '0.0.0',
    description: textOrNull(parsed.description) ?? '',
    author: textOrNull(parsed.author) ?? null,
    type: textOrNull(parsed.type) ?? 'plugin',
    icon: textOrNull(parsed.icon) ?? null,
    enabled: parsed.enabled !== false,
    dir,
  };
}

/**
 * Añade a `out` los plugins de `dir` que aún no estén en `seen`.
 *
 * `seen` es el conjunto de `id` ya entregados: la carpeta principal gana frente
 * a la heredada cuando ambas declaran el mismo plugin.
 */
function scanPluginsDir(dir, out, seen) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    /* La carpeta no existe (o no es legible): no hay plugins que aportar. */
    return;
  }
  for (const item of items) {
    if (out.length >= MAX_PLUGINS) return;
    if (!item.isDirectory() || item.name.startsWith('.')) continue;
    const manifest = readPluginManifest(path.join(dir, item.name));
    if (!manifest || seen.has(manifest.id)) continue;
    seen.add(manifest.id);
    out.push(manifest);
  }
}

/** Plugins reales encontrados en disco (carpeta principal primero). */
function listPlugins() {
  ensurePluginsDir();
  const found = [];
  const seen = new Set();
  scanPluginsDir(PLUGINS_DIR, found, seen);
  if (LEGACY_PLUGINS_DIR !== PLUGINS_DIR) scanPluginsDir(LEGACY_PLUGINS_DIR, found, seen);
  return found;
}

/** `GET /api/plugins` → plugins reales leídos de `plugin.json` en disco. */
async function handlePlugins(req, res) {
  if (req.method !== 'GET') {
    sendJSON(res, 405, { ok: false, error: 'Usa GET.' });
    return;
  }
  try {
    sendJSON(res, 200, { ok: true, path: PLUGINS_DIR, plugins: listPlugins() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sendJSON(res, 500, { ok: false, error: detail });
  }
}

/** `GET /api/plugins/dir` → ruta real de la carpeta de plugins. */
async function handlePluginsDir(req, res) {
  if (req.method !== 'GET') {
    sendJSON(res, 405, { ok: false, error: 'Usa GET.' });
    return;
  }
  sendJSON(res, 200, { ok: true, path: ensurePluginsDir() });
}

/* -------------------------------------------------------------------------- */
/* Ejecución de plugins de aprovisionamiento (`asset-provider`)               */
/* -------------------------------------------------------------------------- */

/**
 * Tope de tiempo de un `search`.
 *
 * Un `search` sale a la red (Vimm, GitHub, …) y puede tardar, pero por encima
 * de este umbral se mata el proceso y se responde 504: una petición HTTP del
 * renderer no puede quedarse colgada esperando a un plugin que no responde.
 */
const PLUGIN_SEARCH_TIMEOUT = 45_000;

/** Tope de tiempo de un `provision` (abre el navegador y espera la descarga). */
const PLUGIN_PROVISION_TIMEOUT = 90_000;

/** Tope de `stdout` acumulado de un plugin (protección anti-OOM). */
const PLUGIN_MAX_STDOUT = 8 * 1024 * 1024;

/** Tope de `stderr` acumulado, que solo se usa para el mensaje de error. */
const PLUGIN_MAX_STDERR = 64 * 1024;

/** Tope de eventos de progreso retenidos de un `provision`. */
const PLUGIN_MAX_EVENTS = 200;

/** Intérpretes conocidos para el campo `runtime` del manifiesto. */
const PLUGIN_RUNTIMES = new Map([
  ['python3', 'python3'],
  ['python', 'python3'],
  ['py', 'python3'],
  ['node', 'node'],
  ['nodejs', 'node'],
  ['bash', 'bash'],
  ['sh', 'bash'],
]);

/**
 * Extrae de `plugin.json` lo necesario para *ejecutar* el plugin.
 *
 * `readPluginManifest` normaliza solo lo que pinta la vista de addons y descarta
 * `entrypoint`, `runtime`, `capabilities` y `platforms`, que son justo los datos
 * que necesita la ejecución. El `entrypoint` se resuelve con `safeEntry` para
 * que un manifiesto con `../` no pueda apuntar fuera de su carpeta.
 *
 * @returns La especificación ejecutable, o `null` si el plugin no es ejecutable.
 */
function readPluginExecSpec(dir) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  /* `enabled: false` en el manifiesto desactiva el plugin también para la API. */
  if (parsed.enabled === false) return null;

  const id = textOrNull(parsed.id) ?? textOrNull(parsed.slug) ?? path.basename(dir);
  const entry = textOrNull(parsed.entrypoint) ?? textOrNull(parsed.main);
  if (!id || !entry) return null;

  const entrypoint = safeEntry(dir, entry);
  if (!entrypoint) {
    console.warn(`[plugins] entrypoint fuera de la carpeta del plugin en ${dir}: ${entry}`);
    return null;
  }
  try {
    if (!fs.statSync(entrypoint).isFile()) return null;
  } catch {
    return null;
  }

  /* Listas normalizadas a minúsculas: `--platform N64` y `n64` deben coincidir. */
  const toList = (value) =>
    Array.isArray(value)
      ? value
          .filter((item) => typeof item === 'string' && item.trim())
          .map((item) => item.trim().toLowerCase())
      : [];

  return {
    id,
    name: textOrNull(parsed.name) ?? id,
    dir,
    entrypoint,
    runtime: textOrNull(parsed.runtime),
    type: textOrNull(parsed.type) ?? 'plugin',
    platforms: toList(parsed.platforms),
    capabilities: toList(parsed.capabilities),
  };
}

/** Manifiestos ejecutables en disco, en el mismo orden que `listPlugins()`. */
function listPluginSpecs() {
  const specs = [];
  for (const plugin of listPlugins()) {
    const spec = readPluginExecSpec(plugin.dir);
    if (spec) specs.push(spec);
  }
  return specs;
}

/**
 * Comando a lanzar para un plugin según su `runtime` declarado.
 *
 * Sin `runtime` (o con `binary`) se ejecuta el `entrypoint` directamente; el
 * resto se delega en el intérprete. Nunca hay `shell` de por medio, así que los
 * argumentos no pueden interpretarse como metacaracteres.
 */
function pluginCommand(spec) {
  const runtime = (spec.runtime || '').toLowerCase();
  const interpreter = PLUGIN_RUNTIMES.get(runtime);
  if (interpreter) return { command: interpreter, args: [spec.entrypoint] };
  if (runtime && runtime !== 'binary' && runtime !== 'direct' && runtime !== 'executable') {
    console.warn(
      `[plugins] runtime '${runtime}' desconocido en ${spec.id}: se ejecuta el entrypoint directamente.`
    );
  }
  return { command: spec.entrypoint, args: [] };
}

/** Entorno del plugin: UTF-8 explícito y sin color en `stderr`. */
function pluginEnv() {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    NO_COLOR: '1',
  };
}

/**
 * Valor apto para el CLI del plugin.
 *
 * No hay shell, pero un valor que empiece por `-` lo leería `argparse` como una
 * opción: un `query` igual a `--output` inyectaría flags en la invocación.
 * También se rechazan caracteres de control y cadenas desmedidas.
 */
function pluginArg(value, name) {
  const text = String(value ?? '');
  if (!text.trim()) throw new Error(`El parámetro "${name}" está vacío.`);
  if (text.startsWith('-')) throw new Error(`El parámetro "${name}" no puede empezar por "-".`);
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`El parámetro "${name}" contiene caracteres de control.`);
  }
  if (text.length > 256) throw new Error(`El parámetro "${name}" es demasiado largo.`);
  return text;
}

/**
 * Último objeto JSON válido de un texto.
 *
 * Los plugins pueden escribir avisos sueltos en `stdout`; se recorre hacia atrás
 * y se devuelve el último objeto parseable, que es el mensaje final del
 * protocolo (`{"success": …}` para `search`, `{"type": "completed"}` para
 * `provision`).
 */
function parsePluginJson(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* Línea no JSON: se prueba con la anterior. */
    }
  }
  return null;
}

/** Cola de `stderr` para adjuntar al error sin volcar el log entero. */
function stderrTail(text, limit = 800) {
  const clean = String(text || '').trim();
  return clean.length > limit ? clean.slice(-limit) : clean;
}

/**
 * Ejecuta el plugin y acumula su salida.
 *
 * `onLine` recibe cada línea de `stdout` según llega (el protocolo de
 * `provision` es JSON por líneas). La promesa **no rechaza por código de
 * salida**: el código y el `timedOut` viajan en el resultado para que el
 * llamante elija el status HTTP. Solo rechaza si el proceso no se pudo lanzar
 * (con `error.status = 502`).
 */
function runPlugin(spec, args, options = {}) {
  const timeout = Number.isFinite(options.timeout) ? options.timeout : PLUGIN_SEARCH_TIMEOUT;
  const onLine = typeof options.onLine === 'function' ? options.onLine : null;
  const { command, args: prefix } = pluginCommand(spec);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, [...prefix, ...args], {
        cwd: spec.dir,
        /* `stdin` cerrado: el plugin ve que no hay TTY (`sys.stdin.isatty()`) y
         * usa sus tiempos cortos de modo no interactivo. */
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: pluginEnv(),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reject(Object.assign(new Error(`No se pudo ejecutar el plugin ${spec.id}: ${detail}`), {
        status: 502,
      }));
      return;
    }

    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < PLUGIN_MAX_STDOUT) stdout += chunk;
      if (!onLine) return;
      pending += chunk;
      let index = pending.indexOf('\n');
      while (index !== -1) {
        const line = pending.slice(0, index).trim();
        pending = pending.slice(index + 1);
        if (line) onLine(line);
        index = pending.indexOf('\n');
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < PLUGIN_MAX_STDERR) stderr += chunk;
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const detail = error instanceof Error ? error.message : String(error);
      reject(Object.assign(new Error(`No se pudo ejecutar el plugin ${spec.id}: ${detail}`), {
        status: 502,
      }));
    });

    child.on('close', (code, signal) => {
      if (onLine && pending.trim()) onLine(pending.trim());
      finish({ code, signal, stdout, stderr, timedOut, timeout });
    });
  });
}

/**
 * Primer plugin habilitado que sirve para lo pedido.
 *
 * Preferencia: `pluginId` explícito → plugin que declare la plataforma pedida →
 * plugin sin `platforms` (comodín) → primero disponible.
 *
 * @returns `{ spec }` si hay candidato, o `{ status, error }` si no.
 */
function selectPlugin({ capability, pluginId, platform }) {
  const specs = listPluginSpecs();
  const capable = specs.filter((spec) => spec.capabilities.includes(capability));

  if (pluginId) {
    const wanted = String(pluginId).trim();
    const known = specs.find((spec) => spec.id === wanted);
    if (!known) {
      return {
        status: 404,
        error: `No existe ningún plugin con id '${wanted}' en ${PLUGINS_DIR}.`,
      };
    }
    if (!known.capabilities.includes(capability)) {
      return {
        status: 409,
        error: `El plugin '${wanted}' no declara la capacidad '${capability}'.`,
      };
    }
    return { spec: known };
  }

  if (platform) {
    const wanted = String(platform).trim().toLowerCase();
    const exact = capable.find((spec) => spec.platforms.includes(wanted));
    if (exact) return { spec: exact };
    const wildcard = capable.find((spec) => spec.platforms.length === 0);
    if (wildcard) return { spec: wildcard };
    return {
      status: 404,
      error: `Ningún plugin habilitado con la capacidad '${capability}' soporta la plataforma '${wanted}'.`,
      plugins: capable.map((spec) => spec.id),
    };
  }

  if (!capable.length) {
    return {
      status: 404,
      error: `No hay ningún plugin habilitado con la capacidad '${capability}' en ${PLUGINS_DIR}.`,
      plugins: specs.map((spec) => spec.id),
    };
  }
  return { spec: capable[0] };
}

/**
 * `POST /api/plugins/search` → busca assets con un plugin `asset-provider`.
 *
 * Cuerpo: `{ query, platform?, pluginId?, region?, version? }`.
 * Respuesta: `{ ok: true, results: [...] }` (el `success` del plugin se traduce
 * a `ok` para que el contrato HTTP sea uniforme).
 */
async function handlePluginSearch(req, res) {
  if (req.method !== 'POST') {
    sendJSON(res, 405, { ok: false, error: 'Usa POST.' });
    return;
  }
  try {
    let body;
    try {
      body = await readJSON(req);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJSON(res, 400, { ok: false, error: detail });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJSON(res, 400, { ok: false, error: 'Se esperaba un objeto JSON.' });
      return;
    }

    let query;
    let platform = null;
    let region = null;
    let version = null;
    let pluginId = null;
    try {
      query = pluginArg(body.query, 'query');
      if (textOrNull(body.platform)) platform = pluginArg(body.platform, 'platform').toLowerCase();
      if (textOrNull(body.region)) region = pluginArg(body.region, 'region');
      if (textOrNull(body.version)) version = pluginArg(body.version, 'version');
      if (textOrNull(body.pluginId)) pluginId = pluginArg(body.pluginId, 'pluginId');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJSON(res, 400, { ok: false, error: detail });
      return;
    }

    const picked = selectPlugin({ capability: 'search', pluginId, platform });
    if (!picked.spec) {
      sendJSON(res, picked.status ?? 404, {
        ok: false,
        error: picked.error,
        plugins: picked.plugins ?? [],
      });
      return;
    }

    const args = ['search', query];
    if (platform) args.push('--platform', platform);
    if (region) args.push('--region', region);
    if (version) args.push('--version', version);

    const run = await runPlugin(picked.spec, args, { timeout: PLUGIN_SEARCH_TIMEOUT });

    if (run.timedOut) {
      sendJSON(res, 504, {
        ok: false,
        pluginId: picked.spec.id,
        error: `El plugin ${picked.spec.id} no respondió en ${Math.round(run.timeout / 1000)} s.`,
        stderr: stderrTail(run.stderr),
      });
      return;
    }

    const payload = parsePluginJson(run.stdout);
    if (!payload) {
      sendJSON(res, 502, {
        ok: false,
        pluginId: picked.spec.id,
        error: `El plugin ${picked.spec.id} no devolvió JSON válido por stdout.`,
        code: run.code,
        stderr: stderrTail(run.stderr),
      });
      return;
    }

    if (payload.success === false || payload.ok === false) {
      sendJSON(res, 502, {
        ok: false,
        pluginId: picked.spec.id,
        error: textOrNull(payload.error) ?? 'El plugin informó de un error.',
        stderr: stderrTail(run.stderr),
      });
      return;
    }

    const results = Array.isArray(payload.results)
      ? payload.results.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      : [];

    sendJSON(res, 200, {
      ok: true,
      pluginId: picked.spec.id,
      query,
      platform,
      region,
      version,
      results,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const status = typeof error?.status === 'number' ? error.status : 500;
    sendJSON(res, status, { ok: false, error: detail });
  }
}

/**
 * `POST /api/plugins/provision` → ejecuta `provision` en un plugin.
 *
 * Cuerpo: `{ pluginId, assetId, outputDir }`.
 * Respuesta: `{ ok: true, outputPath, sha1, events }`. Los eventos de progreso
 * (`{"type":"progress"}`) se retienen porque este endpoint responde un único
 * JSON al final; la UI los repinta al recibir la respuesta.
 */
async function handlePluginProvision(req, res) {
  if (req.method !== 'POST') {
    sendJSON(res, 405, { ok: false, error: 'Usa POST.' });
    return;
  }
  try {
    let body;
    try {
      body = await readJSON(req);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJSON(res, 400, { ok: false, error: detail });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJSON(res, 400, { ok: false, error: 'Se esperaba un objeto JSON.' });
      return;
    }

    let pluginId;
    let assetId;
    let rawOutput;
    try {
      pluginId = pluginArg(body.pluginId, 'pluginId');
      assetId = pluginArg(body.assetId, 'assetId');
      rawOutput = pluginArg(body.outputDir, 'outputDir');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJSON(res, 400, { ok: false, error: detail });
      return;
    }

    /* `assetId` viaja como primer posicional del plugin: se acota a un conjunto
     * de caracteres seguro y se corta cualquier intento de ruta. */
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(assetId)) {
      sendJSON(res, 400, {
        ok: false,
        error: `assetId no válido: ${assetId.slice(0, 80)}`,
      });
      return;
    }

    /* El destino lo propone el renderer; se acota al árbol del launcher, igual
     * que `open-path`, para que el endpoint no sea una escritura arbitraria. */
    const homeRoot = canonicalPath(path.resolve(LAUNCHER_HOME));
    const expanded = rawOutput.replace(/^~(?=$|[\\/])/, os.homedir());
    const outputDir = canonicalPath(path.resolve(expanded));
    if (outputDir !== homeRoot && !outputDir.startsWith(homeRoot + path.sep)) {
      sendJSON(res, 400, {
        ok: false,
        error: `outputDir debe estar dentro de ${homeRoot} (recibido: ${outputDir}).`,
      });
      return;
    }

    const picked = selectPlugin({ capability: 'provision', pluginId });
    if (!picked.spec) {
      sendJSON(res, picked.status ?? 404, {
        ok: false,
        error: picked.error,
        plugins: picked.plugins ?? [],
      });
      return;
    }

    try {
      ensureDir(outputDir);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendJSON(res, 500, { ok: false, error: `No se pudo crear ${outputDir}: ${detail}` });
      return;
    }

    const events = [];
    const run = await runPlugin(picked.spec, ['provision', assetId, '--output', outputDir], {
      timeout: PLUGIN_PROVISION_TIMEOUT,
      onLine: (line) => {
        const event = parsePluginJson(line);
        if (event && events.length < PLUGIN_MAX_EVENTS) events.push(event);
      },
    });

    const payload = parsePluginJson(run.stdout) ?? (events.length ? events[events.length - 1] : null);

    if (run.timedOut) {
      sendJSON(res, 504, {
        ok: false,
        pluginId: picked.spec.id,
        assetId,
        outputDir,
        error: `El plugin ${picked.spec.id} no terminó en ${Math.round(run.timeout / 1000)} s.`,
        events,
        stderr: stderrTail(run.stderr),
      });
      return;
    }

    if (!payload) {
      sendJSON(res, 502, {
        ok: false,
        pluginId: picked.spec.id,
        assetId,
        outputDir,
        error: `El plugin ${picked.spec.id} no devolvió JSON válido por stdout.`,
        code: run.code,
        events,
        stderr: stderrTail(run.stderr),
      });
      return;
    }

    /* Un `provision` puede no poder completarse sin intervención humana (por
     * ejemplo una ROM que hay que descargar a mano). Eso no es un 200: la UI
     * necesita saber que no hay archivo y ofrecer el enlace. */
    if (payload.type === 'error' || payload.success === false || payload.ok === false) {
      sendJSON(res, 502, {
        ok: false,
        pluginId: picked.spec.id,
        assetId,
        outputDir,
        error: textOrNull(payload.error) ?? 'El plugin informó de un error.',
        url: textOrNull(payload.url),
        events,
        stderr: stderrTail(run.stderr),
      });
      return;
    }

    sendJSON(res, 200, {
      ok: true,
      pluginId: picked.spec.id,
      assetId,
      outputDir,
      type: textOrNull(payload.type),
      outputPath: textOrNull(payload.outputPath),
      sha1: textOrNull(payload.sha1),
      events,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const status = typeof error?.status === 'number' ? error.status : 500;
    sendJSON(res, status, { ok: false, error: detail });
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
  if (url === '/api/library') {
    await handleLibrary(req, res);
    return true;
  }
  if (url === '/api/plugins') {
    await handlePlugins(req, res);
    return true;
  }
  if (url === '/api/plugins/dir') {
    await handlePluginsDir(req, res);
    return true;
  }
  if (url === '/api/plugins/search') {
    await handlePluginSearch(req, res);
    return true;
  }
  if (url === '/api/plugins/provision') {
    await handlePluginProvision(req, res);
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
      url === '/api/library' ||
      url === '/api/plugins' ||
      url === '/api/plugins/dir' ||
      url === '/api/plugins/search' ||
      url === '/api/plugins/provision' ||
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
  LEGACY_PLUGINS_DIR,
  LIBRARY_FILE,
  LOGS_DIR,
  PLUGINS_DIR,
  PORTS_DIR,
  STEAMGRID_PREFIX,
  chmodExecutables,
  createApiMiddleware,
  extractZip,
  findMainExecutable,
  firstUsefulLine,
  buildLaunchArgs,
  linkRomForLaunch,
  waitForEarlyExit,
  handleApiRequest,
  handleLaunch,
  handleLibrary,
  handleOpenPath,
  handlePluginProvision,
  handlePluginSearch,
  handlePlugins,
  handlePluginsDir,
  handleReportError,
  handleSelfUpdate,
  handleSteamgridSaveKey,
  installPort,
  listPlugins,
  looksExecutable,
  openInSystem,
  readPluginManifest,
  safeEntry,
  safeFolder,
  scoreAsset,
  sendJSON,
  writeErrorReport,
};
