/* ==========================================================================
 * PortsLauncher · tests/romLaunch.test.ts
 *
 * Pruebas de la preparación de ROM para el lanzamiento (HU-15):
 *   · `parseDiscReferences` — pistas que declara un `.cue`/`.gdi`;
 *   · `pickMainRomFile` — qué fichero recibe `{rom}`;
 *   · `linkRomForLaunch` — árbol real en una carpeta temporal.
 *
 * `electron/api.cjs` es CommonJS y se carga con `createRequire` (el mismo
 * mecanismo que usa `vite.config.ts`). `linkRomForLaunch` toca disco de verdad,
 * pero **sólo** dentro de `os.tmpdir()`: cada test se lleva su carpeta y la
 * borra al terminar. Ni red ni procesos.
 * ========================================================================== */

import { createRequire } from 'node:module';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/* Carga del backend (CommonJS)                                               */
/* -------------------------------------------------------------------------- */

interface RomEntry {
  path: string;
  size?: number;
}

interface RomLaunchModule {
  parseDiscReferences(text: string, ext: string): string[];
  pickMainRomFile(entries: RomEntry[]): RomEntry | null;
  linkRomForLaunch(rawRomPath: unknown, installDir: string, mode?: 'link' | 'copy'): string | null;
}

const requireCjs = createRequire(import.meta.url) as (id: string) => RomLaunchModule;
const api = requireCjs('../electron/api.cjs');

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Carpeta temporal del test en curso (se borra en `afterEach`). */
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'portslauncher-rom-'));
  /* `linkRomForLaunch` avisa por consola de cada decisión; el ruido no aporta
   * nada al informe de Vitest. */
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

/**
 * Escribe un disco de prueba (`Dino Crisis 2.cue` + sus `.bin`) en `folder`.
 *
 * @param tracks nombres de pista tal cual los declara el `.cue`.
 * @returns ruta absoluta del descriptor.
 */
function writeDisc(folder: string, tracks: readonly string[]): string {
  mkdirSync(folder, { recursive: true });
  const cue = join(folder, 'Dino Crisis 2.cue');
  const lines: string[] = ['REM PortsLauncher · disco de prueba', ''];
  tracks.forEach((track, position) => {
    writeFileSync(join(folder, track), `contenido de ${track}`.repeat(8), 'latin1');
    lines.push(`FILE "${track}" BINARY`);
    lines.push(`  TRACK ${String(position + 1).padStart(2, '0')} MODE2/2352`);
    lines.push('    INDEX 01 00:00:00');
  });
  writeFileSync(cue, lines.join('\n'), 'latin1');
  return cue;
}

/** Carpeta de instalación del port, creada vacía. */
function makeInstallDir(): string {
  const dir = join(root, 'ports', 'DinoCrisis2');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* -------------------------------------------------------------------------- */
/* parseDiscReferences                                                        */
/* -------------------------------------------------------------------------- */

describe('parseDiscReferences', () => {
  it('extrae las pistas que declara un .cue', () => {
    const cue = [
      'REM PortsLauncher',
      'FILE "pista1.bin" BINARY',
      '  TRACK 01 MODE2/2352',
      '    INDEX 01 00:00:00',
      'FILE "pista2.bin" BINARY',
      '  TRACK 02 AUDIO',
      '    INDEX 00 00:00:00',
    ].join('\n');

    expect(api.parseDiscReferences(cue, '.cue')).toEqual(['pista1.bin', 'pista2.bin']);
  });

  it('acepta comillas simples y nombres sin comillas', () => {
    const cue = ["FILE 'pista 1.bin' BINARY", 'FILE pista2.bin BINARY'].join('\n');

    expect(api.parseDiscReferences(cue, '.cue')).toEqual(['pista 1.bin', 'pista2.bin']);
  });

  it('no distingue mayúsculas en la directiva y deduplica las repeticiones', () => {
    const cue = [
      'file "Track 1.bin" binary',
      'FILE "track 1.BIN" BINARY',
      'FILE "Track 2.bin" BINARY',
    ].join('\n');

    expect(api.parseDiscReferences(cue, '.cue')).toEqual(['Track 1.bin', 'Track 2.bin']);
  });

  it('extrae las pistas de un .gdi', () => {
    const gdi = ['2', '1 0 4 2352 track01.bin 0', '2 600 0 2352 track02.raw 0'].join('\n');

    expect(api.parseDiscReferences(gdi, '.gdi')).toEqual(['track01.bin', 'track02.raw']);
  });

  it('no inventa referencias en descriptores sin pistas ni con texto vacío', () => {
    expect(api.parseDiscReferences('cualquier cosa', '.iso')).toEqual([]);
    expect(api.parseDiscReferences('', '.cue')).toEqual([]);
    expect(api.parseDiscReferences(null as unknown as string, '.cue')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* pickMainRomFile                                                            */
/* -------------------------------------------------------------------------- */

describe('pickMainRomFile', () => {
  it('prefiere el descriptor aunque la pista de datos sea mayor', () => {
    const chosen = api.pickMainRomFile([
      { path: '/roms/Dino Crisis 2 (Track 1).bin', size: 900_000 },
      { path: '/roms/Dino Crisis 2.cue', size: 120 },
    ]);

    expect(chosen?.path).toBe('/roms/Dino Crisis 2.cue');
  });

  it('sin descriptor elige el de mayor tamaño', () => {
    const chosen = api.pickMainRomFile([
      { path: '/roms/juego.sbi', size: 100 },
      { path: '/roms/juego.z64', size: 33_554_432 },
    ]);

    expect(chosen?.path).toBe('/roms/juego.z64');
    expect(chosen?.size).toBe(33_554_432);
  });

  it('devuelve null cuando no hay candidatos utilizables', () => {
    expect(api.pickMainRomFile([])).toBeNull();
    expect(api.pickMainRomFile(null as unknown as RomEntry[])).toBeNull();
    expect(api.pickMainRomFile([{ path: '' }])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* linkRomForLaunch                                                           */
/* -------------------------------------------------------------------------- */

describe('linkRomForLaunch', () => {
  it('enlaza el .cue y todas sus pistas en la carpeta del port', () => {
    const roms = join(root, 'roms');
    const cue = writeDisc(roms, ['pista1.bin', 'pista2.bin']);
    const installDir = makeInstallDir();

    const main = api.linkRomForLaunch(cue, installDir);

    /* `{rom}` recibe el descriptor, no una pista suelta. */
    expect(main).toBe(join(installDir, 'Dino Crisis 2.cue'));

    for (const name of ['Dino Crisis 2.cue', 'pista1.bin', 'pista2.bin']) {
      const target = join(installDir, name);
      expect(existsSync(target)).toBe(true);
      expect(statSync(target).size).toBeGreaterThan(0);
    }

    /* El contenido viaja intacto, se haya enlazado o copiado. */
    expect(readFileSync(join(installDir, 'pista1.bin'), 'utf8')).toBe(
      readFileSync(join(roms, 'pista1.bin'), 'utf8')
    );
    expect(readFileSync(join(installDir, 'Dino Crisis 2.cue'), 'utf8')).toContain(
      'FILE "pista2.bin" BINARY'
    );
  });

  it('deja enlaces simbólicos apuntando al origen cuando el sistema lo permite', () => {
    const roms = join(root, 'roms');
    const cue = writeDisc(roms, ['pista1.bin']);
    const installDir = makeInstallDir();

    api.linkRomForLaunch(cue, installDir);

    const track = join(installDir, 'pista1.bin');
    const stats = lstatSync(track);
    if (stats.isSymbolicLink()) {
      expect(readlinkSync(track)).toBe(join(roms, 'pista1.bin'));
    } else {
      /* Sistema de ficheros sin enlaces (o Windows sin permisos): se copió. */
      expect(stats.isFile()).toBe(true);
    }
  });

  it("en modo 'copy' duplica la pista en lugar de enlazarla", () => {
    const roms = join(root, 'roms');
    const cue = writeDisc(roms, ['pista1.bin']);
    const installDir = makeInstallDir();

    const main = api.linkRomForLaunch(cue, installDir, 'copy');

    expect(main).toBe(join(installDir, 'Dino Crisis 2.cue'));
    const track = join(installDir, 'pista1.bin');
    expect(lstatSync(track).isSymbolicLink()).toBe(false);
    expect(readFileSync(track, 'utf8')).toBe(readFileSync(join(roms, 'pista1.bin'), 'utf8'));
  });

  it('acepta una lista de rutas separadas por saltos de línea y elige el descriptor', () => {
    const roms = join(root, 'roms');
    mkdirSync(roms, { recursive: true });
    const standalone = join(roms, 'caratula.z64');
    writeFileSync(standalone, 'rom suelta', 'latin1');
    const cue = writeDisc(roms, ['pista1.bin']);
    const installDir = makeInstallDir();

    const main = api.linkRomForLaunch(`${standalone}\n${cue}`, installDir);

    expect(main).toBe(join(installDir, 'Dino Crisis 2.cue'));
    expect(existsSync(join(installDir, 'caratula.z64'))).toBe(true);
    expect(existsSync(join(installDir, 'pista1.bin'))).toBe(true);
  });

  it('acepta un array JSON de rutas', () => {
    const roms = join(root, 'roms');
    const cue = writeDisc(roms, ['pista1.bin', 'pista2.bin']);
    const installDir = makeInstallDir();

    const main = api.linkRomForLaunch(JSON.stringify([cue]), installDir);

    expect(main).toBe(join(installDir, 'Dino Crisis 2.cue'));
    expect(existsSync(join(installDir, 'pista2.bin'))).toBe(true);
  });

  it('sigue adelante cuando el descriptor declara una pista que no existe', () => {
    const roms = join(root, 'roms');
    const cue = writeDisc(roms, ['pista1.bin', 'pista2.bin']);
    /* La segunda pista se borra: el `.cue` queda apuntando a un fichero ausente. */
    rmSync(join(roms, 'pista2.bin'), { force: true });
    const installDir = makeInstallDir();

    const main = api.linkRomForLaunch(cue, installDir);

    expect(main).toBe(join(installDir, 'Dino Crisis 2.cue'));
    expect(existsSync(join(installDir, 'pista1.bin'))).toBe(true);
    expect(existsSync(join(installDir, 'pista2.bin'))).toBe(false);
  });

  it('devuelve null sin rutas o cuando la ruta no existe', () => {
    const installDir = makeInstallDir();

    expect(api.linkRomForLaunch('', installDir)).toBeNull();
    expect(api.linkRomForLaunch(null, installDir)).toBeNull();
    expect(api.linkRomForLaunch(join(root, 'no-existe.cue'), installDir)).toBeNull();
  });
});
