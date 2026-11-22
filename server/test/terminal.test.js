/* Terminal do bar: exige a sessão de uma funcionária (papel "staff"). */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, resetData, call, login, terminal } = require('./helpers');

before(startServer);
after(stopServer);
beforeEach(resetData);

const placeNow = async (token, items = { 1: 2 }) =>
  (await call('/api/orders', { token, body: { type: 'now', items } })).body.order;

/* ---------- Proteção ---------- */

const TERMINAL_ROUTES = [
  ['/state', undefined],
  ['/orders/101/status', { status: 'ready' }],
  ['/orders/101/notify', {}],
  ['/orders/101/cancel', {}],
  ['/stock/1', { delta: 5 }],
  ['/paused', { paused: true }],
];

test('sem sessão → 401 em todas as rotas do terminal', async () => {
  for (const [path, body] of TERMINAL_ROUTES) {
    const r = await terminal(path, { token: null, body });
    assert.deepEqual([path, r.status, r.body.reason], [path, 401, 'unauthenticated']);
  }
});

test('token inválido ou só do 1.º passo (password) → 401', async () => {
  const s1 = await call('/api/auth/login', { body: { email: 'bar@demo.pt', password: 'demo1234' } });
  assert.equal((await terminal('/state', { token: 'lixo' })).status, 401);
  assert.equal((await terminal('/state', { token: s1.body.preToken })).status, 401);
});

test('um aluno ou docente com sessão não consegue usar nenhuma rota do terminal', async () => {
  for (const token of [await login(), await login('ana@demo.pt', 'demo1234', '4321')]) {
    await placeNow(token);
    for (const [path, body] of TERMINAL_ROUTES) {
      const r = await terminal(path, { token, body });
      assert.deepEqual([path, r.status, r.body.reason], [path, 403, 'forbidden']);
    }
  }
  const s = await terminal('/state');
  assert.deepEqual([s.body.paused, s.body.stock[1], s.body.orders.every((o) => o.status === 'received')], [false, 6, true]);   // 2 pedidos de 2 tostas; nada mudou
});

test('a funcionária entra com o mesmo login em 2 passos e o papel "staff"', async () => {
  const token = await login('bar@demo.pt', 'demo1234', '9999');
  const me = await call('/api/auth/me', { token });
  assert.equal(me.body.user.role, 'staff');
  assert.equal((await terminal('/state', { token })).status, 200);
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

test('o histórico mostra o nome atual do utilizador, não a cópia guardada no pedido', async () => {
  const o = await placeNow(await login());
  const { User } = require('../src/models');
  await User.updateOne({ email: 'aluno@demo.pt' }, { name: 'Gonçalo Novo', roleLabel: 'Docente' });

  const r = await terminal('/state');
  const updated = r.body.orders.find((x) => x.number === o.number);
  assert.equal(updated.customer, 'Gonçalo Novo');
  assert.equal(updated.role, 'Docente');

  // Se a conta desaparecer, mantém-se a cópia histórica como fallback.
  await User.deleteOne({ email: 'aluno@demo.pt' });
  const r2 = await terminal('/state');
  assert.equal(r2.body.orders.find((x) => x.number === o.number).customer, 'Gonçalo Silva');
});

/* ---------- Ações ---------- */

test('avançar o estado: sem estado explícito segue para o seguinte', async () => {
  const o = await placeNow(await login());
  const r = await terminal(`/orders/${o._id}/status`, { body: {} });
  assert.equal(r.body.order.status, 'preparing');
  const r2 = await terminal(`/orders/${o._id}/status`, { body: { status: 'ready' } });
  assert.equal(r2.body.order.status, 'ready');
  assert.ok(r2.body.order.readyAt);
});

test('o aluno vê o pedido como pronto depois de o terminal o avançar', async () => {
  const token = await login();
  const o = await placeNow(token);
  await terminal(`/orders/${o._id}/status`, { body: { status: 'ready' } });
  const s = await call('/api/state', { token });
  assert.equal(s.body.orders[0].status, 'ready');
});

test('chamar outra vez atualiza notifiedAt', async () => {
  const o = await placeNow(await login());
  const r = await terminal(`/orders/${o._id}/notify`, { body: {} });
  assert.ok(r.body.order.notifiedAt > 0);
});

test('cancelar no terminal: reembolsa, repõe stock, regista Transaction e cancelledBy = staff', async () => {
  const token = await login();
  const o = await placeNow(token);
  await terminal(`/orders/${o._id}/status`, { body: { status: 'preparing' } });   // o bar pode anular em qualquer estado
  const r = await terminal(`/orders/${o._id}/cancel`, { body: {} });
  assert.equal(r.body.ok, true);
  assert.deepEqual([r.body.order.status, r.body.order.cancelledBy, r.body.order.cancelledByName], ['cancelled', 'staff', 'Rosa Ferreira']);
  assert.deepEqual(r.body.order.actions.map((a) => [a.action, a.by]), [['preparing', 'Rosa Ferreira'], ['cancelled', 'Rosa Ferreira']]);
  const s = await call('/api/state', { token });
  assert.deepEqual([s.body.wallet.balance, s.body.stock[1]], [12.5, 10]);
  assert.deepEqual(s.body.wallet.transactions.map((t) => t.kind), ['refund', 'order']);
});

test('cancelar duas vezes o mesmo pedido não reembolsa duas vezes', async () => {
  const token = await login();
  const o = await placeNow(token);
  await terminal(`/orders/${o._id}/cancel`, { body: {} });
  const again = await terminal(`/orders/${o._id}/cancel`, { body: {} });
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

test('cada ação do terminal fica registada com o nome da funcionária', async () => {
  const o = await placeNow(await login());
  await terminal(`/orders/${o._id}/status`, { body: { status: 'ready' } });
  const r = await terminal(`/orders/${o._id}/notify`, { body: {} });
  assert.deepEqual(r.body.order.actions.map((a) => [a.action, a.by]), [['ready', 'Rosa Ferreira'], ['notified', 'Rosa Ferreira']]);
});

/* ---------- Senha do dia ---------- */

test('pedidos de dias diferentes com a mesma senha não se confundem (as rotas usam o id único)', async () => {
  const { Setting } = require('../src/models');
  const token = await login();
  const ontem = await placeNow(token, { 1: 1 });
  await Setting.updateOne({ _id: 'bar' }, { ticketDay: '2000-01-01' });       // o dia mudou
  const hoje = await placeNow(token, { 2: 1 });
  assert.deepEqual([ontem.ticket, hoje.ticket], [1, 1]);
  assert.notEqual(ontem._id, hoje._id);

  await terminal(`/orders/${hoje._id}/status`, { body: { status: 'preparing' } });
  await terminal(`/orders/${ontem._id}/cancel`, { body: {} });
  const s = await terminal('/state');
  const byId = Object.fromEntries(s.body.orders.map((o) => [o._id, o.status]));
  assert.deepEqual([byId[ontem._id], byId[hoje._id]], ['cancelled', 'preparing']);
});

test('um id de pedido inválido ou inexistente → 404', async () => {
  assert.equal((await terminal('/orders/101/status', { body: {} })).status, 404);
  assert.equal((await terminal('/orders/64b000000000000000000000/cancel', { body: {} })).status, 404);
});

/* ---------- Web Push ---------- */

test('quando o pedido fica pronto o servidor envia Web Push ao aluno', async () => {
  const webpush = require('web-push');
  const token = await login();
  const order = await placeNow(token, { 1: 1 });
  await call('/api/push/subscribe', {
    token,
    body: { subscription: { endpoint: 'https://push.example/sub/ready', keys: { p256dh: 'chave', auth: 'auth' } } },
  });

  const sent = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = async (subscription, payload) => {
    sent.push({ subscription, payload: JSON.parse(payload) });
    return {};
  };

  try {
    await terminal(`/orders/${order._id}/status`, { body: { status: 'preparing' } });
    await terminal(`/orders/${order._id}/status`, { body: { status: 'ready' } });
    for (let i = 0; i < 40 && !sent.length; i++) await new Promise((r) => setTimeout(r, 25));
  } finally {
    webpush.sendNotification = original;
  }

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.title, `Pedido #${order.ticket} pronto!`);   // a senha do dia, não o número interno
  assert.equal(sent[0].subscription.endpoint, 'https://push.example/sub/ready');
});

test('chamar a senha e anular também enviam Web Push', async () => {
  const webpush = require('web-push');
  const token = await login();
  const order = await placeNow(token, { 1: 1 });
  await call('/api/push/subscribe', {
    token,
    body: { subscription: { endpoint: 'https://push.example/sub/call', keys: { p256dh: 'chave', auth: 'auth' } } },
  });

  const sent = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = async (_subscription, payload) => {
    sent.push(JSON.parse(payload));
    return {};
  };

  try {
    await terminal(`/orders/${order._id}/notify`, { body: {} });
    await terminal(`/orders/${order._id}/cancel`, { body: {} });
    for (let i = 0; i < 40 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 25));
  } finally {
    webpush.sendNotification = original;
  }

  assert.deepEqual(sent.map((p) => p.tag), [`bp-order-${order.number}-call`, `bp-order-${order.number}-cancel`]);
});
