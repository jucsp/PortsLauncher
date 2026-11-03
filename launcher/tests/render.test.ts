/* ==========================================================================
 * PortsLauncher · tests/render.test.ts
 *
 * Pruebas del asistente de bienvenida (`wizardModalHTML`). Es HTML puro, así
 * que basta con comprobar los textos, los `data-act` y el escapado de la clave
 * de SteamGridDB: no hace falta DOM.
 * ========================================================================== */

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/services/types';
import type { PortItem, Settings } from '../src/services/types';
import { launcherUpdateBodyHTML, setLauncherUpdate, wizardModalHTML } from '../src/ui/render';
import type { UpdateCheckResult } from '../src/services/updateService';
import { disclaimerMarkup, resolveAuthorDocUrl } from '../src/components/DetailModal';
import { renderRomAssistant } from '../src/components/RomAssistantModal';

/** Ajustes base con la clave vacía (copia: `DEFAULT_SETTINGS` es compartido). */
function settingsWith(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('wizardModalHTML', () => {
  it('envuelve el paso en un scrim que cierra el asistente y un modal de 560px', () => {
    const html = wizardModalHTML(settingsWith(), 1);

    expect(html).toContain('<div class="scrim" data-act="close-wizard"></div>');
    expect(html).toContain('<div class="modal" role="dialog"');
    expect(html).toContain('style="max-width:560px;width:calc(100vw - 32px)"');
    /* Botón de omitir en la cabecera del asistente. */
    expect(html).toContain('<button class="btn ghost sm" data-act="finish-wizard">Omitir</button>');
  });

  it('paso 1: bienvenida, aviso legal y botón «Siguiente»', () => {
    const html = wizardModalHTML(settingsWith(), 1);

    expect(html).toContain('¡Bienvenido a PortsLauncher!');
    expect(html).toContain(
      'El lanzador de escritorio para puertos nativos, recompilaciones y proyectos de ingeniería inversa de código abierto.'
    );
    expect(html).toContain('no aloja ni distribuye archivos protegidos por derechos de autor');
    expect(html).toContain(
      '<button class="btn primary" data-act="wizard-step" data-k="2">Siguiente →</button>'
    );
  });

  it('paso 2: campo opcional de SteamGridDB con la clave vigente', () => {
    const html = wizardModalHTML(settingsWith({ steamgridApiKey: 'clave-123' }), 2);

    expect(html).toContain('Arte oficial y carátulas (Opcional)');
    expect(html).toContain('Clave API de SteamGridDB (opcional)');
    expect(html).toContain('data-set="steamgridApiKey"');
    expect(html).toContain('value="clave-123"');
    expect(html).toContain('carátulas geométricas y estilizadas únicas para cada título');
    expect(html).toContain('<button class="btn sm" data-act="wizard-step" data-k="1">← Anterior</button>');
    expect(html).toContain(
      '<button class="btn primary" data-act="wizard-step" data-k="3">Siguiente →</button>'
    );
  });

  it('paso 2: sin clave el campo queda vacío y nunca se inyecta HTML', () => {
    expect(wizardModalHTML(settingsWith({ steamgridApiKey: '' }), 2)).toContain(
      'placeholder="Pega tu clave aquí (opcional)" value=""'
    );

    const html = wizardModalHTML(settingsWith({ steamgridApiKey: '"><script>x</script>' }), 2);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('paso 3: ecosistema de plugins, guía oficial y botón de cierre', () => {
    const html = wizardModalHTML(settingsWith(), 3);

    expect(html).toContain('Ecosistema de Plugins y Extensiones');
    expect(html).toContain('<code>~/.local/share/portslauncher/plugins/</code>');
    expect(html).toContain('<b>docs/PLUGINS.md</b>');
    expect(html).toContain('<b>docs/LEGAL.md</b>');
    expect(html).toContain('<button class="btn sm" data-act="wizard-step" data-k="2">← Anterior</button>');
    expect(html).toContain('<button class="btn pri" data-act="finish-wizard">¡Comenzar a explorar!</button>');
  });

  it('normaliza el paso: cualquier valor fuera de 2–3 cae en el 1', () => {
    const first = wizardModalHTML(settingsWith(), 1);
    expect(wizardModalHTML(settingsWith(), 0)).toBe(first);
    expect(wizardModalHTML(settingsWith(), 7)).toBe(first);
    expect(wizardModalHTML(settingsWith(), -1)).toBe(first);
  });
});

/** Resultado de comprobación fallido (sin versión superior conocida). */
function failedCheck(status: UpdateCheckResult['status'], error: string): UpdateCheckResult {
  return {
    hasUpdate: false,
    status,
    error,
    currentVersion: '0.1.0',
    latestVersion: '',
    releaseName: '',
    releaseNotes: '',
    publishedAt: '',
    downloadUrl: null,
    assetName: null,
    htmlUrl: '',
  };
}

describe('launcherUpdateBodyHTML (consulta fallida)', () => {
  afterEach(() => setLauncherUpdate({ state: 'idle' }));

  it('not_found no afirma «Estás al día» y ofrece Reintentar', () => {
    setLauncherUpdate({ state: 'done', result: failedCheck('not_found', 'Sin releases.') });
    const html = launcherUpdateBodyHTML();

    expect(html).not.toContain('Estás al día');
    expect(html).toContain('No se pudo comprobar la actualización');
    expect(html).toContain('data-act="check-updates"');
    expect(html).toContain('Reintentar');
  });

  it('rate_limited muestra el mensaje de cuota y no «Estás al día»', () => {
    setLauncherUpdate({
      state: 'done',
      result: failedCheck('rate_limited', 'GitHub limitó la consulta (403/429). Espera unos minutos.'),
    });
    const html = launcherUpdateBodyHTML();

    expect(html).not.toContain('Estás al día');
    expect(html).toContain('GitHub limitó la consulta');
    expect(html).toContain('estado: rate_limited');
  });

  it('network_error muestra el error de conexión', () => {
    setLauncherUpdate({
      state: 'done',
      result: failedCheck('network_error', 'No se pudo conectar con GitHub: Failed to fetch.'),
    });
    const html = launcherUpdateBodyHTML();

    expect(html).not.toContain('Estás al día');
    expect(html).toContain('No se pudo conectar con GitHub');
    expect(html).toContain('estado: network_error');
  });
});

/* -------------------------------------------------------------------------- */
/* Disclaimer de compatibilidad y enlace a documentación (HU-18)              */
/* -------------------------------------------------------------------------- */

describe('Disclaimer de compatibilidad y enlace a documentación (HU-18)', () => {
  function makeTestPort(over: Partial<PortItem> = {}): PortItem {
    return {
      pid: 'test-port',
      name: 'Test Port',
      project: null,
      sourcePlatform: 'ps1',
      targetPlatforms: ['linux'],
      distribution: 'github',
      repository: 'author/repo',
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
      supportedOS: ['linux'],
      verifiedRelease: null,
      launch: {},
      installStrategy: 'external',
      romProfile: { binding: 'in-app', extensions: [], accepted: [] },
      sources: [],
      status: null,
      tags: [],
      gameNames: [],
      searchAliases: [],
      raw: {},
      ...over,
    };
  }

  it('resuelve la documentación del autor desde projectUrl o repository', () => {
    const portWithProject = makeTestPort({ raw: { projectUrl: 'https://example.com/project' } });
    expect(resolveAuthorDocUrl(portWithProject)).toBe('https://example.com/project');

    const portWithRepo = makeTestPort({ repository: 'user/game-port' });
    expect(resolveAuthorDocUrl(portWithRepo)).toBe('https://github.com/user/game-port');
  });

  it('disclaimerMarkup incluye el texto de disclaimer y el enlace al autor', () => {
    const port = makeTestPort({ repository: 'author/myport' });
    const markup = disclaimerMarkup(port);

    expect(markup).toContain('El ejecutable y los parámetros necesarios para iniciar este juego (o cargar la ROM/BIOS) pueden variar según la versión y las decisiones del autor del repositorio. Por favor, consulta la documentación oficial entregada por el autor.');
    expect(markup).toContain('📖 Ver documentación del autor');
    expect(markup).toContain('https://github.com/author/myport');
  });

  it('renderRomAssistant incluye el bloque visual de disclaimer', () => {
    const port = makeTestPort({ repository: 'author/myport' });
    const assistantHtml = renderRomAssistant(port);

    expect(assistantHtml).toContain('El ejecutable y los parámetros necesarios para iniciar este juego (o cargar la ROM/BIOS) pueden variar según la versión y las decisiones del autor del repositorio. Por favor, consulta la documentación oficial entregada por el autor.');
    expect(assistantHtml).toContain('📖 Ver documentación del autor');
  });
});

