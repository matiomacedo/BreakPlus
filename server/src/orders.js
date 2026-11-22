/* Regras de pedidos partilhadas pela app dos alunos e pelo terminal. */
const mongoose = require('mongoose');
const { Product, Order, User, Transaction, Setting } = require('./models');
const { inTx } = require('./db');
const { fail } = require('./http');

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

/** Número a mostrar (senha do dia; os pedidos antigos, sem senha, mostram o número sequencial). */
const ticketOf = (o) => o.ticket ?? o.number;

/** "Mais pedido": os produtos com mais unidades pedidas nos últimos `days` dias (pedidos cancelados não contam).
    Com menos de `minUnits` unidades no total não há dados suficientes e não se destaca nenhum. */
const POPULAR = { days: 7, top: 2, minUnits: 3 };
async function popularItems(now = Date.now()) {
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
  await User.updateOne({ _id: o.user }, { $inc: { balance: o.total } }, { session });
  await Transaction.create([{ user: o.user, kind: 'refund', amount: o.total, order: o.number, ticket: o.ticket }], { session });
  o.status = 'cancelled'; o.cancelledBy = by; o.cancelledByName = name; o.cancelledAt = Date.now();
  if (by === 'staff') o.actions.push({ action: 'cancelled', by: name, at: o.cancelledAt });
  await o.save({ session });
  return o;
});

module.exports = { LIVE, r2, USER_FIELDS, currentCustomer, barSettings, queueStats, popularItems, findOrder, ticketOf, cancelOrder };
