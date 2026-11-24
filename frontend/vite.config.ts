/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Modes:
//   development (npm run dev)      -> VITE_API_MODE=mock (see .env.development): runs with no backend
//   live        (npm run dev:live) -> real API, /api proxied to VITE_PROXY_TARGET (default http://localhost:8000)
//   mock        (npm run build:mock) -> static demo build with the in-browser mock API
//   production  (npm run build)    -> real API (same origin, or VITE_API_BASE for native builds)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8000';
  return {
    plugins: [react()],
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
