/* ==========================================================================
 * PortsLauncher · Fase 3
 * launcher/src/components/Icons.ts
 *
 * Iconografía del launcher: SVG en línea, sin dependencias ni fuentes de
 * iconos. Todas las siluetas se dibujan en una rejilla de 24×24 con
 * `stroke: currentColor` y `stroke-width: 1.8`, de modo que heredan el color
 * del contenedor y escalan con `font-size`/`--ics`.
 *
 * Convenios:
 *  - `IC` es el diccionario; la clave es el nombre corto usado por la UI
 *    (`'home'`, `'lib'`, `'cat'`, `'upd'`, `'set'`, `'search'`…).
 *  - `icon(name, opts)` devuelve una cadena HTML (`<svg …>`).
 *  - `svgIcon(name, opts)` devuelve un `SVGElement` ya listo para insertar.
 *  - Sólo los iconos marcados con `solid: true` se rellenan (triángulo de
 *    *play*, puntos de estado); el resto son trazos.
 *
 * Los iconos son decorativos por defecto (`aria-hidden="true"`): el texto
 * adyacente es el que comunica. Pasa `title` para exponerlos como
 * información (añade `role="img"` + `<title>`).
 * ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export interface IconDef {
  /** Contenido interno del `<svg>` (paths, círculos, rectángulos…). */
  body: string;
  /** Si es `true` se rellena con el color actual en lugar de trazar. */
  solid?: boolean;
  /** Etiqueta legible (para `title` por defecto y documentación). */
  label?: string;
}

export interface IconOptions {
  /** Lado en px (por defecto 20). */
  size?: number;
  /** Clases CSS extra para el `<svg>`. */
  cls?: string;
  /** Grosor del trazo (por defecto 1.8). */
  stroke?: number;
  /** Si se indica, el icono deja de ser decorativo y expone `<title>`. */
  title?: string;
}

export const DEFAULT_ICON_SIZE = 20;
export const DEFAULT_STROKE = 1.8;

/* -------------------------------------------------------------------------- */
/* Diccionario                                                                */
/* -------------------------------------------------------------------------- */

export const IC: Record<string, IconDef> = {
  /* --- Navegación principal ---------------------------------------------- */
  home: {
    label: 'Inicio',
    body:
      '<path d="M4 11.3 12 4l8 7.3V19a1.6 1.6 0 0 1-1.6 1.6h-3.8v-6.1H9.4v6.1H5.6A1.6 1.6 0 0 1 4 19z"/>',
  },
  lib: {
    label: 'Biblioteca',
    body:
      '<path d="M4 5.6A1.6 1.6 0 0 1 5.6 4H9v16H5.6A1.6 1.6 0 0 1 4 18.4z"/>' +
      '<path d="M9 4h4v16H9z"/>' +
      '<path d="m15.1 4.7 3.3.9-3.5 14.6-3.3-.9z"/>',
  },
  cat: {
    label: 'Catálogo',
    body:
      '<path d="M4 6.2A2.2 2.2 0 0 1 6.2 4h11.6A2.2 2.2 0 0 1 20 6.2v8.1l-3.1 5.7H7.1L4 14.3z"/>' +
      '<path d="M8.2 8.1h7.6v4.6H8.2z"/>',
  },
  upd: {
    label: 'Actualizaciones',
    body: '<path d="M20 12a8 8 0 1 1-2.7-6"/><path d="M20 4.4v5.2h-5.2"/>',
  },
  set: {
    label: 'Ajustes',
    body:
      '<circle cx="12" cy="12" r="3.1"/>' +
      '<path d="M12 2.6v2.3M12 19.1v2.3M4.5 12H2.2M21.8 12h-2.3"/>' +
      '<path d="m6.8 6.8 1.6 1.6M15.6 15.6l1.6 1.6M6.8 17.2l1.6-1.6M15.6 8.4l1.6-1.6"/>',
  },

  /* --- Acciones ---------------------------------------------------------- */
  search: { label: 'Buscar', body: '<circle cx="11" cy="11" r="6.3"/><path d="m15.7 15.7 4.4 4.4"/>' },
  play: { label: 'Jugar', solid: true, body: '<path d="M8.4 5.2 18.6 12 8.4 18.8z"/>' },
  stop: { label: 'Detener', solid: true, body: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.6"/>' },
  download: {
    label: 'Descargar',
    body: '<path d="M12 3.8v10.9"/><path d="m7.4 10.6 4.6 4.6 4.6-4.6"/><path d="M4.4 20.2h15.2"/>',
  },
  close: { label: 'Cerrar', body: '<path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8"/>' },
  check: { label: 'Hecho', body: '<path d="m4.8 12.4 4.6 4.6L19.2 7.2"/>' },
  alert: {
    label: 'Aviso',
    body: '<path d="M12 4.4 20.8 20H3.2z"/><path d="M12 9.9v4.5M12 17.1v.2"/>',
  },
  info: { label: 'Información', body: '<circle cx="12" cy="12" r="8.3"/><path d="M12 11.1v5.6M12 7.9v.2"/>' },
  folder: {
    label: 'Carpeta',
    body:
      '<path d="M3.6 7.5a1.9 1.9 0 0 1 1.9-1.9h3.8l2 2.4h7.2a1.9 1.9 0 0 1 1.9 1.9v7.6a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9z"/>',
  },
  external: {
    label: 'Abrir enlace externo',
    body:
      '<path d="M14.2 3.8h6v6"/><path d="M20.2 3.8 10.8 13.2"/>' +
      '<path d="M18.4 14.1v4.4a1.7 1.7 0 0 1-1.7 1.7H5.4a1.7 1.7 0 0 1-1.7-1.7V7.2a1.7 1.7 0 0 1 1.7-1.7h4.4"/>',
  },
  gear: {
    label: 'Ajustes del port',
    body:
      '<circle cx="12" cy="12" r="3.1"/>' +
      '<path d="M12 2.6v2.3M12 19.1v2.3M4.5 12H2.2M21.8 12h-2.3"/>' +
      '<path d="m6.8 6.8 1.6 1.6M15.6 15.6l1.6 1.6M6.8 17.2l1.6-1.6M15.6 8.4l1.6-1.6"/>',
  },
  trash: {
    label: 'Desinstalar',
    body:
      '<path d="M4.6 7.2h14.8"/><path d="M9.2 7.2V5.1a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1v2.1"/>' +
      '<path d="M6.6 7.2 7.5 19a1.4 1.4 0 0 0 1.4 1.3h6.2A1.4 1.4 0 0 0 16.5 19l.9-11.8"/><path d="M10.6 10.6v6M13.4 10.6v6"/>',
  },
  retry: { label: 'Reintentar', body: '<path d="M4.4 12a7.6 7.6 0 1 0 2.6-5.7"/><path d="M4.4 4.6v5.2h5.2"/>' },
  rom: {
    label: 'ROM',
    body: '<path d="M5.4 4.6h13.2v10.1l-2.6 4.7H8L5.4 14.7z"/><path d="M9 8h6v3.4H9z"/><path d="M10.6 16.2v1.9M13.4 16.2v1.9"/>',
  },
  save: {
    label: 'Guardar',
    body: '<path d="M4.4 6.1A1.7 1.7 0 0 1 6.1 4.4h9.4l4.1 4.1v9.4a1.7 1.7 0 0 1-1.7 1.7H6.1a1.7 1.7 0 0 1-1.7-1.7z"/><path d="M8.2 4.4h7v4.4h-7z"/><path d="M8.2 19.6v-5.1h7.6v5.1"/>',
  },
  link: {
    label: 'Enlazar',
    body:
      '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.3 1.3"/>' +
      '<path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3"/>',
  },
  shield: {
    label: 'Verificado',
    body: '<path d="M12 3.4 19.4 6v6.2c0 4-3 7.1-7.4 8.4-4.4-1.3-7.4-4.4-7.4-8.4V6z"/><path d="m9 12 2.2 2.2L15.4 10"/>',
  },
  clock: { label: 'Reciente', body: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.4V12l3.2 1.9"/>' },
  star: {
    label: 'Recomendado',
    body: '<path d="m12 3.9 2.6 5.5 5.9.8-4.3 4.2 1.1 5.9L12 17.5l-5.3 2.8 1.1-5.9L3.5 10.2l5.9-.8z"/>',
  },
  pin: {
    label: 'Fijado',
    body: '<path d="M9.4 3.8h5.2l-.7 5 3.1 3.1H6.9l3.1-3.1z"/><path d="M12 11.9v8.3"/>',
  },
  power: { label: 'Ejecutar', body: '<path d="M12 4.2v7.4"/><path d="M7.4 6.6a6.9 6.9 0 1 0 9.2 0"/>' },
  menu: { label: 'Menú', body: '<path d="M4.4 7.2h15.2M4.4 12h15.2M4.4 16.8h15.2"/>' },
  filter: { label: 'Filtros', body: '<path d="M4.2 6.4h15.6L13.8 13v6.6l-3.6-1.8V13z"/>' },
  sort: { label: 'Ordenar', body: '<path d="M7.4 4.6v14.8"/><path d="m4.2 16.2 3.2 3.2 3.2-3.2"/><path d="M16.6 19.4V4.6"/><path d="m13.4 7.8 3.2-3.2 3.2 3.2"/>' },
  monitor: {
    label: 'Destino',
    body: '<rect x="3.4" y="4.8" width="17.2" height="11.4" rx="1.7"/><path d="M9 20.2h6M12 16.2v4"/>',
  },
  cart: {
    label: 'Soporte',
    body: '<path d="M6.4 6h11.2v9.4l-2.2 4H8.6l-2.2-4z"/><path d="M9.2 9h5.6v3.2H9.2z"/>',
  },
  disc: {
    label: 'Disco',
    body: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.6a8.4 8.4 0 0 1 6 2.5"/>',
  },

  /* --- Vistas (selector segmentado) -------------------------------------- */
  posters: {
    label: 'Carátulas',
    body:
      '<rect x="4.2" y="4.2" width="6.4" height="8.2" rx="1.1"/>' +
      '<rect x="13.4" y="4.2" width="6.4" height="8.2" rx="1.1"/>' +
      '<rect x="4.2" y="14.4" width="6.4" height="5.4" rx="1.1"/>' +
      '<rect x="13.4" y="14.4" width="6.4" height="5.4" rx="1.1"/>',
  },
  big: {
    label: 'Grilla grande',
    body: '<rect x="3.4" y="5.6" width="17.2" height="9.4" rx="1.6"/><path d="M6.4 18.4h11.2"/>',
  },
  carts: {
    label: 'Estantería',
    body:
      '<path d="M4.6 4.8h4.2v14.4H4.6z"/><path d="M9.8 4.8h4.2v14.4H9.8z"/>' +
      '<path d="m15.4 5.6 3.4.9-3.3 14.2-3.4-.9z"/><path d="M3.4 20.4h17.2"/>',
  },
  list: {
    label: 'Lista',
    body:
      '<path d="M8.4 6.4h11.2M8.4 12h11.2M8.4 17.6h11.2"/>' +
      '<circle cx="4.6" cy="6.4" r="1"/><circle cx="4.6" cy="12" r="1"/><circle cx="4.6" cy="17.6" r="1"/>',
  },
  table: {
    label: 'Tabla',
    body:
      '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="1.7"/>' +
      '<path d="M3.4 9.4h17.2M3.4 14.2h17.2M9.6 9.4v10M15.2 9.4v10"/>',
  },

  /* --- Direcciones ------------------------------------------------------- */
  arrowUp: { label: 'Subir', body: '<path d="M12 19.6V4.6"/><path d="m6.4 10.2 5.6-5.6 5.6 5.6"/>' },
  arrowDown: { label: 'Bajar', body: '<path d="M12 4.4v15"/><path d="m6.4 13.8 5.6 5.6 5.6-5.6"/>' },
  chevronDown: { label: 'Desplegar', body: '<path d="m6.4 9.6 5.6 5.6 5.6-5.6"/>' },
  chevronRight: { label: 'Siguiente', body: '<path d="m9.6 6.4 5.6 5.6-5.6 5.6"/>' },
  chevronLeft: { label: 'Anterior', body: '<path d="m14.4 6.4-5.6 5.6 5.6 5.6"/>' },
  grid3: {
    label: 'Cuadrícula',
    body:
      '<rect x="4" y="4" width="6.6" height="6.6" rx="1.2"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.2"/>' +
      '<rect x="4" y="13.4" width="6.6" height="6.6" rx="1.2"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.2"/>',
  },

  /* --- Estado ------------------------------------------------------------ */
  dot: { label: 'Punto', solid: true, body: '<circle cx="12" cy="12" r="4"/>' },
  spinner: {
    label: 'Cargando',
    body: '<path d="M12 3.6a8.4 8.4 0 1 1-8.4 8.4" stroke-linecap="round"/>',
  },
  empty: {
    label: 'Vacío',
    body: '<rect x="3.8" y="6.4" width="16.4" height="11.2" rx="1.8"/><path d="M8 12h8"/>',
  },
};

/** Nombres disponibles (orden de inserción). */
export const ICON_NAMES: string[] = Object.keys(IC);

/** Símbolos usados por los componentes cuando el icono puede faltar. */
export const FALLBACK_GLYPH = '·';

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Envuelve un cuerpo SVG con los atributos comunes del sistema de iconos.
 * Se usa directamente cuando el cuerpo se compone en el sitio (p. ej. el
 * triángulo de *play* con un `transform` concreto).
 */
export function svg(body: string, opts: IconOptions = {}): string {
  const size = opts.size ?? DEFAULT_ICON_SIZE;
  const stroke = opts.stroke ?? DEFAULT_STROKE;
  const cls = opts.cls ? ` class="${escapeAttr(opts.cls)}"` : '';

  const common =
    `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false"`;

  if (opts.title) {
    return (
      `<svg${cls} ${common} role="img" aria-hidden="false">` +
      `<title>${escapeHtml(opts.title)}</title>${body}</svg>`
    );
  }
  return `<svg${cls} ${common}>${body}</svg>`;
}

/** Icono por nombre como cadena HTML. Si el nombre no existe, `FALLBACK_GLYPH`. */
export function icon(name: string, opts: IconOptions = {}): string {
  const def = IC[name];
  if (!def) return `<span aria-hidden="true">${FALLBACK_GLYPH}</span>`;
  const body = def.solid
    ? `<g fill="currentColor" stroke="none">${def.body}</g>`
    : def.body;
  const title = opts.title ?? undefined;
  return svg(body, { ...opts, title });
}

/** Icono por nombre como nodo del DOM (para insertar sin `innerHTML`). */
export function svgIcon(name: string, opts: IconOptions = {}): SVGElement {
  const markup = icon(name, opts);
  const host = document.createElement('div');
  host.innerHTML = markup;
  const node = host.firstElementChild;
  if (node instanceof SVGElement) return node;
  // Nombre inexistente: devolvemos un SVG vacío para no romper el llamante.
  const empty = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  empty.setAttribute('viewBox', '0 0 24 24');
  empty.setAttribute('aria-hidden', 'true');
  return empty;
}

/** `true` si el diccionario contiene el nombre. */
export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(IC, name);
}

/* -------------------------------------------------------------------------- */
/* Utilidades de plantilla (compartidas por todos los componentes)            */
/* -------------------------------------------------------------------------- */

/** Escapa texto para insertarlo como contenido o atributo entrecomillado. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Alias corto de `escapeHtml` (se usa mucho en las plantillas). */
export const esc = escapeHtml;

/**
 * Escapa un valor para un atributo. Devuelve cadena vacía para
 * `null`/`undefined`/`false`, de modo que `disabled="${attr(x)}"` no genera
 * atributos fantasma (`disabled="false"` sigue deshabilitando en HTML).
 */
export function attr(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

/** Concatena clases descartando valores falsy. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

/**
 * Atajo de atributo `style` a partir de pares ya escapados.
 * `styleAttr({ '--mz': 0.8, color: 'var(--accent)' })`
 */
export function styleAttr(decls: Record<string, string | number | null | undefined>): string {
  const body = Object.entries(decls)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${String(v)}`)
    .join(';');
  return body ? ` style="${escapeHtml(body)}"` : '';
}

/** Corta un texto a `max` caracteres añadiendo puntos suspensivos. */
export function truncate(value: string, max = 60): string {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export default IC;
