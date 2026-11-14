/* ==========================================================================
   notifications.js — avisos do sistema (Notification API + service worker).

   - O toast dentro da app continua a ser o aviso principal quando a app está
     visível. Quando está noutro separador / em segundo plano, usamos uma
     notificação do sistema para o aluno não perder o "pedido pronto".
   - No telemóvel, `new Notification()` não é permitido: é o service worker
     que mostra a notificação (por isso js/pwa.js regista o sw.js).
   - Respeita state.prefs.notifications (guardada em localStorage; ver
     js/state.js). A permissão é pedida a partir de um gesto do utilizador.
   ========================================================================== */

const Notifications = (() => {
  const supported = () => typeof window !== 'undefined' && 'Notification' in window;
  const permission = () => (supported() ? Notification.permission : 'unsupported');
  const needsPermission = () => permission() === 'default';

  /** Pede permissão (tem de ser chamado a partir de um clique/toque). */
  async function requestPermission() {
    if (!supported()) return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    try {
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  }

  /** Registo do service worker que vai mostrar a notificação. */
  async function serviceWorkerRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return null;                 // ainda não há SW: usa a API direta
      if (registration.active) return registration;
      return await navigator.serviceWorker.ready;     // SW a instalar: espera que fique ativo
    } catch {
      return null;
    }
  }

  function options({ body = '', tag = 'breakplus', data = {} } = {}) {
    const icon = new URL('icons/icon-192.png', document.baseURI).href;
    return {
      body,
      icon,
      badge: icon,
      tag,
      renotify: true,
      data: { url: './', ...data },
    };
  }

  /** Mostra uma notificação do sistema. Devolve true se foi apresentada. */
  async function show(title, details = {}) {
    if (!supported() || Notification.permission !== 'granted') return false;

    const registration = await serviceWorkerRegistration();
    if (registration) {
      try {
        await registration.showNotification(title, options(details));
        return true;
      } catch {
        // Alguns ambientes não deixam o SW mostrar: tenta a API direta.
      }
    }

    try {
      new Notification(title, options(details));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Notificação do sistema apenas quando o aluno não está a ver a app.
   * Com a app visível, o toast chega (e não duplicamos o aviso).
   */
  function notifyIfAway(title, details = {}) {
    if (!state.prefs.notifications) return false;
    // "Ausente" = noutro separador/app ou janela sem foco (dois ecrãs lado a lado).
    if (!document.hidden && document.hasFocus()) return false;
    return show(title, details);
  }

  /** Texto para a linha das preferências (ecrã "Mais"). */
  function statusHint() {
    if (!state.prefs.notifications) return 'Desativados';
    if (!supported()) return 'Este dispositivo não suporta notificações';
    switch (permission()) {
      case 'granted': return 'Pedido pronto, senha chamada, reservas e anulações';
      case 'denied': return 'Bloqueadas nas definições do browser';
      default: return 'Toca para permitir notificações do sistema';
    }
  }

  return { supported, permission, needsPermission, requestPermission, show, notifyIfAway, statusHint };
})();
