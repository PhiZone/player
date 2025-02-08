import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { rmSync } from 'fs';

const MESSAGE_INTERVAL_MS = 1000000;
const lastMessageTime = process.env.LAST_MESSAGE_TIME || 0;

const now = Date.now();

if (now - lastMessageTime > MESSAGE_INTERVAL_MS) {
  process.stdout.write('Building for production...\n');
  process.env.LAST_MESSAGE_TIME = now;
}

if (process.env.PUBLIC_FFMPEG_URL) {
  rmSync('./static/ffmpeg', { recursive: true, force: true });
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
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
