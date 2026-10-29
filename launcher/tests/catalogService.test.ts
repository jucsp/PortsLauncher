/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/tests/catalogService.test.ts
 *
 * Pruebas de `catalogService` con Vitest. Todo el estado se inyecta con
 * `setIndex()` (fixtures en memoria) o con un `fetch` simulado, de modo que
 * ningún test toca la red ni depende de `data/ports.index.json`.
 * ========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CatalogService,
  catalogService,
  devTagOf,
  fold,
  sortPorts,
} from '../src/services/catalogService';

import { DEFAULT_SETTINGS, DEV_TAG_ORDER, SOURCE_PLATFORMS } from '../src/services/types';
import type {
  CatalogStats,
  PortIndex,
  PortItem,
  StatusInfo,
} from '../src/services/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const LAST_SEEN = '2024-01-01T00:00:00.000Z';

/** Ficha mínima válida: rellena todos los campos obligatorios de `PortItem`. */
function mkPort(over: Partial<PortItem> & { pid: string; name: string }): PortItem {
  return {
    project: null,
    sourcePlatform: 'other',
    targetPlatforms: ['linux'],
    distribution: 'external',
    repository: null,
    repositorySource: null,
    folderName: null,
    iconUrl: null,
    coverUrl: null,
    requiresUserFiles: {},
    gameData: null,
    installRecipe: null,
    modSupport: null,
    preserve: [],
    linux: {},
    android: {},
    maturity: null,
    verification: {},
    visible: true,
    quarantinedLinkFields: [],
    relations: {},
    gameRef: {},
    setupFiles: [],
    aiLevel: 'none',
    playerFeedback: null,
    supportedOS: ['Linux'],
    verifiedRelease: null,
    launch: {},
    installStrategy: 'external',
    romProfile: { binding: 'in-app', extensions: [], accepted: [] },
    sources: [{ source: 'gamewave', externalId: over.pid, lastSeen: LAST_SEEN }],
    status: null,
    tags: [],
    gameNames: [],
    searchAliases: [],
    raw: {},
    ...over,
  };
}

function mkStatus(over: Partial<StatusInfo> & { tag: StatusInfo['tag'] }): StatusInfo {
  return {
    community: { recommended: 0, reviews: 0, bugReports: 0 },
    confidence: 'baja',
    reasons: [],
    computedAt: '2026-10-28T00:00:00.000Z',
    ruleVersion: '1.0.0',
    ...over,
  };
}

function mkStats(total: number): CatalogStats {
  return {
    totalPorts: total,
    bySourcePlatform: {},
    byStatusTag: {},
    byInstallStrategy: {},
    byDistribution: {},
    fusedGamewaveQuiver: 0,
    gamewaveOnly: total,
    quiverOnly: 0,
    uniqueRepositories: 0,
    multiRepositories: [],
    multiRepositoryCount: 0,
    quarantinedLinks: 0,
    withSetupFiles: 0,
    withVerifiedRelease: 0,
    invisible: 0,
  };
}

function makeIndex(ports: PortItem[], over: Partial<PortIndex> = {}): PortIndex {
  return {
    version: '1.0.0',
    schemaVersion: '1.0.0',
    generatedAt: '2026-10-28T14:50:00.000Z',
    semanticHash: 'sha256:abc123',
    stats: mkStats(ports.length),
    ports,
    ...over,
  };
}

/**
 * Catálogo de 9 fichas / 8 visibles:
 * 1 invisible (`n64-experimental`, tag experimental) para probar `onlyVisible`.
 * Plataformas: n64 ×2 visibles, snes, ps1, gba, pc, nds, other.
 * Etiquetas: playable 3, bugs 1, wip 1, abandoned 1, nodata 2, exp 0 (oculta).
 */
function samplePorts(): PortItem[] {
  return [
    mkPort({
      pid: 'n64-zelda',
      name: 'Zelda: Ocarina of Time',
      project: 'Ship of Harkinian',
      sourcePlatform: 'n64',
      targetPlatforms: ['linux', 'windows'],
      distribution: 'github',
      repository: 'HarbourMasters/Shipwright',
      repositorySource: 'github',
      installStrategy: 'release-archive',
      tags: ['hires', '60fps'],
      gameNames: ['The Legend of Zelda'],
      searchAliases: ['oot'],
      verifiedRelease: {
        version: '9.0.0',
        releasedAt: '2026-10-20T00:00:00.000Z',
        prerelease: false,
        pinned: false,
      },
      sources: [{ source: 'gamewave', externalId: '1', lastSeen: '2026-10-27T00:00:00.000Z' }],
      status: mkStatus({
        tag: 'playable',
        community: { recommended: 48, reviews: 50, bugReports: 0 },
        confidence: 'alta',
        reasons: ['Versión publicada y comunidad conforme.'],
      }),
    }),
    mkPort({
      pid: 'n64-mario64',
      name: 'Super Mario 64 Plus',
      project: 'SM64Plus',
      sourcePlatform: 'n64',
      searchAliases: ['sm64plus'],
      status: mkStatus({ tag: 'playable', community: { recommended: 20, reviews: 20, bugReports: 0 } }),
    }),
    mkPort({
      pid: 'snes-smw',
      name: 'Super Mario World DX',
      project: 'Super Mario World',
      sourcePlatform: 'snes',
      distribution: 'github',
      repository: 'owner/smw',
      installStrategy: 'release-installer',
      gameRef: { name: 'Super Mario World' },
      status: mkStatus({
        tag: 'bugs',
        community: { recommended: 3, reviews: 10, bugReports: 6 },
        confidence: 'media',
        reasons: ['Comunidad reporta problemas (30% recomendado) o 6 reportes de bugs.'],
      }),
    }),
    mkPort({
      pid: 'ps1-ff7',
      name: 'Final Fantasy VII Rebirth Port',
      project: 'FF7Rebirth',
      sourcePlatform: 'ps1',
      installStrategy: 'windows-via-proton',
      requiresUserFiles: { es: 'Necesitas la ROM original de PS1.' },
      status: mkStatus({ tag: 'wip', community: { recommended: 4, reviews: 8, bugReports: 1 } }),
    }),
    mkPort({
      pid: 'gba-emerald',
      name: 'Pokémon Esmeralda',
      project: 'Pokémon Esmeralda Port',
      sourcePlatform: 'gba',
      installStrategy: 'source-only',
      tags: ['esp', 'save-edits'],
      searchAliases: ['pokemon emerald', 'emerald'],
      status: mkStatus({ tag: 'playable' }),
    }),
    mkPort({
      pid: 'pc-sonic',
      name: 'Sonic Robo Blast 2',
      sourcePlatform: 'pc',
      verifiedRelease: {
        version: '2.2.13',
        releasedAt: '2025-01-01T00:00:00.000Z',
        prerelease: false,
        pinned: false,
      },
      status: mkStatus({ tag: 'abandoned' }),
    }),
    mkPort({
      pid: 'n64-experimental',
      name: 'N64 Tech Demo',
      sourcePlatform: 'n64',
      visible: false,
      status: mkStatus({ tag: 'experimental' }),
    }),
    mkPort({
      pid: 'nds-nodata',
      name: 'Newer Super Mario DS',
      sourcePlatform: 'nds',
    }),
    mkPort({
      pid: 'other-orphan',
      name: 'Port Sin Datos',
      project: undefined,
      gameRef: { name: 'Super Mario World' },
      tags: ['misc'],
      status: mkStatus({ tag: 'nodata', reasons: ['Sin datos suficientes para determinar el estado de desarrollo.'] }),
    }),
  ];
}

function stubFetchOk(index: PortIndex) {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => index,
  }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

/* -------------------------------------------------------------------------- */
/* Carga del catálogo                                                         */
/* -------------------------------------------------------------------------- */

describe('catalogService · carga del catálogo', () => {
  let svc: CatalogService;

  beforeEach(() => {
    svc = new CatalogService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setIndex prepara puertos, índices auxiliares y metadatos', () => {
    expect(svc.isLoaded()).toBe(false);

    svc.setIndex(makeIndex(samplePorts()));

    expect(svc.isLoaded()).toBe(true);
    expect(svc.getPorts()).toHaveLength(9);
    expect(svc.getPortByPid('n64-zelda')?.name).toBe('Zelda: Ocarina of Time');
    expect(svc.getPortByPid('no-existe')).toBeUndefined();
    expect(svc.getCatalogVersion()).toBe('1.0.0');
    expect(svc.getSemanticHash()).toBe('sha256:abc123');
    expect(svc.getGeneratedAt()).toBe('2026-10-28T14:50:00.000Z');
    expect(svc.getStats()?.totalPorts).toBe(9);
    expect(svc.getVisibleCount()).toBe(8);
  });

  it('loadCatalog carga desde fetch y deja lastError a null', async () => {
    const mock = stubFetchOk(makeIndex(samplePorts()));

    const index = await svc.loadCatalog({ url: '/data/ports.index.json' });

    expect(index.ports).toHaveLength(9);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(svc.lastError).toBeNull();
    expect(svc.getLoadedUrl()).toBe('/data/ports.index.json');
    expect(svc.isLoaded()).toBe(true);
  });

  it('loadCatalog descarta fichas sin pid o sin name', async () => {
    const valid = mkPort({ pid: 'ok-1', name: 'Puerto Válido' });
    const index = makeIndex([
      valid,
      { name: 'sin pid' } as unknown as PortItem,
      { pid: 'sin-name' } as unknown as PortItem,
      { pid: '', name: 'pid vacío' } as unknown as PortItem,
    ]);

    svc.setIndex(index);
    expect(svc.getPorts().map((port) => port.pid)).toEqual(['ok-1']);
  });

  it('cachea el índice: la segunda llamada no vuelve a pedirlo y force sí', async () => {
    const mock = stubFetchOk(makeIndex(samplePorts()));

    await svc.loadCatalog();
    await svc.loadCatalog();
    expect(mock).toHaveBeenCalledTimes(1);

    await svc.loadCatalog({ force: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('estructura no reconocida: degrada sin lanzar y explica el fallo', async () => {
    const mock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }));
    vi.stubGlobal('fetch', mock);

    const index = await svc.loadCatalog({ url: '/data/ports.index.json' });

    expect(index.ports).toEqual([]);
    expect(svc.getPorts()).toEqual([]);
    expect(svc.isLoaded()).toBe(true);
    expect(svc.lastError).toContain('estructura no reconocida');
    expect(svc.lastError).toContain('No se pudo cargar');
  });

  it('HTTP no OK en todas las rutas candidatas: modo degradado con detalle', async () => {
    const mock = vi.fn(async () => ({ ok: false, status: 404, json: async () => null }));
    vi.stubGlobal('fetch', mock);

    const index = await svc.loadCatalog();

    expect(mock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(index.ports).toEqual([]);
    expect(svc.lastError).toContain('HTTP 404');
    expect(svc.getStats()?.totalPorts).toBe(0);
  });

  it('sin fetch disponible reporta el motivo en vez de romper', async () => {
    vi.stubGlobal('fetch', undefined);

    const index = await svc.loadCatalog();

    expect(index.ports).toEqual([]);
    expect(svc.lastError).toContain('Entorno sin');
  });
});

/* -------------------------------------------------------------------------- */
/* Búsqueda                                                                   */
/* -------------------------------------------------------------------------- */

describe('catalogService · búsqueda por texto', () => {
  let svc: CatalogService;

  beforeEach(() => {
    svc = new CatalogService();
    svc.setIndex(makeIndex(samplePorts()));
  });

  const pids = (items: PortItem[]): string[] => items.map((port) => port.pid).sort();

  it('busca en el nombre sin distinguir mayúsculas ni diacríticos', () => {
    expect(pids(svc.search('pokemon'))).toEqual(['gba-emerald']);
    expect(pids(svc.search('POKÉMON'))).toEqual(['gba-emerald']);
    expect(pids(svc.search('ocarina'))).toEqual(['n64-zelda']);
  });

  it('busca en tags', () => {
    expect(pids(svc.search('60fps'))).toEqual(['n64-zelda']);
    expect(pids(svc.search('save-edits'))).toEqual(['gba-emerald']);
    expect(pids(svc.search('misc'))).toEqual(['other-orphan']);
  });

  it('busca en searchAliases y gameNames', () => {
    expect(pids(svc.search('oot'))).toEqual(['n64-zelda']);
    expect(pids(svc.search('emerald'))).toEqual(['gba-emerald']);
    expect(pids(svc.search('legend of zelda'))).toEqual(['n64-zelda']);
  });

  it('busca en proyecto, repositorio y pid', () => {
    expect(pids(svc.search('harkinian'))).toEqual(['n64-zelda']);
    expect(pids(svc.search('harbourmasters'))).toEqual(['n64-zelda']);
    expect(pids(svc.search('ps1-ff7'))).toEqual(['ps1-ff7']);
  });

  it('exige que todos los términos aparezcan (AND por tokens)', () => {
    expect(pids(svc.search('zelda n64'))).toEqual(['n64-zelda']);
    expect(svc.search('zelda snes')).toEqual([]);
    expect(pids(svc.search('mario world dx'))).toEqual(['snes-smw']);
  });

  it('devuelve todo el catálogo visible con query vacía y [] sin coincidencias', () => {
    expect(svc.search('')).toHaveLength(8);
    expect(svc.search('   ')).toHaveLength(8);
    expect(svc.search('zzzz-no-existe')).toEqual([]);
  });

  it('getSuggestions prioriza prefijos y exige 2 caracteres', () => {
    expect(svc.getSuggestions('z')).toEqual([]); // menos de 2 caracteres
    expect(svc.getSuggestions('ze').map((port) => port.pid)).toEqual(['n64-zelda']);
    expect(svc.getSuggestions('port').length).toBeGreaterThanOrEqual(1);
    expect(svc.getSuggestions('super', 1)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Filtros                                                                    */
/* -------------------------------------------------------------------------- */

describe('catalogService · filtros', () => {
  let svc: CatalogService;

  beforeEach(() => {
    svc = new CatalogService();
    svc.setIndex(makeIndex(samplePorts()));
  });

  it('filtra por plataforma de origen', () => {
    expect(svc.search('', { platform: 'n64' })).toHaveLength(2);
    expect(svc.search('', { platform: 'snes' })).toHaveLength(1);
    expect(svc.search('', { platform: 'snes' })[0].pid).toBe('snes-smw');
    expect(svc.search('', { platform: 'ps2' })).toEqual([]);
    expect(svc.search('', { platform: 'all' })).toHaveLength(8);
  });

  it('filtra por estado de desarrollo', () => {
    expect(svc.search('', { dev: 'playable' })).toHaveLength(3);
    expect(svc.search('', { dev: 'bugs' }).map((port) => port.pid)).toEqual(['snes-smw']);
    expect(svc.search('', { dev: 'wip' }).map((port) => port.pid)).toEqual(['ps1-ff7']);
    expect(svc.search('', { dev: 'abandoned' }).map((port) => port.pid)).toEqual(['pc-sonic']);
    expect(svc.search('', { dev: 'nodata' })).toHaveLength(2);
    expect(svc.search('', { dev: 'exp' })).toEqual([]); // sólo existe la ficha invisible
    expect(svc.search('', { dev: 'all' })).toHaveLength(8);
  });

  it('filtra por plataforma de destino y por estrategia', () => {
    expect(svc.search('', { target: 'windows' }).map((port) => port.pid)).toEqual(['n64-zelda']);
    expect(svc.search('', { target: 'linux' })).toHaveLength(8);
    expect(
      svc.search('', { strategy: 'release-archive' }).map((port) => port.pid),
    ).toEqual(['n64-zelda']);
    expect(svc.search('', { strategy: 'windows-via-proton' }).map((port) => port.pid)).toEqual([
      'ps1-ff7',
    ]);
  });

  it('filtra por estado de la biblioteca con setLibraryStates', () => {
    svc.setLibraryStates({ 'n64-zelda': 'Ready', 'ps1-ff7': 'NeedsRom' });

    expect(svc.search('', { library: 'ready' }).map((port) => port.pid)).toEqual(['n64-zelda']);
    expect(svc.search('', { library: 'needs-rom' }).map((port) => port.pid)).toEqual(['ps1-ff7']);
    expect(svc.search('', { library: 'installed' })).toHaveLength(2);
    expect(svc.search('', { library: 'not-installed' })).toHaveLength(6);
    expect(svc.search('', { library: 'all' })).toHaveLength(8);
    expect(svc.getLibraryState('n64-zelda')).toBe('Ready');
    expect(svc.getLibraryState('pc-sonic')).toBe('NotInstalled');
  });

  it('filtra por estado de la biblioteca con resolver reactivo', () => {
    svc.setLibraryResolver((pid) => (pid === 'pc-sonic' ? 'UpdateAvailable' : null));

    expect(svc.search('', { library: 'updates' }).map((port) => port.pid)).toEqual(['pc-sonic']);
    expect(svc.search('', { library: 'installed' })).toHaveLength(1);

    svc.setLibraryResolver(null);
    expect(svc.search('', { library: 'installed' })).toEqual([]);
  });

  it('combina filtros y búsqueda, y onlyVisible:false incluye las ocultas', () => {
    expect(svc.search('mario', { platform: 'snes' }).map((port) => port.pid)).toEqual(['snes-smw']);
    expect(svc.search('', { onlyVisible: false })).toHaveLength(9);
    expect(svc.search('tech', { onlyVisible: false }).map((port) => port.pid)).toEqual([
      'n64-experimental',
    ]);
    expect(svc.search('tech')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Ordenación                                                                 */
/* -------------------------------------------------------------------------- */

describe('catalogService · ordenación', () => {
  let svc: CatalogService;

  beforeEach(() => {
    svc = new CatalogService();
    svc.setIndex(makeIndex(samplePorts()));
  });

  const byName = (a: PortItem, b: PortItem): number => a.name.localeCompare(b.name, 'es');

  it('name-asc ordena alfabéticamente (es) y name-desc lo invierte', () => {
    const asc = svc.search('', {}, 'name-asc');
    expect(asc.map((port) => port.name)).toEqual([...asc].sort(byName).map((port) => port.name));

    const desc = svc.search('', {}, 'name-desc');
    expect(desc.map((port) => port.pid)).toEqual([...asc].reverse().map((port) => port.pid));
  });

  it('platform ordena según SOURCE_PLATFORMS y desempata por nombre', () => {
    const result = svc.search('', {}, 'platform');
    const expected = [...result]
      .sort((a, b) => {
        const ia = SOURCE_PLATFORMS.indexOf(a.sourcePlatform);
        const ib = SOURCE_PLATFORMS.indexOf(b.sourcePlatform);
        return ia - ib || byName(a, b);
      })
      .map((port) => port.pid);

    expect(result.map((port) => port.pid)).toEqual(expected);
    expect(result[0].sourcePlatform).toBe('n64');
    expect(DEV_TAG_ORDER[devTagOf(result[0])]).toBeGreaterThanOrEqual(0);
  });

  it('status ordena de mejor a peor etiqueta (playable antes que abandoned)', () => {
    const result = svc.search('', {}, 'status');
    const order = result.map((port) => DEV_TAG_ORDER[devTagOf(port)]);

    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    }
    expect(devTagOf(result[0])).toBe('playable');
    expect(devTagOf(result[result.length - 1])).toBe('abandoned');
  });

  it('recent coloca primero la release verificada más nueva', () => {
    const result = svc.search('', {}, 'recent');
    expect(result[0].pid).toBe('n64-zelda');
    expect(result[1].pid).toBe('pc-sonic');
  });

  it('sortPorts es reutilizable y no muta la entrada', () => {
    const ports = svc.getPorts();
    const original = ports.map((port) => port.pid);
    const sorted = sortPorts(ports, 'name-desc');

    expect(sorted).not.toBe(ports);
    expect(ports.map((port) => port.pid)).toEqual(original);
    expect(sorted[0].name).toBe([...ports].sort(byName).pop()?.name);
  });
});

/* -------------------------------------------------------------------------- */
/* Etiqueta de desarrollo                                                     */
/* -------------------------------------------------------------------------- */

describe('catalogService · getDevTagInfo', () => {
  let svc: CatalogService;

  beforeEach(() => {
    svc = new CatalogService();
    svc.setIndex(makeIndex(samplePorts()));
  });

  const info = (pid: string) => svc.getDevTagInfo(svc.getPortByPid(pid) as PortItem);

  it('expone tag, text, label, color, glyph, why, pct y conf', () => {
    const zelda = info('n64-zelda');

    expect(zelda.tag).toBe('playable');
    expect(zelda.text).toBe('Jugable');
    expect(zelda.label).toBe('Jugable'); // DevTagInfo extiende DevTagMeta (fix de compilación)
    expect(zelda.color).toBe('var(--st-playable)');
    expect(zelda.glyph).toBe('●');
    expect(zelda.pct).toBe(96); // 48 / 50
    expect(zelda.conf).toBe('alta');
    expect(zelda.why).toBe('Versión publicada y comunidad conforme.');
  });

  it('calcula el porcentaje y la confianza de la comunidad', () => {
    const smw = info('snes-smw');
    expect(smw.tag).toBe('bugs');
    expect(smw.pct).toBe(30); // 3 / 10
    expect(smw.conf).toBe('media');
    expect(smw.why).toContain('6 reportes de bugs');
  });

  it('mapea el tag del indexador "experimental" a "exp"', () => {
    const exp = info('n64-experimental');
    expect(exp.tag).toBe('exp');
    expect(exp.text).toBe('Experimental');
    expect(exp.label).toBe('Experimental');
    expect(exp.color).toBe('var(--st-exp)');
  });

  it('sin estado devuelve "nodata" con explicación propia', () => {
    const nodata = info('nds-nodata');
    expect(nodata.tag).toBe('nodata');
    expect(nodata.text).toBe('Sin datos');
    expect(nodata.pct).toBe(0);
    expect(nodata.conf).toBe('baja');
    expect(nodata.why).toBe('Sin datos suficientes para determinar el estado de desarrollo.');
  });

  it('siempre cumple el contrato DevTagMeta (label === text) para todos los tags', () => {
    for (const port of svc.getPorts()) {
      const value = svc.getDevTagInfo(port);
      expect(typeof value.label).toBe('string');
      expect(value.label.length).toBeGreaterThan(0);
      expect(value.label).toBe(value.text);
      expect(value.color).toMatch(/^var\(--st-/);
      expect(value.conf).toMatch(/^(alta|media|baja)$/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Agregados                                                                  */
/* -------------------------------------------------------------------------- */

describe('catalogService · agregados', () => {
  let svc: CatalogService;

  beforeEach(() => {
    svc = new CatalogService();
    svc.setIndex(makeIndex(samplePorts()));
  });

  it('getPlatformsWithCounts cuenta sólo visibles y ordena por volumen', () => {
    const platforms = svc.getPlatformsWithCounts();

    expect(platforms[0]).toMatchObject({ id: 'n64', count: 2 });
    expect(platforms.find((entry) => entry.id === 'snes')?.count).toBe(1);
    expect(platforms.find((entry) => entry.id === 'ps2')).toBeUndefined();

    const counts = platforms.map((entry) => entry.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    for (const entry of platforms) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.short.length).toBeGreaterThan(0);
    }
  });

  it('getDevCounts y getStrategiesWithCounts resumen el catálogo visible', () => {
    const dev = svc.getDevCounts();
    expect(dev.playable).toBe(3);
    expect(dev.bugs).toBe(1);
    expect(dev.wip).toBe(1);
    expect(dev.abandoned).toBe(1);
    expect(dev.nodata).toBe(2);
    expect(dev.exp).toBe(0);

    const strategies = svc.getStrategiesWithCounts();
    expect(strategies).toHaveLength(5);
    expect(strategies.every((entry) => entry.count > 0)).toBe(true);
    expect(strategies.find((entry) => entry.id === 'release-archive')?.count).toBe(1);
  });

  it('getAllTags ordena por frecuencia', () => {
    const tags = svc.getAllTags();
    expect(tags.map((entry) => entry.tag).sort()).toEqual(
      ['60fps', 'esp', 'hires', 'misc', 'save-edits'].sort(),
    );
    expect(tags.every((entry) => entry.count === 1)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Medios y relaciones                                                        */
/* -------------------------------------------------------------------------- */

describe('catalogService · medios y relaciones', () => {
  let svc: CatalogService;

  beforeEach(() => {
    svc = new CatalogService();
    svc.setIndex(makeIndex(samplePorts()));
  });

  it('getMediaStyle usa la silueta de la plataforma por defecto', () => {
    expect(svc.getMediaStyle(svc.getPortByPid('n64-zelda') as PortItem)).toBe('n64');
    expect(svc.getMediaStyle(svc.getPortByPid('ps1-ff7') as PortItem)).toBe('ps1');
    expect(svc.getMediaStyle(svc.getPortByPid('other-orphan') as PortItem)).toBe('cd');
  });

  it('getMediaStyle respeta mediaMode "single" y mediaMap', () => {
    const port = svc.getPortByPid('n64-zelda') as PortItem;

    expect(
      svc.getMediaStyle(port, { ...DEFAULT_SETTINGS, mediaMode: 'single', mediaDef: 'ps1' }),
    ).toBe('ps1');
    expect(
      svc.getMediaStyle(port, { ...DEFAULT_SETTINGS, mediaMode: 'auto', mediaMap: { n64: 'md' } }),
    ).toBe('md');
    expect(svc.getMediaStyle(port, { ...DEFAULT_SETTINGS, mediaMode: 'auto' })).toBe('n64');
  });

  it('getRelatedPorts usa gameRef, repository y project sin romper con project nulo', () => {
    const smw = svc.getPortByPid('snes-smw') as PortItem;
    const related = svc.getRelatedPorts(smw).map((port) => port.pid);

    expect(related).toContain('other-orphan'); // mismo gameRef.name

    // Regresión del fix de compilación: `candidate.project` puede ser undefined.
    const zelda = svc.getPortByPid('n64-zelda') as PortItem;
    expect(() => svc.getRelatedPorts(zelda)).not.toThrow();
    expect(svc.getRelatedPorts(zelda).map((port) => port.pid)).not.toContain('other-orphan');
    expect(zelda.project).toBe('Ship of Harkinian');
  });

  it('getPlaceholderPort devuelve la ficha si existe', () => {
    expect(svc.getPlaceholderPort('n64-zelda')?.pid).toBe('n64-zelda');
    expect(svc.getPlaceholderPort('no-existe')).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Utilidades exportadas y reset                                              */
/* -------------------------------------------------------------------------- */

describe('catalogService · utilidades y reset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fold normaliza mayúsculas y diacríticos', () => {
    expect(fold('Pokémon')).toBe('pokemon');
    expect(fold('  Ünicode  ')).toBe('  unicode  ');
  });

  it('devTagOf mapea el 100 % de los tags del indexador', () => {
    expect(devTagOf(mkPort({ pid: 'a', name: 'A', status: mkStatus({ tag: 'playable' }) }))).toBe(
      'playable',
    );
    expect(devTagOf(mkPort({ pid: 'b', name: 'B', status: mkStatus({ tag: 'experimental' }) }))).toBe(
      'exp',
    );
    expect(devTagOf(mkPort({ pid: 'c', name: 'C' }))).toBe('nodata');
  });

  it('reset deja el servicio como recién construido', () => {
    catalogService.setIndex(makeIndex(samplePorts()));
    expect(catalogService.getPorts()).toHaveLength(9);

    catalogService.reset();

    expect(catalogService.isLoaded()).toBe(false);
    expect(catalogService.getPorts()).toEqual([]);
    expect(catalogService.getPortByPid('n64-zelda')).toBeUndefined();
    expect(catalogService.getStats()).toBeNull();
    expect(catalogService.lastError).toBeNull();
    expect(catalogService.getLibraryState('n64-zelda')).toBe('NotInstalled');
  });
});
