/* ==========================================================================
 * PortsLauncher · electron/main.cjs
 *
 * Proceso principal de Electron.
 *
 * La app es una SPA que habla con `/api/install` y `/api/steamgrid/*` por
 * `fetch` relativo. Para que funcione igual empaquetada que en `vite dev`, se
 * levanta un servidor HTTP propio en `127.0.0.1` con puerto EFÍMERO (el SO
 * elige uno libre) que:
 *   1. atiende la API con el módulo compartido `electron/api.cjs`;
 *   2. sirve los estáticos de `dist/` con fallback a `index.html` (rutas SPA).
 *
 * Servir en loopback efímero evita exponer la API de instalación en la red
 * local y evita colisiones de puerto entre instancias. Además se valida la
 * cabecera `Host` para descartar *DNS rebinding*.
 * ========================================================================== */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');

const { createApiMiddleware } = require('./api.cjs');

/** URL del servidor de Vite en desarrollo (`VITE_DEV_SERVER_URL`). */
const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';

/** Carpeta con el build de Vite (`npm run build` → `launcher/dist`). */
const DIST_DIR = path.join(__dirname, '..', 'dist');

/** Tipos MIME de los ficheros que produce Vite. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/** Ventana principal (referencia viva mientras la app esté abierta). */
let mainWindow = null;

/** Servidor HTTP local de la app empaquetada. */
let localServer = null;

/* -------------------------------------------------------------------------- */
/* Servidor estático                                                          */
/* -------------------------------------------------------------------------- */

/** Comprueba que el `Host` apunta a loopback (anti DNS-rebinding). */
function isLoopbackHost(req, port) {
  const host = String(req.headers.host || '');
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** Sirve un fichero de `dist/`, con `index.html` como fallback de SPA. */
function serveStatic(req, res, port) {
  if (!isLoopbackHost(req, port)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  /* `decodeURIComponent` puede lanzar con secuencias inválidas (`%ZZ`). */
  let pathname = '/';
  try {
    pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  const relative = pathname.replace(/^\/+/, '');
  const candidate = path.resolve(DIST_DIR, relative || 'index.html');
  const insideDist = candidate === DIST_DIR || candidate.startsWith(DIST_DIR + path.sep);

  /* La resolución del fichero va en un bloque seguro: `statSync` puede lanzar
   * (`EACCES`, `ELOOP`, `ENAMETOOLONG`, carreras de FS…) y esta función corre
   * dentro del handler de `http.createServer`; una excepción síncrona ahí es
   * una `Uncaught Exception` que mata el proceso principal de Electron. Si la
   * comprobación falla, se degrada a la ruta de la SPA / 404 en lugar de
   * crashear. */
  let file = '';
  if (insideDist) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        file = candidate;
      }
    } catch {}
  }
  /* Sin extensión → ruta de la SPA (`/biblioteca`, `/port-sm64`…). */
  if (!file && !path.extname(relative)) file = path.join(DIST_DIR, 'index.html');

  if (!file || !fs.existsSync(file)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('No encontrado');
    return;
  }

  const ext = path.extname(file).toLowerCase();

  /* Se usa `fs.readFile` en lugar de `fs.createReadStream(...).pipe(res)`:
   * dentro de `app.asar` algunos ficheros son "virtuales" y el stream falla en
   * `_construct` con `ENOENT` (p. ej. si el asar se empaquetó sin `dist/`).
   * Ese error se emite de forma asíncrona en el stream; al no haber listener
   * de `error`, se propaga como `Uncaught Exception` y mata el proceso
   * principal de Electron. Con `readFile` cualquier fallo llega al callback y
   * se responde 404/500 sin tumbar la app. */
  fs.readFile(file, (err, data) => {
    if (err) {
      const missing = err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR';
      if (!res.headersSent) {
        res.statusCode = missing ? 404 : 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
      }
      res.end(missing ? 'No encontrado' : 'Error interno');
      return;
    }

    if (res.destroyed) return;

    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    /* El HTML siempre se revalida: es lo que apunta a los assets con hash. */
    res.setHeader('Cache-Control', ext === '.html' ? 'no-store' : 'public, max-age=31536000');
    res.end(data);
  });
}

/* -------------------------------------------------------------------------- */
/* Arranque del servidor local                                                */
/* -------------------------------------------------------------------------- */

/**
 * Levanta el servidor en `127.0.0.1:0` y resuelve con el puerto asignado.
 *
 * `port: 0` deja que el SO elija un puerto libre, así que nunca choca con
 * Vite (5173), con `preview` (4173) ni con otra instancia del launcher.
 */
function startLocalServer() {
  const api = createApiMiddleware();

  const server = http.createServer((req, res) => {
    api(req, res, () => {
      if (!localServer) {
        res.statusCode = 503;
        res.end('Servidor no listo');
        return;
      }
      serveStatic(req, res, localServer.address().port);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      localServer = server;
      resolve(server.address().port);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Ventana                                                                    */
/* -------------------------------------------------------------------------- */

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0a0912',
    autoHideMenuBar: true,
    title: 'PortsLauncher',
    show: false,
    webPreferences: {
      /* La UI no necesita Node: todo el I/O pasa por la API HTTP local. */
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  /* Enlaces externos (GitHub, descarga del actualizador, SteamGridDB…) se
   * abren en el navegador del sistema, nunca dentro de la app. */
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });

  /* Navegación: sólo se permite el propio servidor local y, en desarrollo, la
   * URL de Vite. Un `window.location` inesperado abre el navegador. */
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const allowed = target.startsWith(url) || (!!DEV_URL && target.startsWith(DEV_URL));
    if (!allowed) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    }
  });

  void mainWindow.loadURL(url);
}

/* -------------------------------------------------------------------------- */
/* Ciclo de vida                                                              */
/* -------------------------------------------------------------------------- */

app.whenReady().then(async () => {
  try {
    /* En desarrollo se usa el servidor de Vite (HMR); en producción, el
     * servidor local con la API y los estáticos de `dist/`. */
    const url = DEV_URL || `http://127.0.0.1:${await startLocalServer()}/index.html`;
    createWindow(url);
  } catch (error) {
    console.error('[PortsLauncher] No se pudo arrancar el servidor local:', error);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void startLocalServer().then((port) => createWindow(`http://127.0.0.1:${port}/index.html`));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});
