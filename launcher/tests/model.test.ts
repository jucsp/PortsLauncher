/* ==========================================================================
 * PortsLauncher · tests/model.test.ts
 *
 * Pruebas de las reglas de HU-13 en `ui/model.ts`:
 *   · Todos los ports requieren ROM (`romOf` nunca devuelve `null`).
 *   · El nombre del proyecto se extrae de un `repr()` de Python.
 *   · La query de búsqueda en addons usa el título real del juego.
 *   · Los argumentos de lanzamiento resuelven `{rom}` sin romper espacios.
 *   · `toGame` refleja la ROM ya guardada en la biblioteca.
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
  inferRomExtensions,
  projectOf,
  providerQuery,
  resolveLaunchArgs,
  romOf,
  splitArgs,
  toGame,
} from '../src/ui/model';

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
