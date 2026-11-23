/* ==========================================================================
   scripts/build-config.js — build estático para a Vercel.

   Gera as configurações a partir das variáveis de ambiente e copia só o
   frontend para dist/, sem servidor, sem .env e sem chaves no repositório.

   Variáveis (Vercel → Settings → Environment Variables):
     BREAKPLUS_API_URL  ex.: https://breakplus.onrender.com
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const apiUrl = String(process.env.BREAKPLUS_API_URL || '').trim().replace(/\/+$/, '');

if (!apiUrl) {
  console.error('Falta BREAKPLUS_API_URL (ex.: https://breakplus.onrender.com).');
  process.exit(1);
}

/** window.BREAKPLUS_CONFIG = { ... }; */
const configFile = (fields) => [
  'window.BREAKPLUS_CONFIG = {',
  ...fields.map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`),
  '};',
  '',
].join('\n');

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

// Só o que o browser precisa. O servidor e os testes ficam de fora.
// Um terminal/config.js antigo (da chave do terminal, já não usada) nunca é copiado.
fs.rmSync(dist, { recursive: true, force: true });
const localTerminalConfig = path.join(root, 'terminal', 'config.js');
for (const entry of [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'shared',
  'images',
  'icons',
  'ProfilePictureUser',
  'terminal',
]) {
  fs.cpSync(path.join(root, entry), path.join(dist, entry), {
    recursive: true,
    filter: (file) => path.resolve(file) !== localTerminalConfig,
  });
}

write(path.join(dist, 'js', 'config.js'), configFile([['apiUrl', apiUrl]]));

console.log(`Build Vercel ok: dist/ gerado para ${apiUrl}`);
