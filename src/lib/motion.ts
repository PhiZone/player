import { backOut, cubicOut } from 'svelte/easing';
import { fly, scale } from 'svelte/transition';

/**
 * Shared motion primitives for the app shell UI. Every helper degrades to an
 * instant no-op when the user prefers reduced motion, and keeps durations
 * short (150–300 ms) so interactions feel snappy rather than theatrical.
 */

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** No-op transition result — finishes immediately without touching styles. */
const none = { duration: 0 };

interface SlideFadeParams {
  /** 1 enters from the right, -1 from the left, 0 for a plain fade. */
  direction?: number;
  duration?: number;
}

/**
 * Directional slide-and-fade used when swapping primary views (top-level
 * tabs, segmented sections). Apply as an intro only so the outgoing view
 * yields its layout instantly instead of stacking mid-flight.
 */
export const slideFade = (node: Element, params: SlideFadeParams = {}) => {
  const { direction = 1, duration = 240 } = params;
  if (prefersReducedMotion()) return none;
  return fly(node, { x: 32 * direction, duration, easing: cubicOut });
};

interface RiseInParams {
  y?: number;
  delay?: number;
  duration?: number;
}

/**
 * Gentle rise-and-fade entrance for content blocks and grid cards; pass
 * increasing `delay` values for stagger effects (keep them capped so long
 * lists never feel sluggish).
 */
export const riseIn = (node: Element, params: RiseInParams = {}) => {
  const { y = 12, delay = 0, duration = 280 } = params;
  if (prefersReducedMotion()) return none;
  return fly(node, { y, delay, duration, easing: cubicOut });
};

interface PopInParams {
  delay?: number;
  duration?: number;
}

/**
 * Quick scale-and-fade for small elements appearing in place (buttons,
 * badges) where a directional slide would look detached from their anchor.
 */
export const popIn = (node: Element, params: PopInParams = {}) => {
  const { delay = 0, duration = 180 } = params;
  if (prefersReducedMotion()) return none;
  return scale(node, { start: 0.92, delay, duration, easing: backOut });
};

/** Capped stagger delay for the i-th item in a grid/list entrance. */
export const staggerDelay = (index: number, step = 35, cap = 280) => Math.min(index * step, cap);
