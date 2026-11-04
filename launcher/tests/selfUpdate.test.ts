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
    fallbackCommand?: string;
    fallbackArgs?: string[];
  };
  buildPosixWaitScript(plan: SelfUpdatePlan): string;
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
  fallbackCommand?: string;
  fallbackArgs?: string[];
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

  it('con pkcon disponible se instala con pkcon install-local no interactivo', () => {
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
    /* `-y` es la corrección del bug: sin él pkcon pregunta «¿Quiere continuar
     * con las modificaciones?» por stdin, el script no tiene TTY, recibe EOF y
     * aborta; la app se relanzaba con la versión vieja. */
    expect(plan.installArgs).toEqual([
      '-y',
      '--plain',
      '--allow-untrusted',
      'install-local',
      '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
    ]);
    expect(plan.installArgs?.[0]).toBe('-y');
    expect(plan.waitScript).toContain(
      "'pkcon' '-y' '--plain' '--allow-untrusted' 'install-local'"
    );
  });

  it('pkcon deja preparado el fallback privilegiado con pkexec', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
        installerTool: 'pkcon',
      })
    );
    expect(plan.fallbackCommand).toBe('pkexec');
    expect(plan.fallbackArgs).toEqual([
      'rpm',
      '-Uvh',
      '--replacepkgs',
      '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
    ]);
  });

  it('con pkexec no hay fallback: ya es el camino privilegiado', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
      })
    );
    expect(plan.fallbackCommand).toBe('');
    expect(plan.fallbackArgs).toEqual([]);
  });

  it('la salida del instalador se redirige al log (stdout y stderr)', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
        installerTool: 'pkcon',
      })
    );
    /* Sin esto el log sólo decía «falló» y se perdía la causa real. */
    expect(plan.waitScript).toContain('>>"$LOG" 2>&1');
    /* El comando de pkcon aparece con la redirección en la misma línea. */
    expect(plan.waitScript).toMatch(/'install-local' '.*rpm' <\/dev\/null >>"\$LOG" 2>&1;/);
  });

  it('stdin del instalador se ata a /dev/null para no colgarse pidiendo TTY', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
        installerTool: 'pkcon',
      })
    );
    expect(plan.waitScript).toContain('</dev/null');
    expect(plan.waitScript).not.toMatch(/pkcon[^\n]*<\s*&0/);
  });

  it('si pkcon falla el script reintenta con pkexec antes de rendirse', () => {
    const plan = api.buildSelfUpdatePlan(
      basePlan({
        assetName: 'PortsLauncher-0.1.11.x86_64.rpm',
        downloadPath: '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm',
        installerTool: 'pkcon',
      })
    );

    expect(plan.waitScript).toContain('2>&1; then');
    expect(plan.waitScript).toContain('  rc=$?');
    expect(plan.waitScript).toContain('se reintenta con pkexec');
    /* El fallback va después del intento con pkcon y con los mismos privilegios. */
    expect(plan.waitScript).toContain(
      "'pkexec' 'rpm' '-Uvh' '--replacepkgs' '/home/tester/Downloads/PortsLauncher-0.1.11.x86_64.rpm'"
    );
    const posPkcon = plan.waitScript.indexOf("'pkcon' '-y'");
    const posFallback = plan.waitScript.indexOf("'pkexec' 'rpm'");
    expect(posPkcon).toBeGreaterThan(-1);
    expect(posFallback).toBeGreaterThan(posPkcon);
    /* Se rinde explícitamente y con el código de salida. */
    expect(plan.waitScript).toContain('la instalación del paquete falló o se canceló (código $rc)');
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
/* HU-16 · resolveInstallerCommand (unidad)                                   */
/* -------------------------------------------------------------------------- */

describe('resolveInstallerCommand', () => {
  const rpmPath = '/home/tester/Downloads/PortsLauncher-0.1.14.x86_64.rpm';
  const debPath = '/home/tester/Downloads/portslauncher_0.1.14_amd64.deb';

  it('pkcon siempre recibe -y como primer argumento', () => {
    const command = api.resolveInstallerCommand({
      format: 'rpm',
      tool: 'pkcon',
      targetPath: rpmPath,
    });

    expect(command.tool).toBe('pkcon');
    expect(command.command).toBe('pkcon');
    expect(command.args).toEqual(['-y', '--plain', '--allow-untrusted', 'install-local', rpmPath]);
    expect(command.args[0]).toBe('-y');
  });

  it('pkcon + rpm deja el fallback pkexec rpm -Uvh --replacepkgs', () => {
    const command = api.resolveInstallerCommand({
      format: 'rpm',
      tool: 'pkcon',
      targetPath: rpmPath,
    });
    expect(command.fallbackCommand).toBe('pkexec');
    expect(command.fallbackArgs).toEqual(['rpm', '-Uvh', '--replacepkgs', rpmPath]);
  });

  it('pkcon + deb deja el fallback pkexec apt-get install -y', () => {
    const command = api.resolveInstallerCommand({
      format: 'deb',
      tool: 'pkcon',
      targetPath: debPath,
    });
    expect(command.args).toContain('install-local');
    expect(command.fallbackCommand).toBe('pkexec');
    expect(command.fallbackArgs).toEqual(['apt-get', 'install', '-y', debPath]);
  });

  it('pkexec directo no declara fallback: ya es el camino privilegiado', () => {
    const inputs: Array<Record<string, unknown>> = [
      { format: 'rpm', tool: 'pkexec', targetPath: rpmPath },
      { format: 'deb', tool: 'pkexec', targetPath: debPath },
      { format: 'rpm', tool: undefined, targetPath: rpmPath },
      { format: 'deb', tool: '', targetPath: debPath },
      { format: 'rpm', tool: 'dnf', targetPath: rpmPath },
    ];
    for (const input of inputs) {
      const command = api.resolveInstallerCommand(input);
      expect(command.tool).toBe('pkexec');
      expect(command.command).toBe('pkexec');
      expect(command.fallbackCommand).toBe('');
      expect(command.fallbackArgs).toEqual([]);
    }
  });

  it('pkexec + deb usa apt-get install -y (dpkg no resuelve dependencias)', () => {
    const command = api.resolveInstallerCommand({ format: 'deb', tool: 'pkexec', targetPath: debPath });
    expect(command.args).toEqual(['apt-get', 'install', '-y', debPath]);
    expect(command.args).not.toContain('dpkg');
  });

  it('ninguna variante de pkcon se queda sin -y (regresión del bug 0.1.14)', () => {
    for (const format of ['rpm', 'deb', '', undefined, 'AppImage']) {
      const command = api.resolveInstallerCommand({ format, tool: 'pkcon', targetPath: rpmPath });
      expect(command.args).toContain('-y');
      /* No se usa la forma larga: `-y` es la que entiende pkcon de forma estable. */
      expect(command.args).not.toContain('--noninteractive');
      /* Y se mantiene el orden banderas → subcomando → ruta. */
      expect(command.args[command.args.length - 1]).toBe(rpmPath);
      expect(command.args.indexOf('install-local')).toBeGreaterThan(command.args.indexOf('-y'));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* HU-16 · buildPosixWaitScript en modo package                               */
/* -------------------------------------------------------------------------- */

describe('buildPosixWaitScript · modo package', () => {
  const rpmName = 'PortsLauncher-0.1.14.x86_64.rpm';
  const rpmPath = '/home/tester/Downloads/PortsLauncher-0.1.14.x86_64.rpm';
  const debName = 'portslauncher_0.1.14_amd64.deb';
  const debPath = '/home/tester/Downloads/portslauncher_0.1.14_amd64.deb';

  function packagePlan(overrides: Record<string, unknown> = {}): SelfUpdatePlan {
    return api.buildSelfUpdatePlan(
      basePlan({
        assetName: rpmName,
        downloadPath: rpmPath,
        installerTool: 'pkcon',
        ...overrides,
      })
    );
  }

  /** Líneas del bloque de instalación (sin la cabecera de espera ni el relanzado). */
  function installBlock(script: string): string[] {
    const lines = script.split('\n');
    const start = lines.findIndex((line) => line.includes('update: instalando el paquete'));
    const end = lines.findIndex((line) => line.includes('update: relanzando la aplicación'));
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return lines.slice(start, end).filter((line) => line !== '');
  }

  it('pkcon + rpm: bloque exacto con -y, redirección al log y fallback pkexec', () => {
    expect(installBlock(packagePlan().waitScript)).toEqual([
      'log "update: instalando el paquete rpm con pkcon"',
      "if 'pkcon' '-y' '--plain' '--allow-untrusted' 'install-local' '" +
        rpmPath +
        "' </dev/null >>\"$LOG\" 2>&1; then",
      '  log "update: el paquete se instaló con pkcon"',
      'else',
      '  rc=$?',
      '  log "update: pkcon falló (código $rc); se reintenta con pkexec + rpm"',
      "  if 'pkexec' 'rpm' '-Uvh' '--replacepkgs' '" +
        rpmPath +
        "' </dev/null >>\"$LOG\" 2>&1; then",
      '    log "update: el paquete se instaló con pkexec"',
      '  else',
      '    rc=$?',
      '    log "update: la instalación del paquete falló o se canceló (código $rc)"',
      '  fi',
      'fi',
    ]);
  });

  it('pkcon + deb: el fallback usa apt-get y no rpm', () => {
    const script = packagePlan({ assetName: debName, downloadPath: debPath }).waitScript;
    const block = installBlock(script);

    expect(block.join('\n')).toContain("if 'pkexec' 'apt-get' 'install' '-y' '" + debPath + "'");
    expect(block.join('\n')).not.toContain("'rpm'");
    expect(block.join('\n')).toContain('>>"$LOG" 2>&1');
  });

  it('pkexec directo: un solo intento, sin reintento', () => {
    const script = packagePlan({ installerTool: undefined }).waitScript;
    const block = installBlock(script);

    expect(block).toEqual([
      'log "update: instalando el paquete rpm con pkexec"',
      "if 'pkexec' 'rpm' '-Uvh' '--replacepkgs' '" + rpmPath + "' </dev/null >>\"$LOG\" 2>&1; then",
      '  log "update: el paquete se instaló con pkexec"',
      'else',
      '  rc=$?',
      '  log "update: la instalación del paquete falló o se canceló (código $rc)"',
      'fi',
    ]);
    expect(block.join('\n')).not.toContain('se reintenta');
  });

  it('es determinista: regenerar el script produce el mismo texto', () => {
    const plan = packagePlan();
    expect(api.buildPosixWaitScript(plan)).toBe(plan.waitScript);
  });

  it('los bloques if/fi del script quedan equilibrados', () => {
    const script = packagePlan().waitScript;
    const thens = (script.match(/\bthen\b/g) || []).length;
    const fis = (script.match(/\bfi\b/g) || []).length;
    expect(thens).toBeGreaterThan(0);
    expect(fis).toBe(thens);
  });

  it('una ruta con espacios se entrecomilla en los dos intentos', () => {
    const spacedPath = '/home/tester/Descargas/Mis paquetes/PortsLauncher 0.1.14.x86_64.rpm';
    const plan = packagePlan({
      assetName: 'PortsLauncher 0.1.14.x86_64.rpm',
      downloadPath: spacedPath,
    });
    const quoted = "'" + spacedPath + "'";
    expect(plan.waitScript.split(quoted).length - 1).toBe(2);
  });

  it('el resto del script no cambia: sigue esperando al PID y relanzando', () => {
    const script = packagePlan().waitScript;
    expect(script.startsWith('#!/bin/sh')).toBe(true);
    expect(script).toContain('set -u');
    expect(script).toContain('while kill -0 "$PID" 2>/dev/null; do');
    expect(script).toContain('nohup "$RELAUNCH" >/dev/null 2>&1 &');
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
