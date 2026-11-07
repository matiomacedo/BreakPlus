/* ==========================================================================
   app.js — o que acontece quando o utilizador toca em algo, e como a app
   reage ao que o terminal do bar faz (via js/store.js).

   Cada botão no HTML tem data-action="nome"; a ação correspondente está
   em ACTIONS. Para adicionar uma funcionalidade: cria a ação aqui e usa
   data-action="..." no botão (os data-* extra chegam como argumento `d`).
   ========================================================================== */

/** Mudou um filtro: recria a lista com animação e atualiza o painel aberto. */
function onFiltersChanged() {
  renderMenu({ animate: true });
  syncFiltersSheet();
}

const ACTIONS = {

  /* --- Navegação --- */
  'go': (d) => showView(d.view),

  /* --- Filtros --- */
  'open-filters':  () => openFiltersSheet(),
  'set-period':    (d) => { state.period = d.value;   onFiltersChanged(); },
  'set-category':  (d) => { state.category = d.value; onFiltersChanged(); },
  'clear-filters': () => { state.period = 'Todos'; state.category = 'Todos'; onFiltersChanged(); },

  /* --- Produtos e carrinho --- */
  'show-item':   (d) => openItemSheet(findItem(d.id)),
  'add-to-cart': (d, el) => {
    if (canAddMore(d.id) <= 0) return toast(stockOf(d.id) === 0 ? 'Este produto esgotou' : `Só há ${stockOf(d.id)} em stock`);
    state.cart[d.id] = inCart(d.id) + 1;
    renderTray();
    flashAdded(el);
  },
  'open-cart': () => {
    state.checkout.mode = isPaused() ? 'reserve' : 'now';     // com o bar em pausa, sugere reservar
    openCartSheet();
  },
  'change-qty': (d) => {
    if (+d.delta > 0 && canAddMore(d.id) <= 0) return toast(`Só há ${stockOf(d.id)} em stock`);
    state.cart[d.id] += +d.delta;
    if (state.cart[d.id] <= 0) delete state.cart[d.id];
    renderTray();
    refreshCartSheet();
  },

  /* --- Pedir agora / reservar (no painel do carrinho) --- */
  'set-mode': (d) => { state.checkout.mode = d.mode; syncCheckout(); },
  'set-day':  (d) => { state.checkout.day = d.value; state.checkout.time = null; renderSlots(); syncCheckout(); },
  'set-time': (d) => { state.checkout.time = d.value; syncCheckout(); },

  'pay': async () => {
    const total = cartTotal();
    const { mode, day, time } = state.checkout;
    if (!total) return;
    if (mode === 'now' && isPaused()) return toast('O bar pausou os pedidos na hora. Podes reservar.');
    if (total > balance()) return toast('Carrega o saldo para continuar');
    if (mode === 'reserve' && !time) return toast('Escolhe uma hora de levantamento');

    const result = await Store.placeOrder({
      ...ME,
      mine: true,
      type: mode === 'reserve' ? 'reservation' : 'now',
      items: { ...state.cart },
      pickupKey: day,
      pickupTime: time,
    });

    if (!result.ok) {
      if (result.reason === 'stock') {
        // alguém levou o último: ajusta o carrinho ao que ainda há
        for (const id of Object.keys(state.cart)) {
          state.cart[id] = Math.min(state.cart[id], stockOf(id));
          if (state.cart[id] <= 0) delete state.cart[id];
        }
        renderTray();
        refreshCartSheet();
        return toast(`Já não há ${findItem(result.itemId).name} suficiente`);
      }
      if (result.reason === 'paused') { syncCheckout(); return toast('O bar acabou de pausar os pedidos na hora'); }
      return toast('Não foi possível concluir o pedido');
    }

    state.cart = {};
    state.checkout = { mode: 'now', day: null, time: null };
    renderTray();
    openConfirmationSheet(result.order);
  },

  /* --- Pedidos e reservas --- */
  'show-ticket':  (d) => openTicketSheet(d.id),
  'repeat-order': (d) => {
    const order = db().orders.find((o) => o.number == d.id);
    if (!order) return;
    let skipped = false;
    for (const id in order.items) {
      const add = Math.min(order.items[id], Math.max(0, canAddMore(id)));
      if (add < order.items[id]) skipped = true;
      if (add > 0) state.cart[id] = inCart(id) + add;
    }
    showView('bar');
    toast(skipped ? 'Alguns itens esgotaram e não foram adicionados' : 'Pedido adicionado ao carrinho');
  },
  'cancel-reservation': (d) => {
    const order = db().orders.find((o) => o.number == d.id);
    if (order && canCancel(order)) openCancelSheet(order);
    else toast('Já não é possível cancelar esta reserva');
  },
  'confirm-cancel': async (d) => {
    const result = await Store.cancelOrder(+d.id, 'student');
    closeSheet();
    toast(result.ok ? `Reserva cancelada · ${eur(result.order.total)} devolvidos` : 'Já não é possível cancelar esta reserva');
  },

  /* --- Saldo --- */
  'set-topup': (d) => { state.topupAmount = +d.value; syncTopup(); },
  'topup': async () => {
    const r = await Store.topup(state.topupAmount);
    toast(r.ok ? 'Saldo carregado: +' + eur(state.topupAmount) : 'Não foi possível carregar o saldo');
  },

  /* --- Mais --- */
  'toggle-pref': (d, el) => {
    state.prefs[d.key] = !state.prefs[d.key];
    el.classList.toggle('on', state.prefs[d.key]);          // no sítio → o interruptor desliza
    el.setAttribute('aria-checked', state.prefs[d.key]);
  },
  'logout': () => Auth.logout(),

  /* --- Painel --- */
  'close-sheet': () => closeSheet(),
};

/* Um único listener para toda a app (event delegation). */
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (el && !el.disabled) {
    const action = ACTIONS[el.dataset.action];
    if (action) action(el.dataset, el);
    return;
  }
  // Clicar no fundo escuro fecha o painel
  if (event.target.id === 'sheet') closeSheet();
});

// Esc fecha o painel
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSheet();
});


/* ==========================================================================
   Store → ecrã: sempre que algo muda (aqui ou no terminal), redesenha só o
   que mudou e avisa o aluno do que o bar fez.
   ========================================================================== */

const lastSeen = {};          // assinatura do último desenho de cada zona
let lastMine = null;          // estado anterior dos meus pedidos (para detetar mudanças do bar)
let lastTxCount = null;

/** true se `value` for diferente do que desenhámos da última vez. */
function changed(zone, value) {
  const signature = JSON.stringify(value);
  if (lastSeen[zone] === signature) return false;
  lastSeen[zone] = signature;
  return true;
}

const mySignature = () => myOrders().map((o) => [o.number, o.status, o.notifiedAt || 0, o.pickupTime]);

/** Avisa o aluno do que o bar fez aos pedidos dele (pronto, chamada, anulação). */
function announceBarActions() {
  const mine = myOrders();
  if (lastMine) {
    for (const o of mine) {
      const before = lastMine[o.number];
      if (!before) continue;
      if (o.status !== before.status) {
        if (o.status === 'ready' && state.prefs.notifications) {
          toast(`Pedido #${o.number} pronto! Levanta no balcão`, 4000);
          if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
        } else if (o.status === 'preparing' && before.status === 'reserved') {
          toast(`A tua reserva #${o.number} já está a ser preparada`, 3000);
        } else if (o.status === 'cancelled' && o.cancelledBy === 'staff') {
          toast(`Pedido #${o.number} anulado pelo bar · ${eur(o.total)} devolvidos`, 4000);
        }
      } else if ((o.notifiedAt || 0) > before.notified && state.prefs.notifications) {
        toast(`O bar está a chamar a senha #${o.number}`, 4000);
      }
    }
  }
  lastMine = Object.fromEntries(mine.map((o) => [o.number, { status: o.status, notified: o.notifiedAt || 0 }]));
}

function onStoreChange() {
  const d = db();
  renderHeader();
  renderBarInfo();

  if (changed('menu', [d.stock, d.paused])) {
    renderMenu();
    syncCheckout();                       // se o carrinho estiver aberto: botão e nota (pausa)
  }

  if (changed('mine', mySignature())) {
    announceBarActions();
    renderTicketBanner();
    renderReservationBanner();
    renderOrders();
  }

  if (changed('wallet', d.wallet)) {
    renderWallet({ fresh: lastTxCount !== null && d.wallet.transactions.length > lastTxCount });
    syncPayButton();
  }
  lastTxCount = d.wallet.transactions.length;
}

/** Regista o estado inicial (sem desenhar) para o primeiro evento só reagir a mudanças reais. */
function primeStore() {
  const d = db();
  changed('menu', [d.stock, d.paused]);
  changed('mine', mySignature());
  changed('wallet', d.wallet);
  lastTxCount = d.wallet.transactions.length;
  announceBarActions();
}

Auth.start({
  key: 'bp_token_student',
  roles: ['student', 'teacher'],
  onEnter: async (user) => {
    Object.assign(ME, { customer: user.name, role: user.roleLabel });
    document.getElementById('greet-name').textContent = user.name.split(' ')[0];
    await Store.start();
    renderAll(); primeStore(); Store.subscribe(onStoreChange);
    setInterval(renderBarInfo, 30000);      // a fila e as horas das reservas mudam com o tempo
  },
});
