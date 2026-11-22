/* Rotas do terminal do bar (montadas em /api/terminal). Exigem sessão de uma funcionária
   (papel "staff", mesmo login em 2 passos da app). Cada ação fica registada com o nome dela. */
const express = require('express');
const { Product, Order } = require('./models');
const { fail, wrap } = require('./http');
const { barSettings, queueStats, cancelOrder, USER_FIELDS, currentCustomer } = require('./orders');
const push = require('./push');
const { staffAuth } = require('./auth');
const realtime = require('./realtime');

const NEXT = { received: 'preparing', preparing: 'ready', ready: 'done' };

/** Pedido para o terminal: sem o id do utilizador; nome/função vêm da conta atual (com fallback histórico). */
const terminalOrder = (o) => {
  const { user, ...rest } = o.toObject();
  return { ...rest, ...currentCustomer(o) };
};

/** Inteiro finito (aceita "3" vindo do JSON, recusa 1.5, "abc", null, Infinity). */
const toInt = (v) => (v !== null && v !== '' && Number.isInteger(+v) ? +v : null);

function terminalRouter() {
  const r = express.Router();

  r.use(staffAuth);

  // Estado do bar: todos os pedidos, stock, pausa e fila (sem carteiras nem dados de utilizadores)
  r.get('/state', wrap(async (_req, res) => {
    const [products, set, orders, stats] = await Promise.all([
      Product.find(), barSettings(),
      Order.find().sort({ number: -1 }).limit(200).populate('user', USER_FIELDS),
      queueStats(),
    ]);
    res.json({
      stock: Object.fromEntries(products.map((p) => [p.itemId, p.stock])),
      paused: set.paused, ...stats,
      orders: orders.map(terminalOrder),
    });
  }));

  r.post('/orders/:n/status', wrap(async (req, res) => {
    const o = await Order.findOne({ number: +req.params.n });
    if (!o || o.status === 'cancelled') throw fail('not_found', {}, 404);
    const status = req.body.status || NEXT[o.status];
    if (!['received', 'preparing', 'ready', 'done'].includes(status)) throw fail('bad_status');
    const prev = o.status, now = Date.now();
    o.status = status;
    if (status === 'preparing' && prev === 'reserved') o.queuedAt = now;      // reserva entra na fila
    if (status === 'ready') { o.readyAt = now; o.notifiedAt = now; } else if (status !== 'done') o.readyAt = undefined;
    if (status === 'done') o.doneAt = now;
    o.actions.push({ action: status, by: req.user.name, at: now });
    await o.save();
    realtime.orderChanged(o.user);
    // Aviso imediato ao aluno (chega mesmo com a app fechada).
    if (status === 'ready' && prev !== 'ready') {
      push.notifyUser(o.user, {
        title: `Pedido #${o.number} pronto!`,
        body: 'Levanta no balcão e mostra a senha.',
        tag: `bp-order-${o.number}-ready`,
      });
    }
    await o.populate('user', USER_FIELDS);
    res.json({ ok: true, order: terminalOrder(o) });
  }));

  r.post('/orders/:n/notify', wrap(async (req, res) => {
    const now = Date.now();
    const o = await Order.findOneAndUpdate({ number: +req.params.n },
      { notifiedAt: now, $push: { actions: { action: 'notified', by: req.user.name, at: now } } }, { new: true })
      .populate('user', USER_FIELDS);
    if (o) realtime.orderChanged(o.user);
    if (o && o.status !== 'cancelled') {
      push.notifyUser(o.user && o.user._id ? o.user._id : o.user, {
        title: `Senha #${o.number} chamada`,
        body: 'Dirige-te ao balcão do bar.',
        tag: `bp-order-${o.number}-call`,
      });
    }
    res.json({ ok: !!o, order: o && terminalOrder(o) });
  }));

  // O bar pode anular qualquer pedido (mesmo entregue): reembolsa e repõe stock
  r.post('/orders/:n/cancel', wrap(async (req, res) => {
    const o = await cancelOrder(req.params.n, { by: 'staff', name: req.user.name });
    realtime.orderChanged(o.user);
    push.notifyUser(o.user, {
      title: `Pedido #${o.number} cancelado`,
      body: 'O valor foi devolvido ao teu saldo.',
      tag: `bp-order-${o.number}-cancel`,
    });
    await o.populate('user', USER_FIELDS);
    res.json({ ok: true, order: terminalOrder(o) });
  }));

  // { delta: ±n } soma ao stock; { set: n } define-o. Ambos têm de ser inteiros (set ≥ 0).
  r.post('/stock/:id', wrap(async (req, res) => {
    const { delta, set } = req.body;
    let p;
    if (set !== undefined) {
      const n = toInt(set);
      if (n === null || n < 0) throw fail('bad_stock');
      p = await Product.findOneAndUpdate({ itemId: +req.params.id }, { stock: n }, { new: true });
    } else {
      const n = toInt(delta);
      if (n === null) throw fail('bad_stock');
      p = await Product.findOneAndUpdate({ itemId: +req.params.id, stock: { $gte: -n } }, { $inc: { stock: n } }, { new: true });
    }
    if (!p) throw fail('stock');
    realtime.barChanged('stock');
    res.json({ ok: true, stock: p.stock });
  }));

  r.post('/paused', wrap(async (req, res) => {
    const s = await barSettings({ paused: !!req.body.paused });
    realtime.barChanged('paused');
    res.json({ ok: true, paused: s.paused });
  }));

  return r;
}

module.exports = { terminalRouter };
