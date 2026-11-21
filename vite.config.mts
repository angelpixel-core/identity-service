import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const apiTarget = process.env.VITE_API_URL || 'http://localhost:4000';
const proxyEntry = {
  target: apiTarget,
  changeOrigin: true,
};

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'interfaces/web/client'),
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': proxyEntry,
      '/.well-known': proxyEntry,
      '/oauth2': proxyEntry,
      '/health': proxyEntry,
      '/metrics': proxyEntry,
    }
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true
  }
});
