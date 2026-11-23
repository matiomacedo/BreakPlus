/* Café oferecido por um aluno a um colega (issue #11).

   - Pagar: o saldo de quem oferece sai numa transação com o Gift + movimento
     'gift'. O stock NÃO mexer aqui: a bebida ainda não foi preparada.
   - Levantar: outra transação desconta 1 ao stock, cria a senha/pedido de 0 €
     na fila e faz compare-and-set do Gift pending → claimed. Mesmo dois pedidos
     ao mesmo tempo só um pode ganhar; o outro recebe 'already_claimed'.
   - Não levantado: reembolso preguiçoso ao fim de GIFT.expireDays (esta função
     é chamada pelo /state e antes de qualquer levantamento) também por CAS. */
const crypto = require('crypto');
const express = require('express');
const { User, Product, Order, Gift, Transaction } = require('./models');
const { inTx } = require('./db');
const { fail, wrap } = require('./http');
const { r2, barSettings, clearPopularCache, orderOut, nextOrderTicket } = require('./orders');
const { studentAuth } = require('./auth');
const realtime = require('./realtime');
const push = require('./push');
const { clock } = require('./time');
const { loadSharedData } = require('./shared-data');

const { GIFT } = loadSharedData();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['student', 'teacher'];                       // quem pode receber/levantar na app
const cleanEmail = (value) => String(value || '').toLowerCase().trim();
const newCode = () => crypto.randomBytes(9).toString('base64url');

/** Gift (documento ou objeto) → JSON da app: sem ObjectId e com os nomes quem oferece/recebe. */
const giftOut = (gift) => {
  const g = gift && gift.toObject ? gift.toObject() : (gift || {});
  return {
    ...g,
    id: String(g._id || ''),
    from: String(g.from || ''), to: String(g.to || ''),
    _id: undefined,
  };
};

const messageOf = (value) => {
  const message = String(value ?? '').trim();
  if (message.length > GIFT.maxMessage) throw fail('message');
  return message;
};

/** Reembolsa todas as ofertas pendentes mais antigas que o prazo. Devolve os ids dos autores. */
async function refundExpired(now = clock.now()) {
  const due = await Gift.find({ status: 'pending', expiresAt: { $lte: now } }).select('_id').lean();
  const done = [];
  for (const row of due) {
    const from = await inTx(async (session) => {
      const gift = await Gift.findOneAndUpdate(
        { _id: row._id, status: 'pending' },
        { $set: { status: 'refunded', refundedAt: now } },
        { session, new: true },
      );
      if (!gift) return null;                                // outro servidor já reembolsou
      await User.updateOne({ _id: gift.from }, { $inc: { balance: gift.amount } }, { session });
      await Transaction.create([{ user: gift.from, kind: 'gift_refund', amount: gift.amount, gift: gift.code, giftName: gift.toName }], { session });
      return gift.from;
    });
    if (from) {
      done.push(from);
      realtime.userChanged(from, 'gift');
    }
  }
  return done;
}

function giftsRouter() {
  const r = express.Router();
  r.use(studentAuth);

  /** Confirma o nome antes de pagar: a app mostra este contacto para o aluno confirmar. */
  r.post('/gifts/lookup', wrap(async (req, res) => {
    const email = cleanEmail(req.body && req.body.email);
    if (!EMAIL.test(email) || email.length > 254) throw fail('invalid_email');
    if (email === cleanEmail(req.user.email)) throw fail('self_gift');
    const u = await User.findOne({ email });
    if (!u || !ROLES.includes(u.role)) throw fail('recipient_not_found', {}, 404);
    res.json({ ok: true, contact: { name: u.name, email: u.email, avatar: u.avatar || '', role: u.roleLabel } });
  }));

  /** Paga e cria a oferta pendente. */
  r.post('/gifts', wrap(async (req, res) => {
    const body = req.body || {};
    const email = cleanEmail(body.email);
    if (!EMAIL.test(email) || email.length > 254) throw fail('invalid_email');
    const message = messageOf(body.message);
    const to = await User.findOne({ email });
    if (!to || !ROLES.includes(to.role)) throw fail('recipient_not_found', {}, 404);
    if (String(to._id) === String(req.user._id)) throw fail('self_gift');

    let gift;
    for (let attempt = 0; attempt < 3 && !gift; attempt++) {
      const code = newCode();
      try {
        gift = await inTx(async (session) => {
          const product = await Product.findOne({ itemId: GIFT.itemId }).session(session);
          if (!product || !(product.price > 0) || product.stock < 1) throw fail('stock', {}, 409);
          const amount = r2(product.price);
          const giver = await User.findOneAndUpdate(
            { _id: req.user._id, balance: { $gte: amount } },
            { $inc: { balance: -amount } },
            { session, new: true },
          );
          if (!giver) throw fail('balance', {}, 402);
          const [created] = await Gift.create([{
            code, from: giver._id, fromName: giver.name,
            to: to._id, toName: to.name, toEmail: to.email,
            itemId: product.itemId, productName: product.name, amount, message,
            expiresAt: clock.now() + GIFT.expireDays * 86400000,
          }], { session });
          await Transaction.create([{ user: giver._id, kind: 'gift', amount: -amount, gift: code, giftName: to.name }], { session });
          return created;
        });
      } catch (e) {
        if (e.code !== 11000 || attempt === 2) throw e;      // código repetido (quase impossível): tenta outro
      }
    }

    realtime.userChanged(req.user._id, 'gift');
    realtime.userChanged(to._id, 'gift');
    push.notifyUser(to._id, {
      title: 'Tens um café oferecido!',
      body: `${req.user.name} ofereceu-te um café. Abre a app para o levantar no bar.`,
      tag: `bp-gift-${gift.code}`,
      url: './',
    });
    res.json({ ok: true, gift: giftOut(gift) });
  }));

  /** Levanta: cria o pedido de 0 € e marca a oferta como usada, uma vez só. */
  r.post('/gifts/:code/claim', wrap(async (req, res) => {
    await refundExpired();
    const now = clock.now();
    const found = await Gift.findOne({ code: req.params.code });
    if (!found) throw fail('not_found', {}, 404);
    if (String(found.to) !== String(req.user._id)) throw fail('forbidden', {}, 403);
    if (found.status === 'claimed') throw fail('already_claimed', {}, 409);
    if (found.status === 'refunded' || found.expiresAt <= now) throw fail('expired', {}, 409);

    const { order, gift } = await inTx(async (session) => {
      const g = await Gift.findOne({ code: req.params.code }).session(session);
      if (!g) throw fail('not_found', {}, 404);
      if (String(g.to) !== String(req.user._id)) throw fail('forbidden', {}, 403);
      if (g.status === 'claimed') throw fail('already_claimed', {}, 409);
      if (g.status === 'refunded' || g.expiresAt <= now) throw fail('expired', {}, 409);
      const bar = await barSettings({}, session);
      if (bar.paused) throw fail('paused');

      // Stock só desce aqui, no momento em que o café entra na fila.
      const product = await Product.findOneAndUpdate(
        { itemId: g.itemId, stock: { $gte: 1 } },
        { $inc: { stock: -1 } }, { session, new: true },
      );
      if (!product) throw fail('stock', {}, 409);

      const { number, ticket, ticketDay } = await nextOrderTicket(session);
      const [created] = await Order.create([{
        number, ticket, ticketDay, user: req.user._id,
        customer: req.user.name, role: req.user.roleLabel,
        type: 'now', status: 'received', items: { [g.itemId]: 1 }, total: 0, queuedAt: now,
        giftCode: g.code, giftFrom: String(g.from), giftFromName: g.fromName, giftMessage: g.message,
      }], { session });

      // O compare-and-set é a trava: se outra transação levantou primeiro, esta falha e tudo é revertido.
      const claimed = await Gift.findOneAndUpdate(
        { _id: g._id, status: 'pending' },
        { $set: { status: 'claimed', claimedAt: now, order: number } },
        { session, new: true },
      );
      if (!claimed) throw fail('already_claimed', {}, 409);
      return { order: created, gift: claimed };
    });

    clearPopularCache();
    realtime.orderChanged(req.user._id);                     // senha nova para o destinatário e para o bar
    realtime.userChanged(gift.from, 'gift');                 // o autor vê o estado "levantada"
    push.notifyUser(gift.from, {
      title: 'O teu café foi levantado',
      body: `${req.user.name} levantou o café que ofereceste.`,
      tag: `bp-gift-${gift.code}-claimed`,
      url: './',
    });
    res.json({ ok: true, order: orderOut(order, req.user._id), gift: giftOut(gift) });
  }));

  return r;
}

module.exports = { giftsRouter, refundExpired, giftOut };
