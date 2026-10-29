/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/BigGridView.ts
 *
 * Grilla grande (`.bgrid` > `.big`): banners 16:9 con el arte generativo (o la
 * portada real) como fondo, las etiquetas de plataforma y desarrollo **encima**
 * del arte y el bloque `.in` con título, metadatos, píldora de estado y CTA.
 *
 * Markup del prototipo de Claude (`bigCard()`, líneas 382-385):
 *
 *   article.big[style="background:art"] [data-act=open]
 *     img.cimg                 ← sólo si hay coverUrl
 *     span.tag                 ← plataforma
 *     span.devp                ← chip de desarrollo
 *     div.in
 *       div > título + metadatos + span.pill
 *       button.gear · button.btn[data-act=primary]
 * ========================================================================== */

import type { LibraryState, PortItem } from '../services/types';
import { INSTALL_STRATEGY_LABELS, PLATFORM_SHORT } from '../services/types';
import { esc, icon } from './Icons';
import type { ViewShared } from './PostersView';
import {
  actionButton,
  artBackground,
  delegatePortEvents,
  devChip,
  gearButton,
  metaText,
  stateOf,
  statePill,
} from './PostersView';

/* -------------------------------------------------------------------------- */
/* Tarjeta                                                                    */
/* -------------------------------------------------------------------------- */

/** Banner individual (`.big`). */
export function bigCard(port: PortItem, shared: ViewShared = {}): string {
  const state: LibraryState = stateOf(port.pid, shared);
  const strategy = INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy;
  const label = `${port.name} · ${PLATFORM_SHORT[port.sourcePlatform]} · ${strategy}`;

  const repoButton = port.repository
    ? `<button type="button" class="btn sm ico" data-act="details" data-pid="${esc(port.pid)}" ` +
      `title="Repositorio: ${esc(port.repository)}" aria-label="Ver detalles del repositorio">` +
      `${icon('external', { size: 15 })}</button>`
    : '';

  const cover = port.coverUrl
    ? `<img class="cimg" src="${esc(port.coverUrl)}" alt="" loading="lazy" decoding="async" ` +
      'referrerpolicy="no-referrer" onerror="this.remove()">'
    : '';

  return (
    `<article class="big" style="background:${artBackground(port)}" data-pid="${esc(port.pid)}" ` +
    `data-act="open" tabindex="0" role="link" aria-label="${esc(label)}">` +
    cover +
    `<span class="tag">${esc(PLATFORM_SHORT[port.sourcePlatform] ?? port.sourcePlatform)}</span>` +
    `<span class="devp">${devChip(port, { short: true })}</span>` +
    '<div class="in">' +
    '<div style="flex:1;min-width:0">' +
    `<div style="font:700 22px/1.1 var(--f-display)">${esc(port.name)}</div>` +
    `<div class="muted" style="margin:4px 0 8px">${esc(metaText(port))}</div>` +
    statePill(state) +
    '</div>' +
    gearButton(port, state, 'btn sm ico') +
    repoButton +
    actionButton(port, state) +
    '</div></article>'
  );
}

/* -------------------------------------------------------------------------- */
/* Vista                                                                      */
/* -------------------------------------------------------------------------- */

/** Vista de grilla grande completa (`.bgrid`). */
export function renderBigGrid(ports: readonly PortItem[], shared: ViewShared = {}): string {
  const cards = ports.map((port) => bigCard(port, shared)).join('');
  return `<div class="bgrid" data-view="big">${cards}</div>`;
}

/** Monta la vista en un contenedor y devuelve el desenganche de eventos. */
export function mountBigGrid(
  host: HTMLElement,
  ports: readonly PortItem[],
  shared: ViewShared = {}
): () => void {
  host.innerHTML = renderBigGrid(ports, shared);
  const grid = host.querySelector<HTMLElement>('.bgrid') ?? host;
  return delegatePortEvents(grid, shared);
}

export default renderBigGrid;
