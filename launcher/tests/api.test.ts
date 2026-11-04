/* ==========================================================================
 * PortsLauncher · tests/api.test.ts
 *
 * Pruebas del endpoint `GET /api/port-executables` y de `listPortExecutables`
 * (detector de ejecutables del port que alimenta el desplegable del engranaje):
 *
 *   · `listPortExecutables` ordena por `launchScore` y devuelve rutas relativas
 *     con barras normales (`./sub/bin`), incluye las carpetas de build y no se
 *     rompe si la carpeta no existe.
 *   · `handlePortExecutables` resuelve `installDir` / `folderName`, responde 405
 *     fuera de GET y 400 con un `folderName` inválido.
 *   · El enrutador reconoce la ruta (antes caía en el 404 del servidor estático).
 *
 * `electron/api.cjs` es CommonJS y se carga con `createRequire` (el mismo
 * mecanismo que usa `vite.config.ts`). Todo el árbol de prueba vive en
 * `os.tmpdir()` y se borra al terminar: ni red, ni procesos, ni `~/PortsLauncher`.
 * ========================================================================== */

import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/* Carga del backend (CommonJS)                                               */
/* -------------------------------------------------------------------------- */

/** Ejecutable detectado, en la forma que documenta el endpoint. */
interface PortExecutableEntry {
  name: string;
  relative: string;
  file: string;
  score: number;
}

/** Petición mínima que entiende el backend (`method` + `url`). */
interface FakeRequest {
  method: string;
  url: string;
}

/** Respuesta mínima: `sendJSON` usa `statusCode`, `setHeader` y `end`. */
interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

interface ApiModule {
  listPortExecutables(dir: string, hint?: string): PortExecutableEntry[];
  handlePortExecutables(req: FakeRequest, res: FakeResponse): Promise<void>;
  handleApiRequest(req: FakeRequest, res: FakeResponse): Promise<boolean>;
  createApiMiddleware(): (req: FakeRequest, res: FakeResponse, next: () => void) => void;
}

const requireCjs = createRequire(import.meta.url) as (id: string) => ApiModule;
const api = requireCjs('../electron/api.cjs');

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Carpeta temporal del test en curso (se borra en `afterEach`). */
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'portslauncher-exe-'));
  /* Los avisos de escaneo no aportan nada al informe de Vitest. */
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

/** Respuesta falsa con la misma interfaz que usa `sendJSON`. */
function fakeResponse(): FakeResponse {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name: string, value: string): void {
      this.headers[name] = value;
    },
    end(chunk?: string): void {
      this.body = chunk ?? '';
    },
  };
}

/** Cuerpo JSON ya parseado de una respuesta falsa. */
function jsonOf(res: FakeResponse): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

/**
 * Escribe un fichero dentro de `folder` (se crea si hace falta).
 *
 * Un binario sin extensión sólo cuenta como ejecutable si su cabecera lo es, y
 * `looksExecutable` acepta el shebang (`#!`) en los dos primeros bytes: eso es
 * exactamente lo que hay en el disco del usuario.
 */
function writeFile(folder: string, name: string, body = '#!/bin/sh'): string {
  mkdirSync(folder, { recursive: true });
  const full = join(folder, name);
  writeFileSync(full, body);
  return full;
}

/* -------------------------------------------------------------------------- */
/* `listPortExecutables`                                                      */
/* -------------------------------------------------------------------------- */

describe('listPortExecutables', () => {
  it('ordena por score y devuelve rutas relativas con barras normales', () => {
    const port = join(root, 'DinoCrisis');
    writeFile(port, 'README.md', '# no soy un ejecutable');
    writeFile(port, 'DinoCrisis.sh');
    writeFile(port, 'launcher.sh');

    const list = api.listPortExecutables(port);

    expect(list.length).toBe(2);
    /* Ningún elemento puede ser el README. */
    expect(list.some((item) => /readme/i.test(item.name))).toBe(false);
    /* `relative` es siempre `./…` con `/`, nunca con `\`. */
    for (const item of list) {
      expect(item.relative.startsWith('./')).toBe(true);
      expect(item.relative).not.toContain('\\');
      expect(item.file).toContain(port);
      expect(typeof item.score).toBe('number');
    }
    /* Orden descendente por puntuación. */
    expect(list[0].score).toBeGreaterThanOrEqual(list[1].score);
    expect(list.map((item) => item.name)).toEqual(['DinoCrisis.sh', 'launcher.sh']);
  });

  it('encuentra ejecutables dentro de las carpetas de build', () => {
    const port = join(root, 'ShipOfHarkinian');
    writeFile(port, 'run.sh');
    writeFile(join(port, 'build-release'), '2ship.sh');

    const list = api.listPortExecutables(port);
    const relatives = list.map((item) => item.relative);

    expect(relatives).toContain('./build-release/2ship.sh');
    /* `build-release` suma bonus: el binario compilado gana al script genérico. */
    expect(list[0].relative).toBe('./build-release/2ship.sh');
  });

  it('sube al primer puesto el ejecutable que el usuario ya declaró (hint)', () => {
    const port = join(root, 'Multi');
    writeFile(port, 'aaa.sh');
    writeFile(port, 'zzz.sh');

    expect(api.listPortExecutables(port)[0].name).toBe('aaa.sh');

    const conPista = api.listPortExecutables(port, './zzz.sh');
    expect(conPista[0].name).toBe('zzz.sh');
    expect(conPista[0].score).toBeGreaterThan(conPista[1].score);
  });

  it('devuelve lista vacía si la carpeta no existe o no es un directorio', () => {
    expect(api.listPortExecutables(join(root, 'no-existe'))).toEqual([]);
    expect(api.listPortExecutables('')).toEqual([]);

    const file = writeFile(root, 'suelto.txt', 'hola');
    expect(api.listPortExecutables(file)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* `GET /api/port-executables`                                                */
/* -------------------------------------------------------------------------- */

describe('handlePortExecutables', () => {
  it('devuelve los ejecutables de `installDir`', async () => {
    const port = join(root, 'DinoCrisis');
    writeFile(port, 'DinoCrisis.sh');

    const res = fakeResponse();
    await api.handlePortExecutables(
      { method: 'GET', url: `/api/port-executables?installDir=${encodeURIComponent(port)}` },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('application/json');
    const body = jsonOf(res);
    expect(body['ok']).toBe(true);
    expect(body['installDir']).toBe(port);
    const executables = body['executables'] as PortExecutableEntry[];
    expect(executables.length).toBe(1);
    expect(executables[0].relative).toBe('./DinoCrisis.sh');
  });

  it('responde lista vacía (200) si el directorio no existe', async () => {
    const missing = join(root, 'sin-instalar');
    const res = fakeResponse();
    await api.handlePortExecutables(
      { method: 'GET', url: `/api/port-executables?installDir=${encodeURIComponent(missing)}` },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(jsonOf(res)['ok']).toBe(true);
    expect(jsonOf(res)['executables']).toEqual([]);
  });

  it('responde lista vacía (200) cuando no se indica ninguna carpeta', async () => {
    const res = fakeResponse();
    await api.handlePortExecutables({ method: 'GET', url: '/api/port-executables' }, res);

    expect(res.statusCode).toBe(200);
    expect(jsonOf(res)).toEqual({ ok: true, installDir: '', executables: [] });
  });

  it('rechaza un `folderName` que intente salir de la carpeta de ports', async () => {
    const res = fakeResponse();
    await api.handlePortExecutables(
      { method: 'GET', url: '/api/port-executables?folderName=..%2F..%2Fetc' },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(jsonOf(res)['ok']).toBe(false);
  });

  it('acepta `folderName` de un port sin instalar (lista vacía, 200)', async () => {
    const res = fakeResponse();
    await api.handlePortExecutables(
      { method: 'GET', url: '/api/port-executables?folderName=NoInstaladoAun' },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(jsonOf(res)['executables']).toEqual([]);
  });

  it('sólo atiende GET', async () => {
    const res = fakeResponse();
    await api.handlePortExecutables({ method: 'POST', url: '/api/port-executables' }, res);

    expect(res.statusCode).toBe(405);
    expect(jsonOf(res)['ok']).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Enrutador                                                                  */
/* -------------------------------------------------------------------------- */

describe('enrutado de /api/port-executables', () => {
  it('`handleApiRequest` lo resuelve y devuelve true', async () => {
    const port = join(root, 'DinoCrisis');
    writeFile(port, 'DinoCrisis.sh');

    const res = fakeResponse();
    const handled = await api.handleApiRequest(
      { method: 'GET', url: `/api/port-executables?installDir=${encodeURIComponent(port)}` },
      res
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('no delega en `next()` (el middleware lo reconoce como ruta de API)', async () => {
    const port = join(root, 'DinoCrisis');
    writeFile(port, 'DinoCrisis.sh');

    const next = vi.fn();
    const res = fakeResponse();
    api.createApiMiddleware()(
      { method: 'GET', url: `/api/port-executables?installDir=${encodeURIComponent(port)}` },
      res,
      next
    );

    /* El middleware responde de forma asíncrona: se espera a que `end` corra. */
    await vi.waitFor(() => {
      expect(res.statusCode).toBe(200);
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('sigue dejando pasar las rutas que no son de la API', () => {
    const next = vi.fn();
    api.createApiMiddleware()({ method: 'GET', url: '/index.html' }, fakeResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

