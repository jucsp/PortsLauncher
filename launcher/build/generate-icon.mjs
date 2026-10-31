#!/usr/bin/env node
/* ==========================================================================
 * PortsLauncher · build/generate-icon.mjs
 *
 * Genera `build/icon.png` (512×512, RGBA) a partir del diseño arcade neón de
 * `build/icon.svg`, SIN dependencias externas: solo `node:zlib` y `node:fs`.
 *
 *   node build/generate-icon.mjs          → build/icon.png (+ public/icon.png)
 *
 * Se ejecuta automáticamente antes de `npm run build` (hook `prebuild`), así el
 * PNG que electron-builder necesita (`build.icon` en package.json) siempre
 * existe y no se versiona a mano.
 * ========================================================================== */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* -------------------------------------------------------------------------- */
/* Paleta (la misma de icon.svg)                                              */
/* -------------------------------------------------------------------------- */

const BG_OUTER = [0x0a, 0x09, 0x12]; /* #0A0912 */
const BG_INNER = [0x17, 0x12, 0x33]; /* #171233 */
const CYAN = [0x3d, 0xe8, 0xff]; /* #3DE8FF */
const PINK = [0xff, 0x4f, 0xa3]; /* #FF4FA3 */
const PINK_TOP = [0xff, 0x8a, 0xc4]; /* #FF8AC4 */
const PINK_BOTTOM = [0xc4, 0x2a, 0x78]; /* #C42A78 */

const SIZE = 512;
const SS = 2; /* supersampling: se pinta al doble y se reduce para suavizar */
const W = SIZE * SS;

/* -------------------------------------------------------------------------- */
/* Utilidades numéricas                                                       */
/* -------------------------------------------------------------------------- */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;

/** Cobertura suave: 1 dentro del borde, 0 fuera (`e` = ancho de transición). */
function smooth(edge, e = 1) {
  return clamp(0.5 - edge / e, 0, 1);
}

/** Distancia con signo a un rectángulo redondeado (centro, semiejes, radio). */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

/** Distancia con signo a una circunferencia de radio `r`. */
function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

/** Degradado vertical aproximado entre dos colores. */
function verticalGradient(top, bottom, y) {
  const t = clamp(y / SIZE, 0, 1);
  return [mix(top[0], bottom[0], t), mix(top[1], bottom[1], t), mix(top[2], bottom[2], t)];
}

/* -------------------------------------------------------------------------- */
/* Lienzo en coma flotante (RGBA premultiplicado)                             */
/* -------------------------------------------------------------------------- */

const canvas = new Float32Array(W * W * 4);

/** Compone una capa: `fn(x, y)` devuelve `{ r, g, b, a }` o `null`. */
function paint(fn) {
  for (let row = 0; row < W; row += 1) {
    const y = (row + 0.5) / SS;
    for (let col = 0; col < W; col += 1) {
      const x = (col + 0.5) / SS;
      const src = fn(x, y);
      if (!src) continue;
      const a = clamp(src.a, 0, 1);
      if (a <= 0) continue;
      const i = (row * W + col) * 4;
      canvas[i] = src.r * a + canvas[i] * (1 - a);
      canvas[i + 1] = src.g * a + canvas[i + 1] * (1 - a);
      canvas[i + 2] = src.b * a + canvas[i + 2] * (1 - a);
      canvas[i + 3] = a + canvas[i + 3] * (1 - a);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Diseño                                                                     */
/* -------------------------------------------------------------------------- */

/* 1 · Placa base redondeada con halo interior. */
paint((x, y) => {
  const d = sdRoundRect(x, y, SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2, 112);
  if (d > 1) return null;
  const glow = clamp(1 - Math.hypot(x - SIZE / 2, y - SIZE * 0.42) / (SIZE * 0.58), 0, 1);
  const t = glow * glow;
  return {
    r: mix(BG_OUTER[0], BG_INNER[0], t),
    g: mix(BG_OUTER[1], BG_INNER[1], t),
    b: mix(BG_OUTER[2], BG_INNER[2], t),
    a: smooth(d),
  };
});

/* 2 · Scanlines tipo CRT (dentro del marco). */
paint((x, y) => {
  if (sdRoundRect(x, y, SIZE / 2, SIZE / 2, 220, 220, 88) > 0) return null;
  const line = y % 64;
  if (line > 2) return null;
  return { r: CYAN[0], g: CYAN[1], b: CYAN[2], a: 0.07 };
});

/* 3 · Marco neón cian con bloom. */
paint((x, y) => {
  const d = Math.abs(sdRoundRect(x, y, SIZE / 2, SIZE / 2, 220, 220, 88)) - 8;
  const core = smooth(d, 1.6);
  const glow = Math.exp(-Math.max(d, 0) / 10) * 0.5 * (d > 0 ? 1 : 0);
  const a = clamp(core + glow, 0, 1);
  if (a <= 0.002) return null;
  return { r: CYAN[0], g: CYAN[1], b: CYAN[2], a };
});

/* 4 · Segundo marco fino interior (da profundidad al bisel). */
paint((x, y) => {
  const d = Math.abs(sdRoundRect(x, y, SIZE / 2, SIZE / 2, 204, 204, 74)) - 1.5;
  return { r: CYAN[0], g: CYAN[1], b: CYAN[2], a: smooth(d, 1.6) * 0.28 };
});

/* 5 · Cruz direccional retro (d-pad) en cian. */
paint((x, y) => {
  const horizontal = sdRoundRect(x, y, 256, 412, 28, 8, 7);
  const vertical = sdRoundRect(x, y, 256, 412, 8, 28, 7);
  const d = Math.min(horizontal, vertical);
  return { r: CYAN[0], g: CYAN[1], b: CYAN[2], a: smooth(d, 1.6) * 0.55 };
});

/* 6 · Letra P: asta + anillo, con bloom fucsia. */
paint((x, y) => {
  const stem = sdRoundRect(x, y, 189, 257, 31, 139, 16);
  const ring = Math.abs(sdCircle(x, y, 292, 222, 72)) - 32;
  const d = Math.min(stem, ring);
  const core = smooth(d, 1.6);
  const glow = Math.exp(-Math.max(d, 0) / 12) * 0.45 * (d > 0 ? 1 : 0);
  const a = clamp(core + glow, 0, 1);
  if (a <= 0.002) return null;
  const fill = verticalGradient(PINK_TOP, PINK_BOTTOM, clamp(y, 118, 396));
  /* El núcleo va a fucsia puro; el bloom hereda el degradado. */
  const t = core;
  return {
    r: mix(fill[0], PINK[0], t),
    g: mix(fill[1], PINK[1], t),
    b: mix(fill[2], PINK[2], t),
    a,
  };
});

/* 7 · Brillo interior del asta. */
paint((x, y) => {
  const d = sdRoundRect(x, y, 174, 252, 6, 120, 6);
  return { r: 255, g: 255, b: 255, a: smooth(d, 1.6) * 0.18 };
});

/* 8 · Píxel de estado encendido. */
paint((x, y) => {
  const d = sdCircle(x, y, 386, 386, 18);
  const core = smooth(d, 1.6);
  const glow = Math.exp(-Math.max(d, 0) / 8) * 0.45 * (d > 0 ? 1 : 0);
  const a = clamp(core + glow, 0, 1);
  if (a <= 0.002) return null;
  return { r: PINK[0], g: PINK[1], b: PINK[2], a };
});

/* -------------------------------------------------------------------------- */
/* Reducción a 512×512 y codificación PNG                                     */
/* -------------------------------------------------------------------------- */

/** Promedia bloques SS×SS (espacio premultiplicado) → RGBA de 8 bits. */
function downsample() {
  const out = Buffer.alloc(SIZE * SIZE * 4);
  const area = SS * SS;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          r += canvas[i];
          g += canvas[i + 1];
          b += canvas[i + 2];
          a += canvas[i + 3];
        }
      }
      r /= area;
      g /= area;
      b /= area;
      a /= area;
      const o = (y * SIZE + x) * 4;
      out[o] = a > 0 ? Math.round(clamp(r / a, 0, 1) * 255) : 0;
      out[o + 1] = a > 0 ? Math.round(clamp(g / a, 0, 1) * 255) : 0;
      out[o + 2] = a > 0 ? Math.round(clamp(b / a, 0, 1) * 255) : 0;
      out[o + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  return out;
}

/** Tabla CRC32 (polinomio PNG estándar). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Chunk PNG: longitud + tipo + datos + CRC. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Serializa píxeles RGBA a un PNG (color type 6, bit depth 8). */
function encodePNG(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; /* bits por canal */
  ihdr[9] = 6; /* RGBA */
  ihdr[10] = 0; /* deflate */
  ihdr[11] = 0; /* filtro adaptativo */
  ihdr[12] = 0; /* sin entrelazado */

  const stride = SIZE * 4;
  const raw = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (stride + 1)] = 0; /* filtro None por scanline */
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Escritura                                                                  */
/* -------------------------------------------------------------------------- */

const png = encodePNG(downsample());

const buildDir = path.join(ROOT, 'build');
mkdirSync(buildDir, { recursive: true });
const buildIcon = path.join(buildDir, 'icon.png');
writeFileSync(buildIcon, png);
console.log(`✓ ${path.relative(ROOT, buildIcon)} (${SIZE}×${SIZE}, ${png.length} B)`);

/* Copia para el frontend (favicon / uso desde Vite). */
const publicDir = path.join(ROOT, 'public');
mkdirSync(publicDir, { recursive: true });
const publicIcon = path.join(publicDir, 'icon.png');
writeFileSync(publicIcon, png);
console.log(`✓ ${path.relative(ROOT, publicIcon)} (${SIZE}×${SIZE})`);
