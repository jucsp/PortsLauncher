/* ==========================================================================
 * PortsLauncher · main.ts
 *
 * Controlador principal idéntico al prototipo interactivo
 * (`Documentación/PortsHub Prototipo.html`), alimentado con los datos reales
 * de `catalogService` y `libraryService`.
 * ========================================================================== */

import './styles/app.css';

import type {
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
import type { Game } from './ui/model';
import { toGame, statusOf, esc } from './ui/model';
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
  clampHeroScale,
  clampLogoScale,
  wizardModalHTML,
  pluginsDocModalHTML,
  setSteamgridServerReady,
  steamgridConfigured,
  setSettingsTab,
  RT,
  RT_INV,
  bgOf,
} from './ui/render';
import type { ArtDraft, ArtKind, ArtTab, LogoAnchor, SettingsTab } from './ui/render';
import { art } from './ui/model';

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

type LayerState = LayerRom | LayerGear | LayerUnins | LayerLaunch | null;

let L: LayerState = null;

interface RomWizardState {
  file: { name: string; size: number } | null;
  checks: Array<{ ok: boolean; t: string; v: string }>;
  ok: boolean;
  mode: RomMode;
  fromInstall: boolean;
}

let W: RomWizardState = {
  file: null,
  checks: [],
  ok: false,
  mode: 'link',
  fromInstall: false,
};

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

function validateRom(game: Game, name: string, size: number) {
  const ext = (name.match(/\.[^.]+$/) ?? [''])[0].toLowerCase();
  const allowed = game.rom ? game.rom.x : ['.iso', '.bin', '.rom', '.z64'];
  const okExt = allowed.includes(ext);
  const checks = [
    {
      ok: okExt,
      t: okExt ? 'Extensión reconocida' : 'Extensión no reconocida',
      v: okExt ? ext : 'se esperaba ' + allowed.join(' '),
    },
  ];
  if (okExt) {
    checks.push({ ok: true, t: 'Tamaño correcto', v: fmtSize(size) });
    checks.push({
      ok: true,
      t: ext === '.v64' ? 'Orden de bytes: se convertirá' : 'Orden de bytes correcto',
      v: ext === '.v64' ? 'byte-swapped' : 'big-endian',
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
    checks: [],
    ok: false,
    mode: S.settings.romMode,
    fromInstall: !!fromInstall,
  };
  L = { type: 'rom', id };
  renderLayer();
}

function setFile(name: string, size: number): void {
  if (!L || L.type !== 'rom') return;
  const game = S.byId.get(L.id);
  if (!game) return;
  W.file = { name, size };
  W.checks = validateRom(game, name, size);
  W.ok = W.checks.every((c) => c.ok);
  renderLayer();
}

function romDest(game: Game): string {
  const f = W.file ? W.file.name : `${game.id}${game.rom ? game.rom.x[0] : '.rom'}`;
  return W.mode === 'link'
    ? `~/Descargas/${f}`
    : `${S.settings.romDir}/${game.t.replace(/[^A-Za-z0-9]+/g, '')}/${f}`;
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
     <b style="font-size:16px">${W.file ? esc(W.file.name) : 'Suelta aquí tu archivo de ROM'}</b><div class="muted">${game.rom ? game.rom.n + ' · ' + game.rom.x.join(' ') : 'Archivos de juego'}</div>
     <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn" data-act="pick">Elegir archivo…</button><button class="btn" data-act="sample">Usar ROM de ejemplo</button></div><input type="file" id="fpick" hidden><div class="muted" style="font-size:12px">Prototipo: solo se lee el nombre del archivo, nunca su contenido.</div></div>
    ${W.checks.length ? `<div style="display:flex;flex-direction:column;gap:8px"><div class="lbl" style="padding:0">VALIDACIÓN</div>${W.checks.map((c) => `<div class="chk ${c.ok ? '' : 'bad'}"><i>${c.ok ? '✓' : '✕'}</i><span style="flex:1">${c.t}</span><span class="mono muted" style="font-size:12px">${esc(c.v)}</span></div>`).join('')}</div>` : ''}
    <div><div class="lbl" style="padding:0;margin-bottom:10px">¿CÓMO LA USAMOS?</div><div style="display:flex;flex-wrap:wrap;gap:12px"><button class="opt" role="radio" aria-checked="${W.mode === 'link'}" data-act="wmode" data-k="link"><b>Usarla desde donde está</b><span class="muted">Se enlaza a <span class="mono" style="font-size:12px">${esc(W.file ? '~/Descargas/' + W.file.name : '~/Descargas/…')}</span>. No se mueve nada.</span></button><button class="opt" role="radio" aria-checked="${W.mode === 'copy'}" data-act="wmode" data-k="copy"><b>Copiarla a la carpeta del port</b><span class="muted">Se copia a <span class="mono" style="font-size:12px">${esc(S.settings.romDir)}/…</span></span></button></div><div class="muted" style="font-size:12px;margin-top:8px">El archivo original nunca se mueve ni se borra. Puedes cambiarlo luego en el engranaje ⚙.</div></div></div>
    <div class="mfoot"><button class="btn" data-act="closeL">${W.fromInstall ? 'Hacerlo después' : 'Cancelar'}</button><button class="btn pri" data-act="saveRom" ${W.ok ? '' : 'disabled style="opacity:.45;cursor:not-allowed"'}>${W.fromInstall ? 'Guardar y jugar' : 'Guardar'}</button></div></div>`;
  } else if (L.type === 'unins') {
    h = `<div class="scrim" data-act="closeL"></div><div class="modal" style="width:min(460px,calc(100vw - 24px))" role="alertdialog" aria-modal="true"><div class="mbody"><h2 style="font-size:22px">¿Desinstalar ${esc(game.t)}?</h2><div class="muted">Se borra la carpeta del port. Tu ROM original no se toca.</div><label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="keep" checked> Conservar mis partidas guardadas</label></div><div class="mfoot"><button class="btn" data-act="closeL">Cancelar</button><button class="btn dng" data-act="doUnins">Desinstalar</button></div></div>`;
  } else if (L.type === 'gear') {
    const hasRom = !!game.rom;
    h = `<div class="scrim" data-act="closeL"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Configuración de ${esc(game.t)}">
    <div style="display:flex;align-items:center;gap:14px"><div class="thumb" style="width:56px;height:56px;background:${bgOf(game)}"></div><div style="flex:1;min-width:0"><h2 style="font-size:22px">${esc(game.t)}</h2><div class="muted">${esc(game.pr)} · v${game.v ?? game.lv} · Configuración</div></div><button class="btn ico" data-act="closeL" aria-label="Cerrar">✕</button></div>
    <section style="display:flex;flex-direction:column;gap:10px"><div class="lbl" style="padding:0">DIRECTORIO DE INSTALACIÓN</div><input class="in-txt" data-g="dir" value="${esc(game.dir)}" aria-label="Directorio de instalación"><div style="display:flex;gap:8px"><button class="btn sm" data-act="toast" data-m="Abriendo carpeta… (simulado)">Abrir carpeta</button><button class="btn sm" data-act="toast" data-m="Port movido a ${esc(game.dir)} (simulado)">Mover aquí</button></div></section>
    ${hasRom ? `<section style="display:flex;flex-direction:column;gap:10px"><div class="lbl" style="padding:0">ROM</div><div style="display:flex;gap:8px"><div class="in-txt" style="display:flex;align-items:center;overflow:hidden;white-space:nowrap">${game.romOk ? esc(game.romPath) : 'Sin ROM'}</div><button class="btn" data-act="rom" data-id="${L.id}">Cambiar…</button></div>
     <div class="seg" role="group" aria-label="Modo de ROM"><button style="flex:1;width:auto;font-weight:600" aria-pressed="${game.romMode === 'link'}" data-act="gmode" data-k="link">Usar donde está</button><button style="flex:1;width:auto;font-weight:600" aria-pressed="${game.romMode === 'copy'}" data-act="gmode" data-k="copy">Copiar a carpeta del port</button></div>
     <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="color:${game.romOk ? 'var(--accent2)' : 'var(--warn)'};font-weight:600">${game.romOk ? '● Validada · SHA-1 coincide' : '● Falta la ROM'}</span><button class="btn sm" data-act="reval">Revalidar</button></div></section>` : '<section class="box"><b>Este port no necesita ROM.</b></section>'}
    <section style="display:flex;flex-direction:column;gap:10px"><div class="lbl" style="padding:0">ACTUALIZACIONES</div>
     <div class="chk" style="justify-content:space-between"><span>Actualizar automáticamente</span><button class="tog" role="switch" aria-checked="${game.auto}" data-act="gtog" data-k="auto" aria-label="Actualizar automáticamente"><i></i></button></div>
     <div class="chk" style="justify-content:space-between"><span>Fijar versión <span class="mono warn" style="color:var(--warn)">v${game.v ?? game.lv}</span></span><button class="tog" role="switch" aria-checked="${game.pin}" data-act="gtog" data-k="pin" aria-label="Fijar versión"><i></i></button></div></section>
    <section style="display:flex;flex-direction:column;gap:10px"><div class="lbl" style="padding:0">AVANZADO</div><label class="muted">Ejecutable<input class="in-txt" data-g="exe" value="${esc(game.exe || './' + game.t.replace(/[^A-Za-z0-9]+/g, '') + '.exe')}"></label><label class="muted">Argumentos<input class="in-txt" data-g="args" value="${esc(game.args)}"></label><label class="muted">Ejecutar con<br><select class="sel" data-g="runner" style="margin-top:6px"><option ${game.runner === 'Nativo' ? 'selected' : ''}>Nativo</option><option ${game.runner === 'Proton' ? 'selected' : ''}>Proton</option></select></label></section>
    <div style="margin-top:auto;display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between"><button class="btn dng" data-act="unins">Desinstalar (conservar partidas)</button><button class="btn pri" data-act="closeL">Listo</button></div></aside>`;
  } else if (L.type === 'launch') {
    h = `<div class="launch"><div class="spin"></div><h2 style="font-size:30px">Iniciando ${esc(game.t)}…</h2><div class="muted">${esc(game.pr)} · ${game.runner} · simulación</div><button class="btn" data-act="closeL">Cancelar</button></div>`;
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
    ['dragleave', 'drop'].forEach((e) =>
      drop.addEventListener(e, (ev) => {
        ev.preventDefault();
        drop.classList.remove('over');
      })
    );
    drop.addEventListener('drop', (ev) => {
      const dt = (ev as DragEvent).dataTransfer;
      const file = dt && dt.files && dt.files[0];
      if (file) setFile(file.name, file.size);
    });
    const fp = $('#fpick') as HTMLInputElement | null;
    if (fp) {
      fp.addEventListener('change', () => {
        const file = fp.files && fp.files[0];
        if (file) setFile(file.name, file.size);
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
/* Acciones: simulación, ejecución y persistencia                             */
/* -------------------------------------------------------------------------- */

const PROG: Record<string, number> = {};

function simulate(id: string, kind: 'install' | 'update'): void {
  const game = S.byId.get(id);
  if (!game || PROG[id] != null) return;
  PROG[id] = 0;
  draw();
  const iv = setInterval(() => {
    PROG[id] = Math.min(100, (PROG[id] ?? 0) + 4 + Math.random() * 9);
    document.querySelectorAll<HTMLElement>(`[data-prog="${id}"]`).forEach((e) => {
      e.style.width = PROG[id] + '%';
    });
    const stg = PROG[id] < 60 ? 'Descargando…' : PROG[id] < 85 ? 'Verificando huella…' : 'Instalando…';
    document.querySelectorAll<HTMLElement>(`[data-stage="${id}"]`).forEach((e) => {
      e.textContent = stg;
    });
    if (PROG[id] >= 100) {
      clearInterval(iv);
      delete PROG[id];
      game.inst = true;
      game.v = game.lv;
      saveState();
      draw();
      if (kind === 'install' && game.rom && !game.romOk) {
        openRom(id, true);
      } else {
        toast(game.t + (kind === 'update' ? ' actualizado a ' + game.lv : ' instalado'));
      }
    }
  }, 140);
}

function play(id: string): void {
  const game = S.byId.get(id);
  if (!game) return;
  S.last = id;
  game.played = Date.now();
  saveState();
  L = {
    type: 'launch',
    id,
    timer: setTimeout(() => {
      L = null;
      renderLayer();
      toast('Sesión de ' + game.t + ' terminada (simulada)');
      draw();
    }, 2200),
  };
  renderLayer();
}

function primaryAction(id: string): void {
  const game = S.byId.get(id);
  if (!game) return;
  const st = statusOf(game);
  if (st.act === 'install') simulate(id, 'install');
  else if (st.act === 'update') simulate(id, 'update');
  else if (st.act === 'rom') openRom(id, false);
  else if (st.act === 'play') play(id);
  else if (st.act === 'detail') {
    go('game', id);
    toast('Compilar desde código: se mostraría la guía (simulado)');
  } else if (st.act === 'ext') {
    toast('Abriría la página del proyecto en una pestaña nueva (simulado)');
  }
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

/**
 * Sonda `/api/steamgrid/__status`: ¿tiene clave el servidor de desarrollo?
 *
 * No llama a la API de SteamGridDB; solo informa de si existe
 * `STEAMGRID_API_KEY` en el entorno del proceso o en
 * `~/.steamgrid_credentials.env`. Se lanza sin bloquear el arranque.
 */
async function probeSteamgridStatus(): Promise<void> {
  try {
    const response = await fetch('/api/steamgrid/__status', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { configured?: boolean } | null;
    setSteamgridServerReady(!!payload?.configured);
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
 * Juegos ya intentados en este recorrido (con o sin arte encontrado).
 *
 * Sin este registro, un juego que SteamGridDB no conoce se reintentaría para
 * siempre y el bucle nunca avanzaría al siguiente. Se vacía en cada arranque
 * del recorrido, así que reactivar el interruptor reintenta los fallidos.
 */
const autoSyncTried = new Set<string>();

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

/** Arranca (o reinicia) un recorrido completo del catálogo. */
function startAutoSync(): void {
  /* Ya hay un recorrido vivo (p. ej. el del arranque): no se duplica. */
  if (autoSyncRunning) return;
  stopAutoSync();
  autoSyncTried.clear();
  autoSyncRunning = true;
  autoSyncProgress = {
    completed: 0,
    total: S.games.length,
    current: '',
    status: 'Preparando la sincronización…',
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
  const pending = S.games.filter(
    (game) => !libraryService.getCustomArt(game.id)?.coverUrl && !autoSyncTried.has(game.id)
  );
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
  autoSyncTried.add(game.id);
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
      autoSyncTried.delete(game.id);
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
  primary: (d) => d.id && primaryAction(d.id),
  gear: (d) => {
    if (!d.id) return;
    L = { type: 'gear', id: d.id };
    renderLayer();
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
  ext: () => toast('Abriría la página del proyecto en una pestaña nueva (simulado)'),
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
    S.games
      .filter((g) => statusOf(g).k === 'upd')
      .forEach((g) => simulate(g.id, 'update'));
  },
  closeL: () => closeL(),
  rom: (d) => d.id && openRom(d.id, false),
  pick: () => $('#fpick')?.click(),
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
    if (!L) return;
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

  'open-addons-dir': () => {
    toast('Carpeta: ~/.local/share/portslauncher/plugins/');
  },
  'open-plugins-doc': () => openPluginsDoc(),
  'close-doc-modal': () => closePluginsDoc(),
  'install-addon': () => {
    toast('Copia la carpeta de tu plugin en ~/.local/share/portslauncher/plugins/');
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
      toast('Addon eliminado');
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
    S.settings.dest = t.value as any;
    saveState();
    draw();
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

function saveState(): void {
  try {
    const data = {
      settings: S.settings,
      last: S.last,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

/* -------------------------------------------------------------------------- */
/* Biblioteca de arranque                                                     */
/* -------------------------------------------------------------------------- */

/** Ports emblemáticos que se dan por instalados en un arranque limpio. */
const SEED_KEYWORDS = ['sm64', 'mario', 'sonic', 'zelda', 'doom'];

/**
 * Da vida a Inicio y Biblioteca en el primer arranque.
 *
 * Con la biblioteca local vacía, el héroe «Continuar jugando» y la estantería
 * de RECIENTES no tienen nada que pintar y la app parece rota aunque el
 * catálogo tenga 1000+ ports. Marcamos como instalados hasta cinco ports —
 * preferentemente emblemáticos (`sm64`, `mario`, `sonic`, `zelda`, `doom`) y,
 * si el índice no los trae, los primeros del catálogo— para que el usuario vea
 * su estantería funcionando de inmediato.
 */
function seedLibrary(games: Game[]): void {
  if (games.length === 0) return;
  if (games.some((game) => game.inst)) return;

  const seed: Game[] = [];
  const take = (game: Game | undefined): void => {
    if (!game || seed.length >= 5 || seed.includes(game)) return;
    seed.push(game);
  };

  for (const keyword of SEED_KEYWORDS) {
    if (seed.length >= 5) break;
    take(games.find((game) => `${game.id} ${game.t}`.toLowerCase().includes(keyword)));
  }
  for (const game of games) {
    if (seed.length >= 5) break;
    take(game);
  }

  seed.forEach((game, index) => {
    game.inst = true;
    game.v = game.lv;
    /* Jugables desde el primer momento: sin ROM validada saldrían «Falta ROM». */
    game.romOk = true;
    /* `played` ordena RECIENTES y elige el héroe de «Continuar jugando». */
    game.played = Date.now() - index * 60_000;
  });
}

/* -------------------------------------------------------------------------- */
/* Inicialización de la aplicación                                            */
/* -------------------------------------------------------------------------- */

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
  const library = libraryService.getState();

  const games: Game[] = catalog.ports.map((port: PortItem) => toGame(port, library.games, settings));

  // Biblioteca vacía → sembrar ports emblemáticos (héroe + RECIENTES con vida).
  seedLibrary(games);

  if (!last && games.length > 0) {
    const firstInstalled = games.find((g) => g.inst);
    last = firstInstalled ? firstInstalled.id : games[0].id;
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

  window.addEventListener('hashchange', () => {
    if (!hashBusy) route();
  });

  route();

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
