/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/services/libraryService.ts
 *
 * Estado local del launcher: qué puertos están instalados, con qué versión,
 * si tienen ROM validada y qué ajustes eligió el usuario.
 *
 * Persistencia: `localStorage['portshub-library-v1']` con el mismo esquema que
 * `ports.json` (para poder exportarlo/importarlo como fichero). Si
 * `localStorage` no está disponible (modo privado, cuota llena, entorno sin
 * DOM, tests), se degrada a un almacén en memoria sin lanzar excepciones y
 * `isPersistent()` devuelve `false` para que la UI pueda avisar.
 * ========================================================================== */

import type {
  InstallStrategy,
  LaunchProfile,
  LibraryFile,
  LibraryGame,
  LibraryState,
  RomMode,
  Settings,
} from './types';

import {
  DEFAULT_SETTINGS,
  LIBRARY_SCHEMA_VERSION,
  LIBRARY_STORAGE_KEY,
  LIBRARY_STATES,
  MEDIA_MODES,
  ROM_MODES,
  VIEW_MODES,
  DEST_OPTIONS,
  MEDIA_STYLES,
  SOURCE_PLATFORMS,
} from './types';

/* -------------------------------------------------------------------------- */
/* Almacén seguro                                                             */
/* -------------------------------------------------------------------------- */

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage` si se puede escribir de verdad; si no, `null`. */
function detectStorage(): KeyValueStore | null {
  try {
    const candidate = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (!candidate) return null;
    const probe = '__portshub_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

/** Almacén en memoria que cumple el mismo contrato (fallback). */
class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptyLibrary(): LibraryFile {
  return {
    version: LIBRARY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    games: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Ficha de biblioteca neutra para un pid desconocido. */
export function createLibraryGame(pid: string, installStrategy: InstallStrategy = 'external'): LibraryGame {
  return {
    pid,
    installStrategy,
    installDir: '',
    installedVersion: null,
    state: 'NotInstalled',
    romPath: null,
    romMode: DEFAULT_SETTINGS.romMode,
    romValidatedAt: null,
    launchProfile: {},
    pinnedVersion: null,
    autoUpdate: true,
    installedAt: null,
    progress: 0,
    error: null,
  };
}

function sanitizeGame(pid: string, raw: unknown): LibraryGame {
  const base = createLibraryGame(pid);
  if (!isObject(raw)) return base;

  const state = raw['state'];
  const romMode = raw['romMode'];
  const launchProfile = raw['launchProfile'];

  return {
    pid,
    installStrategy:
      typeof raw['installStrategy'] === 'string'
        ? (raw['installStrategy'] as InstallStrategy)
        : base.installStrategy,
    installDir: typeof raw['installDir'] === 'string' ? raw['installDir'] : '',
    installedVersion:
      typeof raw['installedVersion'] === 'string' ? raw['installedVersion'] : null,
    state:
      typeof state === 'string' && (LIBRARY_STATES as readonly string[]).includes(state)
        ? (state as LibraryState)
        : 'NotInstalled',
    romPath: typeof raw['romPath'] === 'string' ? raw['romPath'] : null,
    romMode:
      typeof romMode === 'string' && (ROM_MODES as readonly string[]).includes(romMode)
        ? (romMode as RomMode)
        : base.romMode,
    romValidatedAt:
      typeof raw['romValidatedAt'] === 'string' ? raw['romValidatedAt'] : null,
    launchProfile: isObject(launchProfile) ? (launchProfile as LaunchProfile) : {},
    pinnedVersion: typeof raw['pinnedVersion'] === 'string' ? raw['pinnedVersion'] : null,
    autoUpdate: raw['autoUpdate'] !== false,
    installedAt: typeof raw['installedAt'] === 'string' ? raw['installedAt'] : null,
    progress: typeof raw['progress'] === 'number' ? raw['progress'] : 0,
    error: typeof raw['error'] === 'string' ? raw['error'] : null,
  };
}

function sanitizeSettings(raw: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!isObject(raw)) return settings;

  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

  settings.media = raw['media'] !== false;
  settings.mediaMode = pick(raw['mediaMode'], MEDIA_MODES, DEFAULT_SETTINGS.mediaMode);
  settings.mediaDef = pick(raw['mediaDef'], MEDIA_STYLES, DEFAULT_SETTINGS.mediaDef);
  settings.view = pick(raw['view'], VIEW_MODES, DEFAULT_SETTINGS.view);
  settings.dest = pick(raw['dest'], DEST_OPTIONS, DEFAULT_SETTINGS.dest);
  settings.romMode = pick(raw['romMode'], ROM_MODES, DEFAULT_SETTINGS.romMode);

  if (typeof raw['installDir'] === 'string' && raw['installDir'].trim()) {
    settings.installDir = raw['installDir'];
  }
  if (typeof raw['romDir'] === 'string' && raw['romDir'].trim()) {
    settings.romDir = raw['romDir'];
  }

  const mediaMap = raw['mediaMap'];
  if (isObject(mediaMap)) {
    const mapped: Settings['mediaMap'] = {};
    for (const platform of SOURCE_PLATFORMS) {
      const value = mediaMap[platform];
      if (typeof value === 'string' && (MEDIA_STYLES as readonly string[]).includes(value)) {
        mapped[platform] = value as Settings['mediaDef'];
      }
    }
    settings.mediaMap = mapped;
  }

  return settings;
}

/* -------------------------------------------------------------------------- */
/* Eventos                                                                    */
/* -------------------------------------------------------------------------- */

export type LibraryEventType = 'hydrate' | 'game' | 'settings' | 'reset';

export interface LibraryEvent {
  type: LibraryEventType;
  pid?: string;
  file: LibraryFile;
}

export type LibraryListener = (event: LibraryEvent) => void;

/* -------------------------------------------------------------------------- */
/* Servicio                                                                   */
/* -------------------------------------------------------------------------- */

export class LibraryService {
  private store: KeyValueStore;
  private persistent: boolean;
  private file: LibraryFile;
  private listeners = new Set<LibraryListener>();
  private storageListenerAttached = false;

  constructor(storage?: KeyValueStore | null) {
    const detected = storage === undefined ? detectStorage() : storage;
    this.persistent = !!detected;
    this.store = detected ?? new MemoryStore();
    this.file = this.read();
    this.attachStorageSync();
  }

  /* --------------------------- lectura / escritura ------------------------ */

  private read(): LibraryFile {
    const raw = this.store.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return emptyLibrary();
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isObject(parsed)) return emptyLibrary();
      const games: Record<string, LibraryGame> = {};
      const rawGames = parsed['games'];
      if (isObject(rawGames)) {
        for (const [pid, value] of Object.entries(rawGames)) {
          if (!pid) continue;
          games[pid] = sanitizeGame(pid, value);
        }
      }
      return {
        version: typeof parsed['version'] === 'number' ? parsed['version'] : LIBRARY_SCHEMA_VERSION,
        updatedAt: typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'] : nowIso(),
        games,
        settings: sanitizeSettings(parsed['settings']),
      };
    } catch {
      // JSON corrupto: no perdemos la sesión, arrancamos limpio.
      return emptyLibrary();
    }
  }

  private write(event: LibraryEventType, pid?: string): void {
    this.file.version = LIBRARY_SCHEMA_VERSION;
    this.file.updatedAt = nowIso();
    try {
      this.store.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(this.file));
    } catch {
      // Cuota llena o almacén no disponible: seguimos en memoria.
      this.persistent = false;
    }
    this.emit({ type: event, pid, file: this.file });
  }

  private emit(event: LibraryEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Un listener roto no debe tumbar la persistencia.
      }
    }
  }

  /** Relee el almacén (por ejemplo tras importar un `ports.json`). */
  reload(): LibraryFile {
    this.file = this.read();
    this.emit({ type: 'hydrate', file: this.file });
    return this.file;
  }

  private attachStorageSync(): void {
    if (this.storageListenerAttached) return;
    const target = globalThis as {
      addEventListener?: (type: string, handler: (event: unknown) => void) => void;
    };
    if (typeof target.addEventListener !== 'function') return;
    try {
      target.addEventListener('storage', (event: unknown) => {
        const key = (event as { key?: string | null }).key;
        if (key !== LIBRARY_STORAGE_KEY) return;
        this.file = this.read();
        this.emit({ type: 'hydrate', file: this.file });
      });
      this.storageListenerAttached = true;
    } catch {
      // Sin soporte de eventos: la sincronización multi-pestaña es opcional.
    }
  }

  /* ------------------------------- estado -------------------------------- */

  isPersistent(): boolean {
    return this.persistent;
  }

  getState(): LibraryFile {
    return this.file;
  }

  /** Copia profunda segura (para snapshots de UI). */
  snapshot(): LibraryFile {
    return clone(this.file);
  }

  subscribe(listener: LibraryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ------------------------------ fichas --------------------------------- */

  getLibraryGame(pid: string): LibraryGame {
    const existing = this.file.games[pid];
    return existing ? { ...existing } : createLibraryGame(pid);
  }

  has(pid: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.file.games, pid);
  }

  updateLibraryGame(pid: string, patch: Partial<LibraryGame>): LibraryGame {
    if (!pid) throw new Error('updateLibraryGame: falta el pid');
    const current = this.file.games[pid] ?? createLibraryGame(pid);
    const next: LibraryGame = sanitizeGame(pid, { ...current, ...patch, pid });
    this.file.games[pid] = next;
    this.write('game', pid);
    return { ...next };
  }

  /** Atajo de bajo nivel para la máquina de estados del instalador. */
  setState(pid: string, state: LibraryState, extra: Partial<LibraryGame> = {}): LibraryGame {
    return this.updateLibraryGame(pid, { ...extra, state });
  }

  setProgress(pid: string, progress: number): LibraryGame {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    return this.updateLibraryGame(pid, { progress: clamped });
  }

  markBroken(pid: string, error: string): LibraryGame {
    return this.updateLibraryGame(pid, { state: 'Broken', error });
  }

  setUpdateAvailable(pid: string, version: string): LibraryGame {
    return this.updateLibraryGame(pid, {
      state: 'UpdateAvailable',
      installedVersion: version,
      error: null,
    });
  }

  /** Fichas en cualquier estado distinto de `NotInstalled`. */
  getInstalledPorts(): LibraryGame[] {
    return Object.values(this.file.games)
      .filter((game) => game.state !== 'NotInstalled')
      .sort((a, b) => a.pid.localeCompare(b.pid, 'es'));
  }

  getPortsInState(state: LibraryState): LibraryGame[] {
    return Object.values(this.file.games).filter((game) => game.state === state);
  }

  /** `{ pid: state }` para inyectar en `catalogService.setLibraryStates()`. */
  getStates(): Map<string, LibraryState> {
    return new Map(Object.entries(this.file.games).map(([pid, game]) => [pid, game.state]));
  }

  /** Contadores por estado (para los chips de la toolbar). */
  getStateCounts(): Record<LibraryState, number> {
    const counts = Object.fromEntries(LIBRARY_STATES.map((state) => [state, 0])) as Record<
      LibraryState,
      number
    >;
    for (const game of Object.values(this.file.games)) counts[game.state] += 1;
    return counts;
  }

  /* -------------------------------- ROM ---------------------------------- */

  /**
   * Registra la ROM del usuario. Si `validated` es `true`, la ficha pasa
   * (o vuelve) a `Ready`; si no, queda en `NeedsRom`.
   */
  setRom(pid: string, romPath: string | null, romMode: RomMode, validated: boolean): LibraryGame {
    const current = this.file.games[pid] ?? createLibraryGame(pid);
    const hasPath = !!romPath && romPath.trim().length > 0;
    const nextState: LibraryState = hasPath && validated ? 'Ready' : 'NeedsRom';

    // No degradar una ficha que aún no está instalada.
    const isInstalled = current.state !== 'NotInstalled';
    const state = isInstalled ? nextState : current.state;
    const romValidatedAt = isInstalled && hasPath && validated ? nowIso() : null;

    return this.updateLibraryGame(pid, {
      romPath: hasPath ? romPath : null,
      romMode,
      romValidatedAt,
      state,
      error: null,
    });
  }

  clearRom(pid: string): LibraryGame {
    return this.updateLibraryGame(pid, {
      romPath: null,
      romValidatedAt: null,
      state: 'NeedsRom',
    });
  }

  /* ------------------------------ desinstalar ----------------------------- */

  uninstallPort(pid: string): LibraryGame {
    const previous = this.file.games[pid] ?? createLibraryGame(pid);
    const next: LibraryGame = {
      ...createLibraryGame(pid, previous.installStrategy),
      autoUpdate: previous.autoUpdate,
      romMode: previous.romMode,
      // Conservamos el pin: es una decisión del usuario, no del instalador.
      pinnedVersion: previous.pinnedVersion,
      state: 'NotInstalled',
    };
    this.file.games[pid] = next;
    this.write('game', pid);
    return { ...next };
  }

  /* ------------------------------- ajustes ------------------------------- */

  getSettings(): Settings {
    return { ...this.file.settings, mediaMap: { ...this.file.settings.mediaMap } };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const merged = { ...this.file.settings, ...patch };
    this.file.settings = sanitizeSettings(merged);
    this.write('settings');
    return this.getSettings();
  }

  /** Fija el soporte visual de una plataforma (`mediaMap`) sin tocar el resto. */
  setPlatformMedia(platform: keyof Settings['mediaMap'], media: Settings['mediaDef']): Settings {
    return this.updateSettings({
      mediaMap: { ...this.file.settings.mediaMap, [platform]: media },
    });
  }

  /* -------------------------------- reset -------------------------------- */

  /** Vacía biblioteca y ajustes (deja el almacén como recién instalado). */
  resetLibrary(): void {
    this.file = emptyLibrary();
    try {
      this.store.removeItem(LIBRARY_STORAGE_KEY);
    } catch {
      // Ignorado: el estado en memoria ya está limpio.
    }
    this.emit({ type: 'reset', file: this.file });
  }

  /* --------------------------- export / import --------------------------- */

  /** Serializa el estado como `ports.json` (mismo formato en disco). */
  exportJson(pretty = true): string {
    return JSON.stringify(this.file, null, pretty ? 2 : 0);
  }

  /** Carga un `ports.json` externo. Devuelve `false` si no es válido. */
  importJson(raw: string): boolean {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isObject(parsed) || !isObject(parsed['games'])) return false;
    } catch {
      return false;
    }
    try {
      this.store.setItem(LIBRARY_STORAGE_KEY, raw);
    } catch {
      return false;
    }
    this.reload();
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton                                                                  */
/* -------------------------------------------------------------------------- */

export const libraryService = new LibraryService();

export default libraryService;
