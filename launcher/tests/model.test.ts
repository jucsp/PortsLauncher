/* ==========================================================================
 * PortsLauncher · tests/model.test.ts
 *
 * Pruebas de las reglas de HU-13 en `ui/model.ts`:
 *   · Todos los ports requieren ROM (`romOf` nunca devuelve `null`).
 *   · El nombre del proyecto se extrae de un `repr()` de Python.
 *   · La query de búsqueda en addons usa el título real del juego.
 *   · Los argumentos de lanzamiento resuelven `{rom}` sin romper espacios.
 *   · `toGame` refleja la ROM ya guardada en la biblioteca.
 *   · `describeRomFileSet` elige el fichero que recibe `{rom}` en discos
 *     multifichero (`.cue` + pistas `.bin`) o en selecciones sin descriptor.
 *
 * `model.ts` consulta `catalogService` (etiqueta de desarrollo) y
 * `libraryService` (arte personalizado), así que ambos se sustituyen por dobles
 * para que el test no toque disco ni red.
 * ========================================================================== */

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/services/types';
import type { LibraryGame, PortItem } from '../src/services/types';
import {
  ROM_EXTENSIONS_FALLBACK,
  describeRomFileSet,
  inferRomExtensions,
  projectOf,
  providerQuery,
  resolveLaunchArgs,
  romOf,
  splitArgs,
  toGame,
} from '../src/ui/model';
import type { RomFileLike } from '../src/ui/model';

vi.mock('../src/services/catalogService', () => ({
  catalogService: {
    getDevTagInfo: () => ({ tag: 'active', why: 'doble de prueba', conf: 'alta' }),
  },
}));

vi.mock('../src/services/libraryService', () => ({
  libraryService: {
    getCustomArt: () => null,
  },
}));

/** Ficha mínima del índice; el resto de campos son opcionales en runtime. */
function portWith(patch: Record<string, unknown> = {}): PortItem {
  return {
    pid: 'harbourmasters-2ship',
    name: '2 Ship 2 Harkinian (Zelda: Majora’s Mask)',
    sourcePlatform: 'n64',
    romProfile: { binding: 'in-app', extensions: [], accepted: [] },
    ...patch,
  } as unknown as PortItem;
}

describe('inferRomExtensions', () => {
  it('infiere las extensiones de la plataforma de origen', () => {
    expect(inferRomExtensions('n64')).toEqual(['.z64', '.n64', '.v64', '.rom']);
    expect(inferRomExtensions('snes')).toContain('.sfc');
    expect(inferRomExtensions('gba')).toContain('.gba');
    expect(inferRomExtensions('ps1')).toContain('.cue');
  });

  it('cae en la reserva genérica para plataformas sin tabla útil', () => {
    expect(inferRomExtensions('other')).toEqual([...ROM_EXTENSIONS_FALLBACK]);
    expect(inferRomExtensions(null)).toEqual([...ROM_EXTENSIONS_FALLBACK]);
    expect(inferRomExtensions(undefined)).toEqual([...ROM_EXTENSIONS_FALLBACK]);
  });

  it('devuelve una copia: mutarla no contamina la tabla', () => {
    const extensions = inferRomExtensions('n64');
    extensions.push('.mutada');
    expect(inferRomExtensions('n64')).not.toContain('.mutada');
  });
});

describe('romOf', () => {
  it('nunca devuelve null aunque el romProfile esté vacío (HU-13)', () => {
    const rom = romOf(portWith());

    expect(rom).not.toBeNull();
    expect(rom.n).toBe('2 Ship 2 Harkinian (Zelda: Majora’s Mask) ROM');
    expect(rom.x).toEqual(['.z64', '.n64', '.v64', '.rom']);
    expect(rom.sha).toBe('requerido');
  });

  it('respeta las extensiones declaradas por el índice', () => {
    const rom = romOf(
      portWith({ romProfile: { binding: 'in-app', extensions: ['.iso', '.gcm'], accepted: [] } })
    );

    expect(rom.x).toEqual(['.iso', '.gcm']);
  });

  it('usa la reserva genérica cuando la plataforma no aporta nada', () => {
    const rom = romOf(portWith({ sourcePlatform: 'other' }));

    expect(rom.x).toEqual([...ROM_EXTENSIONS_FALLBACK]);
  });

  it('abrevia el SHA-1 del primer fichero aceptado', () => {
    const rom = romOf(
      portWith({
        romProfile: {
          binding: 'in-app',
          extensions: ['.z64'],
          accepted: [{ sha1: '0123456789abcdef0123456789abcdef01234567' }],
        },
      })
    );

    expect(rom.sha).toBe('012345678…');
  });
});

describe('projectOf', () => {
  it('extrae el nombre de un diccionario de Python serializado', () => {
    expect(projectOf(portWith({ project: "{'key': 'harbourmasters', 'name': 'Harbour Masters'}" }))).toBe(
      'Harbour Masters'
    );
    expect(projectOf(portWith({ project: '{"key": "harbourmasters", "name": "Harbour Masters"}' }))).toBe(
      'Harbour Masters'
    );
  });

  it('cae a la clave cuando el diccionario no trae name', () => {
    expect(projectOf(portWith({ project: "{'key': 'harbourmasters'}" }))).toBe('harbourmasters');
  });

  it('deja intacto un título que sólo parece un diccionario por las comillas', () => {
    expect(projectOf(portWith({ project: 'Ship of "Harkinian"' }))).toBe('Ship of "Harkinian"');
  });

  it('mantiene el comportamiento previo con cadenas, objetos y ausencia', () => {
    expect(projectOf(portWith({ project: 'Harbour Masters' }))).toBe('Harbour Masters');
    expect(projectOf(portWith({ project: { name: 'Harbour Masters' } }))).toBe('Harbour Masters');
    expect(projectOf(portWith({ project: { key: 'harbourmasters' } }))).toBe('harbourmasters');
    expect(projectOf(portWith({ project: null, name: 'Zelda: Majora’s Mask' }))).toBe('Zelda');
  });
});

describe('providerQuery', () => {
  it('usa el juego real del paréntesis en vez del nombre del motor (HU-13)', () => {
    expect(providerQuery("2 Ship 2 Harkinian (Zelda: Majora's Mask)")).toBe("Majora's Mask");
    expect(providerQuery('2 Ship 2 Harkinian (Zelda: Majora’s Mask)')).toBe('Majora’s Mask');
  });

  it('descarta los paréntesis de metadatos', () => {
    expect(providerQuery('Super Mario 64 (USA)')).toBe('Super Mario 64');
    expect(providerQuery('Super Metroid (Japan) (Rev 1)')).toBe('Super Metroid');
    expect(providerQuery('Chrono Trigger (USA) (En,Fr,De)')).toBe('Chrono Trigger');
  });

  it('usa el contenido del paréntesis cuando es el título del juego', () => {
    expect(providerQuery('Ship of Harkinian (Ocarina of Time)')).toBe('Ocarina of Time');
  });

  it('no toca un título sin paréntesis', () => {
    expect(providerQuery('The Legend of Zelda: Ocarina of Time')).toBe(
      'The Legend of Zelda: Ocarina of Time'
    );
    expect(providerQuery('  Sonic   the Hedgehog  ')).toBe('Sonic the Hedgehog');
  });

  it('tolera entradas vacías o sin contenido', () => {
    expect(providerQuery('')).toBe('');
    expect(providerQuery('   ')).toBe('');
    expect(providerQuery('(USA)')).toBe('(USA)');
  });
});

describe('splitArgs / resolveLaunchArgs', () => {
  it('separa por espacios y respeta comillas', () => {
    expect(splitArgs('--rom {rom} --fullscreen')).toEqual(['--rom', '{rom}', '--fullscreen']);
    expect(splitArgs('--rom "/home/yo/Mis ROMs/zelda.z64" -q')).toEqual([
      '--rom',
      '/home/yo/Mis ROMs/zelda.z64',
      '-q',
    ]);
    expect(splitArgs('   ')).toEqual([]);
  });

  it('sustituye {rom} manteniendo la ruta con espacios como un solo argumento', () => {
    expect(resolveLaunchArgs('--rom {rom} --fullscreen', '/home/yo/Mis ROMs/zelda.z64')).toEqual([
      '--rom',
      '/home/yo/Mis ROMs/zelda.z64',
      '--fullscreen',
    ]);
  });

  it('sustituye {rom} incluso dentro de un argumento compuesto', () => {
    expect(resolveLaunchArgs('--rom-path={rom}', '/roms/x.z64')).toEqual(['--rom-path=/roms/x.z64']);
  });

  it('sin ROM deja los argumentos intactos para que el backend los resuelva', () => {
    expect(resolveLaunchArgs('--rom {rom}', '')).toEqual(['--rom', '{rom}']);
    expect(resolveLaunchArgs('', '/roms/x.z64')).toEqual([]);
  });
});

describe('toGame', () => {
  const settings = { ...DEFAULT_SETTINGS };

  it('refleja la ROM ya guardada en la biblioteca (romOk + romPath)', () => {
    const saved = {
      state: 'Installed',
      installDir: '/home/yo/PortsLauncher/ports/2Ship2Harkinian',
      romPath: '/home/yo/Descargas/zelda.z64',
    } as unknown as LibraryGame;

    const game = toGame(portWith(), { 'harbourmasters-2ship': saved }, settings);

    expect(game.romOk).toBe(true);
    expect(game.romPath).toBe('/home/yo/Descargas/zelda.z64');
    expect(game.rom.x).toEqual(['.z64', '.n64', '.v64', '.rom']);
  });

  it('sigue en «falta ROM» sin romPath ni validación', () => {
    const saved = {
      state: 'Installed',
      installDir: '/home/yo/PortsLauncher/ports/2Ship2Harkinian',
      romPath: null,
      romValidatedAt: null,
    } as unknown as LibraryGame;

    const game = toGame(portWith(), { 'harbourmasters-2ship': saved }, settings);

    expect(game.romOk).toBe(false);
    expect(game.romPath).toBe('');
  });

  it('refleja la validación aunque la ruta no se haya guardado', () => {
    const saved = {
      state: 'Installed',
      romPath: null,
      romValidatedAt: '2024-05-01T10:00:00.000Z',
    } as unknown as LibraryGame;

    expect(toGame(portWith(), { 'harbourmasters-2ship': saved }, settings).romOk).toBe(true);
  });

  it('proyecta el nombre del proyecto sin el diccionario de Python', () => {
    const game = toGame(
      portWith({ project: "{'key': 'harbourmasters', 'name': 'Harbour Masters'}" }),
      {},
      settings
    );

    expect(game.pr).toBe('Harbour Masters');
    expect(game.pr).not.toContain('{');
  });
});

/* -------------------------------------------------------------------------- */
/* Selección de ROM multifichero (HU-15)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ficheros de una selección: sólo importan `name` y `size` (lo mismo que ve el
 * `<input type="file">`), así que se construyen sin `File`.
 */
function fileSet(entries: ReadonlyArray<[string, number]>): RomFileLike[] {
  return entries.map(([name, size]) => ({ name, size }));
}

describe('describeRomFileSet', () => {
  it('devuelve una selección vacía cuando no hay ficheros', () => {
    const empty = describeRomFileSet([]);

    expect(empty.index).toBe(-1);
    expect(empty.main).toBeNull();
    expect(empty.size).toBe(0);
    expect(empty.companions).toEqual([]);
    expect(empty.label).toBe('');
  });

  it('trata `null`/`undefined` y las entradas sin nombre como selección vacía', () => {
    expect(describeRomFileSet(null).main).toBeNull();
    expect(describeRomFileSet(undefined).main).toBeNull();
    /* Un `File` sin nombre no puede usarse como ROM: se descarta. */
    expect(describeRomFileSet([{ name: '' }]).main).toBeNull();
    expect(describeRomFileSet([{ name: '' }]).label).toBe('');
  });

  it('con un solo archivo (.z64) lo elige como principal sin acompañantes', () => {
    const selection = describeRomFileSet(fileSet([['zelda.z64', 33554432]]));

    expect(selection.index).toBe(0);
    expect(selection.main?.name).toBe('zelda.z64');
    expect(selection.size).toBe(33554432);
    expect(selection.companions).toEqual([]);
    /* Sin acompañantes la etiqueta es el nombre pelado, sin sufijo. */
    expect(selection.label).toBe('zelda.z64');
  });

  it('elige el .cue como principal y agrupa los .bin como pistas', () => {
    const selection = describeRomFileSet(
      fileSet([
        ['Dino Crisis 2.cue', 120],
        ['Dino Crisis 2 (Track 1).bin', 4000],
        ['Dino Crisis 2 (Track 2).bin', 3000],
        ['Dino Crisis 2 (Track 3).bin', 2000],
      ])
    );

    expect(selection.main?.name).toBe('Dino Crisis 2.cue');
    expect(selection.index).toBe(0);
    /* El descriptor pesa más que el tamaño: las pistas son mayores y aun así
     * no ganan, porque el emulador abre el `.cue`, no el `.bin`. */
    expect(selection.size).toBe(120);
    expect(selection.companions.map((file) => file.name)).toEqual([
      'Dino Crisis 2 (Track 1).bin',
      'Dino Crisis 2 (Track 2).bin',
      'Dino Crisis 2 (Track 3).bin',
    ]);
    expect(selection.label).toBe('Dino Crisis 2.cue (+3 archivos de pistas)');
  });

  it('usa el singular cuando el disco sólo trae una pista', () => {
    const selection = describeRomFileSet(
      fileSet([
        ['Silent Hill.cue', 90],
        ['Silent Hill (Track 1).bin', 700000],
      ])
    );

    expect(selection.main?.name).toBe('Silent Hill.cue');
    expect(selection.companions).toHaveLength(1);
    expect(selection.label).toBe('Silent Hill.cue (+1 archivo de pistas)');
  });

  it('sin descriptor elige el de mayor tamaño', () => {
    const selection = describeRomFileSet(
      fileSet([
        ['juego.sbi', 100],
        ['juego.z64', 33554432],
        ['leeme.txt', 4096],
      ])
    );

    /* La pista de datos es la grande; un `.sbi` de 100 bytes nunca es el juego. */
    expect(selection.main?.name).toBe('juego.z64');
    expect(selection.index).toBe(1);
    expect(selection.size).toBe(33554432);
    expect(selection.companions.map((file) => file.name)).toEqual(['juego.sbi', 'leeme.txt']);
    expect(selection.label).toBe('juego.z64 (+2 archivos de pistas)');
  });

  it('en empate de tamaño gana el primero, para que el resultado sea determinista', () => {
    const selection = describeRomFileSet(
      fileSet([
        ['disco-b.bin', 1024],
        ['disco-a.bin', 1024],
      ])
    );

    expect(selection.main?.name).toBe('disco-b.bin');
    expect(selection.index).toBe(0);
  });

  it('prefiere `.cue` sobre `.gdi` y `.m3u` cuando conviven', () => {
    const selection = describeRomFileSet(
      fileSet([
        ['Saga.m3u', 300],
        ['Disco 2.gdi', 200],
        ['Disco 1.cue', 100],
      ])
    );

    expect(selection.main?.name).toBe('Disco 1.cue');
    expect(selection.index).toBe(2);
    expect(selection.label).toBe('Disco 1.cue (+2 archivos de pistas)');
  });

  it('usa la ruta relativa de la carpeta como etiqueta legible', () => {
    const selection = describeRomFileSet([
      { name: 'Disco 1.cue', size: 100, webkitRelativePath: 'Dino Crisis 2/Disco 1.cue' },
      { name: 'pista1.bin', size: 4000, webkitRelativePath: 'Dino Crisis 2/pista1.bin' },
    ]);

    expect(selection.main?.webkitRelativePath).toBe('Dino Crisis 2/Disco 1.cue');
    expect(selection.label).toBe('Dino Crisis 2/Disco 1.cue (+1 archivo de pistas)');
  });
});
