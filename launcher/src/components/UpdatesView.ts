/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/UpdatesView.ts
 *
 * Vista de Actualizaciones (spec v4/v5) en tres bloques independientes:
 *
 *   1. Pendientes en tus ports   → versión nueva de algo ya instalado.
 *   2. Atención en lo instalado  → abandonado o con bugs que no avanzan.
 *   3. Novedades del catálogo    → no instalado y con actividad reciente.
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   .sbox > h3        → caja de sección
 *   .upd / .upd.on     → fila de actualización
 *   .upd .uinfo / .uver
 *   .bar (> i)         → progreso de escaneo
 *   .empty / .eico / .etit
 *
 * El modelo es puro (`buildUpdatesModel`) para poder probarlo sin DOM; el
 * render devuelve cadenas HTML y la delegación usa `data-act` + `data-pid`,
 * igual que el resto de vistas.
 * ========================================================================== */

import type { DevTag, LibraryGame, LibraryState, PortItem } from '../services/types';
import { LIBRARY_STATE_LABELS, PLATFORM_SHORT } from '../services/types';
import { libraryService } from '../services/libraryService';
import { esc, icon } from './Icons';
import { devChip, devInfo, isInstalledState, statePill } from './PostersView';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export interface UpdateEntry {
  port: PortItem;
  state: LibraryState;
  currentVersion: string | null;
  newVersion: string | null;
  releasedAt: string | null;
  /** Motivo legible de por qué aparece aquí. */
  reason: string;
}

export interface AttentionEntry {
  port: PortItem;
  state: LibraryState;
  tag: DevTag;
  reason: string;
  bugs: number;
  lastChange: string | null;
}

export interface UpdatesModel {
  pending: UpdateEntry[];
  attention: AttentionEntry[];
  fresh: PortItem[];
  counts: { pending: number; attention: number; fresh: number };
}

export interface UpdatesOptions {
  /** Estados locales por pid (por defecto los de `libraryService`). */
  states?: Record<string, LibraryState> | Map<string, LibraryState>;
  /** Días de actividad reciente para el bloque 3 (por defecto 60). */
  freshDays?: number;
  /** Máximo de novedades listadas (por defecto 12). */
  maxFresh?: number;
  onUpdate?: (pid: string) => void;
  onUpdateAll?: (pids: string[]) => void;
  onOpen?: (pid: string) => void;
  onToast?: (message: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
}

export interface UpdatesCallbacks {
  onUpdate?: (pid: string) => void;
  onUpdateAll?: (pids: string[]) => void;
  onOpen?: (pid: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stateOf(pid: string, states?: UpdatesOptions['states']): LibraryState {
  if (states instanceof Map) return states.get(pid) ?? 'NotInstalled';
  if (states) return states[pid] ?? 'NotInstalled';
  return libraryService.getLibraryGame(pid).state;
}

function gameOf(pid: string): LibraryGame {
  return libraryService.getLibraryGame(pid);
}

/** Compara versiones tipo `1.2.3`, `v1.2`, `2026.10.24.3`. */
export function compareVersions(a: string, b: string): number {
  const clean = (value: string): Array<number | string> =>
    value
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part));

  const left = clean(a);
  const right = clean(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const one = left[index];
    const two = right[index];
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    if (typeof one === 'number' && typeof two === 'number') {
      if (one !== two) return one < two ? -1 : 1;
      continue;
    }
    const result = String(one).localeCompare(String(two), 'es');
    if (result !== 0) return result;
  }
  return 0;
}

/** Fecha de actividad más reciente conocida del port. */
export function lastActivity(port: PortItem): string {
  const candidates: string[] = [];
  const released = str(port.verifiedRelease?.releasedAt);
  if (released) candidates.push(released);
  for (const source of port.sources ?? []) {
    const seen = str(source.lastSeen);
    if (seen) candidates.push(seen);
  }
  const status = str(port.status?.computedAt);
  if (status) candidates.push(status);
  return candidates
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .pop() ?? '';
}

function daysSince(iso: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

function relativeDays(days: number): string {
  if (!Number.isFinite(days)) return 'sin fecha';
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
  const years = Math.floor(days / 365);
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`;
}

/* -------------------------------------------------------------------------- */
/* Modelo                                                                     */
/* -------------------------------------------------------------------------- */

export function buildUpdatesModel(
  ports: readonly PortItem[],
  options: UpdatesOptions = {}
): UpdatesModel {
  const freshDays = options.freshDays ?? 60;
  const maxFresh = options.maxFresh ?? 12;
  const pending: UpdateEntry[] = [];
  const attention: AttentionEntry[] = [];
  const fresh: PortItem[] = [];

  for (const port of ports) {
    if (port.visible === false) continue;
    const state = stateOf(port.pid, options.states);
    const installed = isInstalledState(state) || state === 'UpdateAvailable';
    const game = gameOf(port.pid);
    const newVersion = str(port.verifiedRelease?.version) || null;
    const currentVersion = str(game.installedVersion) || null;

    /* 1. Pendientes: instalado + versión nueva conocida. */
    if (installed && newVersion && newVersion !== currentVersion) {
      const pinned = str(game.pinnedVersion);
      const isNew = !currentVersion || compareVersions(newVersion, currentVersion) > 0;
      if (isNew && (!pinned || pinned === newVersion)) {
        pending.push({
          port,
          state,
          currentVersion,
          newVersion,
          releasedAt: str(port.verifiedRelease?.releasedAt) || null,
          reason: currentVersion
            ? `Instalada v${currentVersion} · disponible v${newVersion}`
            : `Instalada fuera de catálogo · disponible v${newVersion}`,
        });
      }
    }

    /* 2. Atención: abandonado o con bugs abiertos que no avanzan. */
    if (installed) {
      const info = devInfo(port);
      const bugs = Number(port.status?.community?.bugReports ?? 0) || 0;
      if (info.tag === 'abandoned' || (info.tag === 'bugs' && bugs >= 5)) {
        attention.push({
          port,
          state,
          tag: info.tag,
          reason: info.why || (info.tag === 'abandoned' ? 'Proyecto abandonado.' : 'Con bugs abiertos.'),
          bugs,
          lastChange: lastActivity(port) || null,
        });
      }
    }

    /* 3. Novedades: no instalado y con actividad reciente. */
    if (!installed) {
      const activity = lastActivity(port);
      if (activity && daysSince(activity) <= freshDays) fresh.push(port);
    }
  }

  pending.sort((a, b) => a.port.name.localeCompare(b.port.name, 'es'));
  attention.sort((a, b) => b.bugs - a.bugs || a.port.name.localeCompare(b.port.name, 'es'));
  fresh.sort((a, b) => Date.parse(lastActivity(b)) - Date.parse(lastActivity(a)));

  const freshList = fresh.slice(0, maxFresh);

  return {
    pending,
    attention,
    fresh: freshList,
    counts: {
      pending: pending.length,
      attention: attention.length,
      fresh: fresh.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

function emptyBlock(iconName: string, title: string, text: string): string {
  return (
    '<div class="empty">' +
    `<span class="eico" aria-hidden="true">${icon(iconName, { size: 30 })}</span>` +
    `<span class="etit">${esc(title)}</span>` +
    `<span style="max-width:54ch;font-size:var(--fs-s)">${esc(text)}</span>` +
    '</div>'
  );
}

function sectionHeader(title: string, count: number, extra = ''): string {
  // `.sbox > h3` sólo aplica a hijos directos: aquí el rótulo va dentro de una
  // fila flex con el contador y el botón, así que replicamos el estilo.
  const style =
    'margin:0;font-family:var(--f-display);font-size:var(--fs-s);font-weight:700;' +
    'letter-spacing:var(--ls-caps);text-transform:uppercase;color:var(--muted)';
  return (
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
    `<h3 style="${style}">${esc(title)}</h3>` +
    `<span class="pill">${count}</span>` +
    '<span style="margin-left:auto"></span>' +
    extra +
    '</div>'
  );
}

function pendingBlock(model: UpdatesModel): string {
  const all = model.pending.map((entry) => entry.port.pid);
  const action = model.pending.length
    ? `<button type="button" class="btn pri sm" data-act="update-all" ` +
      `data-pids="${esc(all.join(','))}" title="Actualizar todos los ports pendientes">` +
      `${icon('upd', { size: 15 })}<span>Actualizar todo</span></button>`
    : '';

  const rows = model.pending
    .map((entry) => {
      const port = entry.port;
      return (
        '<div class="upd">' +
        `<div class="uinfo" data-act="open" data-pid="${esc(port.pid)}" tabindex="0" ` +
        `title="Abrir la ficha de ${esc(port.name)}">` +
        `<b style="font-family:var(--f-display)">${esc(port.name)}</b>` +
        `<span class="uver">${esc(entry.reason)}` +
        `${entry.releasedAt ? ` · publicada ${esc(relativeDays(daysSince(entry.releasedAt)))}` : ''}` +
        ` · ${esc(LIBRARY_STATE_LABELS[entry.state])}</span>` +
        '</div>' +
        devChip(port, { short: true }) +
        `<button type="button" class="btn warn sm" data-act="update" data-pid="${esc(port.pid)}" ` +
        `title="Actualizar ${esc(port.name)}">` +
        `${icon('upd', { size: 15 })}<span>Actualizar</span></button>` +
        '</div>'
      );
    })
    .join('');

  return (
    '<section class="sbox">' +
    sectionHeader('Pendientes en tus ports', model.pending.length, action) +
    (rows ||
      emptyBlock(
        'check',
        'Todo al día',
        'Ninguno de tus ports instalados tiene una versión más reciente en el índice.'
      )) +
    '</section>'
  );
}

function attentionBlock(model: UpdatesModel): string {
  const rows = model.attention
    .map((entry) => {
      const port = entry.port;
      const badge =
        entry.tag === 'abandoned'
          ? '<span class="pill st-abandoned">abandonado</span>'
          : `<span class="pill st-bugs">${entry.bugs} bugs</span>`;
      return (
        '<div class="upd">' +
        `<div class="uinfo" data-act="open" data-pid="${esc(port.pid)}" tabindex="0" ` +
        `title="Abrir la ficha de ${esc(port.name)}">` +
        `<b style="font-family:var(--f-display)">${esc(port.name)}</b>` +
        `<span class="uver">${esc(entry.reason)}` +
        `${entry.lastChange ? ` · último cambio ${esc(relativeDays(daysSince(entry.lastChange)))}` : ''}` +
        '</span></div>' +
        badge +
        statePill(entry.state, { hideNotInstalled: true }) +
        `<button type="button" class="btn sm" data-act="open" data-pid="${esc(port.pid)}" ` +
        `title="Ver alternativas y estado de ${esc(port.name)}">` +
        `${icon('info', { size: 15 })}<span>Revisar</span></button>` +
        '</div>'
      );
    })
    .join('');

  return (
    '<section class="sbox">' +
    sectionHeader('Atención en lo instalado', model.attention.length) +
    (rows ||
      emptyBlock(
        'shield',
        'Nada que revisar',
        'Lo que tienes instalado no está marcado como abandonado ni acumula bugs abiertos.'
      )) +
    '</section>'
  );
}

function freshBlock(model: UpdatesModel): string {
  const rows = model.fresh
    .map((port) => {
      const activity = lastActivity(port);
      return (
        '<div class="upd">' +
        `<div class="uinfo" data-act="open" data-pid="${esc(port.pid)}" tabindex="0" ` +
        `title="Abrir la ficha de ${esc(port.name)}">` +
        `<b style="font-family:var(--f-display)">${esc(port.name)}</b>` +
        `<span class="uver">${esc(PLATFORM_SHORT[port.sourcePlatform] ?? port.sourcePlatform)}` +
        `${port.verifiedRelease?.version ? ` · v${esc(String(port.verifiedRelease.version))}` : ''}` +
        `${activity ? ` · actividad ${esc(relativeDays(daysSince(activity)))}` : ''}</span>` +
        '</div>' +
        devChip(port, { short: true }) +
        `<button type="button" class="btn sm" data-act="open" data-pid="${esc(port.pid)}" ` +
        `title="Ver ${esc(port.name)}">` +
        `${icon('chevronRight', { size: 15 })}<span>Ver</span></button>` +
        '</div>'
      );
    })
    .join('');

  return (
    '<section class="sbox">' +
    sectionHeader('Novedades del catálogo', model.counts.fresh) +
    (rows ||
      emptyBlock(
        'upd',
        'Sin novedades recientes',
        'Ningún port no instalado tiene actividad en su repositorio en la ventana analizada.'
      )) +
    '</section>'
  );
}

/** Resumen superior con los tres contadores. */
function summaryBlock(model: UpdatesModel): string {
  const card = (label: string, value: number, color: string, glyph: string): string =>
    '<div class="upd" style="flex-direction:column;align-items:flex-start;gap:2px">' +
    `<span class="uver" style="color:${color}">${glyph} ${esc(label)}</span>` +
    `<b style="font-family:var(--f-display);font-size:var(--fs-xl)">${value}</b>` +
    '</div>';

  return (
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">' +
    card('Pendientes', model.counts.pending, 'var(--accent2)', '↑') +
    card('A revisar', model.counts.attention, 'var(--warn)', '!') +
    card('Novedades', model.counts.fresh, 'var(--st-playable)', '✦') +
    '</div>'
  );
}

/** Vista completa de Actualizaciones. */
export function renderUpdates(ports: readonly PortItem[], options: UpdatesOptions = {}): string {
  const model = buildUpdatesModel(ports, options);
  return (
    '<div class="view" data-view="updates">' +
    summaryBlock(model) +
    pendingBlock(model) +
    attentionBlock(model) +
    freshBlock(model) +
    '<p class="mono" style="font-size:var(--fs-2xs);color:var(--muted);margin:0">' +
    'Las comprobaciones se hacen contra el índice local. Las actualizaciones se instalan ' +
    'con la misma máquina de estados que una instalación nueva.' +
    '</p>' +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Delegación / montaje                                                       */
/* -------------------------------------------------------------------------- */

/** Cablea las acciones de la vista (sobrevive a repintados del contenedor). */
export function delegateUpdateEvents(root: HTMLElement, callbacks: UpdatesCallbacks = {}): () => void {
  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hit = target.closest<HTMLElement>('[data-act]');
    if (!hit) return;
    if (hit instanceof HTMLButtonElement && hit.disabled) return;
    const act = hit.dataset.act;

    if (act === 'update-all') {
      event.preventDefault();
      const pids = (hit.dataset.pids ?? '')
        .split(',')
        .map((pid) => pid.trim())
        .filter(Boolean);
      if (pids.length > 0) callbacks.onUpdateAll?.(pids);
      return;
    }
    if (act === 'update') {
      event.preventDefault();
      const pid = hit.dataset.pid;
      if (pid) callbacks.onUpdate?.(pid);
      return;
    }
    if (act === 'open') {
      event.preventDefault();
      const pid = hit.dataset.pid;
      if (pid) callbacks.onOpen?.(pid);
    }
  }

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

/** Monta la vista en un contenedor y devuelve el desenganche. */
export function mountUpdates(
  host: HTMLElement,
  ports: readonly PortItem[],
  options: UpdatesOptions = {}
): () => void {
  host.innerHTML = renderUpdates(ports, options);
  const root = host.querySelector<HTMLElement>('[data-view="updates"]') ?? host;
  return delegateUpdateEvents(root, {
    onUpdate: options.onUpdate,
    onUpdateAll: options.onUpdateAll,
    onOpen: options.onOpen,
  });
}

export default renderUpdates;
