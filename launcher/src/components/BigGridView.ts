/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/BigGridView.ts
 *
 * Vista de grilla grande (`.bgrid` > `.bcard`): banners 16:9 con degradado
 * oscuro inferior e izquierdo, portada o carátula generativa, píldoras de
 * plataforma/desarrollo/estado, título, metadatos y acción primaria.
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   .bgrid > .bcard (aspect-ratio 16/9, overflow hidden) / .binfo (z-index 2)
 *
 * Apilado explícito dentro del banner (todo en línea, sin tocar el CSS):
 *   z0 = carátula generativa · z1 = <img> · z2 = velo · z2+DOM = .binfo
 * El velo combina el degradado inferior (el que `.bcard::after` ya define)
 * con el lateral izquierdo de la spec, para que el texto tenga contraste
 * también cuando no hay portada.
 * ========================================================================== */

import type { LibraryState, PortItem } from '../services/types';
import {
  INSTALL_STRATEGY_LABELS,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
  TARGET_LABELS,
} from '../services/types';
import { esc, icon, styleAttr } from './Icons';
import type { ViewShared } from './PostersView';
import {
  actionButton,
  art,
  delegatePortEvents,
  devChip,
  gearButton,
  platPill,
  stateOf,
  statePill,
  versionText,
} from './PostersView';

/* -------------------------------------------------------------------------- */
/* Capas del banner                                                           */
/* -------------------------------------------------------------------------- */

const ART_LAYER = styleAttr({
  position: 'absolute',
  inset: '0',
  display: 'grid',
  'place-items': 'center',
  'text-align': 'center',
  'z-index': '0',
});

const IMG_LAYER = styleAttr({
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  'object-fit': 'cover',
  'z-index': '1',
});

/** Degradado lateral izquierdo + inferior (contraste del texto). */
const SCRIM = styleAttr({
  position: 'absolute',
  inset: '0',
  'z-index': '2',
  'pointer-events': 'none',
  background:
    'linear-gradient(190deg, transparent 34%, rgba(8,7,15,.72) 74%, rgba(8,7,15,.94) 100%),' +
    'linear-gradient(95deg, rgba(8,7,15,.86) 0%, rgba(8,7,15,.46) 42%, transparent 68%)',
});

function bannerLayer(port: PortItem): string {
  const img = port.coverUrl
    ? `<img src="${esc(port.coverUrl)}" alt="" loading="lazy" decoding="async" ` +
      `referrerpolicy="no-referrer"${IMG_LAYER} onerror="this.remove()">`
    : '';
  const artLayer = port.coverUrl
    ? `<span${ART_LAYER} aria-hidden="true">${art(port, { compact: true })}</span>`
    : `<span${ART_LAYER}>${art(port, { compact: true })}</span>`;
  return artLayer + img + `<span${SCRIM} aria-hidden="true"></span>`;
}

function metaLine(port: PortItem): string {
  const parts: string[] = [PLATFORM_LABELS[port.sourcePlatform] ?? port.sourcePlatform];
  const targets = (port.targetPlatforms ?? []).slice(0, 3).map((t) => TARGET_LABELS[t] ?? t);
  if (targets.length > 0) parts.push(targets.join(' · '));
  const version = versionText(port);
  if (version) parts.push(version);
  return parts.map((p) => `<span class="nm">${esc(p)}</span>`).join(
    '<span class="sep" aria-hidden="true">·</span>'
  );
}

/* -------------------------------------------------------------------------- */
/* Tarjeta                                                                    */
/* -------------------------------------------------------------------------- */

/** Banner individual (`.bcard`). */
export function bigCard(port: PortItem, shared: ViewShared = {}): string {
  const state: LibraryState = stateOf(port.pid, shared);
  const strategy = INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy;
  const label = `${port.name} · ${PLATFORM_SHORT[port.sourcePlatform]} · ${strategy}`;

  const repoButton = port.repository
    ? `<button type="button" class="btn ico sm" data-act="details" data-pid="${esc(port.pid)}" ` +
      `title="Repositorio: ${esc(port.repository)}" aria-label="Ver detalles del repositorio">` +
      `${icon('external', { size: 15 })}</button>`
    : '';

  return (
    `<article class="bcard" data-pid="${esc(port.pid)}" data-act="open" tabindex="0" ` +
    `role="article" aria-label="${esc(label)}">` +
    bannerLayer(port) +
    '<div class="binfo">' +
    `<div class="bmeta">${platPill(port)}${devChip(port, { short: true })}` +
    statePill(state, { hideNotInstalled: true }) +
    '</div>' +
    `<h3 title="${esc(port.name)}">${esc(port.name)}</h3>` +
    `<div class="bmeta">${metaLine(port)}</div>` +
    '<div class="bmeta" style="margin-top:6px;align-items:center">' +
    actionButton(port, state) +
    repoButton +
    gearButton(port, state) +
    '</div>' +
    '</div>' +
    '</article>'
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
