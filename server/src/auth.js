const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User } = require('./models');

const SECRET = process.env.JWT_SECRET;          // obrigatório: index.js recusa arrancar sem ele (config.js)
const MAX_FAILS = 5, LOCK_MIN = 5;

const hash = (secret) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(secret), salt, 32).toString('hex');
};
const verify = (secret, stored) => {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(String(secret), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const sign = (user, scope) =>
  jwt.sign({ sub: String(user._id), scope }, SECRET, { expiresIn: scope === 'pin' ? '5m' : '8h' });

// Middleware: exige sessão completa (password + PIN) de um aluno/docente
const auth = async (req, res, next) => {
  try {
    const raw = (req.headers.authorization || '').replace('Bearer ', '');
    const t = jwt.verify(raw, SECRET);
    if (t.scope !== 'full') throw new Error('scope');
    const user = await User.findById(t.sub);
    if (!user) throw new Error('user');
    req.user = user; next();
  } catch { res.status(401).json({ ok: false, reason: 'unauthenticated' }); }
};

/** Sessão completa de um dos papéis indicados; outro papel → 403. */
const authAs = (roles) => (req, res, next) => auth(req, res, () => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, reason: 'forbidden' });
  next();
});
// Terminal: só funcionárias do bar. App: só alunos e docentes (as funcionárias não pedem nem carregam saldo).
const staffAuth = authAs(['staff']);
const studentAuth = authAs(['student', 'teacher']);

const lockedMin = (u) => (u.lockUntil && u.lockUntil > new Date() ? Math.ceil((u.lockUntil - new Date()) / 60000) : 0);

/* Tentativas de login (password ou PIN). Cada tentativa é reservada de forma atómica ANTES de verificar o
   segredo: pedidos em paralelo nunca conseguem mais do que MAX_FAILS verificações por bloqueio. */

/** Reserva uma tentativa. Devolve o utilizador com o failCount já incrementado, ou null se estiver bloqueado. */
async function takeAttempt(id) {
  const now = new Date();
  await User.updateOne({ _id: id, lockUntil: { $ne: null, $lte: now } }, { lockUntil: null, failCount: 0 });   // bloqueio expirado
  return User.findOneAndUpdate({ _id: id, lockUntil: null, failCount: { $lt: MAX_FAILS } }, { $inc: { failCount: 1 } }, { new: true })
    .select('+failCount +lockUntil');
}

/** Minutos que faltam do bloqueio (para a resposta 'locked'); se ainda não foi gravado, a duração inteira. */
async function lockMinutes(id) {
  return lockedMin(await User.findById(id).select('+lockUntil')) || LOCK_MIN;
}

/** Tentativa errada: à MAX_FAILS-ésima bloqueia LOCK_MIN minutos. Devolve os minutos de bloqueio (0 = não bloqueou). */
async function failAttempt(u) {
  if (u.failCount < MAX_FAILS) return 0;
  await User.updateOne({ _id: u._id, lockUntil: null }, { lockUntil: new Date(Date.now() + LOCK_MIN * 60000), failCount: 0 });
  return LOCK_MIN;
}
const publicUser = (u) => ({ id: u._id, name: u.name, role: u.role, roleLabel: u.roleLabel, email: u.email, avatar: u.avatar || '' });

module.exports = { hash, verify, sign, auth, staffAuth, studentAuth, takeAttempt, failAttempt, lockMinutes, publicUser, SECRET, MAX_FAILS };
