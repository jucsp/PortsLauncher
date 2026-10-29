/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/SettingsDrawer.ts
 *
 * Cajón lateral de un port instalado (`.drawer`, con `backdrop-filter: blur`).
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   .drawer / .dhead / .dbody / .dfoot      (§10)
 *   .sbox / .kv / .set-row                  (§11)
 *   .field / .in-txt / .hint.ok / .hint.bad (§12)
 *   .opt / .chk / .tog                      (§12)
 *   .scrim / .modal.narrow                  (§9) — confirmación de borrado
 *
 * Todo lo que se edita aquí se persiste en `libraryService`, de modo que el
 * cajón es sólo una vista sobre la biblioteca local (sin estado propio salvo
 * el texto que se está escribiendo).
 * ========================================================================== */

import type { LaunchProfile, LibraryGame, PortItem, RomMode } from '../services/types';
import { LIBRARY_STATE_LABELS, ROM_BINDING_LABELS } from '../services/types';
import { catalogService } from '../services/catalogService';
import { libraryService } from '../services/libraryService';
import { installerService, resolveInstallDir } from '../services/installerService';
import { esc, icon, styleAttr } from './Icons';
import { art, devChip, statePill } from './PostersView';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export interface SettingsDrawerOptions {
  /** Contenedor donde montar cajón y confirmación (por defecto `#layer`). */
  host?: HTMLElement | null;
  /** Se llama tras confirmar la desinstalación. */
  onUninstall?: (pid: string, keepSaves: boolean) => void;
  /** Abre el asistente de ROM para el port. */
  onOpenRomAssistant?: (pid: string) => void;
  /** Lanza el port. */
  onLaunch?: (pid: string) => void;
  onToast?: (message: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
  /** Notifica que la ficha cambió (para repintar las vistas). */
  onChanged?: (pid: string) => void;
}

export interface SettingsDrawerHandle {
  readonly el: HTMLElement;
  readonly confirmEl: HTMLElement;
  open(pid: string): void;
  close(): void;
  isOpen(): boolean;
  /** Relee la ficha de `libraryService` y repinta. */
  refresh(): void;
  destroy(): void;
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dash(value: unknown): string {
  const text = str(value);
  return text || '—';
}

/** Runner declarado → etiqueta legible. */
function runnerLabel(runner: string | null | undefined): string {
  const value = str(runner).toLowerCase();
  if (!value) return 'Nativo';
  if (/proton|wine/.test(value)) return 'Wine-Proton';
  if (/native|nativo/.test(value)) return 'Nativo';
  return str(runner);
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

function thumb(port: PortItem): string {
  const img = port.coverUrl
    ? `<img src="${esc(port.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" ` +
      'onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1">'
    : '';
  return (
    '<div aria-hidden="true" ' +
    styleAttr({
      position: 'relative',
      width: '42px',
      height: '56px',
      'border-radius': 'var(--r-s)',
      overflow: 'hidden',
      border: '1px solid var(--line)',
      background: 'var(--panel-lo)',
      flex: '0 0 42px',
    }) +
    '>' +
    `<div style="position:absolute;inset:0;display:grid;place-content:center">${art(port, { compact: true })}</div>` +
    img +
    '</div>'
  );
}

function romSection(port: PortItem, game: LibraryGame): string {
  const hasRom = !!str(game.romPath);
  const validated = hasRom && !!str(game.romValidatedAt);
  const statusClass = validated ? 'hint ok' : 'hint bad';
  const statusText = validated
    ? `● Validada${
        game.romValidatedAt
          ? ` el ${new Date(game.romValidatedAt).toLocaleDateString('es-ES')}`
          : ''
      }${game.romMode === 'copy' ? ' · copia interna' : ' · enlace a la ruta original'}`
    : hasRom
      ? '● ROM registrada sin validar'
      : '● Falta ROM';
  const ext = (port.romProfile?.extensions ?? [])
    .map((item) => `.${String(item).replace(/^\./, '')}`)
    .join(', ');

  return (
    '<div class="sbox">' +
    '<h3>ROM del juego original</h3>' +
    '<dl class="kv">' +
    `<dt>Ruta</dt><dd class="mono">${esc(hasRom ? String(game.romPath) : 'sin asignar')}</dd>` +
    `<dt>Destino</dt><dd class="mono">${esc(
      str(port.romProfile?.destination) || '(carpeta del port)'
    )}</dd>` +
    `<dt>Formatos</dt><dd class="mono">${esc(ext || 'no declarados')}</dd>` +
    `<dt>Enlace</dt><dd>${esc(
      ROM_BINDING_LABELS[port.romProfile?.binding ?? 'in-app'] ?? 'in-app'
    )}</dd>` +
    '</dl>' +
    `<span class="${statusClass}">${esc(statusText)}</span>` +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    `<button type="button" class="btn sm" data-act="change-rom">` +
    `${icon('folder', { size: 15 })}<span>Cambiar…</span></button>` +
    `<button type="button" class="btn sm" data-act="revalidate" ${hasRom ? '' : 'disabled aria-disabled="true"'}>` +
    `${icon('shield', { size: 15 })}<span>Revalidar</span></button>` +
    '</div>' +
    '<div class="field"><label>Modo de uso</label></div>' +
    romModeOption('link', 'Usar donde está', 'ruta directa / enlace simbólico', game.romMode) +
    romModeOption('copy', 'Copiar a la carpeta del port', 'copia interna', game.romMode) +
    '</div>'
  );
}

function romModeOption(
  value: RomMode,
  title: string,
  desc: string,
  current: RomMode
): string {
  const checked = value === current;
  return (
    `<label class="opt${checked ? ' on' : ''}">` +
    `<input type="radio" name="sd-rom-mode" value="${value}"${checked ? ' checked' : ''} ` +
    `aria-label="${esc(title)}">` +
    `<span><span class="oname">${esc(title)}</span><span class="odesc">${esc(desc)}</span></span>` +
    `<span class="otag">${value === 'link' ? 'recomendado' : 'copia'}</span>` +
    '</label>'
  );
}

function launchSection(port: PortItem, game: LibraryGame): string {
  const profile: LaunchProfile = { ...(port.launch ?? {}), ...(game.launchProfile ?? {}) };
  const runner = runnerLabel(profile.runner);
  const args = Array.isArray(profile.args) ? profile.args.join(' ') : '';

  return (
    '<div class="sbox">' +
    '<h3>Lanzador</h3>' +
    '<div class="field"><label for="sd-exe">Ejecutable</label>' +
    `<input id="sd-exe" class="in-txt" type="text" data-field="executable" spellcheck="false" ` +
    `value="${esc(str(profile.executable))}" placeholder="bin/juego"></div>` +
    '<div class="field"><label for="sd-args">Argumentos</label>' +
    `<input id="sd-args" class="in-txt" type="text" data-field="args" spellcheck="false" ` +
    `value="${esc(args)}" placeholder="--windowed --datos ./data"></div>` +
    '<div class="field"><label for="sd-runner">Runner</label>' +
    '<select id="sd-runner" class="in-sel" data-field="runner">' +
    `<option value="native"${runner === 'Nativo' ? ' selected' : ''}>Nativo</option>` +
    `<option value="wine"${runner === 'Wine-Proton' ? ' selected' : ''}>Wine-Proton</option>` +
    '</select></div>' +
    `<span class="hint">Directorio de trabajo: ${esc(dash(profile.workingDir || game.installDir))}</span>` +
    '</div>'
  );
}

function drawerInner(port: PortItem, game: LibraryGame): string {
  const suggested = game.installDir || resolveInstallDir(port);
  return (
    '<div class="dhead">' +
    thumb(port) +
    '<div style="min-width:0;margin-right:auto">' +
    `<h2 style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(port.name)}</h2>` +
    `<span class="mono" style="font-size:var(--fs-2xs);color:var(--muted)">${esc(
      `${game.installedVersion ? `v${game.installedVersion}` : 'sin versión'} · ${LIBRARY_STATE_LABELS[game.state]}`
    )}</span>` +
    '</div>' +
    `<button type="button" class="x" data-act="close" title="Cerrar" aria-label="Cerrar">${icon('close', { size: 16 })}</button>` +
    '</div>' +
    '<div class="dbody">' +
    '<div class="sbox">' +
    '<h3>Directorio de instalación</h3>' +
    '<div class="field"><label for="sd-dir">Carpeta del port</label>' +
    `<input id="sd-dir" class="in-txt" type="text" data-field="installDir" spellcheck="false" ` +
    `value="${esc(suggested)}" aria-describedby="sd-dir-hint"></div>` +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    `<button type="button" class="btn sm" data-act="open-folder">` +
    `${icon('folder', { size: 15 })}<span>Abrir carpeta</span></button>` +
    `<button type="button" class="btn sm" data-act="move-here">` +
    `${icon('retry', { size: 15 })}<span>Mover aquí</span></button>` +
    '</div>' +
    '<span class="hint" id="sd-dir-hint">El contenido del port vive en esta carpeta; ' +
    'las partidas guardadas están en <span class="mono">saves/</span>.</span>' +
    '</div>' +
    romSection(port, game) +
    launchSection(port, game) +
    '<div class="sbox">' +
    '<h3>Estado</h3>' +
    `<div style="display:flex;gap:6px;flex-wrap:wrap">${devChip(port)}${statePill(game.state)}</div>` +
    `<dl class="kv">` +
    `<dt>pid</dt><dd class="mono">${esc(port.pid)}</dd>` +
    `<dt>Estrategia</dt><dd>${esc(port.installStrategy)}</dd>` +
    `<dt>Pinned</dt><dd>${esc(game.pinnedVersion || 'no')}</dd>` +
    `<dt>Auto-actualizar</dt><dd>${game.autoUpdate ? 'sí' : 'no'}</dd>` +
    (game.error ? `<dt>Último error</dt><dd>${esc(game.error)}</dd>` : '') +
    '</dl></div>' +
    '</div>' +
    '<div class="dfoot">' +
    `<button type="button" class="btn sm dng" data-act="ask-uninstall">` +
    `${icon('trash', { size: 15 })}<span>Desinstalar</span></button>` +
    '<span class="spacer" style="margin-left:auto"></span>' +
    `<button type="button" class="btn pri sm" data-act="play">` +
    `${icon('play', { size: 15 })}<span>Jugar</span></button>` +
    '</div>'
  );
}

function confirmInner(port: PortItem, game: LibraryGame): string {
  return (
    '<div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="sd-confirm-title">' +
    '<div class="mhead">' +
    `<h2 id="sd-confirm-title">Desinstalar ${esc(port.name)}</h2>` +
    `<button type="button" class="x" data-act="confirm-close" title="Cerrar" aria-label="Cerrar">${icon('close', { size: 16 })}</button>` +
    '</div>' +
    '<div class="mbody">' +
    '<p style="margin:0;font-size:var(--fs-s)">Se borrará el contenido de ' +
    `<span class="mono">${esc(dash(game.installDir))}</span>. ` +
    'La ROM que aportaste no se toca: PortsHub nunca borra archivos del usuario.</p>' +
    '<label class="chk"><input type="checkbox" id="sd-keep" checked>' +
    '<span class="ctxt"><b>Conservar partidas guardadas</b>' +
    '<span>Mantiene saves/, ajustes y mods propios del port.</span></span></label>' +
    '</div>' +
    '<div class="mfoot">' +
    `<button type="button" class="btn sm" data-act="confirm-close">Cancelar</button>` +
    '<span class="spacer"></span>' +
    `<button type="button" class="btn dng" data-act="confirm-uninstall">` +
    `${icon('trash', { size: 15 })}<span>Desinstalar</span></button>` +
    '</div></div>'
  );
}

/* -------------------------------------------------------------------------- */
/* Montaje                                                                    */
/* -------------------------------------------------------------------------- */

export function mountSettingsDrawer(options: SettingsDrawerOptions = {}): SettingsDrawerHandle {
  const host = options.host ?? document.getElementById('layer') ?? document.body;

  const el = document.createElement('aside');
  el.className = 'drawer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Ajustes del port');
  el.hidden = true;
  host.append(el);

  const confirmEl = document.createElement('div');
  confirmEl.className = 'scrim';
  confirmEl.dataset.modal = 'uninstall';
  confirmEl.hidden = true;
  host.append(confirmEl);

  let pid: string | null = null;
  let restoreFocus: HTMLElement | null = null;

  function port(): PortItem | null {
    return pid ? catalogService.getPortByPid(pid) ?? null : null;
  }

  function game(): LibraryGame {
    return pid ? libraryService.getLibraryGame(pid) : libraryService.getLibraryGame('');
  }

  function paint(): void {
    const current = port();
    if (!current) return;
    el.innerHTML = drawerInner(current, game());
  }

  function paintConfirm(): void {
    const current = port();
    if (!current) return;
    confirmEl.innerHTML = confirmInner(current, game());
  }

  function open(nextPid: string): void {
    const current = catalogService.getPortByPid(nextPid);
    if (!current) {
      options.onToast?.(`No se encontró el port ${nextPid} en el índice.`, 'err');
      return;
    }
    if (el.hidden) {
      const active = document.activeElement;
      restoreFocus = active instanceof HTMLElement ? active : null;
    }
    pid = nextPid;
    paint();
    el.hidden = false;
    el.querySelector<HTMLElement>('[data-act="close"]')?.focus();
  }

  function close(): void {
    if (el.hidden) return;
    el.hidden = true;
    el.innerHTML = '';
    confirmEl.hidden = true;
    confirmEl.innerHTML = '';
    pid = null;
    if (restoreFocus && document.contains(restoreFocus)) {
      try {
        restoreFocus.focus();
      } catch {
        /* foco no restaurable */
      }
    }
    restoreFocus = null;
  }

  function currentPort(): PortItem | null {
    const current = port();
    if (!current) {
      options.onToast?.('El cajón se cerró: ficha no disponible.', 'warn');
      close();
      return null;
    }
    return current;
  }

  function persist(patch: Partial<LibraryGame>): void {
    if (!pid) return;
    libraryService.updateLibraryGame(pid, patch);
    options.onChanged?.(pid);
    paint();
  }

  /* ------------------------------- eventos ------------------------------- */

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target === el) return;

    const hit = target.closest<HTMLElement>('[data-act]');
    if (!hit) return;
    if (hit instanceof HTMLButtonElement && hit.disabled) return;
    const act = hit.dataset.act;
    const current = currentPort();
    if (!current) return;

    switch (act) {
      case 'close':
        event.preventDefault();
        close();
        return;
      case 'open-folder': {
        event.preventDefault();
        const path = game().installDir || resolveInstallDir(current);
        const clipboard = (globalThis as { navigator?: Navigator }).navigator?.clipboard;
        clipboard
          ?.writeText(path)
          .then(() => options.onToast?.(`Ruta copiada: ${path}`, 'info'))
          .catch(() => options.onToast?.(`Ruta: ${path}`, 'info'));
        return;
      }
      case 'move-here': {
        event.preventDefault();
        const input = el.querySelector<HTMLInputElement>('[data-field="installDir"]');
        const value = str(input?.value);
        if (!value) {
          options.onToast?.('Escribe una carpeta de destino.', 'warn');
          input?.focus();
          return;
        }
        persist({ installDir: value });
        options.onToast?.(`Se moverá el port a ${value} (simulado en esta fase).`, 'ok');
        return;
      }
      case 'change-rom':
        event.preventDefault();
        options.onOpenRomAssistant?.(current.pid);
        return;
      case 'revalidate': {
        event.preventDefault();
        const romPath = str(game().romPath);
        if (!romPath) {
          options.onToast?.('No hay ROM registrada para revalidar.', 'warn');
          return;
        }
        const result = installerService.validateRom(current, romPath, game().romMode);
        libraryService.setRom(current.pid, romPath, game().romMode, result.ok);
        options.onChanged?.(current.pid);
        paint();
        options.onToast?.(result.message, result.ok ? 'ok' : 'err');
        return;
      }
      case 'ask-uninstall':
        event.preventDefault();
        paintConfirm();
        confirmEl.hidden = false;
        confirmEl.querySelector<HTMLElement>('[data-act="confirm-uninstall"]')?.focus();
        return;
      case 'play':
        event.preventDefault();
        options.onLaunch?.(current.pid);
        return;
      default:
        return;
    }
  }

  function onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const current = port();
    if (!current || !pid) return;

    if (target instanceof HTMLInputElement && target.name === 'sd-rom-mode') {
      const mode: RomMode = target.value === 'copy' ? 'copy' : 'link';
      const romPath = str(game().romPath);
      const validated = !!str(game().romValidatedAt) && !!romPath;
      libraryService.setRom(pid, romPath || null, mode, validated);
      options.onChanged?.(pid);
      paint();
      return;
    }

    if (target instanceof HTMLInputElement && target.dataset.field) {
      const field = target.dataset.field;
      const value = target.value;
      if (field === 'installDir') {
        persist({ installDir: value });
        return;
      }
      if (field === 'executable' || field === 'args' || field === 'runner') {
        const next: LaunchProfile = { ...(game().launchProfile ?? {}) };
        if (field === 'executable') next.executable = value || null;
        if (field === 'args') next.args = value.trim() ? value.trim().split(/\s+/) : [];
        if (field === 'runner') next.runner = value;
        persist({ launchProfile: next });
      }
      return;
    }

    if (target instanceof HTMLSelectElement && target.dataset.field === 'runner') {
      const next: LaunchProfile = { ...(game().launchProfile ?? {}), runner: target.value };
      persist({ launchProfile: next });
    }
  }

  function onConfirmClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target === confirmEl) {
      confirmEl.hidden = true;
      return;
    }
    const hit = target.closest<HTMLElement>('[data-act]');
    if (!hit) return;
    if (hit instanceof HTMLButtonElement && hit.disabled) return;
    const act = hit.dataset.act;
    const current = currentPort();
    if (!current) return;

    if (act === 'confirm-close') {
      event.preventDefault();
      confirmEl.hidden = true;
      confirmEl.innerHTML = '';
      return;
    }
    if (act === 'confirm-uninstall') {
      event.preventDefault();
      const keep = confirmEl.querySelector<HTMLInputElement>('#sd-keep');
      const keepSaves = keep ? keep.checked : true;
      const targetPid = current.pid;
      confirmEl.hidden = true;
      confirmEl.innerHTML = '';
      close();
      options.onUninstall?.(targetPid, keepSaves);
    }
  }

  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  confirmEl.addEventListener('click', onConfirmClick);

  return {
    el,
    confirmEl,
    open,
    close,
    isOpen(): boolean {
      return !el.hidden && pid !== null;
    },
    refresh(): void {
      paint();
    },
    destroy(): void {
      el.removeEventListener('click', onClick);
      el.removeEventListener('change', onChange);
      confirmEl.removeEventListener('click', onConfirmClick);
      el.remove();
      confirmEl.remove();
      pid = null;
    },
  };
}

export default mountSettingsDrawer;
