/* ==========================================================================
 * PortsLauncher · services/addonProvider.ts
 *
 * Puente entre la UI y los plugins `asset-provider` (proveedores de ROM).
 *
 * El launcher **no** descarga ROMs: invoca los endpoints del backend
 * (`POST /api/plugins/search` y `POST /api/plugins/provision`), que a su vez
 * ejecutan el `entrypoint` del plugin con Python. El flujo asistido abre la
 * ficha del juego en el navegador del usuario y espera a que la descarga se
 * complete; por eso `provision` puede terminar sin archivo y hay que tratar
 * ese caso como «falta la confirmación del usuario», no como éxito.
 *
 * Este módulo no toca el DOM ni el almacenamiento: es lógica pura + `fetch`,
 * para poder probarla con vitest sin montar un navegador.
 * ========================================================================== */

import type { Addon } from './types';

/* -------------------------------------------------------------------------- */
/* Contratos                                                                  */
/* -------------------------------------------------------------------------- */

/** Resultado normalizado de un `search` de plugin. */
export interface ProviderResult {
  /** Identificador estable del asset (`vault-1234`). */
  id: string;
  /** Título legible. */
  title: string;
  /** Plataforma detectada por el plugin (`n64`, `snes`…). */
  platform: string;
  /** Extensión o contenedor esperado (`.z64`, `.zip`…). */
  format: string;
  /** Ficha remota del asset (se abre en el navegador al aprovisionar). */
  url: string;
  /** Descripción corta del plugin. */
  description: string;
  /** Versión declarada (`1.0`). */
  version: string;
  /** Región de la variante (`USA`, `Japan`, `Europe`). */
  region: string;
}

/** Fases que pinta la UI del asistente de ROM. */
export type ProviderPhase = 'idle' | 'searching' | 'results' | 'provisioning' | 'done' | 'error';

/** Cuerpo de `POST /api/plugins/search`. */
export interface ProviderSearchRequest {
  query: string;
  platform?: string | null;
  pluginId?: string | null;
  region?: string | null;
  version?: string | null;
}

/** Resultado de `searchProviderAssets`. */
export interface ProviderSearchOutcome {
  ok: boolean;
  /** Plugin que respondió (el backend resuelve cuál cuando no se fija). */
  pluginId: string | null;
  results: ProviderResult[];
  error: string | null;
}

/** Cuerpo de `POST /api/plugins/provision`. */
export interface ProviderProvisionRequest {
  pluginId: string;
  assetId: string;
  outputDir: string;
}

/** Resultado de `provisionProviderAsset`. */
export interface ProviderProvisionOutcome {
  ok: boolean;
  /** Ruta absoluta del archivo movido, o `null` si no se detectó descarga. */
  outputPath: string | null;
  sha1: string | null;
  /** Ficha remota que el usuario debe visitar si la descarga es manual. */
  url: string | null;
  error: string | null;
}

/** Addon de referencia cuando el manifiesto no declara `type`. */
export const PROVIDER_ADDON_ID = 'vimm-vault';

/**
 * Tope de espera del `fetch` del renderer.
 *
 * Va por encima del tope del backend (45 s `search` / 90 s `provision`) para
 * que gane siempre el error del servidor (que trae `stderr` del plugin) y no un
 * `AbortError` genérico del navegador.
 */
const SEARCH_TIMEOUT_MS = 60_000;
const PROVISION_TIMEOUT_MS = 120_000;

/**
 * Alias entre el vocabulario del catálogo (`SourcePlatform`) y el que usan los
 * plugins (`genesis`, `megadrive`…). Sin esto, un port de Mega Drive no
 * encontraría ningún proveedor que declare `genesis`.
 */
const PLATFORM_ALIASES: Record<string, readonly string[]> = {
  md: ['genesis', 'megadrive', 'mega-drive', 'md'],
  ps1: ['ps1', 'psx', 'playstation'],
  ps2: ['ps2', 'playstation2'],
  n3ds: ['n3ds', '3ds'],
  nsw: ['nsw', 'switch'],
  gcn: ['gcn', 'gc', 'gamecube'],
  dc: ['dc', 'dreamcast'],
};

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Cadena recortada, o `''`. */
function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Lista de cadenas recortadas y en minúsculas. */
function toList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = toText(item).toLowerCase();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** Registro plano, o `null` si el valor no es un objeto JSON. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/* -------------------------------------------------------------------------- */
/* Detección de addons                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `true` si el addon puede buscar y aprovisionar assets.
 *
 * Se acepta cualquiera de las tres señales del manifiesto, porque los plugins
 * de la comunidad no son homogéneos:
 *   · `type: "asset-provider"` (el tipo canónico de `PLUGINS.md`),
 *   · `capabilities: ["search", "provision"]` (plugins sin `type`),
 *   · `id: "vimm-vault"` (proveedor de referencia, que declara ambas).
 *
 * Un addon desactivado (`enabled === false`) nunca cuenta.
 */
export function isAssetProvider(addon: Addon | null | undefined): boolean {
  if (!addon || typeof addon !== 'object') return false;
  if (addon.enabled === false) return false;

  const capabilities = toList(addon.capabilities);
  const both = capabilities.includes('search') && capabilities.includes('provision');
  const type = toText(addon.type).toLowerCase();
  const id = toText(addon.id).toLowerCase();

  return type === 'asset-provider' || both || id === PROVIDER_ADDON_ID;
}

/** Addons activos que pueden proveer ROMs (conserva el orden de instalación). */
export function romProviders(addons: readonly Addon[] | null | undefined): Addon[] {
  if (!Array.isArray(addons)) return [];
  return addons.filter((addon) => isAssetProvider(addon));
}

/**
 * Proveedor que debe atender una plataforma concreta.
 *
 * Prioridad: el que declara explícitamente esa plataforma (con alias) → el que
 * no declara ninguna, es decir, comodín → el primero disponible. Devolver
 * `null` cuando no hay ningún addon apto deja la UI sin la sección, que es lo
 * correcto: sin proveedor no hay nada que ofrecer.
 */
export function providerForPlatform(
  providers: readonly Addon[] | null | undefined,
  platform: string | null | undefined
): Addon | null {
  if (!Array.isArray(providers) || providers.length === 0) return null;

  const key = toText(platform).toLowerCase();
  if (key) {
    const wanted = new Set([key, ...(PLATFORM_ALIASES[key] ?? [])]);
    const exact = providers.find((provider) =>
      toList(provider.platforms).some((declared) => wanted.has(declared))
    );
    if (exact) return exact;
  }

  const wildcard = providers.find((provider) => toList(provider.platforms).length === 0);
  return wildcard ?? providers[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Normalización de respuestas                                                */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza un resultado del plugin.
 *
 * Los plugins no comparten un esquema estricto: se aceptan `id`/`assetId` y
 * `title`/`name` como sinónimos. Sin `id` no hay forma de aprovisionar, así que
 * la entrada se descarta.
 */
export function normalizeProviderResult(raw: unknown): ProviderResult | null {
  const record = asRecord(raw);
  if (!record) return null;

  const id = toText(record['id']) || toText(record['assetId']);
  if (!id) return null;

  return {
    id,
    title: toText(record['title']) || toText(record['name']) || id,
    platform: toText(record['platform']).toLowerCase(),
    format: toText(record['format']),
    url: toText(record['url']),
    description: toText(record['description']),
    version: toText(record['version']),
    region: toText(record['region']),
  };
}

/** Lista de resultados válidos de un `payload` de búsqueda. */
export function readProviderResults(payload: unknown): ProviderResult[] {
  const record = asRecord(payload);
  const raw = record && Array.isArray(record['results']) ? record['results'] : [];
  const out: ProviderResult[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const clean = normalizeProviderResult(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
  }
  return out;
}

/**
 * Etiqueta de la variante (`USA · v1.0 · .z64`).
 *
 * Es lo que permite al usuario distinguir dos resultados del mismo juego; si el
 * plugin no declara nada de esto, se devuelve un guion para no dejar el hueco
 * vacío en la fila.
 */
export function variantLabel(result: ProviderResult): string {
  if (!result) return '—';
  const parts: string[] = [];
  if (result.region) parts.push(result.region.toUpperCase());
  if (result.version) parts.push(/^v/i.test(result.version) ? result.version : `v${result.version}`);
  if (result.format) parts.push(result.format);
  return parts.join(' · ') || '—';
}

/** Mensaje de error del backend o del plugin, con reserva legible. */
export function providerErrorMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  return (
    toText(record?.['error']) ||
    toText(record?.['message']) ||
    toText(fallback) ||
    'El addon no devolvió una respuesta válida.'
  );
}

/** Mensaje para un fallo de red/timeout del propio `fetch`. */
export function networkErrorMessage(error: unknown): string {
  const name = asRecord(error)?.['name'];
  if (name === 'AbortError') return 'El addon tardó demasiado en responder.';
  return 'No se pudo contactar con el backend del launcher (¿está apagado?).';
}

/* -------------------------------------------------------------------------- */
/* Llamadas al backend                                                        */
/* -------------------------------------------------------------------------- */

/** `POST` JSON con tope de tiempo; devuelve el código y el cuerpo ya parseado. */
async function postJSON<T>(
  endpoint: string,
  body: unknown,
  timeoutMs: number
): Promise<{ status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      /* Respuesta sin JSON (proxy caído, 502 de un intermediario…). */
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `POST /api/plugins/search` → variantes del juego en el proveedor.
 *
 * Nunca lanza: los fallos se devuelven como `{ ok: false, error }` para que la
 * UI pinte el mensaje dentro del modal en lugar de romper el flujo.
 */
export async function searchProviderAssets(
  request: ProviderSearchRequest
): Promise<ProviderSearchOutcome> {
  const body: Record<string, string> = { query: toText(request?.query) };
  if (toText(request?.platform)) body['platform'] = toText(request?.platform).toLowerCase();
  if (toText(request?.pluginId)) body['pluginId'] = toText(request?.pluginId);
  if (toText(request?.region)) body['region'] = toText(request?.region);
  if (toText(request?.version)) body['version'] = toText(request?.version);

  if (!body['query']) {
    return { ok: false, pluginId: null, results: [], error: 'Falta el título del juego.' };
  }

  try {
    const { status, data } = await postJSON<Record<string, unknown>>(
      '/api/plugins/search',
      body,
      SEARCH_TIMEOUT_MS
    );
    const record = asRecord(data);
    if (status !== 200 || !record || record['ok'] === false) {
      return {
        ok: false,
        pluginId: null,
        results: [],
        error: providerErrorMessage(data, `El buscador de addons respondió ${status}.`),
      };
    }
    return {
      ok: true,
      pluginId: toText(record['pluginId']) || body['pluginId'] || null,
      results: readProviderResults(record),
      error: null,
    };
  } catch (error) {
    return { ok: false, pluginId: null, results: [], error: networkErrorMessage(error) };
  }
}

/**
 * `POST /api/plugins/provision` → abre la ficha y espera la descarga.
 *
 * `ok: true` **solo** si el backend devuelve una ruta de archivo: un `provision`
 * que abre el navegador pero no detecta descarga llega como error con `url`,
 * y la UI debe ofrecer ese enlace en vez de dar la ROM por buena.
 */
export async function provisionProviderAsset(
  request: ProviderProvisionRequest
): Promise<ProviderProvisionOutcome> {
  const pluginId = toText(request?.pluginId);
  const assetId = toText(request?.assetId);
  const outputDir = toText(request?.outputDir);

  if (!pluginId || !assetId) {
    return {
      ok: false,
      outputPath: null,
      sha1: null,
      url: null,
      error: 'Faltan el addon o la variante elegida.',
    };
  }
  if (!outputDir) {
    return {
      ok: false,
      outputPath: null,
      sha1: null,
      url: null,
      error: 'El port no tiene carpeta de instalación.',
    };
  }

  try {
    const { status, data } = await postJSON<Record<string, unknown>>(
      '/api/plugins/provision',
      { pluginId, assetId, outputDir },
      PROVISION_TIMEOUT_MS
    );
    const record = asRecord(data);
    const outputPath = toText(record?.['outputPath']) || null;
    const url = toText(record?.['url']) || null;

    if (status !== 200 || !record || record['ok'] === false || !outputPath) {
      return {
        ok: false,
        outputPath: null,
        sha1: null,
        url,
        error: providerErrorMessage(
          data,
          'No se detectó la descarga. Confírmala en el navegador y vuelve a intentarlo.'
        ),
      };
    }

    return {
      ok: true,
      outputPath,
      sha1: toText(record['sha1']) || null,
      url,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      outputPath: null,
      sha1: null,
      url: null,
      error: networkErrorMessage(error),
    };
  }
}
