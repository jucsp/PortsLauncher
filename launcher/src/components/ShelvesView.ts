/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/ShelvesView.ts
 *
 * Estantería de soportes (`.shelves` > `.shelf` > `.rail`): una repisa por
 * plataforma de origen, con la línea de neón y el pie de 32 px que define el
 * CSS, y un ítem por port con su cartucho/disco (los 16 estilos de §8).
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css` + `media.css`):
 *   .shelves > .shelf > .shead (h2 + .more) / .rail > *
 *   .rail  → grid auto-columns 132–148 px, scroll-snap y padding-bottom 32 px
 *   .media.<estilo> → spans .body/.grill/.label/.notch/.slot/.umd/.hole/.shine
 *
 * El ítem reaprovecha `.card` / `.ct` / `.cs` para no duplicar estilos; el
 * marco de carátula se neutraliza en línea (`.cover` transparente) para que
 * el protagonista sea el soporte, no un póster 3:4.
 * ========================================================================== */

import type { LibraryState, PortItem, SourcePlatform } from '../services/types';
import {
  CATALOG_PLATFORMS,
  LIBRARY_STATE_LABELS,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
} from '../services/types';
import { esc, styleAttr } from './Icons';
import type { ViewShared } from './PostersView';
import {
  delegatePortEvents,
  gearButton,
  mediaMarkup,
  mediaStyleOf,
  stateOf,
  statePill,
} from './PostersView';

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
  // Plataformas fuera del orden canónico (p. ej. `other` si no estaba).
  for (const platform of buckets.keys()) push(platform);

  return groups;
}

/* -------------------------------------------------------------------------- */
/* Ítem                                                                       */
/* -------------------------------------------------------------------------- */

const COVER_RESET = styleAttr({
  'aspect-ratio': 'auto',
  background: 'none',
  border: '0',
  'box-shadow': 'none',
  overflow: 'visible',
  display: 'grid',
  'place-items': 'center',
  padding: '6px 0 0',
});

const FOOT_STYLE = styleAttr({
  height: '32px',
  'min-height': '32px',
  'justify-content': 'center',
  gap: '6px',
});

/** Insignia del soporte según el estado local. */
function mediaFlag(state: LibraryState): { text: string; kind: 'warn' | 'danger' | 'info' | 'ok' } | null {
  switch (state) {
    case 'NeedsRom':
      return { text: '!', kind: 'warn' };
    case 'Broken':
      return { text: '✕', kind: 'danger' };
    case 'UpdateAvailable':
      return { text: '↑', kind: 'info' };
    case 'Ready':
      return { text: '✓', kind: 'ok' };
    default:
      return null;
  }
}

/** Ítem de repisa: soporte + nombre (2 líneas) + pie de 32 px. */
export function shelfItem(port: PortItem, shared: ViewShared = {}): string {
  const state = stateOf(port.pid, shared);
  const style = mediaStyleOf(port, shared.settings);
  const flag = mediaFlag(state);
  const label =
    `${port.name} · ${PLATFORM_SHORT[port.sourcePlatform]} · ${LIBRARY_STATE_LABELS[state]}`;

  return (
    `<div class="card" data-pid="${esc(port.pid)}" data-act="open" tabindex="0" ` +
    `role="article" aria-label="${esc(label)}">` +
    `<div class="cover"${COVER_RESET}>` +
    mediaMarkup(style, {
      size: 'sz-m',
      label: PLATFORM_SHORT[port.sourcePlatform],
      flag: flag ?? undefined,
    }) +
    '</div>' +
    `<div class="ct" style="text-align:center">${esc(port.name)}</div>` +
    `<div class="cs"${FOOT_STYLE}>` +
    statePill(state) +
    gearButton(port, state) +
    '</div>' +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Repisa y vista                                                             */
/* -------------------------------------------------------------------------- */

/** Repisa individual (`.shelf`). */
export function shelf(group: ShelfGroup, shared: ShelvesOptions = {}): string {
  const items = group.ports.map((port) => shelfItem(port, shared)).join('');
  const more =
    group.total > group.ports.length
      ? `<button type="button" class="more" data-more="${group.platform}" ` +
        `title="Ver los ${group.total} puertos de ${esc(group.label)}">` +
        `Ver todos (${group.total})</button>`
      : '';
  return (
    `<section class="shelf" data-plat="${group.platform}" aria-label="${esc(group.label)}">` +
    '<div class="shead">' +
    `<h2>${esc(group.label)}</h2>` +
    platDot(group.platform) +
    `<span class="mono" style="color:var(--muted);font-size:var(--fs-2xs)">` +
    `${group.ports.length}/${group.total}</span>` +
    more +
    '</div>' +
    `<div class="rail" role="list">${items}</div>` +
    '</section>'
  );
}

function platDot(platform: SourcePlatform): string {
  const neon = `var(--p-${platform}-neon, var(--muted))`;
  const style = styleAttr({
    width: '8px',
    height: '8px',
    'border-radius': '50%',
    background: neon,
    'box-shadow': `0 0 8px ${neon}`,
  });
  return `<span${style} aria-hidden="true"></span>`;
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
