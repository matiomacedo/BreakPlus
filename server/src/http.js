/* Ajudantes HTTP comuns às rotas dos alunos e do terminal. */

/** Erro "esperado": vira { ok: false, reason: code, ...extra } com o status indicado (400 por omissão). */
const fail = (code, extra, status) => Object.assign(new Error(code), { code, extra, status });

/** Envolve um handler async: erros com `code` são respostas normais; o resto é 500. */
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch((e) => {
  if (e.code) return res.status(e.status || 400).json({ ok: false, reason: e.code, ...e.extra });
  console.error(e); res.status(500).json({ ok: false, reason: 'server' });
});

module.exports = { fail, wrap };
