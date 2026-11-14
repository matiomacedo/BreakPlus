/* Configuração, CORS, arranque e robustez do servidor. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { startServer, stopServer, resetData, call, login } = require('./helpers');
const { loadConfig } = require('../src/config');

const ENV = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 's', TERMINAL_KEY: 'k' };

/* ---------- Configuração ---------- */

for (const name of ['MONGODB_URI', 'JWT_SECRET', 'TERMINAL_KEY']) {
  test(`sem ${name} o servidor recusa arrancar e diz o que falta`, () => {
    assert.throws(() => loadConfig({ ...ENV, [name]: '' }), new RegExp(name));
  });
}

test('CORS_ORIGINS separado por vírgulas vira uma lista', () => {
  const c = loadConfig({ ...ENV, CORS_ORIGINS: 'http://localhost:8000, http://bar.local:5500 ,' });
  assert.deepEqual(c.corsOrigins, ['http://localhost:8000', 'http://bar.local:5500']);
});

test('sem CORS_ORIGINS não autoriza nenhuma origem externa', () => {
  assert.deepEqual(loadConfig(ENV).corsOrigins, []);
});

/* ---------- Com servidor ---------- */

test('com servidor', async (t) => {
  await startServer();
  t.after(stopServer);
  await resetData();

  await t.test('CORS: uma origem configurada recebe Access-Control-Allow-Origin', async () => {
    const r = await call('/api/auth/me', { headers: { Origin: 'http://localhost:8000' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8000');
  });

  await t.test('CORS: uma origem desconhecida não recebe Access-Control-Allow-Origin', async () => {
    const r = await call('/api/auth/me', { headers: { Origin: 'http://malicioso.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });

  await t.test('CORS: o preflight do terminal aceita o cabeçalho X-Terminal-Key', async () => {
    const r = await call('/api/terminal/state', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:8000', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-terminal-key',
    } });
    assert.match(r.headers.get('access-control-allow-headers') || '', /x-terminal-key/i);
  });

  await t.test('sem as definições "bar" (base sem seed) o estado e os pedidos funcionam e criam-nas', async () => {
    const { Setting } = require('../src/models');
    await Setting.deleteMany({});
    const token = await login();
    const s = await call('/api/state', { token });
    assert.deepEqual([s.status, s.body.paused], [200, false]);
    const o = await call('/api/orders', { token, body: { type: 'now', items: { 1: 1 } } });
    assert.equal(o.body.order.number, 101);
  });
});

/* ---------- MongoDB sem replica set ---------- */

test('num mongod standalone (sem replica set) o arranque falha com uma mensagem clara', async () => {
  const { assertReplicaSet } = require('../src/db');
  const standalone = await MongoMemoryServer.create();
  const conn = await mongoose.createConnection(standalone.getUri()).asPromise();
  try {
    await assert.rejects(assertReplicaSet(conn), /replica set/i);
  } finally {
    await conn.close(); await standalone.stop();
  }
});
