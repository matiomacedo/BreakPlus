/* Lê shared/data.js (o mesmo ficheiro que o browser usa) para o servidor não ter cópias das regras. */
const fs = require('fs'), path = require('path'), vm = require('vm');

function loadSharedData() {
  const src = fs.readFileSync(path.resolve(__dirname, '..', process.env.DATA_JS || '../shared/data.js'), 'utf8');
  const sandbox = { document: { documentElement: { dataset: {} } }, localStorage: { getItem: () => null, setItem() {} } };
  sandbox.window = sandbox;
  return vm.runInNewContext(src + '\n;({ ITEMS: typeof ITEMS!=="undefined"?ITEMS:[], RESERVATION })', sandbox);
}

module.exports = { loadSharedData };
