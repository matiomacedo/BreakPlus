/* Ambiente de teste: MongoDB em memória como replica set (as transações precisam dele).
   Define as variáveis de ambiente ANTES de carregar o código da app, para nunca
   usar o server/.env (que aponta para a base de dados real). */
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.CORS_ORIGINS = 'http://localhost:8000';

const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let replSet, server, base, staffToken;

async function startServer() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replSet.getUri('breakplus-test');
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = require('../src/app');
  const { loadConfig } = require('../src/config');
  const realtime = require('../src/realtime');
  server = require('http').createServer(createApp(loadConfig()));
  realtime.attach(server, loadConfig());
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await replSet.stop();
}

/** Base de dados limpa com 2 produtos, 2 alunos, 1 funcionária do bar e as definições do bar. */
async function resetData() {
  const { User, Product, Order, Transaction, PushSubscription, Setting } = require('../src/models');
  const { hash } = require('../src/auth');
  await Promise.all([User, Product, Order, Transaction, PushSubscription, Setting].map((m) => m.deleteMany({})));
  await Product.insertMany([
    { itemId: 1, name: 'Tosta', price: 2.2, stock: 10 },
    { itemId: 2, name: 'Croissant', price: 1.6, stock: 3 },
  ]);
  await User.create([
    { name: 'Gonçalo Silva', role: 'student', email: 'aluno@demo.pt', passwordHash: hash('demo1234'), pinHash: hash('1234'), balance: 12.5, avatar: '/ProfilePictureUser/goncalo.svg' },
    { name: 'Ana Costa', role: 'teacher', roleLabel: 'Docente', email: 'ana@demo.pt', passwordHash: hash('demo1234'), pinHash: hash('4321'), balance: 8, avatar: 'ana.svg' },
    { name: 'Rosa Ferreira', role: 'staff', roleLabel: 'Funcionária', email: 'bar@demo.pt', passwordHash: hash('demo1234'), pinHash: hash('9999') },
  ]);
  staffToken = null;
  await Setting.create({ _id: 'bar', paused: false, lastNumber: 100 });
}

/** fetch → { status, body } */
async function call(path, { method, body, token, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

/** Login completo (password + PIN) → token. */
async function login(email = 'aluno@demo.pt', password = 'demo1234', pin = '1234') {
  const s1 = await call('/api/auth/login', { body: { email, password } });
  const s2 = await call('/api/auth/pin', { body: { preToken: s1.body.preToken, pin } });
  return s2.body.token;
}

/** Token de sessão da funcionária do bar (gerado direto, para não repetir o login em cada pedido). */
async function staff() {
  if (!staffToken) {
    const { User } = require('../src/models');
    const { sign } = require('../src/auth');
    staffToken = sign(await User.findOne({ email: 'bar@demo.pt' }), 'full');
  }
  return staffToken;
}

/** Pedido ao terminal com a sessão da funcionária (ou outro `token`, se for dado). */
const terminal = async (path, opts = {}) =>
  call('/api/terminal' + path, { token: 'token' in opts ? opts.token : await staff(), ...opts });

/** Endereço do servidor de teste (para ligar sockets). */
const baseUrl = () => base;

module.exports = { staff, baseUrl, startServer, stopServer, resetData, call, login, terminal };
