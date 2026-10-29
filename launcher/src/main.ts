/* ==========================================================================
 * PortsLauncher · main.ts
 *
 * Controlador principal idéntico al prototipo interactivo
 * (`Documentación/PortsHub Prototipo.html`), alimentado con los datos reales
 * de `catalogService` y `libraryService`.
 * ========================================================================== */

import './styles/app.css';

import type { DestOS, MediaStyle, PortItem, RomMode, Settings, ViewMode } from './services/types';
import { DEFAULT_SETTINGS, LEGACY_VIEW_ALIASES } from './services/types';
import { catalogService } from './services/catalogService';
import { libraryService } from './services/libraryService';
import type { Game } from './ui/model';
import { toGame, statusOf, esc } from './ui/model';
import { MEDIA, PLAT } from './ui/platforms';
import { B, D, R, S, setSnapshot, updateCount } from './ui/state';
import type { Route } from './ui/state';
import {
  renderSide,
  renderBottomNav,
  renderHome,
  renderBrowse,
  refreshBrowse,
  renderUpdates,
  renderSettings,
  renderGame,
  resultsHTML,
  heroHTML,
  RT,
  RT_INV,
  bgOf,
} from './ui/render';
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

const ACT: Record<string, (d: Record<string, string | undefined>) => void> = {
  open: (d) => d.id && go('game', d.id),
  nav: (d) => d.to && go(d.to as Route),
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
};

/* -------------------------------------------------------------------------- */
/* Escuchadores globales de eventos                                           */
/* -------------------------------------------------------------------------- */

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
  if (!target) return;
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
  const target = e.target as HTMLElement | null;
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
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement | null;
  if (!t) return;
  if (t.dataset && t.dataset.map) {
    if (t.value) (S.settings.mediaMap as any)[t.dataset.map] = t.value;
    else delete (S.settings.mediaMap as any)[t.dataset.map];
    saveState();
    renderSettings();
    return;
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
});

/* -------------------------------------------------------------------------- */
/* Router y render loop                                                       */
/* -------------------------------------------------------------------------- */

let hashBusy = false;

export function go(name: Route, id?: string): void {
  R.name = name;
  R.id = id ?? null;
  if (name === 'game') D.tab = 'sum';
  if (name === 'library' || name === 'catalog') B.filter = 'all';

  draw(true);
  window.scrollTo(0, 0);

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
  else if (R.name === 'settings') renderSettings();
  else if (R.name === 'game' && R.id) renderGame(R.id);

  Object.keys(PROG).forEach((id) => {
    document.querySelectorAll<HTMLElement>(`[data-prog="${id}"]`).forEach((e) => {
      e.style.width = PROG[id] + '%';
    });
  });
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

  // Instalar un par de ejemplos en biblioteca si está vacía para dar vida al Inicio arcade
  const installedCount = games.filter((g) => g.inst).length;
  if (installedCount === 0 && games.length > 0) {
    const defaultPlayable = ['sm64', 'oot', 'goldeneye', 'alttp', 'sonic1'];
    games.forEach((g) => {
      if (defaultPlayable.includes(g.id)) {
        g.inst = true;
        g.v = g.lv;
        g.romOk = true;
      }
    });
  }

  if (!last && games.length > 0) {
    const firstInstalled = games.find((g) => g.inst);
    last = firstInstalled ? firstInstalled.id : games[0].id;
  }

  setSnapshot(settings, games, last, catalog.generatedAt);

  window.addEventListener('hashchange', () => {
    if (!hashBusy) route();
  });

  route();
}

init().catch((err) => {
  console.error('[PortsLauncher] Error en inicialización:', err);
});
