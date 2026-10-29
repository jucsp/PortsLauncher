/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/ShelvesView.ts
 *
 * Estantería de soportes: **estructura exacta del prototipo de Claude**
 * (`shelves()` del prototipo, líneas 393-395).
 *
 *   div.shelves
 *     section.shelf
 *       h2                      ← nombre de la plataforma + «N ports»
 *       div.rail[style="--n:<neón>"]
 *         div.items             ← flex-wrap, gap 26px
 *           div.slot[style="--w:<px>"]
 *             <mediaHTML>       ← cartucho/disco con arte y etiqueta
 *             div.cap           ← nombre (máx. 2 líneas, centrado)
 *             div.foot          ← chip de desarrollo + ⚙ (pie de 32 px)
 *         div.board             ← tabla inferior de la repisa
 *
 * El neón de la repisa (`--n`) sale de la plataforma de origen y la línea
 * superior la pinta `.rail::before` en `media.css`.
 * ========================================================================== */

import type { LibraryState, PortItem, SourcePlatform } from '../services/types';
import { CATALOG_PLATFORMS, LIBRARY_STATE_LABELS, PLATFORM_LABELS } from '../services/types';
import { esc } from './Icons';
import { MEDIA, flagFor, mediaHTML, platNeon, styleFor } from './Media';
import type { ViewShared } from './PostersView';
import { delegatePortEvents, devChip, gearButton, stateOf } from './PostersView';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export interface ShelvesOptions extends ViewShared {
  /** Nº máximo de ítems por repisa (por defecto 24). */
  limit?: number;
  /** Plataformas a mostrar y su orden (por defecto, el canónico del catálogo). */
  order?: readonly SourcePlatform[];
  /** Al pulsar "Ver todos" en la cabecera de una repisa. */
  onMore?: (platform: SourcePlatform) => void;
  /** Muestra la repisa aunque quede vacía (por defecto `false`). */
  keepEmpty?: boolean;
}

export interface ShelfGroup {
  platform: SourcePlatform;
  label: string;
  ports: PortItem[];
  /** Total real antes de recortar a `limit`. */
  total: number;
}

/** Orden por defecto de las repisas. */
export const SHELF_ORDER: readonly SourcePlatform[] = CATALOG_PLATFORMS;

const DEFAULT_LIMIT = 24;

/* -------------------------------------------------------------------------- */
/* Agrupación                                                                 */
/* -------------------------------------------------------------------------- */

/** Agrupa los ports por plataforma de origen en el orden canónico. */
export function groupByPlatform(
  ports: readonly PortItem[],
  opts: ShelvesOptions = {}
): ShelfGroup[] {
  const order = opts.order ?? SHELF_ORDER;
  const buckets = new Map<SourcePlatform, PortItem[]>();

  for (const port of ports) {
    const key = port.sourcePlatform;
    const list = buckets.get(key);
    if (list) list.push(port);
    else buckets.set(key, [port]);
  }

  const groups: ShelfGroup[] = [];
  const seen = new Set<SourcePlatform>();

  const push = (platform: SourcePlatform): void => {
    if (seen.has(platform)) return;
    const list = buckets.get(platform) ?? [];
    if (list.length === 0 && !opts.keepEmpty) return;
    seen.add(platform);
    groups.push({
      platform,
      label: PLATFORM_LABELS[platform] ?? platform,
      ports: list.slice(0, opts.limit ?? DEFAULT_LIMIT),
      total: list.length,
    });
  };

  for (const platform of order) push(platform);
  for (const platform of buckets.keys()) push(platform);

  return groups;
}

/* -------------------------------------------------------------------------- */
/* Ítem                                                                       */
/* -------------------------------------------------------------------------- */

/** Insignia de aviso del soporte según el estado local. */
export function mediaFlagOf(state: LibraryState): { text: string; color: string } | null {
  return flagFor(state);
}

/**
 * Ítem de repisa: soporte + nombre en dos líneas + pie de 32 px.
 * Markup idéntico al `.slot` del prototipo.
 */
export function shelfItem(port: PortItem, shared: ShelvesOptions = {}): string {
  const state = stateOf(port.pid, shared);
  const style = styleFor(port, shared.settings);
  const width = (MEDIA[style] ?? MEDIA.cd).w;
  const label =
    `${port.name} · ${PLATFORM_LABELS[port.sourcePlatform] ?? port.sourcePlatform} · ` +
    LIBRARY_STATE_LABELS[state];

  return (
    `<div class="slot" style="--w:${width}px" data-pid="${esc(port.pid)}" data-act="open" ` +
    `tabindex="0" role="link" aria-label="${esc(label)}">` +
    mediaHTML(port, style, { flag: mediaFlagOf(state) }) +
    `<div class="cap" title="${esc(port.name)}">${esc(port.name)}</div>` +
    `<div class="foot">${devChip(port, { title: true })}${gearButton(port, state, 'btn sm ico')}</div>` +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Repisa y vista                                                             */
/* -------------------------------------------------------------------------- */

/** Repisa individual (`.shelf`), markup del prototipo. */
export function shelf(group: ShelfGroup, shared: ShelvesOptions = {}): string {
  const neon = platNeon(group.platform);
  const items = group.ports.map((port) => shelfItem(port, shared)).join('');
  const more =
    group.total > group.ports.length
      ? `<button type="button" class="more" data-more="${esc(group.platform)}" ` +
        `title="Ver los ${group.total} puertos de ${esc(group.label)}">` +
        `Ver todos (${group.total})</button>`
      : '';
  const counter =
    `<span class="mono muted" style="font-size:12px;font-weight:400">${group.ports.length} ports</span>`;

  return (
    `<section class="shelf" data-plat="${esc(group.platform)}" aria-label="${esc(group.label)}">` +
    `<h2>${esc(group.label.toUpperCase())}${counter}${more}</h2>` +
    `<div class="rail" style="--n:${neon}">` +
    `<div class="items">${items}</div>` +
    '<div class="board"></div>' +
    '</div></section>'
  );
}

/** Estantería completa (`.shelves`). */
export function renderShelves(ports: readonly PortItem[], opts: ShelvesOptions = {}): string {
  const groups = groupByPlatform(ports, opts);
  const sections = groups.map((g) => shelf(g, opts)).join('');
  return `<div class="shelves" data-view="shelves">${sections}</div>`;
}

/**
 * Monta la estantería y cablea tanto las acciones de ficha (delegadas) como
 * el "Ver todos" de cada repisa. Devuelve el desenganche conjunto.
 */
export function mountShelves(
  host: HTMLElement,
  ports: readonly PortItem[],
  opts: ShelvesOptions = {}
): () => void {
  host.innerHTML = renderShelves(ports, opts);
  const root = host.querySelector<HTMLElement>('.shelves') ?? host;
  const detachPorts = delegatePortEvents(root, opts);

  const onMoreClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hit = target.closest<HTMLElement>('[data-more]');
    if (!hit) return;
    const platform = hit.dataset.more as SourcePlatform | undefined;
    if (!platform) return;
    event.preventDefault();
    opts.onMore?.(platform);
  };

  root.addEventListener('click', onMoreClick);
  return () => {
    detachPorts();
    root.removeEventListener('click', onMoreClick);
  };
}

export default renderShelves;
