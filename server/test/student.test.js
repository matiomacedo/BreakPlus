/* App dos alunos: comportamento que tem de continuar igual. */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, resetData, call, login } = require('./helpers');
const { clock, lisbonDateKey, lisbonEpoch } = require('../src/time');
const { pickupAtFor } = require('../src/student');

const realNow = clock.now;
before(startServer);
after(async () => { clock.now = realNow; await stopServer(); });
// As reservas dependem da hora: o servidor "está" hoje às 10:00 (Lisboa) em todos os testes.
beforeEach(async () => { clock.now = () => at('10:00'); await resetData(); });

const todayKey = () => lisbonDateKey(Date.now());
const at = (hhmm) => lisbonEpoch(todayKey(), hhmm);
const keyInDays = (days) => lisbonDateKey(Date.now() + days * 86400000);
const reservation = (pickupTime = '18:00', items = { 1: 1 }) => ({
  type: 'reservation', items, pickupKey: todayKey(), pickupTime,
});

test('login em 2 passos: password certa e PIN certo dão um token de sessão', async () => {
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  assert.equal(s1.body.ok, true);
  const s2 = await call('/api/auth/pin', { body: { preToken: s1.body.preToken, pin: '1234' } });
  assert.equal(s2.body.ok, true);
  assert.equal(s2.body.user.email, 'aluno@demo.pt');
});

test('o avatar vem no login e em /api/auth/me (URL completo ou só o nome)', async () => {
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  const s2 = await call('/api/auth/pin', { body: { preToken: s1.body.preToken, pin: '1234' } });
  assert.equal(s2.body.user.avatar, '/ProfilePictureUser/goncalo.svg');
  const me = await call('/api/auth/me', { token: s2.body.token });
  assert.equal(me.body.user.avatar, '/ProfilePictureUser/goncalo.svg');

  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const anaMe = await call('/api/auth/me', { token: ana });
  assert.equal(anaMe.body.user.avatar, 'ana.svg');       // o cliente acrescenta a pasta
});

test('PIN errado é recusado e diz quantas tentativas faltam', async () => {
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  const s2 = await call('/api/auth/pin', { body: { preToken: s1.body.preToken, pin: '0000' } });
  assert.equal(s2.status, 401);
  assert.deepEqual([s2.body.reason, s2.body.attemptsLeft], ['pin', 4]);
});

test('depois de um bloqueio expirado, o PIN errado conta tentativas de novo (não diz bloqueada)', async () => {
  const { User } = require('../src/models');
  await User.updateOne({ email: 'aluno@demo.pt' }, { lockUntil: new Date(Date.now() - 60000), failCount: 0 });
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  const s2 = await call('/api/auth/pin', { body: { preToken: s1.body.preToken, pin: '0000' } });
  assert.equal(s2.status, 401);
  assert.deepEqual([s2.body.reason, s2.body.attemptsLeft], ['pin', 4]);
});

test('a 5.ª tentativa de PIN errada bloqueia e devolve os minutos', async () => {
  const s1 = await call('/api/auth/login', { body: { email: 'aluno@demo.pt', password: 'demo1234' } });
  let r;
  for (let i = 0; i < 5; i++) r = await call('/api/auth/pin', { body: { preToken: s1.body.preToken, pin: '0000' } });
  assert.equal(r.status, 429);
  assert.deepEqual([r.body.reason, r.body.minutes], ['locked', 5]);
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

test('o primeiro pedido do dia recebe a senha 1 e as seguintes sobem; o número único continua a crescer', async () => {
  const token = await login();
  const a = (await call('/api/orders', { token, body: { type: 'now', items: { 1: 1 } } })).body.order;
  const b = (await call('/api/orders', { token, body: { type: 'now', items: { 1: 1 } } })).body.order;
  assert.deepEqual([a.ticket, b.ticket, a.ticketDay], [1, 2, lisbonDateKey()]);
  assert.deepEqual([a.number, b.number], [101, 102]);
});

test('num dia novo a senha recomeça em 1', async () => {
  const { Setting } = require('../src/models');
  await Setting.updateOne({ _id: 'bar' }, { ticketDay: '2000-01-01', lastTicket: 57, lastNumber: 400 });
  const token = await login();
  const r = await call('/api/orders', { token, body: { type: 'now', items: { 1: 1 } } });
  assert.deepEqual([r.body.order.ticket, r.body.order.number], [1, 401]);
  const s = await call('/api/state', { token });
  assert.equal(s.body.wallet.transactions[0].ticket, 1);               // o movimento mostra a senha
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
  const { body } = await call('/api/orders', { token, body: reservation() });
  const r = await call(`/api/orders/${body.order._id}/cancel`, { token, body: {} });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.order.cancelledBy, 'student');
  const s = await call('/api/state', { token });
  assert.deepEqual([s.body.wallet.balance, s.body.stock[1]], [12.5, 10]);
});

test('o aluno não cancela uma reserva a menos de 30 min', async () => {
  const token = await login();
  const { body } = await call('/api/orders', { token, body: reservation('10:30') });
  clock.now = () => at('10:10');                          // faltam 20 min
  const r = await call(`/api/orders/${body.order._id}/cancel`, { token, body: {} });
  assert.equal(r.body.reason, 'window');
});

test('o aluno não cancela reservas de outra pessoa', async () => {
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  const { body } = await call('/api/orders', { token: ana, body: reservation() });
  const r = await call(`/api/orders/${body.order._id}/cancel`, { token: await login(), body: {} });
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

test('reserva para hoje depois das 18:00 é recusada (limite do dia atual)', async () => {
  const token = await login();
  const r = await call('/api/orders', {
    token,
    body: { type: 'reservation', items: { 1: 1 }, pickupKey: todayKey(), pickupTime: '18:30' },
  });
  assert.deepEqual([r.status, r.body.reason], [400, 'pickup']);
});

test('reserva para hoje até às 18:00 é aceite', async () => {
  const token = await login();
  const r = await call('/api/orders', {
    token,
    body: { type: 'reservation', items: { 1: 1 }, pickupKey: todayKey(), pickupTime: '18:00' },
  });
  assert.equal(r.body.ok, true);
});

for (const [time, why] of [['12:15', 'fora da grelha de 30 min'], ['21:00', 'depois do fecho'], ['07:30', 'antes da abertura'], ['10:00', 'sem antecedência']]) {
  test(`pickupAtFor recusa ${time} (${why})`, () => {
    assert.equal(pickupAtFor(todayKey(), time, at('09:55')), null);
  });
}

test('pickupAtFor recusa uma hora daqui a 5 min e aceita com 30 min de antecedência', () => {
  assert.equal(pickupAtFor(todayKey(), '12:00', at('11:55')), null);
  assert.equal(pickupAtFor(todayKey(), '12:30', at('12:00')), at('12:30'));
});

test('pickupAtFor recusa um dia daqui a 10 dias', () => {
  assert.equal(pickupAtFor(keyInDays(10), '12:00', at('10:00')), null);
});

test('a hora de levantamento é calculada no servidor (o pickupAt do cliente é ignorado)', async () => {
  const token = await login();
  const r = await call('/api/orders', { token, body: { ...reservation('12:30'), pickupAt: 1 } });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.order.pickupAt, at('12:30'));
});

test('reserva para outro dia é recusada (só se reserva para hoje)', async () => {
  const token = await login();
  const r = await call('/api/orders', {
    token,
    body: { type: 'reservation', items: { 1: 1 }, pickupKey: keyInDays(1), pickupTime: '10:00' },
  });
  assert.deepEqual([r.status, r.body.reason], [400, 'pickup']);
});

for (const [pickupKey, pickupTime] of [['2099-01-01', '<img src=x onerror=alert(1)>'], ['<b>x</b>', '10:00'], ['2099-1-1', '10:00'], ['2099-01-01', '25:00']]) {
  test(`reserva com dia/hora inválidos (${pickupKey} ${pickupTime}) é recusada (não chega ao terminal)`, async () => {
    const r = await call('/api/orders', { token: await login(), body: { type: 'reservation', items: { 1: 1 }, pickupKey, pickupTime } });
    assert.deepEqual([r.status, r.body.reason], [400, 'pickup']);
  });
}

/* ---------- Web Push ---------- */

test('a chave pública VAPID está disponível para o browser subscrever', async () => {
  const r = await call('/api/push/public-key');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.body.key, /^[A-Za-z0-9_-]{40,}$/);
});

test('subscrever e cancelar avisos exige sessão', async () => {
  const sub = { endpoint: 'https://push.example/sub/1', keys: { p256dh: 'abc', auth: 'def' } };
  const without = await call('/api/push/subscribe', { body: { subscription: sub } });
  assert.equal(without.status, 401);
  const cancel = await call('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } });
  assert.equal(cancel.status, 401);
});

test('a subscrição push fica guardada e é removida ao desligar os avisos', async () => {
  const { PushSubscription } = require('../src/models');
  const token = await login();
  const subscription = { endpoint: 'https://push.example/sub/2', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } };

  const saved = await call('/api/push/subscribe', { token, body: { subscription } });
  assert.equal(saved.body.ok, true);
  assert.equal(await PushSubscription.countDocuments({ endpoint: subscription.endpoint }), 1);

  // O mesmo endpoint noutra conta passa a pertencer a essa conta (sem duplicar).
  const ana = await login('ana@demo.pt', 'demo1234', '4321');
  await call('/api/push/subscribe', { token: ana, body: { subscription } });
  assert.equal(await PushSubscription.countDocuments({ endpoint: subscription.endpoint }), 1);

  const removed = await call('/api/push/unsubscribe', { token: ana, body: { endpoint: subscription.endpoint } });
  assert.equal(removed.body.ok, true);
  assert.equal(await PushSubscription.countDocuments({ endpoint: subscription.endpoint }), 0);
});

test('uma subscrição inválida é recusada', async () => {
  const token = await login();
  for (const subscription of [null, {}, { endpoint: 'http://inseguro.example', keys: { p256dh: 'a', auth: 'b' } }, { endpoint: 'https://x.example', keys: { p256dh: '', auth: 'b' } }]) {
    const r = await call('/api/push/subscribe', { token, body: { subscription } });
    assert.deepEqual([r.status, r.body.reason], [400, 'bad_subscription']);
  }
});

test('o estado e o teste de Web Push contam os dispositivos subscritos', async () => {
  const webpush = require('web-push');
  const token = await login();

  const before = await call('/api/push/status', { token });
  assert.equal(before.body.subscriptions, 0);

  const empty = await call('/api/push/test', { token, body: {} });
  assert.equal(empty.body.ok, true);
  assert.equal(empty.body.sent, 0);

  await call('/api/push/subscribe', {
    token,
    body: { subscription: { endpoint: 'https://push.example/sub/test', keys: { p256dh: 'chave', auth: 'auth' } } },
  });
  const after = await call('/api/push/status', { token });
  assert.equal(after.body.subscriptions, 1);

  const sent = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = async (_subscription, payload) => { sent.push(JSON.parse(payload)); return {}; };
  try {
    const test = await call('/api/push/test', { token, body: {} });
    assert.equal(test.body.sent, 1);
  } finally {
    webpush.sendNotification = original;
  }
  assert.equal(sent[0].tag, 'bp-test-push');
});
