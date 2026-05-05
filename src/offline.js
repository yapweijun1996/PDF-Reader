// Offline indicator banner. Shows a thin bar under the topbar when offline.
// Pure CSS slide-down animation; respects safe-area inset.

export function initOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;

  const update = () => {
    if (navigator.onLine) {
      banner.classList.remove('offline-banner-show');
    } else {
      banner.classList.add('offline-banner-show');
    }
  };

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
