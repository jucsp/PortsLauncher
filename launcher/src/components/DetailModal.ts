/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/DetailModal.ts
 *
 * Ficha completa de un port (`.scrim` > `.modal.wide` > `.detail`).
 *
 * Estructura (spec v5 §10):
 *   .mhead            → nombre + botón de cierre
 *   .dhero            → portada/banner con degradado + metadatos + CTA
 *   .tabs             → Resumen · Versiones · Fuentes
 *   .dbody (grid)     → contenido de la pestaña + `.sbox` lateral
 *
 * **Sin sección de comunidad**: no hay pestaña de reseñas/opiniones ni caja
 * lateral de valoraciones agregadas. El estado de desarrollo se explica con
 * las señales objetivas del índice (regla aplicada, último cambio, bugs
 * abiertos y confianza), nunca con cifras de opinión de terceros.
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   .scrim / .modal.wide / .mhead / .mbody / .mfoot   (§9)
 *   .dhero .dcover .dinfo .dsub .ddesc .dmeta .dactions (§11)
 *   .tabs button[aria-selected] / .sbox / .kv dt dd     (§11)
 *
 * Igual que el resto de componentes, devuelve **cadenas HTML** y comunica las
 * acciones mediante `data-act` + `data-pid`, de modo que el contenedor puede
 * delegarlas con `delegatePortEvents()` o con su propio manejador. La tecla
 * `Escape` la gestiona el orquestador (`main.ts`), que llama a `close()`.
 * ========================================================================== */

import type {
  InstallStrategy,
  LibraryGame,
  LibraryState,
  PortItem,
  Settings,
} from '../services/types';
import {
  INSTALL_STRATEGY_LABELS,
  LIBRARY_STATE_LABELS,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
  ROM_BINDING_LABELS,
  TARGET_LABELS,
} from '../services/types';
import { catalogService } from '../services/catalogService';
import { libraryService } from '../services/libraryService';
import { portNeedsRom } from '../services/installerService';
import { esc, icon, styleAttr } from './Icons';
import type { PortActionKind } from './PostersView';
import {
  actionButton,
  art,
  devChip,
  devInfo,
  gearButton,
  isInstalledState,
  platPill,
  statePill,
  strategyChip,
} from './PostersView';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export type DetailTab = 'summary' | 'versions' | 'sources';

export const DETAIL_TABS: ReadonlyArray<{ id: DetailTab; label: string; icon: string }> = [
  { id: 'summary', label: 'Resumen', icon: 'info' },
  { id: 'versions', label: 'Versiones', icon: 'upd' },
  { id: 'sources', label: 'Fuentes', icon: 'external' },
];

export interface DetailStep {
  title: string;
  detail: string;
  /** Paso ya cubierto por el estado actual de la biblioteca. */
  done: boolean;
}

export interface VersionEntry {
  version: string;
  releasedAt: string | null;
  prerelease: boolean;
  pinned: boolean;
  /** De dónde salió la entrada (`verified`, `release`, `installed`). */
  origin: string;
}

export interface DetailRenderOptions {
  /** Estado local; si falta se consulta a `libraryService`. */
  state?: LibraryState;
  tab?: DetailTab;
  settings?: Settings | null;
  /** Ficha de biblioteca ya cargada (evita una segunda consulta). */
  library?: LibraryGame;
}

export interface DetailModalOptions extends DetailRenderOptions {
  /** Contenedor donde montar el modal (por defecto `#layer` o `body`). */
  host?: HTMLElement | null;
  onAction?: (pid: string, kind: PortActionKind) => void;
  onGear?: (pid: string) => void;
  onOpen?: (pid: string) => void;
  onClose?: (pid: string) => void;
}

export interface DetailModalHandle {
  readonly el: HTMLElement;
  open(pid: string, tab?: DetailTab): void;
  close(): void;
  isOpen(): boolean;
  /** Port ficha actualmente visible (o `null`). */
  current(): PortItem | null;
  destroy(): void;
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Fecha corta legible (`12 mar 2026`); `''` si no se puede interpretar. */
export function formatDate(iso: unknown): string {
  const raw = str(iso);
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw.slice(0, 10);
  try {
    return new Date(parsed).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return raw.slice(0, 10);
  }
}

/** «hace 3 días» / «hace 2 meses» a partir de una fecha ISO. */
export function relativeDate(iso: unknown): string {
  const raw = str(iso);
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return formatDate(raw);
  const days = Math.floor((Date.now() - parsed) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
  const years = Math.floor(days / 365);
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`;
}

function yesNo(value: boolean, yes = 'Sí', no = 'No'): string {
  return value ? yes : no;
}

function latestSeen(port: PortItem): string {
  return (port.sources ?? [])
    .map((source) => str(source.lastSeen))
    .filter(Boolean)
    .sort()
    .pop() ?? '';
}

/* -------------------------------------------------------------------------- */
/* Pasos de instalación (Anexo D.2 / D.3)                                     */
/* -------------------------------------------------------------------------- */

const STRATEGY_STEPS: Record<InstallStrategy, string[]> = {
  'release-archive': [
    'Descargar el archivo de la última release',
    'Extraerlo en la carpeta del port',
    'Verificar el ejecutable y los permisos',
    'Registrar el lanzador en PortsHub',
  ],
  'release-appimage': [
    'Descargar el AppImage de la release',
    'Marcarlo como ejecutable (+x)',
    'Registrar el lanzador en PortsHub',
  ],
  'release-installer': [
    'Descargar el instalador de la release',
    'Ejecutarlo (Wine/Proton si es de Windows)',
    'Localizar el ejecutable instalado',
    'Registrar el lanzador en PortsHub',
  ],
  'windows-via-proton': [
    'Descargar el binario de Windows',
    'Crear/abrir un prefijo de Proton',
    'Extraer el juego dentro del prefijo',
    'Registrar el lanzador (runner: Proton)',
  ],
  'source-only': [
    'Clonar el repositorio del proyecto',
    'Compilar siguiendo las instrucciones del README',
    'Verificar el binario resultante',
    'Registrar el lanzador en PortsHub',
  ],
  external: [
    'Abrir la página oficial del proyecto',
    'Descargar manualmente el paquete',
    'Colocarlo en la carpeta del port',
    'Añadir la ROM si hace falta',
  ],
  recipe: [
    'Aplicar la receta del índice (pasos declarados)',
    'Descargar los ficheros indicados',
    'Verificar el resultado de la receta',
    'Registrar el lanzador en PortsHub',
  ],
  needsChoice: [
    'Elegir la variante (AppImage / archivo / instalador)',
    'Descargar la variante elegida',
    'Instalarla como en esa estrategia',
    'Registrar el lanzador en PortsHub',
  ],
};

/** Lista ordenada de pasos + el paso de ROM cuando el port la requiere. */
export function installSteps(port: PortItem, opts: DetailRenderOptions = {}): DetailStep[] {
  const state = opts.state ?? libraryService.getLibraryGame(port.pid).state;
  const manifest = STRATEGY_STEPS[port.installStrategy] ?? STRATEGY_STEPS.external;
  const romPath = opts.library?.romPath ?? libraryService.getLibraryGame(port.pid).romPath;
  const validatedAt = opts.library?.romValidatedAt ?? libraryService.getLibraryGame(port.pid).romValidatedAt;
  const needsRom = portNeedsRom(port);

  const steps: DetailStep[] = manifest.map((title, index) => ({
    title,
    detail: index === 0 ? 'Automático' : 'Automático',
    done: state === 'Ready' || state === 'Installed' || (state === 'UpdateAvailable' && index === 0),
  }));

  if (steps[1]) steps[1].detail = `Destino: ${resolveDirHint(port)}`;

  if (needsRom) {
    const profile = port.romProfile ?? { binding: 'in-app', extensions: [] };
    const exts = (profile.extensions ?? []).map((ext) => `.${String(ext).replace(/^\./, '')}`);
    const destination = str(profile.destination) || '(carpeta del port)';
    steps.push({
      title: 'Aportar la ROM del juego original',
      detail:
        `Introduce ${exts.length ? exts.join(', ') : 'el fichero que pida el port'} · ` +
        `${ROM_BINDING_LABELS[profile.binding] ?? profile.binding} → ${destination}`,
      done: !!str(romPath) && !!str(validatedAt),
    });
  }

  if (state === 'Ready' || state === 'Installed') {
    // El último paso siempre es "ejecutar"; marcarlo como pendiente es ruido.
    steps.push({
      title: 'Jugar desde PortsHub',
      detail: 'El lanzador queda registrado en la biblioteca local',
      done: false,
    });
  }

  return steps;
}

function resolveDirHint(port: PortItem): string {
  const settings = libraryService.getSettings();
  const folder = str(port.folderName) || port.pid;
  return `${settings.installDir.replace(/\/+$/, '')}/${folder}`;
}

function stepsMarkup(steps: readonly DetailStep[]): string {
  const rows = steps
    .map((step, index) => {
      const glyph = step.done ? '✓' : String(index + 1);
      const color = step.done ? 'var(--st-playable)' : 'var(--muted)';
      return (
        '<li class="set-row" style="align-items:flex-start;gap:10px">' +
        `<span aria-hidden="true" style="${esc(
          `flex:0 0 20px;height:20px;display:grid;place-items:center;border-radius:50%;` +
            `border:1px solid var(--line);font-family:var(--f-mono);font-size:10px;color:${color}`
        )}">${esc(glyph)}</span>` +
        '<div class="sl">' +
        `<b>${esc(step.title)}</b>` +
        `<span>${esc(step.detail)}</span>` +
        '</div>' +
        '</li>'
      );
    })
    .join('');
  return `<ol style="list-style:none;margin:0;padding:0">${rows}</ol>`;
}

/* -------------------------------------------------------------------------- */
/* Versiones                                                                  */
/* -------------------------------------------------------------------------- */

interface RawRelease {
  version?: unknown;
  tag_name?: unknown;
  tagName?: unknown;
  name?: unknown;
  releasedAt?: unknown;
  published_at?: unknown;
  publishedAt?: unknown;
  prerelease?: unknown;
  pinned?: unknown;
}

/** Versiones conocidas: `verifiedRelease`, `raw.releases` y la instalada. */
export function versionsOf(port: PortItem, installedVersion?: string | null): VersionEntry[] {
  const out: VersionEntry[] = [];
  const seen = new Set<string>();

  const push = (entry: VersionEntry): void => {
    const key = entry.version.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  const verified = port.verifiedRelease;
  const verifiedVersion = str(verified?.version);
  if (verifiedVersion) {
    push({
      version: verifiedVersion,
      releasedAt: str(verified?.releasedAt) || null,
      prerelease: verified?.prerelease === true,
      pinned: verified?.pinned === true,
      origin: 'verified',
    });
  }

  const rawReleases = port.raw?.['releases'];
  if (Array.isArray(rawReleases)) {
    for (const item of rawReleases as RawRelease[]) {
      if (!item || typeof item !== 'object') continue;
      const version =
        str(item.version) || str(item.tag_name) || str(item.tagName) || str(item.name);
      if (!version) continue;
      push({
        version,
        releasedAt: str(item.releasedAt) || str(item.published_at) || str(item.publishedAt) || null,
        prerelease: item.prerelease === true || /-(alpha|beta|rc|pre)/i.test(version),
        pinned: item.pinned === true,
        origin: 'release',
      });
    }
  }

  const installed = str(installedVersion);
  if (installed && installed !== 'latest') {
    push({
      version: installed,
      releasedAt: null,
      prerelease: false,
      pinned: false,
      origin: 'installed',
    });
  }

  return out.sort((a, b) => {
    const da = a.releasedAt ? Date.parse(a.releasedAt) : 0;
    const db = b.releasedAt ? Date.parse(b.releasedAt) : 0;
    return (Number.isFinite(db) ? db : 0) - (Number.isFinite(da) ? da : 0);
  });
}

function versionsTab(port: PortItem, opts: DetailRenderOptions): string {
  const game = opts.library ?? libraryService.getLibraryGame(port.pid);
  const entries = versionsOf(port, game.installedVersion);

  if (entries.length === 0) {
    return emptyBlock(
      'upd',
      'Sin versiones publicadas',
      'El índice no tiene releases verificadas para este port. Si instalas, se usará la última disponible en el repositorio.'
    );
  }

  const rows = entries
    .map((entry) => {
      const installed = str(game.installedVersion) === entry.version;
      const tag = entry.pinned
        ? '<span class="pill" title="Versión fijada por el usuario">pin</span>'
        : entry.prerelease
          ? '<span class="pill">pre-release</span>'
          : '';
      const action = installed
        ? '<span class="pill" data-state="Installed">instalada</span>'
        : `<button type="button" class="btn sm" data-act="install-version" ` +
          `data-pid="${esc(port.pid)}" data-version="${esc(entry.version)}" ` +
          `title="Instalar la versión ${esc(entry.version)}">` +
          `${icon('download', { size: 14 })}<span>Instalar</span></button>`;
      return (
        '<div class="upd' + (installed ? ' on' : '') + '">' +
        '<div class="uinfo">' +
        `<b style="font-family:var(--f-display)">v${esc(entry.version.replace(/^v/i, ''))}</b>` +
        `<span class="uver">${esc(
          entry.releasedAt ? `${formatDate(entry.releasedAt)} · ${relativeDate(entry.releasedAt)}` : 'sin fecha'
        )}</span>` +
        '</div>' +
        tag +
        action +
        '</div>'
      );
    })
    .join('');

  const note =
    '<p class="mono" style="font-size:var(--fs-2xs);color:var(--muted);margin:0">' +
    'Las versiones fijadas no se actualizan automáticamente. Instalar una versión concreta ' +
    'descarga esa release del repositorio oficial.</p>';

  return `<div style="display:flex;flex-direction:column;gap:8px">${rows}</div>${note}`;
}

/* -------------------------------------------------------------------------- */
/* Fuentes                                                                    */
/* -------------------------------------------------------------------------- */

export interface OfficialLink {
  label: string;
  url: string;
  kind: 'repository' | 'project' | 'download';
}

/** Enlaces oficiales del port (repositorio o página del proyecto). */
export function officialLinks(port: PortItem): OfficialLink[] {
  const links: OfficialLink[] = [];
  const repository = str(port.repository);
  if (repository && /^[^/\s]+\/[^/\s]+$/.test(repository)) {
    links.push({
      label: `Repositorio ${repository}`,
      url: `https://github.com/${repository}`,
      kind: 'repository',
    });
  }
  const raw = port.raw ?? {};
  const projectUrl = str(raw['projectUrl']) || str(raw['officialUrl']) || str(raw['homepage']);
  if (projectUrl && /^https?:\/\//i.test(projectUrl)) {
    links.push({ label: 'Página del proyecto', url: projectUrl, kind: 'project' });
  }
  const downloadUrl = str(raw['downloadPageUrl']);
  if (downloadUrl && /^https?:\/\//i.test(downloadUrl)) {
    links.push({ label: 'Página de descargas', url: downloadUrl, kind: 'download' });
  }
  return links;
}

function sourcesTab(port: PortItem): string {
  const links = officialLinks(port);
  const buttons = links
    .map(
      (link) =>
        `<a class="btn sm" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer nofollow" ` +
        `title="${esc(link.url)}">${icon('external', { size: 14 })}<span>${esc(link.label)}</span></a>`
    )
    .join('');

  const refs = (port.sources ?? [])
    .map(
      (source) =>
        `<dt>${esc(source.source)}</dt><dd class="mono">${esc(source.externalId)}` +
        (source.catalogVersion ? ` · ${esc(source.catalogVersion)}` : '') +
        (source.lastSeen ? ` · ${esc(formatDate(source.lastSeen))}` : '') +
        '</dd>'
    )
    .join('');

  return (
    '<div class="sbox">' +
    '<h3>Enlaces oficiales</h3>' +
    (buttons
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${buttons}</div>`
      : '<p class="mono" style="font-size:var(--fs-2xs);color:var(--muted);margin:0">' +
        'Este port no declara repositorio ni web oficial en el índice.</p>') +
    (port.distribution ? `<dl class="kv"><dt>Distribución</dt><dd>${esc(port.distribution)}</dd></dl>` : '') +
    '</div>' +
    `<div class="sbox"><h3>Procedencia en el índice</h3><dl class="kv">${refs || '<dt>—</dt><dd>sin fuentes</dd>'}</dl></div>` +
    '<p class="mono" style="font-size:var(--fs-2xs);color:var(--muted);margin:0">' +
    'Sólo enlazamos el origen oficial declarado. Los enlaces en cuarentena del índice no se muestran.</p>'
  );
}

/* -------------------------------------------------------------------------- */
/* Resumen                                                                    */
/* -------------------------------------------------------------------------- */

function requirementsMarkup(port: PortItem): string {
  const targets = (port.targetPlatforms ?? []).map((t) => TARGET_LABELS[t] ?? t);
  const ruf = port.requiresUserFiles ?? {};
  const rufText = str(ruf.es) || str(ruf.en);
  const quarantine = port.quarantinedLinkFields ?? [];

  const rows: string[] = [];
  rows.push(`<dt>Estrategia</dt><dd>${esc(INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy)}</dd>`);
  rows.push(`<dt>Destinos</dt><dd>${esc(targets.length ? targets.join(' · ') : 'sin declarar')}</dd>`);
  if (port.installStrategy === 'windows-via-proton') {
    rows.push('<dt>Runner</dt><dd>Proton (Wine) — se elegirá al lanzar</dd>');
  }
  if (port.launch?.executable) {
    rows.push(`<dt>Ejecutable</dt><dd class="mono">${esc(port.launch.executable)}</dd>`);
  }
  if (Array.isArray(port.launch?.args) && port.launch.args.length > 0) {
    rows.push(`<dt>Argumentos</dt><dd class="mono">${esc(port.launch.args.join(' '))}</dd>`);
  }
  if (port.romProfile?.binding && port.romProfile.binding !== 'in-app') {
    rows.push(
      `<dt>ROM</dt><dd>${esc(ROM_BINDING_LABELS[port.romProfile.binding] ?? port.romProfile.binding)}` +
        (port.romProfile.destination ? ` → <span class="mono">${esc(port.romProfile.destination)}</span>` : '') +
        '</dd>'
    );
  }
  if ((port.setupFiles ?? []).length > 0) {
    rows.push(`<dt>Ficheros</dt><dd>${port.setupFiles.length} declarados en el índice</dd>`);
  }
  if (quarantine.length > 0) {
    rows.push(
      `<dt>Enlaces</dt><dd>${quarantine.length} campo(s) en cuarentena: ` +
        `<span class="mono">${esc(quarantine.join(', '))}</span></dd>`
    );
  }

  return (
    '<div class="sbox">' +
    '<h3>Requisitos</h3>' +
    (rufText ? `<p style="margin:0;font-size:var(--fs-s)">${esc(rufText)}</p>` : '') +
    `<dl class="kv">${rows.join('')}</dl>` +
    '</div>'
  );
}

function summaryTab(port: PortItem, opts: DetailRenderOptions): string {
  const steps = installSteps(port, opts);
  const info = devInfo(port);
  const description =
    str(port.requiresUserFiles?.es) ||
    str(port.requiresUserFiles?.en) ||
    `Port de ${PLATFORM_LABELS[port.sourcePlatform] ?? port.sourcePlatform}` +
      (port.project ? ` basado en ${port.project}` : '') +
      '.';

  return (
    '<div class="sbox">' +
    '<h3>Cómo se instalará</h3>' +
    stepsMarkup(steps) +
    '</div>' +
    '<div class="sbox">' +
    '<h3>Descripción</h3>' +
    `<p style="margin:0;font-size:var(--fs-s)">${esc(description)}</p>` +
    (info.why
      ? `<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">${esc(info.why)}</p>`
      : '') +
    '</div>' +
    requirementsMarkup(port)
  );
}

function emptyBlock(iconName: string, title: string, text: string): string {
  return (
    '<div class="empty">' +
    `<span class="eico" aria-hidden="true">${icon(iconName, { size: 30 })}</span>` +
    `<span class="etit">${esc(title)}</span>` +
    `<span style="max-width:52ch;font-size:var(--fs-s)">${esc(text)}</span>` +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Caja lateral: Estado de desarrollo                                         */
/* -------------------------------------------------------------------------- */

export function statusBox(port: PortItem, state?: LibraryState): string {
  const info = devInfo(port);
  const status = port.status;
  const community = status?.community;
  const bugs = Number(community?.bugReports ?? 0) || 0;
  const lastChange = str(status?.computedAt) || latestSeen(port);
  const game = libraryService.getLibraryGame(port.pid);
  const localState = state ?? game.state;
  const romOk = !!str(game.romPath) && !!str(game.romValidatedAt);
  const index = catalogService.getIndex();

  const rows: string[] = [
    `<dt>Estado</dt><dd>${devChip(port)}</dd>`,
    info.why ? `<dt>Motivo</dt><dd>${esc(info.why)}</dd>` : '',
    `<dt>Declarado por</dt><dd>${esc(
      str(status?.development) || 'el proyecto'
    )}${status?.maintenance ? ` · mantenimiento: ${esc(status.maintenance)}` : ''}</dd>`,
    `<dt>Confianza</dt><dd>${esc(info.conf)}</dd>`,
    `<dt>Compatibilidad</dt><dd>${
      port.linux && Object.keys(port.linux).length > 0 ? 'Linux declarado · ' : ''
    }${(port.targetPlatforms ?? []).map((t) => TARGET_LABELS[t] ?? t).join(' · ') || '—'}</dd>`,
    `<dt>Último cambio</dt><dd>${esc(lastChange ? `${formatDate(lastChange)} (${relativeDate(lastChange)})` : 'sin datos')}</dd>`,
    `<dt>Bugs abiertos</dt><dd>${bugs}</dd>`,
    `<dt>Biblioteca</dt><dd>${esc(LIBRARY_STATE_LABELS[localState])}${
      romOk ? ' · ROM validada' : portNeedsRom(port) ? ' · falta ROM' : ''
    }</dd>`,
  ];

  return (
    '<aside class="sbox" aria-label="Estado de desarrollo">' +
    '<h3>Estado de desarrollo</h3>' +
    `<dl class="kv">${rows.filter(Boolean).join('')}</dl>` +
    `<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">` +
    `Procedencia: índice PortsHub ${esc(index?.version ?? '—')}` +
    `${index?.generatedAt ? ` · ${esc(formatDate(index.generatedAt))}` : ''}. ` +
    'Las etiquetas las calcula el indexador con las señales del repositorio.</p>' +
    '</aside>'
  );
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

/** Cabecera con portada, metadatos y CTA. */
function heroMarkup(port: PortItem, state: LibraryState): string {
  const info = devInfo(port);
  const links = officialLinks(port);
  const external = links[0]
    ? `<a class="btn sm" href="${esc(links[0].url)}" target="_blank" rel="noopener noreferrer nofollow" ` +
      `title="${esc(links[0].url)}">${icon('external', { size: 15 })}<span>Sitio oficial</span></a>`
    : '';
  const cover = port.coverUrl
    ? `<img src="${esc(port.coverUrl)}" alt="" loading="eager" decoding="async" ` +
      'referrerpolicy="no-referrer" onerror="this.remove()" ' +
      'style="position:absolute;inset:0;z-index:1">'
    : '';
  const sub = [port.project, port.repository, port.pid].filter((v) => str(v)).map((v) => str(v)).join(' · ');

  return (
    `<div class="dhero"${styleAttr({ '--plat-neon': `var(--p-${port.sourcePlatform}-neon, var(--accent))` })}>` +
    '<div class="dcover">' +
    `<div style="position:absolute;inset:0;display:grid;place-content:center">${art(port)}</div>` +
    cover +
    '</div>' +
    '<div class="dinfo">' +
    `<div class="dmeta">${platPill(port)}${devChip(port)}${statePill(state, { hideNotInstalled: false })}${strategyChip(port)}</div>` +
    `<div class="dsub">${esc(sub)}</div>` +
    `<div class="ddesc">${esc(
      str(port.requiresUserFiles?.es) ||
        str(port.requiresUserFiles?.en) ||
        `${PLATFORM_SHORT[port.sourcePlatform] ?? port.sourcePlatform} · ${
          INSTALL_STRATEGY_LABELS[port.installStrategy] ?? port.installStrategy
        }`
    )}</div>` +
    `<div class="dactions">${actionButton(port, state)}${external}${gearButton(port, state)}` +
    `<button type="button" class="btn sm" data-act="rom" data-pid="${esc(port.pid)}" ` +
    'title="Elegir o cambiar la ROM">' +
    `${icon('rom', { size: 15 })}<span>ROM</span></button>` +
    '</div>' +
    `<div class="mono" style="font-size:var(--fs-2xs);color:var(--muted)">` +
    `Estado calculado por el índice · confianza ${esc(info.conf)}</div>` +
    '</div></div>'
  );
}

/** Pestañas (`.tabs`) con la activa marcada por `aria-selected`. */
function tabsMarkup(active: DetailTab): string {
  const buttons = DETAIL_TABS.map(
    (tab) =>
      `<button type="button" role="tab" data-tab="${tab.id}" id="dt-tab-${tab.id}" ` +
      `aria-selected="${active === tab.id}" aria-controls="dt-panel" tabindex="${active === tab.id ? '0' : '-1'}">` +
      `${esc(tab.label)}</button>`
  ).join('');
  return `<div class="tabs" role="tablist" aria-label="Secciones de la ficha">${buttons}</div>`;
}

/** Cuerpo de una pestaña concreta. */
export function detailTabBody(port: PortItem, tab: DetailTab, opts: DetailRenderOptions = {}): string {
  switch (tab) {
    case 'versions':
      return versionsTab(port, opts);
    case 'sources':
      return sourcesTab(port);
    case 'summary':
    default:
      return summaryTab(port, opts);
  }
}

/** Contenido interno del modal (sin `.scrim` ni `.modal`). */
export function renderDetail(port: PortItem, opts: DetailRenderOptions = {}): string {
  const game = opts.library ?? libraryService.getLibraryGame(port.pid);
  const state = opts.state ?? game.state ?? 'NotInstalled';
  const tab = opts.tab ?? 'summary';
  const installed = isInstalledState(state);

  return (
    '<div class="detail">' +
    heroMarkup(port, state) +
    tabsMarkup(tab) +
    '<div id="dt-panel" role="tabpanel" aria-labelledby="dt-tab-' + tab + '" ' +
    'style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;align-items:start">' +
    detailTabBody(port, tab, { ...opts, state, library: game }) +
    statusBox(port, state) +
    '</div>' +
    (installed
      ? '<p class="mono" style="font-size:var(--fs-2xs);color:var(--muted);margin:0">' +
        `Instalado en ${esc(game.installDir || '(sin ruta)')}` +
        (game.installedVersion ? ` · v${esc(game.installedVersion)}` : '') +
        (game.error ? ` · último error: ${esc(game.error)}` : '') +
        '</p>'
      : '') +
    '</div>'
  );
}

/**
 * Contenido del `.modal` (sin el `.scrim` que lo envuelve). Es lo que se
 * repinta al cambiar de pestaña, de modo que el `scrim` y su listener de
 * clics nunca se recrean.
 */
export function detailModalInner(port: PortItem, opts: DetailRenderOptions = {}): string {
  const state = opts.state ?? libraryService.getLibraryGame(port.pid).state;
  return (
    '<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="dt-title">' +
    '<div class="mhead">' +
    `<h2 id="dt-title">${esc(port.name)}</h2>` +
    `<button type="button" class="x" data-act="close" title="Cerrar" aria-label="Cerrar">${icon('close', { size: 16 })}</button>` +
    '</div>' +
    `<div class="mbody" id="dt-body">${renderDetail(port, { ...opts, state })}</div>` +
    '<div class="mfoot">' +
    actionButton(port, state) +
    '<span class="spacer"></span>' +
    `<button type="button" class="btn sm" data-act="close">${icon('close', { size: 15 })}<span>Cerrar</span></button>` +
    '</div>' +
    '</div>'
  );
}

/** Modal completo con el `scrim` (oculto por defecto). */
export function renderDetailModal(port: PortItem, opts: DetailRenderOptions = {}): string {
  return `<div class="scrim" data-modal="detail" hidden>${detailModalInner(port, opts)}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Montaje                                                                    */
/* -------------------------------------------------------------------------- */

export function mountDetailModal(opts: DetailModalOptions = {}): DetailModalHandle {
  const callbacks = opts;
  const host =
    opts.host ??
    document.getElementById('layer') ??
    document.body;

  const el = document.createElement('div');
  el.className = 'scrim';
  el.dataset.modal = 'detail';
  el.hidden = true;
  host.append(el);

  let openPid: string | null = null;
  let tab: DetailTab = opts.tab ?? 'summary';
  let restoreFocus: HTMLElement | null = null;

  function port(): PortItem | null {
    return openPid ? catalogService.getPortByPid(openPid) ?? null : null;
  }

  function paint(): void {
    const current = port();
    if (!current) return;
    el.innerHTML = detailModalInner(current, {
      ...opts,
      tab,
      state: libraryService.getLibraryGame(current.pid).state,
    });
  }

  function close(): void {
    if (el.hidden) return;
    const pid = openPid;
    openPid = null;
    el.hidden = true;
    el.innerHTML = '';
    if (restoreFocus && document.contains(restoreFocus)) {
      try {
        restoreFocus.focus();
      } catch {
        /* foco no restaurable */
      }
    }
    restoreFocus = null;
    if (pid) callbacks.onClose?.(pid);
  }

  function open(pid: string, nextTab?: DetailTab): void {
    const current = catalogService.getPortByPid(pid);
    if (!current) return;
    const wasHidden = el.hidden;
    openPid = pid;
    tab = nextTab ?? 'summary';
    if (wasHidden) {
      const active = document.activeElement;
      restoreFocus = active instanceof HTMLElement ? active : null;
    }
    el.innerHTML = detailModalInner(current, {
      ...opts,
      tab,
      state: libraryService.getLibraryGame(pid).state,
    });
    el.hidden = false;
    const focusTarget = el.querySelector<HTMLElement>('[data-act="close"]');
    focusTarget?.focus();
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Clic en el fondo (fuera de la tarjeta) → cerrar.
    if (target === el) {
      close();
      return;
    }

    const tabHit = target.closest<HTMLElement>('[data-tab]');
    if (tabHit) {
      event.preventDefault();
      const next = tabHit.dataset.tab as DetailTab | undefined;
      if (next && DETAIL_TABS.some((t) => t.id === next)) {
        tab = next;
        paint();
        el.querySelector<HTMLElement>('[data-tab="' + next + '"]')?.focus();
      }
      return;
    }

    const actHit = target.closest<HTMLElement>('[data-act]');
    if (!actHit) return;
    const kind = (actHit.dataset.act ?? '') as PortActionKind | 'close' | 'install-version';
    const pid = actHit.dataset.pid ?? openPid ?? '';
    if (!pid) return;

    if (kind === 'close') {
      event.preventDefault();
      close();
      return;
    }
    if (kind === 'install-version') {
      event.preventDefault();
      const version = actHit.dataset.version ?? '';
      callbacks.onAction?.(pid, 'install');
      if (version) {
        // La versión elegida queda fijada en la biblioteca local.
        libraryService.updateLibraryGame(pid, { pinnedVersion: version });
      }
      return;
    }
    if (kind === 'gear') {
      event.preventDefault();
      callbacks.onGear?.(pid);
      return;
    }
    if (kind === 'open' || kind === 'details') {
      callbacks.onOpen?.(pid);
      return;
    }
    event.preventDefault();
    callbacks.onAction?.(pid, kind as PortActionKind);
  }

  el.addEventListener('click', onClick);

  return {
    el,
    open,
    close,
    isOpen(): boolean {
      return !el.hidden && openPid !== null;
    },
    current(): PortItem | null {
      return port();
    },
    destroy(): void {
      el.removeEventListener('click', onClick);
      el.remove();
      openPid = null;
    },
  };
}

export default mountDetailModal;
