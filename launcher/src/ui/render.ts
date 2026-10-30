/* ==========================================================================
 * PortsLauncher · ui/render.ts
 *
 * Pintores del prototipo de Claude (`Documentación/PortsHub Prototipo.html`,
 * líneas 346–499). Cada función devuelve el MISMO HTML que el mock, con los
 * datos reales del índice en lugar de los de ejemplo.
 *
 *   renderSide / renderBottomNav      → #side y .bnav
 *   browseHTML + resultsHTML          → Biblioteca y Catálogo
 *   renderHome / renderUpdates        → Inicio y Actualizaciones
 *   renderGame                        → ficha (Resumen · Versiones · Fuentes)
 *   renderSettings                    → Ajustes
 * ========================================================================== */

import type {
  Addon,
  CustomArtwork,
  LogoAnchor,
  MediaStyle,
  PortItem,
  Settings,
} from '../services/types';
import {
  ADDONS_DIR,
  COVER_OFFSET_MAX,
  COVER_OFFSET_MIN,
  COVER_SCALE_DEFAULT,
  COVER_SCALE_MAX,
  COVER_SCALE_MIN,
  HERO_SCALE_DEFAULT,
  HERO_SCALE_MAX,
  HERO_SCALE_MIN,
  LOGO_ANCHORS,
  LOGO_ANCHOR_DEFAULT,
  LOGO_ANCHOR_GLYPHS,
  LOGO_ANCHOR_LABELS,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
} from '../services/types';
import {
  esc,
  devChip as chipOf,
  clampCoverOffset,
  clampCoverScale,
  clampHeroScale,
  clampLogoScale,
  flagOf,
  PROG,
  statusOf,
  styleFor,
  styleOf,
  artOf,
  mediaWidth,
} from './model';
import type { Game } from './model';
import { IC, addonsGlyph, bookGlyph, paletteGlyph, sv } from './icons';
import { mediaHTML, miniIcon } from './media';
import { AI, DEVT, DEV_LEGEND, MEDIA, PLAT, PLAT_KEYS, PLATMEDIA, STRAT } from './platforms';
import type { PlatKey } from './platforms';
import { TO_PLATFORM } from './platforms';
import { B, D, NAVMEM, R, S, updateCount } from './state';
import type { Route, SortKey } from './state';

/* -------------------------------------------------------------------------- */
/* Navegación                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Menú lateral (`#side`) y menú inferior móvil (`.bnav`).
 *
 * Addons dejó de ser una sección propia: ahora es una pestaña de Ajustes. El
 * hash histórico `#addons` sigue funcionando porque el router (`main.ts`) lo
 * resuelve como «Ajustes → pestaña de Addons y Plugins».
 */
export const NAV: Array<[Route, string, string]> = [
  ['home', 'Inicio', IC.home],
  ['library', 'Biblioteca', IC.lib],
  ['catalog', 'Catálogo', IC.cat],
  ['updates', 'Actualizaciones', IC.upd],
  ['settings', 'Ajustes', IC.set],
];

/** Ruta → hash (`RT` del prototipo). */
export const RT: Record<string, string> = {
  home: 'inicio',
  library: 'biblioteca',
  catalog: 'catalogo',
  updates: 'actualizaciones',
  addons: 'addons',
  settings: 'ajustes',
};

/** Hashes que entiende el router. */
export const RT_INV: Record<string, Route> = {
  inicio: 'home',
  biblioteca: 'library',
  catalogo: 'catalog',
  actualizaciones: 'updates',
  addons: 'addons',
  ajustes: 'settings',
};

const currentNav = (): Route => (R.name === 'game' ? 'library' : R.name);

/* -------------------------------------------------------------------------- */
/* Montaje en `#main`                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Pinta HTML en `<main id="main">` y lo devuelve.
 *
 * El prototipo asigna el markup directamente al contenedor principal en cada
 * repintado; `main.ts` llama a los pintores por su efecto (no consume el
 * retorno), así que el montaje vive aquí y el valor devuelto se puede seguir
 * reutilizando (pruebas, composición de markup).
 */
function paintMain(html: string): string {
  const host = document.getElementById('main');
  if (host) host.innerHTML = html;
  return html;
}

/** Normaliza la ruta activa a los dos listados que comparten plantilla. */
function browseScope(kind: Route): 'library' | 'catalog' {
  return kind === 'catalog' ? 'catalog' : 'library';
}

/** Barra lateral (`renderSide`, línea 347). */
export function renderSide(): string {
  const cur = currentNav();
  const updates = updateCount();
  const platforms = PLAT_KEYS.map((key) => {
    const total = S.games.filter(
      (game) => game.pl === key && (R.name === 'catalog' || game.inst)
    ).length;
    return (
      `<button data-act="plat" data-k="${key}" aria-pressed="${B.plat === key}" title="${PLAT[key].name}">` +
      `<span class="dot" style="background:${PLAT[key].neon}"></span>` +
      `<span class="t">${PLAT[key].name}</span>` +
      `<span class="n muted">${total}</span></button>`
    );
  }).join('');

  const links = NAV.map((item) => {
    const [route, label, glyph] = item;
    return (
      `<a href="#${RT[route]}" data-act="nav" data-to="${route}" aria-label="${label}" ` +
      `${cur === route ? 'aria-current="page"' : ''}>${glyph}<span class="t">${label}</span>` +
      `${route === 'updates' && updates ? `<span class="badge">${updates}</span>` : ''}</a>`
    );
  }).join('');

  return (
    `<div class="brand"><i>${sv('<path d="M6 3h12l2 3v15H4V6z"/><path d="M8 3v4h8V3"/>', 22)}</i><span>PORTSHUB</span></div>` +
    `<div class="nav">${links}</div>` +
    '<div class="lbl">PLATAFORMA ORIGINAL</div>' +
    `<div class="plat"><button data-act="plat" data-k="all" aria-pressed="${B.plat === 'all'}">` +
    `<span class="dot" style="background:var(--muted)"></span><span class="t">Todas</span></button>${platforms}</div>` +
    `<div class="srcbox"><b style="color:var(--text)">Índice PortsHub</b><br>Propio · ${esc(indexAge())}</div>`
  );
}

/** Menú inferior móvil (`#bnav`, línea 356). */
export function renderBottomNav(): string {
  const cur = currentNav();
  return NAV.map(
    ([route, label, glyph]) =>
      `<a href="#${RT[route]}" data-act="nav" data-to="${route}" ${cur === route ? 'aria-current="page"' : ''}>` +
      `${glyph}<br>${label.replace('Actualizaciones', 'Updates')}</a>`
  ).join('');
}

/** «actualizado hace 3 h» del prototipo, con la fecha real del índice. */
function indexAge(): string {
  const generated = S.generatedAt ? Date.parse(S.generatedAt) : NaN;
  if (!Number.isFinite(generated)) return 'actualizado hace 3 h';
  const minutes = Math.max(0, Math.round((Date.now() - generated) / 60000));
  if (minutes < 60) return `actualizado hace ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `actualizado hace ${hours} h`;
  return `actualizado hace ${Math.round(hours / 24)} días`;
}

/* -------------------------------------------------------------------------- */
/* Listado y filtrado (`filtered`, línea 359)                                 */
/* -------------------------------------------------------------------------- */

const ORD: Record<string, number> = {
  rom: 0,
  upd: 1,
  ready: 2,
  inst: 3,
  new: 4,
  build: 5,
  ext: 6,
};

/** Texto sobre el que busca el campo `#q` (título, proyecto, plataforma, alias). */
function searchBlobOf(game: Game): string {
  const port = game.port ?? ({} as PortItem);
  const extras = [
    ...(Array.isArray(port.tags) ? port.tags : []),
    ...(Array.isArray(port.gameNames) ? port.gameNames : []),
    ...(Array.isArray(port.searchAliases) ? port.searchAliases : []),
  ].filter((value): value is string => typeof value === 'string');

  return `${game.t} ${game.pr} ${PLAT[game.pl].name} ${game.pl} ${game.id} ${extras.join(' ')}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Listado del ámbito activo.
 *
 * El CATÁLOGO enseña todos los ports del índice que pasen la búsqueda, la
 * plataforma y el estado de desarrollo: incluidos los de estrategia
 * `external`, que hoy son la totalidad del índice real. Excluirlos dejaba la
 * pantalla en «Sin resultados» (el catálogo se veía completamente vacío).
 *
 * La BIBLIOTECA es el único ámbito restringido: solo lo instalado.
 */
export function supportsDest(game: Game, dest: 'all' | 'Linux' | 'Windows'): boolean {
  if (dest === 'all') return true;
  const norm = dest.toLowerCase();
  if (game.targets.some((t) => t.toLowerCase() === norm)) return true;
  if ((game.port.targetPlatforms ?? []).some((t) => String(t).toLowerCase() === norm)) return true;
  const raw = game.port.raw as Record<string, unknown> | undefined;
  if (norm === 'linux') {
    if (raw?.linuxCompatible || raw?.linuxUrl || raw?.linuxAsset) return true;
    if (game.port.assetHints?.linux) return true;
  } else if (norm === 'windows') {
    if (raw?.windowsAsset) return true;
    if (game.port.assetHints?.windows) return true;
  }
  return false;
}

export function filtered(kind: 'library' | 'catalog'): Game[] {
  const query = B.q.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const list = S.games.filter((game) => {
    if (kind === 'library' && !game.inst) return false;
    if (B.plat !== 'all' && game.pl !== B.plat) return false;
    if (B.dev !== 'all' && game.dev.k !== B.dev) return false;
    const activeDest = B.dest ?? 'all';
    if (activeDest !== 'all' && !supportsDest(game, activeDest)) return false;
    if (query && !searchBlobOf(game).includes(query)) return false;

    switch (B.filter) {
      /* Catálogo: presencia en la biblioteca local. */
      case 'new':
        return !game.inst;
      case 'inst':
        return game.inst;
      /* Biblioteca: estado de la instalación. */
      case 'ready':
        return statusOf(game).k === 'ready';
      case 'rom':
        return statusOf(game).k === 'rom';
      case 'upd':
        return statusOf(game).k === 'upd';
      default:
        return true;
    }
  });

  const comparators: Record<SortKey, (a: Game, b: Game) => number> = {
    name: (a, b) => a.t.localeCompare(b.t),
    status: (a, b) => ORD[statusOf(a).k] - ORD[statusOf(b).k],
    plat: (a, b) => a.pl.localeCompare(b.pl) || a.t.localeCompare(b.t),
    ver: (a, b) => String(a.v || a.lv).localeCompare(String(b.v || b.lv)),
    recent: (a, b) => b.played - a.played,
  };
  const compare = comparators[B.sort] ?? (() => 0);
  return list.sort((a, b) => compare(a, b) * B.dir);
}

/* -------------------------------------------------------------------------- */
/* Botones de ficha (`actBtn` y `gearBtn`, líneas 371–375)                    */
/* -------------------------------------------------------------------------- */

export function actBtn(game: Game, cls = ''): string {
  const status = statusOf(game);
  if (status.k === 'inst') {
    return (
      '<div style="flex:1;min-width:90px"><div class="prog">' +
      `<i data-prog="${game.id}" style="width:${PROG[game.id] ?? 0}%"></i></div>` +
      `<div class="muted" style="font-size:11px;margin-top:3px" data-stage="${game.id}"></div></div>`
    );
  }
  const primary = status.k === 'ready' || status.k === 'new' || status.k === 'upd';
  const kind = primary ? 'pri' : status.k === 'rom' ? 'warn' : '';
  return (
    `<button class="btn sm ${kind} ${cls}" data-act="primary" data-id="${game.id}">` +
    `${status.k === 'ready' ? IC.play + ' ' : ''}${status.cta}</button>`
  );
}

export function gearBtn(game: Game, cls = 'gear'): string {
  return game.inst
    ? `<button class="${cls}" data-act="gear" data-id="${game.id}" aria-label="Configurar ${esc(game.t)}">${IC.gear}</button>`
    : '';
}

const devChip = (game: Game, size?: string): string => chipOf(game, size);

/**
 * Fondo de una caja (tarjeta, miniatura, héroe, cabecera de ficha).
 *
 * La carátula real va como PRIMERA capa y el arte generativo del mock debajo:
 * si la imagen falta o falla, el hueco lo cubre la portada procedural, nunca
 * un fondo liso.
 *
 * @param game  ficha del modelo de vista.
 * @param cover carátula a usar; por defecto `game.cover`. Permite pintar el
 *              banner panorámico (`game.hero`) en las cabeceras.
 */
export function bgOf(game: Game, cover: string | null = game.cover): string {
  const procedural = artOf(game);
  if (!cover) return procedural;
  const url = esc(cover).replace(/[\r\n]+/g, '');
  return `url('${url}') center / cover no-repeat, ${procedural}`;
}

/* -------------------------------------------------------------------------- */
/* Tarjetas (`posterCard`, `bigCard`, `listRow`, `tableView`)                 */
/* -------------------------------------------------------------------------- */

export function posterCard(game: Game): string {
  const status = statusOf(game);
  /* Con carátula real manda la imagen; sin ella, el arte lleva el título. */
  const title = game.cover ? '' : `<span class="t">${esc(game.cv)}</span>`;
  return (
    `<article class="card" data-act="open" data-id="${game.id}" tabindex="0" role="link" aria-label="${esc(game.t)}">` +
    `<div class="poster" style="background:${bgOf(game)}">` +
    `<span class="tag">${game.pl}</span>` +
    `<span class="devp">${devChip(game)}</span>` +
    `${title}</div>` +
    `${gearBtn(game)}` +
    '<div class="meta">' +
    `<b>${esc(game.t)}</b>` +
    `<span class="muted" style="font-size:12px">${esc(game.pr)} · ${esc(game.v || game.lv)}</span>` +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:space-between">' +
    `<span class="pill" style="--c:${status.color}">${status.label}</span>${actBtn(game)}</div>` +
    '</div></article>'
  );
}

export function bigCard(game: Game): string {
  const status = statusOf(game);
  return (
    `<article class="big" style="background:${bgOf(game)}" data-act="open" data-id="${game.id}" tabindex="0" role="link" aria-label="${esc(game.t)}">` +
    `<span class="tag">${game.pl}</span><span class="devp">${devChip(game)}</span>` +
    '<div class="in"><div style="flex:1;min-width:0">' +
    `<div style="font:700 22px/1.1 var(--f-display)">${esc(game.t)}</div>` +
    `<div class="muted" style="margin:4px 0 8px">${esc(game.pr)} · ${esc(game.v || game.lv)}</div>` +
    `<span class="pill" style="--c:${status.color}">${status.label}</span></div>` +
    `${game.inst ? gearBtn(game, 'btn sm ico') : ''}${actBtn(game)}</div></article>`
  );
}

export function listRow(game: Game): string {
  const status = statusOf(game);
  return (
    `<div class="row" data-act="open" data-id="${game.id}" tabindex="0" role="link" aria-label="${esc(game.t)}">` +
    `<div class="thumb" style="background:${bgOf(game)}"></div>` +
    '<div style="flex:1 1 220px;min-width:0">' +
    `<b style="font-size:15px">${esc(game.t)}</b>` +
    `<div class="muted">${esc(game.pr)} · ${PLAT[game.pl].name} → ${esc(S.settings.dest)}</div></div>` +
    `<div class="mono muted" style="flex:0 0 160px;font-size:12px">${esc(game.st)}</div>` +
    `${devChip(game)}<span class="pill" style="--c:${status.color}">${status.label}</span>` +
    `${gearBtn(game, 'btn sm ico')}${actBtn(game)}</div>`
  );
}

export function tableView(list: Game[]): string {
  const th = (key: SortKey, label: string): string =>
    `<th data-act="sort" data-k="${key}">${label}${B.sort === key ? (B.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;

  const rows = list
    .map((game) => {
      const status = statusOf(game);
      return (
        `<tr data-act="open" data-id="${game.id}" tabindex="0">` +
        `<td><b>${esc(game.t)}</b><div class="muted" style="font-size:12px">${esc(game.pr)}</div></td>` +
        `<td class="mono" style="font-size:12px">${game.pl}</td>` +
        `<td>${esc(S.settings.dest)}</td>` +
        `<td class="mono muted" style="font-size:12px">${esc(game.st)}</td>` +
        `<td class="mono" style="font-size:12px">${esc(game.v || game.lv)}</td>` +
        `<td>${devChip(game)}</td>` +
        `<td><span class="pill" style="--c:${status.color}">${status.label}</span></td>` +
        `<td>${gearBtn(game, 'btn sm ico')}</td></tr>`
      );
    })
    .join('');

  return (
    '<div class="twrap"><table><thead><tr>' +
    `${th('name', 'NOMBRE')}${th('plat', 'PLATAFORMA ORIGEN')}` +
    '<th>DESTINO</th><th>ESTRATEGIA</th>' +
    `${th('ver', 'VERSIÓN')}` +
    '<th>DESARROLLO</th>' +
    `${th('status', 'ESTADO')}<th>⚙</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

/* -------------------------------------------------------------------------- */
/* Estanterías (`shelves`, línea 393)                                         */
/* -------------------------------------------------------------------------- */

export function shelves(list: Game[]): string {
  return PLAT_KEYS.filter((key) => list.some((game) => game.pl === key))
    .map((key) => {
      const items = list.filter((game) => game.pl === key);
      const slots = items
        .map((game) => {
          /* PC, «Otras» y cualquier plataforma sin medio propio caen en el
           * estilo por defecto (`settings.mediaDef`) o en el disco genérico. */
          const style = styleFor(game, S.settings) ?? S.settings.mediaDef ?? 'cd';
          return (
            `<div class="slot" style="--w:${mediaWidth(style)}px" data-act="open" data-id="${game.id}" tabindex="0" role="link" aria-label="${esc(game.t)}">` +
            `${mediaHTML(game, style, flagOf(game))}` +
            `<div class="cap">${esc(game.t)}</div>` +
            `<div class="foot">${devChip(game)}${gearBtn(game, 'btn sm ico')}</div></div>`
          );
        })
        .join('');
      return (
        '<section class="shelf">' +
        `<h2>${PLAT[key].name.toUpperCase()}` +
        `<span class="mono muted" style="font-size:12px;font-weight:400">${items.length} ports</span></h2>` +
        `<div class="rail" style="--n:${PLAT[key].neon}"><div class="items">${slots}</div>` +
        '<div class="board"></div></div></section>'
      );
    })
    .join('');
}

/* -------------------------------------------------------------------------- */
/* Resultados y conmutador de vistas                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resultados del listado activo.
 *
 * Acepta la ruta completa porque `main.ts` la pasa tal cual (`resultsHTML(R.name)`
 * al teclear en el buscador); sólo `library` se distingue de `catalog`.
 */
export function resultsHTML(kind: Route): string {
  const scope = browseScope(kind);
  const list = filtered(scope);
  if (list.length === 0) {
    return (
      '<div class="empty"><b style="font-size:16px;color:var(--text)">Sin resultados</b><br>' +
      (scope === 'library'
        ? 'Aún no hay ports instalados que coincidan. Prueba en el Catálogo.'
        : 'Ningún port coincide con estos filtros.') +
      '<br><button class="btn sm" style="margin-top:12px" data-act="clear">Limpiar filtros</button></div>'
    );
  }
  const view = S.settings.view;
  if (view === 'posters') return `<div class="grid">${list.map(posterCard).join('')}</div>`;
  if (view === 'big') return `<div class="bgrid">${list.map(bigCard).join('')}</div>`;
  /* `carts` es la clave canónica del prototipo: estantería de cartuchos y discos. */
  if (view === 'carts') return shelves(list);
  if (view === 'list') return `<div class="list">${list.map(listRow).join('')}</div>`;
  return tableView(list);
}

/** `VIEWS` del prototipo (`carts` = estantería de cartuchos). */
export const VIEWS: Array<[string, string, string]> = [
  ['posters', 'Carátulas', IC.posters],
  ['big', 'Grilla grande', IC.big],
  ['carts', 'Cartuchos', IC.carts],
  ['list', 'Lista', IC.list],
  ['table', 'Tabla', IC.table],
];

export function viewSwitchHTML(): string {
  return VIEWS.map(
    ([key, label, glyph]) =>
      `<button data-act="view" data-k="${key}" aria-pressed="${S.settings.view === key}" ` +
      `aria-label="${label}" title="${label}">${glyph}</button>`
  ).join('');
}

/**
 * Filtros del listado (`#chips`).
 *
 * Todos los filtros son desplegables (`<select class="sel">`) para que el grupo
 * sea uniforme y quepa en una sola fila en móvil: instalación, destino,
 * plataforma de origen, estado de desarrollo y orden.
 *
 * Se exporta también como `chipsHTML` (nombre histórico del prototipo) para no
 * romper a quien ya la importaba con ese alias.
 */
export function controlsHTML(kind: 'library' | 'catalog'): string {
  /* 1. Presencia en la biblioteca local (+ estados propios de la biblioteca). */
  const libraryStates =
    kind === 'library'
      ? `<option value="ready" ${B.filter === 'ready' ? 'selected' : ''}>Listos</option>` +
        `<option value="rom" ${B.filter === 'rom' ? 'selected' : ''}>Falta ROM</option>` +
        `<option value="upd" ${B.filter === 'upd' ? 'selected' : ''}>Actualizaciones</option>`
      : '';

  const filterSelect =
    '<select class="sel" id="filtersel" aria-label="Filtro de instalación">' +
    `<option value="all" ${B.filter === 'all' ? 'selected' : ''}>Instalación: Todos</option>` +
    `<option value="new" ${B.filter === 'new' ? 'selected' : ''}>Sin instalar</option>` +
    `<option value="inst" ${B.filter === 'inst' ? 'selected' : ''}>Instalados</option>` +
    libraryStates +
    '</select>';

  /* 2. Sistema de destino de la descarga. */
  const activeDest = B.dest ?? 'all';
  const destSelect =
    '<select class="sel" id="destsel" aria-label="Sistema de destino">' +
    `<option value="all" ${activeDest === 'all' ? 'selected' : ''}>Destino: Todos</option>` +
    `<option value="Linux" ${activeDest === 'Linux' ? 'selected' : ''}>Destino: Linux</option>` +
    `<option value="Windows" ${activeDest === 'Windows' ? 'selected' : ''}>Destino: Windows</option>` +
    '</select>';

  /* 3. Plataforma de origen. */
  const platOptions = PLAT_KEYS.map(
    (key) =>
      `<option value="${key}" ${B.plat === key ? 'selected' : ''}>${esc(PLAT[key].name)}</option>`
  ).join('');
  const platSelect =
    '<select class="sel" id="platsel" aria-label="Plataforma de origen">' +
    `<option value="all" ${B.plat === 'all' ? 'selected' : ''}>Plataforma: Todas</option>` +
    platOptions +
    '</select>';

  /* 4. Estado de desarrollo. */
  const devOptions = (Object.keys(DEVT) as Array<keyof typeof DEVT>)
    .map(
      (key) =>
        `<option value="${key}" ${B.dev === key ? 'selected' : ''}>${DEVT[key].t}</option>`
    )
    .join('');
  const devSelect =
    '<select class="sel" id="devsel" aria-label="Estado de desarrollo">' +
    `<option value="all" ${B.dev === 'all' ? 'selected' : ''}>Desarrollo: Todos</option>` +
    devOptions +
    '</select>';

  /* 5. Orden. */
  const sortOptions: Array<[SortKey, string]> = [
    ['name', 'Nombre'],
    ['status', 'Estado'],
    ['plat', 'Plataforma'],
    ['recent', 'Recientes'],
  ];
  const sortSelect =
    '<select class="sel" id="sortsel" aria-label="Orden">' +
    sortOptions
      .map(
        ([key, label]) =>
          `<option value="${key}" ${B.sort === key ? 'selected' : ''}>Orden: ${label}</option>`
      )
      .join('') +
    '</select>';

  return filterSelect + destSelect + platSelect + devSelect + sortSelect;
}

/** Alias histórico de `controlsHTML` (el prototipo la llamaba `chipsHTML`). */
export const chipsHTML = controlsHTML;

/* -------------------------------------------------------------------------- */
/* Héroe «continuar jugando» (`heroHTML`, línea 404)                          */
/* -------------------------------------------------------------------------- */

export function heroHTML(): string {
  const game = S.last ? S.byId.get(S.last) : undefined;
  if (!game || !game.inst) return '';
  const status = statusOf(game);
  return (
    `<section class="hero" style="background:${bgOf(game, game.hero ?? game.cover)}"><div class="shade"></div><div class="in">` +
    '<div style="flex:1 1 280px">' +
    `<div class="mono" style="font-size:11px;letter-spacing:.14em;color:var(--accent2)">CONTINUAR JUGANDO</div>` +
    `<h2>${esc(game.t)}</h2>` +
    `<div style="margin-top:6px">${esc(game.pr)} · ${status.label}</div></div>` +
    `<button class="btn lg pri" data-act="primary" data-id="${game.id}">` +
    `${status.k === 'ready' ? IC.play + ' ' : ''}${status.k === 'ready' ? 'Jugar' : status.cta}</button>` +
    '</div></section>'
  );
}

/* -------------------------------------------------------------------------- */
/* Vistas principales                                                         */
/* -------------------------------------------------------------------------- */

export function browseHTML(kind: 'library' | 'catalog'): string {
  const hero = heroShown(kind) ? heroHTML() : '';
  return (
    `<div class="top"><h1>${kind === 'library' ? 'Biblioteca' : 'Catálogo'}</h1>` +
    `<label class="search">${IC.search}` +
    `<input id="q" type="search" placeholder="${kind === 'library' ? 'Buscar en tu biblioteca…' : 'Buscar en el catálogo…'}" ` +
    `value="${esc(B.q)}" aria-label="Buscar"><kbd>/</kbd></label>` +
    `<div class="seg" id="vsw" role="group" aria-label="Forma de ver">${viewSwitchHTML()}</div></div>` +
    `<div id="hero">${hero}</div>` +
    `<div class="chips" id="chips">${chipsHTML(kind)}</div>` +
    `<div id="results">${resultsHTML(kind)}</div>`
  );
}

/** El héroe solo aparece en la biblioteca sin filtros activos. */
export function heroShown(kind: 'library' | 'catalog'): boolean {
  return kind === 'library' && !B.q && B.filter === 'all' && B.plat === 'all' && B.dev === 'all';
}

/**
 * Biblioteca y Catálogo (`browseHTML` montado en `#main`).
 *
 * `main.ts` pasa la ruta activa (`renderBrowse(R.name)`), de modo que la
 * función normaliza el ámbito antes de delegar en `browseHTML`.
 */
export function renderBrowse(kind: Route): string {
  return paintMain(browseHTML(browseScope(kind)));
}

/**
 * Repintado parcial del listado activo sin destruir el buscador.
 *
 * Cambiar filtro, orden, plataforma o forma de ver no debe perder el foco del
 * campo `#q`: sólo se sustituyen resultados, chips, héroe y conmutador.
 */
export function refreshBrowse(): string {
  const kind = browseScope(R.name);
  const results = document.getElementById('results');
  if (results) results.innerHTML = resultsHTML(kind);

  const chips = document.getElementById('chips');
  if (chips) chips.innerHTML = chipsHTML(kind);

  const hero = document.getElementById('hero');
  if (hero) hero.innerHTML = heroShown(kind) ? heroHTML() : '';

  const viewSwitch = document.getElementById('vsw');
  if (viewSwitch) viewSwitch.innerHTML = viewSwitchHTML();

  return results ? results.innerHTML : '';
}

/** Inicio (`renderHome`, línea 420). */
export function renderHome(): string {
  const installed = S.games.filter((game) => game.inst);
  const kind = (game: Game): string => statusOf(game).k;
  const stat = (value: number, label: string, color: string): string =>
    `<div class="box" style="flex:1 1 150px"><div style="font:700 34px var(--f-display);color:${color}">${value}</div>` +
    `<div class="muted">${label}</div></div>`;

  const recent = installed.slice().sort((a, b) => b.played - a.played).slice(0, 6);
  const hero = heroHTML();

  const slots = recent
    .map((game) => {
      const style = styleFor(game, S.settings) ?? S.settings.mediaDef ?? 'cd';
      return (
        `<div class="slot" style="--w:${mediaWidth(style)}px" data-act="open" data-id="${game.id}" tabindex="0" role="link" aria-label="${esc(game.t)}">` +
        `${mediaHTML(game, style, flagOf(game))}` +
        `<div class="cap">${esc(game.t)}</div>` +
        `<div class="foot">${devChip(game)}</div></div>`
      );
    })
    .join('');

  /* «Nuevo en el catálogo» = todo lo que el usuario aún no tiene. Filtrar por
   * estrategia (`external`) vaciaba la sección con el índice real. */
  const fresh = S.games.filter((game) => !game.inst).slice(0, 6).map(posterCard).join('');

  const recentBody = slots
    ? `<div class="rail" style="--n:var(--accent)"><div class="items">${slots}</div></div>`
    : '<div class="empty" style="padding:22px"><b style="color:var(--text)">Tu estantería está vacía</b><br>' +
      'Instala un port desde el Catálogo y aparecerá aquí.' +
      '<br><button class="btn sm" style="margin-top:12px" data-act="nav" data-to="catalog">Ir al Catálogo</button></div>';

  return paintMain(
    '<div class="top"><h1>Inicio</h1></div>' +
    (hero || '<div class="empty">Instala un port desde el Catálogo para empezar.</div>') +
    '<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:28px">' +
    stat(installed.length, 'ports instalados', 'var(--text)') +
    stat(installed.filter((game) => kind(game) === 'ready').length, 'listos para jugar', 'var(--accent2)') +
    stat(installed.filter((game) => kind(game) === 'rom').length, 'esperan tu ROM', 'var(--warn)') +
    stat(updateCount(), 'actualizaciones', 'var(--accent)') +
    '</div>' +
    `<section class="shelf"><h2>RECIENTES</h2>${recentBody}</section>` +
    '<h2 style="font-size:18px;margin-bottom:12px">NUEVO EN EL CATÁLOGO</h2>' +
    `<div class="grid">${fresh}</div>`
  );
}

/** Actualizaciones (`renderUpdates`, línea 430). */
export function renderUpdates(): string {
  const pending = S.games.filter((game) => statusOf(game).k === 'upd');
  const attention = S.games.filter(
    (game) => game.inst && statusOf(game).k !== 'upd' && ['abandoned', 'bugs'].includes(game.dev.k)
  );
  /* Novedades = ports sin instalar con actividad reciente. El filtro por
   * estrategia `external` dejaba la sección vacía con el índice real; si
   * tampoco hay cambios en el último mes, se muestran los más cercanos. */
  const freshPorts = S.games.filter((game) => !game.inst).sort((a, b) => a.months - b.months);
  const recentNews = freshPorts.filter((game) => game.months <= 1);
  const news = (recentNews.length > 0 ? recentNews : freshPorts).slice(0, 8);

  const section = (title: string, subtitle: string, body: string): string =>
    `<section style="margin-bottom:30px"><h2 style="font-size:18px">${title}</h2>` +
    `<div class="muted" style="margin:2px 0 12px;font-size:13px">${subtitle}</div>${body}</section>`;

  const row = (game: Game, middle: string, end: string): string =>
    `<div class="row" data-act="open" data-id="${game.id}" tabindex="0" role="link">` +
    `<div class="thumb" style="background:${bgOf(game)}"></div>` +
    `<div style="flex:1 1 220px;min-width:0"><b style="font-size:15px">${esc(game.t)}</b>` +
    `<div class="muted">${esc(game.pr)}</div></div>${middle}${end}</div>`;

  return paintMain(
    '<div class="top"><h1>Actualizaciones</h1>' +
    (pending.length
      ? `<button class="btn pri" data-act="updall">Actualizar todo (${pending.length})</button>`
      : '') +
    '</div>' +
    section(
      'Pendientes en tus ports',
      'Versiones nuevas de lo que ya tienes instalado.',
      pending.length
        ? '<div class="list">' +
          pending
            .map((game) =>
              row(
                game,
                `<span class="mono" style="font-size:13px">${esc(game.v)} → <b style="color:var(--accent)">${esc(game.lv)}</b></span>`,
                actBtn(game)
              )
            )
            .join('') +
          '</div>'
        : '<div class="empty" style="padding:22px"><b style="color:var(--text)">Todo al día</b><br>No hay versiones pendientes.</div>'
    ) +
    (attention.length
      ? section(
          'Atención en lo instalado',
          'Ports que tienes y que, por ahora, no avanzan o dan problemas. No hay versión nueva que instalar.',
          '<div class="list">' +
            attention
              .map((game) =>
                row(
                  game,
                  devChip(game),
                  `<span class="muted" style="font-size:12px;max-width:260px">${esc(game.dev.why)}</span>`
                )
              )
              .join('') +
            '</div>'
        )
      : '') +
    section(
      'Novedades del catálogo',
      'Ports que aún no instalas y que tuvieron actividad reciente en su repositorio.',
      news.length
        ? '<div class="list">' +
          news
            .map((game) =>
              row(
                game,
                devChip(game),
                `<span class="mono muted" style="font-size:12px">${
                  game.lv && game.lv !== '—' ? `v${game.lv} · ` : ''
                }${game.months > 0 ? `hace ${game.months} mes${game.months === 1 ? '' : 'es'}` : 'este mes'}</span>`
              )
            )
            .join('') +
          '</div>'
        : '<div class="empty" style="padding:22px">Sin novedades por ahora.</div>'
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Addons y extensiones (`renderAddons`)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Icono de un addon.
 *
 * Respeta `addon.icon` sólo cuando es una imagen (URL o `data:`), que se pinta
 * recortada dentro del marco. En cualquier otro caso —sin icono o con un
 * carácter suelto— se usa el glifo vectorial de Addons con la paleta del
 * launcher: nada de emojis ni de círculos de acento saturados.
 */
function addonAvatar(addon: Addon): string {
  const base =
    'width:44px;height:44px;border-radius:10px;background:rgba(255,255,255,.04);' +
    'border:1px solid var(--line);color:var(--accent2);display:grid;place-items:center;' +
    'flex:0 0 auto;overflow:hidden';
  const icon = typeof addon.icon === 'string' ? addon.icon.trim() : '';
  const isImage = /^(https?:|data:)/i.test(icon);
  const glyph = isImage
    ? `<img src="${esc(icon)}" alt="" style="width:100%;height:100%;object-fit:cover" />`
    : `<span style="color:var(--accent2);display:flex">${IC.addons}</span>`;
  return `<div style="${base}">${glyph}</div>`;
}

/** Tarjeta de un addon instalado: identidad, estado y acciones. */
function addonCard(addon: Addon): string {
  const name = esc(addon.name);
  return (
    `<article class="box" style="display:flex;flex-direction:column;gap:12px">` +
    '<div style="display:flex;align-items:center;gap:12px">' +
    addonAvatar(addon) +
    '<div style="flex:1 1 auto;min-width:0">' +
    `<b style="font-size:15px">${name}</b> ` +
    `<span class="mono muted" style="font-size:12px">v${esc(addon.version)}</span>` +
    `<div class="muted" style="font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">` +
    `<span>por ${esc(addon.author ?? 'Comunidad')}</span>` +
    `<span class="pill" style="font-size:11px">${esc(addon.type)}</span></div></div>` +
    `<button class="tog" role="switch" aria-checked="${addon.enabled}" aria-label="${
      addon.enabled ? 'Desactivar' : 'Activar'
    } ${name}" data-act="toggle-addon" data-id="${esc(addon.id)}"><i></i></button>` +
    '</div>' +
    `<div class="muted" style="font-size:13px">${esc(addon.description)}</div>` +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto">' +
    `<span class="muted" style="font-size:12px">${
      addon.enabled ? '● Activo' : '○ Desactivado'
    }</span>` +
    `<button class="btn sm ico dng" data-act="remove-addon" data-id="${esc(addon.id)}" ` +
    `aria-label="Desinstalar ${name}" title="Desinstalar ${name}">${IC.trash}</button>` +
    '</div></article>'
  );
}

/** Texto de apoyo de la sección de Addons. */
const ADDONS_BLURB =
  'Gestiona los plugins que amplían PortsLauncher con herramientas de compilación, ' +
  'extractores de assets y aprovisionamiento local.';

/**
 * Barra de acciones de Addons: carpeta de plugins, instalar y guía.
 *
 * La comparten la pestaña de Ajustes y la vista antigua (`renderAddons`), para
 * que ambas ofrezcan exactamente los mismos controles. La guía abre el modal
 * local (`pluginsDocModalHTML`): no depende de ninguna URL externa.
 */
function addonsActions(): string {
  return (
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button class="btn sm" data-act="open-addons-dir" style="display:inline-flex;align-items:center;gap:6px">' +
    `${IC.folder} Abrir carpeta de plugins</button>` +
    '<button class="btn sm" data-act="install-addon" style="display:inline-flex;align-items:center;gap:6px">' +
    `${IC.plus} Instalar plugin</button>` +
    '<button class="btn sm ghost" data-act="open-plugins-doc" ' +
    `style="display:inline-flex;align-items:center;gap:6px">${IC.book} Guía para desarrolladores</button>` +
    '</div>'
  );
}

/**
 * Estado vacío de Addons.
 *
 * Explica cómo instalar el primer plugin y ofrece la guía de desarrollo (el
 * resto de acciones vive en la barra de arriba, así que aquí no se repiten).
 */
function addonsEmptyState(): string {
  return (
    '<div class="empty" style="padding:36px 22px">' +
    '<div style="color:var(--muted);margin-bottom:12px;display:flex;justify-content:center">' +
    addonsGlyph(40) +
    '</div>' +
    '<b style="font-size:16px;color:var(--text)">Todavía no hay plugins instalados</b><br>' +
    `Copia la carpeta de un plugin en <span class="mono">${esc(ADDONS_DIR)}</span> y reinicia ` +
    'el launcher: aquí verás su ficha, su estado y podrás activarlo o desactivarlo.' +
    '<div style="margin-top:16px;display:flex;justify-content:center">' +
    '<button class="btn sm ghost" data-act="open-plugins-doc" ' +
    `style="display:inline-flex;align-items:center;gap:6px">${IC.book} Guía para desarrolladores</button>` +
    '</div></div>'
  );
}

/** Tarjetas de los plugins instalados (o el estado vacío) y el pie con la ruta. */
function addonsList(): string {
  const addons = S.addons ?? [];
  if (addons.length === 0) return addonsEmptyState();
  return (
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">' +
    addons.map(addonCard).join('') +
    '</div>' +
    '<div class="muted" style="font-size:12px">Carpeta de plugins: ' +
    `<span class="mono">${esc(ADDONS_DIR)}</span> · ${addons.length} instalado${
      addons.length === 1 ? '' : 's'
    }</div>`
  );
}

/**
 * Addons y Extensiones (`renderAddons`).
 *
 * Vista histórica de la sección. Ya no está en la navegación —Addons vive como
 * pestaña de Ajustes (`renderSettings`)— pero se conserva para poder montarla
 * de forma aislada y como red de seguridad del router.
 *
 * Los plugins viven en el sistema de ficheros del usuario (`ADDONS_DIR`); el
 * launcher sólo lista los ya instalados y permite activarlos o desinstalarlos.
 */
export function renderAddons(): string {
  return paintMain(
    '<div class="top"><h1>Addons y Extensiones</h1></div>' +
    '<div style="display:flex;flex-direction:column;gap:20px">' +
    `<div class="muted" style="max-width:820px;font-size:13.5px">${ADDONS_BLURB}</div>` +
    addonsActions() +
    addonsList() +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Guía de desarrollo de plugins (modal local)                                */
/* -------------------------------------------------------------------------- */

/**
 * Modal «Guía de Desarrollo de Plugins» (`#modal-root`).
 *
 * Sustituye al enlace externo que apuntaba a un repositorio inexistente: la
 * guía viaja dentro del launcher, se abre sin conexión y resume el contrato de
 * `docs/PLUGINS.md` (ubicación, manifiesto, protocolo CLI/JSON y aviso legal).
 *
 * Es HTML puro y no lee estado: `main.ts` lo monta, lo cierra con Escape, con
 * el scrim o con los botones del pie, y libera el scroll del documento.
 */
export function pluginsDocModalHTML(): string {
  /* Bloque de código: `esc` neutraliza `<`, `>` y las comillas del JSON. */
  const code = (text: string): string => `<pre class="code">${esc(text)}</pre>`;

  /* Título de sección numerado (`1 · UBICACIÓN LOCAL`). */
  const section = (n: number, title: string, body: string): string =>
    '<section style="display:flex;flex-direction:column;gap:8px">' +
    `<div class="lbl" style="padding:0">${n} · ${title}</div>` +
    body +
    '</section>';

  const heading = (text: string): string => `<h3 style="font-size:15px;margin:0">${text}</h3>`;

  const para = (text: string): string => `<div class="muted" style="font-size:13px">${text}</div>`;

  const tree =
    `${ADDONS_DIR}<id-plugin>/\n` +
    '├── plugin.json\n' +
    '├── icon.png\n' +
    '└── main.py';

  const manifest =
    '{\n' +
    '  "$schema": "https://portslauncher.org/schemas/plugin-v1.json",\n' +
    '  "id": "mi-plugin-ejemplo",\n' +
    '  "name": "Mi Plugin de Ejemplo",\n' +
    '  "version": "1.0.0",\n' +
    '  "description": "Extractor de mis respaldos personales.",\n' +
    '  "author": "Tu nombre o alias",\n' +
    '  "type": "asset-provider",\n' +
    '  "platforms": ["n64", "ps1", "snes", "gba"],\n' +
    '  "entrypoint": "main.py",\n' +
    '  "runtime": "python3",\n' +
    '  "capabilities": ["search", "provision"]\n' +
    '}';

  const checkOut = '{"ok": true, "version": "1.0.0", "message": "Plugin operativo."}';

  const searchOut =
    '{\n' +
    '  "success": true,\n' +
    '  "results": [\n' +
    '    {\n' +
    '      "id": "asset-001",\n' +
    '      "title": "Mi respaldo (USA)",\n' +
    '      "platform": "n64",\n' +
    '      "format": ".z64",\n' +
    '      "sizeBytes": 8388608,\n' +
    '      "sha1": "3ce607099631c77507e157201d8f7e8338807d94"\n' +
    '    }\n' +
    '  ]\n' +
    '}';

  const provisionOut =
    '{"type": "progress", "percent": 25, "status": "Leyendo volcado local..."}\n' +
    '{"type": "progress", "percent": 75, "status": "Extrayendo assets de audio y texturas..."}\n' +
    '{"type": "completed", "outputPath": "<salida>/baserom.us.z64", "sha1": "3ce6070…094"}';

  /* Cada comando con su respuesta esperada por `stdout`. */
  const protocol =
    heading('Tres comandos, JSON por <span class="mono">stdout</span>') +
    para(
      'El launcher ejecuta el <span class="mono">entrypoint</span> con el runtime declarado y lee la ' +
        'respuesta como JSON. El lenguaje del plugin es libre: el contrato es la línea de órdenes.'
    ) +
    '<div class="mono" style="font-size:12px;color:var(--accent2)">1 · check</div>' +
    code('python3 main.py check') +
    code(checkOut) +
    '<div class="mono" style="font-size:12px;color:var(--accent2)">2 · search</div>' +
    code('python3 main.py search "<titulo>" --platform <plataforma>') +
    code(searchOut) +
    '<div class="mono" style="font-size:12px;color:var(--accent2)">3 · provision</div>' +
    code('python3 main.py provision "<asset-id>" --output "<carpeta-destino>"') +
    para('El aprovisionamiento informa del progreso con líneas JSON y termina en un evento de cierre.') +
    code(provisionOut);

  const body =
    section(
      1,
      'UBICACIÓN LOCAL',
      heading('Una carpeta por plugin') +
        para(
          'Cada plugin vive en su propio subdirectorio, con el <span class="mono">id</span> del ' +
            'manifiesto como nombre de carpeta. El launcher lo detecta al arrancar: no hay instalador ' +
            'ni descargas de por medio.'
        ) +
        code(tree) +
        '<div class="muted" style="font-size:12px">Windows: ' +
        '<span class="mono">%APPDATA%\\PortsLauncher\\plugins\\</span> · macOS: ' +
        '<span class="mono">~/Library/Application Support/PortsLauncher/plugins/</span></div>'
    ) +
    section(
      2,
      'MANIFIESTO REQUERIDO',
      heading('<span class="mono">plugin.json</span> en la raíz del plugin') +
        para(
          'Obligatorios: <span class="mono">id</span>, <span class="mono">name</span>, ' +
            '<span class="mono">version</span>, <span class="mono">description</span>, ' +
            '<span class="mono">type</span>, <span class="mono">entrypoint</span> y ' +
            '<span class="mono">capabilities</span>.'
        ) +
        code(manifest)
    ) +
    section(3, 'PROTOCOLO CLI Y JSON ESTÁNDAR', protocol) +
    section(
      4,
      'AVISO LEGAL Y SEGURIDAD',
      heading('Solo respaldos personales') +
        para(
          'Los plugins de aprovisionamiento están pensados para trabajar con volcados de material que ' +
            'ya posees. No distribuyas ni publiques material comercial protegido por derechos de autor: ' +
            'PortsLauncher no aloja, no enlaza ni distribuye plugins de terceros, y cada plugin ' +
            'instalado corre bajo tu exclusiva responsabilidad. Los términos completos están en ' +
            '<span class="mono">docs/LEGAL.md</span>.'
        )
    );

  return (
    '<div class="scrim" data-act="close-doc-modal"></div>' +
    '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="doc-title" ' +
    'style="max-width:760px;width:calc(100vw - 32px);max-height:85vh;display:flex;' +
    'flex-direction:column;overflow:hidden">' +
    /* Cabecera: icono, título y cierre. */
    '<div class="mhead">' +
    '<div style="width:44px;height:44px;border-radius:10px;background:rgba(255,255,255,.04);' +
    'border:1px solid var(--line);color:var(--accent2);display:grid;place-items:center;' +
    `flex:0 0 auto">${bookGlyph(22)}</div>` +
    '<div style="flex:1;min-width:0">' +
    '<h2 id="doc-title" style="font-size:22px">Guía de Desarrollo de Plugins</h2>' +
    '<div class="muted">Contrato local: manifiesto, comandos y aviso legal</div></div>' +
    '<button class="btn ico" data-act="close-doc-modal" aria-label="Cerrar">✕</button>' +
    '</div>' +
    /* Cuerpo: sólo esta zona hace scroll. */
    '<div class="mbody" style="overflow-y:auto;padding:18px 24px;flex:1 1 auto;min-height:0;gap:22px">' +
    body +
    '</div>' +
    /* Pie: carpeta de plugins a la izquierda y cierre explícito a la derecha. */
    '<div class="mfoot">' +
    '<button class="btn sm" data-act="open-addons-dir" style="display:inline-flex;align-items:center;gap:6px">' +
    `${IC.folder} Abrir carpeta de plugins</button>` +
    '<span style="flex:1"></span>' +
    '<button class="btn pri" data-act="close-doc-modal">Entendido</button>' +
    '</div></div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Ficha (`renderGame`, línea 446) — sin reseñas ni comunidad                 */
/* -------------------------------------------------------------------------- */

interface Step {
  t: string;
  d: string;
}

export function stepsFor(game: Game): Step[] {
  const steps: Step[] = [
    {
      t: 'Descargar el port',
      d: 'Se baja el paquete desde el repositorio original del proyecto y se comprueba su huella.',
    },
  ];
  if (game.strategy === 'release-installer') {
    steps[0] = {
      t: 'Descargar el instalador',
      d: 'El proyecto usa un instalador propio. Se ejecuta en segundo plano y prepara los archivos.',
    };
  }
  steps.push({
    t: 'Instalar en tu carpeta de ports',
    d: `Se deja en ${game.dir}. Puedes cambiarla luego en el engranaje ⚙.`,
  });
  if (game.rom) {
    steps.push({
      t: 'Pedirte la ROM',
      d: 'Al terminar te preguntamos dónde está tu copia y la validamos (extensión, orden de bytes y SHA-1).',
    });
  }
  steps.push({ t: 'Listo para jugar', d: 'El botón pasa a «Jugar». Todo se configura por port.' });
  return steps;
}

export function repoOf(game: Game): string | null {
  if (!game.repo) return null;
  return game.repo.includes('/') ? `github.com/${game.repo}` : `github.com/${game.repo}`;
}

/** Caja «Estado del port» (sin métricas de comunidad). */
export function devBox(game: Game): string {
  const changed =
    game.months > 0 ? `hace ${game.months} mes${game.months === 1 ? '' : 'es'}` : 'este mes';
  return (
    '<div class="box"><div style="font:700 17px var(--f-display)">Estado del port</div>' +
    `<div>${devChip(game, 'lg')}</div>` +
    `<div class="muted" style="font-size:13px">${esc(game.dev.why)}</div>` +
    `<div class="kv"><span class="muted">Declarado por el proyecto</span><span>${esc(game.decl)}</span></div>` +
    `<div class="kv"><span class="muted">Último cambio</span><span>${changed}</span></div>` +
    `<div class="kv"><span class="muted">Bugs abiertos</span><span class="mono">${game.bugs}</span></div>` +
    `<div class="kv"><span class="muted">Confianza</span><span>${esc(game.dev.conf)}</span></div>` +
    '<div class="muted" style="font-size:12px">Lo calcula el índice con el estado que declara el proyecto y señales del repositorio.</div>' +
    '</div>'
  );
}

/**
 * Máscaras LINEALES direccionales que funden el hero con el lienzo.
 *
 * Sustituyen a la elipse radial: un `radial-gradient` se mide en porcentajes de
 * la caja del elemento, así que en pantallas anchas (o cuando la imagen es más
 * estrecha que el hueco) el desvanecimiento se agotaba antes de llegar a los
 * extremos laterales y los lados izquierdo/derecho se veían cortados en recto.
 * Con dos degradados lineales en ejes independientes cada borde se desvanece
 * respecto a su propio eje y el resultado es estable a cualquier resolución:
 * en horizontal el `transparent` cae siempre en el 0 % y el 100 % del ancho, en
 * vertical en el 0 % y el 100 % del alto.
 *
 * Los porcentajes son bajos a propósito (`transparent` → `black` en el primer
 * 20 % y de vuelta al 80 %): el centro queda nítido y el fundido ocupa lo justo
 * para que no se distinga ningún borde recto. `rgba(0,0,0,.5)` / `.6` en el 8 %
 * y el 92 % redondea la caída y evita el aspecto de viñeta dura.
 *
 * Se aplican a CONTENEDORES, nunca al `<img>` que lleva el `transform: scale`
 * del slider: así el zoom agranda la imagen por dentro de una máscara anclada a
 * la cabecera. Se emiten `-webkit-*` y estándar (WebKit/Blink y Gecko).
 *
 * OJO: las máscaras de contenedores anidados se MULTIPLICAN entre sí. La capa
 * del hero y la previsualización encadenan X → Y → X (la última sobre el
 * contenedor inmediato del `<img>`, para que los bordes físicos de la imagen
 * —aunque sea más estrecha que la pantalla— empiecen y acaben en `transparent`).
 */
const HERO_MASK_X_CSS =
  '-webkit-mask-image:linear-gradient(to right,transparent 0%,rgba(0,0,0,0.5) 8%,black 20%,black 80%,rgba(0,0,0,0.5) 92%,transparent 100%);' +
  'mask-image:linear-gradient(to right,transparent 0%,rgba(0,0,0,0.5) 8%,black 20%,black 80%,rgba(0,0,0,0.5) 92%,transparent 100%);';

const HERO_MASK_Y_CSS =
  '-webkit-mask-image:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,0.6) 8%,black 20%,black 80%,rgba(0,0,0,0.6) 92%,transparent 100%);' +
  'mask-image:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,0.6) 8%,black 20%,black 80%,rgba(0,0,0,0.6) 92%,transparent 100%);';

export function renderGame(id: string): string {
  const game = S.byId.get(id);
  if (!game) return '<div class="empty">Esta ficha no está en el índice.</div>';

  const status = statusOf(game);
  const tab = D.tab;
  const tabs: Array<['sum' | 'ver' | 'src', string]> = [
    ['sum', 'Resumen'],
    ['ver', 'Versiones'],
    ['src', 'Fuentes'],
  ];
  const repo = repoOf(game);
  let body = '';

  if (tab === 'sum') {
    body =
      '<section style="display:flex;flex-direction:column;gap:12px">' +
      '<h2 style="font-size:20px">Cómo se instalará</h2>' +
      stepsFor(game)
        .map(
          (step, index) =>
            `<div class="step"><span class="n">${index + 1}</span><div><b>${step.t}</b>` +
            `<div class="muted">${esc(step.d)}</div></div></div>`
        )
        .join('') +
      '</section>';
  }

  if (tab === 'ver') {
    const versions = [game.lv, game.ver ?? game.lv].filter(
      (version, index, all) => version && version !== '—' && all.indexOf(version) === index
    );
    body =
      '<div class="list">' +
      versions
        .map(
          (version, index) =>
            '<div class="row" style="cursor:default"><b class="mono">' +
            `${esc(version)}</b><span class="muted" style="flex:1">${index === 0 ? 'Última versión' : 'Versión anterior'}` +
            `${version === game.ver ? ' · verificada' : ''}${game.v === version ? ' · instalada' : ''}</span>` +
            `<button class="btn sm" data-act="toast" data-m="Instalar versión ${esc(version)} (simulado)">Instalar esta</button></div>`
        )
        .join('') +
      '</div>';
  }

  if (tab === 'src') {
    const sources = (game.port.sources ?? [])
      .map(
        (source) =>
          `<div class="row" style="cursor:default"><b style="flex:1">${esc(source.source)}</b>` +
          `<span class="mono muted" style="font-size:12px">${esc(source.externalId)}</span></div>`
      )
      .join('');
    body = repo
      ? '<div class="list"><div class="row" style="cursor:default">' +
        '<div style="flex:1 1 260px;min-width:0"><b>Repositorio</b>' +
        `<div class="mono muted" style="font-size:12px;word-break:break-all">${esc(repo)}</div></div>` +
        '<button class="btn sm" data-act="toast" data-m="Abriría el repositorio en una pestaña nueva (simulado)">Abrir en GitHub</button></div>' +
        `<div class="row" style="cursor:default"><b style="flex:1">Última versión</b><span class="mono">${esc(game.lv)}</span></div>` +
        `<div class="row" style="cursor:default"><b style="flex:1">Último cambio</b><span>${
          game.months > 0 ? `hace ${game.months} meses` : 'este mes'
        }</span></div>` +
        `${sources}</div><p class="muted">Las descargas salen siempre de este repositorio, nunca de PortsHub.</p>`
      : '<div class="empty">Este proyecto no tiene repositorio público.<br>Se distribuye como proyecto externo.</div>';
  }

  const rom = game.rom
    ? '<div class="box" style="border-color:var(--warn)">' +
      `<div style="display:flex;align-items:center;gap:8px;font:700 17px var(--f-display);color:var(--warn)">${IC.carts} Requiere tus archivos</div>` +
      '<div>Este port no incluye el juego. Aportas una copia propia:</div>' +
      '<div style="padding:12px 14px;border-radius:12px;background:var(--panel2);border:1px dashed var(--line)">' +
      `<b>${esc(game.rom.n)}</b><div class="mono muted" style="font-size:12px;margin-top:4px">SHA-1 ${esc(game.rom.sha)} · ${esc(game.rom.x.join(' '))}</div></div>` +
      (game.inst
        ? game.romOk
          ? '<div style="color:var(--accent2);font-weight:600">● ROM validada</div>' +
            `<div class="mono muted" style="font-size:12px;word-break:break-all">${esc(game.romPath)}</div>` +
            `<button class="btn sm" data-act="rom" data-id="${game.id}">Cambiar ROM…</button>`
          : `<button class="btn warn" data-act="rom" data-id="${game.id}">Añadir ROM</button>`
        : '') +
      '<div class="muted" style="font-size:12px">Tu ROM no sale de tu equipo ni la distribuimos.</div></div>'
    : '';

  const cta =
    status.k === 'inst'
      ? `<div style="min-width:240px">${actBtn(game)}</div>`
      : `<button class="btn lg ${status.k === 'rom' ? 'warn' : 'pri'}" data-act="primary" data-id="${game.id}" style="min-width:240px">` +
        `${status.k === 'ready' ? IC.play + ' ' : ''}${status.k === 'ready' ? 'Jugar' : status.cta}</button>`;

  const meta = [
    `<span class="pill" style="background:rgba(10,9,18,.72)">${game.pl}</span>`,
    `<span class="pill" style="background:rgba(10,9,18,.72)">${esc(game.targets.join(' · ') || 'Windows · Linux')}</span>`,
    `<span class="pill" style="background:rgba(10,9,18,.72)">${esc(AI[game.ai] ?? AI['unknown'])}</span>`,
    devChip(game, 'lg'),
  ].join('');

  const tabsHtml = tabs
    .map(
      ([key, label]) =>
        `<button role="tab" data-act="tab" data-k="${key}" aria-selected="${tab === key}">${label}</button>`
    )
    .join('');

  /* Imagen principal de la cabecera: SOLO heros horizontales.
   * Nunca `coverVertical` ni `game.cover` (poster vertical 600x900): una imagen
   * vertical en el centro de la cabecera rompe la composición. Si no hay hero
   * horizontal simplemente no se pinta imagen central. */
  const heroImg = game.hero || (game.coverHorizontal ? game.coverHorizontal : null);
  /* URL saneada para `url('…')`: el escapado HTML ya ha convertido las comillas
   * en entidades, que aquí se eliminan para no romper la cadena CSS. */
  const heroCss = heroImg ? esc(heroImg).replace(/&quot;|&#39;/g, '') : null;
  const logo = game.logo;
  const logoAnchor = game.logoAnchor ?? LOGO_ANCHOR_DEFAULT;
  const logoScale = clampLogoScale(game.logoScale);
  /* Escala del fondo (100–250 %): la imagen se agranda desde el centro dentro
   * de la máscara estática, así el fundido perimetral no se mueve con el zoom. */
  const heroScale = clampHeroScale(game.heroScale);

  /* Capa absoluta del logotipo: el usuario decide el ancla (7 puntos) y el
   * alto (40–220 px) desde el botón «Ajustar arte». Se coloca antes de la capa de
   * contenido para que los botones sigan siendo clicables por encima. */
  const logoLayer = logo
    ? `<div style="${logoBoxStyle(logoAnchor, logoScale)}">` +
      `<img src="${esc(logo)}" alt="${esc(game.t)}" style="${logoImageStyle(logoScale)}" /></div>`
    : '';

  /* Enfoque cinematográfico: el hero queda para el arte y el logotipo. El
   * título tipográfico ya no convive con el logotipo (se pinta en la ficha,
   * justo encima de las pestañas), así que aquí solo aparece cuando el juego no
   * tiene logo, como firma visual de la cabecera. */
  const heroTitle = logo
    ? ''
    : '<div style="display:flex;align-items:center;height:100%;max-height:140px;">' +
      '<h1 style="font-size:clamp(32px,5.5vw,52px);line-height:1.05;' +
      'text-shadow:0 4px 24px rgba(0,0,0,.6);margin:0">' +
      `${esc(game.t)}</h1></div>`;

  /* Botón principal de la cabecera según la estrategia del port. */
  const heroAction =
    game.strategy === 'external'
      ? '<button class="btn lg pri" data-act="ext">Abrir página del proyecto</button>'
      : game.strategy === 'source-only' && !game.inst
        ? '<button class="btn lg" data-act="toast" data-m="Guía de compilación (simulada)">Ver guía de compilación</button>'
        : cta;

  /* Botón de volver dinámico: la ficha recuerda si el usuario venía del
   * Catálogo o de la Biblioteca (`NAVMEM`), de modo que «←» devuelve siempre al
   * listado de origen. */
  const backRoute: 'catalog' | 'library' = NAVMEM.lastBrowseRoute;
  const backHash = backRoute === 'catalog' ? '#catalogo' : '#biblioteca';
  const backLabel = backRoute === 'catalog' ? '← Catálogo' : '← Biblioteca';
  const backBtn =
    `<a href="${backHash}" data-act="nav" data-to="${backRoute}" class="pill" ` +
    'style="background:rgba(10,9,18,.7);backdrop-filter:blur(6px);padding:8px 14px">' +
    `${backLabel}</a>`;

  return paintMain(
    '<div class="dhero">' +
    /* --- capa 0: fondo desenfocado a sangre --------------------------------- */
    (heroCss
      ? '<div style="position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none">' +
        `<div style="position:absolute;inset:-30px;background-image:url('${heroCss}');background-size:cover;` +
        'background-position:center;filter:blur(32px);transform:scale(1.15);opacity:.55"></div></div>'
      : '') +
    /* --- fusión lateral del fondo con el lienzo ----------------------------- */
    '<div style="position:absolute;inset:0;z-index:0;pointer-events:none;background:' +
    'linear-gradient(90deg,#0A0912 0%,rgba(10,9,18,0) 20%,rgba(10,9,18,0) 80%,#0A0912 100%),' +
    'linear-gradient(180deg,rgba(10,9,18,0.2) 0%,rgba(10,9,18,0.9) 100%)"></div>' +
    /* --- capa 1: hero principal centrado ------------------------------------ */
    (heroImg
      ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:1;' +
        'pointer-events:none;padding:12px 60px">' +
        /* El hero se funde con el lienzo mediante máscaras lineales en dos ejes
         * encadenadas en contenedores anidados:
         *   · capa externa → máscara HORIZONTAL sobre el ancho completo del hueco,
         *   · capa media   → máscara VERTICAL sobre el alto completo,
         *   · capa interna → máscara HORIZONTAL otra vez, sobre el contenedor
         *     inmediato del `<img>`, para que los bordes físicos de la imagen
         *     (aunque sea más estrecha que la pantalla) empiecen y terminen en
         *     `transparent` y nunca se vea una línea recta vertical.
         * Ninguna se aplica al `<img>` que lleva el `transform: scale` del
         * slider: así el zoom agranda la imagen por dentro y el fundido sigue
         * anclado a la cabecera. `overflow:hidden` recorta el zoom en una zona
         * que la máscara ya ha dejado transparente, así que no reaparece ningún
         * borde recto. */
        '<div style="width:100%;height:100%;overflow:hidden;display:flex;align-items:center;justify-content:center;' +
        HERO_MASK_X_CSS +
        '">' +
        '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
        HERO_MASK_Y_CSS +
        '">' +
        '<div style="position:relative;display:flex;align-items:center;justify-content:center;max-height:100%;max-width:100%;' +
        HERO_MASK_X_CSS +
        '">' +
        `<img src="${esc(heroImg)}" alt="" style="max-height:100%;max-width:100%;object-fit:contain;display:block;` +
        `transform:scale(${heroScale / 100});transform-origin:center;transition:transform .15s ease-out" />` +
        '</div></div></div></div>'
      : '') +
    /* --- capa 2: contenido, logotipo (izquierda) y acciones (derecha) -------- */
    logoLayer +
    '<div style="position:relative;z-index:2;display:flex;flex-direction:column;justify-content:space-between;gap:16px;flex:1 1 auto">' +
    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;align-self:flex-start">' +
    backBtn +
    `<button class="pill" data-act="art-modal" data-id="${game.id}" style="background:rgba(10,9,18,.7);backdrop-filter:blur(6px);padding:8px 14px;border:1px solid rgba(255,255,255,.15);cursor:pointer;color:var(--text);display:inline-flex;align-items:center;gap:7px">${IC.palette} Ajustar arte</button>` +
    '</div>' +
    '<div style="display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:24px;padding-top:50px">' +
    /* --- lado IZQUIERDO: logotipo a toda la altura (la ficha lleva título,
     *     metadatos y versión, así que la cabecera se deja limpia) ---------- */
    '<div style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:12px">' +
    heroTitle +
    '</div>' +
    /* --- lado DERECHO: acciones + estrategia/requisitos de ROM -------------- */
    '<div style="display:flex;flex-direction:column;gap:10px;align-items:flex-end;text-align:right;' +
    'flex:0 1 auto;max-width:360px;margin-left:auto">' +
    heroAction +
    `<div style="font-size:12px">${esc(game.st)}${
      game.mb ? ` · ~${game.mb} MB` : ''
    }${game.rom ? ' · necesitarás tu ROM' : ''}</div></div></div></div>` +
    /* `dgrid` sale de `.dhero`: las capas absolutas (fondo desenfocado + hero)
     * no deben superponerse al cuerpo de la ficha.
     * El título, las píldoras de metadatos y la versión viven ahora aquí: la
     * cabecera se reserva al arte y al logotipo (enfoque cinematográfico). */
    '</div><div class="dgrid"><div class="dcol">' +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">' +
    `<h1 style="font-size:clamp(24px,3.5vw,34px);line-height:1.15;margin:0;font-weight:700">${esc(game.t)}</h1>` +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${meta}</div>` +
    `<div class="muted" style="font-size:14px">${esc(game.pr)} · última versión ${esc(game.lv)}</div>` +
    '</div>' +
    `<div class="tabs" role="tablist">${tabsHtml}</div>${body}</div>` +
    `<aside class="dside">${rom}${devBox(game)}` +
    '<div class="box"><div style="font:700 17px var(--f-display)">Nivel de verificación</div>' +
    (game.ver
      ? `<div>● <b style="color:var(--accent2)">Verificado</b> en v${esc(game.ver)}</div>`
      : '<div>● <b style="color:var(--warn)">Sin verificar</b></div>') +
    (game.ver && game.ver !== game.lv
      ? `<div>● Versión ${esc(game.lv)}: <b style="color:var(--warn)">sin verificar</b></div>`
      : '') +
    `<div class="muted" style="font-size:12px">${esc(AI[game.ai] ?? AI['unknown'])} según declara el proyecto.</div></div>` +
    (game.inst
      ? '<div class="box"><div style="font:700 17px var(--f-display)">Instalación</div>' +
        `<div class="kv"><span class="muted">Versión</span><span class="mono">${esc(game.v ?? '—')}</span></div>` +
        `<div class="kv"><span class="muted">Directorio</span><span class="mono" style="font-size:12px;word-break:break-all;text-align:right">${esc(game.dir)}</span></div>` +
        `<button class="btn" data-act="gear" data-id="${game.id}">${IC.gear} Configurar</button></div>`
      : '') +
    '<div class="box"><div style="font:700 17px var(--f-display)">Repositorio</div>' +
    (repo
      ? `<div class="mono muted" style="font-size:12px;word-break:break-all">${esc(repo)}</div>` +
        '<button class="btn sm" data-act="toast" data-m="Abriría el repositorio en una pestaña nueva (simulado)">Abrir en GitHub</button>'
      : '<div class="muted">Proyecto externo, sin repositorio público.</div>') +
    '<div class="muted" style="font-size:12px">La descarga sale siempre del repositorio original del proyecto.</div></div>' +
    '</aside></div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Ajustes (`renderSettings`, línea 481)                                      */
/* -------------------------------------------------------------------------- */

/** Plataforma representativa de cada silueta (para las miniaturas). */
const STYLE_PLAT: Record<MediaStyle, PlatKey> = {
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
  cd: 'OTRAS',
  ps1: 'PS1',
  gcn: 'GCN',
  wii: 'WII',
  xbox: 'XBOX',
  ps2: 'PS2',
  x360: 'X360',
  ps3: 'PS3',
  ps4: 'PS4',
  wiiu: 'WIIU',
  dc: 'DC',
  vita: 'VITA',
  xbone: 'XBONE',
};

/** Ficha sintética para previsualizar un soporte sin datos reales. */
function sampleFor(style: MediaStyle): Game {
  const found = S.games.find((game) => styleFor(game, S.settings) === style);
  if (found) return found;
  return {
    id: `preview-${style}`,
    t: 'PortsHub',
    cv: 'PORTS\nHUB',
    pr: 'PortsHub',
    lv: '—',
    ver: null,
    pl: STYLE_PLAT[style],
    platform: 'other',
    st: STRAT['release-archive'],
    strategy: 'release-archive',
    mb: 0,
    c: ['#1B1035', '#5B2BD9', '#FF4FA3'],
    p: 'grid',
    cover: null,
    coverHorizontal: null,
    coverVertical: null,
    coverSquare: null,
    logo: null,
    hero: null,
    customArt: null,
    logoAnchor: LOGO_ANCHOR_DEFAULT,
    logoScale: 110,
    heroScale: HERO_SCALE_DEFAULT,
    coverScale: COVER_SCALE_DEFAULT,
    coverY: 0,
    coverX: 0,
    rom: null,
    ai: 'none',
    exp: false,
    dev: { k: 'nodata', t: DEVT.nodata.t, c: DEVT.nodata.c, g: DEVT.nodata.g, why: '', conf: 'baja' },
    repo: null,
    decl: 'Sin declarar',
    bugs: 0,
    months: 0,
    targets: [],
    inst: false,
    romOk: false,
    v: null,
    pin: false,
    auto: false,
    dir: '',
    romPath: '',
    romMode: 'link',
    args: '',
    runner: 'Nativo',
    exe: '',
    played: 0,
    port: {} as PortItem,
  };
}

/** Etiqueta del «auto» de una plataforma (usa el medio por defecto si no tiene). */
function autoLabel(key: PlatKey, settings: Settings): string {
  const own = PLATMEDIA[key];
  if (own) return `Auto · ${MEDIA[own].name}`;
  return `Defecto · ${MEDIA[settings.mediaDef ?? 'cd'].name}`;
}

/* -------------------------------------------------------------------------- */
/* Integración con SteamGridDB                                                */
/* -------------------------------------------------------------------------- */

/**
 * ¿El **servidor** de Vite tiene credenciales de SteamGridDB?
 *
 * `main.ts` lo averigua al arrancar con `GET /api/steamgrid/__status` (no llama
 * a la API: solo pregunta si hay clave en el entorno o en
 * `~/.steamgrid_credentials.env`). Mientras no se sepa, se asume `false`.
 */
let serverSteamgridReady = false;

/** Registra el resultado de la sonda `/api/steamgrid/__status`. */
export function setSteamgridServerReady(ready: boolean): void {
  serverSteamgridReady = !!ready;
}

/** ¿Hay clave de SteamGridDB, en los ajustes del usuario o en el servidor? */
export function steamgridConfigured(settings: Settings): boolean {
  return !!String(settings.steamgridApiKey ?? '').trim() || serverSteamgridReady;
}

/* -------------------------------------------------------------------------- */
/* Pestañas de Ajustes                                                        */
/* -------------------------------------------------------------------------- */

/** Pestañas de la pantalla de Ajustes. */
export type SettingsTab = 'appearance' | 'storage' | 'integrations' | 'addons' | 'system';

/**
 * Pestaña visible ahora mismo.
 *
 * Es estado de navegación, no una preferencia del usuario: vive en memoria a
 * propósito para que cada arranque vuelva a abrir «Apariencia» en lugar de
 * quedarse atascado en la última pestaña que se visitó.
 */
let currentSettingsTab: SettingsTab = 'appearance';

/** Activa una pestaña de Ajustes (`main.ts`, acción `set-tab`). */
export function setSettingsTab(tab: SettingsTab): void {
  currentSettingsTab = tab;
}

export function renderSettings(): string {
  const settings = S.settings;
  /* El indicador de Ajustes refleja SOLO la clave guardada por el usuario: la
   * del servidor de desarrollo no se muestra como «Conectado» para no prometer
   * una integración que la build estática no tiene. */
  const steamgridReady = !!(settings.steamgridApiKey && settings.steamgridApiKey.trim());
  const demo = (['psp', 'snes', 'md', 'ps1', 'gb'] as const).map(sampleFor);
  const mediaKeys = Object.keys(MEDIA) as MediaStyle[];
  const selected = settings.mediaDef;

  const tiles = mediaKeys
    .map(
      (key) =>
        `<button class="mtile" data-act="media" data-k="${key}" aria-pressed="${selected === key}">` +
        `<span style="width:44px;height:38px;display:grid;place-items:center">${miniIcon(key, sampleFor(key))}</span>` +
        `<span><b style="font-size:13px">${MEDIA[key].name}</b><br>` +
        `<span class="muted" style="font-size:11px">${MEDIA[key].hint}</span></span></button>`
    )
    .join('');

  const perPlatform =
    settings.mediaMode === 'auto'
      ? '<div style="font:600 14px var(--f-body);margin-top:6px">Medio de cada biblioteca</div><div class="list">' +
        PLAT_KEYS.map((key) => {
          const options = mediaKeys
            .map(
              (media) =>
                `<option value="${media}" ${settings.mediaMap[platformOf(key)] === media ? 'selected' : ''}>${MEDIA[media].name}</option>`
            )
            .join('');
          return (
            '<div class="row" style="cursor:default;padding:8px 14px;gap:12px">' +
            `<span style="width:44px;height:38px;display:grid;place-items:center">${miniIcon(styleOf(key, settings), sampleFor(styleOf(key, settings)))}</span>` +
            `<b style="flex:1 1 140px">${PLAT[key].name}</b>` +
            `<select class="in-txt" data-map="${platformOf(key)}" style="max-width:260px;height:36px">` +
            `<option value="">${esc(autoLabel(key, settings))}</option>${options}</select></div>`
          );
        }).join('') +
        '</div>'
      : '';

  const viewButtons = VIEWS.map(
    ([key, label, glyph]) =>
      `<button data-act="view" data-k="${key}" aria-pressed="${settings.view === key}" aria-label="${label}" title="${label}">${glyph}</button>`
  ).join('');

  /* Barra de pestañas: Ajustes es una sola pantalla, pero sólo se pinta el
   * panel de la pestaña activa (antes era un scroll vertical interminable). */
  const tabs: Array<[SettingsTab, string, string]> = [
    ['appearance', 'Apariencia', IC.posters],
    ['storage', 'Carpetas y ROMs', IC.folder],
    ['integrations', 'Integraciones y Arte', IC.cat],
    ['addons', 'Addons y Plugins', IC.addons],
    ['system', 'Sistema e Índice', IC.gear],
  ];

  const tabsHtml =
    '<div class="tabs" role="tablist" style="margin-bottom:22px">' +
    tabs
      .map(
        ([id, label, icon]) =>
          `<button class="tab" role="tab" aria-selected="${currentSettingsTab === id}" ` +
          `data-act="set-tab" data-k="${id}" style="display:inline-flex;align-items:center;gap:8px">` +
          `${icon} ${label}</button>`
      )
      .join('') +
    '</div>';

  /* Cada pestaña agrupa una o varias secciones ya maquetadas. */
  const appearanceSection =
    /* APARIENCIA */
    '<section class="box"><div class="lbl" style="padding:0">APARIENCIA</div>' +
    '<h2 style="font-size:18px">Cartuchos y discos</h2>' +
    '<div class="seg txt" style="align-self:flex-start;flex-wrap:wrap">' +
    `<button data-act="mmode" data-k="single" aria-pressed="${settings.mediaMode === 'single'}">Un solo estilo para todos</button>` +
    `<button data-act="mmode" data-k="auto" aria-pressed="${settings.mediaMode === 'auto'}">Según la plataforma</button></div>` +
    `<div class="muted" style="font-size:13px">${
      settings.mediaMode === 'single'
        ? 'Todos tus juegos se ven con el mismo estilo, sea cual sea su plataforma.'
        : 'Cada biblioteca usa el medio de su plataforma. Las que no tengan uno propio usan el estilo por defecto.'
    }</div>` +
    `<div style="font:600 14px var(--f-body)">${
      settings.mediaMode === 'single' ? 'Estilo para todos los juegos' : 'Estilo por defecto (plataformas sin medio propio)'
    }</div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:10px">${tiles}</div>` +
    perPlatform +
    `<div class="rail" style="--n:var(--accent);--mz:${window.innerWidth < 720 ? 0.7 : 1}">` +
    '<div class="items" style="justify-content:center;gap:34px">' +
    demo
      .map(
        (game) =>
          `<div class="slot" style="--w:${mediaWidth(styleFor(game, settings))}px;cursor:default">` +
          `${mediaHTML(game, styleFor(game, settings), false)}<div class="cap">${esc(game.t)}</div></div>`
      )
      .join('') +
    '</div><div class="board"></div></div></section>';

  const librarySection =
    /* BIBLIOTECA */
    '<section class="box"><div class="lbl" style="padding:0">BIBLIOTECA</div>' +
    '<h2 style="font-size:18px">Vista predeterminada</h2>' +
    `<div class="seg" style="align-self:flex-start">${viewButtons}</div>` +
    '<div class="muted" style="font-size:12px">Con qué vista se abren Biblioteca y Catálogo.</div></section>';

  const storageSection =
    /* CARPETAS Y ROMS */
    '<section class="box"><div class="lbl" style="padding:0">CARPETAS Y ROMS</div>' +
    '<label>Carpeta de ports por defecto' +
    `<input class="in-txt" data-set="installDir" value="${esc(settings.installDir)}"></label>` +
    '<label>Carpeta interna de ROMs' +
    `<input class="in-txt" data-set="romDir" value="${esc(settings.romDir)}"></label>` +
    '<div>Al añadir una ROM, por defecto:</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:12px">' +
    `<button class="opt" role="radio" aria-checked="${settings.romMode === 'link'}" data-act="rmode" data-k="link">` +
    '<b>Usarla desde donde está</b><span class="muted">No se mueve nada.</span></button>' +
    `<button class="opt" role="radio" aria-checked="${settings.romMode === 'copy'}" data-act="rmode" data-k="copy">` +
    `<b>Copiarla a la carpeta del port</b><span class="muted">Se copia dentro de ${esc(settings.romDir)}.</span></button>` +
    '</div></section>';

  const systemSection =
    /* SISTEMA */
    '<section class="box"><div class="lbl" style="padding:0">SISTEMA</div>' +
    '<div class="kv"><span>Destino de los ports</span>' +
    `<button class="btn sm" data-act="dest">${esc(settings.dest)} (cambiar)</button></div></section>`;

  const integrationsSection =
    /* INTEGRACIONES Y ARTE */
    '<section class="box"><div class="lbl" style="padding:0">INTEGRACIONES Y ARTE</div>' +
    '<h2 style="font-size:18px">Carátulas reales con tu clave de SteamGridDB</h2>' +
    '<div class="kv"><span>Estado de la integración</span>' +
    `<span style="font-weight:600">${
      steamgridReady ? '🟢 Conectado' : '🟡 No configurada'
    }</span></div>` +
    '<label>Clave API de SteamGridDB (personal y gratuita)' +
    '<input class="in-txt" type="text" data-set="steamgridApiKey" autocomplete="off" ' +
    `spellcheck="false" placeholder="Pega aquí tu clave (opcional)" value="${esc(settings.steamgridApiKey ?? '')}"></label>` +
    '<div class="muted" style="font-size:12px">La clave se guarda solo en este navegador y viaja al ' +
    'proxy local del launcher. Sin clave, cada soporte usa su arte generativo procedural.</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
    '<button class="btn sm" data-act="test-steamgrid">Probar conexión</button>' +
    '<button class="btn sm" data-act="open-wizard">Ver asistente de bienvenida</button>' +
    '</div>' +
    '<div class="muted" style="font-size:12px">Consigue tu clave API personal y gratuita en ' +
    '<a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" ' +
    'rel="noreferrer noopener" style="color:var(--accent2)">steamgriddb.com/profile/preferences/api</a>.' +
    '</div>' +
    /* Descarga masiva del catálogo: el motor vive en `main.ts`, que inyecta el
     * estado y la barra de progreso en `#steamgrid-sync-box` (de ahí que el
     * contenedor se pinte vacío aquí). */
    '<div class="box" style="margin-top:12px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px">' +
    '<div>' +
    '<b style="font-size:15px">Descargar carátulas del catálogo automáticamente</b>' +
    '<div class="muted" style="font-size:12.5px;max-width:620px;margin-top:3px">' +
    'Consulta SteamGridDB en segundo plano de forma progresiva (con protección de rate-limit) ' +
    'para descargar y guardar localmente las carátulas, fondos y logotipos de los 1.166 juegos. ' +
    'Si se desactiva, solo se descargará arte manualmente.' +
    '</div>' +
    '</div>' +
    `<button class="tog" role="switch" aria-checked="${!!settings.steamgridAutoSync}" ` +
    'data-act="toggle-auto-art" aria-label="Descargar carátulas automáticamente"><i></i></button>' +
    '</div>' +
    '<div id="steamgrid-sync-box" style="margin-top:12px;display:flex;flex-direction:column;gap:6px">' +
    '<!-- Estado y progreso dinámico inyectado por main.ts -->' +
    '</div>' +
    '</div>' +
    '</section>';

  const indexSection =
    /* ÍNDICE */
    '<section class="box"><div class="lbl" style="padding:0">ÍNDICE DE PORTS</div>' +
    '<h2 style="font-size:18px">Un índice propio alimenta el launcher</h2>' +
    '<div class="flow">' +
    '<div><b>Repositorios</b><br><span class="muted" style="font-size:12px">GitHub · GitLab</span></div>' +
    '<span class="ar">→</span>' +
    '<div><b>Indexador</b><br><span class="muted" style="font-size:12px">normaliza, deduplica y calcula estados</span></div>' +
    '<span class="ar">→</span>' +
    '<div><b>Índice PortsHub</b><br>' +
    `<span class="mono muted" style="font-size:12px">ports.index.json · ${esc(S.generatedAt ?? 'sin fecha')}</span></div>` +
    '<span class="ar">→</span>' +
    '<div><b>Este launcher</b><br><span class="muted" style="font-size:12px">solo lee el índice</span></div>' +
    '</div>' +
    `<div class="kv"><span>Último indexado</span><span>${esc(indexAge())}</span></div>` +
    `<div class="kv"><span>Ports en el índice</span><span class="mono">${S.games.length}</span></div>` +
    '<div class="muted" style="font-size:12px">El launcher no consulta repositorios ni listados de terceros: solo lee el índice.</div></section>';

  const legendSection =
    /* ETIQUETAS */
    '<section class="box"><div class="lbl" style="padding:0">ETIQUETAS DE ESTADO</div>' +
    '<h2 style="font-size:18px">Qué significa cada etiqueta</h2>' +
    DEV_LEGEND.map(
      ([key, text]) =>
        '<div class="kv" style="align-items:center">' +
        `<span class="dev" style="--c:${DEVT[key].c}">${DEVT[key].g} ${DEVT[key].t}</span>` +
        `<span class="muted" style="text-align:right">${esc(text)}</span></div>`
    ).join('') +
    '</section>';

  const localSection =
    /* BIBLIOTECA LOCAL */
    '<section class="box"><div class="lbl" style="padding:0">BIBLIOTECA LOCAL</div>' +
    '<div class="muted">Tus instalaciones, ROMs y ajustes se guardan en este navegador.</div>' +
    '<button class="btn dng" style="align-self:flex-start" data-act="reset">Restablecer biblioteca y ajustes</button></section>';

  const addonsSection =
    '<div class="lbl" style="padding:0">ADDONS Y PLUGINS</div>' +
    `<div class="muted" style="max-width:820px;font-size:13.5px">${ADDONS_BLURB}</div>` +
    addonsActions() +
    addonsList();

  /* Sólo se pinta la pestaña activa. */
  const panels: Record<SettingsTab, string> = {
    appearance: appearanceSection + librarySection,
    storage: storageSection,
    integrations: integrationsSection,
    addons: addonsSection,
    system: systemSection + indexSection + legendSection + localSection,
  };

  return paintMain(
    '<div class="top"><h1>Ajustes</h1></div>' +
    tabsHtml +
    `<div style="display:flex;flex-direction:column;gap:22px;max-width:980px">${panels[currentSettingsTab]}</div>`
  );
}

/** Traduce una clave visual a `sourcePlatform`. */
function platformOf(key: PlatKey): 'n64' | 'snes' | 'nes' | 'md' | 'gba' | 'gb' | 'nds' | 'n3ds' | 'nsw' | 'psp' | 'ps1' | 'ps2' | 'gcn' | 'wii' | 'xbox' | 'x360' | 'ps3' | 'ps4' | 'wiiu' | 'dc' | 'vita' | 'xbone' | 'pc' | 'other' {
  const map: Record<PlatKey, ReturnType<typeof platformOf>> = {
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
    PS3: 'ps3',
    PS4: 'ps4',
    WIIU: 'wiiu',
    DC: 'dc',
    VITA: 'vita',
    XBONE: 'xbone',
    PC: 'pc',
    OTRAS: 'other',
  };
  return map[key];
}

export { MEDIA, PLAT, PLAT_KEYS };

/* -------------------------------------------------------------------------- */
/* Arte personalizado: posición del logo y modal «Ajustar arte»               */
/* -------------------------------------------------------------------------- */

/** Secciones del modal de personalización. */
export type ArtKind = 'logo' | 'hero' | 'cover';
export type ArtTab = ArtKind;

/** Etiqueta de cada pestaña del modal. */
export const ART_TAB_LABELS: Record<ArtTab, string> = {
  logo: 'Logo',
  hero: 'Fondo de cabecera',
  cover: 'Carátula del soporte',
};

/** Borrador en edición: lo que el usuario ve antes de «Guardar y aplicar». */
export interface ArtDraft {
  logoUrl: string | null;
  heroUrl: string | null;
  coverUrl: string | null;
  logoAnchor: LogoAnchor;
  logoScale: number;
  /** Escala del fondo de cabecera en porcentaje (100–250). */
  heroScale?: number;
  /** Zoom de la carátula dentro del soporte en porcentaje (80–200). */
  coverScale?: number;
  /** Desplazamiento vertical de la carátula dentro del soporte (-50…50 %). */
  coverY?: number;
  /** Desplazamiento horizontal de la carátula dentro del soporte (-50…50 %). */
  coverX?: number;
}

/** Miniatura de la galería devuelta por `/api/steamgrid/...`. */
export interface ArtGalleryItem {
  url: string;
  thumb?: string;
  label?: string;
}

export interface ArtModalOptions {
  /** Valores en edición (por defecto, el arte efectivo del juego). */
  draft?: ArtDraft;
  /** Resultados ya descargados de SteamGridDB, por sección. */
  gallery?: Partial<Record<ArtKind, ArtGalleryItem[]>>;
  /** Mensaje de estado de la última búsqueda, por sección. */
  status?: Partial<Record<ArtKind, string | null>>;
  /** Texto del buscador, por sección (se conserva entre repintados). */
  queries?: Partial<Record<ArtKind, string>>;
  /**
   * ¿Hay clave de SteamGridDB disponible (ajustes del usuario o servidor)?
   * Si llega `false`, el modal muestra el aviso amigable para configurarla.
   */
  apiKeyConfigured?: boolean;
}

/** Altura de la botonera de la cabecera (`← Catálogo` / `Ajustar arte`).
 *  Los 70 px de las anclas superiores son un margen seguro: el logo nunca
 *  colisiona ni queda oculto bajo esa botonera. */
const LOGO_TOP_SAFE = 70;
/** Equivalente en el recuadro de previsualización del editor (~200 px de alto,
 *  sin botonera): el margen real dejaría el logo fuera del recorte. */
const LOGO_TOP_PREVIEW = 20;

/** Ancla → propiedades CSS del contenedor absoluto del logotipo. */
const LOGO_ANCHOR_CSS: Record<LogoAnchor, string> = {
  'top-left': 'top:70px;left:32px;',
  'top-center': 'top:70px;left:50%;transform:translateX(-50%);',
  'top-right': 'top:70px;right:32px;',
  center: 'top:52%;left:50%;transform:translate(-50%,-50%);',
  'bottom-left': 'bottom:24px;left:32px;',
  'bottom-center': 'bottom:24px;left:50%;transform:translateX(-50%);',
  'bottom-right': 'bottom:24px;right:32px;',
};

/** Posición CSS (sin `position`) del ancla pedida. */
export function logoAnchorStyle(anchor: LogoAnchor | string | null | undefined): string {
  const key = (anchor ?? LOGO_ANCHOR_DEFAULT) as LogoAnchor;
  return LOGO_ANCHOR_CSS[key] ?? LOGO_ANCHOR_CSS[LOGO_ANCHOR_DEFAULT];
}

/**
 * Igual que `logoAnchorStyle`, pero con los offsets adaptados al recuadro de
 * previsualización del editor de arte: el margen seguro de 70 px de la cabecera
 * real no aplica ahí (no hay botonera y el recuadro solo mide 200 px), así que
 * se reduce para que el logo siga viéndose entero en las tres anclas «top».
 */
export function logoPreviewAnchorStyle(anchor: LogoAnchor | string | null | undefined): string {
  const css = logoAnchorStyle(anchor);
  if (css.indexOf(`top:${LOGO_TOP_SAFE}px;`) === 0) {
    return css.replace(`top:${LOGO_TOP_SAFE}px;`, `top:${LOGO_TOP_PREVIEW}px;`);
  }
  /* `center` va al 52 % en la cabecera (compensa la botonera superior); en la
   * previsualización vuelve al centro geométrico exacto. */
  if (css.indexOf('top:52%;') === 0) return css.replace('top:52%;', 'top:50%;');
  return css;
}

/**
 * Contenedor absoluto del logo dentro de la cabecera (o de la previsualización).
 * `preview` cambia los offsets de las anclas superiores (ver
 * `logoPreviewAnchorStyle`).
 */
export function logoBoxStyle(
  anchor: LogoAnchor | string | null | undefined,
  scale: number | null | undefined,
  preview = false
): string {
  return (
    'position:absolute;z-index:2;pointer-events:none;' +
    `${preview ? logoPreviewAnchorStyle(anchor) : logoAnchorStyle(anchor)}` +
    `height:${clampLogoScale(scale)}px;max-height:100%;`
  );
}

/** Estilo del `<img>`/`<span>` del logo: alto del slider sin deformar. */
export function logoImageStyle(scale: number | null | undefined): string {
  return (
    `height:${clampLogoScale(scale)}px;max-height:100%;max-width:min(100%,460px);object-fit:contain;` +
    'filter:drop-shadow(0 6px 20px rgba(0,0,0,.9));'
  );
}

/** Galería de miniaturas clicables devuelta por el proxy de SteamGridDB. */
export function artGalleryHTML(kind: ArtKind, items: ArtGalleryItem[]): string {
  if (!items || items.length === 0) return '';
  return items
    .map(
      (item) =>
        `<button data-act="art-pick" data-k="${kind}" data-url="${esc(item.url)}" ` +
        `title="${esc(item.label ?? 'Usar esta imagen')}" aria-label="${esc(item.label ?? 'Usar esta imagen')}" ` +
        'style="padding:0;height:92px;border-radius:12px;overflow:hidden;border:1px solid var(--line);' +
        'background:var(--panel2);cursor:pointer">' +
        `<img src="${esc(item.thumb ?? item.url)}" alt="" loading="lazy" ` +
        'style="width:100%;height:100%;object-fit:cover;display:block" /></button>'
    )
    .join('');
}

/** Estado del borrador a partir del arte efectivo de un juego. */
export function artDraftOf(game: Game): ArtDraft {
  return {
    logoUrl: game.customArt?.logoUrl ?? null,
    heroUrl: game.customArt?.heroUrl ?? null,
    coverUrl: game.customArt?.coverUrl ?? null,
    logoAnchor: game.logoAnchor ?? LOGO_ANCHOR_DEFAULT,
    logoScale: clampLogoScale(game.logoScale),
    heroScale: clampHeroScale(game.heroScale),
    coverScale: clampCoverScale(game.coverScale),
    coverY: clampCoverOffset(game.coverY),
    coverX: clampCoverOffset(game.coverX),
  };
}

/** Borrador del modal en el `CustomArtwork` que se persiste. */
export function artPatchOf(draft: ArtDraft): CustomArtwork {
  return {
    coverUrl: draft.coverUrl,
    heroUrl: draft.heroUrl,
    logoUrl: draft.logoUrl,
    logoAnchor: draft.logoAnchor,
    logoScale: clampLogoScale(draft.logoScale),
    heroScale: clampHeroScale(draft.heroScale),
    coverScale: clampCoverScale(draft.coverScale),
    coverY: clampCoverOffset(draft.coverY),
    coverX: clampCoverOffset(draft.coverX),
  };
}

/* Reexportaciones de conveniencia: `main.ts` consume el modal y su modelo de
 * borrador junto a las escalas y el tipo de ancla, sin depender de tres
 * módulos. */
export { clampCoverOffset, clampCoverScale, clampHeroScale, clampLogoScale } from './model';
export {
  COVER_OFFSET_MAX,
  COVER_OFFSET_MIN,
  COVER_SCALE_DEFAULT,
  COVER_SCALE_MAX,
  COVER_SCALE_MIN,
  HERO_SCALE_DEFAULT,
  HERO_SCALE_MAX,
  HERO_SCALE_MIN,
} from '../services/types';
export type { LogoAnchor } from '../services/types';

/**
 * Modal «Ajustar arte» (estilo Steam): logo con 7 anclas y slider, fondo de
 * cabecera y carátula del soporte, con búsqueda en SteamGridDB, subida local y
 * URL manual.
 *
 * Es HTML puro: el estado del borrador lo guarda `main.ts` y lo pasa en
 * `options.draft`, de modo que cada repintado conserva lo elegido.
 */
export function artModalHTML(
  game: Game,
  activeTab: ArtTab = 'logo',
  options: ArtModalOptions = {}
): string {
  const draft: ArtDraft = options.draft ?? artDraftOf(game);
  const gallery = options.gallery ?? {};
  const status = options.status ?? {};
  const queries = options.queries ?? {};

  const anchor = (draft.logoAnchor ?? LOGO_ANCHOR_DEFAULT) as LogoAnchor;
  const scale = clampLogoScale(draft.logoScale);
  const logoPreview = draft.logoUrl ?? game.logo ?? null;
  const heroPreview = draft.heroUrl ?? game.hero ?? null;
  const coverPreview = draft.coverUrl ?? game.coverHorizontal ?? game.cover ?? null;

  /* Aviso amable cuando no hay clave ni en los ajustes ni en el servidor: la
   * búsqueda en SteamGridDB no puede funcionar, pero el arte generativo sí. */
  const apiNotice =
    options.apiKeyConfigured === false
      ? '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px;' +
        'border-radius:12px;border:1px dashed var(--warn);background:rgba(255,154,61,.08)">' +
        '<div style="flex:1 1 300px"><b>🟡 SteamGridDB aún no está configurado</b><br>' +
        '<span class="muted" style="font-size:12.5px">Buscar carátulas reales necesita una clave API ' +
        'personal y gratuita. Puedes pegarla en <b>Ajustes → Integraciones y Arte</b> o seguir con el ' +
        'arte generativo: cada soporte ya pinta su patrón y su título.</span></div>' +
        '<button class="btn sm" data-act="art-goto-settings">Ir a Ajustes</button>' +
        '</div>'
      : '';

  const tabButtons = (['logo', 'hero', 'cover'] as ArtTab[])
    .map(
      (key) =>
        `<button data-act="art-tab" data-k="${key}" aria-pressed="${activeTab === key}">` +
        `${esc(ART_TAB_LABELS[key])}</button>`
    )
    .join('');

  /* Buscador + subida local + URL manual: el mismo bloque para las 3 secciones. */
  const sourceBlock = (
    kind: ArtKind,
    label: string,
    placeholder: string,
    current: string | null
  ): string =>
    `<div class="lbl" style="padding:0">${label}</div>` +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    `<input class="in-txt" id="art-q-${kind}" data-art="query" data-k="${kind}" ` +
    `value="${esc(queries[kind] ?? '')}" placeholder="${esc(placeholder)}" style="flex:1 1 220px" ` +
    `aria-label="Buscar ${esc(label)} en SteamGridDB">` +
    `<button class="btn sm" data-act="art-search" data-k="${kind}">Buscar en SteamGridDB</button>` +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    `<label class="btn sm" style="display:inline-flex;align-items:center;gap:6px">${IC.folder} Subir archivo` +
    `<input type="file" accept="image/*" data-art="file" data-k="${kind}" hidden></label>` +
    `<input class="in-txt" id="art-url-${kind}" data-art="url" data-k="${kind}" ` +
    `value="${esc(current ?? '')}" placeholder="https://…/imagen.png" style="flex:1 1 180px" ` +
    `aria-label="URL de ${esc(label)}">` +
    `<button class="btn sm" data-act="art-url" data-k="${kind}">Usar URL</button>` +
    '</div>' +
    `<div id="art-status-${kind}" class="muted" style="font-size:12px">${esc(status[kind] ?? '')}</div>` +
    `<div id="art-gallery-${kind}" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px">` +
    artGalleryHTML(kind, gallery[kind] ?? []) +
    '</div>';

  const anchorButtons = LOGO_ANCHORS.map(
    (key) =>
      `<button class="chip" data-act="set-anchor" data-k="${key}" aria-pressed="${anchor === key}" ` +
      `title="${esc(LOGO_ANCHOR_LABELS[key])}">${LOGO_ANCHOR_GLYPHS[key]} ${esc(
        LOGO_ANCHOR_LABELS[key]
      )}</button>`
  ).join('');

  let panel = '';
  if (activeTab === 'logo') {
    panel =
      '<div class="lbl" style="padding:0">PREVISUALIZACIÓN</div>' +
      '<div style="position:relative;height:200px;border-radius:14px;overflow:hidden;' +
      'border:1px solid var(--line);background:var(--panel2)">' +
      (heroPreview
        ? `<img src="${esc(heroPreview)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;` +
          'object-fit:cover;filter:blur(10px);opacity:.45" />'
        : '') +
      `<div id="art-logo-box" style="${logoBoxStyle(anchor, scale, true)}">` +
      (logoPreview
        ? `<img id="art-logo-img" src="${esc(logoPreview)}" alt="Logo" style="${logoImageStyle(scale)}" />`
        : '<span class="muted" style="font-size:12px">Sin logo</span>') +
      '</div></div>' +
      '<div class="lbl" style="padding:0">POSICIÓN DEL LOGO</div>' +
      `<div style="display:flex;flex-wrap:wrap;gap:8px">${anchorButtons}</div>` +
      '<div class="lbl" style="padding:0">TAMAÑO DEL LOGO</div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      `<input id="art-scale" type="range" min="${LOGO_SCALE_MIN}" max="${LOGO_SCALE_MAX}" step="2" ` +
      `value="${scale}" data-art="scale" data-act="set-scale" aria-label="Tamaño del logo" style="flex:1">` +
      `<span class="mono" id="art-scale-val" style="min-width:66px;text-align:right">${scale} px</span>` +
      '</div>' +
      sourceBlock('logo', 'CAMBIAR EL LOGO', 'GoldenEye 007', draft.logoUrl);
  }

  if (activeTab === 'hero') {
    /* Mismas máscaras lineales que la cabecera (X → Y → X sobre contenedores
     * anidados): la previsualización debe mostrar exactamente el mismo fundido
     * perimetral, sin cortes laterales en ningún ancho. El zoom (`scale`) se
     * aplica a la imagen de dentro para que la máscara no se mueva. */
    const heroScale = clampHeroScale(draft.heroScale);
    panel =
      '<div class="lbl" style="padding:0">PREVISUALIZACIÓN</div>' +
      '<div style="position:relative;height:170px;border-radius:14px;overflow:hidden;' +
      'border:1px solid var(--line);background:var(--panel2)">' +
      (heroPreview
        ? `<img src="${esc(heroPreview)}" alt="" style="position:absolute;inset:-30px;width:calc(100% + 60px);` +
          'height:calc(100% + 60px);object-fit:cover;filter:blur(26px);opacity:.6" />' +
          '<div style="position:absolute;inset:0;display:flex;align-items:center;' +
          'justify-content:center;padding:8px 20px;' +
          HERO_MASK_X_CSS +
          '">' +
          '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
          HERO_MASK_Y_CSS +
          '">' +
          '<div style="position:relative;display:flex;align-items:center;justify-content:center;max-height:100%;max-width:100%;' +
          HERO_MASK_X_CSS +
          '">' +
          `<img id="art-hero-preview-img" src="${esc(heroPreview)}" alt="" style="max-width:100%;` +
          'max-height:100%;object-fit:contain;display:block;' +
          `transform:scale(${heroScale / 100});transform-origin:center;transition:transform .15s ease-out" />` +
          '</div></div></div>'
        : '<span class="muted" style="position:absolute;inset:0;display:grid;place-items:center">Sin fondo</span>') +
      '</div>' +
      '<div class="muted" style="font-size:12px">Al aplicarlo, la cabecera usa el fondo difuminado al máximo ' +
      'y el desvanecimiento lateral hacia el lienzo.</div>' +
      '<div class="lbl" style="padding:0">ESCALA DEL FONDO</div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      `<input id="art-hero-scale" type="range" min="${HERO_SCALE_MIN}" max="${HERO_SCALE_MAX}" step="2" ` +
      `value="${heroScale}" data-art="hero-scale" data-act="set-hero-scale" aria-label="Escala del fondo" style="flex:1">` +
      `<span class="mono" id="art-hero-scale-val" style="min-width:66px;text-align:right">${heroScale}%</span>` +
      '</div>' +
      sourceBlock('hero', 'FONDO DE CABECERA (HERO)', 'GoldenEye 007', draft.heroUrl);
  }

  if (activeTab === 'cover') {
    /* Previsualización del soporte ya montado (cartucho, caja o disco) con el
     * zoom y el desplazamiento del borrador: es el único modo de ver el efecto
     * real de los sliders, porque la carátula se pinta DENTRO de la silueta. */
    const style = styleFor(game, S.settings) ?? S.settings.mediaDef ?? 'n64';
    const coverScale = clampCoverScale(draft.coverScale);
    const coverY = clampCoverOffset(draft.coverY);
    const previewGame: Game = {
      ...game,
      coverHorizontal: coverPreview,
      coverSquare: coverPreview,
      coverVertical: coverPreview,
      cover: coverPreview,
      coverScale,
      coverY,
    };
    panel =
      '<div class="lbl" style="padding:0">PREVISUALIZACIÓN DEL SOPORTE</div>' +
      '<div style="position:relative;height:240px;border-radius:14px;overflow:hidden;' +
      'border:1px solid var(--line);background:var(--panel2);display:flex;align-items:center;' +
      'justify-content:center;padding:16px">' +
      '<div id="art-cover-preview-box" style="transform:scale(1.15);transform-origin:center">' +
      mediaHTML(previewGame, style, false) +
      '</div></div>' +
      '<div class="muted" style="font-size:12px">Es la imagen que luce el soporte: etiqueta del cartucho, ' +
      'caja o disco según la plataforma.</div>' +
      '<div class="lbl" style="padding:0">TAMAÑO DE LA IMAGEN (ZOOM)</div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      `<input id="art-cover-scale" type="range" min="${COVER_SCALE_MIN}" max="${COVER_SCALE_MAX}" step="2" ` +
      `value="${coverScale}" data-art="cover-scale" data-act="set-cover-scale" aria-label="Tamaño de la carátula" style="flex:1">` +
      `<span class="mono" id="art-cover-scale-val" style="min-width:66px;text-align:right">${coverScale}%</span>` +
      '</div>' +
      '<div class="lbl" style="padding:0">POSICIÓN VERTICAL</div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      `<input id="art-cover-y" type="range" min="${COVER_OFFSET_MIN}" max="${COVER_OFFSET_MAX}" step="1" ` +
      `value="${coverY}" data-art="cover-y" data-act="set-cover-y" aria-label="Posición vertical" style="flex:1">` +
      `<span class="mono" id="art-cover-y-val" style="min-width:66px;text-align:right">${coverY > 0 ? `+${coverY}` : coverY}%</span>` +
      '</div>' +
      sourceBlock('cover', 'CARÁTULA DEL SOPORTE', 'GoldenEye 007', draft.coverUrl);
  }

  return (
    '<div class="scrim" data-act="close-modal"></div>' +
    '<div class="modal" role="dialog" aria-modal="true" aria-label="Ajustar arte de ' +
    esc(game.t) +
    '" style="width:min(880px,calc(100vw - 24px))">' +
    '<div class="mhead">' +
    '<div style="width:44px;height:44px;border-radius:10px;background:rgba(255,255,255,.04);' +
    `border:1px solid var(--line);color:var(--accent2);display:grid;place-items:center;flex:0 0 auto">${paletteGlyph(20)}</div>` +
    `<div style="flex:1;min-width:0"><h2 style="font-size:22px">Ajustar arte</h2>` +
    `<div class="muted">${esc(game.t)} · logo, cabecera y carátula al estilo Steam</div></div>` +
    '<button class="btn ico" data-act="close-modal" aria-label="Cerrar">✕</button>' +
    '</div>' +
    '<div class="mbody">' +
    apiNotice +
    `<div class="seg txt" style="align-self:flex-start;flex-wrap:wrap">${tabButtons}</div>` +
    panel +
    '</div>' +
    '<div class="mfoot">' +
    `<button class="btn dng" data-act="reset-art" data-id="${game.id}">Restaurar por defecto</button>` +
    '<span style="flex:1"></span>' +
    '<button class="btn" data-act="close-modal">Cancelar</button>' +
    `<button class="btn pri" data-act="save-art" data-id="${game.id}">Guardar y aplicar</button>` +
    '</div></div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Asistente de bienvenida (wizard de 3 pasos)                                */
/* -------------------------------------------------------------------------- */

/** Número de pasos del asistente de bienvenida. */
export const WIZARD_STEPS = 3;

/** Indicador «1 de 3» con los puntos de progreso. */
function wizardProgress(step: number): string {
  const dots = Array.from({ length: WIZARD_STEPS }, (_, index) => {
    const n = index + 1;
    return (
      `<span style="width:8px;height:8px;border-radius:50%;display:inline-block;` +
      `background:${n === step ? 'var(--accent)' : 'var(--line)'}"></span>`
    );
  }).join('');
  return (
    '<div style="display:flex;align-items:center;gap:10px">' +
    `<span class="mono muted" style="font-size:11px;letter-spacing:.14em">PASO ${step} DE ${WIZARD_STEPS}</span>` +
    `<span style="display:flex;gap:6px">${dots}</span></div>`
  );
}

/**
 * Modal del asistente de bienvenida (`#modal-root`).
 *
 * Tres pasos: presentación y aviso legal, conexión opcional con SteamGridDB y
 * ecosistema de plugins. Es HTML puro: `main.ts` guarda el paso activo
 * (`currentWizardStep`) y repinta al navegar. Al terminar u omitir se marca
 * `settings.onboardingDone`, de modo que el asistente no vuelve a aparecer.
 *
 * @param settings ajustes vigentes (la clave de SteamGridDB se prerrellena).
 * @param step     paso activo, 1–3 (cualquier otro valor cae en el 1).
 */
export function wizardModalHTML(settings: Settings, step: number): string {
  const current = step === 2 ? 2 : step === 3 ? 3 : 1;

  let title = '';
  let description = '';
  let detail = '';
  let actions = '';

  if (current === 1) {
    title = '¡Bienvenido a PortsLauncher!';
    description =
      'El lanzador de escritorio para puertos nativos, recompilaciones y proyectos de ingeniería inversa de código abierto.';
    detail =
      '<p class="muted" style="font-size:13px;margin:0">PortsLauncher no aloja ni distribuye archivos protegidos ' +
      'por derechos de autor. Cada puerto es código abierto desarrollado por la comunidad.</p>';
    actions = '<button class="btn primary" data-act="wizard-step" data-k="2">Siguiente →</button>';
  } else if (current === 2) {
    title = 'Arte oficial y carátulas (Opcional)';
    description =
      'Puedes conectar tu clave gratuita de SteamGridDB para que los juegos muestren carátulas, fondos y logotipos oficiales de alta resolución.';
    detail =
      '<label>Clave API de SteamGridDB (opcional)' +
      '<input class="in-txt" type="text" data-set="steamgridApiKey" autocomplete="off" spellcheck="false" ' +
      `placeholder="Pega tu clave aquí (opcional)" value="${esc(settings.steamgridApiKey ?? '')}"></label>` +
      '<div class="muted" style="font-size:12px">Si decides no ingresarla, PortsLauncher generará ' +
      'automáticamente carátulas geométricas y estilizadas únicas para cada título.</div>';
    actions =
      '<button class="btn sm" data-act="wizard-step" data-k="1">← Anterior</button>' +
      '<button class="btn primary" data-act="wizard-step" data-k="3">Siguiente →</button>';
  } else {
    title = 'Ecosistema de Plugins y Extensiones';
    description =
      'PortsLauncher admite plugins modulares de la comunidad instalados en tu directorio local:';
    detail =
      '<code>~/.local/share/portslauncher/plugins/</code>' +
      '<p class="muted" style="font-size:13px;margin:0">Los plugins permiten extender el lanzador con ' +
      'herramientas de compilación, extractores de assets y gestión de tus respaldos personales. Consulta la ' +
      'guía oficial en <b>docs/PLUGINS.md</b> y los términos en <b>docs/LEGAL.md</b>.</p>';
    actions =
      '<button class="btn sm" data-act="wizard-step" data-k="2">← Anterior</button>' +
      '<button class="btn pri" data-act="finish-wizard">¡Comenzar a explorar!</button>';
  }

  return (
    '<div class="scrim" data-act="close-wizard"></div>' +
    '<div class="modal" role="dialog" aria-modal="true" aria-label="Asistente de bienvenida" ' +
    'style="max-width:560px;width:calc(100vw - 32px)">' +
    '<div class="mhead">' +
    '<div style="width:44px;height:44px;border-radius:50%;background:var(--accent);color:var(--onaccent);' +
    'display:grid;place-items:center;font-size:20px">👋</div>' +
    '<div style="flex:1;min-width:0">' +
    `<div class="muted" style="font-size:12px">Asistente de bienvenida</div>` +
    `${wizardProgress(current)}</div>` +
    '<button class="btn ghost sm" data-act="finish-wizard">Omitir</button>' +
    '</div>' +
    '<div class="mbody">' +
    `<h2 style="font-size:24px;line-height:1.15">${esc(title)}</h2>` +
    `<div class="muted" style="font-size:14px">${esc(description)}</div>` +
    detail +
    '</div>' +
    `<div class="mfoot">${actions}</div>` +
    '</div>'
  );
}

