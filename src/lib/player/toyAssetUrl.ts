/**
 * Bilibili Toy only hosts an explicit allow list of file extensions
 * (.js/.json/.css/.html/.svg/.png/.jpg/.gif/.webp/.ttf/.woff/.woff2/.wav/.mp3/
 * .wasm/.ico …). Text assets with blocked extensions — `.glsl` shaders and
 * `.fnt` bitmap-font descriptors, plus `.xml`/`.txt` — are stripped from the
 * package at upload and return 404 on the real host.
 *
 * Every loader that consumes these files reads the **content as text**
 * (Phaser's `XMLFile` uses `responseText` + `DOMParser`; the app's `loadText`
 * uses `blob.text()`), so what matters is the bytes, not the extension. We
 * therefore ship a `.json` copy of each blocked-extension file (the platform
 * allows `.json`) and rewrite the URL to that copy while on a Toy page.
 *
 * This is a small leaf module — it only imports the Toy environment probe
 * (`isToyEnvironmentSync`) from `services/toy`, so both `constants.ts` and
 * `scenes/Game.ts` can use it without creating an import cycle through
 * `utils.ts` (which imports from `player/constants`).
 */
import { isToyEnvironmentSync } from '../services/toy';
import { toyRootUrl } from '../services/toyUrl';

const BLOCKED_EXT = /\.(fnt|glsl|xml|txt)$/i;

/**
 * Rewrite a URL for a platform-hosted asset whose extension is on Toy's block
 * list so it points at the `.json` copy shipped in the build. Non-Toy pages
 * and non-Toy URLs (external hosts) pass through unchanged.
 *
 * The `.json` twins live under the app root (`/toy/<slug>/game/...`), but the
 * caller may be on a nested page whose `$app/paths` base differs (the play
 * route's base is `/toy/<slug>/play`). We rebase the pathname onto the app
 * root first (via `toyRootUrl`), then append the `.json` suffix.
 */
export function toyAssetUrl(url: string): string {
  if (!isToyEnvironmentSync()) return url;
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return url;
  }
  if (!/^\/toy\//.test(parsed.pathname)) return url;
  // Rebase onto the app root (strip any route segment beyond /toy/<slug>).
  parsed.pathname = toyRootUrl(parsed.pathname);
  if (BLOCKED_EXT.test(parsed.pathname)) parsed.pathname += '.json';
  return parsed.toString();
}
