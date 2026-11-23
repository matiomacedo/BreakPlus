/* Regras de pedidos partilhadas pela app dos alunos e pelo terminal. */
const mongoose = require('mongoose');
const { Product, Order, User, Transaction, Setting, Slot } = require('./models');
const { inTx } = require('./db');
const { fail } = require('./http');
const { lisbonDateKey } = require('./time');

const LIVE = ['received', 'preparing', 'ready'];
const r2 = (n) => Math.round(n * 100) / 100;

/** Campos do utilizador usados para mostrar quem fez o pedido. */
const USER_FIELDS = 'name roleLabel';

/** Nome/função atuais do utilizador; a cópia no pedido é o fallback se a conta já não existir. */
function currentCustomer(o) {
  const u = o.user && typeof o.user === 'object' && o.user.name ? o.user : null;
  return u ? { customer: u.name, role: u.roleLabel } : { customer: o.customer, role: o.role };
}

/** Definições do bar (pausa + contador de senhas). Cria-as se ainda não existirem (ex.: sem seed). */
const barSettings = (update = {}, session = null) =>
  Setting.findOneAndUpdate({ _id: 'bar' }, update, { upsert: true, new: true, setDefaultsOnInsert: true, session });

/** Tamanho da fila global e tempo médio de preparação (para o tempo de espera e o terminal). */
async function queueStats() {
  const [queueSize, recent] = await Promise.all([
    Order.countDocuments({ type: 'now', status: { $in: LIVE } }),
    Order.find({ readyAt: { $ne: null }, queuedAt: { $ne: null } }).sort({ readyAt: -1 }).limit(20).select('readyAt queuedAt'),
  ]);
  const avgPrepSec = recent.length ? Math.round(recent.reduce((a, o) => a + (o.readyAt - o.queuedAt), 0) / recent.length / 1000) : null;
  return { queueSize, avgPrepSec };
}

/** Pedido pelo identificador único (_id). Id mal formado → null (como um pedido que não existe). */
const findOrder = (id, session = null) => (mongoose.isValidObjectId(id) ? Order.findById(id).session(session) : Promise.resolve(null));

/** Registo das ações do bar num pedido: guarda só as últimas MAX_ACTIONS (ex.: chamar a senha muitas vezes). */
const MAX_ACTIONS = 50;
const pushAction = (entry) => ({ actions: { $each: [entry], $slice: -MAX_ACTIONS } });

/** Número a mostrar (senha do dia; os pedidos antigos, sem senha, mostram o número sequencial). */
const ticketOf = (o) => o.ticket ?? o.number;

/** Pedido para a app do aluno: id do utilizador como valor simples + `mine` + nome/função atuais. */
const orderOut = (o, uid) => {
  const obj = o.toObject();
  const userId = obj.user && obj.user._id ? obj.user._id : obj.user;
  return { ...obj, user: userId, mine: String(userId) === String(uid), ...currentCustomer(o) };
};

/** Número único e senha do dia (Lisboa), alocados dentro da transação do pedido/levantamento. */
async function nextOrderTicket(session) {
  const today = lisbonDateKey();
  const set = await barSettings({ $inc: { lastNumber: 1 } }, session);
  const ticket = set.ticketDay === today ? set.lastTicket + 1 : 1;
  await barSettings({ ticketDay: today, lastTicket: ticket }, session);
  return { number: set.lastNumber, ticket, ticketDay: today };
}

/** "Mais pedido": os produtos com mais unidades pedidas nos últimos `days` dias (pedidos cancelados não contam).
    Com menos de `minUnits` unidades no total não há dados suficientes e não se destaca nenhum. */
const POPULAR = { days: 7, top: 2, minUnits: 3 };
/* Cache curta: o /state é pedido por todos os alunos a cada mudança; um pedido novo ou cancelado limpa-a. */
const POPULAR_TTL_MS = 30000;
let popularCache = null;                                   // { at, ids }
const clearPopularCache = () => { popularCache = null; };

async function popularItems(now = Date.now()) {
  if (popularCache && now - popularCache.at < POPULAR_TTL_MS) return popularCache.ids;
  const ids = await computePopular(now);
  popularCache = { at: now, ids };
  return ids;
}

async function computePopular(now) {
  const rows = await Order.aggregate([
    { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: new Date(now - POPULAR.days * 86400000) } } },
    { $project: { items: { $objectToArray: '$items' } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.k', qty: { $sum: '$items.v' } } },
  ]);
  if (rows.reduce((sum, r) => sum + r.qty, 0) < POPULAR.minUnits) return [];
  return rows.map((r) => ({ id: +r._id, qty: r.qty }))
    .sort((a, b) => b.qty - a.qty || a.id - b.id)
    .slice(0, POPULAR.top).map((r) => r.id);
}

/**
 * Cancela um pedido: devolve o saldo, repõe o stock e regista o reembolso.
 * `by`: 'student' | 'staff'; `name`: quem anulou. `check(order)` pode recusar (lançando `fail`) antes de mexer em nada.
 */
const cancelOrder = (id, { by, name }, check = () => {}) => inTx(async (session) => {
  const o = await findOrder(id, session);
  if (!o || o.status === 'cancelled') throw fail('not_found', {}, 404);
  check(o);
  for (const [id, qty] of Object.entries(o.items)) await Product.updateOne({ itemId: +id }, { $inc: { stock: qty } }, { session });
  if (o.type === 'reservation') {                            // liberta o lugar na hora de levantamento
    await Slot.updateOne({ key: o.pickupKey, time: o.pickupTime, count: { $gt: 0 } }, { $inc: { count: -1 } }, { session });
  }
  // Um pedido de oferta custou 0 € ao destinatário: não há saldo a devolver nem movimento falso.
  if (o.total > 0) {
    await User.updateOne({ _id: o.user }, { $inc: { balance: o.total } }, { session });
    await Transaction.create([{ user: o.user, kind: 'refund', amount: o.total, order: o.number, ticket: o.ticket }], { session });
  }
  clearPopularCache();
  o.status = 'cancelled'; o.cancelledBy = by; o.cancelledByName = name; o.cancelledAt = Date.now();
  if (by === 'staff') { o.actions.push({ action: 'cancelled', by: name, at: o.cancelledAt }); o.actions.splice(0, o.actions.length - MAX_ACTIONS); }
  await o.save({ session });
  return o;
});

module.exports = { LIVE, r2, USER_FIELDS, currentCustomer, barSettings, queueStats, popularItems, clearPopularCache, findOrder, pushAction, ticketOf, orderOut, nextOrderTicket, cancelOrder };
