'use strict';
/* global UI, icon, api, h, iconEl, toast, sheet, toggle, segmented, select, spinner, group, row, busy, settingsAi, refreshAccounts, refreshLocal, bindAiEvents, ACCOUNTS, viewDocs, openDocs, participantDisabilitySection, participantDocsSection, describeDis */

const state = {
  info: null, settings: null, hasApiKey: false, claudePath: null,
  view: 'plans',
  workshops: [], participants: [], plans: [], assessments: [],
  plan: null, planProblems: [],
  assess: null, stats: null,
  marks: { workshopId: null, date: null, mode: 'plan' },
  planFilter: '', assessFilter: 'all', peopleFilter: '',
  wsId: null, openDays: {}, doc: null,
  settingsTab: 'general',
  accounts: {}, acc: {}, local: { status: null, pulling: null, installing: false, log: '' }, aiView: null, aiAdvanced: false
};

// ───────────────────────── narzędzia ─────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayIso = () => isoDate(new Date());
const fmtDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : '—'; };
const DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const parseIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
const dayLabel = (s) => { const d = parseIso(s); return d ? `${DAYS[d.getDay()]}, ${fmtDate(s)}` : ''; };
const monthLabel = (s) => { const d = parseIso(s); return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : ''; };
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const plural = (n, a, b, c) => { if (n === 1) return a; const d = n % 10, t = n % 100; return d >= 2 && d <= 4 && !(t >= 12 && t <= 14) ? b : c; };
const fullName = (p) => [p && p.firstName, p && p.lastName].filter(Boolean).join(' ');
const shortName = (p) => [p && p.firstName, p && p.lastName ? p.lastName.charAt(0) + '.' : ''].filter(Boolean).join(' ');
function errToast(e) { toast(e.message || String(e), 'error', 7000); }
const PLAN_KIND = { day: 'Dzienny', week: 'Tygodniowy', month: 'Miesięczny' };
const ASSESS_KIND = { month: 'Miesięczna', year: 'Roczna', complex: 'Kompleksowa' };
const KIND_CHIP = { day: 'teal', week: 'blue', month: 'purple', year: 'blue', complex: 'orange' };

const aiOn = () => state.settings.ai.provider !== 'none';
function aiReady() {
  const ai = state.settings.ai;
  if (ai.provider === 'none') return false;
  if (ai.provider === 'api') return state.hasApiKey;
  if (ai.provider === 'local') { const L = state.local.status; return !!(ai.local.model && (!L || (L.running && L.models.some((m) => m.name === ai.local.model)))); }
  const st = state.accounts[ai.provider];
  if (st && st.loggedIn && ai.provider === 'claude-code' && st.tier !== 'paid') return false;
  return st ? !!st.loggedIn : !!(ai.connected || {})[ai.provider];
}
function aiName() {
  const ai = state.settings.ai;
  if (ai.provider === 'local') return 'Lokalny model';
  if (ai.provider === 'api') return 'Klucz API Claude';
  const d = ACCOUNTS.find((x) => x.id === ai.provider);
  return d ? d.name : 'AI';
}

function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 34) + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return ta;
}

function debounce(fn, ms) {
  let timer = null, pending = null;
  const run = () => { timer = null; pending = Promise.resolve(fn()).catch(errToast); return pending; };
  const d = () => { clearTimeout(timer); timer = setTimeout(run, ms); };
  d.flush = async () => { if (timer) { clearTimeout(timer); await run(); } else if (pending) await pending; };
  return d;
}

const field = (label, control, style) => h('div', { class: 'field', style }, h('label', null, label), control);
const keepScroll = (fn) => { const c = document.getElementById('content'); const y = c.scrollTop; fn(); c.scrollTop = y; };
const rerenderKeep = () => keepScroll(render);

const wsById = (id) => state.workshops.find((w) => w.id === id) || null;
const workWorkshops = () => state.workshops.filter((w) => !w.general);
const generalWs = () => state.workshops.find((w) => w.general) || null;
const skillsOf = (w) => (w ? w.areas.flatMap((a) => a.skills) : []);
const groupOf = (wid) => state.participants.filter((p) => p.workshopId === wid && p.active !== false);
const scaleLabel = (v) => { const s = state.settings.scale[v]; return s ? s.label : ''; };

// ───────────────────────── start ─────────────────────────
async function init() {
  state.info = await api.info();
  document.body.classList.add('platform-' + state.info.platform);
  await loadSettings();
  await reloadData();
  state.marks.date = todayIso();
  state.marks.workshopId = (workWorkshops()[0] || {}).id || null;

  document.querySelectorAll('#traffic .tl').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.act === 'close') await flushAll();
    const maximized = await api.windowControl(b.dataset.act);
    if (b.dataset.act === 'maximize') setMaxTitle(maximized);
  }));
  api.on('window:state', (s) => setMaxTitle(s.maximized));
  document.querySelector('.titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('.traffic')) api.windowControl('maximize'); });
  window.addEventListener('blur', () => document.body.classList.add('window-blur'));
  window.addEventListener('focus', () => document.body.classList.remove('window-blur'));
  document.getElementById('content').addEventListener('scroll', (e) => e.target.classList.toggle('scrolled', e.target.scrollTop > 4));

  bindAiEvents();
  render();
  refreshAccounts();
  if (state.settings.ai.provider === 'local') refreshLocal();
}

async function reloadData() {
  [state.workshops, state.participants, state.plans, state.assessments] = await Promise.all([api.getWorkshops(), api.listParticipants(), api.listPlans(), api.listAssessments()]);
}

function setMaxTitle(maximized) { const b = document.querySelector('#traffic .tl.max'); if (b) b.title = maximized ? 'Przywróć' : 'Maksymalizuj'; }

async function loadSettings() {
  const r = await api.getSettings();
  state.settings = r.settings; state.hasApiKey = r.hasApiKey; state.claudePath = r.claudePath;
}

async function saveSettings(patch, quiet) {
  try { state.settings = await api.setSettings(patch); if (!quiet) toast('Zapisano ustawienia', 'success', 1600); } catch (e) { errToast(e); }
}

async function flushAll() { await savePlanSoon.flush(); await saveAssessSoon.flush(); await saveWorkshopsSoon.flush(); await saveMarksSoon.flush(); }

async function go(view) {
  await flushAll();
  if (['plans', 'assessments', 'participants', 'marks'].includes(view)) await reloadData();
  state.view = view;
  render();
  document.getElementById('content').scrollTop = 0;
}

// ───────────────────────── pasek boczny ─────────────────────────
function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const items = [
    ['plans', 'calendar', 'Plany pracy', state.plans.length || null],
    ['marks', 'check', 'Oceny cząstkowe'],
    ['assessments', 'doc', 'Oceny okresowe', state.assessments.length || null]
  ];
  const data = [
    ['participants', 'people', 'Uczestnicy', state.participants.length || null],
    ['docs', 'scan', 'Dokumenty i skany'],
    ['workshops', 'home', 'Pracownie', workWorkshops().length || null]
  ];
  const ai = state.settings.ai;
  const ok = aiReady();
  const acc = state.accounts[ai.provider];
  const checking = ACCOUNTS.some((d) => d.id === ai.provider) && !acc;
  const dot = ai.provider === 'none' ? 'off' : ok ? '' : checking ? 'busy' : 'off';
  const t1 = ai.provider === 'none' ? 'Bez AI' : ok ? `AI: ${aiName()}` : checking ? 'Sprawdzam połączenie…' : `${aiName()} – niepołączone`;
  const t2 = ai.provider === 'none' ? 'Plany i oceny z profili'
    : ai.provider === 'local' ? (ai.local.model || 'Wybierz model').replace(/^SpeakLeash\//, '')
      : ai.provider === 'api' ? 'Rozliczany za zużycie'
        : acc && acc.loggedIn ? (acc.tier === 'paid' ? `Plan płatny${acc.planName && acc.planName !== 'darmowy' ? ' · ' + acc.planName : ''}` : 'Plan darmowy – tryb próbny') : 'Opcjonalnie – pomoc w redakcji';
  const active = (v) => state.view === v || (v === 'plans' && state.view === 'plan') || (v === 'assessments' && state.view === 'assess');
  const nav = ([v, ic, label, badge]) => h('div', { class: 'nav-item' + (active(v) ? ' active' : ''), onclick: () => go(v) }, h('span', { html: icon(ic, 17) }), label, badge ? h('span', { class: 'nav-count' }, badge) : null);
  sb.replaceChildren(
    h('div', { class: 'brand' },
      h('div', { class: 'brand-logo', html: icon('calendar', 20) }),
      h('div', null, h('div', { class: 'brand-name' }, 'WTZ Helper'), h('div', { class: 'brand-sub' }, 'Plany pracy i oceny'))),
    h('div', { class: 'nav-section' }, 'Praca'), ...items.map(nav),
    h('div', { class: 'nav-section' }, 'Dane'), ...data.map(nav),
    h('div', { class: 'nav-section' }, 'Aplikacja'),
    h('div', { class: 'nav-item' + (state.view === 'settings' ? ' active' : ''), onclick: () => go('settings') }, h('span', { html: icon('gear', 17) }), 'Ustawienia'),
    h('div', { class: 'sidebar-spacer' }),
    h('div', { class: 'agent-pill', title: 'Ustawienia AI', onclick: () => { state.settingsTab = 'ai'; go('settings'); } },
      h('span', { class: 'agent-dot ' + dot }),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 't1' }, t1), h('div', { class: 't2' }, t2))));
}

function render() {
  renderSidebar();
  const c = document.getElementById('content');
  const views = { plans: viewPlans, plan: viewPlan, marks: viewMarks, assessments: viewAssessments, assess: viewAssess, participants: viewParticipants, workshops: viewWorkshops, settings: viewSettings, docs: viewDocs };
  const el = views[state.view]();
  el.classList.add('fade-in');
  c.replaceChildren(el);
  const title = { plans: 'Plany pracy', plan: 'Plan pracy', marks: 'Oceny cząstkowe', assessments: 'Oceny okresowe', assess: 'Ocena', participants: 'Uczestnicy', workshops: 'Pracownie', settings: 'Ustawienia', docs: 'Dokumenty i skany' }[state.view];
  document.getElementById('window-title').textContent = title + ' — WTZ Helper';
}

function needAi() {
  if (aiReady()) return true;
  sheet({
    title: state.settings.ai.provider === 'local' ? 'Lokalny model nie jest gotowy' : 'Połącz aplikację z AI',
    body: h('p', null, state.settings.ai.provider === 'local'
      ? 'Uruchom program Ollama i wybierz pobrany model w Ustawieniach → AI → Lokalny model.'
      : 'Ta funkcja wymaga połączenia z kontem AI (na start wystarczy darmowe konto ChatGPT lub Google) albo modelu lokalnego. To opcjonalne: plany i oceny tworzysz i zapisujesz bez AI.'),
    actions: [{ label: 'Nie teraz' }, { label: 'Przejdź do ustawień', kind: 'primary', onClick: () => { state.settingsTab = 'ai'; go('settings'); } }]
  });
  return false;
}

function exportedToast(r, format) {
  if (!r) return;
  const root = document.getElementById('toast-root');
  const el = h('div', { class: 'toast success show' }, iconEl('checkCircle', 18), h('span', null, `Zapisano ${format.toUpperCase()}`),
    h('button', { class: 'btn sm', onclick: () => api.openFile(r.path) }, 'Otwórz'),
    h('button', { class: 'btn sm', onclick: () => api.showFile(r.path) }, 'Pokaż w folderze'));
  root.appendChild(el);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 9000);
}

function showPreview(r, title, onExport) {
  const paper = h('div', { class: 'paper' + (r.format.landscape ? ' landscape' : ''), style: { fontFamily: r.fontCss, fontSize: r.format.size + 'pt', padding: `${r.format.marginCm}cm` }, html: r.html });
  const s = sheet({ title, subtitle: 'Tak będzie wyglądał dokument. Podział na strony może się nieznacznie różnić.', wide: true, body: h('div', { class: 'paper-wrap' }, paper),
    actions: [{ label: 'Zamknij' }, { label: 'Zapisz DOCX', onClick: () => { onExport('docx'); } }, { label: 'Zapisz PDF', kind: 'primary', onClick: () => { onExport('pdf'); } }] });
  s.panel.classList.add('preview-sheet');
}

function emptyState(ic, title, text, btn) {
  return h('div', { class: 'card card-pad' }, h('div', { class: 'empty big' }, h('div', { class: 'empty-ic', html: icon(ic, 30) }), h('h2', null, title), h('p', null, text), btn || null));
}

// ───────────────────────── PLANY (lista) ─────────────────────────
function viewPlans() {
  const ws = workWorkshops();
  const rows = state.plans.filter((p) => !state.planFilter || p.workshopId === state.planFilter).sort((a, b) => b.from.localeCompare(a.from) || a.workshop.localeCompare(b.workshop, 'pl'));
  const period = (p) => (p.type === 'day' ? dayLabel(p.from) : p.type === 'month' ? cap(monthLabel(p.from)) : `${fmtDate(p.from)} – ${fmtDate(p.to)}`);
  let body;
  if (!state.plans.length) body = emptyState('calendar', 'Utwórz pierwszy plan pracy', 'Wybierz pracownię i okres – aplikacja ułoży plan dzienny, tygodniowy lub miesięczny wyłącznie z zajęć zapisanych w profilu pracowni, z uwzględnieniem potrzeb uczestników (na podstawie ocen cząstkowych).', h('button', { class: 'btn primary lg', onclick: newPlanSheet }, iconEl('plus', 15), 'Nowy plan'));
  else if (!rows.length) body = h('div', { class: 'card card-pad' }, h('div', { class: 'empty' }, 'Brak planów dla wybranej pracowni.'));
  else body = h('div', { class: 'card', style: { overflow: 'hidden' } }, h('table', { class: 'tbl list' },
    h('thead', null, h('tr', null, h('th', null, 'Plan'), h('th', null, 'Pracownia'), h('th', null, 'Okres'), h('th', null, 'Temat przewodni'), h('th', null, 'Zmieniono'), h('th', null, ''))),
    h('tbody', null, rows.map((p) => h('tr', { class: 'clickable', onclick: () => openPlan(p.id) },
      h('td', null, h('span', { class: 'chip ' + KIND_CHIP[p.type] }, PLAN_KIND[p.type])),
      h('td', null, h('b', null, p.workshop)),
      h('td', null, period(p)),
      h('td', { class: 'muted' }, p.theme || '—'),
      h('td', { class: 'muted' }, fmtDate(p.updatedAt)),
      h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
        h('button', { class: 'icon-btn', title: 'Powiel plan', onclick: async (e) => { e.stopPropagation(); try { await api.duplicatePlan(p.id); state.plans = await api.listPlans(); render(); toast('Utworzono kopię planu', 'success'); } catch (er) { errToast(er); } }, html: icon('copy', 15) }),
        h('button', { class: 'icon-btn', title: 'Usuń', onclick: (e) => { e.stopPropagation(); sheet({ title: 'Usunąć plan?', body: h('p', null, `Plan ${PLAN_KIND[p.type].toLowerCase()} „${p.workshop}” (${period(p)}) zostanie usunięty z aplikacji. Zapisane pliki DOCX i PDF pozostaną na dysku.`), actions: [{ label: 'Anuluj' }, { label: 'Usuń', kind: 'danger', onClick: async () => { await api.removePlan(p.id); state.plans = await api.listPlans(); render(); } }] }); }, html: icon('trash', 15) })))))));
  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Plany pracy'), h('div', { class: 'spacer' }),
      state.plans.length ? select([{ value: '', label: 'Wszystkie pracownie' }, ...ws.map((w) => ({ value: w.id, label: w.name }))], state.planFilter, (v) => { state.planFilter = v; render(); }) : null,
      h('button', { class: 'btn primary', onclick: newPlanSheet }, iconEl('plus', 14), 'Nowy plan')),
    h('div', { class: 'page' }, body));
}

function newPlanSheet() {
  const ws = workWorkshops();
  if (!ws.length) return sheet({ title: 'Brak pracowni', body: h('p', null, 'Najpierw dodaj profil pracowni (zakładka Pracownie).'), actions: [{ label: 'OK' }] });
  const d = { type: 'week', workshopId: state.planFilter || ws[0].id, date: todayIso(), theme: '' };
  const info = h('div', { class: 'note-box' });
  const drawInfo = () => {
    const w = wsById(d.workshopId);
    const n = groupOf(d.workshopId).length;
    const acts = w ? w.activities.filter((a) => a.skills.length).length : 0;
    info.replaceChildren(iconEl('info', 16), h('div', null,
      `Pracownia ma ${acts} ${plural(acts, 'zajęcie', 'zajęcia', 'zajęć')} w banku i ${skillsOf(w).length} ${plural(skillsOf(w).length, 'umiejętność', 'umiejętności', 'umiejętności')} w profilu. `,
      n ? `Plan uwzględni potrzeby ${n} ${plural(n, 'uczestnika', 'uczestników', 'uczestników')} przypisanych do pracowni (na podstawie ocen cząstkowych).` : 'Do pracowni nie przypisano jeszcze uczestników – plan powstanie bez indywidualizacji.'));
  };
  drawInfo();
  sheet({
    title: 'Nowy plan pracy',
    subtitle: 'Plan składa się wyłącznie z zajęć zapisanych w profilu wybranej pracowni. Weekendy i dni ustawowo wolne są pomijane.',
    body: h('div', null,
      field('Rodzaj planu', segmented([{ value: 'day', label: 'Dzienny' }, { value: 'week', label: 'Tygodniowy' }, { value: 'month', label: 'Miesięczny' }], d.type, (v) => { d.type = v; })),
      h('div', { class: 'form-grid two' },
        field('Pracownia', select(ws.map((w) => ({ value: w.id, label: w.name })), d.workshopId, (v) => { d.workshopId = v; drawInfo(); }, { style: 'width:100%' })),
        field('Data (dzień, dowolny dzień tygodnia lub miesiąca)', h('input', { class: 'input full', type: 'date', value: d.date, onchange: (e) => { d.date = e.target.value; } }))),
      field('Temat przewodni (opcjonalnie – puste = temat z kalendarza tematów)', h('input', { class: 'input full', placeholder: 'np. Andrzejki', oninput: (e) => { d.theme = e.target.value; } })),
      info),
    actions: [{ label: 'Anuluj' }, { label: 'Utwórz plan', kind: 'primary', onClick: async () => {
      try { const plan = await api.createPlan({ ...d, theme: d.theme.trim() || null }); state.plans = await api.listPlans(); showPlan(plan); } catch (e) { errToast(e); return false; }
    } }]
  });
}

async function openPlan(id) { try { showPlan(await api.getPlan(id)); } catch (e) { errToast(e); } }
async function showPlan(plan) {
  state.plan = plan; state.openDays = {}; state.view = 'plan';
  try { state.planProblems = await api.validatePlan(plan.id); } catch (_) { state.planProblems = []; }
  render(); document.getElementById('content').scrollTop = 0;
}

const savePlanSoon = debounce(async () => {
  if (!state.plan) return;
  await api.savePlan(state.plan);
  const el = document.getElementById('save-state');
  if (el) { el.textContent = 'Zapisano'; el.classList.remove('dirty'); }
}, 500);
function touchPlan() { const el = document.getElementById('save-state'); if (el) { el.textContent = 'Zapisuję…'; el.classList.add('dirty'); } savePlanSoon(); }

// ───────────────────────── PLAN (edytor) ─────────────────────────
function viewPlan() {
  const plan = state.plan;
  const w = wsById(plan.workshopId);
  const g = generalWs();
  const T = (key, rows, ph) => autoGrow(h('textarea', { class: 'input', rows, placeholder: ph || '', value: plan[key] || '', oninput: (e) => { plan[key] = e.target.value; touchPlan(); } }));
  const period = plan.type === 'day' ? dayLabel(plan.from) : plan.type === 'month' ? `${cap(monthLabel(plan.from))} (${fmtDate(plan.from)} – ${fmtDate(plan.to)})` : `${fmtDate(plan.from)} – ${fmtDate(plan.to)}`;
  const people = plan.participantIds.map((id) => state.participants.find((p) => p.id === id)).filter(Boolean);

  const info = h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('calendar', 16), `${PLAN_KIND[plan.type]} plan pracy · ${period}`),
    plan.type !== 'month' ? field('Temat przewodni', h('input', { class: 'input full', value: plan.theme || '', placeholder: 'np. Jesień w kuchni', oninput: (e) => { plan.theme = e.target.value; touchPlan(); } })) : null,
    plan.type === 'month' ? field('Tematy tygodni', h('div', { class: 'week-themes' }, (plan.weeks || []).map((wk) => h('div', { class: 'week-theme' },
      h('span', { class: 'muted small' }, `${fmtDate(wk.from)} – ${fmtDate(wk.to)}`),
      h('input', { class: 'input full', value: wk.theme || '', oninput: (e) => { wk.theme = e.target.value; touchPlan(); } }))))) : null,
    field({ day: 'Cele dnia', week: 'Cele tygodnia', month: 'Cele miesiąca' }[plan.type] + ' (każdy w osobnej linii)', T('goals', 2)),
    field('Uwagi (trafiają na koniec dokumentu)', T('notes', 1, 'np. wyjście do sklepu w środę, zajęcia z udziałem rodziców…')),
    h('div', { class: 'people-line' }, h('span', { class: 'muted small' }, people.length ? 'Uczestnicy: ' : 'Brak uczestników przypisanych do pracowni.'), people.map((p) => h('span', { class: 'chip person', title: describeDis(p.disability) || 'brak danych z orzeczenia' }, shortName(p), p.disability && p.disability.codes && p.disability.codes.length ? ` · ${p.disability.codes.join(', ')}` : ''))),
    people.some((p) => (p.adaptations || []).length || (p.disability && (p.disability.degree || (p.disability.codes || []).length))) ? h('div', { class: 'muted small', style: { marginTop: '6px' } }, iconEl('info', 12), ' Dostosowania do rodzaju i stopnia niepełnosprawności uczestników trafią do dokumentu planu (tabela) i do zapytania „Dobierz z AI”. Uzupełnisz je w karcie uczestnika lub z dokumentów.') : null);

  const ok = !state.planProblems.length;
  const banner = h('div', { class: 'note-box' + (ok ? ' ok' : ' warn') }, iconEl(ok ? 'checkCircle' : 'warn', 16),
    h('div', null, ok ? h('span', null, h('b', null, 'Plan w pełni zgodny z profilem pracowni. '), `Wszystkie zajęcia pochodzą z banku „${w ? w.name : ''}”${g ? ' i profilu Umiejętności ogólne' : ''}, a rozwijane umiejętności – z jej profilu.`)
      : h('span', null, h('b', null, 'Uwaga: część planu nie odpowiada profilowi pracowni. '), state.planProblems.slice(0, 5).join('; '), '. Wybierz zajęcia z banku albo uzupełnij profil.')));

  const days = plan.days.map((d) => dayCard(d, w, g));
  const ins = h('div', { class: 'toolbar' },
    h('button', { class: 'icon-btn', title: 'Wróć do listy planów', onclick: () => go('plans'), html: icon('chevronL', 18) }),
    h('h1', null, w ? w.name : 'Plan'),
    h('span', { class: 'chip ' + KIND_CHIP[plan.type] }, PLAN_KIND[plan.type]),
    h('span', { class: 'save-state', id: 'save-state' }, 'Zapisano'),
    h('div', { class: 'spacer' }),
    aiOn() ? h('button', { class: 'btn ai', title: aiReady() ? `${aiName()} dobierze zajęcia do tematu – wyłącznie z banku pracowni` : 'Wymaga połączenia z AI (Ustawienia → AI)', onclick: (e) => aiPlan(e.currentTarget) }, iconEl('sparkles', 14), 'Dobierz z AI') : null,
    h('button', { class: 'btn', title: 'Ułóż plan od nowa (tematy, cele i uwagi zostają)', onclick: (e) => regenerate(e.currentTarget) }, iconEl('refresh', 14), 'Ułóż ponownie'),
    h('button', { class: 'btn', onclick: () => previewPlan() }, iconEl('eye', 14), 'Podgląd'),
    h('button', { class: 'btn', onclick: (e) => exportPlan(e.currentTarget, 'docx') }, iconEl('doc', 14), 'DOCX'),
    h('button', { class: 'btn primary', onclick: (e) => exportPlan(e.currentTarget, 'pdf') }, iconEl('arrowDown', 14), 'PDF'));
  return h('div', null, ins, h('div', { class: 'page editor' }, info, banner, days));
}

function dayCard(d, w, g) {
  const plan = state.plan;
  const many = plan.days.length > 5;
  const open = many ? !!state.openDays[d.date] : state.openDays[d.date] !== false;
  const card = h('div', { class: 'card ed-card cat' + (open ? '' : ' collapsed') });
  const acts = d.blocks.filter((b) => b.kind === 'activity').map((b) => b.title);
  const head = h('div', { class: 'cat-head', onclick: () => { state.openDays[d.date] = !open; rerenderKeep(); } },
    h('span', { class: 'cat-chev', html: icon('chevronR', 14) }),
    h('h3', null, cap(dayLabel(d.date))),
    !open ? h('span', { class: 'muted small day-sum' }, acts.join(' · ')) : null,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn sm', title: 'Wystaw oceny cząstkowe za ten dzień', onclick: (e) => { e.stopPropagation(); state.marks = { workshopId: plan.workshopId, date: d.date, mode: 'plan' }; go('marks'); } }, iconEl('check', 12), 'Oceń zajęcia'),
    h('button', { class: 'btn sm', title: 'Wylosuj inne zajęcia na ten dzień', onclick: (e) => { e.stopPropagation(); regenerate(e.currentTarget, d.date); } }, iconEl('refresh', 12), 'Inne zajęcia'));
  const body = h('div', { class: 'cat-body' }, d.blocks.map((b) => blockRow(b, w, g)),
    h('div', { class: 'sub' }, h('div', { class: 'sub-head' }, h('div', { class: 'sub-name' }, 'Uwagi do dnia')),
      autoGrow(h('textarea', { class: 'input', rows: 1, value: d.note || '', placeholder: 'opcjonalnie', oninput: (e) => { d.note = e.target.value; touchPlan(); } }))));
  card.append(head, body);
  return card;
}

function blockRow(b, w, g) {
  const wrap = h('div', { class: 'sub block-row k-' + b.kind });
  const time = h('div', { class: 'block-time' }, `${b.start}–${b.end}`);
  if (b.kind === 'fixed' || (b.kind === 'general' && !g) || (!b.activityId && b.kind !== 'activity')) {
    wrap.append(time, h('div', { class: 'block-main' }, h('input', { class: 'input full', value: b.title || '', oninput: (e) => { b.title = e.target.value; touchPlan(); } })));
    return wrap;
  }
  const src = b.kind === 'activity' ? w : g;
  const skills = new Map(skillsOf(src).map((s) => [s.id, s.name]));
  const pick = select([{ value: '', label: '— wybierz zajęcia z banku —' }, ...src.activities.filter((a) => a.skills.length).map((a) => ({ value: a.id, label: a.name }))], b.activityId || '', async (v) => {
    const a = src.activities.find((x) => x.id === v);
    if (!a) return;
    Object.assign(b, { activityId: a.id, title: a.name, goal: a.goal || '', methods: a.methods || '', materials: a.materials || '', skills: [...a.skills] });
    try { await savePlanSoon.flush(); state.plan = await api.savePlan(state.plan, true); rerenderKeep(); } catch (e) { errToast(e); }
  }, { class: 'input full' });
  const inp = (key, ph) => h('input', { class: 'input full', value: b[key] || '', placeholder: ph, oninput: (e) => { b[key] = e.target.value; touchPlan(); } });
  const indiv = (b.individual || []).map((x) => {
    const p = state.participants.find((pp) => pp.id === x.participantId);
    if (!p) return null;
    const txt = [x.skillId && skills.get(x.skillId) ? `${skills.get(x.skillId)} (${x.level})` : '', x.supervision ? 'nadzór przy narzędziach' : ''].filter(Boolean).join(' · ');
    return txt ? h('span', { class: 'chip' + (x.supervision ? ' warn' : ''), title: x.supervision ? 'Rodzaj lub stopień niepełnosprawności wymaga nadzoru przy narzędziach ostrych, gorących i maszynach' : `obecnie: ${scaleLabel(x.level).toLowerCase()}` }, `${shortName(p)}: ${txt}`) : null;
  }).filter(Boolean);
  wrap.append(time, h('div', { class: 'block-main' },
    h('div', { class: 'block-top' }, h('span', { class: 'chip ' + (b.kind === 'activity' ? 'blue' : 'teal') }, b.kind === 'activity' ? 'pracownia' : 'ogólne'), pick),
    field('Tytuł zajęć w planie', inp('title')),
    field('Cel', autoGrow(h('textarea', { class: 'input', rows: 1, value: b.goal || '', oninput: (e) => { b.goal = e.target.value; touchPlan(); } }))),
    h('div', { class: 'form-grid two' }, field('Metody i formy', inp('methods')), field('Materiały', inp('materials'))),
    h('div', { class: 'skill-chips' }, h('span', { class: 'muted small' }, 'Rozwijane umiejętności: '), (b.skills || []).map((s) => h('span', { class: 'chip green' }, skills.get(s) || '(spoza profilu)'))),
    indiv.length ? h('div', { class: 'skill-chips' }, h('span', { class: 'muted small' }, 'Praca indywidualna: '), indiv) : null,
    b.note || b.kind === 'activity' ? field('Notatka (przebieg, związek z tematem)', inp('note', 'opcjonalnie')) : null));
  return wrap;
}

async function regenerate(btn, date) {
  const plan = state.plan;
  await busy(btn, async () => {
    try { await savePlanSoon.flush(); state.plan = await api.regeneratePlan(plan.id, date); state.planProblems = await api.validatePlan(plan.id); rerenderKeep(); toast(date ? 'Wylosowano inne zajęcia na ten dzień' : 'Plan ułożony ponownie', 'success', 2000); } catch (e) { errToast(e); }
  }, 'Układam…');
}

async function aiPlan(btn) {
  if (!needAi()) return;
  const plan = state.plan;
  await busy(btn, async () => {
    try {
      await savePlanSoon.flush();
      const r = await api.aiPlan(plan.id);
      const w = wsById(plan.workshopId), g = generalWs();
      const all = new Map([...w.activities, ...(g ? g.activities : [])].map((a) => [a.id, a]));
      const changes = [];
      for (const d of plan.days) for (const b of d.blocks) if (r.blocks[b.id]) changes.push({ d, b, x: r.blocks[b.id] });
      sheet({
        title: 'Propozycja AI – dobór zajęć',
        subtitle: `${r.provider ? r.provider + ' · ' : ''}Wszystkie zajęcia pochodzą z banku pracowni. Przyjęcie zastąpi zajęcia w ${changes.length} ${plural(changes.length, 'bloku', 'blokach', 'blokach')}.`,
        wide: true,
        body: h('div', null, changes.slice(0, 60).map(({ d, b, x }) => h('div', { class: 'diff' }, h('div', { class: 'diff-name' }, `${dayLabel(d.date)} · ${b.start}`), h('div', { class: 'diff-old' }, b.title), h('div', { class: 'diff-new' }, x.title + (x.note ? ' – ' + x.note : ''))))),
        actions: [{ label: 'Odrzuć' }, { label: 'Przyjmij', kind: 'primary', onClick: async () => {
          for (const { b, x } of changes) { const a = all.get(x.activityId); if (!a) continue; Object.assign(b, { activityId: a.id, title: x.title || a.name, goal: a.goal || '', methods: a.methods || '', materials: a.materials || '', skills: [...a.skills], note: x.note || b.note || '' }); }
          state.plan = await api.savePlan(plan, true); state.planProblems = await api.validatePlan(plan.id); rerenderKeep();
        } }]
      });
    } catch (e) { errToast(e); }
  }, 'AI planuje…');
}

async function previewPlan() {
  try { await savePlanSoon.flush(); const r = await api.previewPlan(state.plan.id); showPreview(r, 'Podgląd planu', (f) => exportPlan(null, f)); } catch (e) { errToast(e); }
}
async function exportPlan(btn, format) {
  const work = async () => { try { await savePlanSoon.flush(); exportedToast(await api.exportPlan(state.plan.id, format), format); } catch (e) { errToast(e); } };
  if (btn) await busy(btn, work, 'Zapisuję…'); else await work();
}

// ───────────────────────── OCENY CZĄSTKOWE ─────────────────────────
const marksQueue = new Map();
const saveMarksSoon = debounce(async () => {
  const entries = [...marksQueue.values()];
  marksQueue.clear();
  if (entries.length) await api.setMarks(entries);
  const el = document.getElementById('save-state');
  if (el) { el.textContent = 'Zapisano'; el.classList.remove('dirty'); }
}, 400);

function viewMarks() {
  const M = state.marks;
  const ws = workWorkshops();
  if (!M.workshopId || !wsById(M.workshopId)) M.workshopId = (ws[0] || {}).id || null;
  const w = wsById(M.workshopId);
  const g = generalWs();
  const people = groupOf(M.workshopId);
  const body = h('div', null, h('div', { class: 'card card-pad' }, h('div', { class: 'empty' }, spinner(16), ' Wczytuję…')));
  const tb = h('div', { class: 'toolbar' }, h('h1', null, 'Oceny cząstkowe'), h('span', { class: 'save-state', id: 'save-state' }, ''), h('div', { class: 'spacer' }),
    select(ws.map((x) => ({ value: x.id, label: x.name })), M.workshopId || '', (v) => { M.workshopId = v; render(); }),
    h('input', { class: 'input', type: 'date', value: M.date, onchange: (e) => { M.date = e.target.value || todayIso(); render(); } }),
    segmented([{ value: 'plan', label: 'Zajęcia z planu' }, { value: 'all', label: 'Wszystkie umiejętności' }], M.mode, (v) => { M.mode = v; render(); }));
  const view = h('div', null, tb, h('div', { class: 'page' },
    h('div', { class: 'note-box' }, iconEl('info', 16), h('div', null, h('b', null, 'Ocena cząstkowa = stopień opanowania umiejętności w danym dniu. '),
      state.settings.scale.map((s) => `${s.value} – ${s.label.toLowerCase()}`).join(' · '), '. Kliknij pole i wybierz poziom; zmiany zapisują się same. Z ocen cząstkowych powstają oceny miesięczne, roczne i kompleksowe.')),
    body));
  if (!w) { body.replaceChildren(emptyState('home', 'Brak pracowni', 'Dodaj profil pracowni w zakładce Pracownie.')); return view; }
  if (!people.length) { body.replaceChildren(emptyState('people', 'Brak uczestników w tej pracowni', 'Przypisz uczestników do pracowni w zakładce Uczestnicy, a tu wystawisz im oceny cząstkowe.', h('button', { class: 'btn primary', onclick: () => go('participants') }, 'Przejdź do uczestników'))); return view; }

  (async () => {
    try {
      const [marks, plans] = await Promise.all([api.getMarks({ from: M.date, to: M.date }), Promise.all(state.plans.filter((p) => p.workshopId === M.workshopId && p.from <= M.date && p.to >= M.date).map((p) => api.getPlan(p.id)))]);
      let planSkills = null, planActs = [];
      for (const p of plans) { const d = p.days.find((x) => x.date === M.date); if (d) { planSkills = planSkills || new Set(); for (const b of d.blocks) if (b.activityId) { (b.skills || []).forEach((s) => planSkills.add(s)); planActs.push(b.title); } } }
      const useFilter = M.mode === 'plan' && planSkills && planSkills.size;
      const val = new Map(marks.map((m) => [`${m.participantId}|${m.skillId}`, m.level]));
      const sources = [w, g && g.id !== w.id ? g : null].filter(Boolean);
      const rows = [];
      for (const src of sources) for (const ar of src.areas) {
        const sk = ar.skills.filter((s) => !useFilter || planSkills.has(s.id));
        if (!sk.length) continue;
        rows.push(h('tr', { class: 'area-row' }, h('td', { class: 'sticky-col', colspan: people.length + 2 }, h('b', null, ar.name), src.general ? h('span', { class: 'muted small' }, '  · umiejętności ogólne') : null)));
        for (const s of sk) {
          const cells = people.map((p) => {
            const k = `${p.id}|${s.id}`;
            const cur = val.has(k) ? val.get(k) : '';
            const sel = h('select', { class: 'mark-sel lv' + cur, title: `${fullName(p)} – ${s.name}` },
              h('option', { value: '' }, '·'), state.settings.scale.map((x) => h('option', { value: String(x.value), selected: String(x.value) === String(cur) ? 'selected' : null }, `${x.value}`)));
            sel.value = String(cur);
            sel.addEventListener('change', () => {
              const v = sel.value === '' ? null : Number(sel.value);
              sel.className = 'mark-sel lv' + (v == null ? '' : v);
              if (v == null) val.delete(k); else val.set(k, v);
              marksQueue.set(k, { participantId: p.id, workshopId: M.workshopId, skillId: s.id, date: M.date, level: v });
              const el = document.getElementById('save-state'); if (el) { el.textContent = 'Zapisuję…'; el.classList.add('dirty'); }
              saveMarksSoon();
            });
            return h('td', { class: 'mx-cell' }, sel);
          });
          const all = h('select', { class: 'mark-sel all', title: 'Ustaw wszystkim uczestnikom' }, h('option', { value: '' }, 'wszystkim…'), state.settings.scale.map((x) => h('option', { value: String(x.value) }, `${x.value} – ${x.label.toLowerCase()}`)));
          all.addEventListener('change', () => { if (all.value === '') return; cells.forEach((td) => { const se = td.querySelector('select'); se.value = all.value; se.dispatchEvent(new Event('change')); }); all.value = ''; });
          rows.push(h('tr', null, h('td', { class: 'sticky-col skill-name' }, s.name), ...cells, h('td', null, all)));
        }
      }
      const planNote = M.mode === 'plan' ? (useFilter ? h('div', { class: 'muted small', style: { margin: '0 0 8px 2px' } }, `Umiejętności z zajęć zaplanowanych na ${dayLabel(M.date)}: ${planActs.join(', ')}.`)
        : h('div', { class: 'muted small', style: { margin: '0 0 8px 2px' } }, `Brak planu pracowni na ${dayLabel(M.date)} – pokazuję wszystkie umiejętności z profilu.`)) : null;
      body.replaceChildren(planNote || '', h('div', { class: 'card mx-wrap marks-wrap' }, h('table', { class: 'tbl mx marks' },
        h('thead', null, h('tr', null, h('th', { class: 'sticky-col' }, 'Umiejętność'), people.map((p) => h('th', { class: 'mx-person', title: fullName(p) }, shortName(p))), h('th', null, ''))),
        h('tbody', null, rows))));
    } catch (e) { errToast(e); }
  })();
  return view;
}

// ───────────────────────── OCENY OKRESOWE (lista) ─────────────────────────
function viewAssessments() {
  const rows = state.assessments.filter((a) => state.assessFilter === 'all' || a.type === state.assessFilter).sort((a, b) => b.to.localeCompare(a.to) || a.name.localeCompare(b.name, 'pl'));
  const period = (a) => (a.type === 'month' ? cap(monthLabel(a.from)) : `${fmtDate(a.from)} – ${fmtDate(a.to)}`);
  let body;
  if (!state.assessments.length) body = emptyState('doc', 'Przygotuj pierwszą ocenę', 'Ocena miesięczna, roczna lub kompleksowa powstaje z ocen cząstkowych wystawionych w danym okresie: aplikacja liczy stopień opanowania umiejętności, porównuje go z poprzednim okresem i składa opis, który możesz dowolnie poprawić.', h('button', { class: 'btn primary lg', onclick: newAssessSheet }, iconEl('plus', 15), 'Nowa ocena'));
  else if (!rows.length) body = h('div', { class: 'card card-pad' }, h('div', { class: 'empty' }, 'Brak ocen tego rodzaju.'));
  else body = h('div', { class: 'card', style: { overflow: 'hidden' } }, h('table', { class: 'tbl list' },
    h('thead', null, h('tr', null, h('th', null, 'Uczestnik'), h('th', null, 'Ocena'), h('th', null, 'Okres'), h('th', null, 'Data sporządzenia'), h('th', null, ''))),
    h('tbody', null, rows.map((a) => h('tr', { class: 'clickable', onclick: () => openAssess(a.id) },
      h('td', null, h('div', { class: 'who' }, h('span', { class: 'avatar' }, (a.name || '?').charAt(0)), h('b', null, a.name))),
      h('td', null, h('span', { class: 'chip ' + KIND_CHIP[a.type] }, ASSESS_KIND[a.type])),
      h('td', null, period(a)), h('td', { class: 'muted' }, fmtDate(a.date)),
      h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
        h('button', { class: 'icon-btn', title: 'Usuń', onclick: (e) => { e.stopPropagation(); sheet({ title: 'Usunąć ocenę?', body: h('p', null, `Ocena ${ASSESS_KIND[a.type].toLowerCase()} – ${a.name} (${period(a)}) zostanie usunięta. Oceny cząstkowe pozostają bez zmian.`), actions: [{ label: 'Anuluj' }, { label: 'Usuń', kind: 'danger', onClick: async () => { await api.removeAssessment(a.id); state.assessments = await api.listAssessments(); render(); } }] }); }, html: icon('trash', 15) })))))));
  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Oceny okresowe'), h('div', { class: 'spacer' }),
      segmented([{ value: 'all', label: 'Wszystkie' }, { value: 'month', label: 'Miesięczne' }, { value: 'year', label: 'Roczne' }, { value: 'complex', label: 'Kompleksowe' }], state.assessFilter, (v) => { state.assessFilter = v; render(); }),
      h('button', { class: 'btn primary', onclick: newAssessSheet }, iconEl('plus', 14), 'Nowa ocena')),
    h('div', { class: 'page' }, body));
}

function periodPreview(type, date) {
  const d = parseIso(date) || new Date();
  const y = d.getFullYear(), m = d.getMonth();
  if (type === 'month') return `${MONTHS[m]} ${y}`;
  if (type === 'year') return `${fmtDate(isoDate(new Date(y, 0, 1)))} – ${fmtDate(isoDate(new Date(y, 11, 31)))}`;
  return `${fmtDate(isoDate(new Date(y - 3, m + 1, 1)))} – ${fmtDate(isoDate(new Date(y, m + 1, 0)))} (3 lata)`;
}

function newAssessSheet() {
  if (!state.participants.length) return sheet({ title: 'Brak uczestników', body: h('p', null, 'Najpierw dodaj uczestników (zakładka Uczestnicy) i wystaw im oceny cząstkowe.'), actions: [{ label: 'Anuluj' }, { label: 'Przejdź do uczestników', kind: 'primary', onClick: () => go('participants') }] });
  const d = { type: 'month', who: state.participants[0].id, date: todayIso() };
  const per = h('div', { class: 'muted small' });
  const drawPer = () => { per.textContent = 'Okres oceny: ' + periodPreview(d.type, d.date) + ' – możesz go zmienić po utworzeniu.'; };
  drawPer();
  const opts = [
    ...workWorkshops().filter((w) => groupOf(w.id).length).map((w) => ({ value: 'grp:' + w.id, label: `Wszyscy uczestnicy – ${w.name} (${groupOf(w.id).length})` })),
    ...state.participants.map((p) => ({ value: p.id, label: `${p.lastName} ${p.firstName}${wsById(p.workshopId) ? ' – ' + wsById(p.workshopId).name : ''}` }))
  ];
  sheet({
    title: 'Nowa ocena',
    subtitle: 'Ocena powstaje z ocen cząstkowych z wybranego okresu. Kompleksowa ocena realizacji IPR obejmuje domyślnie 3 lata (art. 10a ustawy o rehabilitacji – nie rzadziej niż co 3 lata).',
    body: h('div', null,
      field('Rodzaj oceny', segmented([{ value: 'month', label: 'Miesięczna' }, { value: 'year', label: 'Roczna (okresowa)' }, { value: 'complex', label: 'Kompleksowa' }], d.type, (v) => { d.type = v; drawPer(); })),
      h('div', { class: 'form-grid two' },
        field('Uczestnik', select(opts, d.who, (v) => { d.who = v; }, { style: 'width:100%' })),
        field('Dzień w ocenianym okresie', h('input', { class: 'input full', type: 'date', value: d.date, onchange: (e) => { d.date = e.target.value; drawPer(); } }))),
      per),
    actions: [{ label: 'Anuluj' }, { label: 'Utwórz', kind: 'primary', onClick: async () => {
      try {
        if (d.who.startsWith('grp:')) {
          const ppl = groupOf(d.who.slice(4));
          for (const p of ppl) await api.createAssessment({ type: d.type, participantId: p.id, date: d.date });
          state.assessments = await api.listAssessments(); render();
          toast(`Utworzono ${ppl.length} ${plural(ppl.length, 'ocenę', 'oceny', 'ocen')}`, 'success');
        } else { const a = await api.createAssessment({ type: d.type, participantId: d.who, date: d.date }); state.assessments = await api.listAssessments(); showAssess(a); }
      } catch (e) { errToast(e); return false; }
    } }]
  });
}

async function openAssess(id) { try { showAssess(await api.getAssessment(id)); } catch (e) { errToast(e); } }
async function showAssess(a) {
  state.assess = a; state.view = 'assess';
  try { state.stats = await api.assessmentStats(a.id); } catch (_) { state.stats = null; }
  render(); document.getElementById('content').scrollTop = 0;
}

const saveAssessSoon = debounce(async () => {
  if (!state.assess) return;
  await api.saveAssessment(state.assess);
  const el = document.getElementById('save-state');
  if (el) { el.textContent = 'Zapisano'; el.classList.remove('dirty'); }
}, 500);
function touchAssess() { const el = document.getElementById('save-state'); if (el) { el.textContent = 'Zapisuję…'; el.classList.add('dirty'); } saveAssessSoon(); }

async function recompute(resetAll) {
  const a = state.assess;
  if (resetAll) { for (const k of Object.keys(a.sections)) a.sections[k].auto = true; a.summaryAuto = true; a.recommendationsAuto = true; if (a.stance) a.stance.auto = true; }
  try { await saveAssessSoon.flush(); state.assess = await api.saveAssessment(a, true); state.stats = await api.assessmentStats(a.id); rerenderKeep(); } catch (e) { errToast(e); }
}

// ───────────────────────── OCENA (edytor) ─────────────────────────
function viewAssess() {
  const a = state.assess;
  const person = state.participants.find((p) => p.id === a.participantId) || { firstName: '?', lastName: '' };
  const S = state.stats || { areas: {}, skills: {}, overall: null, rated: 0, marks: 0 };
  const pct = (v) => (v == null ? '—' : Math.round((v / 4) * 100) + '%');
  const ws = state.workshops;

  const info = h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('person', 16), `${ASSESS_KIND[a.type]} ocena – ${fullName(person)}`),
    h('div', { class: 'form-grid' },
      field('Okres od', h('input', { class: 'input full', type: 'date', value: a.from, onchange: (e) => { a.from = e.target.value; recompute(false); } })),
      field('Okres do', h('input', { class: 'input full', type: 'date', value: a.to, onchange: (e) => { a.to = e.target.value; recompute(false); } })),
      field('Data sporządzenia', h('input', { class: 'input full', type: 'date', value: a.date || '', onchange: (e) => { a.date = e.target.value; touchAssess(); } }))),
    field('Uwzględnione profile', h('div', { class: 'checks' }, ws.map((w) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.workshopIds.includes(w.id), onchange: (e) => { a.workshopIds = e.target.checked ? [...a.workshopIds, w.id] : a.workshopIds.filter((x) => x !== w.id); recompute(false); } }), w.name)))),
    field('Notatki własne (nie trafiają do dokumentu; AI może je uwzględnić – bez danych osobowych)', autoGrow(h('textarea', { class: 'input', rows: 1, value: a.notes || '', oninput: (e) => { a.notes = e.target.value; touchAssess(); } }))));

  const statsCard = h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('table', 16), 'Stopień opanowania umiejętności', h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm', title: 'Przelicz opisy oznaczone jako automatyczne (Twoje poprawki zostają)', onclick: () => recompute(false) }, iconEl('refresh', 12), 'Przelicz z ocen')),
    S.rated ? h('div', null,
      h('div', { class: 'stat-line' }, h('div', { class: 'big-pct' }, pct(S.overall)), h('div', { class: 'muted' }, `${S.rated} ${plural(S.rated, 'oceniona umiejętność', 'ocenione umiejętności', 'ocenionych umiejętności')} · ${S.marks} ${plural(S.marks, 'ocena cząstkowa', 'oceny cząstkowe', 'ocen cząstkowych')} w okresie`)),
      h('div', { class: 'area-bars' }, a.workshopIds.map(wsById).filter(Boolean).flatMap((w) => w.areas.filter((ar) => S.areas[ar.id] && S.areas[ar.id].avg != null).map((ar) => h('div', { class: 'area-bar' },
        h('span', { class: 'ab-name' }, ar.name), h('div', { class: 'progress' }, h('div', { style: { width: pct(S.areas[ar.id].avg) } })), h('span', { class: 'ab-val' }, pct(S.areas[ar.id].avg)))))))
      : h('div', { class: 'note-box warn' }, iconEl('warn', 16), h('div', null, 'W tym okresie uczestnik nie ma jeszcze ocen cząstkowych. Wystaw je w zakładce Oceny cząstkowe, a potem kliknij „Przelicz z ocen”.')));

  const sectionCards = a.workshopIds.map(wsById).filter(Boolean).map((w) => h('div', { class: 'card ed-card cat' },
    h('div', { class: 'cat-head' }, iconEl(w.general ? 'people' : 'home', 16), h('h3', null, w.general ? 'Funkcjonowanie w obszarach ogólnych' : w.name)),
    h('div', { class: 'cat-body' }, w.areas.map((ar) => {
      const sec = a.sections[ar.id] || (a.sections[ar.id] = { text: '', auto: true });
      const st = S.areas[ar.id];
      return h('div', { class: 'sub' + (sec.text ? ' filled' : '') },
        h('div', { class: 'sub-head' }, h('div', { class: 'sub-name' }, ar.name, h('div', { class: 'muted small' }, st && st.avg != null ? `${pct(st.avg)} · ${st.rated}/${st.total} umiejętności ocenionych` : 'brak ocen w okresie')),
          h('div', { class: 'picks' }, h('span', { class: 'chip ' + (sec.auto ? 'blue' : 'orange') }, sec.auto ? 'automatyczny' : 'poprawiony'), !sec.auto ? h('button', { class: 'btn plain sm', onclick: () => { sec.auto = true; recompute(false); } }, 'Przywróć z ocen') : null)),
        autoGrow(h('textarea', { class: 'input', rows: 2, value: sec.text || '', oninput: (e) => { sec.text = e.target.value; sec.auto = false; touchAssess(); } })));
    }))));

  const goals = (person.iprGoals || []).filter((g) => g.text);
  const iprCard = a.type !== 'month' ? h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('flag', 16), 'Realizacja celów IPR'),
    goals.length ? goals.map((g) => {
      const x = a.ipr[g.id] || (a.ipr[g.id] = { status: '', comment: '' });
      return h('div', { class: 'ipr-row' }, h('div', { class: 'ipr-goal' }, g.text),
        select([{ value: '', label: '— stopień realizacji —' }, ...state.info.iprStatus], x.status || '', (v) => { x.status = v; touchAssess(); }),
        h('input', { class: 'input', placeholder: 'uwagi', value: x.comment || '', oninput: (e) => { x.comment = e.target.value; touchAssess(); } }));
    }) : h('div', { class: 'muted' }, 'Uczestnik nie ma wpisanych celów IPR. Dodasz je w zakładce Uczestnicy – pojawią się tu i w dokumencie.')) : null;

  const area = (key, autoKey, label, ph) => field(label, autoGrow(h('textarea', { class: 'input', rows: 3, placeholder: ph || '', value: a[key] || '', oninput: (e) => { a[key] = e.target.value; a[autoKey] = false; touchAssess(); } })));
  const sumCard = h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('checkCircle', 16), 'Podsumowanie i zalecenia', h('div', { class: 'spacer' }),
      aiOn() ? h('button', { class: 'btn sm ai', title: aiReady() ? `${aiName()} zaproponuje podsumowanie i zalecenia na podstawie opisów` : 'Wymaga połączenia z AI', onclick: (e) => aiConclusions(e.currentTarget) }, iconEl('sparkles', 13), 'Zaproponuj z AI') : null,
      h('button', { class: 'btn sm', onclick: () => { a.summaryAuto = true; a.recommendationsAuto = true; recompute(false); } }, iconEl('refresh', 12), 'Z ocen')),
    area('summary', 'summaryAuto', 'Podsumowanie'),
    area('recommendations', 'recommendationsAuto', a.type === 'month' ? 'Zalecenia do dalszej pracy' : 'Wnioski i zalecenia', 'Każde zalecenie w osobnej linii; „–” na początku = punkt listy.'));

  const stCard = a.type === 'complex' ? h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('shield', 16), 'Stanowisko rady programowej'),
    h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, 'Po kompleksowej ocenie rada programowa zajmuje stanowisko w kwestii osiągniętych postępów w rehabilitacji (art. 10a ust. 5 ustawy o rehabilitacji zawodowej i społecznej).'),
    segmented(state.settings.stances.map((s) => ({ value: s.id, label: s.label })), (a.stance || {}).option, (v) => { a.stance = { option: v, text: '', auto: true }; recompute(false); }),
    h('div', { style: { height: '8px' } }),
    autoGrow(h('textarea', { class: 'input', rows: 3, value: (a.stance || {}).text || '', oninput: (e) => { a.stance = { ...(a.stance || {}), text: e.target.value, auto: false }; touchAssess(); } }))) : null;

  return h('div', null,
    h('div', { class: 'toolbar' },
      h('button', { class: 'icon-btn', title: 'Wróć do listy ocen', onclick: () => go('assessments'), html: icon('chevronL', 18) }),
      h('h1', null, fullName(person)), h('span', { class: 'chip ' + KIND_CHIP[a.type] }, ASSESS_KIND[a.type]),
      h('span', { class: 'save-state', id: 'save-state' }, 'Zapisano'), h('div', { class: 'spacer' }),
      aiOn() ? h('button', { class: 'btn ai', title: aiReady() ? `${aiName()} zredaguje opisy obszarów w płynny tekst (bez zmiany poziomów)` : 'Wymaga połączenia z AI', onclick: (e) => aiPolish(e.currentTarget) }, iconEl('wand', 14), 'Wygładź z AI') : null,
      h('button', { class: 'btn', onclick: previewAssess }, iconEl('eye', 14), 'Podgląd'),
      h('button', { class: 'btn', onclick: (e) => exportAssess(e.currentTarget, 'docx') }, iconEl('doc', 14), 'DOCX'),
      h('button', { class: 'btn primary', onclick: (e) => exportAssess(e.currentTarget, 'pdf') }, iconEl('arrowDown', 14), 'PDF')),
    h('div', { class: 'page editor' }, info, statsCard, sectionCards, iprCard, sumCard, stCard));
}

async function aiPolish(btn) {
  if (!needAi()) return;
  const a = state.assess;
  await busy(btn, async () => {
    try {
      await saveAssessSoon.flush();
      const r = await api.aiPolishAssessment(a.id);
      const names = new Map(state.workshops.flatMap((w) => w.areas).map((ar) => [ar.id, ar.name]));
      sheet({
        title: 'Propozycja AI – redakcja opisów', wide: true,
        subtitle: `${r.provider ? r.provider + ' · ' : ''}Sprawdź, czy poziomy opanowania umiejętności się nie zmieniły.`,
        body: h('div', null, Object.entries(r.items).map(([id, t]) => h('div', { class: 'diff' }, h('div', { class: 'diff-name' }, names.get(id) || id), h('div', { class: 'diff-old' }, (a.sections[id] || {}).text || ''), h('div', { class: 'diff-new' }, t)))),
        actions: [{ label: 'Odrzuć' }, { label: 'Przyjmij', kind: 'primary', onClick: async () => { for (const [id, t] of Object.entries(r.items)) a.sections[id] = { text: t, auto: false }; state.assess = await api.saveAssessment(a); rerenderKeep(); } }]
      });
    } catch (e) { errToast(e); }
  }, 'AI pisze…');
}

async function aiConclusions(btn) {
  if (!needAi()) return;
  const a = state.assess;
  await busy(btn, async () => {
    try {
      await saveAssessSoon.flush();
      const r = await api.aiConclusions(a.id);
      sheet({
        title: 'Propozycja podsumowania i zaleceń', wide: true,
        subtitle: `${r.provider ? r.provider + ' · ' : ''}Przyjęcie zastąpi obecną treść pól.`,
        body: h('div', null, h('div', { class: 'diff' }, h('div', { class: 'diff-name' }, 'Podsumowanie'), h('div', { class: 'diff-new' }, r.summary)),
          h('div', { class: 'diff' }, h('div', { class: 'diff-name' }, 'Zalecenia'), h('div', { class: 'diff-new pre' }, r.recommendations)),
          r.stance ? h('div', { class: 'diff' }, h('div', { class: 'diff-name' }, 'Uzasadnienie stanowiska rady programowej'), h('div', { class: 'diff-new' }, r.stance)) : null),
        actions: [{ label: 'Odrzuć' }, { label: 'Zastąp', kind: 'primary', onClick: async () => {
          if (r.summary) { a.summary = r.summary; a.summaryAuto = false; }
          if (r.recommendations) { a.recommendations = r.recommendations; a.recommendationsAuto = false; }
          if (r.stance && a.stance) { a.stance.text = [a.stance.text, r.stance].filter(Boolean).join(' '); a.stance.auto = false; }
          state.assess = await api.saveAssessment(a); rerenderKeep();
        } }]
      });
    } catch (e) { errToast(e); }
  }, 'AI pisze…');
}

async function previewAssess() {
  try { await saveAssessSoon.flush(); const r = await api.previewAssessment(state.assess.id); showPreview(r, 'Podgląd oceny', (f) => exportAssess(null, f)); } catch (e) { errToast(e); }
}
async function exportAssess(btn, format) {
  const work = async () => { try { await saveAssessSoon.flush(); exportedToast(await api.exportAssessment(state.assess.id, format), format); } catch (e) { errToast(e); } };
  if (btn) await busy(btn, work, 'Zapisuję…'); else await work();
}

// ───────────────────────── UCZESTNICY ─────────────────────────
function viewParticipants() {
  const ws = workWorkshops();
  const list = state.participants.filter((p) => !state.peopleFilter || p.workshopId === state.peopleFilter);
  const importSheet = () => {
    let wid = state.peopleFilter || '';
    const ta = h('textarea', { class: 'input', rows: 7, placeholder: 'Wklej tabelę z nagłówkami (np. z Excela): Nazwisko, Imię, Data urodzenia, PESEL…' });
    const done = async (r) => { if (!r) return; state.participants = await api.listParticipants(); toast(`Dodano: ${r.added}, zaktualizowano: ${r.updated}`, 'success', 5000); render(); };
    sheet({
      title: 'Import uczestników', wide: true,
      subtitle: 'Wczytaj listę z pliku Excel (.xlsx), CSV lub XML albo wklej tabelę skopiowaną z innego programu. Kolumny są rozpoznawane po nagłówkach.',
      body: h('div', null,
        field('Przypisz nowych uczestników do pracowni', select([{ value: '', label: '— bez przypisania —' }, ...ws.map((w) => ({ value: w.id, label: w.name }))], wid, (v) => { wid = v; }, { style: 'width:100%' })),
        h('div', { style: { margin: '10px 0' } }, h('button', { class: 'btn primary', onclick: (e) => busy(e.currentTarget, async () => { try { await done(await api.importParticipantsFile(wid)); } catch (er) { errToast(er); } }, 'Wczytuję…') }, iconEl('upload', 14), 'Wczytaj plik…')),
        field('…albo wklej tabelę', ta)),
      actions: [{ label: 'Zamknij' }, { label: 'Importuj wklejone', kind: 'primary', onClick: async () => { try { await done(await api.importParticipantsText(ta.value, wid)); } catch (e) { errToast(e); return false; } } }]
    });
  };
  let body;
  if (!state.participants.length) body = emptyState('people', 'Dodaj uczestników warsztatu', 'Każdy uczestnik jest przypisany do pracowni. Na podstawie jego ocen cząstkowych plany uwzględniają pracę indywidualną, a oceny okresowe opisują postępy.', h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center' } }, h('button', { class: 'btn primary lg', onclick: () => editParticipant(null) }, iconEl('plus', 15), 'Dodaj uczestnika'), h('button', { class: 'btn lg', onclick: importSheet }, iconEl('upload', 15), 'Importuj z pliku')));
  else body = h('div', { class: 'card', style: { overflow: 'hidden' } }, h('table', { class: 'tbl list' },
    h('thead', null, h('tr', null, h('th', null, `Uczestnik (${list.length})`), h('th', null, 'Pracownia'), h('th', null, 'Orzeczenie'), h('th', null, 'Data przyjęcia'), h('th', null, 'Cele IPR'), h('th', null, ''))),
    h('tbody', null, list.map((p) => h('tr', { class: 'clickable' + (p.active === false ? ' off' : ''), onclick: () => editParticipant(p) },
      h('td', null, h('div', { class: 'who' }, h('span', { class: 'avatar' }, (p.lastName || '?').charAt(0)), h('b', null, `${p.lastName} ${p.firstName}`), p.active === false ? h('span', { class: 'chip' }, 'nieaktywny') : null)),
      h('td', null, wsById(p.workshopId) ? wsById(p.workshopId).name : h('span', { class: 'muted' }, '— nieprzypisany —')),
      h('td', { class: 'muted small' }, describeDis(p.disability) || '—'),
      h('td', { class: 'muted' }, fmtDate(p.admission)),
      h('td', null, (p.iprGoals || []).length || '—'),
      h('td', { style: { textAlign: 'right' } }, h('button', { class: 'icon-btn', title: 'Usuń', onclick: (e) => { e.stopPropagation(); sheet({ title: 'Usunąć uczestnika?', body: h('p', null, `${fullName(p)} zostanie usunięty z aplikacji razem z ocenami cząstkowymi i ocenami okresowymi. Zamiast tego możesz oznaczyć uczestnika jako nieaktywnego.`), actions: [{ label: 'Anuluj' }, { label: 'Usuń', kind: 'danger', onClick: async () => { await api.removeParticipant(p.id); await reloadData(); render(); } }] }); }, html: icon('trash', 15) })))))));
  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Uczestnicy'), h('div', { class: 'spacer' }),
      state.participants.length ? select([{ value: '', label: 'Wszystkie pracownie' }, ...ws.map((w) => ({ value: w.id, label: w.name }))], state.peopleFilter, (v) => { state.peopleFilter = v; render(); }) : null,
      h('button', { class: 'btn', onclick: () => openDocs('') }, iconEl('scan', 14), 'Z dokumentu'),
      h('button', { class: 'btn', onclick: importSheet }, iconEl('upload', 14), 'Importuj'),
      h('button', { class: 'btn primary', onclick: () => editParticipant(null) }, iconEl('plus', 14), 'Dodaj uczestnika')),
    h('div', { class: 'page' }, body,
      h('p', { class: 'group-footer', style: { maxWidth: '900px' } }, 'Dane uczestników są przechowywane wyłącznie na tym komputerze. Do AI nie trafiają imiona, nazwiska, PESEL, daty urodzenia ani adresy – pilnuje tego strażnik prywatności.')));
}

function editParticipant(p) {
  const isNew = !p;
  const d = JSON.parse(JSON.stringify(p || { id: newId(), firstName: '', lastName: '', gender: 'm', birthDate: '', pesel: '', refStyle: 'imie', workshopId: state.peopleFilter || '', admission: '', iprGoals: [], notes: '', active: true }));
  d.iprGoals = d.iprGoals || [];
  const inp = (key, attrs = {}) => h('input', { class: 'input full', value: d[key] || '', ...attrs, oninput: (e) => { d[key] = e.target.value; } });
  const goals = h('div', { class: 'goals' });
  const drawGoals = () => goals.replaceChildren(...d.iprGoals.map((g, i) => h('div', { class: 'goal-row' },
    autoGrow(h('textarea', { class: 'input', rows: 1, value: g.text, placeholder: 'np. Samodzielne przygotowanie kanapki z zachowaniem zasad higieny', oninput: (e) => { g.text = e.target.value; } })),
    h('button', { class: 'icon-btn', title: 'Usuń cel', onclick: () => { d.iprGoals.splice(i, 1); drawGoals(); }, html: icon('x', 13) }))),
  h('button', { class: 'btn plain sm', onclick: () => { d.iprGoals.push({ id: 'c-' + newId(), text: '' }); drawGoals(); goals.querySelectorAll('textarea')[d.iprGoals.length - 1].focus(); } }, iconEl('plus', 12), 'Dodaj cel IPR'));
  drawGoals();
  const progress = h('div', null);
  if (!isNew) loadProgress(d, progress);
  let sh;
  sh = sheet({
    title: isNew ? 'Nowy uczestnik' : fullName(d), wide: true,
    body: h('div', null,
      h('div', { class: 'form-grid' },
        field('Imię', inp('firstName')), field('Nazwisko', inp('lastName')),
        field('Płeć (formy gramatyczne)', segmented([{ value: 'm', label: 'Mężczyzna' }, { value: 'k', label: 'Kobieta' }], d.gender, (v) => { d.gender = v; })),
        field('Data urodzenia', inp('birthDate', { type: 'date' })), field('PESEL (opcjonalnie)', inp('pesel', { maxlength: 11 })),
        field('Data przyjęcia do WTZ', inp('admission', { type: 'date' })),
        field('Pracownia', select([{ value: '', label: '— nieprzypisany —' }, ...workWorkshops().map((w) => ({ value: w.id, label: w.name }))], d.workshopId || '', (v) => { d.workshopId = v; }, { style: 'width:100%' })),
        field('W opisach nazywaj osobę', select(state.info.refStyles, d.refStyle || 'imie', (v) => { d.refStyle = v; }, { style: 'width:100%' })),
        field('Status', h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.active !== false, onchange: (e) => { d.active = e.target.checked; } }), 'aktywny uczestnik'))),
      h('h3', { class: 'group-title', style: { marginTop: '14px' } }, 'Orzeczenie i dostosowania'),
      participantDisabilitySection(d),
      field('Cele indywidualnego programu rehabilitacji (IPR)', goals),
      !isNew ? field('Dokumenty (orzeczenia, poprzednie oceny, IPR) – skany zostają na tym komputerze', participantDocsSection(d, () => sh.close())) : null,
      field('Notatki', autoGrow(h('textarea', { class: 'input', rows: 2, value: d.notes || '', oninput: (e) => { d.notes = e.target.value; } }))),
      progress),
    actions: [{ label: 'Anuluj' }, { label: 'Zapisz', kind: 'primary', onClick: async () => {
      if (!d.firstName.trim() || !d.lastName.trim()) { toast('Podaj imię i nazwisko', 'error'); return false; }
      d.firstName = d.firstName.trim(); d.lastName = d.lastName.trim(); d.iprGoals = d.iprGoals.filter((g) => String(g.text || '').trim());
      try {
        const cur = state.participants.find((x) => x.id === d.id);
        if (cur) d.documents = cur.documents; // dokumenty zmieniane są osobno (dodawanie, analiza, usuwanie)
        await api.saveParticipant(d); state.participants = await api.listParticipants(); render(); toast('Zapisano', 'success', 1500);
      } catch (e) { errToast(e); return false; }
    } }]
  });
}

// Postępy uczestnika: średni poziom w obszarach w ostatnich 6 miesiącach.
async function loadProgress(p, el) {
  try {
    const marks = await api.getMarks({ participantId: p.id });
    if (!marks.length) { el.replaceChildren(h('div', { class: 'muted small' }, 'Brak ocen cząstkowych.')); return; }
    const now = new Date();
    const months = [...Array(6)].map((_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; });
    const sources = [wsById(p.workshopId), generalWs()].filter(Boolean);
    const rows = sources.flatMap((w) => w.areas.map((ar) => {
      const ids = new Set(ar.skills.map((s) => s.id));
      const cells = months.map((m) => { const v = marks.filter((x) => ids.has(x.skillId) && x.date.startsWith(m)).map((x) => x.level); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
      return { name: ar.name, cells };
    })).filter((r) => r.cells.some((c) => c != null));
    el.replaceChildren(field('Postępy – średni poziom w obszarach (0–4)', h('table', { class: 'tbl progress-tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Obszar'), months.map((m) => h('th', null, MONTHS[+m.slice(5) - 1].slice(0, 3) + ' ' + m.slice(2, 4))))),
      h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r.name), r.cells.map((c) => h('td', { class: 'pv' + (c == null ? '' : Math.round(c)) }, c == null ? '–' : (Math.round(c * 10) / 10).toString().replace('.', ',')))))))));
  } catch (e) { el.replaceChildren(); }
}

// ───────────────────────── PRACOWNIE (profile) ─────────────────────────
const saveWorkshopsSoon = debounce(async () => { await api.setWorkshops(state.workshops); }, 500);

function viewWorkshops() {
  const list = state.workshops;
  if (!list.find((w) => w.id === state.wsId)) state.wsId = (workWorkshops()[0] || list[0] || {}).id || null;
  const w = list.find((x) => x.id === state.wsId);
  const changed = () => saveWorkshopsSoon();
  const redraw = () => rerenderKeep();

  const side = h('div', { class: 'lib-side card' },
    list.map((x) => h('div', { class: 'lib-cat' + (x.id === state.wsId ? ' active' : ''), onclick: () => { state.wsId = x.id; redraw(); } },
      h('span', { class: 'lib-cat-name' }, x.name || 'Bez nazwy'), h('span', { class: 'muted small' }, x.activities.length))),
    h('button', { class: 'btn plain sm', style: { margin: '6px' }, onclick: () => newWorkshopSheet() }, iconEl('plus', 12), 'Dodaj pracownię'));

  let main;
  if (!w) main = h('div', { class: 'card card-pad' }, h('div', { class: 'empty' }, 'Dodaj pierwszą pracownię.'));
  else {
    const allSk = skillsOf(w);
    const areaCard = (ar, ai) => h('div', { class: 'card lib-sub' },
      h('div', { class: 'lib-sub-head' },
        h('input', { class: 'input name', value: ar.name, placeholder: 'Nazwa obszaru, np. Przygotowywanie posiłków', oninput: (e) => { ar.name = e.target.value; changed(); } }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'icon-btn', title: 'Usuń obszar', onclick: () => sheet({ title: 'Usunąć obszar?', body: h('p', null, `Obszar „${ar.name}” i jego umiejętności zostaną usunięte z profilu. Oceny cząstkowe tych umiejętności przestaną być widoczne w ocenach.`), actions: [{ label: 'Anuluj' }, { label: 'Usuń', kind: 'danger', onClick: () => { w.areas.splice(ai, 1); changed(); redraw(); } }] }), html: icon('trash', 14) })),
      ar.skills.map((s, si) => h('div', { class: 'lib-var skill-var' },
        h('input', { class: 'input', value: s.name, placeholder: 'Umiejętność, np. Krojenie i posługiwanie się nożem', oninput: (e) => { s.name = e.target.value; changed(); } }),
        h('button', { class: 'icon-btn', title: 'Usuń umiejętność', onclick: () => { ar.skills.splice(si, 1); w.activities.forEach((a) => { a.skills = a.skills.filter((x) => x !== s.id); }); changed(); redraw(); }, html: icon('x', 13) }))),
      h('button', { class: 'btn plain sm', onclick: () => { ar.skills.push({ id: `${w.id}.u-${newId()}`, name: '' }); changed(); redraw(); } }, iconEl('plus', 12), 'Dodaj umiejętność'));

    const actCard = (a, ai) => h('div', { class: 'card lib-sub act-card' },
      h('div', { class: 'lib-sub-head' },
        h('input', { class: 'input name', value: a.name, placeholder: 'Nazwa zajęć', oninput: (e) => { a.name = e.target.value; changed(); } }),
        !a.skills.length ? h('span', { class: 'chip orange', title: 'Zajęcia bez umiejętności nie trafiają do planów' }, 'wybierz umiejętności') : null,
        h('div', { class: 'spacer' }),
        h('button', { class: 'icon-btn', title: 'Usuń zajęcia', onclick: () => { w.activities.splice(ai, 1); changed(); redraw(); }, html: icon('trash', 14) })),
      h('div', { class: 'act-skills' }, w.areas.map((ar) => h('div', { class: 'act-area' }, h('span', { class: 'muted small' }, ar.name + ':'),
        ar.skills.map((s) => h('button', { class: 'pick' + (a.skills.includes(s.id) ? ' on' : ''), type: 'button', onclick: (e) => { a.skills = a.skills.includes(s.id) ? a.skills.filter((x) => x !== s.id) : [...a.skills, s.id]; e.currentTarget.classList.toggle('on'); changed(); } }, s.name || '(bez nazwy)'))))),
      h('div', { class: 'form-grid act-fields' },
        field('Cel', h('input', { class: 'input full', value: a.goal || '', oninput: (e) => { a.goal = e.target.value; changed(); } })),
        field('Metody i formy', h('input', { class: 'input full', value: a.methods || '', oninput: (e) => { a.methods = e.target.value; changed(); } })),
        field('Materiały', h('input', { class: 'input full', value: a.materials || '', oninput: (e) => { a.materials = e.target.value; changed(); } }))));

    main = h('div', { class: 'lib-main' },
      h('div', { class: 'lib-cat-head' },
        h('input', { class: 'input cat-name', value: w.name, oninput: (e) => { w.name = e.target.value; changed(); const el = side.querySelector('.lib-cat.active .lib-cat-name'); if (el) el.textContent = w.name || 'Bez nazwy'; } }),
        aiOn() && !w.general ? h('button', { class: 'btn sm ai', title: 'AI zaproponuje obszary, umiejętności i bank zajęć dla tej pracowni', onclick: () => aiProfileSheet(w) }, iconEl('sparkles', 13), 'Uzupełnij z AI') : null,
        h('button', { class: 'icon-btn', title: 'Eksportuj profil do pliku', onclick: async () => { try { await saveWorkshopsSoon.flush(); const r = await api.exportWorkshops([w.id]); if (r) toast('Zapisano profil', 'success'); } catch (e) { errToast(e); } }, html: icon('arrowDown', 15) }),
        !w.general ? h('button', { class: 'icon-btn', title: 'Usuń pracownię', onclick: () => sheet({ title: 'Usunąć pracownię?', body: h('p', null, `Profil „${w.name}” zostanie usunięty. Istniejące plany tej pracowni nie będą mogły być edytowane, a oceny cząstkowe jej umiejętności przestaną być widoczne.`), actions: [{ label: 'Anuluj' }, { label: 'Usuń', kind: 'danger', onClick: () => { state.workshops = list.filter((x) => x.id !== w.id); changed(); redraw(); } }] }), html: icon('trash', 15) }) : null),
      h('div', { class: 'card card-pad ed-card' },
        h('div', { class: 'form-grid two' },
          field('Prowadzący (instruktor / terapeuta)', h('input', { class: 'input full', value: w.instructor || '', placeholder: 'puste = autor z Ustawień', oninput: (e) => { w.instructor = e.target.value; changed(); } })),
          field('Liczba', h('div', { class: 'muted', style: { paddingTop: '7px' } }, `${w.areas.length} ${plural(w.areas.length, 'obszar', 'obszary', 'obszarów')} · ${allSk.length} ${plural(allSk.length, 'umiejętność', 'umiejętności', 'umiejętności')} · ${w.activities.length} ${plural(w.activities.length, 'zajęcie', 'zajęcia', 'zajęć')}`))),
        field('Profil pracowni (opis)', autoGrow(h('textarea', { class: 'input', rows: 2, value: w.description || '', oninput: (e) => { w.description = e.target.value; changed(); } }))),
        field('Cele pracowni (każdy w osobnej linii)', autoGrow(h('textarea', { class: 'input', rows: 3, value: (w.goals || []).join('\n'), oninput: (e) => { w.goals = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); changed(); } })))),
      h('h3', { class: 'group-title', style: { marginTop: '18px' } }, 'Obszary i umiejętności (oceniane w ocenach cząstkowych)'),
      w.areas.map(areaCard),
      h('button', { class: 'btn', onclick: () => { w.areas.push({ id: `${w.id}.o-${newId()}`, name: '', skills: [{ id: `${w.id}.u-${newId()}`, name: '' }] }); changed(); redraw(); } }, iconEl('plus', 14), 'Dodaj obszar'),
      h('h3', { class: 'group-title', style: { marginTop: '22px' } }, `Bank zajęć (${w.activities.length}) – tylko z tych zajęć powstają plany`),
      w.activities.map(actCard),
      h('button', { class: 'btn', onclick: () => { w.activities.push({ id: `${w.id}.z-${newId()}`, name: '', skills: [], goal: '', methods: '', materials: '' }); changed(); redraw(); } }, iconEl('plus', 14), 'Dodaj zajęcia'));
  }

  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Pracownie'), h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: async () => { try { await saveWorkshopsSoon.flush(); const r = await api.importWorkshops(); if (r) { state.workshops = r.workshops; toast(`Wczytano: ${r.added} nowe, ${r.replaced} zastąpione`, 'success'); render(); } } catch (e) { errToast(e); } } }, iconEl('upload', 14), 'Wczytaj profile'),
      h('button', { class: 'btn', onclick: async () => { try { await saveWorkshopsSoon.flush(); const r = await api.exportWorkshops(null); if (r) toast('Zapisano profile', 'success'); } catch (e) { errToast(e); } } }, iconEl('arrowDown', 14), 'Zapisz wszystkie'),
      h('button', { class: 'btn', onclick: () => sheet({ title: 'Przywrócić zestaw startowy?', body: h('p', null, 'Wszystkie profile pracowni zostaną zastąpione zestawem startowym. Plany, uczestnicy i oceny zostają, ale zajęcia i umiejętności spoza zestawu przestaną być widoczne.'), actions: [{ label: 'Anuluj' }, { label: 'Przywróć', kind: 'danger', onClick: async () => { await saveWorkshopsSoon.flush(); state.workshops = await api.resetWorkshops(); render(); } }] }) }, iconEl('refresh', 14), 'Zestaw startowy')),
    h('div', { class: 'page' },
      h('div', { class: 'note-box' }, iconEl('info', 16), h('div', null, h('b', null, 'Profil pracowni decyduje o planach i ocenach. '), 'Plany pracy składają się wyłącznie z zajęć z banku pracowni, a oceny cząstkowe dotyczą umiejętności z jej obszarów. Profil „Umiejętności ogólne” jest wspólny dla wszystkich uczestników. Zestaw startowy możesz dowolnie zmieniać, a profile zapisać do pliku i przenieść na inny komputer.')),
      h('div', { class: 'lib' }, side, main)));
}

function newWorkshopSheet() {
  let name = '', description = '';
  sheet({
    title: 'Nowa pracownia',
    body: h('div', null,
      field('Nazwa pracowni', h('input', { class: 'input full', placeholder: 'np. Pracownia przygotowania do pracy', oninput: (e) => { name = e.target.value; } })),
      field('Profil (opis) – opcjonalnie', autoGrow(h('textarea', { class: 'input', rows: 2, oninput: (e) => { description = e.target.value; } }))),
      aiOn() ? h('p', { class: 'muted small' }, 'Po utworzeniu możesz kliknąć „Uzupełnij z AI”, aby otrzymać propozycję obszarów, umiejętności i banku zajęć.') : null),
    actions: [{ label: 'Anuluj' }, { label: 'Utwórz', kind: 'primary', onClick: async () => {
      if (!name.trim()) { toast('Podaj nazwę pracowni', 'error'); return false; }
      const id = 'p-' + newId();
      state.workshops.push({ id, name: name.trim(), description: description.trim(), instructor: '', goals: [], areas: [{ id: `${id}.o-${newId()}`, name: '', skills: [{ id: `${id}.u-${newId()}`, name: '' }] }], activities: [] });
      state.wsId = id; await api.setWorkshops(state.workshops); render();
    } }]
  });
}

function aiProfileSheet(w) {
  if (!needAi()) return;
  let s;
  const run = async (btn) => busy(btn, async () => {
    try {
      await saveWorkshopsSoon.flush();
      const r = await api.aiProfile({ name: w.name, description: w.description });
      s.close();
      sheet({
        title: `Propozycja profilu – ${w.name}`, wide: true,
        subtitle: `${r.provider ? r.provider + ' · ' : ''}${r.areas.length} ${plural(r.areas.length, 'obszar', 'obszary', 'obszarów')}, ${r.areas.reduce((n, a) => n + a.skills.length, 0)} umiejętności, ${r.activities.length} zajęć. Sprawdź i dopasuj do swojej pracowni.`,
        body: h('div', null, r.description ? h('p', null, r.description) : null,
          r.areas.map((a) => h('div', { class: 'diff' }, h('div', { class: 'diff-name' }, a.name), h('div', { class: 'diff-new' }, a.skills.join(' · ')))),
          h('div', { class: 'diff' }, h('div', { class: 'diff-name' }, 'Zajęcia'), h('div', { class: 'diff-new pre' }, r.activities.map((a) => '– ' + a.name).join('\n')))),
        actions: [{ label: 'Odrzuć' },
          { label: 'Dodaj do profilu', onClick: () => applyProfile(w, r, false) },
          { label: 'Zastąp profil', kind: 'primary', onClick: () => applyProfile(w, r, true) }]
      });
    } catch (e) { errToast(e); }
  }, 'AI pisze…');
  s = sheet({ title: 'Uzupełnij profil z AI', body: h('p', null, `AI zaproponuje obszary umiejętności i bank zajęć dla „${w.name}” na podstawie nazwy i opisu pracowni. Do AI nie trafiają żadne dane uczestników.`),
    actions: [{ label: 'Anuluj' }, { label: 'Zaproponuj', kind: 'primary', onClick: (e) => { run(document.querySelector('.sheet-actions .btn.primary')); return false; } }] });
}

async function applyProfile(w, r, replace) {
  if (replace) { w.areas = []; w.activities = []; }
  if (r.description && (replace || !w.description)) w.description = r.description;
  if (r.goals.length && (replace || !(w.goals || []).length)) w.goals = r.goals;
  w.areas = w.areas.filter((a) => a.name || a.skills.some((s) => s.name));
  const byName = new Map(skillsOf(w).map((s) => [s.name.toLowerCase(), s.id]));
  for (const a of r.areas) {
    let ar = w.areas.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
    if (!ar) { ar = { id: `${w.id}.o-${newId()}`, name: a.name, skills: [] }; w.areas.push(ar); }
    for (const sn of a.skills) if (!byName.has(sn.toLowerCase())) { const id = `${w.id}.u-${newId()}`; ar.skills.push({ id, name: sn }); byName.set(sn.toLowerCase(), id); }
  }
  for (const a of r.activities) if (!w.activities.some((x) => x.name.toLowerCase() === a.name.toLowerCase())) w.activities.push({ id: `${w.id}.z-${newId()}`, name: a.name, skills: a.skills.map((s) => byName.get(s.toLowerCase())).filter(Boolean), goal: a.goal, methods: a.methods, materials: a.materials });
  await api.setWorkshops(state.workshops);
  render();
}

// ───────────────────────── USTAWIENIA ─────────────────────────
function viewSettings() {
  const tabs = [
    { value: 'general', label: 'Ogólne', icon: 'person' },
    { value: 'docs', label: 'Dokumenty', icon: 'doc' },
    { value: 'scale', label: 'Skala i opisy', icon: 'list' },
    { value: 'schedule', label: 'Rozkład dnia', icon: 'clock' },
    { value: 'ai', label: 'AI', icon: 'sparkles' }
  ];
  const body = { general: settingsGeneral, docs: settingsDocs, scale: settingsScale, schedule: settingsSchedule, ai: settingsAi }[state.settingsTab]();
  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Ustawienia')),
    h('div', { class: 'page' }, h('div', { class: 'settings-tabs' }, segmented(tabs, state.settingsTab, (v) => { state.settingsTab = v; render(); })), body));
}

function textInput(value, onSave, attrs = {}) {
  return h('input', { class: 'input', style: { width: attrs.width || '300px' }, value: value || '', placeholder: attrs.placeholder || '', type: attrs.type || 'text', onchange: (e) => onSave(e.target.value) });
}
function textArea(value, onSave, attrs = {}) {
  return autoGrow(h('textarea', { class: 'input', rows: attrs.rows || 2, placeholder: attrs.placeholder || '', value: value || '', onchange: (e) => onSave(e.target.value) }));
}

function settingsGeneral() {
  const s = state.settings;
  return h('div', null,
    group('Autor dokumentów', [
      row('Imię i nazwisko', textInput(s.profile.name, (v) => saveSettings({ profile: { name: v } }), { placeholder: 'np. mgr Anna Nowak' }), { icon: 'person', color: 'var(--accent)' }),
      row('Stanowisko', textInput(s.profile.title, (v) => saveSettings({ profile: { title: v } }), { placeholder: 'np. terapeuta zajęciowy' }), { icon: 'flag', color: 'var(--purple)' }),
      row('Miejscowość', textInput(s.profile.city, (v) => saveSettings({ profile: { city: v } }), { placeholder: 'np. Kraków' }), { icon: 'globe', color: 'var(--teal)' }),
      row('Warsztat (nagłówek dokumentów)', textArea(s.profile.institution, (v) => saveSettings({ profile: { institution: v } }), { rows: 3, placeholder: 'Warsztat Terapii Zajęciowej …\nulica i numer\nkod pocztowy, miejscowość' }), { icon: 'home', color: 'var(--indigo)', stack: true })
    ], 'Te dane trafiają do nagłówka i podpisu planów oraz ocen. Prowadzącego pracownię ustawisz w jej profilu.'),
    group('Wygląd aplikacji', [
      row('Motyw', segmented([{ value: 'system', label: 'Systemowy' }, { value: 'light', label: 'Jasny' }, { value: 'dark', label: 'Ciemny' }], s.ui.theme, (v) => saveSettings({ ui: { theme: v } }, true)), { icon: 'paint', color: 'var(--pink)' })
    ]),
    group('Dane', [
      row('Folder danych aplikacji', h('span', { class: 'path', style: { maxWidth: '380px' } }, state.info.dataDir), { icon: 'folder', color: 'var(--orange)', hint: state.info.portable ? 'Wersja przenośna – dane leżą obok pliku .exe.' : 'Wszystkie dane są przechowywane wyłącznie na tym komputerze. Kopia tego folderu = kopia wszystkich danych.' }),
      row('Wersja', h('span', { class: 'muted' }, state.info.version), { icon: 'info', color: 'var(--text-3)' })
    ]));
}

function settingsDocs() {
  const T = state.settings.template;
  const save = (patch, quiet) => saveSettings({ template: patch }, quiet);
  const title = (key, name) => row(name, textInput(T.titles[key], (v) => save({ titles: { [key]: v.trim() || T.titles[key] } }), { width: '420px' }));
  return h('div', null,
    group('Tytuły dokumentów', [title('day', 'Plan dzienny'), title('week', 'Plan tygodniowy'), title('month', 'Plan miesięczny'), title('month_a', 'Ocena miesięczna'), title('year_a', 'Ocena roczna'), title('complex_a', 'Ocena kompleksowa')]),
    group('Nagłówek i podpisy', [
      row('Nagłówek', textArea(T.header, (v) => save({ header: v }), { rows: 2, placeholder: 'Puste = dane warsztatu z zakładki Ogólne' }), { stack: true }),
      row('Skład rady programowej (podpisy pod oceną kompleksową, każda osoba w osobnej linii)', textArea(T.council, (v) => save({ council: v }), { rows: 4 }), { stack: true }),
      row('Dopisek na końcu ocen', textArea(T.footnote, (v) => save({ footnote: v }), { rows: 2, placeholder: 'opcjonalnie' }), { stack: true })
    ]),
    group('Treść', [
      row('Tabela umiejętności w ocenach', toggle(T.skillTable !== false, (v) => save({ skillTable: v }, true)), { hint: 'Zestawienie ocen cząstkowych: liczba ocen, średnia, poziom i zmiana.' }),
      row('Harmonogram dzienny w planie miesięcznym', toggle(T.monthDetail !== false, (v) => save({ monthDetail: v }, true))),
      row('Plany w orientacji poziomej', toggle(T.landscapePlans !== false, (v) => save({ landscapePlans: v }, true)))
    ]),
    group('Wygląd dokumentu', [
      row('Czcionka', select(['Times New Roman', 'Cambria', 'Calibri', 'Arial'].map((f) => ({ value: f, label: f })), T.font, (v) => save({ font: v }))),
      row('Rozmiar tekstu', select([10, 11, 12, 13].map((n) => ({ value: String(n), label: n + ' pt' })), String(T.fontSize), (v) => save({ fontSize: Number(v) }))),
      row('Interlinia', select([{ value: '1', label: 'Pojedyncza' }, { value: '1.15', label: '1,15' }, { value: '1.5', label: '1,5' }], String(T.lineSpacing), (v) => save({ lineSpacing: Number(v) }))),
      row('Marginesy', select([{ value: '1.5', label: '1,5 cm' }, { value: '2', label: '2 cm' }, { value: '2.5', label: '2,5 cm' }], String(T.marginCm), (v) => save({ marginCm: Number(v) }))),
      row('Tekst wyjustowany', toggle(T.justify, (v) => save({ justify: v }, true)))
    ]));
}

function settingsScale() {
  const s = state.settings;
  const saveScale = () => saveSettings({ scale: s.scale }, true);
  const reset = (key, label) => h('button', { class: 'btn sm', onclick: () => sheet({ title: `Przywrócić domyślne: ${label}?`, body: h('p', null, 'Twoje zmiany w tej części zostaną zastąpione ustawieniami domyślnymi.'), actions: [{ label: 'Anuluj' }, { label: 'Przywróć', kind: 'danger', onClick: async () => { state.settings = await api.resetSettingsPart(key); render(); } }] }) }, iconEl('refresh', 12), 'Domyślne');
  return h('div', null,
    h('section', { class: 'group' }, h('div', { class: 'group-row' }, h('h3', { class: 'group-title' }, 'Skala ocen cząstkowych (0–4)'), h('div', { class: 'spacer' }), reset('scale', 'skala')),
      h('div', { class: 'group-body', style: { padding: '6px 14px' } }, s.scale.map((lv) => h('div', { class: 'scale-row' },
        h('span', { class: 'scale-val lv' + lv.value }, lv.value),
        h('div', { class: 'scale-fields' },
          h('div', { class: 'form-grid two' },
            field('Nazwa poziomu', h('input', { class: 'input full', value: lv.label, onchange: (e) => { lv.label = e.target.value; saveScale(); } })),
            field('Opis poziomu', h('input', { class: 'input full', value: lv.desc, onchange: (e) => { lv.desc = e.target.value; saveScale(); } }))),
          field('Zdanie w ocenie opisowej ({osoba}, [forma m|forma ż], {lista} = umiejętności)', autoGrow(h('textarea', { class: 'input', rows: 1, value: lv.text, onchange: (e) => { lv.text = e.target.value; saveScale(); } }))))))),
      h('p', { class: 'group-footer' }, 'Średnia ocen cząstkowych z okresu, zaokrąglona do pełnego poziomu, decyduje o tym, którym zdaniem opisana jest umiejętność. Wynik procentowy = średnia / 4.')),
    h('section', { class: 'group' }, h('div', { class: 'group-row' }, h('h3', { class: 'group-title' }, 'Zdania o zmianach'), h('div', { class: 'spacer' }), reset('phrases', 'zdania o zmianach')),
      h('div', { class: 'group-body', style: { padding: '6px 14px' } },
        [['progress', 'Postęp ({porównanie} = „poprzednim miesiącem” / „początkiem okresu oceny”)'], ['regress', 'Obniżenie poziomu'], ['stable', 'Bez zmian'], ['none', 'Brak ocen w obszarze']].map(([k, label]) =>
          field(label, autoGrow(h('textarea', { class: 'input', rows: 1, value: s.phrases[k], onchange: (e) => saveSettings({ phrases: { [k]: e.target.value } }, true) })))))),
    h('section', { class: 'group' }, h('div', { class: 'group-row' }, h('h3', { class: 'group-title' }, 'Stanowiska rady programowej (ocena kompleksowa)'), h('div', { class: 'spacer' }), reset('stances', 'stanowiska')),
      h('div', { class: 'group-body', style: { padding: '6px 14px' } }, s.stances.map((st) => h('div', { class: 'form-grid stance-grid' },
        field('Nazwa', h('input', { class: 'input full', value: st.label, onchange: (e) => { st.label = e.target.value; saveSettings({ stances: s.stances }, true); } })),
        field('Treść', autoGrow(h('textarea', { class: 'input', rows: 1, value: st.text, onchange: (e) => { st.text = e.target.value; saveSettings({ stances: s.stances }, true); } })))))),
      h('p', { class: 'group-footer' }, 'Zgodnie z art. 10a ust. 5 ustawy o rehabilitacji zawodowej i społecznej rada programowa po kompleksowej ocenie zajmuje stanowisko w kwestii osiągniętych postępów. Treści dopasuj do praktyki swojego warsztatu.')));
}

function settingsSchedule() {
  const s = state.settings;
  const saveSch = () => saveSettings({ schedule: s.schedule }, true);
  const kinds = [{ value: 'activity', label: 'Zajęcia w pracowni' }, { value: 'general', label: 'Zajęcia ogólne' }, { value: 'fixed', label: 'Stały punkt dnia' }];
  const reset = (key, label) => h('button', { class: 'btn sm', onclick: () => sheet({ title: `Przywrócić domyślne: ${label}?`, body: h('p', null, 'Twoje zmiany w tej części zostaną zastąpione ustawieniami domyślnymi.'), actions: [{ label: 'Anuluj' }, { label: 'Przywróć', kind: 'danger', onClick: async () => { state.settings = await api.resetSettingsPart(key); render(); } }] }) }, iconEl('refresh', 12), 'Domyślne');
  return h('div', null,
    h('section', { class: 'group' }, h('div', { class: 'group-row' }, h('h3', { class: 'group-title' }, 'Rozkład dnia w warsztacie'), h('div', { class: 'spacer' }), reset('schedule', 'rozkład dnia')),
      h('div', { class: 'group-body', style: { padding: '8px 14px' } },
        s.schedule.map((sl, i) => h('div', { class: 'slot-row' },
          h('input', { class: 'input w-time', type: 'time', value: sl.start, onchange: (e) => { sl.start = e.target.value; saveSch(); } }),
          h('input', { class: 'input w-time', type: 'time', value: sl.end, onchange: (e) => { sl.end = e.target.value; saveSch(); } }),
          select(kinds, sl.kind, (v) => { sl.kind = v; saveSch(); }),
          h('input', { class: 'input', style: { flex: 1 }, value: sl.label, onchange: (e) => { sl.label = e.target.value; saveSch(); } }),
          h('button', { class: 'icon-btn', title: 'Usuń blok', onclick: () => { s.schedule.splice(i, 1); saveSch().then(render); }, html: icon('x', 13) }))),
        h('button', { class: 'btn plain sm', onclick: () => { const last = s.schedule[s.schedule.length - 1]; s.schedule.push({ start: last ? last.end : '08:00', end: last ? last.end : '09:00', kind: 'activity', label: 'Zajęcia w pracowni' }); saveSch().then(render); } }, iconEl('plus', 12), 'Dodaj blok')),
      h('p', { class: 'group-footer' }, 'Bloki „Zajęcia w pracowni” wypełnia bank zajęć danej pracowni, „Zajęcia ogólne” – profil Umiejętności ogólne, a „Stały punkt dnia” to tekst bez zmian (np. przerwa, posiłek).')),
    group('Planowanie', [
      row('Pomijaj dni ustawowo wolne od pracy', toggle(s.planning.skipHolidays !== false, (v) => saveSettings({ planning: { skipHolidays: v } }, true)), { icon: 'calendar', color: 'var(--red)' }),
      row('Praca indywidualna w planach', toggle(s.planning.individual !== false, (v) => saveSettings({ planning: { individual: v } }, true)), { icon: 'person', color: 'var(--accent)', hint: 'Dla każdego uczestnika wskazuje umiejętność z danych zajęć, w której ma najniższy poziom.' })
    ]),
    h('section', { class: 'group' }, h('div', { class: 'group-row' }, h('h3', { class: 'group-title' }, 'Tematy przewodnie miesięcy (kolejne tygodnie)'), h('div', { class: 'spacer' }), reset('themes', 'tematy')),
      h('div', { class: 'group-body themes-grid' }, MONTHS.map((m, i) => field(cap(m), autoGrow(h('textarea', { class: 'input', rows: 2, value: (s.themes[i] || []).join('\n'), onchange: (e) => { s.themes[i] = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); saveSettings({ themes: s.themes }, true); } }))))),
      h('p', { class: 'group-footer' }, 'Każdy temat w osobnej linii – pierwszy dotyczy pierwszego tygodnia miesiąca, drugi drugiego itd. Temat możesz zawsze zmienić w planie.')));
}

init().catch((e) => { document.getElementById('content').textContent = 'Błąd uruchamiania: ' + e.message; });
