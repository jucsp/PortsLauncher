/* ==========================================================================
 * PortsLauncher · tests/selfUpdate.test.ts
 *
 * Pruebas de la auto-actualización del launcher (HU-14):
 *   · detección del tipo de instalación (AppImage portable vs carpeta);
 *   · decisión de elección (`pkexec`/UAC) a partir de la escriturabilidad;
 *   · generación de los scripts desacoplados (POSIX y PowerShell);
 *   · parcheo del `.desktop` del usuario.
 *
 * `electron/api.cjs` es CommonJS y se carga con `createRequire` (el mismo
 * mecanismo que usa `vite.config.ts`). Todo lo que se prueba aquí es puro: no
 * se toca el disco, ni la red, ni se lanza ningún proceso.
 * ========================================================================== */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/* -------------------------------------------------------------------------- */
/* Carga del backend (CommonJS)                                               */
/* -------------------------------------------------------------------------- */

interface InstallTarget {
  kind: 'appimage' | 'folder';
  source: string;
  target: string;
  installDir: string;
  execPath: string;
}

interface SelfUpdateModule {
  shellQuote(value: unknown): string;
  psQuote(value: unknown): string;
  parseDesktopExec(text: string): { command: string; args: string[] } | null;
  splitDesktopArgs(raw: string): string[];
  resolveInstallTarget(input: Record<string, unknown>): InstallTarget;
  selfUpdateRuntime(env: unknown, versions: unknown, defaultApp: unknown): string;
  withDesktopVersion(text: string, version: string): string;
  buildSelfUpdatePlan(input: Record<string, unknown>): SelfUpdatePlan;
  handleSelfUpdate(req: unknown, res: unknown): Promise<void>;
  /* HU-16 · detección del paquete nativo del host */
  parseOsRelease(text: unknown): Record<string, string>;
  distroFamily(fields: Record<string, unknown>): string;
  detectPackageFormat(input?: Record<string, unknown>): string;
  pickInstallerTool(probe?: unknown): string;
  resolveInstallerCommand(input: Record<string, unknown>): {
    tool: string;
    command: string;
    args: string[];
  };
  handleSystemInfo(req: unknown, res: unknown): void;
  formatSseEvent(payload: unknown): string;
}

interface SelfUpdatePlan {
  mode: 'appimage' | 'folder' | 'installer' | 'manual' | 'package';
  reason?: string;
  platform: string;
  pid: number;
  needsElevation: boolean;
  kind: 'appimage' | 'folder';
  target: string;
  installDir: string;
  execPath: string;
  stagingDir: string;
  stageRoot: string;
  logPath: string;
  waitScriptPath: string;
  elevatedScriptPath: string;
  waitScript: string;
  elevatedScript: string | null;
  /* HU-16 · sólo en `mode === 'package'` */
  packageKind?: string;
  installerTool?: string;
  installCommand?: string;
  installArgs?: string[];
}

const requireCjs = createRequire(import.meta.url) as (id: string) => SelfUpdateModule;
const api = requireCjs('../electron/api.cjs');

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Plan base válido: cada test sobrescribe sólo lo que le interesa. */
function basePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runtime: 'electron',
    platform: 'linux',
    pid: 4242,
    appImage: '',
    execPath: '/home/tester/.local/share/PortsLauncher/portslauncher',
    desktopExec: '',
    version: '0.1.10',
    downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.10.AppImage',
    assetName: 'PortsLauncher-0.1.10.AppImage',
    stagingDir: '/home/tester/.cache/portslauncher/update-staging/0.1.10-20260101',
    needsElevation: false,
    ...overrides,
  };
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  setHeader(key: string, value: string): void;
  end(chunk?: string): void;
}

/** `res` falso que captura el cuerpo JSON que envía `sendJSON`. */
function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(key: string, value: string) {
      res.headers[key] = value;
    },
    end(chunk?: string) {
      res.body = chunk ? JSON.parse(chunk) : null;
    },
  };
  return res;
}

/**
 * `req` falso suficiente para `readJSON`.
 *
 * `readJSON` sólo usa `on('data')`, `on('end')`, `on('error')` y
 * `destroy()`; los eventos se emiten como microtareas en el orden en que se
 * registran, así que no hace falta un stream real.
 */
function fakeRequest(method: string, body: unknown): unknown {
  const payload = new TextEncoder().encode(JSON.stringify(body));
  const handlers: Record<string, Array<(arg?: unknown) => void>> = {
    data: [],
    end: [],
    error: [],
  };

  const req = {
    method,
    destroyed: false,
    on(event: string, handler: (arg?: unknown) => void) {
      const list = handlers[event] ?? (handlers[event] = []);
      list.push(handler);
      if (event === 'data') queueMicrotask(() => handler(payload));
      if (event === 'end') queueMicrotask(() => handler());
      return req;
    },
    destroy() {
      req.destroyed = true;
    },
  };

  return req;
}

/* -------------------------------------------------------------------------- */
/* Escapado para los scripts                                                  */
/* -------------------------------------------------------------------------- */

describe('shellQuote', () => {
  it('envuelve en comillas simples', () => {
    expect(api.shellQuote('/home/yo/PortsLauncher')).toBe("'/home/yo/PortsLauncher'");
  });

  it('escapa la comilla simple con el patrón POSIX (cerrar, escapar, reabrir)', () => {
    expect(api.shellQuote("/home/yo/Mis ROM's/x.z64")).toBe("'/home/yo/Mis ROM'\\''s/x.z64'");
  });

  it('tolera null, undefined y números', () => {
    expect(api.shellQuote(null)).toBe("''");
    expect(api.shellQuote(undefined)).toBe("''");
    expect(api.shellQuote(42)).toBe("'42'");
  });
});

describe('psQuote', () => {
  it('duplica la comilla simple en PowerShell', () => {
    expect(api.psQuote("C:\\Users\\O'Brien\\PortsLauncher")).toBe(
      "'C:\\Users\\O''Brien\\PortsLauncher'"
    );
  });
});

/* -------------------------------------------------------------------------- */
/* `.desktop` del usuario                                                     */
/* -------------------------------------------------------------------------- */

describe('parseDesktopExec', () => {
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=PortsLauncher',
    'Comment=PortsLauncher 0.1.9',
    'Exec=/home/yo/.local/share/PortsLauncher/portslauncher %U',
    'Icon=portslauncher',
  ].join('\n');

  it('extrae el comando y descarta los códigos de campo', () => {
    expect(api.parseDesktopExec(entry)).toEqual({
      command: '/home/yo/.local/share/PortsLauncher/portslauncher',
      args: [],
    });
  });

  it('respeta las comillas de la ruta', () => {
    const text = '[Desktop Entry]\nExec="/home/yo/Mis Apps/portslauncher" --minimized %F\n';
    expect(api.parseDesktopExec(text)).toEqual({
      command: '/home/yo/Mis Apps/portslauncher',
      args: ['--minimized'],
    });
  });

  it('devuelve null sin Exec o con Exec inútil', () => {
    expect(api.parseDesktopExec('[Desktop Entry]\nName=PortsLauncher\n')).toBeNull();
    expect(api.parseDesktopExec('[Desktop Entry]\nExec=%U\n')).toBeNull();
    expect(api.parseDesktopExec('')).toBeNull();
  });
});

describe('splitDesktopArgs', () => {
  it('tokeniza con comillas simples y dobles', () => {
    expect(api.splitDesktopArgs('a "b c" \'d e\' f')).toEqual(['a', 'b c', 'd e', 'f']);
  });

  it('conserva un token vacío entrecomillado', () => {
    expect(api.splitDesktopArgs('a "" b')).toEqual(['a', '', 'b']);
  });
});

describe('withDesktopVersion', () => {
  it('reescribe el Comment y añade X-PortsLauncher-Version', () => {
    const before = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=PortsLauncher',
      'Comment=PortsLauncher 0.1.9',
      'Exec=/home/yo/PortsLauncher/portslauncher',
    ].join('\n');

    const after = api.withDesktopVersion(before, '0.1.10');

    expect(after).toContain('Comment=PortsLauncher 0.1.10');
    expect(after).not.toContain('0.1.9');
    expect(after).toContain('X-PortsLauncher-Version=0.1.10');
    /* El resto del fichero se conserva intacto. */
    expect(after).toContain('Exec=/home/yo/PortsLauncher/portslauncher');
    expect(after.startsWith('[Desktop Entry]\n')).toBe(true);
    expect(after.endsWith('\n')).toBe(true);
  });

  it('añade Comment cuando no existía', () => {
    const after = api.withDesktopVersion('[Desktop Entry]\nName=PortsLauncher\n', '0.2.0');
    expect(after).toContain('Comment=PortsLauncher 0.2.0');
  });

  it('no duplica X-PortsLauncher-Version si ya estaba', () => {
    const before = ['Comment=PortsLauncher 0.1.0', 'X-PortsLauncher-Version=0.1.0'].join('\n');
    const after = api.withDesktopVersion(before, '0.1.10');
    expect(after.match(/X-PortsLauncher-Version=/g)).toHaveLength(1);
    expect(after).toContain('X-PortsLauncher-Version=0.1.10');
  });
});

/* -------------------------------------------------------------------------- */
/* Detección del tipo de instalación                                          */
/* -------------------------------------------------------------------------- */

describe('resolveInstallTarget', () => {
  it('prioriza APPIMAGE (AppImage portable)', () => {
    const target = api.resolveInstallTarget({
      appImage: '/home/yo/Apps/PortsLauncher-0.1.9.AppImage',
      execPath: '/opt/electron/electron',
      desktopExec: '/opt/PortsLauncher/portslauncher',
    });

    expect(target).toEqual({
      kind: 'appimage',
      source: 'APPIMAGE',
      target: '/home/yo/Apps/PortsLauncher-0.1.9.AppImage',
      installDir: '/home/yo/Apps',
      execPath: '/home/yo/Apps/PortsLauncher-0.1.9.AppImage',
    });
  });

  it('usa el .desktop del usuario cuando no hay APPIMAGE', () => {
    const target = api.resolveInstallTarget({
      execPath: '/usr/lib/electron/electron',
      desktopExec: '/home/yo/.local/share/PortsLauncher/portslauncher',
    });

    expect(target.kind).toBe('folder');
    expect(target.source).toBe('desktop');
    expect(target.installDir).toBe('/home/yo/.local/share/PortsLauncher');
    expect(target.execPath).toBe('/home/yo/.local/share/PortsLauncher/portslauncher');
  });

  it('degrada a la carpeta de process.execPath', () => {
    const target = api.resolveInstallTarget({ execPath: '/opt/PortsLauncher/portslauncher' });
    expect(target.kind).toBe('folder');
    expect(target.source).toBe('execPath');
    expect(target.installDir).toBe('/opt/PortsLauncher');
  });
});

describe('selfUpdateRuntime', () => {
  it('sin Electron es Node puro (vite dev / preview)', () => {
    expect(api.selfUpdateRuntime({}, {}, false)).toBe('node');
    expect(api.selfUpdateRuntime({}, { electron: undefined }, false)).toBe('node');
  });

  it('detecta Electron sin empaquetar', () => {
    expect(api.selfUpdateRuntime({}, { electron: '33.0.0' }, true)).toBe('electron-dev');
    expect(
      api.selfUpdateRuntime(
        { VITE_DEV_SERVER_URL: 'http://localhost:5173' },
        { electron: '33.0.0' },
        false
      )
    ).toBe('electron-dev');
  });

  it('detecta Electron empaquetado', () => {
    expect(api.selfUpdateRuntime({}, { electron: '33.0.0' }, false)).toBe('electron');
  });
});

/* -------------------------------------------------------------------------- */
/* Plan de actualización                                                      */
/* -------------------------------------------------------------------------- */

describe('buildSelfUpdatePlan', () => {
  it('en modo desarrollo no aplica nada', () => {
    const plan = api.buildSelfUpdatePlan(basePlan({ runtime: 'node' }));
    expect(plan.mode).toBe('manual');
    expect(plan.reason).toBe('dev-runtime');
    expect(plan.waitScript).toBe('');
  });

  it('AppImage portable: reemplaza el fichero, sin pkexec si es escribible', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({ appImage: '/home/tester/Apps/PortsLauncher-0.1.9.AppImage' })
    );

    expect(plan.mode).toBe('appimage');
    expect(plan.target).toBe('/home/tester/Apps/PortsLauncher-0.1.9.AppImage');
    expect(plan.elevatedScript).toBeNull();
    expect(plan.waitScript).toContain('PID=4242');
    expect(plan.waitScript).toContain('kill -0 "$PID"');
    expect(plan.waitScript).toContain(
      "cp -f '/home/tester/Downloads/PortsLauncher-0.1.10.AppImage'"
    );
    expect(plan.waitScript).toContain('chmod 755');
    expect(plan.waitScript).toContain('nohup "$RELAUNCH"');
    expect(plan.waitScript).not.toContain('pkexec');
  });

  it('AppImage en /opt: pide elevación y sólo copia con pkexec', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({ appImage: '/opt/PortsLauncher/PortsLauncher.AppImage', needsElevation: true })
    );

    expect(plan.mode).toBe('appimage');
    expect(plan.needsElevation).toBe(true);
    expect(plan.waitScript).toContain('pkexec /bin/sh');
    expect(plan.waitScript).not.toContain("cp -f '/home/tester/Downloads");

    /* El script elevado sólo copia: nada de relanzar la app como root. */
    expect(plan.elevatedScript).toContain(
      "cp -f '/home/tester/Downloads/PortsLauncher-0.1.10.AppImage'"
    );
    expect(plan.elevatedScript).toContain("chmod 755 '/opt/PortsLauncher/PortsLauncher.AppImage'");
    expect(plan.elevatedScript).not.toContain('nohup');
  });

  it('carpeta instalada: copia el contenido de squashfs-root encima', () => {
    const plan = api.buildSelfUpdatePlan(basePlan());

    expect(plan.mode).toBe('folder');
    expect(plan.installDir).toBe('/home/tester/.local/share/PortsLauncher');
    expect(plan.stageRoot).toBe(
      '/home/tester/.cache/portslauncher/update-staging/0.1.10-20260101/squashfs-root'
    );
    /* El `/.` es obligatorio: sin él `cp -a` copiaría la carpeta DENTRO del
     * destino (`destino/squashfs-root`) en vez de su contenido. */
    expect(plan.waitScript).toContain(
      "cp -a '/home/tester/.cache/portslauncher/update-staging/0.1.10-20260101/squashfs-root/.'"
    );
    expect(plan.waitScript).toContain("'/home/tester/.local/share/PortsLauncher/'");
  });

  it('carpeta instalada en /opt: copia vía pkexec', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({ desktopExec: '/opt/PortsLauncher/portslauncher', needsElevation: true })
    );

    expect(plan.mode).toBe('folder');
    expect(plan.installDir).toBe('/opt/PortsLauncher');
    expect(plan.waitScript).toContain('pkexec /bin/sh');
    expect(plan.elevatedScript).toContain(
      "cp -a '/home/tester/.cache/portslauncher/update-staging"
    );
    expect(plan.elevatedScript).toContain("'/opt/PortsLauncher/'");
  });

  /* HU-16: en Linux un .rpm/.deb ya NO es «no soportado»: se instala con el
   * gestor de paquetes del sistema (`mode: 'package'`). Para un asset que de
   * verdad no se sabe aplicar se usa un formato ajeno a todos los flujos. */
  it('un asset no soportado (.pkg) se queda en descarga manual', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.pkg',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.pkg',
      })
    );
    expect(plan.mode).toBe('manual');
    expect(plan.reason).toBe('unsupported-asset');
  });

  it('tampoco intenta ejecutar un .apk ni un .rar', () => {
    for (const ext of ['.apk', '.rar']) {
      const plan = api.buildSelfUpdatePlan(
        basePlan({
          assetName: `PortsLauncher-0.1.11${ext}`,
          downloadPath: `/home/tester/Downloads/PortsLauncher-0.1.11${ext}`,
        })
      );
      expect(plan.mode).toBe('manual');
      expect(plan.reason).toBe('unsupported-asset');
    }
  });

  it('no intenta reemplazar el fichero que está en ejecución', () => {
    const same = '/home/tester/Apps/PortsLauncher-0.1.10.AppImage';
    const plan = api.buildSelfUpdatePlan(
      basePlan({ appImage: same, downloadPath: same })
    );
    expect(plan.mode).toBe('manual');
    expect(plan.reason).toBe('same-file');
  });

  it('Windows con .exe: lo ejecuta con UAC cuando hace falta', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        platform: 'win32',
        execPath: 'C:\\Program Files\\PortsLauncher\\portslauncher.exe',
        assetName: 'PortsLauncher-0.1.10.exe',
        downloadPath: 'C:\\Users\\tester\\Downloads\\PortsLauncher-0.1.10.exe',
        needsElevation: true,
      })
    );

    expect(plan.mode).toBe('installer');
    expect(plan.waitScript).toContain('Wait-Process -Id $targetPid -Timeout 30');
    expect(plan.waitScript).toContain('-Verb RunAs');
    expect(plan.waitScriptPath.endsWith('apply-update.ps1')).toBe(true);
    expect(plan.elevatedScript).toBeNull();
  });

  it('Windows con .zip: Expand-Archive sobre la carpeta instalada', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        platform: 'win32',
        execPath: 'C:\\PortsLauncher\\portslauncher.exe',
        assetName: 'PortsLauncher-0.1.10.zip',
        downloadPath: 'C:\\Users\\tester\\Downloads\\PortsLauncher-0.1.10.zip',
        needsElevation: false,
      })
    );

    expect(plan.mode).toBe('folder');
    expect(plan.waitScript).toContain('Expand-Archive -LiteralPath');
    expect(plan.waitScript).not.toContain('-Verb RunAs');
  });

  it('un AppImage no se puede instalar en Windows: degrada a manual', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({ platform: 'win32', appImage: 'C:\\Apps\\PortsLauncher.AppImage' })
    );
    expect(plan.mode).toBe('manual');
    expect(plan.reason).toBe('appimage-on-windows');
  });

  it('los scripts se generan dentro de la carpeta de staging', () => {
    const plan = api.buildSelfUpdatePlan(basePlan());
    expect(plan.waitScriptPath).toBe(plan.stagingDir + '/apply-update.sh');
    expect(plan.elevatedScriptPath).toBe(plan.stagingDir + '/apply-elevated.sh');
    expect(plan.logPath.endsWith('self-update.log')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* HU-16 · paquete nativo (.rpm / .deb)                                       */
/* -------------------------------------------------------------------------- */

describe('buildSelfUpdatePlan · modo package', () => {
  it('un .rpm se instala con pkexec + rpm -Uvh', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
      })
    );

    expect(plan.mode).toBe('package');
    expect(plan.packageKind).toBe('rpm');
    expect(plan.installerTool).toBe('pkexec');
    expect(plan.installCommand).toBe('pkexec');
    expect(plan.installArgs).toEqual([
      'rpm',
      '-Uvh',
      '--replacepkgs',
      '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
    ]);
    /* `buildPosixWaitScript` entrecomilla cada argumento con comillas simples. */
    expect(plan.waitScript).toContain("'pkexec' 'rpm' '-Uvh' '--replacepkgs'");
    expect(plan.waitScript).toContain('instalando el paquete rpm con pkexec');
  });

  it('un .deb se instala con apt-get (dpkg no resuelve dependencias)', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'portslauncher_0.1.11_amd64.deb',
        downloadPath: '/home/tester/Downloads/portslauncher_0.1.11_amd64.deb',
      })
    );

    expect(plan.mode).toBe('package');
    expect(plan.packageKind).toBe('deb');
    expect(plan.installArgs).toEqual([
      'apt-get',
      'install',
      '-y',
      '/home/tester/Downloads/portslauncher_0.1.11_amd64.deb',
    ]);
    expect(plan.waitScript).toContain("'pkexec' 'apt-get' 'install' '-y'");
  });

  it('con pkcon disponible se instala con pkcon install-local', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
        installerTool: 'pkcon',
      })
    );

    expect(plan.mode).toBe('package');
    expect(plan.installerTool).toBe('pkcon');
    expect(plan.installCommand).toBe('pkcon');
    expect(plan.installArgs).toEqual([
      'install-local',
      '--plain',
      '--allow-untrusted',
      '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
    ]);
    expect(plan.waitScript).toContain("'pkcon' 'install-local' '--plain' '--allow-untrusted'");
  });

  it('el paquete manda aunque el launcher corra desde un AppImage', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        appImage: '/home/tester/Apps/PortsLauncher-0.1.10.AppImage',
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
      })
    );
    expect(plan.mode).toBe('package');
    expect(plan.packageKind).toBe('rpm');
  });

  it('no genera un segundo script elevado: la elevación va dentro del comando', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
        needsElevation: true,
      })
    );
    expect(plan.mode).toBe('package');
    expect(plan.elevatedScript).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Handler HTTP                                                               */
/* -------------------------------------------------------------------------- */

describe('handleSelfUpdate', () => {
  it('rechaza métodos distintos de POST con 405', async () => {
    const res = fakeResponse();
    await api.handleSelfUpdate(fakeRequest('GET', {}), res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ ok: false, error: 'Usa POST.' });
  });

  it('rechaza URLs que no son de GitHub antes de descargar', async () => {
    const res = fakeResponse();
    await api.handleSelfUpdate(
      fakeRequest('POST', { downloadUrl: 'https://evil.example.com/payload.AppImage' }),
      res
    );
    expect(res.statusCode).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.error)).toContain('downloadUrl no válido');
  });

  it('responde JSON y sin caché', async () => {
    const res = fakeResponse();
    await api.handleSelfUpdate(fakeRequest('GET', {}), res);
    expect(res.headers['Content-Type']).toContain('application/json');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});
