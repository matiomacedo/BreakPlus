/* ==========================================================================
   scripts/build-config.js — build estático para a Vercel.

   Gera as configurações a partir das variáveis de ambiente e copia só o
   frontend para dist/, sem servidor, sem .env e sem chaves no repositório.

   Variáveis (Vercel → Settings → Environment Variables):
     BREAKPLUS_API_URL  ex.: https://breakplus.onrender.com
     TERMINAL_KEY       a mesma chave TERMINAL_KEY do Render

   Nota: a chave do terminal fica visível no JavaScript servido ao browser
   (é assim que o terminal funciona). Protege o URL do terminal.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const apiUrl = String(process.env.BREAKPLUS_API_URL || '').trim().replace(/\/+$/, '');
const terminalKey = String(process.env.TERMINAL_KEY || '').trim();

if (!apiUrl) {
  console.error('Falta BREAKPLUS_API_URL (ex.: https://breakplus.onrender.com).');
  process.exit(1);
}
if (!terminalKey) {
  console.error('Falta TERMINAL_KEY (a mesma chave configurada no Render).');
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
// O terminal/config.js local (com a chave real) nunca é copiado: é gerado abaixo.
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
write(path.join(dist, 'terminal', 'config.js'), configFile([
  ['terminalKey', terminalKey],
  ['apiUrl', apiUrl],
]));

console.log(`Build Vercel ok: dist/ gerado para ${apiUrl}`);
