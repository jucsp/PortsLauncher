/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/Sidebar.ts
 *
 * Menú lateral `#side` y navegación inferior móvil `.bnav`.
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   #side > .brand (.logo / .name / .ver)
 *   #side > nav > .navi (.ico / .t / .n)
 *   #side > .group           (rótulo de sección)
 *   #side > .side-foot       (caja de procedencia del índice)
 *   .bnav > button.on > .ico
 *
 * Los contadores se leen de `catalogService` y `libraryService` cuando el
 * llamante no los inyecta en el estado, de modo que la barra refleja siempre
 * el catálogo realmente cargado (y sigue funcionando en modo degradado, con 0).
 *
 * Montaje: `mountSidebar()` crea los nodos raíz **una sola vez** y a partir de
 * ahí sólo sustituye su `innerHTML`; así el listener delegado nunca se pierde.
 * ========================================================================== */

import type { SourcePlatform } from '../services/types';
import { CATALOG_PLATFORMS, PLATFORM_LABELS, PLATFORM_SHORT } from '../services/types';
import { catalogService } from '../services/catalogService';
import { libraryService } from '../services/libraryService';
import { cx, esc, icon, styleAttr } from './Icons';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export type NavId = 'home' | 'library' | 'catalog' | 'updates' | 'settings';

export interface SidebarRoute {
  id: NavId;
  label: string;
  /** Clave del diccionario de iconos (`Icons.IC`). */
  icon: string;
  /** Icono alternativo para la barra móvil. */
  mobileIcon?: string;
}

/** Orden canónico de las rutas principales. */
export const SIDEBAR_ROUTES: readonly SidebarRoute[] = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'library', label: 'Biblioteca', icon: 'lib' },
  { id: 'catalog', label: 'Catálogo', icon: 'cat' },
  { id: 'updates', label: 'Actualizaciones', icon: 'upd', mobileIcon: 'upd' },
  { id: 'settings', label: 'Ajustes', icon: 'set' },
];

/** Rutas de la barra inferior móvil (5 como máximo, spec v5). */
export const BOTTOM_NAV_ROUTES: readonly NavId[] = [
  'home',
  'library',
  'catalog',
  'updates',
  'settings',
];

export interface SidebarState {
  /** Ruta activa. */
  route: NavId;
  /** Plataforma seleccionada en el árbol lateral (`all` = todas). */
  platform: SourcePlatform | 'all';
  /** Contadores por plataforma (si faltan se piden al catálogo). */
  counts?: Partial<Record<SourcePlatform, number>>;
  /** Nº de fichas en la biblioteca local. */
  libraryCount?: number;
  /** Nº de actualizaciones pendientes (badge de `updates`). */
  updates?: number;
  /** Nº de fichas rotas. */
  broken?: number;
  /** Versión del launcher (marca). */
  version?: string;
  /** Versión del catálogo indexado. */
  catalogVersion?: string;
  /** Hash semántico del índice. */
  semanticHash?: string;
  /** Fecha ISO de generación del índice. */
  generatedAt?: string;
  /** Total de puertos visibles del índice. */
  totalPorts?: number;
}

export interface SidebarCallbacks {
  onNavigate?: (route: NavId) => void;
  onPlatform?: (platform: SourcePlatform | 'all') => void;
  /** Atajo "Ajustes" desde el pie. */
  onOpenSettings?: () => void;
  /** Atajo al panel de actualizaciones. */
  onOpenUpdates?: () => void;
  /** Filtro de biblioteca solicitado desde el aviso de fichas rotas. */
  onLibraryFilter?: (filter: 'broken') => void;
}

export interface SidebarHandle {
  /** Nodo raíz `#side` (estable entre repintados). */
  readonly side: HTMLElement;
  /** Nodo raíz `#bnav` (estable entre repintados). */
  readonly bnav: HTMLElement;
  update: (patch: Partial<SidebarState>) => void;
  getState: () => SidebarState;
  destroy: () => void;
}

export const LAUNCHER_VERSION = '1.0.0';

/* -------------------------------------------------------------------------- */
/* Estado                                                                     */
/* -------------------------------------------------------------------------- */

/** Completa el estado con los datos reales de los servicios. */
export function resolveSidebarState(patch: Partial<SidebarState> = {}): SidebarState {
  const counts: Partial<Record<SourcePlatform, number>> = { ...(patch.counts ?? {}) };
  if (patch.counts === undefined) {
    for (const item of catalogService.getPlatformsWithCounts()) {
      counts[item.id] = item.count;
    }
  }

  const stateCounts = libraryService.getStateCounts();
  const installed = Object.keys(libraryService.getState().games).length;

  return {
    route: patch.route ?? 'home',
    platform: patch.platform ?? 'all',
    counts,
    libraryCount: patch.libraryCount ?? installed,
    updates: patch.updates ?? stateCounts.UpdateAvailable ?? 0,
    broken: patch.broken ?? stateCounts.Broken ?? 0,
    version: patch.version ?? LAUNCHER_VERSION,
    catalogVersion: patch.catalogVersion ?? catalogService.getCatalogVersion(),
    semanticHash: patch.semanticHash ?? catalogService.getSemanticHash(),
    generatedAt: patch.generatedAt ?? catalogService.getGeneratedAt() ?? undefined,
    totalPorts: patch.totalPorts ?? catalogService.getVisibleCount(),
  };
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

/** Variable CSS del neón de plataforma (`--p-n64-neon`). */
export function platNeonVar(platform: SourcePlatform): string {
  return `var(--p-${platform}-neon, var(--muted))`;
}

const MONO = 'font-family:var(--f-mono);font-size:var(--fs-2xs);color:var(--muted)';

function brandMarkup(state: SidebarState): string {
  return (
    '<div class="brand">' +
    '<span class="logo" aria-hidden="true"></span>' +
    '<div style="min-width:0">' +
    '<div class="name">PORTSHUB</div>' +
    `<span class="ver">v${esc(state.version ?? LAUNCHER_VERSION)} · ${state.totalPorts ?? 0} ports</span>` +
    '</div>' +
    '</div>'
  );
}

function navButton(
  route: SidebarRoute,
  state: SidebarState,
  opts: { count?: number; title?: string } = {}
): string {
  const active = state.route === route.id;
  const count = opts.count && opts.count > 0 ? `<span class="n">${opts.count}</span>` : '';
  const title = opts.title ? `${route.label} · ${opts.title}` : route.label;
  return (
    `<button type="button" class="${cx('navi', active && 'on')}" data-nav="${route.id}" ` +
    `aria-current="${active ? 'page' : 'false'}" title="${esc(title)}">` +
    `<span class="ico" aria-hidden="true">${icon(route.icon, { size: 19 })}</span>` +
    `<span class="t">${esc(route.label)}</span>` +
    count +
    '</button>'
  );
}

function platformButton(platform: SourcePlatform, state: SidebarState): string {
  const active = state.platform === platform;
  const count = state.counts?.[platform] ?? 0;
  const neon = platNeonVar(platform);
  const dot = styleAttr({
    width: '9px',
    height: '9px',
    'border-radius': '50%',
    background: neon,
    'box-shadow': `0 0 8px ${neon}`,
  });
  return (
    `<button type="button" class="${cx('navi', active && 'on')}" data-plat="${platform}" ` +
    `aria-current="${active ? 'page' : 'false'}" ` +
    `title="${esc(`${PLATFORM_LABELS[platform]} · ${count} puertos`)}">` +
    `<span class="ico" aria-hidden="true"><span${dot}></span></span>` +
    `<span class="t">${esc(PLATFORM_SHORT[platform])}</span>` +
    (count > 0 ? `<span class="n">${count}</span>` : '') +
    '</button>'
  );
}

function shortHash(hash: string | undefined): string {
  if (!hash) return 'sin índice';
  const clean = hash.replace(/^sha256:/, '');
  return `sha256:${clean.slice(0, 8)}…`;
}

function provenanceMarkup(state: SidebarState): string {
  const gen = state.generatedAt ? state.generatedAt.slice(0, 10) : '—';
  const ver = state.catalogVersion || '—';
  const broken =
    state.broken && state.broken > 0
      ? `<button type="button" class="btn sm warn" data-nav="library" data-libfilter="broken" ` +
        `title="Ver fichas rotas">${icon('alert', { size: 15 })}<span>${state.broken} rotas</span></button>`
      : '';
  return (
    '<div class="side-foot">' +
    '<div class="group" style="padding:0 0 2px">Índice PortsHub</div>' +
    `<div class="mono" style="${MONO}" title="Versión y fecha del índice">` +
    `Catálogo ${esc(ver)} · ${esc(gen)}</div>` +
    `<div class="mono" style="${MONO}" title="Hash semántico del índice">` +
    `${esc(shortHash(state.semanticHash))}</div>` +
    broken +
    `<button type="button" class="btn sm" data-nav="settings" title="Abrir ajustes">` +
    `${icon('set', { size: 15 })}<span>Ajustes</span></button>` +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

/** Contenido interno de `#side` (sin el nodo raíz). */
export function sidebarInner(state: SidebarState): string {
  const main = SIDEBAR_ROUTES.filter((r) => r.id !== 'settings')
    .map((r) => {
      if (r.id === 'updates') {
        const n = state.updates ?? 0;
        return navButton(r, state, { count: n, title: `${n} pendientes` });
      }
      if (r.id === 'library') {
        return navButton(r, state, { count: state.libraryCount ?? 0 });
      }
      return navButton(r, state);
    })
    .join('');

  const allActive = state.platform === 'all';
  const allButton =
    `<button type="button" class="${cx('navi', allActive && 'on')}" data-plat="all" ` +
    `aria-current="${allActive ? 'page' : 'false'}" title="Todas las plataformas">` +
    `<span class="ico" aria-hidden="true">${icon('grid3', { size: 17 })}</span>` +
    '<span class="t">Todas</span>' +
    `<span class="n">${state.totalPorts ?? 0}</span>` +
    '</button>';

  const platforms = CATALOG_PLATFORMS.map((p) => platformButton(p, state)).join('');

  return (
    brandMarkup(state) +
    `<nav aria-label="Secciones">${main}</nav>` +
    '<div class="group">Plataformas</div>' +
    `<nav aria-label="Plataformas">${allButton}${platforms}</nav>` +
    provenanceMarkup(state)
  );
}

/** Menú lateral completo (`<aside id="side">`). */
export function renderSidebar(state: SidebarState): string {
  return `<aside id="side" class="side" aria-label="Navegación principal">${sidebarInner(state)}</aside>`;
}

/** Contenido interno de `.bnav` (sin el nodo raíz). */
export function bottomNavInner(state: SidebarState): string {
  return BOTTOM_NAV_ROUTES.map((id) => {
    const route = SIDEBAR_ROUTES.find((r) => r.id === id);
    if (!route) return '';
    const active = state.route === route.id;
    const badge =
      route.id === 'updates' && (state.updates ?? 0) > 0
        ? `<span class="flag" data-kind="info" style="position:absolute;top:2px;right:12px">` +
          `${state.updates}</span>`
        : '';
    return (
      `<button type="button" class="${cx(active && 'on')}" data-nav="${route.id}" ` +
      `aria-current="${active ? 'page' : 'false'}">` +
      `<span class="ico" aria-hidden="true">${icon(route.mobileIcon ?? route.icon, { size: 18 })}</span>` +
      `${esc(route.label)}${badge}</button>`
    );
  }).join('');
}

/** Barra inferior móvil (`.bnav`). */
export function renderBottomNav(state: SidebarState): string {
  return `<nav id="bnav" class="bnav" aria-label="Navegación principal">${bottomNavInner(state)}</nav>`;
}

/* -------------------------------------------------------------------------- */
/* Montaje                                                                    */
/* -------------------------------------------------------------------------- */

export interface MountSidebarOptions {
  /** Contenedor donde insertar `#side` (por defecto `#app`). */
  sideHost?: HTMLElement | null;
  /** Contenedor donde insertar `#bnav` (por defecto `document.body`). */
  bnavHost?: HTMLElement | null;
  state?: Partial<SidebarState>;
  callbacks?: SidebarCallbacks;
}

/**
 * Inserta el menú lateral y la barra móvil, y cablea los clics con delegación
 * sobre los nodos raíz (que nunca se recrean).
 */
export function mountSidebar(opts: MountSidebarOptions = {}): SidebarHandle {
  const callbacks = opts.callbacks ?? {};
  let state = resolveSidebarState(opts.state ?? {});

  const sideEl = document.createElement('aside');
  sideEl.id = 'side';
  sideEl.className = 'side';
  sideEl.setAttribute('aria-label', 'Navegación principal');
  sideEl.innerHTML = sidebarInner(state);

  const bnavEl = document.createElement('nav');
  bnavEl.id = 'bnav';
  bnavEl.className = 'bnav';
  bnavEl.setAttribute('aria-label', 'Navegación principal');
  bnavEl.innerHTML = bottomNavInner(state);

  const sideHost = opts.sideHost ?? document.getElementById('app');
  if (sideHost) sideHost.prepend(sideEl);
  else document.body.prepend(sideEl);

  const bnavHost = opts.bnavHost ?? document.body;
  bnavHost.append(bnavEl);

  function paint(): void {
    sideEl.innerHTML = sidebarInner(state);
    bnavEl.innerHTML = bottomNavInner(state);
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const navHit = target.closest<HTMLElement>('[data-nav]');
    if (navHit) {
      const id = navHit.dataset.nav as NavId | undefined;
      if (!id) return;
      event.preventDefault();
      if (id === 'settings') callbacks.onOpenSettings?.();
      if (id === 'updates') callbacks.onOpenUpdates?.();
      callbacks.onNavigate?.(id);
      state = { ...state, route: id };
      paint();
      return;
    }

    const platHit = target.closest<HTMLElement>('[data-plat]');
    if (platHit) {
      const raw = platHit.dataset.plat;
      const platform: SourcePlatform | 'all' =
        !raw || raw === 'all' ? 'all' : (raw as SourcePlatform);
      event.preventDefault();
      callbacks.onPlatform?.(platform);
      state = { ...state, platform };
      paint();
    }
  }

  sideEl.addEventListener('click', onClick);
  bnavEl.addEventListener('click', onClick);

  return {
    side: sideEl,
    bnav: bnavEl,
    update(patch: Partial<SidebarState>): void {
      state = resolveSidebarState({ ...state, ...patch });
      paint();
    },
    getState(): SidebarState {
      return state;
    },
    destroy(): void {
      sideEl.removeEventListener('click', onClick);
      bnavEl.removeEventListener('click', onClick);
      sideEl.remove();
      bnavEl.remove();
    },
  };
}

/**
 * Alterna la visibilidad del menú lateral en móvil (`.open` en `#side`).
 * Devuelve el nuevo estado.
 */
export function toggleSidebar(force?: boolean): boolean {
  const side = document.getElementById('side');
  if (!side) return false;
  const open = force ?? !side.classList.contains('open');
  side.classList.toggle('open', open);
  return open;
}

export default renderSidebar;
