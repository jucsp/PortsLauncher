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

/**
 * Lista de cadenas normalizada a minúsculas (`['Search']` → `['search']`).
 *
 * Se usa con `capabilities` y `platforms` de los addons: el backend ya las
 * entrega en minúsculas, pero una entrada antigua de `ports.json` puede venir
 * con otra caja y la comparación de capacidades debe seguir funcionando.
 */
function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase());
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
  if (typeof raw['dir'] === 'string' && raw['dir'].trim()) {
    addon.dir = raw['dir'].trim();
  }
  /* `capabilities` y `platforms` los normaliza el backend a minúsculas; se
   * conservan porque la UI los necesita para decidir qué addons pueden buscar y
   * aprovisionar ROMs después de recargar la lista desde `ports.json`. */
  const capabilities = textList(raw['capabilities']);
  if (capabilities.length) addon.capabilities = capabilities;
  const platforms = textList(raw['platforms']);
  if (platforms.length) addon.platforms = platforms;

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

/**
 * ¿El valor tiene forma de `ports.json`?
 *
 * Es la comprobación que separa «hay biblioteca» de «hay cualquier cosa»: se
 * usa al hidratar desde disco para no sustituir el estado local por contenido
 * inválido. Coincide con la que aplica el backend en `POST /api/library`.
 */
export function isLibraryPayload(value: unknown): value is Record<string, unknown> {
  return isObject(value) && isObject(value['games']);
}

/**
 * Sanea un `ports.json` ya parseado (de `localStorage` o de disco).
 *
 * Devuelve `null` solo si el valor no es un objeto. Un fichero sin `games` se
 * acepta como biblioteca vacía (conservando ajustes y arte): así una biblioteca
 * antigua o parcial nunca se descarta entera.
 */
export function parseLibrary(parsed: unknown): LibraryFile | null {
  if (!isObject(parsed)) return null;

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

  /* Addons: se respeta lo guardado y, si la biblioteca es anterior a la
   * sección de plugins (no hay clave `addons`), se arranca sin ninguno. El
   * disco es la única fuente de verdad: `syncAddons()` rellena la lista con
   * los `plugin.json` reales al iniciar. Nunca se siembran plugins de
   * ejemplo. */
  const rawAddons = parsed['addons'];
  const addons: Addon[] = Array.isArray(rawAddons)
    ? rawAddons
        .map((entry) => sanitizeAddon(entry))
        .filter((entry): entry is Addon => entry !== null)
    : [];

  return {
    version: typeof parsed['version'] === 'number' ? parsed['version'] : LIBRARY_SCHEMA_VERSION,
    updatedAt: typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'] : nowIso(),
    games,
    settings,
    customArt,
    addons,
  };
}

/* -------------------------------------------------------------------------- */
/* Sincronización con disco (`~/PortsLauncher/ports.json`)                    */
/* -------------------------------------------------------------------------- */

/** Endpoint del backend local que lee y persiste la biblioteca en disco. */
export const LIBRARY_DISK_ENDPOINT = '/api/library';

/** Configuración de la persistencia en disco. */
export interface DiskSyncConfig {
  /** Ruta del endpoint (por defecto `LIBRARY_DISK_ENDPOINT`). */
  endpoint?: string;
  /** Implementación de `fetch`; los tests inyectan una falsa. */
  fetchImpl?: typeof fetch;
}

interface DiskSyncTarget {
  endpoint: string;
  send: (payload: string) => Promise<void>;
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

  /** Destino de persistencia en disco; `null` mientras no se active. */
  private diskSync: DiskSyncTarget | null = null;
  /** Cola serializada de escrituras: coalesce ráfagas y respeta el orden. */
  private diskQueue: Promise<void> = Promise.resolve();
  /** Hay cambios locales sin volcar a `ports.json`. */
  private diskDirty = false;

  constructor(storage?: KeyValueStore | null) {
    const detected = storage === undefined ? detectStorage() : storage;
    this.persistent = !!detected;
    this.store = detected ?? new MemoryStore();
    this.file = this.read();
    this.attachStorageSync();
  }

  /* --------------------------- lectura / escritura ------------------------ */

  /**
   * Estado persistido en `localStorage` (caché local).
   *
   * El fichero `~/PortsLauncher/ports.json` manda sobre esta caché: `init()` lo
   * lee con `GET /api/library` y llama a `hydrateFromDisk()` antes de pintar.
   */
  private read(): LibraryFile {
    const raw = this.store.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return emptyLibrary();
    try {
      return parseLibrary(JSON.parse(raw)) ?? emptyLibrary();
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
    /* Cada escritura viaja al fichero de disco: `localStorage` es solo caché. */
    this.scheduleDiskPush();
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

  /* -------------------------- persistencia en disco ------------------------ */

  /**
   * Activa el volcado a `~/PortsLauncher/ports.json` vía `POST /api/library`.
   *
   * Se llama desde `init()` **después** de intentar hidratar desde disco. A
   * partir de ahí, cada `write()` programa una escritura; las ráfagas se
   * coalescen (una instalación emite decenas de eventos de progreso y no tiene
   * sentido reescribir el fichero en cada uno).
   *
   * Si no hay `fetch` disponible (entorno sin DOM y sin inyección) la llamada es
   * un no-op: la biblioteca sigue funcionando en `localStorage`.
   */
  enableDiskSync(config: DiskSyncConfig = {}): void {
    const endpoint = config.endpoint ?? LIBRARY_DISK_ENDPOINT;
    let fetchFn: typeof fetch | null = config.fetchImpl ?? null;
    if (!fetchFn) {
      const nativeFetch = (globalThis as { fetch?: typeof fetch }).fetch;
      if (typeof nativeFetch === 'function') {
        /* `fetch` desacoplado del objeto global lanza «Illegal invocation» en
         * algunos navegadores: se envuelve para conservar el `this`. */
        fetchFn = (input, init) => nativeFetch(input, init);
      }
    }
    if (!fetchFn) {
      this.diskSync = null;
      return;
    }

    this.diskSync = {
      endpoint,
      send: async (payload: string) => {
        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: payload,
        });
        if (!response.ok) throw new Error(`POST ${endpoint} respondió ${response.status}`);
      },
    };

    /* El estado actual aún no está en disco: se vuelca de inmediato. */
    this.scheduleDiskPush();
  }

  /**
   * Sustituye el estado en memoria por la biblioteca leída de disco.
   *
   * `GET /api/library` entrega `{ library }` o el documento plano; ambas formas
   * valen. Solo se adopta si tiene forma de `ports.json` (objeto con `games`):
   * así un fichero corrupto, un `[]` o un `null` dejan intacto lo que hubiera.
   *
   * Lo hidratado se copia también a `localStorage` para que un arranque
   * posterior sin backend no vuelva a un estado viejo.
   *
   * @returns `true` si el estado se sustituyó.
   */
  hydrateFromDisk(raw: unknown): boolean {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return false;
      }
    }
    if (!isLibraryPayload(parsed)) return false;

    const file = parseLibrary(parsed);
    if (!file) return false;

    this.file = file;
    try {
      this.store.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(this.file));
      this.persistent = true;
    } catch {
      /* Sin sitio en `localStorage`: la verdad sigue en disco. */
      this.persistent = false;
    }
    this.emit({ type: 'hydrate', file: this.file });
    return true;
  }

  /** Desactiva el volcado a disco (los tests y el modo sin backend lo usan). */
  disableDiskSync(): void {
    this.diskSync = null;
    this.diskDirty = false;
  }

  isDiskSyncEnabled(): boolean {
    return this.diskSync !== null;
  }

  /** Fuerza el volcado del estado actual a disco. */
  pushToDisk(): void {
    this.scheduleDiskPush();
  }

  /**
   * Espera a que la cola de escrituras se vacíe.
   *
   * Útil para tests y para cerrar la app con la seguridad de que `ports.json`
   * ya refleja el último cambio. No lanza: el fallo de red ya se ignora dentro
   * del bucle (el estado sigue a salvo en `localStorage`).
   */
  async flushDiskSync(): Promise<void> {
    for (let round = 0; round < 5; round += 1) {
      await this.diskQueue;
      if (!this.diskDirty) return;
    }
  }

  private scheduleDiskPush(): void {
    if (!this.diskSync) return;
    this.diskDirty = true;
    this.diskQueue = this.diskQueue
      .then(() => this.drainDiskPush())
      .catch(() => {
        /* Un fallo inesperado de la cola no debe romper la siguiente escritura. */
      });
  }

  /**
   * Bucle de volcado: reenvía siempre el estado más reciente.
   *
   * Si durante el `await` llega otra escritura, `diskDirty` vuelve a `true` y el
   * bucle repite con los datos nuevos, de modo que se envía como mucho una
   * petición por vuelta y nunca una versión obsoleta al final.
   */
  private async drainDiskPush(): Promise<void> {
    while (this.diskDirty && this.diskSync) {
      this.diskDirty = false;
      const target = this.diskSync;
      const payload = JSON.stringify(this.file);
      try {
        await target.send(payload);
      } catch {
        /* Backend ausente (build sin API) o error de escritura: el estado sigue
         * en `localStorage` y el siguiente `write()` reintenta. */
      }
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

  /**
   * Sincroniza la lista de addons con los plugins reales de disco.
   *
   * El disco manda: se descarta cualquier entrada que ya no tenga carpeta (o
   * que nunca existió) y se añaden las nuevas. De cada plugin que ya estaba se
   * conservan `enabled` e `installedAt`, porque ese estado lo decide el usuario
   * en la UI y no viene del `plugin.json`.
   *
   * Es una sola escritura por sincronización (frente a N `installAddon` +
   * `removeAddon`), para no encadenar eventos `addons` mientras la vista pinta.
   *
   * @param addons Plugins leídos de `GET /api/plugins`.
   * @returns La lista resultante (copia defensiva).
   */
  syncAddons(addons: Addon[]): Addon[] {
    const previous = new Map((this.file.addons ?? []).map((entry) => [entry.id, entry]));
    const next: Addon[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(addons) ? addons : []) {
      const clean = sanitizeAddon(raw);
      if (!clean || seen.has(clean.id)) continue;
      seen.add(clean.id);
      const before = previous.get(clean.id);
      if (before) {
        clean.enabled = before.enabled;
        clean.installedAt = before.installedAt;
      } else {
        clean.enabled = true;
      }
      next.push(clean);
    }

    /* Sin cambios reales (mismos ids, mismos datos) no se escribe: evita
     * eventos y `updatedAt` innecesarios en cada arranque. Las `capabilities`
     * entran en la firma: si el autor del plugin las amplía, la lista
     * persistida debe refrescarse para que la UI ofrezca el buscador. */
    const signature = (list: Addon[]): string =>
      JSON.stringify(
        list.map((entry) => [
          entry.id,
          entry.name,
          entry.version,
          entry.enabled,
          entry.dir ?? '',
          (entry.capabilities ?? []).join(','),
          (entry.platforms ?? []).join(','),
        ])
      );
    const unchanged = signature(this.file.addons ?? []) === signature(next);
    this.file.addons = next;
    if (!unchanged) this.write('addons');
    return this.getAddons();
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
    /* El vaciado también viaja a disco: si no, el siguiente arranque volvería a
     * hidratar la biblioteca anterior desde `ports.json`. */
    this.scheduleDiskPush();
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
    /* Lo importado es la nueva verdad: se persiste en `ports.json`. */
    this.scheduleDiskPush();
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton                                                                  */
/* -------------------------------------------------------------------------- */

export const libraryService = new LibraryService();

export default libraryService;
