import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend AChatGo: React SPA, build ra public/ để Express (server.ts) phục vụ.
// Không đổi API backend; mọi dữ liệu qua POST /api/action + GET /api/bootstrap.
export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:10000',
      '/health': 'http://localhost:10000',
    },
  },
});
