/* ==========================================================================
   terminal/js/app.js — o que acontece quando a funcionária toca em algo.
   Cada botão no HTML tem data-act="nome"; a ação está em ACTIONS.
   Para adicionar uma funcionalidade: cria a ação aqui e usa data-act="..."
   no botão (os data-* chegam como argumento `d`).
   ========================================================================== */

const orderOf = (number) => Store.get().orders.find((o) => o.number === +number);

const ACTIONS = {

  /* --- Navegação --- */
  'tab': (d) => showTab(d.tab),
  'goto-orders': () => showTab('orders'),

  /* --- Fila de pedidos --- */

  // Avança para o passo seguinte: recebido → a preparar → pronto → entregue
  'advance': (d, el) => {
    const o = orderOf(d.number);
    if (!o) return;
    if (o.status === 'received')  return void Store.setStatus(o.number, 'preparing');
    if (o.status === 'preparing') {
      Store.setStatus(o.number, 'ready');
      return toast(`Pedido #${o.number} pronto`, `${o.customer} foi avisado na app. Chamada ativa no balcão.`);
    }
    // entregue: o cartão desvanece-se e depois sai da fila
    const card = el.closest('.order');
    if (card) card.classList.add('leaving');
    setTimeout(() => {
      Store.setStatus(o.number, 'done');
      toast(`Pedido #${o.number} entregue`, 'Passou para o histórico recente.');
    }, card ? 280 : 0);
  },

  'notify': (d) => {
    Store.notify(+d.number);
    toast('Senha chamada outra vez', `Aviso reenviado ao ecrã e à app de ${orderOf(d.number).customer}.`);
  },

  // Cancelar um pedido da fila ou uma reserva (devolve o saldo e repõe o stock)
  'cancel': (d) => {
    const o = orderOf(d.number);
    if (!o) return;
    openConfirm({
      title: `Cancelar ${o.type === 'reservation' ? 'reserva' : 'pedido'} #${o.number}?`,
      text: `Devolve ${eur(o.total)} a ${o.customer} e repõe o stock.`,
      okLabel: 'Cancelar e reembolsar',
      onOk: () => {
        Store.cancelOrder(o.number);
        toast(`#${o.number} cancelado`, `${eur(o.total)} devolvidos a ${o.customer}.`);
      },
    });
  },

  // Anular um pedido já entregue (engano)
  'undo': (d) => {
    const o = orderOf(d.number);
    if (!o) return;
    openConfirm({
      title: `Anular pedido #${o.number}?`,
      text: `Devolve ${eur(o.total)} a ${o.customer} e repõe os produtos no stock.`,
      okLabel: 'Anular pedido',
      onOk: () => {
        Store.cancelOrder(o.number);
        toast(`Pedido #${o.number} anulado`, `${eur(o.total)} devolvidos · stock reposto.`);
      },
    });
  },

  /* --- Reservas --- */
  'start-reservation': (d) => {
    const o = orderOf(d.number);
    Store.setStatus(+d.number, 'preparing');
    toast(`Reserva #${d.number} na fila`, `${o.customer} foi avisado de que a preparação começou.`);
  },

  /* --- Stock --- */
  'stock-adjust': (d) => Store.adjustStock(+d.id, +d.delta),
  'stock-toggle': (d) => {
    const qty = Store.get().stock[d.id] ?? 0;
    const name = findItem(d.id).name;
    if (qty > 0) { Store.setStock(+d.id, 0); toast('Produto esgotado', `${name} já não aparece como disponível na app.`); }
    else         { Store.setStock(+d.id, 10); toast('Produto reativado (+10)', `${name} está outra vez disponível na app.`); }
  },

  /* --- Terminal --- */
  'pause': () => {
    const paused = !Store.get().paused;
    Store.setPaused(paused);
    toast(paused ? 'Pedidos na hora em pausa' : 'Balcão aberto', paused ? 'Os alunos só podem reservar até retomares.' : 'Os pedidos na hora voltaram a entrar.');
  },
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
    if (action) action(el.dataset, el);
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
    label.textContent = (i === +input.value ? '● ' : '') + STEP_LABEL[STEPS[i]];
  });
});

// Ao largar: grava o novo estado
document.addEventListener('change', (event) => {
  const input = event.target.closest('.speed-input');
  if (!input) return;
  ui.dragging = false;
  Store.setStatus(+input.dataset.number, STEPS[+input.value]);
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

// Sem login: o terminal abre logo na fila (a chave do terminal vai em cada pedido).
(async () => {
  await Store.start();
  Store.subscribe(render); render(); showTab('orders');
  setInterval(() => { tickTimes(); renderTopbar(); }, 15000);   // relógio e "Há N min"
})();
