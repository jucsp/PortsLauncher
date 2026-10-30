/* ==========================================================================
 * PortsLauncher · services/updateService.ts
 *
 * Comprobación de actualizaciones del LAUNCHER (no de los ports) contra los
 * GitHub Releases del repositorio publicado.
 *
 * El módulo es puro salvo por dos accesos explícitos al entorno:
 *   - `fetch`         → consulta la API pública de GitHub.
 *   - `localStorage`  → recuerda el repositorio elegido por el usuario.
 *
 * Ambos están guardados, así que el módulo se puede importar (y probar) en
 * Node sin `fetch` ni `localStorage` disponibles: en ese caso
 * `checkForUpdates` devuelve un resultado sin actualización en vez de lanzar.
 * ========================================================================== */

/** Versión del launcher que se está ejecutando. */
export const CURRENT_VERSION = '0.1.0';

/** Repositorio de releases por defecto (configurable en Ajustes). */
export const DEFAULT_UPDATE_REPO = 'juancarlosf/PortsLauncher';

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

/** Resultado de `checkForUpdates`. Nunca es `null`: sin red devuelve «al día». */
export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  downloadUrl: string | null;
  assetName: string | null;
  htmlUrl: string;
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

/** Prioridad de extensiones por sistema operativo. */
const PREFERENCE: Record<UpdatePlatform, string[]> = {
  linux: ['.appimage', '.deb', '.tar.gz', '.tgz'],
  win32: ['.exe', '.zip'],
  darwin: ['.dmg', '.zip'],
};

/** Un asset de otro SO no debe colarse como candidato. */
const FOREIGN: Record<UpdatePlatform, RegExp> = {
  linux: /(?:mac|darwin|osx|windows|win32|win64|\.exe$|\.msi$)/i,
  win32: /(?:mac|darwin|osx|linux|appimage|\.deb$|\.rpm$)/i,
  darwin: /(?:windows|win32|win64|\.exe$|\.msi$|linux|appimage|\.deb$)/i,
};

/**
 * Elige el asset descargable más adecuado para `platform`.
 *
 * Orden por sistema: Linux `AppImage → deb → tar.gz`; Windows `exe → zip`;
 * macOS `dmg → zip`. Ignora los assets de otros sistemas y los ficheros que no
 * son instaladores (checksums, firmas, manifiestos).
 */
export function findPlatformAsset(
  assets: readonly GithubReleaseAsset[],
  platform: UpdatePlatform
): { name: string; url: string } | null {
  const order = PREFERENCE[platform];
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
/* Comprobación                                                               */
/* -------------------------------------------------------------------------- */

/** Resultado neutro: «al día» o «no se pudo comprobar». */
function noUpdate(latestVersion = CURRENT_VERSION): UpdateCheckResult {
  return {
    hasUpdate: false,
    currentVersion: CURRENT_VERSION,
    latestVersion: cleanVersion(latestVersion) || CURRENT_VERSION,
    releaseName: '',
    releaseNotes: '',
    publishedAt: '',
    downloadUrl: null,
    assetName: null,
    htmlUrl: '',
  };
}

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

/**
 * Consulta el último release publicado y lo compara con `CURRENT_VERSION`.
 *
 * Nunca lanza: sin red, con rate-limit (403/429), 404 o JSON inválido devuelve
 * un `UpdateCheckResult` sin actualización. La UI distingue «al día» de «no se
 * pudo comprobar» por su cuenta si lo necesita.
 */
export async function checkForUpdates(
  repo?: string,
  platform: UpdatePlatform = detectPlatform()
): Promise<UpdateCheckResult> {
  const target = String(repo ?? '').trim() || getUpdateRepo();
  if (!isValidRepo(target)) return noUpdate();
  if (typeof fetch !== 'function') return noUpdate();

  try {
    const response = await fetch(`https://api.github.com/repos/${target}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return noUpdate();

    const release = (await response.json()) as GithubRelease;
    /* Un borrador o un prerelease nunca es «la última versión estable». */
    if (!release || release.draft || release.prerelease) return noUpdate();

    const rawTag = String(release.tag_name ?? release.name ?? '').trim();
    const latestVersion = cleanVersion(rawTag);
    if (!latestVersion) return noUpdate();

    const asset = findPlatformAsset(release.assets ?? [], platform);
    const hasUpdate = compareSemver(latestVersion, CURRENT_VERSION) > 0;

    return {
      hasUpdate,
      currentVersion: CURRENT_VERSION,
      latestVersion,
      releaseName: String(release.name ?? rawTag),
      releaseNotes: String(release.body ?? ''),
      publishedAt: String(release.published_at ?? ''),
      /* Sin instalador para este SO se ofrece la página del release. */
      downloadUrl: hasUpdate ? (asset?.url ?? (release.html_url ? String(release.html_url) : null)) : null,
      assetName: asset?.name ?? null,
      htmlUrl: String(release.html_url ?? ''),
    };
  } catch {
    /* Offline, CORS, DNS, timeout… todo acaba en «no hay novedades conocidas». */
    return noUpdate();
  }
}
