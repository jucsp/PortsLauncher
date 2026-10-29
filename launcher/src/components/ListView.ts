/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/ListView.ts
 *
 * Vista de lista (`.list` > `.row`), markup del prototipo de Claude
 * (`listRow()`, líneas 386-389):
 *
 *   div.row [data-act=open]
 *     div.thumb[style="background:art"]  ← 56×56
 *     div > b (nombre) + div.muted (proyecto · plataforma → destino)
 *     div.mono.muted                     ← estrategia de instalación
 *     span.dev · span.pill · ⚙ · acción
 * ========================================================================== */

import type { LibraryState, PortItem } from '../services/types';
import {
  INSTALL_STRATEGY_LABELS,
  LIBRARY_STATE_LABELS,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
} from '../services/types';
import { esc } from './Icons';
import { artBackground } from './PostersView';
import type { ViewShared } from './PostersView';
import {
  actionButton,
  delegatePortEvents,
  devChip,
  gearButton,
  stateOf,
  statePill,
} from './PostersView';

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

/** Miniatura cuadrada 56×56 con el arte generativo (o la portada). */
export function listThumb(port: PortItem): string {
  const img = port.coverUrl
    ? `<img class="cimg" src="${esc(port.coverUrl)}" alt="" loading="lazy" decoding="async" ` +
      'referrerpolicy="no-referrer" onerror="this.remove()">'
    : '';
  return (
    `<div class="thumb" style="background:${artBackground(port)}" aria-hidden="true">` +
    `${img}</div>`
  );
}

/** Fila individual (`.row`). */
export function listRow(port: PortItem, shared: ViewShared = {}): string {
  const state: LibraryState = stateOf(port.pid, shared);
  const strategy = INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy;
  const dest = shared.settings?.dest ?? 'Linux';
  const project = (port.project ?? '').trim();
  const sub = [
    project,
    `${PLATFORM_LABELS[port.sourcePlatform] ?? port.sourcePlatform} → ${dest}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const label =
    `${port.name} · ${PLATFORM_SHORT[port.sourcePlatform]} · ${LIBRARY_STATE_LABELS[state]}`;

  return (
    `<div class="row" data-pid="${esc(port.pid)}" data-act="open" tabindex="0" ` +
    `role="link" aria-label="${esc(label)}">` +
    listThumb(port) +
    '<div style="flex:1 1 220px;min-width:0">' +
    `<b style="font-size:15px">${esc(port.name)}</b>` +
    `<div class="muted">${esc(sub)}</div>` +
    '</div>' +
    `<div class="mono muted" style="flex:0 0 160px;font-size:12px">${esc(strategy)}</div>` +
    devChip(port) +
    statePill(state) +
    gearButton(port, state, 'btn sm ico') +
    actionButton(port, state) +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Vista                                                                      */
/* -------------------------------------------------------------------------- */

/** Vista de lista completa (`.list`). */
export function renderList(ports: readonly PortItem[], shared: ViewShared = {}): string {
  const rows = ports.map((port) => listRow(port, shared)).join('');
  return `<div class="list" data-view="list">${rows}</div>`;
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
