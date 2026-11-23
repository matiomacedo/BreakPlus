/* Oferecer um café: aceitação da issue #11. */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, resetData, call, login, terminal, staff } = require('./helpers');
const { clock, lisbonDateKey, lisbonEpoch } = require('../src/time');
const { Order, Gift, Product, Transaction, User } = require('../src/models');
const { hash } = require('../src/auth');
const { ensureCatalogue } = require('../src/catalogue');

const realNow = clock.now;
before(startServer);
after(async () => { clock.now = realNow; await stopServer(); });
beforeEach(async () => {
  clock.now = realNow;
  await resetData();
  await Gift.deleteMany({});                                  // o seed partilhado não conhece ofertas
  await Product.create({ itemId: 7, name: 'Café Espresso', price: 0.8, stock: 20 });
});

const todayKey = () => lisbonDateKey(Date.now());
const at = (hhmm) => lisbonEpoch(todayKey(), hhmm);
const send = (token, email, message = '') => call('/api/gifts', { token, body: { email, message } });
const claim = (token, code) => call(`/api/gifts/${code}/claim`, { token, body: {} });
const giverId = async () => (await User.findOne({ email: 'aluno@demo.pt' }))._id;

test('o arranque cria o café canónico sem alterar preço, nome ou stock já configurados', async () => {
  await Product.deleteMany({ itemId: 7 });
  await Product.updateOne({ itemId: 1 }, { $set: { name: 'Tosta da casa', price: 9.99, stock: 3 } });

  assert.ok(await ensureCatalogue() >= 1);
  const coffee = await Product.findOne({ itemId: 7 });
  assert.deepEqual([coffee.name, coffee.price, coffee.stock], ['Café Espresso', 0.8, 20]);
  const tosta = await Product.findOne({ itemId: 1 });
  assert.deepEqual([tosta.name, tosta.price, tosta.stock], ['Tosta da casa', 9.99, 3]);
  assert.equal(await ensureCatalogue(), 0);                   // idempotente

  // A app mostra o preço que a API realmente cobra, mesmo se o café tiver outro preço na BD.
  await Product.updateOne({ itemId: 7 }, { $set: { price: 0.7 } });
  const state = await call('/api/state', { token: await login(), method: 'GET' });
  assert.equal(state.body.giftPrice, 0.7);
});

test('oferecer desconta quem oferece; levantar não desconta quem recebe e só aí desce o stock', async () => {
  const giver = await login();
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const before = await call('/api/state', { token: giver });
  assert.deepEqual([before.body.wallet.balance, before.body.stock[7]], [12.5, 20]);

  const sent = await send(giver, 'ana@demo.pt', 'Bom trabalho!');
  assert.deepEqual([sent.status, sent.body.ok], [200, true]);
  assert.deepEqual([sent.body.gift.status, sent.body.gift.amount, sent.body.gift.message], ['pending', 0.8, 'Bom trabalho!']);
  assert.equal(sent.body.gift.toEmail, 'ana@demo.pt');

  const afterSend = await call('/api/state', { token: giver });
  assert.deepEqual([afterSend.body.wallet.balance, afterSend.body.stock[7]], [11.7, 20]);  // stock intacto até ao levantamento
  assert.equal(afterSend.body.gifts.sent.length, 1);
  const movement = await Transaction.findOne({ kind: 'gift' });
  assert.deepEqual([movement.amount, String(movement.user), movement.gift], [-0.8, String(await giverId()), sent.body.gift.code]);

  const asAna = await call('/api/state', { token: ana });
  assert.deepEqual([asAna.body.wallet.balance, asAna.body.gifts.received.length], [8, 1]);

  const claimed = await claim(ana, sent.body.gift.code);
  assert.deepEqual([claimed.status, claimed.body.ok], [200, true]);
  assert.deepEqual([claimed.body.order.total, claimed.body.order.status, claimed.body.order.type], [0, 'received', 'now']);
  assert.deepEqual([claimed.body.order.giftFromName, claimed.body.order.giftMessage, claimed.body.order.mine], ['Gonçalo Silva', 'Bom trabalho!', true]);

  const giverAfter = await call('/api/state', { token: giver });
  const anaAfter = await call('/api/state', { token: ana });
  assert.deepEqual([giverAfter.body.wallet.balance, anaAfter.body.wallet.balance], [11.7, 8]);
  assert.deepEqual([anaAfter.body.stock[7], anaAfter.body.queueSize], [19, 1]);
  assert.equal(anaAfter.body.gifts.received[0].status, 'claimed');
  assert.equal(await Transaction.countDocuments({ user: (await User.findOne({ email: 'ana@demo.pt' }))._id }), 0);
});

test('só quem recebeu levanta, e dois pedidos ao mesmo tempo só criam um pedido', async () => {
  await User.create({
    name: 'João Lopes', role: 'student', email: 'joao@demo.pt',
    passwordHash: hash('demo1234'), pinHash: hash('1234'), balance: 5,
  });
  const giver = await login();
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const joao = await login('joao@demo.pt');
  const gift = (await send(giver, 'ana@demo.pt')).body.gift;

  const wrong = await claim(joao, gift.code);
  assert.deepEqual([wrong.status, wrong.body.reason], [403, 'forbidden']);

  const [a, b] = await Promise.all([
    claim(ana, gift.code),
    claim(ana, gift.code),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.deepEqual([a.body.reason, b.body.reason].filter(Boolean), ['already_claimed']);
  assert.equal(await Order.countDocuments({ giftCode: gift.code }), 1);
  assert.equal((await Gift.findOne({ code: gift.code })).status, 'claimed');
  assert.equal((await Product.findOne({ itemId: 7 })).stock, 19);
  assert.equal((await call('/api/state', { token: giver })).body.wallet.balance, 11.7);
});

test('email inexistente, próprio e mensagem longa dão erro claro sem descontar saldo', async () => {
  const giver = await login();
  const missing = await send(giver, 'ninguem@demo.pt');
  assert.deepEqual([missing.status, missing.body.reason], [404, 'recipient_not_found']);
  const self = await send(giver, 'ALUNO@demo.pt');
  assert.deepEqual([self.status, self.body.reason], [400, 'self_gift']);
  const long = await send(giver, 'ana@demo.pt', 'x'.repeat(121));
  assert.deepEqual([long.status, long.body.reason], [400, 'message']);
  const bad = await call('/api/gifts/lookup', { token: giver, body: { email: 'nao-e-email' } });
  assert.deepEqual([bad.status, bad.body.reason], [400, 'invalid_email']);

  const lookup = await call('/api/gifts/lookup', { token: giver, body: { email: '  ANA@demo.pt ' } });
  assert.deepEqual([lookup.status, lookup.body.contact.name, lookup.body.contact.email], [200, 'Ana Costa', 'ana@demo.pt']);
  assert.equal((await call('/api/state', { token: giver })).body.wallet.balance, 12.5);
  assert.equal(await Gift.countDocuments(), 0);
});

test('passados 30 dias sem levantar, o café é reembolsado uma vez e já não pode ser levantado', async () => {
  clock.now = () => at('10:00');
  const giver = await login();
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const gift = (await send(giver, 'ana@demo.pt')).body.gift;
  assert.equal((await call('/api/state', { token: giver })).body.wallet.balance, 11.7);

  clock.now = () => at('10:00') + 31 * 86400000;
  const after = await call('/api/state', { token: giver });
  assert.equal(after.body.wallet.balance, 12.5);
  assert.equal(after.body.gifts.sent[0].status, 'refunded');
  assert.equal(await Transaction.countDocuments({ kind: 'gift_refund' }), 1);

  const again = await call('/api/state', { token: giver });
  assert.deepEqual([again.body.wallet.balance, await Transaction.countDocuments({ kind: 'gift_refund' })], [12.5, 1]);

  const late = await claim(ana, gift.code);
  assert.deepEqual([late.status, late.body.reason], [409, 'expired']);
  assert.equal(await Order.countDocuments({ giftCode: gift.code }), 0);
  assert.equal((await Product.findOne({ itemId: 7 })).stock, 20);
});

test('o terminal recebe o pedido da oferta com a origem e o valor 0 €', async () => {
  const giver = await login();
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const gift = (await send(giver, 'ana@demo.pt')).body.gift;
  await claim(ana, gift.code);

  const s = await terminal('/state');
  const order = s.body.orders.find((o) => o.giftCode === gift.code);
  assert.ok(order);
  assert.deepEqual([order.total, order.giftFromName, order.customer, order.status], [0, 'Gonçalo Silva', 'Ana Costa', 'received']);
  assert.deepEqual(order.items, { 7: 1 });
});

test('com o bar em pausa não é possível levantar a oferta', async () => {
  const giver = await login();
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const gift = (await send(giver, 'ana@demo.pt')).body.gift;
  await call('/api/terminal/paused', { token: await staff(), body: { paused: true } });

  const r = await claim(ana, gift.code);
  assert.deepEqual([r.status, r.body.reason], [400, 'paused']);
  assert.equal((await Gift.findOne({ code: gift.code })).status, 'pending');
  assert.equal((await Product.findOne({ itemId: 7 })).stock, 20);
  assert.equal(await Order.countDocuments({ giftCode: gift.code }), 0);
});
