/* ==========================================================================
 * PortsLauncher · tests/render.test.ts
 *
 * Pruebas del asistente de bienvenida (`wizardModalHTML`). Es HTML puro, así
 * que basta con comprobar los textos, los `data-act` y el escapado de la clave
 * de SteamGridDB: no hace falta DOM.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/services/types';
import type { Settings } from '../src/services/types';
import { wizardModalHTML } from '../src/ui/render';

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
