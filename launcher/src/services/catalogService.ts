/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/services/catalogService.ts
 *
 * Carga y consulta del catálogo unificado (`data/ports.index.json`) generado
 * por `catalog-builder/builder.py`.
 *
 * El servicio es un singleton perezoso: `loadCatalog()` se llama una vez desde
 * `main.ts` y el resto de la UI consume `getPorts()` / `search()` de forma
 * síncrona. Si el índice no se puede cargar, el servicio queda en modo
 * degradado (lista vacía + `lastError`) en lugar de romper el arranque.
 * ========================================================================== */

import type {
  CatalogStats,
  DevTag,
  DevTagInfo,
  LibraryFilter,
  LibraryState,
  MediaStyle,
  PortFilter,
  PortIndex,
  PortItem,
  Settings,
  SortKey,
  SourcePlatform,
  TargetPlatform,
  InstallStrategy,
} from './types';

import {
  CATALOG_TO_DEV_TAG,
  DEV_TAG_META,
  DEV_TAG_ORDER,
  DEV_TAGS,
  INSTALL_STRATEGIES,
  MEDIA_BY_PLATFORM,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
  SOURCE_PLATFORMS,
} from './types';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Minúsculas + sin diacríticos: `Pokémon` y `pokemon` deben casar. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Base de la app (`/` en dev, `/sub/` si se sirve bajo subruta). */
function baseUrl(): string {
  try {
    const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
    return env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

/** Rutas candidatas, de la canónica a la "copia en public/". */
function candidateUrls(): string[] {
  const base = baseUrl().endsWith('/') ? baseUrl() : `${baseUrl()}/`;
  const urls: string[] = [];
  const add = (path: string): void => {
    if (!urls.includes(path)) urls.push(path);
  };
  add(`${base}data/ports.index.json`);
  add('/data/ports.index.json');
  add('data/ports.index.json');
  add(`${base}ports.index.json`);
  add('ports.index.json');
  return urls;
}

/** Índice vacío válido: permite renderizar el estado "sin catálogo". */
function emptyIndex(message: string): PortIndex {
  return {
    version: '0.0.0',
    schemaVersion: '0.0.0',
    generatedAt: new Date(0).toISOString(),
    semanticHash: 'sha256:0',
    stats: {
      totalPorts: 0,
      bySourcePlatform: {},
      byStatusTag: {},
      byInstallStrategy: {},
      byDistribution: {},
      fusedGamewaveQuiver: 0,
      gamewaveOnly: 0,
      quiverOnly: 0,
      uniqueRepositories: 0,
      multiRepositories: [],
      multiRepositoryCount: 0,
      quarantinedLinks: 0,
      withSetupFiles: 0,
      withVerifiedRelease: 0,
      invisible: 0,
      _notice: message,
    },
    ports: [],
  };
}

function isPortIndex(value: unknown): value is PortIndex {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PortIndex>;
  return Array.isArray(candidate.ports) && typeof candidate.version === 'string';
}

/* -------------------------------------------------------------------------- */
/* Servicio                                                                   */
/* -------------------------------------------------------------------------- */

export interface LoadCatalogOptions {
  /** URL explícita (tests, fixtures, builds alternativas). */
  url?: string;
  /** Ignora la caché en memoria y vuelve a descargar. */
  force?: boolean;
}

export interface PlatformCount {
  id: SourcePlatform;
  label: string;
  short: string;
  count: number;
}

export interface StrategyCount {
  id: InstallStrategy;
  label: string;
  count: number;
}

export class CatalogService {
  private index: PortIndex | null = null;
  private ports: PortItem[] = [];
  private byPid = new Map<string, PortItem>();
  /** Texto pre-normalizado por pid para búsquedas rápidas. */
  private searchBlob = new Map<string, string>();
  /** Estado local por pid, inyectado por `libraryService`. */
  private libraryStates = new Map<string, LibraryState>();
  private libraryResolver: ((pid: string) => LibraryState | null) | null = null;
  private loading: Promise<PortIndex> | null = null;
  private loadedUrl: string | null = null;

  /** Último error de carga (null si todo fue bien). */
  lastError: string | null = null;

  /* ------------------------------ carga ---------------------------------- */

  isLoaded(): boolean {
    return this.index !== null;
  }

  /** Carga (una sola vez) el índice y prepara los índices auxiliares. */
  async loadCatalog(options: LoadCatalogOptions = {}): Promise<PortIndex> {
    if (options.force) {
      this.loading = null;
      this.index = null;
      this.loadedUrl = null;
    }
    if (this.index && !options.url) return this.index;
    if (this.loading && !options.url) return this.loading;

    const task = this.fetchIndex(options.url).then((index) => {
      this.applyIndex(index);
      return index;
    });
    this.loading = task;
    return task;
  }

  private async fetchIndex(explicitUrl?: string): Promise<PortIndex> {    const urls = explicitUrl ? [explicitUrl] : candidateUrls();
    const errors: string[] = [];

    if (typeof fetch !== 'function') {
      this.lastError = 'Entorno sin `fetch`: no se puede cargar el catálogo.';
      return emptyIndex(this.lastError);
    }

    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: explicitUrl ? 'no-cache' : 'default' });
        if (!response.ok) {
          errors.push(`${url} → HTTP ${response.status}`);
          continue;
        }
        const payload: unknown = await response.json();
        if (!isPortIndex(payload)) {
          errors.push(`${url} → estructura no reconocida`);
          continue;
        }
        this.loadedUrl = url;
        this.lastError = null;
        return payload;
      } catch (error) {
        errors.push(`${url} → ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Fallback final: modo degradado, pero con el detalle disponible.
    this.lastError =
      'No se pudo cargar `ports.index.json`. Ejecuta `python3 catalog-builder/builder.py --offline` ' +
      'o copia `data/` dentro de `launcher/public/`. Detalle: ' +
      errors.join(' | ');
    return emptyIndex(this.lastError);
  }

  private applyIndex(index: PortIndex): void {
    this.index = index;
    const ports = Array.isArray(index.ports) ? index.ports.filter(isUsablePort) : [];
    this.ports = ports;
    this.byPid = new Map(ports.map((port) => [port.pid, port]));
    this.searchBlob = new Map(ports.map((port) => [port.pid, buildBlob(port)]));
  }

  /** Sustituye el índice en memoria (fixtures y tests). */
  setIndex(index: PortIndex): void {
    this.applyIndex(index);
    this.loading = Promise.resolve(index);
  }

  getLoadedUrl(): string | null {
    return this.loadedUrl;
  }

  /* ------------------------------ acceso --------------------------------- */

  getPorts(): PortItem[] {
    return this.ports;
  }

  getPortByPid(pid: string): PortItem | undefined {
    return this.byPid.get(pid);
  }

  getIndex(): PortIndex | null {
    return this.index;
  }

  getStats(): CatalogStats | null {
    return this.index?.stats ?? null;
  }

  getCatalogVersion(): string {
    return this.index?.version ?? '0.0.0';
  }

  getSemanticHash(): string {
    return this.index?.semanticHash ?? 'sha256:0';
  }

  getGeneratedAt(): string | null {
    return this.index?.generatedAt ?? null;
  }

  /** Nº de fichas visibles (lo que la UI llama "el catálogo"). */
  getVisibleCount(): number {
    return this.ports.reduce((total, port) => (port.visible === false ? total : total + 1), 0);
  }

  /* ------------------------- estado de biblioteca ------------------------- */

  /** Inyecta `{ pid: state }` para el filtro de biblioteca. */
  setLibraryStates(states: Map<string, LibraryState> | Record<string, LibraryState>): void {
    this.libraryStates =
      states instanceof Map ? new Map(states) : new Map(Object.entries(states));
  }

  /** Alternativa reactiva: el servicio pregunta el estado al vuelo. */
  setLibraryResolver(resolver: ((pid: string) => LibraryState | null) | null): void {
    this.libraryResolver = resolver;
  }

  getLibraryState(pid: string): LibraryState {
    if (this.libraryResolver) {
      const resolved = this.libraryResolver(pid);
      if (resolved) return resolved;
    }
    return this.libraryStates.get(pid) ?? 'NotInstalled';
  }

  /* ------------------------------ búsqueda -------------------------------- */

  /**
   * Filtra + ordena el catálogo.
   * `query` busca en nombre, proyecto, tags, alias, `gameNames` y `pid`.
   */
  search(query = '', filters: PortFilter = {}, sort: SortKey = 'name-asc'): PortItem[] {
    const needle = fold(query.trim());
    const onlyVisible = filters.onlyVisible !== false;

    const result = this.ports.filter((port) => {
      if (onlyVisible && port.visible === false) return false;
      if (!this.matchesPlatform(port, filters.platform)) return false;
      if (!this.matchesDev(port, filters.dev)) return false;
      if (!this.matchesTarget(port, filters.target)) return false;
      if (!this.matchesStrategy(port, filters.strategy)) return false;
      if (!this.matchesLibrary(port, filters.library)) return false;
      if (needle && !this.matchesQuery(port, needle)) return false;
      return true;
    });

    return sortPorts(result, sort);
  }

  matchesQuery(port: PortItem, foldedNeedle: string): boolean {
    if (!foldedNeedle) return true;
    const blob = this.searchBlob.get(port.pid) ?? buildBlob(port);
    // Coincidencia por tokens: todos los términos deben aparecer.
    return foldedNeedle.split(/\s+/).every((token) => blob.includes(token));
  }

  private matchesPlatform(port: PortItem, platform?: SourcePlatform | 'all' | null): boolean {
    if (!platform || platform === 'all') return true;
    return port.sourcePlatform === platform;
  }

  private matchesDev(port: PortItem, dev?: DevTag | 'all' | null): boolean {
    if (!dev || dev === 'all') return true;
    return devTagOf(port) === dev;
  }

  private matchesTarget(port: PortItem, target?: TargetPlatform | 'all' | null): boolean {
    if (!target || target === 'all') return true;
    return asArray<TargetPlatform>(port.targetPlatforms).includes(target);
  }

  private matchesStrategy(port: PortItem, strategy?: InstallStrategy | 'all' | null): boolean {
    if (!strategy || strategy === 'all') return true;
    return port.installStrategy === strategy;
  }

  private matchesLibrary(port: PortItem, filter?: LibraryFilter | null): boolean {
    if (!filter || filter === 'all') return true;
    const state = this.getLibraryState(port.pid);
    switch (filter) {
      case 'installed':
        return state !== 'NotInstalled';
      case 'not-installed':
        return state === 'NotInstalled';
      case 'ready':
        return state === 'Ready';
      case 'needs-rom':
        return state === 'NeedsRom';
      case 'updates':
        return state === 'UpdateAvailable';
      case 'broken':
        return state === 'Broken';
      default:
        return true;
    }
  }

  /* --------------------------- agregados ---------------------------------- */

  getPlatformsWithCounts(): PlatformCount[] {
    const counts = new Map<SourcePlatform, number>();
    for (const port of this.ports) {
      if (port.visible === false) continue;
      const platform = port.sourcePlatform ?? 'other';
      counts.set(platform, (counts.get(platform) ?? 0) + 1);
    }
    return SOURCE_PLATFORMS.filter((platform) => (counts.get(platform) ?? 0) > 0)
      .map((platform) => ({
        id: platform,
        label: PLATFORM_LABELS[platform],
        short: PLATFORM_SHORT[platform],
        count: counts.get(platform) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.short.localeCompare(b.short, 'es'));
  }

  getDevCounts(): Record<DevTag, number> {
    const counts = Object.fromEntries(DEV_TAGS.map((tag) => [tag, 0])) as Record<DevTag, number>;
    for (const port of this.ports) {
      if (port.visible === false) continue;
      counts[devTagOf(port)] += 1;
    }
    return counts;
  }

  getStrategiesWithCounts(): StrategyCount[] {
    const counts = new Map<InstallStrategy, number>();
    for (const port of this.ports) {
      if (port.visible === false) continue;
      const strategy = port.installStrategy;
      counts.set(strategy, (counts.get(strategy) ?? 0) + 1);
    }
    return INSTALL_STRATEGIES.map((id) => ({
      id,
      label: id,
      count: counts.get(id) ?? 0,
    })).filter((entry) => entry.count > 0);
  }

  /** Etiquetas libres más frecuentes (para los chips del topbar). */
  getAllTags(limit = 30): Array<{ tag: string; count: number }> {
    const counts = new Map<string, number>();
    for (const port of this.ports) {
      if (port.visible === false) continue;
      for (const tag of asArray<string>(port.tags)) {
        const key = str(tag).trim();
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'es'))
      .slice(0, limit);
  }

  /** Sugerencias para el autocompletado del buscador. */
  getSuggestions(query: string, limit = 8): PortItem[] {
    const needle = fold(query.trim());
    if (needle.length < 2) return [];
    const prefix: PortItem[] = [];
    const contains: PortItem[] = [];
    for (const port of this.ports) {
      if (port.visible === false) continue;
      const name = fold(port.name);
      if (name.startsWith(needle)) prefix.push(port);
      else if (this.matchesQuery(port, needle)) contains.push(port);
      if (prefix.length >= limit) break;
    }
    return [...prefix, ...contains]
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .slice(0, limit);
  }

  /** Puertos relacionados (mismo `gameRef`, misma saga o mismo repo). */
  getRelatedPorts(port: PortItem, limit = 6): PortItem[] {
    const gameKey = str((port.gameRef ?? {})['id'] ?? (port.gameRef ?? {})['name']);
    const related: PortItem[] = [];
    for (const candidate of this.ports) {
      if (candidate.pid === port.pid || candidate.visible === false) continue;
      const sameGame =
        gameKey !== '' && str((candidate.gameRef ?? {})['id'] ?? (candidate.gameRef ?? {})['name']) === gameKey;
      const sameRepo = !!port.repository && candidate.repository === port.repository;
      const sameProject = !!port.project && fold(candidate.project ?? '') === fold(port.project ?? '');
      if (sameGame || sameRepo || sameProject) related.push(candidate);
      if (related.length >= limit) break;
    }
    return related;
  }

  /* ------------------------- etiqueta de estado --------------------------- */

  /**
   * `{ tag, text, color, glyph, why, pct, conf }` para pintar la insignia de
   * estado de desarrollo de una ficha.
   */
  getDevTagInfo(port: PortItem): DevTagInfo {
    const tag = devTagOf(port);
    const meta = DEV_TAG_META[tag];
    const status = port.status ?? null;
    const community = status?.community ?? null;
    const reviews = Number(community?.reviews ?? 0) || 0;
    const recommended = Number(community?.recommended ?? 0) || 0;
    const pct = reviews > 0 ? Math.round((recommended / reviews) * 100) : 0;

    const reasons = Array.isArray(status?.reasons) ? status!.reasons : [];
    const why =
      reasons.length > 0
        ? reasons.join(' ')
        : tag === 'nodata'
          ? 'Sin datos suficientes para determinar el estado de desarrollo.'
          : meta.label;

    return {
      tag,
      text: meta.label,
      label: meta.label,
      color: meta.color,
      glyph: meta.glyph,
      why,
      pct,
      conf: str(status?.confidence) || 'baja',
    };
  }

  /** Silueta de soporte según la plataforma y los ajustes del usuario. */
  getMediaStyle(port: PortItem, settings?: Settings | null): MediaStyle {
    const platform = port.sourcePlatform ?? 'other';
    if (settings) {
      if (settings.mediaMode === 'single') return settings.mediaDef;
      const override = settings.mediaMap?.[platform];
      if (override) return override;
    }
    return MEDIA_BY_PLATFORM[platform] ?? 'cd';
  }

  /** Ficha "de relleno" para rutas profundas (`#/port/<pid>`) sin catálogo. */
  getPlaceholderPort(pid: string): PortItem | undefined {
    return this.byPid.get(pid);
  }

  /** Sólo tests: deja el servicio como recién construido. */
  reset(): void {
    this.index = null;
    this.ports = [];
    this.byPid.clear();
    this.searchBlob.clear();
    this.libraryStates.clear();
    this.libraryResolver = null;
    this.loading = null;
    this.loadedUrl = null;
    this.lastError = null;
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers de módulo                                                          */
/* -------------------------------------------------------------------------- */

function isUsablePort(value: unknown): value is PortItem {
  if (!value || typeof value !== 'object') return false;
  const port = value as Partial<PortItem>;
  return typeof port.pid === 'string' && port.pid.length > 0 && typeof port.name === 'string';
}

function buildBlob(port: PortItem): string {
  const parts: string[] = [
    port.name,
    str(port.project),
    port.pid,
    str(port.repository),
    str(port.folderName),
    port.sourcePlatform,
    ...asArray<string>(port.tags),
    ...asArray<string>(port.gameNames),
    ...asArray<string>(port.searchAliases),
    ...asArray<string>(port.targetPlatforms),
  ];
  return fold(parts.filter((part) => typeof part === 'string' && part.length > 0).join(' ¦ '));
}

/** Etiqueta de desarrollo efectiva de una ficha. */
export function devTagOf(port: PortItem): DevTag {
  const tag = port.status?.tag;
  if (tag && tag in CATALOG_TO_DEV_TAG) return CATALOG_TO_DEV_TAG[tag];
  return 'nodata';
}

function timestampOf(port: PortItem): number {
  const released = str(port.verifiedRelease?.releasedAt);
  const lastSeen = asArray<{ lastSeen?: string }>(port.sources)
    .map((source) => str(source.lastSeen))
    .sort()
    .pop();
  const raw = released || lastSeen || '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortPorts(ports: PortItem[], sort: SortKey): PortItem[] {
  const items = [...ports];
  const byName = (a: PortItem, b: PortItem): number => a.name.localeCompare(b.name, 'es');

  switch (sort) {
    case 'name-desc':
      return items.sort((a, b) => byName(b, a));
    case 'platform':
      return items.sort((a, b) => {
        const ia = SOURCE_PLATFORMS.indexOf(a.sourcePlatform ?? 'other');
        const ib = SOURCE_PLATFORMS.indexOf(b.sourcePlatform ?? 'other');
        return ia - ib || byName(a, b);
      });
    case 'status':
      return items.sort((a, b) => {
        const ia = DEV_TAG_ORDER[devTagOf(a)];
        const ib = DEV_TAG_ORDER[devTagOf(b)];
        return ia - ib || byName(a, b);
      });
    case 'recent':
      return items.sort((a, b) => timestampOf(b) - timestampOf(a) || byName(a, b));
    case 'name-asc':
    default:
      return items.sort(byName);
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton                                                                  */
/* -------------------------------------------------------------------------- */

export const catalogService = new CatalogService();

export default catalogService;
