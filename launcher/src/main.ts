/* ==========================================================================
 * PortsLauncher · main.ts
 *
 * Controlador principal idéntico al prototipo interactivo
 * (`Documentación/PortsHub Prototipo.html`), alimentado con los datos reales
 * de `catalogService` y `libraryService`.
 * ========================================================================== */

import './styles/app.css';

import type {
  Addon,
  DestOS,
  MediaStyle,
  PortItem,
  RomMode,
  Settings,
  SourcePlatform,
  ViewMode,
} from './services/types';
import { DEFAULT_SETTINGS, LEGACY_VIEW_ALIASES } from './services/types';
import { catalogService } from './services/catalogService';
import { libraryService } from './services/libraryService';
import {
  providerForPlatform,
  provisionProviderAsset,
  romProviders,
  searchProviderAssets,
  variantLabel,
} from './services/addonProvider';
import type { ProviderPhase, ProviderResult } from './services/addonProvider';
import type { Game } from './ui/model';
import { toGame, statusOf, esc, styleFor, folderOf, providerQuery, resolveLaunchArgs, describeRomFileSet, isRomDescriptor, type RomFileLike } from './ui/model';
import { mediaHTML } from './ui/media';
import { MEDIA, PLAT } from './ui/platforms';
import { B, D, NAVMEM, R, S, setSnapshot, updateCount } from './ui/state';
import type { Route } from './ui/state';
import {
  renderSide,
  renderBottomNav,
  renderHome,
  renderBrowse,
  refreshBrowse,
  renderUpdates,
  renderSettings,
  renderAddons,
  renderGame,
  resultsHTML,
  heroHTML,
  artModalHTML,
  artDraftOf,
  artPatchOf,
  clampCoverOffset,
  clampCoverScale,
  clampHeroScale,
  clampLogoScale,
  wizardModalHTML,
  pluginsDocModalHTML,
  setSteamgridServerReady,
  steamgridConfigured,
  setSettingsTab,
  setLauncherUpdate,
  getLauncherUpdate,
  launcherUpdateBodyHTML,
  setUpdateProgress,
  getUpdateProgress,
  RT,
  RT_INV,
  bgOf,
} from './ui/render';
import type { ArtDraft, ArtKind, ArtTab, LogoAnchor, SettingsTab } from './ui/render';
import { art } from './ui/model';
import {
  checkForUpdates,
  getUpdateRepo,
  isCheckFailed,
  isValidRepo,
  setUpdateRepo,
} from './services/updateService';

const STORAGE_KEY = 'portshub-proto-v1';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
  document.querySelector<T>(sel);

/* -------------------------------------------------------------------------- */
/* Capas modales: ROM, engranaje, desinstalación, lanzamiento                 */
/* -------------------------------------------------------------------------- */

interface LayerRom {
  type: 'rom';
  id: string;
}

interface LayerGear {
  type: 'gear';
  id: string;
}

interface LayerUnins {
  type: 'unins';
  id: string;
}

interface LayerLaunch {
  type: 'launch';
  id: string;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Modal de error con el reporte técnico del fallo.
 *
 * No lleva `id` a propósito: un fallo puede ocurrir antes de saber a qué port
 * pertenece (o con el port ya desinstalado), y el modal debe abrirse igual. Por
 * eso `renderLayer` lo resuelve antes de buscar el juego en el snapshot.
 */
interface LayerError {
  type: 'error';
  title: string;
  message: string;
  logPath: string;
}

type LayerState = LayerRom | LayerGear | LayerUnins | LayerLaunch | LayerError | null;

let L: LayerState = null;

interface RomWizardState {
  file: { name: string; size: number } | null;
  /**
   * Selección completa (HU-15). Un disco de PlayStation/Saturn llega como
   * `.cue` + pistas `.bin`, así que el asistente guarda **todos** los ficheros
   * elegidos y usa el descriptor como ruta de `{rom}`. El backend vuelve a
   * resolver las pistas desde el `.cue`, pero aquí hacen falta para contar los
   * acompañantes y para no perderlos al cambiar el modo.
   */
  files: RomFileLike[];
  /** Cuántas pistas/acompañantes acompañan al fichero principal. */
  companions: number;
  /**
   * Etiqueta legible del conjunto: `Dino Crisis 2.cue (+2 archivos de pistas)`.
   * Es lo que se pinta en el dropzone cuando la selección trae acompañantes;
   * con un solo fichero coincide con su nombre.
   */
  label: string;
  checks: Array<{ ok: boolean; t: string; v: string }>;
  ok: boolean;
  mode: RomMode;
  fromInstall: boolean;
}

let W: RomWizardState = {
  file: null,
  files: [],
  companions: 0,
  label: '',
  checks: [],
  ok: false,
  mode: 'link',
  fromInstall: false,
};

/* -------------------------------------------------------------------------- */
/* Flujo asistido con addons (`asset-provider`)                               */
/* -------------------------------------------------------------------------- */

/**
 * Estado del buscador de ROMs que se pinta dentro del modal de ROM y del drawer
 * de configuración.
 *
 * Es un único objeto (no estado por port) porque el flujo vive siempre dentro de
 * una capa modal: abrir otra lo reinicia. `addonId` lo devuelve el backend, que
 * puede resolver un plugin distinto del propuesto si el declarado no soporta la
 * plataforma del port.
 */
interface ProviderFlow {
  addonId: string;
  addonName: string;
  /** Título con el que se consulta al plugin (el del port). */
  query: string;
  phase: ProviderPhase;
  message: string;
  results: ProviderResult[];
  error: string | null;
  /** Ficha remota para la descarga manual cuando el plugin no la detectó. */
  url: string | null;
}

let PF: ProviderFlow | null = null;

/** `true` mientras hay una petición al backend en vuelo (evita dobles envíos). */
let providerBusy = false;

/** Proveedor activo que puede servir la plataforma del port, o `null`. */
function providerFor(game: Game | undefined): Addon | null {
  if (!game) return null;
  return providerForPlatform(romProviders(S.addons), game.platform);
}

/**
 * Prepara el flujo al abrir el modal de ROM.
 *
 * Sin addons aptos deja `PF` en `null` y la sección no se pinta: la UI no
 * promete un buscador que no existe.
 */
function resetProviderFlow(game: Game): void {
  const addon = providerFor(game);
  providerBusy = false;
  PF = addon
    ? {
        addonId: addon.id,
        addonName: addon.name || addon.id,
        /* Título con el que se busca en el addon: `2 Ship 2 Harkinian (Zelda:
         * Majora's Mask)` se convierte en `Majora's Mask`, que es como está
         * catalogada la ROM (HU-13). */
        query: providerQuery(game.t),
        phase: 'idle',
        message: '',
        results: [],
        error: null,
        url: null,
      }
    : null;
}

/** Icono/estado textual de cada fase del flujo. */
function providerStatusLine(flow: ProviderFlow): string {
  if (flow.phase === 'searching') {
    return (
      '<div class="chk"><i>⋯</i><span style="flex:1">Buscando en ' +
      `${esc(flow.addonName)}…</span></div>`
    );
  }
  if (flow.phase === 'provisioning') {
    /* Texto literal del contrato: la descarga la confirma el usuario en el
     * navegador, así que la UI tiene que decirlo sin rodeos. */
    return (
      '<div class="chk"><i>⋯</i><span style="flex:1">Abriendo navegador y esperando descarga...</span></div>' +
      '<div class="muted" style="font-size:12px">Confirma la descarga en el navegador que se acaba de abrir; ' +
      'el launcher moverá el archivo a la carpeta del port.</div>'
    );
  }
  if (flow.phase === 'done') {
    return (
      '<div class="chk"><i>✓</i><span style="flex:1">' +
      `${esc(flow.message || 'ROM aprovisionada')}</span></div>`
    );
  }
  if (flow.phase === 'error') {
    return (
      '<div class="chk bad"><i>✕</i><span style="flex:1">' +
      `${esc(flow.error ?? 'El addon no devolvió resultados')}</span></div>` +
      (flow.url
        ? `<button class="btn sm" data-act="provider-open" data-url="${esc(flow.url)}">Abrir ficha en el navegador</button>`
        : '')
    );
  }
  return '';
}

/**
 * Sección «PROVEEDORES Y ADDONS» del modal de ROM y del drawer de configuración.
 *
 * Devuelve `''` cuando no hay ningún addon de aprovisionamiento activo, de modo
 * que la UI de un launcher sin plugins queda exactamente como antes.
 *
 * @param searchLabel Texto del botón de búsqueda. El drawer de configuración usa
 *   «Buscar ROM con Addon» (genérico, porque puede haber más de un proveedor
 *   instalado); el modal de ROM nombra al proveedor concreto que va a responder.
 */
function providerSectionHTML(game: Game, searchLabel?: string): string {
  if (!PF) return '';
  const busy = providerBusy || PF.phase === 'searching' || PF.phase === 'provisioning';
  const disabled = busy ? 'disabled style="opacity:.45;cursor:not-allowed"' : '';

  const head =
    '<div class="lbl" style="padding:0">PROVEEDORES Y ADDONS</div>' +
    `<div class="muted" style="font-size:12px">${esc(PF.addonName)} · ${esc(PF.addonId)}</div>`;

  const searchBtn =
    `<button class="btn" data-act="provider-search" data-id="${esc(game.id)}" ${disabled}>` +
    `${
      busy && PF.phase === 'searching'
        ? 'Buscando…'
        : esc(searchLabel ?? `Buscar ROM con ${PF.addonName}`)
    }</button>`;

  const rows = PF.results
    .map((result) => {
      const detail = [result.description, result.platform].filter(Boolean).join(' · ');
      return (
        '<div class="chk" style="align-items:flex-start;gap:10px">' +
        `<span style="flex:1;min-width:0"><b>${esc(result.title)}</b>` +
        `<div class="muted mono" style="font-size:12px">${esc(variantLabel(result))}</div>` +
        (detail ? `<div class="muted" style="font-size:12px">${esc(detail)}</div>` : '') +
        '</span>' +
        `<button class="btn sm pri" data-act="provider-provision" data-id="${esc(game.id)}" ` +
        `data-asset-id="${esc(result.id)}" ${disabled}>Descargar y aprovisionar</button>` +
        '</div>'
      );
    })
    .join('');

  const list = PF.results.length
    ? `<div style="display:flex;flex-direction:column;gap:8px">${rows}</div>`
    : PF.phase === 'results'
      ? '<div class="muted" style="font-size:12px">No se encontraron ROMs para este port en el addon.</div>'
      : '';

  return (
    `<section style="display:flex;flex-direction:column;gap:10px">${head}${searchBtn}` +
    `${providerStatusLine(PF)}${list}` +
    '<div class="muted" style="font-size:12px">El addon solo localiza la ficha: la descarga la confirmas tú ' +
    'en el navegador y el archivo se queda en tu equipo.</div></section>'
  );
}

/** `POST /api/plugins/search` con el título y la plataforma del port. */
async function triggerProviderSearch(game: Game): Promise<void> {
  if (providerBusy) return;
  if (!PF) resetProviderFlow(game);
  const flow = PF;
  if (!flow) {
    toast('No hay addons de aprovisionamiento activos');
    return;
  }

  providerBusy = true;
  flow.phase = 'searching';
  flow.message = '';
  flow.error = null;
  flow.url = null;
  flow.results = [];
  renderLayer();

  const outcome = await searchProviderAssets({
    /* `flow.query` ya viene normalizado por `providerQuery()`; el respaldo
     * cubre un flujo restaurado sin query. */
    query: flow.query || providerQuery(game.t),
    platform: game.platform,
    pluginId: flow.addonId,
  });

  providerBusy = false;
  /* El usuario pudo cerrar el modal o abrir otro port mientras se esperaba. */
  if (PF !== flow) return;

  if (outcome.pluginId) flow.addonId = outcome.pluginId;
  if (!outcome.ok) {
    flow.phase = 'error';
    flow.error = outcome.error ?? 'No se pudo buscar en el addon.';
  } else {
    flow.results = outcome.results;
    flow.phase = 'results';
  }

  if (L && 'id' in L && L.id === game.id) renderLayer();
  else toast(flow.phase === 'error' ? (flow.error ?? 'Error del addon') : 'Búsqueda completada');
}

/**
 * `POST /api/plugins/provision` y registro de la ROM en la biblioteca.
 *
 * Al terminar con archivo se actualiza el estado local, se persiste con
 * `libraryService.setRom` (que deja el port en `Ready` y habilita «Jugar») y se
 * repinta: el modal queda abierto mostrando el éxito y la ficha cambia de
 * «Falta ROM» a «Listo».
 */
async function triggerProviderProvision(game: Game, assetId: string): Promise<void> {
  if (providerBusy) return;
  const flow = PF;
  if (!flow || !assetId) return;

  const outputDir = (game.dir || `${S.settings.installDir}/${folderOf(game.t)}`).trim();

  providerBusy = true;
  flow.phase = 'provisioning';
  flow.message = 'Abriendo navegador y esperando descarga...';
  flow.error = null;
  flow.url = null;
  renderLayer();

  const outcome = await provisionProviderAsset({
    pluginId: flow.addonId,
    assetId,
    outputDir,
  });

  providerBusy = false;
  if (PF !== flow) return;

  if (!outcome.ok || !outcome.outputPath) {
    flow.phase = 'error';
    flow.error = outcome.error ?? 'No se detectó descarga de ROM.';
    flow.url = outcome.url;
    renderLayer();
    toast('El addon necesita que confirmes la descarga en el navegador');
    return;
  }

  /* Registro y validación: `romOk` + `setRom(…, true)` es lo que convierte el
   * estado de la ficha en `Ready` («Listo» con botón «Jugar»). */
  game.romPath = outcome.outputPath;
  game.romOk = true;
  try {
    libraryService.setRom(game.id, outcome.outputPath, game.romMode, true);
  } catch (error) {
    console.warn('[PortsLauncher] No se pudo registrar la ROM en la biblioteca:', error);
  }
  saveState();

  flow.phase = 'done';
  flow.message = `ROM registrada en ${outcome.outputPath}`;
  flow.results = [];

  draw();
  renderLayer();
  toast(`${game.t}: ROM lista · ya puedes jugar`);
}

export function toast(msg: string): void {
  const container = $('#toast');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function fmtSize(bytes: number): string {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

/**
 * Extensiones que ofrece el selector nativo de archivos.
 *
 * Incluye los descriptores de disco (`.cue`, `.gdi`, `.m3u`) aunque el perfil
 * del port sólo declare la extensión de las pistas: sin ellos el diálogo
 * ocultaría justo el fichero que el usuario tiene que elegir.
 */
function romAccept(game: Game): string {
  const allowed = game.rom ? game.rom.x : ['.iso', '.bin', '.rom', '.z64'];
  return [...new Set([...allowed, '.cue', '.gdi', '.m3u'])].join(',');
}

function validateRom(game: Game, name: string, size: number, companions = 0) {
  const ext = (name.match(/\.[^.]+$/) ?? [''])[0].toLowerCase();
  const allowed = game.rom ? game.rom.x : ['.iso', '.bin', '.rom', '.z64'];
  /* Un `.cue`/`.gdi`/`.m3u` no es la ROM, es su índice: el perfil declara la
   * extensión de las pistas (`.bin`, `.iso`), así que rechazarlo por extensión
   * impediría aportar justo el formato que los discos multi-pista necesitan. */
  const descriptor = isRomDescriptor(name);
  const okExt = descriptor || allowed.includes(ext);
  const checks = [
    {
      ok: okExt,
      t: descriptor
        ? 'Descriptor de disco reconocido'
        : okExt
          ? 'Extensión reconocida'
          : 'Extensión no reconocida',
      v: okExt ? ext : 'se esperaba ' + allowed.join(' '),
    },
  ];
  if (okExt) {
    checks.push({ ok: true, t: 'Tamaño correcto', v: fmtSize(size) });
    if (companions > 0) {
      checks.push({
        ok: true,
        t: 'Pistas asociadas detectadas',
        v: `${companions} ${companions === 1 ? 'archivo' : 'archivos'}`,
      });
    }
    checks.push({
      ok: true,
      t: descriptor
        ? 'Pistas enlazadas al lanzar'
        : ext === '.v64'
          ? 'Orden de bytes: se convertirá'
          : 'Orden de bytes correcto',
      v: descriptor ? 'se leen del índice' : ext === '.v64' ? 'byte-swapped' : 'big-endian',
    });
    checks.push({
      ok: true,
      t: 'Huella SHA-1 coincide',
      v: (game.rom?.sha ?? 'validado') + ' (simulado)',
    });
  }
  return checks;
}

function openRom(id: string, fromInstall = false): void {
  W = {
    file: null,
    files: [],
    companions: 0,
    label: '',
    checks: [],
    ok: false,
    mode: S.settings.romMode,
    fromInstall: !!fromInstall,
  };
  /* El buscador de addons se reinicia con cada apertura: así no arrastra
   * resultados del port anterior ni de una búsqueda ya cerrada. */
  const game = S.byId.get(id);
  if (game) resetProviderFlow(game);
  else PF = null;
  L = { type: 'rom', id };
  renderLayer();
}

/**
 * Registra la selección de ROM del asistente (HU-15).
 *
 * Acepta varios ficheros porque un disco de PlayStation/Saturn es un `.cue` más
 * sus pistas `.bin`: se elige el descriptor como principal y se cuentan los
 * acompañantes para mostrarlo en la UI. Con un solo fichero se comporta igual
 * que antes.
 *
 * Recibe la lista completa (arrastrar varios ficheros, `multiple` o una carpeta
 * con `webkitdirectory`); **nunca** se queda con el primero, que en una carpeta
 * de disco suele ser una pista `.bin` y no el `.cue` que el emulador espera.
 */
function setFiles(list: readonly RomFileLike[] | null | undefined): void {
  if (!L || L.type !== 'rom') return;
  const game = S.byId.get(L.id);
  if (!game) return;
  const files = (list ?? []).filter((file) => file && String(file.name ?? '').trim() !== '');
  if (files.length === 0) return;
  const selection = describeRomFileSet(files);
  if (!selection.main) return;
  W.files = files.slice();
  W.companions = selection.companions.length;
  W.label = selection.label;
  W.file = { name: selection.main.name, size: selection.size };
  W.checks = validateRom(game, selection.main.name, selection.size, W.companions);
  W.ok = W.checks.every((check) => check.ok);
  renderLayer();
}

/** Azúcar para el botón «Usar ROM de ejemplo» y la ruta de un solo fichero. */
function setFile(name: string, size: number): void {
  setFiles([{ name, size }]);
}

function romDest(game: Game): string {
  const f = W.file ? W.file.name : `${game.id}${game.rom ? game.rom.x[0] : '.rom'}`;
  return W.mode === 'link'
    ? `~/Descargas/${f}`
    : `${S.settings.romDir}/${game.t.replace(/[^A-Za-z0-9]+/g, '')}/${f}`;
}

/** Icono de alerta del modal de error (triángulo con exclamación). */
const ALERT_ICON =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v5"/><path d="M12 17.5v.01"/><path d="M10.3 3.9 2.6 17.1A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';

/**
 * HTML del modal de error con la ruta del reporte técnico.
 *
 * El botón «Abrir reporte» lleva la ruta en `data-path` y la abre con el visor
 * del sistema a través de `data-act="openReport"`. «Cerrar» usa la acción
 * genérica `closeL`, que ya limpia la capa y restaura el scroll.
 */
function errorLayerHTML(layer: LayerError): string {
  return `<div class="scrim" data-act="closeL"></div><div class="modal" style="width:min(620px,calc(100vw - 24px))" role="alertdialog" aria-modal="true" aria-labelledby="err-title">
    <div class="mhead"><div style="width:44px;height:44px;flex:0 0 auto;border-radius:50%;background:var(--warn);color:#2A1A02;display:grid;place-items:center">${ALERT_ICON}</div><div style="min-width:0"><h2 id="err-title" style="font-size:21px">${esc(layer.title)}</h2><div class="muted">${esc(layer.message)}</div></div></div>
    <div class="mbody"><div><div class="lbl" style="padding:0;margin-bottom:8px">REPORTE TÉCNICO</div><div class="in-txt mono" style="font-size:12px;overflow-wrap:anywhere">${esc(layer.logPath)}</div></div>
    <div class="muted" style="font-size:13px">Envía este archivo si necesitas ayuda: incluye el sistema operativo, la arquitectura, la versión del launcher y la pila del error.</div></div>
    <div class="mfoot"><button class="btn" data-act="closeL">Cerrar</button><button class="btn pri" data-act="openReport" data-path="${esc(layer.logPath)}">Abrir reporte</button></div></div>`;
}

function romDisclaimerHTML(game: Game): string {
  const raw = (game.port?.raw ?? {}) as Record<string, unknown>;
  const projectUrl = (raw.projectUrl || raw.officialUrl || raw.homepage) as string | undefined;
  const docUrl = (projectUrl && /^https?:\/\//i.test(projectUrl)) ? projectUrl : repoUrl(game.repo || game.port?.repository);
  const buttonHtml = docUrl
    ? `<div style="margin-top:8px"><button type="button" class="btn sm" data-act="openRepo" data-repo="${esc(docUrl)}" style="display:inline-flex;align-items:center;gap:6px">📖 Ver documentación del autor</button></div>`
    : '';

  return (
    `<div class="sbox disclaimer-box" style="border-left:3px solid var(--accent, #646cff);background:rgba(255,255,255,0.03);padding:10px 12px;margin-top:10px;border-radius:4px">` +
    `<p style="margin:0;font-size:12px;line-height:1.45;color:var(--muted)">` +
    `El ejecutable y los parámetros necesarios para iniciar este juego (o cargar la ROM/BIOS) pueden variar según la versión y las decisiones del autor del repositorio. Por favor, consulta la documentación oficial entregada por el autor.` +
    `</p>` +
    buttonHtml +
    `</div>`
  );
}

function renderLayer(): void {
  const el = $('#layer');
  if (!el) return;
  if (!L) {
    el.innerHTML = '';
    document.body.style.overflow = '';
    return;
  }
  document.body.style.overflow = 'hidden';
  /* El modal de error no depende de un port concreto: se pinta antes de
   * resolver el juego del snapshot, porque el fallo puede ocurrir con una ficha
   * que no llegó a crearse o que el usuario acaba de desinstalar. */
  if (L.type === 'error') {
    el.innerHTML = errorLayerHTML(L);
    const btn = el.querySelector<HTMLButtonElement>('.modal button');
    if (btn) btn.focus({ preventScroll: true });
    return;
  }
  const game = S.byId.get(L.id);
  if (!game) {
    closeL();
    return;
  }
  let h = '';

  if (L.type === 'rom') {
    h = `<div class="scrim" data-act="closeL"></div><div class="modal" role="dialog" aria-modal="true" aria-label="Añadir ROM">
    <div class="mhead"><div style="width:44px;height:44px;border-radius:50%;background:var(--accent2);color:#04202B;display:grid;place-items:center;font-weight:800;font-size:20px">${W.fromInstall ? '✓' : '↑'}</div><div><h2 style="font-size:22px">${W.fromInstall ? esc(game.t) + ' se instaló' : 'Añade tu ROM de ' + esc(game.t)}</h2><div class="muted">${W.fromInstall ? 'Un último paso: falta tu ROM para poder jugar.' : 'Elige tu copia del juego.'}</div></div></div>
    <div class="mbody"><div class="drop" id="drop"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
     <b style="font-size:16px">${W.file ? esc(W.label || W.file.name) : 'Suelta aquí tu archivo de ROM'}</b><div class="muted">${W.companions > 0 ? `${W.companions} ${W.companions === 1 ? 'pista asociada' : 'pistas asociadas'} · ` : ''}${game.rom ? game.rom.n + ' · ' + game.rom.x.join(' ') : 'Archivos de juego'}</div>
     <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn" data-act="pick">Elegir archivo…</button><button class="btn" data-act="pickDir">Elegir carpeta…</button><button class="btn" data-act="sample">Usar ROM de ejemplo</button></div><input type="file" id="fpick" hidden multiple accept="${esc(romAccept(game))}"><input type="file" id="fpickdir" hidden multiple webkitdirectory directory><div class="muted" style="font-size:12px">Puedes soltar el <span class="mono">.cue</span> y sus pistas <span class="mono">.bin</span> a la vez, o la carpeta del disco entera.</div></div>
    ${providerSectionHTML(game)}
    ${W.checks.length ? `<div style="display:flex;flex-direction:column;gap:8px"><div class="lbl" style="padding:0">VALIDACIÓN</div>${W.checks.map((c) => `<div class="chk ${c.ok ? '' : 'bad'}"><i>${c.ok ? '✓' : '✕'}</i><span style="flex:1">${c.t}</span><span class="mono muted" style="font-size:12px">${esc(c.v)}</span></div>`).join('')}</div>` : ''}
    <div><div class="lbl" style="padding:0;margin-bottom:10px">¿CÓMO LA USAMOS?</div><div style="display:flex;flex-wrap:wrap;gap:12px"><button class="opt" role="radio" aria-checked="${W.mode === 'link'}" data-act="wmode" data-k="link"><b>Usarla desde donde está</b><span class="muted">Se enlaza a <span class="mono" style="font-size:12px">${esc(W.file ? '~/Descargas/' + W.file.name : '~/Descargas/…')}</span>. No se mueve nada.</span></button><button class="opt" role="radio" aria-checked="${W.mode === 'copy'}" data-act="wmode" data-k="copy"><b>Copiarla a la carpeta del port</b><span class="muted">Se copia a <span class="mono" style="font-size:12px">${esc(S.settings.romDir)}/…</span></span></button></div><div class="muted" style="font-size:12px;margin-top:8px">El archivo original nunca se mueve ni se borra. Puedes cambiarlo luego en el engranaje ⚙.</div></div>
    ${romDisclaimerHTML(game)}
    </div>
    <div class="mfoot"><button class="btn" data-act="closeL">${W.fromInstall ? 'Hacerlo después' : 'Cancelar'}</button><button class="btn pri" data-act="saveRom" ${W.ok ? '' : 'disabled style="opacity:.45;cursor:not-allowed"'}>${W.fromInstall ? 'Guardar y jugar' : 'Guardar'}</button></div></div>`;
  } else if (L.type === 'unins') {
    h = `<div class="scrim" data-act="closeL"></div><div class="modal" style="width:min(460px,calc(100vw - 24px))" role="alertdialog" aria-modal="true"><div class="mbody"><h2 style="font-size:22px">¿Desinstalar ${esc(game.t)}?</h2><div class="muted">Se borra la carpeta del port. Tu ROM original no se toca.</div><label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="keep" checked> Conservar mis partidas guardadas</label></div><div class="mfoot"><button class="btn" data-act="closeL">Cancelar</button><button class="btn dng" data-act="doUnins">Desinstalar</button></div></div>`;
  } else if (L.type === 'gear') {
    h = `<div class="scrim" data-act="closeL"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Configuración de ${esc(game.t)}">
    <div style="display:flex;align-items:center;gap:14px"><div class="thumb" style="width:56px;height:56px;background:${bgOf(game)}"></div><div style="flex:1;min-width:0"><h2 style="font-size:22px">${esc(game.t)}</h2><div class="muted">${esc(game.pr)} · v${game.v ?? game.lv} · Configuración</div></div><button class="btn ico" data-act="closeL" aria-label="Cerrar">✕</button></div>
    <section style="display:flex;flex-direction:column;gap:10px"><div class="lbl" style="padding:0">DIRECTORIO DE INSTALACIÓN</div><input class="in-txt" data-g="dir" value="${esc(game.dir)}" aria-label="Directorio de instalación"><div style="display:flex;gap:8px"><button class="btn sm" data-act="toast" data-m="Abriendo carpeta… (simulado)">Abrir carpeta</button><button class="btn sm" data-act="toast" data-m="Port movido a ${esc(game.dir)} (simulado)">Mover aquí</button></div></section>
    <section style="display:flex;flex-direction:column;gap:10px"><div class="lbl" style="padding:0">ROM</div><div style="display:flex;gap:8px"><div class="in-txt" style="display:flex;align-items:center;overflow:hidden;white-space:nowrap">${game.romOk && game.romPath ? esc(game.romPath) : 'Sin ROM'}</div><button class="btn" data-act="rom" data-id="${L.id}">Cambiar…</button></div>
     <div class="muted" style="font-size:12px">Se espera ${esc(game.rom.n)} · ${esc(game.rom.x.join(' '))}</div>
     <div class="seg" role="group" aria-label="Modo de ROM"><button style="flex:1;width:auto;font-weight:600" aria-pressed="${game.romMode === 'link'}" data-act="gmode" data-k="link">Usar donde está</button><button style="flex:1;width:auto;font-weight:600" aria-pressed="${game.romMode === 'copy'}" data-act="gmode" data-k="copy">Copiar a carpeta del port</button></div>
     <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="color:${game.romOk ? 'var(--accent2)' : 'var(--warn)'};font-weight:600">${game.romOk ? '● Validada · SHA-1 coincide' : '● Falta la ROM'}</span><button class="btn sm" data-act="reval">Revalidar</button></div></section>
    ${providerSectionHTML(game, 'Buscar ROM con Addon')}
    <section style="display:flex;flex-direction:column;gap:10px"><div class="lbl" style="padding:0">ACTUALIZACIONES</div>
     <div class="chk" style="justify-content:space-between"><span>Actualizar automáticamente</span><button class="tog" role="switch" aria-checked="${game.auto}" data-act="gtog" data-k="auto" aria-label="Actualizar automáticamente"><i></i></button></div>
     <div class="chk" style="justify-content:space-between"><span>Fijar versión <span class="mono warn" style="color:var(--warn)">v${game.v ?? game.lv}</span></span><button class="tog" role="switch" aria-checked="${game.pin}" data-act="gtog" data-k="pin" aria-label="Fijar versión"><i></i></button></div></section>
    <section style="display:flex;flex-direction:column;gap:10px"><div class="lbl" style="padding:0">AVANZADO</div><label class="muted">Ejecutable<input class="in-txt" data-g="exe" value="${esc(game.exe || './' + game.t.replace(/[^A-Za-z0-9]+/g, '') + '.exe')}"></label><label class="muted">Argumentos<input class="in-txt" data-g="args" value="${esc(game.args)}"></label><label class="muted">Ejecutar con<br><select class="sel" data-g="runner" style="margin-top:6px"><option ${game.runner === 'Nativo' ? 'selected' : ''}>Nativo</option><option ${game.runner === 'Proton' ? 'selected' : ''}>Proton</option></select></label></section>
    <div style="margin-top:auto;display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between"><button class="btn dng" data-act="unins">Desinstalar (conservar partidas)</button><button class="btn pri" data-act="closeL">Listo</button></div></aside>`;
  } else if (L.type === 'launch') {
    h = `<div class="launch"><div class="spin"></div><h2 style="font-size:30px">Iniciando ${esc(game.t)}…</h2><div class="muted">${esc(game.pr)} · ${game.runner} · buscando el ejecutable</div><button class="btn" data-act="closeL">Cancelar</button></div>`;
  }

  el.innerHTML = h;

  const drop = $('#drop');
  if (drop) {
    ['dragover', 'dragenter'].forEach((e) =>
      drop.addEventListener(e, (ev) => {
        ev.preventDefault();
        drop.classList.add('over');
      })
    );
    drop.addEventListener('dragleave', (ev) => {
      ev.preventDefault();
      drop.classList.remove('over');
    });
    /* Un disco multifichero llega como varios ficheros a la vez: se pasan
     * **todos** a `setFiles`, que elige el descriptor como principal. Quedarse
     * con `files[0]` tomaría la primera pista `.bin` y rompería el lanzamiento. */
    drop.addEventListener('drop', (ev) => {
      ev.preventDefault();
      drop.classList.remove('over');
      const dt = (ev as DragEvent).dataTransfer;
      const files = dt ? Array.from(dt.files ?? []) : [];
      if (files.length > 0) setFiles(files);
    });
    const fp = $('#fpick') as HTMLInputElement | null;
    if (fp) {
      fp.addEventListener('change', () => {
        const files = fp.files ? Array.from(fp.files) : [];
        if (files.length > 0) setFiles(files);
      });
    }
    /* Selección de carpeta completa (`webkitdirectory`). El navegador entrega
     * todos los ficheros del árbol con su `webkitRelativePath`, que es lo que
     * `describeRomFileSet` usa para mostrar la ruta legible. */
    const fpd = $('#fpickdir') as HTMLInputElement | null;
    if (fpd) {
      fpd.addEventListener('change', () => {
        const files = fpd.files ? Array.from(fpd.files) : [];
        if (files.length > 0) setFiles(files);
      });
    }
  }

  const firstBtn = el.querySelector<HTMLButtonElement>(
    '.modal button, .drawer button, .launch button'
  );
  if (firstBtn) firstBtn.focus({ preventScroll: true });
}

function closeL(): void {
  if (L && L.type === 'launch' && L.timer) clearTimeout(L.timer);
  const wasRom = L && L.type === 'rom' && W.fromInstall;
  L = null;
  renderLayer();
  if (wasRom) toast('Podrás añadir la ROM cuando quieras desde el engranaje ⚙');
  draw();
}

/* -------------------------------------------------------------------------- */
/* Errores: reporte técnico y modal interactivo                               */
/* -------------------------------------------------------------------------- */

/** Datos mínimos que el backend necesita para escribir un reporte útil. */
interface FailureInput {
  /** Título del modal (`No se pudo instalar Mario 64`). */
  title: string;
  /** Mensaje comprensible para el usuario. */
  message: string;
  /** Acción que falló: `install`, `update`, `launch`… */
  action: string;
  /** Error original: se envían al backend su mensaje y su pila. */
  error: unknown;
  pid?: string;
  name?: string;
  details?: Record<string, unknown>;
  /** Ruta ya generada por el backend (por ejemplo, `/api/launch` la devuelve). */
  logPath?: string | null;
}

/**
 * Pide al backend que escriba el reporte técnico y devuelve su ruta.
 *
 * Devuelve `null` si el servidor no responde o no pudo escribir el archivo: el
 * modal se abre igualmente indicándolo, porque ocultar el fallo sería peor que
 * quedarse sin log.
 */
async function reportFailure(input: FailureInput): Promise<string | null> {
  const error = input.error;
  try {
    const res = await fetch('/api/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: input.pid ?? null,
        name: input.name ?? null,
        action: input.action,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
        details: input.details ?? null,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; logPath?: string };
    if (res.ok && data.ok && typeof data.logPath === 'string') return data.logPath;
  } catch {
    /* Servidor caído o `fetch` bloqueado: el modal sigue siendo útil. */
  }
  return null;
}

/**
 * Abre un reporte técnico o la carpeta de plugins con la app del sistema.
 *
 * El backend aplica lista blanca: sólo pueden abrirse los `*.log` de
 * `~/PortsLauncher/logs` y la carpeta de plugins (o subcarpetas suyas);
 * cualquier otra ruta se rechaza con error.
 *
 * @param target Ruta absoluta (o con `~`) a un `.log` o a la carpeta de plugins.
 * @param what   Qué se está abriendo, para el aviso de error (`el reporte`,
 *               `la carpeta de plugins`…).
 */
async function openPathInSystem(target: string, what = 'el reporte'): Promise<void> {
  try {
    const res = await fetch('/api/open-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error || `Error ${res.status}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    toast(`No se pudo abrir ${what}: ` + detail);
  }
}

/**
 * Escribe el reporte y abre el modal con su ruta.
 *
 * Es el único camino de error visible para el usuario: cualquier fallo de
 * instalación o de ejecución acaba aquí, así que siempre queda un log en
 * `~/PortsLauncher/logs` y una ventana que dice dónde encontrarlo.
 */
async function failWithReport(input: FailureInput): Promise<void> {
  const logPath = input.logPath ?? (await reportFailure(input));
  L = {
    type: 'error',
    title: input.title,
    message: input.message,
    logPath: logPath ?? '(no se pudo escribir el reporte en disco)',
  };
  renderLayer();
}

/* -------------------------------------------------------------------------- */
/* Acciones: instalación real, ejecución y persistencia                       */
/* -------------------------------------------------------------------------- */

const PROG: Record<string, number> = {};

/**
 * Ejecuta el port instalado con `POST /api/launch`.
 *
 * Antes de llamar al backend se comprueba la ROM: un port que la necesita y no
 * la tiene no debe llegar al lanzamiento. Cualquier fallo (falta la ROM, la
 * carpeta no existe, no hay ejecutable) termina en el modal de error con su
 * reporte técnico.
 */
function play(id: string): void {
  void launchReal(id);
}

async function launchReal(id: string): Promise<void> {
  const game = S.byId.get(id);
  if (!game) return;

  if (game.rom && !game.romOk) {
    await failWithReport({
      title: 'No se pudo ejecutar ' + game.t,
      message: 'Falta la ROM del juego: añádela desde el engranaje ⚙ para poder jugar.',
      action: 'launch',
      pid: game.id,
      name: game.t,
      error: new Error('Falta la ROM del port.'),
      details: { reason: 'missing-rom', rom: game.rom.n ?? null, installDir: game.dir },
    });
    return;
  }

  /* Capa de progreso: el lanzamiento real tarda lo que tarde el `spawn` y la
   * localización del ejecutable, así que se cierra cuando responde el backend. */
  L = { type: 'launch', id };
  renderLayer();

  /* Sustitución de `{rom}` en el frontend (HU-13): el backend recibe los
   * argumentos ya resueltos como array, de modo que una ruta con espacios
   * (`/home/yo/Mis ROMs/zelda.z64`) sigue siendo un único argumento. */
  const romPath = (game.romPath ?? '').trim();
  const args = resolveLaunchArgs(game.args, romPath);

  try {
    const res = await fetch('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: game.id,
        name: game.t,
        folderName: folderOf(game.t),
        exe: game.exe,
        args,
        /* El backend enlaza la ROM dentro de la carpeta del port para que los
         * binarios que la buscan en su `cwd` (2ship.appimage) la encuentren. */
        romPath: romPath || undefined,
        installDir: game.dir,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      path?: string;
      logPath?: string | null;
    };

    if (!res.ok || !data.ok) {
      await failWithReport({
        title: 'No se pudo ejecutar ' + game.t,
        message: data.error || `El servidor devolvió un error ${res.status}.`,
        action: 'launch',
        pid: game.id,
        name: game.t,
        error: new Error(data.error || `Error ${res.status}`),
        details: { folderName: folderOf(game.t), installDir: game.dir },
        logPath: data.logPath ?? null,
      });
      return;
    }

    /* Sólo una ejecución real cuenta como «última partida». */
    S.last = id;
    game.played = Date.now();
    saveState();

    L = null;
    renderLayer();
    toast(game.t + ' en ejecución');
    draw();
  } catch (error) {
    await failWithReport({
      title: 'No se pudo ejecutar ' + game.t,
      message: error instanceof Error ? error.message : String(error),
      action: 'launch',
      pid: game.id,
      name: game.t,
      error,
      details: { folderName: folderOf(game.t), installDir: game.dir },
    });
  }
}

/**
 * Instala o actualiza un port con el pipeline real de `/api/install`.
 *
 * El servidor descarga el release, el ZIP del repositorio o clona el repo, y
 * deja el port listo en `LAUNCHER_HOME/ports/<folder>`. Aquí sólo se pinta el
 * progreso y se persiste el resultado: ruta física y versión instalada van a
 * `libraryService` (fuente de verdad, sobrevive a recargas) y a la ficha en
 * memoria que consume el renderizador.
 *
 * Sirve tanto para `install` como para `update`: el backend reescribe la
 * carpeta del port, que es exactamente lo que hace una actualización.
 */
async function installReal(id: string): Promise<void> {
  const game = S.byId.get(id);
  if (!game || PROG[id] != null) return;

  const wasInstalled = game.inst;
  PROG[id] = 0;
  draw();

  const setStage = (text: string, pct: number): void => {
    PROG[id] = pct;
    document.querySelectorAll<HTMLElement>(`[data-prog="${id}"]`).forEach((e) => {
      e.style.width = pct + '%';
    });
    document.querySelectorAll<HTMLElement>(`[data-stage="${id}"]`).forEach((e) => {
      e.textContent = text;
    });
  };
  setStage(wasInstalled ? 'Descargando actualización…' : 'Descargando…', 10);

  /* Avance lento mientras el servidor trabaja (sin superar el 90 %). */
  const iv = setInterval(() => {
    const cur = PROG[id] ?? 0;
    setStage(
      cur < 60 ? 'Descargando…' : cur < 80 ? 'Extrayendo…' : 'Instalando…',
      Math.min(90, cur + 2 + Math.random() * 4)
    );
  }, 400);

  try {
    const folderName = folderOf(game.t);
    const res = await fetch('/api/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: game.id,
        repo: game.repo,
        name: game.t,
        folderName,
        dest: game.dir,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      installDir?: string;
      method?: string;
      version?: string | null;
      assetName?: string;
      executables?: string[];
      error?: string;
    };
    if (!res.ok || !data.ok) throw new Error(data.error || `Error ${res.status}`);
    if (!data.installDir) throw new Error('El servidor no devolvió la ruta de instalación.');

    clearInterval(iv);
    setStage('Verificando…', 96);

    const installDir = data.installDir;
    /* La versión que compara la máquina de estados es la del índice
     * (`game.lv`): se persiste esa para que el port quede «Listo» y no
     * reaparezca como «Actualizar». El tag del release sólo se usa si el
     * catálogo no declara versión. */
    const catalogVersion = game.ver ?? (game.lv !== '—' ? game.lv : null);
    const installedVersion =
      catalogVersion ?? (data.version ? String(data.version) : null);
    const needsRom = !!game.rom && !game.romOk;

    /* Persistencia real: ruta física + versión en `libraryService`. */
    libraryService.updateLibraryGame(game.id, {
      state: needsRom ? 'NeedsRom' : 'Ready',
      installDir,
      installedVersion,
      installedAt: new Date().toISOString(),
      installStrategy: game.strategy,
      progress: 100,
      error: null,
    });

    /* Ficha en memoria: mismo snapshot que pinta la UI. */
    game.inst = true;
    game.dir = installDir;
    game.v = installedVersion;
    game.romOk = !needsRom;
    if (typeof data.method === 'string') game.st = methodLabel(data.method);

    PROG[id] = 100;
    setStage('Listo', 100);
    delete PROG[id];
    saveState();
    draw();

    if (needsRom) {
      toast(game.t + ' descargado · falta la ROM');
      openRom(id, true);
      return;
    }

    if (wasInstalled) {
      toast(`${game.t} actualizado${installedVersion ? ' a ' + installedVersion : ''}`);
    } else {
      toast(`${game.t} instalado en ${installDir}`);
    }
  } catch (error) {
    clearInterval(iv);
    delete PROG[id];
    const reason = error instanceof Error ? error.message : String(error);
    /* El fallo también se persiste: la ficha queda en `Broken` con la causa y
     * no se inventa un estado instalado. */
    try {
      libraryService.updateLibraryGame(game.id, {
        state: 'Broken',
        installedVersion: null,
        progress: 0,
        error: reason,
      });
    } catch {}
    game.inst = false;
    game.v = null;
    game.romOk = false;
    saveState();
    draw();
    /* Reporte técnico en disco + modal con la ruta: el toast se queda corto
     * para un fallo del que el usuario probablemente quiera pedir ayuda. */
    await failWithReport({
      title: (wasInstalled ? 'No se pudo actualizar ' : 'No se pudo instalar ') + game.t,
      message: reason,
      action: wasInstalled ? 'update' : 'install',
      pid: game.id,
      name: game.t,
      error,
      details: {
        repo: game.repo,
        folderName: folderOf(game.t),
        installDir: game.dir,
        wasInstalled,
      },
    });
  }
}

/** Texto legible del método de instalación devuelto por el backend. */
function methodLabel(method: string): string {
  switch (method) {
    case 'release':
      return 'Release oficial';
    case 'repo-zip':
      return 'ZIP del repositorio';
    case 'clone':
      return 'Clonado de Git';
    case 'existing':
      return 'Carpeta existente';
    default:
      return 'Descarga directa';
  }
}

/* -------------------------------------------------------------------------- */
/* Enlaces externos al repositorio del port                                   */
/* -------------------------------------------------------------------------- */

/**
 * Abre `url` en el navegador predeterminado del sistema operativo.
 *
 * En Electron `window.open` NO crea una ventana nueva: `setWindowOpenHandler`
 * (ver `electron/main.cjs:171`) intercepta la petición, delega en
 * `shell.openExternal` y responde `{ action: 'deny' }`, de modo que el enlace
 * termina en el navegador real del usuario, en una pestaña nueva. Las features
 * `noopener,noreferrer` impiden que la página abierta reciba `window.opener` y
 * la cabecera `Referer`.
 *
 * OJO: con `noopener` la especificación HTML obliga a devolver `null` aunque la
 * pestaña se abra, así que el retorno NO sirve para detectar un bloqueo de
 * popups. Por eso no se navega en la misma pestaña como alternativa: dentro de
 * Electron ese `location.href` acabaría en `will-navigate` y abriría el enlace
 * dos veces. Los botones son clics síncronos del usuario, nunca bloqueados.
 */
function openExternalUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Normaliza el `repository` declarado por un port a una URL absoluta.
 *
 * El catálogo lo guarda como `owner/repo`, pero `repoOf` (render.ts) ya lo pinta
 * como `github.com/owner/repo` y nada impide que un port declare la URL
 * completa. Se aceptan las tres formas; `null` si el port no publica uno.
 */
function repoUrl(value: string | null | undefined): string | null {
  const repo = (value ?? '').trim();
  if (!repo) return null;
  if (/^https?:\/\//i.test(repo)) return repo;
  if (/^(?:www\.)?github\.com\//i.test(repo)) return 'https://' + repo.replace(/^www\./i, '');
  return 'https://github.com/' + repo.replace(/^\/+/, '');
}

/** Abre el repositorio de un port; avisa si el proyecto no publica ninguno. */
function openGameRepo(game: Game | undefined): void {
  const url = repoUrl(game?.repo);
  if (!url) {
    toast('Este proyecto no tiene repositorio público');
    return;
  }
  openExternalUrl(url);
}

/** Resuelve el port implicado en una acción (`data-id` o la ficha abierta). */
function gameFromData(d: Record<string, string | undefined>): Game | undefined {
  if (d.id) return S.byId.get(d.id);
  return R.id ? S.byId.get(R.id) : undefined;
}

/**
 * Punto único de entrada de `data-act="openRepo"` y de la acción `ext`: usa el
 * repositorio de `data-repo` cuando el botón lo trae y, si no, el del port.
 */
function openRepoLink(d: Record<string, string | undefined>): void {
  if (d.repo) {
    const url = repoUrl(d.repo);
    if (!url) {
      toast('No se pudo abrir el repositorio');
      return;
    }
    openExternalUrl(url);
    return;
  }
  openGameRepo(gameFromData(d));
}

function primaryAction(id: string): void {
  const game = S.byId.get(id);
  if (!game) return;
  const st = statusOf(game);
  /* Instalar y actualizar son la misma operación real: el backend reescribe la
   * carpeta del port con la última versión publicada. */
  if (st.act === 'install') void installReal(id);
  else if (st.act === 'update') void installReal(id);
  else if (st.act === 'rom') openRom(id, false);
  else if (st.act === 'play') play(id);
  else if (st.act === 'detail') {
    go('game', id);
    toast('Compilar desde código: se mostraría la guía (simulado)');
  } else if (st.act === 'ext') {
    /* Proyecto externo: el CTA lleva al repositorio real en el navegador. */
    openGameRepo(game);
  }
}

/* -------------------------------------------------------------------------- */
/* Actualizador del launcher                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Repinta sólo lo que depende del actualizador: la insignia del menú lateral y
 * el bloque de Ajustes. Repintar la vista entera haría perder el foco del campo
 * de repositorio mientras el usuario escribe.
 */
function refreshLauncherUpdateUI(): void {
  const side = $('#side');
  if (side) side.innerHTML = renderSide();

  const box = document.getElementById('launcher-update-box');
  if (box) box.innerHTML = launcherUpdateBodyHTML();

  const button = document.querySelector<HTMLButtonElement>('[data-act="check-updates"]');
  if (button) {
    const checking = getLauncherUpdate().state === 'checking';
    button.disabled = checking;
    button.textContent = checking ? 'Comprobando…' : 'Comprobar actualizaciones';
  }
}

/**
 * Consulta el último release del repositorio configurado.
 *
 * `silent` se usa en el arranque: no muestra toasts y deja la insignia lista si
 * hay novedades. `checkForUpdates` nunca lanza, pero el `try` protege de
 * cualquier fallo del propio repintado.
 *
 * Importante: un resultado con `status !== 'ok'` es un FALLO de consulta (404 de
 * repo privado sin releases, rate limit, red caída), no «estás al día». Se
 * guarda igual en el estado para que Ajustes muestre el diagnóstico, pero el
 * toast lo dice sin ambigüedad.
 */
async function checkLauncherUpdates(silent = false): Promise<void> {
  if (getLauncherUpdate().state === 'checking') return;
  setLauncherUpdate({ state: 'checking' });
  refreshLauncherUpdateUI();
  try {
    const result = await checkForUpdates(getUpdateRepo());
    setLauncherUpdate({ state: 'done', result });
    if (!silent) {
      if (isCheckFailed(result)) toast('No se pudo comprobar la actualización');
      else if (result.hasUpdate) toast('Nueva versión disponible: v' + result.latestVersion);
      else toast('Tienes la última versión de PortsLauncher (v' + result.currentVersion + ')');
    }
  } catch (error) {
    setLauncherUpdate({
      state: 'error',
      message: 'No se pudo comprobar la actualización: ' + (error instanceof Error ? error.message : String(error)),
    });
    if (!silent) toast('No se pudo comprobar la actualización');
  } finally {
    refreshLauncherUpdateUI();
  }
}

/* -------------------------------------------------------------------------- */
/* Actualizador: descarga en streaming (HU-16)                                */
/* -------------------------------------------------------------------------- */

/** Evento del stream `text/event-stream` de `/api/launcher/self-update`. */
interface SelfUpdateEvent {
  type?: string;
  ok?: boolean;
  error?: string;
  phase?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
  mode?: string;
  path?: string;
  scheduled?: boolean;
  willRestart?: boolean;
  requiresElevation?: boolean;
  packageFormat?: string;
  installerTool?: string;
}

/**
 * `data:` de un bloque SSE → evento JSON.
 *
 * Un evento puede traer varias líneas `data:` (el formato las concatena con
 * `\n`), así que se unen antes de parsear. Devuelve `null` si el bloque no
 * contiene JSON válido, de modo que un comentario de keep-alive o una línea
 * corrupta no rompe la lectura.
 */
function parseSseEvent(block: string): SelfUpdateEvent | null {
  const payload = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as SelfUpdateEvent) : null;
  } catch {
    return null;
  }
}

/**
 * Consume el stream SSE completo, evento a evento.
 *
 * El texto se acumula y se parte por el separador de eventos (`\n\n`) porque un
 * chunk del socket puede cortar un `data: {...}` por la mitad. Al terminar se
 * procesa el resto del buffer (el último evento puede venir sin el `\n\n`
 * final).
 */
async function readSelfUpdateStream(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (event: SelfUpdateEvent) => void
): Promise<void> {
  if (!body || typeof body.getReader !== 'function') return;
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = parseSseEvent(block);
      if (event) onEvent(event);
    }
  }
  buffer += decoder.decode();
  const tail = parseSseEvent(buffer);
  if (tail) onEvent(tail);
}

/** Repinta SÓLO el bloque de Ajustes (el progreso llega en ráfaga). */
function refreshUpdateBox(): void {
  const box = document.getElementById('launcher-update-box');
  if (box) box.innerHTML = launcherUpdateBodyHTML();
}

/** Texto del desenlace, a partir de lo que respondió el backend. */
function updateDoneMessage(event: SelfUpdateEvent, version: string): string {
  if (event.ok === false) {
    return 'No se pudo aplicar la actualización: ' + (event.error || 'error del servidor.');
  }
  const target = event.packageFormat
    ? 'El paquete ' + event.packageFormat.toUpperCase()
    : 'La actualización';
  if (event.willRestart) {
    return event.requiresElevation
      ? `${target} está listo: confirma la contraseña de administrador cuando el sistema la pida; la app se reiniciará al cerrarse.`
      : `${target} se instalará al cerrarse la app, que se reiniciará con la versión v${version}.`;
  }
  if (event.path) return 'Actualización descargada en: ' + event.path;
  return event.message || 'Actualización v' + version + ' descargada.';
}

/**
 * Aplica la actualización del release descargándola en el proceso principal.
 *
 * Consume `/api/launcher/self-update` como `text/event-stream`: el backend
 * descarga el asset, informa del avance (`downloading` con bytes y porcentaje),
 * avisa al pasar a `installing` (pkcon/pkexec pedirá la contraseña de
 * administrador), y termina con `done`.
 *
 * Nunca se abre el navegador: ni `window.open` ni `location.href`. Si el backend
 * no está (build servida desde otro origen), el stream falla o responde un
 * error, la propia UI muestra el mensaje y el toast correspondiente.
 */
async function openUpdateDownload(): Promise<void> {
  const state = getLauncherUpdate();
  if (state.state !== 'done' || !state.result.downloadUrl) {
    toast('No hay descarga disponible para esta versión');
    return;
  }

  const result = state.result;
  const url = result.downloadUrl;
  const version = result.latestVersion;
  const assetName = result.assetName;

  /* Sin asset para este SO, `downloadUrl` apunta a la página HTML del release:
   * descargarla instalaría el HTML, así que aquí no se hace nada. */
  if (!assetName) {
    toast('El release v' + version + ' no publica un instalador para este sistema.');
    return;
  }
  if (getUpdateProgress()) {
    toast('Ya hay una actualización en curso');
    return;
  }

  setUpdateProgress({
    phase: 'downloading',
    percent: 0,
    transferred: 0,
    total: 0,
    message: 'Descargando actualización…',
    version,
  });
  refreshLauncherUpdateUI();

  /** Cierra el flujo: limpia la barra, repinta y avisa (sin abrir nada). */
  const stop = (message: string): void => {
    setUpdateProgress(null);
    refreshLauncherUpdateUI();
    toast(message);
  };

  let res: Response;
  try {
    res = await fetch('/api/launcher/self-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ downloadUrl: url, assetName, version, apply: true, stream: true }),
    });
  } catch (error) {
    /* Sin backend o red caída: se informa en la UI, no se abre el navegador. */
    const detail = error instanceof Error ? error.message : String(error);
    stop('No se pudo aplicar la actualización: ' + detail);
    return;
  }

  const contentType = String(res.headers?.get?.('content-type') || '');

  /* Respuesta sin stream: error HTTP en JSON (400/405/500) o backend antiguo. */
  if (!contentType.includes('text/event-stream')) {
    let data: SelfUpdateEvent = {};
    try {
      data = (await res.json()) as SelfUpdateEvent;
    } catch {
      data = {};
    }
    if (!res.ok || data.ok === false) {
      const detail = data.error || 'el servidor devolvió un error ' + res.status + '.';
      stop('No se pudo aplicar la actualización: ' + detail);
      return;
    }
    const message = updateDoneMessage(data, version);
    setLauncherUpdate({ state: 'done', result, notice: message });
    stop(message);
    return;
  }

  /* Eventos `done` vistos en el stream (se guardan en un array para que el
   * callback no dependa del análisis de flujo de TypeScript). */
  const doneEvents: SelfUpdateEvent[] = [];

  try {
    await readSelfUpdateStream(res.body, (event) => {
      if (event.type === 'progress') {
        const installing = event.phase === 'installing';
        setUpdateProgress({
          phase: installing ? 'installing' : 'downloading',
          percent: Number(event.percent) || 0,
          transferred: Number(event.transferred) || 0,
          total: Number(event.total) || 0,
          message: String(event.message || ''),
          version,
        });
        refreshUpdateBox();
        return;
      }
      if (event.type === 'done') {
        doneEvents.push(event);
        return;
      }
      if (event.type === 'error') {
        throw new Error(String(event.error || 'La actualización falló.'));
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stop('No se pudo aplicar la actualización: ' + detail);
    return;
  }

  if (doneEvents.length === 0) {
    stop('La actualización no devolvió confirmación del servidor.');
    return;
  }

  /* El aviso se queda en la tarjeta (no sólo en el toast): el usuario puede
   * volver a Ajustes y seguir viendo qué pasó. */
  const message = updateDoneMessage(doneEvents[0], version);
  setLauncherUpdate({ state: 'done', result, notice: message });
  stop(message);
}

/* -------------------------------------------------------------------------- */
/* Personalización de arte (modal estilo Steam)                               */
/* -------------------------------------------------------------------------- */

/** Imagen de la galería, normalizada desde `/api/steamgrid/...`. */
interface ArtGalleryEntry {
  id: number;
  url: string;
  thumb?: string;
  label?: string;
}

/** Secciones del modal, en el orden de las pestañas. */
const ART_KINDS: ArtKind[] = ['logo', 'hero', 'cover'];

/** Estado del modal «Ajustar arte» (se pierde al cerrarlo). */
let currentArtGame: Game | null = null;
let currentArtTab: ArtTab = 'logo';
let currentArtDraft: ArtDraft | null = null;
let currentArtGallery: Record<ArtKind, ArtGalleryEntry[]> = { logo: [], hero: [], cover: [] };
let currentArtStatus: Record<ArtKind, string> = { logo: '', hero: '', cover: '' };
let currentArtQueries: Record<ArtKind, string> = { logo: '', hero: '', cover: '' };

/** Endpoint de SteamGridDB para cada sección del modal. */
const STEAMGRID_ENDPOINTS: Record<ArtKind, (gameId: number) => string> = {
  logo: (gameId) => `logos/game/${gameId}?types=static`,
  hero: (gameId) => `heroes/game/${gameId}?types=static`,
  /* Carátula del soporte: grid horizontal 920x430 / 460x215 (etiquetas). */
  cover: (gameId) => `grids/game/${gameId}?dimensions=920x430,460x215&types=static`,
};

/** Contenedor del modal (`#modal-root`, creado en `index.html`). */
function artRoot(): HTMLElement | null {
  return $('#modal-root');
}

/** ¿La clave recibida es una sección válida del modal? */
function isArtKind(value: unknown): value is ArtKind {
  return typeof value === 'string' && (ART_KINDS as string[]).includes(value);
}

/** Repinta el modal con el borrador y la galería actuales. */
function renderArtModal(): void {
  const root = artRoot();
  const game = currentArtGame;
  const draft = currentArtDraft;
  if (!root) return;
  if (!game || !draft) {
    root.innerHTML = '';
    document.body.style.overflow = '';
    return;
  }
  root.innerHTML = artModalHTML(game, currentArtTab, {
    draft,
    gallery: currentArtGallery,
    status: currentArtStatus,
    queries: currentArtQueries,
    /* ¿Hay clave en los ajustes o en el servidor? Si no, el modal avisa. */
    apiKeyConfigured: steamgridConfigured(S.settings),
  });
  document.body.style.overflow = 'hidden';
}

/** Abre el modal para un juego y deja el borrador listo para editar. */
function openArtModal(game: Game): void {
  currentArtGame = game;
  currentArtTab = 'logo';
  currentArtDraft = artDraftOf(game);
  /* El buscador arranca con el mejor título comercial conocido (el nombre
   * técnico del port no existe en SteamGridDB); el usuario puede afinarlo. */
  const title = bestGameTitle(game);
  for (const kind of ART_KINDS) {
    currentArtGallery[kind] = [];
    currentArtStatus[kind] = '';
    currentArtQueries[kind] = title;
  }
  renderArtModal();
  /* Con clave configurada, la galería de logos aparece sin pulsar «Buscar». */
  if (steamgridConfigured(S.settings)) void searchArt('logo');
}

/** Cierra el modal, limpia el estado y libera el scroll de la página. */
function closeArtModal(): void {
  const root = artRoot();
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
  currentArtGame = null;
  currentArtDraft = null;
  currentArtTab = 'logo';
  for (const kind of ART_KINDS) {
    currentArtGallery[kind] = [];
    currentArtStatus[kind] = '';
    currentArtQueries[kind] = '';
  }
}

/** Asigna una imagen al campo del borrador que toca según la sección. */
function setDraftUrl(kind: ArtKind, url: string | null): void {
  if (!currentArtDraft) return;
  if (kind === 'logo') currentArtDraft.logoUrl = url;
  else if (kind === 'hero') currentArtDraft.heroUrl = url;
  else currentArtDraft.coverUrl = url;
}

/** Ajusta el tamaño del logo y refresca la previsualización sin repintar. */
function applyLogoScale(raw: number): void {
  if (!currentArtDraft) return;
  const scale = clampLogoScale(raw);
  currentArtDraft.logoScale = scale;
  const box = document.getElementById('art-logo-box');
  if (box) box.style.height = `${scale}px`;
  const img = document.getElementById('art-logo-img');
  if (img) img.style.height = `${scale}px`;
  const label = document.getElementById('art-scale-val');
  if (label) label.textContent = `${scale} px`;
}

/** Ajusta el zoom del fondo de cabecera y refresca la previsualización sin repintar. */
function applyHeroScale(raw: number): void {
  if (!currentArtDraft) return;
  const scale = clampHeroScale(raw);
  currentArtDraft.heroScale = scale;
  const img = document.getElementById('art-hero-preview-img');
  if (img) img.style.transform = `scale(${scale / 100})`;
  const label = document.getElementById('art-hero-scale-val');
  if (label) label.textContent = `${scale}%`;
}

/**
 * Repinta el soporte de la previsualización con el zoom y el desplazamiento
 * vigentes del borrador.
 *
 * Se sustituye solo el interior de `#art-cover-preview-box` (el soporte ya
 * montado) y no el modal entero: así el arrastre de los sliders no pierde el
 * foco ni el `value` que el navegador mantiene mientras se mueve el pulgar.
 */
function refreshCoverPreview(): void {
  if (!currentArtGame || !currentArtDraft) return;
  const box = document.getElementById('art-cover-preview-box');
  if (!box) return;
  const style = styleFor(currentArtGame, S.settings) ?? S.settings.mediaDef ?? 'n64';
  const coverUrl = currentArtDraft.coverUrl ?? currentArtGame.coverHorizontal ?? currentArtGame.cover ?? null;
  const previewGame: Game = {
    ...currentArtGame,
    coverHorizontal: coverUrl,
    coverSquare: coverUrl,
    coverVertical: coverUrl,
    cover: coverUrl,
    coverScale: clampCoverScale(currentArtDraft.coverScale),
    coverY: clampCoverOffset(currentArtDraft.coverY),
  };
  box.innerHTML = mediaHTML(previewGame, style, false);
}

/** Ajusta el zoom de la carátula dentro del soporte (80–200 %). */
function applyCoverScale(raw: number): void {
  if (!currentArtDraft) return;
  const scale = clampCoverScale(raw);
  currentArtDraft.coverScale = scale;
  const label = document.getElementById('art-cover-scale-val');
  if (label) label.textContent = `${scale}%`;
  refreshCoverPreview();
}

/** Ajusta el desplazamiento vertical de la carátula dentro del soporte. */
function applyCoverY(raw: number): void {
  if (!currentArtDraft) return;
  const y = clampCoverOffset(raw);
  currentArtDraft.coverY = y;
  const label = document.getElementById('art-cover-y-val');
  if (label) label.textContent = `${y > 0 ? `+${y}` : y}%`;
  refreshCoverPreview();
}

/** Texto legible del error que devuelve SteamGridDB (o el propio proxy). */
function steamgridErrorDetail(payload: unknown): string {
  const body = payload as { error?: unknown; errors?: unknown } | null;
  const parts: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  };

  push(body?.error);
  const errors = body?.errors;
  if (Array.isArray(errors)) errors.forEach(push);
  else if (errors && typeof errors === 'object') {
    for (const value of Object.values(errors as Record<string, unknown>)) push(value);
  } else push(errors);

  return parts.join(' · ');
}

/**
 * GET al proxy de desarrollo; devuelve el JSON ya parseado.
 *
 * En error se lee el cuerpo de la respuesta para arrastrar el mensaje real de
 * la API (`error`/`errors`): así el modal «Ajustar arte» y la sincronización
 * automática distinguen clave inválida (401), rate-limit (429) o falta de
 * clave (503) en lugar de mostrar un status escueto.
 */
async function steamgridJSON(endpoint: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  /* Clave personal del usuario (si existe) → el proxy la reenvía a la API. */
  if (S.settings.steamgridApiKey) {
    headers['x-steamgrid-key'] = S.settings.steamgridApiKey.trim();
  }
  const response = await fetch(`/api/steamgrid/${endpoint}`, { headers });
  if (!response.ok) {
    let detail = '';
    try {
      detail = steamgridErrorDetail(await response.json());
    } catch {
      /* Cuerpo no JSON (proxy caído, HTML del dev server): sin detalle. */
    }
    throw new Error(`SteamGridDB HTTP ${response.status}: ${detail || response.statusText}`);
  }
  return response.json();
}

/** `search/autocomplete/<q>` → primer `game_id` de SteamGridDB. */
async function steamgridAutocomplete(query: string): Promise<number | null> {
  const payload = (await steamgridJSON(
    `search/autocomplete/${encodeURIComponent(query)}`
  )) as { data?: Array<{ id?: number }> } | null;
  const matches: Array<{ id?: number }> =
    payload && Array.isArray(payload.data) ? payload.data : [];
  const first = matches[0];
  return first && typeof first.id === 'number' ? first.id : null;
}

/** Alias de la ficha que se prueban como máximo tras fallar la query inicial. */
const STEAMGRID_ALIAS_LIMIT = 4;

/** Contenido entre paréntesis o corchetes de un nombre de port («smw (… )»). */
const PARENTHESIS_RE = /[(\[]([^)\]]{2,})[)\]]/;

/** Clave de comparación de títulos: sin mayúsculas, acentos ni espacios extra. */
function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** ¿El nombre parece un título comercial (no el nombre técnico del port)? */
function isCleanTitle(value: string): boolean {
  return value.length > 1 && value.length <= 80 && !/[()\[\]{}]/.test(value);
}

/**
 * Variantes de búsqueda de un título, de la más fiable a la más genérica.
 *
 * El catálogo identifica los ports con su nombre técnico («smw (Super Mario
 * World)», «Gen1Recomp (Pokemon Red, Blue, & Yellow)»), que SteamGridDB
 * desconoce: solo entiende títulos comerciales. Por eso, si la query inicial no
 * devuelve resultados, se prueban el contenido del paréntesis, los alias de la
 * ficha y, por último, el título base sin subtítulos.
 */
function steamgridQueryCandidates(query: string, game?: Game | null): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return;
    if (out.some((seen) => seen.toLowerCase() === text.toLowerCase())) return;
    out.push(text);
  };

  push(query);

  /* a) «Zelda 3 Launcher (Zelda: A Link To The Past)» → lo de dentro. */
  const inner = query.match(PARENTHESIS_RE);
  if (inner) push(inner[1]);

  /* b) Alias de la ficha: `gameNames` son títulos comerciales y `searchAliases`
   * añade abreviaturas. Se descartan los nombres técnicos con paréntesis. */
  const port = game?.port;
  const aliases = [
    ...(Array.isArray(port?.gameNames) ? port.gameNames : []),
    ...(Array.isArray(port?.searchAliases) ? port.searchAliases : []),
  ].filter((value): value is string => typeof value === 'string' && isCleanTitle(value.trim()));

  for (const alias of aliases.slice(0, STEAMGRID_ALIAS_LIMIT)) push(alias);

  /* c) Último recurso: título sin subtítulos, marcas ni paréntesis. */
  if (game) push(baseGameTitle(game));

  return out;
}

/**
 * Resuelve el `game_id` de SteamGridDB probando variantes del título.
 *
 * Los fallos de la API (401/429/503) se propagan a propósito: son condiciones
 * globales, no del título, y quien llama decide qué hacer (el modal explica el
 * motivo; la sincronización automática reintenta a los 10 s con un 429).
 */
async function steamgridGameId(query: string, game?: Game | null): Promise<number | null> {
  for (const candidate of steamgridQueryCandidates(query, game)) {
    const id = await steamgridAutocomplete(candidate);
    if (id) return id;
  }
  return null;
}

/** Imagen tal y como la devuelve la API v2 de SteamGridDB. */
interface SteamGridAsset {
  id?: number;
  url?: string;
  thumb?: string;
  style?: string;
}

/** Mensaje del modal según el fallo de SteamGridDB (clave, límite, red…). */
function artSearchErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b/.test(message)) {
    return 'Clave de SteamGridDB inválida (401). Revísala en Ajustes → Integraciones y Arte.';
  }
  if (/\b429\b/.test(message)) {
    return 'SteamGridDB ha limitado las peticiones (429). Espera unos segundos y vuelve a buscar.';
  }
  if (/\b503\b/.test(message)) {
    return 'Falta la clave de SteamGridDB (503). Pégala en Ajustes → Integraciones y Arte.';
  }
  return `No se pudo consultar SteamGridDB: ${message}`;
}

/** Busca imágenes del tipo activo y las guarda como galería. */
async function searchArt(kind: ArtKind): Promise<void> {
  const query = (currentArtQueries[kind] ?? '').trim();
  currentArtGallery[kind] = [];
  if (!query) {
    currentArtStatus[kind] = 'Escribe el título del juego para buscar.';
    renderArtModal();
    return;
  }

  currentArtStatus[kind] = 'Buscando en SteamGridDB…';
  renderArtModal();

  try {
    /* `game_id` explícito → nos ahorramos el autocompletado. El juego abierto
     * aporta alias y paréntesis con los que reintentar si el título técnico del
     * port no existe en SteamGridDB. */
    const gameId = /^\d+$/.test(query)
      ? Number(query)
      : await steamgridGameId(query, currentArtGame);
    if (!gameId) {
      currentArtStatus[kind] = `Sin resultados para «${query}» en SteamGridDB.`;
      renderArtModal();
      return;
    }

    const payload = (await steamgridJSON(STEAMGRID_ENDPOINTS[kind](gameId))) as {
      data?: SteamGridAsset[];
    } | null;
    const raw: SteamGridAsset[] = payload && Array.isArray(payload.data) ? payload.data : [];

    currentArtGallery[kind] = raw
      .filter((item) => typeof item?.url === 'string' && !!item.url)
      .slice(0, 36)
      .map((item, index) => {
        const id = typeof item.id === 'number' ? item.id : index + 1;
        return {
          id,
          url: String(item.url),
          thumb: typeof item.thumb === 'string' ? item.thumb : undefined,
          label: item.style ? `#${id} · ${item.style}` : `#${id}`,
        };
      });

    currentArtStatus[kind] = currentArtGallery[kind].length
      ? `${currentArtGallery[kind].length} imágenes de SteamGridDB (juego #${gameId}).`
      : 'SteamGridDB no tiene imágenes de este tipo para ese juego.';
  } catch (error) {
    currentArtStatus[kind] = artSearchErrorMessage(error);
    console.warn('[PortsLauncher] SteamGridDB:', error);
  }

  renderArtModal();
}

/** Aplica una imagen elegida de la galería al borrador. */
function pickArt(kind: ArtKind, url: string | undefined): void {
  if (!currentArtDraft || !url) return;
  setDraftUrl(kind, url);
  currentArtStatus[kind] = 'Imagen elegida. Pulsa «Guardar y aplicar».';
  renderArtModal();
}

/** Lee un archivo local como DataURL y lo deja en el borrador. */
function applyArtFile(kind: ArtKind, file: File | null | undefined): void {
  if (!file || !currentArtDraft) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : null;
    if (!dataUrl || !currentArtDraft) return;
    setDraftUrl(kind, dataUrl);
    currentArtStatus[kind] = `Archivo «${file.name}» cargado.`;
    renderArtModal();
  };
  reader.onerror = () => {
    currentArtStatus[kind] = 'No se pudo leer el archivo elegido.';
    renderArtModal();
  };
  reader.readAsDataURL(file);
}

/**
 * Refresca la ficha en memoria con el arte recién persistido.
 *
 * Reutiliza `toGame` (la única proyección `PortItem → Game`) y conserva el
 * estado efímero de la sesión: instalaciones simuladas, ROM validada y
 * «jugado». El objeto se muta en sitio para no romper `S.byId` ni `S.last`.
 */
function refreshGameArt(game: Game): void {
  const rebuilt = toGame(game.port, libraryService.getState().games, S.settings);
  Object.assign(game, rebuilt, {
    inst: game.inst,
    romOk: game.romOk,
    v: game.v,
    pin: game.pin,
    auto: game.auto,
    dir: game.dir,
    romPath: game.romPath,
    romMode: game.romMode,
    args: game.args,
    runner: game.runner,
    exe: game.exe,
    played: game.played,
  });
}

/** Guarda el borrador, cierra el modal y repinta la vista actual. */
function saveArt(): void {
  const game = currentArtGame;
  const draft = currentArtDraft;
  if (!game || !draft) return;
  const stored = libraryService.setCustomArt(game.id, artPatchOf(draft));
  refreshGameArt(game);
  closeArtModal();
  draw();
  toast(stored ? `Arte de ${game.t} actualizado` : `Arte de ${game.t} sin cambios`);
}

/** Borra el arte personalizado del juego y vuelve al del índice. */
function resetArt(): void {
  const game = currentArtGame;
  if (!game) return;
  libraryService.setCustomArt(game.id, null);
  refreshGameArt(game);
  closeArtModal();
  draw();
  toast(`Arte de ${game.t} restaurado al del índice`);
}

/** Acción compartida por `pick-art` y `art-pick` (galería). */
function pickArtAction(d: Record<string, string | undefined>): void {
  const kind = d.k;
  if (!isArtKind(kind)) return;
  pickArt(kind, d.url);
}

/* -------------------------------------------------------------------------- */
/* Asistente de bienvenida (wizard)                                           */
/* -------------------------------------------------------------------------- */

/** Paso activo del asistente (1–3). */
let currentWizardStep = 1;

/** ¿El asistente está abierto ahora mismo? (lo usa la tecla Escape). */
let wizardOpen = false;

/** Pinta el paso activo del asistente en `#modal-root`. */
function renderWizardModal(): void {
  const root = artRoot();
  if (!root) return;
  root.innerHTML = wizardModalHTML(S.settings, currentWizardStep);
  document.body.style.overflow = 'hidden';
  wizardOpen = true;
}

/** Abre el asistente desde el principio. */
function openWizard(): void {
  currentWizardStep = 1;
  renderWizardModal();
}

/** Cierra el asistente y persiste `onboardingDone` (no vuelve a aparecer). */
function finishWizard(): void {
  S.settings.onboardingDone = true;
  saveState();
  /* La clave que se haya escrito en el paso 2 del asistente se guarda también
   * en `~/.steamgrid_credentials.env` (sin esperar al rebote del teclado). */
  scheduleSaveSteamgridKey(S.settings.steamgridApiKey ?? '', true);
  const root = $('#modal-root');
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
  wizardOpen = false;
  currentWizardStep = 1;
  draw();
}

/* -------------------------------------------------------------------------- */
/* Guía de desarrollo de plugins (modal local)                                */
/* -------------------------------------------------------------------------- */

/** ¿La guía de plugins está abierta ahora mismo? (lo usa la tecla Escape). */
let pluginsDocOpen = false;

/**
 * Monta la guía de plugins en `#modal-root`.
 *
 * La guía es HTML puro (`pluginsDocModalHTML`) y no depende de la red: se abre
 * sin conexión desde la barra de Addons o desde su estado vacío.
 */
function openPluginsDoc(): void {
  const root = artRoot();
  if (!root) return;
  root.innerHTML = pluginsDocModalHTML();
  document.body.style.overflow = 'hidden';
  pluginsDocOpen = true;
}

/** Cierra la guía y devuelve el scroll al documento. */
function closePluginsDoc(): void {
  const root = artRoot();
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
  pluginsDocOpen = false;
}

/* -------------------------------------------------------------------------- */
/* Plugins reales en disco                                                    */
/* -------------------------------------------------------------------------- */

/** Forma cruda de un plugin tal y como lo entrega `GET /api/plugins`. */
interface DiskPlugin {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  author?: unknown;
  type?: unknown;
  icon?: unknown;
  enabled?: unknown;
  dir?: unknown;
}

/** Cadena recortada y no vacía, o `null`. */
function pluginText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Ruta real de la carpeta de plugins (`~/PortsLauncher/plugins`).
 *
 * La resuelve el backend (`GET /api/plugins/dir`): el renderer no debe adivinar
 * rutas del sistema. Se cachea porque no cambia durante la sesión.
 */
let pluginsDirPath: string | null = null;

async function resolvePluginsDir(): Promise<string | null> {
  if (pluginsDirPath) return pluginsDirPath;
  try {
    const res = await fetch('/api/plugins/dir', { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; path?: string } | null;
    const dir = pluginText(data?.path);
    if (data?.ok === false || !dir) return null;
    pluginsDirPath = dir;
    return dir;
  } catch {
    return null;
  }
}

/** Abre en el explorador del sistema la carpeta real donde viven los plugins. */
async function openPluginsFolder(): Promise<void> {
  const dir = await resolvePluginsDir();
  if (!dir) {
    toast('No se pudo localizar la carpeta de plugins');
    return;
  }
  await openPathInSystem(dir, 'la carpeta de plugins');
}

/**
 * Sincroniza los plugins reales de disco con `libraryService`.
 *
 * Es la única vía por la que aparecen addons en la UI: lee `GET /api/plugins`
 * (que escanea los `plugin.json` de `~/PortsLauncher/plugins`) y publica el
 * resultado en la biblioteca local, conservando el `enabled` que el usuario
 * conmutó. Si el backend no responde se mantiene la lista guardada: nunca se
 * inventan plugins.
 */
async function syncPluginsFromDisk(): Promise<void> {
  let payload: { ok?: boolean; path?: string; plugins?: DiskPlugin[] } | null = null;
  try {
    const res = await fetch('/api/plugins', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    payload = (await res.json()) as { ok?: boolean; path?: string; plugins?: DiskPlugin[] } | null;
  } catch {
    /* Servidor local caído (o build sin backend): se respeta lo ya guardado. */
    return;
  }
  if (!payload || payload.ok === false || !Array.isArray(payload.plugins)) return;

  const reportedDir = pluginText(payload.path);
  if (reportedDir) pluginsDirPath = reportedDir;

  const installedAt = Date.now();
  const plugins: Addon[] = [];
  for (const raw of payload.plugins) {
    const id = pluginText(raw?.id);
    const name = pluginText(raw?.name);
    if (!id || !name) continue;
    const addon: Addon = {
      id,
      name,
      version: pluginText(raw?.version) ?? '0.0.0',
      description: pluginText(raw?.description) ?? '',
      type: pluginText(raw?.type) ?? 'plugin',
      enabled: raw?.enabled !== false,
      installedAt,
    };
    const author = pluginText(raw?.author);
    if (author) addon.author = author;
    const icon = pluginText(raw?.icon);
    if (icon) addon.icon = icon;
    const dir = pluginText(raw?.dir);
    if (dir) addon.dir = dir;
    plugins.push(addon);
  }

  const before = JSON.stringify(S.addons ?? []);
  const addons = libraryService.syncAddons(plugins);
  S.addons = addons;
  /* Sólo se repinta si la lista cambió: en un arranque estable no hay parpadeo. */
  if (JSON.stringify(addons) !== before) draw();
}

/* -------------------------------------------------------------------------- */
/* Biblioteca persistida en disco (`~/PortsLauncher/ports.json`)              */
/* -------------------------------------------------------------------------- */

/** Respuesta de `GET /api/library`. */
interface LibraryResponse {
  ok?: boolean;
  path?: string;
  exists?: boolean;
  library?: unknown;
}

/**
 * Hidrata la biblioteca desde `~/PortsLauncher/ports.json`.
 *
 * El fichero en disco es la fuente de verdad: si existe y es válido, sustituye
 * al estado guardado en `localStorage` (que queda como caché para los arranques
 * sin backend). Si no existe, o el backend no responde, se conserva lo local.
 *
 * En ambos casos se activa la persistencia en disco a partir de ese momento, de
 * modo que cualquier escritura posterior (instalar, ROM, arte, ajustes, addons)
 * se refleja en `ports.json`. Sin fichero previo, el estado actual se vuelca de
 * inmediato: el fichero existe desde el primer arranque.
 *
 * Nunca lanza: un backend caído no debe impedir que el launcher arranque.
 *
 * @returns `true` si la biblioteca se hidrató desde el fichero.
 */
async function hydrateLibraryFromDisk(): Promise<boolean> {
  let payload: LibraryResponse | null = null;
  try {
    const res = await fetch('/api/library', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) payload = (await res.json()) as LibraryResponse | null;
  } catch {
    /* Servidor local caído (o build servido sin la API): se sigue con la caché. */
  }

  /* Se aceptan las dos formas: `{ library }` y el documento plano. */
  const raw =
    payload && payload.ok !== false
      ? payload.library !== undefined
        ? payload.library
        : payload
      : null;
  const fromDisk = raw ? libraryService.hydrateFromDisk(raw) : false;

  libraryService.enableDiskSync();
  if (!fromDisk) libraryService.pushToDisk();
  return fromDisk;
}

/**
 * Espera antes de guardar la clave en disco mientras se escribe.
 *
 * El campo se edita tecla a tecla: sin este retardo cada pulsación escribiría
 * `~/.steamgrid_credentials.env`.
 */
const STEAMGRID_KEY_SAVE_DEBOUNCE_MS = 700;

/** `setTimeout` del guardado pendiente de la clave, o `null`. */
let steamgridKeySaveTimer: number | null = null;

/**
 * `POST /api/steamgrid/__save-key` — guarda la clave en
 * `~/.steamgrid_credentials.env`.
 *
 * Es un extra sobre `ports.json`: la clave viaja igual en los ajustes de la
 * biblioteca, pero el fichero de credenciales es lo que lee el proxy cuando el
 * frontend no manda la cabecera `x-steamgrid-key`, y así sobrevive incluso si
 * se restablece la biblioteca. Nunca lanza: en la build estática (sin backend)
 * el ajuste se queda solo en `ports.json`.
 */
async function persistSteamgridKey(key: string): Promise<void> {
  try {
    const res = await fetch('/api/steamgrid/__save-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const message =
        detail && typeof detail === 'object' && typeof (detail as { error?: unknown }).error === 'string'
          ? (detail as { error: string }).error
          : `HTTP ${res.status}`;
      console.warn('[PortsLauncher] No se pudo guardar la clave de SteamGridDB:', message);
    }
  } catch (error) {
    /* Sin backend local: la clave ya está en los ajustes de `ports.json`. */
    console.warn('[PortsLauncher] No se pudo guardar la clave de SteamGridDB:', error);
  }
}

/**
 * Programa el guardado de la clave.
 *
 * @param immediate `true` en acciones explícitas (terminar el asistente,
 *                  limpiar la clave) para no esperar al rebote del teclado.
 */
function scheduleSaveSteamgridKey(key: string, immediate = false): void {
  if (steamgridKeySaveTimer !== null) {
    clearTimeout(steamgridKeySaveTimer);
    steamgridKeySaveTimer = null;
  }
  const value = key.trim();
  if (immediate) {
    void persistSteamgridKey(value);
    return;
  }
  steamgridKeySaveTimer = window.setTimeout(() => {
    steamgridKeySaveTimer = null;
    void persistSteamgridKey(value);
  }, STEAMGRID_KEY_SAVE_DEBOUNCE_MS);
}

/**
 * Sonda `/api/steamgrid/__status`: ¿tiene clave el servidor de desarrollo?
 *
 * No llama a la API de SteamGridDB; solo informa de si existe
 * `STEAMGRID_API_KEY` en el entorno del proceso o en
 * `~/.steamgrid_credentials.env`, y devuelve la clave (`key`) para que se pueda
 * autodetectar: si el usuario aún no tiene ninguna en los ajustes, se
 * prerrellena y se persiste, de modo que deja de pedírsela en cada arranque.
 * Se lanza sin bloquear el arranque.
 */
async function probeSteamgridStatus(): Promise<void> {
  try {
    const response = await fetch('/api/steamgrid/__status', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { configured?: boolean; key?: string } | null;
    setSteamgridServerReady(!!payload?.configured);

    /* Autodetección: solo si el usuario no tiene ya una clave propia. */
    const detected = typeof payload?.key === 'string' ? payload.key.trim() : '';
    if (detected && !(S.settings.steamgridApiKey ?? '').trim()) {
      S.settings.steamgridApiKey = detected;
      saveState();
    }

    /* La sección de Ajustes pinta el estado: repintar si está a la vista. */
    if (R.name === 'settings') renderSettings();
  } catch {
    /* Sin servidor de desarrollo (build estático): se queda en `false`. */
  }
}

/** Prueba real de conexión con SteamGridDB (botón de Ajustes). */
async function testSteamgrid(): Promise<void> {
  /* Sin clave propia no hay nada que probar: el proxy no tiene credenciales
   * del usuario y la petición sólo podría fallar. */
  const userKey = (S.settings.steamgridApiKey ?? '').trim();
  if (!userKey) {
    toast('Ingresa tu clave de SteamGridDB antes de probar la conexión');
    return;
  }

  try {
    const payload = (await steamgridJSON('search/autocomplete/Mario')) as {
      data?: unknown[];
    } | null;
    const data = payload && Array.isArray(payload.data) ? payload.data : [];
    if (data.length > 0) {
      toast('✓ Conexión con SteamGridDB exitosa');
      setSteamgridServerReady(true);
      renderSettings();
      return;
    }
  } catch (error) {
    console.warn('[PortsLauncher] SteamGridDB:', error);
  }
  toast('✗ Clave inválida o error al conectar con SteamGridDB');
}

/* -------------------------------------------------------------------------- */
/* Sincronización automática del catálogo                                     */
/* -------------------------------------------------------------------------- */

/**
 * Descarga masiva de arte en segundo plano (interruptor de Ajustes).
 *
 * Recorre `S.games` saltándose los juegos que ya tienen carátula propia en
 * `customArt`, y por cada pendiente consulta el autocompletado de SteamGridDB y
 * después sus endpoints de grid (carátula), hero (fondo) y logo. El resultado
 * se guarda con `libraryService.setCustomArt`, así que sobrevive a recargas y
 * convive con el arte elegido a mano (que nunca se sobrescribe).
 *
 * El recorrido es pausado a propósito: un juego cada 1,5 s y, si la API
 * responde 429, una espera de 10 s antes de reintentar el mismo juego.
 */

/** Intervalo entre juegos (protección de rate-limit de la API). */
const AUTO_SYNC_INTERVAL_MS = 1500;

/** Espera antes de reintentar el mismo juego cuando la API responde 429. */
const AUTO_SYNC_RATE_LIMIT_MS = 10_000;

/** ¿Hay un recorrido en curso? Evita dos bucles simultáneos. */
let autoSyncRunning = false;

/** `setTimeout` del próximo juego, o `null` si no hay nada programado. */
let autoSyncTimer: number | null = null;

/** Progreso que pinta `updateSyncProgressUI()` en `#steamgrid-sync-box`. */
let autoSyncProgress = { completed: 0, total: 0, current: '', status: '' };

/**
 * Clave de `localStorage` donde se recuerdan los juegos ya intentados.
 *
 * El registro vivía solo en memoria: al reiniciar el launcher se perdía y el
 * motor volvía a empezar por el primer juego del catálogo, repitiendo
 * indefinidamente los mismos títulos (incluidos los que SteamGridDB no
 * conoce). Persistirlo hace que el progreso de descarga de arte sobreviva a
 * cada arranque.
 */
const AUTO_SYNC_TRIED_STORAGE_KEY = 'portshub-autosync-tried';

/** Tope de ids guardados (evita crecer sin límite con catálogos enormes). */
const AUTO_SYNC_TRIED_LIMIT = 5000;

/**
 * Lee los juegos ya intentados de `localStorage`.
 *
 * Acepta tanto un array de `pid` como `{ ids: [...] }`; cualquier entrada que
 * no sea una cadena con contenido se descarta (un `localStorage` manipulado no
 * debe romper el motor).
 */
function loadAutoSyncTried(): Set<string> {
  const out = new Set<string>();
  try {
    const raw = localStorage.getItem(AUTO_SYNC_TRIED_STORAGE_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { ids?: unknown } | null)?.ids)
        ? ((parsed as { ids: unknown[] }).ids as unknown[])
        : [];
    for (const value of list) {
      if (typeof value === 'string' && value.trim()) out.add(value);
    }
  } catch {
    /* Sin almacenamiento o JSON corrupto: se arranca con el registro vacío. */
  }
  return out;
}

/**
 * Juegos ya intentados (con o sin arte encontrado).
 *
 * Sin este registro, un juego que SteamGridDB no conoce se reintentaría para
 * siempre y el bucle nunca avanzaría al siguiente. Se siembra de disco para
 * que reiniciar el launcher no reinicie la descarga desde cero.
 */
const autoSyncTried = loadAutoSyncTried();

/** Volca el registro en `localStorage` (recortando por la cola si es enorme). */
function persistAutoSyncTried(): void {
  try {
    const ids = [...autoSyncTried];
    const trimmed =
      ids.length > AUTO_SYNC_TRIED_LIMIT ? ids.slice(ids.length - AUTO_SYNC_TRIED_LIMIT) : ids;
    localStorage.setItem(AUTO_SYNC_TRIED_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* Cuota llena: el registro sigue en memoria durante esta sesión. */
  }
}

/** Marca un juego como intentado y lo persiste. */
function markAutoSyncTried(pid: string): void {
  autoSyncTried.add(pid);
  persistAutoSyncTried();
}

/** Retira un juego del registro (reintento tras un 429) y lo persiste. */
function unmarkAutoSyncTried(pid: string): void {
  autoSyncTried.delete(pid);
  persistAutoSyncTried();
}

/** Título con el que buscar en SteamGridDB (sin subtítulos ni paréntesis). */
function baseGameTitle(game: Game): string {
  const raw = `${game.port?.name ?? ''}`.trim() || game.t;
  const head = raw.split(/[:–—|]/)[0] || raw;
  return head.replace(/\s*[([].*$/, '').replace(/[™®©]/g, '').trim() || raw;
}

/**
 * Mejor título conocido para buscar arte en SteamGridDB.
 *
 * Prioriza un título comercial sobre el nombre técnico del port, por este orden:
 *   1. Un `gameNames` limpio («The Legend of Zelda: Majora's Mask»), siempre que
 *      no repita el nombre técnico del port ni lleve marcas de port entre
 *      paréntesis («Auto-TMC (Zelda: The Minish Cap)»).
 *   2. El contenido del paréntesis del nombre del port, que en el catálogo casi
 *      siempre es el título real del juego.
 *   3. `baseGameTitle()`: nombre técnico sin subtítulo, paréntesis ni marcas.
 */
function bestGameTitle(game: Game): string {
  const port = game.port;
  const technical = `${port?.name ?? ''}`.trim() || `${game.t ?? ''}`.trim();
  const technicalKey = normalizeTitle(technical);

  const commercial = (Array.isArray(port?.gameNames) ? port.gameNames : [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .find((value) => isCleanTitle(value) && normalizeTitle(value) !== technicalKey);
  if (commercial) return commercial;

  /* «smw (Super Mario World)» → «Super Mario World». */
  for (const raw of [technical, `${game.t ?? ''}`.trim()]) {
    const found = raw.match(PARENTHESIS_RE)?.[1]?.trim() ?? '';
    if (found.length > 1) return found;
  }

  return baseGameTitle(game);
}

/**
 * Pinta el estado del motor en Ajustes → Integraciones.
 *
 * Es un no-op cuando el contenedor no está en el DOM (el usuario está en otra
 * pantalla), de modo que se puede llamar sin condiciones desde el bucle.
 */
function updateSyncProgressUI(): void {
  const box = document.getElementById('steamgrid-sync-box');
  if (!box) return;

  const { completed, total, current, status } = autoSyncProgress;
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : 0;
  const enabled = !!S.settings.steamgridAutoSync;
  const flag = enabled
    ? `● Sincronizando en segundo plano: ${esc(current || 'preparando…')}...`
    : '○ Sincronización automática desactivada.';

  box.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
    `<span class="muted" style="font-size:12.5px">Sincronizados: ${completed} / ${total} juegos</span>` +
    `<span class="mono muted" style="font-size:12px">${pct}%</span>` +
    '</div>' +
    '<div style="height:6px;border-radius:999px;background:var(--line);overflow:hidden">' +
    `<i style="display:block;height:100%;width:${pct}%;background:var(--accent2);transition:width .3s"></i>` +
    '</div>' +
    (status ? `<div class="muted" style="font-size:12px">${esc(status)}</div>` : '') +
    `<div style="font-size:12px;color:${enabled ? 'var(--accent2)' : 'var(--muted)'}">${flag}</div>`;
}

/** Detiene el recorrido y cancela la siguiente vuelta programada. */
function stopAutoSync(): void {
  autoSyncRunning = false;
  if (autoSyncTimer !== null) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
  }
}

/** Programa la siguiente vuelta del bucle (`delay` ms). */
function scheduleAutoSync(delay: number): void {
  if (autoSyncTimer !== null) clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => {
    autoSyncTimer = null;
    void runAutoSyncLoop();
  }, delay);
}

/**
 * Arranca (o reanuda) un recorrido del catálogo.
 *
 * **No** vacía `autoSyncTried`: el registro vive en `localStorage` y es lo que
 * hace que apagar y encender el launcher (o el interruptor) no vuelva a
 * descargar el mismo arte ni reintente en bucle los juegos que SteamGridDB no
 * reconoce. El progreso mostrado se deriva del estado real (arte ya guardado +
 * ids ya intentados), no de un contador que empezaba en 0.
 */
function startAutoSync(): void {
  /* Ya hay un recorrido vivo (p. ej. el del arranque): no se duplica. */
  if (autoSyncRunning) return;
  stopAutoSync();
  autoSyncRunning = true;
  const done = S.games.filter(
    (game) => !!libraryService.getCustomArt(game.id)?.coverUrl || autoSyncTried.has(game.id)
  ).length;
  autoSyncProgress = {
    completed: done,
    total: S.games.length,
    current: '',
    status: done >= S.games.length ? '✓ Catálogo sincronizado al 100%' : 'Preparando la sincronización…',
  };
  updateSyncProgressUI();
  void runAutoSyncLoop();
}

/** Primera URL útil de un endpoint de arte de SteamGridDB para un `game_id`. */
async function steamgridFirstArtUrl(kind: ArtKind, gameId: number): Promise<string | null> {
  const payload = (await steamgridJSON(STEAMGRID_ENDPOINTS[kind](gameId))) as {
    data?: SteamGridAsset[];
  } | null;
  const list = payload && Array.isArray(payload.data) ? payload.data : [];
  const found = list.find((item) => typeof item?.url === 'string' && !!item.url.trim());
  return found && typeof found.url === 'string' ? found.url : null;
}

/**
 * Descarga y guarda el arte de un juego concreto.
 *
 * Devuelve `false` cuando SteamGridDB no reconoce el título o no tiene ninguna
 * imagen: el juego se da por intentado y el bucle pasa al siguiente.
 */
async function syncGameArt(game: Game): Promise<boolean> {
  /* Mismo criterio que el modal: título comercial + alias de la ficha, para que
   * los ports con nombre técnico («smw (… )») también encuentren su arte. */
  const gameId = await steamgridGameId(bestGameTitle(game), game);
  if (!gameId) return false;

  /* Secuencial a propósito: tres peticiones simultáneas por juego agotan el
   * rate-limit de la API mucho antes que hacerlas en serie. */
  const coverUrl = await steamgridFirstArtUrl('cover', gameId);
  const heroUrl = await steamgridFirstArtUrl('hero', gameId);
  const logoUrl = await steamgridFirstArtUrl('logo', gameId);
  if (!coverUrl && !heroUrl && !logoUrl) return false;

  libraryService.setCustomArt(game.id, { coverUrl, heroUrl, logoUrl });
  /* El modelo de vista (`Game`) se muta en sitio: `S.byId` sigue siendo válido. */
  refreshGameArt(game);
  return true;
}

/**
 * Una vuelta del motor: procesa **un** juego y programa la siguiente.
 *
 * Se detiene sola si el interruptor se apagó, si desapareció la clave o si ya
 * no queda ningún juego sin carátula.
 */
async function runAutoSyncLoop(): Promise<void> {
  if (!S.settings.steamgridAutoSync) {
    stopAutoSync();
    autoSyncProgress.status = 'Sincronización automática desactivada.';
    updateSyncProgressUI();
    return;
  }
  if (!steamgridConfigured(S.settings)) {
    stopAutoSync();
    autoSyncProgress.status = 'Falta la clave de SteamGridDB: sincronización detenida';
    updateSyncProgressUI();
    return;
  }

  autoSyncRunning = true;
  /* Los ports **instalados** se atienden primero: son los que el usuario ve en
   * su biblioteca y los que dan valor inmediato a la carátula. `sort` es
   * estable, así que dentro de cada grupo se conserva el orden del catálogo. */
  const pending = S.games
    .filter((game) => !libraryService.getCustomArt(game.id)?.coverUrl && !autoSyncTried.has(game.id))
    .sort((a, b) => Number(b.inst) - Number(a.inst));
  autoSyncProgress.total = S.games.length;
  autoSyncProgress.completed = S.games.length - pending.length;

  if (pending.length === 0) {
    stopAutoSync();
    autoSyncProgress.current = '';
    autoSyncProgress.completed = S.games.length;
    autoSyncProgress.status = '✓ Catálogo sincronizado al 100%';
    updateSyncProgressUI();
    return;
  }

  const game = pending[0];
  markAutoSyncTried(game.id);
  autoSyncProgress.current = game.t;
  autoSyncProgress.status = `Buscando arte de ${game.t}…`;
  updateSyncProgressUI();

  let saved = false;
  try {
    saved = await syncGameArt(game);
    autoSyncProgress.status = saved
      ? `Carátula guardada: ${game.t}`
      : `Sin arte en SteamGridDB: ${game.t}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\b429\b/.test(message)) {
      /* Límite de peticiones: se reintenta el MISMO juego 10 s después. */
      unmarkAutoSyncTried(game.id);
      autoSyncProgress.status = 'SteamGridDB ha limitado las peticiones: reintentando en 10 s';
      updateSyncProgressUI();
      scheduleAutoSync(AUTO_SYNC_RATE_LIMIT_MS);
      return;
    }
    console.warn('[PortsLauncher] Sincronización automática:', error);
    autoSyncProgress.status = `No se pudo descargar el arte de ${game.t}`;
  }

  if (saved) {
    autoSyncProgress.completed = Math.min(autoSyncProgress.total, autoSyncProgress.completed + 1);
  }
  updateSyncProgressUI();

  /* El usuario pudo apagar el interruptor mientras se descargaba el arte. */
  if (!S.settings.steamgridAutoSync) {
    stopAutoSync();
    return;
  }
  scheduleAutoSync(AUTO_SYNC_INTERVAL_MS);
}

const ACT: Record<string, (d: Record<string, string | undefined>) => void> = {
  open: (d) => d.id && go('game', d.id),
  nav: (d) => d.to && go(d.to as Route),
  /* Pestañas de Ajustes: cambian el panel activo sin mover la ruta. */
  'set-tab': (d) => {
    if (d.k) {
      setSettingsTab(d.k as SettingsTab);
      renderSettings();
    }
  },
  /* Actualizador del launcher (Ajustes → Actualizaciones y aviso lateral). */
  'check-updates': () => {
    void checkLauncherUpdates();
  },
  'download-update': () => {
    void openUpdateDownload();
  },
  'open-update': () => {
    setSettingsTab('updates');
    go('settings');
  },
  primary: (d) => d.id && primaryAction(d.id),
  gear: (d) => {
    if (!d.id) return;
    L = { type: 'gear', id: d.id };
    /* El drawer incluye el buscador de addons: hay que preparar el flujo del
     * port abierto o `providerSectionHTML` devolvería '' (PF seguiría en null). */
    const game = S.byId.get(d.id);
    if (game) resetProviderFlow(game);
    else PF = null;
    renderLayer();
  },
  /* --- Flujo asistido de ROMs con addons `asset-provider` ------------------ */
  'provider-search': (d) => {
    const game = d.id ? S.byId.get(d.id) : null;
    if (game) void triggerProviderSearch(game);
  },
  'provider-provision': (d) => {
    const game = d.id ? S.byId.get(d.id) : null;
    if (game && d.assetId) void triggerProviderProvision(game, d.assetId);
  },
  'provider-open': (d) => {
    if (d.url) openExternalUrl(d.url);
  },
  'provider-reset': () => {
    if (PF) {
      PF.phase = 'idle';
      PF.results = [];
      PF.error = null;
      renderLayer();
    }
  },
  plat: (d) => {
    B.plat = (d.k as any) || 'all';
    if (!['library', 'catalog'].includes(R.name)) {
      go('library');
    } else {
      draw();
    }
  },
  filter: (d) => {
    B.filter = (d.k as any) || 'all';
    refreshBrowse();
    renderSide();
  },
  clear: () => {
    B.q = '';
    B.filter = 'all';
    B.plat = 'all';
    B.dev = 'all';
    draw();
  },
  dest: () => {
    S.settings.dest = S.settings.dest === 'Linux' ? 'Windows' : 'Linux';
    B.dest = S.settings.dest;
    saveState();
    draw();
    toast('Destino: ' + S.settings.dest);
  },
  view: (d) => {
    if (!d.k) return;
    S.settings.view = d.k as ViewMode;
    saveState();
    if (R.name === 'settings') renderSettings();
    else refreshBrowse();
  },
  sort: (d) => {
    const k = d.k as any;
    if (B.sort === k) B.dir = (B.dir * -1) as 1 | -1;
    else {
      B.sort = k;
      B.dir = 1;
    }
    refreshBrowse();
  },
  tab: (d) => {
    if (d.k) D.tab = d.k as any;
    if (R.id) renderGame(R.id);
  },
  toast: (d) => d.m && toast(d.m),
  /* «Abrir en GitHub»: `data-repo` trae el repositorio del port; el navegador
   * real lo abre vía `shell.openExternal` (ver `openExternalUrl`). */
  openRepo: (d) => openRepoLink(d),
  ext: (d) => openRepoLink(d),
  media: (d) => {
    if (!d.k) return;
    if (S.settings.mediaMode === 'single') S.settings.media = true;
    S.settings[S.settings.mediaMode === 'single' ? 'mediaDef' : 'mediaDef'] = d.k as MediaStyle;
    saveState();
    renderSettings();
    toast('Estilo: ' + (MEDIA[d.k as MediaStyle]?.name ?? d.k));
  },
  mmode: (d) => {
    if (d.k) S.settings.mediaMode = d.k as any;
    saveState();
    renderSettings();
  },
  rmode: (d) => {
    if (d.k) S.settings.romMode = d.k as any;
    saveState();
    renderSettings();
  },
  reset: () => {
    S.settings = { ...DEFAULT_SETTINGS };
    saveState();
    draw();
    toast('Ajustes restablecidos');
  },
  updall: () => {
    /* Secuencial a propósito: cada port recorre el pipeline real completo
     * (descarga del release o del ZIP, extracción y `chmod`). Lanzarlos en
     * paralelo saturaba la red y el disco y multiplicaba las descompresiones
     * simultáneas, acercando el backend al OOM. `installReal` ya ignora una
     * petición si ese port está en curso, así que el `for…of` no se solapa. */
    void (async () => {
      const pending = S.games.filter((g) => statusOf(g).k === 'upd');
      for (const game of pending) await installReal(game.id);
    })();
  },
  closeL: () => closeL(),
  /* «Abrir reporte» del modal de error: abre el `.log` con el visor del sistema
   * (Electron `shell.openPath`, o `xdg-open`/`open` fuera de él; en Windows el
   * backend usa `notepad.exe`, nunca `cmd /c start`). */
  openReport: (d) => {
    if (!d.path) {
      toast('No hay ningún reporte que abrir');
      return;
    }
    void openPathInSystem(d.path);
  },
  rom: (d) => d.id && openRom(d.id, false),
  pick: () => $('#fpick')?.click(),
  pickDir: () => $('#fpickdir')?.click(),
  sample: () => {
    if (!L || L.type !== 'rom') return;
    const game = S.byId.get(L.id);
    if (!game) return;
    setFile(game.id + (game.rom ? game.rom.x[0] : '.iso'), 16777216);
  },
  wmode: (d) => {
    if (d.k) W.mode = d.k as RomMode;
    renderLayer();
  },
  saveRom: () => {
    if (!W.ok || !L || L.type !== 'rom') return;
    const id = L.id;
    const game = S.byId.get(id);
    if (!game) return;
    const fi = W.fromInstall;
    game.romOk = true;
    game.romMode = W.mode;
    game.romPath = romDest(game);
    libraryService.setRom(id, game.romPath, game.romMode, true);
    saveState();
    L = null;
    renderLayer();
    draw();
    if (fi) play(id);
    else toast('ROM guardada y validada');
  },
  gmode: (d) => {
    if (!L || L.type !== 'gear') return;
    const game = S.byId.get(L.id);
    if (!game || !d.k) return;
    game.romMode = d.k as RomMode;
    if (game.romOk) {
      const f = game.romPath.split('/').pop() ?? '';
      game.romPath =
        d.k === 'link'
          ? `~/Descargas/${f}`
          : `${S.settings.romDir}/${game.t.replace(/[^A-Za-z0-9]+/g, '')}/${f}`;
    }
    saveState();
    renderLayer();
    toast(
      d.k === 'copy'
        ? 'ROM copiada a la carpeta del port (simulado)'
        : 'Usando la ROM desde su ubicación original'
    );
  },
  reval: () => {
    toast('Revalidando…');
    setTimeout(() => toast('ROM validada · SHA-1 coincide (simulado)'), 900);
  },
  gtog: (d) => {
    if (!L || L.type !== 'gear') return;
    const game = S.byId.get(L.id);
    if (!game || !d.k) return;
    if (d.k === 'auto') game.auto = !game.auto;
    if (d.k === 'pin') game.pin = !game.pin;
    saveState();
    renderLayer();
  },
  unins: () => {
    if (!L || !('id' in L)) return;
    L = { type: 'unins', id: L.id };
    renderLayer();
  },
  doUnins: () => {
    if (!L || L.type !== 'unins') return;
    const id = L.id;
    const game = S.byId.get(id);
    if (game) {
      game.inst = false;
      game.v = null;
      game.romOk = false;
      saveState();
      L = null;
      renderLayer();
      toast(game.t + ' desinstalado');
      if (R.name === 'game') renderGame(id);
      draw();
    }
  },

  /* ------------------------- arte personalizado -------------------------- */

  'art-modal': (d) => {
    const game = d.id ? S.byId.get(d.id) : undefined;
    if (game) openArtModal(game);
  },
  'art-tab': (d) => {
    const kind = d.k;
    if (!isArtKind(kind)) return;
    currentArtTab = kind;
    renderArtModal();
    /* Pestaña sin galería: se pide sola (si hay clave) para no obligar a pulsar
     * «Buscar» en cada sección al cambiar entre logo, fondo y carátula. */
    if (steamgridConfigured(S.settings) && currentArtGallery[kind].length === 0) {
      void searchArt(kind);
    }
  },
  'set-anchor': (d) => {
    if (!currentArtDraft || typeof d.k !== 'string') return;
    currentArtDraft.logoAnchor = d.k as LogoAnchor;
    renderArtModal();
  },
  /* `set-scale` llega como input/change del slider (ver escuchadores). */
  'set-scale': () => {
    /* Intencionadamente vacío: el valor se aplica en `input`/`change`. */
  },
  /* Mismo contrato para el slider de zoom del fondo (`data-art="hero-scale"`). */
  'set-hero-scale': () => {
    /* Intencionadamente vacío: el valor se aplica en `input`/`change`. */
  },
  /* Y para los dos sliders de la carátula del soporte. */
  'set-cover-scale': () => {
    /* Intencionadamente vacío: el valor se aplica en `input`/`change`. */
  },
  'set-cover-y': () => {
    /* Intencionadamente vacío: el valor se aplica en `input`/`change`. */
  },
  'art-search': (d) => {
    const kind = d.k;
    if (!isArtKind(kind)) return;
    void searchArt(kind);
  },
  'art-url': (d) => {
    const kind = d.k;
    if (!isArtKind(kind)) return;
    const input = document.getElementById(`art-url-${kind}`) as HTMLInputElement | null;
    const url = (input?.value ?? '').trim();
    if (!url) {
      currentArtStatus[kind] = 'Pega una URL de imagen válida.';
      renderArtModal();
      return;
    }
    setDraftUrl(kind, url);
    currentArtStatus[kind] = 'URL aplicada al borrador.';
    renderArtModal();
  },
  'pick-art': pickArtAction,
  /* `render.ts` rotula la galería con `data-act="art-pick"`: mismo efecto. */
  'art-pick': pickArtAction,
  'save-art': () => saveArt(),
  'reset-art': () => resetArt(),
  'close-modal': () => closeArtModal(),
  'art-goto-settings': () => {
    /* El aviso del modal enlaza a Ajustes: cerrar el arte y navegar. */
    closeArtModal();
    go('settings');
  },

  /* -------------------- asistente de bienvenida --------------------------- */

  'open-wizard': () => openWizard(),
  'wizard-step': (d) => {
    currentWizardStep = Number(d.k) || 1;
    renderWizardModal();
  },
  'finish-wizard': () => finishWizard(),
  'close-wizard': () => finishWizard(),

  /* ------------------------- SteamGridDB --------------------------------- */

  'test-steamgrid': () => {
    void testSteamgrid();
  },
  /* Interruptor de descarga masiva del catálogo (Ajustes → Integraciones). */
  'toggle-auto-art': () => {
    /* Sin clave (ni del usuario ni del proxy) no hay nada que descargar: el
     * interruptor no se enciende para no prometer una integración inexistente. */
    if (!S.settings.steamgridAutoSync && !steamgridConfigured(S.settings)) {
      toast('Configura tu clave de SteamGridDB primero');
      return;
    }

    S.settings.steamgridAutoSync = !S.settings.steamgridAutoSync;
    saveState();
    /* Persistencia en la biblioteca local (`ports.json`), además de la copia
     * rápida de `saveState()` en `localStorage`. */
    libraryService.updateSettings({ steamgridAutoSync: S.settings.steamgridAutoSync });
    renderSettings();

    if (S.settings.steamgridAutoSync) {
      startAutoSync();
      toast('Sincronización automática activada en segundo plano');
    } else {
      stopAutoSync();
      autoSyncProgress.status = 'Sincronización automática pausada';
      updateSyncProgressUI();
      toast('Sincronización automática pausada');
    }
  },

  /* -------------------- addons y extensiones ------------------------------ */

  /* Las dos acciones abren la carpeta real de plugins en el explorador del
   * sistema (no hay carpeta ficticia ni mensaje simulado): ahí se copian las
   * carpetas con su `plugin.json` y el siguiente arranque las lista. */
  'open-plugins-folder': () => void openPluginsFolder(),
  'open-addons-dir': () => void openPluginsFolder(),
  'open-plugins-doc': () => openPluginsDoc(),
  'close-doc-modal': () => closePluginsDoc(),
  'install-addon': () => {
    toast('Copia la carpeta del plugin en la carpeta que se acaba de abrir');
    void openPluginsFolder();
  },
  'toggle-addon': (d) => {
    const addon = S.addons.find((a) => a.id === d.id);
    if (addon) {
      addon.enabled = !addon.enabled;
      libraryService.setAddon(addon);
      draw();
      toast(`${addon.name} ${addon.enabled ? 'activado' : 'desactivado'}`);
    }
  },
  'remove-addon': (d) => {
    if (d.id) {
      libraryService.removeAddon(d.id);
      S.addons = S.addons.filter((a) => a.id !== d.id);
      draw();
      /* El disco manda: el plugin sigue en su carpeta y volverá a listarse al
       * reiniciar. Para desinstalarlo hay que borrar esa carpeta. */
      toast('Plugin quitado de la lista · su carpeta sigue en disco');
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Escuchadores globales de eventos                                           */
/* -------------------------------------------------------------------------- */

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
  if (!target) return;
  /* Los controles de formulario (el slider del arte) gestionan su valor en
   * `input`/`change`: no deben perder el comportamiento nativo del clic. */
  if (target.matches('input, select, textarea')) return;
  const act = target.dataset.act;
  if (act && ACT[act]) {
    e.preventDefault();
    ACT[act](target.dataset as Record<string, string | undefined>);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && L) {
    closeL();
    return;
  }
  if (e.key === 'Escape' && currentArtGame) {
    closeArtModal();
    return;
  }
  if (e.key === 'Escape' && wizardOpen) {
    finishWizard();
    return;
  }
  if (e.key === 'Escape' && pluginsDocOpen) {
    closePluginsDoc();
    return;
  }
  const target = e.target as HTMLElement | null;
  /* Buscador del modal «Ajustar arte»: Intro lanza la búsqueda sin tener que
   * llegar al botón. Se lee el valor del campo porque el evento `input` puede
   * no haberse procesado todavía (autocompletado, pegado con ratón). */
  if (e.key === 'Enter' && target?.matches('input[data-art="query"]')) {
    const input = target as HTMLInputElement;
    const kind = input.dataset.k;
    if (isArtKind(kind)) {
      e.preventDefault();
      currentArtQueries[kind] = input.value;
      void searchArt(kind);
    }
    return;
  }
  if (
    (e.key === 'Enter' || e.key === ' ') &&
    target?.matches('[data-act]') &&
    !/^(BUTTON|A|INPUT|SELECT)$/.test(target.tagName)
  ) {
    e.preventDefault();
    const act = target.dataset.act;
    if (act && ACT[act]) ACT[act](target.dataset as Record<string, string | undefined>);
  }
  if (e.key === '/' && target && !/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
    const q = $('#q') as HTMLInputElement | null;
    if (q) {
      e.preventDefault();
      q.focus();
    }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement | null;
  if (!t) return;
  if (t.id === 'q') {
    B.q = t.value;
    const res = $('#results');
    if (res) res.innerHTML = resultsHTML(R.name);
    const hero = $('#hero');
    if (hero) {
      hero.innerHTML =
        R.name === 'library' && !B.q && B.filter === 'all' && B.plat === 'all' ? heroHTML() : '';
    }
  }
  if (t.dataset.set) {
    (S.settings as any)[t.dataset.set] = t.value;
    saveState();
    /* La clave de SteamGridDB se guarda además en
     * `~/.steamgrid_credentials.env` (con rebote: se escribe tecla a tecla). */
    if (t.dataset.set === 'steamgridApiKey') scheduleSaveSteamgridKey(t.value);
  }
  if (t.dataset.g && L && L.type === 'gear') {
    const game = S.byId.get(L.id);
    if (game) {
      (game as any)[t.dataset.g] = t.value;
      saveState();
    }
  }
  /* Modal «Ajustar arte»: el buscador y el slider no repintan el modal para no
   * perder el foco mientras se escribe o se arrastra. */
  if (t.dataset.art === 'query') {
    const kind = t.dataset.k;
    if (isArtKind(kind)) currentArtQueries[kind] = t.value;
  }
  if (t.dataset.art === 'scale') {
    applyLogoScale(Number(t.value));
  }
  if (t.dataset.art === 'hero-scale') {
    applyHeroScale(Number(t.value));
  }
  if (t.dataset.art === 'cover-scale') {
    applyCoverScale(Number(t.value));
  }
  if (t.dataset.art === 'cover-y') {
    applyCoverY(Number(t.value));
  }
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement | null;
  if (!t) return;
  /* Ajustes → «Según la plataforma»: el `<select>` lleva la plataforma de origen
   * en `data-map` (no la clave visual del listado). */
  if (t.dataset && t.dataset.map) {
    const platKey = t.dataset.map as SourcePlatform;
    if (t.value) (S.settings.mediaMap as any)[platKey] = t.value;
    else delete (S.settings.mediaMap as any)[platKey];
    saveState();
    renderSettings();
    draw();
    toast('Formato actualizado');
    return;
  }
  /* Filtros del catálogo y de la biblioteca (`controlsHTML`). */
  if (t.id === 'filtersel') {
    B.filter = t.value as any;
    refreshBrowse();
  }
  if (t.id === 'destsel') {
    const val = t.value as 'all' | 'Linux' | 'Windows';
    B.dest = val;
    if (val === 'Linux' || val === 'Windows') {
      S.settings.dest = val;
      saveState();
    }
    refreshBrowse();
  }
  if (t.id === 'platsel') {
    B.plat = t.value as any;
    refreshBrowse();
  }
  if (t.id === 'devsel') {
    B.dev = t.value as any;
    refreshBrowse();
  }
  if (t.id === 'sortsel') {
    B.sort = t.value as any;
    B.dir = 1;
    refreshBrowse();
  }
  if (t.dataset.g === 'runner' && L && L.type === 'gear') {
    const game = S.byId.get(L.id);
    if (game) {
      game.runner = t.value;
      saveState();
    }
  }
  /* Modal «Ajustar arte»: archivo local y confirmación del slider. */
  if (t.dataset.art === 'file') {
    const kind = t.dataset.k;
    if (isArtKind(kind)) {
      const input = t as HTMLInputElement;
      applyArtFile(kind, input.files?.[0] ?? null);
    }
    return;
  }
  if (t.dataset.art === 'scale') {
    applyLogoScale(Number(t.value));
  }
  if (t.dataset.art === 'hero-scale') {
    applyHeroScale(Number(t.value));
  }
  if (t.dataset.art === 'cover-scale') {
    applyCoverScale(Number(t.value));
  }
  if (t.dataset.art === 'cover-y') {
    applyCoverY(Number(t.value));
  }
});

/* -------------------------------------------------------------------------- */
/* Router y render loop                                                       */
/* -------------------------------------------------------------------------- */

let hashBusy = false;

export function go(name: Route, id?: string): void {
  const previous = R.name;
  const leavingBrowse = previous === 'catalog' || previous === 'library';

  /* Abrir una ficha desde un listado: recordar de dónde venimos y en qué punto
   * de lectura estaba, para que «←» devuelva al sitio exacto. */
  if (leavingBrowse && name === 'game') {
    NAVMEM.lastBrowseRoute = previous as 'catalog' | 'library';
    NAVMEM.catalogScrollY = window.scrollY;
  }

  R.name = name;
  R.id = id ?? null;
  if (name === 'game') D.tab = 'sum';
  /* Los filtros del usuario se conservan al cambiar de sección: reiniciarlos
   * hacía perder la búsqueda en curso cada vez que se abría una ficha. */

  draw(true);

  /* Volver de la ficha al listado de origen restaura el scroll; cualquier otro
   * movimiento empieza arriba. */
  const returning = previous === 'game' && name === NAVMEM.lastBrowseRoute;
  window.scrollTo(0, returning ? NAVMEM.catalogScrollY : 0);

  const h = name === 'game' ? `port-${id}` : RT[name];
  try {
    if (location.hash !== '#' + h) {
      hashBusy = true;
      location.hash = h;
      setTimeout(() => {
        hashBusy = false;
      }, 50);
    }
  } catch {}
}

export function route(): void {
  const h = (location.hash || '').replace('#', '');
  if (h.startsWith('port-')) {
    const id = h.slice(5);
    if (S.byId.has(id)) {
      go('game', id);
      return;
    }
  }
  /* Addons ya no es una sección propia: es una pestaña de Ajustes. El hash
   * histórico `#addons` se conserva para no romper enlaces ni marcadores. */
  if (h === 'addons') {
    setSettingsTab('addons');
    go('settings');
    return;
  }
  go(RT_INV[h] ?? 'home');
}

export function draw(fresh = false): void {
  const side = $('#side');
  if (side) side.innerHTML = renderSide();
  const bnav = $('#bnav');
  if (bnav) bnav.innerHTML = renderBottomNav();

  if (R.name === 'home') renderHome();
  else if (R.name === 'library' || R.name === 'catalog') {
    if (fresh || !$('#results')) renderBrowse(R.name);
    else refreshBrowse();
  } else if (R.name === 'updates') renderUpdates();
  else if (R.name === 'addons') renderAddons();
  else if (R.name === 'settings') renderSettings();
  else if (R.name === 'game' && R.id) renderGame(R.id);

  Object.keys(PROG).forEach((id) => {
    document.querySelectorAll<HTMLElement>(`[data-prog="${id}"]`).forEach((e) => {
      e.style.width = PROG[id] + '%';
    });
  });

  /* Ajustes → Integraciones: el progreso de la sincronización automática vive
   * en un contenedor que sólo este módulo sabe rellenar. Tras repintar la
   * pantalla se vuelve a inyectar (no-op si el contenedor no está en el DOM). */
  updateSyncProgressUI();
}

/**
 * Última firma de `S.settings` volcada a `libraryService`.
 *
 * `saveState()` se llama en cada pulsación de tecla de los ajustes; sin este
 * registro se reescribiría `ports.json` con el mismo contenido decenas de
 * veces por segundo.
 */
let persistedSettingsSignature = '';

/**
 * Persiste los ajustes en los dos destinos.
 *
 * `localStorage` es la caché rápida del arranque, pero la fuente de verdad es
 * `~/PortsLauncher/ports.json`: `init()` hidrata desde ahí, así que un ajuste
 * que solo viva en `localStorage` se pierde en cuanto una escritura de la
 * biblioteca vuelca su propio `settings` al fichero. Por eso todo cambio de
 * ajustes viaja también a `libraryService` (`onboardingDone`,
 * `steamgridApiKey`, `steamgridAutoSync`, vista, carpetas…).
 */
function saveState(): void {
  try {
    const data = {
      settings: S.settings,
      last: S.last,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}

  try {
    const signature = JSON.stringify(S.settings);
    if (signature === persistedSettingsSignature) return;
    persistedSettingsSignature = signature;
    libraryService.updateSettings(S.settings);
  } catch (error) {
    /* Cuota llena o servicio sin almacén: la copia de `localStorage` sigue. */
    console.warn('[PortsLauncher] No se pudieron persistir los ajustes:', error);
  }
}

/* -------------------------------------------------------------------------- */
/* Inicialización de la aplicación                                            */
/* -------------------------------------------------------------------------- */

/**
 * Fusiona los ajustes del arranque con los hidratados de `ports.json`.
 *
 * La copia de `localStorage` aporta apariencia y carpetas, pero hay decisiones
 * que viven en el fichero de disco y que antes se perdían al arrancar (y por
 * eso el launcher volvía a pedir la clave en cada inicio):
 *
 *   · `onboardingDone`: si el asistente ya se completó, no se repite.
 *   · `steamgridApiKey`: la clave guardada se respeta sobre la local.
 *   · `steamgridAutoSync`: la sincronización opt-in se conserva.
 */
function mergePersistedSettings(
  local: Settings,
  persisted: Settings | null | undefined
): Settings {
  const merged: Settings = { ...local };
  if (!persisted) return merged;

  if (persisted.onboardingDone === true) merged.onboardingDone = true;

  const storedKey =
    typeof persisted.steamgridApiKey === 'string' ? persisted.steamgridApiKey.trim() : '';
  if (storedKey) merged.steamgridApiKey = storedKey;

  if (persisted.steamgridAutoSync === true) merged.steamgridAutoSync = true;

  return merged;
}

async function init(): Promise<void> {
  let settings = { ...DEFAULT_SETTINGS };
  let last: string | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.settings) {
        settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      }
      if (parsed.last) last = parsed.last;
    }
  } catch {}

  // Migrar alias 'shelves' a 'carts'
  if ((settings.view as string) === 'shelves') {
    settings.view = 'carts';
  }

  // Cargar índice real y biblioteca
  const catalog = await catalogService.loadCatalog();

  /* El fichero en disco (`~/PortsLauncher/ports.json`) es la fuente de verdad:
   * se hidrata ANTES de leer el estado para que `libraryService` refleje lo
   * persistido y no la caché de `localStorage`. Nunca lanza: si el backend no
   * responde se conserva el estado local. */
  await hydrateLibraryFromDisk();

  const library = libraryService.getState();

  /* El fichero manda también en los ajustes: si `ports.json` dice que el
   * asistente ya se completó o trae la clave de SteamGridDB, se respeta aunque
   * la copia de `localStorage` sea vieja o no exista. */
  settings = mergePersistedSettings(settings, library.settings);

  const games: Game[] = catalog.ports.map((port: PortItem) => toGame(port, library.games, settings));

  /* Sin siembra ni estado simulado: el estado instalado proviene únicamente de
   * `libraryService` (ver `toGame`). Un arranque limpio deja la biblioteca
   * vacía y el héroe «Continuar jugando» sin pintar. */
  if (!last) {
    const firstInstalled = games.find((g) => g.inst);
    last = firstInstalled ? firstInstalled.id : null;
  }

  /* Los addons viven en la biblioteca local: la sección de Addons pinta los del
   * usuario (una lista vacía es un estado válido, no un fallback a fábrica). */
  setSnapshot(
    settings,
    games,
    last,
    catalog.generatedAt,
    Array.isArray(library.addons) ? library.addons : S.addons
  );

  /* Los ajustes fusionados se escriben de vuelta: así `ports.json` conserva
   * `onboardingDone` y la clave aunque vinieran de `localStorage`, y el
   * siguiente arranque los hidrata sin volver a preguntar nada. */
  saveState();

  window.addEventListener('hashchange', () => {
    if (!hashBusy) route();
  });

  route();

  /* Comprobación silenciosa de actualizaciones del launcher. */
  void checkLauncherUpdates(true);

  /* Plugins reales: se leen los `plugin.json` de disco y se sincronizan con la
   * biblioteca. No bloquea el arranque y, si no hay ninguno, la lista queda
   * vacía (no hay addons de fábrica). */
  void syncPluginsFromDisk();

  /* Sonda del proxy de SteamGridDB: no bloquea el arranque. Cuando termina, se
   * arranca la sincronización automática si el usuario la dejó activa (la sonda
   * decide si hay clave en el servidor de desarrollo, no solo en Ajustes). */
  void probeSteamgridStatus().then(() => {
    if (S.settings.steamgridAutoSync) startAutoSync();
  });

  /* Primer arranque: asistente de bienvenida (3 pasos). */
  if (!S.settings.onboardingDone) {
    currentWizardStep = 1;
    renderWizardModal();
  }
}

init().catch((err) => {
  console.error('[PortsLauncher] Error en inicialización:', err);
});
