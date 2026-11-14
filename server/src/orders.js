/* Regras de pedidos partilhadas pela app dos alunos e pelo terminal. */
const { Product, Order, User, Transaction, Setting } = require('./models');
const { inTx } = require('./db');
const { fail } = require('./http');

const LIVE = ['received', 'preparing', 'ready'];
const r2 = (n) => Math.round(n * 100) / 100;

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

/**
 * Cancela um pedido: devolve o saldo, repõe o stock e regista o reembolso.
 * `by`: 'student' | 'staff'. `check(order)` pode recusar (lançando `fail`) antes de mexer em nada.
 */
const cancelOrder = (number, by, check = () => {}) => inTx(async (session) => {
  const o = await Order.findOne({ number: +number }).session(session);
  if (!o || o.status === 'cancelled') throw fail('not_found', {}, 404);
  check(o);
  for (const [id, qty] of Object.entries(o.items)) await Product.updateOne({ itemId: +id }, { $inc: { stock: qty } }, { session });
  await User.updateOne({ _id: o.user }, { $inc: { balance: o.total } }, { session });
  await Transaction.create([{ user: o.user, kind: 'refund', amount: o.total, order: o.number }], { session });
  o.status = 'cancelled'; o.cancelledBy = by; o.cancelledAt = Date.now(); await o.save({ session });
  return o;
});

module.exports = { LIVE, r2, barSettings, queueStats, cancelOrder };
