import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const apiTarget = process.env['API_URL'] ?? 'http://127.0.0.1:3000';
// Lab Hub: o jogo tem endereco proprio (projeto Pages `cyberidle-game`, separado do hub),
// publicado a partir de projetos/cyberidle/site/. Os sprites moram em site/assets/, fora do
// codigo. Claude (Opus 5.5).
const BASE = '/';
const site = path.resolve(repoRoot, '../site');
const assetsDir = path.join(site, 'assets');
const shims = path.resolve(here, 'src/local/shims');

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
};

/** Serve extractor output from disk so the scene works even if the API is down. */
function serveExtractedAssets(): Plugin {
  return {
    name: 'serve-extracted-assets',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const prefixo = `${BASE}assets/`;
        if (!req.url?.startsWith(prefixo)) return next();
        const rel = decodeURIComponent(req.url.slice(prefixo.length).split('?')[0] ?? '');
        const file = path.normalize(path.join(assetsDir, rel));
        if (!file.startsWith(assetsDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return next();
        }
        res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
        // JSON must not stick for a day — regenerated atlases left hunts black.
        res.setHeader(
          'cache-control',
          path.extname(file) === '.json' ? 'no-cache, must-revalidate' : 'public, max-age=120',
        );
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), serveExtractedAssets()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget, ws: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      // Modo local: o codigo do servidor roda no navegador; estes modulos do Node viram
      // substitutos pequenos (ver src/local/shims/).
      'node:crypto': path.join(shims, 'crypto.ts'),
      'node:fs': path.join(shims, 'vazio.ts'),
      'node:path': path.join(shims, 'vazio.ts'),
      'node:module': path.join(shims, 'vazio.ts'),
    },
  },
  build: {
    // Sai direto na pasta publica do hub. Nao apaga a pasta (os sprites moram la);
    // o script `publicar` limpa so o que e do build (index.html e app/).
    outDir: site,
    emptyOutDir: false,
    assetsDir: 'app',
    sourcemap: false,
    chunkSizeWarningLimit: 12000,
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
          data: [path.resolve(repoRoot, 'packages/data/src/index.ts')],
        },
      },
    },
  },
});
