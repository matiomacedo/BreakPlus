/* ==========================================================================
   shared/nozoom.js — mantém as duas apps com zoom fixo (telemóvel/PWA).

   - iOS Safari: os eventos gesture* são o gesto de pinch.
   - Android/Chrome e iOS: dois dedos em touchmove = pinch.
   - Trackpad/desktop: Ctrl+scroll = zoom do browser.

   O zoom automático ao focar um input é evitado no CSS: os campos de texto
   têm font-size >= 16px (ver css/auth.css).
   ========================================================================== */

(() => {
  // Pinch no iOS Safari (não standard, mas é o que o Safari dispara).
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  }

  // Pinch no Chrome/Android e restantes browsers.
  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });

  // Ctrl+scroll (trackpad/desktop) também não deve ampliar a app.
  document.addEventListener('wheel', (event) => {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });
})();
