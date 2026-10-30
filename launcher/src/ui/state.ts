/* ==========================================================================
 * PortsLauncher · ui/state.ts
 *
 * Estado de navegación y filtros, tal y como lo modela el prototipo:
 *   R → ruta actual             B → filtros del listado
 *   D → pestaña de la ficha     S → snapshot (ajustes + games + último jugado)
 *
 * Es deliberadamente mutable y global: el prototipo repinta el DOM entero en
 * cada acción y los pintores leen de aquí (igual que `renderSide`, `filtered`
 * o `resultsHTML` en el mock).
 * ========================================================================== */

import type { Addon, Settings } from '../services/types';
import { DEFAULT_SETTINGS, defaultAddons } from '../services/types';
import type { DevKey, PlatKey } from './platforms';
import type { Game } from './model';
import { statusOf } from './model';

export type Route = 'home' | 'library' | 'catalog' | 'updates' | 'settings' | 'game' | 'addons';
export type DetailTab = 'sum' | 'ver' | 'src';
export type SortKey = 'name' | 'status' | 'plat' | 'ver' | 'recent';
export type FilterKey = 'all' | 'ready' | 'rom' | 'upd' | 'new' | 'inst';

export interface RouteState {
  name: Route;
  id: string | null;
}

/**
 * Memoria de navegación entre los listados y la ficha de un port.
 *
 * - `lastBrowseRoute`: de dónde vino el usuario (Catálogo o Biblioteca) para
 *   que el botón «←» de la ficha vuelva al sitio correcto.
 * - `catalogScrollY`: posición del scroll que tenía el listado, para
 *   restaurarla al volver de la ficha (no se pierde el sitio de lectura).
 */
export const NAVMEM: { lastBrowseRoute: 'catalog' | 'library'; catalogScrollY: number } = {
  lastBrowseRoute: 'catalog',
  catalogScrollY: 0,
};

export interface BrowseState {
  q: string;
  filter: FilterKey;
  plat: PlatKey | 'all';
  dev: DevKey | 'all';
  dest: 'all' | 'Linux' | 'Windows';
  sort: SortKey;
  dir: 1 | -1;
}

export interface Snapshot {
  settings: Settings;
  games: Game[];
  byId: Map<string, Game>;
  /** Addons (plugins) instalados, tal y como los devuelve `libraryService`. */
  addons: Addon[];
  /** Último port lanzado (héroe «Continuar jugando»). */
  last: string | null;
  /** `generatedAt` del índice cargado (o `null`). */
  generatedAt: string | null;
}

export const R: RouteState = { name: 'home', id: null };

export const B: BrowseState = {
  q: '',
  filter: 'all',
  plat: 'all',
  dev: 'all',
  dest: 'all',
  sort: 'name',
  dir: 1,
};

export const D: { tab: DetailTab } = { tab: 'sum' };

export const S: Snapshot = {
  settings: DEFAULT_SETTINGS,
  games: [],
  byId: new Map(),
  addons: defaultAddons(),
  last: null,
  generatedAt: null,
};

/** Refresca el snapshot que consumen los pintores. */
export function setSnapshot(
  settings: Settings,
  games: Game[],
  last: string | null = S.last,
  generatedAt: string | null = S.generatedAt,
  addons: Addon[] = S.addons
): void {
  S.settings = settings;
  S.games = games;
  S.byId = new Map(games.map((game) => [game.id, game]));
  S.addons = addons;
  S.last = last;
  S.generatedAt = generatedAt;
}

/** Nº de ports con actualización pendiente (badge del sidebar). */
export function updateCount(): number {
  return S.games.filter((game) => statusOf(game).k === 'upd').length;
}
