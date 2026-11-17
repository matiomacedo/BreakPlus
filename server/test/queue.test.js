/* Fila com prioridade justa (shared/queue.js): regras que não podem regredir. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Queue = require('../../shared/queue');

const ITEMS = [
  { id: 1, name: 'Café', category: 'Bebidas', complexity: 1, prepMin: 1 },
  { id: 2, name: 'Tosta', category: 'Tostas & Snacks', complexity: 4, prepMin: 4 },
  { id: 3, name: 'Sumo', category: 'Bebidas', complexity: 3, prepMin: 3 },
];

/* Hora fixa: os testes não dependem do relógio nem do fuso. */
const NOW = Date.UTC(2026, 0, 5, 10, 0, 0);

const order = (id, minutesAgo, items, extra = {}) => ({
  order_id: id,
  created_at: NOW - minutesAgo * 60000,
  items,
  total_quantity: Object.values(items).reduce((sum, qty) => sum + qty, 0),
  ...extra,
});

const rank = (orders, options = {}) => Queue.rankOrders(orders, {
  items: ITEMS, current_time: NOW, context: 'low', ...options,
});

test('a espera pesa mais do que a simplicidade: 10 min à frente de um pedido novo', () => {
  const ranked = rank([order('novo', 0, { 1: 1 }), order('antigo', 10, { 2: 1 })]);
  assert.deepEqual(ranked.map((row) => row.order_id), ['antigo', 'novo']);
});

test('em hora de ponta, um pedido simples passa à frente de um complexo ligeiramente mais antigo', () => {
  const orders = [order('complexo', 2, { 2: 1 }), order('simples', 1, { 1: 1 })];
  assert.equal(rank(orders, { context: 'low' })[0].order_id, 'complexo');
  assert.equal(rank(orders, { context: 'peak_rush' })[0].order_id, 'simples');
});

test('pedido grande espera enquanto é recente, mas a penalização desaparece com a espera', () => {
  const recent = rank([order('grande', 0, { 1: 6 }), order('pequeno', 0, { 1: 1 })], { context: 'peak_rush' });
  assert.equal(recent[0].order_id, 'pequeno');

  const old = rank([order('grande', 13, { 1: 6 }), order('pequeno', 0, { 1: 1 })], { context: 'peak_rush' });
  assert.equal(old[0].order_id, 'grande');
});

test('a partir de 12 min nenhum pedido fica atrás, mesmo sendo grande e complexo', () => {
  const ranked = rank([
    order('enorme', 13, { 2: 6 }),
    order('rapido', 5, { 1: 1 }),
  ], { context: 'peak_rush' });
  assert.equal(ranked[0].order_id, 'enorme');
  assert.match(ranked[0].reasoning, /anti-inanição/);
});

test('agrupa pedidos com o mesmo produto quando a prioridade é próxima', () => {
  const row = (id, score, dominantId, dominantName) => ({
    order: { order_id: id },
    order_id: id,
    score,
    ageMin: 0,
    profile: { dominantId, dominantName },
    batchGroup: null,
    batchedWith: null,
  });

  const grouped = Queue.groupBatches([
    row('A', 100, '1', 'Café'),
    row('B', 95, '2', 'Tosta'),
    row('C', 92, '1', 'Café'),
  ]);
  assert.deepEqual(grouped.map((item) => item.order_id), ['A', 'C', 'B']);
  assert.equal(grouped[1].batchedWith.order_id, 'A');
});

test('não agrupa quando a diferença de prioridade é grande (equidade primeiro)', () => {
  const row = (id, score, dominantId) => ({
    order: { order_id: id },
    order_id: id,
    score,
    ageMin: 0,
    profile: { dominantId, dominantName: 'Café' },
    batchGroup: null,
    batchedWith: null,
  });

  const grouped = Queue.groupBatches([
    row('A', 100, '1'),
    row('B', 95, '2'),
    row('C', 80, '1'),
  ]);
  assert.deepEqual(grouped.map((item) => item.order_id), ['A', 'B', 'C']);
});

test('empate: o mais antigo e depois o número mais baixo', () => {
  const ranked = rank([order('10', 3, { 1: 1 }), order('9', 3, { 1: 1 })]);
  assert.deepEqual(ranked.map((row) => row.order_id), ['9', '10']);
});

test('respeita complexity_score e total_quantity vindos do payload', () => {
  const lookup = new Map([['1', { name: 'Café', category: 'Bebidas', complexity: 1, prepMin: 1 }]]);
  const profile = Queue.profileOf({ items: { 1: 1 }, complexity_score: 5, total_quantity: 9 }, lookup);
  assert.equal(profile.complexity, 5);
  assert.equal(profile.qty, 9);
});

test('sort devolve o formato pedido, com posições e justificação', () => {
  const result = Queue.sort({
    current_time: NOW,
    context: 'low',
    items: ITEMS,
    orders: [order('a', 0, { 1: 1 }), order('b', 4, { 2: 1 })],
  });

  assert.equal(result.sorted_queue.length, 2);
  assert.deepEqual(result.sorted_queue.map((row) => row.position), [1, 2]);
  assert.equal(typeof result.sorted_queue[0].reasoning, 'string');
  assert.ok(result.sorted_queue[0].reasoning.length > 0);
  assert.equal(result.context, 'low');
  assert.ok(result.diagnostics);
});

test('contexto do dia: normal, hora de ponta e fecho', () => {
  assert.equal(Queue.contextAt(new Date(2026, 0, 5, 10, 0)), 'low');
  assert.equal(Queue.contextAt(new Date(2026, 0, 5, 12, 30)), 'peak_rush');
  assert.equal(Queue.contextAt(new Date(2026, 0, 5, 18, 0)), 'peak_rush');
  assert.equal(Queue.contextAt(new Date(2026, 0, 5, 19, 30)), 'closing');
});
