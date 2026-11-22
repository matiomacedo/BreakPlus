/* ==========================================================================
   js/store.js — Store da app dos alunos: o estado do servidor (shared/api.js)
   pedido com o token de sessão (js/auth.js) + as ações que um aluno pode fazer.
   ========================================================================== */

const Store = createStore({
  request: Auth.api,
  statePath: '/api/state',
  cacheKey: 'bp_state_student',
  onConnection: (ok, reason) => setConnection(ok, reason),
  actions: ({ post, withOrder }) => ({
    // A hora de levantamento (pickupAt) é calculada no servidor a partir do dia e da hora.
    placeOrder: async (p) => withOrder(await post('/api/orders', { type: p.type, items: p.items, pickupKey: p.pickupKey, pickupTime: p.pickupTime })),
    cancelOrder: async (number) => withOrder(await post(`/api/orders/${number}/cancel`, {})),
    topup: (amount) => post('/api/wallet/topup', { amount }),
  }),
});
