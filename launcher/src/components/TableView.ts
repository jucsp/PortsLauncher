/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/TableView.ts
 *
 * Vista de tabla (`.twrap` > `table`), markup y estilo del prototipo de Claude
 * (`tableView()`, líneas 390-392): cabeceras en mayúsculas ordenables, filas
 * clicables y columnas Port · Plataforma · Destino · Estrategia · Versión ·
 * Desarrollo · Estado · Acción · ⚙.
 *
 * El componente ordena él mismo (salvo `opts.sort === false`) y notifica cada
 * clic con `onSortColumn(column, dir)` para que el contenedor pueda persistir
 * la preferencia o reordenar contra el catálogo completo.
 * ========================================================================== */

import type { LibraryState, PortItem } from '../services/types';
import {
  DEV_TAG_ORDER,
  INSTALL_STRATEGY_LABELS,
  LIBRARY_STATES,
  LIBRARY_STATE_LABELS,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
  TARGET_LABELS,
} from '../services/types';
import { catalogService } from '../services/catalogService';
import { esc, styleAttr } from './Icons';
import type { ViewShared } from './PostersView';
import {
  actionButton,
  delegatePortEvents,
  devChip,
  gearButton,
  stateOf,
  statePill,
  versionText,
} from './PostersView';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export type TableColumn =
  | 'name'
  | 'platform'
  | 'target'
  | 'strategy'
  | 'version'
  | 'dev'
  | 'state'
  | 'action'
  | 'gear';

export type SortDirection = 'asc' | 'desc';

export interface TableColumnDef {
  id: TableColumn;
  label: string;
  /** Columna ordenable (las de acción no lo son). */
  sortable: boolean;
  /** Ancho/alineación sugeridos. */
  align?: 'left' | 'right' | 'center';
}

export interface TableOptions extends ViewShared {
  /** Columna activa de ordenación (por defecto `name`). */
  sortColumn?: TableColumn;
  sortDir?: SortDirection;
  /** `false` desactiva la ordenación interna (la hace el contenedor). */
  sort?: boolean;
  /** Columnas visibles y su orden. */
  columns?: readonly TableColumn[];
  /** Fila seleccionada (recibe la clase `.on`). */
  selected?: string | null;
  onSortColumn?: (column: TableColumn, dir: SortDirection) => void;
  onSelect?: (pid: string) => void;
}

/** Definición canónica de columnas (rótulos del prototipo en mayúsculas). */
export const TABLE_COLUMNS: readonly TableColumnDef[] = [
  { id: 'name', label: 'PORT', sortable: true, align: 'left' },
  { id: 'platform', label: 'PLATAFORMA ORIGEN', sortable: true, align: 'left' },
  { id: 'target', label: 'DESTINO', sortable: true, align: 'left' },
  { id: 'strategy', label: 'ESTRATEGIA', sortable: true, align: 'left' },
  { id: 'version', label: 'VERSIÓN', sortable: true, align: 'left' },
  { id: 'dev', label: 'DESARROLLO', sortable: true, align: 'left' },
  { id: 'state', label: 'ESTADO', sortable: true, align: 'left' },
  { id: 'action', label: 'ACCIÓN', sortable: false, align: 'right' },
  { id: 'gear', label: '⚙', sortable: false, align: 'right' },
];

/* -------------------------------------------------------------------------- */
/* Ordenación                                                                 */
/* -------------------------------------------------------------------------- */

function text(value: unknown): string {
  return String(value ?? '').toLocaleLowerCase('es');
}

function platformIndex(port: PortItem): number {
  const order = Object.keys(PLATFORM_LABELS) as Array<keyof typeof PLATFORM_LABELS>;
  const idx = order.indexOf(port.sourcePlatform);
  return idx < 0 ? order.length : idx;
}

function devIndex(port: PortItem): number {
  const tag = catalogService.getDevTagInfo(port).tag;
  return DEV_TAG_ORDER[tag] ?? 99;
}

function stateIndex(state: LibraryState): number {
  const idx = (LIBRARY_STATES as readonly string[]).indexOf(state);
  return idx < 0 ? LIBRARY_STATES.length : idx;
}

/** Valor comparable de una ficha para una columna dada. */
export function columnValue(
  port: PortItem,
  column: TableColumn,
  shared: ViewShared = {}
): number | string {
  switch (column) {
    case 'platform':
      return platformIndex(port);
    case 'target':
      return text((port.targetPlatforms ?? []).join(' '));
    case 'strategy':
      return text(INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy);
    case 'version':
      return text(port.verifiedRelease?.version ?? '');
    case 'dev':
      return devIndex(port);
    case 'state':
      return stateIndex(stateOf(port.pid, shared));
    case 'name':
    case 'action':
    case 'gear':
    default:
      return text(port.name);
  }
}

/** Copia ordenada de `ports` según columna y dirección. */
export function sortByColumn(
  ports: readonly PortItem[],
  column: TableColumn,
  dir: SortDirection,
  shared: ViewShared = {}
): PortItem[] {
  const factor = dir === 'desc' ? -1 : 1;
  return [...ports].sort((a, b) => {
    const va = columnValue(a, column, shared);
    const vb = columnValue(b, column, shared);
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * factor || a.name.localeCompare(b.name, 'es');
    }
    return String(va).localeCompare(String(vb), 'es') * factor;
  });
}

/* -------------------------------------------------------------------------- */
/* Cabecera                                                                   */
/* -------------------------------------------------------------------------- */

function headCell(def: TableColumnDef, opts: TableOptions): string {
  const active = (opts.sortColumn ?? 'name') === def.id;
  const dir = opts.sortDir ?? 'asc';
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const align = def.align ?? 'left';
  const style = styleAttr({ 'text-align': align });
  const arrow = active ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
  const title = def.sortable
    ? `Ordenar por ${def.label}${active ? ` (${dir === 'asc' ? 'asc' : 'desc'})` : ''}`
    : def.label;

  const inner = def.sortable
    ? `<span data-sortcol="${def.id}" style="cursor:pointer">${esc(def.label)}${arrow}</span>`
    : esc(def.label);

  return (
    `<th scope="col" aria-sort="${ariaSort}"${style} title="${esc(title)}">${inner}</th>`
  );
}

/* -------------------------------------------------------------------------- */
/* Filas                                                                      */
/* -------------------------------------------------------------------------- */

function cell(inner: string, align: 'left' | 'right' | 'center' = 'left', cls = ''): string {
  const style = styleAttr({ 'text-align': align });
  const klass = cls ? ` class="${cls}"` : '';
  return `<td${klass}${style}>${inner}</td>`;
}

/** Fila individual (`<tr>`). */
export function tableRow(port: PortItem, shared: ViewShared = {}): string {
  const opts = shared as TableOptions;
  const state: LibraryState = stateOf(port.pid, shared);
  const selected = opts.selected === port.pid;
  const label =
    `${port.name} · ${PLATFORM_SHORT[port.sourcePlatform]} · ${LIBRARY_STATE_LABELS[state]}`;
  const strategy = INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy;
  const dest = shared.settings?.dest ?? 'Linux';
  const targets = (port.targetPlatforms ?? []).slice(0, 2).map((t) => TARGET_LABELS[t] ?? t);
  const version = versionText(port);

  return (
    `<tr data-pid="${esc(port.pid)}" data-act="open" tabindex="0" ` +
    `class="${selected ? 'on' : ''}" aria-selected="${selected ? 'true' : 'false'}" ` +
    `aria-label="${esc(label)}">` +
    cell(
      `<b>${esc(port.name)}</b>` +
        (port.project ? `<div class="muted" style="font-size:12px">${esc(port.project)}</div>` : ''),
      'left'
    ) +
    cell(`<span class="mono" style="font-size:12px">${esc(PLATFORM_SHORT[port.sourcePlatform])}</span>`, 'left') +
    cell(`${esc(dest)}${targets.length > 0 ? ` <span class="muted" style="font-size:11px">(${esc(targets.join(', '))})</span>` : ''}`, 'left') +
    cell(`<span class="mono muted" style="font-size:12px">${esc(strategy)}</span>`, 'left') +
    cell(`<span class="mono" style="font-size:12px">${esc(version || '—')}</span>`, 'left') +
    cell(devChip(port), 'left') +
    cell(statePill(state), 'left') +
    cell(actionButton(port, state), 'right') +
    cell(gearButton(port, state, 'btn sm ico'), 'right') +
    '</tr>'
  );
}

/* -------------------------------------------------------------------------- */
/* Vista                                                                      */
/* -------------------------------------------------------------------------- */

/** Tabla completa (`.twrap` > `table`). */
export function renderTable(ports: readonly PortItem[], opts: TableOptions = {}): string {
  const columns = (opts.columns ?? TABLE_COLUMNS.map((c) => c.id))
    .map((id) => TABLE_COLUMNS.find((c) => c.id === id))
    .filter((c): c is TableColumnDef => !!c);

  const sortColumn = opts.sortColumn ?? 'name';
  const sortDir = opts.sortDir ?? 'asc';
  const rowsIn = opts.sort === false ? [...ports] : sortByColumn(ports, sortColumn, sortDir, opts);

  const head = columns.map((c) => headCell(c, opts)).join('');
  const body = rowsIn.map((port) => tableRow(port, opts)).join('');
  const dirLabel = sortDir === 'asc' ? 'ascendente' : 'descendente';
  const summary = `${rowsIn.length} puertos · orden por ${sortColumn} (${dirLabel})`;

  return (
    '<div class="twrap" data-view="table">' +
    `<table aria-label="Catálogo de puertos" aria-rowcount="${rowsIn.length}">` +
    `<caption class="sr-only">${esc(summary)}</caption>` +
    `<thead><tr>${head}</tr></thead>` +
    `<tbody>${body}</tbody>` +
    '</table></div>'
  );
}

/**
 * Monta la tabla y gestiona la ordenación por cabecera (y la selección de
 * fila vía `onSelect`). Devuelve el desenganche de eventos.
 */
export function mountTable(
  host: HTMLElement,
  ports: readonly PortItem[],
  opts: TableOptions = {}
): () => void {
  let state: TableOptions = { sortColumn: 'name', sortDir: 'asc', ...opts };

  function paint(): void {
    host.innerHTML = renderTable(ports, state);
  }
  paint();

  // Los listeners viven en `host` (nodo estable): `paint()` sólo sustituye su
  // contenido, así que la delegación nunca se pierde al reordenar.
  const detachPorts = delegatePortEvents(host, { ...state, callbacks: state.callbacks });

  function onSortClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hit = target.closest<HTMLElement>('[data-sortcol]');
    if (!hit) return;
    const column = hit.dataset.sortcol as TableColumn | undefined;
    if (!column) return;
    event.preventDefault();
    event.stopPropagation();
    const same = state.sortColumn === column;
    const dir: SortDirection = same && state.sortDir === 'asc' ? 'desc' : 'asc';
    state = { ...state, sortColumn: column, sortDir: dir };
    state.onSortColumn?.(column, dir);
    paint();
  }

  host.addEventListener('click', onSortClick);

  return () => {
    detachPorts();
    host.removeEventListener('click', onSortClick);
  };
}

export default renderTable;
