require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const { loadConfig } = require('./config');

let config;
try { config = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }

const { createApp } = require('./app');
const { assertReplicaSet } = require('./db');
const realtime = require('./realtime');

(async () => {
  await mongoose.connect(config.mongoUri);
  await assertReplicaSet();
  if (!config.corsOrigins.length) console.warn('Aviso: CORS_ORIGINS vazio, nenhuma página noutra origem consegue usar a API.');
  const commit = process.env.RENDER_GIT_COMMIT;
  const server = http.createServer(createApp(config));
  realtime.attach(server, config);
  server.listen(config.port, () => console.log('API em http://localhost:' + config.port + (commit ? ' (commit ' + commit.slice(0, 7) + ')' : '')));
})().catch((e) => { console.error(e.message); process.exit(1); });
