import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

const viteServerConfig = () => ({
  name: 'add-headers',
  configureServer: (server) => {
    server.middlewares.use((_, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [sveltekit(), viteServerConfig()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    port: 9900,
  },
});
