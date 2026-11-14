/* ==========================================================================
   state.js — estado da app dos alunos e funções que só leem/calculam
   (sem tocar no DOM).

   O que é partilhado com o terminal (pedidos, saldo, stock, pausa) vive em
   js/store.js (servidor). Aqui fica só o que é desta app: vista atual, filtros,
   carrinho e preferências.
   ========================================================================== */

/* Preferências guardadas no dispositivo: mantêm-se depois de recarregar. */
const PREFS_KEY = 'bp_prefs_student';
const DEFAULT_PREFS = { vegetarian: false, glutenFree: false, lactoseFree: false, notifications: true };

function loadPrefs() {
  const prefs = { ...DEFAULT_PREFS };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    for (const key of Object.keys(DEFAULT_PREFS)) {
      if (typeof saved[key] === 'boolean') prefs[key] = saved[key];
    }
  } catch { /* localStorage indisponível: usa os valores por omissão */ }
  return prefs;
}

function persistPrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* sem armazenamento */ }
}

const state = {
  view: 'bar',              // 'bar' | 'orders' | 'wallet' | 'more'

  // Filtros do menu
  category: 'Todos',
  period: 'Todos',

  // Carrinho: { [idDoPrato]: quantidade }
  cart: {},

  // Como vai ser o pedido: na hora ('now') ou reserva ('reserve') + dia/hora escolhidos
  checkout: { mode: 'now', day: null, time: null },

  topupAmount: 10,

  // Preferências (ecrã "Mais"), persistidas em localStorage
  prefs: loadPrefs(),
};

/* O aluno que está com sessão iniciada nesta app */
const ME = { customer: 'Gonçalo Silva', role: 'Estudante' };

/* ---------- Dados partilhados (lidos da store) ---------- */

const db = () => Store.get();
const balance = () => db().wallet.balance;
const stockOf = (id) => db().stock[id] ?? 0;
const isPaused = () => db().paused;

/* ---------- Menu e carrinho ---------- */

function visibleItems() {
  return ITEMS.filter((item) =>
    (state.category === 'Todos' || item.category === state.category) &&
    (state.period === 'Todos' || item.periods.includes(state.period))
  );
}

/** Filtros ativos (para o contador e o texto por baixo de "N produtos"). */
const activeFilters = () => [state.period, state.category].filter((f) => f !== 'Todos');

const cartCount = () => itemsCount(state.cart);
const cartTotal = () => itemsTotal(state.cart);
const inCart = (id) => state.cart[id] || 0;

/** Quantas unidades ainda se podem juntar ao carrinho (stock − o que já lá está). */
const canAddMore = (id) => stockOf(id) - inCart(id);

/* ---------- Os meus pedidos ---------- */

const myOrders = () => db().orders.filter((o) => o.mine);

/** Pedidos na hora que ainda estão na fila do bar (o mais recente primeiro). */
const liveOrders = () => myOrders().filter((o) => o.type === 'now' && isLive(o)).sort((a, b) => b.number - a.number);

/** Reservas por levantar, pela hora de levantamento. */
const activeReservations = () => myOrders()
  .filter((o) => o.type === 'reservation' && (o.status === 'reserved' || isLive(o)))
  .sort((a, b) => pickupDate(a) - pickupDate(b));

/** Já terminados (entregues ou cancelados). */
const historyOrders = () => myOrders()
  .filter((o) => o.status === 'done' || o.status === 'cancelled')
  .sort((a, b) => b.number - a.number);

/** Só dá para cancelar reservas que o bar ainda não começou, e até X min antes. */
const canCancel = (o) =>
  o.status === 'reserved' && pickupDate(o) - new Date() >= RESERVATION.cancelBeforeMin * 60000;

/** Texto do estado na fila, para o aluno. */
const STATUS_TEXT = {
  reserved:  'Reservado',
  received:  'Recebido',
  preparing: 'A preparar',
  ready:     'Pronto para levantar',
  done:      'Entregue',
  cancelled: 'Cancelado',
};

/* ---------- Horários das reservas ---------- */

/** Demonstração: alguns horários aparecem "esgotados" (em produção viria do servidor). */
function isSlotFull(key, time) {
  const hash = [...(key + time)].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return hash % 6 === 0;
}

/** Horários de um dia: [{ time: '12:30', full: false }, ...] */
function slotsFor(date) {
  const now = new Date();
  const isToday = dateKey(date) === dateKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Hoje só se reserva até à hora definida em RESERVATION.todayUntil (18:00).
  const lastMin = isToday ? toMinutes(RESERVATION.todayUntil) + 1 : toMinutes(BAR.close);
  const slots = [];
  for (let m = toMinutes(BAR.open); m < lastMin; m += RESERVATION.stepMin) {
    if (isToday && m < nowMin + RESERVATION.minLeadMin) continue;
    const time = fromMinutes(m);
    slots.push({ time, full: isSlotFull(dateKey(date), time) });
  }
  return slots;
}

/** As reservas são só para o dia de hoje (nunca para dias seguintes). */
function reservationDays() {
  const today = new Date();
  if (!slotsFor(today).some((s) => !s.full)) return [];
  return [{ key: dateKey(today), label: dayLabel(today) }];
}

/** Garante que o dia/hora escolhidos ainda são válidos (o tempo passa). */
function ensureCheckoutDay() {
  const c = state.checkout;
  const days = reservationDays();
  if (!days.some((d) => d.key === c.day)) { c.day = days[0] ? days[0].key : null; c.time = null; }
  if (c.time && !(c.day && slotsFor(dateFromKey(c.day)).some((s) => s.time === c.time && !s.full))) c.time = null;
  return days;
}
