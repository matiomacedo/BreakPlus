/* ==========================================================================
   auth.js — login da app dos alunos/docentes: email + password, depois o
   PIN do cartão num keypad 0–9. Arranque: Auth.start({ key, roles, onEnter }).
   Também usado pelo terminal do bar, só para contas com o papel "staff".
   ========================================================================== */

const Auth = (() => {
  const el = (id) => document.getElementById(id);
  let cfg = { key: 'bp_token', roles: [], onEnter() {} };
  let preToken = null, pin = '';

  const token = () => localStorage.getItem(cfg.key);
  const userKey = () => cfg.key + '_user';

  /** Última conta conhecida: permite abrir a app sem rede (o token continua guardado). */
  const cachedUser = () => {
    try { return JSON.parse(localStorage.getItem(userKey())); } catch { return null; }
  };
  const saveUser = (user) => {
    try { localStorage.setItem(userKey(), JSON.stringify(user)); } catch { /* sem armazenamento */ }
  };

  /** Overlay de carregamento (shared/boot.css): útil quando o servidor está a acordar. */
  const boot = (message) => {
    const overlay = el('boot');
    if (!overlay) return;
    const text = el('boot-msg');
    if (text && message) text.textContent = message;
    overlay.hidden = false;
  };
  const bootDone = () => { const overlay = el('boot'); if (overlay) overlay.hidden = true; };

  /** fetch ao servidor com o token. Sessão expirada → volta ao login. */
  async function api(path, body) {
    const { status, data } = await requestJson(path, { body, headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
    if (status === 401 && data.reason === 'unauthenticated' && token()) logout();
    return data;
  }

  const logout = () => {
    localStorage.removeItem(cfg.key);
    localStorage.removeItem(userKey());
    location.reload();
  };
  const step = (n) => { el('auth-s1').hidden = n !== 1; el('auth-s2').hidden = n !== 2; err(''); };
  const err = (msg) => { el('auth-err').textContent = msg; };
  const allowed = (u) => !cfg.roles.length || cfg.roles.includes(u.role);
  const drawDots = () => document.querySelectorAll('#pin-dots i').forEach((d, i) => d.classList.toggle('on', i < pin.length));

  async function enter(user) {
    el('auth').hidden = true;
    boot('A carregar os teus dados…');
    try {
      await cfg.onEnter(user);
    } finally {
      bootDone();
    }
  }

  /** O servidor recusou mesmo a sessão (401): só aí se apaga o token. */
  function rejectSession(message = '') {
    localStorage.removeItem(cfg.key);
    localStorage.removeItem(userKey());
    bootDone();
    el('auth').hidden = false;
    el('auth-retry').hidden = true;
    err(message);
  }

  /** Sem ligação: mantém o token e abre com a última conta conhecida, se existir. */
  function offline() {
    const user = cachedUser();
    if (user && allowed(user)) return enter(user);
    bootDone();
    el('auth').hidden = false;
    el('auth-retry').hidden = false;
    err('Sem ligação ao servidor');
  }

  let resuming = false;
  /** Valida a sessão guardada. Rede em baixo não invalida a sessão. */
  async function resume() {
    if (resuming) return;
    resuming = true;
    boot('A validar a sessão…');
    try {
      const { status, data } = await requestJson('/api/auth/me', {
        headers: token() ? { Authorization: 'Bearer ' + token() } : {},
      });
      if (data.ok) {
        if (!allowed(data.user)) return rejectSession('Esta conta não tem acesso a esta aplicação');
        saveUser(data.user);
        return enter(data.user);
      }
      if (status === 401 && data.reason === 'unauthenticated') return rejectSession();
      offline();                                  // rede/servidor em baixo: sessão fica guardada
    } catch {
      offline();
    } finally {
      resuming = false;
    }
  }

  async function submitLogin() {
    const email = el('auth-email').value, password = el('auth-pass').value;
    if (!email || !password) return err('Preenche o email e a password');
    boot('A entrar…');
    try {
      const r = await api('/api/auth/login', { email, password });
      if (r.ok) { preToken = r.preToken; pin = ''; drawDots(); el('auth-hello').textContent = 'Olá, ' + r.name.split(' ')[0]; return step(2); }
      err(r.reason === 'locked' ? `Demasiadas tentativas. Tenta daqui a ${r.minutes} min`
        : r.reason === 'credentials' ? 'Email ou password incorretos' : 'Sem ligação ao servidor');
    } finally {
      bootDone();
    }
  }

  async function press(key) {
    if (key === 'back') pin = pin.slice(0, -1); else if (pin.length < 4) pin += key;
    drawDots(); err('');
    if (pin.length < 4) return;
    boot('A confirmar o PIN…');
    try {
      const r = await api('/api/auth/pin', { preToken, pin });
      if (r.ok) {
        if (!allowed(r.user)) { pin = ''; drawDots(); step(1); return err('Esta conta não tem acesso a esta aplicação'); }
        localStorage.setItem(cfg.key, r.token);
        saveUser(r.user);
        return enter(r.user);                     // enter() mantém o overlay até os dados carregarem
      }
      pin = ''; drawDots();
      const dots = el('pin-dots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
      if (r.reason === 'expired') { step(1); return err('A sessão expirou. Entra outra vez'); }
      err(r.reason === 'locked' ? `Conta bloqueada. Tenta daqui a ${r.minutes} min`
        : r.reason === 'pin' ? `PIN incorreto · ${r.attemptsLeft} tentativas`
        : 'Sem ligação ao servidor');
    } finally {
      bootDone();
    }
  }

  function start(config) {
    cfg = { ...cfg, ...config };
    el('auth-s1').addEventListener('submit', (e) => { e.preventDefault(); submitLogin(); });
    el('auth-keypad').addEventListener('click', (e) => { const b = e.target.closest('[data-key]'); if (b) press(b.dataset.key); });
    el('auth-back').addEventListener('click', () => { preToken = null; pin = ''; step(1); });
    el('auth-retry').addEventListener('click', () => {
      el('auth-retry').hidden = true;
      err('A tentar ligar…');
      resume();
    });
    window.addEventListener('online', () => {
      if (token() && !el('auth').hidden) resume();   // a rede voltou: tenta sozinho
    });
    document.addEventListener('keydown', (e) => {
      if (el('auth').hidden || el('auth-s2').hidden) return;
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('back');
    });

    /* Teclado do telemóvel: rola o campo focado para ficar acima do teclado.
       O zoom continua bloqueado (shared/nozoom.js); aqui só se ajusta o scroll. */
    const auth = el('auth');
    const isField = (node) => node instanceof Element && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
    const revealFocused = () => {
      const field = document.activeElement;
      if (!field || !isField(field) || !auth.contains(field)) return;
      const vv = window.visualViewport;
      const top = vv ? vv.offsetTop : 0;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const rect = field.getBoundingClientRect();
      const margin = 16;
      if (rect.bottom > bottom - margin) auth.scrollTop += rect.bottom - (bottom - margin);
      else if (rect.top < top + margin) auth.scrollTop -= (top + margin) - rect.top;
    };
    auth.addEventListener('focusin', (event) => {
      if (isField(event.target)) setTimeout(revealFocused, 320);   // espera o teclado abrir
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => setTimeout(revealFocused, 60));
    }

    if (token()) resume();
    else { bootDone(); el('auth').hidden = false; }
  }

  return { start, api, token, logout };
})();
