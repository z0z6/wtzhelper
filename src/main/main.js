'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage, protocol, session, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Store } = require('./store');
const { Accounts } = require('./accounts');
const { createProvider, providerChain, ACCOUNT_IDS, MODES, DEFS, findClaude } = require('./ai/providers');
const cliTools = require('./ai/cli-tools');
const ollama = require('./ai/ollama');
const { polishAssessment, proposeConclusions, proposePlan, proposeProfile, analyzeDocument, findLeaks } = require('./ai/tasks');
const DOC = require('./documents');
const X = require('./text');
const PL = require('./planner');
const AS = require('./assessment');
const { parsePeopleFile, textToPeople } = require('./import');
const { renderDocx, renderHtml, renderBody, FONT_FALLBACK } = require('./render');

app.setName('WTZ Helper');
app.commandLine.appendSwitch('lang', 'pl');
if (process.platform === 'win32') app.setAppUserModelId('pl.z0z6.wtzhelper');

// Wersja portable (Windows): dane obok pliku .exe
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
const dataDir = process.env.WTZ_DATA_DIR || (portableDir ? path.join(portableDir, 'WTZ Helper - dane') : path.join(app.getPath('userData'), 'dane'));

if (!app.requestSingleInstanceLock()) app.quit();

// Interfejs ładowany z własnego protokołu app:// (WASM i workery lokalnego OCR działają jak na stronie www).
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const RENDERER = path.join(__dirname, '..', 'renderer');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.gz': 'application/gzip' };
const scansDir = () => path.join(dataDir, 'skany');

function registerAppProtocol() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER)) return new Response('forbidden', { status: 403 });
    try {
      const buf = await fs.promises.readFile(file);
      return new Response(buf, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch (_) { return new Response('not found', { status: 404 }); }
  });
}

// Okno aplikacji nie ma dostępu do internetu – tylko lokalne pliki. Skany dokumentów nie mogą wyjść z komputera;
// połączenia z AI wykonuje wyłącznie proces główny, po kontroli strażnika prywatności.
function lockDownNetwork() {
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^(app|data|blob|devtools|file):/i.test(details.url) }));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
}

let win = null;
let store, accounts;
let pullAbort = null;

const secretsFile = () => path.join(dataDir, 'klucz.bin');
const uid = () => crypto.randomUUID();

function getApiKey() {
  try {
    const raw = fs.readFileSync(secretsFile());
    if (raw.slice(0, 4).toString() === 'b64:') return Buffer.from(raw.slice(4).toString(), 'base64').toString('utf8');
    return safeStorage.decryptString(raw);
  } catch (_) { return null; }
}

function setApiKey(key) {
  if (!key) { try { fs.unlinkSync(secretsFile()); } catch (_) { /* brak */ } return; }
  if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(secretsFile(), safeStorage.encryptString(key));
  else fs.writeFileSync(secretsFile(), 'b64:' + Buffer.from(key, 'utf8').toString('base64'));
}

function getProvider(id) { return createProvider(id || store.settings.ai.provider, store.settings, getApiKey); }

function setConnected(id, value) {
  const ai = store.settings.ai;
  const conn = ai.connected || {};
  const patch = { ai: { connected: { [id]: value } } };
  const currentOk = ai.provider === 'local' || (ai.provider === 'api' ? !!getApiKey() : ai.provider !== 'none' && !!conn[ai.provider]);
  if (value && ai.provider !== id && (ai.provider === 'none' || !currentOk)) patch.ai.provider = id;
  if (!value && ai.provider === id) patch.ai.provider = ACCOUNT_IDS.find((x) => x !== id && conn[x]) || 'none';
  store.updateSettings(patch);
}

function setDetectedPlan(id, plan) {
  const cur = (store.settings.ai.detected || {})[id] || {};
  if (cur.tier === plan.tier && cur.plan === plan.plan) return;
  store.updateSettings({ ai: { detected: { [id]: { tier: plan.tier, plan: plan.plan, at: new Date().toISOString() } } } });
}

// Łańcuch dostawców dla jednego zadania. Przed każdą wysyłką poza komputer strażnik prywatności
// sprawdza, czy w treści nie zostały dane osobowe któregokolwiek z uczestników.
function aiChain(persons) {
  const people = (Array.isArray(persons) ? persons : [persons]).filter(Boolean);
  const used = { label: null };
  return {
    used,
    async run(req) {
      let lastErr = null;
      for (const id of providerChain(store.settings.ai)) {
        const p = getProvider(id);
        if (!p.isLocal) {
          const text = `${req.system}\n${req.prompt}`;
          const leaks = [...new Set(people.flatMap((person) => findLeaks(text, person)))];
          if (leaks.length) throw new Error(`Strażnik prywatności zablokował wysyłkę: w tekście zostały dane osobowe (${leaks.join(', ')}). Usuń je z opisów lub notatek i spróbuj ponownie.`);
        }
        try {
          const r = await p.run(req);
          used.label = p.label;
          return r;
        } catch (e) {
          lastErr = e;
          if (e.code !== 'AI_LIMIT') throw e;
        }
      }
      throw lastErr || new Error('Nie wybrano sposobu pracy z AI.');
    }
  };
}

function localBase() { return (store.settings.ai.local && store.settings.ai.local.url) || ollama.DEFAULT_URL; }
function emit(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
function iconPath() { return path.join(__dirname, '..', 'assets', 'icon.png'); }

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 1060, minHeight: 680, show: false,
    frame: isMac, titleBarStyle: isMac ? 'hiddenInset' : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f7',
    icon: iconPath(),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  win.setMenuBarVisibility(false);
  try { win.webContents.session.setSpellCheckerLanguages(['pl']); } catch (_) { /* brak słownika */ }
  win.loadURL('app://local/index.html');
  win.once('ready-to-show', () => win.show());
  if (process.env.WTZ_SHOTS) {
    win.webContents.on('console-message', (...a) => { const e = a[0]; console.log('[renderer]', e && e.message ? e.message : a.slice(1).join(' ')); });
    win.webContents.once('did-finish-load', () => devScreenshots(process.env.WTZ_SHOTS));
  }
  win.on('maximize', () => emit('window:state', { maximized: true }));
  win.on('unmaximize', () => emit('window:state', { maximized: false }));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Tryb deweloperski: zrzuty ekranu (WTZ_SHOTS=katalog, WTZ_STEPS="nazwa=<JS>,…")
async function devScreenshots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  const steps = (process.env.WTZ_STEPS || 'start').split(',');
  await wait(1500);
  if (process.env.WTZ_TEST_FILE) await win.webContents.executeJavaScript(`window.__testB64=${JSON.stringify(fs.readFileSync(process.env.WTZ_TEST_FILE).toString('base64'))}`);
  for (const step of steps) {
    const i = step.indexOf('=');
    const name = i < 0 ? step : step.slice(0, i);
    const js = i < 0 ? '' : step.slice(i + 1);
    if (js) await win.webContents.executeJavaScript(decodeURIComponent(js)).catch((e) => console.error(e));
    await wait(900);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
  }
  app.quit();
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ─────────────────────────── dane pomocnicze ───────────────────────────

function must(kind, id) {
  const x = store.get(kind, id);
  if (!x) throw new Error({ plans: 'Nie znaleziono planu.', assessments: 'Nie znaleziono oceny.', participants: 'Nie znaleziono uczestnika.' }[kind]);
  return x;
}
const workshopOf = (id) => { const w = store.workshop(id); if (!w) throw new Error('Nie znaleziono pracowni – mogła zostać usunięta z profili.'); return w; };
const groupOf = (workshopId) => store.list('participants').filter((p) => p.workshopId === workshopId && p.active !== false);

function planCtx(plan) {
  const workshop = workshopOf(plan.workshopId);
  const general = store.general();
  const participants = plan.participantIds.map((id) => store.get('participants', id)).filter(Boolean);
  return { workshop, general: general && general.id !== workshop.id ? general : null, participants, settings: store.settings };
}

function assessCtx(a) {
  const person = must('participants', a.participantId);
  return { workshops: store.workshops, marks: store.data.marks, settings: store.settings, person };
}

function planListItem(pl) {
  const w = store.workshop(pl.workshopId);
  return { id: pl.id, type: pl.type, from: pl.from, to: pl.to, theme: pl.theme, workshop: w ? w.name : '(usunięta pracownia)', workshopId: pl.workshopId, days: pl.days.length, updatedAt: pl.updatedAt };
}

function assessListItem(a) {
  const p = store.get('participants', a.participantId);
  return { id: a.id, type: a.type, from: a.from, to: a.to, date: a.date, participantId: a.participantId, name: p ? X.fullName(p) : '(usunięty uczestnik)', updatedAt: a.updatedAt };
}

async function htmlToPdf(html) {
  const tmp = path.join(app.getPath('temp'), `wtzhelper-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await w.loadFile(tmp);
    return await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  } finally {
    w.destroy();
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

async function exportModel(model, base, format, title) {
  const ext = format === 'pdf' ? 'pdf' : 'docx';
  let target;
  if (process.env.WTZ_EXPORT_DIR) {
    fs.mkdirSync(process.env.WTZ_EXPORT_DIR, { recursive: true });
    target = path.join(process.env.WTZ_EXPORT_DIR, `${base}.${ext}`);
  } else {
    const last = store.data.lastExportDir;
    const dir = last && fs.existsSync(last) ? last : app.getPath('documents');
    const save = await dialog.showSaveDialog(win, {
      title: ext === 'pdf' ? 'Zapisz jako PDF' : 'Zapisz jako dokument Word',
      defaultPath: path.join(dir, `${base}.${ext}`),
      filters: [ext === 'pdf' ? { name: 'Dokument PDF', extensions: ['pdf'] } : { name: 'Dokument Word', extensions: ['docx'] }]
    });
    if (save.canceled || !save.filePath) return null;
    target = save.filePath;
    store.data.lastExportDir = path.dirname(target);
    store.save();
  }
  const buffer = ext === 'pdf' ? await htmlToPdf(renderHtml(model, { title })) : await renderDocx(model, { title, author: store.settings.profile.name });
  try { fs.writeFileSync(target, buffer); } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') throw new Error('Nie można zapisać pliku – zamknij go w innym programie i spróbuj ponownie.');
    throw e;
  }
  return { path: target };
}

const preview = (model) => ({ html: renderBody(model), format: model.format, fontCss: FONT_FALLBACK[model.format.font] || 'serif' });

function planModel(plan) {
  const c = planCtx(plan);
  return PL.buildPlanModel(plan, { ...c, participants: store.list('participants'), scale: store.settings.scale });
}

// ─────────────────────────── IPC ───────────────────────────

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir, portable: !!portableDir, refStyles: Object.entries(X.REF_STYLES).map(([value, v]) => ({ value, label: v.label })), iprStatus: AS.IPR_STATUS, today: X.today(), codes: DOC.CODES, docTypes: DOC.DOC_TYPES, adapt: DOC.ADAPT, degreeAdapt: DOC.DEGREE_ADAPT }));

  handle('window:control', (action) => {
    if (!win) return false;
    if (action === 'close') { win.close(); return false; }
    if (action === 'minimize') { win.minimize(); return win.isMaximized(); }
    if (action === 'maximize') { const target = !win.isMaximized(); if (target) win.maximize(); else win.unmaximize(); return target; }
    return win.isMaximized();
  });

  handle('settings:get', () => ({ settings: store.settings, hasApiKey: !!getApiKey(), claudePath: findClaude(store.settings.ai.claudePath) }));
  handle('settings:set', (patch) => {
    const s = store.updateSettings(patch);
    if (patch && patch.ui && patch.ui.theme) nativeTheme.themeSource = patch.ui.theme;
    return s;
  });
  handle('settings:resetPart', (key) => {
    const D = require('./store');
    const map = { scale: D.SCALE, phrases: D.PHRASES, stances: D.STANCES, schedule: D.SCHEDULE, themes: D.THEMES };
    if (!map[key]) throw new Error('Nieznana część ustawień.');
    store.data.settings[key] = JSON.parse(JSON.stringify(map[key]));
    store.save();
    return store.settings;
  });
  handle('apikey:set', (key) => { setApiKey((key || '').trim()); return !!getApiKey(); });

  // ── AI: sposób pracy ──
  handle('ai:mode', (mode) => {
    if (!MODES.includes(mode)) throw new Error('Nieznany sposób pracy z AI.');
    return store.updateSettings({ ai: { provider: mode } });
  });
  handle('ai:test', async (id) => {
    const target = id || store.settings.ai.provider;
    const r = await getProvider(target).test();
    if (ACCOUNT_IDS.includes(target) && !(store.settings.ai.connected || {})[target]) setConnected(target, true);
    return r;
  });

  // ── konta AI ──
  const accId = (id) => { if (!ACCOUNT_IDS.includes(id)) throw new Error('Nieznane konto AI.'); return id; };
  handle('account:status', (id) => accounts.status(accId(id)));
  handle('account:install', (id) => accounts.install(accId(id)));
  handle('account:login', (id, mode) => accounts.startLogin(accId(id), mode));
  handle('account:code', (id, code) => accounts.submitCode(accId(id), code));
  handle('account:cancel', (id) => { accounts.cancelLogin(accId(id)); return true; });
  handle('account:logout', (id) => accounts.logout(accId(id)));
  handle('account:plan', (id, value) => {
    accId(id);
    if (!['auto', 'free', 'paid'].includes(value)) throw new Error('Nieznany plan.');
    store.updateSettings({ ai: { plans: { [id]: value } } });
    return accounts.status(id);
  });
  handle('account:browse', async (id) => {
    accId(id);
    const r = await dialog.showOpenDialog(win, { title: `Wskaż program ${DEFS[id].program}`, properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.updateSettings({ ai: { paths: { [id]: r.filePaths[0] } } });
    return accounts.status(id);
  });

  // ── lokalny model (Ollama) ──
  handle('local:status', () => ollama.status(localBase(), (store.settings.ai.paths || {}).local));
  handle('local:start', async () => { await ollama.start(localBase(), (store.settings.ai.paths || {}).local); return ollama.status(localBase()); });
  handle('local:install', async () => {
    const r = await ollama.install((text) => emit('local:log', text));
    if (!r.terminal) cliTools.refreshPath();
    return { ...r, status: await ollama.status(localBase()) };
  });
  handle('local:pull', async (model) => {
    const name = String(model || '').trim();
    if (!name) throw new Error('Podaj nazwę modelu.');
    if (ollama.isCloudModel(name)) throw new Error('To model chmurowy Ollama – aplikacja korzysta tylko z modeli działających na tym komputerze.');
    if (pullAbort) throw new Error('Trwa już pobieranie modelu.');
    pullAbort = new AbortController();
    try { await ollama.pull(localBase(), name, (p) => emit('local:pull', { model: name, ...p }), pullAbort.signal); } finally { pullAbort = null; }
    const st = await ollama.status(localBase());
    const ai = store.settings.ai;
    if (!ai.local.model || !st.models.some((m) => m.name === ai.local.model)) store.updateSettings({ ai: { local: { model: name } } });
    return st;
  });
  handle('local:cancelPull', () => { if (pullAbort) pullAbort.abort(); return true; });
  handle('local:browse', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Wskaż program Ollama', properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.updateSettings({ ai: { paths: { local: r.filePaths[0] } } });
    return ollama.status(localBase(), r.filePaths[0]);
  });

  // ── pracownie (profile) ──
  handle('workshops:get', () => store.workshops);
  handle('workshops:set', (list) => {
    if (!Array.isArray(list)) throw new Error('Nieprawidłowe dane pracowni.');
    return store.setWorkshops(list);
  });
  handle('workshops:reset', () => store.resetWorkshops());
  handle('workshops:export', async (ids) => {
    const list = store.workshops.filter((w) => !ids || ids.includes(w.id));
    const name = list.length === 1 ? `Profil - ${X.safeFile(list[0].name)}.json` : 'Profile pracowni WTZ.json';
    const save = await dialog.showSaveDialog(win, { title: 'Zapisz profile pracowni', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'Profile pracowni', extensions: ['json'] }] });
    if (save.canceled || !save.filePath) return null;
    fs.writeFileSync(save.filePath, JSON.stringify({ wtzhelper: 'pracownie', version: 1, workshops: list }, null, 2), 'utf8');
    return { path: save.filePath };
  });
  handle('workshops:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Wczytaj profile pracowni', filters: [{ name: 'Profile pracowni', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    let j;
    try { j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (_) { throw new Error('Plik nie jest poprawnym plikiem profili pracowni (JSON).'); }
    const incoming = Array.isArray(j) ? j : j.workshops;
    if (!Array.isArray(incoming) || !incoming.every((w) => w && w.name && Array.isArray(w.areas) && Array.isArray(w.activities))) throw new Error('W pliku nie ma profili pracowni.');
    const list = store.workshops;
    let added = 0, replaced = 0;
    for (const w of incoming) {
      const i = list.findIndex((x) => x.id === w.id);
      if (i >= 0) { list[i] = w; replaced++; } else { list.push(w); added++; }
    }
    store.setWorkshops(list);
    return { added, replaced, workshops: list };
  });

  // ── uczestnicy ──
  handle('participants:list', () => store.list('participants'));
  handle('participants:save', (p) => {
    if (!p || !p.id) throw new Error('Nieprawidłowe dane uczestnika.');
    return store.put('participants', p);
  });
  handle('participants:remove', (id) => {
    store.remove('participants', id);
    try { fs.rmSync(path.join(scansDir(), path.basename(id)), { recursive: true, force: true }); } catch (_) { /* brak */ }
    return true;
  });
  handle('participants:importFile', async (workshopId) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Wybierz plik z listą uczestników',
      filters: [{ name: 'Dane osób', extensions: ['xlsx', 'csv', 'txt', 'tsv', 'xml', 'xls', 'html', 'htm'] }, { name: 'Wszystkie pliki', extensions: ['*'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const people = await parsePeopleFile(fs.readFileSync(r.filePaths[0]));
    return { ...store.mergeParticipants(people, { workshopId }), file: path.basename(r.filePaths[0]) };
  });
  handle('participants:importText', (text, workshopId) => {
    if (!String(text || '').trim()) throw new Error('Wklej najpierw skopiowaną tabelę.');
    const people = textToPeople(String(text));
    if (!people.length) throw new Error('We wklejonym tekście nie znalazłem żadnej osoby z imieniem i nazwiskiem.');
    return store.mergeParticipants(people, { workshopId });
  });

  // ── oceny cząstkowe ──
  handle('marks:get', (q) => store.marksFor(q || {}));
  handle('marks:set', (entries) => {
    if (!Array.isArray(entries)) throw new Error('Nieprawidłowe oceny.');
    return store.setMarks(entries, uid);
  });

  // ── plany pracy ──
  handle('plans:list', () => store.list('plans').map(planListItem));
  handle('plans:get', (id) => must('plans', id));
  handle('plans:create', ({ type, workshopId, date, theme }) => {
    const workshop = workshopOf(workshopId);
    const general = store.general();
    const participants = groupOf(workshopId);
    const plan = PL.generatePlan({ id: uid(), type, start: date, workshop, general: general && general.id !== workshop.id ? general : null, participants, marks: store.data.marks, settings: store.settings, seed: Math.floor(Math.random() * 1e9), theme });
    return store.put('plans', plan);
  });
  // refresh = zmieniono zajęcia w blokach: odśwież pracę indywidualną (najsłabsza umiejętność każdego uczestnika)
  handle('plans:save', (plan, refresh) => {
    if (!plan || !plan.id) throw new Error('Nieprawidłowe dane planu.');
    if (refresh) {
      const ctx = PL.makeCtx({ ...planCtx(plan), marks: store.data.marks, until: plan.to });
      for (const d of plan.days) for (const b of d.blocks) if (b.kind === 'activity') b.individual = PL.individualFor(ctx, b.skills || [], b.title);
    }
    return store.put('plans', plan);
  });
  // date = tylko ten dzień; bez daty = cały plan (zachowuje tematy i uwagi)
  handle('plans:regenerate', (id, date) => {
    const plan = must('plans', id);
    const c = planCtx(plan);
    c.participants = groupOf(plan.workshopId);
    plan.participantIds = c.participants.map((p) => p.id);
    const ctx = PL.makeCtx({ ...c, marks: store.data.marks, until: plan.to });
    const seed = Math.floor(Math.random() * 1e9);
    if (date) PL.regenerateDay(plan, date, ctx, seed);
    else { PL.fillDays(plan, plan.days.map((d) => d.date), ctx, seed); plan.goals = PL.autoGoals(plan, ctx); }
    return store.put('plans', plan);
  });
  handle('plans:duplicate', (id) => {
    const copy = JSON.parse(JSON.stringify(must('plans', id)));
    copy.id = uid(); copy.createdAt = null;
    return store.put('plans', copy);
  });
  handle('plans:remove', (id) => { store.remove('plans', id); return true; });
  handle('plans:validate', (id) => { const plan = must('plans', id); const c = planCtx(plan); return PL.validatePlan(plan, c.workshop, c.general); });
  handle('plans:preview', (id) => preview(planModel(must('plans', id))));
  handle('plans:export', (id, format) => {
    const plan = must('plans', id);
    const title = PL.planTitle(plan, store.workshop(plan.workshopId));
    return exportModel(planModel(plan), X.safeFile(title), format, title);
  });

  // ── oceny okresowe i kompleksowe ──
  handle('assessments:list', () => store.list('assessments').map(assessListItem));
  handle('assessments:get', (id) => must('assessments', id));
  handle('assessments:create', ({ type, participantId, date }) => {
    const participant = must('participants', participantId);
    const a = AS.newAssessment(uid(), { type, participant, date: date || X.today(), workshops: store.workshops });
    AS.refreshAuto(a, assessCtx(a));
    return store.put('assessments', a);
  });
  handle('assessments:save', (a, refresh) => {
    if (!a || !a.id) throw new Error('Nieprawidłowe dane oceny.');
    if (refresh) AS.refreshAuto(a, assessCtx(a));
    return store.put('assessments', a);
  });
  handle('assessments:stats', (id) => { const a = must('assessments', id); return AS.computeStats(a, assessCtx(a)); });
  handle('assessments:duplicate', (id) => {
    const copy = JSON.parse(JSON.stringify(must('assessments', id)));
    copy.id = uid(); copy.createdAt = null;
    return store.put('assessments', copy);
  });
  handle('assessments:remove', (id) => { store.remove('assessments', id); return true; });
  handle('assessments:preview', (id) => { const a = must('assessments', id); return preview(AS.buildAssessmentModel(a, assessCtx(a))); });
  handle('assessments:export', (id, format) => {
    const a = must('assessments', id);
    const c = assessCtx(a);
    const title = AS.assessmentTitle(a, c.person);
    return exportModel(AS.buildAssessmentModel(a, c), X.safeFile(title), format, title);
  });

  // ── AI ──
  handle('ai:polishAssessment', async (id) => {
    const a = must('assessments', id);
    const c = assessCtx(a);
    const items = AS.workshopsOf(a, store.workshops).flatMap((w) => w.areas).filter((ar) => a.sections[ar.id] && String(a.sections[ar.id].text || '').trim()).map((ar) => ({ id: ar.id, name: ar.name, text: a.sections[ar.id].text }));
    const chain = aiChain(c.person);
    const out = await polishAssessment(chain, { items, person: c.person, refName: X.refName(c.person), type: a.type, notes: a.notes });
    return { items: out, provider: chain.used.label };
  });
  handle('ai:conclusions', async (id) => {
    const a = must('assessments', id);
    const c = assessCtx(a);
    const sections = AS.workshopsOf(a, store.workshops).flatMap((w) => w.areas.map((ar) => ({ name: `${w.general ? 'Obszary ogólne' : w.name} – ${ar.name}`, text: (a.sections[ar.id] || {}).text || '' }))).filter((s) => String(s.text).trim());
    const ipr = (c.person.iprGoals || []).filter((g) => g.text).map((g) => ({ text: g.text, status: ((AS.IPR_STATUS.find((x) => x.value === (a.ipr[g.id] || {}).status)) || {}).label }));
    const stance = a.type === 'complex' && a.stance ? ((store.settings.stances.find((s) => s.id === a.stance.option) || {}).label || '') : '';
    const chain = aiChain(c.person);
    const r = await proposeConclusions(chain, { sections, person: c.person, refName: X.refName(c.person), type: a.type, ipr, stance, notes: a.notes, disability: DOC.describeDisability(c.person.disability) });
    return { ...r, provider: chain.used.label };
  });
  handle('ai:plan', async (id) => {
    const plan = must('plans', id);
    const c = planCtx(plan);
    const ctx = PL.makeCtx({ ...c, marks: store.data.marks, until: plan.to });
    const needs = PL.allSkills(c.workshop).map((s) => s).sort((x, y) => (ctx.need.get(y.id) || 3) - (ctx.need.get(x.id) || 3)).slice(0, 5).map((s) => s.name);
    const chain = aiChain(store.list('participants'));
    const group = c.participants.map((p, i) => { const d = DOC.describeDisability(p.disability); return d ? `uczestnik ${i + 1}: ${d}` : ''; }).filter(Boolean);
    const out = await proposePlan(chain, { workshop: c.workshop, general: c.general, plan, needs, group });
    return { blocks: out, provider: chain.used.label };
  });
  handle('ai:profile', async ({ name, description }) => {
    const chain = aiChain(store.list('participants'));
    const r = await proposeProfile(chain, { name, description });
    return { ...r, provider: chain.used.label };
  });

  // ── dokumenty uczestników (OCR w oknie, odczyt i pseudonimizacja tutaj) ──
  // do pseudonimizacji: wszyscy uczestnicy (także ten, którego dotyczy dokument), terapeuci i prowadzący
  const others = () => [...store.list('participants'), { name: store.settings.profile.name }, ...store.workshops.map((w) => ({ name: w.instructor }))];
  const skillsFor = (p) => [store.workshop(p && p.workshopId), store.general()].filter(Boolean).flatMap((w) => PL.allSkills(w));
  handle('clipboard:image', () => {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) throw new Error('W schowku nie ma obrazu. Zrób zrzut ekranu (np. Win+Shift+S lub PrtSc) i spróbuj ponownie.');
    return img.toPNG().toString('base64');
  });
  handle('docs:parse', (type, text, participantId) => {
    if (!DOC.DOC_TYPES[type]) throw new Error('Nieznany rodzaj dokumentu.');
    const p = participantId ? must('participants', participantId) : null;
    const workshop = p ? store.workshop(p.workshopId) : null;
    const skills = p ? skillsFor(p) : PL.allSkills(store.general());
    return { ...DOC.parseDocument(type, String(text || ''), { skills }), workshopId: workshop ? workshop.id : '' };
  });
  // person = dane z formularza (także dla nowego uczestnika); wynik = tekst dla AI + stan strażnika
  handle('docs:anonymize', (text, person, participantId) => {
    const r = DOC.pseudonymize(text, person, others(participantId));
    return { ...r, leaks: DOC.findLeaks(r.text, person, others(participantId)) };
  });
  handle('docs:guard', (text, person, participantId) => DOC.findLeaks(text, person, others(participantId)));
  // zapis dokumentu w karcie uczestnika (nowego albo istniejącego) + uzupełnienie danych
  handle('docs:save', ({ participantId, personal, disability, doc, scans, overwrite }) => {
    let p = participantId ? must('participants', participantId) : null;
    if (!p) {
      if (!personal || !personal.firstName || !personal.lastName) throw new Error('Uzupełnij imię i nazwisko uczestnika.');
      p = { id: uid(), firstName: '', lastName: '', gender: 'm', birthDate: '', pesel: '', address: '', refStyle: 'imie', workshopId: personal.workshopId || '', admission: '', iprGoals: [], notes: '', active: true };
    }
    for (const k of ['firstName', 'lastName', 'gender', 'birthDate', 'pesel', 'address']) {
      const v = personal && String(personal[k] || '').trim();
      if (v && (overwrite || !p[k] || !participantId)) p[k] = v;
    }
    if (personal && personal.workshopId && (overwrite || !p.workshopId)) p.workshopId = personal.workshopId;
    if (disability) {
      const cur = p.disability || DOC.emptyDisability();
      const d = { ...cur };
      for (const k of ['degree', 'number', 'issued', 'validUntil', 'therapy']) if (disability[k] && (overwrite || !cur[k])) d[k] = disability[k];
      if ((disability.codes || []).length && (overwrite || !(cur.codes || []).length)) d.codes = disability.codes;
      p.disability = d;
      if (!(p.adaptations || []).length) p.adaptations = DOC.localAdaptations(d);
    }
    const docId = uid();
    const files = [];
    if (Array.isArray(scans) && scans.length) {
      const dir = path.join(scansDir(), path.basename(p.id));
      fs.mkdirSync(dir, { recursive: true });
      scans.forEach((b64, i) => { const f = `${docId}-${i + 1}.jpg`; fs.writeFileSync(path.join(dir, f), Buffer.from(String(b64), 'base64')); files.push(f); });
    }
    p.documents = p.documents || [];
    if (doc) p.documents.unshift({ id: docId, type: doc.type, name: doc.name || DOC.DOC_TYPES[doc.type], date: doc.date || '', addedAt: new Date().toISOString(), text: doc.text || '', anonText: doc.anonText || '', scans: files, analysis: null });
    store.put('participants', p);
    return { participant: p, docId };
  });
  handle('docs:analyze', async (participantId, docId, anonText) => {
    const p = must('participants', participantId);
    const d = (p.documents || []).find((x) => x.id === docId);
    if (!d) throw new Error('Nie znaleziono dokumentu.');
    if (typeof anonText === 'string') d.anonText = anonText;
    const leaks = DOC.findLeaks(d.anonText, p, others(p.id));
    if (leaks.length) throw new Error(`Strażnik prywatności zablokował wysyłkę: w tekście dla AI zostały dane osobowe (${leaks.join(', ')}). Popraw tekst w podglądzie i spróbuj ponownie.`);
    const w = store.workshop(p.workshopId);
    const chain = aiChain([p, ...store.list('participants').filter((x) => x.id !== p.id)]);
    const r = await analyzeDocument(chain, { type: d.type, text: d.anonText, skills: skillsFor(p), scale: store.settings.scale, workshop: w ? w.name : '', disability: DOC.describeDisability(p.disability) });
    d.analysis = { ...r, provider: chain.used.label, at: new Date().toISOString() };
    store.put('participants', p);
    return d.analysis;
  });
  // przyjęcie wyników analizy: dostosowania, cele IPR, oceny wyjściowe, orzeczenie
  handle('docs:apply', (participantId, { adaptations = [], goals = [], marks = [], date, disability }) => {
    const p = must('participants', participantId);
    p.adaptations = [...(p.adaptations || [])];
    for (const a of adaptations) if (a && !p.adaptations.includes(a)) p.adaptations.push(a);
    p.iprGoals = [...(p.iprGoals || [])];
    for (const g of goals) if (g && !p.iprGoals.some((x) => x.text === g)) p.iprGoals.push({ id: 'c-' + uid().slice(0, 8), text: g });
    if (disability) {
      const cur = p.disability || DOC.emptyDisability();
      p.disability = { ...cur, degree: cur.degree || disability.degree || '', codes: (cur.codes || []).length ? cur.codes : (disability.codes || []) };
    }
    store.put('participants', p);
    let n = 0;
    if (marks.length) {
      if (!date) throw new Error('Podaj datę ocen wyjściowych.');
      n = store.setMarks(marks.map((m) => ({ participantId: p.id, workshopId: p.workshopId || '', skillId: m.skillId, date, level: m.level })), uid);
    }
    return { participant: p, marks: n };
  });
  handle('docs:remove', (participantId, docId) => {
    const p = must('participants', participantId);
    const d = (p.documents || []).find((x) => x.id === docId);
    for (const f of (d && d.scans) || []) { try { fs.unlinkSync(path.join(scansDir(), path.basename(p.id), path.basename(f))); } catch (_) { /* brak */ } }
    p.documents = (p.documents || []).filter((x) => x.id !== docId);
    return store.put('participants', p);
  });
  handle('docs:openScan', (participantId, file) => shell.openPath(path.join(scansDir(), path.basename(participantId), path.basename(file))));

  handle('shell:showFile', (p) => shell.showItemInFolder(p));
  handle('shell:openFile', (p) => shell.openPath(p));
  handle('shell:openExternal', (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
}

app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  registerAppProtocol();
  lockDownNetwork();
  store = new Store(dataDir);
  nativeTheme.themeSource = store.settings.ui.theme || 'system';
  cliTools.refreshPath();
  accounts = new Accounts({
    getSettings: () => store.settings,
    emit,
    onConnected: (id) => setConnected(id, true),
    onDisconnected: (id) => setConnected(id, false),
    onPlan: setDetectedPlan
  });
  registerIpc();
  createWindow();
  app.on('activate', showWindow);
});

app.on('before-quit', () => {
  if (accounts) accounts.cancelAll();
  if (pullAbort) pullAbort.abort();
  cliTools.killAll();
});
app.on('window-all-closed', () => app.quit());
