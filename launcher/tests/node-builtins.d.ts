/* ==========================================================================
 * PortsLauncher · tests/node-builtins.d.ts
 *
 * Declaraciones mínimas de los builtins de Node que necesita la suite.
 *
 * `tsconfig.json` fija `types: ["vite/client"]` a propósito (el renderer no
 * tiene Node), así que `@types/node` no forma parte del programa y
 * `import { createRequire } from 'node:module'` no resolvería en `tsc`.
 *
 * Aquí se declara SÓLO lo que usan los tests para cargar `electron/api.cjs` y
 * preparar sus carpetas temporales, sin abrir el resto de la API de Node al
 * frontend. En runtime Vitest resuelve los builtins reales: esto es únicamente
 * el contrato que ve `tsc`.
 * ========================================================================== */

declare module 'node:module' {
  /** Crea un `require` de CommonJS anclado a `filename` (aquí, `import.meta.url`). */
  export function createRequire(filename: string | URL): (id: string) => unknown;
}

declare module 'node:os' {
  /** Carpeta temporal del sistema. */
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function basename(file: string, ext?: string): string;
  export function dirname(file: string): string;
  export function extname(file: string): string;
}

declare module 'node:fs' {
  /** Subconjunto de `fs.Stats` que consultan los tests. */
  export interface Stats {
    size: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }

  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(dir: string, options?: { recursive?: boolean }): string | undefined;
  export function writeFileSync(file: string, data: string, encoding?: string): void;
  export function readFileSync(file: string, encoding: string): string;
  export function existsSync(file: string): boolean;
  export function lstatSync(file: string): Stats;
  export function statSync(file: string): Stats;
  export function readlinkSync(file: string): string;
  export function realpathSync(file: string): string;
  export function rmSync(dir: string, options?: { recursive?: boolean; force?: boolean }): void;
}
