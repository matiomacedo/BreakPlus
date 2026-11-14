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

/* ---------- Ligação ao servidor (aviso "Sem ligação") ---------- */

let storeConnection = null;        // null = ainda não sabemos; false = última atualização falhou

function updateConnectionBanner() {
  const offline = !navigator.onLine || storeConnection === false;
  const note = document.getElementById('offline-note');
  if (note) note.hidden = !offline;
  document.body.classList.toggle('is-offline', offline);
}

/** Chamado pela Store a cada atualização (ver js/store.js). */
function setConnection(ok) {
  storeConnection = ok;
  updateConnectionBanner();
}

window.addEventListener('offline', updateConnectionBanner);
window.addEventListener('online', () => {
  updateConnectionBanner();
  if (Auth.token()) Store.refresh();        // tenta recuperar os dados assim que houver rede
});

updateConnectionBanner();

/** Notificação do sistema quando o aluno tem a app noutro separador. */
function notifySystem(title, body, tag) {
  if (!state.prefs.notifications) return;
  Notifications.notifyIfAway(title, { body, tag });
}

/**
 * A permissão do sistema tem de ser pedida a partir de um gesto. Se a
 * preferência já vem ligada de outra sessão mas o browser ainda não deu
 * permissão, aproveitamos o primeiro toque na app (menos no próprio
 * interruptor, que trata do pedido em js/app.js → toggle-pref).
 */
function armNotificationPermission() {
  if (!state.prefs.notifications || !Notifications.needsPermission()) return;

  const ask = (event) => {
    if (event.target instanceof Element && event.target.closest('[data-key="notifications"]')) return;
    document.removeEventListener('pointerdown', ask, true);
    if (!state.prefs.notifications || !Notifications.needsPermission()) return;
    Notifications.requestPermission().then((result) => {
      if (result !== 'granted') {
        state.prefs.notifications = false;
        persistPrefs();
      }
      if (state.view === 'more') renderMore();
    });
  };
  document.addEventListener('pointerdown', ask, true);
}

/* O browser passou a permitir instalar a app: mostra a linha no ecrã "Mais". */
document.addEventListener('pwa-installable', () => {
  if (state.view === 'more') renderMore();
});

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
  'set-time': (d) => { state.checkout.time = d.value; syncCheckout(); },

  'pay': async () => {
    const total = cartTotal();
    const mode = state.checkout.mode;
    if (!total) return;
    if (mode === 'now' && isPaused()) return toast('O bar pausou os pedidos na hora. Podes reservar.');
    if (total > balance()) return toast('Carrega o saldo para continuar');
    if (mode === 'reserve') {
      // O tempo passou enquanto o carrinho estava aberto: volta a validar a hora (só hoje, até às 18:00).
      const days = ensureCheckoutDay();
      if (!days.length) { renderSlots(); syncCheckout(); return toast('Já não há horas de reserva para hoje'); }
      if (!state.checkout.time) { renderSlots(); syncCheckout(); return toast('Escolhe uma hora de levantamento'); }
    }
    const { day, time } = state.checkout;

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
      if (result.reason === 'pickup') { renderSlots(); syncCheckout(); return toast(`Só podes reservar para hoje, até às ${RESERVATION.todayUntil}`); }
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
  'toggle-pref': async (d, el) => {
    const turningOn = !state.prefs[d.key];

    // Ativar os avisos precisa de permissão do sistema (pedida neste clique).
    if (turningOn && d.key === 'notifications') {
      const result = await Notifications.requestPermission();
      if (result !== 'granted') {
        state.prefs.notifications = false;
        persistPrefs();
        el.classList.remove('on');
        el.setAttribute('aria-checked', 'false');
        const hint = el.closest('.mrow')?.querySelector('small');
        if (hint) hint.textContent = Notifications.statusHint();
        return toast(result === 'denied'
          ? 'Notificações bloqueadas nas definições do browser'
          : 'Este dispositivo não suporta notificações');
      }
    }

    state.prefs[d.key] = turningOn;
    persistPrefs();                                          // mantém a escolha ao recarregar
    el.classList.toggle('on', state.prefs[d.key]);            // no sítio → o interruptor desliza
    el.setAttribute('aria-checked', state.prefs[d.key]);
    if (d.key === 'notifications') {
      const hint = el.closest('.mrow')?.querySelector('small');
      if (hint) hint.textContent = Notifications.statusHint();
      if (state.prefs.notifications) toast('Avisos do sistema ativados');
    }
  },
  'test-notification': async () => {
    if (!Notifications.supported()) return toast('Este dispositivo não suporta notificações');
    const result = await Notifications.requestPermission();
    if (result !== 'granted') {
      return toast(result === 'denied'
        ? 'Notificações bloqueadas nas definições do browser'
        : 'Não foi possível ativar as notificações');
    }
    const shown = await Notifications.show('Break+ESTG · teste', {
      body: 'Se vês isto, as notificações do sistema estão a funcionar.',
      tag: 'bp-test',
    });
    toast(shown ? 'Notificação de teste enviada' : 'Não foi possível mostrar a notificação');
  },
  'install-pwa': async () => {
    const installed = await PWA.promptInstall();
    if (installed) toast('Break+ instalado no ecrã principal');
  },
  'logout': () => {
    try { localStorage.removeItem('bp_state_student'); } catch { /* sem armazenamento */ }
    Auth.logout();
  },

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
          notifySystem(`Pedido #${o.number} pronto!`, 'Levanta no balcão e mostra a senha.', `bp-order-${o.number}-ready`);
          if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
        } else if (o.status === 'preparing' && before.status === 'reserved') {
          toast(`A tua reserva #${o.number} já está a ser preparada`, 3000);
          notifySystem(`Reserva #${o.number} a preparar`, `Já estamos a preparar o teu pedido para ${o.pickupTime || 'hoje'}.`, `bp-order-${o.number}-preparing`);
        } else if (o.status === 'cancelled' && o.cancelledBy === 'staff') {
          toast(`Pedido #${o.number} anulado pelo bar · ${eur(o.total)} devolvidos`, 4000);
          notifySystem(`Pedido #${o.number} anulado pelo bar`, `${eur(o.total)} devolvidos ao teu saldo.`, `bp-order-${o.number}-cancelled`);
        }
      } else if ((o.notifiedAt || 0) > before.notified && state.prefs.notifications) {
        toast(`O bar está a chamar a senha #${o.number}`, 4000);
        notifySystem(`Senha #${o.number} chamada`, 'Dirige-te ao balcão do bar.', `bp-order-${o.number}-call`);
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
    updateConnectionBanner();
    armNotificationPermission();
    setInterval(renderBarInfo, 30000);      // a fila e as horas das reservas mudam com o tempo
  },
});
