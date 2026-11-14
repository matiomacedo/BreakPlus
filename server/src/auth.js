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

const lockedMin = (u) => (u.lockUntil && u.lockUntil > new Date() ? Math.ceil((u.lockUntil - new Date()) / 60000) : 0);
async function registerFail(u) {
  u.failCount += 1;
  if (u.failCount >= MAX_FAILS) { u.lockUntil = new Date(Date.now() + LOCK_MIN * 60000); u.failCount = 0; }
  await u.save();
}
const publicUser = (u) => ({ id: u._id, name: u.name, role: u.role, roleLabel: u.roleLabel, email: u.email, avatar: u.avatar || '' });

module.exports = { hash, verify, sign, auth, lockedMin, registerFail, publicUser, SECRET, MAX_FAILS };
