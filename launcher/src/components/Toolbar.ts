/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/Toolbar.ts
 *
 * Barra superior `.top`: título de la vista, buscador con atajo `/`, selector
 * de vistas, chips de filtro por biblioteca, y selectores de destino,
 * desarrollo y ordenación.
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   .top > .title (h1 + .sub)
 *   .top > .search (input + kbd)
 *   .top > .seg > button[aria-pressed]
 *   .top > .chips > .chip[aria-pressed] (.dot / .x)
 *   .top > select.sel
 *
 * Atajo de teclado: `/` enfoca el buscador (se ignora si el foco ya está en un
 * campo de texto o si hay modificadores). `Escape` limpia y devuelve el foco.
 * ========================================================================== */

import type { DestOS, DevTag, LibraryFilter, SortKey, SourcePlatform, TargetPlatform, ViewMode } from '../services/types';
import {
  DEST_OPTIONS,
  DEV_TAGS,
  DEV_TAG_META,
  LIBRARY_FILTER_LABELS,
  PLATFORM_SHORT,
  SORT_KEYS,
  SORT_LABELS,
  TARGET_LABELS,
  VIEW_MODES,
} from '../services/types';
import { esc, icon, styleAttr } from './Icons';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export interface ToolbarState {
  /** Título de la vista actual ("Inicio", "Catálogo", "Biblioteca"…). */
  title: string;
  /** Línea de contexto bajo el título. */
  subtitle?: string;
  /** Texto del buscador. */
  query: string;
  view: ViewMode;
  /** Filtro por presencia en la biblioteca. */
  library: LibraryFilter;
  /** Filtro por estado de desarrollo. */
  dev: DevTag | 'all';
  dest: DestOS;
  sort: SortKey;
  /** Plataforma de origen activa (chip removible). */
  platform?: SourcePlatform | 'all';
  /** Plataforma de destino activa. */
  target?: TargetPlatform | 'all';
  /** Nº de resultados tras aplicar filtros. */
  resultCount?: number;
  /** Nº total antes de filtrar. */
  totalCount?: number;
  /** Contadores por chip de biblioteca. */
  counts?: Partial<Record<LibraryFilter, number>>;
  /** Muestra el indicador de carga del catálogo. */
  loading?: boolean;
}

export interface ToolbarCallbacks {
  onQuery?: (query: string) => void;
  onSubmit?: (query: string) => void;
  onView?: (view: ViewMode) => void;
  onLibrary?: (filter: LibraryFilter) => void;
  onDev?: (dev: DevTag | 'all') => void;
  onDest?: (dest: DestOS) => void;
  onSort?: (sort: SortKey) => void;
  onClearPlatform?: () => void;
  onClearTarget?: () => void;
}

export interface ToolbarHandle {
  readonly el: HTMLElement;
  update: (patch: Partial<ToolbarState>) => void;
  focusSearch: () => void;
  getState: () => ToolbarState;
  destroy: () => void;
}

/** Tecla que enfoca el buscador. */
export const SEARCH_HOTKEY = '/';

/** Chips de biblioteca visibles, en el orden de la spec v5. */
export const TOOLBAR_CHIPS: readonly LibraryFilter[] = [
  'all',
  'ready',
  'needs-rom',
  'updates',
  'not-installed',
  'installed',
];

/** Vistas del selector segmentado con su icono. */
export const VIEW_BUTTONS: ReadonlyArray<{ id: ViewMode; label: string; icon: string }> = [
  { id: 'posters', label: 'Carátulas', icon: 'posters' },
  { id: 'big', label: 'Grilla grande', icon: 'big' },
  { id: 'shelves', label: 'Estantería', icon: 'carts' },
  { id: 'list', label: 'Lista', icon: 'list' },
  { id: 'table', label: 'Tabla', icon: 'table' },
];

export const DEFAULT_TOOLBAR_STATE: ToolbarState = {
  title: 'Catálogo',
  query: '',
  /* Por defecto se entra en la estantería de cartuchos y discos. */
  view: 'shelves',
  library: 'all',
  dev: 'all',
  dest: 'Linux',
  sort: 'name-asc',
  platform: 'all',
  target: 'all',
};

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

function titleMarkup(state: ToolbarState): string {
  const sub =
    state.subtitle ??
    (state.resultCount !== undefined
      ? `${state.resultCount} de ${state.totalCount ?? state.resultCount} puertos`
      : '');
  return (
    '<div class="title">' +
    `<h1>${esc(state.title)}</h1>` +
    (sub ? `<span class="sub">${esc(sub)}</span>` : '') +
    '</div>'
  );
}

function searchMarkup(state: ToolbarState): string {
  return (
    '<div class="search" role="search">' +
    icon('search', { size: 17, cls: 'sic' }) +
    `<input id="pl-search" type="search" name="q" value="${esc(state.query)}" ` +
    'placeholder="Buscar puerto, juego, repo…" aria-label="Buscar en el catálogo" ' +
    'autocomplete="off" spellcheck="false" enterkeyhint="search">' +
    `<kbd title="Pulsa ${esc(SEARCH_HOTKEY)} para buscar">${esc(SEARCH_HOTKEY)}</kbd>` +
    '</div>'
  );
}

function segmentMarkup(state: ToolbarState): string {
  const buttons = VIEW_BUTTONS.map(
    (v) =>
      `<button type="button" data-view="${v.id}" ` +
      `aria-pressed="${state.view === v.id}" ` +
      `aria-label="${esc(v.label)}" title="${esc(v.label)}">` +
      icon(v.icon, { size: 17 }) +
      '</button>'
  ).join('');
  return `<div class="seg" role="group" aria-label="Vista">${buttons}</div>`;
}

function chip(
  id: LibraryFilter,
  state: ToolbarState
): string {
  const active = state.library === id;
  const count = state.counts?.[id];
  return (
    `<button type="button" class="chip" data-lib="${id}" aria-pressed="${active}" ` +
    `title="Filtrar: ${esc(LIBRARY_FILTER_LABELS[id])}">` +
    `<span class="dot" aria-hidden="true"></span>` +
    esc(LIBRARY_FILTER_LABELS[id]) +
    (count !== undefined && count > 0 ? `<span class="x">${count}</span>` : '') +
    '</button>'
  );
}

function chipsMarkup(state: ToolbarState): string {
  const platformChip =
    state.platform && state.platform !== 'all'
      ? `<button type="button" class="chip" data-act="clear-platform" aria-pressed="true" ` +
        `title="Quitar filtro de plataforma">` +
        `<span class="dot" aria-hidden="true"></span>` +
        `${esc(PLATFORM_SHORT[state.platform] ?? state.platform)}<span class="x" aria-hidden="true">✕</span>` +
        '</button>'
      : '';
  const targetChip =
    state.target && state.target !== 'all'
      ? `<button type="button" class="chip" data-act="clear-target" aria-pressed="true" ` +
        `title="Quitar filtro de destino">` +
        `<span class="dot" aria-hidden="true"></span>` +
        `${esc(TARGET_LABELS[state.target] ?? state.target)}<span class="x" aria-hidden="true">✕</span>` +
        '</button>'
      : '';
  const chips = TOOLBAR_CHIPS.map((id) => chip(id, state)).join('');
  return `<div class="chips" role="group" aria-label="Filtros">${chips}${platformChip}${targetChip}</div>`;
}

function devSelect(state: ToolbarState): string {
  const options = [
    `<option value="all"${state.dev === 'all' ? ' selected' : ''}>Desarrollo: todos</option>`,
    ...DEV_TAGS.map((tag) => {
      const meta = DEV_TAG_META[tag];
      return (
        `<option value="${tag}"${state.dev === tag ? ' selected' : ''}>` +
        `${esc(meta.glyph)} ${esc(meta.label)}</option>`
      );
    }),
  ].join('');
  return `<select class="sel" data-select="dev" aria-label="Estado de desarrollo">${options}</select>`;
}

function destSelect(state: ToolbarState): string {
  const options = DEST_OPTIONS.map(
    (os) => `<option value="${os}"${state.dest === os ? ' selected' : ''}>${esc(os)}</option>`
  ).join('');
  return (
    `<select class="sel" data-select="dest" aria-label="Destino de instalación" ` +
    `title="Destino de instalación">${options}</select>`
  );
}

function sortSelect(state: ToolbarState): string {
  const options = SORT_KEYS.map(
    (key) =>
      `<option value="${key}"${state.sort === key ? ' selected' : ''}>` +
      `${esc(SORT_LABELS[key])}</option>`
  ).join('');
  return `<select class="sel" data-select="sort" aria-label="Ordenar por">${options}</select>`;
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

/** Contenido interno de `.top` (sin el nodo raíz). */
export function toolbarInner(state: ToolbarState): string {
  const loading = state.loading
    ? `<span class="mono" style="opacity:.75" aria-live="polite">${icon('spinner', { size: 14 })}</span>`
    : '';
  return (
    titleMarkup(state) +
    searchMarkup(state) +
    segmentMarkup(state) +
    chipsMarkup(state) +
    devSelect(state) +
    destSelect(state) +
    sortSelect(state) +
    loading
  );
}

/** Barra superior completa (`<div class="top">`). */
export function renderToolbar(state: ToolbarState, _cb: ToolbarCallbacks = {}): string {
  return `<div class="top" id="top" role="toolbar" aria-label="Barra de herramientas">${toolbarInner(state)}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Montaje                                                                    */
/* -------------------------------------------------------------------------- */

export interface MountToolbarOptions {
  state?: Partial<ToolbarState>;
  callbacks?: ToolbarCallbacks;
  /** Retardo del debounce del buscador (ms). Por defecto 140. */
  debounce?: number;
}

/**
 * Crea la barra en `host`, cablea los controles y el atajo `/`.
 * `update(patch)` repinta conservando foco y posición del cursor.
 */
export function mountToolbar(host: HTMLElement, opts: MountToolbarOptions = {}): ToolbarHandle {
  const callbacks = opts.callbacks ?? {};
  const debounceMs = opts.debounce ?? 140;
  let state: ToolbarState = { ...DEFAULT_TOOLBAR_STATE, ...(opts.state ?? {}) };

  const el = document.createElement('div');
  el.className = 'top';
  el.id = 'top';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Barra de herramientas');
  el.innerHTML = toolbarInner(state);
  host.prepend(el);

  let timer: number | null = null;

  function paint(): void {
    const active = document.activeElement;
    const input = el.querySelector<HTMLInputElement>('#pl-search');
    const hadFocus = !!input && active === input;
    const caret = input?.selectionStart ?? null;

    el.innerHTML = toolbarInner(state);

    if (hadFocus) {
      const next = el.querySelector<HTMLInputElement>('#pl-search');
      if (next) {
        next.focus();
        const pos = caret ?? next.value.length;
        next.setSelectionRange(pos, pos);
      }
    }
  }

  function flushQuery(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    callbacks.onQuery?.(state.query);
  }

  function onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== 'pl-search') return;
    state = { ...state, query: target.value };
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      callbacks.onQuery?.(state.query);
    }, debounceMs);
  }

  function onSubmit(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== 'pl-search') return;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    callbacks.onSubmit?.(state.query);
    callbacks.onQuery?.(state.query);
  }

  function onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const key = target.dataset.select;
    const value = target.value;
    if (key === 'dev') {
      const dev = value === 'all' ? 'all' : (value as DevTag);
      state = { ...state, dev };
      callbacks.onDev?.(dev);
    } else if (key === 'dest') {
      const dest = value as DestOS;
      state = { ...state, dest };
      callbacks.onDest?.(dest);
    } else if (key === 'sort') {
      const sort = value as SortKey;
      state = { ...state, sort };
      callbacks.onSort?.(sort);
    }
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const viewHit = target.closest<HTMLElement>('[data-view]');
    if (viewHit) {
      const view = viewHit.dataset.view as ViewMode | undefined;
      if (!view) return;
      event.preventDefault();
      state = { ...state, view };
      callbacks.onView?.(view);
      paint();
      return;
    }

    const libHit = target.closest<HTMLElement>('[data-lib]');
    if (libHit) {
      const filter = libHit.dataset.lib as LibraryFilter | undefined;
      if (!filter) return;
      event.preventDefault();
      state = { ...state, library: filter };
      callbacks.onLibrary?.(filter);
      paint();
      return;
    }

    const actHit = target.closest<HTMLElement>('[data-act]');
    if (actHit?.dataset.act === 'clear-platform') {
      event.preventDefault();
      state = { ...state, platform: 'all' };
      callbacks.onClearPlatform?.();
      paint();
      return;
    }
    if (actHit?.dataset.act === 'clear-target') {
      event.preventDefault();
      state = { ...state, target: 'all' };
      callbacks.onClearTarget?.();
      paint();
    }
  }

  function isTextField(node: EventTarget | null): boolean {
    if (!(node instanceof HTMLElement)) return false;
    if (node.isContentEditable) return true;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function onHotkey(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === SEARCH_HOTKEY && !isTextField(event.target)) {
      const input = el.querySelector<HTMLInputElement>('#pl-search');
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
      return;
    }

    if (event.key === 'Escape' && event.target === el.querySelector('#pl-search')) {
      const input = el.querySelector<HTMLInputElement>('#pl-search');
      if (!input || input.value === '') return;
      input.value = '';
      state = { ...state, query: '' };
      callbacks.onQuery?.('');
    }
  }

  function onEnterKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) onSubmit(event);
  }

  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('keydown', onEnterKey);
  document.addEventListener('keydown', onHotkey);

  return {
    el,
    update(patch: Partial<ToolbarState>): void {
      state = { ...state, ...patch };
      paint();
    },
    focusSearch(): void {
      const input = el.querySelector<HTMLInputElement>('#pl-search');
      input?.focus();
      input?.select();
    },
    getState(): ToolbarState {
      return state;
    },
    destroy(): void {
      if (timer !== null) window.clearTimeout(timer);
      el.removeEventListener('input', onInput);
      el.removeEventListener('change', onChange);
      el.removeEventListener('click', onClick);
      el.removeEventListener('submit', onSubmit);
      el.removeEventListener('keydown', onEnterKey);
      document.removeEventListener('keydown', onHotkey);
      el.remove();
    },
  };
}

/** Estilo del indicador de carga (por si el llamante reutiliza la pieza). */
export const LOADING_STYLE = styleAttr({ opacity: '0.75' });

export default renderToolbar;
