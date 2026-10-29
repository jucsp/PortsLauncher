/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/SettingsView.ts
 *
 * Vista de Ajustes con la sección de **cartuchos y discos** calcada del
 * prototipo de Claude (`renderSettings()`, líneas 481-500):
 *
 *   section.box
 *     div.lbl APARIENCIA · h2 Cartuchos y discos
 *     div.seg.txt                      → «Un solo estilo» / «Según la plataforma»
 *     div.muted                        → explicación del modo activo
 *     div (flex) > button.mtile × 16   → rejilla de estilos (click = seleccionar)
 *     [modo auto] div.list > div.row   → medio de cada biblioteca (select)
 *     div.rail > div.items > div.slot  → vista previa con 5 juegos de ejemplo
 *
 * La rejilla de `.mtile`, los selectores por plataforma y la vista previa se
 * repintan en cada cambio porque el llamante (`main.ts`) guarda los ajustes en
 * `libraryService` y vuelve a renderizar la ruta.
 * ========================================================================== */

import type {
  DestOS,
  DevTag,
  KnownPlatform,
  MediaStyle,
  RomMode,
  Settings,
  SourcePlatform,
  ViewMode,
} from '../services/types';
import {
  CATALOG_PLATFORMS,
  DEST_OPTIONS,
  DEV_TAG_META,
  MEDIA_BY_PLATFORM,
  MEDIA_STYLES,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
  VIEW_MODES,
} from '../services/types';
import type { PortItem } from '../services/types';
import { catalogService } from '../services/catalogService';
import { libraryService } from '../services/libraryService';
import { esc, icon } from './Icons';
import { MEDIA, mediaHTML, miniIcon, styleFor } from './Media';

/* -------------------------------------------------------------------------- */
/* Constantes                                                                 */
/* -------------------------------------------------------------------------- */

/** Medio por defecto de cada plataforma (tabla `PLATMEDIA` del prototipo). */
export const PLATMEDIA: Record<KnownPlatform | 'other', MediaStyle> = {
  n64: 'n64',
  snes: 'snes',
  nes: 'nes',
  md: 'md',
  gba: 'gba',
  gb: 'gb',
  nds: 'nds',
  n3ds: 'n3ds',
  nsw: 'nsw',
  psp: 'psp',
  ps1: 'ps1',
  ps2: 'ps2',
  gcn: 'gcn',
  xbox: 'xbox',
  x360: 'x360',
  pc: 'cd',
  other: 'cd',
};

/** Nombre legible de cada silueta. */
export const MEDIA_LABELS: Record<MediaStyle, string> = {
  n64: 'Cartucho N64',
  snes: 'Cartucho SNES',
  nes: 'Cartucho NES',
  md: 'Cartucho Mega Drive',
  gba: 'Cartucho GBA',
  gb: 'Cartucho Game Boy',
  nds: 'Cartucho DS',
  n3ds: 'Cartucho 3DS',
  nsw: 'Cartucho Switch',
  psp: 'UMD PSP',
  cd: 'CD genérico',
  ps1: 'Disco PS1',
  gcn: 'MiniDVD GameCube',
  xbox: 'Disco Xbox',
  ps2: 'DVD PS2',
  x360: 'DVD Xbox 360',
};

export const VIEW_LABELS: Record<ViewMode, string> = {
  posters: 'Carátulas (3:4)',
  big: 'Grilla grande (16:9)',
  shelves: 'Estantería de cartuchos',
  list: 'Lista',
  table: 'Tabla',
};

/** Explicación de cada etiqueta de desarrollo (señales objetivas del índice). */
export const DEVELOPMENT_LEGEND: ReadonlyArray<{ tag: DevTag; title: string; text: string }> = [
  {
    tag: 'playable',
    title: 'Jugable',
    text: 'Versión publicada, sin incidencias abiertas relevantes y con mantenimiento al día.',
  },
  {
    tag: 'bugs',
    title: 'Con bugs',
    text: 'Funciona, pero el repositorio acumula 5 o más fallos abiertos.',
  },
  {
    tag: 'wip',
    title: 'En desarrollo',
    text: 'El proyecto declara desarrollo activo: canal alpha/beta o disponibilidad «en desarrollo».',
  },
  {
    tag: 'exp',
    title: 'Experimental',
    text: 'Marcado como experimental o con versiones sólo preliminares (pre-releases).',
  },
  {
    tag: 'abandoned',
    title: 'Abandonado',
    text: 'Archivado por el autor o sin cambios en más de 18 meses.',
  },
  {
    tag: 'nodata',
    title: 'Sin datos',
    text: 'El índice no reúne señales suficientes para determinar el estado de desarrollo.',
  },
];

/** Juegos de ejemplo de la vista previa (los mismos nombres que el prototipo). */
const DEMO_NAMES = [
  'GoldenEye 007',
  'A Link to the Past',
  'Sonic the Hedgehog',
  'Spyro the Dragon',
  'The Minish Cap',
];

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export interface CatalogProvenance {
  version: string;
  generatedAt: string;
  semanticHash: string;
  totalPorts: number;
  platforms: number;
  fused: number;
  multiRepositories: number;
}

export interface SettingsViewOptions {
  /** Ajustes a pintar (por defecto los de `libraryService`). */
  settings?: Settings;
  /** Datos de procedencia del índice (por defecto los de `catalogService`). */
  catalog?: Partial<CatalogProvenance>;
  onSettings?: (patch: Partial<Settings>) => void;
  onReset?: () => void;
  onToast?: (message: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
}

export interface SettingsCallbacks {
  onSettings?: (patch: Partial<Settings>) => void;
  onReset?: () => void;
  onToast?: (message: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shortHash(hash: string): string {
  const clean = str(hash).replace(/^sha256:/, '');
  return clean ? `sha256:${clean.slice(0, 12)}…` : 'sin índice';
}

function provenance(): CatalogProvenance {
  const index = catalogService.getIndex();
  const stats = catalogService.getStats();
  const platforms = catalogService.getPlatformsWithCounts().length;
  return {
    version: str(index?.version) || '0.0.0',
    generatedAt: str(index?.generatedAt),
    semanticHash: str(index?.semanticHash),
    totalPorts: stats?.totalPorts ?? catalogService.getVisibleCount(),
    platforms,
    fused: Number(stats?.fusedGamewaveQuiver ?? 0) || 0,
    multiRepositories: Number(stats?.multiRepositoryCount ?? 0) || 0,
  };
}

function mediaOptions(current: MediaStyle): string {
  return MEDIA_STYLES.map(
    (style) =>
      `<option value="${style}"${style === current ? ' selected' : ''}>` +
      `${esc(MEDIA_LABELS[style] ?? style)}</option>`
  ).join('');
}

function fieldHint(text: string): string {
  return `<span class="hint">${esc(text)}</span>`;
}

/**
 * Los cinco juegos de ejemplo de la vista previa: se buscan por nombre en el
 * catálogo y se completan con plataformas distintas hasta llegar a cinco.
 */
export function demoPorts(limit = 5): PortItem[] {
  const out: PortItem[] = [];
  const used = new Set<string>();
  const platforms = new Set<SourcePlatform>();

  for (const name of DEMO_NAMES) {
    if (out.length >= limit) break;
    const hit = catalogService.search(name, { onlyVisible: true })[0];
    if (!hit || used.has(hit.pid)) continue;
    out.push(hit);
    used.add(hit.pid);
    platforms.add(hit.sourcePlatform);
  }

  if (out.length < limit) {
    for (const port of catalogService.getPorts()) {
      if (out.length >= limit) break;
      if (port.visible === false || used.has(port.pid)) continue;
      if (platforms.has(port.sourcePlatform)) continue;
      out.push(port);
      used.add(port.pid);
      platforms.add(port.sourcePlatform);
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Secciones                                                                  */
/* -------------------------------------------------------------------------- */

/** Rejilla de estilos (`mtiles`) + selectores por biblioteca + vista previa. */
function mediaSection(settings: Settings): string {
  const single = settings.mediaMode === 'single';
  const selected = settings.mediaDef ?? 'cd';

  const tiles = MEDIA_STYLES.map((style) => {
    const pressed = selected === style;
    return (
      `<button type="button" class="mtile" data-media="${style}" aria-pressed="${pressed}" ` +
      `title="${esc(MEDIA[style].name)} · ${esc(MEDIA[style].hint)}">` +
      `<span style="width:44px;height:38px;display:grid;place-items:center">${miniIcon(style)}</span>` +
      '<span><b style="font-size:13px">' +
      `${esc(MEDIA[style].name)}</b><br>` +
      `<span class="muted" style="font-size:11px">${esc(MEDIA[style].hint)}</span></span>` +
      '</button>'
    );
  }).join('');

  const perLibrary = single
    ? ''
    : '<div style="font:600 14px var(--f-body);margin-top:6px">Medio de cada biblioteca</div>' +
      '<div class="list">' +
      (CATALOG_PLATFORMS as readonly SourcePlatform[])
        .map((platform) => {
          const auto = MEDIA_BY_PLATFORM[platform] ?? 'cd';
          const current = settings.mediaMap?.[platform] ?? '';
          /* `pc` y `other` no tienen soporte propio: heredan el estilo por defecto. */
          const hasOwn = platform !== 'pc' && platform !== 'other';
          const autoLabel = hasOwn
            ? `Auto · ${esc(MEDIA[auto].name)}`
            : `Defecto · ${esc(MEDIA[selected].name)}`;
          const options = [
            `<option value=""${current === '' ? ' selected' : ''}>` +
              `${autoLabel}` +
              '</option>',
            ...MEDIA_STYLES.map(
              (style) =>
                `<option value="${style}"${current === style ? ' selected' : ''}>` +
                `${esc(MEDIA_LABELS[style])}</option>`
            ),
          ].join('');
          return (
            '<div class="row" style="cursor:default;padding:8px 14px;gap:12px">' +
            `<span style="width:44px;height:38px;display:grid;place-items:center">` +
            `${miniIcon(current || auto)}</span>` +
            `<b style="flex:1 1 140px">${esc(PLATFORM_LABELS[platform])}</b>` +
            `<select class="in-txt" data-media-platform="${esc(platform)}" ` +
            `style="max-width:260px;height:36px" aria-label="Medio de ${esc(PLATFORM_LABELS[platform])}">` +
            `${options}</select></div>`
          );
        })
        .join('') +
      '</div>';

  const demo = demoPorts(5);
  const demoSlots = demo
    .map((port) => {
      const style = styleFor(port, settings);
      return (
        `<div class="slot" style="--w:${MEDIA[style].w}px;cursor:default">` +
        mediaHTML(port, style) +
        `<div class="cap">${esc(port.name)}</div>` +
        '</div>'
      );
    })
    .join('');
  const preview =
    demo.length > 0
      ? '<div class="rail" style="--n:var(--accent)">' +
        '<div class="items" style="justify-content:center;gap:34px">' +
        demoSlots +
        '</div><div class="board"></div></div>'
      : '<div class="empty" style="padding:22px">El índice no tiene fichas para la vista previa.</div>';

  return (
    '<section class="box">' +
    '<div class="lbl" style="padding:0">APARIENCIA</div>' +
    '<h2 style="font-size:18px">Cartuchos y discos</h2>' +
    '<div class="seg txt" style="align-self:flex-start;flex-wrap:wrap">' +
    `<button type="button" data-media-mode="single" aria-pressed="${single}">` +
    'Un solo estilo para todos</button>' +
    `<button type="button" data-media-mode="auto" aria-pressed="${!single}">` +
    'Según la plataforma</button></div>' +
    '<div class="muted" style="font-size:13px">' +
    (single
      ? 'Todos tus juegos se ven con el mismo estilo, sea cual sea su plataforma.'
      : 'Cada biblioteca usa el medio de su plataforma. Las que no tengan uno propio usan el estilo por defecto.') +
    '</div>' +
    '<div style="font:600 14px var(--f-body)">' +
    (single ? 'Estilo para todos los juegos' : 'Estilo por defecto (plataformas sin medio propio)') +
    '</div>' +
    `<div style="display:flex;flex-wrap:wrap;gap:10px">${tiles}</div>` +
    perLibrary +
    '<div class="row" style="cursor:default;padding:8px 14px;gap:12px">' +
    '<b style="flex:1 1 140px">Mostrar soportes</b>' +
    '<label class="tog">' +
    `<input type="checkbox" data-set="media"${settings.media ? ' checked' : ''} ` +
    'aria-label="Mostrar soportes"><span class="track"></span></label></div>' +
    preview +
    '</section>'
  );
}

function viewSection(settings: Settings): string {
  const options = VIEW_MODES.map(
    (view) =>
      `<option value="${view}"${settings.view === view ? ' selected' : ''}>` +
      `${esc(VIEW_LABELS[view])}</option>`
  ).join('');
  return (
    '<section class="box">' +
    '<div class="lbl" style="padding:0">BIBLIOTECA</div>' +
    '<h2 style="font-size:18px">Vista predeterminada</h2>' +
    '<div class="seg" style="align-self:flex-start">' +
    VIEW_MODES.map(
      (view) =>
        `<button type="button" data-selectview="${view}" aria-pressed="${settings.view === view}" ` +
        `aria-label="${esc(VIEW_LABELS[view])}" title="${esc(VIEW_LABELS[view])}">` +
        `${icon(view === 'shelves' ? 'carts' : view, { size: 17 })}</button>`
    ).join('') +
    '</div>' +
    '<div class="row" style="cursor:default;padding:8px 14px;gap:12px">' +
    '<b style="flex:1 1 140px">Vista del catálogo al abrir</b>' +
    `<select class="in-txt" data-set="view" style="max-width:260px;height:36px" ` +
    `aria-label="Vista por defecto">${options}</select></div>` +
    '<p class="mono" style="margin:0;font-size:12px;color:var(--muted)">' +
    'El selector de la barra superior cambia la vista sin modificar esta preferencia.</p>' +
    '</section>'
  );
}

function dirsSection(settings: Settings): string {
  return (
    '<section class="box">' +
    '<div class="lbl" style="padding:0">CARPETAS Y ROMS</div>' +
    '<label>Carpeta de ports por defecto' +
    `<input class="in-txt" type="text" data-set="installDir" spellcheck="false" ` +
    `value="${esc(settings.installDir)}" placeholder="~/Ports"></label>` +
    '<label>Carpeta interna de ROMs' +
    `<input class="in-txt" type="text" data-set="romDir" spellcheck="false" ` +
    `value="${esc(settings.romDir)}" placeholder="~/Ports/Roms"></label>` +
    fieldHint('Cada port vive en una subcarpeta con su nombre de carpeta.') +
    '<div>Al añadir una ROM, por defecto:</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:12px">' +
    `<button type="button" class="opt${settings.romMode === 'link' ? ' on' : ''}" role="radio" ` +
    `aria-checked="${settings.romMode === 'link'}" data-rom-mode="link">` +
    '<b>Usarla desde donde está</b><span class="muted">No se mueve nada.</span></button>' +
    `<button type="button" class="opt${settings.romMode === 'copy' ? ' on' : ''}" role="radio" ` +
    `aria-checked="${settings.romMode === 'copy'}" data-rom-mode="copy">` +
    `<b>Copiarla a la carpeta del port</b>` +
    `<span class="muted">Se copia dentro de ${esc(settings.romDir)}.</span></button>` +
    '</div></section>'
  );
}

function destSection(settings: Settings): string {
  const cards = DEST_OPTIONS.map((os: DestOS) => {
    const active = settings.dest === os;
    const desc =
      os === 'Linux'
        ? 'Ejecutables nativos, AppImage y Proton cuando haga falta'
        : 'Se priorizan los binarios de Windows ejecutados con Wine/Proton';
    return (
      `<button type="button" class="opt${active ? ' on' : ''}" role="radio" ` +
      `aria-checked="${active}" data-dest="${os}" title="${esc(os)}">` +
      `<span><span class="oname">${esc(os)}</span>` +
      `<span class="odesc">${esc(desc)}</span></span>` +
      `<span class="otag">${active ? 'activo' : ''}</span></button>`
    );
  }).join('');

  return (
    '<section class="box">' +
    '<div class="lbl" style="padding:0">SISTEMA</div>' +
    '<div class="kv"><span>Destino de los ports</span>' +
    `<b class="mono">${esc(settings.dest)}</b></div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>` +
    '</section>'
  );
}

function indexSection(catalog: CatalogProvenance): string {
  const flow =
    '<div class="flow">' +
    '<div><b>Repositorios</b><br><span class="muted" style="font-size:12px">GitHub · GameWave · Quiver</span></div>' +
    '<span class="ar">→</span>' +
    '<div><b>Indexador</b><br><span class="muted" style="font-size:12px">normaliza, deduplica y calcula estados</span></div>' +
    '<span class="ar">→</span>' +
    '<div><b>Índice PortsHub</b><br>' +
    `<span class="mono muted" style="font-size:12px">ports.index.json · ${esc(catalog.version)}</span></div>` +
    '<span class="ar">→</span>' +
    '<div><b>Este launcher</b><br><span class="muted" style="font-size:12px">solo lee el índice</span></div>' +
    '</div>';
  const rows = [
    `<div class="kv"><span>Hash semántico</span>` +
    `<span class="mono" title="${esc(catalog.semanticHash)}">${esc(shortHash(catalog.semanticHash))}</span></div>`,
    `<div class="kv"><span>Último indexado</span>` +
    `<span class="mono">${esc(catalog.generatedAt.slice(0, 19).replace('T', ' ') || '—')}</span></div>`,
    `<div class="kv"><span>Puertos en el índice</span><span class="mono">${catalog.totalPorts}</span></div>`,
    `<div class="kv"><span>Plataformas</span><span class="mono">${catalog.platforms}</span></div>`,
    `<div class="kv"><span>Fusionados GameWave + Quiver</span><span class="mono">${catalog.fused}</span></div>`,
    `<div class="kv"><span>Repositorios multi-ficha</span><span class="mono">${catalog.multiRepositories}</span></div>`,
  ];

  return (
    '<section class="box">' +
    '<div class="lbl" style="padding:0">ÍNDICE DE PORTS</div>' +
    '<h2 style="font-size:18px">Un índice propio alimenta el launcher</h2>' +
    flow +
    rows.join('') +
    '<div class="muted" style="font-size:12px">El launcher no consulta repositorios ni listados ' +
    'de terceros: solo lee el índice. No aloja binarios ni ROMs.</div>' +
    '</section>'
  );
}

function legendSection(): string {
  const rows = DEVELOPMENT_LEGEND.map((entry) => {
    const meta = DEV_TAG_META[entry.tag];
    return (
      '<div class="kv" style="align-items:center">' +
      `<span class="dev" style="--c:${meta.color}">${esc(meta.glyph)} ${esc(meta.label)}</span>` +
      `<span class="muted" style="text-align:right;font-size:13px;max-width:52ch">` +
      `${esc(entry.text)}</span></div>`
    );
  }).join('');

  return (
    '<section class="box">' +
    '<div class="lbl" style="padding:0">ETIQUETAS DE ESTADO</div>' +
    '<h2 style="font-size:18px">Qué significa cada etiqueta</h2>' +
    rows +
    '<div class="muted" style="font-size:12px">El evaluador aplica 6 reglas en orden: la primera ' +
    'que se cumple gana. Cada ficha muestra el motivo y la confianza del resultado.</div>' +
    '</section>'
  );
}

function resetSection(): string {
  return (
    '<section class="box">' +
    '<div class="lbl" style="padding:0">DATOS LOCALES</div>' +
    '<div class="muted">Restablecer borra la biblioteca local y los ajustes ' +
    '(instalaciones registradas, ROMs enlazadas y preferencias). No toca los ficheros de tu disco.</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    '<button type="button" class="btn dng" data-act="reset">' +
    `${icon('trash', { size: 15 })}<span>Restablecer datos</span></button>` +
    '<span data-reset-confirm hidden style="display:flex;gap:8px;align-items:center">' +
    '<span class="mono" style="font-size:12px;color:var(--warn)">¿Seguro?</span>' +
    '<button type="button" class="btn dng sm" data-act="reset-confirm">Sí, borrar</button>' +
    '<button type="button" class="btn sm" data-act="reset-cancel">Cancelar</button>' +
    '</span></div>' +
    `<p class="mono" style="margin:0;font-size:12px;color:var(--muted)">` +
    `Clave de almacenamiento: ${esc('portshub-library-v1')} · persistencia: ${
      libraryService.isPersistent() ? 'localStorage' : 'memoria (sin persistencia)'
    }</p>` +
    '</section>'
  );
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

/** Vista completa de Ajustes. */
export function renderSettings(options: SettingsViewOptions = {}): string {
  const settings = options.settings ?? libraryService.getSettings();
  const catalog: CatalogProvenance = { ...provenance(), ...(options.catalog ?? {}) };

  return (
    '<div class="view" data-view="settings">' +
    '<div class="top"><h1>Ajustes</h1></div>' +
    '<div style="display:flex;flex-direction:column;gap:22px;max-width:980px">' +
    mediaSection(settings) +
    viewSection(settings) +
    dirsSection(settings) +
    destSection(settings) +
    indexSection(catalog) +
    legendSection() +
    resetSection() +
    '</div></div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Delegación                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Traduce clics y cambios (`data-media-mode`, `data-media`, `data-media-platform`,
 * `data-rom-mode`, `data-dest`, `data-selectview`, `data-set`) a parches de
 * `Settings`, y gestiona la confirmación en dos pasos del reset.
 */
export function delegateSettingsEvents(
  root: HTMLElement,
  callbacks: SettingsCallbacks = {}
): () => void {
  function patch(partial: Partial<Settings>): void {
    callbacks.onSettings?.(partial);
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hit = target.closest<HTMLElement>('[data-act]');

    /* Cambio de modo (un solo estilo vs por plataforma). */
    const modeHit = target.closest<HTMLElement>('[data-media-mode]');
    if (modeHit) {
      event.preventDefault();
      const mode = modeHit.dataset.mediaMode === 'single' ? 'single' : 'auto';
      patch({ mediaMode: mode });
      return;
    }

    /* Rejilla de estilos (mtiles). */
    const tileHit = target.closest<HTMLElement>('[data-media]');
    if (tileHit) {
      event.preventDefault();
      const style = tileHit.dataset.media as MediaStyle | undefined;
      if (style && (MEDIA_STYLES as readonly string[]).includes(style)) {
        patch({ mediaDef: style });
      }
      return;
    }

    /* Modo de ROM. */
    const romHit = target.closest<HTMLElement>('[data-rom-mode]');
    if (romHit) {
      event.preventDefault();
      const mode = romHit.dataset.romMode === 'copy' ? 'copy' : 'link';
      patch({ romMode: mode as RomMode });
      return;
    }

    /* Destino. */
    const destHit = target.closest<HTMLElement>('[data-dest]');
    if (destHit) {
      event.preventDefault();
      const dest = destHit.dataset.dest === 'Windows' ? 'Windows' : 'Linux';
      patch({ dest: dest as DestOS });
      return;
    }

    /* Vista por defecto desde el selector segmentado. */
    const viewHit = target.closest<HTMLElement>('[data-selectview]');
    if (viewHit) {
      event.preventDefault();
      const view = viewHit.dataset.selectview as ViewMode | undefined;
      if (view && (VIEW_MODES as readonly string[]).includes(view)) patch({ view });
      return;
    }

    if (!hit) return;
    const act = hit.dataset.act;

    if (act === 'reset') {
      event.preventDefault();
      const confirm = root.querySelector<HTMLElement>('[data-reset-confirm]');
      if (confirm) confirm.hidden = false;
      if (hit instanceof HTMLButtonElement) hit.disabled = true;
      return;
    }
    if (act === 'reset-cancel') {
      event.preventDefault();
      const confirm = root.querySelector<HTMLElement>('[data-reset-confirm]');
      if (confirm) confirm.hidden = true;
      const trigger = root.querySelector<HTMLButtonElement>('[data-act="reset"]');
      if (trigger) trigger.disabled = false;
      return;
    }
    if (act === 'reset-confirm') {
      event.preventDefault();
      callbacks.onReset?.();
      const confirm = root.querySelector<HTMLElement>('[data-reset-confirm]');
      if (confirm) confirm.hidden = true;
      const trigger = root.querySelector<HTMLButtonElement>('[data-act="reset"]');
      if (trigger) trigger.disabled = false;
    }
  }

  function onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    /* Interruptor de soportes. */
    if (target instanceof HTMLInputElement && target.dataset.set === 'media') {
      patch({ media: target.checked });
      return;
    }

    /* Selector del medio de una biblioteca (modo auto) → mediaMap. */
    if (target instanceof HTMLSelectElement) {
      const platform = target.dataset.mediaPlatform as SourcePlatform | undefined;
      if (platform) {
        const settings = libraryService.getSettings();
        const mediaMap = { ...settings.mediaMap };
        const value = target.value as MediaStyle | '';
        if (value) mediaMap[platform] = value;
        else delete mediaMap[platform];
        patch({ mediaMap });
        return;
      }

      const key = target.dataset.set;
      if (key === 'mediaDef') {
        patch({ mediaDef: target.value as MediaStyle });
        return;
      }
      if (key === 'view') {
        patch({ view: target.value as ViewMode });
        return;
      }
      return;
    }

    /* Entradas de texto. */
    if (target instanceof HTMLInputElement && target.dataset.set) {
      const key = target.dataset.set;
      const value = target.value;
      if (key === 'installDir') {
        if (str(value)) patch({ installDir: value });
        else callbacks.onToast?.('La carpeta de instalación no puede estar vacía.', 'warn');
        return;
      }
      if (key === 'romDir') {
        if (str(value)) patch({ romDir: value });
        else callbacks.onToast?.('La carpeta de ROMs no puede estar vacía.', 'warn');
      }
    }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  };
}

/** Monta la vista en un contenedor y devuelve el desenganche. */
export function mountSettings(host: HTMLElement, options: SettingsViewOptions = {}): () => void {
  host.innerHTML = renderSettings(options);
  return delegateSettingsEvents(host, {
    onSettings: options.onSettings,
    onReset: options.onReset,
    onToast: options.onToast,
  });
}

export default renderSettings;
