/* ==========================================================================
   terminal/js/store.js — Store do terminal: estado de todo o bar + ações do balcão.
   Cada pedido leva o token da funcionária com sessão iniciada (../js/auth.js).
   ========================================================================== */

const terminalRequest = (path, body) => Auth.api('/api/terminal' + path, body);

const Store = createStore({
  request: terminalRequest,
  menuPath: '/menu',
  statePath: '/state',
  socketAuth: () => ({ token: Auth.token() }),
  onConnection: (ok, reason) => showConnection(ok, reason),      // em terminal/js/ui.js
  actions: ({ post }) => ({
    setStatus: (id, status) => post(`/orders/${id}/status`, { status }),
    notify: (id) => post(`/orders/${id}/notify`, {}),
    cancelOrder: (id) => post(`/orders/${id}/cancel`, {}),
    adjustStock: (id, delta) => post(`/stock/${id}`, { delta }),
    setStock: (id, qty) => post(`/stock/${id}`, { set: qty }),
    setPaused: (paused) => post('/paused', { paused }),
  }),
});
