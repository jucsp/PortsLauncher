/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/tests/libraryService.test.ts
 *
 * Pruebas de `libraryService` con Vitest. Cada test construye su propia
 * instancia sobre un almacén falso (`FakeStore`) o sobre `null` (memoria), de
 * modo que nunca se toca el `localStorage` real ni el singleton.
 * ========================================================================== */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  createLibraryGame,
} from '../src/services/libraryService';

import { DEFAULT_SETTINGS, LIBRARY_STORAGE_KEY } from '../src/services/types';
import type { LibraryGame, LibraryState, Settings } from '../src/services/types';

/* -------------------------------------------------------------------------- */
/* Almacén falso                                                              */
/* -------------------------------------------------------------------------- */

interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class FakeStore implements StoreLike {
  data = new Map<string, string>();
  writes = 0;
  removes = 0;
  failOnSet = false;

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnSet) throw new Error('QuotaExceededError');
    this.writes += 1;
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.removes += 1;
    this.data.delete(key);
  }

  /** Atajo: contenido JSON ya persistido bajo la clave de la biblioteca. */
  seed(value: unknown): void {
    this.data.set(LIBRARY_STORAGE_KEY, JSON.stringify(value));
  }

  parsed(): Record<string, unknown> {
    const raw = this.getItem(LIBRARY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }
}

const ISO = '2026-10-28T14:00:00.000Z';

function makeService(storage?: StoreLike | null): {
  svc: LibraryService;
  store: FakeStore;
} {
  const store = new FakeStore();
  const svc = new LibraryService(storage === undefined ? store : storage);
  return { svc, store };
}

/* -------------------------------------------------------------------------- */
/* Estado inicial y ajustes por defecto                                       */
/* -------------------------------------------------------------------------- */

describe('libraryService · estado inicial seguro', () => {
  it('arranca vacío, sin fichas y con los ajustes por defecto', () => {
    const { svc } = makeService();

    expect(svc.isPersistent()).toBe(true);
    expect(svc.getState().version).toBe(1);
    expect(svc.getState().games).toEqual({});
    expect(svc.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(svc.getInstalledPorts()).toEqual([]);
    expect(svc.isPersistent()).toBe(true);
  });

  it('sin almacén disponible degrada a memoria sin lanzar', () => {
    const { svc } = makeService(null);

    expect(svc.isPersistent()).toBe(false);

    svc.updateLibraryGame('a', { state: 'Installed' });
    expect(svc.getLibraryGame('a').state).toBe('Installed');
    expect(svc.isPersistent()).toBe(false);
  });

  it('getLibraryGame devuelve una ficha neutra para un pid desconocido', () => {
    const { svc } = makeService();

    const fresh = svc.getLibraryGame('desconocido');
    expect(fresh).toMatchObject({
      pid: 'desconocido',
      state: 'NotInstalled',
      installStrategy: 'external',
      installDir: '',
      installedVersion: null,
      romPath: null,
      romMode: DEFAULT_SETTINGS.romMode,
      romValidatedAt: null,
      pinnedVersion: null,
      autoUpdate: true,
    });
    expect(fresh.launchProfile).toEqual({});
    expect(svc.has('desconocido')).toBe(false);
  });

  it('createLibraryGame rellena los valores por defecto del contrato', () => {
    const game = createLibraryGame('x', 'release-archive');

    expect(game.pid).toBe('x');
    expect(game.installStrategy).toBe('release-archive');
    expect(game.state).toBe('NotInstalled');
    expect(game.autoUpdate).toBe(true);
    expect(game.romMode).toBe('link');
    expect(game.progress).toBe(0);
    expect(game.error).toBeNull();
  });

  it('un JSON corrupto no rompe el arranque: se ignora el contenido', () => {
    const store = new FakeStore();
    store.data.set(LIBRARY_STORAGE_KEY, '{esto no es json');

    const svc = new LibraryService(store);

    expect(svc.getState().games).toEqual({});
    expect(svc.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('un JSON válido pero con formas inesperadas se sanea', () => {
    const store = new FakeStore();
    store.data.set(LIBRARY_STORAGE_KEY, '[]');
    expect(new LibraryService(store).getState().games).toEqual({});

    store.data.set(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: 7,
        updatedAt: ISO,
        games: {
          a: { state: 'Nope', autoUpdate: false, romMode: 'zzz', launchProfile: 'x', installedVersion: 5 },
          b: { state: 'Ready', romPath: '/roms/x.n64', romMode: 'copy', autoUpdate: false },
        },
        settings: { media: false, view: 'carousel', mediaMap: { n64: 'md', nes: 'bogus' } },
      }),
    );

    const svc = new LibraryService(store);
    const a = svc.getLibraryGame('a');
    const b = svc.getLibraryGame('b');

    expect(a.state).toBe('NotInstalled');
    expect(a.autoUpdate).toBe(false);
    expect(a.romMode).toBe('link');
    expect(a.launchProfile).toEqual({});
    expect(a.installedVersion).toBeNull();

    expect(b.state).toBe('Ready');
    expect(b.romPath).toBe('/roms/x.n64');
    expect(b.romMode).toBe('copy');

    const settings = svc.getSettings();
    expect(settings.media).toBe(false);
    expect(settings.view).toBe('carts');
    expect(settings.mediaMap).toEqual({ n64: 'md' });
  });
});

/* -------------------------------------------------------------------------- */
/* Fichas: actualización y transiciones                                       */
/* -------------------------------------------------------------------------- */

describe('libraryService · actualización de fichas', () => {
  let svc: LibraryService;
  let store: FakeStore;

  beforeEach(() => {
    ({ svc, store } = makeService());
  });

  it('updateLibraryGame crea la ficha, aplica el patch y persiste', () => {
    const game = svc.updateLibraryGame('gw::n64-zelda', {
      state: 'Installing',
      installDir: '/opt/ports/zelda',
      installedVersion: '9.0.0',
    });

    expect(game.state).toBe('Installing');
    expect(game.installDir).toBe('/opt/ports/zelda');
    expect(game.installedVersion).toBe('9.0.0');
    expect(svc.has('gw::n64-zelda')).toBe(true);
    expect(store.writes).toBeGreaterThanOrEqual(1);

    const persisted = store.parsed() as { games: Record<string, LibraryGame> };
    expect(persisted.games['gw::n64-zelda'].state).toBe('Installing');
  });

  it('updateLibraryGame preserva los campos no incluidos en el patch', () => {
    svc.updateLibraryGame('a', { installDir: '/opt/a', installedVersion: '1.0.0' });
    const patched = svc.updateLibraryGame('a', { state: 'Installed' });

    expect(patched.installDir).toBe('/opt/a');
    expect(patched.installedVersion).toBe('1.0.0');
    expect(patched.state).toBe('Installed');
  });

  it('updateLibraryGame exige un pid', () => {
    expect(() => svc.updateLibraryGame('', { state: 'Installed' })).toThrow(/falta el pid/);
  });

  it('sanea valores inválidos que lleguen por patch', () => {
    const game = svc.updateLibraryGame('a', {
      state: 'Nope' as LibraryState,
      romMode: 'move' as never,
    });

    expect(game.state).toBe('NotInstalled');
    expect(game.romMode).toBe('link');
  });

  it('setState recorre la máquina de estados y acepta extras', () => {
    const downloading = svc.setState('a', 'Downloading', { progress: 0 });
    expect(downloading.state).toBe('Downloading');

    const installing = svc.setState('a', 'Installing', { installDir: '/opt/a' });
    expect(installing.state).toBe('Installing');
    expect(installing.installDir).toBe('/opt/a');

    const installed = svc.setState('a', 'Installed', { installedVersion: '1.2.3' });
    expect(installed.state).toBe('Installed');
    expect(installed.installedVersion).toBe('1.2.3');

    const ready = svc.setState('a', 'Ready');
    expect(ready.state).toBe('Ready');
    expect(svc.getInstalledPorts()).toHaveLength(1);
  });

  it('setProgress recorta el progreso a 0–100', () => {
    expect(svc.setProgress('a', 42).progress).toBe(42);
    expect(svc.setProgress('a', 150).progress).toBe(100);
    expect(svc.setProgress('a', -5).progress).toBe(0);
    expect(svc.setProgress('a', 33.6).progress).toBe(34);
  });

  it('markBroken y setUpdateAvailable dejan el motivo/versión registrados', () => {
    svc.setState('a', 'Installed');

    const broken = svc.markBroken('a', 'Ejecutable no encontrado');
    expect(broken.state).toBe('Broken');
    expect(broken.error).toBe('Ejecutable no encontrado');

    const updatable = svc.setUpdateAvailable('a', '9.1.0');
    expect(updatable.state).toBe('UpdateAvailable');
    expect(updatable.installedVersion).toBe('9.1.0');
    expect(updatable.error).toBeNull();
  });

  it('getLibraryGame devuelve una copia: mutarla no altera el estado interno', () => {
    svc.updateLibraryGame('a', { state: 'Installed' });

    const copy = svc.getLibraryGame('a');
    copy.state = 'Broken';

    expect(svc.getLibraryGame('a').state).toBe('Installed');
  });

  it('un fallo de escritura no pierde el estado: pasa a memoria', () => {
    store.failOnSet = true;

    const game = svc.updateLibraryGame('a', { state: 'Installed' });

    expect(game.state).toBe('Installed');
    expect(svc.getLibraryGame('a').state).toBe('Installed');
    expect(svc.isPersistent()).toBe(false);
  });

  it('relee el estado persistido al construirse', () => {
    store.seed({
      version: 1,
      updatedAt: ISO,
      games: { a: { ...createLibraryGame('a'), state: 'Ready', romPath: '/roms/a.n64' } },
      settings: { ...DEFAULT_SETTINGS, view: 'table' },
    });

    const other = new LibraryService(store);

    expect(other.getLibraryGame('a').state).toBe('Ready');
    expect(other.getLibraryGame('a').romPath).toBe('/roms/a.n64');
    expect(other.getSettings().view).toBe('table');
  });
});

/* -------------------------------------------------------------------------- */
/* ROM                                                                        */
/* -------------------------------------------------------------------------- */

describe('libraryService · ROM del usuario', () => {
  let svc: LibraryService;

  beforeEach(() => {
    ({ svc } = makeService());
  });

  it('setRom NO degrada una ficha que aún no está instalada', () => {
    const game = svc.setRom('a', '/roms/a.n64', 'link', true);

    expect(game.romPath).toBe('/roms/a.n64');
    expect(game.state).toBe('NotInstalled');
    expect(game.romValidatedAt).toBeNull();
  });

  it('setRom validada lleva la ficha de Installed a Ready', () => {
    svc.setState('a', 'Installed');

    const game = svc.setRom('a', '/roms/a.n64', 'copy', true);

    expect(game.state).toBe('Ready');
    expect(game.romPath).toBe('/roms/a.n64');
    expect(game.romMode).toBe('copy');
    expect(game.romValidatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('setRom sin validar deja la ficha en NeedsRom', () => {
    svc.setState('a', 'Installed');

    const game = svc.setRom('a', '/roms/a.n64', 'link', false);

    expect(game.state).toBe('NeedsRom');
    expect(game.romValidatedAt).toBeNull();
    expect(game.romPath).toBe('/roms/a.n64');
  });

  it('setRom con ruta vacía equivale a no tener ROM', () => {
    svc.setState('a', 'Installed');

    const game = svc.setRom('a', '   ', 'link', true);

    expect(game.romPath).toBeNull();
    expect(game.state).toBe('NeedsRom');
    expect(game.romValidatedAt).toBeNull();
  });

  it('clearRom devuelve la ficha a NeedsRom y limpia la validación', () => {
    svc.setState('a', 'Installed');
    svc.setRom('a', '/roms/a.n64', 'link', true);
    expect(svc.getLibraryGame('a').state).toBe('Ready');

    const game = svc.clearRom('a');

    expect(game.romPath).toBeNull();
    expect(game.romValidatedAt).toBeNull();
    expect(game.state).toBe('NeedsRom');
  });
});

/* -------------------------------------------------------------------------- */
/* Consultas agregadas                                                        */
/* -------------------------------------------------------------------------- */

describe('libraryService · consultas agregadas', () => {
  let svc: LibraryService;

  beforeEach(() => {
    ({ svc } = makeService());
    svc.setState('b', 'Ready');
    svc.setState('a', 'Installed');
    svc.setState('c', 'NeedsRom');
    svc.setState('d', 'UpdateAvailable');
    svc.setState('e', 'Broken');
    svc.updateLibraryGame('f', { state: 'NotInstalled' });
  });

  it('getInstalledPorts excluye NotInstalled y ordena por pid', () => {
    expect(svc.getInstalledPorts().map((game) => game.pid)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('getPortsInState filtra por estado exacto', () => {
    expect(svc.getPortsInState('Ready').map((game) => game.pid)).toEqual(['b']);
    expect(svc.getPortsInState('NeedsRom').map((game) => game.pid)).toEqual(['c']);
    expect(svc.getPortsInState('Downloading')).toEqual([]);
  });

  it('getStateCounts cubre los 8 estados de la máquina', () => {
    const counts = svc.getStateCounts();

    expect(Object.keys(counts).sort()).toEqual(
      [
        'Broken',
        'Downloading',
        'Installed',
        'Installing',
        'NeedsRom',
        'NotInstalled',
        'Ready',
        'UpdateAvailable',
      ].sort(),
    );
    expect(counts.Ready).toBe(1);
    expect(counts.NotInstalled).toBe(1);
    expect(counts.Downloading).toBe(0);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('getStates exporta el mapa { pid: state } para el catálogo', () => {
    const states = svc.getStates();

    expect(states).toBeInstanceOf(Map);
    expect(states.get('b')).toBe('Ready');
    expect(states.get('e')).toBe('Broken');
    expect(states.size).toBe(6);
  });

  it('uninstallPort limpia la instalación y conserva las decisiones del usuario', () => {
    svc.updateLibraryGame('a', {
      state: 'Ready',
      installDir: '/opt/a',
      installedVersion: '1.0.0',
      romPath: '/roms/a.n64',
      romMode: 'copy',
      pinnedVersion: '0.9.0',
      autoUpdate: false,
    });

    const game = svc.uninstallPort('a');

    expect(game.state).toBe('NotInstalled');
    expect(game.installDir).toBe('');
    expect(game.installedVersion).toBeNull();
    expect(game.romPath).toBeNull();
    expect(game.romValidatedAt).toBeNull();
    expect(game.pinnedVersion).toBe('0.9.0');
    expect(game.autoUpdate).toBe(false);
    expect(game.romMode).toBe('copy');
  });

  it('getStates refleja la baja tras uninstallPort', () => {
    svc.uninstallPort('c');
    expect(svc.getStates().get('c')).toBe('NotInstalled');
  });
});

/* -------------------------------------------------------------------------- */
/* Ajustes                                                                    */
/* -------------------------------------------------------------------------- */

describe('libraryService · ajustes', () => {
  let svc: LibraryService;
  let store: FakeStore;

  beforeEach(() => {
    ({ svc, store } = makeService());
  });

  it('updateSettings fusiona el patch con los ajustes actuales', () => {
    const settings = svc.updateSettings({ view: 'table', dest: 'Windows' });

    expect(settings.view).toBe('table');
    expect(settings.dest).toBe('Windows');
    expect(settings.installDir).toBe(DEFAULT_SETTINGS.installDir);
    expect(settings.media).toBe(DEFAULT_SETTINGS.media);
  });

  it('updateSettings sanea valores inválidos y persiste el resultado', () => {
    const settings = svc.updateSettings({
      view: 'carousel' as Settings['view'],
      mediaMode: 'nope' as never,
      mediaDef: 'zzz' as never,
      dest: 'Mac' as never,
      romMode: 'move' as never,
    });

    expect(settings.view).toBe('carts');
    expect(settings.mediaMode).toBe('auto');
    expect(settings.mediaDef).toBe('cd');
    expect(settings.dest).toBe('Linux');
    expect(settings.romMode).toBe('link');

    const persisted = store.parsed() as { settings: Settings };
    expect(persisted.settings.view).toBe('carts');
    expect(persisted.settings.dest).toBe('Linux');
  });

  it('un installDir/romDir vacío cae a los valores por defecto', () => {
    svc.updateSettings({ installDir: '/data/ports' });
    expect(svc.getSettings().installDir).toBe('/data/ports');

    const settings = svc.updateSettings({ installDir: '   ', romDir: '  ' });
    expect(settings.installDir).toBe(DEFAULT_SETTINGS.installDir);
    expect(settings.romDir).toBe(DEFAULT_SETTINGS.romDir);
  });

  it('setPlatformMedia añade overrides por plataforma sin perder el resto', () => {
    svc.setPlatformMedia('n64', 'md');
    svc.setPlatformMedia('nes', 'snes');

    const settings = svc.getSettings();
    expect(settings.mediaMap).toEqual({ n64: 'md', nes: 'snes' });
    expect(settings.view).toBe(DEFAULT_SETTINGS.view);
  });

  it('getSettings devuelve una copia independiente', () => {
    const settings = svc.getSettings();
    settings.view = 'table';
    settings.mediaMap.n64 = 'gb';

    expect(svc.getSettings().view).toBe('carts');
    expect(svc.getSettings().mediaMap.n64).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Export / import / reset                                                    */
/* -------------------------------------------------------------------------- */

describe('libraryService · exportación, importación y reseteo', () => {
  let svc: LibraryService;
  let store: FakeStore;

  beforeEach(() => {
    ({ svc, store } = makeService());
    svc.setState('a', 'Ready', { installedVersion: '1.0.0' });
    svc.updateSettings({ view: 'list' });
  });

  it('exportJson serializa un ports.json válido', () => {
    const pretty = svc.exportJson();
    const parsed = JSON.parse(pretty) as { version: number; games: Record<string, LibraryGame>; settings: Settings };

    expect(parsed.version).toBe(1);
    expect(parsed.games.a.state).toBe('Ready');
    expect(parsed.settings.view).toBe('list');
    expect(pretty).toContain('\n');

    expect(svc.exportJson(false)).not.toContain('\n');
  });

  it('importJson carga un ports.json válido', () => {
    const payload = JSON.stringify({
      version: 1,
      updatedAt: ISO,
      games: { z: { ...createLibraryGame('z', 'release-archive'), state: 'Installed' } },
      settings: { ...DEFAULT_SETTINGS, view: 'carts' },
    });

    expect(svc.importJson(payload)).toBe(true);
    expect(svc.getLibraryGame('z').state).toBe('Installed');
    expect(svc.getLibraryGame('z').installStrategy).toBe('release-archive');
    expect(svc.getSettings().view).toBe('carts');
    expect(svc.has('a')).toBe(false); // el import sustituye, no fusiona
  });

  it('importJson sanea las fichas importadas', () => {
    const payload = JSON.stringify({ games: { y: { state: 'Bogus', autoUpdate: false } } });

    expect(svc.importJson(payload)).toBe(true);
    expect(svc.getLibraryGame('y').state).toBe('NotInstalled');
    expect(svc.getLibraryGame('y').autoUpdate).toBe(false);
  });

  it('importJson rechaza contenido inválido sin alterar la biblioteca', () => {
    expect(svc.importJson('no-json')).toBe(false);
    expect(svc.importJson('{"games":[]}')).toBe(false);
    expect(svc.importJson('{"foo":1}')).toBe(false);
    expect(svc.importJson('null')).toBe(false);
    expect(svc.getLibraryGame('a').state).toBe('Ready');
  });

  it('resetLibrary vacía biblioteca y ajustes y borra la clave', () => {
    const events: string[] = [];
    svc.subscribe((event) => events.push(event.type));

    svc.resetLibrary();

    expect(svc.getState().games).toEqual({});
    expect(svc.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(store.getItem(LIBRARY_STORAGE_KEY)).toBeNull();
    expect(store.removes).toBe(1);
    expect(events).toContain('reset');
  });

  it('reload relee el almacén y emite hydrate', () => {
    store.seed({
      version: 1,
      updatedAt: ISO,
      games: { q: { ...createLibraryGame('q'), state: 'Installed' } },
      settings: { ...DEFAULT_SETTINGS },
    });

    const events: string[] = [];
    svc.subscribe((event) => events.push(event.type));
    svc.reload();

    expect(svc.getLibraryGame('q').state).toBe('Installed');
    expect(events).toContain('hydrate');
  });
});

/* -------------------------------------------------------------------------- */
/* Suscripciones                                                              */
/* -------------------------------------------------------------------------- */

describe('libraryService · eventos', () => {
  let svc: LibraryService;

  beforeEach(() => {
    ({ svc } = makeService());
  });

  it('emite "game" y "settings" con el pid afectado', () => {
    const events: Array<{ type: string; pid?: string }> = [];
    svc.subscribe((event) => events.push({ type: event.type, pid: event.pid }));

    svc.updateLibraryGame('a', { state: 'Installed' });
    svc.updateSettings({ view: 'big' });

    expect(events).toEqual([
      { type: 'game', pid: 'a' },
      { type: 'settings', pid: undefined },
    ]);
  });

  it('unsubscribe deja de notificar y un listener roto no interrumpe', () => {
    const seen: string[] = [];
    const off = svc.subscribe((event) => seen.push(event.type));

    svc.subscribe(() => {
      throw new Error('listener roto');
    });

    svc.updateLibraryGame('a', { state: 'Installed' });
    expect(seen).toHaveLength(1);

    off();
    expect(() => svc.updateLibraryGame('a', { state: 'Ready' })).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(svc.getLibraryGame('a').state).toBe('Ready');
  });

  it('snapshot devuelve una copia profunda', () => {
    svc.updateLibraryGame('a', { state: 'Installed', launchProfile: { executable: 'run.sh' } });

    const snap = svc.snapshot();
    snap.games.a.state = 'Broken';
    (snap.games.a.launchProfile as { executable?: string }).executable = 'otro';

    expect(svc.getLibraryGame('a').state).toBe('Installed');
    expect(svc.getLibraryGame('a').launchProfile.executable).toBe('run.sh');
  });
});
