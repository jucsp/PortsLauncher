/* ==========================================================================
 * PortsLauncher · ui/platforms.ts
 *
 * Constantes visuales portadas LITERALMENTE del prototipo de Claude
 * (`Documentación/PortsHub Prototipo.html`, líneas 166–291).
 *
 * No son datos de dominio: son la tabla de colores, nombres de plataforma,
 * dimensiones de soporte y siluetas `clip-path` que dibuja el frontend. Los
 * datos reales viven en `services/`.
 * ========================================================================== */

import type { InstallStrategy, MediaStyle, SourcePlatform } from '../services/types';

/* -------------------------------------------------------------------------- */
/* Plataformas de origen (claves en MAYÚSCULAS, como el prototipo)            */
/* -------------------------------------------------------------------------- */

export const PLAT_KEYS = [
  'N64',
  'SNES',
  'MD',
  'GBA',
  'NDS',
  'PS2',
  'X360',
  'NSW',
  'NES',
  'GB',
  'N3DS',
  'PSP',
  'PS1',
  'GCN',
  'WII',
  'XBOX',
  'PC',
  'OTRAS',
] as const;

export type PlatKey = (typeof PLAT_KEYS)[number];

export interface PlatInfo {
  /** Nombre largo usado en sidebar, estanterías y filtros. */
  name: string;
  /** Color del riel de neón (`.rail[style="--n:…"]`). */
  neon: string;
  /** Fondo de la pegatina de consola dentro del cartucho. */
  tag: string;
}

/** Tabla `PLAT` del prototipo (+ PC/OTRAS, ausentes en el mock). */
export const PLAT: Record<PlatKey, PlatInfo> = {
  N64: { name: 'Nintendo 64', neon: '#FF4FA3', tag: '#E5E5EC' },
  SNES: { name: 'Super Nintendo', neon: '#A78BFA', tag: '#C9B6FF' },
  MD: { name: 'Mega Drive', neon: '#3DE8FF', tag: '#8FF0FF' },
  GBA: { name: 'Game Boy Advance', neon: '#9B7BF0', tag: '#B9A0FF' },
  NDS: { name: 'Nintendo DS', neon: '#7FD1D9', tag: '#8FD3DB' },
  PS2: { name: 'PlayStation 2', neon: '#6C8BFF', tag: '#7D95FF' },
  X360: { name: 'Xbox 360', neon: '#A9D14A', tag: '#C2E86B' },
  NSW: { name: 'Switch', neon: '#F0605E', tag: '#FF8584' },
  NES: { name: 'NES', neon: '#FF6B4A', tag: '#FF9B80' },
  GB: { name: 'Game Boy', neon: '#B6D84A', tag: '#D2EC7A' },
  N3DS: { name: 'Nintendo 3DS', neon: '#FF5C7A', tag: '#FF93A8' },
  PSP: { name: 'PSP', neon: '#5EC8FF', tag: '#9ADBFF' },
  PS1: { name: 'PlayStation', neon: '#B7B9D6', tag: '#D4D6EC' },
  GCN: { name: 'GameCube', neon: '#8F6BFF', tag: '#B79DFF' },
  WII: { name: 'Nintendo Wii', neon: '#00A0E9', tag: '#EAF8FF' },
  XBOX: { name: 'Xbox', neon: '#52E070', tag: '#8CF0A2' },
  PC: { name: 'PC', neon: '#FFC857', tag: '#FFE6A8' },
  OTRAS: { name: 'Otras', neon: '#A9A4D4', tag: '#C9C4E8' },
};

/** `sourcePlatform` del índice → clave visual. */
export const FROM_PLATFORM: Record<SourcePlatform, PlatKey> = {
  n64: 'N64',
  snes: 'SNES',
  nes: 'NES',
  md: 'MD',
  gba: 'GBA',
  gb: 'GB',
  nds: 'NDS',
  n3ds: 'N3DS',
  nsw: 'NSW',
  psp: 'PSP',
  ps1: 'PS1',
  ps2: 'PS2',
  gcn: 'GCN',
  wii: 'WII',
  xbox: 'XBOX',
  x360: 'X360',
  pc: 'PC',
  other: 'OTRAS',
};

/** Clave visual → `sourcePlatform` (para filtrar contra el servicio). */
export const TO_PLATFORM: Record<PlatKey, SourcePlatform> = {
  N64: 'n64',
  SNES: 'snes',
  MD: 'md',
  GBA: 'gba',
  NDS: 'nds',
  PS2: 'ps2',
  X360: 'x360',
  NSW: 'nsw',
  NES: 'nes',
  GB: 'gb',
  N3DS: 'n3ds',
  PSP: 'psp',
  PS1: 'ps1',
  GCN: 'gcn',
  WII: 'wii',
  XBOX: 'xbox',
  PC: 'pc',
  OTRAS: 'other',
};

/* -------------------------------------------------------------------------- */
/* Estrategias de instalación (texto de la ficha)                             */
/* -------------------------------------------------------------------------- */

/** `STRAT` del prototipo, mapeado a las estrategias reales del índice. */
export const STRAT: Record<InstallStrategy, string> = {
  'release-archive': 'Descarga directa',
  'release-appimage': 'AppImage',
  'release-installer': 'Instalador + archivos',
  'windows-via-proton': 'Windows vía Proton',
  'source-only': 'Compilar desde código',
  external: 'Enlace externo',
  recipe: 'Receta propia',
  needsChoice: 'Requiere elección',
};

/* -------------------------------------------------------------------------- */
/* Etiquetas de estado de desarrollo (`DEVT` del prototipo)                   */
/* -------------------------------------------------------------------------- */

export type DevKey = 'playable' | 'bugs' | 'wip' | 'exp' | 'abandoned' | 'nodata';

export interface DevInfo {
  t: string;
  c: string;
  g: string;
}

export const DEVT: Record<DevKey, DevInfo> = {
  playable: { t: 'Jugable', c: '#5CF08A', g: '✓' },
  bugs: { t: 'Con bugs', c: '#FF9A3D', g: '▲' },
  wip: { t: 'En desarrollo', c: '#7DB7FF', g: '◐' },
  exp: { t: 'Experimental', c: '#C58CFF', g: '◆' },
  abandoned: { t: 'Sin mantenimiento', c: '#9A96B8', g: '■' },
  nodata: { t: 'Sin datos', c: '#9A96B8', g: '○' },
};

/** Leyenda de la pantalla de Ajustes (textos del prototipo). */
export const DEV_LEGEND: Array<[DevKey, string]> = [
  ['playable', 'Versión publicada y comunidad conforme.'],
  ['bugs', 'Se juega, pero hay bugs conocidos o recomendación baja.'],
  ['wip', 'El proyecto sigue en desarrollo activo.'],
  ['exp', 'El proyecto se declara experimental.'],
  ['abandoned', 'Sin cambios hace más de 18 meses.'],
  ['nodata', 'Aún no hay datos suficientes.'],
];

/* -------------------------------------------------------------------------- */
/* Nivel de asistencia por IA (`AI` del prototipo)                            */
/* -------------------------------------------------------------------------- */

export const AI: Record<string, string> = {
  assisted: 'Asistido por IA',
  none: 'Sin IA declarada',
  unknown: 'Sin información',
};

/* -------------------------------------------------------------------------- */
/* Soportes físicos (`MEDIA` del prototipo)                                   */
/* -------------------------------------------------------------------------- */

export interface MediaInfo {
  w: number;
  h: number;
  name: string;
  hint: string;
}

export const MEDIA: Record<MediaStyle, MediaInfo> = {
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
  wii: { w: 140, h: 140, name: 'Wii (Disco)', hint: 'Disco blanco / azul' },
  xbox: { w: 140, h: 140, name: 'Xbox', hint: 'Disco verde' },
  ps2: { w: 112, h: 156, name: 'PlayStation 2', hint: 'Caja DVD azul' },
  x360: { w: 112, h: 156, name: 'Xbox 360', hint: 'Caja DVD verde' },
};

/** Medio propio de cada plataforma (`PLATMEDIA` del prototipo). */
export const PLATMEDIA: Record<PlatKey, MediaStyle | undefined> = {
  N64: 'n64',
  SNES: 'snes',
  NES: 'nes',
  MD: 'md',
  GBA: 'gba',
  GB: 'gb',
  NDS: 'nds',
  N3DS: 'n3ds',
  NSW: 'nsw',
  PSP: 'psp',
  PS1: 'ps1',
  GCN: 'gcn',
  WII: 'wii',
  XBOX: 'xbox',
  PS2: 'ps2',
  X360: 'x360',
  PC: undefined,
  OTRAS: undefined,
};

/** Cuerpo de los cartuchos sin `bg` propio (`DSSH` del prototipo). */
export const DSSH: Partial<Record<PlatKey, string>> = {
  N64: '#9A9AA6,#7C7C88',
  SNES: '#B79CFF,#7A55D9',
  MD: '#44444E,#1D1D24',
  GBA: '#9B7BF0,#4F31A6',
  NDS: '#7FB8BF,#356C76',
  PS2: '#4F6CE0,#1F2F85',
  X360: '#A9D14A,#567A18',
  NSW: '#F0605E,#9A2626',
  NES: '#FF6B4A,#9A2E1A',
  GB: '#B6D84A,#6B8A1E',
  N3DS: '#FF5C7A,#9A2040',
  PSP: '#5EC8FF,#1F6A9A',
  PS1: '#B7B9D6,#6A6C8E',
  GCN: '#8F6BFF,#4A2FA6',
  WII: '#EAF8FF,#00A0E9',
  XBOX: '#52E070,#1F7A34',
  PC: '#FFC857,#8A6A18',
  OTRAS: '#8A86B0,#4A476E',
};

/* -------------------------------------------------------------------------- */
/* Siluetas de cartucho (`CART` del prototipo)                                */
/* -------------------------------------------------------------------------- */

export interface CartInfo {
  /** `clip-path: path()` en píxeles de la caja `MEDIA[style]`. */
  p: string;
  /** Fondo de la carcasa (si falta, se deriva de `DSSH`). */
  bg: string | null;
  /** Caja de la etiqueta dentro de la carcasa. */
  lab: string;
  rad: string;
  bd: string;
  fs: number;
  /** Cabecera hundida con el número "64". */
  hdr?: 1;
  /** Distribución horizontal (título + pegatina en la base). */
  row?: 1;
  /** Estrías del agarre inferior. */
  grip?: 1;
  /** Nervios laterales superiores. */
  ribs?: 1;
  /** Ranura inferior del Game Boy. */
  gb?: 1;
  /** Pestaña inferior central (NDS/3DS/Switch). */
  thumb?: 1;
  /** Ventana del UMD (PSP). */
  umd?: 1;
}

export const CART: Partial<Record<MediaStyle, CartInfo>> = {
  n64: {
    p: 'M12 0H156Q168 0 168 12V110L158 120V134Q158 144 148 144H20Q10 144 10 134V120L0 110V12Q0 0 12 0Z',
    bg: 'linear-gradient(180deg,#A4A4AF,#7B7B87 58%,#5C5C67)',
    lab: 'left:17px;right:17px;top:15px;bottom:40px',
    rad: '6px',
    bd: '3px solid rgba(0,0,0,.4)',
    fs: 18,
    hdr: 1,
  },
  snes: {
    p: 'M10 0H166Q176 0 176 10V108Q176 118 166 118H150Q144 118 144 112V104H32V112Q32 118 26 118H10Q0 118 0 108V10Q0 0 10 0Z',
    bg: 'linear-gradient(180deg,#D8D6CE,#B2B0A8 60%,#8E8C85)',
    lab: 'left:14px;right:14px;top:11px;bottom:34px',
    rad: '14px 14px 4px 4px',
    bd: '2px solid rgba(0,0,0,.4)',
    fs: 17,
    row: 1,
  },
  nes: {
    p: 'M8 0H140Q148 0 148 8V104H138V132Q138 140 130 140H18Q10 140 10 132V104H0V8Q0 0 8 0Z',
    bg: 'linear-gradient(180deg,#B9B7B2,#92908B 60%,#6F6D69)',
    lab: 'left:14px;right:14px;top:14px;bottom:50px',
    rad: '3px',
    bd: '2px solid rgba(0,0,0,.45)',
    fs: 16,
    grip: 1,
  },
  md: {
    p: 'M22 0H150L172 22V96H164V110Q164 122 152 122H20Q8 122 8 110V96H0V22Z',
    bg: 'linear-gradient(180deg,#3A3A44,#22222A 55%,#121217)',
    lab: 'left:16px;right:16px;top:28px;bottom:26px',
    rad: '12px 12px 3px 3px',
    bd: '2px solid rgba(255,255,255,.22)',
    fs: 16,
    ribs: 1,
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
    gb: 1,
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
    thumb: 1,
  },
  nsw: {
    p: 'M0 12Q0 0 12 0H68L92 24V112Q92 124 80 124H12Q0 124 0 112Z',
    bg: 'linear-gradient(180deg,#6A6A76,#3B3B44 60%,#25252C)',
    lab: 'left:7px;right:7px;top:9px;bottom:36px',
    rad: '5px',
    bd: '2px solid rgba(255,255,255,.18)',
    fs: 12,
    thumb: 1,
  },
  psp: {
    p: 'M0 14Q0 0 14 0H98L128 28V118Q128 132 114 132H14Q0 132 0 118Z',
    bg: 'linear-gradient(180deg,#6C6C78,#3E3E48 60%,#26262E)',
    lab: 'left:10px;right:10px;top:10px;bottom:58px',
    rad: '5px',
    bd: '2px solid rgba(255,255,255,.2)',
    fs: 13,
    umd: 1,
  },
};
