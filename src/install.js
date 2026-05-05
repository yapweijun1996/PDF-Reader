// Custom PWA install prompt.
// - Captures `beforeinstallprompt`, shows our own button in the topbar.
// - Hides the button if the user is already in standalone mode or
//   has previously dismissed the prompt this session.
// - Listens for `appinstalled` to clean up.

const DISMISSED_KEY = 'pdfReader.installDismissed';

let deferredPrompt = null;

export function initInstallPrompt(buttonEl) {
  if (!buttonEl) return;
  buttonEl.hidden = true;

  if (isStandalone()) return;
  if (sessionStorage.getItem(DISMISSED_KEY)) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    buttonEl.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    buttonEl.hidden = true;
  });

  buttonEl.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'dismissed') {
        sessionStorage.setItem(DISMISSED_KEY, '1');
      }
    } finally {
      deferredPrompt = null;
      buttonEl.hidden = true;
    }
  });
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}
