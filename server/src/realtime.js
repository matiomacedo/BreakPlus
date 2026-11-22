/* Tempo real (Socket.IO): avisa as apps de que o estado mudou, para não esperarem pelo polling.
   - Alunos/docentes ligam-se com o token de sessão → sala "user:<id>" (só os seus pedidos/saldo).
   - As funcionárias (papel "staff") ligam-se com o token delas → sala "terminal" (todos os pedidos).
   Os eventos não levam dados: cada app volta a pedir o seu /state, que já filtra o que pode ver. */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { SECRET } = require('./auth');
const { User } = require('./models');

let io = null;

function attach(httpServer, { corsOrigins }) {
  io = new Server(httpServer, { cors: { origin: corsOrigins } });
  io.use(async (socket, next) => {
    try {
      const t = jwt.verify(String((socket.handshake.auth || {}).token || ''), SECRET);
      if (t.scope !== 'full') throw new Error('scope');
      const user = await User.findById(t.sub).select('role');
      if (!user) throw new Error('user');
      socket.data.room = user.role === 'staff' ? 'terminal' : 'user:' + t.sub;
      next();
    } catch { next(new Error('unauthenticated')); }
  });
  io.on('connection', (socket) => socket.join(socket.data.room));
  return io;
}

const emit = (rooms, type) => { if (io) io.to(rooms).emit('changed', { type }); };

/** Pedido novo/alterado: o dono e o terminal. */
const orderChanged = (userId, type = 'order') => emit([`user:${userId && userId._id ? userId._id : userId}`, 'terminal'], type);
/** Só o aluno (ex.: carregamento de saldo). */
const userChanged = (userId, type) => emit(`user:${userId}`, type);
/** Toda a gente (stock, pausa). */
const barChanged = (type) => { if (io) io.emit('changed', { type }); };

module.exports = { attach, orderChanged, userChanged, barChanged };
