/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/RomAssistantModal.ts
 *
 * Asistente de ROM (`.scrim` > `.modal`): arrastrar y soltar, validación
 * contra `setupFiles`/`romProfile` (extensión + SHA-1) y elección del modo de
 * enlace (`link` = usar donde está · `copy` = copiar a la carpeta del port).
 *
 * Contrato con el CSS (`launcher/src/styles/layout.css`):
 *   .drop / .drop.over / .dt / .dh / .dbig        (§12)
 *   .opt / .oname / .odesc / .otag / :has(input)  (§12)
 *   .chk / .ctxt                                   (§12)
 *   .field / .hint.ok / .hint.bad / .in-txt        (§12)
 *
 * Garantía que se muestra al usuario en todo momento: **el archivo original
 * nunca se mueve ni se borra**; el modo `copy` duplica y `link` sólo
 * referencia la ruta existente.
 * ========================================================================== */

import type { PortItem, RomMode, SetupFile } from '../services/types';
import { ROM_BINDING_LABELS } from '../services/types';
import { catalogService } from '../services/catalogService';
import { libraryService } from '../services/libraryService';
import { installerService } from '../services/installerService';
import type { RomValidation } from '../services/installerService';
import { describeRomFileSet } from '../ui/model';
import { esc, icon } from './Icons';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export interface RomAssistantOptions {
  /** Contenedor del modal (por defecto `#layer` o `body`). */
  host?: HTMLElement | null;
  /** Texto del botón primario ('Guardar' por defecto). */
  primaryLabel?: string;
  /** Texto del botón secundario ('Cancelar' por defecto). */
  secondaryLabel?: string;
  /** Modo preseleccionado (por defecto el de los ajustes). */
  defaultMode?: RomMode;
  /** La ficha ya está lista: tras guardar, el flujo puede lanzar el port. */
  playAfterSave?: boolean;
  onSaved?: (pid: string, validation: RomValidation, opts: { play: boolean }) => void;
  onCancel?: (pid: string) => void;
  onToast?: (message: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
}

export interface RomAssistantOpenOptions {
  primaryLabel?: string;
  secondaryLabel?: string;
  mode?: RomMode;
  playAfterSave?: boolean;
}

export interface RomAssistantHandle {
  readonly el: HTMLElement;
  open(pid: string, opts?: RomAssistantOpenOptions): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

interface AssistantState {
  pid: string | null;
  mode: RomMode;
  /** Ruta o nombre del fichero seleccionado. */
  fileName: string;
  /** `File` real (permite hashear) o `null` si es un ejemplo/ruta. */
  file: File | null;
  /**
   * Selección completa (HU-15). Un disco de PlayStation/Saturn es un `.cue` más
   * sus pistas `.bin`, así que se conservan **todos** los ficheros soltados y no
   * sólo el primero (que en una carpeta suele ser una pista, no el descriptor).
   */
  files: File[];
  /** Cuántas pistas acompañan al fichero principal. */
  companions: number;
  /** Etiqueta legible: `Dino Crisis 2.cue (+2 archivos de pistas)`. */
  label: string;
  validation: RomValidation | null;
  busy: boolean;
  /** Mensaje de error de lectura del fichero. */
  error: string | null;
  primaryLabel: string;
  secondaryLabel: string;
  playAfterSave: boolean;
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Extensiones admitidas por el port (de `romProfile` o de `setupFiles`). */
export function acceptedExtensions(port: PortItem): string[] {
  const fromProfile = (port.romProfile?.extensions ?? [])
    .map((ext) => String(ext).replace(/^\./, '').trim().toLowerCase())
    .filter(Boolean);
  if (fromProfile.length > 0) return fromProfile;

  const fromFiles = (port.setupFiles ?? [])
    .flatMap((file: SetupFile) => {
      const name = str(file.name);
      const match = /\.([a-z0-9]{2,5})$/i.exec(name);
      return match ? [match[1].toLowerCase()] : [];
    })
    .filter(Boolean);
  if (fromFiles.length > 0) return [...new Set(fromFiles)];

  return [];
}

/** Ficheros que el usuario debe aportar, según el índice. */
export function requiredUserFiles(port: PortItem): SetupFile[] {
  const files = (port.setupFiles ?? []).filter((file) => {
    if (!file || typeof file !== 'object') return false;
    const kind = String(file.kind ?? file['type'] ?? '').toLowerCase();
    return file.required === true || /rom|bios|asset|data/.test(kind) || !str(file.url);
  });
  return files;
}

/** Nombre de ejemplo que pasaría la validación de extensión. */
function sampleName(port: PortItem): string {
  const exts = acceptedExtensions(port);
  const ext = exts[0] ?? 'rom';
  const slug = port.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'juego';
  return `${slug}.${ext}`;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

function requirementsBox(port: PortItem): string {
  const exts = acceptedExtensions(port);
  const accepted = (port.romProfile?.accepted ?? [])
    .map((entry) => String(entry.sha1 ?? '').toLowerCase())
    .filter((hash) => /^[0-9a-f]{40}$/.test(hash));
  const files = requiredUserFiles(port);
  const binding = port.romProfile?.binding ?? 'in-app';
  const destination = str(port.romProfile?.destination) || '(carpeta del port)';

  const rows: string[] = [
    `<dt>Extensiones</dt><dd class="mono">${
      exts.length ? exts.map((ext) => `.${ext}`).join(', ') : 'no declaradas'
    }</dd>`,
    `<dt>Destino</dt><dd class="mono">${esc(destination)}</dd>`,
    `<dt>Enlace</dt><dd>${esc(ROM_BINDING_LABELS[binding] ?? binding)}</dd>`,
  ];
  if (accepted.length > 0) {
    rows.push(
      `<dt>SHA-1</dt><dd class="mono">${accepted
        .slice(0, 3)
        .map((hash) => `${hash.slice(0, 10)}…`)
        .join('<br>')}${accepted.length > 3 ? `<br>+${accepted.length - 3} más` : ''}</dd>`
    );
  }
  if (files.length > 0) {
    rows.push(
      `<dt>Ficheros</dt><dd class="mono">${files
        .slice(0, 3)
        .map((file) => esc(str(file.name) || 'sin nombre'))
        .join('<br>')}</dd>`
    );
  }

  return `<div class="sbox"><h3>Requisitos de la ROM</h3><dl class="kv">${rows.join('')}</dl></div>`;
}

function modeOption(
  value: RomMode,
  title: string,
  desc: string,
  current: RomMode,
  tag: string
): string {
  const checked = value === current;
  return (
    `<label class="opt${checked ? ' on' : ''}" data-opt="${value}">` +
    `<input type="radio" name="rom-mode" value="${value}"${checked ? ' checked' : ''} ` +
    'aria-label="' + esc(title) + '">' +
    '<span><span class="oname">' + esc(title) + '</span>' +
    `<span class="odesc">${esc(desc)}</span></span>` +
    `<span class="otag">${esc(tag)}</span>` +
    '</label>'
  );
}

function validationMarkup(state: AssistantState): string {
  if (state.busy) {
    return (
      '<div class="field"><span class="hint">' +
      `${icon('spinner', { size: 14 })} Comprobando el fichero…</span></div>`
    );
  }
  const validation = state.validation;
  if (!validation) {
    return (
      '<div class="field"><span class="hint">' +
      'Aún no se ha elegido ningún fichero. Puedes arrastrarlo aquí abajo.</span></div>'
    );
  }
  const cls = validation.ok ? 'hint ok' : 'hint bad';
  const glyph = validation.ok ? '✓' : '✕';
  const warnings = validation.warnings.length
    ? `<span class="hint">${esc(validation.warnings.join(' · '))}</span>`
    : '';
  return (
    `<div class="field"><span class="${cls}">${glyph} ${esc(validation.message)}</span>` +
    warnings +
    (validation.sha1
      ? `<span class="hint mono">SHA-1: ${esc(validation.sha1)}</span>`
      : '') +
    '</div>'
  );
}

function assistantInner(port: PortItem, state: AssistantState): string {
  const exts = acceptedExtensions(port);
  const dropClass = 'drop' + (state.busy ? ' is-busy' : '');
  /* El label del conjunto manda: `Dino Crisis 2.cue (+2 archivos de pistas)`
   * dice mucho más que el nombre suelto del descriptor. */
  const fileName = state.label || (state.fileName ? baseName(state.fileName) : '');
  /* Los descriptores de disco se aceptan siempre: sin `.cue`/`.gdi` en el
   * diálogo el usuario no podría elegir el fichero que el emulador abre. */
  const accept = [...new Set([...exts, 'cue', 'gdi', 'm3u'])];
  const companionHint =
    state.companions > 0
      ? `<span class="dh">${state.companions} ${
          state.companions === 1 ? 'archivo de pistas asociado' : 'archivos de pistas asociados'
        }</span>`
      : '';

  return (
    '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="rom-title">' +
    '<div class="mhead">' +
    '<h2 id="rom-title">Asistente de ROM</h2>' +
    '<button type="button" class="x" data-act="close" title="Cerrar" aria-label="Cerrar">' +
    `${icon('close', { size: 16 })}</button>` +
    '</div>' +
    '<div class="mbody">' +
    '<p style="margin:0;font-size:var(--fs-s)">' +
    `<b>${esc(port.name)}</b> necesita un fichero que sólo puedes aportar tú. ` +
    'PortsHub no descarga ROMs ni contenido con copyright: sólo enlaza el archivo que ya tienes.' +
    '</p>' +
    `<div class="${dropClass}" data-drop="rom" tabindex="0" role="button" ` +
    'aria-label="Suelta aquí tus archivos de ROM o pulsa para elegirlos">' +
    `<span class="dbig" aria-hidden="true">${icon('rom', { size: 30 })}</span>` +
    `<span class="dt">${fileName ? esc(fileName) : 'Suelta aquí tu archivo de ROM'}</span>` +
    `<span class="dh">${esc(
      exts.length ? `Formatos admitidos: ${exts.map((ext) => `.${ext}`).join(', ')}` : 'Cualquier formato declarado por el port'
    )}</span>` +
    companionHint +
    '<span class="dh">o suelta el .cue con sus .bin, o pulsa para elegir</span>' +
    `<input id="rom-file" type="file" hidden multiple accept="${esc(accept.map((ext) => `.${ext}`).join(','))}">` +
    '<input id="rom-dir" type="file" hidden multiple webkitdirectory directory>' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    `<button type="button" class="btn sm pri" data-act="pick" ${state.busy ? 'disabled' : ''}>` +
    `${icon('folder', { size: 15 })}<span>Elegir archivo…</span></button>` +
    `<button type="button" class="btn sm" data-act="pick-dir" ${state.busy ? 'disabled' : ''} ` +
    'title="Elige la carpeta del disco para traer el .cue y todas sus pistas">' +
    `${icon('folder', { size: 15 })}<span>Carpeta del disco…</span></button>` +
    `<button type="button" class="btn sm" data-act="sample" ${state.busy ? 'disabled' : ''} ` +
    'title="Usa un nombre de ejemplo para probar el flujo sin fichero real">' +
    `${icon('dot', { size: 15 })}<span>Usar ROM de ejemplo</span></button>` +
    '</div>' +
    validationMarkup(state) +
    '<div class="field"><label>¿Cómo quieres usarla?</label></div>' +
    modeOption(
      'link',
      'Usarla desde donde está',
      'Se guarda la ruta y se enlaza (sin mover el archivo)',
      state.mode,
      'recomendado'
    ) +
    modeOption('copy', 'Copiarla a la carpeta del port', 'Se duplica dentro del port', state.mode, 'copia') +
    '<p class="mono" style="margin:0;font-size:var(--fs-2xs);color:var(--muted)">' +
    'El archivo original nunca se mueve ni se borra.' +
    '</p>' +
    requirementsBox(port) +
    '</div>' +
    '<div class="mfoot">' +
    `<button type="button" class="btn sm" data-act="later">${esc(state.secondaryLabel)}</button>` +
    '<span class="spacer"></span>' +
    `<button type="button" class="btn pri" data-act="save" ` +
    `${state.validation && state.validation.ok ? '' : 'disabled aria-disabled="true"'}>` +
    `${icon(state.playAfterSave ? 'play' : 'save', { size: 16 })}` +
    `<span>${esc(state.primaryLabel)}</span></button>` +
    '</div>' +
    '</div>'
  );
}

/** HTML completo del asistente (con `scrim`), útil para tests y SSR. */
export function renderRomAssistant(port: PortItem, options: RomAssistantOpenOptions = {}): string {
  const settings = libraryService.getSettings();
  const state: AssistantState = {
    pid: port.pid,
    mode: options.mode ?? settings.romMode,
    fileName: '',
    file: null,
    files: [],
    companions: 0,
    label: '',
    validation: null,
    busy: false,
    error: null,
    primaryLabel: options.primaryLabel ?? 'Guardar',
    secondaryLabel: options.secondaryLabel ?? 'Cancelar',
    playAfterSave: options.playAfterSave ?? false,
  };
  return `<div class="scrim" data-modal="rom" hidden>${assistantInner(port, state)}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Montaje                                                                    */
/* -------------------------------------------------------------------------- */

export function mountRomAssistant(options: RomAssistantOptions = {}): RomAssistantHandle {
  const host = options.host ?? document.getElementById('layer') ?? document.body;

  const el = document.createElement('div');
  el.className = 'scrim';
  el.dataset.modal = 'rom';
  el.hidden = true;
  host.append(el);

  const settings = libraryService.getSettings();
  const state: AssistantState = {
    pid: null,
    mode: options.defaultMode ?? settings.romMode,
    fileName: '',
    file: null,
    files: [],
    companions: 0,
    label: '',
    validation: null,
    busy: false,
    error: null,
    primaryLabel: options.primaryLabel ?? 'Guardar',
    secondaryLabel: options.secondaryLabel ?? 'Cancelar',
    playAfterSave: options.playAfterSave ?? false,
  };
  let restoreFocus: HTMLElement | null = null;

  function port(): PortItem | null {
    return state.pid ? catalogService.getPortByPid(state.pid) ?? null : null;
  }

  function paint(): void {
    const current = port();
    if (!current) return;
    el.innerHTML = assistantInner(current, state);
  }

  function fileInput(): HTMLInputElement | null {
    return el.querySelector<HTMLInputElement>('#rom-file');
  }

  function dirInput(): HTMLInputElement | null {
    return el.querySelector<HTMLInputElement>('#rom-dir');
  }

  function open(pid: string, openOpts: RomAssistantOpenOptions = {}): void {
    const current = catalogService.getPortByPid(pid);
    if (!current) {
      options.onToast?.(`No se encontró el port ${pid} en el índice.`, 'err');
      return;
    }
    const wasHidden = el.hidden;
    state.pid = pid;
    state.mode = openOpts.mode ?? libraryService.getSettings().romMode;
    state.fileName = '';
    state.file = null;
    state.files = [];
    state.companions = 0;
    state.label = '';
    state.validation = null;
    state.busy = false;
    state.error = null;
    state.primaryLabel = openOpts.primaryLabel ?? options.primaryLabel ?? 'Guardar';
    state.secondaryLabel = openOpts.secondaryLabel ?? options.secondaryLabel ?? 'Cancelar';
    state.playAfterSave = openOpts.playAfterSave ?? options.playAfterSave ?? false;

    if (wasHidden) {
      const active = document.activeElement;
      restoreFocus = active instanceof HTMLElement ? active : null;
    }
    paint();
    el.hidden = false;
    el.querySelector<HTMLElement>('[data-act="pick"]')?.focus();
  }

  function close(): void {
    if (el.hidden) return;
    const pid = state.pid;
    el.hidden = true;
    el.innerHTML = '';
    state.pid = null;
    if (restoreFocus && document.contains(restoreFocus)) {
      try {
        restoreFocus.focus();
      } catch {
        /* foco no restaurable */
      }
    }
    restoreFocus = null;
    if (pid) options.onCancel?.(pid);
  }

  async function validate(): Promise<void> {
    const current = port();
    if (!current) return;
    if (!state.fileName) {
      state.validation = null;
      paint();
      return;
    }
    state.busy = true;
    state.error = null;
    paint();
    try {
      const input = state.file ?? state.fileName;
      const validation = await installerService.validateRomAsync(current, input, state.mode);
      state.validation = validation;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.validation = null;
      options.onToast?.(state.error, 'err');
    } finally {
      state.busy = false;
      paint();
    }
  }

  /**
   * Registra la selección del usuario (HU-15).
   *
   * Un disco de PlayStation/Saturn no es un fichero: es un `.cue` más sus
   * pistas `.bin`. Se analiza la **lista completa** con `describeRomFileSet`
   * para quedarse con el descriptor como principal y contar los acompañantes;
   * antes se tomaba `files[0]`, que al arrastrar una carpeta suele ser una
   * pista y dejaba el disco inutilizable.
   */
  function chooseFiles(list: readonly File[]): void {
    const current = port();
    if (!current) return;
    const files = (list ?? []).filter((file) => !!file && !!str(file.name));
    if (files.length === 0) return;

    const selection = describeRomFileSet(files);
    const main = selection.main;
    if (!main) return;

    const exts = acceptedExtensions(current);
    const name = main.name.toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
    state.files = files.slice();
    state.companions = selection.companions.length;
    state.label = selection.label;
    state.fileName = main.name;
    state.file = main;

    /* Los descriptores de disco se aceptan aunque el perfil sólo declare la
     * extensión de las pistas: es justo el fichero que el emulador abre. */
    const isDescriptor = /^(cue|gdi|m3u)$/.test(ext);
    if (!isDescriptor && exts.length > 0 && ext && !exts.includes(ext)) {
      state.validation = {
        ok: false,
        romPath: main.name,
        romMode: state.mode,
        validatedAt: null,
        destination: str(current.romProfile?.destination) || '.',
        sha1: null,
        message: `Extensión ".${ext}" no admitida. Se esperaba: ${exts
          .map((item) => `.${item}`)
          .join(', ')}.`,
        warnings: [],
      };
      paint();
      return;
    }
    void validate();
  }

  function save(): void {
    const current = port();
    if (!current || !state.pid) return;
    const validation = state.validation;
    if (!validation || !validation.ok) {
      options.onToast?.('Elige un fichero de ROM válido antes de guardar.', 'warn');
      return;
    }
    const game = libraryService.setRom(state.pid, validation.romPath, state.mode, true);
    options.onToast?.(
      game.state === 'Ready'
        ? 'ROM guardada. El port está listo para jugar.'
        : 'ROM guardada. Termina la instalación para jugar.',
      'ok'
    );
    const pid = state.pid;
    const play = state.playAfterSave;
    el.hidden = true;
    el.innerHTML = '';
    state.pid = null;
    options.onSaved?.(pid, validation, { play });
  }

  function onPick(): void {
    const input = fileInput();
    if (!input) return;
    input.value = '';
    input.click();
  }

  /** Abre el selector de carpeta (`webkitdirectory`). */
  function onPickDir(): void {
    const input = dirInput();
    if (!input) return;
    input.value = '';
    input.click();
  }

  /**
   * `change` de cualquiera de los dos inputs.
   *
   * Se recogen **todos** los ficheros (`multiple` o el árbol de una carpeta),
   * no sólo el primero: un `.cue` suelto sin sus `.bin` no arranca el juego.
   */
  function onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id !== 'rom-file' && target.id !== 'rom-dir') return;
    const files = target.files ? Array.from(target.files) : [];
    if (files.length === 0) return;
    chooseFiles(files);
  }

  function onModeChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== 'rom-mode') return;
    state.mode = target.value === 'copy' ? 'copy' : 'link';
    void validate();
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target === el) {
      close();
      return;
    }

    // El `.drop` es zona de clic: abre el selector nativo.
    const drop = target.closest<HTMLElement>('[data-drop]');
    if (drop && !target.closest('[data-act]')) {
      event.preventDefault();
      onPick();
      return;
    }

    const hit = target.closest<HTMLElement>('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (hit instanceof HTMLButtonElement && hit.disabled) return;

    if (act === 'close' || act === 'later') {
      event.preventDefault();
      close();
      return;
    }
    if (act === 'pick') {
      event.preventDefault();
      onPick();
      return;
    }
    if (act === 'pick-dir') {
      event.preventDefault();
      onPickDir();
      return;
    }
    if (act === 'sample') {
      event.preventDefault();
      const current = port();
      if (!current) return;
      state.file = null;
      state.files = [];
      state.companions = 0;
      state.label = '';
      state.fileName = sampleName(current);
      void validate();
      return;
    }
    if (act === 'save') {
      event.preventDefault();
      save();
    }
  }

  /* ------------------------- arrastrar y soltar -------------------------- */

  let dragDepth = 0;

  function dropZone(): HTMLElement | null {
    return el.querySelector<HTMLElement>('[data-drop]');
  }

  function onDragEnter(event: DragEvent): void {
    const zone = dropZone();
    if (!zone || !zone.contains(event.target as Node)) return;
    event.preventDefault();
    dragDepth += 1;
    zone.classList.add('over');
  }

  function onDragOver(event: DragEvent): void {
    const zone = dropZone();
    if (!zone || !zone.contains(event.target as Node)) return;
    event.preventDefault();
    zone.classList.add('over');
  }

  function onDragLeave(event: DragEvent): void {
    const zone = dropZone();
    if (!zone) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) zone.classList.remove('over');
    void event;
  }

  function onDrop(event: DragEvent): void {
    const zone = dropZone();
    if (!zone || !zone.contains(event.target as Node)) return;
    event.preventDefault();
    dragDepth = 0;
    zone.classList.remove('over');
    /* Todos los ficheros soltados, no el primero: al arrastrar la carpeta de un
     * disco el navegador entrega el `.cue` y sus pistas `.bin` en la misma
     * lista. */
    const files = event.dataTransfer ? Array.from(event.dataTransfer.files ?? []) : [];
    if (files.length === 0) return;
    chooseFiles(files);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.drop !== undefined) {
      event.preventDefault();
      onPick();
    }
  }

  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('change', onModeChange);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('dragenter', onDragEnter);
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop', onDrop);

  return {
    el,
    open,
    close,
    isOpen(): boolean {
      return !el.hidden && state.pid !== null;
    },
    destroy(): void {
      el.removeEventListener('click', onClick);
      el.removeEventListener('change', onChange);
      el.removeEventListener('change', onModeChange);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('dragenter', onDragEnter);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
      el.remove();
    },
  };
}

export default mountRomAssistant;
