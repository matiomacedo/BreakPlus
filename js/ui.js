/* ==========================================================================
   ui.js — tudo o que desenha no ecrã e as animações.
   Regra: aqui só se lê o state e a store; para os alterar usa js/app.js.

   Princípio das animações: nunca reescrever HTML que já está no ecrã se só
   mudou uma classe (assim o CSS consegue fazer a transição). Por isso há
   funções "render" (constroem) e funções "sync" (atualizam no sítio).
   ========================================================================== */

const $ = (selector) => document.querySelector(selector);

/* Ordem das vistas — tem de bater com a ordem dos botões em <nav> */
const VIEWS = ['bar', 'orders', 'wallet', 'more'];

/* ---------- Helpers de animação ---------- */

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Volta a disparar uma animação CSS (remove a classe, força reflow, volta a pôr). */
function replay(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/** Anima um número de `from` até `to` (usado nos saldos). */
function tweenNumber(el, from, to, format, duration = 700) {
  cancelAnimationFrame(el._raf);
  if (reducedMotion() || from === to) { el.textContent = format(to); return; }
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = format(from + (to - from) * ease(t));
    if (t < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/* Limpa as classes de animação quando terminam (para poderem voltar a disparar). */
document.addEventListener('animationend', (e) => {
  ['rise', 'pop', 'swap', 'bump'].forEach((c) => e.target.classList.remove(c));
});

/** Entrada escalonada: cada elemento sobe e aparece com um pequeno atraso. */
function riseIn(elements) {
  elements.forEach((el, i) => {
    el.style.setProperty('--i', Math.min(i, 8));
    replay(el, 'rise');
  });
}

/* ---------- Pequenos blocos reutilizáveis ---------- */

const badgeHTML = (badge) => `<span class="b ${escapeHtml(badge.style || '')}">${escapeHtml(badge.text)}</span>`;
const badgesHTML = (badges) => `<div class="bd">${badges.map(badgeHTML).join('')}</div>`;
const chipHTML = (action, value, isOn) =>
  `<button class="chip ${isOn ? 'on' : ''}" data-action="${action}" data-value="${value}" aria-pressed="${isOn}">${value}</button>`;

/** Fotografia de perfil: aceita um URL/path completo ou só o nome em ProfilePictureUser/. */
function avatarSrc(avatar) {
  const src = String(avatar || '').trim();
  if (!src) return '';
  if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('/') || src.startsWith('data:')) return src;
  return '/ProfilePictureUser/' + src;
}

function setChip(button, isOn) {
  button.classList.toggle('on', isOn);
  button.setAttribute('aria-pressed', isOn);
}

/* ==========================================================================
   Cabeçalho, local, banner e bandeja
   ========================================================================== */

let shownBalance = null;
function renderHeader() {
  const from = shownBalance ?? balance();
  tweenNumber($('#balance'), from, balance(), eur);
  shownBalance = balance();
}

function renderBarInfo() {
  const hours = `${BAR.open}–${BAR.close}`;
  $('#bar-name').textContent = BAR.name;
  $('#bar-hours').textContent = isPaused() ? `Pedidos na hora em pausa · ${hours}` : `${BAR.status} · ${hours}`;
  $('#bar-wait').textContent = 'Fila: ' + Store.waitText();
  $('#paused-note').hidden = !isPaused();
  document.querySelector('.cap .dot').classList.toggle('paused', isPaused());
}

/** Textos do banner no topo do Bar, conforme o estado do pedido na fila do bar. */
const TICKET_COPY = {
  received:  { title: (n) => `Pedido #${n} recebido`,   sub: 'Já está na fila · Retirada no balcão' },
  preparing: { title: (n) => `Pedido #${n} a preparar`, sub: 'Pronto em breve · Retirada no balcão' },
  ready:     { title: (n) => `Pedido #${n} pronto!`,    sub: 'Levanta no balcão e mostra a senha' },
};

let bannerWasShown = false;
function renderTicketBanner() {
  const banner = $('#ticket-banner');
  const order = liveOrders()[0];
  banner.hidden = !order;
  if (order) {
    const copy = TICKET_COPY[order.status];
    $('#ticket-title').textContent = copy.title(order.number);
    $('#ticket-sub').textContent = copy.sub;
    banner.classList.toggle('ready', order.status === 'ready');
    banner.querySelector('button').dataset.id = order.number;
    if (!bannerWasShown && state.view === 'bar') replay(banner, 'pop');
  }
  bannerWasShown = !!order;
}

/** Mostra a próxima reserva (a mais próxima no tempo) no topo do Bar. */
let reservationBannerWasShown = false;
function renderReservationBanner() {
  const banner = $('#resv-banner');
  const next = activeReservations()[0];
  banner.hidden = !next;
  if (next) {
    const detail = next.status === 'reserved' ? plural(itemsCount(next.items), 'item', 'itens')
      : next.status === 'ready' ? 'pronta para levantar' : 'a preparar';
    $('#resv-title').textContent = pickupText(next);
    $('#resv-sub').textContent = `Reserva #${next.number} · ${detail}`;
    banner.querySelector('button').dataset.id = next.number;
    if (!reservationBannerWasShown && state.view === 'bar') replay(banner, 'pop');
  }
  reservationBannerWasShown = !!next;
}

let lastCartCount = 0;
function renderTray() {
  const count = cartCount();
  $('#tray-count').textContent = plural(count, 'item', 'itens');
  $('#tray-total').textContent = 'Total ' + eur(cartTotal());
  $('#tray').classList.toggle('show', count > 0 && state.view === 'bar');
  if (count > 0 && count !== lastCartCount) replay($('#tray-count'), 'bump');
  lastCartCount = count;
}

/* ==========================================================================
   Vista: Bar
   ========================================================================== */

/** Imagem do prato. Por baixo fica um ícone neutro: se a imagem faltar, é ele que se vê. */
function productImageHTML(item, stock) {
  const src = imageUrl(item);
  const img = src
    ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async"
            onload="this.classList.add('loaded')" onerror="this.remove()">`
    : '';
  const low = stock > 0 && stock <= 5;
  const meta = low ? `Últimas ${stock}` : item.meta;
  return `
    <div class="pic">
      <span class="pic-fallback" aria-hidden="true"><svg class="ic"><use href="#i-utensils"/></svg></span>
      ${img}
      <span class="tag ${escapeHtml(item.tagStyle || '')}">${escapeHtml(item.tag)}</span>
      ${meta && stock > 0 ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}
      ${stock === 0 ? '<span class="soldout-badge">Esgotado</span>' : ''}
    </div>`;
}

function productCardHTML(item, index, animate) {
  const stock = stockOf(item.id);
  return `
    <article class="item ${animate ? 'enter' : ''} ${stock === 0 ? 'soldout' : ''}" style="--i:${Math.min(index, 6)}">
      ${productImageHTML(item, stock)}
      <div class="info">
        <div class="row">
          <div>
            <div class="cl">${escapeHtml(item.subtitle)}</div>
            <h3>${escapeHtml(item.name)}</h3>
          </div>
          <div class="pr">${eur(item.price)}<small>${escapeHtml(item.priceLabel)}</small></div>
        </div>
        <p class="desc">${escapeHtml(item.description)}</p>
        ${badgesHTML(item.badges)}
        <div class="acts">
          <button class="ghost" data-action="show-item" data-id="${escapeHtml(item.id)}">Detalhes</button>
          <button class="cta" data-action="add-to-cart" data-id="${escapeHtml(item.id)}" ${stock === 0 ? 'disabled' : ''}>${stock === 0 ? 'Esgotado' : `Adicionar · ${eur(item.price)}`}</button>
        </div>
      </div>
    </article>`;
}

/** Reconstrói a lista. `animate` faz os cartões entrarem em cascata. */
function renderMenu({ animate = false } = {}) {
  const items = visibleItems();
  const filters = activeFilters();
  $('#menu-count').textContent = plural(items.length, 'produto', 'produtos');
  $('#menu-filters').textContent = filters.join(' · ');
  const badge = $('#filters-badge');
  const badgeText = String(filters.length || '');
  if (badge.textContent !== badgeText) {
    badge.textContent = badgeText;
    if (filters.length) replay(badge, 'bump');       // pequeno salto ao mudar de filtros
  }
  $('#menu-list').innerHTML = items.length
    ? items.map((item, i) => productCardHTML(item, i, animate)).join('')
    : '<p class="desc">Sem produtos com estes filtros. Limpa os filtros para ver tudo.</p>';
}

/** Feedback no botão "Pedir ao Balcão": mostra um visto durante um instante. */
function flashAdded(button) {
  if (button._timer) clearTimeout(button._timer);
  else button._html = button.innerHTML;
  button.classList.add('added');
  button.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>Adicionado';
  button._timer = setTimeout(() => {
    button.classList.remove('added');
    button.innerHTML = button._html;
    button._timer = null;
  }, 1100);
}

/* ==========================================================================
   Vista: Pedidos
   ========================================================================== */

function orderRowHTML(o) {
  const cancelled = o.status === 'cancelled';
  const when = o.type === 'reservation' ? `Reserva · ${pickupText(o)}` : o.when;
  return `
    <div class="rw ${cancelled ? 'is-cancelled' : ''}">
      <div><b>#${escapeHtml(o.number)} · ${escapeHtml(when)}</b><small>${escapeHtml(itemsSummary(o.items))}</small></div>
      <div class="rw-end">
        <b>${eur(o.total)}</b>
        ${cancelled
          ? '<span class="b">Cancelada</span>'
          : `<button class="ghost" data-action="repeat-order" data-id="${escapeHtml(o.number)}">Repetir</button>`}
      </div>
    </div>`;
}

function reservationCardHTML(o) {
  let action;
  if (o.status !== 'reserved') action = `<span class="resv-locked">${o.status === 'ready' ? 'Pronta: já podes levantar' : 'Já em preparação'}</span>`;
  else if (canCancel(o)) action = `<button class="ghost" data-action="cancel-reservation" data-id="${escapeHtml(o.number)}">Cancelar</button>`;
  else action = `<span class="resv-locked">Já não dá para cancelar</span>`;
  return `
    <div class="card resv-card">
      <div class="row">
        <div><div class="cl">Reserva #${escapeHtml(o.number)}</div><h3>${escapeHtml(pickupText(o))}</h3></div>
        <span class="b v ${isLive(o) ? 'live' : ''}">${STATUS_TEXT[o.status]}</span>
      </div>
      <p class="desc">${escapeHtml(itemsSummary(o.items))}</p>
      <div class="acts">
        ${action}
        <button class="cta" data-action="show-ticket" data-id="${escapeHtml(o.number)}">Ver senha</button>
      </div>
    </div>`;
}

function liveOrderCardHTML(o) {
  const step = { received: 0, preparing: 1, ready: 2 }[o.status];
  const steps = ['Recebido', 'A preparar', 'Pronto']
    .map((label, i) => `<li class="${i < step ? 'done' : i === step ? 'cur' : ''}">${label}</li>`).join('');
  return `
    <div class="card">
      <div class="row">
        <div><div class="cl">Em curso</div><h3>Pedido #${escapeHtml(o.number)}</h3></div>
        <span class="b v live">${STATUS_TEXT[o.status]}</span>
      </div>
      <ol class="steps">${steps}</ol>
      <p class="desc">${o.status === 'ready' ? 'Levanta no balcão e mostra a senha.' : 'Retirada no balcão · avisamos-te quando estiver pronto.'}</p>
      <button class="cta cta-full" data-action="show-ticket" data-id="${escapeHtml(o.number)}">Ver senha</button>
    </div>`;
}

function renderOrders() {
  const live = liveOrders();
  const current = live.length
    ? `<div class="stack">${live.map(liveOrderCardHTML).join('')}</div>`
    : `<div class="card"><p class="desc desc-flush">Sem pedidos em curso. Escolhe algo no Bar.</p></div>`;

  const reservations = activeReservations();
  const reservationsHTML = `
    <div class="cl sec">Reservas</div>
    ${reservations.length
      ? `<div class="stack">${reservations.map(reservationCardHTML).join('')}</div>`
      : `<div class="card"><p class="desc desc-flush">Sem reservas. No carrinho, escolhe "Reservar" para levantares mais tarde.</p></div>`}`;

  const history = historyOrders().map(orderRowHTML).join('');

  $('#view-orders .body').innerHTML = current + reservationsHTML + '<div class="cl sec">Anteriores</div>' + history;
}

/* ==========================================================================
   Vista: Saldo
   ========================================================================== */

let shownWalletBalance = null;
function renderWallet({ fresh = false } = {}) {
  const chips = TOPUP_AMOUNTS.map((v) => `
    <button class="chip ${v === state.topupAmount ? 'on' : ''}" data-action="set-topup" data-value="${v}" aria-pressed="${v === state.topupAmount}">${eur(v)}</button>`
  ).join('');

  const movements = db().wallet.transactions.map((t, i) => `
    <div class="rw ${fresh && i === 0 ? 'row-new' : ''}">
      <div><b>${escapeHtml(t.label)}</b><small>${escapeHtml(t.when)}</small></div>
      <b class="${t.value > 0 ? 'pos' : ''}">${t.value > 0 ? '+' : '−'}${eur(Math.abs(t.value))}</b>
    </div>`).join('');

  $('#view-wallet .body').innerHTML = `
    <div class="bigbal">
      <span class="bigbal-tag">SAS - IPVC</span>
      <small>Saldo disponível</small>
      <b id="wallet-balance"></b>
    </div>
    <div class="cl sec">Carregar saldo</div>
    <div class="chips" id="topup-chips">${chips}</div>
    <button class="cta cta-full cta-spaced" id="topup-btn" data-action="topup">Carregar ${eur(state.topupAmount)}</button>
    <div class="cl sec">Movimentos</div>
    ${movements}`;

  tweenNumber($('#wallet-balance'), shownWalletBalance ?? balance(), balance(), eur, 800);
  shownWalletBalance = balance();
}

/** Atualiza só os chips e o botão de carregar (sem reconstruir → há transição). */
function syncTopup() {
  document.querySelectorAll('#topup-chips .chip').forEach((chip) =>
    setChip(chip, +chip.dataset.value === state.topupAmount));
  $('#topup-btn').textContent = 'Carregar ' + eur(state.topupAmount);
}

/* ==========================================================================
   Vista: Mais
   ========================================================================== */

function switchRowHTML(key, label, hint) {
  const on = state.prefs[key];
  return `
    <div class="mrow">
      <div><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div>
      <button class="sw ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${label}" data-action="toggle-pref" data-key="${key}"></button>
    </div>`;
}

function renderMore() {
  const avatar = avatarSrc(ME.avatar);
  $('#view-more .body').innerHTML = `
    <div class="card prof">
      <span class="av" aria-hidden="true">${escapeHtml(ME.customer[0] || '?')}${avatar
        ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
        : ''}</span>
      <div><b>${escapeHtml(ME.customer)}</b><small>${escapeHtml(ME.role)} · IPVC ESTG</small></div>
    </div>

    <div class="cl sec">Preferências alimentares</div>
    <div class="card">
      ${switchRowHTML('vegetarian', 'Vegetariano')}
      ${switchRowHTML('glutenFree', 'Sem glúten')}
      ${switchRowHTML('lactoseFree', 'Sem lactose')}
    </div>

    <div class="cl sec">Notificações</div>
    <div class="card">
      ${switchRowHTML('notifications', 'Aviso de pedido pronto', Notifications.statusHint())}
      <button class="mrow" data-action="test-notification">
        <div><b>Testar notificação</b><small>Envia um aviso de exemplo para este dispositivo</small></div>
      </button>
    </div>

    <div class="cl sec">Aplicação</div>
    <div class="card" id="install-card" ${PWA.canInstall() ? '' : 'hidden'}>
      <button class="mrow" data-action="install-pwa">
        <div><b>Instalar no ecrã principal</b><small>Abre em ecrã completo, como uma app</small></div>
      </button>
    </div>
    <p class="desc desc-flush">No iPhone/iPad: Partilhar → Adicionar ao ecrã principal.</p>

    <div class="cl sec">Conta</div>
    <div class="card">
      <div class="mrow"><div><b>Sobre o Break+</b><small>Versão 1.0</small></div></div>
      <button class="mrow" data-action="logout"><div><b>Terminar sessão</b></div></button>
    </div>`;
}

/* ==========================================================================
   Navegação entre vistas
   ========================================================================== */

let lastNavView = null;
function syncNav() {
  const nav = $('#nav');
  nav.style.setProperty('--n', VIEWS.length);
  nav.style.setProperty('--idx', VIEWS.indexOf(state.view));
  nav.querySelectorAll('button').forEach((btn) => {
    const isCurrent = btn.dataset.view === state.view;
    btn.classList.toggle('on', isCurrent);
    if (isCurrent) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  // O ícone da vista ativa faz um pequeno "pop" ao mudar de separador.
  if (state.view !== lastNavView) {
    const icon = nav.querySelector(`button[data-view="${state.view}"] span`);
    if (icon) replay(icon, 'bump');
    lastNavView = state.view;
  }
}

/** Anima a entrada de uma vista (título + blocos sobem em cascata). */
function enterView(name) {
  const view = $('#view-' + name);
  const blocks = [...view.children].flatMap((child) =>
    child.classList.contains('body') ? [...child.children] : [child]);
  riseIn(blocks.filter((el) => el.id !== 'menu-list'));   // a lista do Bar tem a sua própria cascata
}

function showView(name) {
  const changed = name !== state.view;
  state.view = name;

  VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== name; });
  syncNav();
  renderTray();

  if (changed) {
    if (name === 'bar') renderMenu({ animate: true });
    if (name === 'orders') renderOrders();
    if (name === 'wallet') renderWallet();
    if (name === 'more') renderMore();
    enterView(name);
  }
  window.scrollTo(0, 0);
}

/* ==========================================================================
   Aviso (toast) e painel deslizante (sheet)
   ========================================================================== */

function toast(message, ms = 1800) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

/** `swap: true` faz o conteúdo novo aparecer com um fade quando o painel já está aberto. */
function openSheet(html, { swap = false } = {}) {
  const sheet = $('#sheet');
  const wasOpen = sheet.classList.contains('show');
  $('#pane').innerHTML = html;
  if (!wasOpen) $('#pane').scrollTop = 0;
  // Índices para a entrada em cascata (ver .sheet.show .pane > * em styles.css).
  [...$('#pane').children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10)));
  $('#pane').querySelectorAll('.chip').forEach((el, i) => el.style.setProperty('--ci', Math.min(i, 12)));
  if (wasOpen && swap) replay($('#pane'), 'swap');
  sheet.classList.add('show');
  sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
}

function closeSheet() {
  const sheet = $('#sheet');
  sheet.classList.remove('show');
  sheet.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('locked');
}

const closeButtonHTML = (label = 'Fechar', cls = 'ghost') =>
  `<button class="${cls} cta-full cta-spaced" data-action="close-sheet">${label}</button>`;

function openFiltersSheet() {
  openSheet(`
    <h2>Filtrar</h2>
    <div class="cl cl-first">Período</div>
    <div class="chips">${PERIODS.map((p) => chipHTML('set-period', p, p === state.period)).join('')}</div>
    <div class="cl">Categoria</div>
    <div class="chips">${CATEGORIES.map((c) => chipHTML('set-category', c, c === state.category)).join('')}</div>
    <div class="acts">
      <button class="ghost" data-action="clear-filters">Limpar</button>
      <button class="cta" id="filters-apply" data-action="close-sheet"></button>
    </div>`);
  syncFiltersSheet();
}

/** Atualiza chips e contagem no sítio, para os filtros mudarem com transição suave. */
function syncFiltersSheet() {
  document.querySelectorAll('#pane [data-action="set-period"]').forEach((b) => setChip(b, b.dataset.value === state.period));
  document.querySelectorAll('#pane [data-action="set-category"]').forEach((b) => setChip(b, b.dataset.value === state.category));
  const apply = $('#filters-apply');
  if (apply) apply.textContent = 'Ver ' + plural(visibleItems().length, 'produto', 'produtos');
}

/* ---------- Carrinho (pedido na hora ou reserva) ---------- */

function cartLinesHTML() {
  return Object.entries(state.cart).map(([id, qty]) => {
    const item = findItem(id);
    return `
      <div class="ln">
        <span class="ln-name">${escapeHtml(item.name)}<small>${eur(item.price)} cada</small></span>
        <span class="q">
          <button data-action="change-qty" data-id="${escapeHtml(id)}" data-delta="-1" aria-label="Menos">−</button><b>${qty}</b>
          <button data-action="change-qty" data-id="${escapeHtml(id)}" data-delta="1" aria-label="Mais">+</button>
        </span>
        <b class="ln-total">${eur(qty * item.price)}</b>
      </div>`;
  }).join('');
}

function renderSlots() {
  const grid = $('#slot-grid');
  if (!grid) return;
  const day = state.checkout.day;
  const slots = day ? slotsFor(dateFromKey(day)) : [];
  grid.innerHTML = slots.length
    ? slots.map((s) => `<button class="chip slot" data-action="set-time" data-value="${escapeHtml(s.time)}" aria-pressed="false" ${s.full ? 'disabled title="Esgotado"' : ''}>${escapeHtml(s.time)}</button>`).join('')
    : '<p class="desc">Sem horários disponíveis.</p>';
  replay(grid, 'swap');
}

/** Atualiza o painel do carrinho no sítio (modo, chips, nota e botão de pagar). */
function syncCheckout() {
  const seg = $('#mode-seg');
  if (!seg) return;
  const { mode, time } = state.checkout;
  const reserve = mode === 'reserve';

  seg.dataset.mode = mode;
  seg.querySelectorAll('button').forEach((b) => setChip(b, b.dataset.mode === mode));

  const box = $('#reserve-box');
  box.classList.toggle('open', reserve);
  box.inert = !reserve;

  $('#mode-note').textContent = reserve
    ? `Pagas agora e levantas à hora escolhida. Podes cancelar até ${RESERVATION.cancelBeforeMin} min antes e o valor volta ao teu saldo.`
    : isPaused()
      ? 'O bar pausou os pedidos na hora. Podes reservar para mais tarde.'
      : `Pronto em ${BAR.prep} · Retirada no balcão.`;

  document.querySelectorAll('#slot-grid .chip').forEach((c) => setChip(c, c.dataset.value === time));
  syncPayButton();
}

function syncPayButton() {
  const btn = $('#pay-btn');
  if (!btn) return;
  const total = cartTotal();
  const { mode, time } = state.checkout;
  let label = `Pagar com saldo · ${eur(total)}`;
  let disabled = false;

  if (mode === 'now' && isPaused()) { label = 'Pedidos na hora em pausa'; disabled = true; }
  else if (total > balance()) label = 'Saldo insuficiente';
  else if (mode === 'reserve') {
    if (time) label = `Pagar e reservar · ${eur(total)}`;
    else { label = 'Escolhe uma hora'; disabled = true; }
  }
  btn.textContent = label;
  btn.classList.toggle('disabled', disabled);
  btn.setAttribute('aria-disabled', disabled);
  $('#cart-total').textContent = eur(total);
}

function openCartSheet() {
  if (!cartCount()) return closeSheet();
  const days = ensureCheckoutDay();
  const c = state.checkout;

  openSheet(`
    <h2>O teu pedido</h2>
    <div id="cart-lines">${cartLinesHTML()}</div>

    <div class="seg" id="mode-seg" data-mode="${c.mode}">
      <div class="seg-thumb"></div>
      <button data-action="set-mode" data-mode="now" aria-pressed="true">Pedir agora</button>
      <button data-action="set-mode" data-mode="reserve" aria-pressed="false">Reservar</button>
    </div>
    <p class="mode-note" id="mode-note"></p>

    <div class="reserve" id="reserve-box">
      <div class="reserve-inner">
        ${days.length
          ? `<div class="cl cl-first">Hora de levantamento · hoje</div>
             <div class="slots" id="slot-grid"></div>
             <p class="mode-note">As reservas são só para hoje. A última hora de levantamento é ${RESERVATION.todayUntil}.</p>`
          : '<p class="desc">Já não há horas de reserva hoje. Podes pedir agora ou voltar amanhã.</p>'}
      </div>
    </div>

    <div class="tot"><span>Total</span><span id="cart-total"></span></div>
    <button class="cta cta-full" id="pay-btn" data-action="pay"></button>`);

  renderSlots();
  syncCheckout();
}

/** Mudou o carrinho com o painel aberto: só atualiza linhas e totais (sem piscar). */
function refreshCartSheet() {
  if (!cartCount()) return closeSheet();
  $('#cart-lines').innerHTML = cartLinesHTML();
  syncPayButton();
}

/* ---------- Detalhes, senha, confirmação e cancelamento ---------- */

function openItemSheet(item) {
  openSheet(`
    <h2>${escapeHtml(item.name)}</h2>
    <p class="desc">${escapeHtml(item.description)}</p>
    ${badgesHTML(item.badges)}
    ${closeButtonHTML()}`);
}

function openTicketSheet(number) {
  const order = db().orders.find((o) => o.mine && o.number === +number) || liveOrders()[0];
  if (!order) return;
  const reservation = order.type === 'reservation';
  const status = order.status === 'reserved' && reservation
    ? `Levantamento ${pickupText(order)}`
    : STATUS_TEXT[order.status] + (order.status === 'ready' ? ' · levanta no balcão' : '');
  openSheet(`
    <h2>${reservation ? `Reserva #${escapeHtml(order.number)}` : `Senha #${escapeHtml(order.number)}`}</h2>
    <p class="desc">${escapeHtml(status)}</p>
    <div class="qr"></div>
    ${closeButtonHTML('Fechar', 'cta')}`);
}

function openConfirmationSheet(order) {
  const reservation = order.type === 'reservation';
  openSheet(`
    <div class="done" aria-hidden="true">
      <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M16 27l7 7 13-14"/></svg>
    </div>
    <h2 class="center">${reservation ? 'Reserva' : 'Pedido'} #${escapeHtml(order.number)} confirmad${reservation ? 'a' : 'o'}</h2>
    <p class="desc center">${reservation
      ? `Levanta no balcão ${escapeHtml(pickupText(order))}. Mostra este código.`
      : 'Mostra este código no balcão.'}</p>
    <div class="qr"></div>
    ${closeButtonHTML('Concluir', 'cta')}`, { swap: true });
}

function openCancelSheet(order) {
  openSheet(`
    <h2>Cancelar reserva #${escapeHtml(order.number)}?</h2>
    <p class="desc">${escapeHtml(pickupText(order))} · ${escapeHtml(itemsSummary(order.items))}</p>
    <p class="desc">Vais receber ${eur(order.total)} de volta no teu saldo.</p>
    <div class="acts">
      <button class="ghost" data-action="close-sheet">Manter</button>
      <button class="cta danger" data-action="confirm-cancel" data-id="${escapeHtml(order.number)}">Cancelar reserva</button>
    </div>`);
}

/* ==========================================================================
   Arranque
   ========================================================================== */

function renderAll() {
  renderHeader();
  renderBarInfo();
  renderMenu({ animate: true });
  renderTicketBanner();
  renderReservationBanner();
  renderTray();
  renderOrders();
  renderWallet();
  renderMore();
  syncNav();
  enterView('bar');
}
