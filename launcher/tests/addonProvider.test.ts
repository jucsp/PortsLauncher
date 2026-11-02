/* ==========================================================================
 * PortsLauncher · tests/addonProvider.test.ts
 *
 * Pruebas del puente entre la UI y los addons `asset-provider`
 * (`src/services/addonProvider.ts`). Todo el I/O está simulado: `fetch` se
 * sustituye por un mock, así que la suite nunca abre red ni lanza Python.
 *
 * Equivalencia con la nomenclatura de la HU-11 (el módulo real usa estos
 * nombres, que son los que se importan aquí):
 *   · `isProviderAddon`        → `isAssetProvider`
 *   · `canProvideForPlatform`  → `providerForPlatform`
 *   · `normalizeSearchOutcome` → `searchProviderAssets` + `readProviderResults`
 *   · `normalizeProvisionOutcome` → `provisionProviderAsset`
 * ========================================================================== */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PROVIDER_ADDON_ID,
  isAssetProvider,
  networkErrorMessage,
  normalizeProviderResult,
  providerErrorMessage,
  providerForPlatform,
  provisionProviderAsset,
  readProviderResults,
  romProviders,
  searchProviderAssets,
  variantLabel,
} from '../src/services/addonProvider';

import type { Addon } from '../src/services/types';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Addon mínimo válido; cada test sobrescribe sólo lo que le interesa. */
function addon(over: Partial<Addon> = {}): Addon {
  return {
    id: 'vimm-vault',
    name: "Vimm's Vault ROM Provider",
    version: '1.0.0',
    description: 'Buscador asistido de ROMs',
    type: 'asset-provider',
    enabled: true,
    installedAt: 1_700_000_000_000,
    ...over,
  };
}

/** Respuesta mínima con la forma que consume `postJSON`. */
function jsonResponse(body: unknown, status = 200): Response {
  return { status, json: async () => body } as unknown as Response;
}

/** Respuesta cuyo cuerpo no es JSON (502 de un intermediario, HTML…). */
function brokenJsonResponse(status = 200): Response {
  return {
    status,
    json: async () => {
      throw new Error('Unexpected token < in JSON');
    },
  } as unknown as Response;
}

/** Firma del `fetch` global, para que el espía conserve los tipos de llamada. */
type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Instala un `fetch` simulado y devuelve el espía. */
function stubFetch(impl: FetchMock) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Cuerpo JSON que se envió en la llamada `callIndex` del espía. */
function sentBody(spy: ReturnType<typeof stubFetch>, callIndex = 0): Record<string, unknown> {
  const init = spy.mock.calls[callIndex]?.[1];
  const raw = init?.body;
  return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* isAssetProvider                                                            */
/* -------------------------------------------------------------------------- */

describe('isAssetProvider', () => {
  it('acepta el tipo canónico asset-provider', () => {
    expect(isAssetProvider(addon())).toBe(true);
    expect(isAssetProvider(addon({ id: 'otro', name: 'Otro' }))).toBe(true);
  });

  it('acepta plugins sin type si declaran search + provision', () => {
    expect(
      isAssetProvider(addon({ id: 'roms-xyz', type: 'scanner', capabilities: ['search', 'provision'] }))
    ).toBe(true);
  });

  it('no acepta plugins que sólo saben buscar', () => {
    expect(isAssetProvider(addon({ id: 'roms-xyz', type: 'scanner', capabilities: ['search'] }))).toBe(
      false
    );
    expect(
      isAssetProvider(addon({ id: 'roms-xyz', type: 'scanner', capabilities: ['provision'] }))
    ).toBe(false);
  });

  it('normaliza las capacidades antes de compararlas', () => {
    expect(
      isAssetProvider(addon({ id: 'roms-xyz', type: 'scanner', capabilities: [' Search', 'PROVISION '] }))
    ).toBe(true);
  });

  it('reconoce al proveedor de referencia por id', () => {
    expect(PROVIDER_ADDON_ID).toBe('vimm-vault');
    expect(isAssetProvider(addon({ type: 'toolchain', capabilities: [] }))).toBe(true);
    expect(isAssetProvider(addon({ id: 'vimm-vault', type: 'toolchain', capabilities: [] }))).toBe(
      true
    );
  });

  it('ignora los addons desactivados', () => {
    expect(isAssetProvider(addon({ enabled: false }))).toBe(false);
  });

  it('tolera entradas que no son addons', () => {
    expect(isAssetProvider(null)).toBe(false);
    expect(isAssetProvider(undefined)).toBe(false);
    expect(isAssetProvider({} as Addon)).toBe(false);
    expect(isAssetProvider([] as unknown as Addon)).toBe(false);
    expect(isAssetProvider('vimm-vault' as unknown as Addon)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* romProviders                                                               */
/* -------------------------------------------------------------------------- */

describe('romProviders', () => {
  it('filtra y conserva el orden de instalación', () => {
    const list = [
      addon({ id: 'a', name: 'A' }),
      addon({ id: 'scanner', name: 'Escáner', type: 'scanner', capabilities: [] }),
      addon({ id: 'b', name: 'B', type: 'asset-provider' }),
      addon({ id: 'off', name: 'Off', enabled: false }),
    ];
    expect(romProviders(list).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('devuelve lista vacía sin addons', () => {
    expect(romProviders(null)).toEqual([]);
    expect(romProviders(undefined)).toEqual([]);
    expect(romProviders([])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* providerForPlatform                                                        */
/* -------------------------------------------------------------------------- */

describe('providerForPlatform', () => {
  const n64 = addon({ id: 'n64-provider', platforms: ['n64'] });
  const snes = addon({ id: 'snes-provider', platforms: ['snes'] });
  const wildcard = addon({ id: 'wildcard', platforms: [] });

  it('elige el que declara la plataforma del port', () => {
    expect(providerForPlatform([n64, snes], 'n64')?.id).toBe('n64-provider');
    expect(providerForPlatform([n64, snes], 'snes')?.id).toBe('snes-provider');
  });

  it('resuelve alias (md → genesis) del vocabulario del catálogo', () => {
    const genesis = addon({ id: 'genesis-provider', platforms: ['genesis'] });
    expect(providerForPlatform([n64, genesis], 'md')?.id).toBe('genesis-provider');
  });

  it('cae al comodín cuando ninguno declara la plataforma', () => {
    expect(providerForPlatform([n64, snes, wildcard], 'gba')?.id).toBe('wildcard');
  });

  it('cae al primero cuando no hay comodín', () => {
    expect(providerForPlatform([n64, snes], 'gba')?.id).toBe('n64-provider');
    expect(providerForPlatform([n64], 'zzz')?.id).toBe('n64-provider');
  });

  it('prefiere el comodín si el port no tiene plataforma', () => {
    expect(providerForPlatform([n64, wildcard], null)?.id).toBe('wildcard');
    expect(providerForPlatform([n64, wildcard], '')?.id).toBe('wildcard');
  });

  it('devuelve null sin proveedores', () => {
    expect(providerForPlatform(null, 'n64')).toBeNull();
    expect(providerForPlatform([], 'n64')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* normalizeProviderResult / readProviderResults                              */
/* -------------------------------------------------------------------------- */

describe('normalizeProviderResult', () => {
  it('normaliza el resultado del plugin', () => {
    expect(
      normalizeProviderResult({
        id: 'vault-1',
        title: '  Super Mario 64  ',
        platform: 'N64',
        format: '.z64',
        url: 'https://vimm.net/vault/1',
        description: 'Plataformas',
        version: '1.0',
        region: 'usa',
      })
    ).toEqual({
      id: 'vault-1',
      title: 'Super Mario 64',
      platform: 'n64',
      format: '.z64',
      url: 'https://vimm.net/vault/1',
      description: 'Plataformas',
      version: '1.0',
      region: 'usa',
    });
  });

  it('acepta assetId/name como sinónimos', () => {
    expect(normalizeProviderResult({ assetId: 'vault-2', name: 'Otra ROM' })).toMatchObject({
      id: 'vault-2',
      title: 'Otra ROM',
    });
  });

  it('usa el id como título cuando falta el nombre', () => {
    expect(normalizeProviderResult({ id: 'vault-3' })?.title).toBe('vault-3');
  });

  it('descarta resultados sin id (no se pueden aprovisionar)', () => {
    expect(normalizeProviderResult({ title: 'Sin id' })).toBeNull();
    expect(normalizeProviderResult({ id: '   ' })).toBeNull();
    expect(normalizeProviderResult(null)).toBeNull();
    expect(normalizeProviderResult('vault-1')).toBeNull();
    expect(normalizeProviderResult([{ id: 'vault-1' }])).toBeNull();
  });
});

describe('readProviderResults', () => {
  it('lee y deduplica la lista de resultados', () => {
    const out = readProviderResults({
      results: [
        { id: 'vault-1', title: 'Super Mario 64' },
        { id: 'vault-2', title: 'Super Mario 64 (J)' },
        { id: 'vault-1', title: 'Duplicado' },
        { title: 'Sin id' },
      ],
    });
    expect(out.map((r) => r.id)).toEqual(['vault-1', 'vault-2']);
    expect(out[0]?.title).toBe('Super Mario 64');
  });

  it('tolera payloads sin results', () => {
    expect(readProviderResults(null)).toEqual([]);
    expect(readProviderResults('nope')).toEqual([]);
    expect(readProviderResults({})).toEqual([]);
    expect(readProviderResults({ results: 'nope' })).toEqual([]);
    expect(readProviderResults({ items: [{ id: 'vault-1' }] })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* variantLabel                                                               */
/* -------------------------------------------------------------------------- */

describe('variantLabel', () => {
  const base = { id: 'vault-1', title: 'X', platform: 'n64', url: '', description: '' };

  it('compone región, versión y formato', () => {
    expect(variantLabel({ ...base, region: 'usa', version: '1.0', format: '.z64' })).toBe(
      'USA · v1.0 · .z64'
    );
  });

  it('no duplica el prefijo v', () => {
    expect(variantLabel({ ...base, region: 'USA', version: 'v1.0', format: '' })).toBe('USA · v1.0');
  });

  it('no deja el hueco vacío', () => {
    expect(variantLabel({ ...base, region: '', version: '', format: '' })).toBe('—');
    expect(variantLabel({ ...base, region: '', version: '', format: '.zip' })).toBe('.zip');
  });
});

/* -------------------------------------------------------------------------- */
/* Mensajes de error                                                          */
/* -------------------------------------------------------------------------- */

describe('providerErrorMessage / networkErrorMessage', () => {
  it('prioriza error sobre message y sobre el texto de reserva', () => {
    expect(providerErrorMessage({ error: 'boom', message: 'msg' }, 'fallback')).toBe('boom');
    expect(providerErrorMessage({ message: 'msg' }, 'fallback')).toBe('msg');
    expect(providerErrorMessage(null, 'fallback')).toBe('fallback');
    expect(providerErrorMessage(null, '')).toBe('El addon no devolvió una respuesta válida.');
  });

  it('distingue el timeout del backend caído', () => {
    expect(networkErrorMessage({ name: 'AbortError' })).toBe('El addon tardó demasiado en responder.');
    expect(networkErrorMessage(new Error('ECONNREFUSED'))).toBe(
      'No se pudo contactar con el backend del launcher (¿está apagado?).'
    );
  });
});

/* -------------------------------------------------------------------------- */
/* searchProviderAssets                                                       */
/* -------------------------------------------------------------------------- */

describe('searchProviderAssets', () => {
  it('devuelve los resultados normalizados y el plugin que respondió', async () => {
    const spy = stubFetch(async () =>
      jsonResponse({
        ok: true,
        pluginId: 'vimm-vault',
        results: [
          { id: 'vault-1', title: 'Super Mario 64', platform: 'n64', region: 'USA', version: '1.0' },
          { assetId: 'vault-2', name: 'Super Mario 64 (J)', platform: 'n64', region: 'Japan' },
          { title: 'sin id, se descarta' },
        ],
      })
    );

    const out = await searchProviderAssets({
      query: 'Super Mario 64',
      platform: 'n64',
      pluginId: 'vimm-vault',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('/api/plugins/search');
    expect(out.ok).toBe(true);
    expect(out.error).toBeNull();
    expect(out.pluginId).toBe('vimm-vault');
    expect(out.results.map((r) => r.id)).toEqual(['vault-1', 'vault-2']);
    expect(out.results[0]).toMatchObject({ region: 'USA', version: '1.0', platform: 'n64' });
  });

  it('envía sólo los campos informados y normaliza la plataforma', async () => {
    const spy = stubFetch(async () => jsonResponse({ ok: true, results: [] }));

    await searchProviderAssets({ query: '  Super Metroid  ', platform: 'SNES', region: 'USA' });

    expect(sentBody(spy)).toEqual({ query: 'Super Metroid', platform: 'snes', region: 'USA' });

    const soloQuery = stubFetch(async () => jsonResponse({ ok: true, results: [] }));
    await searchProviderAssets({ query: 'Chrono Trigger', platform: null, pluginId: null });
    expect(sentBody(soloQuery)).toEqual({ query: 'Chrono Trigger' });
  });

  it('rechaza una búsqueda sin título sin llamar al backend', async () => {
    const spy = stubFetch(async () => jsonResponse({ ok: true, results: [] }));
    const out = await searchProviderAssets({ query: '   ' });

    expect(spy).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: false, results: [], error: 'Falta el título del juego.' });
  });

  it('propaga el error del backend con su código de estado', async () => {
    stubFetch(async () => jsonResponse({ ok: false, error: 'Addon no encontrado' }, 404));
    const out = await searchProviderAssets({ query: 'Super Mario 64' });

    expect(out.ok).toBe(false);
    expect(out.error).toBe('Addon no encontrado');
    expect(out.results).toEqual([]);
  });

  it('trata ok:false con 200 como error legible', async () => {
    stubFetch(async () => jsonResponse({ ok: false, message: 'Plugin sin capacidad search' }));
    const out = await searchProviderAssets({ query: 'Sonic' });

    expect(out.ok).toBe(false);
    expect(out.error).toBe('Plugin sin capacidad search');
  });

  it('sobrevive a una respuesta sin JSON', async () => {
    stubFetch(async () => brokenJsonResponse(502));
    const out = await searchProviderAssets({ query: 'Sonic' });

    expect(out.ok).toBe(false);
    expect(out.error).toBe('El buscador de addons respondió 502.');
  });

  it('convierte un timeout del navegador en mensaje de espera', async () => {
    stubFetch(async () => {
      throw { name: 'AbortError' };
    });
    const out = await searchProviderAssets({ query: 'Sonic' });

    expect(out.ok).toBe(false);
    expect(out.error).toBe('El addon tardó demasiado en responder.');
  });

  it('cae al pluginId de la petición si la respuesta no lo trae', async () => {
    stubFetch(async () => jsonResponse({ ok: true, results: [] }));
    const out = await searchProviderAssets({ query: 'Sonic', pluginId: 'vimm-vault' });

    expect(out.pluginId).toBe('vimm-vault');

    stubFetch(async () => jsonResponse({ ok: true, results: [] }));
    const sinPlugin = await searchProviderAssets({ query: 'Sonic' });
    expect(sinPlugin.pluginId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* provisionProviderAsset                                                     */
/* -------------------------------------------------------------------------- */

describe('provisionProviderAsset', () => {
  const request = {
    pluginId: 'vimm-vault',
    assetId: 'vault-1',
    outputDir: '/home/user/PortsLauncher/ports/sm64',
  };

  it('devuelve la ruta y el sha1 del archivo aprovisionado', async () => {
    const spy = stubFetch(async () =>
      jsonResponse({
        ok: true,
        outputPath: '/home/user/PortsLauncher/ports/sm64/sm64.z64',
        sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
        url: 'https://vimm.net/vault/1',
      })
    );

    const out = await provisionProviderAsset(request);

    expect(spy.mock.calls[0]?.[0]).toBe('/api/plugins/provision');
    expect(sentBody(spy)).toEqual(request);
    expect(out).toEqual({
      ok: true,
      outputPath: '/home/user/PortsLauncher/ports/sm64/sm64.z64',
      sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      url: 'https://vimm.net/vault/1',
      error: null,
    });
  });

  it('no da la ROM por buena si el backend no devuelve archivo', async () => {
    stubFetch(async () => jsonResponse({ ok: true, url: 'https://vimm.net/vault/1' }));
    const out = await provisionProviderAsset(request);

    expect(out.ok).toBe(false);
    expect(out.outputPath).toBeNull();
    expect(out.sha1).toBeNull();
    expect(out.url).toBe('https://vimm.net/vault/1');
    expect(out.error).toBe(
      'No se detectó la descarga. Confírmala en el navegador y vuelve a intentarlo.'
    );
  });

  it('conserva la url de descarga manual que manda el plugin', async () => {
    stubFetch(async () =>
      jsonResponse(
        {
          ok: false,
          error: 'No se detectó descarga de ROM. Se requiere descarga manual asistida desde el enlace del navegador.',
          url: 'https://vimm.net/vault/42',
        },
        502
      )
    );
    const out = await provisionProviderAsset({ ...request, assetId: 'vault-42' });

    expect(out.ok).toBe(false);
    expect(out.url).toBe('https://vimm.net/vault/42');
    expect(out.error).toContain('descarga manual asistida');
  });

  it('valida los parámetros antes de llamar al backend', async () => {
    const spy = stubFetch(async () => jsonResponse({ ok: true }));

    const sinPlugin = await provisionProviderAsset({ ...request, pluginId: '' });
    expect(sinPlugin.error).toBe('Faltan el addon o la variante elegida.');

    const sinAsset = await provisionProviderAsset({ ...request, assetId: '  ' });
    expect(sinAsset.error).toBe('Faltan el addon o la variante elegida.');

    const sinSalida = await provisionProviderAsset({ ...request, outputDir: '' });
    expect(sinSalida.error).toBe('El port no tiene carpeta de instalación.');

    expect(spy).not.toHaveBeenCalled();
  });

  it('informa del timeout sin lanzar', async () => {
    stubFetch(async () => {
      throw { name: 'AbortError' };
    });
    const out = await provisionProviderAsset(request);

    expect(out).toMatchObject({
      ok: false,
      outputPath: null,
      sha1: null,
      url: null,
      error: 'El addon tardó demasiado en responder.',
    });
  });

  it('informa del backend caído sin lanzar', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const out = await provisionProviderAsset(request);

    expect(out.ok).toBe(false);
    expect(out.error).toBe('No se pudo contactar con el backend del launcher (¿está apagado?).');
  });
});
