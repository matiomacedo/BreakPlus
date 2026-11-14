/* Ambiente de teste: MongoDB em memória como replica set (as transações precisam dele).
   Define as variáveis de ambiente ANTES de carregar o código da app, para nunca
   usar o server/.env (que aponta para a base de dados real). */
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.TERMINAL_KEY = 'chave-do-terminal-de-teste';
process.env.CORS_ORIGINS = 'http://localhost:8000';

const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let replSet, server, base;

async function startServer() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replSet.getUri('breakplus-test');
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = require('../src/app');
  const { loadConfig } = require('../src/config');
  await new Promise((resolve) => { server = createApp(loadConfig()).listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await replSet.stop();
}

/** Base de dados limpa com 2 produtos, 2 alunos e as definições do bar. */
async function resetData() {
  const { User, Product, Order, Transaction, Setting } = require('../src/models');
  const { hash } = require('../src/auth');
  await Promise.all([User, Product, Order, Transaction, Setting].map((m) => m.deleteMany({})));
  await Product.insertMany([
    { itemId: 1, name: 'Tosta', price: 2.2, stock: 10 },
    { itemId: 2, name: 'Croissant', price: 1.6, stock: 3 },
  ]);
  await User.create([
    { name: 'Gonçalo Silva', role: 'student', email: 'aluno@demo.pt', passwordHash: hash('demo1234'), pinHash: hash('1234'), balance: 12.5, avatar: '/ProfilePictureUser/goncalo.svg' },
    { name: 'Ana Costa', role: 'teacher', roleLabel: 'Docente', email: 'ana@demo.pt', passwordHash: hash('demo1234'), pinHash: hash('4321'), balance: 8, avatar: 'ana.svg' },
  ]);
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

const terminal = (path, opts = {}) =>
  call('/api/terminal' + path, { ...opts, headers: { 'X-Terminal-Key': process.env.TERMINAL_KEY, ...opts.headers } });

module.exports = { startServer, stopServer, resetData, call, login, terminal };
