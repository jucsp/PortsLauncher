/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/Media.ts
 *
 * Port **1:1** de `mediaHTML()` del prototipo de Claude
 * (`Documentación/PortsHub Prototipo.html`, líneas 259-324).
 *
 * Diferencias inevitables respecto al prototipo (los datos son otros):
 *   - el prototipo recibe un objeto mock `g` con `c` (paleta), `p` (patrón) y
 *     `cv` (texto de carátula); aquí la paleta y el patrón se derivan de forma
 *     determinista del `pid` + la plataforma, y el texto de la carátula se
 *     calcula a partir del nombre del port.
 *   - si la ficha trae `coverUrl`, la carátula real sustituye al arte
 *     generativo **dentro de la etiqueta** del cartucho/disco (no encima).
 *
 * Todo el dibujo es CSS en línea (clip-path, conic-gradient, repeating-*), de
 * modo que `media.css` sólo define el contenedor `.media`, la insignia `.flag`
 * y el andamiaje de la estantería (`.rail` / `.slot` / `.board`).
 * ========================================================================== */

import type { MediaStyle, PortItem, Settings, SourcePlatform } from '../services/types';
import { MEDIA_BY_PLATFORM, MEDIA_STYLES, PLATFORM_SHORT } from '../services/types';
import { esc } from './Icons';

/* -------------------------------------------------------------------------- */
/* Tabla de medios (§8 del prototipo)                                         */
/* -------------------------------------------------------------------------- */

export interface MediaDim {
  w: number;
  h: number;
  name: string;
  hint: string;
}

/** Dimensiones exactas del prototipo (`MEDIA`). */
export const MEDIA: Record<MediaStyle, MediaDim> = {
  n64: { w: 168, h: 144, name: 'Nintendo 64', hint: 'Gris, etiqueta grande' },
  snes: { w: 176, h: 118, name: 'Super Nintendo', hint: 'Dos patas y arco' },
  nes: { w: 148, h: 140, name: 'NES', hint: 'Gris con agarres' },
  md: { w: 172, h: 122, name: 'Mega Drive', hint: 'Negro con chaflanes' },
  gba: { w: 150, h: 108, name: 'Game Boy Advance', hint: 'Ancho, lavanda' },
  gb: { w: 124, h: 128, name: 'Game Boy', hint: 'Chaflán y pie estrecho' },
  nds: { w: 128, h: 148, name: 'Nintendo DS', hint: 'Compacto, de color' },
  n3ds: { w: 100, h: 106, name: 'Nintendo 3DS', hint: 'Tarjeta oscura' },
  nsw: { w: 92, h: 124, name: 'Switch', hint: 'Tarjeta vertical' },
  psp: { w: 128, h: 132, name: 'PSP (UMD)', hint: 'Disco en carcasa' },
  cd: { w: 140, h: 140, name: 'Disco genérico', hint: 'El comodín por defecto' },
  ps1: { w: 140, h: 140, name: 'PlayStation', hint: 'Disco oscuro' },
  gcn: { w: 110, h: 110, name: 'GameCube', hint: 'Mini disco' },
  xbox: { w: 140, h: 140, name: 'Xbox', hint: 'Disco verde' },
  ps2: { w: 112, h: 156, name: 'PlayStation 2', hint: 'Caja DVD azul' },
  x360: { w: 112, h: 156, name: 'Xbox 360', hint: 'Caja DVD verde' },
};

/** Estilo → plataforma de origen representativa (para las miniaturas). */
const PLAT_FOR_STYLE: Record<MediaStyle, SourcePlatform> = {
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
  cd: 'pc',
  ps1: 'ps1',
  gcn: 'gcn',
  xbox: 'xbox',
  ps2: 'ps2',
  x360: 'x360',
};

/* -------------------------------------------------------------------------- */
/* Colores por plataforma (PLAT + DSSH del prototipo)                         */
/* -------------------------------------------------------------------------- */

interface PlatColors {
  /** Neón de la plataforma (también color de la repisa). */
  neon: string;
  /** Color de la pegatina de la etiqueta (texto oscuro encima). */
  tag: string;
  /** Par de grises/colores de la carcasa cuando la silueta no fija fondo. */
  dsh: [string, string];
}

const PLAT_HEX: Record<string, PlatColors> = {
  n64: { neon: '#FF4FA3', tag: '#E5E5EC', dsh: ['#9A9AA6', '#7C7C88'] },
  snes: { neon: '#A78BFA', tag: '#C9B6FF', dsh: ['#B79CFF', '#7A55D9'] },
  nes: { neon: '#FF6B4A', tag: '#FF9B80', dsh: ['#FF6B4A', '#9A2E1A'] },
  md: { neon: '#3DE8FF', tag: '#8FF0FF', dsh: ['#44444E', '#1D1D24'] },
  gba: { neon: '#9B7BF0', tag: '#B9A0FF', dsh: ['#9B7BF0', '#4F31A6'] },
  gb: { neon: '#B6D84A', tag: '#D2EC7A', dsh: ['#B6D84A', '#6B8A1E'] },
  nds: { neon: '#7FD1D9', tag: '#8FD3DB', dsh: ['#7FB8BF', '#356C76'] },
  n3ds: { neon: '#FF5C7A', tag: '#FF93A8', dsh: ['#FF5C7A', '#9A2040'] },
  nsw: { neon: '#F0605E', tag: '#FF8584', dsh: ['#F0605E', '#9A2626'] },
  psp: { neon: '#5EC8FF', tag: '#9ADBFF', dsh: ['#5EC8FF', '#1F6A9A'] },
  ps1: { neon: '#B7B9D6', tag: '#D4D6EC', dsh: ['#B7B9D6', '#6A6C8E'] },
  ps2: { neon: '#6C8BFF', tag: '#7D95FF', dsh: ['#4F6CE0', '#1F2F85'] },
  gcn: { neon: '#8F6BFF', tag: '#B79DFF', dsh: ['#8F6BFF', '#4A2FA6'] },
  xbox: { neon: '#52E070', tag: '#8CF0A2', dsh: ['#52E070', '#1F7A34'] },
  x360: { neon: '#A9D14A', tag: '#C2E86B', dsh: ['#A9D14A', '#567A18'] },
  pc: { neon: '#FFC857', tag: '#FFD98A', dsh: ['#5A5A72', '#2A2A3A'] },
  other: { neon: '#A9A4D4', tag: '#C9C4F0', dsh: ['#8A86B0', '#4A476E'] },
};

/** Neón de la plataforma (lo usan las repisas y los puntos laterales). */
export function platNeon(platform: SourcePlatform | string): string {
  return (PLAT_HEX[platform] ?? PLAT_HEX.other).neon;
}

/* -------------------------------------------------------------------------- */
/* Arte generativo (`art(c, p)` del prototipo)                                */
/* -------------------------------------------------------------------------- */

function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Mezcla un color hex con negro (`factor` 0 = negro, 1 = color original). */
export function darken(hex: string, factor: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return hex;
  const r = clamp255(((num >> 16) & 0xff) * factor);
  const g = clamp255(((num >> 8) & 0xff) * factor);
  const b = clamp255((num & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Paleta `[oscuro, medio, luz]` determinista para un port. */
export function paletteFor(subject: ArtSubject): [string, string, string] {
  const colors = PLAT_HEX[subject.sourcePlatform] ?? PLAT_HEX.other;
  const seed = hash32(`${subject.pid}|${subject.name}`);
  const dark = darken(colors.neon, 0.3 + ((seed >>> 5) % 9) / 100);
  const mid = (seed & 1) === 0 ? colors.neon : colors.dsh[0];
  return [dark, mid, colors.tag];
}

export type ArtPattern = 'sun' | 'grid' | 'diag' | 'dots';

const PATTERNS: readonly ArtPattern[] = ['sun', 'grid', 'diag', 'dots'];

/** Patrón de carátula determinista para un port. */
export function patternFor(subject: ArtSubject): ArtPattern {
  return PATTERNS[hash32(`${subject.name}#${subject.pid}`) % PATTERNS.length];
}

/**
 * Fondo CSS de carátula: la función `art(c, p)` del prototipo, con las cuatro
 * familias de patrón (`sun`, `grid`, `diag`, `dots`).
 */
export function artCss(subject: ArtSubject): string {
  const [a, b, d] = paletteFor(subject);
  switch (patternFor(subject)) {
    case 'sun':
      return (
        `radial-gradient(circle at 50% 40%,${d} 0 19%,transparent 20%),` +
        'repeating-linear-gradient(0deg,rgba(0,0,0,0) 0 8px,rgba(0,0,0,.26) 8px 10px),' +
        `linear-gradient(180deg,${a},${b})`
      );
    case 'grid':
      return (
        `repeating-linear-gradient(90deg,${d}33 0 1px,transparent 1px 16px),` +
        `repeating-linear-gradient(0deg,${d}33 0 1px,transparent 1px 16px),` +
        `linear-gradient(200deg,${a},${b})`
      );
    case 'diag':
      return (
        'repeating-linear-gradient(135deg,rgba(255,255,255,.1) 0 4px,transparent 4px 12px),' +
        `linear-gradient(160deg,${a},${b} 68%,${d})`
      );
    case 'dots':
    default:
      return (
        `radial-gradient(${d}77 1.2px,transparent 1.3px) 0 0/10px 10px,` +
        `linear-gradient(150deg,${b},${a})`
      );
  }
}

/** Texto de carátula (`cv` en el prototipo): nombre partido en dos líneas. */
export function coverTitle(name: string): string {
  const clean = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!clean) return '?';
  const words = clean.split(' ');
  if (words.length === 1) {
    const word = words[0];
    if (word.length <= 12) return word;
    const mid = Math.ceil(word.length / 2);
    return `${word.slice(0, mid)}\n${word.slice(mid)}`;
  }
  const mid = Math.ceil(words.length / 2);
  return `${words.slice(0, mid).join(' ')}\n${words.slice(mid).join(' ')}`;
}

/* -------------------------------------------------------------------------- */
/* Sujeto mínimo que necesita el dibujo                                       */
/* -------------------------------------------------------------------------- */

/** Campos de una ficha que usa el dibujo del soporte. */
export interface ArtSubject {
  pid: string;
  name: string;
  sourcePlatform: SourcePlatform;
  coverUrl?: string | null;
}

/**
 * URL lista para `url("…")` dentro de un atributo `style="…"`.
 *
 * Codifica lo que cerraría la cadena CSS (`"`, `'`, `(`, `)`) o rompería el
 * atributo (barra invertida, saltos de línea) y neutraliza los espacios; el
 * `&` se escapa para el parser HTML (se decodifica de vuelta a `&`).
 */
export function cssUrl(url: string): string {
  const clean = String(url ?? '').trim();
  if (!clean) return '';
  return clean
    .replace(/["'()\\]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/[\r\n\t]/g, '')
    .replace(/ /g, '%20')
    .replace(/&/g, '&amp;');
}

/**
 * Fondo de la etiqueta: la carátula real si existe (encima, `center/cover`) y
 * el arte generativo debajo como respaldo, de modo que una portada que no
 * carga nunca deja el hueco vacío.
 *
 * La etiqueta que lo consume (`CART[style].lab`) ya lleva
 * `border-radius:${c.rad}` + `overflow:hidden`, así que la carátula queda
 * recortada **exactamente** al marco del cartucho.
 */
function labelBackground(subject: ArtSubject): string {
  const art = artCss(subject);
  const url = typeof subject.coverUrl === 'string' ? subject.coverUrl.trim() : '';
  if (!url) return art;
  return `url("${cssUrl(url)}") center/cover no-repeat,${art}`;
}

/* -------------------------------------------------------------------------- */
/* Siluetas de cartucho (`CART` del prototipo)                                */
/* -------------------------------------------------------------------------- */

interface CartDef {
  /** `clip-path: path()` en píxeles de la caja w×h. */
  p: string;
  /** Fondo de la carcasa; `null` = derivado de `DSSH` (por plataforma). */
  bg: string | null;
  /** `style` de la etiqueta (posición y tamaño). */
  lab: string;
  rad: string;
  bd: string;
  /** Tamaño del título en px. */
  fs: number;
  /** Título y pegatina en la misma fila (SNES). */
  row?: boolean;
  /** Cabecera con relieve (N64). */
  hdr?: boolean;
  /** Estrías horizontales del asa (NES). */
  grip?: boolean;
  /** Estrías verticales superiores (Mega Drive). */
  ribs?: boolean;
  /** Ranura inferior (Game Boy). */
  gb?: boolean;
  /** Pestaña inferior (3DS / Switch). */
  thumb?: boolean;
  /** Ventana UMD iridiscente (PSP). */
  umd?: boolean;
}

const CART: Partial<Record<MediaStyle, CartDef>> = {
  n64: {
    p: 'M12 0H156Q168 0 168 12V110L158 120V134Q158 144 148 144H20Q10 144 10 134V120L0 110V12Q0 0 12 0Z',
    bg: 'linear-gradient(180deg,#A4A4AF,#7B7B87 58%,#5C5C67)',
    lab: 'left:17px;right:17px;top:15px;bottom:40px',
    rad: '6px',
    bd: '3px solid rgba(0,0,0,.4)',
    fs: 18,
    hdr: true,
  },
  snes: {
    p: 'M10 0H166Q176 0 176 10V108Q176 118 166 118H150Q144 118 144 112V104H32V112Q32 118 26 118H10Q0 118 0 108V10Q0 0 10 0Z',
    bg: 'linear-gradient(180deg,#D8D6CE,#B2B0A8 60%,#8E8C85)',
    lab: 'left:14px;right:14px;top:11px;bottom:34px',
    rad: '14px 14px 4px 4px',
    bd: '2px solid rgba(0,0,0,.4)',
    fs: 17,
    row: true,
  },
  nes: {
    p: 'M8 0H140Q148 0 148 8V104H138V132Q138 140 130 140H18Q10 140 10 132V104H0V8Q0 0 8 0Z',
    bg: 'linear-gradient(180deg,#B9B7B2,#92908B 60%,#6F6D69)',
    lab: 'left:14px;right:14px;top:14px;bottom:50px',
    rad: '3px',
    bd: '2px solid rgba(0,0,0,.45)',
    fs: 16,
    grip: true,
  },
  md: {
    p: 'M22 0H150L172 22V96H164V110Q164 122 152 122H20Q8 122 8 110V96H0V22Z',
    bg: 'linear-gradient(180deg,#3A3A44,#22222A 55%,#121217)',
    lab: 'left:16px;right:16px;top:28px;bottom:26px',
    rad: '12px 12px 3px 3px',
    bd: '2px solid rgba(255,255,255,.22)',
    fs: 16,
    ribs: true,
  },
  gba: {
    p: 'M20 0H138Q150 0 150 12V82H142V96Q142 108 130 108H20Q8 108 8 96V82H0V20Z',
    bg: 'linear-gradient(180deg,#B9B6CF,#8F8CA8 62%,#6B6884)',
    lab: 'left:13px;right:13px;top:14px;bottom:28px',
    rad: '3px 3px 10px 10px',
    bd: '2px solid rgba(0,0,0,.4)',
    fs: 14,
  },
  gb: {
    p: 'M0 24L24 0H116Q124 0 124 8V104H116V120Q116 128 108 128H16Q8 128 8 120V104H0Z',
    bg: 'linear-gradient(180deg,#C4C3BB,#9A9992 60%,#76756E)',
    lab: 'left:12px;right:12px;top:22px;bottom:30px',
    rad: '3px',
    bd: '2px solid rgba(0,0,0,.4)',
    fs: 13,
    gb: true,
  },
  nds: {
    p: 'M22 0H118Q128 0 128 10V126Q128 134 120 134H108V140Q108 148 100 148H28Q20 148 20 140V134H8Q0 134 0 126V22Z',
    bg: null,
    lab: 'left:11px;right:11px;top:26px;bottom:42px',
    rad: '5px',
    bd: '2px solid rgba(0,0,0,.4)',
    fs: 15,
  },
  n3ds: {
    p: 'M0 12Q0 0 12 0H70L100 26V94Q100 106 88 106H12Q0 106 0 94Z',
    bg: 'linear-gradient(180deg,#4A4A56,#2A2A33 60%,#17171D)',
    lab: 'left:8px;right:8px;top:9px;bottom:30px',
    rad: '4px',
    bd: '2px solid rgba(255,255,255,.2)',
    fs: 12,
    thumb: true,
  },
  nsw: {
    p: 'M0 12Q0 0 12 0H68L92 24V112Q92 124 80 124H12Q0 124 0 112Z',
    bg: 'linear-gradient(180deg,#6A6A76,#3B3B44 60%,#25252C)',
    lab: 'left:7px;right:7px;top:9px;bottom:36px',
    rad: '5px',
    bd: '2px solid rgba(255,255,255,.18)',
    fs: 12,
    thumb: true,
  },
  psp: {
    p: 'M0 14Q0 0 14 0H98L128 28V118Q128 132 114 132H14Q0 132 0 118Z',
    bg: 'linear-gradient(180deg,#6C6C78,#3E3E48 60%,#26262E)',
    lab: 'left:10px;right:10px;top:10px;bottom:58px',
    rad: '5px',
    bd: '2px solid rgba(255,255,255,.2)',
    fs: 13,
    umd: true,
  },
};

/** Ventana UMD iridiscente. */
const IRIDESCENT =
  'conic-gradient(from 30deg,#EDEDF7,#B7C3FF,#F6C2FF,#C2FFF0,#FFF3C2,#EDEDF7)';

interface DiscDef {
  rim: string;
  ins: number;
  hole: number;
}

const DISC: Partial<Record<MediaStyle, DiscDef>> = {
  cd: { rim: IRIDESCENT, ins: 11, hole: 30 },
  ps1: {
    rim: 'conic-gradient(from 20deg,#3A3A44,#6A6A78,#2A2A32,#7A7A88,#3A3A44)',
    ins: 12,
    hole: 28,
  },
  gcn: {
    rim: 'conic-gradient(from 40deg,#CFC8F2,#8E84C8,#E6E0FF,#7A70B8,#CFC8F2)',
    ins: 9,
    hole: 20,
  },
  xbox: {
    rim: 'conic-gradient(from 10deg,#0E3A12,#3FA84A,#0A2A0E,#7BE08A,#0E3A12)',
    ins: 12,
    hole: 28,
  },
};

/* -------------------------------------------------------------------------- */
/* Dibujo                                                                     */
/* -------------------------------------------------------------------------- */

export interface MediaFlag {
  text: string;
  color: string;
}

export interface MediaHTMLOptions {
  /** Insignia de aviso en la esquina superior derecha. */
  flag?: MediaFlag | null;
  /** Etiqueta de plataforma (por defecto, el código corto). */
  label?: string;
  /** Zoom fino del soporte (`--mz`). */
  mz?: number;
  /** Texto de carátula (por defecto se deriva del nombre). */
  cover?: string;
  /** Clases extra del contenedor `.media`. */
  cls?: string;
  /** Atributos extra ya escapados. */
  extra?: string;
}

/** Trozo de markup envuelto en un `div` absoluto (helper `A` del prototipo). */
function abs(css: string, inner = ''): string {
  return `<div style="position:absolute;${css}">${inner}</div>`;
}

/**
 * **Port exacto de `mediaHTML(g, style, flag)`** del prototipo de Claude.
 *
 * @param subject ficha (o sujeto mínimo) con `pid`, `name`, `sourcePlatform`
 *                y opcionalmente `coverUrl`.
 * @param style   silueta a dibujar (16 estilos de §8).
 */
export function mediaHTML(
  subject: ArtSubject,
  style: MediaStyle,
  opts: MediaHTMLOptions = {}
): string {
  const m = MEDIA[style] ?? MEDIA.cd;
  const art = labelBackground(subject);
  const plat = subject.sourcePlatform ?? 'other';
  const colors = PLAT_HEX[plat] ?? PLAT_HEX.other;
  const tag = colors.tag;
  const code = (opts.label ?? PLATFORM_SHORT[plat as SourcePlatform] ?? plat).toUpperCase();
  const title = esc(opts.cover ?? coverTitle(subject.name));

  const sticker =
    `<span style="font:500 10px var(--f-mono);color:#14041A;padding:1px 6px;` +
    `border-radius:4px;background:${tag}">${esc(code)}</span>`;
  const ttl = (fs: number): string =>
    `<span style="font:700 ${fs}px/1 var(--f-display);color:#fff;` +
    `text-shadow:0 1px 8px rgba(0,0,0,.6);white-space:pre-line">${title}</span>`;
  const lines = (
    css: string,
    dir = '0deg',
    color = 'rgba(0,0,0,.3)',
    n = 6
  ): string =>
    abs(
      `${css};background:repeating-linear-gradient(${dir},${color} 0 2px,transparent 2px ${n}px);` +
        'border-radius:2px'
    );

  let h = '';

  const cart = CART[style];
  if (cart) {
    let bg = cart.bg;
    if (!bg) {
      const [c1, c2] = colors.dsh;
      bg = `linear-gradient(180deg,${c1},${c2})`;
    }

    const body = cart.row
      ? '<div style="display:flex;align-items:flex-end;justify-content:space-between;' +
        `width:100%;height:100%;padding:7px 10px;box-sizing:border-box">${ttl(cart.fs)}${sticker}</div>`
      : '<div style="display:flex;flex-direction:column;justify-content:space-between;' +
        `width:100%;height:100%;padding:${cart.hdr ? '22px 9px 6px' : '6px 9px'};box-sizing:border-box">` +
        `<span style="align-self:flex-start">${sticker}</span>${ttl(cart.fs)}</div>`;

    h += abs(`inset:0;background:${bg};clip-path:path('${cart.p}')`);
    h += abs(
      `${cart.lab};background:${art};overflow:hidden;box-sizing:border-box;` +
        `border-radius:${cart.rad};border:${cart.bd};box-shadow:0 0 0 2px rgba(255,255,255,.1)`,
      body
    );

    if (cart.hdr) {
      const left = Number.parseInt(/left:(\d+)/.exec(cart.lab)?.[1] ?? '0', 10);
      const right = Number.parseInt(/right:(\d+)/.exec(cart.lab)?.[1] ?? '0', 10);
      const top = Number.parseInt(/top:(\d+)/.exec(cart.lab)?.[1] ?? '0', 10);
      h += abs(
        `left:${left + 3}px;right:${right + 3}px;top:${top + 3}px;height:17px;` +
          'border-radius:3px 3px 0 0;background:linear-gradient(180deg,#4A4A55,#2E2E37);' +
          'display:flex;align-items:center;justify-content:center;' +
          'font:italic 800 12px var(--f-display);color:#E8E8F2;letter-spacing:.08em',
        '64'
      );
    }
    if (cart.grip) {
      h += lines('left:24px;right:24px;top:100px;height:20px', '0deg', 'rgba(0,0,0,.3)', 7);
    }
    if (cart.ribs) {
      h += lines('left:30px;width:44px;top:7px;height:15px', '90deg', 'rgba(255,255,255,.16)');
      h += lines('right:30px;width:44px;top:7px;height:15px', '90deg', 'rgba(255,255,255,.16)');
    }
    if (cart.gb) {
      h += lines('left:34px;width:36px;top:106px;height:12px', '90deg', 'rgba(0,0,0,.28)');
      h += lines('right:20px;width:36px;top:106px;height:12px', '90deg', 'rgba(0,0,0,.28)');
    }
    if (cart.thumb) {
      h += abs(
        'left:50%;margin-left:-13px;bottom:7px;width:26px;height:11px;' +
          'border-radius:0 0 13px 13px;background:rgba(0,0,0,.35)'
      );
    }
    if (cart.umd) {
      h += abs(
        `left:50%;margin-left:-26px;bottom:8px;width:52px;height:52px;border-radius:50%;` +
          `background:${IRIDESCENT};box-shadow:0 0 0 3px rgba(0,0,0,.45)`
      );
      h += abs(
        'left:50%;margin-left:-8px;bottom:26px;width:16px;height:16px;border-radius:50%;' +
          'background:#17171D;border:3px solid rgba(255,255,255,.65)'
      );
    }
  } else if (style === 'ps2' || style === 'x360') {
    const col = style === 'ps2' ? '#2C45C8' : '#6CB31B';
    const dk = style === 'ps2' ? '#16248A' : '#3F7A0C';
    h += abs(`inset:0;border-radius:8px;background:${art};box-shadow:inset 0 0 0 2px rgba(0,0,0,.45)`);
    h += abs(
      `left:0;top:0;bottom:0;width:15px;border-radius:8px 0 0 8px;` +
        `background:linear-gradient(90deg,${dk},${col})`
    );
    h += abs(
      `left:15px;right:0;top:0;height:22px;border-radius:0 8px 0 0;background:${col};` +
        'display:flex;align-items:center;padding:0 9px;font:600 10px var(--f-mono);' +
        `color:#fff;letter-spacing:.06em`,
      esc(code)
    );
    h += abs(
      'left:15px;right:0;bottom:0;padding:8px 10px;border-radius:0 0 8px 0;' +
        'background:linear-gradient(180deg,transparent,rgba(0,0,0,.65))',
      ttl(15)
    );
    h += abs('inset:0;border-radius:8px;background:linear-gradient(115deg,rgba(255,255,255,.22),transparent 38%)');
  } else {
    const disc = DISC[style] ?? DISC.cd!;
    const fs = m.w < 120 ? 12 : 15;
    h += abs(`inset:0;border-radius:50%;background:${disc.rim}`);
    h += abs(
      `inset:${disc.ins}px;border-radius:50%;background:${art};` +
        'border:2px solid rgba(0,0,0,.25);overflow:hidden',
      `<span style="position:absolute;left:0;right:0;top:16%;text-align:center;` +
        `font:700 ${fs}px/1 var(--f-display);color:#fff;` +
        `text-shadow:0 1px 8px rgba(0,0,0,.65);white-space:pre-line">${title}</span>` +
        `<span style="position:absolute;left:0;right:0;bottom:13%;text-align:center;` +
        `font:500 10px var(--f-mono);color:#fff">${esc(code)}</span>`
    );
    h += abs(
      `left:50%;top:50%;width:${disc.hole}px;height:${disc.hole}px;` +
        `margin:-${disc.hole / 2}px 0 0 -${disc.hole / 2}px;border-radius:50%;` +
        `background:#0A0912;border:${disc.hole > 24 ? 5 : 4}px solid rgba(255,255,255,.7)`
    );
    h += abs(`inset:0;border-radius:50%;border:3px solid ${tag}`);
  }

  const flag = opts.flag
    ? `<span class="flag" style="background:${opts.flag.color}">${esc(opts.flag.text)}</span>`
    : '';
  const cls = `media${opts.cls ? ` ${opts.cls}` : ''}`;
  const mz = opts.mz ? `;--mz:${opts.mz}` : '';

  return (
    `<div class="${esc(cls)}" style="--w:${m.w}px;--h:${m.h}px${mz}"` +
    ` aria-hidden="true"${opts.extra ?? ''}>${h}${flag}</div>`
  );
}

/**
 * Miniatura de un estilo para los selectores de Ajustes (36 px de alto).
 * Equivale a `miniIcon(k)` del prototipo.
 */
export function miniIcon(style: MediaStyle): string {
  const m = MEDIA[style] ?? MEDIA.cd;
  const scale = 36 / Math.max(m.w, m.h);
  const w = Math.round(m.w * scale);
  const h = Math.round(m.h * scale);
  const subject: ArtSubject = {
    pid: `preview-${style}`,
    name: MEDIA[style]?.name ?? 'Port',
    sourcePlatform: PLAT_FOR_STYLE[style] ?? 'other',
  };
  return (
    `<span style="--mz:${scale.toFixed(3)};display:block;width:${w}px;height:${h}px">` +
    `${mediaHTML(subject, style)}</span>`
  );
}

/* -------------------------------------------------------------------------- */
/* Resolución del estilo efectivo                                             */
/* -------------------------------------------------------------------------- */

/** Estilo efectivo de una ficha según los ajustes (equivalente a `styleFor`). */
export function styleFor(port: ArtSubject & { sourcePlatform: SourcePlatform }, settings?: Settings | null): MediaStyle {
  const platform = port.sourcePlatform ?? 'other';
  if (settings) {
    if (settings.mediaMode === 'single') return settings.mediaDef ?? 'cd';
    const override = settings.mediaMap?.[platform];
    if (override) return override;
  }
  return MEDIA_BY_PLATFORM[platform] ?? 'cd';
}

/** Estilo de una plataforma concreta (equivalente a `styleOf`). */
export function styleOf(platform: SourcePlatform, settings?: Settings | null): MediaStyle {
  if (settings?.mediaMode === 'auto' || !settings) {
    const override = settings?.mediaMap?.[platform];
    if (override) return override;
    return MEDIA_BY_PLATFORM[platform] ?? settings?.mediaDef ?? 'cd';
  }
  return settings.mediaDef ?? MEDIA_BY_PLATFORM[platform] ?? 'cd';
}

/** Insignia de aviso sugerida por el estado local de la biblioteca. */
export function flagFor(state: string): MediaFlag | null {
  switch (state) {
    case 'NeedsRom':
      return { text: '!', color: 'var(--warn)' };
    case 'UpdateAvailable':
      return { text: '↑', color: 'var(--accent)' };
    case 'Broken':
      return { text: '✕', color: 'var(--danger)' };
    case 'Ready':
      return { text: '✓', color: 'var(--accent2)' };
    default:
      return null;
  }
}

/** Lista canónica de estilos (re-exportada para los selectores). */
export const MEDIA_ORDER: readonly MediaStyle[] = MEDIA_STYLES;

/** Sujeto mínimo a partir de un port real. */
export function subjectOf(port: PortItem): ArtSubject {
  return {
    pid: port.pid,
    name: port.name,
    sourcePlatform: port.sourcePlatform,
    coverUrl: port.coverUrl ?? null,
  };
}
