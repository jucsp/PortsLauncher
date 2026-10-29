/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/PostersView.ts
 *
 * Vista de carátulas (`.grid` > `.card`) **y piezas compartidas** por el resto
 * de vistas: chip de desarrollo, píldora de estado, carátula generativa,
 * soporte (cartucho/disco), acción primaria y delegación de eventos.
 *
 * Contract CSS (`launcher/src/styles/layout.css`):
 *   .grid > .card > .cover (.badges / .media-slot) / .ct / .cs
 *
 * Todos los componentes devuelven **cadenas HTML** y delegan los clics por
 * atributos (`data-pid` + `data-act`), de modo que el llamante puede usar
 * `delegatePortEvents()` o su propio manejador:
 *
 *   <div class="card" data-pid="…" data-act="open" tabindex="0">
 *     <button data-act="install">Instalar</button>
 *     <button data-act="gear">⚙</button>
 *   </div>
 *
 * `closest('[data-act]')` resuelve primero el botón interno, así que el clic
 * en una acción nunca se confunde con "abrir ficha".
 * ========================================================================== */

import type {
  DevTag,
  DevTagInfo,
  LibraryState,
  MediaStyle,
  PortItem,
  Settings,
} from '../services/types';
import {
  INSTALL_STRATEGY_LABELS,
  LIBRARY_STATE_LABELS,
  PLATFORM_SHORT,
} from '../services/types';
import { catalogService } from '../services/catalogService';
import { esc, icon, styleAttr } from './Icons';

/* -------------------------------------------------------------------------- */
/* Tipos compartidos                                                          */
/* -------------------------------------------------------------------------- */

export type PortActionKind =
  | 'open'
  | 'install'
  | 'play'
  | 'rom'
  | 'update'
  | 'retry'
  | 'external'
  | 'details'
  | 'gear';

export interface PortAction {
  kind: PortActionKind;
  label: string;
  /** Clase del botón (`btn pri sm`, `btn sm warn`…). */
  cls: string;
  disabled: boolean;
  iconName: string;
}

export interface ViewCallbacks {
  /** Acción primaria de una ficha. */
  onAction?: (pid: string, kind: PortActionKind) => void;
  /** Botón ⚙ (ajustes del port instalado). */
  onGear?: (pid: string) => void;
  /** Apertura de la ficha de detalle. */
  onOpen?: (pid: string) => void;
}

export interface ViewShared {
  /** Estado de biblioteca por pid (lo aporta `libraryService`). */
  states?: Record<string, LibraryState> | Map<string, LibraryState>;
  /** Ajustes activos (soporte, vista, destino). */
  settings?: Settings | null;
  callbacks?: ViewCallbacks;
  /** Fuerza/niega el soporte en esta vista. Por defecto `settings.media`. */
  media?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Estado de biblioteca                                                       */
/* -------------------------------------------------------------------------- */

/** Estado de un port según `shared.states` (por defecto `NotInstalled`). */
export function stateOf(pid: string, shared: ViewShared = {}): LibraryState {
  const states = shared.states;
  if (!states) return catalogService.getLibraryState(pid);
  if (states instanceof Map) return states.get(pid) ?? 'NotInstalled';
  return states[pid] ?? 'NotInstalled';
}

/** `true` si la ficha está instalada, lista, rota o actualizable. */
export function isInstalledState(state: LibraryState): boolean {
  return (
    state === 'Installed' ||
    state === 'Ready' ||
    state === 'NeedsRom' ||
    state === 'UpdateAvailable' ||
    state === 'Broken'
  );
}

/* -------------------------------------------------------------------------- */
/* Chips y píldoras                                                           */
/* -------------------------------------------------------------------------- */

/** Información de desarrollo normalizada (cachea por pid dentro del catálogo). */
export function devInfo(port: PortItem): DevTagInfo {
  return catalogService.getDevTagInfo(port);
}

/**
 * Chip de desarrollo: color de estado + glifo + texto.
 * Nunca es sólo icono (requisito de accesibilidad de la spec).
 */
export function devChip(port: PortItem, opts: { short?: boolean; title?: boolean } = {}): string {
  const info = devInfo(port);
  const tag: DevTag = info.tag;
  const text = opts.short ? info.text : info.label;
  const title =
    opts.title === false
      ? ''
      : `${info.label} · confianza ${info.conf}` +
        (info.pct > 0 ? ` · ${info.pct}% recomendado` : '') +
        (info.why ? ` — ${info.why}` : '');
  return (
    `<span class="pill st-${tag}" data-dev="${tag}"` +
    (title ? ` title="${esc(title)}"` : '') +
    ` aria-label="${esc(`${info.label}, confianza ${info.conf}`)}">` +
    `<span aria-hidden="true" style="font-size:9px;line-height:1">${esc(info.glyph)}</span>` +
    `<span>${esc(text)}</span></span>`
  );
}

const STATE_GLYPH: Record<LibraryState, string> = {
  NotInstalled: '○',
  Downloading: '↓',
  Installing: '⚙',
  Installed: '▣',
  NeedsRom: '＋',
  Ready: '✓',
  UpdateAvailable: '↑',
  Broken: '✕',
};

const STATE_COLOR: Record<LibraryState, string> = {
  NotInstalled: 'var(--muted)',
  Downloading: 'var(--st-wip)',
  Installing: 'var(--st-wip)',
  Installed: 'var(--accent2)',
  NeedsRom: 'var(--warn)',
  Ready: 'var(--st-playable)',
  UpdateAvailable: 'var(--accent2)',
  Broken: 'var(--danger)',
};

/** Píldora del estado local (biblioteca). */
export function statePill(state: LibraryState, opts: { hideNotInstalled?: boolean } = {}): string {
  if (opts.hideNotInstalled && state === 'NotInstalled') return '';
  const color = STATE_COLOR[state];
  return (
    `<span class="pill" data-state="${state}" ` +
    `style="color:${color};border-color:${color}" ` +
    `title="${esc(LIBRARY_STATE_LABELS[state])}">` +
    `<span aria-hidden="true" style="font-size:10px;line-height:1">${esc(STATE_GLYPH[state])}</span>` +
    `<span>${esc(LIBRARY_STATE_LABELS[state])}</span></span>`
  );
}

/** Píldora de plataforma de origen con el neón correspondiente. */
export function platPill(port: PortItem): string {
  const plat = port.sourcePlatform;
  return (
    `<span class="pill plat" data-plat="${plat}" ` +
    styleAttr({ '--plat-neon': `var(--p-${plat}-neon, var(--accent))` }) +
    ` title="${esc(port.sourcePlatform)}">${esc(PLATFORM_SHORT[plat] ?? plat)}</span>`
  );
}

/** Píldora con la estrategia de instalación. */
export function strategyChip(port: PortItem, opts: { icon?: boolean } = {}): string {
  const label = INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy;
  return (
    `<span class="pill" data-strategy="${esc(port.installStrategy)}" title="Instalación: ${esc(label)}">` +
    (opts.icon ? icon('download', { size: 12 }) : '') +
    `<span>${esc(label)}</span></span>`
  );
}

/** Versión verificada/publicada (o la instalada) como texto mono. */
export function versionText(port: PortItem): string {
  const v = port.verifiedRelease?.version;
  if (!v) return '';
  return `v${v.replace(/^v/i, '')}`;
}

/* -------------------------------------------------------------------------- */
/* Acción primaria                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Acción que debe ofrecer la tarjeta para un port en un estado dado.
 * Sigue la máquina del Anexo D.3: lo que falta es siempre el siguiente paso.
 */
export function portAction(port: PortItem, state: LibraryState): PortAction {
  switch (state) {
    case 'Ready':
      return { kind: 'play', label: 'Jugar', cls: 'btn pri sm', disabled: false, iconName: 'play' };
    case 'Installed':
      return portNeedsRomHint(port)
        ? { kind: 'rom', label: 'Añadir ROM', cls: 'btn pri sm', disabled: false, iconName: 'rom' }
        : { kind: 'play', label: 'Jugar', cls: 'btn pri sm', disabled: false, iconName: 'play' };
    case 'NeedsRom':
      return { kind: 'rom', label: 'Añadir ROM', cls: 'btn pri sm', disabled: false, iconName: 'rom' };
    case 'Downloading':
      return { kind: 'install', label: 'Descargando…', cls: 'btn sm', disabled: true, iconName: 'spinner' };
    case 'Installing':
      return { kind: 'install', label: 'Instalando…', cls: 'btn sm', disabled: true, iconName: 'spinner' };
    case 'UpdateAvailable':
      return { kind: 'update', label: 'Actualizar', cls: 'btn warn sm', disabled: false, iconName: 'upd' };
    case 'Broken':
      return { kind: 'retry', label: 'Reinstalar', cls: 'btn dng sm', disabled: false, iconName: 'retry' };
    case 'NotInstalled':
    default:
      break;
  }

  const strategy = port.installStrategy;
  if (strategy === 'external') {
    return { kind: 'external', label: 'Sitio oficial', cls: 'btn sm', disabled: false, iconName: 'external' };
  }
  if (strategy === 'recipe' || strategy === 'source-only' || strategy === 'needsChoice') {
    return { kind: 'details', label: 'Cómo instalar', cls: 'btn sm', disabled: false, iconName: 'info' };
  }
  return { kind: 'install', label: 'Instalar', cls: 'btn pri sm', disabled: false, iconName: 'download' };
}

function portNeedsRomHint(port: PortItem): boolean {
  const ruf = port.requiresUserFiles ?? {};
  if (Object.values(ruf).some((v) => typeof v === 'string' && v.trim().length > 0)) return true;
  const binding = port.romProfile?.binding;
  if (binding && binding !== 'in-app') return true;
  return (port.setupFiles ?? []).some(
    (f) => f && (f.required === true || String(f.kind ?? '').toLowerCase() === 'rom')
  );
}

/** Botón de acción primaria listo para insertar. */
export function actionButton(port: PortItem, state: LibraryState): string {
  const action = portAction(port, state);
  return (
    `<button type="button" class="${esc(action.cls)}" data-act="${action.kind}" ` +
    `data-pid="${esc(port.pid)}" ${attrDisabled(action.disabled)} ` +
    `title="${esc(action.label)}">` +
    `${icon(action.iconName, { size: 15 })}<span>${esc(action.label)}</span></button>`
  );
}

function attrDisabled(disabled: boolean): string {
  return disabled ? 'disabled aria-disabled="true"' : '';
}

/** Botón ⚙ (sólo cuando la ficha tiene algo instalado, regla v4). */
export function gearButton(port: PortItem, state: LibraryState): string {
  if (!isInstalledState(state)) return '';
  return (
    `<button type="button" class="btn ico sm" data-act="gear" data-pid="${esc(port.pid)}" ` +
    `title="Ajustes de ${esc(port.name)}" aria-label="Ajustes de ${esc(port.name)}">` +
    `${icon('gear', { size: 15 })}</button>`
  );
}

/* -------------------------------------------------------------------------- */
/* Carátula generativa                                                        */
/* -------------------------------------------------------------------------- */

function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function monogram(name: string): string {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 || /\d/.test(w));
  const out = words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  return out || String(name ?? '?').slice(0, 2).toUpperCase();
}

/**
 * Carátula generativa (`art(c, p)` de la spec): degradados deterministas
 * derivados del `pid`, con el neón/pegatina de la plataforma y el monograma
 * del título. Se usa cuando `coverUrl` falta o falla.
 */
export function art(port: PortItem, opts: { compact?: boolean } = {}): string {
  const plat = port.sourcePlatform;
  const seed = hash32(`${port.pid}|${port.name}`);
  const ax = 8 + (seed % 78);
  const ay = 6 + ((seed >>> 7) % 72);
  const angle = 20 + ((seed >>> 13) % 120);
  const neon = `var(--p-${plat}-neon, var(--accent))`;
  const sticker = `var(--p-${plat}-sticker, var(--accent2))`;
  const bg = [
    `radial-gradient(120% 90% at ${ax}% ${ay}%, color-mix(in srgb, ${neon} 46%, transparent), transparent 62%)`,
    `radial-gradient(90% 70% at ${100 - ax}% ${100 - ay}%, color-mix(in srgb, ${sticker} 58%, transparent), transparent 68%)`,
    `repeating-linear-gradient(${angle}deg, rgba(255,255,255,.055) 0 2px, transparent 2px 7px)`,
    'linear-gradient(160deg, var(--panel2), #0A0912 92%)',
  ].join(',');

  return (
    `<span class="fallback" aria-hidden="true"${styleAttr({ background: bg })}>` +
    `<b style="font-size:${opts.compact ? '22px' : '34px'};letter-spacing:.02em;` +
    `text-shadow:0 2px 12px rgba(0,0,0,.55)">${esc(monogram(port.name))}</b>` +
    `<i style="font-family:var(--f-mono);font-size:10px;font-style:normal;color:var(--muted);` +
    `letter-spacing:.14em;margin-top:2px">${esc(PLATFORM_SHORT[plat] ?? plat)}</i>` +
    '</span>'
  );
}

/** `<img>` de portada con la carátula generativa como respaldo. */
export function coverMarkup(port: PortItem, opts: { big?: boolean; compact?: boolean } = {}): string {
  const img = port.coverUrl
    ? `<img src="${esc(port.coverUrl)}" alt="" loading="lazy" decoding="async" ` +
      `referrerpolicy="no-referrer" onerror="this.remove()">`
    : '';
  return art(port, { compact: opts.compact ?? opts.big ?? false }) + img;
}

/* -------------------------------------------------------------------------- */
/* Soportes (cartuchos y discos)                                              */
/* -------------------------------------------------------------------------- */

/** Spans que necesita cada silueta (los opcionales quedan invisibles si faltan). */
export const MEDIA_SPANS: Record<MediaStyle, readonly string[]> = {
  n64: ['body', 'grill', 'label', 'notch'],
  snes: ['body', 'grill', 'label'],
  nes: ['body', 'grill', 'label', 'notch'],
  md: ['body', 'grill', 'label', 'slot'],
  gba: ['body', 'grill', 'label', 'notch'],
  gb: ['body', 'grill', 'label', 'slot'],
  nds: ['body', 'grill', 'label'],
  n3ds: ['body', 'grill', 'label', 'notch'],
  nsw: ['body', 'grill', 'label', 'notch'],
  psp: ['body', 'umd', 'hole', 'label'],
  cd: ['body', 'hole', 'shine'],
  ps1: ['body', 'hole', 'shine'],
  gcn: ['body', 'hole', 'shine'],
  xbox: ['body', 'hole', 'shine'],
  ps2: ['body', 'hole', 'shine'],
  x360: ['body', 'hole', 'shine'],
};

/** Orden de pintado canónico (el `.body` primero, la `.shine` al final). */
const SPAN_ORDER = ['body', 'grill', 'label', 'notch', 'slot', 'umd', 'hole', 'shine'] as const;

export type MediaSize = 'sz-s' | 'sz-m' | 'sz-l' | 'sz-xl';

export interface MediaOptions {
  size?: MediaSize;
  /** Texto de la etiqueta (por defecto la plataforma corta). */
  label?: string;
  /** Insignia de aviso en la esquina (-9px): texto y tipo. */
  flag?: { text: string; kind?: 'warn' | 'danger' | 'info' | 'ok' };
  /** Zoom fino (`--mz`), multiplica el tamaño base de la silueta. */
  mz?: number;
  /** Clases extra para el contenedor. */
  cls?: string;
  /** Atributos extra ya escapados (p. ej. `title`). */
  extra?: string;
}

/**
 * Soporte completo (`.media.<estilo>`) con sus spans y la insignia opcional.
 * El tamaño base lo pone el CSS de cada silueta; `size`/`mz` lo escalan.
 */
export function mediaMarkup(style: MediaStyle, opts: MediaOptions = {}): string {
  const spans = MEDIA_SPANS[style] ?? MEDIA_SPANS.cd;
  const label = opts.label ?? '';
  const body = SPAN_ORDER.filter((name) => spans.includes(name))
    .map((name) => {
      if (name === 'label') return `<span class="label">${esc(label)}</span>`;
      return `<span class="${name}"></span>`;
    })
    .join('');
  const flag = opts.flag
    ? `<span class="flag" data-kind="${opts.flag.kind ?? 'warn'}">${esc(opts.flag.text)}</span>`
    : '';
  const cls = `media ${style}${opts.size ? ` ${opts.size}` : ''}${opts.cls ? ` ${opts.cls}` : ''}`;
  const styleAttrValue = opts.mz ? styleAttr({ '--mz': String(opts.mz) }) : '';
  return (
    `<div class="${esc(cls)}"${styleAttrValue} aria-hidden="true"${opts.extra ?? ''}>` +
    `${body}${flag}</div>`
  );
}

/** Estilo de soporte efectivo de un port según los ajustes activos. */
export function mediaStyleOf(port: PortItem, settings?: Settings | null): MediaStyle {
  return catalogService.getMediaStyle(port, settings ?? null);
}

/** Slot de soporte que se superpone a la carátula (posters y lista). */
export function mediaSlot(port: PortItem, shared: ViewShared = {}): string {
  const enabled = shared.media ?? shared.settings?.media ?? true;
  if (!enabled) return '';
  const style = mediaStyleOf(port, shared.settings);
  return (
    `<div class="media-slot">` +
    mediaMarkup(style, {
      size: 'sz-s',
      mz: 0.62,
      label: PLATFORM_SHORT[port.sourcePlatform] ?? '',
    }) +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Delegación de eventos                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cablea los clics (y Enter/Espacio en las tarjetas) de un contenedor de
 * fichas. Devuelve la función para desengancharlo.
 */
export function delegatePortEvents(root: HTMLElement, shared: ViewShared = {}): () => void {
  const cb = shared.callbacks ?? {};

  function fire(pid: string, kind: PortActionKind): void {
    if (kind === 'gear') cb.onGear?.(pid);
    else if (kind === 'open' || kind === 'details') {
      if (cb.onOpen) cb.onOpen(pid);
      else cb.onAction?.(pid, kind);
    } else cb.onAction?.(pid, kind);
  }

  function resolve(event: Event): { pid: string; kind: PortActionKind } | null {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const actEl = target.closest<HTMLElement>('[data-act]');
    if (!actEl) return null;
    if (actEl instanceof HTMLButtonElement && actEl.disabled) return null;
    const host = actEl.closest<HTMLElement>('[data-pid]');
    const pid = actEl.dataset.pid ?? host?.dataset.pid ?? '';
    if (!pid) return null;
    return { pid, kind: (actEl.dataset.act ?? 'open') as PortActionKind };
  }

  function onClick(event: Event): void {
    const hit = resolve(event);
    if (!hit) return;
    event.preventDefault();
    fire(hit.pid, hit.kind);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target instanceof HTMLButtonElement) return; // el navegador ya lo hace
    const hit = resolve(event);
    if (!hit) return;
    event.preventDefault();
    fire(hit.pid, hit.kind);
  }

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeyDown);
  };
}

/* -------------------------------------------------------------------------- */
/* Tarjeta                                                                    */
/* -------------------------------------------------------------------------- */

/** Tarjeta de carátula individual (`.card`). */
export function posterCard(port: PortItem, shared: ViewShared = {}): string {
  const state = stateOf(port.pid, shared);
  const version = versionText(port);
  const label =
    `${port.name} · ${PLATFORM_SHORT[port.sourcePlatform] ?? port.sourcePlatform} · ` +
    LIBRARY_STATE_LABELS[state];
  const meta = [
    PLATFORM_SHORT[port.sourcePlatform] ?? port.sourcePlatform,
    version,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    `<div class="card" data-pid="${esc(port.pid)}" data-act="open" tabindex="0" ` +
    `role="article" aria-label="${esc(label)}">` +
    '<div class="cover">' +
    `<div class="badges">${platPill(port)}${devChip(port, { short: true })}</div>` +
    coverMarkup(port) +
    mediaSlot(port, shared) +
    '</div>' +
    `<div class="ct" title="${esc(port.name)}">${esc(port.name)}</div>` +
    `<div class="cs"><span class="nm">${esc(meta)}</span>` +
    `<span class="sep" aria-hidden="true">·</span>` +
    `<span class="nm">${esc(INSTALL_STRATEGY_LABELS[port.installStrategy] ?? '')}</span></div>` +
    '<div class="cs" style="justify-content:space-between;gap:6px">' +
    actionButton(port, state) +
    gearButton(port, state) +
    '</div>' +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Vista                                                                      */
/* -------------------------------------------------------------------------- */

/** Vista de carátulas completa (`.grid`). */
export function renderPosters(ports: readonly PortItem[], shared: ViewShared = {}): string {
  const cards = ports.map((port) => posterCard(port, shared)).join('');
  return `<div class="grid" data-view="posters">${cards}</div>`;
}

/** Monta la vista en un contenedor y devuelve el desenganche de eventos. */
export function mountPosters(
  host: HTMLElement,
  ports: readonly PortItem[],
  shared: ViewShared = {}
): () => void {
  host.innerHTML = renderPosters(ports, shared);
  const grid = host.querySelector<HTMLElement>('.grid') ?? host;
  return delegatePortEvents(grid, shared);
}

export default renderPosters;
