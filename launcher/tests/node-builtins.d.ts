/* ==========================================================================
 * PortsLauncher · tests/node-builtins.d.ts
 *
 * Declaraciones mínimas de los builtins de Node que necesita la suite.
 *
 * `tsconfig.json` fija `types: ["vite/client"]` a propósito (el renderer no
 * tiene Node), así que `@types/node` no forma parte del programa y
 * `import { createRequire } from 'node:module'` no resolvería en `tsc`.
 *
 * Aquí se declara SÓLO lo que usa `tests/selfUpdate.test.ts` para cargar
 * `electron/api.cjs`, sin abrir el resto de la API de Node al frontend.
 * ========================================================================== */

declare module 'node:module' {
  /** Crea un `require` de CommonJS anclado a `filename` (aquí, `import.meta.url`). */
  export function createRequire(filename: string | URL): (id: string) => unknown;
}
