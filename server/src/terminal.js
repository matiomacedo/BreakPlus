/* Rotas do terminal do bar (montadas em /api/terminal). Sem login: cada pedido traz a chave
   partilhada TERMINAL_KEY no cabeçalho X-Terminal-Key (configurada em terminal/config.js). */
const crypto = require('crypto');
const express = require('express');
const { Product, Order } = require('./models');
const { fail, wrap } = require('./http');
const { barSettings, queueStats, cancelOrder, USER_FIELDS, currentCustomer } = require('./orders');

const NEXT = { received: 'preparing', preparing: 'ready', ready: 'done' };

/** Pedido para o terminal: sem o id do utilizador; nome/função vêm da conta atual (com fallback histórico). */
const terminalOrder = (o) => {
  const { user, ...rest } = o.toObject();
  return { ...rest, ...currentCustomer(o) };
};

/** Compara em tempo constante (o hash iguala os tamanhos). */
const sameKey = (a, b) => {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

/** Inteiro finito (aceita "3" vindo do JSON, recusa 1.5, "abc", null, Infinity). */
const toInt = (v) => (v !== null && v !== '' && Number.isInteger(+v) ? +v : null);

function terminalRouter({ terminalKey }) {
  const r = express.Router();

  r.use((req, res, next) => {
    if (sameKey(req.get('X-Terminal-Key') || '', terminalKey)) return next();
    res.status(401).json({ ok: false, reason: 'terminal_key' });
  });

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
    await o.save();
    await o.populate('user', USER_FIELDS);
    res.json({ ok: true, order: terminalOrder(o) });
  }));

  r.post('/orders/:n/notify', wrap(async (req, res) => {
    const o = await Order.findOneAndUpdate({ number: +req.params.n }, { notifiedAt: Date.now() }, { new: true })
      .populate('user', USER_FIELDS);
    res.json({ ok: !!o, order: o && terminalOrder(o) });
  }));

  // O bar pode anular qualquer pedido (mesmo entregue): reembolsa e repõe stock
  r.post('/orders/:n/cancel', wrap(async (req, res) => {
    const o = await cancelOrder(req.params.n, 'staff');
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
    res.json({ ok: true, stock: p.stock });
  }));

  r.post('/paused', wrap(async (req, res) => {
    const s = await barSettings({ paused: !!req.body.paused });
    res.json({ ok: true, paused: s.paused });
  }));

  return r;
}

module.exports = { terminalRouter };
