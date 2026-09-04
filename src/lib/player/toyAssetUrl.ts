/**
 * Bilibili Toy only hosts an explicit allow list of file extensions. Text
 * assets with blocked extensions — `.glsl` shaders and `.fnt` bitmap-font
 * descriptors, plus `.xml`/`.txt` — are stripped from the package at upload
 * and return 404 on the real host. Standalone FFmpeg `.js` and `.wasm` files
 * are also currently rejected by the Toy package filter, even though
 * application chunks under `_app/` are served normally.
 *
 * The loaders consume the response bytes rather than relying on the original
 * extension: text loaders parse the bytes as text, while FFmpeg turns the
 * fetched `.json` response back into typed Blob URLs. We therefore ship a
 * `.json` copy of each affected file (the platform allows `.json`) and
 * rewrite the URL to that copy while on a Toy page.
 *
 * This is a small leaf module — it only imports the Toy environment probe
 * (`isToyEnvironmentSync`) from `services/toy`, so both `constants.ts` and
 * `scenes/Game.ts` can use it without creating an import cycle through
 * `utils.ts` (which imports from `player/constants`).
 */
import { isToyEnvironmentSync } from '../services/toy';
import { toyRootUrl } from '../services/toyUrl';

const JSON_TWIN_EXT = /\.(fnt|glsl|xml|txt)$/i;
const FFMPEG_CORE_ASSET = /\/ffmpeg\/ffmpeg-core\.(js|wasm)$/i;

/**
 * Rewrite a URL for a platform-hosted asset that Toy strips so it points at
 * the `.json` copy shipped in the build. Non-Toy pages and non-Toy URLs
 * (external hosts) pass through unchanged.
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
  if (JSON_TWIN_EXT.test(parsed.pathname) || FFMPEG_CORE_ASSET.test(parsed.pathname)) {
    parsed.pathname += '.json';
  }
  return parsed.toString();
}
