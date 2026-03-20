import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { rmSync } from 'fs';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { execSync } from 'child_process';

const MESSAGE_INTERVAL_MS = 1000000;
const lastMessageTime = process.env.LAST_MESSAGE_TIME || 0;

const now = Date.now();

const commitHash = execSync('git rev-parse --short HEAD').toString().trim();

if (now - lastMessageTime > MESSAGE_INTERVAL_MS) {
  process.stdout.write('Building for production...\n');
  process.env.LAST_MESSAGE_TIME = now;
}

if (process.env.PUBLIC_FFMPEG_URL) {
  rmSync('./static/ffmpeg', { recursive: true, force: true });
}

export default defineConfig({
  plugins: [
    sveltekit(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'localStorage', 'preferredLanguage', 'baseLocale'],
    }),
  ],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
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
