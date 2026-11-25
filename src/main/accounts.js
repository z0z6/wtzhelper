'use strict';
// Połączenie z kontami AI przez oficjalne programy producentów:
// instalacja jednym kliknięciem (za zgodą użytkownika), logowanie na stronie producenta
// w przeglądarce, sprawdzanie stanu, wylogowanie. Aplikacja nie widzi ani nie przechowuje
// haseł ani tokenów – logowanie i sesję obsługuje wyłącznie oficjalny program.
//
//  codex        – `codex login` (przeglądarka) lub `codex login --device-auth` (kod na stronie)
//  gemini       – Antigravity CLI loguje się przy pierwszym zapytaniu; robimy to w oknie terminala
//  claude-code  – `claude auth login --claudeai` (przeglądarka, ewentualnie kod do wklejenia)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFS, stripAnsi, readCodexPlan, claudePlan, geminiPlanFromModels } = require('./ai/providers');
const tools = require('./ai/cli-tools');

const LOGIN_TIMEOUT = 10 * 60 * 1000;
const GEMINI_HELLO = 'Odpowiedz jednym slowem: Polaczono';

class Accounts {
  constructor({ getSettings, emit, onConnected, onDisconnected, onPlan }) {
    this.getSettings = getSettings;
    this.onPlan = onPlan || (() => {});
    this.emit = emit;
    this.onConnected = onConnected || (() => {});
    this.onDisconnected = onDisconnected || (() => {});
    this.logins = {};
  }

  customPath(id) {
    const ai = this.getSettings().ai;
    return (ai.paths && ai.paths[id]) || (id === 'claude-code' ? ai.claudePath : '') || '';
  }

  bin(id) { return tools.findBinary(DEFS[id], this.customPath(id)); }

  // ─────────── stan ───────────
  async status(id) {
    const def = DEFS[id];
    if (!def) throw new Error('Nieznane konto: ' + id);
    let bin = this.bin(id);
    if (!bin) { tools.refreshPath(); bin = this.bin(id); } // np. zainstalowany ręcznie w terminalu
    const base = { id, installed: !!bin, path: bin, loggedIn: false, loggingIn: !!this.logins[id] };
    if (!bin) return base;
    const v = await tools.run(bin, ['--version'], { timeoutMs: 20000 });
    base.version = stripAnsi(v.out || v.err).trim().split('\n')[0] || null;
    if (id === 'claude-code') {
      const s = await tools.run(bin, ['auth', 'status', '--json'], { timeoutMs: 20000 });
      let info = {};
      try { info = JSON.parse(s.out); } catch (_) { /* starsza wersja bez JSON */ }
      const plan = info.loggedIn ? claudePlan(info) : null;
      if (plan) this.onPlan(id, plan);
      return this.withPlan({
        ...base,
        loggedIn: !!info.loggedIn,
        email: info.email || (info.account && info.account.email) || info.emailAddress || null
      }, plan);
    }
    if (id === 'codex') {
      const s = await tools.run(bin, ['login', 'status'], { timeoutMs: 20000 });
      const txt = stripAnsi(s.out + '\n' + s.err);
      const m = txt.match(/Logged in using ([^\n.]+)/i);
      const loggedIn = s.code === 0 && !/not logged in/i.test(txt);
      const apiKey = !!(m && /api key/i.test(m[1]));
      const plan = loggedIn && !apiKey ? readCodexPlan() : null;
      if (plan) this.onPlan(id, plan);
      return this.withPlan({ ...base, loggedIn, method: m ? m[1].trim() : null }, plan);
    }
    // gemini: Antigravity CLI nie ma polecenia „status” – opieramy się na udanym połączeniu
    // zapamiętanym w ustawieniach oraz na obecności zapisanego logowania.
    const connected = !!(this.getSettings().ai.connected || {}).gemini;
    const loggedIn = connected || this.geminiCredentialHint();
    let plan = null;
    if (loggedIn) {
      // `agy models` – lista modeli dostępnych dla konta; modele planu Google AI Pro = płatny plan
      const ms = await tools.run(bin, ['models'], { timeoutMs: 20000 });
      plan = ms.code === 0 ? geminiPlanFromModels(ms.out) : null;
      if (plan) this.onPlan(id, { tier: plan.tier, plan: plan.plan });
    }
    return this.withPlan({ ...base, loggedIn, models: plan ? plan.models : [] }, plan);
  }

  // Dołącza do stanu wykryty plan oraz ewentualne ręczne ustawienie użytkownika.
  withPlan(st, plan) {
    const ai = this.getSettings().ai;
    const saved = (ai.detected || {})[st.id] || null;
    const detected = plan || saved;
    const override = (ai.plans || {})[st.id];
    st.detectedTier = detected ? detected.tier : null;
    st.planName = detected ? detected.plan : null;
    st.tier = override === 'free' || override === 'paid' ? override : st.detectedTier || (st.id === 'claude-code' ? 'paid' : 'free');
    st.planManual = override === 'free' || override === 'paid';
    return st;
  }

  geminiCredentialHint() {
    try {
      if (process.platform === 'linux') return fs.existsSync(path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token'));
    } catch (_) { /* brak */ }
    return false;
  }

  // ─────────── instalacja ───────────
  async install(id) {
    const def = DEFS[id];
    const log = (text) => this.emit('account:log', { id, text });
    log(`Instaluję ${def.program} (${def.vendor}) z oficjalnego instalatora…\n`);
    const code = await tools.install(def, log);
    const st = await this.status(id);
    if (st.installed) return st;
    throw new Error(`Instalacja ${def.program} nie powiodła się (kod ${code}). Sprawdź połączenie z internetem i spróbuj ponownie – albo wybierz „Poprowadź mnie krok po kroku”.`);
  }

  // ─────────── logowanie ───────────
  // mode: 'auto' (w aplikacji) | 'device' (kod na stronie – tylko ChatGPT) | 'terminal' (okno terminala)
  startLogin(id, mode = 'auto') {
    const def = DEFS[id];
    const bin = this.bin(id);
    if (!bin) throw new Error(`Najpierw zainstaluj ${def.program}.`);
    this.cancelLogin(id);
    const state = { id, mode, url: null, code: null, done: false, started: Date.now() };
    this.logins[id] = state;
    const send = (stage, extra = {}) => this.emit('account:login', { id, stage, mode, url: state.url, code: state.code, ...extra });

    if (id === 'gemini' || mode === 'terminal') {
      const command = id === 'gemini' ? [bin, '-p', GEMINI_HELLO]
        : id === 'codex' ? [bin, 'login'] : [bin, 'auth', 'login', '--claudeai'];
      const lines = id === 'gemini'
        ? ['WTZ Helper - logowanie do Google Gemini', '1. Za chwile otworzy sie przegladarka ze strona logowania Google.', '2. Zaloguj sie swoim kontem Google (Gmail) i zaakceptuj zgode.', '3. Jesli strona pokaze kod - skopiuj go i wklej tutaj, potem Enter.', '4. Gdy pojawi sie slowo "Polaczono", okno zamknie sie samo.']
        : [`WTZ Helper - logowanie do ${def.name}`, '1. Otworzy sie strona logowania w przegladarce.', '2. Zaloguj sie swoim kontem.', '3. Jesli strona pokaze kod - wklej go tutaj i nacisnij Enter.'];
      const t = tools.openTerminal({ title: `Logowanie - ${def.name}`, lines, command });
      state.marker = t.marker;
      send('terminal');
    } else {
      const args = id === 'codex' ? (mode === 'device' ? ['login', '--device-auth'] : ['login']) : ['auth', 'login', '--claudeai'];
      const child = tools.spawnBin(bin, args);
      state.child = child;
      let buf = '';
      const onData = (d) => {
        buf = (buf + stripAnsi(String(d))).slice(-20000);
        const url = (buf.match(/https:\/\/[^\s"'<>]+/g) || []).find((u) => /oauth|authorize|auth\.|device|login|activate/i.test(u));
        if (url && !state.url) { state.url = url.replace(/[).,]+$/, ''); send(mode === 'device' ? 'device' : 'url'); }
        const code = mode === 'device' && buf.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/);
        if (code && !state.code) { state.code = code[1]; send('device'); }
        if (id === 'claude-code' && /paste code/i.test(buf) && !state.askedCode) { state.askedCode = true; send('code'); }
        if (id === 'claude-code' && /(Max|Pro) (or|lub) (Pro|Max)|need claude (max|pro)|subscription required/i.test(buf) && !state.noPlan) {
          state.noPlan = true;
          this.cancelLogin(id);
          send('error', { error: 'To konto Claude nie ma płatnego planu Pro lub Max – darmowe konto Claude nie obejmuje programu Claude Code. Wypróbuj aplikację bezpłatnie z kontem ChatGPT lub Google Gemini albo z lokalnym modelem.' });
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (e) => { if (this.logins[id] === state) { this.cancelLogin(id); send('error', { error: e.message }); } });
      child.on('close', () => { state.closed = true; });
      send('start');
    }

    const poll = async () => {
      if (this.logins[id] !== state || state.done) return;
      let ok = false;
      let failed = null;
      if (id === 'gemini') {
        const m = tools.readMarker(state.marker);
        if (m === 0) ok = true;
        else if (m != null) failed = 'Logowanie do Google nie zakończyło się powodzeniem. Spróbuj ponownie – albo sprawdź, czy konto Google jest kontem prywatnym (Gmail).';
      } else {
        const st = await this.status(id).catch(() => null);
        ok = !!(st && st.loggedIn);
        if (!ok && state.marker && tools.readMarker(state.marker) != null && Date.now() - state.started > 5000) {
          const st2 = await this.status(id).catch(() => null);
          ok = !!(st2 && st2.loggedIn);
          if (!ok) failed = 'Logowanie zostało przerwane. Spróbuj ponownie.';
        }
      }
      if (ok) {
        state.done = true;
        this.cancelLogin(id);
        await this.onConnected(id);
        send('done', { status: await this.status(id) });
        return;
      }
      if (failed || Date.now() - state.started > LOGIN_TIMEOUT) {
        this.cancelLogin(id);
        send('error', { error: failed || 'Upłynął czas na zalogowanie. Spróbuj ponownie.' });
        return;
      }
      setTimeout(poll, id === 'gemini' ? 1500 : 2500);
    };
    setTimeout(poll, 2500);
    return { started: true, mode };
  }

  submitCode(id, code) {
    const L = this.logins[id];
    if (!L || !L.child || L.closed) throw new Error('Logowanie nie jest w toku – kliknij „Połącz” ponownie.');
    L.child.stdin.write(String(code).trim() + '\n');
    return true;
  }

  cancelLogin(id) {
    const L = this.logins[id];
    if (L && L.child) tools.killTree(L.child);
    delete this.logins[id];
  }

  cancelAll() { for (const id of Object.keys(this.logins)) this.cancelLogin(id); }

  async logout(id) {
    const bin = this.bin(id);
    if (bin && id === 'claude-code') await tools.run(bin, ['auth', 'logout'], { timeoutMs: 20000 });
    if (bin && id === 'codex') await tools.run(bin, ['logout'], { timeoutMs: 20000 });
    if (id === 'gemini' && process.platform === 'linux') {
      try { fs.rmSync(path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), { force: true }); } catch (_) { /* brak */ }
    }
    await this.onDisconnected(id);
    return this.status(id);
  }
}

module.exports = { Accounts };
