'use strict';
/* global UI, icon, api, state, render, renderSidebar, loadSettings, saveSettings, errToast */
// Ustawienia → AI: sposób pracy (Bez AI / Lokalny model / Konto AI), konta ChatGPT, Gemini i Claude
// z rozpoznaniem planu (darmowy / płatny) oraz lokalny model przez Ollama.
const { h, iconEl, toast, sheet, toggle, segmented, select, spinner, group, row, busy } = UI;

// Odświeżenie widoku z zachowaniem przewinięcia (i bez przerywania pisania w polu).
function rerender() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox' && state.view === 'settings') { renderSidebar(); return; }
  const c = document.getElementById('content');
  const y = c ? c.scrollTop : 0;
  render();
  if (c) c.scrollTop = y;
}

// ───────────────────────── konta ─────────────────────────
// Domyślnie bezpłatnie: ChatGPT i Google Gemini działają na darmowych kontach. Claude wymaga planu Pro/Max.
const ACCOUNTS = [
  {
    id: 'codex', name: 'ChatGPT', vendor: 'OpenAI', program: 'Codex CLI', icon: 'sparkles', grad: 'linear-gradient(145deg, #1fc485, #0a7d55)', free: true,
    plan: 'Wypróbujesz na darmowym koncie ChatGPT',
    paidInfo: 'Plany Go, Plus i Pro dają większe limity i nowsze modele.',
    blurb: 'Modele GPT od OpenAI. Logujesz się na stronie OpenAI tym samym kontem co w ChatGPT.',
    signup: 'https://chatgpt.com', upgrade: 'https://chatgpt.com/pricing', dataUrl: 'https://chatgpt.com/#settings/DataControls',
    install: { win: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', unix: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' },
    login: 'codex login', loginHint: 'Otworzy się strona logowania OpenAI – zaloguj się kontem ChatGPT.'
  },
  {
    id: 'gemini', name: 'Google Gemini', vendor: 'Google', program: 'Antigravity CLI', icon: 'brain', grad: 'linear-gradient(145deg, #4f8cff, #8a5cff)', free: true,
    plan: 'Wypróbujesz na darmowym koncie Google (Gmail)',
    paidInfo: 'Google AI Pro i Ultra odblokowują mocniejsze modele Gemini i wyższe limity.',
    blurb: 'Modele Gemini od Google. Logujesz się na stronie Google swoim prywatnym kontem (Gmail).',
    signup: 'https://accounts.google.com/signup', upgrade: 'https://one.google.com/about/ai-premium', dataUrl: 'https://myaccount.google.com/data-and-privacy',
    install: { win: 'powershell -ExecutionPolicy ByPass -c "irm https://antigravity.google/cli/install.ps1 | iex"', unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
    login: 'agy', loginHint: 'Uruchom program – otworzy się strona logowania Google. Po zalogowaniu wpisz /exit i naciśnij Enter.'
  },
  {
    id: 'claude-code', name: 'Claude', vendor: 'Anthropic', program: 'Claude Code', icon: 'speech', grad: 'linear-gradient(145deg, #d97757, #b9532f)', free: false,
    plan: 'Wymaga płatnego planu Claude Pro lub Max',
    paidInfo: 'Darmowe konto Claude nie obejmuje programu Claude Code.',
    blurb: 'Modele Claude od Anthropic – korzystasz z limitów swojego opłaconego planu.',
    signup: 'https://claude.ai/upgrade', upgrade: 'https://claude.ai/upgrade', dataUrl: 'https://claude.ai/settings/data-privacy-controls',
    install: { win: 'powershell -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"', unix: 'curl -fsSL https://claude.ai/install.sh | bash' },
    login: 'claude auth login', loginHint: 'Otworzy się strona logowania Claude – zaloguj się kontem z planem Pro lub Max.'
  }
];
const accDef = (id) => ACCOUNTS.find((a) => a.id === id) || { id, name: id, vendor: '', program: id };
function accUi(id) { return (state.acc[id] = state.acc[id] || { installing: false, log: '', login: null, guide: false }); }
const isWinPlatform = () => state.info && state.info.platform === 'win32';
const isAccount = (id) => ACCOUNTS.some((a) => a.id === id);

async function refreshAccounts(ids = ACCOUNTS.map((a) => a.id)) {
  await Promise.all(ids.map(async (id) => {
    try { state.accounts[id] = await api.accountStatus(id); } catch (e) { state.accounts[id] = { id, installed: false, loggedIn: false }; }
  }));
  await syncConnected();
  if (state.view === 'settings') rerender(); else renderSidebar();
}

// Ustawienia „połączone konta” zgodne z faktycznym stanem kont.
async function syncConnected() {
  const ai = state.settings.ai;
  const conn = { ...(ai.connected || {}) };
  const patch = {};
  for (const d of ACCOUNTS) {
    const st = state.accounts[d.id];
    if (!st) continue;
    if (!!conn[d.id] !== !!st.loggedIn) { conn[d.id] = !!st.loggedIn; patch.connected = { ...(patch.connected || {}), [d.id]: !!st.loggedIn }; }
  }
  if (isAccount(ai.provider) && state.accounts[ai.provider] && !conn[ai.provider]) {
    const next = ACCOUNTS.find((d) => conn[d.id]);
    if (next) patch.provider = next.id;
  }
  if (Object.keys(patch).length) await saveSettings({ ai: patch }, true);
}

function copyText(t) {
  try { navigator.clipboard.writeText(t); toast('Skopiowano', 'success', 1400); } catch (_) { toast('Zaznacz i skopiuj tekst ręcznie', 'info'); }
}

function cmdBox(text) {
  return h('div', { class: 'cmd-box' }, h('code', null, text), h('button', { class: 'btn sm', onclick: () => copyText(text) }, iconEl('copy', 12), 'Kopiuj'));
}

function accLogo(def, ok) {
  return h('div', { class: 'acc-logo', style: { background: def.grad } }, h('span', { html: icon(def.icon, 22) }), ok ? h('span', { class: 'acc-badge', html: icon('check', 10) }) : null);
}

function planChip(def, st) {
  if (!st || !st.loggedIn) return def.free ? h('span', { class: 'chip green' }, 'darmowe konto wystarczy') : h('span', { class: 'chip orange' }, 'płatny plan');
  if (def.id === 'claude-code' && st.tier !== 'paid') return h('span', { class: 'chip orange' }, 'brak planu Pro/Max');
  if (st.tier === 'paid') return h('span', { class: 'chip purple' }, iconEl('crown', 11), `plan płatny${st.planName && st.planName !== 'darmowy' ? ' · ' + st.planName : ''}`);
  return h('span', { class: 'chip green' }, 'plan darmowy – tryb próbny');
}

// Panel planu połączonego konta: tryb próbny na darmowym planie albo własne opłacone limity.
function planPanel(def, st) {
  const ai = state.settings.ai;
  const detected = st.detectedTier ? (st.detectedTier === 'paid' ? `płatny${st.planName ? ' – ' + st.planName : ''}` : 'darmowy') : 'nie rozpoznano';
  const planSel = select([
    { value: 'auto', label: `Rozpoznaj automatycznie (${detected})` },
    { value: 'free', label: 'Darmowy – tryb próbny' },
    { value: 'paid', label: 'Płatny – używaj moich opłaconych limitów' }
  ], (ai.plans || {})[def.id] || 'auto', async (v) => {
    try { state.accounts[def.id] = await api.accountPlan(def.id, v); await loadSettings(); rerender(); } catch (e) { errToast(e); }
  }, { style: { maxWidth: '330px' } });

  const lines = [];
  if (st.tier === 'paid') {
    const paidModels = ai.paidModels !== false;
    lines.push(h('div', { class: 'plan-note paid' }, iconEl('crown', 14), h('div', null,
      h('b', null, 'Korzystasz z płatnego planu. '),
      paidModels ? 'Zapytania aplikacji zużywają limity Twojego opłaconego planu. Możesz wybrać mocniejszy model – puste pole oznacza domyślny model Twojego planu.' : 'Mocniejsze modele są wyłączone – aplikacja używa domyślnego modelu konta.')));
    if (paidModels) lines.push(h('div', { class: 'plan-row' }, h('span', { class: 'muted small' }, 'Model:'), modelControl(def, st)));
  } else if (def.id === 'claude-code') {
    lines.push(h('div', { class: 'plan-note warn' }, iconEl('warn', 14), h('div', null,
      h('b', null, 'To konto nie ma planu Pro ani Max. '), 'Claude Code działa tylko na płatnym planie Claude. Wypróbuj aplikację bezpłatnie z ChatGPT, Gemini albo z lokalnym modelem. ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal(def.upgrade); } }, 'Plany Claude'))));
  } else {
    lines.push(h('div', { class: 'plan-note' }, iconEl('info', 14), h('div', null,
      h('b', null, 'Tryb próbny – plan darmowy. '), `Aplikacja korzysta z darmowego limitu i domyślnego modelu konta ${def.name}. ${def.paidInfo} `,
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal(def.upgrade); } }, 'Porównaj plany'))));
  }
  return h('div', { class: 'acc-sub' }, ...lines, h('div', { class: 'plan-row' }, h('span', { class: 'muted small' }, 'Plan konta:'), planSel));
}

function modelControl(def, st) {
  const ai = state.settings.ai;
  if (def.id === 'claude-code') {
    return select([{ value: 'sonnet', label: 'Sonnet (zalecany)' }, { value: 'opus', label: 'Opus (najdokładniejszy, szybciej zużywa limit)' }, { value: 'haiku', label: 'Haiku (najszybszy)' }], ai.model || 'sonnet', (v) => saveSettings({ ai: { model: v } }, true));
  }
  if (def.id === 'gemini' && st.models && st.models.length) {
    return select([{ value: '', label: 'Domyślny dla konta' }, ...st.models.map((m) => ({ value: m, label: m }))], ai.geminiModel || '', (v) => saveSettings({ ai: { geminiModel: v } }, true));
  }
  const key = def.id === 'codex' ? 'codexModel' : 'geminiModel';
  return h('input', { class: 'input', style: { width: '220px' }, value: ai[key] || '', placeholder: 'domyślny dla konta', onchange: (e) => saveSettings({ ai: { [key]: e.target.value.trim() } }, true) });
}

function accountCard(def) {
  const st = state.accounts[def.id];
  const A = accUi(def.id);
  const ai = state.settings.ai;
  const active = ai.provider === def.id;
  const connected = !!(st && st.loggedIn);
  const chips = [planChip(def, st), active && connected ? h('span', { class: 'chip blue' }, 'używane w aplikacji') : null];
  const head = (sub, ...buttons) => h('div', { class: 'acc-row' }, accLogo(def, connected),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'acc-title' }, def.name, ...chips), h('div', { class: 'muted small' }, sub)),
    ...buttons);
  const wrap = h('div', { class: 'account' + (active && connected ? ' active' : '') });

  if (!st) { wrap.append(head('Sprawdzam połączenie…', spinner(16))); return wrap; }

  if (A.installing) {
    wrap.append(head(`Instaluję ${def.program} od ${def.vendor}… (ok. 1 minuty)`, spinner(18)),
      h('pre', { class: 'acc-log', 'data-id': def.id }, (A.log || '').split('\n').slice(-6).join('\n')));
    return wrap;
  }

  if (A.login) { wrap.append(head(def.plan), loginPanel(def, A.login)); return wrap; }

  if (connected) {
    const who = [st.email, st.method ? `logowanie: ${st.method}` : null].filter(Boolean).join(' · ');
    wrap.append(head(`Połączono${who ? ' · ' + who : ''}`,
      !active && !(def.id === 'claude-code' && st.tier !== 'paid') ? h('button', { class: 'btn', onclick: async () => { await api.setAiMode(def.id); await loadSettings(); state.aiView = 'cloud'; toast(`Aplikacja korzysta teraz z konta ${def.name}`, 'success'); rerender(); } }, 'Używaj') : null,
      h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { try { toast(await api.testAi(def.id), 'success', 6000); } catch (er) { errToast(er); } }, 'Testuję…') }, iconEl('bolt', 13), 'Testuj'),
      h('button', { class: 'btn danger', onclick: () => disconnectAccount(def) }, 'Odłącz')),
    planPanel(def, st));
    return wrap;
  }

  wrap.append(head(`${def.plan}. ${st.installed ? `Program ${def.program} jest zainstalowany – wystarczy się zalogować.` : def.blurb}`,
    h('button', { class: 'btn primary', onclick: () => connectAccount(def) }, iconEl('key', 13), 'Połącz')));
  if (A.guide) wrap.append(guidePanel(def));
  else wrap.append(h('div', { class: 'acc-sub' }, h('div', { class: 'acc-links', style: { marginTop: 0 } },
    h('button', { class: 'btn plain sm', onclick: () => { A.guide = true; rerender(); } }, iconEl('list', 12), 'Poprowadź mnie krok po kroku'),
    h('button', { class: 'btn plain sm', onclick: () => api.openExternal(def.signup) }, iconEl('globe', 12), def.free ? 'Nie mam konta – załóż bezpłatnie' : 'Plany Claude'))));
  return wrap;
}

function loginPanel(def, L) {
  const A = accUi(def.id);
  const cancel = h('button', { class: 'btn', onclick: async () => { await api.accountCancel(def.id).catch(() => {}); A.login = null; rerender(); } }, 'Anuluj');
  const waiting = (title, sub) => h('div', { class: 'acc-row acc-wait' }, h('div', { class: 'acc-spin' }, spinner(18)), h('div', { style: { flex: 1 } }, h('div', { class: 'acc-title' }, title), h('div', { class: 'muted small' }, sub)), cancel);

  if (L.stage === 'terminal' || L.mode === 'terminal') {
    return h('div', { class: 'acc-sub' },
      waiting('Logowanie w okienku terminala…', def.id === 'gemini'
        ? 'Otworzyłem małe okno logowania i stronę Google w przeglądarce. Zaloguj się kontem Google. Jeśli strona pokaże kod – wklej go w okienku terminala i naciśnij Enter. Aplikacja połączy się sama.'
        : `Otworzyłem okno logowania ${def.name}. Zaloguj się w przeglądarce; jeśli strona pokaże kod – wklej go w okienku i naciśnij Enter.`),
      h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Nie widzisz okienka? Sprawdź pasek zadań albo wybierz „Poprowadź mnie krok po kroku”.'));
  }

  if (L.stage === 'device' || L.mode === 'device') {
    return h('div', { class: 'acc-sub' },
      waiting('Logowanie kodem…', 'Otwórz stronę OpenAI, zaloguj się i wpisz poniższy kod. Aplikacja połączy się sama.'),
      h('div', { class: 'device-box' },
        h('div', null, h('div', { class: 'muted small' }, '1. Otwórz stronę'), h('button', { class: 'btn sm', disabled: L.url ? null : true, onclick: () => api.openExternal(L.url) }, iconEl('globe', 12), L.url ? 'Otwórz stronę logowania' : 'czekam na adres…')),
        h('div', null, h('div', { class: 'muted small' }, '2. Wpisz kod'), L.code ? h('div', { class: 'device-code' }, L.code, h('button', { class: 'btn sm', onclick: () => copyText(L.code) }, iconEl('copy', 12), 'Kopiuj')) : spinner(14))));
  }

  const parts = [waiting('Czekam na zalogowanie w przeglądarce…', `${def.loginHint} Aplikacja połączy się sama.`)];
  const links = [];
  if (L.url) links.push(h('button', { class: 'btn plain sm', onclick: () => api.openExternal(L.url) }, iconEl('globe', 12), 'Przeglądarka się nie otworzyła? Otwórz stronę logowania'));
  if (def.id === 'codex') links.push(h('button', { class: 'btn plain sm', onclick: () => startAccountLogin(def, 'device') }, iconEl('key', 12), 'Nie działa? Zaloguj się kodem'));
  if (links.length) parts.push(h('div', { class: 'acc-links' }, links));
  if (def.id === 'claude-code') {
    const code = h('input', { class: 'input', style: { flex: 1 }, placeholder: 'Wklej kod ze strony logowania (jeśli się pojawił)' });
    parts.push(h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', width: '100%' } }, code,
      h('button', { class: 'btn primary', onclick: async () => { if (!code.value.trim()) return; try { await api.accountCode(def.id, code.value); toast('Przekazano kod – trwa łączenie…', 'info', 3000); } catch (er) { errToast(er); } } }, 'Zatwierdź kod')));
  }
  return h('div', { class: 'acc-sub' }, parts);
}

function guidePanel(def) {
  const A = accUi(def.id);
  const win = isWinPlatform();
  const st = state.accounts[def.id] || {};
  const step = (n, title, body) => h('div', { class: 'guide-step' + (n === 3 && st.installed ? ' done' : '') },
    h('div', { class: 'guide-num' }, n === 3 && st.installed ? h('span', { html: icon('check', 12) }) : String(n)),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'guide-title' }, title), body || null));
  return h('div', { class: 'acc-guide' },
    h('div', { class: 'guide-head' }, h('b', null, `Połączenie z ${def.name} krok po kroku`), h('div', { class: 'spacer' }), h('button', { class: 'btn plain sm', onclick: () => { A.guide = false; rerender(); } }, 'Zwiń')),
    step(1, def.free ? `Załóż bezpłatne konto ${def.vendor}, jeśli go nie masz.` : 'Upewnij się, że masz plan Claude Pro lub Max.', h('button', { class: 'btn sm', onclick: () => api.openExternal(def.signup) }, iconEl('globe', 12), 'Otwórz stronę')),
    step(2, win ? 'Otwórz PowerShell: kliknij prawym przyciskiem menu Start i wybierz „Terminal”.' : 'Otwórz Terminal (Ctrl+Alt+T).'),
    step(3, st.installed ? `${def.program} jest już zainstalowany.` : `Wklej polecenie instalacji ${def.program} i naciśnij Enter:`, st.installed ? null : cmdBox(win ? def.install.win : def.install.unix)),
    step(4, win ? 'Zamknij i otwórz Terminal ponownie, a potem wpisz polecenie logowania:' : 'Wpisz polecenie logowania:', h('div', null, cmdBox(def.login), h('div', { class: 'muted small', style: { marginTop: '4px' } }, def.loginHint))),
    step(5, 'Wróć tutaj i sprawdź połączenie.', h('div', { class: 'guide-actions' },
      h('button', { class: 'btn primary sm', onclick: (e) => busy(e.currentTarget, () => checkAccount(def), 'Sprawdzam…') }, iconEl('checkCircle', 12), 'Sprawdź połączenie'),
      st.installed ? h('button', { class: 'btn sm', onclick: () => startAccountLogin(def, 'terminal') }, 'Otwórz logowanie w okienku') : null,
      h('button', { class: 'btn plain sm', onclick: async () => { try { const r = await api.accountBrowse(def.id); if (r) { state.accounts[def.id] = r; rerender(); } } catch (er) { errToast(er); } } }, iconEl('folder', 12), 'Wskaż program…'))));
}

async function checkAccount(def) {
  await refreshAccounts([def.id]);
  let st = state.accounts[def.id];
  if (st && st.installed && !st.loggedIn && def.id === 'gemini') {
    // Antigravity CLI nie ma polecenia „status” – krótkie zapytanie testowe potwierdza logowanie
    try { await api.testAi('gemini'); await loadSettings(); await refreshAccounts(['gemini']); st = state.accounts.gemini; } catch (_) { /* niezalogowany */ }
  }
  if (!st || !st.installed) toast(`Nie znaleziono programu ${def.program}. Zainstaluj go (krok 3) albo wskaż jego plik.`, 'error', 7000);
  else if (!st.loggedIn) toast(`${def.program} jest zainstalowany, ale nie jesteś zalogowany (krok 4).`, 'info', 7000);
  else { accUi(def.id).guide = false; toast(`Połączono z kontem ${def.name}`, 'success'); rerender(); }
}

function connectAccount(def) {
  const consent = (state.settings.ai.consent || {})[def.id];
  if (consent) return runConnect(def);
  const chk = h('input', { type: 'checkbox' });
  const installed = (state.accounts[def.id] || {}).installed;
  const goBtn = h('button', { class: 'btn primary', disabled: true }, iconEl('bolt', 13), installed ? 'Połącz' : 'Zainstaluj i połącz');
  chk.addEventListener('change', () => { goBtn.disabled = !chk.checked; });
  let sh = null;
  const guideBtn = h('button', { class: 'btn', onclick: () => { sh.close(); accUi(def.id).guide = true; rerender(); } }, iconEl('list', 13), 'Poprowadź mnie krok po kroku');
  sh = sheet({
    title: `Połącz z kontem ${def.name}`,
    subtitle: def.plan,
    body: h('div', { class: 'consent' },
      h('p', null, `Do połączenia potrzebny jest oficjalny, bezpłatny program ${def.program} od ${def.vendor}. Mogę zrobić wszystko za Ciebie albo poprowadzić Cię krok po kroku.`),
      h('div', { class: 'consent-box' },
        h('div', { class: 'consent-title' }, iconEl('wand', 14), 'Zrób to za mnie'),
        h('ol', { class: 'steps-list' },
          installed ? null : h('li', null, `Pobiorę i zainstaluję ${def.program} z oficjalnej strony ${def.vendor} – do Twojego folderu użytkownika, bez uprawnień administratora (ok. 1 minuty).`),
          h('li', null, def.id === 'gemini' ? 'Otworzę małe okienko logowania i stronę Google w przeglądarce – zalogujesz się swoim kontem Google.' : `Otworzę stronę logowania ${def.vendor} w przeglądarce – zalogujesz się swoim kontem.`),
          h('li', null, def.free ? 'Rozpoznam plan konta: na darmowym koncie aplikacja działa w trybie próbnym, na płatnym – korzysta z Twoich opłaconych limitów.' : 'Sprawdzę plan konta i połączenie.')),
        h('label', { class: 'consent-check' }, chk, h('span', null, `Zgadzam się, aby aplikacja ${installed ? '' : `zainstalowała ${def.program} i `}przeprowadziła logowanie w moim imieniu.`))),
      h('div', { class: 'consent-note' }, iconEl('shield', 14), h('div', null,
        h('b', null, 'Twoje dane. '), `Hasło wpisujesz tylko na stronie ${def.vendor} – aplikacja go nie widzi i nie przechowuje. Do ${def.vendor} trafia wyłącznie treść planów i opisów ocen bez imienia, nazwiska, PESEL-u, daty urodzenia i adresu (sprawdza to strażnik prywatności). `,
        def.free ? 'Na darmowych kontach dostawca może wykorzystywać przesłane treści do ulepszania modeli – możesz to wyłączyć w ' : 'Możesz sprawdzić ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal(def.dataUrl); } }, 'ustawieniach prywatności konta'), '.')),
      h('div', { class: 'consent-actions' }, guideBtn, h('div', { class: 'spacer' }), goBtn))
  });
  goBtn.addEventListener('click', async () => {
    sh.close();
    await saveSettings({ ai: { consent: { [def.id]: new Date().toISOString() } } }, true);
    runConnect(def);
  });
}

async function runConnect(def) {
  const A = accUi(def.id);
  A.guide = false;
  let st = state.accounts[def.id];
  try {
    if (!st || !st.installed) {
      A.installing = true; A.log = ''; rerender();
      st = state.accounts[def.id] = await api.accountInstall(def.id);
      A.installing = false;
    }
    if (st.loggedIn) { await syncConnected(); rerender(); return; }
    await startAccountLogin(def, 'auto');
  } catch (e) { A.installing = false; A.login = null; errToast(e); rerender(); }
}

async function startAccountLogin(def, mode) {
  const A = accUi(def.id);
  try {
    if (A.login) await api.accountCancel(def.id).catch(() => {});
    A.login = { stage: 'start', mode: def.id === 'gemini' ? 'terminal' : mode };
    rerender();
    await api.accountLogin(def.id, mode);
  } catch (e) { A.login = null; errToast(e); rerender(); }
}

function disconnectAccount(def) {
  sheet({
    title: `Odłączyć konto ${def.name}?`,
    body: h('p', { class: 'muted' }, def.id === 'gemini'
      ? 'Aplikacja przestanie korzystać z tego konta. Aby całkowicie wylogować program Antigravity CLI, uruchom w terminalu „agy” i wpisz /logout.'
      : `Program ${def.program} zostanie wylogowany z Twojego konta. Plany, oceny i profile pracowni pozostaną bez zmian.`),
    actions: [{ label: 'Anuluj' }, { label: 'Odłącz', kind: 'danger', onClick: async () => { try { state.accounts[def.id] = await api.accountLogout(def.id); await loadSettings(); rerender(); } catch (e) { errToast(e); } } }]
  });
}

// Zdarzenia z procesu głównego (instalacja i logowanie kont, model lokalny).
function bindAiEvents() {
  api.on('account:log', ({ id, text }) => {
    const A = accUi(id);
    A.log = (A.log + text).slice(-4000);
    const el = document.querySelector(`.acc-log[data-id="${id}"]`);
    if (el) el.textContent = A.log.split('\n').slice(-6).join('\n');
  });
  api.on('account:login', async (ev) => {
    const A = accUi(ev.id);
    const def = accDef(ev.id);
    if (ev.stage === 'done') {
      A.login = null;
      state.accounts[ev.id] = ev.status;
      await loadSettings();
      const st = ev.status || {};
      toast(`Połączono z kontem ${def.name}${st.tier === 'paid' ? ' – plan płatny' : st.tier === 'free' ? ' – plan darmowy (tryb próbny)' : ''}`, 'success', 5000);
    } else if (ev.stage === 'error') {
      A.login = null;
      errToast(new Error(ev.error));
    } else {
      A.login = { ...(A.login || {}), stage: ev.stage, mode: ev.mode, url: ev.url || (A.login && A.login.url), code: ev.code || (A.login && A.login.code) };
    }
    if (state.view === 'settings') rerender(); else renderSidebar();
  });
  api.on('local:log', (text) => {
    state.local.log = (state.local.log + text).slice(-4000);
    const el = document.querySelector('.acc-log[data-id="local"]');
    if (el) el.textContent = state.local.log.split('\n').slice(-6).join('\n');
  });
  api.on('local:pull', (p) => {
    state.local.pulling = { ...p };
    const bar = document.querySelector('.pull-bar > span');
    const txt = document.querySelector('.pull-text');
    if (bar && p.total) bar.style.width = Math.round((p.completed / p.total) * 100) + '%';
    if (txt) txt.textContent = pullText(p);
  });
}

// ───────────────────────── model lokalny (Ollama) ─────────────────────────
const RECOMMENDED_LOCAL = [
  { id: 'SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M', name: 'Bielik 11B v3', size: '6,7 GB', note: 'Polski model – najlepsza jakość tekstu. Zalecane 16 GB RAM (najlepiej z kartą graficzną).', best: true },
  { id: 'SpeakLeash/bielik-4.5b-v3.0-instruct:Q8_0', name: 'Bielik 4.5B v3', size: '5,1 GB', note: 'Polski model, szybszy – dla komputerów z 8 GB RAM.' }
];

async function refreshLocal() {
  try { state.local.status = await api.localStatus(); } catch (_) { state.local.status = { installed: false, running: false, models: [] }; }
  if (state.view === 'settings') rerender(); else renderSidebar();
}

const gb = (n) => (n / 1e9).toFixed(1).replace('.', ',') + ' GB';
function pullText(p) {
  if (!p) return '';
  if (p.total) return `${p.status || 'pobieranie'} – ${gb(p.completed)} z ${gb(p.total)} (${Math.round((p.completed / p.total) * 100)}%)`;
  return p.status || 'Łączę…';
}

async function pullModel(name) {
  const L = state.local;
  if (L.pulling) return;
  L.pulling = { model: name, status: 'Łączę…', total: 0, completed: 0 };
  rerender();
  try {
    L.status = await api.localPull(name);
    await loadSettings();
    toast(`Pobrano model ${name}`, 'success');
  } catch (e) { if (!/Przerwano/.test(e.message)) errToast(e); }
  L.pulling = null;
  rerender();
}

function localCard() {
  const L = state.local;
  const st = L.status;
  const ai = state.settings.ai;
  const logo = (ok) => h('div', { class: 'acc-logo', style: { background: 'linear-gradient(145deg, #5b6b7f, #2f3a48)' } }, h('span', { html: icon('laptop', 22) }), ok ? h('span', { class: 'acc-badge', html: icon('check', 10) }) : null);
  const head = (title, sub, ...buttons) => h('div', { class: 'acc-row' }, logo(st && st.running && ai.local.model),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'acc-title' }, title, h('span', { class: 'chip green' }, 'bezpłatnie, bez limitów')), h('div', { class: 'muted small' }, sub)), ...buttons);
  const wrap = h('div', { class: 'account' });
  if (!st) { wrap.append(head('Lokalny model (Ollama)', 'Sprawdzam…', spinner(16))); return wrap; }

  if (L.installing) {
    wrap.append(head('Instaluję Ollama…', 'Oficjalny instalator z ollama.com (kilka minut).', spinner(18)),
      h('pre', { class: 'acc-log', 'data-id': 'local' }, (L.log || '').split('\n').slice(-6).join('\n')));
    return wrap;
  }

  if (!st.installed) {
    const win = isWinPlatform();
    wrap.append(head('Lokalny model (Ollama)', 'Model działa na tym komputerze – dane nie opuszczają dysku. Potrzebny jest bezpłatny program Ollama.',
      h('button', { class: 'btn primary', onclick: installLocal }, iconEl('upload', 13), 'Zainstaluj Ollama')),
    h('div', { class: 'acc-sub' },
      h('div', { class: 'muted small' }, 'Albo zainstaluj ręcznie – wklej w terminalu:'), cmdBox(win ? 'irm https://ollama.com/install.ps1 | iex' : 'curl -fsSL https://ollama.com/install.sh | sh'),
      h('div', { class: 'acc-links' },
        h('button', { class: 'btn plain sm', onclick: () => api.openExternal('https://ollama.com/download') }, iconEl('globe', 12), 'ollama.com/download'),
        h('button', { class: 'btn plain sm', onclick: (e) => busy(e.currentTarget, refreshLocal, 'Sprawdzam…') }, iconEl('refresh', 12), 'Sprawdź'),
        h('button', { class: 'btn plain sm', onclick: async () => { try { const r = await api.localBrowse(); if (r) { state.local.status = r; rerender(); } } catch (e) { errToast(e); } } }, iconEl('folder', 12), 'Wskaż program…'))));
    return wrap;
  }

  if (!st.running) {
    wrap.append(head('Lokalny model (Ollama)', 'Ollama jest zainstalowany, ale nie działa.',
      h('button', { class: 'btn primary', onclick: (e) => busy(e.currentTarget, async () => { try { state.local.status = await api.localStart(); rerender(); } catch (er) { errToast(er); } }, 'Uruchamiam…') }, iconEl('bolt', 13), 'Uruchom'),
      h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, refreshLocal, 'Sprawdzam…') }, iconEl('refresh', 13), 'Sprawdź')));
    return wrap;
  }

  const have = new Set(st.models.map((m) => m.name));
  const current = ai.local.model && have.has(ai.local.model) ? ai.local.model : '';
  wrap.append(head('Lokalny model (Ollama)', `Ollama ${st.version} działa · ${st.models.length ? `${st.models.length} ${st.models.length === 1 ? 'model' : 'modele'} na dysku` : 'brak pobranych modeli'}`,
    st.models.length ? h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { try { toast(await api.testAi('local'), 'success', 6000); } catch (er) { errToast(er); } }, 'Testuję…') }, iconEl('bolt', 13), 'Testuj') : null));

  const sub = h('div', { class: 'acc-sub' });
  if (st.models.length) {
    sub.append(h('div', { class: 'plan-row' }, h('span', { class: 'muted small' }, 'Używany model:'),
      select([{ value: '', label: '— wybierz —' }, ...st.models.map((m) => ({ value: m.name, label: `${m.name}${m.params ? ' · ' + m.params : ''} · ${gb(m.size)}` }))], current, async (v) => { await saveSettings({ ai: { local: { model: v } } }, true); rerender(); }, { style: { maxWidth: '420px' } })));
  }
  if (L.pulling) {
    sub.append(h('div', { class: 'pull' },
      h('div', { class: 'acc-title' }, `Pobieram ${L.pulling.model}`),
      h('div', { class: 'pull-bar' }, h('span', { style: { width: L.pulling.total ? Math.round((L.pulling.completed / L.pulling.total) * 100) + '%' : '0%' } })),
      h('div', { class: 'pull-row' }, h('span', { class: 'pull-text muted small' }, pullText(L.pulling)), h('button', { class: 'btn sm', onclick: () => api.localCancelPull() }, 'Przerwij'))));
  }
  sub.append(h('div', { class: 'muted small', style: { marginTop: '10px' } }, 'Polecane modele do pisania po polsku:'));
  for (const m of RECOMMENDED_LOCAL) {
    const got = have.has(m.id);
    sub.append(h('div', { class: 'model-row' },
      h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'acc-title' }, m.name, h('span', { class: 'chip' }, m.size), m.best ? h('span', { class: 'chip blue' }, 'zalecany') : null), h('div', { class: 'muted small' }, m.note)),
      got ? (current === m.id ? h('span', { class: 'chip green' }, iconEl('check', 11), 'używany') : h('button', { class: 'btn sm', onclick: async () => { await saveSettings({ ai: { local: { model: m.id } } }, true); rerender(); } }, 'Używaj'))
        : h('button', { class: 'btn sm primary', disabled: L.pulling ? true : null, onclick: () => pullModel(m.id) }, iconEl('arrowDown', 12), 'Pobierz')));
  }
  const custom = h('input', { class: 'input', style: { flex: 1 }, placeholder: 'inny model z ollama.com, np. SpeakLeash/bielik-11b-v3.1-instruct:Q4_K_M' });
  sub.append(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', width: '100%' } }, custom,
    h('button', { class: 'btn sm', disabled: L.pulling ? true : null, onclick: () => { if (custom.value.trim()) pullModel(custom.value.trim()); } }, iconEl('arrowDown', 12), 'Pobierz')));
  wrap.append(sub);
  return wrap;
}

async function installLocal() {
  const L = state.local;
  L.installing = true; L.log = ''; rerender();
  try {
    const r = await api.localInstall();
    L.installing = false;
    if (r.terminal) toast('Otworzyłem okno terminala z instalatorem Ollama. Po zakończeniu kliknij „Sprawdź”.', 'info', 9000);
    L.status = r.status;
  } catch (e) { L.installing = false; errToast(e); }
  rerender();
}

// ───────────────────────── zakładka AI ─────────────────────────
function aiViewOf(provider) { return provider === 'none' ? 'none' : provider === 'local' ? 'local' : 'cloud'; }

async function chooseView(v) {
  state.aiView = v;
  const ai = state.settings.ai;
  if (v === 'none') await api.setAiMode('none');
  if (v === 'local') await api.setAiMode('local');
  if (v === 'cloud' && aiViewOf(ai.provider) !== 'cloud') {
    const conn = ACCOUNTS.find((d) => state.accounts[d.id] && state.accounts[d.id].loggedIn);
    if (conn) await api.setAiMode(conn.id);
  }
  await loadSettings();
  if (v === 'local' && !state.local.status) refreshLocal();
  rerender();
}

function modeCards() {
  const cur = state.aiView || aiViewOf(state.settings.ai.provider);
  const card = (v, ic, title, text, color) => h('button', { class: 'mode-card' + (cur === v ? ' active' : ''), onclick: () => chooseView(v) },
    h('span', { class: 'mode-ic', style: { background: color }, html: icon(ic, 18) }),
    h('div', { class: 'mode-title' }, title), h('div', { class: 'mode-text' }, text));
  return h('section', { class: 'group' }, h('h3', { class: 'group-title' }, 'Jak aplikacja ma korzystać z AI?'),
    h('div', { class: 'mode-cards' },
      card('none', 'pen', 'Bez AI', 'Plany i oceny z profili pracowni. Nic nie jest nigdzie wysyłane.', 'var(--text-3)'),
      card('local', 'laptop', 'Lokalny model', 'AI działa na tym komputerze (Ollama). Bezpłatnie i bez limitów.', '#4a5a6e'),
      card('cloud', 'cloud', 'Konto AI', 'ChatGPT, Gemini lub Claude. Wypróbuj na darmowym planie, płatny plan użyje Twoich limitów.', 'var(--accent)')));
}

function aiTestRow() {
  const status = h('div', { class: 'status-line' });
  const testBtn = h('button', { class: 'btn' }, iconEl('bolt', 14), 'Testuj połączenie');
  testBtn.addEventListener('click', () => busy(testBtn, async () => {
    status.className = 'status-line'; status.replaceChildren(spinner(12), ' Łączę…');
    try { const r = await api.testAi(); status.className = 'status-line ok'; status.replaceChildren(iconEl('checkCircle', 14), r); } catch (e) { status.className = 'status-line bad'; status.replaceChildren(iconEl('warn', 14), e.message); }
  }, 'Testuję…'));
  return h('div', { class: 'group', style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } }, testBtn, status);
}

function apiKeyRows() {
  const s = state.settings;
  const keyInput = h('input', { class: 'input', type: 'password', style: { width: '260px' }, placeholder: state.hasApiKey ? '•••••••• (zapisany)' : 'sk-ant-…' });
  return [
    row('Klucz', h('div', { style: { display: 'flex', gap: '6px' } }, keyInput, h('button', { class: 'btn', onclick: async () => { try { state.hasApiKey = await api.setApiKey(keyInput.value); keyInput.value = ''; toast(state.hasApiKey ? 'Zapisano klucz' : 'Usunięto klucz', 'success'); rerender(); } catch (e) { errToast(e); } } }, 'Zapisz')), { icon: 'key', color: 'var(--green)' }),
    row('Model', select([{ value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (zalecany)' }, { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }], s.ai.apiModel, (v) => saveSettings({ ai: { apiModel: v } })), { icon: 'sparkles', color: 'var(--purple)' }),
    row('Pobierz klucz', h('button', { class: 'btn sm', onclick: () => api.openExternal('https://platform.claude.com/settings/keys') }, 'platform.claude.com'), { icon: 'globe', color: 'var(--teal)' })
  ];
}

function settingsAi() {
  const s = state.settings;
  const view = state.aiView || aiViewOf(s.ai.provider);
  const parts = [modeCards()];

  if (view === 'none') {
    parts.push(h('div', { class: 'card card-pad info-card' }, iconEl('pen', 18), h('div', null,
      h('b', null, 'Aplikacja działa bez AI. '), 'Plany pracy powstają z banku zajęć pracowni, a oceny z ocen cząstkowych – generowanie, edycja i eksport do DOCX/PDF działają w pełni. Przyciski AI są ukryte. Możesz w każdej chwili wybrać lokalny model albo konto AI.')));
    return h('div', null, parts);
  }

  if (view === 'local') {
    parts.push(h('section', { class: 'group' }, h('h3', { class: 'group-title' }, 'Lokalny model'),
      h('div', { class: 'group-body acc-list' }, localCard()),
      h('p', { class: 'group-footer' }, 'Model działa wyłącznie na tym komputerze – plany, oceny i notatki nie są nigdzie wysyłane, a korzystanie jest bezpłatne i bez limitów. Jakość i szybkość zależą od komputera: do pisania po polsku najlepsze są modele Bielik.')));
    if (s.ai.provider !== 'local') parts.push(h('div', { class: 'group' }, h('button', { class: 'btn primary', onclick: () => chooseView('local') }, 'Używaj modelu lokalnego')));
    return h('div', null, parts);
  }

  const usingApi = s.ai.provider === 'api';
  const anyConnected = ACCOUNTS.some((d) => state.accounts[d.id] && state.accounts[d.id].loggedIn);
  parts.push(
    h('section', { class: 'group' },
      h('h3', { class: 'group-title' }, 'Konta AI – połącz jedno lub kilka'),
      h('div', { class: 'group-body acc-list' }, ACCOUNTS.map(accountCard)),
      h('p', { class: 'group-footer' }, 'Na start wystarczy darmowe konto ChatGPT lub Google – aplikacja działa wtedy w trybie próbnym, na darmowym limicie i domyślnym modelu konta. Gdy aplikacja rozpozna płatny plan (albo zaznaczysz go ręcznie), skorzysta z wybranych mocniejszych modeli i Twoich opłaconych limitów. Do AI trafia wyłącznie treść planów i ocen bez danych osobowych.')),
    usingApi ? h('div', { class: 'connect-banner card' }, iconEl('key', 18), h('div', { style: { flex: 1 } }, h('b', null, 'Aplikacja korzysta z klucza API Claude'), h('div', { class: 'muted small' }, 'Zapytania są rozliczane za zużycie. Zmienisz to w sekcji Zaawansowane albo klikając „Używaj” przy połączonym koncie.'))) : null,
    group('Płatne plany i limity', [
      row('Na płatnym planie używaj mocniejszych modeli', toggle(s.ai.paidModels !== false, async (v) => { await saveSettings({ ai: { paidModels: v } }, true); rerender(); }), { icon: 'crown', color: 'var(--purple)', hint: 'Dotyczy tylko kont z płatnym planem – zużywa ich opłacone limity. Na kontach darmowych aplikacja zawsze używa domyślnego modelu konta.' }),
      row('Gdy skończy się limit, użyj kolejnego połączonego konta', toggle(s.ai.fallback !== false, (v) => saveSettings({ ai: { fallback: v } }, true)), { icon: 'refresh', color: 'var(--indigo)', hint: 'Najpierw konta na planie darmowym, potem płatne. Klucz API nigdy nie jest używany automatycznie.' })
    ]),
    anyConnected || usingApi ? aiTestRow() : null,
    h('div', { class: 'group' }, h('button', { class: 'btn plain sm', onclick: () => { state.aiAdvanced = !state.aiAdvanced; rerender(); } }, iconEl(state.aiAdvanced ? 'chevronL' : 'chevronR', 12), state.aiAdvanced ? 'Ukryj ustawienia zaawansowane' : 'Ustawienia zaawansowane')),
    state.aiAdvanced ? h('div', null,
      group('Programy na tym komputerze', ACCOUNTS.map((d) => {
        const st = state.accounts[d.id] || {};
        return row(d.program, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, st.path ? h('span', { class: 'path', style: { maxWidth: '300px' } }, st.path) : h('span', { class: 'muted small' }, 'nie znaleziono'),
          h('button', { class: 'btn sm', onclick: async () => { try { const r = await api.accountBrowse(d.id); if (r) { state.accounts[d.id] = r; await syncConnected(); rerender(); } } catch (e) { errToast(e); } } }, 'Wskaż…')), { icon: 'folder', color: 'var(--orange)', hint: st.version || null });
      })),
      group('Klucz API Claude (płatny, rozliczany za zużycie)', [
        ...apiKeyRows(),
        row('Używaj klucza API zamiast konta', toggle(usingApi, async (v) => {
          const next = v ? 'api' : (ACCOUNTS.find((d) => state.accounts[d.id] && state.accounts[d.id].loggedIn) || { id: 'none' }).id;
          await api.setAiMode(next); await loadSettings(); rerender();
        }), { icon: 'cpu', color: 'var(--accent)' })
      ], 'Klucz jest zaszyfrowany systemowym magazynem haseł.')) : null);
  return h('div', null, parts);
}
