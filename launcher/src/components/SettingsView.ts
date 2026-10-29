/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/SettingsView.ts
 *
 * Vista de Ajustes: apariencia/medios, vista por defecto, directorios, modo de
 * ROM, sistema de destino, procedencia del índice, leyenda de etiquetas de
 * desarrollo y restablecimiento de datos.
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   .settings (grid auto-fit) / .sbox > h3
 *   .set-row > .sl (b + span) / .sr
 *   .opt (.oname / .odesc / .otag) / .tog (.track) / .chk
 *   .field / .in-txt / .sel / .btn / .pill / .mono
 *
 * La vista es puramente declarativa: `renderSettings()` devuelve HTML con
 * `data-set` en cada control y `delegateSettingsEvents()` traduce los cambios a
 * un `Partial<Settings>`. El llamante decide si repinta (main.ts lo hace al
 * recibir el evento de `libraryService`).
 * ========================================================================== */

import type { DevTag, KnownPlatform, MediaStyle, Settings, SourcePlatform, ViewMode, RomMode, DestOS } from '../services/types';
import {
  CATALOG_PLATFORMS,
  DEST_OPTIONS,
  DEV_TAG_META,
  MEDIA_STYLES,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
  VIEW_MODES,
} from '../services/types';
import { catalogService } from '../services/catalogService';
import { libraryService } from '../services/libraryService';
import { esc, icon } from './Icons';

/* -------------------------------------------------------------------------- */
/* Constantes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Soporte por defecto de cada plataforma (tabla `PLATMEDIA` de la spec v5).
 * Es la misma correspondencia que aplica `MEDIA_BY_PLATFORM` en los servicios;
 * aquí se materializa como tabla editable en Ajustes.
 */
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

/** Nombre legible de cada silueta (para los selectores de medios). */
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

/** Explicación de cada etiqueta de desarrollo (leyenda de la spec v5 §7). */
export const DEVELOPMENT_LEGEND: ReadonlyArray<{ tag: DevTag; title: string; text: string }> = [
  {
    tag: 'playable',
    title: 'Jugable',
    text: 'Versión publicada, comunidad conforme y sin incidencias relevantes en la ventana analizada.',
  },
  {
    tag: 'bugs',
    title: 'Con bugs',
    text: 'Funciona, pero la comunidad reporta fallos: 5 o más reportes abiertos o menos del 70 % de recomendación.',
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

/* -------------------------------------------------------------------------- */
/* Secciones                                                                  */
/* -------------------------------------------------------------------------- */

function mediaSection(settings: Settings): string {
  const single = settings.mediaMode === 'single';
  const defaultSelect = single
    ? '<div class="set-row">' +
      '<div class="sl"><b>Soporte por defecto</b><span>Se usa para todos los ports</span></div>' +
      '<div class="sr"><select class="sel" data-set="mediaDef" aria-label="Soporte por defecto">' +
      mediaOptions(settings.mediaDef) +
      '</select></div></div>'
    : '';

  const perPlatform = single
    ? ''
    : '<div style="display:flex;flex-direction:column">' +
      (CATALOG_PLATFORMS as readonly SourcePlatform[])
        .map((platform) => {
          const current = (settings.mediaMap?.[platform] ?? PLATMEDIA[platform] ?? 'cd') as MediaStyle;
          return (
            '<div class="set-row">' +
            '<div class="sl">' +
            `<b>${esc(PLATFORM_SHORT[platform] ?? platform)}</b>` +
            `<span>${esc(PLATFORM_LABELS[platform] ?? platform)}</span>` +
            '</div>' +
            '<div class="sr">' +
            `<select class="sel" data-set-platform="${platform}" ` +
            `aria-label="Soporte para ${esc(PLATFORM_LABELS[platform] ?? platform)}">` +
            mediaOptions(current) +
            '</select></div></div>'
          );
        })
        .join('') +
      '</div>';

  return (
    '<section class="sbox">' +
    '<h3>Apariencia / Medios</h3>' +
    '<div class="set-row">' +
    '<div class="sl"><b>Mostrar soportes</b><span>Cartuchos y discos junto a las carátulas</span></div>' +
    '<div class="sr"><label class="tog">' +
    `<input type="checkbox" data-set="media"${settings.media ? ' checked' : ''} ` +
    'aria-label="Mostrar soportes"><span class="track"></span></label></div>' +
    '</div>' +
    '<label class="opt' + (single ? ' on' : '') + '">' +
    `<input type="radio" name="set-media-mode" value="single"${single ? ' checked' : ''} ` +
    'aria-label="Un solo estilo para todos">' +
    '<span><span class="oname">Un solo estilo para todos</span>' +
    '<span class="odesc">El mismo soporte en todas las plataformas</span></span>' +
    '<span class="otag">uniforme</span></label>' +
    '<label class="opt' + (single ? '' : ' on') + '">' +
    `<input type="radio" name="set-media-mode" value="auto"${single ? '' : ' checked'} ` +
    'aria-label="Según la plataforma">' +
    '<span><span class="oname">Según la plataforma</span>' +
    '<span class="odesc">Cada plataforma usa su cartucho o disco real</span></span>' +
    '<span class="otag">recomendado</span></label>' +
    defaultSelect +
    perPlatform +
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
    '<section class="sbox">' +
    '<h3>Vista por defecto</h3>' +
    '<div class="set-row">' +
    '<div class="sl"><b>Vista del catálogo</b><span>Se aplica al abrir PortsHub</span></div>' +
    '<div class="sr"><select class="sel" data-set="view" aria-label="Vista por defecto">' +
    options +
    '</select></div></div>' +
    '<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">' +
    'El selector de la barra superior cambia la vista sin modificar esta preferencia.' +
    '</p></section>'
  );
}

function dirsSection(settings: Settings): string {
  return (
    '<section class="sbox">' +
    '<h3>Directorios</h3>' +
    '<div class="field"><label for="set-installdir">Carpeta de instalación</label>' +
    `<input id="set-installdir" class="in-txt" type="text" data-set="installDir" ` +
    `value="${esc(settings.installDir)}" spellcheck="false" placeholder="~/PortsLauncher/ports">` +
    fieldHint('Cada port se instala en una subcarpeta con su nombre de carpeta.') +
    '</div>' +
    '<div class="field"><label for="set-romdir">Carpeta de ROMs</label>' +
    `<input id="set-romdir" class="in-txt" type="text" data-set="romDir" ` +
    `value="${esc(settings.romDir)}" spellcheck="false" placeholder="~/PortsLauncher/roms">` +
    fieldHint('Sólo se usa cuando eliges «copiar a la carpeta del port».') +
    '</div></section>'
  );
}

function romModeSection(settings: Settings): string {
  const link = settings.romMode === 'link';
  return (
    '<section class="sbox">' +
    '<h3>Modo de ROM por defecto</h3>' +
    '<label class="opt' + (link ? ' on' : '') + '">' +
    `<input type="radio" name="set-rom-mode" value="link"${link ? ' checked' : ''} ` +
    'aria-label="Enlace">' +
    '<span><span class="oname">Usar donde está (enlace)</span>' +
    '<span class="odesc">No se copia nada: se guarda la ruta original</span></span>' +
    '<span class="otag">recomendado</span></label>' +
    '<label class="opt' + (link ? '' : ' on') + '">' +
    `<input type="radio" name="set-rom-mode" value="copy"${link ? '' : ' checked'} ` +
    'aria-label="Copia">' +
    '<span><span class="oname">Copiar a la carpeta del port</span>' +
    '<span class="odesc">Duplica el fichero dentro de la instalación</span></span>' +
    '<span class="otag">copia</span></label>' +
    '<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">' +
    'En ningún caso se mueve ni se borra el archivo original.</p>' +
    '</section>'
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
      `<label class="opt${active ? ' on' : ''}">` +
      `<input type="radio" name="set-dest" value="${os}"${active ? ' checked' : ''} ` +
      `aria-label="${esc(os)}">` +
      `<span><span class="oname">${esc(os)}</span>` +
      `<span class="odesc">${esc(desc)}</span></span>` +
      `<span class="otag">${active ? 'activo' : ''}</span></label>`
    );
  }).join('');

  return '<section class="sbox"><h3>Sistema de destino</h3>' + cards + '</section>';
}

function indexSection(catalog: CatalogProvenance): string {
  const flow =
    'HAR de GameWave + API de Quiver → adaptadores → deduplicación por clave técnica → ' +
    'evaluación de estado (Anexo F) → hash semántico → <span class="mono">ports.index.json</span>';
  const rows = [
    `<dt>Versión</dt><dd class="mono">${esc(catalog.version)}</dd>`,
    `<dt>Generado</dt><dd class="mono">${esc(catalog.generatedAt.slice(0, 19).replace('T', ' ') || '—')}</dd>`,
    `<dt>Hash</dt><dd class="mono" title="${esc(catalog.semanticHash)}">${esc(shortHash(catalog.semanticHash))}</dd>`,
    `<dt>Puertos</dt><dd>${catalog.totalPorts}</dd>`,
    `<dt>Plataformas</dt><dd>${catalog.platforms}</dd>`,
    `<dt>Fusionados</dt><dd>${catalog.fused} <span class="mono">(GameWave + Quiver)</span></dd>`,
    `<dt>Multi-repo</dt><dd>${catalog.multiRepositories}</dd>`,
  ];

  return (
    '<section class="sbox">' +
    '<h3>Índice PortsHub</h3>' +
    `<p style="margin:0;font-size:var(--fs-s)">${flow}</p>` +
    `<dl class="kv">${rows.join('')}</dl>` +
    '<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">' +
    'PortsHub no aloja binarios ni ROMs: sólo indexa metadatos y enlaces oficiales ' +
    'declarados por los proyectos. Las fichas marcadas en cuarentena no exponen sus URLs.' +
    '</p></section>'
  );
}

function legendSection(): string {
  const rows = DEVELOPMENT_LEGEND.map((entry) => {
    const meta = DEV_TAG_META[entry.tag];
    return (
      '<div class="set-row" style="align-items:flex-start">' +
      `<div class="sl"><b>${esc(entry.title)}</b><span>${esc(entry.text)}</span></div>` +
      `<div class="sr"><span class="pill st-${entry.tag}" data-dev="${entry.tag}">` +
      `<span aria-hidden="true" style="font-size:9px;line-height:1">${esc(meta.glyph)}</span>` +
      `<span>${esc(meta.label)}</span></span></div></div>`
    );
  }).join('');

  return (
    '<section class="sbox">' +
    '<h3>Leyenda de etiquetas de desarrollo</h3>' +
    rows +
    '<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">' +
    'El evaluador aplica 6 reglas en orden (de «sin datos» a «jugable»): la primera que se ' +
    'cumple gana. Cada ficha muestra además el motivo y la confianza del resultado.' +
    '</p></section>'
  );
}

function resetSection(): string {
  return (
    '<section class="sbox">' +
    '<h3>Datos locales</h3>' +
    '<p style="margin:0;font-size:var(--fs-s)">' +
    'Restablecer borra la biblioteca local y los ajustes (instalaciones registradas, ' +
    'ROMs enlazadas y preferencias). No toca los ficheros de tu disco.</p>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    '<button type="button" class="btn dng sm" data-act="reset">' +
    `${icon('trash', { size: 15 })}<span>Restablecer datos</span></button>` +
    '<span data-reset-confirm hidden style="display:flex;gap:8px;align-items:center">' +
    '<span class="mono" style="font-size:var(--fs-2xs);color:var(--warn)">¿Seguro?</span>' +
    '<button type="button" class="btn dng sm" data-act="reset-confirm">Sí, borrar</button>' +
    '<button type="button" class="btn sm" data-act="reset-cancel">Cancelar</button>' +
    '</span></div>' +
    `<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">` +
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
    '<div class="settings">' +
    mediaSection(settings) +
    viewSection(settings) +
    dirsSection(settings) +
    romModeSection(settings) +
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
 * Traduce los cambios de los controles (`data-set`, `data-set-platform`) a
 * parches de `Settings`, y gestiona la confirmación en dos pasos del reset.
 */
export function delegateSettingsEvents(
  root: HTMLElement,
  callbacks: SettingsCallbacks = {}
): () => void {
  function patch(partial: Partial<Settings>): void {
    callbacks.onSettings?.(partial);
  }

  function onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    /* Medios: un solo estilo vs por plataforma. */
    if (target instanceof HTMLInputElement && target.name === 'set-media-mode') {
      patch({ mediaMode: target.value === 'single' ? 'single' : 'auto' });
      return;
    }
    if (target instanceof HTMLInputElement && target.name === 'set-rom-mode') {
      patch({ romMode: (target.value === 'copy' ? 'copy' : 'link') as RomMode });
      return;
    }
    if (target instanceof HTMLInputElement && target.name === 'set-dest') {
      patch({ dest: (target.value === 'Windows' ? 'Windows' : 'Linux') as DestOS });
      return;
    }

    /* Interruptor de soportes. */
    if (target instanceof HTMLInputElement && target.dataset.set === 'media') {
      patch({ media: target.checked });
      return;
    }

    /* Selectores simples. */
    if (target instanceof HTMLSelectElement) {
      const key = target.dataset.set;
      if (key === 'mediaDef') {
        patch({ mediaDef: target.value as MediaStyle });
        return;
      }
      if (key === 'view') {
        patch({ view: target.value as ViewMode });
        return;
      }
      const platform = target.dataset.setPlatform as SourcePlatform | undefined;
      if (platform) {
        const settings = libraryService.getSettings();
        patch({
          mediaMap: { ...settings.mediaMap, [platform]: target.value as MediaStyle },
        });
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

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hit = target.closest<HTMLElement>('[data-act]');
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
      return;
    }
  }

  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  return () => {
    root.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
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
