/* Configuração lida do ambiente (server/.env). Falha logo no arranque se faltar algo obrigatório. */

const REQUIRED = ['MONGODB_URI', 'JWT_SECRET', 'TERMINAL_KEY'];

function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Falta definir ${missing.join(', ')} em server/.env (ver server/.env.example)`);
  return {
    mongoUri: env.MONGODB_URI,
    terminalKey: env.TERMINAL_KEY,
    // Origens (onde estão as páginas) autorizadas a chamar a API, ex.: http://localhost:8000
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
    port: Number(env.PORT) || 3000,
  };
}

module.exports = { loadConfig };
