'use strict';
// Lokalny model przez program Ollama (https://ollama.com) działający na tym komputerze.
// Komunikacja wyłącznie z adresem lokalnym (127.0.0.1) – dane nie opuszczają komputera.
// Modele chmurowe Ollama (z końcówką „cloud”) są pomijane, bo działają na serwerach Ollama.

const http = require('http');
const { spawn } = require('child_process');
const { findBinary, install: runInstaller, openTerminal, isWin } = require('./cli-tools');

const DEFAULT_URL = 'http://127.0.0.1:11434';

const DEF = {
  id: 'local', cmd: 'ollama', name: 'Ollama', vendor: 'Ollama', program: 'Ollama',
  install: { win: 'irm https://ollama.com/install.ps1 | iex', unix: 'curl -fsSL https://ollama.com/install.sh | sh' },
  winPaths: ['{LOCALAPPDATA}/Programs/Ollama/ollama.exe', '{LOCALAPPDATA}/Ollama/ollama.exe'],
  unixPaths: ['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/homebrew/bin/ollama', '{HOME}/.local/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama'],
  searchRoots: ['{LOCALAPPDATA}/Programs/Ollama']
};

// Polecane modele (polskie Bieliki od SpeakLeash + mały model ogólny dla słabszych komputerów).
const RECOMMENDED = [
  { id: 'SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M', name: 'Bielik 11B v3', size: '6,7 GB', note: 'Polski model – najlepsza jakość tekstu. Zalecane 16 GB RAM.' },
  { id: 'SpeakLeash/bielik-4.5b-v3.0-instruct:Q8_0', name: 'Bielik 4.5B v3', size: '5,1 GB', note: 'Polski model dla komputerów z 8 GB RAM.' }
];

const isCloudModel = (name) => /(^|[:\-])cloud$/i.test(String(name || ''));

function request(base, method, pathName, body, { timeoutMs = 15000, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(pathName, base || DEFAULT_URL); } catch (e) { reject(e); return; }
    if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname)) { reject(new Error('Lokalny model musi działać na tym komputerze (adres 127.0.0.1).')); return; }
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(url, { method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
      let buf = '';
      let all = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        all += d;
        if (!onLine) return;
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) { try { onLine(JSON.parse(line)); } catch (_) { /* niepełna linia */ } }
        }
      });
      res.on('end', () => {
        if (onLine && buf.trim()) { try { onLine(JSON.parse(buf.trim())); } catch (_) { /* ignore */ } }
        let json = null;
        try { json = JSON.parse(all); } catch (_) { /* strumień lub tekst */ }
        if (res.statusCode >= 400) { const e = new Error((json && json.error) || all.slice(0, 300) || `HTTP ${res.statusCode}`); e.status = res.statusCode; reject(e); return; }
        resolve(json != null ? json : all);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(Object.assign(new Error('Lokalny model nie odpowiedział w wyznaczonym czasie.'), { code: 'ETIMEDOUT' })); });
    if (signal) signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('Przerwano.'), { code: 'ABORTED' })), { once: true });
    if (data) req.write(data);
    req.end();
  });
}

async function version(base) {
  const r = await request(base, 'GET', '/api/version', null, { timeoutMs: 3000 });
  return r && r.version;
}

async function models(base) {
  const r = await request(base, 'GET', '/api/tags', null, { timeoutMs: 5000 });
  return ((r && r.models) || [])
    .filter((m) => !isCloudModel(m.name) && !m.remote_host)
    .map((m) => ({ name: m.name, size: m.size || 0, family: (m.details && m.details.family) || '', params: (m.details && m.details.parameter_size) || '' }));
}

async function status(base, customPath) {
  const bin = findBinary(DEF, customPath);
  let v = null;
  try { v = await version(base); } catch (_) { /* nie działa */ }
  const list = v ? await models(base).catch(() => []) : [];
  return { installed: !!bin || !!v, path: bin, running: !!v, version: v, models: list };
}

// Uruchomienie serwera Ollama, gdy program jest zainstalowany, ale nie działa.
async function start(base, customPath) {
  const bin = findBinary(DEF, customPath);
  if (!bin) throw new Error('Nie znaleziono programu Ollama. Zainstaluj go najpierw.');
  const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if (await version(base)) return true; } catch (_) { /* jeszcze nie */ }
  }
  throw new Error('Ollama nie uruchomił się. Uruchom program Ollama ręcznie i spróbuj ponownie.');
}

// Instalacja: Windows i macOS – oficjalny skrypt bez uprawnień administratora;
// Linux – skrypt wymaga hasła (sudo), więc otwieramy okno terminala.
function install(onLog) {
  if (process.platform === 'linux') {
    const t = openTerminal({
      title: 'WTZ Helper - instalacja Ollama',
      lines: ['WTZ Helper - instalacja programu Ollama (model lokalny)', 'Instalator poprosi o haslo administratora (sudo).', 'Po zakonczeniu wroc do aplikacji WTZ Helper i kliknij "Sprawdz".'],
      command: ['bash', '-c', DEF.install.unix]
    });
    return Promise.resolve({ terminal: true, marker: t.marker });
  }
  return runInstaller(DEF, onLog).then((code) => ({ terminal: false, code }));
}

// Pobieranie modelu z postępem (strumień NDJSON z /api/pull).
function pull(base, model, onProgress, signal) {
  return request(base, 'POST', '/api/pull', { model, stream: true }, {
    timeoutMs: 6 * 60 * 60 * 1000,
    signal,
    onLine: (j) => {
      if (j.error) return;
      onProgress && onProgress({ status: j.status, total: j.total || 0, completed: j.completed || 0 });
    }
  }).then((r) => {
    const s = String(r || '');
    const m = s.match(/"error"\s*:\s*"([^"]+)"/);
    if (m) throw new Error(m[1]);
    return true;
  });
}

async function chat(base, { model, system, prompt, timeoutMs }) {
  const r = await request(base, 'POST', '/api/chat', {
    model,
    stream: false,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    options: { temperature: 0.3, num_ctx: 8192 }
  }, { timeoutMs: timeoutMs || 8 * 60 * 1000 });
  const text = r && r.message && r.message.content;
  if (!text || !String(text).trim()) throw new Error('Model nie zwrócił odpowiedzi.');
  // modele „myślące” mogą dodać blok rozumowania – usuwamy go
  return String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

module.exports = { DEF, DEFAULT_URL, RECOMMENDED, isCloudModel, request, version, models, status, start, install, pull, chat, isWin };
