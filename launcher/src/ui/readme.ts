/**
 * README oficial del repositorio de un port, renderizado con `marked`.
 *
 * - Descarga `https://raw.githubusercontent.com/<repo>/HEAD/README.md`.
 * - Reescribe enlaces e imágenes relativas hacia el repositorio.
 * - Sanea el HTML resultante (sin scripts, manejadores `on*` ni `javascript:`).
 * - Cachea el resultado por repositorio y rellena `#readme-box` al terminar.
 */
import { marked } from 'marked';

type ReadmeEntry = { state: 'loading' } | { state: 'ok'; html: string } | { state: 'error' };

const CACHE = new Map<string, ReadmeEntry>();

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function rawBase(repo: string): string {
  return `https://raw.githubusercontent.com/${repo}/HEAD/`;
}

function blobBase(repo: string): string {
  return `https://github.com/${repo}/blob/HEAD/`;
}

function resolveRelative(value: string, base: string): string {
  if (!value || ABSOLUTE.test(value)) return value;
  return base + value.replace(/^\.?\/+/, '');
}

/** Convierte Markdown a HTML seguro con rutas relativas resueltas. */
export function markdownToHtml(markdown: string, repo: string): string {
  const raw = marked.parse(markdown, { async: false, gfm: true }) as string;
  if (typeof document === 'undefined') return raw;

  const tpl = document.createElement('template');
  tpl.innerHTML = raw;
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach((n) => n.remove());
  tpl.content.querySelectorAll<HTMLElement>('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
    const href = el.getAttribute('href');
    if (href !== null) {
      if (/^\s*javascript:/i.test(href)) el.removeAttribute('href');
      else {
        el.setAttribute('href', resolveRelative(href.trim(), blobBase(repo)));
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
    const src = el.getAttribute('src');
    if (src !== null) {
      if (/^\s*javascript:/i.test(src)) el.removeAttribute('src');
      else el.setAttribute('src', resolveRelative(src.trim(), rawBase(repo)));
    }
  });
  return tpl.innerHTML;
}

const LOADING_HTML = '<p class="muted">Cargando documentación oficial del repositorio...</p>';

/** Contenido inicial de `#readme-box` según el estado de la caché. */
export function readmeBoxHTML(repo: string | null | undefined): string {
  if (!repo) return '<p class="muted">Este proyecto no tiene repositorio público ni documentación disponible.</p>';
  const entry = CACHE.get(repo);
  if (entry?.state === 'ok') return entry.html;
  if (entry?.state === 'error') {
    return '<p class="muted">No se pudo cargar el README del repositorio.</p>';
  }
  return LOADING_HTML;
}

/** Inicia (si hace falta) la descarga y rellena `#readme-box` al completarse. */
export function ensureReadme(repo: string | null | undefined): void {
  if (!repo || typeof fetch !== 'function' || typeof document === 'undefined') return;
  if (CACHE.has(repo)) return;
  CACHE.set(repo, { state: 'loading' });
  const paint = (): void => {
    const box = document.getElementById('readme-box');
    if (box && box.dataset.repo === repo) box.innerHTML = readmeBoxHTML(repo);
  };
  fetch(`${rawBase(repo)}README.md`)
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    })
    .then((md) => CACHE.set(repo, { state: 'ok', html: markdownToHtml(md, repo) }))
    .catch(() => CACHE.set(repo, { state: 'error' }))
    .finally(paint);
}
