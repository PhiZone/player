import * as env from '$env/static/public';
import { sequence } from '@sveltejs/kit/hooks';
import { handleErrorWithSentry, sentryHandle } from '@sentry/sveltekit';
import * as Sentry from '@sentry/sveltekit';

if ('PUBLIC_SENTRY_DSN' in env) {
  Sentry.init({
    dsn: env.PUBLIC_SENTRY_DSN as string,

    tracesSampleRate: 1.0,

    // uncomment the line below to enable Spotlight (https://spotlightjs.com)
    spotlight: import.meta.env.DEV,
  });
}

// If you have custom handlers, make sure to place them after `sentryHandle()` in the `sequence` function.
export const handle = 'PUBLIC_SENTRY_DSN' in env ? sequence(sentryHandle()) : undefined;

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = 'PUBLIC_SENTRY_DSN' in env ? handleErrorWithSentry() : undefined;
