/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/services/installerService.ts
 *
 * Máquina de estados de instalación (Anexo D.3):
 *
 *   NotInstalled → Downloading → Installing → Installed → (NeedsRom) → Ready
 *
 * En esta fase la descarga/extracción son **simuladas** (no hay backend de
 * ficheros todavía): se emiten progresos realistas con temporizadores y se
 * persiste cada transición en `libraryService`, de forma que la UI puede
 * reanudar la vista aunque se recargue la pestaña. Cuando exista el backend
 * real, sólo hay que sustituir `simulateDownload()` / `simulateExtract()` por
 * la llamada de red, manteniendo intactas las transiciones.
 * ========================================================================== */

import type { LibraryGame, LibraryState, PortItem, RomMode, RomProfile } from './types';

import libraryService, { createLibraryGame } from './libraryService';

/* -------------------------------------------------------------------------- */
/* Tipos públicos                                                             */
/* -------------------------------------------------------------------------- */

/** Etapas que puede reportar el instalador a la UI. */
export const INSTALL_STAGES = [
  'prepare',
  'download',
  'extract',
  'verify',
  'rom',
  'done',
] as const;
export type InstallStage = (typeof INSTALL_STAGES)[number];

export const INSTALL_STAGE_LABELS: Record<InstallStage, string> = {
  prepare: 'Preparando…',
  download: 'Descargando…',
  extract: 'Extrayendo…',
  verify: 'Verificando…',
  rom: 'Comprobando ROM…',
  done: 'Listo',
};

/** `(pct 0–100, etapa legible)` — la firma que espera la pantalla de lanzamiento. */
export type ProgressCallback = (pct: number, stage: string) => void;

export interface RomValidation {
  ok: boolean;
  romPath: string;
  romMode: RomMode;
  validatedAt: string | null;
  /** Destino calculado dentro del directorio del port (si procede). */
  destination: string;
  /** SHA-1 calculado (40 hex) cuando hay bytes disponibles; si no, `null`. */
  sha1: string | null;
  /** Mensaje legible: éxito, aviso o causa del fallo. */
  message: string;
  warnings: string[];
}

/** Error con `name` estable para distinguir cancelación de fallo real. */
export class InstallCancelledError extends Error {
  readonly pid: string;

  constructor(pid: string) {
    super(`Instalación cancelada: ${pid}`);
    this.name = 'InstallCancelledError';
    this.pid = pid;
  }
}

export function isCancelError(error: unknown): boolean {
  return error instanceof InstallCancelledError || (!!error && (error as Error).name === 'InstallCancelledError');
}

/* -------------------------------------------------------------------------- */
/* Transiciones permitidas (Anexo D.3)                                        */
/* -------------------------------------------------------------------------- */

/** Matriz de transiciones válidas de la máquina de estados. */
export const INSTALL_TRANSITIONS: Record<LibraryState, readonly LibraryState[]> = {
  NotInstalled: ['Downloading', 'NeedsRom', 'Ready', 'Broken'],
  Downloading: ['Installing', 'NotInstalled', 'Broken'],
  Installing: ['Installed', 'NotInstalled', 'Broken'],
  Installed: ['NeedsRom', 'Ready', 'UpdateAvailable', 'NotInstalled', 'Broken'],
  NeedsRom: ['Ready', 'NotInstalled', 'Broken', 'UpdateAvailable'],
  Ready: ['NeedsRom', 'UpdateAvailable', 'NotInstalled', 'Broken'],
  UpdateAvailable: ['Downloading', 'Ready', 'NotInstalled', 'Broken'],
  Broken: ['NotInstalled', 'Downloading', 'Ready'],
};

export function canTransition(from: LibraryState, to: LibraryState): boolean {
  if (from === to) return true;
  return (INSTALL_TRANSITIONS[from] ?? []).includes(to);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** FNV-1a: da una "personalidad" estable por pid (tamaño, velocidad, versión). */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function romProfileOf(port: PortItem): RomProfile {
  const profile = port.romProfile;
  return {
    binding: profile?.binding ?? 'in-app',
    destination: profile?.destination ?? null,
    extensions: Array.isArray(profile?.extensions) ? profile.extensions : [],
    accepted: Array.isArray(profile?.accepted) ? profile.accepted : [],
    notes: profile?.notes ?? null,
  };
}

/** ¿Este port necesita que el usuario aporte una ROM/fichero propio? */
export function portNeedsRom(port: PortItem): boolean {
  const files = port.requiresUserFiles ?? {};
  for (const value of Object.values(files)) {
    if (nonEmpty(value)) return true;
  }

  const profile = romProfileOf(port);
  if (profile.binding !== 'in-app' && (profile.extensions.length > 0 || profile.accepted.length > 0)) {
    return true;
  }

  const setupFiles = Array.isArray(port.setupFiles) ? port.setupFiles : [];
  if (
    setupFiles.some((file) => {
      if (!file || typeof file !== 'object') return false;
      if (file['required'] === true) return true;
      const kind = String(file['kind'] ?? file['type'] ?? '');
      return /rom|bios|asset|data/i.test(kind) && !nonEmpty(file['url']);
    })
  ) {
    return true;
  }

  const gameData = port.gameData as { required?: unknown } | null | undefined;
  if (gameData && typeof gameData === 'object' && gameData.required === true) return true;

  const raw = port.raw ?? {};
  return raw['needsRom'] === true || raw['requiresRom'] === true;
}

/** Ruta de instalación simulada: `<installDir>/<folderName|pid>`. */
export function resolveInstallDir(port: PortItem): string {
  const settings = libraryService.getSettings();
  const base = settings.installDir.replace(/\/+$/, '');
  const folder = nonEmpty(port.folderName) ? String(port.folderName) : port.pid;
  return `${base}/${folder}`;
}

function extensionOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function normalizeExtension(ext: unknown): string {
  return typeof ext === 'string' ? ext.replace(/^\./, '').trim().toLowerCase() : '';
}

async function sha1Hex(bytes: ArrayBuffer): Promise<string | null> {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj || !cryptoObj.subtle) return null;
  try {
    const digest = await cryptoObj.subtle.digest('SHA-1', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Servicio                                                                   */
/* -------------------------------------------------------------------------- */

interface InstallToken {
  cancelled: boolean;
}

/** Fichero aceptado por `validateRom` (ruta o `File` real para hashear). */
export type RomInput =
  | string
  | {
      name?: string;
      size?: number;
      arrayBuffer?: () => Promise<ArrayBuffer>;
    };

export class InstallerService {
  private tokens = new Map<string, InstallToken>();

  /* ----------------------------- consulta -------------------------------- */

  isInstalling(pid: string): boolean {
    return this.tokens.has(pid);
  }

  getActiveInstalls(): string[] {
    return [...this.tokens.keys()];
  }

  /* ------------------------------ instalación ---------------------------- */

  /**
   * Ejecuta la máquina de estados completa.
   *
   * @param port       Ficha del catálogo.
   * @param onProgress Callback opcional `(pct, etapa)`.
   * @throws {InstallCancelledError} si se llama a `cancelInstall(pid)`.
   */
  async installPort(port: PortItem, onProgress?: ProgressCallback): Promise<LibraryGame> {
    if (!port || !nonEmpty(port.pid)) {
      throw new Error('installPort: falta el pid del port');
    }
    const pid = port.pid;

    if (this.tokens.has(pid)) {
      throw new Error(`installPort: ya hay una instalación en curso para ${pid}`);
    }

    const token: InstallToken = { cancelled: false };
    this.tokens.set(pid, token);

    const seed = hashString(pid);
    const installDir = resolveInstallDir(port);
    const version = nonEmpty(port.verifiedRelease?.version)
      ? String(port.verifiedRelease?.version)
      : 'latest';

    const emit = (pct: number, stage: InstallStage | string): void => {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      try {
        onProgress?.(clamped, typeof stage === 'string' && stage in INSTALL_STAGE_LABELS
          ? INSTALL_STAGE_LABELS[stage as InstallStage]
          : String(stage));
      } catch {
        // Un callback roto no debe abortar la instalación.
      }
    };

    const guard = (): void => {
      if (token.cancelled) throw new InstallCancelledError(pid);
    };

    try {
      /* 1. Preparando ------------------------------------------------ */
      emit(0, 'prepare');
      this.transition(pid, 'Downloading', {
        installStrategy: port.installStrategy,
        installDir,
        installedVersion: null,
        installedAt: null,
        error: null,
        progress: 0,
        launchProfile: port.launch ?? {},
      });
      await this.sleep(90 + (seed % 60));
      guard();

      /* 2. Descarga simulada (0 → 70 %) ------------------------------ */
      const totalMb = 40 + (seed % 700);
      const speed = 8 + (seed % 16); // MB/s simulados
      const ticks = 20;
      const perTick = 70 / ticks;
      emit(0, 'download');
      for (let tick = 1; tick <= ticks; tick += 1) {
        // 120 ms por tick ≈ descarga de ~2,5 s, con jitter de ±35 ms.
        await this.sleep(120 + ((seed + tick * 37) % 70) - 35);
        guard();
        const pct = perTick * tick;
        emit(pct, 'download');
        libraryService.setProgress(pid, pct);
        if (tick === 1) {
          // Traza útil en consola durante la fase de simulación.
          // eslint-disable-next-line no-console
          console.info(
            `[installer] ${pid}: ~${totalMb} MB a ${speed} MB/s hacia ${installDir}`,
          );
        }
      }

      /* 3. Extracción / instalación (70 → 88 %) ---------------------- */
      this.transition(pid, 'Installing');
      const extractTicks = 8;
      for (let tick = 1; tick <= extractTicks; tick += 1) {
        await this.sleep(140);
        guard();
        const pct = 70 + (18 / extractTicks) * tick;
        emit(pct, 'extract');
        libraryService.setProgress(pid, pct);
      }

      /* 4. Verificación (88 → 96 %) ---------------------------------- */
      for (let tick = 1; tick <= 3; tick += 1) {
        await this.sleep(110);
        guard();
        const pct = 88 + (8 / 3) * tick;
        emit(pct, 'verify');
        libraryService.setProgress(pid, pct);
      }

      /* 5. Installed ------------------------------------------------ */
      this.transition(pid, 'Installed', {
        installDir,
        installedVersion: version,
        installedAt: nowIso(),
        progress: 96,
        error: null,
      });
      guard();

      /* 6. ¿Necesita ROM? ------------------------------------------- */
      const game = libraryService.getLibraryGame(pid);
      const needsRom = portNeedsRom(port);
      const hasValidRom = nonEmpty(game.romPath) && nonEmpty(game.romValidatedAt);

      if (!needsRom) {
        emit(100, 'done');
        return this.transition(pid, 'Ready', { progress: 100, error: null });
      }

      if (hasValidRom) {
        emit(100, 'done');
        return this.transition(pid, 'Ready', { progress: 100, error: null });
      }

      emit(100, 'rom');
      return this.transition(pid, 'NeedsRom', { progress: 100, error: null });
    } catch (error) {
      if (isCancelError(error)) {
        libraryService.updateLibraryGame(pid, {
          ...createLibraryGame(pid, port.installStrategy),
          state: 'NotInstalled',
          installDir: '',
          installedVersion: null,
          progress: 0,
          error: 'Instalación cancelada por el usuario.',
        });
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      libraryService.markBroken(pid, message);
      throw error;
    } finally {
      this.tokens.delete(pid);
    }
  }

  /** Cancela una instalación en curso. Devuelve `true` si había alguna. */
  cancelInstall(pid: string): boolean {
    const token = this.tokens.get(pid);
    if (!token) return false;
    token.cancelled = true;
    return true;
  }

  /** Cancela todas (al desmontar la pantalla de lanzamiento). */
  cancelAll(): void {
    for (const token of this.tokens.values()) token.cancelled = true;
  }

  /* --------------------------------- ROM --------------------------------- */

  /**
   * Valida la ROM elegida por el usuario.
   *
   * Comprueba extensión contra `romProfile.extensions` y, si se pasa un `File`
   * (o algo con `arrayBuffer()`), calcula el SHA-1 y lo contrasta con los
   * hashes aceptados. Con sólo una ruta no se puede hashear: se devuelve
   * `ok` según la extensión y un aviso de que el hash se verificará al lanzar.
   */
  validateRom(port: PortItem, filePath: RomInput, mode: RomMode): RomValidation {
    const profile = romProfileOf(port);
    const warnings: string[] = [];
    const name =
      typeof filePath === 'string' ? filePath : typeof filePath?.name === 'string' ? filePath.name : '';
    const destination = profile.destination ?? '.';

    if (!nonEmpty(name)) {
      return {
        ok: false,
        romPath: '',
        romMode: mode,
        validatedAt: null,
        destination,
        sha1: null,
        message: 'No se seleccionó ningún fichero.',
        warnings,
      };
    }

    const allowed = profile.extensions.map(normalizeExtension).filter(Boolean);
    const extension = extensionOf(name);

    if (allowed.length > 0 && !allowed.includes(extension)) {
      return {
        ok: false,
        romPath: name,
        romMode: mode,
        validatedAt: null,
        destination,
        sha1: null,
        message: `Extensión ".${extension || '?'}" no admitida. Se esperaba: ${allowed
          .map((ext) => `.${ext}`)
          .join(', ')}.`,
        warnings,
      };
    }

    if (allowed.length === 0 && extension === '') {
      warnings.push('El fichero no tiene extensión; se aceptará tal cual.');
    }

    if (mode === 'external') {
      warnings.push('Modo externo: la ROM no se copiará, se referenciará en su ubicación actual.');
    }

    if (profile.accepted.length > 0) {
      warnings.push(
        `Se esperaba uno de ${profile.accepted.length} hash(es) conocidos; la verificación completa se hará al lanzar.`,
      );
    }

    return {
      ok: true,
      romPath: name,
      romMode: mode,
      validatedAt: nowIso(),
      destination,
      sha1: null,
      message: `ROM válida (${extension ? `.${extension}` : 'sin extensión'}) → ${destination}`,
      warnings,
    };
  }

  /**
   * Igual que `validateRom` pero asíncrona: hashea el contenido si el input
   * expone `arrayBuffer()` y compara con `romProfile.accepted`.
   */
  async validateRomAsync(port: PortItem, filePath: RomInput, mode: RomMode): Promise<RomValidation> {
    const base = this.validateRom(port, filePath, mode);
    if (!base.ok || typeof filePath === 'string') return base;

    if (typeof filePath.arrayBuffer !== 'function') return base;

    let bytes: ArrayBuffer;
    try {
      bytes = await filePath.arrayBuffer();
    } catch (error) {
      return {
        ...base,
        ok: false,
        message: `No se pudo leer el fichero: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const sha1 = await sha1Hex(bytes);
    if (!sha1) {
      return { ...base, warnings: [...base.warnings, 'El navegador no permite calcular SHA-1.'] };
    }

    const profiles = romProfileOf(port);
    const accepted = profiles.accepted
      .map((entry) => String(entry.sha1 ?? '').toLowerCase())
      .filter((hash) => /^[0-9a-f]{40}$/.test(hash));

    if (accepted.length === 0) {
      return { ...base, sha1, message: `${base.message} · SHA-1 calculado: ${sha1}` };
    }

    if (!accepted.includes(sha1)) {
      return {
        ...base,
        ok: false,
        sha1,
        validatedAt: null,
        message: 'El SHA-1 de la ROM no coincide con ninguno de los esperados.',
      };
    }

    return {
      ...base,
      sha1,
      message: `${base.message} · SHA-1 verificado`,
      warnings: base.warnings.filter((warning) => !warning.startsWith('Se esperaba uno de')),
    };
  }

  /* ------------------------------ internos ------------------------------- */

  private transition(pid: string, next: LibraryState, patch: Partial<LibraryGame> = {}): LibraryGame {
    const current = libraryService.getLibraryGame(pid);
    if (!canTransition(current.state, next)) {
      // No bloqueamos: el catálogo puede traer estados históricos raros y es
      // preferible converger que dejar la ficha atascada. Sólo avisamos.
      // eslint-disable-next-line no-console
      console.warn(`[installer] transición no canónica ${current.state} → ${next} (${pid})`);
    }
    return libraryService.updateLibraryGame(pid, { ...patch, state: next });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, Math.round(ms)));
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton + API funcional                                                  */
/* -------------------------------------------------------------------------- */

export const installerService = new InstallerService();

/** Atajo equivalente a `installerService.installPort(port, onProgress)`. */
export function installPort(port: PortItem, onProgress?: ProgressCallback): Promise<LibraryGame> {
  return installerService.installPort(port, onProgress);
}

export function cancelInstall(pid: string): boolean {
  return installerService.cancelInstall(pid);
}

export function validateRom(port: PortItem, filePath: RomInput, mode: RomMode): RomValidation {
  return installerService.validateRom(port, filePath, mode);
}

export default installerService;
