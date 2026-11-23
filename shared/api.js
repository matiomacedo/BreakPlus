/* ==========================================================================
   shared/api.js — ligação ao servidor, comum às duas apps.

   - requestJson(path, { body, headers }) → { status, data }: fetch à API.
   - createStore({ request, statePath, actions, onConnection, socketAuth }): cópia
     local do estado com as leituras que as vistas usam. Atualiza quando o
     servidor avisa por Socket.IO; sem ligação em tempo real, de 2,5 em 2,5 s.

   Cada app injeta o seu `request` (o aluno com o token de sessão, o terminal
   com a chave do terminal) e as suas ações de escrita:
   ver js/store.js e terminal/js/store.js. Antes do primeiro desenho: await Store.start().
   ========================================================================== */

/* Endereço da API: BREAKPLUS_CONFIG.apiUrl (js/config.js ou terminal/config.js); por omissão,
   o mesmo computador que serve a página, na porta 3000. */
const API_URL = (window.BREAKPLUS_CONFIG || {}).apiUrl || `${location.protocol}//${location.hostname}:3000`;

/** fetch JSON à API. Sem rede → { status: 0, data: { ok: false, reason: 'network' } }. */
async function requestJson(path, { body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',                       // sessão e dados nunca vêm da cache HTTP
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { return { status: 0, data: { ok: false, reason: 'network' } }; }
  const data = await res.json().catch(() => ({ ok: false, reason: 'server' }));
  return { status: res.status, data };
}

/* ---------- Catálogo: o que a API devolve é a fonte verdadeira ---------- */

/** Produto da BD → objeto que as duas apps sabem desenhar. Campos ausentes ficam vazios
    (o placeholder das vistas entra em ação); não se inventam dados locais aqui. */
function normalizeProduct(p) {
  const price = Number(p.price);
  const photo = String(p.photo || p.image || '').trim();
  return {
    ...p,
    id: p.itemId ?? p.id,
    itemId: p.itemId ?? p.id,
    name: p.name || 'Produto',
    price: Number.isFinite(price) ? price : 0,
    category: p.category || '',
    periods: Array.isArray(p.periods) ? p.periods : [],
    photo,
    image: photo,
    subtitle: p.subtitle || '',
    description: p.description || '',
    priceLabel: p.priceLabel || '',
    meta: p.meta || '',
    tag: p.tag || '',
    tagStyle: p.tagStyle || '',
    badges: Array.isArray(p.badges) ? p.badges : [],
    dietary: Array.isArray(p.dietary) ? p.dietary : [],
  };
}

/** Só é chamado quando a resposta (ou a cache) traz `products`: uma lista vazia
    também é válida e não deve fazer a app recorrer ao catálogo antigo. */
function setProducts(products) {
  window.BREAKPLUS_PRODUCTS = Array.isArray(products) ? products.map(normalizeProduct) : null;
}

/**
 * request(path, body?) → resposta JSON do servidor
 * actions({ request, post, withOrder }) → ações de escrita desta app (ficam no objeto devolvido)
 * onConnection(ok, reason) → chamado a cada atualização (para mostrar erros de ligação)
 * cacheKey → opcional: guarda a última resposta em localStorage para abrir sem rede
 * socketAuth() → credenciais do Socket.IO ({ token }); sem isto, só polling
 */
function createStore({ request, statePath, actions, onConnection = () => {}, cacheKey = null, socketAuth = null }) {
  const whenText = (ts) => {
    const d = new Date(ts), t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === new Date().toDateString() ? `Hoje · ${t}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${t}`;
  };
  const TX_LABEL = {
    topup: () => 'Carregamento de saldo',
    refund: (t) => `Reembolso · pedido #${t.ticket ?? t.order}`,
    order: (t) => `Pedido #${t.ticket ?? t.order}`,
    gift: (t) => `Café oferecido a ${t.giftName || 'um colega'}`,
    gift_refund: () => 'Reembolso · café não levantado',
  };

  // ticket: senha do dia (os pedidos antigos, sem senha, mostram o número sequencial)
  const normOrder = (o) => ({ ...o, ticket: o.ticket ?? o.number, when: whenText(o.createdAt), notifiedAt: o.notifiedAt || 0 });
  const normGift = (g) => ({ ...g, when: whenText(g.createdAt) });
  const normWallet = (w) => ({ balance: w.balance, transactions: w.transactions.map((t) => ({
    label: (TX_LABEL[t.kind] || (() => 'Movimento de saldo'))(t), when: whenText(t.createdAt), value: t.amount,
  })) });
  const emptyState = () => ({
    stock: {}, paused: false, queueSize: 0, avgPrepSec: null,
    products: [], wallet: { balance: 0, transactions: [] }, orders: [],
    gifts: { received: [], sent: [] },
  });
  const hydrate = (r) => {
    if (Array.isArray(r.products)) setProducts(r.products);   // API/Atlas manda no catálogo
    return {
      ...r,
      products: Array.isArray(r.products) ? r.products.map(normalizeProduct) : [],
      orders: Array.isArray(r.orders) ? r.orders.map(normOrder) : [],
      wallet: r.wallet ? normWallet(r.wallet) : emptyState().wallet,
      gifts: {
        received: Array.isArray(r.gifts?.received) ? r.gifts.received.map(normGift) : [],
        sent: Array.isArray(r.gifts?.sent) ? r.gifts.sent.map(normGift) : [],
      },
    };
  };

  /** Última resposta boa (para a app abrir com dados quando não há rede). */
  function readCache() {
    if (!cacheKey) return null;
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey));
      return saved && saved.stock ? saved : null;
    } catch { return null; }
  }

  function writeCache(raw) {
    if (!cacheKey) return;
    try { localStorage.setItem(cacheKey, JSON.stringify(raw)); } catch { /* cache cheio ou indisponível */ }
  }

  const cached = readCache();
  let data = cached ? hydrate(cached) : emptyState();
  let signature = cached ? JSON.stringify(cached) : '';
  const subscribers = new Set();
  const LIVE = ['received', 'preparing', 'ready'];
  let started = false;

  async function refresh() {
    const r = await request(statePath);
    onConnection(!!r.stock, r.reason);
    if (!r.stock) return;                                   // erro de rede/sessão: mantém o que há
    const sig = JSON.stringify(r);
    if (sig === signature) return;
    signature = sig;
    data = hydrate(r);
    writeCache(r);
    subscribers.forEach((fn) => fn());
  }

  /* Socket.IO: o cliente vem do próprio servidor da API. Se não carregar (sem rede), fica o polling. */
  let live = false;
  function connectLive() {
    if (!socketAuth) return;
    const script = document.createElement('script');
    script.src = API_URL + '/socket.io/socket.io.js';
    script.onload = () => {
      const socket = io(API_URL, { auth: (cb) => cb(socketAuth()) });
      socket.on('connect', () => { live = true; refresh(); });     // apanha o que mudou enquanto estava desligado
      socket.on('disconnect', () => { live = false; });
      socket.on('connect_error', () => { live = false; });
      socket.on('changed', () => refresh());
    };
    document.head.appendChild(script);
  }

  const post = async (path, body) => { const r = await request(path, body); await refresh(); return r; };
  const withOrder = (r) => (r.order ? { ...r, order: normOrder(r.order) } : r);

  return {
    /* leitura (síncrona, sobre a cópia local) */
    get: () => data,
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
    queue: () => data.orders.filter((o) => LIVE.includes(o.status)).sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0)),
    reservations: () => data.orders.filter((o) => o.status === 'reserved').sort((a, b) => a.pickupAt - b.pickupAt),
    history: (n) => data.orders.filter((o) => o.status === 'done' || o.status === 'cancelled')
      .sort((a, b) => (b.doneAt || b.cancelledAt || 0) - (a.doneAt || a.cancelledAt || 0)).slice(0, n),
    avgPrepSeconds: () => data.avgPrepSec,
    waitText() {
      if (!data.queueSize) return 'sem espera';
      const per = data.avgPrepSec ? data.avgPrepSec / 60 : 4;
      return `~${Math.max(1, Math.round(data.queueSize * per))} min`;
    },

    /* arranque: carrega o estado e passa a atualizar com os avisos do servidor
       (polling de 2,5 em 2,5 s só enquanto não houver ligação em tempo real) */
    async start() {
      await refresh();
      if (started) return;                     // um só temporizador e uma só ligação em tempo real
      started = true;
      setInterval(() => { if (!live) refresh(); }, 2500);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
      connectLive();
    },
    refresh,

    /* escrita (assíncrona: devolve o resultado do servidor) */
    ...actions({ request, post, withOrder }),
  };
}
