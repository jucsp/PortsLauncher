/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/ListView.ts
 *
 * Vista de lista (`.list` > `.lrow`): miniatura cuadrada, título, proyecto,
 * estrategia de instalación, chip de desarrollo, píldora de estado y acciones.
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   .list  → contenedor con borde y radios
 *   .lrow  → grid 40px + 1fr + auto + auto (thumb / main / tags / act)
 *   .lthumb (40px en el CSS) · .lmain > .lname + .lsub · .ltags · .lact
 *
 * La spec v5 pide miniatura de **56×56**: se sobrescribe en línea tanto el
 * tamaño del thumb como la primera columna del grid, sin tocar la hoja de
 * estilos (`.lact` aparece al hover, comportamiento que se conserva).
 * ========================================================================== */

import type { LibraryState, PortItem } from '../services/types';
import {
  INSTALL_STRATEGY_LABELS,
  LIBRARY_STATE_LABELS,
  PLATFORM_SHORT,
} from '../services/types';
import { esc, styleAttr } from './Icons';
import type { ViewShared } from './PostersView';
import {
  actionButton,
  art,
  delegatePortEvents,
  devChip,
  gearButton,
  stateOf,
  statePill,
} from './PostersView';

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

const ROW_STYLE = styleAttr({ 'grid-template-columns': '56px minmax(0, 1fr) auto auto' });

const THUMB_STYLE = styleAttr({
  width: '56px',
  height: '56px',
  position: 'relative',
  overflow: 'hidden',
  'border-radius': 'var(--r-s)',
});

/** Miniatura cuadrada 56×56 (portada o carátula generativa compacta). */
export function listThumb(port: PortItem): string {
  const img = port.coverUrl
    ? `<img src="${esc(port.coverUrl)}" alt="" loading="lazy" decoding="async" ` +
      `referrerpolicy="no-referrer" onerror="this.remove()">`
    : '';
  return (
    `<span class="lthumb"${THUMB_STYLE} aria-hidden="true">` +
    `<span style="position:absolute;inset:0;display:grid;place-items:center">` +
    `${art(port, { compact: true })}</span>` +
    `<span style="position:absolute;inset:0;z-index:1">${img}</span>` +
    '</span>'
  );
}

/** Fila individual (`.lrow`). */
export function listRow(port: PortItem, shared: ViewShared = {}): string {
  const state: LibraryState = stateOf(port.pid, shared);
  const strategy = INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy;
  const sub = [
    port.project || port.repository || '',
    strategy,
  ]
    .filter((v) => v && v.length > 0)
    .join(' · ');
  const label =
    `${port.name} · ${PLATFORM_SHORT[port.sourcePlatform]} · ${LIBRARY_STATE_LABELS[state]}`;

  return (
    `<div class="lrow" data-pid="${esc(port.pid)}" data-act="open" tabindex="0" ` +
    `role="row" aria-label="${esc(label)}"${ROW_STYLE}>` +
    listThumb(port) +
    '<div class="lmain">' +
    `<span class="lname" title="${esc(port.name)}">${esc(port.name)}</span>` +
    `<span class="lsub" title="${esc(sub)}">${esc(sub)}</span>` +
    '</div>' +
    `<div class="ltags">${devChip(port, { short: true })}${statePill(state, { hideNotInstalled: true })}</div>` +
    `<div class="lact">${actionButton(port, state)}${gearButton(port, state)}</div>` +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Vista                                                                      */
/* -------------------------------------------------------------------------- */

/** Vista de lista completa (`.list`). */
export function renderList(ports: readonly PortItem[], shared: ViewShared = {}): string {
  const rows = ports.map((port) => listRow(port, shared)).join('');
  return `<div class="list" data-view="list" role="table">${rows}</div>`;
}

/** Monta la vista en un contenedor y devuelve el desenganche de eventos. */
export function mountList(
  host: HTMLElement,
  ports: readonly PortItem[],
  shared: ViewShared = {}
): () => void {
  host.innerHTML = renderList(ports, shared);
  const root = host.querySelector<HTMLElement>('.list') ?? host;
  return delegatePortEvents(root, shared);
}

export default renderList;
