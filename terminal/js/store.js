/* ==========================================================================
   terminal/js/store.js — Store do terminal: estado de todo o bar + ações do balcão.
   Sem login: cada pedido leva a chave do terminal (terminal/config.js), enviada
   no cabeçalho X-Terminal-Key. Tem de ser igual a TERMINAL_KEY em server/.env.
   ========================================================================== */

const TERMINAL_KEY = (window.BREAKPLUS_CONFIG || {}).terminalKey || '';

const terminalRequest = async (path, body) =>
  (await requestJson('/api/terminal' + path, { body, headers: { 'X-Terminal-Key': TERMINAL_KEY } })).data;

const Store = createStore({
  request: terminalRequest,
  statePath: '/state',
  onConnection: (ok, reason) => showConnection(ok, reason),      // em terminal/js/ui.js
  actions: ({ post }) => ({
    setStatus: (number, status) => post(`/orders/${number}/status`, { status }),
    notify: (number) => post(`/orders/${number}/notify`, {}),
    cancelOrder: (number) => post(`/orders/${number}/cancel`, {}),
    adjustStock: (id, delta) => post(`/stock/${id}`, { delta }),
    setStock: (id, qty) => post(`/stock/${id}`, { set: qty }),
    setPaused: (paused) => post('/paused', { paused }),
  }),
});
