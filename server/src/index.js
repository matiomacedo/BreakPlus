require('dotenv').config();
const mongoose = require('mongoose');
const { loadConfig } = require('./config');

let config;
try { config = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }

const { createApp } = require('./app');
const { assertReplicaSet } = require('./db');

(async () => {
  await mongoose.connect(config.mongoUri);
  await assertReplicaSet();
  if (!config.corsOrigins.length) console.warn('Aviso: CORS_ORIGINS vazio, nenhuma página noutra origem consegue usar a API.');
  createApp(config).listen(config.port, () => console.log('API em http://localhost:' + config.port));
})().catch((e) => { console.error(e.message); process.exit(1); });
