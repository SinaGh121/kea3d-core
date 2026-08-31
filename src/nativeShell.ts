const nativeWindow = window as Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

export function isNativeShell(): boolean {
  return nativeWindow.__TAURI__ !== undefined || nativeWindow.__TAURI_INTERNALS__ !== undefined;
}

export async function resetNativeWebCache(): Promise<void> {
  if (!isNativeShell()) return;

  const [registrations, cacheNames] = await Promise.all([
    'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations() : Promise.resolve([]),
    'caches' in window ? caches.keys() : Promise.resolve([]),
  ]);
  const hadCachedWebAssets = registrations.length > 0 || cacheNames.length > 0;

  await Promise.all([
    ...registrations.map((registration) => registration.unregister()),
    ...cacheNames.map((cacheName) => caches.delete(cacheName)),
  ]);

  const resetKey = 'kea3d-native-web-cache-reset';
  if (hadCachedWebAssets && sessionStorage.getItem(resetKey) !== '1') {
    sessionStorage.setItem(resetKey, '1');
    window.location.reload();
  }
}
