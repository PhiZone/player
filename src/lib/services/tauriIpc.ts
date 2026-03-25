/**
 * Unified wrappers for Tauri IPC that transparently fall back to the
 * WebSocket bridge when running in a browser with the `backend` query param.
 */

import { hasTauriBackendParam, bridgeInvoke, bridgeListen } from '$lib/services/tauriIpcBridge';

/** Check for Tauri without importing from $lib/utils to avoid circular deps. */
const isTauri = () => '__TAURI_INTERNALS__' in window;

/**
 * Calls a Tauri command – either through the native IPC or via the WS bridge.
 */
export async function tauriInvoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  }
  if (hasTauriBackendParam()) {
    return bridgeInvoke<T>(command, args);
  }
  throw new Error(`Cannot invoke "${command}": not in Tauri and no backend param`);
}

/**
 * Listens for a Tauri event – either through the native API or via the WS bridge.
 * Returns an unlisten function.
 */
export async function tauriListen<T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (isTauri()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(event, handler);
  }
  if (hasTauriBackendParam()) {
    return bridgeListen<T>(event, handler);
  }
  throw new Error(`Cannot listen for "${event}": not in Tauri and no backend param`);
}
