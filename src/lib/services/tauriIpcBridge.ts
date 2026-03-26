/**
 * WebSocket-based IPC bridge that mimics Tauri's invoke/listen/emit API.
 *
 * When the app is opened in a regular browser with the `backend` query parameter
 * pointing to the Tauri backend WebSocket URL, this bridge transparently proxies
 * Tauri IPC calls over WebSocket so that rendering mode works outside of the
 * Tauri WebView.
 *
 * Protocol (JSON text frames):
 *   → { "type": "invoke", "id": <number>, "command": <string>, "args": <object> }
 *   ← { "type": "invoke-response", "id": <number>, "result": <any> }
 *   ← { "type": "invoke-error", "id": <number>, "error": <string> }
 *   ← { "type": "event", "event": <string>, "payload": <any> }
 */

type EventCallback<T = unknown> = (event: { payload: T }) => void;

let ws: WebSocket | null = null;
let nextId = 1;
const pendingInvokes = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
const eventListeners = new Map<string, Set<EventCallback>>();

let connectPromise: Promise<void> | null = null;

function getBackendUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('backend');
}

function connect(url: string): Promise<void> {
  if (connectPromise) return connectPromise;

  connectPromise = new Promise<void>((resolve, reject) => {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[IPC Bridge] WebSocket connection established');
      resolve();
    };

    ws.onerror = (err) => {
      console.error('[IPC Bridge] WebSocket error', err);
      reject(new Error('WebSocket connection failed'));
    };

    ws.onclose = () => {
      console.log('[IPC Bridge] WebSocket connection closed');
      ws = null;
      connectPromise = null;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'invoke-response' || msg.type === 'invoke-error') {
          const pending = pendingInvokes.get(msg.id);
          if (pending) {
            pendingInvokes.delete(msg.id);
            if (msg.type === 'invoke-response') {
              pending.resolve(msg.result);
            } else {
              pending.reject(new Error(msg.error));
            }
          }
        } else if (msg.type === 'event') {
          const listeners = eventListeners.get(msg.event);
          if (listeners) {
            for (const cb of listeners) {
              cb({ payload: msg.payload });
            }
          }
        }
      } catch (e) {
        console.error('[IPC Bridge] Failed to parse message', e);
      }
    };
  });

  return connectPromise;
}

async function ensureConnection(): Promise<void> {
  const url = getBackendUrl();
  if (!url) throw new Error('No backend URL configured');
  if (ws && ws.readyState === WebSocket.OPEN) return;
  await connect(url);
}

/**
 * Mimics Tauri's invoke() – sends a command to the backend and awaits the response.
 */
export async function bridgeInvoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  await ensureConnection();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pendingInvokes.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    ws!.send(JSON.stringify({ type: 'invoke', id, command, args: args ?? {} }));
  });
}

/**
 * Mimics Tauri's listen() – registers a callback for backend events.
 * Returns an unlisten function.
 */
export async function bridgeListen<T = unknown>(
  event: string,
  handler: EventCallback<T>,
): Promise<() => void> {
  await ensureConnection();
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(handler as EventCallback);
  return () => {
    const set = eventListeners.get(event);
    if (set) {
      set.delete(handler as EventCallback);
      if (set.size === 0) eventListeners.delete(event);
    }
  };
}

/**
 * Returns true when the `backend` query param is present, meaning we are
 * running in a browser but should behave as if we are inside Tauri.
 */
export function hasTauriBackendParam(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('backend');
}

/**
 * Returns the backend query parameter value, or null.
 */
export function getTauriBackendUrl(): string | null {
  return getBackendUrl();
}
