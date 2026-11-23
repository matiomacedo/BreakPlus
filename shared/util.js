/* ==========================================================================
   shared/util.js — pequenas funções puras usadas pelas duas apps.
   ========================================================================== */

/* ---------- Formatação ---------- */

const eur = (value) => value.toFixed(2).replace('.', ',') + '€';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------- Pratos e pedidos ---------- */

const findItem = (id) => ITEMS.find((item) => String(item.id) === String(id)) || {
  id,
  name: 'Produto indisponível',
  price: 0,
  stock: 0,
  category: '',
  periods: [],
  image: '',
  subtitle: '',
  description: '',
  priceLabel: '',
  tag: '',
  badges: [],
};

function setMenuFromApi(products) {
  if (!Array.isArray(products)) return;

  ITEMS = products.map((product) => {
    const defaults = DEFAULT_ITEMS.get(String(product.itemId)) || {};

    return {
      ...defaults,
      id: product.itemId,
      name: product.name ?? defaults.name ?? 'Produto indisponível',
      price: Number(product.price) || 0,
      stock: Number(product.stock) || 0,
      category: product.category ?? defaults.category ?? '',
      periods: product.periods ?? defaults.periods ?? [],
      image: product.photo || defaults.image || '',
    };
  });
}

/** items = { [idDoPrato]: quantidade } */
const itemsTotal = (items) =>
  Object.entries(items).reduce((sum, [id, qty]) => sum + qty * findItem(id).price, 0);

const itemsCount = (items) => Object.values(items).reduce((sum, qty) => sum + qty, 0);

/** "2× Tosta Mista..., 1× Sumo..." */
const itemsSummary = (items) =>
  Object.entries(items).map(([id, qty]) => `${qty}× ${findItem(id).name}`).join(', ');

/* ---------- Datas e horas ---------- */

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // "2026-11-05"
const dateFromKey = (key) => new Date(key + 'T00:00:00');
const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMinutes = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** "Hoje", "Amanhã" ou "Qui 6". */
function dayLabel(date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  const text = date.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric' }).replace(/[.,]/g, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------- Reservas ---------- */

const pickupDate = (o) => new Date(`${o.pickupKey}T${o.pickupTime}:00`);
const pickupText = (o) => `${dayLabel(dateFromKey(o.pickupKey))} · ${o.pickupTime}`;

/** Pedido que já está na fila do bar (ainda não entregue nem cancelado). */
const isLive = (o) => o.status === 'received' || o.status === 'preparing' || o.status === 'ready';
/* ---------- Ações: proteger contra duplo toque ---------- */

const actionsInFlight = new Set();
/** Só deixa correr uma ação com a mesma chave de cada vez (pagar, carregar, etc.). */
function guarded(keyOf, fn) {
  return async (...args) => {
    const key = keyOf(...args);
    if (actionsInFlight.has(key)) return;
    actionsInFlight.add(key);
    try { return await fn(...args); } finally { actionsInFlight.delete(key); }
  };
}

/** Escapes untrusted values before they are interpolated into HTML templates. */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[char]);
