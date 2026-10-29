/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/main.ts
 *
 * Punto de entrada: construye el esqueleto del DOM, monta los componentes
 * persistentes (sidebar, toolbar, modales, cajón, toasts), carga el índice y
 * enruta por hash.
 *
 * Rutas:
 *   #inicio · #biblioteca · #catalogo · #actualizaciones · #ajustes
 *   #port-<pid>   → ficha de detalle (abre el modal sobre el catálogo)
 *
 * Ownership de eventos:
 *   - `delegatePortEvents()`  → acciones de ficha (open/install/play/rom/…)
 *   - `delegateSettingsEvents()` → cambios de ajustes y reset (sin `data-pid`)
 *   - `main.ts`               → `load-more`, botones de navegación interna,
 *                               `Escape` (cierra el overlay superior) y `/`
 *     Las tres delegaciones conviven en `#view` porque sus `data-act` son
 *     disjuntos: las dos primeras ignoran lo que no les corresponde.
 * ========================================================================== */

import '../src/styles/tokens.css';
import '../src/styles/media.css';
import '../src/styles/layout.css';

import type {
  DevTag,
  DestOS,
  LibraryFilter,
  LibraryState,
  PortItem,
  Settings,
  SortKey,
  SourcePlatform,
  ViewMode,
} from './services/types';
import {
  LIBRARY_STATE_LABELS,
  PLATFORM_SHORT,
  SORT_LABELS,
  VIEW_MODES,
} from './services/types';
import { catalogService } from './services/catalogService';
import { libraryService } from './services/libraryService';
import { installerService, isCancelError } from './services/installerService';
import { mountSidebar } from './components/Sidebar';
import type { NavId, SidebarHandle } from './components/Sidebar';
import { mountToolbar } from './components/Toolbar';
import type { ToolbarHandle } from './components/Toolbar';
import {
  delegatePortEvents,
  mediaMarkup,
  mediaStyleOf,
  renderPosters,
} from './components/PostersView';
import type { PortActionKind, ViewShared } from './components/PostersView';
import { renderBigGrid } from './components/BigGridView';
import { renderShelves } from './components/ShelvesView';
import { renderList } from './components/ListView';
import { renderTable } from './components/TableView';
import { mountDetailModal } from './components/DetailModal';
import type { DetailModalHandle } from './components/DetailModal';
import { mountRomAssistant } from './components/RomAssistantModal';
import type { RomAssistantHandle } from './components/RomAssistantModal';
import { mountSettingsDrawer } from './components/SettingsDrawer';
import type { SettingsDrawerHandle } from './components/SettingsDrawer';
import { renderUpdates } from './components/UpdatesView';
import { delegateSettingsEvents, renderSettings } from './components/SettingsView';
import { esc, icon } from './components/Icons';

/* -------------------------------------------------------------------------- */
/* Constantes                                                                 */
/* -------------------------------------------------------------------------- */

/** Fichas por página (el catálogo tiene >1000 y se pinta bajo demanda). */
export const PAGE_SIZE = 120;

const ROUTE_TITLES: Record<NavId, string> = {
  home: 'Inicio',
  library: 'Biblioteca',
  catalog: 'Catálogo',
  updates: 'Actualizaciones',
  settings: 'Ajustes',
};

const HASH_BY_ROUTE: Record<NavId, string> = {
  home: '#inicio',
  library: '#biblioteca',
  catalog: '#catalogo',
  updates: '#actualizaciones',
  settings: '#ajustes',
};

const ROUTE_BY_HASH: Record<string, NavId> = {
  '': 'home',
  inicio: 'home',
  biblioteca: 'library',
  catalogo: 'catalog',
  actualizaciones: 'updates',
  ajustes: 'settings',
};

type ToastKind = 'info' | 'ok' | 'warn' | 'err';

/* -------------------------------------------------------------------------- */
/* Estado de la aplicación                                                    */
/* -------------------------------------------------------------------------- */

interface AppState {
  route: NavId;
  /** Ficha abierta por ruta profunda (`#port-<pid>`). */
  pid: string | null;
  query: string;
  view: ViewMode;
  library: LibraryFilter;
  dev: DevTag | 'all';
  sort: SortKey;
  dest: DestOS;
  platform: SourcePlatform | 'all';
  /** Fichas visibles por página (paginación local). */
  limit: number;
}

function initialState(): AppState {
  const settings = libraryService.getSettings();
  return {
    route: 'home',
    pid: null,
    query: '',
    view: settings.view,
    library: 'all',
    dev: 'all',
    sort: 'name-asc',
    dest: settings.dest,
    platform: 'all',
    limit: PAGE_SIZE,
  };
}

const state = initialState();

/* -------------------------------------------------------------------------- */
/* DOM                                                                        */
/* -------------------------------------------------------------------------- */

interface Shell {
  app: HTMLElement;
  main: HTMLElement;
  view: HTMLElement;
  layer: HTMLElement;
  toasts: HTMLElement;
}

function ensureDom(): Shell {
  let app = document.getElementById('app');
  if (!app) {
    app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
  }

  let main = document.getElementById('main');
  if (!main) {
    main = document.createElement('main');
    main.id = 'main';
    app.append(main);
  }

  let view = document.getElementById('view');
  if (!view) {
    view = document.createElement('div');
    view.id = 'view';
    view.className = 'view';
    main.append(view);
  }

  let layer = document.getElementById('layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'layer';
    document.body.append(layer);
  }

  let toasts = document.getElementById('toast');
  if (!toasts) {
    toasts = document.createElement('div');
    toasts.id = 'toast';
    toasts.setAttribute('aria-live', 'polite');
    toasts.setAttribute('aria-atomic', 'false');
    document.body.append(toasts);
  }

  return { app, main, view, layer, toasts };
}

const shell = ensureDom();

/* -------------------------------------------------------------------------- */
/* Toasts                                                                     */
/* -------------------------------------------------------------------------- */

const TOAST_ICON: Record<ToastKind, string> = {
  info: 'info',
  ok: 'check',
  warn: 'alert',
  err: 'alert',
};

export function toast(message: string, kind: ToastKind = 'info', ms = 4800): void {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  el.innerHTML =
    `<span class="ti" aria-hidden="true">${icon(TOAST_ICON[kind], { size: 16 })}</span>` +
    `<span class="tm">${esc(message)}</span>` +
    '<button type="button" class="tx" aria-label="Cerrar aviso">✕</button>';

  const remove = (): void => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 220);
  };

  el.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.tx')) remove();
  });

  shell.toasts.append(el);
  window.setTimeout(remove, ms);
}

/* -------------------------------------------------------------------------- */
/* Componentes persistentes                                                   */
/* -------------------------------------------------------------------------- */

let sidebar: SidebarHandle;
let toolbar: ToolbarHandle;
let detail: DetailModalHandle;
let romAssistant: RomAssistantHandle;
let drawer: SettingsDrawerHandle;

/** Objeto compartido por todas las vistas (se actualiza antes de cada render). */
const shared: ViewShared = {
  states: libraryService.getStates(),
  settings: libraryService.getSettings(),
  callbacks: {
    onOpen: (pid) => openDetail(pid),
    onGear: (pid) => drawer.open(pid),
    onAction: (pid, kind) => handlePortAction(pid, kind),
  },
};

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

export function parseHash(hash: string = location.hash): { route: NavId; pid: string | null } {
  const raw = hash.replace(/^#\/?/, '').trim();
  if (raw.startsWith('port-')) {
    const pid = raw.slice('port-'.length);
    return { route: 'catalog', pid: pid || null };
  }
  return { route: ROUTE_BY_HASH[raw] ?? 'home', pid: null };
}

function hashFor(route: NavId, pid?: string | null): string {
  if (pid) return `#port-${encodeURIComponent(pid)}`;
  return HASH_BY_ROUTE[route];
}

/** Cambia de vista (y opcionalmente abre una ficha). */
export function navigate(route: NavId, pid?: string | null): void {
  const target = hashFor(route, pid ?? null);
  if (location.hash === target) {
    applyHash();
    return;
  }
  location.hash = target;
}

function applyHash(): void {
  const { route, pid } = parseHash();
  const routeChanged = route !== state.route;
  state.route = route;
  state.pid = pid;
  if (routeChanged) {
    state.limit = PAGE_SIZE;
  }
  render();
  if (pid) {
    detail.open(pid);
  } else if (detail.isOpen()) {
    // Navegar fuera de `#port-…` cierra la ficha (y no rebota al cerrar).
    suppressCloseRedirect = true;
    detail.close();
    suppressCloseRedirect = false;
  }
  if (routeChanged) window.scrollTo({ top: 0, behavior: 'auto' });
}

/* -------------------------------------------------------------------------- */
/* Datos derivados                                                            */
/* -------------------------------------------------------------------------- */

function filteredPorts(): PortItem[] {
  return catalogService.search(
    state.query,
    {
      platform: state.platform,
      dev: state.dev,
      library: state.library,
      onlyVisible: true,
    },
    state.sort
  );
}

function libraryPorts(): PortItem[] {
  const ports: PortItem[] = [];
  for (const game of libraryService.getInstalledPorts()) {
    const port = catalogService.getPortByPid(game.pid);
    if (port) ports.push(port);
  }
  return ports;
}

function libraryCounts(): Record<LibraryFilter, number> {
  const counts = libraryService.getStateCounts();
  const total = Object.keys(libraryService.getState().games).length;
  const visible = catalogService.getVisibleCount();
  return {
    all: visible,
    installed: total,
    'not-installed': Math.max(0, visible - total),
    ready: counts.Ready,
    'needs-rom': counts.NeedsRom,
    updates: counts.UpdateAvailable,
    broken: counts.Broken,
  };
}

function pendingUpdateCount(): number {
  const states = libraryService.getStateCounts();
  const direct = states.UpdateAvailable;
  // Además, instalados cuya versión publicada es más nueva.
  let extra = 0;
  for (const game of libraryService.getInstalledPorts()) {
    if (game.state === 'UpdateAvailable') continue;
    const port = catalogService.getPortByPid(game.pid);
    const published = port?.verifiedRelease?.version;
    if (!published || !game.installedVersion) continue;
    if (published !== game.installedVersion && !game.pinnedVersion) extra += 1;
  }
  return direct + extra;
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

let renderTimer: number | null = null;

function scheduleRender(delay = 120): void {
  if (renderTimer !== null) window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    render();
  }, delay);
}

function render(): void {
  shared.states = libraryService.getStates();
  shared.settings = libraryService.getSettings();

  const ports = state.route === 'catalog' ? filteredPorts() : [];
  const total = catalogService.getVisibleCount();

  paintSidebar();
  paintToolbar(ports.length, total);
  shell.view.innerHTML = renderRoute(ports);
}

function paintSidebar(): void {
  sidebar.update({
    route: state.route,
    platform: state.platform,
    updates: pendingUpdateCount(),
    broken: libraryService.getStateCounts().Broken,
    libraryCount: Object.keys(libraryService.getState().games).length,
    catalogVersion: catalogService.getCatalogVersion(),
    semanticHash: catalogService.getSemanticHash(),
    generatedAt: catalogService.getGeneratedAt() ?? undefined,
    totalPorts: catalogService.getVisibleCount(),
  });
}

function paintToolbar(resultCount: number, totalCount: number): void {
  toolbar.update({
    title: ROUTE_TITLES[state.route],
    subtitle:
      state.route === 'catalog'
        ? `${resultCount} de ${totalCount} puertos`
        : state.route === 'library'
          ? `${libraryPorts().length} instalados · ${totalCount} en el catálogo`
          : undefined,
    query: state.query,
    view: state.view,
    library: state.library,
    dev: state.dev,
    dest: state.dest,
    sort: state.sort,
    platform: state.platform,
    counts: libraryCounts(),
    loading: false,
  });
}

function renderRoute(ports: PortItem[]): string {
  switch (state.route) {
    case 'library':
      return renderLibrary();
    case 'catalog':
      return renderCatalog(ports);
    case 'updates':
      return renderUpdates(catalogService.getPorts(), {
        states: libraryService.getStates(),
        onUpdate: (pid) => handlePortAction(pid, 'update'),
        onOpen: (pid) => openDetail(pid),
      });
    case 'settings':
      return renderSettings({
        settings: libraryService.getSettings(),
        onSettings,
        onReset,
        onToast: toast,
      });
    case 'home':
    default:
      return renderHome();
  }
}

/* ------------------------------- Inicio ---------------------------------- */

function homeStats(): { total: number; platforms: number; installed: number; pending: number } {
  return {
    total: catalogService.getVisibleCount(),
    platforms: catalogService.getPlatformsWithCounts().length,
    installed: Object.keys(libraryService.getState().games).length,
    pending: pendingUpdateCount(),
  };
}

function homeBanner(): string {
  const stats = homeStats();
  const error = catalogService.lastError;
  const notice = error
    ? '<div class="sbox" style="border-color:var(--warn)">' +
      '<h3>Índice no disponible</h3>' +
      `<p style="margin:0;font-size:var(--fs-s)">${esc(error)}</p>` +
      '</div>'
    : '';

  const button = (label: string, act: string, route: NavId, cls = 'btn sm') =>
    `<button type="button" class="${cls}" data-act="${act}" data-route="${route}">` +
    `${icon(routeIcon(route), { size: 15 })}<span>${esc(label)}</span></button>`;

  return (
    notice +
    '<section class="sbox" style="gap:10px">' +
    '<h3>PortsHub · biblioteca de ports</h3>' +
    `<p style="margin:0;font-size:var(--fs-m)">` +
    `<b>${stats.total}</b> ports indexados de <b>${stats.platforms}</b> plataformas · ` +
    `<b>${stats.installed}</b> en tu biblioteca · <b>${stats.pending}</b> actualizaciones pendientes.` +
    '</p>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    button('Explorar catálogo', 'goto', 'catalog', 'btn pri sm') +
    button('Mi biblioteca', 'goto', 'library') +
    button(`Actualizaciones (${stats.pending})`, 'goto', 'updates') +
    button('Ajustes', 'goto', 'settings') +
    '</div>' +
    '</section>'
  );
}

function routeIcon(route: NavId): string {
  switch (route) {
    case 'library':
      return 'lib';
    case 'catalog':
      return 'cat';
    case 'updates':
      return 'upd';
    case 'settings':
      return 'set';
    case 'home':
    default:
      return 'home';
  }
}

/** Bloque de estantería con su rótulo (se omite si no hay fichas). */
function homeShelf(title: string, ports: readonly PortItem[]): string {
  if (ports.length === 0) return '';
  return (
    `<h2 style="margin:0;font-size:var(--fs-l);letter-spacing:var(--ls-caps);` +
    `text-transform:uppercase;color:var(--muted)">${esc(title)}</h2>` +
    renderShelves(ports, shared)
  );
}

function renderHome(): string {
  const all = catalogService.getPorts().filter((port) => port.visible !== false);

  const ready = libraryPorts().filter((port) => {
    const game = libraryService.getLibraryGame(port.pid);
    return game.state === 'Ready' || game.state === 'Installed';
  });

  const recent = [...all]
    .sort((a, b) => {
      const da = Date.parse(a.verifiedRelease?.releasedAt ?? '') || 0;
      const db = Date.parse(b.verifiedRelease?.releasedAt ?? '') || 0;
      return db - da;
    })
    .slice(0, 14);

  const best = [...all]
    .filter((port) => catalogService.getDevTagInfo(port).tag === 'playable')
    .sort((a, b) => catalogService.getDevTagInfo(b).pct - catalogService.getDevTagInfo(a).pct)
    .slice(0, 14);

  const blocks = [
    homeShelf('Continuar jugando', ready),
    homeShelf('Recién llegados', recent),
    homeShelf('Mejor valorados por la comunidad', best),
  ].filter(Boolean);

  return (
    '<div class="view" data-view="home">' +
    homeBanner() +
    (blocks.length > 0 && all.length > 0
      ? blocks.join('')
      : emptyState(
          'cat',
          'El índice está vacío',
          'Ejecuta <span class="mono">python3 catalog-builder/builder.py --offline</span> y copia ' +
            'el resultado en <span class="mono">launcher/public/data/</span>.'
        )) +
    '</div>'
  );
}

/* ------------------------------ Biblioteca -------------------------------- */

function renderLibrary(): string {
  const ports = libraryPorts();
  if (ports.length === 0) {
    return (
      '<div class="view" data-view="library">' +
      emptyState(
        'lib',
        'Tu biblioteca está vacía',
        'Instala un port desde el catálogo y aparecerá aquí con su estado y su ROM.'
      ) +
      '<div style="display:flex;justify-content:center">' +
      '<button type="button" class="btn pri" data-act="goto" data-route="catalog">' +
      `${icon('cat', { size: 16 })}<span>Explorar el catálogo</span></button>` +
      '</div></div>'
    );
  }

  const sorted = [...ports].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return (
    '<div class="view" data-view="library">' +
    renderSummaryStrip(sorted) +
    renderCollection(sorted, 'library') +
    '</div>'
  );
}

function renderSummaryStrip(ports: readonly PortItem[]): string {
  const counts = new Map<LibraryState, number>();
  for (const port of ports) {
    const current = libraryService.getLibraryGame(port.pid).state;
    counts.set(current, (counts.get(current) ?? 0) + 1);
  }
  const chips = [...counts.entries()]
    .map(
      ([stateName, count]) =>
        '<span class="pill">' +
        `<span aria-hidden="true" style="font-size:9px">●</span>` +
        `${esc(LIBRARY_STATE_LABELS[stateName])} · ${count}</span>`
    )
    .join('');
  return `<div class="chips" role="list" aria-label="Estados de tu biblioteca">${chips}</div>`;
}

/* ------------------------------- Catálogo -------------------------------- */

function renderCatalog(ports: PortItem[]): string {
  if (catalogService.lastError) {
    return (
      '<div class="view" data-view="catalog">' +
      emptyState('alert', 'No se pudo cargar el índice', esc(catalogService.lastError)) +
      '</div>'
    );
  }
  if (ports.length === 0) {
    return (
      '<div class="view" data-view="catalog">' +
      emptyState(
        'search',
        'Ningún port coincide',
        'Prueba con otro texto, quita filtros o cambia la plataforma seleccionada.'
      ) +
      '<div style="display:flex;justify-content:center">' +
      '<button type="button" class="btn sm" data-act="clear-filters">Limpiar filtros</button>' +
      '</div></div>'
    );
  }
  return (
    '<div class="view" data-view="catalog">' +
    renderCollection(ports, 'catalog') +
    '</div>'
  );
}

/** Colección con la vista activa + paginación. */
function renderCollection(ports: readonly PortItem[], scope: 'catalog' | 'library'): string {
  const total = ports.length;
  const slice = ports.slice(0, state.limit);
  let body: string;

  switch (state.view) {
    case 'big':
      body = renderBigGrid(slice, shared);
      break;
    case 'shelves':
      body = renderShelves(slice, shared);
      break;
    case 'list':
      body = renderList(slice, shared);
      break;
    case 'table':
      body = renderTable(slice, shared);
      break;
    case 'posters':
    default:
      body = renderPosters(slice, shared);
      break;
  }

  const remaining = total - slice.length;
  const more =
    remaining > 0
      ? '<div style="display:flex;justify-content:center;padding:var(--sp-3) 0">' +
        '<button type="button" class="btn" data-act="load-more" ' +
        `data-scope="${scope}" title="Mostrar más resultados">` +
        `${icon('arrowDown', { size: 15 })}` +
        `<span>Cargar más (${remaining} restantes)</span></button></div>`
      : '';

  const count =
    total > slice.length
      ? `<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">` +
        `Mostrando ${slice.length} de ${total} · vista ${esc(VIEW_MODES.includes(state.view) ? state.view : 'posters')} · ` +
        `orden ${esc(SORT_LABELS[state.sort])}</p>`
      : '';

  return count + body + more;
}

/* ------------------------------- Auxiliares ------------------------------- */

function emptyState(iconName: string, title: string, textHtml: string): string {
  return (
    '<div class="empty">' +
    `<span class="eico" aria-hidden="true">${icon(iconName, { size: 30 })}</span>` +
    `<span class="etit">${esc(title)}</span>` +
    `<span style="max-width:56ch;font-size:var(--fs-s)">${textHtml}</span>` +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Overlay de lanzamiento                                                     */
/* -------------------------------------------------------------------------- */

interface LaunchOverlay {
  el: HTMLElement;
  set(pct: number, stage: string): void;
  close(): void;
}

let launching: { overlay: LaunchOverlay; cancel?: () => void } | null = null;

function showLaunch(
  port: PortItem | null,
  opts: { title: string; sub?: string; pct?: number; stage?: string; cancellable?: boolean; onCancel?: () => void }
): LaunchOverlay {
  closeLaunch();

  const el = document.createElement('div');
  el.className = 'launch';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', opts.title);

  const media = port
    ? mediaMarkup(mediaStyleOf(port, libraryService.getSettings()), {
        size: 'sz-l',
        label: PLATFORM_SHORT[port.sourcePlatform] ?? '',
      })
    : '';

  el.innerHTML =
    '<div class="lwrap">' +
    `<div class="lart" aria-hidden="true">${media}</div>` +
    `<div class="ltitle">${esc(opts.title)}</div>` +
    `<div class="lsub">${esc(opts.sub ?? '')}</div>` +
    `<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" ` +
    `aria-valuenow="${Math.round(opts.pct ?? 0)}"><i style="width:${Math.round(opts.pct ?? 0)}%"></i></div>` +
    `<div class="lsub" data-stage>${esc(opts.stage ?? '')}</div>` +
    (opts.cancellable
      ? '<button type="button" class="btn sm" data-act="launch-cancel">Cancelar</button>'
      : '') +
    '</div>';

  shell.layer.append(el);

  const bar = el.querySelector<HTMLElement>('.prog > i');
  const barHost = el.querySelector<HTMLElement>('.prog');
  const stageEl = el.querySelector<HTMLElement>('[data-stage]');

  function set(pct: number, stage: string): void {
    const safe = Math.max(0, Math.min(100, Math.round(pct)));
    if (bar) bar.style.width = `${safe}%`;
    if (barHost) barHost.setAttribute('aria-valuenow', String(safe));
    if (stageEl) stageEl.textContent = stage;
  }

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-act="launch-cancel"]')) return;
    event.preventDefault();
    opts.onCancel?.();
  };
  el.addEventListener('click', onClick);

  const overlay: LaunchOverlay = {
    el,
    set,
    close(): void {
      el.removeEventListener('click', onClick);
      el.remove();
    },
  };

  launching = { overlay, cancel: opts.onCancel };
  return overlay;
}

function closeLaunch(): void {
  if (!launching) return;
  launching.overlay.close();
  launching = null;
}

/* -------------------------------------------------------------------------- */
/* Acciones                                                                   */
/* -------------------------------------------------------------------------- */

let suppressCloseRedirect = false;

function openDetail(pid: string): void {
  if (state.route !== 'catalog') {
    navigate('catalog', pid);
    return;
  }
  if (location.hash !== `#port-${encodeURIComponent(pid)}`) {
    history.replaceState(null, '', `#port-${encodeURIComponent(pid)}`);
  }
  state.pid = pid;
  detail.open(pid);
}

function officialUrl(port: PortItem): string {
  const repository = typeof port.repository === 'string' ? port.repository : '';
  if (repository && /^[^/\s]+\/[^/\s]+$/.test(repository)) return `https://github.com/${repository}`;
  const raw = port.raw ?? {};
  for (const key of ['projectUrl', 'officialUrl', 'homepage', 'downloadPageUrl']) {
    const value = raw[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  }
  return '';
}

function openExternal(pid: string): void {
  const port = catalogService.getPortByPid(pid);
  if (!port) return;
  const url = officialUrl(port);
  if (!url) {
    toast(`${port.name} no declara una web oficial en el índice.`, 'warn');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function isReadyState(value: LibraryState): boolean {
  return value === 'Ready' || value === 'Installed';
}

function startInstall(pid: string, mode: 'install' | 'update' = 'install'): void {
  const port = catalogService.getPortByPid(pid);
  if (!port) {
    toast('No se encontró la ficha en el índice.', 'err');
    return;
  }
  if (installerService.isInstalling(pid)) {
    toast(`${port.name} ya se está instalando.`, 'warn');
    return;
  }

  const overlay = showLaunch(port, {
    title: mode === 'update' ? `Actualizando ${port.name}` : `Instalando ${port.name}`,
    sub: port.installStrategy,
    cancellable: true,
    onCancel: () => installerService.cancelInstall(pid),
  });
  overlay.set(0, 'Preparando…');

  installerService
    .installPort(port, (pct, stage) => overlay.set(pct, stage))
    .then((game) => {
      closeLaunch();
      render();
      if (game.state === 'NeedsRom') {
        toast(`${port.name}: falta la ROM del juego original.`, 'warn');
        romAssistant.open(pid, {
          primaryLabel: 'Guardar y jugar',
          secondaryLabel: 'Hacerlo después',
          playAfterSave: true,
        });
        return;
      }
      toast(
        mode === 'update' ? `${port.name} actualizado.` : `${port.name} instalado y listo.`,
        'ok'
      );
    })
    .catch((error: unknown) => {
      closeLaunch();
      render();
      if (isCancelError(error)) {
        toast('Instalación cancelada. No se ha modificado nada.', 'warn');
        return;
      }
      toast(
        `No se pudo completar: ${error instanceof Error ? error.message : String(error)}`,
        'err'
      );
    });
}

async function updateAll(pids: readonly string[]): Promise<void> {
  if (pids.length === 0) return;
  const overlay = showLaunch(null, {
    title: `Actualizando ${pids.length} ports`,
    sub: 'Se procesan en serie',
    cancellable: false,
  });
  let done = 0;
  let failed = 0;
  for (const pid of pids) {
    const port = catalogService.getPortByPid(pid);
    if (!port) continue;
    try {
      await installerService.installPort(port, (pct) => {
        const global = ((done + pct / 100) / pids.length) * 100;
        overlay.set(global, `${port.name} · ${done + 1}/${pids.length}`);
      });
      done += 1;
    } catch (error) {
      failed += 1;
      if (isCancelError(error)) break;
    }
  }
  closeLaunch();
  render();
  toast(
    failed > 0
      ? `${done} actualizados, ${failed} con errores.`
      : `${done} ports actualizados.`,
    failed > 0 ? 'warn' : 'ok'
  );
}

function playPort(pid: string): void {
  const port = catalogService.getPortByPid(pid);
  if (!port) return;
  const game = libraryService.getLibraryGame(pid);

  if (game.state === 'NeedsRom') {
    romAssistant.open(pid, {
      primaryLabel: 'Guardar y jugar',
      secondaryLabel: 'Hacerlo después',
      playAfterSave: true,
    });
    return;
  }
  if (!isReadyState(game.state)) {
    if (game.state === 'Broken' || game.state === 'NotInstalled') {
      startInstall(pid, 'install');
      return;
    }
    toast(`${port.name} todavía no está listo (${LIBRARY_STATE_LABELS[game.state]}).`, 'warn');
    return;
  }

  const runner = game.launchProfile?.runner ?? port.launch?.runner ?? 'native';
  const overlay = showLaunch(port, {
    title: `Iniciando ${port.name}`,
    sub: `runner: ${runner} · ${game.installDir || port.folderName || 'carpeta del port'}`,
    stage: 'Arrancando el ejecutable…',
    pct: 100,
  });
  window.setTimeout(() => {
    overlay.close();
    launching = null;
    toast(
      'Lanzamiento simulado: en esta fase PortsHub no ejecuta binarios del sistema.',
      'info'
    );
  }, 1400);
}

function handlePortAction(pid: string, kind: PortActionKind): void {
  switch (kind) {
    case 'install':
      startInstall(pid, 'install');
      return;
    case 'update':
      startInstall(pid, 'update');
      return;
    case 'retry':
      startInstall(pid, 'install');
      return;
    case 'play':
      playPort(pid);
      return;
    case 'rom':
      romAssistant.open(pid, {
        primaryLabel: 'Guardar y jugar',
        secondaryLabel: 'Hacerlo después',
        playAfterSave: true,
      });
      return;
    case 'external':
      openExternal(pid);
      return;
    case 'gear':
      drawer.open(pid);
      return;
    case 'open':
    case 'details':
    default:
      openDetail(pid);
  }
}

function uninstall(pid: string, keepSaves: boolean): void {
  const port = catalogService.getPortByPid(pid);
  libraryService.uninstallPort(pid);
  drawer.close();
  render();
  toast(
    keepSaves
      ? `${port?.name ?? pid} desinstalado. Partidas y ajustes conservados.`
      : `${port?.name ?? pid} desinstalado.`,
    'ok'
  );
}

function onSettings(patch: Partial<Settings>): void {
  const next = libraryService.updateSettings(patch);
  state.dest = next.dest;
  // La "vista por defecto" se aplica al cambiarla, pero el selector de la
  // toolbar sigue siendo efímero (no reescribe esta preferencia).
  if (patch.view) state.view = next.view;
  toast('Ajustes guardados.', 'ok', 1800);
  render();
}

function onReset(): void {
  libraryService.resetLibrary();
  state.library = 'all';
  state.dev = 'all';
  state.platform = 'all';
  state.limit = PAGE_SIZE;
  render();
  toast('Biblioteca y ajustes restablecidos.', 'ok');
}

/* -------------------------------------------------------------------------- */
/* Atajos de teclado                                                          */
/* -------------------------------------------------------------------------- */

function isTextField(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT';
}

/** Cierra el overlay superior en orden de apilado (LIFO). */
function closeTopOverlay(): boolean {
  if (launching) {
    launching.cancel?.();
    if (!launching.cancel) closeLaunch();
    return true;
  }
  if (romAssistant.isOpen()) {
    romAssistant.close();
    return true;
  }
  if (detail.isOpen()) {
    detail.close();
    return true;
  }
  if (drawer.isOpen()) {
    drawer.close();
    return true;
  }
  return false;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (closeTopOverlay()) event.preventDefault();
    return;
  }
  if (event.key !== '/' || event.defaultPrevented) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTextField(event.target)) return;
  event.preventDefault();
  toolbar.focusSearch();
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

function mountComponents(): void {
  sidebar = mountSidebar({
    sideHost: shell.app,
    bnavHost: document.body,
    state: {
      route: state.route,
      platform: state.platform,
    },
    callbacks: {
      onNavigate: (route) => navigate(route),
      onPlatform: (platform) => {
        state.platform = platform;
        state.limit = PAGE_SIZE;
        if (state.route !== 'catalog') navigate('catalog');
        else render();
      },
      onOpenSettings: () => navigate('settings'),
      onOpenUpdates: () => navigate('updates'),
      onLibraryFilter: (filter) => {
        state.library = filter;
        navigate('library');
      },
    },
  });

  toolbar = mountToolbar(shell.main, {
    state: {
      title: ROUTE_TITLES[state.route],
      view: state.view,
      library: state.library,
      dev: state.dev,
      dest: state.dest,
      sort: state.sort,
      platform: state.platform,
    },
    callbacks: {
      onQuery: (query) => {
        state.query = query;
        state.limit = PAGE_SIZE;
        if (state.route !== 'catalog' && query.trim()) {
          navigate('catalog');
          return;
        }
        scheduleRender(0);
      },
      onSubmit: () => scheduleRender(0),
      onView: (view) => {
        state.view = view;
        render();
      },
      onLibrary: (library) => {
        state.library = library;
        state.limit = PAGE_SIZE;
        render();
      },
      onDev: (dev) => {
        state.dev = dev;
        state.limit = PAGE_SIZE;
        render();
      },
      onDest: (dest) => {
        state.dest = dest;
        libraryService.updateSettings({ dest });
      },
      onSort: (sort) => {
        state.sort = sort;
        render();
      },
      onClearPlatform: () => {
        state.platform = 'all';
        render();
      },
      onClearTarget: () => {
        render();
      },
    },
  });

  detail = mountDetailModal({
    host: shell.layer,
    onAction: handlePortAction,
    onGear: (pid) => drawer.open(pid),
    onOpen: (pid) => openDetail(pid),
    onClose: () => {
      if (suppressCloseRedirect) return;
      if (state.pid) {
        state.pid = null;
        if (location.hash.startsWith('#port-')) {
          history.replaceState(null, '', HASH_BY_ROUTE.catalog);
        }
      }
    },
  });

  romAssistant = mountRomAssistant({
    host: shell.layer,
    onToast: toast,
    onCancel: () => {
      /* Cerrar sin guardar no cambia la ficha. */
    },
    onSaved: (pid, _validation, opts) => {
      render();
      if (opts.play) playPort(pid);
    },
  });

  drawer = mountSettingsDrawer({
    host: shell.layer,
    onToast: toast,
    onUninstall: uninstall,
    onChanged: () => {
      render();
    },
    onOpenRomAssistant: (pid) => {
      romAssistant.open(pid, { primaryLabel: 'Guardar', secondaryLabel: 'Cancelar' });
    },
    onLaunch: (pid) => {
      drawer.close();
      playPort(pid);
    },
  });

  /* Delegación de fichas (sobrevive a los repintados de `#view`). */
  delegatePortEvents(shell.view, shared);

  /* Ajustes (change + reset) sobre el mismo contenedor. */
  delegateSettingsEvents(shell.view, {
    onSettings,
    onReset,
    onToast: toast,
  });

  /* Acciones propias de la cáscara: navegación interna y paginación. */
  shell.view.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hit = target.closest<HTMLElement>('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;

    if (act === 'load-more') {
      event.preventDefault();
      state.limit += PAGE_SIZE;
      render();
      return;
    }
    if (act === 'goto') {
      event.preventDefault();
      const route = hit.dataset.route as NavId | undefined;
      if (route && route in HASH_BY_ROUTE) navigate(route);
      return;
    }
    if (act === 'clear-filters') {
      event.preventDefault();
      state.query = '';
      state.library = 'all';
      state.dev = 'all';
      state.platform = 'all';
      state.limit = PAGE_SIZE;
      toolbar.update({ query: '', library: 'all', dev: 'all', platform: 'all' });
      render();
    }
  });

  document.addEventListener('keydown', onKeyDown);

  /* Router por hash: `navigate()` cambia `location.hash` y esto lo aplica. */
  window.addEventListener('hashchange', applyHash);

  libraryService.subscribe((event) => {
    // El progreso de una instalación no debe repintar todo el catálogo.
    if (event.type === 'game' && event.pid && installerService.isInstalling(event.pid)) return;
    scheduleRender();
    if (drawer.isOpen() && event.pid) drawer.refresh();
  });
}

/**
 * Arranca la aplicación: monta componentes, carga el índice y aplica la ruta.
 * Se exporta para poder reutilizarla en pruebas o en un arranque diferido.
 */
export async function boot(): Promise<void> {
  mountComponents();
  applyHash();

  try {
    const index = await catalogService.loadCatalog();
    if (catalogService.lastError) {
      toast(catalogService.lastError, 'warn', 9000);
    } else if (index.stats?.totalPorts !== undefined) {
      toast(
        `Índice ${index.version} cargado · ${index.stats.totalPorts} puertos.`,
        'info',
        2600
      );
    }
  } catch (error) {
    toast(
      `No se pudo cargar el catálogo: ${error instanceof Error ? error.message : String(error)}`,
      'err',
      9000
    );
  }

  render();
  applyHash();
}

/* Arranque automático al cargar el módulo (Vite inyecta este script). */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot());
  } else {
    void boot();
  }
}
