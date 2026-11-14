/* ==========================================================================
   sw.js — service worker da app dos alunos (PWA).

   - Guarda a "casca" da app (HTML, CSS, JS, imagens e manifest) para abrir
     depressa e continuar a abrir sem rede.
   - Os pedidos à API nunca são guardados: os dados continuam a vir do
     servidor e a app mostra o aviso "Sem ligação" quando não consegue falar
     com ele (ver js/app.js).
   - Serve também de base para as notificações do sistema. O handler `push`
     fica pronto para Web Push, mas o envio exige um servidor de push com
     VAPID (ainda não implementado; ver README.md).

   Ao mudar ficheiros da app, sobe CACHE_VERSION para os clientes antigos
   receberem a versão nova.
   ========================================================================== */

const CACHE_VERSION = 'breakplus-v11';
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;

/* Caminhos relativos à raiz onde está o sw.js. */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './css/auth.css',
  './shared/tokens.css',
  './shared/data.js',
  './shared/util.js',
  './shared/api.js',
  './js/config.js',
  './js/auth.js',
  './js/store.js',
  './js/state.js',
  './js/ui.js',
  './js/notifications.js',
  './js/pwa.js',
  './js/app.js',
  './images/logo-break-estg.png',
  './images/logo-break-estg-dark.png',
  './images/tosta-mista-pão-rustico.png',
  './images/croissant-misto.png',
  './images/donut-glaze-chocolate.png',
  './images/sumo-laranja-natural.png',
  './images/frize.png',
  './images/cafe-nata.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const INDEX_URL = new URL('./index.html', self.location).href;
const NOTIFICATION_ICON = new URL('./icons/icon-192.png', self.location).href;
const NOTIFICATION_BADGE = new URL('./icons/icon-192.png', self.location).href;

self.addEventListener('install', (event) => {
  // "cache: reload" garante que uma versão nova da app não reaproveita ficheiros antigos do cache HTTP.
  const requests = APP_SHELL.map((path) => new Request(new URL(path, self.location), { cache: 'reload' }));
  event.waitUntil(
    caches.open(ASSET_CACHE)
      .then((cache) => cache.addAll(requests))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== ASSET_CACHE && key !== FONT_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/** Guarda uma resposta no cache quando é útil (inclui respostas opacas de fontes). */
function putInCache(cacheName, request, response) {
  if (!response || (!response.ok && response.type !== 'opaque')) return response;
  const copy = response.clone();
  caches.open(cacheName).then((cache) => cache.put(request, copy));
  return response;
}

/** Ficheiros da app: cache primeiro, rede em segundo (e atualiza em fundo). */
async function cacheFirst(request, cacheName = ASSET_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request)
      .then((response) => putInCache(cacheName, request, response))
      .catch(() => {});
    return cached;
  }
  try {
    return putInCache(cacheName, request, await fetch(request));
  } catch {
    return new Response('', { status: 504, statusText: 'Sem ligação' });
  }
}

/** Navegação: rede primeiro; sem rede, a última cópia da app. */
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    putInCache(ASSET_CACHE, INDEX_URL, response);
    return response;
  } catch {
    const cached = await caches.match(INDEX_URL, { ignoreSearch: true });
    return cached || new Response('Sem ligação', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;                       // escritas vão diretas à API

  const url = new URL(request.url);

  // Dados e sessão continuam sempre a vir da rede (a app trata da falta de ligação).
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) {
    // Fontes do Google: depois da primeira visita também ficam disponíveis offline.
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      event.respondWith(cacheFirst(request, FONT_CACHE));
    }
    return;
  }

  event.respondWith(cacheFirst(request));
});

/* ---------- Notificações ---------- */

/** Mostra uma notificação do sistema (usado também pelo Web Push, se vier a existir). */
function showNotification(payload = {}) {
  const title = payload.title || 'Break+ESTG';
  const options = {
    body: payload.body || 'O teu pedido mudou de estado.',
    icon: payload.icon || NOTIFICATION_ICON,
    badge: payload.badge || NOTIFICATION_BADGE,
    tag: payload.tag || 'breakplus',
    renotify: true,
    data: { url: payload.url || './', ...(payload.data || {}) },
  };
  return self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* payload em texto simples */ }
  if (!payload.title && event.data) {
    try { payload.body = event.data.text(); } catch { /* sem corpo */ }
  }
  event.waitUntil(showNotification(payload));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === new URL(target).origin);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});
