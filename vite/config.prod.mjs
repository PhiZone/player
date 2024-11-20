import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

const MESSAGE_INTERVAL_MS = 1000000;
const lastMessageTime = process.env.LAST_MESSAGE_TIME || 0;

const now = Date.now();

if (now - lastMessageTime > MESSAGE_INTERVAL_MS) {
  process.stdout.write('Building for production...\n');
  process.env.LAST_MESSAGE_TIME = now;
}

export default defineConfig({
  base: './',
  plugins: [sveltekit()],
  logLevel: 'error',
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        passes: 2,
      },
      mangle: true,
      format: {
        comments: false,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
