/* ==========================================================================
 * PortsLauncher · ui/model.ts
 *
 * Modelo de vista. Es el objeto `g` que consume el prototipo de Claude
 * (`Documentación/PortsHub Prototipo.html`): cada `PortItem` del índice se
 * proyecta aquí una vez por render, junto con el snapshot de su ficha de
 * biblioteca (`ports.json`). Así las funciones de pintado son puras y su HTML
 * es idéntico al del mock.
 * ========================================================================== */

import type {
  CustomArtwork,
  InstallStrategy,
  LibraryGame,
  LogoAnchor,
  MediaStyle,
  PortItem,
  RomMode,
  Settings,
  SourcePlatform,
} from '../services/types';
import {
  COVER_OFFSET_DEFAULT,
  COVER_OFFSET_MAX,
  COVER_OFFSET_MIN,
  COVER_SCALE_DEFAULT,
  COVER_SCALE_MAX,
  COVER_SCALE_MIN,
  HERO_SCALE_DEFAULT,
  HERO_SCALE_MAX,
  HERO_SCALE_MIN,
  LOGO_ANCHOR_DEFAULT,
  LOGO_SCALE_DEFAULT,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
} from '../services/types';
import { catalogService } from '../services/catalogService';
import { libraryService } from '../services/libraryService';
import { DEVT, DSSH, FROM_PLATFORM, MEDIA, PLAT, PLATMEDIA, STRAT, TO_PLATFORM } from './platforms';
import type { DevInfo, DevKey, PlatKey } from './platforms';

/* -------------------------------------------------------------------------- */
/* Estado efímero compartido por los pintores                                 */
/* -------------------------------------------------------------------------- */

/**
 * Progreso de instalación en curso (`PROG[id] = 0…100`). Su presencia cambia
 * el estado de la ficha a «Instalando» y hace que se pinte la barra.
 */
export const PROG: Record<string, number> = {};

/* -------------------------------------------------------------------------- */
/* Tipos del modelo de vista                                                  */
/* -------------------------------------------------------------------------- */

export type Pattern =
  | 'sun'
  | 'grid'
  | 'diag'
  | 'dots'
  | 'waves'
  | 'mesh'
  | 'neon'
  | 'stripes';

/** Catálogo de patrones procedurales (orden estable: define el reparto por pid). */
export const PATTERNS: readonly Pattern[] = [
  'sun',
  'grid',
  'diag',
  'dots',
  'waves',
  'mesh',
  'neon',
  'stripes',
];
/** `[oscuro, medio, luz]` — igual que el `c` del prototipo. */
export type Palette = [string, string, string];

export interface RomReq {
  /** Nombre del fichero que se pide (`GoldenEye 007 ROM`). */
  n: string;
  /** Extensiones aceptadas (`.z64 .n64 …`). */
  x: string[];
  /** Huella esperada, abreviada para mostrar. */
  sha: string;
}

export interface DevState extends DevInfo {
  k: DevKey;
  why: string;
  conf: string;
}

export type StatusKey = 'inst' | 'build' | 'ext' | 'new' | 'rom' | 'upd' | 'ready';
export type ActionKey = 'none' | 'detail' | 'ext' | 'install' | 'rom' | 'update' | 'play';

export interface Status {
  k: StatusKey;
  label: string;
  color: string;
  cta: string;
  act: ActionKey;
}

/** Proyección de `PortItem` + `LibraryGame` que consume el renderizador. */
export interface Game {
  /** `pid` del índice (el `id` del prototipo). */
  id: string;
  /** Título. */
  t: string;
  /** Título corto de carátula (`GOLDEN\nEYE`). */
  cv: string;
  /** Proyecto / autor. */
  pr: string;
  /** Última versión conocida. */
  lv: string;
  /** Versión verificada. */
  ver: string | null;
  /** Plataforma de origen como clave visual. */
  pl: PlatKey;
  /** Plataforma de origen tal y como la usa el servicio (minúsculas). */
  platform: SourcePlatform;
  /** Estrategia de instalación (texto legible). */
  st: string;
  /** Estrategia de instalación (clave del índice). */
  strategy: InstallStrategy;
  /** Tamaño aproximado en MB (0 si el índice no lo declara). */
  mb: number;
  /** Paleta de la carátula generativa. */
  c: Palette;
  /** Patrón de la carátula generativa. */
  p: Pattern;
  /** Portada real, si el índice la trae. */
  cover: string | null;
  /** Grid horizontal (etiqueta de cartucho), si el índice la trae. */
  coverHorizontal: string | null;
  /** Grid vertical (carátula de caja PS2 / Xbox 360 / Switch), si la trae. */
  coverVertical: string | null;
  /** Grid cuadrado (arte de discos y reserva de cartuchos), si la trae. */
  coverSquare: string | null;
  /** Logotipo oficial (PNG transparente) para la cabecera de detalle. */
  logo: string | null;
  /** Imagen panorámica para la cabecera de la ficha de detalle, si la trae. */
  hero: string | null;
  /** Arte personalizado del usuario (botón «Ajustar arte»), si lo hay. */
  customArt?: CustomArtwork | null;
  /** Punto de anclaje del logotipo en la cabecera. */
  logoAnchor: LogoAnchor;
  /** Alto del logotipo en píxeles (40–220). */
  logoScale: number;
  /** Escala del fondo de cabecera en porcentaje (100–250). */
  heroScale: number;
  /** Zoom de la carátula dentro del soporte en porcentaje (80–200). */
  coverScale: number;
  /** Desplazamiento vertical de la carátula dentro del soporte (-50…50 %). */
  coverY: number;
  /** Desplazamiento horizontal de la carátula dentro del soporte (-50…50 %). */
  coverX: number;
  /** Archivos que debe aportar el usuario (ROM), o `null`. */
  rom: RomReq | null;
  /** Nivel de asistencia por IA declarado. */
  ai: string;
  /** El proyecto se declara experimental. */
  exp: boolean;
  /** Etiqueta de estado de desarrollo. */
  dev: DevState;
  /** Repositorio `owner/name`, si es público. */
  repo: string | null;
  /** Qué declara el proyecto: versión publicada, en desarrollo… */
  decl: string;
  /** Bugs abiertos declarados por el índice. */
  bugs: number;
  /** Meses desde el último cambio conocido. */
  months: number;
  /** Plataformas de destino legibles (`Windows`, `Linux`…). */
  targets: string[];
  /* --- snapshot de la biblioteca local --- */
  inst: boolean;
  romOk: boolean;
  /** Versión instalada. */
  v: string | null;
  pin: boolean;
  auto: boolean;
  dir: string;
  romPath: string;
  romMode: RomMode;
  args: string;
  runner: string;
  exe: string;
  played: number;
  /** Ficha original del índice (fuentes, notas legales, setupFiles…). */
  port: PortItem;
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Escape HTML mínimo (idéntico al `esc` del prototipo). */
export const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char];
  });

/** FNV-1a de 32 bits, estable entre sesiones. */
export function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Paleta de la carátula generativa, derivada del `pid`. */
export function paletteFromPid(pid: string, platform: SourcePlatform): Palette {
  const info = PLAT[FROM_PLATFORM[platform] ?? 'OTRAS'];
  const hash = hash32(pid);
  const hue = hash % 360;
  const hue2 = (hue + 26 + (hash % 40)) % 360;
  return [`hsl(${hue} 58% 13%)`, `hsl(${hue2} 64% 34%)`, info.tag];
}

/** Patrón de la carátula generativa, derivado del `pid`. */
export function patternFromPid(pid: string): Pattern {
  return PATTERNS[hash32(`${pid}·pattern`) % PATTERNS.length];
}

/** `GOLDENEYE 007` → `GOLDENEYE\n007` (dos líneas como el mock). */
export function coverTitle(name: string): string {
  const words = name
    .replace(/^(the)\s+/i, '')
    .replace(/[™®©]/g, '')
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return name.toUpperCase();
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]}\n${words[1]}`;
  const cut = Math.ceil(words.length / 2);
  return `${words.slice(0, cut).join(' ')}\n${words.slice(cut).join(' ')}`;
}

/** Nombre de carpeta del port (`GoldenEye 007` → `GoldenEye007`). */
export function folderOf(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '');
}

/* -------------------------------------------------------------------------- */
/* Carátula generativa (`art` del prototipo, línea 243)                       */
/* -------------------------------------------------------------------------- */

/**
 * Fondo CSS procedural de un soporte sin carátula real.
 *
 * Todos los patrones se construyen con gradientes CSS apilados (sin imágenes ni
 * SVG) para que el arte viaje en el propio `style` en línea y se degrade con
 * elegancia: si un navegador no entiende una capa, pinta las siguientes.
 *
 * `color[2]` (`light`) siempre es un color hex de `PLAT[...].tag`, así que se
 * le puede añadir el alfa con sufijo (`${light}33`). Los otros dos son `hsl()`
 * y usan `rgba()` para las veladuras.
 */
export function art(color: Palette, pattern: Pattern): string {
  const [dark, mid, light] = color;

  switch (pattern) {
    /* Sol arcade con scanlines de tubo. */
    case 'sun':
      return (
        `radial-gradient(circle at 50% 38%,${light} 0 19%,transparent 20%),` +
        `radial-gradient(circle at 50% 38%,${light}55 0 30%,transparent 31%),` +
        `repeating-linear-gradient(0deg,rgba(0,0,0,0) 0 8px,rgba(0,0,0,.26) 8px 10px),` +
        `linear-gradient(180deg,${dark},${mid})`
      );

    /* Rejilla de perspectiva (suelo de neón). */
    case 'grid':
      return (
        `repeating-linear-gradient(90deg,${light}33 0 1px,transparent 1px 16px),` +
        `repeating-linear-gradient(0deg,${light}33 0 1px,transparent 1px 16px),` +
        `radial-gradient(circle at 50% 112%,${light}44 0 42%,transparent 70%),` +
        `linear-gradient(200deg,${dark},${mid})`
      );

    /* Diagonales de cinta de casete. */
    case 'diag':
      return (
        `repeating-linear-gradient(135deg,rgba(255,255,255,.1) 0 4px,transparent 4px 12px),` +
        `repeating-linear-gradient(45deg,${light}22 0 2px,transparent 2px 22px),` +
        `linear-gradient(160deg,${dark},${mid} 68%,${light})`
      );

    /* Trama de puntos (LED matrix). */
    case 'dots':
      return (
        `radial-gradient(${light}77 1.2px,transparent 1.3px) 0 0/10px 10px,` +
        `radial-gradient(${light}33 1px,transparent 1.1px) 5px 5px/10px 10px,` +
        `linear-gradient(150deg,${mid},${dark})`
      );

    /* Ondas concéntricas de radar retro. */
    case 'waves':
      return (
        `repeating-radial-gradient(circle at 50% 118%,${light}3D 0 2px,transparent 2px 14px),` +
        `repeating-linear-gradient(0deg,rgba(255,255,255,.06) 0 5px,transparent 5px 13px),` +
        `linear-gradient(180deg,${dark},${mid})`
      );

    /* Malla cruzada con foco de luz. */
    case 'mesh':
      return (
        `repeating-linear-gradient(45deg,${light}26 0 1px,transparent 1px 14px),` +
        `repeating-linear-gradient(-45deg,${light}26 0 1px,transparent 1px 14px),` +
        `radial-gradient(circle at 32% 22%,${light}44 0 12%,transparent 55%),` +
        `linear-gradient(180deg,${mid},${dark})`
      );

    /* Atardecer synthwave con barrotes de neón. */
    case 'neon':
      return (
        `repeating-linear-gradient(0deg,${light}55 0 2px,transparent 2px 18px),` +
        `radial-gradient(circle at 50% 76%,${light} 0 26%,transparent 27%),` +
        `radial-gradient(circle at 50% 76%,${light}44 0 40%,transparent 62%),` +
        `linear-gradient(180deg,${dark} 0 44%,${mid} 100%)`
      );

    /* Rayas verticales de valla publicitaria. */
    case 'stripes':
    default:
      return (
        `repeating-linear-gradient(90deg,rgba(255,255,255,.1) 0 6px,transparent 6px 18px),` +
        `repeating-linear-gradient(90deg,${light}2E 0 3px,transparent 3px 18px),` +
        `linear-gradient(200deg,${mid},${dark} 78%)`
      );
  }
}

/** Atajo del prototipo: `art(g.c, g.p)`. */
export const artOf = (game: Game): string => art(game.c, game.p);

/** Alto del logotipo acotado al rango del slider (40–220 px). */
export function clampLogoScale(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return LOGO_SCALE_DEFAULT;
  return Math.max(LOGO_SCALE_MIN, Math.min(LOGO_SCALE_MAX, Math.round(value)));
}

/** Escala del fondo de cabecera acotada al rango del slider (100–250 %). */
export function clampHeroScale(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return HERO_SCALE_DEFAULT;
  return Math.max(HERO_SCALE_MIN, Math.min(HERO_SCALE_MAX, Math.round(value)));
}

/** Zoom de la carátula dentro del soporte (80–200 %). */
export function clampCoverScale(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return COVER_SCALE_DEFAULT;
  return Math.max(COVER_SCALE_MIN, Math.min(COVER_SCALE_MAX, Math.round(value)));
}

/**
 * Desplazamiento de la carátula dentro del soporte (-50…50 %).
 *
 * Se redondea al entero y se acota para que `translate()` nunca empuje la
 * imagen fuera del recorte de la etiqueta más de media caja.
 */
export function clampCoverOffset(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return COVER_OFFSET_DEFAULT;
  return Math.max(COVER_OFFSET_MIN, Math.min(COVER_OFFSET_MAX, Math.round(value)));
}

/* -------------------------------------------------------------------------- */
/* Carátula según el soporte físico                                           */
/* -------------------------------------------------------------------------- */

/**
 * Siluetas que lucen la etiqueta del **grid horizontal** del cartucho.
 *
 * Coincide con `CARTRIDGE_PLATFORMS` del indexado (grid 920x430 / 460x215).
 */
const HORIZONTAL_COVER_STYLES: readonly MediaStyle[] = [
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
 * Siluetas que lucen la carátula del **grid vertical** de la caja.
 *
 * Coincide con `BOX_PLATFORMS` del indexado (grid 600x900).
 */
const VERTICAL_COVER_STYLES: readonly MediaStyle[] = ['ps2', 'x360', 'nsw', 'ps3', 'ps4', 'wiiu', 'xbone', 'vita'];

/** Devuelve la URL si es una cadena con contenido; `null` en cualquier otro caso. */
const usableCover = (url: string | null | undefined): string | null =>
  typeof url === 'string' && url.trim() ? url : null;

/**
 * Carátula que corresponde al soporte que se está dibujando.
 *
 * - **Cartuchos** (`n64`, `snes`, `nes`, `md`, `gba`, `gb`, `nds`, `n3ds`):
 *   `coverHorizontal` (grid horizontal de la etiqueta) → `coverSquare` → `cover`.
 * - **Cajas** (`ps2`, `x360`, `nsw`): `coverVertical` (grid vertical) → `cover`.
 * - **Resto** (discos, PC, otros): `coverSquare` → `cover` → `coverVertical`.
 *
 * Si el arte específico falta se degrada a `cover`; si tampoco hay, `null` y el
 * soporte pinta su arte generativo procedural.
 */
export function coverForStyle(game: Game, style: MediaStyle): string | null {
  if (HORIZONTAL_COVER_STYLES.includes(style)) {
    return (
      usableCover(game.coverHorizontal) ??
      usableCover(game.coverSquare) ??
      usableCover(game.cover) ??
      usableCover(game.coverVertical)
    );
  }
  if (VERTICAL_COVER_STYLES.includes(style)) {
    return (
      usableCover(game.coverVertical) ??
      usableCover(game.cover) ??
      usableCover(game.coverSquare) ??
      usableCover(game.coverHorizontal)
    );
  }
  return (
    usableCover(game.coverSquare) ??
    usableCover(game.cover) ??
    usableCover(game.coverVertical) ??
    usableCover(game.coverHorizontal)
  );
}

/* -------------------------------------------------------------------------- */
/* Estado de la ficha (`status` y `flagOf` del prototipo)                     */
/* -------------------------------------------------------------------------- */

/** Orden de presentación de los estados (para la ordenación por estado). */
export const ORD: Record<StatusKey, number> = {
  rom: 0,
  upd: 1,
  ready: 2,
  inst: 3,
  new: 4,
  build: 5,
  ext: 6,
};

/** Estrategias que no se instalan desde el launcher. */
const BUILD_STRATEGIES = new Set(['source-only', 'recipe', 'needsChoice']);

export function statusOf(game: Game): Status {
  if (PROG[game.id] != null) {
    return {
      k: 'inst',
      label: 'Instalando',
      color: 'var(--accent2)',
      cta: 'Instalando…',
      act: 'none',
    };
  }
  if (!game.inst) {
    return {
      k: 'new',
      label: 'Sin instalar',
      color: 'var(--muted)',
      cta: 'Instalar',
      act: 'install',
    };
  }
  if (game.rom && !game.romOk) {
    return { k: 'rom', label: 'Falta ROM', color: 'var(--warn)', cta: 'Añadir ROM', act: 'rom' };
  }
  if (game.lv !== '—' && game.v !== game.lv && !game.pin) {
    return {
      k: 'upd',
      label: 'Actualización',
      color: 'var(--accent)',
      cta: 'Actualizar',
      act: 'update',
    };
  }
  return { k: 'ready', label: 'Listo', color: 'var(--accent2)', cta: 'Jugar', act: 'play' };
}

/** Insignia de aviso sobre el soporte (↑ actualización, ! falta ROM). */
export function flagOf(game: Game): [string, string] | null {
  const kind = statusOf(game).k;
  if (kind === 'upd') return ['↑', 'var(--accent)'];
  if (kind === 'rom') return ['!', 'var(--warn)'];
  return null;
}

/* -------------------------------------------------------------------------- */
/* Soportes: estilo por plataforma y por ajustes                              */
/* -------------------------------------------------------------------------- */

/**
 * `styleOf(k)` del prototipo: medio de una plataforma según los ajustes.
 *
 * Cadena de reserva completa: override del usuario → medio propio de la
 * plataforma → estilo por defecto → `cd`. Es importante que NUNCA devuelva
 * `undefined`: plataformas como `PC` u `OTRAS` no tienen entrada en
 * `PLATMEDIA`, y un estilo vacío rompía `MEDIA[styleFor(...)]` al pintar las
 * estanterías (el Catálogo se quedaba sin cartuchos ni discos).
 */
export function styleOf(key: PlatKey, settings: Settings): MediaStyle {
  const mapped = settings.mediaMap ? settings.mediaMap[TO_PLATFORM[key]] : undefined;
  return mapped || PLATMEDIA[key] || settings.mediaDef || 'cd';
}

/** `styleFor(g)` del prototipo: un solo estilo o el de su plataforma. */
export function styleFor(game: Game, settings: Settings): MediaStyle {
  const style = settings.mediaMode === 'single' ? settings.mediaDef : styleOf(game.pl, settings);
  if (style && MEDIA[style]) return style;
  return settings.mediaDef && MEDIA[settings.mediaDef] ? settings.mediaDef : 'cd';
}

/** Ancho del soporte en píxeles, con reserva segura si el estilo no existe. */
export function mediaWidth(style: MediaStyle): number {
  const info = MEDIA[style] ?? MEDIA.cd;
  return info.w;
}

/** Cuerpo de la carcasa cuando el cartucho no declara `bg`. */
export function bodyOf(key: PlatKey): string {
  const [from, to] = (DSSH[key] ?? '#8A86B0,#4A476E').split(',');
  return `linear-gradient(180deg,${from},${to})`;
}

export { MEDIA };

/* -------------------------------------------------------------------------- */
/* Proyección `PortItem` → `Game`                                             */
/* -------------------------------------------------------------------------- */

interface LibrarySnapshot {
  game: LibraryGame;
  installDir: string;
}

/** Etiqueta de estado de desarrollo con los colores del prototipo. */
function devOf(port: PortItem): DevState {
  const info = catalogService.getDevTagInfo(port);
  const key = (info.tag ?? 'nodata') as DevKey;
  const meta = DEVT[key] ?? DEVT.nodata;
  return { k: key, t: meta.t, c: meta.c, g: meta.g, why: info.why, conf: info.conf };
}

/** Archivos que debe aportar el usuario, si el índice los declara. */
function romOf(port: PortItem): RomReq | null {
  const profile = port.romProfile;
  const extensions = Array.isArray(profile?.extensions) ? profile.extensions.slice() : [];
  const text =
    (port.requiresUserFiles?.['es'] as string | null | undefined) ??
    (port.requiresUserFiles?.['en'] as string | null | undefined) ??
    null;
  const setupRom = (port.setupFiles ?? []).some(
    (file) => file.required === true && /rom/i.test(String(file.kind ?? file.name ?? ''))
  );
  const needs = text !== null ? text.trim() !== '' : extensions.length > 0 && profile.binding !== 'in-app';
  if (!needs && !setupRom) return null;

  const accepted = Array.isArray(profile?.accepted) ? profile.accepted : [];
  const firstHash = accepted.find((entry) => typeof entry?.sha1 === 'string');
  const sha = firstHash?.sha1 ? `${String(firstHash.sha1).slice(0, 9)}…` : 'requerido';
  return {
    n: `${port.name} ROM`,
    x: extensions.length > 0 ? extensions : ['.iso', '.bin', '.rom', '.z64'],
    sha,
  };
}

/**
 * Proyecta una ficha del índice junto con su estado local.
 *
 * `library` es el snapshot de `libraryService` (`games`), no una referencia al
 * servicio: el renderizador no debe consultar almacenamiento.
 */
export function toGame(
  port: PortItem,
  library: Record<string, LibraryGame>,
  settings: Settings
): Game {
  const saved = library[port.pid];
  const state = saved?.state ?? 'NotInstalled';
  const installed =
    state !== 'NotInstalled' && state !== 'Broken' && state !== 'Downloading' && state !== 'Installing';
  const version = saved?.installedVersion ?? null;
  const latest = port.verifiedRelease?.version ?? '—';
  const dev = devOf(port);
  const platform = port.sourcePlatform ?? 'other';
  /* Arte personalizado (localStorage → `customArt[pid]`): sobreescribe el del
   * índice y está disponible tanto para ports instalados como no instalados. */
  const custom = libraryService.getCustomArt(port.pid);

  return {
    id: port.pid,
    t: port.name,
    cv: coverTitle(port.name),
    pr: projectOf(port),
    lv: latest,
    ver: port.verifiedRelease?.version ?? null,
    pl: FROM_PLATFORM[platform] ?? 'OTRAS',
    platform,
    st: STRAT[port.installStrategy] ?? 'Descarga directa',
    strategy: port.installStrategy,
    mb: 0,
    c: paletteFromPid(port.pid, platform),
    p: patternFromPid(port.pid),
    cover: custom?.coverUrl ?? port.coverUrl ?? null,
    coverHorizontal: custom?.coverUrl ?? port.coverHorizontalUrl ?? null,
    coverVertical: port.coverVerticalUrl ?? null,
    coverSquare: port.coverSquareUrl ?? null,
    logo: custom?.logoUrl ?? port.logoUrl ?? null,
    hero: custom?.heroUrl ?? port.heroUrl ?? null,
    customArt: custom,
    logoAnchor: custom?.logoAnchor ?? LOGO_ANCHOR_DEFAULT,
    logoScale: clampLogoScale(custom?.logoScale ?? LOGO_SCALE_DEFAULT),
    heroScale: clampHeroScale(custom?.heroScale ?? HERO_SCALE_DEFAULT),
    coverScale: clampCoverScale(custom?.coverScale ?? COVER_SCALE_DEFAULT),
    coverY: clampCoverOffset(custom?.coverY ?? COVER_OFFSET_DEFAULT),
    coverX: clampCoverOffset(custom?.coverX ?? COVER_OFFSET_DEFAULT),
    rom: romOf(port),
    ai: port.aiLevel || 'unknown',
    exp: dev.k === 'exp',
    dev,
    repo: typeof port.repository === 'string' && port.repository ? port.repository : null,
    decl: declOf(port),
    bugs: Math.max(0, Math.round(Number(port.status?.community?.bugReports ?? 0) || 0)),
    months: monthsSince(lastSeenOf(port)),
    targets: (port.targetPlatforms ?? []).map((target) => TARGET_ES[target] ?? String(target)),
    inst: installed,
    romOk: installed && !!(saved?.romValidatedAt || state === 'Ready'),
    v: installed ? version : null,
    pin: !!saved?.pinnedVersion,
    auto: !!saved?.autoUpdate,
    dir: saved?.installDir || `${settings.installDir}/${folderOf(port.name)}`,
    romPath: saved?.romPath ?? '',
    romMode: saved?.romMode ?? settings.romMode,
    args: (saved?.launchProfile?.args ?? []).join(' ') || '--rom {rom}',
    runner: saved?.launchProfile?.runner || 'Nativo',
    exe: saved?.launchProfile?.executable || `./${folderOf(port.name)}`,
    played: 0,
    port,
  };
}

/** Destinos del índice → etiqueta corta de la ficha. */
const TARGET_ES: Record<string, string> = {
  windows: 'Windows',
  linux: 'Linux',
  android: 'Android',
  macos: 'macOS',
  ios: 'iOS',
  switch: 'Switch',
  web: 'Web',
  other: 'Otros',
};

/** `status.development` → texto de la ficha. */
function declOf(port: PortItem): string {
  const value = String(port.status?.development ?? '').toLowerCase();
  if (value === 'release' || value === 'released') return 'Versión publicada';
  if (value === 'wip' || value === 'active' || value === 'development') return 'En desarrollo';
  if (value === 'experimental') return 'Experimental';
  return 'Sin declarar';
}

/** Fecha más reciente observada por el indexador. */
function lastSeenOf(port: PortItem): string {
  const dates = (port.sources ?? [])
    .map((source) => Date.parse(source.lastSeen ?? ''))
    .filter((time) => Number.isFinite(time));
  if (dates.length === 0) return '';
  return new Date(Math.max(...dates)).toISOString();
}

/** Meses completos transcurridos desde una fecha ISO. */
function monthsSince(iso: string): number {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 0;
  const diff = Date.now() - time;
  if (diff <= 0) return 0;
  return Math.floor(diff / (30 * 24 * 60 * 60 * 1000));
}

/** Nombre del proyecto, tolerante a `string`, `null` y objetos del adaptador. */
export function projectOf(port: PortItem): string {
  const raw = port.project as unknown;
  if (raw === null || raw === undefined) return port.name.split(/[:–-]/)[0].trim();
  if (typeof raw === 'string') return raw.trim() || port.name;
  if (typeof raw === 'object') {
    const record = raw as { name?: unknown; key?: unknown };
    const name = typeof record.name === 'string' ? record.name : '';
    const key = typeof record.key === 'string' ? record.key : '';
    return (name || key || port.name).trim();
  }
  return String(raw);
}

/* -------------------------------------------------------------------------- */
/* Insignias                                                                  */
/* -------------------------------------------------------------------------- */

/** `devChip` del prototipo (línea 228). */
export function devChip(game: Game, size?: string): string {
  return (
    `<span class="dev ${size || ''}" style="--c:${game.dev.c}" title="${game.dev.why.replace(/"/g, '')}">` +
    `${game.dev.g} ${game.dev.t}</span>`
  );
}

/** Píldora de estado de instalación. */
export function statePill(game: Game): string {
  const state = statusOf(game);
  return `<span class="pill" style="--c:${state.color}">${state.label}</span>`;
}

/** Etiqueta de plataforma de origen para la esquina de la carátula. */
export function platTag(game: Game): string {
  return `<span class="tag">${game.pl}</span>`;
}
