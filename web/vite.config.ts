import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(new Date().toISOString().slice(5, 16).replace('T', ' ')),
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  esbuild: { legalComments: 'none' },
});
