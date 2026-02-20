import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    // Demo mode: allow tunnel host headers (Cloudflare quick tunnel rotates subdomains).
    allowedHosts: true,

    proxy: {
      '/api': {
        // Local default works on host; compose can override with VITE_API_PROXY_TARGET.
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
