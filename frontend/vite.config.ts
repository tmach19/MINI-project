import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import proxyConfig from './proxy.conf.json';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api-en': {
        ...proxyConfig['/api-en'],
        rewrite: (path: string) => path.replace(/^\/api-en(?=\/|$)/, '/api'),
      },
      '/api/': proxyConfig['/api'],
    },
  },
});
