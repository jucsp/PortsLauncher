/* ==========================================================================
 * PortsLauncher · ui/media.ts
 *
 * `mediaHTML()` y `miniIcon()` portados LITERALMENTE del prototipo de Claude
 * (líneas 292–324). Todo el soporte se dibuja con estilos en línea + una
 * silueta `clip-path`; la hoja solo aporta `.media`, `.media>*` y `.flag`.
 *
 * Contrato de capas:
 *   .media (--w/--h)  →  carcasa · etiqueta · detalles · ventana UMD · flag
 * ========================================================================== */

import type { MediaStyle } from '../services/types';
import { art, bodyOf, coverForStyle } from './model';
import type { Game } from './model';
import { CART, DSSH, MEDIA, PLAT } from './platforms';

/** Gradiente iridiscente compartido por los discos y la ventana UMD. */
const IRI = 'conic-gradient(from 30deg,#EDEDF7,#B7C3FF,#F6C2FF,#C2FFF0,#FFF3C2,#EDEDF7)';

/**
 * Capa de carátula real.
 *
 * Se usa como PRIMERA capa de `background` y el arte generativo queda debajo:
 * si la imagen no existe o el navegador no puede cargarla, el soporte sigue
 * mostrando su portada procedural en lugar de un hueco.
 */
function coverLayer(url: string): string {
  /* Las comillas dobles DENTRO de `style="…"` cortaban el atributo en el parser
   * HTML (el atributo terminaba en `url("`), invalidando todo el `background`.
   * Ahora la cadena CSS usa comillas simples y cualquier comilla de la URL se
   * codifica como percent-encoding, que es válido en una URL. */
  const safe = String(url)
    .replace(/[\r\n]+/g, '')
    .replace(/"/g, '%22')
    .replace(/'/g, '%27')
    .trim();
  return `url('${safe}') center / cover no-repeat`;
}

/** Velo tenue sobre la carátula: garantiza contraste del texto encima. */
const COVER_VEIL = 'linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,.5))';

/**
 * Carátula real pintada como `<img>` nativo.
 *
 * Es la vía infalible: el `background` en línea queda como respaldo, pero la
 * imagen se dibuja con un elemento propio (`object-fit:cover`) que no puede
 * romper el atributo `style` del contenedor.
 */
function coverImg(url: string | null): string {
  if (!url) return '';
  return (
    `<img src="${escText(url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;` +
    'object-fit:cover;object-position:center;pointer-events:none;border-radius:inherit;" />'
  );
}

/** Velo superpuesto a la foto para que la pegatina de plataforma mantenga contraste. */
function coverVeil(url: string | null): string {
  if (!url) return '';
  return `<div style="position:absolute;inset:0;background:${COVER_VEIL};pointer-events:none"></div>`;
}

/**
 * Rótulo centrado sobre el arte generativo.
 *
 * Cuando el port **no tiene carátula real** (`artwork === null`) el soporte pinta
 * su patrón procedural: este rótulo superpone `game.cv` (`GOLDEN\nEYE`) en
 * tipografía display retro (itálica, mayúsculas, sombra dura) con un velo
 * radial tenue detrás para garantizar contraste sobre cualquier patrón. Así cada
 * cartucho, caja o disco se reconoce de un vistazo.
 *
 * @param fontPx tamaño base del rótulo (se adapta al tamaño del soporte).
 * @param css    ajustes extra para esquivar asas, cabeceras, agujeros…
 */
function titleOverlay(game: Game, fontPx: number, css = ''): string {
  const raw = String(game.cv ?? game.t ?? '').replace(/\r/g, '').trim();
  if (!raw) return '';
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const text = (lines.length > 0 ? lines : [raw]).map((line) => escText(line)).join('<br>');
  const size = Math.max(8, Math.round(fontPx));
  return (
    '<div style="position:absolute;inset:0;z-index:3;display:flex;align-items:center;' +
    `justify-content:center;padding:6px;box-sizing:border-box;pointer-events:none;${css}">` +
    `<span style="display:block;font:italic 800 ${size}px/1.03 var(--f-display);letter-spacing:.02em;` +
    'text-transform:uppercase;color:#FFFFFF;text-align:center;' +
    'padding:1px 3px;border-radius:4px;background:radial-gradient(closest-side,rgba(0,0,0,.42),rgba(0,0,0,0));' +
    'text-shadow:0 1px 0 rgba(0,0,0,.92),0 2px 6px rgba(0,0,0,.85),0 0 18px rgba(0,0,0,.6);' +
    `">${text}</span></div>`
  );
}

/**
 * Dibuja un soporte físico.
 *
 * @param game  ficha del modelo de vista (aporta carátula, plataforma y arte).
 * @param style silueta a dibujar (una de las 16).
 * @param flag  `true` para pintar la insignia de aviso (`↑` / `!`).
 */
export function mediaHTML(game: Game, style: MediaStyle, flag: boolean | [string, string] | null): string {
  const info = MEDIA[style];
  const art_ = art(game.c, game.p);
  /* Carátula que corresponde al soporte: grid horizontal en cartuchos, grid
   * vertical en cajas y `cover` en el resto (discos, PC, otros). */
  const artwork = coverForStyle(game, style);
  /* Carátula real encima (si existe) y arte generativo siempre debajo. */
  const cover = artwork ? `${coverLayer(artwork)}, ${art_}` : art_;
  /**
   * Variante para las caras impresas (etiqueta de cartucho, disco, caja DVD):
   * con foto real se antepone un velo tenue para que la pegatina de plataforma
   * mantenga contraste, igual que el sombreado del mock sobre el arte.
   */
  const face = artwork ? `${COVER_VEIL}, ${cover}` : cover;
  /* Capas nativas (foto + velo) que se inyectan DENTRO del contenedor de la
   * etiqueta: así la carátula real se ve siempre, aunque el `background` en
   * línea falle o el navegador ignore la propiedad. */
  const coverMarkup = coverImg(artwork) + coverVeil(artwork);
  /* Sin carátula real: el soporte luce su patrón procedural y su título. */
  const generative = !artwork;
  const tagColor = (PLAT[game.pl] ?? PLAT.OTRAS).tag;
  const label = game.pl;

  const layer = (css: string, inner = ''): string =>
    `<div style="position:absolute;${css}">${inner}</div>`;

  const sticker =
    `<span style="font:500 10px var(--f-mono);color:#14041A;padding:1px 6px;border-radius:4px;` +
    `background:${tagColor};box-shadow:0 1px 6px rgba(0,0,0,.55);text-shadow:none">${label}</span>`;

  const lines = (
    css: string,
    direction = '0deg',
    color = 'rgba(0,0,0,.3)',
    step = 6
  ): string =>
    layer(
      `${css};background:repeating-linear-gradient(${direction},${color} 0 2px,transparent 2px ${step}px);` +
        'border-radius:2px'
    );

  let markup = '';

  /* ------------------------------- cartuchos ------------------------------ */
  const cart = CART[style];
  if (cart) {
    const body = cart.bg ?? bodyOf(game.pl);
    const inner = cart.row
      ? '<div style="position:relative;z-index:2;display:flex;align-items:flex-end;justify-content:flex-end;' +
        `width:100%;height:100%;padding:7px 10px;box-sizing:border-box">${sticker}</div>`
      : '<div style="position:relative;z-index:2;display:flex;flex-direction:column;justify-content:flex-start;' +
        `width:100%;height:100%;padding:${cart.hdr ? '22px 9px 6px' : '6px 9px'};box-sizing:border-box">` +
        `<span style="align-self:flex-start">${sticker}</span></div>`;
    /* Etiqueta procedural: título centrado, apartado de la pegatina. */
    const cartTitle = generative
      ? titleOverlay(game, cart.fs, cart.row ? 'padding-bottom:20px' : 'padding-top:12px')
      : '';

    markup =
      layer(`inset:0;background:${body};clip-path:path('${cart.p}')`) +
      layer(
        `${cart.lab};background:${face};overflow:hidden;box-sizing:border-box;` +
          `border-radius:${cart.rad};border:${cart.bd};box-shadow:0 0 0 2px rgba(255,255,255,.1)`,
        coverMarkup + cartTitle + inner
      );

    if (cart.hdr) {
      const left = Number((cart.lab.match(/left:(\d+)/) ?? [])[1] ?? 0) + 3;
      const right = Number((cart.lab.match(/right:(\d+)/) ?? [])[1] ?? 0) + 3;
      const top = Number((cart.lab.match(/top:(\d+)/) ?? [])[1] ?? 0) + 3;
      markup += layer(
        `left:${left}px;right:${right}px;top:${top}px;height:17px;border-radius:3px 3px 0 0;` +
          'background:linear-gradient(180deg,#4A4A55,#2E2E37);display:flex;align-items:center;' +
          'justify-content:center;font:italic 800 12px var(--f-display);color:#E8E8F2;letter-spacing:.08em',
        '64'
      );
    }
    if (cart.grip) markup += lines('left:24px;right:24px;top:100px;height:20px', '0deg', 'rgba(0,0,0,.3)', 7);
    if (cart.ribs) {
      markup +=
        lines('left:30px;width:44px;top:7px;height:15px', '90deg', 'rgba(255,255,255,.16)') +
        lines('right:30px;width:44px;top:7px;height:15px', '90deg', 'rgba(255,255,255,.16)');
    }
    if (cart.gb) {
      markup +=
        lines('left:34px;width:36px;top:106px;height:12px', '90deg', 'rgba(0,0,0,.28)') +
        lines('right:20px;width:36px;top:106px;height:12px', '90deg', 'rgba(0,0,0,.28)');
    }
    if (cart.thumb) {
      markup += layer(
        'left:50%;margin-left:-13px;bottom:7px;width:26px;height:11px;' +
          'border-radius:0 0 13px 13px;background:rgba(0,0,0,.35)'
      );
    }
    if (cart.umd) {
      markup +=
        layer(
          `left:50%;margin-left:-26px;bottom:8px;width:52px;height:52px;border-radius:50%;` +
            `background:${IRI};box-shadow:0 0 0 3px rgba(0,0,0,.45)`
        ) +
        layer(
          'left:50%;margin-left:-8px;bottom:26px;width:16px;height:16px;border-radius:50%;' +
            'background:#17171D;border:3px solid rgba(255,255,255,.65)'
        );
    }
  } else if (style === 'ps2' || style === 'x360') {
    /* --------------------------- cajas DVD ------------------------------- */
    const color = style === 'ps2' ? '#2C45C8' : '#6CB31B';
    const dark = style === 'ps2' ? '#16248A' : '#3F7A0C';
    markup =
      layer(
        `inset:0;border-radius:8px;background:${face};box-shadow:inset 0 0 0 2px rgba(0,0,0,.45);overflow:hidden`,
        coverMarkup +
          (generative
            ? titleOverlay(game, 15, 'inset:22px 0 0 15px;padding:10px 8px 8px')
            : '')
      ) +
      layer(
        `left:0;top:0;bottom:0;width:15px;border-radius:8px 0 0 8px;` +
          `background:linear-gradient(90deg,${dark},${color})`
      ) +
      layer(
        `left:15px;right:0;top:0;height:22px;border-radius:0 8px 0 0;background:${color};` +
          'display:flex;align-items:center;padding:0 9px;font:600 10px var(--f-mono);color:#fff;letter-spacing:.06em;' +
          'text-shadow:0 1px 8px rgba(0,0,0,.6)',
        label
      ) +
      layer('inset:0;border-radius:8px;background:linear-gradient(115deg,rgba(255,255,255,.22),transparent 38%)');
  } else {
    /* ----------------------------- discos -------------------------------- */
    const discs: Record<string, { rim: string; inset: number; hole: number }> = {
      cd: { rim: IRI, inset: 11, hole: 30 },
      ps1: {
        rim: 'conic-gradient(from 20deg,#3A3A44,#6A6A78,#2A2A32,#7A7A88,#3A3A44)',
        inset: 12,
        hole: 28,
      },
      gcn: {
        rim: 'conic-gradient(from 40deg,#CFC8F2,#8E84C8,#E6E0FF,#7A70B8,#CFC8F2)',
        inset: 9,
        hole: 20,
      },
      xbox: {
        rim: 'conic-gradient(from 10deg,#0E3A12,#3FA84A,#0A2A0E,#7BE08A,#0E3A12)',
        inset: 12,
        hole: 28,
      },
    };
    const disc = discs[style] ?? discs.cd;
    markup =
      layer(`inset:0;border-radius:50%;background:${disc.rim}`) +
      layer(
        `inset:${disc.inset}px;border-radius:50%;background:${face};border:2px solid rgba(0,0,0,.25);overflow:hidden`,
        coverMarkup +
          /* Título en el anillo superior del disco: el agujero central manda. */
          (generative ? titleOverlay(game, 10, 'align-items:flex-start;padding-top:9px') : '') +
          `<span style="position:absolute;left:0;right:0;bottom:13%;z-index:2;text-align:center;` +
          `font:500 10px var(--f-mono);color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.6)">${label}</span>`
      ) +
      layer(
        `left:50%;top:50%;width:${disc.hole}px;height:${disc.hole}px;` +
          `margin:-${disc.hole / 2}px 0 0 -${disc.hole / 2}px;border-radius:50%;` +
          `background:#0A0912;border:${disc.hole > 24 ? 5 : 4}px solid rgba(255,255,255,.7)`
      ) +
      layer(`inset:0;border-radius:50%;border:3px solid ${tagColor}`);
  }

  const badge = flag && Array.isArray(flag) ? flag : null;
  return (
    `<div class="media" style="--w:${info.w}px;--h:${info.h}px">${markup}` +
    (badge ? `<span class="flag" style="background:${badge[1]}">${badge[0]}</span>` : '') +
    '</div>'
  );
}

/** Vista en miniatura de un soporte (para las fichas de estilo de Ajustes). */
export function miniIcon(style: MediaStyle, sample: Game): string {
  const info = MEDIA[style];
  const scale = 36 / Math.max(info.w, info.h);
  const width = Math.round(info.w * scale);
  const height = Math.round(info.h * scale);
  return (
    `<span style="--mz:${scale.toFixed(3)};display:block;width:${width}px;height:${height}px">` +
    `${mediaHTML(sample, style, false)}</span>`
  );
}

/** Escape local para no arrastrar dependencias de iconos. */
function escText(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char];
  });
}

export { DSSH };
