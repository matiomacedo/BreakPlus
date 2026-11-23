/* ==========================================================================
   terminal/js/app.js — o que acontece quando a funcionária toca em algo.
   Cada botão no HTML tem data-act="nome"; a ação está em ACTIONS.
   Para adicionar uma funcionalidade: cria a ação aqui e usa data-act="..."
   no botão (os data-* chegam como argumento `d`).
   ========================================================================== */

const orderOf = (number) => Store.get().orders.find((o) => o.number === +number);
const writeFailed = (r) => !r || r.ok === false;
const writeError = () => toast('Não foi possível gravar', 'O servidor não respondeu. Tenta outra vez.');

const ACTIONS = {

  /* --- Navegação --- */
  'tab': (d) => showTab(d.tab),
  'goto-orders': () => showTab('orders'),

  /* --- Fila de pedidos --- */

  // Avança para o passo seguinte: recebido → a preparar → pronto → entregue
  'advance': guarded((d) => 'advance:' + d.number, async (d, el) => {
    const o = orderOf(d.number);
    if (!o) return;
    if (o.status === 'received' || o.status === 'preparing') {
      const next = o.status === 'received' ? 'preparing' : 'ready';
      if (writeFailed(await Store.setStatus(o._id, next))) return writeError();
      if (next === 'ready') toast(`Pedido #${o.ticket} pronto`, `${o.customer} foi avisado na app. Chamada ativa no balcão.`);
      return;
    }
    // entregue: o cartão desvanece-se e depois sai da fila
    const card = el.closest('.order');
    if (card) card.classList.add('leaving');
    await new Promise((resolve) => setTimeout(resolve, card ? 280 : 0));
    if (writeFailed(await Store.setStatus(o._id, 'done'))) return writeError();
    toast(`Pedido #${o.ticket} entregue`, 'Passou para o histórico recente.');
  }),

  'notify': guarded((d) => 'notify:' + d.number, async (d) => {
    const o = orderOf(d.number);
    if (!o) return;
    if (writeFailed(await Store.notify(o._id))) return writeError();
    toast('Senha chamada outra vez', `Aviso reenviado ao ecrã e à app de ${o.customer}.`);
  }),

  // Cancelar um pedido da fila ou uma reserva (devolve o saldo e repõe o stock)
  'cancel': (d) => {
    const o = orderOf(d.number);
    if (!o) return;
    openConfirm({
      title: `Cancelar ${o.type === 'reservation' ? 'reserva' : 'pedido'} #${o.ticket}?`,
      text: `Devolve ${eur(o.total)} a ${o.customer} e repõe o stock.`,
      okLabel: 'Cancelar e reembolsar',
      onOk: guarded(() => 'cancel:' + o.number, async () => {
        if (writeFailed(await Store.cancelOrder(o._id))) return writeError();
        toast(`#${o.ticket} cancelado`, `${eur(o.total)} devolvidos a ${o.customer}.`);
      }),
    });
  },

  // Anular um pedido já entregue (engano)
  'undo': (d) => {
    const o = orderOf(d.number);
    if (!o) return;
    openConfirm({
      title: `Anular pedido #${o.ticket}?`,
      text: `Devolve ${eur(o.total)} a ${o.customer} e repõe os produtos no stock.`,
      okLabel: 'Anular pedido',
      onOk: guarded(() => 'cancel:' + o.number, async () => {
        if (writeFailed(await Store.cancelOrder(o._id))) return writeError();
        toast(`Pedido #${o.ticket} anulado`, `${eur(o.total)} devolvidos · stock reposto.`);
      }),
    });
  },

  /* --- Reservas --- */
  'start-reservation': guarded((d) => 'reservation:' + d.number, async (d) => {
    const o = orderOf(d.number);
    if (!o) return;
    if (writeFailed(await Store.setStatus(o._id, 'preparing'))) return writeError();
    toast(`Reserva #${o.ticket} na fila`, `${o.customer} foi avisado de que a preparação começou.`);
  }),

  /* --- Stock --- */
  'stock-adjust': guarded((d) => 'stock:' + d.id, async (d) => {
    if (writeFailed(await Store.adjustStock(+d.id, +d.delta))) writeError();
  }),
  'stock-toggle': guarded((d) => 'stock:' + d.id, async (d) => {
    const qty = Store.get().stock[d.id] ?? 0;
    const name = findItem(d.id)?.name || 'Produto';
    const out = qty > 0;
    if (writeFailed(await Store.setStock(+d.id, out ? 0 : 10))) return writeError();
    toast(out ? 'Produto esgotado' : 'Produto reativado (+10)',
      out ? `${name} já não aparece como disponível na app.` : `${name} está outra vez disponível na app.`);
  }),

  /* --- Terminal --- */
  'pause': guarded(() => 'pause', async () => {
    const paused = !Store.get().paused;
    if (writeFailed(await Store.setPaused(paused))) return writeError();
    toast(paused ? 'Pedidos na hora em pausa' : 'Balcão aberto', paused ? 'Os alunos só podem reservar até retomares.' : 'Os pedidos na hora voltaram a entrar.');
  }),
  'logout': () => Auth.logout(),
  'fullscreen': () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  },

  /* --- Confirmação --- */
  'modal-close': () => closeConfirm(),
  'modal-ok': () => { const run = confirmCallback; closeConfirm(); if (run) run(); },
};

/* Um único listener para toda a app (event delegation). */
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-act]');
  if (el && !el.disabled) {
    const action = ACTIONS[el.dataset.act];
    if (action) Promise.resolve(action(el.dataset, el)).catch(() => writeError());
    return;
  }
  if (event.target.id === 'modal') closeConfirm();    // clicar no fundo
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeConfirm();
});

/* ---------- Barra de estado (arrastar) ---------- */

const speedOf = (input) => input.closest('.speed');

// Enquanto se arrasta: só mexe na barra, sem gravar nada
document.addEventListener('input', (event) => {
  const input = event.target.closest('.speed-input');
  if (!input) return;
  const speed = speedOf(input);
  speed.style.setProperty('--p', input.value / 2);
  speed.querySelectorAll('.speed-labels span').forEach((label, i) => {
    label.classList.toggle('on', i === +input.value);
    label.innerHTML = (i === +input.value ? '<i class="step-dot"></i>' : '') + STEP_LABEL[STEPS[i]];
  });
});

// Ao largar: grava o novo estado
document.addEventListener('change', (event) => {
  const input = event.target.closest('.speed-input');
  if (!input) return;
  ui.dragging = false;
  const o = orderOf(input.dataset.number);
  if (!o) return;                                   // o pedido pode ter saído da lista entretanto
  const status = STEPS[+input.value];
  guarded((id) => 'speed:' + id, async (id, s) => {
    if (writeFailed(await Store.setStatus(id, s))) writeError();
  })(o._id, status);
});

document.addEventListener('pointerdown', (event) => { if (event.target.closest('.speed-input')) ui.dragging = true; });
const endDrag = () => {
  if (!ui.dragging) return;
  ui.dragging = false;
  if (ui.pending) { ui.pending = false; render(); }
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

/* ---------- Arranque ---------- */

/* A barra de topo pode ficar mais alta com letra maior ou ecrã mais estreito.
   Medir a altura impede que a faixa de pausa e o aviso passem por baixo dela. */
const topbar = document.querySelector('.topbar');
const syncTopbarHeight = () => {
  if (!topbar) return;
  document.documentElement.style.setProperty('--topbar-h', Math.ceil(topbar.getBoundingClientRect().height) + 'px');
};
syncTopbarHeight();
if (topbar && window.ResizeObserver) new ResizeObserver(syncTopbarHeight).observe(topbar);
else window.addEventListener('resize', syncTopbarHeight);

// Login das funcionárias (papel "staff"); só depois se carrega o estado do bar.
// O spinner de arranque é mostrado por Auth.start() apenas se a resposta demorar.
Auth.start({
  key: 'bp_token_staff',
  roles: ['staff'],
  onEnter: async (user) => {
    document.getElementById('staff-name').textContent = user.name;
    await Store.start();
    Store.subscribe(render); render(); showTab('orders');
    // Relógio, "Há N min" e prioridade (a espera muda a ordem sem novos pedidos).
    if (!window.bpTerminalClockTimer) {
      window.bpTerminalClockTimer = setInterval(() => { tickTimes(); renderTopbar(); refreshQueuePriority(); }, 15000);
    }
  },
});
