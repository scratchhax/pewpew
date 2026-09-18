import { defineConfig, type Plugin } from 'vite';
import { readdirSync, existsSync } from 'node:fs';

/** Theme ids = folders under src/themes with an index.ts (as in registry.ts). */
const themeIds = readdirSync(new URL('./src/themes', import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`./src/themes/${d.name}/index.ts`, import.meta.url)))
  .map((d) => d.name);

/**
 * Write dist/<theme>/index.html for every theme, so /<theme>/ loads that theme
 * from the relay and from static hosts like GitHub Pages. The page is the
 * normal index.html; relative asset URLs (demo build) gain one ../ level.
 */
function themePages(): Plugin {
  return {
    name: 'pewpew-theme-pages',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') return;
      const source = String(html.source).replace(/(src|href)="\.\//g, '$1="../');
      for (const id of themeIds) {
        this.emitFile({ type: 'asset', fileName: `${id}/index.html`, source });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? './' : '/',
  define: {
    __DEMO__: mode === 'demo',
    __BUILD__: JSON.stringify(new Date().toISOString().slice(5, 16).replace('T', ' ')),
  },
  plugins: [themePages()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/api': { target: 'http://localhost:8080' },
      '/tracks': { target: 'http://localhost:8080' },
      '/wads': { target: 'http://localhost:8080' },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  esbuild: { legalComments: 'none' },
}));
