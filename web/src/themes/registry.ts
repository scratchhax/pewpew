import type { Theme } from '../theme';

/**
 * Every folder under themes/ with an index.ts (default-exporting a Theme) is
 * a theme, loaded as its own chunk so a viewer only downloads the one it shows.
 * The build also writes <id>/index.html per theme (see vite.config.ts), which
 * is how the relay knows what to serve at /<id>/.
 */
const modules = import.meta.glob<{ default: Theme<any> }>('./*/index.ts');

export const THEME_IDS = Object.keys(modules).map((p) => p.split('/')[1]).sort();

/** Used when neither the URL nor the relay names a theme. */
export const BUILTIN_DEFAULT = 'scifi';

/**
 * Pick the theme for this page: the URL path (/zombie/), then ?theme=, then
 * the relay's default_theme (/config.json), then the built-in default.
 */
export async function resolveTheme(): Promise<Theme<any>> {
  const segments = location.pathname.split('/').filter(Boolean);
  const fromPath = segments[segments.length - 1] ?? '';
  const fromQuery = new URLSearchParams(location.search).get('theme') ?? '';
  let id = [fromPath, fromQuery].find((x) => THEME_IDS.includes(x));
  if (!id) {
    const relay = await relayDefault();
    id = relay && THEME_IDS.includes(relay) ? relay : BUILTIN_DEFAULT;
  }
  return (await modules[`./${id}/index.ts`]()).default;
}

/** The relay's configured default theme, or null (demo build, no relay, old relay). */
async function relayDefault(): Promise<string | null> {
  if (__DEMO__) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1500);
  try {
    const res = await fetch('/config.json', { signal: abort.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const cfg = await res.json() as { default_theme?: unknown };
    return typeof cfg.default_theme === 'string' ? cfg.default_theme : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
