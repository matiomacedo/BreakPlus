/* App dos alunos: comportamento que tem de continuar igual. */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, resetData, call, login } = require('./helpers');

before(startServer);
after(stopServer);
beforeEach(resetData);

const inMinutes = (m) => Date.now() + m * 60000;
const reservation = (pickupAt, items = { 1: 1 }) => ({ type: 'reservation', items, pickupKey: '2099-01-01', pickupTime: '10:00', pickupAt });

test('login em 2 passos: password certa e PIN certo dão um token de sessão', async () => {
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  assert.equal(s1.body.ok, true);
  const s2 = await call('/api/auth/pin', { body: { preToken: s1.body.preToken, pin: '1234' } });
  assert.equal(s2.body.ok, true);
  assert.equal(s2.body.user.email, 'aluno@demo.pt');
});

test('PIN errado é recusado e diz quantas tentativas faltam', async () => {
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  const s2 = await call('/api/auth/pin', { body: { preToken: s1.body.preToken, pin: '0000' } });
  assert.equal(s2.status, 401);
  assert.deepEqual([s2.body.reason, s2.body.attemptsLeft], ['pin', 4]);
});

test('o token do 1.º passo (só password) não serve para usar a API', async () => {
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  const r = await call('/api/state', { token: s1.body.preToken });
  assert.equal(r.status, 401);
});

test('pedir agora desconta o saldo e o stock e entra na fila como "received"', async () => {
  const token = await login();
  const r = await call('/api/orders', { token, body: { type: 'now', items: { 1: 2 } } });
  assert.equal(r.body.ok, true);
  assert.deepEqual([r.body.order.status, r.body.order.total, r.body.order.mine], ['received', 4.4, true]);
  const s = await call('/api/state', { token });
  assert.equal(s.body.wallet.balance, 8.1);
  assert.equal(s.body.stock[1], 8);
  assert.equal(s.body.queueSize, 1);
});

test('o estado do aluno só mostra os pedidos dele', async () => {
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  await call('/api/orders', { token: ana, body: { type: 'now', items: { 1: 1 } } });
  const s = await call('/api/state', { token: await login() });
  assert.equal(s.body.orders.length, 0);
  assert.equal(s.body.queueSize, 1);           // mas a fila global conta para o tempo de espera
});

test('sem stock suficiente o pedido é recusado e nada é descontado', async () => {
  const token = await login();
  const r = await call('/api/orders', { token, body: { type: 'now', items: { 2: 4 } } });
  assert.equal(r.status, 409);
  assert.deepEqual([r.body.reason, r.body.itemId], ['stock', 2]);
  const s = await call('/api/state', { token });
  assert.deepEqual([s.body.wallet.balance, s.body.stock[2]], [12.5, 3]);
});

test('sem saldo suficiente o pedido é recusado', async () => {
  const token = await login();
  const r = await call('/api/orders', { token, body: { type: 'now', items: { 1: 6 } } });
  assert.deepEqual([r.status, r.body.reason], [402, 'balance']);
});

test('o aluno cancela a sua reserva com mais de 30 min de antecedência: reembolso e stock reposto', async () => {
  const token = await login();
  const { body } = await call('/api/orders', { token, body: reservation(inMinutes(120)) });
  const r = await call(`/api/orders/${body.order.number}/cancel`, { token, body: {} });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.order.cancelledBy, 'student');
  const s = await call('/api/state', { token });
  assert.deepEqual([s.body.wallet.balance, s.body.stock[1]], [12.5, 10]);
});

test('o aluno não cancela uma reserva a menos de 30 min', async () => {
  const token = await login();
  const { body } = await call('/api/orders', { token, body: reservation(inMinutes(10)) });
  const r = await call(`/api/orders/${body.order.number}/cancel`, { token, body: {} });
  assert.equal(r.body.reason, 'window');
});

test('o aluno não cancela reservas de outra pessoa', async () => {
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const { body } = await call('/api/orders', { token: ana, body: reservation(inMinutes(120)) });
  const r = await call(`/api/orders/${body.order.number}/cancel`, { token: await login(), body: {} });
  assert.equal(r.status, 403);
});

test('carregar saldo soma ao saldo e regista o movimento', async () => {
  const token = await login();
  await call('/api/wallet/topup', { token, body: { amount: 5 } });
  const s = await call('/api/state', { token });
  assert.equal(s.body.wallet.balance, 17.5);
  assert.equal(s.body.wallet.transactions[0].kind, 'topup');
});

test('quantidades em texto ("2") são guardadas como números', async () => {
  const token = await login();
  const r = await call('/api/orders', { token, body: { type: 'now', items: { 1: '2' } } });
  assert.deepEqual(r.body.order.items, { 1: 2 });
});

for (const [pickupKey, pickupTime] of [['2099-01-01', '<img src=x onerror=alert(1)>'], ['<b>x</b>', '10:00'], ['2099-1-1', '10:00'], ['2099-01-01', '25:00']]) {
  test(`reserva com dia/hora inválidos (${pickupKey} ${pickupTime}) é recusada (não chega ao terminal)`, async () => {
    const r = await call('/api/orders', { token: await login(), body: { type: 'reservation', items: { 1: 1 }, pickupKey, pickupTime, pickupAt: inMinutes(120) } });
    assert.deepEqual([r.status, r.body.reason], [400, 'pickup']);
  });
}
