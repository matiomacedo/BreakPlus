/* Rotas da app dos alunos/docentes (montadas em /api). Todas, exceto o login, pedem sessão completa
   de um aluno/docente; /auth/me serve qualquer papel (o terminal também valida a sessão aqui). */
const express = require('express');
const jwt = require('jsonwebtoken');
const { User, Product, Order, Transaction, PushSubscription, Slot } = require('./models');
const { verify, sign, auth, studentAuth, takeAttempt, failAttempt, lockMinutes, publicUser, SECRET, MAX_FAILS } = require('./auth');
const { inTx } = require('./db');
const { fail, wrap } = require('./http');
const { r2, barSettings, queueStats, popularItems, cancelOrder, USER_FIELDS, currentCustomer } = require('./orders');
const push = require('./push');
const realtime = require('./realtime');
const { clock, lisbonDateKey, lisbonEpoch, toMinutes } = require('./time');
const { loadSharedData } = require('./shared-data');

const { RESERVATION, BAR } = loadSharedData();     // mesmas regras que a app (shared/data.js)
const orderOut = (o, uid) => {
  const obj = o.toObject();
  const userId = obj.user && obj.user._id ? obj.user._id : obj.user;
  return { ...obj, user: userId, mine: String(userId) === String(uid), ...currentCustomer(o) };
};

/**
 * Porque é que a hora de levantamento não serve (Europe/Lisbon), ou null se servir:
 * 'pickup' se não for hoje, se estiver fora de BAR.open–RESERVATION.todayUntil ou da grelha de RESERVATION.stepMin;
 * 'lead' se tiver menos de RESERVATION.minLeadMin de antecedência. A antecedência conta-se em minutos
 * inteiros, como a app ao mostrar as horas (às 12:00:40 a hora 12:30 ainda é válida).
 */
function pickupError(pickupKey, pickupTime, now = clock.now()) {
  if (pickupKey !== lisbonDateKey(now)) return 'pickup';
  const m = toMinutes(pickupTime), open = toMinutes(BAR.open);
  if (m < open || m > toMinutes(RESERVATION.todayUntil) || (m - open) % RESERVATION.stepMin) return 'pickup';
  const minuteNow = Math.floor(now / 60000) * 60000;
  return lisbonEpoch(pickupKey, pickupTime) - minuteNow < RESERVATION.minLeadMin * 60000 ? 'lead' : null;
}

/** Hora de levantamento (ms) calculada no servidor (o `pickupAt` do cliente é ignorado); null se não servir. */
const pickupAtFor = (pickupKey, pickupTime, now = clock.now()) =>
  (pickupError(pickupKey, pickupTime, now) ? null : lisbonEpoch(pickupKey, pickupTime));

/** Horas de hoje (Lisboa) que já atingiram RESERVATION.slotCapacity: { key, full: ['12:30', ...] }. */
async function slotsToday() {
  const key = lisbonDateKey();
  const full = await Slot.find({ key, count: { $gte: RESERVATION.slotCapacity } }).sort('time').select('time');
  return { key, full: full.map((s) => s.time) };
}

/** Garante que o contador da hora existe, FORA da transação: duas primeiras reservas em paralelo para a mesma
    hora não podem chocar no índice único dentro da transação (E11000 não é repetido sozinho → erro 500). */
async function ensureSlot(key, time) {
  try { await Slot.updateOne({ key, time }, { $setOnInsert: { count: 0 } }, { upsert: true }); } catch (e) {
    if (e.code !== 11000) throw e;                         // outro pedido criou-o ao mesmo tempo: já existe
  }
}

/** Ocupa um lugar na hora pedida, dentro da transação do pedido. Hora cheia → recusa. */
async function takeSlot(key, time, session) {
  const slot = await Slot.findOneAndUpdate({ key, time, count: { $lt: RESERVATION.slotCapacity } }, { $inc: { count: 1 } }, { session, new: true });
  if (!slot) throw fail('slot_full', {}, 409);
}

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
    const u = await User.findOne({ email }).select('+passwordHash');
    if (!u) throw fail('credentials', {}, 401);                        // mesma resposta: não revela se o email existe
    const attempt = await takeAttempt(u._id);
    if (!attempt) throw fail('locked', { minutes: await lockMinutes(u._id) }, 429);
    if (!verify(req.body.password, u.passwordHash)) {
      const minutes = await failAttempt(attempt);
      if (minutes) throw fail('locked', { minutes }, 429);
      throw fail('credentials', {}, 401);
    }
    await User.updateOne({ _id: u._id, failCount: { $gt: 0 } }, { $inc: { failCount: -1 } });   // password certa: devolve a tentativa
    res.json({ ok: true, preToken: sign(u, 'pin'), name: u.name });
  }));

  r.post('/auth/pin', wrap(async (req, res) => {
    let t; try { t = jwt.verify(req.body.preToken, SECRET); if (t.scope !== 'pin') throw 0; } catch { throw fail('expired', {}, 401); }
    const u = await User.findById(t.sub).select('+pinHash');
    if (!u) throw fail('expired', {}, 401);
    const attempt = await takeAttempt(u._id);
    if (!attempt) throw fail('locked', { minutes: await lockMinutes(u._id) }, 429);
    if (!/^\d{4}$/.test(String(req.body.pin)) || !verify(req.body.pin, u.pinHash)) {
      const minutes = await failAttempt(attempt);
      if (minutes) throw fail('locked', { minutes }, 429);
      throw fail('pin', { attemptsLeft: MAX_FAILS - attempt.failCount }, 401);
    }
    await User.updateOne({ _id: u._id }, { failCount: 0, lockUntil: null });
    res.json({ ok: true, token: sign(u, 'full'), user: publicUser(u) });
  }));

  r.get('/auth/me', auth, wrap(async (req, res) => res.json({ ok: true, user: publicUser(req.user) })));

  /* ---------- Notificações Web Push (chegam com a app fechada) ---------- */

  // Diagnóstico do deploy: permite confirmar qual commit está a correr no Render.
  r.get('/version', (_req, res) => res.json({ ok: true, commit: process.env.RENDER_GIT_COMMIT || null }));

  r.get('/push/public-key', wrap(async (_req, res) => {
    const key = await push.publicKey();
    if (!key) throw fail('push_off', {}, 503);
    res.json({ ok: true, key });
  }));

  // Guarda a subscrição deste dispositivo (endpoint + chaves do browser).
  r.post('/push/subscribe', studentAuth, wrap(async (req, res) => {
    const sub = req.body && req.body.subscription;
    const endpoint = sub && typeof sub.endpoint === 'string' ? sub.endpoint.trim() : '';
    const p256dh = sub && sub.keys && typeof sub.keys.p256dh === 'string' ? sub.keys.p256dh : '';
    const authKey = sub && sub.keys && typeof sub.keys.auth === 'string' ? sub.keys.auth : '';
    if (!/^https:\/\/\S+$/i.test(endpoint) || endpoint.length > 1000 || !p256dh || !authKey) throw fail('bad_subscription');
    await PushSubscription.updateOne(
      { endpoint },
      { $set: { user: req.user._id, keys: { p256dh, auth: authKey } } },
      { upsert: true },
    );
    res.json({ ok: true });
  }));

  // Remove a subscrição deste dispositivo (avisos desligados ou conta terminada).
  r.post('/push/unsubscribe', studentAuth, wrap(async (req, res) => {
    const endpoint = String((req.body && req.body.endpoint) || '');
    if (endpoint) await PushSubscription.deleteOne({ endpoint, user: req.user._id });
    res.json({ ok: true });
  }));

  // Diagnóstico: quantos dispositivos deste aluno estão subscritos.
  r.get('/push/status', studentAuth, wrap(async (req, res) => {
    res.json({ ok: true, subscriptions: await PushSubscription.countDocuments({ user: req.user._id }) });
  }));

  // Teste real: o servidor envia o aviso (confirma o Web Push com a app fechada).
  r.post('/push/test', studentAuth, wrap(async (req, res) => {
    const sent = await push.sendToUser(req.user._id, {
      title: 'Break+ESTG · teste',
      body: 'Se vês isto com a app fechada, o Web Push está a funcionar.',
      tag: 'bp-test-push',
    });
    res.json({ ok: true, sent });
  }));

  /* ---------- Dados ---------- */

  // Estado da app: só os pedidos e a carteira de quem tem sessão + fila global (tempo de espera) + "Mais pedido"
  r.get('/state', studentAuth, wrap(async (req, res) => {
    const [products, set, orders, txs, stats, popular, slots] = await Promise.all([
      Product.find(), barSettings(),
      Order.find({ user: req.user._id }).sort({ number: -1 }).limit(200).populate('user', USER_FIELDS),
      Transaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50),
      queueStats(), popularItems(), slotsToday(),
    ]);
    res.json({
      stock: Object.fromEntries(products.map((p) => [p.itemId, p.stock])),
      paused: set.paused, ...stats, popular, slots,
      wallet: { balance: req.user.balance, transactions: txs },
      orders: orders.map((o) => orderOut(o, req.user._id)),
    });
  }));

  // Ocupação das horas de reserva de hoje (as reservas são só para o dia atual)
  r.get('/slots', studentAuth, wrap(async (_req, res) => res.json({ ok: true, ...(await slotsToday()) })));

  r.get('/menu', studentAuth, wrap(async (_req, res) => res.json(await Product.find().sort('itemId'))));
  r.get('/orders/mine', studentAuth, wrap(async (req, res) => {
    const orders = await Order.find({ user: req.user._id }).sort({ number: -1 }).populate('user', USER_FIELDS);
    res.json(orders.map((o) => orderOut(o, req.user._id)));
  }));

  /* ---------- Pedidos ---------- */

  r.post('/orders', studentAuth, wrap(async (req, res) => {
    const { type, pickupKey, pickupTime } = req.body;
    if (!['now', 'reservation'].includes(type)) throw fail('type');
    const items = parseItems(req.body.items);
    const reservation = type === 'reservation';
    // Dia e hora vão parar ao ecrã do terminal: só se aceita o formato exato ("2026-11-05", "12:30")
    if (reservation && !(/^\d{4}-\d{2}-\d{2}$/.test(pickupKey) && /^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime))) throw fail('pickup');
    // Só se reserva para hoje, na grelha do bar e até às 18:00 (mesmas regras que a app mostra em shared/data.js)
    const why = reservation ? pickupError(pickupKey, pickupTime) : null;
    if (why) throw fail(why);
    const pickupAt = reservation ? lisbonEpoch(pickupKey, pickupTime) : null;
    if (reservation) await ensureSlot(pickupKey, pickupTime);
    const out = await inTx(async (session) => {
      const set = await barSettings({}, session);
      if (type === 'now' && set.paused) throw fail('paused');
      if (reservation) await takeSlot(pickupKey, pickupTime, session);
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
      // Número único (sequencial) + senha do dia: a primeira senha de cada dia (Lisboa) é 1.
      const today = lisbonDateKey();
      const s2 = await barSettings({ $inc: { lastNumber: 1 } }, session);
      const ticket = s2.ticketDay === today ? s2.lastTicket + 1 : 1;
      await barSettings({ ticketDay: today, lastTicket: ticket }, session);
      const [order] = await Order.create([{
        number: s2.lastNumber, ticket, ticketDay: today, user: u._id, customer: u.name, role: u.roleLabel, type, items, total,
        status: reservation ? 'reserved' : 'received',
        ...(reservation ? { pickupKey, pickupTime, pickupAt } : {}), queuedAt: type === 'now' ? Date.now() : undefined,
      }], { session });
      await Transaction.create([{ user: u._id, kind: 'order', amount: -total, order: order.number, ticket }], { session });
      return order;
    });
    realtime.orderChanged(req.user._id);                     // stock, fila e ocupação das horas mudaram para todos
    res.json({ ok: true, order: orderOut(out, req.user._id) });
  }));

  // Cancelar: só as suas reservas, até 30 min antes. Reembolsa e repõe stock.
  r.post('/orders/:id/cancel', studentAuth, wrap(async (req, res) => {
    const out = await cancelOrder(req.params.id, { by: 'student', name: req.user.name }, (o) => {
      if (String(o.user) !== String(req.user._id)) throw fail('forbidden', {}, 403);
      if (o.status !== 'reserved' || o.pickupAt - clock.now() < RESERVATION.cancelBeforeMin * 60000) throw fail('window');
    });
    realtime.orderChanged(req.user._id);
    await out.populate('user', USER_FIELDS);
    res.json({ ok: true, order: orderOut(out, req.user._id) });
  }));

  r.post('/wallet/topup', studentAuth, wrap(async (req, res) => {
    const amount = r2(+req.body.amount);
    if (!(amount > 0 && amount <= 100)) throw fail('amount');
    const u = await User.findByIdAndUpdate(req.user._id, { $inc: { balance: amount } }, { new: true });
    await Transaction.create({ user: u._id, kind: 'topup', amount });
    realtime.userChanged(u._id, 'wallet');
    res.json({ ok: true, balance: u.balance });
  }));

  return r;
}

module.exports = { studentRouter, pickupAtFor, RESERVATION };
