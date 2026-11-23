/* Rotas do terminal do bar (montadas em /api/terminal). Exigem sessão de uma funcionária
   (papel "staff", mesmo login em 2 passos da app). Cada ação fica registada com o nome dela. */
const express = require('express');
const { Product, Order } = require('./models');
const { fail, wrap } = require('./http');
const { barSettings, queueStats, findOrder, pushAction, ticketOf, cancelOrder, USER_FIELDS, currentCustomer } = require('./orders');
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

  r.post('/orders/:id/status', wrap(async (req, res) => {
    const o = await findOrder(req.params.id);
    if (!o || o.status === 'cancelled') throw fail('not_found', {}, 404);
    const status = req.body.status || NEXT[o.status];
    if (!['received', 'preparing', 'ready', 'done'].includes(status)) throw fail('bad_status');
    const prev = o.status, now = Date.now();
    const set = { status }, unset = {};
    if (status === 'preparing' && prev === 'reserved') set.queuedAt = now;    // reserva entra na fila
    if (status === 'ready') { set.readyAt = now; set.notifiedAt = now; } else if (status !== 'done') unset.readyAt = 1;
    if (status === 'done') set.doneAt = now;
    // Só muda se o estado ainda for o que se leu: um cancelamento ao mesmo tempo (já reembolsado) nunca é desfeito.
    const updated = await Order.findOneAndUpdate({ _id: o._id, status: prev },
      { $set: set, $unset: unset, $push: pushAction({ action: status, by: req.user.name, at: now }) }, { new: true });
    if (!updated) throw fail('conflict', {}, 409);
    realtime.orderChanged(updated.user);
    // Aviso imediato ao aluno (chega mesmo com a app fechada).
    if (status === 'ready' && prev !== 'ready') {
      push.notifyUser(updated.user, {
        title: updated.giftFromName
          ? `Café oferecido por ${updated.giftFromName} pronto!`
          : `Pedido #${ticketOf(updated)} pronto!`,
        body: 'Levanta no balcão e mostra a senha.',
        tag: `bp-order-${updated.number}-ready`,
      });
    }
    await updated.populate('user', USER_FIELDS);
    res.json({ ok: true, order: terminalOrder(updated) });
  }));

  r.post('/orders/:id/notify', wrap(async (req, res) => {
    const now = Date.now();
    const found = await findOrder(req.params.id);
    // Atómico e nunca num pedido cancelado (não se chama a senha de um pedido já reembolsado).
    const o = found && await Order.findOneAndUpdate({ _id: found._id, status: { $ne: 'cancelled' } },
      { notifiedAt: now, $push: pushAction({ action: 'notified', by: req.user.name, at: now }) }, { new: true });
    if (!o) throw fail('not_found', {}, 404);
    realtime.orderChanged(o.user, { shared: false });   // chamar a senha não muda nada para os outros
    push.notifyUser(o.user, {
      title: `Senha #${ticketOf(o)} chamada`,
      body: 'Dirige-te ao balcão do bar.',
      tag: `bp-order-${o.number}-call`,
    });
    await o.populate('user', USER_FIELDS);
    res.json({ ok: true, order: terminalOrder(o) });
  }));

  // O bar pode anular qualquer pedido (mesmo entregue): reembolsa e repõe stock
  r.post('/orders/:id/cancel', wrap(async (req, res) => {
    const o = await cancelOrder(req.params.id, { by: 'staff', name: req.user.name });
    realtime.orderChanged(o.user);
    push.notifyUser(o.user, {
      title: `Pedido #${ticketOf(o)} cancelado`,
      body: o.giftCode ? 'O bar anulou este café oferecido.' : 'O valor foi devolvido ao teu saldo.',
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
