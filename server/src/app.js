/* Monta a API (sem ligar à base de dados nem abrir a porta: isso é em index.js). */
const express = require('express'), cors = require('cors');
const { studentRouter } = require('./student');
const { terminalRouter } = require('./terminal');

function createApp(config) {
  const app = express();
  app.use(cors({ origin: config.corsOrigins })); app.use(express.json());
  app.use('/api/terminal', terminalRouter(config));
  app.use('/api', studentRouter());
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, reason: 'not_found' }));
  return app;
}

module.exports = { createApp };
