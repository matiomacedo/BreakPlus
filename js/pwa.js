/* ==========================================================================
   pwa.js — instalação no ecrã principal e arranque do service worker.

   - Regista sw.js (cache da app + notificações do sistema).
   - Guarda o evento `beforeinstallprompt` para o botão "Instalar app" no
     ecrã "Mais" (Android/Chrome). No iOS a instalação é feita pelo menu
     Partilhar → "Adicionar ao ecrã principal".
   - O service worker só é registado em http(s); em file:// a app continua a
     funcionar, mas sem cache offline nem notificações.
   ========================================================================== */

const PWA = (() => {
  let installPrompt = null;

  const supported = 'serviceWorker' in navigator;
  const canInstall = () => !!installPrompt;

  function register() {
    if (!supported || !/^https?:$/.test(location.protocol)) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(new URL('sw.js', document.baseURI), { scope: './' })
        .catch((error) => console.warn('Service worker não registado:', error));
    });
  }

  async function promptInstall() {
    if (!installPrompt) return false;
    const prompt = installPrompt;
    installPrompt = null;

    try {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      document.dispatchEvent(new Event('pwa-installable'));
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();                 // mostra o botão da app, não o banner automático
    installPrompt = event;
    document.dispatchEvent(new Event('pwa-installable'));
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    document.dispatchEvent(new Event('pwa-installable'));
  });

  register();

  return { register, canInstall, promptInstall };
})();
