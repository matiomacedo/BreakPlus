/* ==========================================================================
   terminal/js/ui.js — tudo o que desenha no ecrã do terminal.
   Regra: aqui só se lê a store; para a alterar usa terminal/js/app.js.
   ========================================================================== */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const TABS = ['orders', 'reservations', 'stock'];
const STEPS = ['received', 'preparing', 'ready'];               // ordem na fila
const STEP_LABEL = { received: 'Recebido', preparing: 'A preparar', ready: 'Pronto p/ entrega' };
const LOW_STOCK = 5;                                             // "pouco stock" até esta quantidade

/* Estado só do ecrã (o resto vive na store) */
const ui = {
  tab: 'orders',
  first: true,          // primeira renderização: não anima nem avisa
  known: new Set(),     // números de pedidos que já vimos
  lastStatus: {},       // número → último estado (para destacar mudanças)
  dragging: false,      // a arrastar uma barra: não redesenhar a fila
  pending: false,       // houve alterações enquanto se arrastava
};

/* ---------- Tempo ---------- */

const minutesSince = (ts) => Math.floor((Date.now() - ts) / 60000);

function sinceText(ts) {
  const m = minutesSince(ts);
  if (m < 1) return 'Agora';
  if (m < 60) return `Há ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `Há ${h} h` : `Há ${Math.floor(h / 24)} d`;
}

function untilText(date) {
  const m = Math.round((date - Date.now()) / 60000);
  if (m < 0) return `Em atraso ${-m} min`;
  if (m < 1) return 'Agora';
  if (m < 60) return `Daqui a ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `Daqui a ${h} h${r ? ` ${r} min` : ''}`;
}

const fmtDuration = (seconds) => `${Math.floor(seconds / 60)}m ${pad(Math.round(seconds % 60))}s`;

/** Atualiza os textos "Há N min" / "Daqui a N min" sem redesenhar nada. */
function tickTimes() {
  $$('[data-since]').forEach((el) => {
    const ts = +el.dataset.since;
    const late = el.dataset.late === '1' && minutesSince(ts) >= 5;
    el.querySelector('span').textContent = sinceText(ts);
    el.classList.toggle('late', late);
  });
  $$('[data-until]').forEach((el) => { el.textContent = untilText(new Date(+el.dataset.until)); });
}

/* ---------- Blocos reutilizáveis ---------- */

const icon = (name, cls = '') => `<svg class="ic ${cls}"><use href="#i-${name}"/></svg>`;

const emptyHTML = (title, text) => `
  <div class="empty">
    ${icon('inbox', 'xl')}
    <b>${title}</b>
    <span>${text}</span>
  </div>`;

const roleBadge = (o) => (o.role && o.role !== 'Estudante' ? `<span class="role">${escapeHtml(o.role)}</span>` : '');

const linesHTML = (items) => Object.entries(items).map(([id, qty]) => {
  const item = findItem(id);
  return `<li><span>${qty}× ${escapeHtml(item.name)}</span><b>${eur(qty * item.price)}</b></li>`;
}).join('');

/* ==========================================================================
   Barra de topo
   ========================================================================== */

function renderTopbar() {
  const d = Store.get();
  $('#m-queue').textContent = plural(Store.queue().length, 'pedido', 'pedidos');
  const avg = Store.avgPrepSeconds();
  $('#m-avg').textContent = avg == null ? '–' : fmtDuration(avg);
  $('#m-clock').textContent = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

  // Separadores: contagens e destaque
  const queueCount = Store.queue().length;
  const reservations = Store.reservations();
  const dueSoon = reservations.some((o) => o.status === 'reserved' && pickupDate(o) - Date.now() <= 20 * 60000);
  const soldOut = ITEMS.filter((item) => (d.stock[item.id] ?? 0) === 0).length;

  $('#b-orders').textContent = queueCount;
  const resv = $('#b-resv');
  resv.textContent = reservations.length;
  resv.classList.toggle('alert', dueSoon);
  const stock = $('#b-stock');
  stock.hidden = soldOut === 0;
  stock.textContent = `${soldOut} esgotado${soldOut === 1 ? '' : 's'}`;
  stock.classList.add('alert');

  $('#tabs').style.setProperty('--idx', TABS.indexOf(ui.tab));
  $$('.tab').forEach((tab) => {
    const on = tab.dataset.tab === ui.tab;
    tab.classList.toggle('on', on);
    tab.setAttribute('aria-selected', on);
  });

  // Pausa
  document.body.classList.toggle('paused', d.paused);
  $('#pause-strip').hidden = !d.paused;
  $('#pause-label').textContent = d.paused ? 'Retomar' : 'Pausar';
  $('#pause-btn use').setAttribute('href', d.paused ? '#i-play' : '#i-pause');
  $('#pause-btn').classList.toggle('on', d.paused);
}

/* ==========================================================================
   Pedidos: fila e histórico
   ========================================================================== */

/** Botão principal do cartão, conforme o estado em que o pedido está. */
function mainButtonHTML(o) {
  if (o.status === 'received') return `<button class="btn primary big" data-act="advance" data-number="${escapeHtml(o.number)}">${icon('flame')}Iniciar preparação</button>`;
  if (o.status === 'preparing') return `<button class="btn ready big" data-act="advance" data-number="${escapeHtml(o.number)}">${icon('megaphone')}Marcar pronto (chamar #${escapeHtml(o.number)})</button>`;
  return `<button class="btn deliver big" data-act="advance" data-number="${escapeHtml(o.number)}">${icon('check-circle')}Entregar pedido</button>`;
}

function sideButtonHTML(o) {
  if (o.status === 'ready') return `<button class="btn soft icon big" data-act="notify" data-number="${escapeHtml(o.number)}" title="Tocar a campainha / chamar outra vez" aria-label="Chamar outra vez">${icon('bell')}</button>`;
  return `<button class="btn soft icon big danger-hover" data-act="cancel" data-number="${escapeHtml(o.number)}" title="Cancelar e reembolsar" aria-label="Cancelar e reembolsar">${icon('x')}</button>`;
}

const SPEED_HINT = {
  received: 'Arrasta a barra para avançar de imediato',
  preparing: 'Arrasta para a direita para marcar como pronto',
  ready: 'Cliente a caminho do balcão',
};

function orderCardHTML(o) {
  const step = STEPS.indexOf(o.status);
  const isNew = !ui.first && !ui.known.has(o.number);
  const changedStatus = ui.lastStatus[o.number] && ui.lastStatus[o.number] !== o.status;
  const reservation = o.type === 'reservation';
  const origin = reservation
    ? `${icon('calendar', 'sm')}Reserva · levantamento às ${escapeHtml(o.pickupTime)}`
    : 'Enviado da App Campus · Saldo pago';
  const labels = STEPS.map((s, i) => `<span class="${i === step ? 'on' : ''}">${i === step ? '● ' : ''}${STEP_LABEL[s]}</span>`).join('');

  return `
  <article class="order s-${escapeHtml(o.status)} ${isNew ? 'rise' : ''} ${changedStatus ? 'flash' : ''}" data-number="${escapeHtml(o.number)}">
    <header class="order-head">
      <div class="who">
        <span class="num">#${escapeHtml(o.number)}</span>
        <div>
          <div class="name">${escapeHtml(o.customer)}${roleBadge(o)}</div>
          <div class="origin">${origin}</div>
        </div>
      </div>
      <div class="pills">
        ${o.status === 'ready'
          ? `<span class="pill ok" data-since="${escapeHtml(o.readyAt)}" data-late="0">${icon('check', 'sm')}<span>${sinceText(o.readyAt)}</span></span>`
          : `<span class="pill" data-since="${escapeHtml(o.queuedAt)}" data-late="1">${icon('clock', 'sm')}<span>${sinceText(o.queuedAt)}</span></span>`}
        <span class="pill state s-${escapeHtml(o.status)}">${step + 1}. ${STEP_LABEL[o.status]}</span>
      </div>
    </header>

    <ul class="lines">${linesHTML(o.items)}</ul>

    <div class="controls">
      <div class="speed" style="--p:${step / 2}">
        <div class="speed-labels">${labels}</div>
        <div class="speed-bar">
          <div class="speed-track"><div class="speed-fill"></div></div>
          <input class="speed-input" type="range" min="0" max="2" step="1" value="${step}"
                 data-number="${escapeHtml(o.number)}" aria-label="Estado do pedido #${escapeHtml(o.number)}">
        </div>
        <small>${SPEED_HINT[o.status]}</small>
      </div>
      <div class="buttons">${mainButtonHTML(o)}${sideButtonHTML(o)}</div>
    </div>
  </article>`;
}

function historyItemHTML(o) {
  const cancelled = o.status === 'cancelled';
  const ts = cancelled ? o.cancelledAt : o.doneAt;
  const when = sinceText(ts).replace(/^H/, 'h');
  return `
    <div class="hist ${cancelled ? 'is-cancelled' : ''}">
      <div class="hist-top">
        <span class="hnum">#${escapeHtml(o.number)}</span>
        <div class="hist-who"><b>${escapeHtml(o.customer)}</b><small>${cancelled ? 'Anulado' : 'Entregue'} ${when}</small></div>
        <b class="price">${eur(o.total)}</b>
      </div>
      <div class="hist-items">${escapeHtml(itemsSummary(o.items))}</div>
      ${cancelled
        ? `<span class="pill">${o.mine ? 'Reembolsado na app' : 'Anulado'}</span>`
        : `<button class="btn soft-danger" data-act="undo" data-number="${escapeHtml(o.number)}">${icon('undo')}Anular pedido (reembolso + stock)</button>`}
    </div>`;
}

function renderOrders() {
  const queue = Store.queue();
  $('#queue').innerHTML = queue.length
    ? queue.map(orderCardHTML).join('')
    : emptyHTML('Sem pedidos na fila', 'Quando um aluno pedir na app, aparece aqui automaticamente.');

  const history = Store.history(5);
  $('#history').innerHTML = `
    <div class="panel side">
      <div class="side-head">
        ${icon('history', 'lg ok')}
        <h2>Histórico recente</h2>
        <span class="pill">Últimos</span>
      </div>
      <p class="muted">Resolve enganos com 1 toque: <b>Anular pedido</b> repõe o stock e devolve o saldo ao aluno de imediato.</p>
      ${history.length ? history.map(historyItemHTML).join('') : '<p class="muted">Ainda não há pedidos entregues.</p>'}
      <div class="tip">${icon('zap', 'ok')}<span>Sem leitores de QR: o aluno diz o número e o nome, e a fila corre mais depressa.</span></div>
    </div>`;
}

/* ==========================================================================
   Reservas
   ========================================================================== */

function reservationCardHTML(o) {
  const when = pickupDate(o);
  const soon = o.status === 'reserved' && when - Date.now() <= 20 * 60000;
  const queued = o.status !== 'reserved';
  const isNew = !ui.first && !ui.known.has(o.number);
  const status = queued
    ? `<span class="pill state s-${escapeHtml(o.status)}">Na fila · ${STEP_LABEL[o.status]}</span>`
    : `<span class="pill ${soon ? 'late' : ''}">${soon ? 'Preparar já' : 'Reservado'}</span>`;

  return `
  <article class="resv ${soon ? 'soon' : ''} ${queued ? 'queued' : ''} ${isNew ? 'rise' : ''}" data-number="${escapeHtml(o.number)}">
    <div class="when">
      <b>${escapeHtml(o.pickupTime)}</b>
      <span class="pill" data-until="${when.getTime()}">${untilText(when)}</span>
    </div>
    <div class="resv-body">
      <div class="resv-top">
        <span class="hnum">#${escapeHtml(o.number)}</span>
        <div><div class="name">${escapeHtml(o.customer)}${roleBadge(o)}</div><div class="origin">Reservado na App Campus · Saldo pago</div></div>
        ${status}
      </div>
      <ul class="lines compact">${linesHTML(o.items)}</ul>
    </div>
    <div class="buttons col">
      ${queued
        ? `<button class="btn soft big" data-act="goto-orders">${icon('receipt')}Ver na fila</button>`
        : `<button class="btn primary big" data-act="start-reservation" data-number="${escapeHtml(o.number)}">${icon('flame')}Preparar agora</button>
           <button class="btn soft big danger-hover" data-act="cancel" data-number="${escapeHtml(o.number)}">${icon('x')}Cancelar e reembolsar</button>`}
    </div>
  </article>`;
}

function renderReservations() {
  const list = Store.reservations();
  if (!list.length) {
    $('#resv-list').innerHTML = emptyHTML('Sem reservas', 'As reservas feitas na app dos alunos aparecem aqui, por hora de levantamento.');
    return;
  }
  const groups = {};
  list.forEach((o) => { (groups[o.pickupKey] ||= []).push(o); });
  $('#resv-list').innerHTML = Object.keys(groups).sort().map((key) => `
    <section class="resv-day">
      <h2 class="cl">${dayLabel(dateFromKey(key))}</h2>
      <div class="stack">${groups[key].map(reservationCardHTML).join('')}</div>
    </section>`).join('');
}

/* ==========================================================================
   Stock (construído uma vez; depois só se atualiza no sítio, sem piscar as fotos)
   ========================================================================== */

function stockState(qty) {
  if (qty === 0) return { key: 'out', label: 'Esgotado' };
  if (qty <= LOW_STOCK) return { key: 'low', label: `Pouco stock (≤ ${LOW_STOCK})` };
  return { key: 'ok', label: 'Em stock' };
}

function stockCardHTML(item) {
  const src = imageUrl(item);
  return `
  <article class="stock" id="stock-${escapeHtml(item.id)}" data-id="${escapeHtml(item.id)}">
    <div class="stock-head">
      <div class="thumb">
        <span class="thumb-fallback">${icon('utensils')}</span>
        ${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" onload="this.classList.add('loaded')" onerror="this.remove()">` : ''}
      </div>
      <div class="stock-name"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.subtitle)}</small></div>
      <span class="pill state" data-role="badge"></span>
    </div>
    <div class="stepper">
      <button class="step" data-act="stock-adjust" data-id="${escapeHtml(item.id)}" data-delta="-1" aria-label="Menos uma unidade">${icon('minus')}</button>
      <div class="qty"><b data-role="qty"></b><small>unidades</small></div>
      <button class="step plus" data-act="stock-adjust" data-id="${escapeHtml(item.id)}" data-delta="1" aria-label="Mais uma unidade">${icon('plus')}</button>
    </div>
    <button class="btn soft wide" data-act="stock-toggle" data-id="${escapeHtml(item.id)}" data-role="toggle"></button>
  </article>`;
}

function renderStock() {
  const grid = $('#stock-grid');
  if (!grid.children.length) grid.innerHTML = ITEMS.map(stockCardHTML).join('');

  const stock = Store.get().stock;
  let ok = 0, low = 0, out = 0;
  ITEMS.forEach((item) => {
    const qty = stock[item.id] ?? 0;
    const state = stockState(qty);
    if (state.key === 'ok') ok++; else if (state.key === 'low') low++; else out++;

    const card = $('#stock-' + item.id);
    card.dataset.state = state.key;
    card.querySelector('[data-role=qty]').textContent = qty;
    const badge = card.querySelector('[data-role=badge]');
    badge.textContent = state.label;
    badge.className = `pill state st-${state.key}`;
    const toggle = card.querySelector('[data-role=toggle]');
    toggle.className = `btn wide ${qty === 0 ? 'ready' : 'soft'}`;
    toggle.innerHTML = qty === 0 ? `${icon('check-circle')}Reativar (+10)` : `${icon('ban')}Marcar como esgotado`;
  });

  $('#stock-summary').innerHTML = `
    <span><i class="dot s-ready"></i>${ok} disponíveis</span>
    ${low ? `<span><i class="dot s-received"></i>${low} com pouco stock</span>` : ''}
    <span><i class="dot st-out"></i>${out} esgotado${out === 1 ? '' : 's'}</span>`;
}

/* ==========================================================================
   Navegação, aviso e confirmação
   ========================================================================== */

function showTab(name) {
  ui.tab = name;
  TABS.forEach((t) => { $('#view-' + t).hidden = t !== name; });
  $('#tabs').style.setProperty('--idx', TABS.indexOf(name));
  renderTopbar();
  const view = $('#view-' + name);
  view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
  window.scrollTo(0, 0);
}

/** Mostra/esconde o aviso de ligação (chamado pela store a cada atualização). */
const CONN_TEXT = {
  terminal_key: 'Chave do terminal em falta ou errada. Confirma terminalKey em terminal/config.js (igual a TERMINAL_KEY em server/.env).',
  network: 'Sem ligação ao servidor. A tentar outra vez…',
};
function showConnection(ok, reason) {
  $('#conn-strip').hidden = ok;
  if (!ok) $('#conn-msg').textContent = CONN_TEXT[reason] || 'O servidor respondeu com um erro. A tentar outra vez…';
}

function toast(title, message = '') {
  $('#toast-title').textContent = title;
  $('#toast-msg').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 3800);
}

let confirmCallback = null;

function openConfirm({ title, text, okLabel, onOk }) {
  $('#modal-title').textContent = title;
  $('#modal-text').textContent = text;
  $('#modal-ok').textContent = okLabel;
  confirmCallback = onOk;
  $('#modal').classList.add('show');
  $('#modal').setAttribute('aria-hidden', 'false');
}

function closeConfirm() {
  confirmCallback = null;
  $('#modal').classList.remove('show');
  $('#modal').setAttribute('aria-hidden', 'true');
}

/* ==========================================================================
   Redesenhar tudo (chamado quando a store muda)
   ========================================================================== */

/** Avisa de pedidos/reservas novos que chegaram da app dos alunos. */
function announceArrivals() {
  if (ui.first) return;
  Store.get().orders.forEach((o) => {
    if (ui.known.has(o.number)) return;
    if (o.status === 'received') toast(`Novo pedido #${o.number}`, `${o.customer} · ${itemsSummary(o.items)}`);
    else if (o.status === 'reserved') toast(`Nova reserva #${o.number}`, `${o.customer} · ${pickupText(o)}`);
  });
}

function render() {
  renderTopbar();
  if (ui.dragging) { ui.pending = true; return; }     // não mexer na fila enquanto se arrasta uma barra

  announceArrivals();
  renderOrders();
  renderReservations();
  renderStock();

  const orders = Store.get().orders;
  orders.forEach((o) => { ui.known.add(o.number); ui.lastStatus[o.number] = o.status; });
  ui.first = false;
}
