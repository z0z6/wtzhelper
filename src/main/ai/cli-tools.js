'use strict';
// Wspólne narzędzia dla oficjalnych programów AI uruchamianych z aplikacji
// (Codex CLI – ChatGPT, Antigravity CLI – Google Gemini, Claude Code – Claude, Ollama – model lokalny):
// wyszukiwanie programu na dysku, uruchamianie procesów, otwieranie okna terminala
// do logowania oraz zamykanie wszystkich procesów przy wyjściu z aplikacji.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const CHILDREN = new Set();

// ─────────── odświeżenie PATH (Windows: instalator dopisuje katalog do PATH użytkownika) ───────────
function refreshPath() {
  if (!isWin) {
    const home = os.homedir();
    const extra = [path.join(home, '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin'];
    const cur = (process.env.PATH || '').split(path.delimiter);
    process.env.PATH = [...new Set([...cur, ...extra])].filter(Boolean).join(path.delimiter);
    return;
  }
  const read = (key) => {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
      return m ? m[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] || `%${v}%`) : '';
    } catch (_) { return ''; }
  };
  const parts = [process.env.PATH, read('HKCU\\Environment'), read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')]
    .join(';').split(';').map((s) => s.trim()).filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(';');
}

// Szuka pliku `names` w katalogu (płytko, do `depth` poziomów) – dla instalatorów,
// które kładą program w podkatalogu z numerem wersji.
function searchDir(root, names, depth = 4) {
  if (depth < 0) return null;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of entries) if (e.isFile() && names.includes(e.name.toLowerCase())) return path.join(root, e.name);
  for (const e of entries) {
    if (!e.isDirectory() || /^(node_modules|sessions|log|logs|cache|tmp|\.git)$/i.test(e.name)) continue;
    const r = searchDir(path.join(root, e.name), names, depth - 1);
    if (r) return r;
  }
  return null;
}

// Znajdź program: ścieżka wskazana przez użytkownika → znane miejsca instalacji → PATH → przeszukanie katalogów.
function findBinary(def, customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const home = os.homedir();
  const env = {
    HOME: home,
    APPDATA: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  };
  const expand = (p) => p.replace(/\{(\w+)\}/g, (_, k) => env[k] || '');
  const list = (isWin ? def.winPaths : def.unixPaths).map(expand);
  const exts = isWin ? ['.exe', '.cmd'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) list.push(path.join(dir, def.cmd + ext));
  }
  for (const p of [...new Set(list)]) {
    try { if (fs.statSync(p).isFile()) return p; } catch (_) { /* brak */ }
  }
  const names = isWin ? [def.cmd + '.exe'] : [def.cmd];
  for (const root of (def.searchRoots || []).map(expand)) {
    const r = searchDir(root, names);
    if (r) return r;
  }
  return null;
}

function spawnBin(bin, args, opts = {}) {
  const isScript = isWin && /\.(cmd|bat)$/i.test(bin);
  const child = spawn(isScript ? `"${bin}"` : bin, args, { shell: isScript, windowsHide: true, env: process.env, ...opts });
  CHILDREN.add(child);
  child.on('close', () => CHILDREN.delete(child));
  child.on('error', () => CHILDREN.delete(child));
  return child;
}

// Uruchom proces i zbierz wynik (nigdy nie odrzuca – zwraca kod, stdout, stderr).
function run(bin, args, { input = null, cwd, timeoutMs = 60000, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try { child = spawnBin(bin, args, { cwd, env: env || process.env }); } catch (e) { resolve({ code: -1, out: '', err: e.message, timedOut: false }); return; }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + e.message, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, timedOut }); });
    if (input != null) child.stdin.end(input, 'utf8'); else child.stdin.end();
  });
}

function killTree(child) {
  if (!child || child.exitCode != null || child.killed) return;
  try {
    if (isWin && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill();
  } catch (_) { /* ignore */ }
}

// Przy zamknięciu aplikacji – zakończ wszystkie uruchomione programy AI.
function killAll() {
  for (const c of [...CHILDREN]) killTree(c);
  CHILDREN.clear();
}

// Instalacja oficjalnym skryptem producenta (bez uprawnień administratora – do katalogu użytkownika).
function install(def, onLog) {
  return new Promise((resolve, reject) => {
    const child = isWin
      ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', def.install.win], { windowsHide: true })
      : spawn('bash', ['-lc', def.install.unix], { env: process.env });
    CHILDREN.add(child);
    const log = (d) => onLog && onLog(String(d));
    child.stdout.on('data', log);
    child.stderr.on('data', log);
    child.on('error', (e) => { CHILDREN.delete(child); reject(new Error('Nie udało się uruchomić instalatora: ' + e.message)); });
    child.on('close', (code) => { CHILDREN.delete(child); refreshPath(); resolve(code); });
  });
}

// ─────────── okno terminala (logowanie wymagające terminala, tryb „poprowadź mnie”) ───────────
// Skrypt zapisuje kod wyjścia do pliku-znacznika – aplikacja wie, kiedy użytkownik skończył.
function openTerminal({ title, lines, command }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtzhelper-login-'));
  const marker = path.join(dir, 'wynik.txt');
  const q = (s) => `"${String(s).replace(/"/g, '')}"`;
  let script;
  if (isWin) {
    const cmdLine = command.map((a, i) => (i === 0 || /\s|[&|<>^]/.test(a) ? q(a) : a)).join(' ');
    script = path.join(dir, 'logowanie.cmd');
    fs.writeFileSync(script, [
      '@echo off', 'chcp 65001 >nul', `title ${title}`, 'echo.',
      ...lines.map((l) => (l ? `echo ${l.replace(/%/g, '%%').replace(/[&|<>^]/g, '^$&')}` : 'echo.')), 'echo.',
      `cd /d ${q(dir)}`,
      cmdLine,
      `>${q(marker)} echo %ERRORLEVEL%`,
      'echo.', 'echo Gotowe - to okno mozesz zamknac.', 'timeout /t 15 >nul', ''
    ].join('\r\n'), 'utf8');
    // jak w Node (shell: true): /s /c "…" – cmd zdejmuje zewnętrzne cudzysłowy
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `"start "${title}" cmd.exe /c "${script}""`], { windowsHide: true, windowsVerbatimArguments: true });
    child.on('error', () => {});
    return { marker, dir };
  }
  const sh = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  script = path.join(dir, 'logowanie.sh');
  fs.writeFileSync(script, [
    '#!/bin/bash', `printf '\\033]0;%s\\007' ${sh(title)}`, 'echo',
    ...lines.map((l) => `echo ${sh(l)}`), 'echo',
    `cd ${sh(dir)}`,
    command.map(sh).join(' '),
    `echo $? > ${sh(marker)}`,
    'echo', 'echo "Gotowe – to okno możesz zamknąć."', 'sleep 15', ''
  ].join('\n'), { mode: 0o755 });
  if (process.platform === 'darwin') {
    const cmdFile = script.replace(/\.sh$/, '.command');
    fs.renameSync(script, cmdFile);
    spawn('open', ['-a', 'Terminal', cmdFile], { detached: true, stdio: 'ignore' }).unref();
    return { marker, dir };
  }
  const terms = [
    ['gnome-terminal', ['--', 'bash', script]],
    ['konsole', ['-e', 'bash', script]],
    ['xfce4-terminal', ['-x', 'bash', script]],
    ['mate-terminal', ['-x', 'bash', script]],
    ['tilix', ['-e', `bash ${script}`]],
    ['x-terminal-emulator', ['-e', `bash ${script}`]],
    ['xterm', ['-e', 'bash', script]]
  ];
  for (const [t, args] of terms) {
    const bin = findBinary({ cmd: t, winPaths: [], unixPaths: [`/usr/bin/${t}`] });
    if (!bin) continue;
    spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
    return { marker, dir };
  }
  throw new Error('Nie znaleziono programu terminala. Otwórz terminal ręcznie i wpisz: ' + command.join(' '));
}

function readMarker(marker) {
  try { const t = fs.readFileSync(marker, 'utf8').trim(); return t === '' ? null : Number(t); } catch (_) { return null; }
}

module.exports = { findBinary, run, spawnBin, killTree, killAll, install, openTerminal, readMarker, refreshPath, searchDir, isWin };
