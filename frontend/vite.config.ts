import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import proxyConfig from './proxy.conf.json';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: proxyConfig,
  },
});
