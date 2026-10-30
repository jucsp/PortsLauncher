/* ==========================================================================
 * PortsLauncher · ui/icons.ts
 *
 * Iconos del prototipo de Claude (líneas 325–340). Son SVG en línea, sin
 * sprite externo: `stroke: currentColor`, `stroke-width: 1.8`, 24×24.
 * ========================================================================== */

/** Envoltorio `sv()` del prototipo. */
export const sv = (path: string, size = 20): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

/**
 * Glifo de Addons (pieza de puzle).
 *
 * Se expone como función porque la sección lo necesita a dos tamaños: 20 px en
 * la navegación (vía `IC.addons`) y 40 px en el estado vacío de la pantalla.
 */
export const addonsGlyph = (size = 20): string =>
  sv(
    '<path d="M19 7h-3V4a2 2 0 0 0-4 0v3H9a2 2 0 0 0-2 2v3H4a2 2 0 0 0 0 4h3v3a2 2 0 0 0 2 2h3v-3a2 2 0 0 1 4 0v3h3a2 2 0 0 0 2-2v-3h-3a2 2 0 0 1 0-4h3V9a2 2 0 0 0-2-2z"/>',
    size
  );

/**
 * Glifo de libro abierto (guía).
 *
 * Igual que `addonsGlyph`, se expone como función porque la guía de plugins lo
 * necesita a 16 px en los botones (`IC.book`) y a 22 px en la cabecera del
 * modal de documentación.
 */
export const bookGlyph = (size = 16): string =>
  sv(
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    size
  );

/**
 * Glifo de paleta de pintor monocromática.
 *
 * Mismo patrón que `addonsGlyph`/`bookGlyph`: 16 px en botones de la UI
 * (`IC.palette`) y un tamaño mayor en la cabecera del modal de arte.
 *
 * Los cuatro puntos llevan `fill="currentColor"` explícito porque `sv()` fija
 * `fill="none"` en el `<svg>`; el contorno hereda el trazo del envoltorio
 * (`stroke: currentColor`, `stroke-width: 1.8`).
 */
export const paletteGlyph = (size = 16): string =>
  sv(
    '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>' +
      '<circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>' +
      '<path d="M12 2C6.49 2 2 6.49 2 12c0 4.41 3.59 8 8 8 1.1 0 2-.9 2-2 0-.49-.18-.94-.48-1.29-.3-.35-.48-.8-.48-1.29 ' +
      '0-1.1.9-2 2-2h2.41c4.14 0 7.55-3.41 7.55-7.55C23.49 6.49 18.35 2 12 2z"/>',
    size
  );

export const IC = {
  home: sv('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  lib: sv(
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
  ),
  cat: sv('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  upd: sv('<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 20h16"/>'),
  set: sv(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1' +
      'a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3' +
      'l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 ' +
      '1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 ' +
      '4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 ' +
      '1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
  ),
  search: sv('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', 18),
  posters: sv(
    '<rect x="4" y="3" width="7" height="10" rx="1.5"/><rect x="13" y="3" width="7" height="10" rx="1.5"/>' +
      '<rect x="4" y="15" width="7" height="6" rx="1.5"/><rect x="13" y="15" width="7" height="6" rx="1.5"/>'
  ),
  big: sv('<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/>'),
  carts: sv('<path d="M6 3h12l2 3v15H4V6z"/><path d="M8 3v4h8V3M8 21v-3h8v3"/>'),
  list: sv('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>'),
  table: sv('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>'),
  play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>',
  addons: addonsGlyph(),
  folder: sv('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', 16),
  plus: sv('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 16),
  book: bookGlyph(),
  trash: sv(
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    16
  ),
  palette: paletteGlyph(),
  gear: sv(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1' +
      'a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3' +
      'l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 ' +
      '1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 ' +
      '4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 ' +
      '1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    16
  ),
} as const;

export type IconKey = keyof typeof IC;
