const nativeWindow = window as Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

export function isNativeShell(): boolean {
  return nativeWindow.__TAURI__ !== undefined || nativeWindow.__TAURI_INTERNALS__ !== undefined;
}
