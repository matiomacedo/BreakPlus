/* ==========================================================================
   notifications.js — avisos do sistema (Notification API + service worker).

   - O toast dentro da app é o aviso imediato; além dele, cada mudança de
     pedido aparece também na central de notificações do telemóvel.
   - Com a app fechada só o Web Push funciona: o servidor envia a notificação
     para as subscrições guardadas (ver server/src/push.js e o handler `push`
     em sw.js). `syncPush()` cria/renova essa subscrição.
   - No telemóvel, `new Notification()` não é permitido: é o service worker
     que mostra a notificação (por isso js/pwa.js regista o sw.js).
   - Respeita state.prefs.notifications (guardada em localStorage; ver
     js/state.js). A permissão é pedida a partir de um gesto do utilizador.
   ========================================================================== */

const Notifications = (() => {
  const supported = () => typeof window !== 'undefined' && 'Notification' in window;
  const permission = () => (supported() ? Notification.permission : 'unsupported');
  const needsPermission = () => permission() === 'default';
  const secure = () => /^https:$/.test(location.protocol)
    || ['localhost', '127.0.0.1'].includes(location.hostname);
  const pushSupported = () => supported() && secure() && 'serviceWorker' in navigator && 'PushManager' in window;

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

  /** Registo ativo para o Web Push (espera pelo SW em vez de desistir). */
  async function pushRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && registration.active) return registration;
      return await navigator.serviceWorker.ready;
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

  /* ---------- Web Push (avisos com a app fechada) ---------- */

  const toBytes = (value) => {
    const base64 = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  };
  const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  /**
   * Garante que este dispositivo está subscrito para receber avisos com a app
   * fechada. Silencioso: se o browser/servidor não der, as notificações locais
   * continuam a funcionar.
   */
  async function syncPush() {
    if (!pushSupported() || !state.prefs.notifications || permission() !== 'granted') return false;
    const registration = await pushRegistration();
    if (!registration || !registration.pushManager) return false;

    try {
      const { data } = await requestJson('/api/push/public-key');
      if (!data || !data.ok || !data.key) return false;

      let sub = await registration.pushManager.getSubscription();
      // Se as chaves do servidor mudaram (ex.: base de dados recriada), renova.
      const current = sub && sub.options && sub.options.applicationServerKey
        ? toBase64Url(new Uint8Array(sub.options.applicationServerKey))
        : null;
      if (sub && current && current !== data.key) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toBytes(data.key),
        });
      }

      const saved = await Auth.api('/api/push/subscribe', { subscription: sub.toJSON() });
      return !!(saved && saved.ok);
    } catch {
      return false;
    }
  }

  /** Cancela a subscrição deste dispositivo (avisos desligados). */
  async function stopPush() {
    if (!pushSupported()) return;
    try {
      const registration = await pushRegistration();
      const sub = registration && await registration.pushManager.getSubscription();
      if (!sub) return;
      await Auth.api('/api/push/unsubscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    } catch {
      // Sem rede: fica para a próxima sincronização.
    }
  }

  /** Texto para a linha das preferências (ecrã "Mais"). */
  function statusHint() {
    if (!state.prefs.notifications) return 'Desativados';
    if (!supported()) return 'Este dispositivo não suporta notificações';
    switch (permission()) {
      case 'granted': return 'Pedido pronto, senha chamada e anulações — mesmo com a app fechada';
      case 'denied': return 'Bloqueadas nas definições do browser';
      default: return 'Toca para permitir notificações do sistema';
    }
  }

  return { supported, permission, needsPermission, requestPermission, show, syncPush, stopPush, statusHint };
})();
