/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/services/types.ts
 *
 * Contratos de datos compartidos por todos los servicios del launcher.
 *
 * IMPORTANTE: los nombres de campo son *camelCase* porque el indexador
 * (`catalog-builder/models.py`) serializa sus dataclasses con
 * `dataclasses.asdict()`, que conserva el nombre exacto del atributo
 * (`sourcePlatform`, `installStrategy`, `requiresUserFiles`, `romProfile`…).
 * No renombrar nada de aquí sin tocar también el indexador: el catálogo es
 * un contrato entre Python y TypeScript.
 * ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Plataformas de origen                                                      */
/* -------------------------------------------------------------------------- */

/** Vocabulario cerrado de plataformas de origen (Anexo A del contrato). */
export const SOURCE_PLATFORMS = [
  'n64',
  'snes',
  'nes',
  'md',
  'gba',
  'gb',
  'nds',
  'n3ds',
  'nsw',
  'psp',
  'ps1',
  'ps2',
  'gcn',
  'wii',
  'xbox',
  'x360',
  'ps3',
  'ps4',
  'wiiu',
  'dc',
  'vita',
  'xbone',
  'pc',
  'other',
] as const;

export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

/** Plataformas "reales" (todo menos el cajón desastre `other`). */
export type KnownPlatform = Exclude<SourcePlatform, 'other'>;

export const PLATFORM_LABELS: Record<SourcePlatform, string> = {
  n64: 'Nintendo 64',
  snes: 'Super Nintendo',
  nes: 'Nintendo Entertainment System',
  md: 'Mega Drive / Genesis',
  gba: 'Game Boy Advance',
  gb: 'Game Boy',
  nds: 'Nintendo DS',
  n3ds: 'Nintendo 3DS',
  nsw: 'Nintendo Switch',
  psp: 'PlayStation Portable',
  ps1: 'PlayStation',
  ps2: 'PlayStation 2',
  gcn: 'Nintendo GameCube',
  wii: 'Nintendo Wii',
  xbox: 'Xbox',
  x360: 'Xbox 360',
  ps3: 'PlayStation 3',
  ps4: 'PlayStation 4',
  wiiu: 'Nintendo Wii U',
  dc: 'Dreamcast',
  vita: 'PlayStation Vita',
  xbone: 'Xbox One',
  pc: 'PC',
  other: 'Otras plataformas',
};

export const PLATFORM_SHORT: Record<SourcePlatform, string> = {
  n64: 'N64',
  snes: 'SNES',
  nes: 'NES',
  md: 'MD',
  gba: 'GBA',
  gb: 'GB',
  nds: 'NDS',
  n3ds: '3DS',
  nsw: 'NSW',
  psp: 'PSP',
  ps1: 'PS1',
  ps2: 'PS2',
  gcn: 'GCN',
  wii: 'WII',
  xbox: 'XBOX',
  x360: 'X360',
  ps3: 'PS3',
  ps4: 'PS4',
  wiiu: 'WIIU',
  dc: 'DC',
  vita: 'VITA',
  xbone: 'XONE',
  pc: 'PC',
  other: 'OTRAS',
};

/** Plataformas visualmente representables en la UI (con cartucho o disco). */
export const CATALOG_PLATFORMS: readonly KnownPlatform[] = [
  'n64',
  'snes',
  'nes',
  'md',
  'gba',
  'gb',
  'nds',
  'n3ds',
  'nsw',
  'psp',
  'ps1',
  'ps2',
  'gcn',
  'wii',
  'xbox',
  'x360',
  'ps3',
  'ps4',
  'wiiu',
  'dc',
  'vita',
  'xbone',
  'pc',
];

/* -------------------------------------------------------------------------- */
/* Plataformas de destino                                                     */
/* -------------------------------------------------------------------------- */

export const TARGET_PLATFORMS = [
  'windows',
  'linux',
  'android',
  'macos',
  'ios',
  'switch',
  'web',
  'other',
] as const;

export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

export const TARGET_LABELS: Record<TargetPlatform, string> = {
  windows: 'Windows',
  linux: 'Linux',
  android: 'Android',
  macos: 'macOS',
  ios: 'iOS',
  switch: 'Switch',
  web: 'Web',
  other: 'Otras',
};

/* -------------------------------------------------------------------------- */
/* Estado de desarrollo                                                       */
/* -------------------------------------------------------------------------- */

/** Etiquetas que consume la UI (nombres cortos, §7 de la spec v5). */
export const DEV_TAGS = ['playable', 'bugs', 'wip', 'exp', 'abandoned', 'nodata'] as const;
export type DevTag = (typeof DEV_TAGS)[number];

/** Etiquetas que emite el evaluador del catálogo (`catalog-builder/status.py`). */
export const CATALOG_STATUS_TAGS = [
  'playable',
  'bugs',
  'wip',
  'experimental',
  'abandoned',
  'nodata',
] as const;
export type CatalogStatusTag = (typeof CATALOG_STATUS_TAGS)[number];

/** El catálogo dice `experimental`; la UI lo abrevia a `exp`. */
export const CATALOG_TO_DEV_TAG: Record<CatalogStatusTag, DevTag> = {
  playable: 'playable',
  bugs: 'bugs',
  wip: 'wip',
  experimental: 'exp',
  abandoned: 'abandoned',
  nodata: 'nodata',
};

export interface DevTagMeta {
  /** Etiqueta legible en español. */
  label: string;
  /** Expresión CSS que resuelve a un token de `tokens.css`. */
  color: string;
  /** Glifo de la insignia (siempre acompañado de texto: nunca sólo icono). */
  glyph: string;
}

export const DEV_TAG_META: Record<DevTag, DevTagMeta> = {
  playable: { label: 'Jugable', color: 'var(--st-playable)', glyph: '●' },
  bugs: { label: 'Con bugs', color: 'var(--st-bugs)', glyph: '▲' },
  wip: { label: 'En desarrollo', color: 'var(--st-wip)', glyph: '◆' },
  exp: { label: 'Experimental', color: 'var(--st-exp)', glyph: '✦' },
  abandoned: { label: 'Abandonado', color: 'var(--st-abandoned)', glyph: '✕' },
  nodata: { label: 'Sin datos', color: 'var(--st-nodata)', glyph: '?' },
};

/** Resultado de `CatalogService.getDevTagInfo(port)`. */
export interface DevTagInfo extends DevTagMeta {
  tag: DevTag;
  /** Texto corto para la insignia. */
  text: string;
  /** Explicación ("why") tomada de `status.reasons` o del propio tag. */
  why: string;
  /** % de recomendación de la comunidad (0–100, redondeado). */
  pct: number;
  /** Confianza declarada por el evaluador: alta | media | baja. */
  conf: string;
}

/* -------------------------------------------------------------------------- */
/* Estrategias de instalación y enlace de ROM                                 */
/* -------------------------------------------------------------------------- */

export const INSTALL_STRATEGIES = [
  'release-archive',
  'release-appimage',
  'release-installer',
  'windows-via-proton',
  'source-only',
  'external',
  'recipe',
  'needsChoice',
] as const;
export type InstallStrategy = (typeof INSTALL_STRATEGIES)[number];

export const INSTALL_STRATEGY_LABELS: Record<InstallStrategy, string> = {
  'release-archive': 'Archivo de release',
  'release-appimage': 'AppImage',
  'release-installer': 'Instalador',
  'windows-via-proton': 'Windows vía Proton',
  'source-only': 'Sólo código fuente',
  external: 'Externo',
  recipe: 'Receta propia',
  needsChoice: 'Requiere elección',
};

export const ROM_BINDINGS = ['place', 'arg', 'config', 'in-app'] as const;
export type RomBinding = (typeof ROM_BINDINGS)[number];

export const ROM_BINDING_LABELS: Record<RomBinding, string> = {
  place: 'Copiar en carpeta del juego',
  arg: 'Pasar como argumento',
  config: 'Referenciar en configuración',
  'in-app': 'Selector dentro de la app',
};

/* -------------------------------------------------------------------------- */
/* Estilos visuales de soporte (17 siluetas, §8 de la spec v5)                 */
/* -------------------------------------------------------------------------- */

export const MEDIA_STYLES = [
  'n64',
  'snes',
  'nes',
  'md',
  'gba',
  'gb',
  'nds',
  'n3ds',
  'nsw',
  'psp',
  'cd',
  'ps1',
  'gcn',
  'wii',
  'xbox',
  'ps2',
  'x360',
  'ps3',
  'ps4',
  'wiiu',
  'dc',
  'vita',
  'xbone',
] as const;
export type MediaStyle = (typeof MEDIA_STYLES)[number];

/** Plataforma de origen → silueta por defecto. */
export const MEDIA_BY_PLATFORM: Record<SourcePlatform, MediaStyle> = {
  n64: 'n64',
  snes: 'snes',
  nes: 'nes',
  md: 'md',
  gba: 'gba',
  gb: 'gb',
  nds: 'nds',
  n3ds: 'n3ds',
  nsw: 'nsw',
  psp: 'psp',
  ps1: 'ps1',
  ps2: 'ps2',
  gcn: 'gcn',
  wii: 'wii',
  xbox: 'xbox',
  x360: 'x360',
  ps3: 'ps3',
  ps4: 'ps4',
  wiiu: 'wiiu',
  dc: 'dc',
  vita: 'vita',
  xbone: 'xbone',
  pc: 'cd',
  other: 'cd',
};

/* -------------------------------------------------------------------------- */
/* Selección de carátula según el soporte físico                              */
/* -------------------------------------------------------------------------- */

/**
 * Plataformas que el launcher dibuja como **cartucho**: la etiqueta usa el grid
 * horizontal (`coverHorizontalUrl`). Debe coincidir con
 * `CARTRIDGE_PLATFORMS` del indexador (`catalog-builder/enrichment/steamgrid.py`).
 */
export const CARTRIDGE_PLATFORMS: readonly SourcePlatform[] = [
  'n64',
  'snes',
  'nes',
  'md',
  'gba',
  'gb',
  'nds',
  'n3ds',
];

/**
 * Plataformas que el launcher dibuja como **caja DVD/tarjeta**: la carátula usa
 * el grid vertical (`coverVerticalUrl`). Coincide con `BOX_PLATFORMS` del
 * indexador.
 */
export const BOX_PLATFORMS: readonly SourcePlatform[] = ['ps2', 'x360', 'nsw'];

export interface CoverSources {
  coverUrl?: string | null;
  coverHorizontalUrl?: string | null;
  coverVerticalUrl?: string | null;
}

/** Devuelve la primera URL no vacía de las dos candidatas (o `null`). */
function firstUrl(primary?: string | null, fallback?: string | null): string | null {
  const a = typeof primary === 'string' ? primary.trim() : '';
  if (a) return a;
  const b = typeof fallback === 'string' ? fallback.trim() : '';
  return b || null;
}

/**
 * Carátula que corresponde a un soporte físico.
 *
 * - **Cartuchos** (`n64`, `snes`, `nes`, `md`, `gba`, `gb`, `nds`, `n3ds`):
 *   `coverHorizontalUrl` (grid 920x430 / 460x215).
 * - **Cajas** (`ps2`, `x360`, `nsw`): `coverVerticalUrl` (grid 600x900).
 * - **Otros soportes** (discos, `pc`, `other`…): `coverUrl`.
 *
 * En todos los casos se degrada a `coverUrl` si el arte específico falta; si no
 * hay ninguna imagen, devuelve `null` y el launcher pinta el arte generativo
 * procedural.
 */
export function coverForPlatform(
  platform: SourcePlatform | string | null | undefined,
  sources: CoverSources
): string | null {
  const key = String(platform ?? 'other');
  if (CARTRIDGE_PLATFORMS.includes(key as SourcePlatform)) {
    return firstUrl(sources.coverHorizontalUrl, sources.coverUrl);
  }
  if (BOX_PLATFORMS.includes(key as SourcePlatform)) {
    return firstUrl(sources.coverVerticalUrl, sources.coverUrl);
  }
  return firstUrl(sources.coverUrl, null);
}

/* -------------------------------------------------------------------------- */
/* Arte personalizado (estilo Steam): logo, cabecera y carátula               */
/* -------------------------------------------------------------------------- */

/**
 * Puntos de anclaje del logotipo dentro de la cabecera de la ficha.
 *
 * Los siete valores cubren la rejilla 3×3 de SteamGridDB (esquinas, bordes y
 * centro). Se guardan tal cual en `customArt[pid].logoAnchor`.
 */
export const LOGO_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export type LogoAnchor = (typeof LOGO_ANCHORS)[number];

export const LOGO_ANCHOR_DEFAULT: LogoAnchor = 'bottom-left';

/** Etiquetas cortas de los siete anclas (modal «Ajustar arte»). */
export const LOGO_ANCHOR_LABELS: Record<LogoAnchor, string> = {
  'top-left': 'Arriba izq.',
  'top-center': 'Arriba centro',
  'top-right': 'Arriba dcha.',
  center: 'Centro',
  'bottom-left': 'Abajo izq.',
  'bottom-center': 'Abajo centro',
  'bottom-right': 'Abajo dcha.',
};

/** Glifo de cada ancla (rejilla 3×3 del modal). */
export const LOGO_ANCHOR_GLYPHS: Record<LogoAnchor, string> = {
  'top-left': '↖',
  'top-center': '↑',
  'top-right': '↗',
  center: '•',
  'bottom-left': '↙',
  'bottom-center': '↓',
  'bottom-right': '↘',
};

/** Rango del slider de tamaño del logo (px de alto). */
export const LOGO_SCALE_MIN = 40;
export const LOGO_SCALE_MAX = 220;
export const LOGO_SCALE_DEFAULT = 110;

/**
 * Rango del slider de escala del fondo de cabecera (porcentaje).
 *
 * El 100 % muestra el hero entero dentro de su hueco; por encima se agranda
 * desde el centro (`transform: scale`) para recortar los bordes de la imagen
 * sin tocar la máscara estática que la funde con el lienzo.
 */
export const HERO_SCALE_MIN = 100; // 100%
export const HERO_SCALE_MAX = 250; // 250%
export const HERO_SCALE_DEFAULT = 115; // 115%

/**
 * Rango del slider de zoom de la carátula **dentro del soporte** (porcentaje).
 *
 * El 100 % dibuja la imagen tal cual la recorta `object-fit:cover`; por debajo
 * se ve más arte del original y por encima se amplía desde el centro de la
 * etiqueta. Es independiente del tamaño del soporte (`--mz`), que lo decide el
 * layout.
 */
export const COVER_SCALE_MIN = 80; // 80%
export const COVER_SCALE_MAX = 200; // 200%
export const COVER_SCALE_DEFAULT = 100; // 100%

/**
 * Rango del desplazamiento de la carátula dentro del soporte (porcentaje del
 * tamaño de la imagen). El 0 % la deja centrada.
 */
export const COVER_OFFSET_MIN = -50;
export const COVER_OFFSET_MAX = 50;
export const COVER_OFFSET_DEFAULT = 0;

/** Ajustes de arte que el usuario puede sobrescribir por juego. */
export interface CustomArtwork {
  /** Carátula del soporte (cartucho/caja/disco). `null` = usar la del índice. */
  coverUrl?: string | null;
  /** Fondo de la cabecera (hero). `null` = usar la del índice. */
  heroUrl?: string | null;
  /** Logotipo del título. `null` = usar el del índice. */
  logoUrl?: string | null;
  logoAnchor?: LogoAnchor;
  logoScale?: number;
  /** Escala del fondo de cabecera en porcentaje (100–250). */
  heroScale?: number;
  /** Zoom de la carátula dentro del soporte en porcentaje (80–200). */
  coverScale?: number;
  /** Desplazamiento vertical de la carátula dentro del soporte (-50…50 %). */
  coverY?: number;
  /** Desplazamiento horizontal de la carátula dentro del soporte (-50…50 %). */
  coverX?: number;
}

/** `true` si el valor es uno de los siete anclas válidos. */
export function isLogoAnchor(value: unknown): value is LogoAnchor {
  return typeof value === 'string' && (LOGO_ANCHORS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Catálogo: `data/ports.index.json`                                          */
/* -------------------------------------------------------------------------- */

export interface SourceRef {
  source: string;
  externalId: string;
  lastSeen: string;
  catalogVersion?: string | null;
}

export interface StatusCommunity {
  verdict?: string | null;
  recommended: number;
  reviews: number;
  bugReports: number;
  windowDays?: number | null;
}

export interface StatusInfo {
  tag: CatalogStatusTag;
  development?: string;
  maintenance?: string;
  community: StatusCommunity;
  confidence: string;
  reasons: string[];
  computedAt?: string;
  ruleVersion?: string;
  manualOverride?: Record<string, unknown> | null;
}

export interface AssetHints {
  windows?: string | null;
  linux?: string | null;
  android?: string | null;
}

export interface PlayerFeedback {
  recommended: number;
  reportIssues: number;
  reportBroken: number;
  reviewCount: number;
}

export interface VerifiedRelease {
  version?: string | null;
  releasedAt?: string | null;
  prerelease: boolean;
  pinned: boolean;
}

/** Entrada de `romProfile.accepted` (hash SHA-1 de un fichero aceptado). */
export interface AcceptedHash {
  sha1?: string;
  name?: string;
  path?: string;
  [extra: string]: unknown;
}

export interface RomProfile {
  binding: RomBinding;
  destination?: string | null;
  extensions: string[];
  accepted: AcceptedHash[];
  notes?: string | null;
}

/** Fichero que el usuario debe aportar (ROM, BIOS, assets de un port). */
export interface SetupFile {
  name?: string;
  url?: string | null;
  sha1?: string | null;
  size?: number | null;
  destination?: string | null;
  required?: boolean;
  kind?: string;
  [extra: string]: unknown;
}

/** Textos legales / de origen de ficheros, por idioma. */
export interface RequiresUserFiles {
  es?: string | null;
  en?: string | null;
  [lang: string]: string | null | undefined;
}

export interface LaunchProfile {
  executable?: string | null;
  args?: string[];
  /**
   * Argumentos con los que el port **sugiere** lanzarlo (`--rom {rom}`).
   *
   * Es una pista del índice, no una imposición: el engranaje ⚙ arranca el campo
   * «Argumentos» con este valor y el usuario puede borrarlo por completo para
   * dejar el campo vacío (un port que no necesita argumentos). `args` es lo que
   * el usuario guardó; `defaultArgs` lo que propone el proyecto.
   */
  defaultArgs?: string[];
  workingDir?: string | null;
  env?: Record<string, string>;
  runner?: string | null;
  preferredExecutables?: string[];
  [extra: string]: unknown;
}

/** Ficha unificada del catálogo (`UnifiedPort` en el indexador). */
export interface PortItem {
  pid: string;
  name: string;
  project?: string | null;
  sourcePlatform: SourcePlatform;
  targetPlatforms: TargetPlatform[];
  distribution: string;
  repository?: string | null;
  repositorySource?: string | null;
  assetHints?: AssetHints;
  releaseAssetFilter?: string | null;
  folderName?: string | null;
  iconUrl?: string | null;
  coverUrl?: string | null;
  /** Grid horizontal (920x430 / 460x215): etiqueta de cartuchos. */
  coverHorizontalUrl?: string | null;
  /** Grid vertical (600x900): carátula de cajas PS2 / Xbox 360 / Switch. */
  coverVerticalUrl?: string | null;
  /** Grid cuadrado (512x512 / 1024x1024): arte de discos y reserva de cartuchos. */
  coverSquareUrl?: string | null;
  /** Logotipo oficial (PNG transparente) de la cabecera de detalle. */
  logoUrl?: string | null;
  /** Imagen panorámica (1920x620): fondo de la cabecera de detalle. */
  heroUrl?: string | null;
  requiresUserFiles: RequiresUserFiles;
  gameData?: unknown;
  installRecipe?: Record<string, unknown> | null;
  modSupport?: unknown;
  preserve: string[];
  linux: Record<string, unknown>;
  android: Record<string, unknown>;
  maturity?: unknown;
  verification: Record<string, unknown>;
  visible: boolean;
  quarantinedLinkFields: string[];
  relations: Record<string, unknown>;
  gameRef: Record<string, unknown>;
  setupFiles: SetupFile[];
  aiLevel: string;
  playerFeedback?: PlayerFeedback | null;
  supportedOS: string[];
  verifiedRelease?: VerifiedRelease | null;
  launch: LaunchProfile;
  installStrategy: InstallStrategy;
  romProfile: RomProfile;
  sources: SourceRef[];
  status?: StatusInfo | null;
  tags: string[];
  gameNames: string[];
  searchAliases: string[];
  /** Payload original del adaptador (depuración; puede ser grande). */
  raw: Record<string, unknown>;
}

/** Bloque `stats` tal y como lo emite `builder.compute_stats()`. */
export interface CatalogStats {
  totalPorts: number;
  bySourcePlatform: Record<string, number>;
  byStatusTag: Record<string, number>;
  byInstallStrategy: Record<string, number>;
  byDistribution: Record<string, number>;
  fusedGamewaveQuiver: number;
  gamewaveOnly: number;
  quiverOnly: number;
  uniqueRepositories: number;
  multiRepositories: Array<{ repository: string; count: number }>;
  multiRepositoryCount: number;
  quarantinedLinks: number;
  withSetupFiles: number;
  withVerifiedRelease: number;
  invisible: number;
  /** Métricas extra que añada el indexador (`deduplicator.last_stats`). */
  [extra: string]: unknown;
}

/** Raíz de `data/ports.index.json`. */
export interface PortIndex {
  version: string;
  schemaVersion: string;
  generatedAt: string;
  semanticHash: string;
  stats: CatalogStats;
  ports: PortItem[];
}

/* -------------------------------------------------------------------------- */
/* Biblioteca local: `ports.json` / localStorage                              */
/* -------------------------------------------------------------------------- */

export const LIBRARY_STORAGE_KEY = 'portshub-library-v1';
export const LIBRARY_SCHEMA_VERSION = 1;

/** Estados de la máquina de instalación (Anexo D.3). */
export const LIBRARY_STATES = [
  'NotInstalled',
  'Downloading',
  'Installing',
  'Installed',
  'NeedsRom',
  'Ready',
  'UpdateAvailable',
  'Broken',
] as const;
export type LibraryState = (typeof LIBRARY_STATES)[number];

export const LIBRARY_STATE_LABELS: Record<LibraryState, string> = {
  NotInstalled: 'Sin instalar',
  Downloading: 'Descargando',
  Installing: 'Instalando',
  Installed: 'Instalado',
  NeedsRom: 'Falta la ROM',
  Ready: 'Listo',
  UpdateAvailable: 'Actualización disponible',
  Broken: 'Roto',
};

export const ROM_MODES = ['link', 'copy', 'external'] as const;
export type RomMode = (typeof ROM_MODES)[number];

export interface LibraryGame {
  pid: string;
  installStrategy: InstallStrategy;
  /** Ruta absoluta del directorio de instalación (vacío si no instalado). */
  installDir: string;
  installedVersion: string | null;
  state: LibraryState;
  romPath: string | null;
  romMode: RomMode;
  /** ISO-8601 del último `validateRom()` correcto. */
  romValidatedAt: string | null;
  launchProfile: LaunchProfile;
  pinnedVersion: string | null;
  autoUpdate: boolean;
  /** Fecha ISO de instalación (informativa). */
  installedAt?: string | null;
  /** Progreso 0–100 de la última operación (informativo). */
  progress?: number;
  /** Último error legible, si lo hubo. */
  error?: string | null;
}

export interface LibraryFile {
  version: number;
  updatedAt: string;
  games: Record<string, LibraryGame>;
  settings: Settings;
  /**
   * Arte personalizado por juego (`pid` → ajustes). Vive aparte de `games`
   * para que exista aunque el port no esté instalado.
   */
  customArt?: Record<string, CustomArtwork>;
  /** Addons (plugins) instalados en el launcher. */
  addons: Addon[];
}

/* -------------------------------------------------------------------------- */
/* Addons (plugins) de la comunidad                                           */
/* -------------------------------------------------------------------------- */

/**
 * Directorio local donde el launcher busca los plugins.
 *
 * Los addons son extensiones de la comunidad (proveedores de assets,
 * escáneres de backups, herramientas de compilación…) que se cargan desde el
 * sistema de ficheros del usuario, nunca desde la red. Cada plugin es una
 * carpeta con un `plugin.json` en su raíz; el backend
 * (`GET /api/plugins`) es quien lo lee realmente.
 */
export const ADDONS_DIR = '~/PortsLauncher/plugins/';

/** Addon instalado en el launcher. */
export interface Addon {
  /** Identificador estable, tomado del `plugin.json` (`asset-provider-x`). */
  id: string;
  /** Nombre visible del plugin. */
  name: string;
  /** Versión declarada por el autor (`1.0.0`). */
  version: string;
  /** Qué hace, en una línea. */
  description: string;
  /** Autor o proyecto que lo publica. */
  author?: string;
  /** Icono (URL o emoji) opcional; sin él se pinta la pieza de puzle. */
  icon?: string;
  /** Tipo de extensión (`asset-provider`, `scanner`, `toolchain`…). */
  type: string;
  /** `true` si el addon está activo. */
  enabled: boolean;
  /** Marca de tiempo (ms) de la instalación. */
  installedAt: number;
  /** Carpeta real del plugin en disco (la rellena `GET /api/plugins`). */
  dir?: string;
  /**
   * Capacidades declaradas por el manifiesto, en minúsculas (`search`,
   * `provision`…). Es lo que permite a la UI saber qué addons pueden buscar y
   * aprovisionar ROMs sin volver a leer el `plugin.json`.
   */
  capabilities?: string[];
  /**
   * Plataformas de origen que declara el manifiesto, en minúsculas. Una lista
   * vacía significa «cualquiera» (el plugin decide qué puede servir).
   */
  platforms?: string[];
}

/**
 * Addons con los que arranca el launcher de fábrica: **ninguno**.
 *
 * No hay plugins inventados. La lista se llena con lo que
 * `libraryService.syncAddons()` recibe de `GET /api/plugins`, es decir, con los
 * `plugin.json` que existan realmente en `~/PortsLauncher/plugins`. Un arranque
 * sin plugins en disco deja la sección vacía, que es un estado válido.
 */
export function defaultAddons(): Addon[] {
  return [];
}

/* -------------------------------------------------------------------------- */
/* Ajustes del launcher                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Vistas del listado.
 *
 * Las claves son las del prototipo (`VIEWS` del mock). `carts` es la estantería
 * de cartuchos y discos.
 */
export const VIEW_MODES = ['posters', 'big', 'carts', 'list', 'table'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Alias heredado: la clave `shelves` se migra a `carts` al leer ajustes. */
export const LEGACY_VIEW_ALIASES: Record<string, ViewMode> = { shelves: 'carts' };

export const MEDIA_MODES = ['single', 'auto'] as const;
export type MediaMode = (typeof MEDIA_MODES)[number];

export const DEST_OPTIONS = ['Linux', 'Windows'] as const;
export type DestOS = (typeof DEST_OPTIONS)[number];

export interface Settings {
  /** Mostrar soportes (cartuchos/discos) junto a las carátulas. */
  media: boolean;
  /** `single` = mismo soporte para todo; `auto` = por plataforma + mediaMap. */
  mediaMode: MediaMode;
  /** Soporte por defecto cuando `mediaMode === 'single'`. */
  mediaDef: MediaStyle;
  /** Overrides por plataforma de origen. */
  mediaMap: Partial<Record<SourcePlatform, MediaStyle>>;
  view: ViewMode;
  dest: DestOS;
  installDir: string;
  romDir: string;
  romMode: RomMode;
  /**
   * Clave API **personal** de SteamGridDB (gratuita). Se envía al proxy de
   * desarrollo en la cabecera `x-steamgrid-key`; vacía = sin integración y el
   * launcher pinta el arte generativo procedural de cada soporte.
   */
  steamgridApiKey?: string;
  /**
   * `true` cuando el usuario activó la descarga automática del catálogo.
   *
   * Con el flag encendido, `main.ts` recorre en segundo plano los juegos que
   * aún no tienen carátula propia y consulta SteamGridDB de forma progresiva
   * (con protección de rate-limit) para guardarla en `customArt`. Con el flag
   * apagado solo se descarga arte a mano desde el modal «Ajustar arte».
   */
  steamgridAutoSync?: boolean;
  /** `true` cuando el asistente de bienvenida ya se completó (no se repite). */
  onboardingDone?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  media: true,
  mediaMode: 'auto',
  mediaDef: 'cd',
  mediaMap: {},
  /* Vista por defecto: estantería de cartuchos y discos (prototipo de Claude). */
  view: 'carts',
  dest: 'Linux',
  installDir: '~/PortsLauncher/ports',
  romDir: '~/PortsLauncher/roms',
  romMode: 'link',
  /* Integraciones: sin clave, el arte generativo hace todo el trabajo. */
  steamgridApiKey: '',
  /* La sincronización masiva del catálogo es opt-in: gasta cuota de la API. */
  steamgridAutoSync: false,
  onboardingDone: false,
};

/* -------------------------------------------------------------------------- */
/* Filtros y ordenación                                                       */
/* -------------------------------------------------------------------------- */

/** Filtro por presencia en la biblioteca local. */
export const LIBRARY_FILTERS = [
  'all',
  'installed',
  'not-installed',
  'ready',
  'needs-rom',
  'updates',
  'broken',
] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

export const LIBRARY_FILTER_LABELS: Record<LibraryFilter, string> = {
  all: 'Todos',
  installed: 'Instalados',
  'not-installed': 'Sin instalar',
  ready: 'Listos',
  'needs-rom': 'Falta ROM',
  updates: 'Actualizables',
  broken: 'Rotos',
};

export interface PortFilter {
  /** `all` o una plataforma concreta. */
  platform?: SourcePlatform | 'all' | null;
  /** `all` o una etiqueta de desarrollo. */
  dev?: DevTag | 'all' | null;
  library?: LibraryFilter | null;
  /** `all` o una plataforma de destino. */
  target?: TargetPlatform | 'all' | null;
  strategy?: InstallStrategy | 'all' | null;
  /** Sólo fichas visibles (por defecto `true`). */
  onlyVisible?: boolean;
}

export const SORT_KEYS = ['name-asc', 'name-desc', 'platform', 'status', 'recent'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  'name-asc': 'Nombre (A→Z)',
  'name-desc': 'Nombre (Z→A)',
  platform: 'Plataforma',
  status: 'Estado',
  recent: 'Novedades',
};

/** Orden canónico de las etiquetas de desarrollo (de mejor a peor). */
export const DEV_TAG_ORDER: Record<DevTag, number> = {
  playable: 0,
  wip: 1,
  bugs: 2,
  exp: 3,
  nodata: 4,
  abandoned: 5,
};

/* -------------------------------------------------------------------------- */
/* Utilidades de tipos                                                        */
/* -------------------------------------------------------------------------- */

export function isSourcePlatform(value: unknown): value is SourcePlatform {
  return typeof value === 'string' && (SOURCE_PLATFORMS as readonly string[]).includes(value);
}

export function isDevTag(value: unknown): value is DevTag {
  return typeof value === 'string' && (DEV_TAGS as readonly string[]).includes(value);
}

export function isLibraryState(value: unknown): value is LibraryState {
  return typeof value === 'string' && (LIBRARY_STATES as readonly string[]).includes(value);
}
