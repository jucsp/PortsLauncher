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
  /**
   * Archivos que debe aportar el usuario (ROM). Nunca es `null`: **todos** los
   * ports se consideran dependientes de una ROM (HU-13). Los ports de
   * descompilación (2 Ship 2 Harkinian, Ship of Harkinian, recompilaciones
   * estáticas) también la necesitan para extraer los assets originales, así que
   * inferir «no necesita ROM» a partir de un `romProfile` vacío era un falso
   * negativo que dejaba al usuario sin la sección de ROM en el engranaje.
   */
  rom: RomReq;
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
/* Búsqueda de ROM en addons (HU-13)                                          */
/* -------------------------------------------------------------------------- */

/** Sufijos entre paréntesis que son metadatos y no parte del título. */
const PAREN_METADATA =
  /^(?:usa?|europe|eu|japan|jp|world|australia|korea|china|brazil|canada|germany|france|spain|italy|netherlands|sweden|asia|en|fr|de|es|it|ja|ko|zh|nl|pt|ru|multi\d*|beta|proto|demo|sample|kiosk|rev\s*\w+|v?\d+(?:\.\d+)*)$/i;

/** ¿El contenido del paréntesis es sólo metadatos (`USA`, `Rev 1`, `En,Fr,De`)? */
function isMetadataParen(inner: string): boolean {
  const text = inner.trim();
  if (!text) return true;
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => PAREN_METADATA.test(part));
}

/**
 * Título con el que buscar la ROM de un port en un addon.
 *
 * Los ports de descompilación se llaman como el *motor*, no como el juego:
 * `2 Ship 2 Harkinian (Zelda: Majora's Mask)`. Buscar ese título completo en
 * Vimm's Vault devolvía cero resultados porque la ROM se llama `Majora's Mask`
 * (HU-13). Reglas:
 *
 * 1. Se descartan los paréntesis de metadatos (`USA`, `Rev 1`, `En,Fr,De`…).
 * 2. Si queda un paréntesis final, se usa su contenido como título real.
 * 3. Dentro de ese contenido, si hay `Serie: Juego`, gana la parte tras los dos
 *    puntos (`Zelda: Majora's Mask` → `Majora's Mask`), que es como están
 *    catalogadas las ROMs.
 *
 * Es una función pura para poder probarla sin montar la aplicación.
 *
 * @example
 * providerQuery("2 Ship 2 Harkinian (Zelda: Majora's Mask)") // "Majora's Mask"
 * providerQuery('Super Mario 64 (USA)')                      // "Super Mario 64"
 */
export function providerQuery(title: string): string {
  const base = String(title ?? '')
    .replace(/[™®©]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';

  let working = base;
  /* 1. Metadatos finales, potencialmente encadenados: `(USA) (Rev 1)`. */
  for (;;) {
    const meta = /\(([^()]*)\)$/.exec(working);
    if (!meta || !isMetadataParen(meta[1])) break;
    working = working.slice(0, meta.index).trim();
    if (!working) return base;
  }

  /* 2. Paréntesis final con el título real del juego. */
  const tail = /\(([^()]*)\)$/.exec(working);
  if (tail) {
    const inner = tail[1].trim();
    const before = working.slice(0, tail.index).trim();
    const colon = inner.lastIndexOf(':');
    const candidate = colon >= 0 ? inner.slice(colon + 1).trim() : inner;
    if (candidate.length >= 2) return candidate;
    if (inner.length >= 2) return inner;
    if (before) return before;
  }
  return working || base;
}

/**
 * Divide una línea de argumentos respetando comillas simples y dobles.
 *
 * El prototipo guarda los argumentos como texto (`--rom {rom} --fullscreen`).
 * Partirlos por espacios rompía las rutas con espacios (`/home/yo/Mis ROMs/…`),
 * así que la tokenización se hace aquí y el backend recibe un array ya resuelto.
 */
export function splitArgs(raw: string): string[] {
  const text = String(raw ?? '');
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/** Marcador que los perfiles de lanzamiento usan para la ruta de la ROM. */
export const ROM_PLACEHOLDER = '{rom}';

/**
 * Argumentos de lanzamiento con `{rom}` sustituido por la ruta real.
 *
 * Sin ROM conocida se devuelven los tokens tal cual: el backend vuelve a
 * intentar la sustitución y, si tampoco puede, el error lo reporta él.
 */
export function resolveLaunchArgs(raw: string, romPath: string): string[] {
  const tokens = splitArgs(raw);
  const rom = String(romPath ?? '').trim();
  if (!rom) return tokens;
  return tokens
    .map((token) => token.split(ROM_PLACEHOLDER).join(rom))
    .filter((token) => token !== '');
}

/* -------------------------------------------------------------------------- */
/* Selección múltiple de ROM (HU-15)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Descriptores de disco: el fichero que el emulador abre de verdad.
 *
 * Un juego de PlayStation o Saturn no es un fichero, es un `.cue`/`.gdi` que
 * declara sus pistas `.bin`. Cuando el usuario arrastra la carpeta entera hay
 * que saber cuál de los ficheros es «la ROM» que recibe `{rom}`.
 */
export const ROM_DESCRIPTOR_EXTS: readonly string[] = ['.cue', '.gdi', '.m3u'];

/** Forma mínima que necesitan los helpers: sirve para `File` y para `{name,size}`. */
export interface RomFileLike {
  name: string;
  size?: number;
  /** Ruta relativa cuando se elige una carpeta (`webkitdirectory`). */
  webkitRelativePath?: string;
}

/** Resultado de analizar una selección múltiple de ficheros de ROM. */
export interface RomSelection<T extends RomFileLike = RomFileLike> {
  /** Índice del fichero principal dentro de la lista original (`-1` si vacía). */
  index: number;
  /** El fichero que debe recibir `{rom}`. */
  main: T | null;
  /** Tamaño del principal en bytes. */
  size: number;
  /** Pistas y asociados que acompañan al principal. */
  companions: T[];
  /** Texto listo para la UI: `Dino Crisis 2.cue (+2 archivos de pistas)`. */
  label: string;
}

/** `juego.CUE` → `cue`. */
export function romExtensionOf(name: string): string {
  const value = String(name ?? '');
  const dot = value.lastIndexOf('.');
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  if (dot <= slash || dot === value.length - 1) return '';
  return value.slice(dot + 1).toLowerCase();
}

/** ¿El nombre corresponde a un descriptor de disco (`.cue`, `.gdi`, `.m3u`)? */
export function isRomDescriptor(name: string): boolean {
  return ROM_DESCRIPTOR_EXTS.includes('.' + romExtensionOf(name));
}

/** Nombre visible: la ruta relativa si el usuario eligió una carpeta. */
export function romDisplayName(file: RomFileLike): string {
  const relative = typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath.trim() : '';
  return relative || String(file.name ?? '');
}

/**
 * Peso de un descriptor: a igualdad de tamaño, gana el más específico.
 *
 * `.cue` > `.gdi` > `.m3u` > cualquier otro fichero, porque los dos primeros
 * identifican un disco concreto y el `.m3u` sólo agrupa varios.
 */
function descriptorWeight(name: string): number {
  const ext = '.' + romExtensionOf(name);
  if (ext === '.cue') return 4;
  if (ext === '.gdi') return 3;
  if (ext === '.m3u') return 2;
  return ROM_DESCRIPTOR_EXTS.includes(ext) ? 1 : 0;
}

/**
 * Elige el fichero que debe recibir `{rom}` entre una selección múltiple.
 *
 * Prioridad: descriptor de disco y, si no hay ninguno, **el de mayor tamaño**
 * (la pista de datos es la grande; un `.sbi` de 100 bytes nunca es el juego).
 * Empate → el primero que aparece, para que el resultado sea determinista.
 */
export function describeRomFileSet<T extends RomFileLike>(
  files: readonly T[] | null | undefined
): RomSelection<T> {
  const list = (files ?? []).filter((file): file is T => !!file && !!String(file.name ?? ''));
  if (list.length === 0) {
    return { index: -1, main: null, size: 0, companions: [], label: '' };
  }

  let index = 0;
  for (let i = 1; i < list.length; i += 1) {
    const candidate = list[i];
    const best = list[index];
    const candidateWeight = descriptorWeight(candidate.name);
    const bestWeight = descriptorWeight(best.name);
    if (candidateWeight > bestWeight) {
      index = i;
    } else if (candidateWeight === bestWeight && (candidate.size ?? 0) > (best.size ?? 0)) {
      index = i;
    }
  }

  const main = list[index];
  const companions = list.filter((_, position) => position !== index);
  const name = romDisplayName(main);
  const label =
    companions.length === 0
      ? name
      : `${name} (+${companions.length} ${companions.length === 1 ? 'archivo de pistas' : 'archivos de pistas'})`;

  return { index, main, size: main.size ?? 0, companions, label };
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

/**
 * Extensiones de ROM por plataforma de origen (HU-13).
 *
 * El índice no siempre declara `romProfile.extensions` (los ports de
 * descompilación suelen declararlo vacío porque la ROM se consume en tiempo de
 * ejecución, no en el instalador). Sin inferencia, `romOf` devolvía `null` y la
 * UI concluía «Este port no necesita ROM». La tabla es deliberadamente amplia:
 * aceptar extensiones de más es inocuo (la validación final es del usuario),
 * mientras que aceptar de menos bloquea el flujo.
 */
export const ROM_EXTENSIONS_BY_PLATFORM: Record<SourcePlatform, readonly string[]> = {
  n64: ['.z64', '.n64', '.v64', '.rom'],
  snes: ['.sfc', '.smc', '.fig', '.swc'],
  nes: ['.nes', '.unf', '.fds'],
  md: ['.md', '.gen', '.smd', '.bin'],
  gba: ['.gba', '.agb'],
  gb: ['.gb', '.gbc'],
  nds: ['.nds', '.srl'],
  n3ds: ['.3ds', '.cia', '.cci'],
  nsw: ['.nsp', '.xci'],
  psp: ['.iso', '.cso', '.pbp'],
  ps1: ['.bin', '.cue', '.iso', '.chd', '.img'],
  ps2: ['.iso', '.chd', '.bin'],
  gcn: ['.iso', '.gcm', '.rvz'],
  wii: ['.iso', '.wbfs', '.rvz'],
  xbox: ['.iso', '.xiso'],
  x360: ['.iso', '.god'],
  ps3: ['.iso', '.pkg'],
  ps4: ['.pkg'],
  wiiu: ['.wud', '.wux', '.rpx'],
  dc: ['.gdi', '.cdi', '.chd', '.bin'],
  vita: ['.vpk', '.mai'],
  xbone: ['.iso'],
  pc: ['.iso', '.bin'],
  other: [] /* sin tabla útil: activa ROM_EXTENSIONS_FALLBACK */,
};

/**
 * Reserva generosa cuando la plataforma no aporta nada mejor que `other`.
 *
 * Incluye las extensiones del ticket de HU-13 (`.rom`, `.wbfs`) y las de los
 * formatos más habituales de descompilación (`.z64`, `.iso`, `.bin`).
 */
export const ROM_EXTENSIONS_FALLBACK: readonly string[] = ['.iso', '.bin', '.rom', '.z64', '.wbfs'];

/**
 * Extensiones aceptadas para una plataforma.
 *
 * @param platform Plataforma de origen del port; admite `null`/basura porque
 *   el índice puede traer fichas antiguas sin el campo.
 */
export function inferRomExtensions(platform: SourcePlatform | null | undefined): string[] {
  const table = platform ? ROM_EXTENSIONS_BY_PLATFORM[platform] : undefined;
  return table && table.length > 0 ? [...table] : [...ROM_EXTENSIONS_FALLBACK];
}

/**
 * Archivos que debe aportar el usuario. **Nunca devuelve `null`** (HU-13).
 *
 * Prioridad de las extensiones: las declaradas por el índice → inferidas de la
 * plataforma de origen → reserva genérica. El `sha` se abrevia para la ficha,
 * como antes; si el índice no publica hashes queda `requerido`.
 */
export function romOf(port: PortItem): RomReq {
  const profile = port.romProfile;
  const declared = Array.isArray(profile?.extensions)
    ? profile.extensions.filter((ext): ext is string => typeof ext === 'string' && ext.trim() !== '')
    : [];
  const extensions = declared.length > 0 ? declared.slice() : inferRomExtensions(port.sourcePlatform);

  const accepted = Array.isArray(profile?.accepted) ? profile.accepted : [];
  const firstHash = accepted.find((entry) => typeof entry?.sha1 === 'string');
  const sha = firstHash?.sha1 ? `${String(firstHash.sha1).slice(0, 9)}…` : 'requerido';
  return {
    n: `${port.name} ROM`,
    x: extensions,
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
    /* Una ROM ya registrada en `ports.json` se refleja en la ficha al arrancar
     * (HU-13): antes se exigía `romValidatedAt`, así que una biblioteca con
     * `romPath` pero sin marca de validación seguía mostrando «Falta ROM» y el
     * botón «Jugar» quedaba bloqueado con la ROM en disco. */
    romOk:
      (saved?.romPath ?? '').trim() !== '' ||
      (installed && (!!saved?.romValidatedAt || state === 'Ready')),
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

/**
 * Extrae el valor de un campo de un diccionario serializado como texto.
 *
 * El indexador arrastra `project` tal cual lo publica la fuente: algunas fichas
 * (Harbour Masters entre ellas) lo emiten como `repr()` de Python, así que el
 * campo llega a la UI como `"{'key': 'harbourmasters', 'name': 'Harbour Masters'}"`
 * y el subtítulo del port mostraba el diccionario en crudo (HU-13).
 *
 * @returns El valor desescapado, o `null` si el campo no aparece.
 */
function pythonDictField(text: string, field: string): string | null {
  const pattern = new RegExp(`['"]${field}['"]\\s*:\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`);
  const match = pattern.exec(text);
  if (!match) return null;
  const raw = match[1] ?? match[2] ?? '';
  /* `repr()` escapa comillas y barras invertidas. */
  const value = raw.replace(/\\(['"\\])/g, '$1').trim();
  return value || null;
}

/**
 * ¿El texto es el `repr()` de un diccionario de Python?
 *
 * Se exige llaves en los extremos y al menos un `clave: valor` entrecomillado
 * para no confundir un título legítimo con paréntesis o comillas.
 */
function looksLikePythonDict(text: string): boolean {
  return /^\s*\{.*\}\s*$/s.test(text) && /['"][^'"]+['"]\s*:/.test(text);
}

/**
 * Nombre del proyecto a partir de un `project` textual.
 *
 * @returns `null` cuando el texto no es un diccionario reconocible.
 */
export function projectFromText(text: string): string | null {
  const value = text.trim();
  if (!value || !looksLikePythonDict(value)) return null;
  return pythonDictField(value, 'name') ?? pythonDictField(value, 'key');
}

/** Nombre del proyecto, tolerante a `string`, `null`, objetos y `repr()` de Python. */
export function projectOf(port: PortItem): string {
  const raw = port.project as unknown;
  if (raw === null || raw === undefined) return port.name.split(/[:–-]/)[0].trim();
  if (typeof raw === 'string') {
    const fromDict = projectFromText(raw);
    if (fromDict) return fromDict;
    return raw.trim() || port.name;
  }
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
