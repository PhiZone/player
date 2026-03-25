/**
 * Thin wrappers around Tauri filesystem / path APIs.
 *
 * When running inside Tauri, these delegate to the native plugins.
 * When running in a browser with the `backend` query param, they are
 * routed through the WebSocket IPC bridge.
 */

import { tauriInvoke } from '$lib/services/tauriIpc';

/** Check for Tauri without importing from $lib/utils to avoid circular deps. */
const isTauri = () => '__TAURI_INTERNALS__' in window;

// ── Path helpers ──────────────────────────────────────────────────────

export async function pathJoin(...parts: string[]): Promise<string> {
  if (isTauri()) {
    const { join } = await import('@tauri-apps/api/path');
    // join() takes exactly 2 args, so chain them
    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      result = await join(result, parts[i]);
    }
    return result;
  }
  // In non-Tauri (browser) mode, join path parts with forward slashes.
  // The Tauri backend already uses platform-native separators internally,
  // and the IPC bridge commands (e.g. fs_mkdir, fs_write_file) receive full
  // paths that the backend processes as-is.
  return parts.join('/');
}

export async function pathTempDir(): Promise<string> {
  if (isTauri()) {
    const { tempDir } = await import('@tauri-apps/api/path');
    return tempDir();
  }
  return tauriInvoke<string>('get_temp_dir');
}

export async function pathVideoDir(): Promise<string> {
  if (isTauri()) {
    const { videoDir } = await import('@tauri-apps/api/path');
    return videoDir();
  }
  return tauriInvoke<string>('get_video_dir');
}

// ── Filesystem operations ─────────────────────────────────────────────

export async function fsMkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  if (isTauri()) {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    return mkdir(path, options);
  }
  await tauriInvoke('fs_mkdir', { path, recursive: options?.recursive ?? false });
}

export async function fsRemove(path: string, options?: { recursive?: boolean }): Promise<void> {
  if (isTauri()) {
    const { remove } = await import('@tauri-apps/plugin-fs');
    return remove(path, options);
  }
  await tauriInvoke('fs_remove', { path, recursive: options?.recursive ?? false });
}

export async function fsWriteFile(path: string, data: Uint8Array): Promise<void> {
  if (isTauri()) {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    return writeFile(path, data);
  }
  // Convert Uint8Array to base64 for transport over JSON
  const base64 = btoa(String.fromCharCode(...data));
  await tauriInvoke('fs_write_file', { path, dataBase64: base64 });
}

// ── Window operations ─────────────────────────────────────────────────

export async function closeCurrentWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}

// ── Path separator ────────────────────────────────────────────────────

export async function pathSep(): Promise<string> {
  if (isTauri()) {
    const { sep } = await import('@tauri-apps/api/path');
    return sep();
  }
  return '/';
}
