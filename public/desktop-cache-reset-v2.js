/* global caches, navigator, sessionStorage, window */

(() => {
  const nativeShell = window.__TAURI__ !== undefined || window.__TAURI_INTERNALS__ !== undefined;
  if (!nativeShell || !('serviceWorker' in navigator) || !('caches' in window)) return;

  const resetKey = 'kea3d-native-cache-reset-v2';
  Promise.all([navigator.serviceWorker.getRegistrations(), caches.keys()])
    .then(([registrations, cacheNames]) => {
      const hasStaleWebAssets = registrations.length > 0 || cacheNames.length > 0;
      return Promise.all([
        ...registrations.map((registration) => registration.unregister()),
        ...cacheNames.map((cacheName) => caches.delete(cacheName)),
      ]).then(() => hasStaleWebAssets);
    })
    .then((hasStaleWebAssets) => {
      if (!hasStaleWebAssets || sessionStorage.getItem(resetKey) === '1') return;
      sessionStorage.setItem(resetKey, '1');
      window.location.reload();
    })
    .catch(() => {
      // A cache reset must never prevent the local viewer from starting.
    });
})();
