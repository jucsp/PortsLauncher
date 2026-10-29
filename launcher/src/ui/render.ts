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

import type { MediaStyle, PortItem, Settings } from '../services/types';
import { esc, devChip as chipOf, flagOf, PROG, statusOf, styleFor, styleOf, artOf } from './model';
import type { Game } from './model';
import { IC, sv } from './icons';
import { mediaHTML, miniIcon } from './media';
import { AI, DEVT, DEV_LEGEND, MEDIA, PLAT, PLAT_KEYS, PLATMEDIA, STRAT } from './platforms';
import type { PlatKey } from './platforms';
import { TO_PLATFORM } from './platforms';
import { B, D, R, S, updateCount } from './state';
import type { FilterKey, Route, SortKey } from './state';

/* -------------------------------------------------------------------------- */
/* Navegación                                                                 */
/* -------------------------------------------------------------------------- */

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
  settings: 'ajustes',
};

/** Hashes que entiende el router. */
export const RT_INV: Record<string, Route> = {
  inicio: 'home',
  biblioteca: 'library',
  catalogo: 'catalog',
  actualizaciones: 'updates',
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

export function filtered(kind: 'library' | 'catalog'): Game[] {
  const query = B.q.trim().toLowerCase();
  const list = S.games.filter((game) => {
    const status = statusOf(game).k;
    if (kind === 'library' && !game.inst) return false;
    if (B.plat !== 'all' && game.pl !== B.plat) return false;
    if (B.dev !== 'all' && game.dev.k !== B.dev) return false;
    if (
      query &&
      !`${game.t} ${game.pr} ${PLAT[game.pl].name} ${game.pl}`.toLowerCase().includes(query)
    ) {
      return false;
    }
    const filter = B.filter;
    if (filter === 'ready' && status !== 'ready') return false;
    if (filter === 'rom' && status !== 'rom') return false;
    if (filter === 'upd' && status !== 'upd') return false;
    if (filter === 'new' && game.inst) return false;
    if (filter === 'inst' && !game.inst) return false;
    return true;
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
 */
export function bgOf(game: Game): string {
  const procedural = artOf(game);
  if (!game.cover) return procedural;
  const url = esc(game.cover).replace(/[\r\n]+/g, '');
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
        .map(
          (game) =>
            `<div class="slot" style="--w:${MEDIA[styleFor(game, S.settings)].w}px" data-act="open" data-id="${game.id}" tabindex="0" role="link" aria-label="${esc(game.t)}">` +
            `${mediaHTML(game, styleFor(game, S.settings), flagOf(game))}` +
            `<div class="cap">${esc(game.t)}</div>` +
            `<div class="foot">${devChip(game)}${gearBtn(game, 'btn sm ico')}</div></div>`
        )
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

export function chipsHTML(kind: 'library' | 'catalog'): string {
  const filters: Array<[FilterKey, string]> =
    kind === 'library'
      ? [
          ['all', 'Todos'],
          ['ready', 'Listos'],
          ['rom', 'Falta ROM'],
          ['upd', 'Actualizaciones'],
        ]
      : [
          ['all', 'Todos'],
          ['new', 'Sin instalar'],
          ['inst', 'Instalados'],
        ];

  const chips = filters
    .map(
      ([key, label]) =>
        `<button class="chip" data-act="filter" data-k="${key}" aria-pressed="${B.filter === key}">${label}</button>`
    )
    .join('');

  const devs = (Object.keys(DEVT) as Array<keyof typeof DEVT>)
    .map(
      (key) =>
        `<option value="${key}" ${B.dev === key ? 'selected' : ''}>${DEVT[key].t}</option>`
    )
    .join('');

  const sortOptions: Array<[SortKey, string]> = [
    ['name', 'Nombre'],
    ['status', 'Estado'],
    ['plat', 'Plataforma'],
    ['recent', 'Recientes'],
  ];
  const sorts = sortOptions
    .map(
      ([key, label]) =>
        `<option value="${key}" ${B.sort === key ? 'selected' : ''}>${label}</option>`
    )
    .join('');

  return (
    chips +
    '<button class="chip" data-act="dest" title="Cambiar sistema de destino">' +
    `Destino: ${esc(S.settings.dest)}</button>` +
    '<label class="muted" style="display:flex;gap:8px;align-items:center">Desarrollo ' +
    `<select class="sel" id="devsel" aria-label="Estado de desarrollo"><option value="all">Todos</option>${devs}</select></label>` +
    '<label class="muted" style="margin-left:auto;display:flex;gap:8px;align-items:center">Orden ' +
    `<select class="sel" id="sortsel" aria-label="Orden">${sorts}</select></label>`
  );
}

/* -------------------------------------------------------------------------- */
/* Héroe «continuar jugando» (`heroHTML`, línea 404)                          */
/* -------------------------------------------------------------------------- */

export function heroHTML(): string {
  const game = S.last ? S.byId.get(S.last) : undefined;
  if (!game || !game.inst) return '';
  const status = statusOf(game);
  return (
    `<section class="hero" style="background:${bgOf(game)}"><div class="shade"></div><div class="in">` +
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
    .map(
      (game) =>
        `<div class="slot" style="--w:${MEDIA[styleFor(game, S.settings)].w}px" data-act="open" data-id="${game.id}" tabindex="0" role="link" aria-label="${esc(game.t)}">` +
        `${mediaHTML(game, styleFor(game, S.settings), flagOf(game))}` +
        `<div class="cap">${esc(game.t)}</div>` +
        `<div class="foot">${devChip(game)}</div></div>`
    )
    .join('');

  const fresh = S.games
    .filter((game) => !game.inst && game.strategy !== 'external')
    .slice(0, 6)
    .map(posterCard)
    .join('');

  return paintMain(
    '<div class="top"><h1>Inicio</h1></div>' +
    (hero || '<div class="empty">Instala un port desde el Catálogo para empezar.</div>') +
    '<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:28px">' +
    stat(installed.length, 'ports instalados', 'var(--text)') +
    stat(installed.filter((game) => kind(game) === 'ready').length, 'listos para jugar', 'var(--accent2)') +
    stat(installed.filter((game) => kind(game) === 'rom').length, 'esperan tu ROM', 'var(--warn)') +
    stat(updateCount(), 'actualizaciones', 'var(--accent)') +
    '</div>' +
    '<section class="shelf"><h2>RECIENTES</h2>' +
    `<div class="rail" style="--n:var(--accent)"><div class="items">${slots}</div></div></section>` +
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
  const news = S.games
    .filter((game) => !game.inst && game.strategy !== 'external' && game.months <= 1)
    .slice(0, 8);

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

  return paintMain(
    `<div class="dhero" style="background:${bgOf(game)}">` +
    '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,9,18,.15),rgba(10,9,18,.85))"></div>' +
    '<a href="#biblioteca" data-act="nav" data-to="library" class="pill" style="position:relative;align-self:flex-start;background:rgba(10,9,18,.7);backdrop-filter:blur(6px);padding:8px 14px">← Biblioteca</a>' +
    '<div style="position:relative;display:flex;flex-wrap:wrap;align-items:flex-end;gap:24px;padding-top:70px">' +
    '<div style="flex:1 1 380px;min-width:0">' +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${meta}</div>` +
    `<h1 style="font-size:clamp(32px,6vw,52px);line-height:1;text-shadow:0 4px 24px rgba(0,0,0,.5)">${esc(game.t)}</h1>` +
    `<div style="margin-top:8px;font-size:18px">${esc(game.pr)} · última versión ${esc(game.lv)}</div></div>` +
    '<div style="display:flex;flex-direction:column;gap:8px;align-items:stretch">' +
    (game.strategy === 'external'
      ? '<button class="btn lg pri" data-act="ext">Abrir página del proyecto</button>'
      : game.strategy === 'source-only' && !game.inst
        ? '<button class="btn lg" data-act="toast" data-m="Guía de compilación (simulada)">Ver guía de compilación</button>'
        : cta) +
    `<div style="text-align:center;font-size:12px">${esc(game.st)}${
      game.mb ? ` · ~${game.mb} MB` : ''
    }${game.rom ? ' · necesitarás tu ROM' : ''}</div></div></div></div>` +
    '<div class="dgrid"><div class="dcol">' +
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
    '</aside></div></div>'
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
  xbox: 'XBOX',
  ps2: 'PS2',
  x360: 'X360',
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

export function renderSettings(): string {
  const settings = S.settings;
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
          const current = settings.mediaMap[platformOf(key)] ?? PLATMEDIA[key] ?? '';
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
            `<select class="in-txt" data-map="${key}" style="max-width:260px;height:36px">` +
            `<option value="">${esc(autoLabel(key, settings))}</option>${options}</select></div>`
          );
        }).join('') +
        '</div>'
      : '';

  const viewButtons = VIEWS.map(
    ([key, label, glyph]) =>
      `<button data-act="view" data-k="${key}" aria-pressed="${settings.view === key}" aria-label="${label}" title="${label}">${glyph}</button>`
  ).join('');

  return paintMain(
    '<div class="top"><h1>Ajustes</h1></div>' +
    '<div style="display:flex;flex-direction:column;gap:22px;max-width:980px">' +
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
          `<div class="slot" style="--w:${MEDIA[styleFor(game, settings)].w}px;cursor:default">` +
          `${mediaHTML(game, styleFor(game, settings), false)}<div class="cap">${esc(game.t)}</div></div>`
      )
      .join('') +
    '</div><div class="board"></div></div></section>' +
    /* BIBLIOTECA */
    '<section class="box"><div class="lbl" style="padding:0">BIBLIOTECA</div>' +
    '<h2 style="font-size:18px">Vista predeterminada</h2>' +
    `<div class="seg" style="align-self:flex-start">${viewButtons}</div></section>` +
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
    '</div></section>' +
    /* SISTEMA */
    '<section class="box"><div class="lbl" style="padding:0">SISTEMA</div>' +
    '<div class="kv"><span>Destino de los ports</span>' +
    `<button class="btn sm" data-act="dest">${esc(settings.dest)} (cambiar)</button></div></section>` +
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
    '<div class="muted" style="font-size:12px">El launcher no consulta repositorios ni listados de terceros: solo lee el índice.</div></section>' +
    /* ETIQUETAS */
    '<section class="box"><div class="lbl" style="padding:0">ETIQUETAS DE ESTADO</div>' +
    '<h2 style="font-size:18px">Qué significa cada etiqueta</h2>' +
    DEV_LEGEND.map(
      ([key, text]) =>
        '<div class="kv" style="align-items:center">' +
        `<span class="dev" style="--c:${DEVT[key].c}">${DEVT[key].g} ${DEVT[key].t}</span>` +
        `<span class="muted" style="text-align:right">${esc(text)}</span></div>`
    ).join('') +
    '</section>' +
    /* BIBLIOTECA LOCAL */
    '<section class="box"><div class="lbl" style="padding:0">BIBLIOTECA LOCAL</div>' +
    '<div class="muted">Tus instalaciones, ROMs y ajustes se guardan en este navegador.</div>' +
    '<button class="btn dng" style="align-self:flex-start" data-act="reset">Restablecer biblioteca y ajustes</button></section>' +
    '</div>'
  );
}

/** Traduce una clave visual a `sourcePlatform`. */
function platformOf(key: PlatKey): 'n64' | 'snes' | 'nes' | 'md' | 'gba' | 'gb' | 'nds' | 'n3ds' | 'nsw' | 'psp' | 'ps1' | 'ps2' | 'gcn' | 'xbox' | 'x360' | 'pc' | 'other' {
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
    XBOX: 'xbox',
    PC: 'pc',
    OTRAS: 'other',
  };
  return map[key];
}

export { MEDIA, PLAT, PLAT_KEYS };
