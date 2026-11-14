/* ==========================================================================
   shared/api.js — ligação ao servidor, comum às duas apps.

   - requestJson(path, { body, headers }) → { status, data }: fetch à API.
   - createStore({ request, statePath, actions, onConnection }): cópia local do
     estado (atualizada de 2,5 em 2,5 s) com as leituras que as vistas usam.

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
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { return { status: 0, data: { ok: false, reason: 'network' } }; }
  const data = await res.json().catch(() => ({ ok: false, reason: 'server' }));
  return { status: res.status, data };
}

/**
 * request(path, body?) → resposta JSON do servidor
 * actions({ post, withOrder }) → ações de escrita desta app (ficam no objeto devolvido)
 * onConnection(ok, reason) → chamado a cada atualização (para mostrar erros de ligação)
 * cacheKey → opcional: guarda a última resposta em localStorage para abrir sem rede
 */
function createStore({ request, statePath, actions, onConnection = () => {}, cacheKey = null }) {
  const whenText = (ts) => {
    const d = new Date(ts), t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === new Date().toDateString() ? `Hoje · ${t}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${t}`;
  };
  const TX_LABEL = { topup: () => 'Carregamento de saldo', refund: (t) => `Reembolso · pedido #${t.order}`, order: (t) => `Pedido #${t.order}` };

  const normOrder = (o) => ({ ...o, when: whenText(o.createdAt), notifiedAt: o.notifiedAt || 0 });
  const normWallet = (w) => ({ balance: w.balance, transactions: w.transactions.map((t) => ({ label: TX_LABEL[t.kind](t), when: whenText(t.createdAt), value: t.amount })) });
  const emptyState = () => ({ stock: {}, paused: false, queueSize: 0, avgPrepSec: null, wallet: { balance: 0, transactions: [] }, orders: [] });
  const hydrate = (r) => ({
    ...r,
    orders: Array.isArray(r.orders) ? r.orders.map(normOrder) : [],
    wallet: r.wallet ? normWallet(r.wallet) : emptyState().wallet,
  });

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

    /* arranque: carrega o estado e passa a atualizar de 2,5 em 2,5 s */
    async start() {
      await refresh();
      setInterval(refresh, 2500);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    },
    refresh,

    /* escrita (assíncrona: devolve o resultado do servidor) */
    ...actions({ post, withOrder }),
  };
}
