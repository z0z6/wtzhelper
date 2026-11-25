'use strict';
// Personalizacja tekstów: {osoba}, [forma męska|forma żeńska], daty, nazwy plików.

const REF_STYLES = {
  imie: { label: 'Imię', m: (p) => p.firstName || 'Uczestnik', k: (p) => p.firstName || 'Uczestniczka' },
  pan: { label: 'Pan / Pani + imię', m: (p) => `Pan ${p.firstName || ''}`.trim(), k: (p) => `Pani ${p.firstName || ''}`.trim() },
  uczestnik: { label: 'uczestnik / uczestniczka', m: () => 'uczestnik', k: () => 'uczestniczka' },
  podopieczny: { label: 'podopieczny / podopieczna', m: () => 'podopieczny', k: () => 'podopieczna' }
};

function refName(person) {
  const p = person || {};
  const st = REF_STYLES[p.refStyle] || REF_STYLES.imie;
  return (p.gender === 'k' ? st.k : st.m)(p);
}

// Wielka litera na początku tekstu i po kropce / wykrzykniku / pytajniku.
function capitalizeSentences(text) {
  return String(text).replace(/(^\s*|[.!?…]\s+)(\p{Ll})/gu, (_m, pre, ch) => pre + ch.toLocaleUpperCase('pl'));
}

function personalize(text, person) {
  const p = person || {};
  const female = p.gender === 'k';
  let out = String(text || '')
    .replace(/\[([^\[\]|]*)\|([^\[\]|]*)\]/g, (_m, m, k) => (female ? k : m))
    .replace(/\{osoba\}/gi, refName(p))
    .replace(/\{imi[eę]\}/gi, p.firstName || '')
    .replace(/\{nazwisko\}/gi, p.lastName || '');
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  return capitalizeSentences(out);
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
const today = () => iso(new Date());

function fmtDate(s, suffix = true) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}${suffix ? ' r.' : ''}` : '';
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

function dayLabel(s) {
  const d = parseIso(s);
  return d ? `${DAYS[d.getDay()]}, ${fmtDate(s, false)}` : '';
}

function monthLabel(s) {
  const d = parseIso(s);
  return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

function fullName(p) { return [p && p.firstName, p && p.lastName].filter(Boolean).join(' ').trim(); }
function shortName(p) { return [p && p.firstName, p && p.lastName ? p.lastName.charAt(0) + '.' : ''].filter(Boolean).join(' ').trim(); }

function safeFile(s) { return String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// Lista z „oraz” przed ostatnim elementem (nazwy umiejętności często same zawierają „i”): a, b oraz c
function joinList(items, last = ' oraz ') {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + last + a[a.length - 1];
}

// Odmiana rzeczownika po liczebniku: 1 ocena, 2 oceny, 5 ocen
const plural = (n, one, few, many) => { if (n === 1) return one; const d = n % 10, t = n % 100; return d >= 2 && d <= 4 && !(t >= 12 && t <= 14) ? few : many; };

const lower = (s) => { const t = String(s || '').trim(); return t && !/^\p{Lu}{2}/u.test(t) ? t.charAt(0).toLocaleLowerCase('pl') + t.slice(1) : t; };

module.exports = { REF_STYLES, refName, personalize, capitalizeSentences, fmtDate, iso, parseIso, today, MONTHS, MONTHS_GEN, DAYS, dayLabel, monthLabel, fullName, shortName, safeFile, joinList, plural, lower, pad };
