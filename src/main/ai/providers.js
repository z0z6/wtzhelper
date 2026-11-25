'use strict';
// Sposoby korzystania z AI w WTZ Helper. Plany i oceny z profili pracowni działają zawsze – AI tylko pomaga w redakcji.
//
//  "none"        – Bez AI: same gotowe opisy, nic nie jest nigdzie wysyłane.
//  "local"       – Lokalny model (Ollama) na tym komputerze: bezpłatnie, bez limitów, tekst nie opuszcza komputera.
//  Konta (logowanie w przeglądarce, bez kluczy i bez wyciągania tokenów – zapytania wykonuje oficjalny program):
//  "codex"       – ChatGPT (OpenAI) przez Codex CLI; działa na darmowym koncie ChatGPT, płatny plan = większe limity.
//  "gemini"      – Google Gemini przez Antigravity CLI (`agy`); darmowe konto Google, Google AI Pro/Ultra = mocniejsze modele.
//  "claude-code" – Claude (Anthropic) przez Claude Code; wymaga płatnego planu Pro/Max.
//  "api"         – klucz API Claude (rozliczany za zużycie) – opcja zaawansowana, nigdy nie jest używany automatycznie.
//
// Zasada planów: domyślnie aplikacja korzysta z darmowego planu konta (domyślny model konta, darmowy limit).
// Dopiero gdy konto ma płatny plan (wykryty albo zaznaczony ręcznie), aplikacja używa wybranych mocniejszych
// modeli – wtedy zapytania zużywają limit Twojego opłaconego planu.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findBinary, run } = require('./cli-tools');
const ollama = require('./ollama');

const TIMEOUT = 8 * 60 * 1000;

// Definicje programów: polecenie, oficjalny instalator, typowe miejsca instalacji.
const DEFS = {
  codex: {
    id: 'codex', cmd: 'codex', name: 'ChatGPT', vendor: 'OpenAI', program: 'Codex CLI',
    install: { win: 'irm https://chatgpt.com/codex/install.ps1 | iex', unix: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' },
    winPaths: ['{HOME}/.local/bin/codex.exe', '{LOCALAPPDATA}/Programs/OpenAI/Codex/bin/codex.exe', '{LOCALAPPDATA}/OpenAI/Codex/bin/codex.exe', '{HOME}/.codex/bin/codex.exe', '{APPDATA}/npm/codex.cmd'],
    unixPaths: ['{HOME}/.local/bin/codex', '{HOME}/.codex/bin/codex', '/usr/local/bin/codex', '/opt/homebrew/bin/codex', '{HOME}/.npm-global/bin/codex'],
    searchRoots: ['{HOME}/.codex/packages', '{LOCALAPPDATA}/Programs/OpenAI', '{LOCALAPPDATA}/OpenAI']
  },
  gemini: {
    id: 'gemini', cmd: 'agy', name: 'Google Gemini', vendor: 'Google', program: 'Antigravity CLI',
    install: { win: 'irm https://antigravity.google/cli/install.ps1 | iex', unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
    winPaths: ['{LOCALAPPDATA}/agy/bin/agy.exe', '{HOME}/.local/bin/agy.exe'],
    unixPaths: ['{HOME}/.local/bin/agy', '/usr/local/bin/agy', '/opt/homebrew/bin/agy'],
    searchRoots: ['{LOCALAPPDATA}/agy']
  },
  'claude-code': {
    id: 'claude-code', cmd: 'claude', name: 'Claude', vendor: 'Anthropic', program: 'Claude Code',
    install: { win: 'irm https://claude.ai/install.ps1 | iex', unix: '(curl -fsSL https://claude.ai/install.sh || wget -qO- https://claude.ai/install.sh) | bash' },
    winPaths: ['{HOME}/.local/bin/claude.exe', '{APPDATA}/npm/claude.cmd', '{LOCALAPPDATA}/Programs/claude/claude.exe', '{LOCALAPPDATA}/AnthropicClaude/claude.exe'],
    unixPaths: ['{HOME}/.local/bin/claude', '{HOME}/.claude/local/claude', '{HOME}/.npm-global/bin/claude', '{HOME}/.bun/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude', '/opt/homebrew/bin/claude'],
    searchRoots: []
  }
};
const ACCOUNT_IDS = Object.keys(DEFS);
const MODES = ['none', 'local', ...ACCOUNT_IDS, 'api'];

const stripAnsi = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

function aiError(message, code) { const e = new Error(message); if (code) e.code = code; return e; }

// ─────────── plany kont: darmowy / płatny ───────────
const PLAN_NAMES = {
  free: 'darmowy', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro', team: 'Team', business: 'Business',
  enterprise: 'Enterprise', edu: 'Edu', max: 'Max', 'google-ai-pro': 'Google AI Pro'
};

// ChatGPT: rodzaj planu zapisany przez Codex CLI w pliku logowania (pole chatgpt_plan_type w id_token).
// Odczytujemy wyłącznie to jedno pole – tokeny nie są nigdzie kopiowane ani wysyłane.
function codexPlanFromAuth(auth) {
  try {
    const tok = auth && auth.tokens && auth.tokens.id_token;
    if (!tok) return null;
    const payload = JSON.parse(Buffer.from(String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const claims = payload['https://api.openai.com/auth'] || {};
    const type = String(claims.chatgpt_plan_type || '').toLowerCase();
    if (!type) return null;
    const until = claims.chatgpt_subscription_active_until ? Date.parse(claims.chatgpt_subscription_active_until) : null;
    const expired = until && until < Date.now();
    const paid = type !== 'free' && !expired;
    return { tier: paid ? 'paid' : 'free', plan: paid ? (PLAN_NAMES[type] || type) : 'darmowy' };
  } catch (_) { return null; }
}

function readCodexPlan() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  try { return codexPlanFromAuth(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'))); } catch (_) { return null; }
}

// Claude: `claude auth status --json` → subscriptionType (pro / max / team / enterprise).
function claudePlan(info) {
  const t = String((info && (info.subscriptionType || info.plan || (info.account && info.account.plan))) || '').toLowerCase();
  if (!t) return null;
  if (t === 'free') return { tier: 'free', plan: 'darmowy' };
  return { tier: 'paid', plan: PLAN_NAMES[t] || t };
}

// Google: `agy models` pokazuje modele dostępne dla konta. Modele z planu Google AI Pro/Ultra
// (Gemini 4 Neon / Carbon / Argon, Claude 5.5) oznaczają płatny plan.
const RX_GEMINI_PAID = /neon|carbon|argon|orchestrator|(opus|sonnet)[-\s]?5|claude[-\s]?(opus|sonnet)?[-\s]?5\.5/i;
function parseAgyModels(text) {
  const lines = stripAnsi(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ids = [];
  for (const l of lines) {
    const m = l.match(/^[-*•\s]*([a-z][a-z0-9.:\-_/]{2,})(?:\s|$)/i);
    if (m && /[-.0-9]/.test(m[1]) && !/^(usage|model|models|available|name|id)$/i.test(m[1])) ids.push(m[1]);
  }
  return [...new Set(ids)];
}
function geminiPlanFromModels(text) {
  const ids = parseAgyModels(text);
  if (!ids.length) return null;
  const paid = ids.some((id) => RX_GEMINI_PAID.test(id));
  return { tier: paid ? 'paid' : 'free', plan: paid ? 'Google AI Pro' : 'darmowy', models: ids };
}

// Faktyczny plan konta: ręczne ustawienie użytkownika ma pierwszeństwo przed wykrytym.
function effectiveTier(ai, id) {
  if (id === 'api') return 'paid';
  if (id === 'local' || id === 'none') return 'free';
  const o = (ai.plans || {})[id];
  if (o === 'free' || o === 'paid') return o;
  const d = (ai.detected || {})[id];
  if (d && d.tier) return d.tier;
  return id === 'claude-code' ? 'paid' : 'free'; // Claude Code działa tylko na płatnym planie
}

// Model dla konta: na planie darmowym – domyślny model konta (bez wymuszania),
// na płatnym – model wybrany przez użytkownika (o ile włączono mocniejsze modele).
function modelFor(ai, id, { test } = {}) {
  const tier = effectiveTier(ai, id);
  const paidModels = tier === 'paid' && ai.paidModels !== false;
  if (id === 'claude-code') return test ? 'haiku' : (paidModels ? ai.model || 'sonnet' : 'haiku');
  if (id === 'codex') return paidModels ? ai.codexModel || '' : '';
  if (id === 'gemini') return paidModels ? ai.geminiModel || '' : '';
  if (id === 'api') return ai.apiModel || 'claude-sonnet-5-5';
  if (id === 'local') return (ai.local && ai.local.model) || '';
  return '';
}

// Rozpoznanie typowych błędów programów (limit planu, brak logowania).
const RX_LIMIT = /usage limit|rate.?limit|limit reached|quota|too many requests|\b429\b|resource.?exhausted|hit your .*limit|upgrade your (plan|subscription)|individual quota/i;
const RX_AUTH = /not logged in|please log ?in|log ?in required|authenticat|unauthori[sz]ed|\b401\b|invalid.*(token|credential)|sign.?in (required|again)|expired.*(token|session)|need claude (max|pro)/i;

function classify(def, msg) {
  const m = stripAnsi(msg).trim().slice(-600);
  if (RX_LIMIT.test(m)) return aiError(`Wyczerpano limit konta ${def.name}. Spróbuj później albo połącz kolejne konto w Ustawieniach → AI – aplikacja przełączy się na nie automatycznie.`, 'AI_LIMIT');
  if (RX_AUTH.test(m)) return aiError(`Konto ${def.name} nie jest zalogowane (lub sesja wygasła). Otwórz Ustawienia → AI i kliknij „Połącz” przy ${def.name}.`, 'AI_AUTH');
  return aiError(`${def.program}: ${m || 'nieoczekiwana odpowiedź'}`);
}

const NO_FILES = 'Nie korzystaj z internetu, nie twórz ani nie modyfikuj żadnych plików i nie uruchamiaj poleceń. Odpowiedz wyłącznie wynikiem w żądanym formacie JSON.';
const fullPrompt = (system, prompt) => `${system}\n\n---\n\n${prompt}\n\n${NO_FILES}`;

function workDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wtzhelper-')); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ } }

class CliProvider {
  constructor(id, settings) { this.def = DEFS[id]; this.settings = settings; }
  get id() { return this.def.id; }
  get label() { return `${this.def.name} (${this.def.program})`; }
  get isLocal() { return false; }
  get tier() { return effectiveTier(this.settings.ai, this.def.id); }
  locate() { return findBinary(this.def, (this.settings.ai.paths || {})[this.def.id] || (this.def.id === 'claude-code' ? this.settings.ai.claudePath : '')); }
  requireBin() {
    const bin = this.locate();
    if (!bin) throw aiError(`Nie znaleziono programu ${this.def.program}. Otwórz Ustawienia → AI i kliknij „Połącz” przy ${this.def.name}.`, 'AI_AUTH');
    return bin;
  }
  async version() {
    const bin = this.locate();
    if (!bin) return null;
    const r = await run(bin, ['--version'], { timeoutMs: 20000 });
    return stripAnsi(r.out || r.err).trim().split('\n')[0] || null;
  }
  async test() {
    const v = await this.version();
    if (!v) throw aiError(`Nie znaleziono programu ${this.def.program} na tym komputerze.`);
    const r = await this.run({ system: 'Jesteś testem połączenia.', prompt: 'Odpowiedz dokładnie tekstem: {"ok":true}', test: true });
    const plan = this.tier === 'paid' ? 'plan płatny' : 'plan darmowy';
    return `${this.def.name}: połączenie działa (${v}, ${plan}) – ${r.text.trim().slice(0, 40)}`;
  }
}

// ─────────── ChatGPT – Codex CLI (`codex exec`) ───────────
class CodexProvider extends CliProvider {
  constructor(settings) { super('codex', settings); }

  args({ outFile, model }) {
    // read-only + wyłączone narzędzie powłoki + bez wyszukiwania: model nie czyta plików i nie uruchamia poleceń
    const a = ['exec', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--sandbox', 'read-only',
      '-c', 'features.shell_tool=false', '-c', 'web_search=disabled', '-o', outFile];
    if (model) a.push('-m', model);
    a.push('-'); // treść zapytania ze standardowego wejścia
    return a;
  }

  async run({ system, prompt, test }) {
    const bin = this.requireBin();
    const work = workDir();
    const outFile = path.join(work, 'odpowiedz.txt');
    try {
      const r = await run(bin, this.args({ outFile, model: modelFor(this.settings.ai, 'codex', { test }) }), { input: fullPrompt(system, prompt), cwd: work, timeoutMs: TIMEOUT });
      let text = '';
      try { text = fs.readFileSync(outFile, 'utf8'); } catch (_) { /* brak */ }
      if (text.trim()) return { text };
      if (r.timedOut) throw aiError('ChatGPT nie odpowiedział w wyznaczonym czasie.');
      throw classify(this.def, r.err || r.out || `kod ${r.code}`);
    } finally { cleanup(work); }
  }
}

// ─────────── Google Gemini – Antigravity CLI (`agy`, tryb bez okna) ───────────
function parseAgyOutput(out) {
  const lines = String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let env = null;
  let deltas = '';
  for (const l of lines) {
    let j;
    try { j = JSON.parse(l); } catch (_) { continue; }
    if (j && j.event === 'result' && j.result) env = j.result;
    else if (j && j.event === 'step_update' && j.step_update && j.step_update.step_type === 'agent_response' && j.step_update.text_delta) deltas += j.step_update.text_delta;
    else if (j && (j.response !== undefined || j.status)) env = j;
  }
  if (!env) {
    try { const j = JSON.parse(String(out || '').trim()); if (j && typeof j === 'object') env = j.result || j; } catch (_) { /* nie JSON */ }
  }
  return { response: (env && env.response) || deltas || '', status: env && env.status, error: env && env.error };
}

class GeminiProvider extends CliProvider {
  constructor(settings) { super('gemini', settings); }

  args({ model, full, stream }) {
    const a = ['--output-format', stream ? 'stream-json' : 'json', '--print-timeout', '8m', '--disable-slash-commands', '--sandbox'];
    if (stream) a.push('--input-format', 'stream-json');
    if (model) a.push('--model', model);
    if (!stream) a.push('-p', full); // -p ZAWSZE na końcu: agy traktuje dalsze argumenty jako treść
    return a;
  }

  async run({ system, prompt, test }) {
    const bin = this.requireBin();
    const work = workDir();
    const full = fullPrompt(system, prompt);
    const stream = full.length > (process.platform === 'win32' ? 24000 : 100000);
    try {
      const input = stream ? JSON.stringify({ event: 'user', message: { content: full } }) + '\n' : null;
      const r = await run(bin, this.args({ model: modelFor(this.settings.ai, 'gemini', { test }), full, stream }), { input, cwd: work, timeoutMs: TIMEOUT });
      const p = parseAgyOutput(r.out);
      if (p.response && String(p.response).trim() && p.status !== 'ERROR') return { text: String(p.response) };
      if (r.timedOut) throw aiError('Gemini nie odpowiedział w wyznaczonym czasie.');
      throw classify(this.def, [p.error, r.err, r.out].filter(Boolean).join('\n') || `kod ${r.code}`);
    } finally { cleanup(work); }
  }
}

// ─────────── Claude – Claude Code (`claude -p`) ───────────
class ClaudeCodeProvider extends CliProvider {
  constructor(settings) { super('claude-code', settings); }

  args({ model, bin }) {
    // bez żadnych narzędzi: tylko tekst na wejściu i wyjściu
    return ['-p', '--output-format', 'json', '--no-session-persistence', '--model', model || 'sonnet',
      '--tools', process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin || '') ? '""' : ''];
  }

  async run({ system, prompt, test }) {
    const bin = this.requireBin();
    const work = workDir();
    try {
      const r = await run(bin, this.args({ model: modelFor(this.settings.ai, 'claude-code', { test }), bin }), { input: fullPrompt(system, prompt), cwd: work, timeoutMs: TIMEOUT });
      let parsed = null;
      try {
        parsed = JSON.parse(r.out);
        if (Array.isArray(parsed)) parsed = parsed.find((x) => x.type === 'result') || parsed[parsed.length - 1];
      } catch (_) { /* nie JSON */ }
      if (!parsed) {
        if (r.timedOut) throw aiError('Claude nie odpowiedział w wyznaczonym czasie.');
        throw classify(this.def, r.err || r.out || `kod ${r.code}`);
      }
      if (parsed.is_error) throw classify(this.def, String(parsed.result || parsed.subtype || 'błąd'));
      return { text: String(parsed.result || ''), usage: { costUsd: parsed.total_cost_usd || null } };
    } finally { cleanup(work); }
  }
}

// ─────────── Lokalny model – Ollama na tym komputerze ───────────
class LocalProvider {
  constructor(settings) { this.settings = settings; }
  get id() { return 'local'; }
  get label() { const m = modelFor(this.settings.ai, 'local'); return `Lokalny model${m ? ` (${m})` : ''}`; }
  get isLocal() { return true; }
  get tier() { return 'free'; }
  base() { return (this.settings.ai.local && this.settings.ai.local.url) || ollama.DEFAULT_URL; }

  async run({ system, prompt }) {
    const model = modelFor(this.settings.ai, 'local');
    if (!model) throw aiError('Nie wybrano modelu lokalnego. Otwórz Ustawienia → AI → Lokalny model i pobierz lub wybierz model.', 'AI_AUTH');
    if (ollama.isCloudModel(model)) throw aiError('Wybrany model działa w chmurze Ollama, a nie na tym komputerze. Wybierz model lokalny.', 'AI_AUTH');
    try {
      const text = await ollama.chat(this.base(), { model, system, prompt: `${prompt}\n\nOdpowiedz wyłącznie wynikiem w żądanym formacie JSON.`, timeoutMs: TIMEOUT });
      return { text };
    } catch (e) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') throw aiError('Program Ollama nie jest uruchomiony. Otwórz Ustawienia → AI → Lokalny model i kliknij „Uruchom”.', 'AI_AUTH');
      if (/not found|pull/i.test(e.message)) throw aiError(`Model „${model}” nie jest pobrany. Pobierz go w Ustawieniach → AI → Lokalny model.`, 'AI_AUTH');
      throw aiError('Lokalny model: ' + e.message);
    }
  }

  async test() {
    const v = await ollama.version(this.base()).catch(() => null);
    if (!v) throw aiError('Program Ollama nie odpowiada. Upewnij się, że jest zainstalowany i uruchomiony.');
    const r = await this.run({ system: 'Jesteś testem połączenia.', prompt: 'Odpowiedz dokładnie tekstem: {"ok":true}' });
    return `Lokalny model działa (Ollama ${v}, ${modelFor(this.settings.ai, 'local')}) – ${r.text.trim().slice(0, 40)}`;
  }
}

// ─────────── Bez AI ───────────
class NoneProvider {
  get id() { return 'none'; }
  get label() { return 'Bez AI'; }
  get isLocal() { return true; }
  async run() { throw aiError('WTZ Helper działa w trybie „Bez AI”. Aby skorzystać z pomocy AI, wybierz lokalny model albo połącz konto w Ustawieniach → AI.', 'AI_OFF'); }
  async test() { return 'Tryb „Bez AI” – plany i oceny powstają z profili pracowni, nic nie jest wysyłane.'; }
}

// ─────────── klucz API Claude (zaawansowane, rozliczany za zużycie) ───────────
class ApiProvider {
  constructor(settings, getKey) { this.settings = settings; this.getKey = getKey; }
  get id() { return 'api'; }
  get label() { return 'Klucz API Claude'; }
  get isLocal() { return false; }
  get tier() { return 'paid'; }

  client() {
    const key = this.getKey();
    if (!key) throw aiError('Brak klucza API. Wklej klucz w Ustawieniach → AI → Zaawansowane.', 'AI_AUTH');
    const Anthropic = require('@anthropic-ai/sdk');
    const Ctor = Anthropic.default || Anthropic.Anthropic || Anthropic;
    return new Ctor({ apiKey: key, maxRetries: 2, timeout: 5 * 60 * 1000 });
  }

  async run({ system, prompt, maxTokens = 8000 }) {
    const client = this.client();
    try {
      const res = await client.messages.create({ model: modelFor(this.settings.ai, 'api'), max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] });
      return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), usage: res.usage };
    } catch (e) {
      if (e && (e.status === 429 || RX_LIMIT.test(e.message || ''))) throw aiError('Osiągnięto limit klucza API Claude. Spróbuj później.', 'AI_LIMIT');
      if (e && e.status === 401) throw aiError('Klucz API Claude jest nieprawidłowy.', 'AI_AUTH');
      throw e;
    }
  }

  async test() {
    const r = await this.run({ system: 'Jesteś testem połączenia.', prompt: 'Odpowiedz dokładnie tekstem: {"ok":true}', maxTokens: 50 });
    return `Połączenie działa (model ${this.settings.ai.apiModel}): ${r.text.trim().slice(0, 40)}`;
  }
}

function createProvider(id, settings, getKey) {
  if (id === 'api') return new ApiProvider(settings, getKey);
  if (id === 'local') return new LocalProvider(settings);
  if (id === 'gemini') return new GeminiProvider(settings);
  if (id === 'claude-code') return new ClaudeCodeProvider(settings);
  if (id === 'codex') return new CodexProvider(settings);
  return new NoneProvider();
}

// Kolejność prób: wybrane konto, a przy wyczerpanym limicie – pozostałe połączone konta,
// najpierw darmowe, potem płatne. Klucz API, model lokalny i tryb „Bez AI” nie mają zastępstw:
// płatny klucz API nigdy nie jest używany bez wyraźnego wyboru użytkownika.
function providerChain(ai) {
  const first = MODES.includes(ai.provider) ? ai.provider : 'none';
  if (!ACCOUNT_IDS.includes(first) || ai.fallback === false) return [first];
  const order = (ai.order && ai.order.length ? ai.order : ACCOUNT_IDS).filter((id) => ACCOUNT_IDS.includes(id));
  const rest = order.filter((id) => id !== first && ai.connected && ai.connected[id]);
  const free = rest.filter((id) => effectiveTier(ai, id) === 'free' && id !== 'claude-code');
  const paid = rest.filter((id) => effectiveTier(ai, id) === 'paid');
  return [first, ...free, ...paid];
}

function extractJson(text) {
  if (!text) throw new Error('Pusta odpowiedź modelu.');
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const tries = [...blocks.reverse(), text];
  for (const t of tries) {
    try { return JSON.parse(t.trim()); } catch (_) { /* dalej */ }
    const starts = [t.indexOf('{'), t.indexOf('[')].filter((x) => x >= 0);
    if (!starts.length) continue;
    const s = Math.min(...starts);
    const closer = t[s] === '{' ? '}' : ']';
    const e = t.lastIndexOf(closer);
    if (e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch (_) { /* dalej */ }
    }
  }
  throw new Error('Nie udało się odczytać odpowiedzi modelu jako JSON.');
}

const findClaude = (customPath) => findBinary(DEFS['claude-code'], customPath);

module.exports = {
  DEFS, ACCOUNT_IDS, MODES, PLAN_NAMES,
  CodexProvider, GeminiProvider, ClaudeCodeProvider, LocalProvider, NoneProvider, ApiProvider,
  createProvider, providerChain, effectiveTier, modelFor,
  codexPlanFromAuth, readCodexPlan, claudePlan, geminiPlanFromModels, parseAgyModels,
  parseAgyOutput, classify, stripAnsi, extractJson, findClaude
};
