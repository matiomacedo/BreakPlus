/* Tempo real (Socket.IO): quem recebe os avisos de mudança. */
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { startServer, stopServer, resetData, call, login, terminal, baseUrl } = require('./helpers');

before(startServer);
after(stopServer);
beforeEach(resetData);

let sockets = [];
afterEach(() => { sockets.forEach((s) => s.close()); sockets = []; });

/** Liga um socket e devolve-o já ligado (ou o erro de ligação). */
function connect(auth) {
  const s = io(baseUrl(), { auth, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

/** Junta os eventos "changed" que o socket recebe. */
const collect = (s) => { const got = []; s.on('changed', (e) => got.push(e)); return got; };
const settle = () => new Promise((r) => setTimeout(r, 200));

test('um pedido feito na app chega ao terminal e ao próprio aluno, sem polling', async () => {
  const token = await login();
  const term = await connect({ terminalKey: process.env.TERMINAL_KEY });
  const mine = await connect({ token });
  const termGot = collect(term), mineGot = collect(mine);
  await call('/api/orders', { token, body: { type: 'now', items: { 1: 1 } } });
  await settle();
  assert.deepEqual(termGot, [{ type: 'order' }]);
  assert.deepEqual(mineGot, [{ type: 'order' }]);
});

test('um aluno nunca recebe eventos dos pedidos de outro aluno', async () => {
  const goncalo = await login();
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const anaSocket = await connect({ token: ana });
  const anaGot = collect(anaSocket);
  const r = await call('/api/orders', { token: goncalo, body: { type: 'now', items: { 1: 1 } } });
  await terminal(`/orders/${r.body.order.number}/status`, { body: { status: 'ready' } });
  await call('/api/wallet/topup', { token: goncalo, body: { amount: 5 } });
  await settle();
  assert.deepEqual(anaGot, []);
});

test('o terminal avisa o dono do pedido quando muda o estado', async () => {
  const token = await login();
  const r = await call('/api/orders', { token, body: { type: 'now', items: { 1: 1 } } });
  const got = collect(await connect({ token }));
  await terminal(`/orders/${r.body.order.number}/status`, { body: { status: 'preparing' } });
  await settle();
  assert.deepEqual(got, [{ type: 'order' }]);
});

test('stock e pausa chegam a todos', async () => {
  const got = collect(await connect({ token: await login() }));
  await terminal('/stock/1', { body: { delta: 1 } });
  await terminal('/paused', { body: { paused: true } });
  await settle();
  assert.deepEqual(got, [{ type: 'stock' }, { type: 'paused' }]);
});

test('sem sessão válida a ligação é recusada', async () => {
  await assert.rejects(connect({}), /unauthenticated/);
  await assert.rejects(connect({ token: 'lixo' }), /unauthenticated/);
  await assert.rejects(connect({ terminalKey: 'errada' }), /unauthenticated/);
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  await assert.rejects(connect({ token: s1.body.preToken }), /unauthenticated/);   // só a password não chega
});
