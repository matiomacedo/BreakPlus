const mongoose = require('mongoose');

/** Corre `fn(session)` numa transação MongoDB (precisa de replica set: Atlas ou mongod --replSet). */
const inTx = async (fn) => {
  const s = await mongoose.startSession();
  try { let out; await s.withTransaction(async () => { out = await fn(s); }); return out; } finally { s.endSession(); }
};

/** As transações só funcionam num replica set. Falha no arranque com uma mensagem clara num mongod standalone. */
async function assertReplicaSet(conn = mongoose.connection) {
  const hello = await conn.db.admin().command({ hello: 1 });
  if (hello.setName || hello.msg === 'isdbgrid') return;
  throw new Error('O MongoDB não é um replica set: os pedidos usam transações. Usa o Atlas, ou arranca o mongod com '
    + '--replSet rs0 e corre uma vez rs.initiate() no mongosh (ver server/README.md).');
}

module.exports = { inTx, assertReplicaSet };
