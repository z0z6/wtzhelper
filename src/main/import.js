'use strict';
// Import danych osobowych z pliku wyeksportowanego z dziennika (np. Vulcan): XLSX, CSV/TSV, tabela HTML,
// arkusz XML 2003 oraz pliki XML z rekordami uczniów (np. format SOU). Dane zostają wyłącznie na tym komputerze.
const JSZip = require('jszip');
const crypto = require('crypto');

const norm = (s) => String(s == null ? '' : s)
  .replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, '$1 $2')
  .toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const decodeEntities = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// ───────────────────────────── rozpoznawanie rubryk ─────────────────────────────

// Zwraca nazwę pola dla nagłówka kolumny / nazwy elementu XML (albo null).
function fieldFor(header) {
  const h = norm(header);
  if (!h) return null;
  if (/(matk|ojc|ojciec|opiekun|rodzic)/.test(h)) return null;
  if (/^(nazwisko i imie|nazwisko imie|nazwisko i imiona|nazwisko imiona|uczen|nazwisko i imie ucznia)$/.test(h)) return 'lastFirst';
  if (/^(imie i nazwisko|imie nazwisko|imiona i nazwisko|imie i nazwisko ucznia)$/.test(h)) return 'firstLast';
  if (/^nazwisko( ucznia)?$/.test(h)) return 'lastName';
  if (/^(imie|pierwsze imie|imie pierwsze|imie ucznia|imie 1)$/.test(h)) return 'firstName';
  if (/^imiona$/.test(h)) return 'firstNames';
  if (/pesel/.test(h)) return 'pesel';
  if (/data ur|urodzon|^data i miejsce urodzenia$/.test(h)) return 'birthDate';
  if (/^plec$/.test(h)) return 'gender';
  if (/^(oddzial|klasa|oddzial klasa|klasa oddzial|symbol oddzialu|nazwa oddzialu)$/.test(h)) return 'klass';
  if (/zameld|korespond/.test(h)) return null;
  if (/^(adres|adres zamieszkania|miejsce zamieszkania|adres ucznia)$/.test(h)) return 'address';
  if (/^ulica/.test(h)) return 'street';
  if (/^(nr|numer) (domu|budynku)|^(dom|nr domu)$/.test(h)) return 'house';
  if (/^(nr|numer) (lokalu|mieszkania)|^(lokal|mieszkanie)$/.test(h)) return 'flat';
  if (/^kod( pocztowy)?$/.test(h)) return 'zip';
  if (/^(miejscowosc|miasto)( zamieszkania)?$/.test(h)) return 'city';
  if (/^poczta$/.test(h)) return 'post';
  return null;
}

function parseDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const pad = (n) => String(n).padStart(2, '0');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/.exec(s);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) { // liczba dni w Excelu
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return '';
}

function fromPesel(pesel) {
  const p = String(pesel || '').replace(/\D/g, '');
  if (p.length !== 11) return {};
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = w.reduce((a, x, i) => a + x * Number(p[i]), 0);
  if ((10 - (sum % 10)) % 10 !== Number(p[10])) return {};
  let y = Number(p.slice(0, 2)), mo = Number(p.slice(2, 4));
  const d = p.slice(4, 6);
  const century = Math.floor(mo / 20);
  y += [1900, 2000, 2100, 2200, 1800][century] || 1900;
  mo %= 20;
  if (mo < 1 || mo > 12) return {};
  return { birthDate: `${y}-${String(mo).padStart(2, '0')}-${d}`, gender: Number(p[9]) % 2 ? 'm' : 'k' };
}

const titleCase = (s) => String(s || '').trim().replace(/\s+/g, ' ');

// Zamienia rekord [[nagłówek, wartość], …] na osobę kartoteki.
function toPerson(pairs) {
  const f = {};
  for (const [key, value] of pairs) {
    const field = fieldFor(key);
    const v = String(value == null ? '' : value).trim();
    if (field && v && !f[field]) f[field] = v;
  }
  let firstName = f.firstName || (f.firstNames ? f.firstNames.split(/[\s,]+/)[0] : '');
  let lastName = f.lastName || '';
  if (!lastName && f.lastFirst) { const parts = f.lastFirst.replace(',', ' ').split(/\s+/); lastName = parts[0]; firstName = firstName || parts[1] || ''; }
  if (!lastName && f.firstLast) { const parts = f.firstLast.split(/\s+/); firstName = firstName || parts[0]; lastName = parts.slice(1).join(' '); }
  if (!lastName || !firstName) return null;
  const pesel = (f.pesel || '').replace(/\D/g, '');
  const fp = fromPesel(pesel);
  let gender = '';
  const g = norm(f.gender || '');
  if (/^(k|kobieta|dziewczyn|zenska|f)/.test(g)) gender = 'k';
  else if (/^(m|mezczyzna|chlop|meska)/.test(g)) gender = 'm';
  gender = gender || fp.gender || (/a$/i.test(firstName) ? 'k' : 'm');
  let address = f.address || '';
  if (!address && (f.street || f.city || f.house)) {
    const city = f.city || f.post || '';
    const street = f.street ? (/^(ul|al|os|pl|aleja|plac|osiedle)\b\.?/i.test(f.street) ? f.street : 'ul. ' + f.street) : city;
    const num = [f.house, f.flat].filter(Boolean).join('/');
    const line1 = [street, num].filter(Boolean).join(' ');
    const line2 = [f.zip, f.street ? city : (f.post && f.post !== city ? f.post : city)].filter(Boolean).join(' ');
    address = [line1, line2].filter(Boolean).join(', ');
  }
  return {
    id: crypto.randomUUID(),
    firstName: titleCase(firstName), lastName: titleCase(lastName), gender,
    birthDate: parseDate(f.birthDate) || fp.birthDate || '',
    pesel: pesel.length === 11 ? pesel : '',
    address: titleCase(address), klass: titleCase(f.klass)
  };
}

// ───────────────────────────── tabele ─────────────────────────────

// Wiersz nagłówków = wiersz (z pierwszych 25) z największą liczbą rozpoznanych rubryk.
function tableToPeople(rows) {
  let best = -1, bestScore = 0;
  rows.slice(0, 25).forEach((r, i) => {
    const fields = new Set(r.map(fieldFor).filter(Boolean));
    const hasName = ['lastName', 'lastFirst', 'firstLast'].some((x) => fields.has(x));
    if (hasName && fields.size > bestScore) { best = i; bestScore = fields.size; }
  });
  if (best < 0) throw new Error('Nie znalazłem w pliku wiersza z nagłówkami (np. „Nazwisko”, „Imię”, „Data urodzenia”). Wyeksportuj listę z nagłówkami kolumn.');
  const headers = rows[best];
  const out = [];
  for (const r of rows.slice(best + 1)) {
    const p = toPerson(headers.map((hd, i) => [hd, r[i]]));
    if (p) out.push(p);
  }
  return out;
}

function parseDelimited(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const count = (ch) => first.split(ch).length - 1;
  const delim = count('\t') >= 1 ? '\t' : count(';') >= count(',') ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

const stripTags = (s) => decodeEntities(String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function parseHtmlTable(text) {
  return [...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]))).filter((r) => r.some(Boolean));
}

function parseSpreadsheetXml(text) {
  return [...text.matchAll(/<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/g)].map((m) => {
    const row = [];
    for (const c of m[1].matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/g)) {
      const idx = /(?:ss:)?Index="(\d+)"/.exec(c[1]);
      if (idx) while (row.length < Number(idx[1]) - 1) row.push('');
      row.push(stripTags(c[2] || ''));
    }
    return row;
  }).filter((r) => r.some(Boolean));
}

async function parseXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name) => (zip.file(name) ? zip.file(name).async('string') : '');
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1])).join(''));
  const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!sheets.length) throw new Error('Plik XLSX nie zawiera arkuszy.');
  const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  let bestRows = [];
  for (const name of sheets) {
    const xml = await read(name);
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((m) => {
      const row = [];
      for (const c of m[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(c[1]);
        const type = (/\bt="(\w+)"/.exec(c[1]) || [])[1];
        const inner = c[2] || '';
        const v = (/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        let val = '';
        if (type === 's') val = shared[Number(v)] || '';
        else if (type === 'inlineStr') val = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1])).join('');
        else if (v != null) val = decodeEntities(v);
        const i = ref ? col(ref[1]) : row.length;
        while (row.length < i) row.push('');
        row[i] = String(val).trim();
      }
      return row;
    }).filter((r) => r.some(Boolean));
    if (rows.length > bestRows.length) bestRows = rows;
  }
  return bestRows;
}

// ───────────────────────────── XML z rekordami (np. SOU) ─────────────────────────────

function parseXmlTree(text) {
  const root = { name: '#root', children: [], attrs: {}, text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s>/]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); } else if (m[3]) {
      const node = { name: m[3].replace(/^.*:/, ''), children: [], attrs: {}, text: '' };
      for (const a of (m[4] || '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) if (!/^xmlns/.test(a[1])) node.attrs[a[1].replace(/^.*:/, '')] = decodeEntities(a[2] != null ? a[2] : a[3]);
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decodeEntities(m[6]);
  }
  return root;
}

function xmlToPeople(text) {
  const root = parseXmlTree(text);
  // liście: [ścieżka, nazwa, wartość]
  const leaves = (node, path, out) => {
    for (const [k, v] of Object.entries(node.attrs)) if (String(v).trim()) out.push([path, k, v]);
    if (!node.children.length && node.text.trim()) out.push([path, node.name, node.text.trim()]);
    for (const c of node.children) leaves(c, `${path}/${c.name}`, out);
    return out;
  };
  const isStudentName = (l) => fieldFor(l[1]) && ['lastName', 'lastFirst', 'firstLast'].includes(fieldFor(l[1])) && !/(matk|ojc|ojciec|opiekun|rodzic)/.test(norm(l[0]));
  const count = new Map(); // nazwa elementu -> { n, depth }
  const walk = (node, depth) => {
    if (leaves(node, '', []).some(isStudentName)) {
      const c = count.get(node.name) || { n: 0, depth };
      c.n++; c.depth = Math.min(c.depth, depth); count.set(node.name, c);
    }
    node.children.forEach((c) => walk(c, depth + 1));
  };
  root.children.forEach((c) => walk(c, 0));
  const ranked = [...count.entries()].sort((a, b) => b[1].n - a[1].n || a[1].depth - b[1].depth);
  if (!ranked.length) throw new Error('W pliku XML nie znalazłem danych osób (brak pól „Nazwisko” i „Imię”).');
  const recordTag = ranked[0][0];
  const out = [];
  const collect = (node) => {
    if (node.name === recordTag) {
      const ls = leaves(node, '', []).filter((l) => !/(matk|ojc|ojciec|opiekun|rodzic)/.test(norm(l[0])));
      const rank = (l) => (/zamieszk/.test(norm(l[0])) ? 0 : /(zameld|korespond)/.test(norm(l[0])) ? 2 : 1);
      ls.sort((a, b) => rank(a) - rank(b));
      const p = toPerson(ls.filter((l) => rank(l) < 2).map((l) => [l[1], l[2]]));
      if (p) out.push(p);
      return;
    }
    node.children.forEach(collect);
  };
  collect(root);
  return out;
}

// ───────────────────────────── wejście ─────────────────────────────

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  const declared = /encoding=["']([\w-]+)["']/i.exec(buffer.slice(0, 200).toString('latin1'));
  if (declared && !/utf-?8/i.test(declared[1])) { try { return new TextDecoder(declared[1].toLowerCase()).decode(buffer); } catch (_) { /* niżej */ } }
  const utf = new TextDecoder('utf-8').decode(buffer);
  if (!utf.includes('�')) return utf.replace(/^﻿/, '');
  return new TextDecoder('windows-1250').decode(buffer);
}

function textToPeople(text) {
  const t = text.trim();
  if (/^<\?xml|^</.test(t)) {
    if (/<(ss:)?Workbook\b/.test(t) && /<(ss:)?Row\b/.test(t)) return tableToPeople(parseSpreadsheetXml(t));
    if (/<table\b/i.test(t)) return tableToPeople(parseHtmlTable(t));
    return xmlToPeople(t);
  }
  return tableToPeople(parseDelimited(t));
}

async function parsePeopleFile(buffer) {
  let people;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) people = tableToPeople(await parseXlsx(buffer));
  else if (buffer[0] === 0xd0 && buffer[1] === 0xcf) throw new Error('To plik w starym formacie Excela (.xls). Otwórz go w Excelu lub LibreOffice i zapisz jako .xlsx albo .csv, a potem zaimportuj ponownie.');
  else people = textToPeople(decodeText(buffer));
  if (!people.length) throw new Error('W pliku nie znalazłem żadnej osoby z imieniem i nazwiskiem.');
  return people;
}

module.exports = { parsePeopleFile, textToPeople, tableToPeople, toPerson, fieldFor, parseDate, fromPesel, parseDelimited };
