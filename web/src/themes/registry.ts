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

/** What the scene picker shows for each theme (kept here so picking never downloads every theme). */
export const SCENES: Record<string, { title: string; blurb: string; accent: string }> = {
  scifi: { title: 'Orbital Command', blurb: 'A space station defending your network: asteroids, lasers and constellations.', accent: '#46f0d9' },
  zombie: { title: 'Last Outpost', blurb: "A walled compound holding out against the internet's zombies.", accent: '#9fe36b' },
  racing: { title: 'Midnight Run', blurb: 'A neon street race: traffic, roadblocks, rivals and police chases.', accent: '#ff3fb4' },
  rush: { title: 'Packet Rush', blurb: 'A 16-bit runner: gems, stompable baddies, query blocks, rivals and a hunter drone.', accent: '#41a6f6' },
  spy: { title: 'Panopticon', blurb: 'A made-up planet under watch: signal arcs, satellites, and an eye of god that zooms in on the people behind the traffic.', accent: '#e8c26a' },
  mainframe: { title: 'Mainframe', blurb: 'A god\'s-eye flight over a glowing circuit board at night: traffic races the traces, and dives into chips trace intruders.', accent: '#7ef3ff' },
  aquarium: { title: 'Aquarium', blurb: 'A reef tank: schools of fish for your traffic, pufferfish for blocks, a shark for threats, and bubbles for DNS lookups.', accent: '#6fe6ff' },
  gibson: { title: 'The Gibson', blurb: 'The storage wall from the movie: translucent cyan monoliths lining the corridor, a DHCP lease rewrites one, and the camera locks onto red intruder files.', accent: '#5fd6ff' },
  mycelium: { title: 'Mycelium', blurb: 'Your network as a forest floor at night: permitted traffic grows a glowing web between hosts, DNS pushes up mushrooms wearing the domain, threats are a blight the web burns off.', accent: '#5ff0cf' },
};
/** Themes in picker order: the known scenes first (as the README lists them), then any others. */
export const SCENE_ORDER = [...Object.keys(SCENES).filter((id) => THEME_IDS.includes(id)), ...THEME_IDS.filter((id) => !(id in SCENES))];
export const sceneInfo = (id: string) => SCENES[id] ?? { title: id.toUpperCase(), blurb: '', accent: '#9fdcff' };

/** This screen's own pick, from the scene picker (per browser, so a kiosk keeps it across reboots). */
const SCENE_KEY = 'pewpew.scene';
function savedScene(): string | null {
  try { const v = localStorage.getItem(SCENE_KEY); return v && THEME_IDS.includes(v) ? v : null; } catch { return null; }
}

/** The path segment naming a theme, if the URL has one (/zombie/). */
function pathTheme(): string | null {
  const segments = location.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return THEME_IDS.includes(last) ? last : null;
}

/**
 * Pick the theme for this page: the URL path (/zombie/), then ?theme=, then
 * this screen's pick from the scene picker, then the relay's default_theme
 * (/config.json), then the built-in default.
 */
export async function resolveTheme(): Promise<Theme<any>> {
  const fromQuery = new URLSearchParams(location.search).get('theme') ?? '';
  let id = pathTheme() ?? (THEME_IDS.includes(fromQuery) ? fromQuery : null) ?? savedScene();
  if (!id) {
    const relay = await relayDefault();
    id = relay && THEME_IDS.includes(relay) ? relay : BUILTIN_DEFAULT;
  }
  return (await modules[`./${id}/index.ts`]()).default;
}

/**
 * Switch this screen to another scene: remember the pick, then load it. A URL
 * that names a theme (/zombie/ or ?theme=) is rewritten to the new one; the
 * plain address (what a kiosk opens) just reloads and finds the saved pick.
 */
export function switchScene(id: string): void {
  if (!THEME_IDS.includes(id)) return;
  try { localStorage.setItem(SCENE_KEY, id); } catch { /* private window: the URL change below still works */ }
  const url = new URL(location.href);
  const inPath = pathTheme();
  if (inPath) url.pathname = url.pathname.replace(new RegExp(`/${inPath}/?$`), `/${id}/`);
  if (url.searchParams.has('theme') || (__DEMO__ && !inPath)) url.searchParams.set('theme', id);
  location.assign(url.toString());
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
