/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/PostersView.ts
 *
 * Vista de carátulas (`.grid` > `.card`) **y piezas compartidas** por el resto
 * de vistas: chip de desarrollo (`.dev`), píldora de estado (`.pill`), pegatina
 * de plataforma (`.tag`), carátula generativa y delegación de eventos.
 *
 * Fidelidad: la tarjeta reproduce el markup del prototipo de Claude
 * (`posterCard()` del prototipo, líneas 376-381):
 *
 *   article.card[data-act=open]
 *     div.poster            ← `background: art(c,p)` + <img> si hay coverUrl
 *       span.tag            ← plataforma (z-index por encima de la portada)
 *       span.devp           ← chip de desarrollo (z-index por encima)
 *       span.t              ← texto de carátula
 *     button.gear           ← sólo si está instalado (regla v4)
 *     div.meta
 *       b                   ← nombre
 *       span.muted          ← proyecto · versión
 *       div                 ← píldora de estado + acción primaria
 *
 * Todos los componentes devuelven **cadenas HTML** y delegan los clics por
 * atributos (`data-pid` + `data-act`), de modo que el llamante puede usar
 * `delegatePortEvents()` o su propio manejador.
 * ========================================================================== */

import type { DevTag, DevTagInfo, LibraryState, MediaStyle, PortItem, Settings } from '../services/types';
import {
  INSTALL_STRATEGY_LABELS,
  LIBRARY_STATE_LABELS,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
} from '../services/types';
import { catalogService } from '../services/catalogService';
import { esc, icon } from './Icons';
import { artCss, coverTitle, cssUrl, mediaHTML, platNeon, styleFor, subjectOf } from './Media';

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
  /** Clase del botón (`btn sm pri`, `btn sm warn`…). */
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
 * Chip de desarrollo `.dev` con el color de estado, el glifo y el texto
 * (exactamente como `devChip()` del prototipo).
 */
export function devChip(
  port: PortItem,
  opts: { short?: boolean; large?: boolean; title?: boolean; cls?: string } = {}
): string {
  const info = devInfo(port);
  const tag: DevTag = info.tag;
  const text = opts.short ? info.text : info.label;
  const title =
    opts.title === false
      ? ''
      : `${info.label} · confianza ${info.conf}${info.why ? ` — ${info.why}` : ''}`;
  const cls = `dev${opts.large ? ' lg' : ''}${opts.cls ? ` ${opts.cls}` : ''}`;
  return (
    `<span class="${esc(cls)}" data-dev="${tag}" style="--c:${info.color}"` +
    (title ? ` title="${esc(title)}"` : '') +
    ` aria-label="${esc(`${info.label}, confianza ${info.conf}`)}">` +
    `<span aria-hidden="true">${esc(info.glyph)}</span> ${esc(text)}</span>`
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
  Ready: 'var(--accent2)',
  UpdateAvailable: 'var(--accent)',
  Broken: 'var(--danger)',
};

/** Píldora del estado local (biblioteca), con el `--c` del prototipo. */
export function statePill(state: LibraryState, opts: { hideNotInstalled?: boolean } = {}): string {
  if (opts.hideNotInstalled && state === 'NotInstalled') return '';
  const color = STATE_COLOR[state];
  return (
    `<span class="pill" data-state="${state}" style="--c:${color}" ` +
    `title="${esc(LIBRARY_STATE_LABELS[state])}">` +
    `<span aria-hidden="true">${esc(STATE_GLYPH[state])}</span> ${esc(LIBRARY_STATE_LABELS[state])}</span>`
  );
}

/** Pegatina `.tag` de la plataforma de origen (misma que el prototipo). */
export function platTag(port: PortItem): string {
  return `<span class="tag">${esc(PLATFORM_SHORT[port.sourcePlatform] || port.sourcePlatform)}</span>`;
}

/** Píldora de plataforma de origen con el neón correspondiente. */
export function platPill(port: PortItem): string {
  const plat = port.sourcePlatform;
  return (
    `<span class="pill" data-plat="${esc(plat)}" style="--c:${platNeon(plat)}" ` +
    `title="${esc(PLATFORM_LABELS[plat] ?? plat)}">${esc(PLATFORM_SHORT[plat] ?? plat)}</span>`
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

/** Versión verificada/publicada como texto mono. */
export function versionText(port: PortItem): string {
  const v = port.verifiedRelease?.version;
  if (!v) return '';
  return `v${v.replace(/^v/i, '')}`;
}

/**
 * Línea «proyecto · versión» del prototipo.
 *
 * `project` debería ser `string`, pero en datos heredados llega como objeto
 * (`{'key': …}`): se normaliza a su nombre/clave y NUNCA se imprime el objeto
 * (que además rompería `String.prototype.trim()`).
 */
export function metaText(port: PortItem): string {
  const version = versionText(port);
  const project = projectName(port.project);
  return [project, version].filter(Boolean).join(' · ') || PLATFORM_LABELS[port.sourcePlatform] || '';
}

/** Nombre legible de `project`: `string` o `{ name | key }`. */
function projectName(project: PortItem['project']): string {
  const raw = project as unknown;
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw !== 'object') return String(raw).trim();
  const obj = raw as { name?: unknown; key?: unknown };
  const name = typeof obj.name === 'string' ? obj.name : '';
  const key = typeof obj.key === 'string' ? obj.key : '';
  return (name || key).trim();
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
      return { kind: 'play', label: 'Jugar', cls: 'btn sm pri', disabled: false, iconName: 'play' };
    case 'Installed':
      return portNeedsRomHint(port)
        ? { kind: 'rom', label: 'Añadir ROM', cls: 'btn sm pri', disabled: false, iconName: 'rom' }
        : { kind: 'play', label: 'Jugar', cls: 'btn sm pri', disabled: false, iconName: 'play' };
    case 'NeedsRom':
      return { kind: 'rom', label: 'Añadir ROM', cls: 'btn sm warn', disabled: false, iconName: 'rom' };
    case 'Downloading':
      return { kind: 'install', label: 'Descargando…', cls: 'btn sm', disabled: true, iconName: 'spinner' };
    case 'Installing':
      return { kind: 'install', label: 'Instalando…', cls: 'btn sm', disabled: true, iconName: 'spinner' };
    case 'UpdateAvailable':
      return { kind: 'update', label: 'Actualizar', cls: 'btn sm warn', disabled: false, iconName: 'upd' };
    case 'Broken':
      return { kind: 'retry', label: 'Reinstalar', cls: 'btn sm dng', disabled: false, iconName: 'retry' };
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
  return { kind: 'install', label: 'Instalar', cls: 'btn sm pri', disabled: false, iconName: 'download' };
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

/** Botón de acción primaria listo para insertar (`actBtn()` del prototipo). */
export function actionButton(port: PortItem, state: LibraryState): string {
  const action = portAction(port, state);
  return (
    `<button type="button" class="${esc(action.cls)}" data-act="${action.kind}" ` +
    `data-pid="${esc(port.pid)}" ${attrDisabled(action.disabled)} ` +
    `title="${esc(action.label)}">` +
    `${action.kind === 'play' ? icon('play', { size: 14 }) : ''}<span>${esc(action.label)}</span></button>`
  );
}

function attrDisabled(disabled: boolean): string {
  return disabled ? 'disabled aria-disabled="true"' : '';
}

/** Botón ⚙ (sólo cuando la ficha tiene algo instalado, regla v4). */
export function gearButton(port: PortItem, state: LibraryState, cls = 'gear'): string {
  if (!isInstalledState(state)) return '';
  return (
    `<button type="button" class="${esc(cls)}" data-act="gear" data-pid="${esc(port.pid)}" ` +
    `title="Ajustes de ${esc(port.name)}" aria-label="Ajustes de ${esc(port.name)}">` +
    `${icon('gear', { size: 15 })}</button>`
  );
}

/* -------------------------------------------------------------------------- */
/* Carátula generativa                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Capa de arte generativo (`art(c, p)`) como bloque absoluto que rellena su
 * contenedor. Es lo que usan las miniaturas y la ficha de detalle.
 */
export function art(port: PortItem, opts: { cover?: string; compact?: boolean } = {}): string {
  const subject = subjectOf(port);
  /** `compact` reduce el monograma; por defecto se mantiene el tamaño original. */
  const fs = opts.compact ? 16 : 22;
  return (
    '<span class="art" aria-hidden="true" style="position:absolute;inset:0;display:grid;' +
    `place-items:center;background:${artCss(subject)}">` +
    `<b style="font:700 ${fs}px/1 var(--f-display);color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6);` +
    `white-space:pre-line;text-align:center">${esc(opts.cover ?? coverTitle(port.name))}</b>` +
    '</span>'
  );
}

/** Fondo CSS de carátula de una ficha (para `style="background:…"`). */
export function artBackground(port: PortItem): string {
  return artCss(subjectOf(port));
}

/** `<img>` de portada con el arte generativo como respaldo. */
export function coverMarkup(port: PortItem, opts: { cls?: string } = {}): string {
  const img = port.coverUrl
    ? `<img class="${esc(opts.cls ?? 'cimg')}" src="${esc(port.coverUrl)}" alt="" loading="lazy" ` +
      'decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">'
    : '';
  return art(port) + img;
}

/* -------------------------------------------------------------------------- */
/* Soportes (cartuchos y discos)                                              */
/* -------------------------------------------------------------------------- */

/** Estilo de soporte efectivo de un port según los ajustes activos. */
export function mediaStyleOf(port: PortItem, settings?: Settings | null): MediaStyle {
  return styleFor(port, settings ?? null);
}

/**
 * Soporte completo (cartucho o disco) de una ficha, con la carátula real si la
 * hay y la insignia de aviso opcional. Delega en el port de `mediaHTML()`.
 */
export function mediaMarkup(
  style: MediaStyle,
  opts: {
    port?: PortItem | null;
    label?: string;
    flag?: { text: string; color: string } | null;
    mz?: number;
    cover?: string;
    cls?: string;
    extra?: string;
    size?: string;
  } = {}
): string {
  const subject = opts.port
    ? subjectOf(opts.port)
    : { pid: `style-${style}`, name: style.toUpperCase(), sourcePlatform: 'other' as const };
  /** `size` (`.sz-s`, `.sz-m`, `.sz-l`, `.sz-xl`…) se suma a las clases del soporte. */
  const cls = [opts.cls, opts.size].filter(Boolean).join(' ');
  return mediaHTML(subject, style, {
    label: opts.label,
    flag: opts.flag ?? null,
    mz: opts.mz,
    cover: opts.cover,
    cls: cls || undefined,
    extra: opts.extra,
  });
}

/** Slot de soporte que se superpone a la carátula (posters y lista). */
export function mediaSlot(port: PortItem, shared: ViewShared = {}): string {
  const enabled = shared.media ?? shared.settings?.media ?? true;
  if (!enabled) return '';
  const style = mediaStyleOf(port, shared.settings);
  return (
    '<div class="media-slot">' +
    mediaMarkup(style, {
      port,
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

/** Tarjeta de carátula individual (`.card`), markup del prototipo. */
export function posterCard(port: PortItem, shared: ViewShared = {}): string {
  const state = stateOf(port.pid, shared);
  const label =
    `${port.name} · ${PLATFORM_SHORT[port.sourcePlatform] ?? port.sourcePlatform} · ` +
    LIBRARY_STATE_LABELS[state];

  /* Con carátula real: la imagen va de fondo del `.poster` (`cover` centrado) y
     NO se pinta el texto de carátula, que taparía el arte. Sin carátula: fondo
     generativo + título. */
  const cover = (port.coverUrl ?? '').trim();
  const posterStyle = cover
    ? `background-image: url('${cssUrl(cover)}'); ` +
      'background-size: cover; background-position: center;'
    : `background: ${artBackground(port)}`;
  const title = cover ? '' : `<span class="t">${esc(coverTitle(port.name))}</span>`;

  return (
    `<article class="card" data-pid="${esc(port.pid)}" data-act="open" tabindex="0" ` +
    `role="link" aria-label="${esc(label)}">` +
    `<div class="poster" style="${posterStyle}">` +
    platTag(port) +
    `<span class="devp">${devChip(port, { short: true })}</span>` +
    title +
    '</div>' +
    gearButton(port, state) +
    '<div class="meta">' +
    `<b title="${esc(port.name)}">${esc(port.name)}</b>` +
    `<span class="muted" style="font-size:12px">${esc(metaText(port))}</span>` +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:space-between">' +
    statePill(state) +
    actionButton(port, state) +
    '</div></div></article>'
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
