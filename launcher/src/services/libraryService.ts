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
  Addon,
  CustomArtwork,
  InstallStrategy,
  LaunchProfile,
  LibraryFile,
  LibraryGame,
  LibraryState,
  LogoAnchor,
  RomMode,
  Settings,
} from './types';

import {
  COVER_OFFSET_MAX,
  COVER_OFFSET_MIN,
  COVER_SCALE_MAX,
  COVER_SCALE_MIN,
  DEFAULT_SETTINGS,
  defaultAddons,
  HERO_SCALE_MAX,
  HERO_SCALE_MIN,
  LIBRARY_SCHEMA_VERSION,
  LIBRARY_STORAGE_KEY,
  LIBRARY_STATES,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  MEDIA_MODES,
  ROM_MODES,
  VIEW_MODES,
  DEST_OPTIONS,
  MEDIA_STYLES,
  SOURCE_PLATFORMS,
  isLogoAnchor,
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
    customArt: {},
    addons: defaultAddons(),
  };
}

/* -------------------------------------------------------------------------- */
/* Arte personalizado                                                         */
/* -------------------------------------------------------------------------- */

/** URL válida para un campo de arte: cadena con contenido o `null`. */
function artUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Escala del logo acotada al rango del slider. */
function artScale(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(LOGO_SCALE_MIN, Math.min(LOGO_SCALE_MAX, Math.round(value)));
}

/** Escala del fondo de cabecera acotada al rango del slider (100–250 %). */
function artHeroScale(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(HERO_SCALE_MIN, Math.min(HERO_SCALE_MAX, Math.round(value)));
}

/** Zoom de la carátula dentro del soporte acotado a su slider (80–200 %). */
function artCoverScale(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(COVER_SCALE_MIN, Math.min(COVER_SCALE_MAX, Math.round(value)));
}

/** Desplazamiento de la carátula dentro del soporte (-50…50 %). */
function artCoverOffset(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(COVER_OFFSET_MIN, Math.min(COVER_OFFSET_MAX, Math.round(value)));
}

/**
 * Sanea el arte personalizado leído de disco o de `localStorage`.
 *
 * Devuelve `null` cuando no queda ningún ajuste útil, de modo que el mapa
 * `customArt` no acumule entradas vacías.
 */
export function sanitizeCustomArt(raw: unknown): CustomArtwork | null {
  if (!isObject(raw)) return null;
  const art: CustomArtwork = {};

  const coverUrl = artUrl(raw['coverUrl']);
  if (coverUrl) art.coverUrl = coverUrl;
  const heroUrl = artUrl(raw['heroUrl']);
  if (heroUrl) art.heroUrl = heroUrl;
  const logoUrl = artUrl(raw['logoUrl']);
  if (logoUrl) art.logoUrl = logoUrl;

  if (isLogoAnchor(raw['logoAnchor'])) art.logoAnchor = raw['logoAnchor'] as LogoAnchor;
  const logoScale = artScale(raw['logoScale']);
  if (logoScale !== undefined) art.logoScale = logoScale;
  const heroScale = artHeroScale(raw['heroScale']);
  if (heroScale !== undefined) art.heroScale = heroScale;
  const coverScale = artCoverScale(raw['coverScale']);
  if (coverScale !== undefined) art.coverScale = coverScale;
  const coverY = artCoverOffset(raw['coverY']);
  if (coverY !== undefined) art.coverY = coverY;
  const coverX = artCoverOffset(raw['coverX']);
  if (coverX !== undefined) art.coverX = coverX;

  return Object.keys(art).length > 0 ? art : null;
}

function cloneCustomArt(art: CustomArtwork): CustomArtwork {
  return { ...art };
}

/* -------------------------------------------------------------------------- */
/* Addons (plugins)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Sanea un addon leído de `localStorage` o entregado por la UI.
 *
 * Devuelve `null` si le falta lo mínimo (`id` y `name`), de modo que una
 * entrada corrupta no llega nunca a la lista de la sección de Addons.
 */
export function sanitizeAddon(raw: unknown): Addon | null {
  if (!isObject(raw)) return null;

  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  if (!id || !name) return null;

  const addon: Addon = {
    id,
    name,
    version: typeof raw['version'] === 'string' && raw['version'].trim() ? raw['version'].trim() : '0.0.0',
    description: typeof raw['description'] === 'string' ? raw['description'].trim() : '',
    type: typeof raw['type'] === 'string' && raw['type'].trim() ? raw['type'].trim() : 'plugin',
    enabled: raw['enabled'] !== false,
    installedAt:
      typeof raw['installedAt'] === 'number' && Number.isFinite(raw['installedAt'])
        ? raw['installedAt']
        : Date.now(),
  };

  if (typeof raw['author'] === 'string' && raw['author'].trim()) {
    addon.author = raw['author'].trim();
  }
  if (typeof raw['icon'] === 'string' && raw['icon'].trim()) {
    addon.icon = raw['icon'].trim();
  }

  return addon;
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

  /* Integraciones: la clave de SteamGridDB y el flag del asistente se
   * conservan tal cual (la clave se recorta, el flag se normaliza a boolean). */
  if (typeof raw['steamgridApiKey'] === 'string') {
    settings.steamgridApiKey = raw['steamgridApiKey'].trim();
  }
  settings.onboardingDone = raw['onboardingDone'] === true;
  /* Descarga automática del catálogo en segundo plano (interruptor de Ajustes):
   * sólo un `true` explícito la activa, cualquier otro valor la deja apagada. */
  settings.steamgridAutoSync = raw['steamgridAutoSync'] === true;

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

/**
 * Migración de ajustes guardados por versiones anteriores.
 *
 * v1 → v2: la vista por defecto pasó de `posters` a `shelves` (estantería de
 * cartuchos, como el prototipo). Si la biblioteca se guardó con el esquema 1 y
 * la vista sigue siendo la antigua por defecto `posters`, se asciende a la
 * nueva; una elección explícita posterior ya queda marcada con el esquema 2.
 */
function migrateSettings(settings: Settings, storedVersion: unknown): Settings {
  const version = typeof storedVersion === 'number' ? storedVersion : 0;
  if (version < 2 && settings.view === 'posters') {
    settings.view = DEFAULT_SETTINGS.view;
  }
  return settings;
}

/* -------------------------------------------------------------------------- */
/* Eventos                                                                    */
/* -------------------------------------------------------------------------- */

export type LibraryEventType = 'hydrate' | 'game' | 'settings' | 'art' | 'addons' | 'reset';

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
      const storedVersion = parsed['version'];
      const settings = migrateSettings(sanitizeSettings(parsed['settings']), storedVersion);
      const customArt: Record<string, CustomArtwork> = {};
      const rawArt = parsed['customArt'];
      if (isObject(rawArt)) {
        for (const [pid, value] of Object.entries(rawArt)) {
          if (!pid) continue;
          const art = sanitizeCustomArt(value);
          if (art) customArt[pid] = art;
        }
      }
      /* Addons: si la biblioteca guardada es anterior a la sección de plugins
       * (no hay clave `addons`), se siembra el addon de ejemplo; un array vacío
       * guardado por el usuario (los desinstaló todos) se respeta. */
      const rawAddons = parsed['addons'];
      const addons: Addon[] = Array.isArray(rawAddons)
        ? rawAddons
            .map((entry) => sanitizeAddon(entry))
            .filter((entry): entry is Addon => entry !== null)
        : defaultAddons();
      return {
        version: typeof parsed['version'] === 'number' ? parsed['version'] : LIBRARY_SCHEMA_VERSION,
        updatedAt: typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'] : nowIso(),
        games,
        settings,
        customArt,
        addons,
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

  /* --------------------------- arte personalizado ------------------------- */

  /**
   * Arte personalizado guardado para un `pid`, o `null` si el juego conserva
   * el arte del índice.
   *
   * Funciona igual para ports instalados y no instalados: el mapa `customArt`
   * vive al margen de `games`, así que personalizar el arte nunca instala el
   * port ni toca su estado.
   */
  getCustomArt(pid: string): CustomArtwork | null {
    if (!pid) return null;
    const art = this.file.customArt?.[pid];
    return art ? cloneCustomArt(art) : null;
  }

  /** Mapa completo `pid → arte` (copia defensiva). */
  getCustomArtMap(): Record<string, CustomArtwork> {
    const out: Record<string, CustomArtwork> = {};
    for (const [pid, art] of Object.entries(this.file.customArt ?? {})) {
      out[pid] = cloneCustomArt(art);
    }
    return out;
  }

  /**
   * Guarda (o borra, con `null`) el arte personalizado de un juego.
   *
   * Persiste en `localStorage['portshub-library-v1']` bajo `customArt[pid]`
   * para que sobreviva a recargas y a la desinstalación del port.
   */
  setCustomArt(pid: string, art: CustomArtwork | null): CustomArtwork | null {
    if (!pid) throw new Error('setCustomArt: falta el pid');
    const clean = sanitizeCustomArt(art);
    if (!this.file.customArt) this.file.customArt = {};
    if (clean) this.file.customArt[pid] = clean;
    else delete this.file.customArt[pid];
    this.write('art', pid);
    return clean ? cloneCustomArt(clean) : null;
  }

  /* ------------------------------- addons -------------------------------- */

  /** Lista de addons instalados (copia defensiva). */
  getAddons(): Addon[] {
    return (this.file.addons ?? []).map((addon) => ({ ...addon }));
  }

  /** Activa o desactiva un addon; devuelve la lista resultante. */
  toggleAddon(id: string): Addon[] {
    const addon = (this.file.addons ?? []).find((entry) => entry.id === id);
    if (addon) {
      addon.enabled = !addon.enabled;
      this.write('addons');
    }
    return this.getAddons();
  }

  /**
   * Instala (o reemplaza, por `id`) un addon y lo persiste.
   *
   * Igual que el resto del servicio, el addon se sanea antes de guardarlo: un
   * plugin sin `id`/`name` se descarta sin tocar la biblioteca.
   */
  installAddon(addon: Addon): Addon[] {
    const clean = sanitizeAddon(addon);
    if (!clean) return this.getAddons();
    if (!Array.isArray(this.file.addons)) this.file.addons = [];
    const index = this.file.addons.findIndex((entry) => entry.id === clean.id);
    if (index >= 0) this.file.addons[index] = clean;
    else this.file.addons.push(clean);
    this.write('addons');
    return this.getAddons();
  }

  /** Desinstala un addon por `id`; devuelve la lista resultante. */
  removeAddon(id: string): Addon[] {
    if (!Array.isArray(this.file.addons)) this.file.addons = [];
    const remaining = this.file.addons.filter((entry) => entry.id !== id);
    if (remaining.length !== this.file.addons.length) {
      this.file.addons = remaining;
      this.write('addons');
    }
    return this.getAddons();
  }

  /**
   * Persiste el estado completo de un addon ya presente en la lista.
   *
   * Es el camino que usa la sección de Addons al conmutar el interruptor: la UI
   * muta su copia (`enabled`) y aquí se guarda tal cual, sin invertirla otra vez
   * (eso duplicaría el cambio que ya hizo `toggleAddon`). Si el addon aún no
   * estaba en la biblioteca se inserta, igual que `installAddon`.
   */
  setAddon(addon: Addon): Addon[] {
    return this.installAddon(addon);
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
