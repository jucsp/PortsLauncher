/* ==========================================================================
 * PortsLauncher · services/updateService.ts
 *
 * Comprobación de actualizaciones del LAUNCHER (no de los ports) contra los
 * GitHub Releases del repositorio publicado.
 *
 * El módulo es puro salvo por tres accesos explícitos al entorno:
 *   - `__APP_VERSION__` → versión instalada, inyectada por Vite en el build.
 *   - `fetch`           → consulta la API pública de GitHub.
 *   - `localStorage`    → recuerda el repositorio elegido por el usuario.
 *
 * Todos están guardados, así que el módulo se puede importar (y probar) en
 * Node sin `fetch`, `localStorage` ni `define`: en ese caso `CURRENT_VERSION`
 * cae a `FALLBACK_VERSION` y `checkForUpdates` devuelve un resultado con
 * `status` distinto de `ok` en vez de lanzar.
 * ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Versión instalada                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Constante inyectada por Vite desde `launcher/package.json` (`define` en
 * `vite.config.ts`).
 *
 * La declaración sólo existe para TypeScript; en tiempo de ejecución el
 * identificador puede no estar presente (Node puro, otro bundler, REPL), así
 * que siempre se lee con `typeof`, que nunca lanza `ReferenceError`.
 */
declare const __APP_VERSION__: string | undefined;

/** Valor de emergencia cuando no hay versión inyectada (Vitest sin `define`). */
export const FALLBACK_VERSION = '0.0.0-dev';

/** Origen de `CURRENT_VERSION`, para diagnóstico en Ajustes. */
export type VersionSource = 'build' | 'fallback';

/**
 * Normaliza una versión candidata: sin prefijo `v`, sin espacios y con los tres
 * componentes completados (`0.1` → `0.1.0`).
 *
 * @returns `''` si el valor no parece semver, para que el llamante aplique el
 * fallback en vez de comparar contra basura.
 */
function normalizeInjectedVersion(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = cleanVersion(value);
  if (!/^\d+(?:\.\d+)*$/.test(raw)) return '';
  const [major, minor, patch] = parseSemver(raw);
  return `${major}.${minor}.${patch}`;
}

/** Versión inyectada por el build, o `''` si no hay ninguna disponible. */
function readInjectedVersion(): string {
  /* `typeof` sobre un identificador no declarado es seguro y no lanza. */
  if (typeof __APP_VERSION__ !== 'string') return '';
  return normalizeInjectedVersion(__APP_VERSION__);
}

const INJECTED_VERSION = readInjectedVersion();

/**
 * Versión del launcher que se está ejecutando.
 *
 * Se inyecta desde `launcher/package.json` durante el build; si el plugin no
 * se aplicó (Vitest/Node) cae a {@link FALLBACK_VERSION} para no romper la
 * importación. Es la ÚNICA fuente de verdad de la versión en la UI.
 */
export const CURRENT_VERSION = INJECTED_VERSION || FALLBACK_VERSION;

/** `'build'` si la versión vino del `package.json`; `'fallback'` si no. */
export const VERSION_SOURCE: VersionSource = INJECTED_VERSION ? 'build' : 'fallback';

/** Repositorio de releases por defecto (configurable en Ajustes). */
export const DEFAULT_UPDATE_REPO = 'jucsp/PortsLauncher';

/** Clave de `localStorage` donde vive el repositorio elegido. */
const REPO_STORAGE_KEY = 'portshub-update-repo';

/** Sistemas operativos para los que se busca instalador. */
export type UpdatePlatform = 'linux' | 'win32' | 'darwin';

/** Asset de un release de GitHub (sólo lo que usa el launcher). */
export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

/**
 * Desenlace de la consulta a GitHub.
 *
 * Sólo `ok` autoriza a afirmar «estás al día». El resto indica que la
 * comprobación no llegó a buen término, que es justo lo que hay que decirle al
 * usuario cuando el repositorio es privado, no tiene releases publicados
 * (GitHub responde `404 Not Found`) o la red falla:
 *
 *   - `not_found`     → 404: repo privado/inexistente o sin releases.
 *   - `rate_limited`  → 403/429: cuota de la API agotada.
 *   - `network_error` → DNS, CORS, timeout, offline o 5xx.
 *   - `invalid_repo`  → el `owner/repo` configurado no es válido.
 *   - `unsupported`   → el entorno no tiene `fetch` (Node sin runtime web).
 *   - `no_release`    → respondió 200 pero sin release estable (borrador,
 *                       prerelease o `tag_name` vacío).
 */
export type UpdateCheckStatus =
  | 'ok'
  | 'not_found'
  | 'rate_limited'
  | 'network_error'
  | 'invalid_repo'
  | 'unsupported'
  | 'no_release';

/**
 * Resultado de `checkForUpdates`. Nunca es `null` ni lanza.
 *
 * `status` y `error` distinguen «no hay actualizaciones» (`ok` +
 * `hasUpdate: false`) de «no se pudo comprobar» (cualquier otro `status`), que
 * es el fallo que hacía que la UI mintiera diciendo «Estás al día · v0.1.0».
 */
export interface UpdateCheckResult {
  hasUpdate: boolean;
  /** Desenlace de la consulta; `ok` es el único estado «al día» fiable. */
  status: UpdateCheckStatus;
  /** Mensaje legible del fallo, o `null` si la consulta fue correcta. */
  error: string | null;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  downloadUrl: string | null;
  assetName: string | null;
  htmlUrl: string;
  /**
   * Formato de paquete con el que se eligió el asset (`rpm`, `deb`, `appimage`…),
   * o `null` si no se pudo determinar. Sólo informativo: la UI lo muestra como
   * diagnóstico y el backend vuelve a detectarlo por su cuenta.
   */
  packageFormat?: PackageFormat | null;
}

/** `true` sólo cuando GitHub confirmó que no hay versión superior. */
export function isUpToDate(result: UpdateCheckResult | null | undefined): boolean {
  return result ? result.status === 'ok' && !result.hasUpdate : false;
}

/** `true` si la comprobación falló y no sabemos si hay actualización. */
export function isCheckFailed(result: UpdateCheckResult | null | undefined): boolean {
  return result ? result.status !== 'ok' : false;
}

/* -------------------------------------------------------------------------- */
/* Semver                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Trocea una versión en sus tres componentes numéricos.
 *
 * Acepta prefijo `v`, sufijos de prerelease/build (`1.2.3-beta.1`) y etiquetas
 * con menos partes (`v1.2` → `1.2.0`). Cualquier parte no numérica se trata
 * como 0: el comparador tolera datos sucios en lugar de romper el arranque.
 */
export function parseSemver(value: string): [number, number, number] {
  const core = String(value ?? '')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0];
  const parts = core.split('.');
  const num = (index: number): number => {
    const parsed = Number.parseInt(parts[index] ?? '', 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [num(0), num(1), num(2)];
}

/**
 * Compara dos versiones ignorando el prefijo `v`.
 *
 * @returns `-1` si `a < b`, `0` si son iguales, `1` si `a > b`.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/** Versión canónica sin prefijo `v` (`v0.2.0` → `0.2.0`). */
export function cleanVersion(value: string): string {
  return String(value ?? '').trim().replace(/^v/i, '');
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Formato de paquete nativo del host.
 *
 * Lo publica el backend en `GET /api/launcher/system-info` (detecta la distro
 * con `/etc/os-release`): `rpm` en Fedora/RHEL/openSUSE, `deb` en
 * Debian/Ubuntu, `appimage` en el resto y en lo desconocido, `exe` en Windows y
 * `dmg` en macOS.
 */
export type PackageFormat = 'rpm' | 'deb' | 'appimage' | 'exe' | 'dmg';

/** Formatos aceptados; cualquier otro valor se ignora. */
const PACKAGE_FORMATS: readonly string[] = ['rpm', 'deb', 'appimage', 'exe', 'dmg'];

/** `true` si `value` es un formato de paquete conocido. */
export function isPackageFormat(value: unknown): value is PackageFormat {
  return typeof value === 'string' && PACKAGE_FORMATS.includes(value);
}

/** Prioridad de extensiones por sistema operativo (orden general). */
const PREFERENCE: Record<UpdatePlatform, string[]> = {
  linux: ['.appimage', '.deb', '.rpm', '.tar.gz', '.tgz'],
  win32: ['.exe', '.zip'],
  darwin: ['.dmg', '.zip'],
};

/**
 * Prioridad en Linux cuando el host usa un gestor de paquetes concreto.
 *
 * Instalar el paquete nativo es lo correcto en Fedora/Debian: el gestor del
 * sistema resuelve dependencias, registra el paquete y lo actualiza después.
 * El AppImage queda como respaldo (y como primera opción en Arch, Gentoo, etc.,
 * donde no hay ninguno de los dos).
 */
const LINUX_BY_FORMAT: Record<'rpm' | 'deb' | 'appimage', string[]> = {
  rpm: ['.rpm', '.appimage', '.tar.gz', '.tgz'],
  deb: ['.deb', '.appimage', '.tar.gz', '.tgz'],
  appimage: ['.appimage', '.deb', '.rpm', '.tar.gz', '.tgz'],
};

/** Orden de preferencia para una plataforma y, en Linux, un formato nativo. */
function preferenceOrder(
  platform: UpdatePlatform,
  packageFormat?: PackageFormat | null
): string[] {
  if (platform === 'linux') {
    if (packageFormat === 'rpm') return LINUX_BY_FORMAT.rpm;
    if (packageFormat === 'deb') return LINUX_BY_FORMAT.deb;
    /* `appimage` (y `exe`/`dmg`, que no aplican aquí) usan el orden general. */
    return LINUX_BY_FORMAT.appimage;
  }
  return PREFERENCE[platform];
}

/**
 * Un asset de otro SO no debe colarse como candidato.
 *
 * Importante: en Linux NO se excluyen `.rpm` ni `.deb`. Son justamente los
 * paquetes nativos que hay que instalar en Fedora/Debian, así que el filtro de
 * Linux sólo descarta binarios de macOS y Windows.
 */
const FOREIGN: Record<UpdatePlatform, RegExp> = {
  linux: /(?:mac|darwin|osx|windows|win32|win64|\.exe$|\.msi$)/i,
  win32: /(?:mac|darwin|osx|linux|appimage|\.deb$|\.rpm$)/i,
  darwin: /(?:windows|win32|win64|\.exe$|\.msi$|linux|appimage|\.deb$)/i,
};

/**
 * Elige el asset descargable más adecuado para `platform`.
 *
 * Orden por sistema: Linux `AppImage → deb → rpm → tar.gz` por defecto, o el
 * paquete nativo primero cuando `packageFormat` lo indica (ver
 * {@link LINUX_BY_FORMAT}); Windows `exe → zip`; macOS `dmg → zip`. Ignora los
 * assets de otros sistemas y los ficheros que no son instaladores (checksums,
 * firmas, manifiestos).
 */
export function findPlatformAsset(
  assets: readonly GithubReleaseAsset[],
  platform: UpdatePlatform,
  packageFormat?: PackageFormat | null
): { name: string; url: string } | null {
  const order = preferenceOrder(platform, packageFormat);
  const foreign = FOREIGN[platform];

  const usable = assets.filter((asset) => {
    const name = String(asset?.name ?? '');
    if (!name) return false;
    if (/\.(sha\d*|sig|asc|md5|txt|json|yml|yaml|sbom)$/i.test(name)) return false;
    return !foreign.test(name);
  });

  for (const extension of order) {
    const hit = usable.find((asset) => asset.name.toLowerCase().endsWith(extension));
    if (hit) return { name: hit.name, url: hit.browser_download_url };
  }
  return null;
}

/** SO del navegador/Electron, con el del proceso como respaldo. */
export function detectPlatform(): UpdatePlatform {
  if (typeof navigator !== 'undefined') {
    const agent = navigator.userAgent ?? '';
    if (/windows|win32|win64/i.test(agent)) return 'win32';
    if (/mac os|macintosh|darwin/i.test(agent)) return 'darwin';
    if (/linux|x11/i.test(agent)) return 'linux';
  }
  const nodePlatform = (globalThis as unknown as { process?: { platform?: string } }).process?.platform ?? '';
  if (nodePlatform === 'win32' || nodePlatform === 'darwin') return nodePlatform;
  return 'linux';
}

/* -------------------------------------------------------------------------- */
/* Repositorio configurable                                                   */
/* -------------------------------------------------------------------------- */

/** `owner/repo` en el formato que acepta la API de GitHub. */
export function isValidRepo(repo: string): boolean {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(repo ?? '').trim());
}

/** Repositorio guardado por el usuario, o el de fábrica. */
export function getUpdateRepo(): string {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_UPDATE_REPO;
    const stored = localStorage.getItem(REPO_STORAGE_KEY);
    if (stored && isValidRepo(stored)) return stored.trim();
  } catch {
    /* Modo privado o almacenamiento bloqueado: seguimos con el de fábrica. */
  }
  return DEFAULT_UPDATE_REPO;
}

/** Guarda el repositorio elegido. Devuelve lo que quedó almacenado. */
export function setUpdateRepo(repo: string): string {
  const value = String(repo ?? '').trim();
  try {
    if (typeof localStorage !== 'undefined') {
      if (!value || value === DEFAULT_UPDATE_REPO) localStorage.removeItem(REPO_STORAGE_KEY);
      else localStorage.setItem(REPO_STORAGE_KEY, value);
    }
  } catch {
    /* Sin almacenamiento: el valor vive sólo en memoria durante la sesión. */
  }
  return value || DEFAULT_UPDATE_REPO;
}

/* -------------------------------------------------------------------------- */
/* Formato nativo del host                                                    */
/* -------------------------------------------------------------------------- */

/** Endpoint del backend que informa del SO y del paquete nativo. */
export const SYSTEM_INFO_URL = '/api/launcher/system-info';

/**
 * ¿Tiene sentido sondear la API local?
 *
 * La URL es relativa, así que sólo se puede resolver cuando hay un documento
 * del que tomar la base (renderer de Electron, `vite dev`/`preview`). En Node
 * puro (Vitest) `fetch('/api/...')` lanzaría `TypeError: Failed to parse URL`,
 * de modo que la sonda se omite y se usa el orden general de assets.
 */
function canProbeHost(): boolean {
  return typeof document !== 'undefined' && typeof fetch === 'function';
}

/**
 * Pregunta al backend qué paquete nativo corresponde a esta máquina.
 *
 * Nunca lanza ni bloquea: si no hay backend (build servida desde otro origen),
 * la respuesta no es JSON o el campo no es un formato conocido, devuelve
 * `null` y `checkForUpdates` sigue con el orden general de assets.
 */
export async function detectHostPackageFormat(): Promise<PackageFormat | null> {
  if (!canProbeHost()) return null;
  try {
    const response = await fetch(SYSTEM_INFO_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response || !response.ok) return null;
    const data = (await response.json()) as unknown;
    const format = (data as { packageFormat?: unknown } | null)?.packageFormat;
    return isPackageFormat(format) ? format : null;
  } catch {
    /* Backend ausente o respuesta ilegible: fallback silencioso. */
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Comprobación                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resultado neutro: sin actualización conocida y con el motivo del desenlace.
 *
 * `latestVersion` se mantiene en `CURRENT_VERSION` (nunca se inventa una
 * versión «última» que no se ha visto) y `hasUpdate` en `false`, de modo que la
 * forma del objeto es estable; quien decide si se puede afirmar «al día» es
 * `status`.
 */
function neutralResult(status: UpdateCheckStatus, error: string | null = null): UpdateCheckResult {
  return {
    hasUpdate: false,
    status,
    error,
    currentVersion: CURRENT_VERSION,
    latestVersion: CURRENT_VERSION,
    releaseName: '',
    releaseNotes: '',
    publishedAt: '',
    downloadUrl: null,
    assetName: null,
    htmlUrl: '',
  };
}

/* Mensajes de diagnóstico: los usa la UI y los tests (texto estable). */
const MSG_NOT_FOUND =
  'GitHub no encontró releases para este repositorio (404). Puede ser privado, ' +
  'no existir o no tener ningún release publicado todavía.';
const MSG_RATE_LIMITED =
  'GitHub limitó la consulta (403/429). Espera unos minutos o configura un token.';
const MSG_INVALID_REPO = 'El repositorio de releases debe tener el formato owner/repo.';
const MSG_UNSUPPORTED = 'Este entorno no permite consultar GitHub (fetch no disponible).';
const MSG_NO_RELEASE = 'El repositorio no tiene ningún release estable publicado.';

/** Forma mínima del JSON de `/releases/latest` que consume este módulo. */
interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubReleaseAsset[];
}

/** Mensaje de error de red legible a partir de una excepción desconocida. */
function networkMessage(error: unknown): string {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string'
        ? error
        : 'error desconocido';
  return `No se pudo conectar con GitHub: ${detail}`;
}

/**
 * Consulta el último release publicado y lo compara con `CURRENT_VERSION`.
 *
 * Nunca lanza: cualquier fallo (sin red, timeout, CORS, 404 de repo privado sin
 * releases, 403 por rate limit, JSON inválido) devuelve un resultado con
 * `status` distinto de `ok` y un `error` legible. La UI debe usar ese campo para
 * NO anunciar «estás al día» cuando en realidad no se pudo comprobar.
 *
 * `packageFormat` decide qué asset se prefiere en Linux (`.rpm` en Fedora,
 * `.deb` en Debian). Si no se indica, se pregunta al backend
 * (`/api/launcher/system-info`) y, si no responde, se usa el orden general.
 */
export async function checkForUpdates(
  repo?: string,
  platform: UpdatePlatform = detectPlatform(),
  packageFormat?: PackageFormat | null
): Promise<UpdateCheckResult> {
  const target = String(repo ?? '').trim() || getUpdateRepo();
  if (!isValidRepo(target)) return neutralResult('invalid_repo', MSG_INVALID_REPO);
  if (typeof fetch !== 'function') return neutralResult('unsupported', MSG_UNSUPPORTED);

  /* El formato nativo sólo importa en Linux y, si el llamante ya lo sabe, no se
   * gasta ninguna petición extra. */
  let format: PackageFormat | null = isPackageFormat(packageFormat) ? packageFormat : null;
  if (!format && platform === 'linux') format = await detectHostPackageFormat();

  try {
    const response = await fetch(`https://api.github.com/repos/${target}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      const status = Number(response.status) || 0;
      /* 404 = repo privado/inexistente o sin releases: NO es «estás al día». */
      if (status === 404) return neutralResult('not_found', MSG_NOT_FOUND);
      if (status === 403 || status === 429) return neutralResult('rate_limited', MSG_RATE_LIMITED);
      return neutralResult('network_error', `GitHub respondió HTTP ${status} al consultar ${target}.`);
    }

    const release = (await response.json()) as GithubRelease;
    /* Un borrador o un prerelease nunca es «la última versión estable». */
    if (!release || release.draft || release.prerelease) {
      return neutralResult('no_release', MSG_NO_RELEASE);
    }

    const rawTag = String(release.tag_name ?? release.name ?? '').trim();
    const latestVersion = cleanVersion(rawTag);
    if (!latestVersion) return neutralResult('no_release', MSG_NO_RELEASE);

    const asset = findPlatformAsset(release.assets ?? [], platform, format);
    const hasUpdate = compareSemver(latestVersion, CURRENT_VERSION) > 0;

    return {
      hasUpdate,
      /* Consulta completada: aquí sí se puede afirmar «al día» si no hay update. */
      status: 'ok',
      error: null,
      currentVersion: CURRENT_VERSION,
      latestVersion,
      releaseName: String(release.name ?? rawTag),
      releaseNotes: String(release.body ?? ''),
      publishedAt: String(release.published_at ?? ''),
      /* Sin instalador para este SO se ofrece la página del release. */
      downloadUrl: hasUpdate ? (asset?.url ?? (release.html_url ? String(release.html_url) : null)) : null,
      assetName: asset?.name ?? null,
      htmlUrl: String(release.html_url ?? ''),
      packageFormat: format,
    };
  } catch (error) {
    /* Offline, CORS, DNS, timeout, JSON inválido… se reporta, no se disimula. */
    return neutralResult('network_error', networkMessage(error));
  }
}
