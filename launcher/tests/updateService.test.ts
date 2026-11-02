/* ==========================================================================
 * PortsLauncher · tests/updateService.test.ts
 *
 * Pruebas del comprobador de actualizaciones del launcher. Todo el I/O está
 * simulado: `fetch` se sustituye por un mock y `localStorage` no se toca
 * (siempre se pasa el repositorio de forma explícita).
 * ========================================================================== */

import { afterEach, describe, expect, it, vi } from 'vitest';

import pkg from '../package.json';

import {
  CURRENT_VERSION,
  FALLBACK_VERSION,
  VERSION_SOURCE,
  checkForUpdates,
  cleanVersion,
  compareSemver,
  findPlatformAsset,
  isCheckFailed,
  isUpToDate,
  isValidRepo,
  parseSemver,
} from '../src/services/updateService';

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Respuesta mínima con la forma que consume `checkForUpdates`. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** Firma del `fetch` global, para que el espía conserve los tipos de llamada. */
type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Instala un `fetch` simulado y devuelve el espía. */
function stubFetch(impl: FetchMock) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

const REPO = 'jucsp/PortsLauncher';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* compareSemver                                                              */
/* -------------------------------------------------------------------------- */

describe('compareSemver', () => {
  it('detecta que hay una versión más nueva', () => {
    expect(compareSemver('v0.2.0', '0.1.0')).toBe(1);
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
    expect(compareSemver('0.1.1', '0.1.0')).toBe(1);
  });

  it('considera iguales las versiones con y sin prefijo v', () => {
    expect(compareSemver('0.1.0', 'v0.1.0')).toBe(0);
    expect(compareSemver('v0.1.0', 'v0.1.0')).toBe(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('detecta que la versión publicada es más antigua', () => {
    expect(compareSemver('0.0.9', '0.1.0')).toBe(-1);
    expect(compareSemver('v0.1.0', '0.2.0')).toBe(-1);
  });

  it('tolera versiones cortas, con sufijo o basura', () => {
    expect(compareSemver('v1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.2.3-beta.1', '1.2.3')).toBe(0);
    expect(parseSemver('v1.2')).toEqual([1, 2, 0]);
    expect(parseSemver('basura')).toEqual([0, 0, 0]);
  });
});

/* -------------------------------------------------------------------------- */
/* cleanVersion / isValidRepo                                                 */
/* -------------------------------------------------------------------------- */

describe('cleanVersion', () => {
  it('quita el prefijo v y los espacios', () => {
    expect(cleanVersion(' v0.2.0 ')).toBe('0.2.0');
    expect(cleanVersion('0.2.0')).toBe('0.2.0');
  });
});

describe('isValidRepo', () => {
  it('acepta owner/repo y rechaza el resto', () => {
    expect(isValidRepo(REPO)).toBe(true);
    expect(isValidRepo('a/b')).toBe(true);
    expect(isValidRepo('')).toBe(false);
    expect(isValidRepo('sin-barra')).toBe(false);
    expect(isValidRepo('a/b/c')).toBe(false);
    expect(isValidRepo('../../etc')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* findPlatformAsset                                                          */
/* -------------------------------------------------------------------------- */

describe('findPlatformAsset', () => {
  const assets = [
    { name: 'PortsLauncher-0.2.0.AppImage', browser_download_url: 'https://x/appimage' },
    { name: 'portslauncher_0.2.0_amd64.deb', browser_download_url: 'https://x/deb' },
    { name: 'PortsLauncher-0.2.0.tar.gz', browser_download_url: 'https://x/targz' },
    { name: 'PortsLauncher Setup 0.2.0.exe', browser_download_url: 'https://x/exe' },
    { name: 'PortsLauncher-0.2.0-win.zip', browser_download_url: 'https://x/winzip' },
    { name: 'PortsLauncher-0.2.0.dmg', browser_download_url: 'https://x/dmg' },
    { name: 'latest.yml', browser_download_url: 'https://x/yml' },
    { name: 'PortsLauncher-0.2.0.AppImage.sha256', browser_download_url: 'https://x/sha' },
  ];

  it('encuentra el AppImage en Linux', () => {
    expect(findPlatformAsset(assets, 'linux')).toEqual({
      name: 'PortsLauncher-0.2.0.AppImage',
      url: 'https://x/appimage',
    });
  });

  it('prioriza AppImage sobre deb y tar.gz', () => {
    const onlyDebAndTar = assets.filter((asset) => !asset.name.endsWith('.AppImage'));
    expect(findPlatformAsset(onlyDebAndTar, 'linux')?.name).toBe('portslauncher_0.2.0_amd64.deb');
    const onlyTar = assets.filter(
      (asset) => !asset.name.endsWith('.AppImage') && !asset.name.endsWith('.deb')
    );
    expect(findPlatformAsset(onlyTar, 'linux')?.name).toBe('PortsLauncher-0.2.0.tar.gz');
  });

  it('encuentra el .exe en Windows', () => {
    expect(findPlatformAsset(assets, 'win32')).toEqual({
      name: 'PortsLauncher Setup 0.2.0.exe',
      url: 'https://x/exe',
    });
  });

  it('cae al .zip cuando no hay .exe', () => {
    const noExe = assets.filter((asset) => !asset.name.endsWith('.exe'));
    expect(findPlatformAsset(noExe, 'win32')?.name).toBe('PortsLauncher-0.2.0-win.zip');
  });

  it('ignora assets de otro sistema y los ficheros que no son instaladores', () => {
    const macOnly = [{ name: 'PortsLauncher-0.2.0.dmg', browser_download_url: 'https://x/dmg' }];
    expect(findPlatformAsset(macOnly, 'linux')).toBeNull();
    expect(findPlatformAsset(macOnly, 'win32')).toBeNull();

    const checksums = [{ name: 'PortsLauncher-0.2.0.AppImage.sha256', browser_download_url: 'x' }];
    expect(findPlatformAsset(checksums, 'linux')).toBeNull();
    expect(findPlatformAsset([], 'linux')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* checkForUpdates                                                            */
/* -------------------------------------------------------------------------- */

describe('checkForUpdates', () => {
  it('detecta una versión nueva y elige el asset del SO', async () => {
    const spy = stubFetch(async () =>
      jsonResponse({
        tag_name: 'v0.2.0',
        name: 'PortsLauncher 0.2.0',
        body: '## Novedades\n- Auto-actualizador',
        published_at: '2026-01-02T10:00:00Z',
        html_url: 'https://github.com/jucsp/PortsLauncher/releases/tag/v0.2.0',
        assets: [
          { name: 'PortsLauncher-0.2.0.AppImage', browser_download_url: 'https://x/appimage' },
          { name: 'PortsLauncher Setup 0.2.0.exe', browser_download_url: 'https://x/exe' },
        ],
      })
    );

    const result = await checkForUpdates(REPO, 'linux');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain(`https://api.github.com/repos/${REPO}/releases/latest`);
    expect(result.hasUpdate).toBe(true);
    expect(result.currentVersion).toBe(CURRENT_VERSION);
    expect(result.latestVersion).toBe('0.2.0');
    expect(result.assetName).toBe('PortsLauncher-0.2.0.AppImage');
    expect(result.downloadUrl).toBe('https://x/appimage');
    expect(result.releaseNotes).toContain('Auto-actualizador');
    expect(result.publishedAt).toBe('2026-01-02T10:00:00Z');
  });

  it('en Windows elige el .exe', async () => {
    stubFetch(async () =>
      jsonResponse({
        tag_name: 'v0.3.0',
        assets: [
          { name: 'PortsLauncher-0.3.0.AppImage', browser_download_url: 'https://x/appimage' },
          { name: 'PortsLauncher Setup 0.3.0.exe', browser_download_url: 'https://x/exe' },
        ],
      })
    );

    const result = await checkForUpdates(REPO, 'win32');
    expect(result.assetName).toBe('PortsLauncher Setup 0.3.0.exe');
    expect(result.downloadUrl).toBe('https://x/exe');
  });

  it('con la misma versión no hay actualización', async () => {
    stubFetch(async () => jsonResponse({ tag_name: `v${CURRENT_VERSION}` }));

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe(CURRENT_VERSION);
    expect(result.downloadUrl).toBeNull();
  });

  it('un 404 no rompe la app y devuelve el resultado neutro', async () => {
    stubFetch(async () => jsonResponse({ message: 'Not Found' }, false, 404));

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe(CURRENT_VERSION);
    expect(result.assetName).toBeNull();
  });

  it('un error de red se traga sin lanzar excepciones', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });

    await expect(checkForUpdates(REPO, 'linux')).resolves.toMatchObject({
      hasUpdate: false,
      latestVersion: CURRENT_VERSION,
    });
  });

  it('ignora borradores y prereleases', async () => {
    stubFetch(async () => jsonResponse({ tag_name: 'v9.9.9', draft: true }));
    expect((await checkForUpdates(REPO, 'linux')).hasUpdate).toBe(false);

    stubFetch(async () => jsonResponse({ tag_name: 'v9.9.9', prerelease: true }));
    expect((await checkForUpdates(REPO, 'linux')).hasUpdate).toBe(false);
  });

  it('no llama a la red con un repositorio inválido', async () => {
    const spy = stubFetch(async () => jsonResponse({ tag_name: 'v9.9.9' }));

    const result = await checkForUpdates('no-es-un-repo', 'linux');
    expect(spy).not.toHaveBeenCalled();
    expect(result.hasUpdate).toBe(false);
  });

  it('sin instalador para el SO ofrece la página del release', async () => {
    stubFetch(async () =>
      jsonResponse({
        tag_name: 'v0.4.0',
        html_url: 'https://github.com/jucsp/PortsLauncher/releases/tag/v0.4.0',
        assets: [{ name: 'PortsLauncher-0.4.0.dmg', browser_download_url: 'https://x/dmg' }],
      })
    );

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.hasUpdate).toBe(true);
    expect(result.assetName).toBeNull();
    expect(result.downloadUrl).toBe(
      'https://github.com/jucsp/PortsLauncher/releases/tag/v0.4.0'
    );
  });
});

/* -------------------------------------------------------------------------- */
/* HU-12 · versión dinámica                                                   */
/* -------------------------------------------------------------------------- */

describe('CURRENT_VERSION', () => {
  it('es un semver completo o el fallback declarado', () => {
    if (VERSION_SOURCE === 'build') {
      expect(CURRENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    } else {
      expect(CURRENT_VERSION).toBe(FALLBACK_VERSION);
    }
  });

  it('coincide con la versión de package.json cuando el define está aplicado', () => {
    /* `vite.config.ts` inyecta `pkg.version`; Vitest reutiliza esa config. Si
     * el entorno no aplica `define`, el módulo cae al fallback y aquí no hay
     * nada que comparar. */
    if (VERSION_SOURCE === 'build') {
      expect(CURRENT_VERSION).toBe(String((pkg as { version?: string }).version));
    }
  });

  it('no es la cadena vacía ni un placeholder obsoleto', () => {
    expect(CURRENT_VERSION.trim().length).toBeGreaterThan(0);
    expect(CURRENT_VERSION).not.toBe('undefined');
    expect(CURRENT_VERSION).not.toBe('null');
  });
});

/* -------------------------------------------------------------------------- */
/* HU-12 · diagnóstico de la consulta                                         */
/* -------------------------------------------------------------------------- */

describe('checkForUpdates · status y error', () => {
  it('un release válido deja status ok y error null', async () => {
    stubFetch(async () => jsonResponse({ tag_name: `v${CURRENT_VERSION}` }));

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.status).toBe('ok');
    expect(result.error).toBeNull();
    expect(isCheckFailed(result)).toBe(false);
    expect(isUpToDate(result)).toBe(true);
  });

  it('un 404 se reporta como not_found y NO como «al día»', async () => {
    stubFetch(async () => jsonResponse({ message: 'Not Found' }, false, 404));

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.status).toBe('not_found');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('404');
    expect(result.hasUpdate).toBe(false);
    expect(isUpToDate(result)).toBe(false);
    expect(isCheckFailed(result)).toBe(true);
  });

  it('un 403 se reporta como rate_limited', async () => {
    stubFetch(async () => jsonResponse({ message: 'API rate limit exceeded' }, false, 403));

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.status).toBe('rate_limited');
    expect(isCheckFailed(result)).toBe(true);
    expect(isUpToDate(result)).toBe(false);
  });

  it('un 429 también es rate_limited', async () => {
    stubFetch(async () => jsonResponse({}, false, 429));
    expect((await checkForUpdates(REPO, 'linux')).status).toBe('rate_limited');
  });

  it('un 500 se reporta como network_error', async () => {
    stubFetch(async () => jsonResponse({}, false, 500));

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.status).toBe('network_error');
    expect(result.error).toContain('500');
  });

  it('un fallo de red se reporta con el mensaje de la excepción', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.status).toBe('network_error');
    expect(result.error).toContain('offline');
    expect(isUpToDate(result)).toBe(false);
  });

  it('un repositorio inválido no consulta la red y lo reporta', async () => {
    const spy = stubFetch(async () => jsonResponse({ tag_name: 'v9.9.9' }));

    const result = await checkForUpdates('no-es-un-repo', 'linux');
    expect(spy).not.toHaveBeenCalled();
    expect(result.status).toBe('invalid_repo');
    expect(isUpToDate(result)).toBe(false);
  });

  it('un release sin tag ni name se reporta como no_release', async () => {
    stubFetch(async () => jsonResponse({ name: '' }));

    const result = await checkForUpdates(REPO, 'linux');
    expect(result.status).toBe('no_release');
    expect(isUpToDate(result)).toBe(false);
  });

  it('un borrador o prerelease se reporta como no_release', async () => {
    stubFetch(async () => jsonResponse({ tag_name: 'v9.9.9', draft: true }));
    expect((await checkForUpdates(REPO, 'linux')).status).toBe('no_release');

    stubFetch(async () => jsonResponse({ tag_name: 'v9.9.9', prerelease: true }));
    expect((await checkForUpdates(REPO, 'linux')).status).toBe('no_release');
  });

  it('isUpToDate/isCheckFailed toleran null y undefined', () => {
    expect(isUpToDate(null)).toBe(false);
    expect(isCheckFailed(undefined)).toBe(false);
  });
});
