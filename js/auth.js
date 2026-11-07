/* ==========================================================================
   auth.js — login da app dos alunos/docentes: email + password, depois o
   PIN do cartão num keypad 0–9. Arranque: Auth.start({ key, roles, onEnter }).
   (O terminal do bar não tem login: ver terminal/js/store.js.)
   ========================================================================== */

const Auth = (() => {
  const el = (id) => document.getElementById(id);
  let cfg = { key: 'bp_token', roles: [], onEnter() {} };
  let preToken = null, pin = '';

  const token = () => localStorage.getItem(cfg.key);

  /** fetch ao servidor com o token. Sessão expirada → volta ao login. */
  async function api(path, body) {
    const { status, data } = await requestJson(path, { body, headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
    if (status === 401 && data.reason === 'unauthenticated' && token()) logout();
    return data;
  }

  const logout = () => { localStorage.removeItem(cfg.key); location.reload(); };
  const step = (n) => { el('auth-s1').hidden = n !== 1; el('auth-s2').hidden = n !== 2; err(''); };
  const err = (msg) => { el('auth-err').textContent = msg; };
  const allowed = (u) => !cfg.roles.length || cfg.roles.includes(u.role);
  const drawDots = () => document.querySelectorAll('#pin-dots i').forEach((d, i) => d.classList.toggle('on', i < pin.length));

  function enter(user) { el('auth').hidden = true; cfg.onEnter(user); }

  async function submitLogin() {
    const email = el('auth-email').value, password = el('auth-pass').value;
    if (!email || !password) return err('Preenche o email e a password');
    const r = await api('/api/auth/login', { email, password });
    if (r.ok) { preToken = r.preToken; pin = ''; drawDots(); el('auth-hello').textContent = 'Olá, ' + r.name.split(' ')[0]; return step(2); }
    err(r.reason === 'locked' ? `Demasiadas tentativas. Tenta daqui a ${r.minutes} min`
      : r.reason === 'credentials' ? 'Email ou password incorretos' : 'Sem ligação ao servidor');
  }

  async function press(key) {
    if (key === 'back') pin = pin.slice(0, -1); else if (pin.length < 4) pin += key;
    drawDots(); err('');
    if (pin.length < 4) return;
    const r = await api('/api/auth/pin', { preToken, pin });
    if (r.ok) {
      if (!allowed(r.user)) { pin = ''; drawDots(); step(1); return err('Esta conta não tem acesso a esta aplicação'); }
      localStorage.setItem(cfg.key, r.token);
      return enter(r.user);
    }
    pin = ''; drawDots();
    const dots = el('pin-dots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
    if (r.reason === 'expired') { step(1); return err('A sessão expirou. Entra outra vez'); }
    err(r.reason === 'locked' ? `Conta bloqueada. Tenta daqui a ${r.minutes} min`
      : r.reason === 'pin' ? (r.attemptsLeft ? `PIN incorreto · ${r.attemptsLeft} tentativas` : 'Conta bloqueada por 5 min')
      : 'Sem ligação ao servidor');
  }

  function start(config) {
    cfg = { ...cfg, ...config };
    el('auth-s1').addEventListener('submit', (e) => { e.preventDefault(); submitLogin(); });
    el('auth-keypad').addEventListener('click', (e) => { const b = e.target.closest('[data-key]'); if (b) press(b.dataset.key); });
    el('auth-back').addEventListener('click', () => { preToken = null; pin = ''; step(1); });
    document.addEventListener('keydown', (e) => {
      if (el('auth').hidden || el('auth-s2').hidden) return;
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('back');
    });
    if (token()) {
      api('/api/auth/me').then((r) => { if (r.ok && allowed(r.user)) enter(r.user); else { localStorage.removeItem(cfg.key); el('auth').hidden = false; } });
    } else el('auth').hidden = false;
  }

  return { start, api, token, logout };
})();
