import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';

/**
 * Post-build plugin that makes the SvelteKit static export portable for
 * Bilibili Toy. Runs after the adapter has written `build/` (in the SSR
 * build's `closeBundle`, which the SvelteKit plugin awaits before this one).
 *
 * Toy hosts pages under https://www.bilibili.com/toy/<slug>/ and serves/shared
 * URLs with an explicit `/index.html` suffix. The platform also only hosts an
 * explicit allow list of file extensions. This plugin addresses three gaps the
 * default build cannot (per SvelteKit/Vite docs):
 *
 * 1. The SPA fallback (build/index.html) always uses root-absolute asset paths
 *    (`/_app/...`, `/favicon.ico`) — SvelteKit docs state "Single-page app
 *    fallback pages will always use absolute paths". Those break under
 *    /toy/<slug>/, so we rewrite them to relative paths and compute the base
 *    dynamically.
 *
 * 2. SvelteKit's client router treats a trailing `/index.html` in the URL as a
 *    route path and renders "Not Found". Every Toy URL ends with /index.html.
 *    We inject a snippet that strips the suffix (via history.replaceState)
 *    before the router reads the URL.
 *
 * 3. Toy refuses to host `.fnt` / `.glsl` / `.xml` text assets. The app
 *    rewrites URLs for these to a `.json` twin at runtime (see
 *    src/lib/player/toyAssetUrl.ts), so we emit that byte-identical twin here.
 *
 * 4. Vite does not emit the @fontsource-variable/inter woff2 files that the
 *    built CSS references, so we copy them from the package into the build.
 *
 * Enable with `TOY_BUILD=1`; otherwise this plugin is a no-op.
 */
const BLOCKED_EXT = new Set(['.fnt', '.glsl', '.xml']);

const INTER_FONTS = [
  'inter-cyrillic-ext-wght-normal.woff2',
  'inter-cyrillic-wght-normal.woff2',
  'inter-greek-ext-wght-normal.woff2',
  'inter-greek-wght-normal.woff2',
  'inter-latin-ext-wght-normal.woff2',
  'inter-latin-wght-normal.woff2',
  'inter-vietnamese-wght-normal.woff2',
];

// Injected at the very top of the inline bootstrap script, BEFORE the base is
// computed and the app imports, so SvelteKit's router sees a clean
// trailing-slash URL. Stripping '/index.html' yields '/toy/<slug>' which does
// NOT match the root route '/'; appending '/' gives '/toy/<slug>/'.
const URL_NORMALIZE =
  "if (location.pathname.endsWith('/index.html')) {" +
  "  history.replaceState(history.state, '', " +
  "    location.pathname.slice(0, -'/index.html'.length) + '/' + " +
  '    location.search + location.hash);' +
  '}';

/** Recursively collect every file path under `dir`. */
function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out;
}

/** Emit a byte-identical `<name>.json` twin for every blocked-extension file. */
function emitJsonTwins(root) {
  let made = 0;
  for (const f of collectFiles(root)) {
    if (!BLOCKED_EXT.has(extname(f).toLowerCase())) continue;
    const twin = `${f}.json`;
    if (existsSync(twin)) continue;
    copyFileSync(f, twin);
    made += 1;
    console.log(`[toy] json twin: ${f}`);
  }
  return made;
}

/** Copy the Inter variable font woff2 files Vite failed to emit. */
function copyInterFonts(root) {
  const pkgDir = resolve('node_modules/@fontsource-variable/inter/files');
  const destDir = join(root, '_app/immutable/assets/files');
  let copied = 0;
  if (!existsSync(pkgDir)) return 0;
  mkdirSync(destDir, { recursive: true });
  for (const name of INTER_FONTS) {
    const src = join(pkgDir, name);
    const dest = join(destDir, name);
    if (!existsSync(src) || existsSync(dest)) continue;
    copyFileSync(src, dest);
    copied += 1;
  }
  return copied;
}

/** Make the SPA fallback (root build/index.html) Toy-safe. */
function transformFallback(html) {
  // Compute the base dynamically (resolves to /toy/<slug> at the root).
  html = html.replace(/base:\s*""/, 'base: new URL(".", location).pathname.slice(0, -1)');
  // Rewrite root-absolute asset references to relative ones.
  html = html.replace(/(["'])\/(_app\/|favicon\.ico)/g, '$1./$2');
  return html;
}

/** Inject the /index.html URL-normalization at the top of the inline script. */
function injectUrlNormalize(html) {
  if (html.includes("location.pathname.endsWith('/index.html')")) return html;
  const pattern = /<script>\s*\{\s*/s;
  const m = pattern.exec(html);
  if (!m) return html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + URL_NORMALIZE + html.slice(at);
}

function processHtml(path) {
  const original = readFileSync(path, 'utf8');
  let html = original;
  const isRoot = path.endsWith('/index.html') && path.includes('/build/index.html');

  if (isRoot) html = transformFallback(html);
  html = injectUrlNormalize(html);

  if (html === original) return false;

  // Guard: never leave a root-absolute /_app or /favicon ref in the fallback.
  if (isRoot) {
    const leftovers = /["']\/(_app\/|favicon\.ico)/.exec(html);
    if (leftovers) {
      throw new Error(`[toy] ${path} still has root-absolute refs: ${leftovers[0]}`);
    }
  }

  writeFileSync(path, html);
  return true;
}

export default function toyPostbuild() {
  let isSsr = false;
  return {
    name: 'toy-postbuild',
    apply: 'build',
    configResolved(config) {
      isSsr = !!config.build?.ssr;
    },
    closeBundle: {
      // Sequential so this runs after the SvelteKit plugin's own sequential
      // closeBundle (which awaits the adapter writing `build/`).
      sequential: true,
      async handler() {
        if (process.env.TOY_BUILD !== '1') return;
        // The SvelteKit adapter runs in the SSR build; only then is `build/`
        // fully written, so post-process only there.
        if (!isSsr) return;

        const root = resolve('build');
        if (!existsSync(join(root, 'index.html'))) return;

        let changed = 0;
        for (const f of collectFiles(root)) {
          if (f.endsWith('.html') && processHtml(f)) {
            changed += 1;
            console.log(`[toy] patched ${f}`);
          }
        }
        const twins = emitJsonTwins(root);
        const fonts = copyInterFonts(root);
        console.log(
          `[toy] done: ${changed} html patched, ${twins} json twins, ${fonts} fonts copied`,
        );
      },
    },
  };
}
