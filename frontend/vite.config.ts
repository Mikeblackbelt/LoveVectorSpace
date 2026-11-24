/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Content-Security-Policy for production builds (dev needs Vite's inline preamble, so it is build-only).
 * The backend should send the same policy as a header, plus frame-ancestors (ignored in <meta>);
 * see README "Security headers".
 */
export function cspFor(apiBase: string): string {
  let apiOrigin = '';
  try {
    apiOrigin = apiBase ? new URL(apiBase).origin : '';
  } catch {
    apiOrigin = '';
  }
  return [
    "default-src 'self'",
    `connect-src 'self'${apiOrigin ? ' ' + apiOrigin : ''}`,
    "script-src 'self' https://appleid.cdn-apple.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "base-uri 'self'",
    "form-action 'self' https://appleid.apple.com https://accounts.google.com",
    "object-src 'none'",
  ].join('; ');
}

function csp(apiBase: string): Plugin {
  return {
    name: 'lvs-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${cspFor(apiBase)}" />`);
    },
  };
}

// Modes:
//   development (npm run dev)      -> VITE_API_MODE=mock (see .env.development): runs with no backend
//   live        (npm run dev:live) -> real API, /api proxied to VITE_PROXY_TARGET (default http://localhost:8000)
//   mock        (npm run build:mock) -> static demo build with the in-browser mock API
//   production  (npm run build)    -> real API (same origin, or VITE_API_BASE for native builds)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8000';
  return {
    plugins: [react(), csp(env.VITE_API_BASE || '')],
    define: { __LVS_MOCK__: JSON.stringify(env.VITE_API_MODE === 'mock') },
    server: {
      port: 5173,
      proxy: mode === 'live' ? { '/api': { target, changeOrigin: true }, '/healthz': { target, changeOrigin: true } } : undefined,
    },
    build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      include: ['src/**/*.test.{ts,tsx}'],
      env: { VITE_API_MODE: 'live' },
    },
  };
});
