/**
 * Toy-safe URL helpers for assets that live at the *app root* (the directory
 * holding the root `index.html` at `/toy/<slug>/`), regardless of the current
 * route.
 *
 * On a Toy page, `$app/paths` `base` is the *current route's* base:
 * `/toy/<slug>` on the landing page but `/toy/<slug>/play` on the play page
 * (each prerendered page inlines `base: new URL(".", location).pathname...`
 * and the build's URL-normalization keeps trailing-slash routes).
 *
 * Platform-served static files like `ffmpeg/ffmpeg-core.js` and
 * `game/shaders/*.glsl` live under the app root — NOT under every route.
 * If a loader naively joins them to the route base, the fetch 404s on
 * nested pages (`/toy/<slug>/play/ffmpeg/...`), which surfaces as "ffmpeg
 * fails to load" only on the second play attempt (the first play runs with
 * blobs cached or succeeds before conversion).
 *
 * Non-Toy pages pass through: `base` is then `''` (root-absolute paths) and
 * `toyRootUrl` returns the path unchanged, so behavior is unchanged everywhere
 * else (regular web, Capacitor, Tauri).
 */
import { isToyEnvironmentSync } from './toy';

/**
 * Resolve a URL against the *app root*. `path` is typically the `$app/paths`
 * base (`''` or `/toy/<slug>`/`/toy/<slug>/play`) joined with a static dir
 * like `/ffmpeg`. On Toy pages this returns
 * `https://host/toy/<slug><rest>` regardless of the current route. Outside
 * Toy, root-relative URLs already point at the app root, so `path` is
 * returned unchanged.
 */
export function toyRootUrl(path: string): string {
  if (!isToyEnvironmentSync() || typeof window === 'undefined') return path;
  return rebaseToAppRoot(path);
}

/** The current page's app root: `/toy/<slug>`. */
function currentAppRoot(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/^(\/toy\/[^/]+)/);
  return m?.[1] ?? null;
}

/**
 * Rebaser: `path` is typically `${base}/static/...` where `$app/paths` base
 * carries the *current route* (`/toy/<slug>/play` on the play page). Drop the
 * route portion so the remaining static path is joined onto the app root.
 * Example on the play page: `/toy/<slug>/play/ffmpeg` -> `/toy/<slug>/ffmpeg`.
 */
function rebaseToAppRoot(path: string): string {
  const appRoot = currentAppRoot();
  if (!appRoot || typeof window === 'undefined') return path;
  const routePrefix = window.location.pathname.slice(appRoot.length); // e.g. "/" or "/play/"
  let rest = path;
  const baseWithRoute = appRoot + routePrefix;
  if (rest.startsWith(baseWithRoute)) {
    rest = rest.slice(baseWithRoute.length);
  }
  // Also drop a bare leading /toy/<slug> token (already at the app root).
  rest = rest.replace(/^\/toy\/[^/]+/, '');
  return `${appRoot}${rest.startsWith('/') ? rest : `/${rest}`}`;
}
