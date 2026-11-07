/* Rotas da app dos alunos/docentes (montadas em /api). Todas, exceto o login, pedem sessão completa. */
const express = require('express');
const jwt = require('jsonwebtoken');
const { User, Product, Order, Transaction } = require('./models');
const { verify, sign, auth, lockedMin, registerFail, publicUser, SECRET, MAX_FAILS } = require('./auth');
const { inTx } = require('./db');
const { fail, wrap } = require('./http');
const { r2, barSettings, queueStats, cancelOrder } = require('./orders');
const { loadSharedData } = require('./shared-data');

const { RESERVATION } = loadSharedData();     // mesmas regras que a app (shared/data.js)
const orderOut = (o, uid) => ({ ...o.toObject(), mine: String(o.user) === String(uid) });

/** { "1": 2 } → { 1: 2 } com ids e quantidades inteiros positivos (senão recusa). */
function parseItems(items) {
  const out = {};
  for (const [id, qty] of Object.entries(items || {})) {
    if (!Number.isInteger(+id) || !Number.isInteger(+qty) || +qty <= 0) throw fail('empty');
    out[+id] = +qty;
  }
  return out;
}

function studentRouter() {
  const r = express.Router();

  /* ---------- Login em 2 passos: email+password → PIN do cartão ---------- */

  r.post('/auth/login', wrap(async (req, res) => {
    const email = String(req.body.email || '').toLowerCase().trim();
    const u = await User.findOne({ email }).select('+passwordHash +failCount +lockUntil');
    if (!u) throw fail('credentials', {}, 401);                        // mesma resposta: não revela se o email existe
    const lock = lockedMin(u);
    if (lock) throw fail('locked', { minutes: lock }, 429);
    if (!verify(req.body.password, u.passwordHash)) { await registerFail(u); throw fail('credentials', {}, 401); }
    res.json({ ok: true, preToken: sign(u, 'pin'), name: u.name });
  }));

  r.post('/auth/pin', wrap(async (req, res) => {
    let t; try { t = jwt.verify(req.body.preToken, SECRET); if (t.scope !== 'pin') throw 0; } catch { throw fail('expired', {}, 401); }
    const u = await User.findById(t.sub).select('+pinHash +failCount +lockUntil');
    if (!u) throw fail('expired', {}, 401);
    const lock = lockedMin(u);
    if (lock) throw fail('locked', { minutes: lock }, 429);
    if (!/^\d{4}$/.test(String(req.body.pin)) || !verify(req.body.pin, u.pinHash)) {
      await registerFail(u);
      throw fail('pin', { attemptsLeft: u.lockUntil ? 0 : MAX_FAILS - u.failCount }, 401);
    }
    u.failCount = 0; u.lockUntil = null; await u.save();
    res.json({ ok: true, token: sign(u, 'full'), user: publicUser(u) });
  }));

  r.get('/auth/me', auth, wrap(async (req, res) => res.json({ ok: true, user: publicUser(req.user) })));

  /* ---------- Dados ---------- */

  // Estado da app: só os pedidos e a carteira de quem tem sessão + fila global (tempo de espera)
  r.get('/state', auth, wrap(async (req, res) => {
    const [products, set, orders, txs, stats] = await Promise.all([
      Product.find(), barSettings(),
      Order.find({ user: req.user._id }).sort({ number: -1 }).limit(200),
      Transaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50),
      queueStats(),
    ]);
    res.json({
      stock: Object.fromEntries(products.map((p) => [p.itemId, p.stock])),
      paused: set.paused, ...stats,
      wallet: { balance: req.user.balance, transactions: txs },
      orders: orders.map((o) => orderOut(o, req.user._id)),
    });
  }));

  r.get('/menu', auth, wrap(async (_req, res) => res.json(await Product.find().sort('itemId'))));
  r.get('/orders/mine', auth, wrap(async (req, res) => res.json(await Order.find({ user: req.user._id }).sort({ number: -1 }))));

  /* ---------- Pedidos ---------- */

  r.post('/orders', auth, wrap(async (req, res) => {
    const { type, pickupKey, pickupTime, pickupAt } = req.body;
    if (!['now', 'reservation'].includes(type)) throw fail('type');
    const items = parseItems(req.body.items);
    const reservation = type === 'reservation';
    // Dia e hora vão parar ao ecrã do terminal: só se aceita o formato exato ("2026-11-05", "12:30")
    if (reservation && !(/^\d{4}-\d{2}-\d{2}$/.test(pickupKey) && /^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime) && +pickupAt > Date.now())) throw fail('pickup');
    const out = await inTx(async (session) => {
      const set = await barSettings({}, session);
      if (type === 'now' && set.paused) throw fail('paused');
      let total = 0;
      for (const [id, qty] of Object.entries(items)) {
        const p = await Product.findOneAndUpdate({ itemId: +id, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { session, new: true });
        if (!p) throw fail('stock', { itemId: +id }, 409);
        total += p.price * qty;
      }
      total = r2(total);
      if (!total) throw fail('empty');
      const u = await User.findOneAndUpdate({ _id: req.user._id, balance: { $gte: total } }, { $inc: { balance: -total } }, { session, new: true });
      if (!u) throw fail('balance', {}, 402);
      const s2 = await barSettings({ $inc: { lastNumber: 1 } }, session);
      const [order] = await Order.create([{
        number: s2.lastNumber, user: u._id, customer: u.name, role: u.roleLabel, type, items, total,
        status: reservation ? 'reserved' : 'received',
        ...(reservation ? { pickupKey, pickupTime, pickupAt: +pickupAt } : {}), queuedAt: type === 'now' ? Date.now() : undefined,
      }], { session });
      await Transaction.create([{ user: u._id, kind: 'order', amount: -total, order: order.number }], { session });
      return order;
    });
    res.json({ ok: true, order: orderOut(out, req.user._id) });
  }));

  // Cancelar: só as suas reservas, até 30 min antes. Reembolsa e repõe stock.
  r.post('/orders/:n/cancel', auth, wrap(async (req, res) => {
    const out = await cancelOrder(req.params.n, 'student', (o) => {
      if (String(o.user) !== String(req.user._id)) throw fail('forbidden', {}, 403);
      if (o.status !== 'reserved' || o.pickupAt - Date.now() < RESERVATION.cancelBeforeMin * 60000) throw fail('window');
    });
    res.json({ ok: true, order: orderOut(out, req.user._id) });
  }));

  r.post('/wallet/topup', auth, wrap(async (req, res) => {
    const amount = r2(+req.body.amount);
    if (!(amount > 0 && amount <= 100)) throw fail('amount');
    const u = await User.findByIdAndUpdate(req.user._id, { $inc: { balance: amount } }, { new: true });
    await Transaction.create({ user: u._id, kind: 'topup', amount });
    res.json({ ok: true, balance: u.balance });
  }));

  return r;
}

module.exports = { studentRouter };
