/* Terminal do bar: sem login, protegido pela chave partilhada (X-Terminal-Key). */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, resetData, call, login, terminal } = require('./helpers');

before(startServer);
after(stopServer);
beforeEach(resetData);

const placeNow = async (token, items = { 1: 2 }) =>
  (await call('/api/orders', { token, body: { type: 'now', items } })).body.order;

/* ---------- Proteção ---------- */

test('sem chave do terminal → 401', async () => {
  const r = await call('/api/terminal/state');
  assert.deepEqual([r.status, r.body.reason], [401, 'terminal_key']);
});

test('chave errada → 401, também nas ações de escrita', async () => {
  const bad = { headers: { 'X-Terminal-Key': 'errada' } };
  assert.equal((await terminal('/state', bad)).status, 401);
  assert.equal((await terminal('/paused', { ...bad, body: { paused: true } })).status, 401);
});

test('o token de um aluno não abre o terminal', async () => {
  const r = await call('/api/terminal/state', { token: await login() });
  assert.equal(r.status, 401);
});

/* ---------- Estado ---------- */

test('o estado do terminal tem os pedidos de todos, stock, pausa e fila, sem dados de carteira/utilizador', async () => {
  await placeNow(await login());
  await placeNow(await login('ana@demo.pt', 'demo1234', '4321'), { 2: 1 });
  const r = await terminal('/state');
  assert.equal(r.status, 200);
  assert.equal(r.body.orders.length, 2);
  assert.deepEqual(r.body.stock, { 1: 8, 2: 2 });
  assert.equal(r.body.paused, false);
  assert.equal(r.body.queueSize, 2);
  assert.ok('avgPrepSec' in r.body);
  assert.equal(r.body.wallet, undefined);
  for (const o of r.body.orders) assert.equal(o.user, undefined, 'não expõe o id do utilizador');
  assert.deepEqual(r.body.orders.map((o) => o.customer).sort(), ['Ana Costa', 'Gonçalo Silva']);
});

/* ---------- Ações ---------- */

test('avançar o estado: sem estado explícito segue para o seguinte', async () => {
  const o = await placeNow(await login());
  const r = await terminal(`/orders/${o.number}/status`, { body: {} });
  assert.equal(r.body.order.status, 'preparing');
  const r2 = await terminal(`/orders/${o.number}/status`, { body: { status: 'ready' } });
  assert.equal(r2.body.order.status, 'ready');
  assert.ok(r2.body.order.readyAt);
});

test('o aluno vê o pedido como pronto depois de o terminal o avançar', async () => {
  const token = await login();
  const o = await placeNow(token);
  await terminal(`/orders/${o.number}/status`, { body: { status: 'ready' } });
  const s = await call('/api/state', { token });
  assert.equal(s.body.orders[0].status, 'ready');
});

test('chamar outra vez atualiza notifiedAt', async () => {
  const o = await placeNow(await login());
  const r = await terminal(`/orders/${o.number}/notify`, { body: {} });
  assert.ok(r.body.order.notifiedAt > 0);
});

test('cancelar no terminal: reembolsa, repõe stock, regista Transaction e cancelledBy = staff', async () => {
  const token = await login();
  const o = await placeNow(token);
  await terminal(`/orders/${o.number}/status`, { body: { status: 'preparing' } });   // o bar pode anular em qualquer estado
  const r = await terminal(`/orders/${o.number}/cancel`, { body: {} });
  assert.equal(r.body.ok, true);
  assert.deepEqual([r.body.order.status, r.body.order.cancelledBy], ['cancelled', 'staff']);
  const s = await call('/api/state', { token });
  assert.deepEqual([s.body.wallet.balance, s.body.stock[1]], [12.5, 10]);
  assert.deepEqual(s.body.wallet.transactions.map((t) => t.kind), ['refund', 'order']);
});

test('cancelar duas vezes o mesmo pedido não reembolsa duas vezes', async () => {
  const token = await login();
  const o = await placeNow(token);
  await terminal(`/orders/${o.number}/cancel`, { body: {} });
  const again = await terminal(`/orders/${o.number}/cancel`, { body: {} });
  assert.equal(again.status, 404);
  assert.equal((await call('/api/state', { token })).body.wallet.balance, 12.5);
});

test('stock: delta soma, set define', async () => {
  assert.equal((await terminal('/stock/1', { body: { delta: 5 } })).body.stock, 15);
  assert.equal((await terminal('/stock/1', { body: { set: 0 } })).body.stock, 0);
});

test('stock: não deixa ficar negativo', async () => {
  const r = await terminal('/stock/2', { body: { delta: -4 } });
  assert.equal(r.body.ok, false);
});

for (const body of [{ delta: 1.5 }, { delta: 'abc' }, { delta: null }, {}, { set: 'x' }, { set: -1 }, { set: 2.5 }, { delta: 'Infinity' }]) {
  test(`stock: recusa valores inválidos ${JSON.stringify(body)} com 400`, async () => {
    const r = await terminal('/stock/1', { body });
    assert.deepEqual([r.status, r.body.reason], [400, 'bad_stock']);
  });
}

test('pausar e retomar pedidos na hora', async () => {
  assert.equal((await terminal('/paused', { body: { paused: true } })).body.paused, true);
  const r = await call('/api/orders', { token: await login(), body: { type: 'now', items: { 1: 1 } } });
  assert.equal(r.body.reason, 'paused');
  assert.equal((await terminal('/paused', { body: { paused: false } })).body.paused, false);
});

/* ---------- A app dos alunos já não tem ações do terminal ---------- */

for (const [path, body] of [
  ['/api/orders/101/status', { status: 'ready' }],
  ['/api/orders/101/notify', {}],
  ['/api/stock/1', { delta: 5 }],
  ['/api/paused', { paused: true }],
]) {
  test(`um aluno já não consegue usar ${path}`, async () => {
    const token = await login();
    await placeNow(token);
    const r = await call(path, { token, body });
    assert.equal(r.status, 404);
  });
}

test('/api/users e /api/users/:id/orders foram removidos', async () => {
  const token = await login();
  assert.equal((await call('/api/users', { token })).status, 404);
  assert.equal((await call('/api/users/x/orders', { token })).status, 404);
});

test('não existe papel "staff" nos utilizadores', async () => {
  const { User } = require('../src/models');
  await assert.rejects(User.create({ name: 'X', role: 'staff', email: 'x@demo.pt', passwordHash: 'a', pinHash: 'b' }), /staff/);
});
