'use strict';
// Dokumenty uczestnika (orzeczenie, poprzednie oceny, IPR, opinie) – wszystko lokalnie:
//  • parseDocument() – odczyt danych z tekstu OCR (dane osobowe, stopień i symbole niepełnosprawności,
//    poziomy umiejętności z poprzednich arkuszy ocen, cele IPR),
//  • pseudonymize()  – usuwa dane osobowe przed analizą przez AI (znaczniki {{IMIE}}, {{NAZWISKO}}…),
//  • findLeaks()     – strażnik: dane osobowe, które zostały w tekście,
//  • baza dostosowań form i metod pracy do rodzaju i stopnia niepełnosprawności.
// Obrazy dokumentów NIGDY nie opuszczają komputera – OCR działa w oknie aplikacji (Tesseract).

// ───────────── słowniki ─────────────

// Symbole przyczyn niepełnosprawności (rozporządzenie w sprawie orzekania o niepełnosprawności i stopniu niepełnosprawności).
const CODES = {
  '01-U': 'upośledzenie umysłowe',
  '02-P': 'choroby psychiczne',
  '03-L': 'zaburzenia głosu, mowy i choroby słuchu',
  '04-O': 'choroby narządu wzroku',
  '05-R': 'upośledzenie narządu ruchu',
  '06-E': 'epilepsja',
  '07-S': 'choroby układu oddechowego i krążenia',
  '08-T': 'choroby układu pokarmowego',
  '09-M': 'choroby układu moczowo-płciowego',
  '10-N': 'choroby neurologiczne',
  '11-I': 'inne schorzenia',
  '12-C': 'całościowe zaburzenia rozwojowe'
};

const DEGREES = { lekki: 'lekki', umiarkowany: 'umiarkowany', znaczny: 'znaczny' };

const DOC_TYPES = {
  orzeczenie: 'Orzeczenie o stopniu niepełnosprawności',
  ocena: 'Poprzednia ocena / arkusz ocen',
  ipr: 'Indywidualny program rehabilitacji',
  inny: 'Inny dokument (opinia, zaświadczenie)'
};

// Dostosowania form i metod pracy w pracowniach – zestaw startowy, do edycji w karcie uczestnika.
const ADAPT = {
  '01-U': ['Krótkie, jednoetapowe polecenia połączone z pokazem.', 'Instrukcje obrazkowe krok po kroku przy stanowisku pracy.', 'Dzielenie zadania na etapy, częste powtórzenia i utrwalanie.', 'Natychmiastowe wzmocnienia pozytywne, stałe stanowisko pracy.'],
  '02-P': ['Przewidywalny plan dnia, zapowiadanie zmian z wyprzedzeniem.', 'Możliwość przerwy i wyciszenia w razie napięcia.', 'Unikanie presji czasu i rywalizacji, zadania o stopniowanej trudności.', 'Obserwacja samopoczucia; w razie pogorszenia kontakt z psychologiem.'],
  '03-L': ['Komunikaty wzrokowe i pisemne, piktogramy, gesty (AAC).', 'Mówienie wyraźnie, twarzą do uczestnika; sprawdzanie zrozumienia poleceń.', 'Ograniczanie hałasu przy przekazywaniu instrukcji.'],
  '04-O': ['Dobre oświetlenie, kontrastowe i powiększone materiały.', 'Stałe miejsce narzędzi i materiałów, porządek na stanowisku.', 'Słowny opis wykonywanych czynności.', 'Asekuracja przy narzędziach ostrych i gorących.'],
  '05-R': ['Dostosowana wysokość blatu i dostęp do stanowiska (także dla wózka).', 'Narzędzia ergonomiczne (pogrubione uchwyty), stabilizacja materiału.', 'Tempo pracy dostosowane do możliwości ruchowych, pomoc w przemieszczaniu.'],
  '06-E': ['Nadzór przy narzędziach ostrych, gorących i maszynach; unikanie pracy na wysokości.', 'Znajomość procedury postępowania w czasie napadu przez prowadzącego.', 'Unikanie przemęczenia, niedosypiania i migających świateł; regularne przerwy.'],
  '07-S': ['Dawkowanie wysiłku, częstsze przerwy.', 'Unikanie zapylenia i oparów (np. szlifowanie, lakiery) – praca przy otwartym oknie lub zamiana zadania.'],
  '08-T': ['Uwzględnienie zaleceń dietetycznych w pracowni gospodarstwa domowego.', 'Swobodny dostęp do toalety i przerw.'],
  '09-M': ['Swobodny dostęp do toalety, przerwy w zajęciach.'],
  '10-N': ['Tempo pracy i przerwy dostosowane do męczliwości.', 'Asekuracja przy zadaniach wymagających równowagi i precyzji.', 'Uproszczone narzędzia i ćwiczenia koordynacji ruchowej.'],
  '11-I': ['Dostosowania zgodnie z zaleceniami lekarza (np. dieta, leki o stałych porach).'],
  '12-C': ['Stały plan dnia z piktogramami, zapowiadanie każdej zmiany.', 'Ograniczanie bodźców (hałas, tłok), dostęp do miejsca wyciszenia.', 'Jasne, konkretne polecenia i ustrukturyzowane zadanie (początek – koniec).', 'Trening umiejętności społecznych i komunikacyjnych w małej grupie.']
};

const DEGREE_ADAPT = {
  znaczny: ['Praca indywidualna lub w małej grupie, pomoc i asekuracja przy większości czynności.'],
  umiarkowany: ['Częściowa pomoc i ukierunkowanie słowne, stopniowe zwiększanie samodzielności.'],
  lekki: ['Dążenie do pełnej samodzielności, zadania o charakterze zawodowym i odpowiedzialności za ich efekt.']
};

// Rodzaje niepełnosprawności, przy których zajęcia z narzędziami ostrymi, gorącymi lub maszynami wymagają nadzoru.
const SUPERVISION_CODES = ['04-O', '05-R', '06-E', '10-N'];
const RISKY = /n[oó]ż|krojeni|pił|piłow|wierc|wkręt|sekator|kuchenk|piekarnik|żelazk|prasow|czajnik|koło garncar|maszyn|blender|mikser|robot|piec|gorąc|nożyc/i;

function emptyDisability() { return { degree: '', codes: [], number: '', issued: '', validUntil: '', therapy: '', notes: '' }; }

function describeDisability(d) {
  if (!d) return '';
  const parts = [];
  if (d.degree) parts.push(`stopień ${d.degree}`);
  const codes = (d.codes || []).filter((c) => CODES[c]).map((c) => `${c} (${CODES[c]})`);
  if (codes.length) parts.push(codes.join(', '));
  return parts.join('; ');
}

function localAdaptations(d) {
  const out = [];
  for (const c of (d && d.codes) || []) for (const a of ADAPT[c] || []) if (!out.includes(a)) out.push(a);
  for (const a of DEGREE_ADAPT[(d && d.degree) || ''] || []) if (!out.includes(a)) out.push(a);
  return out;
}

function needsSupervision(person) {
  const d = (person && person.disability) || {};
  return d.degree === 'znaczny' || (d.codes || []).some((c) => SUPERVISION_CODES.includes(c));
}

const isRisky = (...names) => names.some((n) => RISKY.test(String(n || '')));

// ───────────── tekst, daty, PESEL ─────────────

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
const norm = (s) => strip(String(s || '').toLowerCase()).replace(/[^\S\n]+/g, ' ');
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y, m, d) => { const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d; };

function parseDate(s) {
  if (!s) return null;
  const t = String(s);
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m && validDate(+m[1], +m[2], +m[3])) return isoOf(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{4})\b/);
  if (m && validDate(+m[3], +m[2], +m[1])) return isoOf(+m[3], +m[2], +m[1]);
  const a = strip(t.toLowerCase());
  m = a.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
  if (m) {
    const mi = MONTHS_GEN.map(strip).findIndex((x) => m[2].startsWith(x.slice(0, 4)));
    if (mi >= 0 && validDate(+m[3], mi + 1, +m[1])) return isoOf(+m[3], mi + 1, +m[1]);
  }
  return null;
}

function dateVariants(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return [];
  const [y, m, d] = iso.split('-').map(Number);
  return [...new Set([`${pad(d)}.${pad(m)}.${y}`, `${d}.${m}.${y}`, `${d}.${pad(m)}.${y}`, `${pad(d)}-${pad(m)}-${y}`, `${pad(d)}/${pad(m)}/${y}`, iso, `${d} ${MONTHS_GEN[m - 1]} ${y}`, `${pad(d)} ${MONTHS_GEN[m - 1]} ${y}`])];
}

function peselDecode(p) {
  const s = String(p || '').replace(/\D/g, '');
  if (s.length !== 11) return null;
  let y = Number(s.slice(0, 2)); let m = Number(s.slice(2, 4)); const d = Number(s.slice(4, 6));
  let base = null;
  for (const [off, c] of [[80, 1800], [0, 1900], [20, 2000], [40, 2100], [60, 2200]]) if (m > off && m <= off + 12) { base = c; m -= off; break; }
  if (base == null) return null;
  y += base;
  if (!validDate(y, m, d)) return null;
  return { birthDate: isoOf(y, m, d), gender: Number(s[9]) % 2 === 1 ? 'm' : 'k' };
}

function peselValid(p) {
  const s = String(p || '').replace(/\D/g, '');
  if (s.length !== 11) return false;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = w.reduce((acc, wi, i) => acc + wi * Number(s[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(s[10]) && !!peselDecode(s);
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

// ───────────── odczyt dokumentów ─────────────

function lines(text) { return String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean); }

// Wartość pola z etykietą: w tej samej linii (po etykiecie) albo w następnej.
function labelValue(ls, labelRx) {
  for (let i = 0; i < ls.length; i++) {
    const n = norm(ls[i]);
    const m = n.match(labelRx);
    if (!m) continue;
    const rest = ls[i].slice(m.index + m[0].length).replace(/^[\s:.\-–—)]+/, '').trim();
    if (rest.length > 1) return rest;
    for (let j = i + 1; j < Math.min(ls.length, i + 3); j++) if (ls[j].length > 1) return ls[j];
  }
  return '';
}

function parseName(ls) {
  let v = labelValue(ls, /(imie|imiona) i nazwisko/);
  let reversed = false;
  if (!v) { v = labelValue(ls, /nazwisko i imi(e|ona)/); reversed = !!v; }
  if (!v) {
    const l = ls.find((x) => /^(pan|pani)\s+\p{Lu}/u.test(x));
    if (l) v = l.replace(/^(pan|pani)\s+/i, '');
  }
  const words = (v.match(/[\p{L}\-]{2,}/gu) || []).filter((w) => !/^(pan|pani|syn|córka|corka|ur|urodzon\p{L}*)$/iu.test(w)).slice(0, 3);
  if (words.length < 2) return {};
  const tc = words.map(titleCase);
  return reversed ? { lastName: tc[0], firstName: tc.slice(1).join(' ') } : { firstName: tc.slice(0, -1).join(' '), lastName: tc[tc.length - 1] };
}

function parsePersonal(text) {
  const ls = lines(text);
  const out = { ...parseName(ls) };
  const pm = String(text).replace(/(\d)\s(?=\d)/g, '$1').match(/(?<!\d)\d{11}(?!\d)/g) || [];
  const pesel = pm.find(peselValid);
  if (pesel) { out.pesel = pesel; const d = peselDecode(pesel); out.birthDate = d.birthDate; out.gender = d.gender; }
  const bd = parseDate(labelValue(ls, /data urodzenia/));
  if (bd) out.birthDate = bd;
  if (!out.gender && out.firstName) out.gender = /a$/i.test(out.firstName.split(' ')[0]) ? 'k' : 'm';
  const addr = labelValue(ls, /adres( zamieszkania| stalego pobytu)?\b|zamieszkal\p{L}*/u);
  if (addr && /\d/.test(addr)) out.address = addr.replace(/\s{2,}/g, ' ');
  return out;
}

function parseDisability(text) {
  const d = emptyDisability();
  const n = norm(text);
  const deg = n.match(/(znaczn|umiarkowan|lekk)\p{L}*\s+stopni/u) || n.match(/stopien\p{L}*\s+niepelnosprawnosci\s*[:\-–]?\s*(znaczn|umiarkowan|lekk)/u);
  if (deg) d.degree = { znaczn: 'znaczny', umiarkowan: 'umiarkowany', lekk: 'lekki' }[deg[1]];
  const codes = [];
  for (const m of String(text).toUpperCase().matchAll(/(?<![\dA-Z])(0[1-9]|1[0-2])\s*[-–—.]?\s*([ULPOREST MNIC])(?![A-Z])/g)) {
    const c = `${m[1]}-${m[2]}`;
    if (CODES[c] && !codes.includes(c)) codes.push(c);
  }
  d.codes = codes.slice(0, 3);
  const nr = String(text).match(/\b(?:nr|numer|znak)\s*[:.]?\s*([A-Za-z0-9][\w./\-]*\d[\w./\-]*)/i);
  if (nr) d.number = nr[1];
  const ls = lines(text);
  d.issued = parseDate(labelValue(ls, /data wydania( orzeczenia)?/)) || '';
  if (/na stale/.test(n)) d.validUntil = 'na stałe';
  else {
    const m = n.match(/(?:wydaje sie|wazne|na okres)[^\n]{0,40}?do(?: dnia)?\s*([\d.\-/ ]{8,12}\d|\d{1,2} \p{L}+ \d{4})/u) || n.match(/do dnia\s*([\d.\-/ ]{8,12}\d)/);
    if (m) d.validUntil = parseDate(m[1]) || '';
  }
  const tl = n.split('\n').find((l) => /terapii zajeciowej/.test(l));
  if (tl) d.therapy = /nie (wymaga|wskaz|jest wskaz)|brak wskaz/.test(tl) ? 'nie wskazane' : 'wskazane';
  return d;
}

// Poziomy umiejętności z poprzedniego arkusza ocen: linia z nazwą umiejętności + cyfra 0–4 lub opis poziomu.
const LEVEL_WORDS = [[4, /samodzieln/], [3, /ukierunkow|niewielk\p{L}* pomoc|podpowiedz/u], [2, /czesciow\p{L}* pomoc|z pomoca/u], [1, /pelna pomoc|pelnej pomocy|z pelna/], [0, /nie podejmuje|odmawia|nie wykonuje/]];
const STOP = new Set(['oraz', 'przez', 'jego', 'swoich', 'innych', 'zakresie', 'umiejetnosc', 'umiejetnosci']);

function matchSkillLevels(text, skills) {
  const ls = lines(text).map((l) => ({ raw: l, n: norm(l) }));
  const out = [];
  for (const s of skills) {
    const words = norm(s.name).split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, Math.max(4, w.length - 2)));
    if (!words.length) continue;
    const need = Math.min(2, words.length);
    const hit = ls.find((l) => words.filter((w) => l.n.includes(w)).length >= need);
    if (!hit) continue;
    const tail = hit.n.replace(new RegExp(words.join('|'), 'g'), ' ');
    let level = null;
    const dm = tail.match(/(?<![\d.,])([0-4])(?![\d.,%])/);
    if (dm) level = Number(dm[1]);
    else for (const [v, rx] of LEVEL_WORDS) if (rx.test(tail)) { level = v; break; }
    if (level != null) out.push({ skillId: s.id, level, line: hit.raw });
  }
  return out;
}

function parseGoals(text) {
  return lines(text).filter((l) => /^([-–•*]|\d+[.)])\s+\S/.test(l)).map((l) => l.replace(/^([-–•*]|\d+[.)])\s+/, '').trim()).filter((l) => l.length >= 8 && l.length <= 220).slice(0, 15);
}

function firstDate(text) { const m = String(text).match(/\b\d{1,2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/); return m ? parseDate(m[0]) : null; }

function parseDocument(type, text, { skills = [] } = {}) {
  const out = { type, personal: parsePersonal(text), disability: null, date: null, levels: [], goals: [] };
  if (type === 'orzeczenie') { out.disability = parseDisability(text); out.date = out.disability.issued || firstDate(text); }
  else {
    const d = parseDisability(text);
    if (d.degree || d.codes.length) out.disability = d;
    out.date = parseDate(labelValue(lines(text), /data (sporzadzenia|oceny|wydania)/)) || firstDate(text);
  }
  if (type === 'ocena' || type === 'inny') out.levels = matchSkillLevels(text, skills);
  if (type === 'ipr' || type === 'ocena') out.goals = parseGoals(text);
  return out;
}

// ───────────── pseudonimizacja i strażnik ─────────────

const DIMINUTIVES = {
  jakub: ['Kuba', 'Kubuś'], aleksander: ['Olek', 'Alek'], aleksandra: ['Ola', 'Ala'], katarzyna: ['Kasia'], małgorzata: ['Gosia', 'Małgosia'],
  agnieszka: ['Aga'], magdalena: ['Magda'], joanna: ['Asia'], anna: ['Ania', 'Anka'], maria: ['Marysia'], zofia: ['Zosia'], julia: ['Julka'],
  zuzanna: ['Zuzia', 'Zuza'], wiktoria: ['Wika'], natalia: ['Natka'], weronika: ['Wera'], karolina: ['Karolcia'], gabriela: ['Gabrysia'],
  barbara: ['Basia'], elżbieta: ['Ela'], ewa: ['Ewka', 'Ewunia'], dominika: ['Domi'], helena: ['Hela'], hanna: ['Hania'], krystyna: ['Krysia'], teresa: ['Tereska'],
  michał: ['Michaś'], wojciech: ['Wojtek'], tomasz: ['Tomek'], piotr: ['Piotrek', 'Piotruś'], paweł: ['Pawełek'], krzysztof: ['Krzyś', 'Krzysiek'],
  grzegorz: ['Grześ', 'Grzesiek'], stanisław: ['Staś', 'Stasiek'], antoni: ['Antek'], franciszek: ['Franek'], jan: ['Jaś', 'Janek'], mateusz: ['Mati'],
  bartosz: ['Bartek'], bartłomiej: ['Bartek'], szymon: ['Szymek'], józef: ['Józek'], adam: ['Adaś'], łukasz: ['Łukaszek'], marek: ['Mareczek'], andrzej: ['Andrzejek', 'Jędrek'], robert: ['Robercik'], rafał: ['Rafałek'], marcin: ['Marcinek']
};

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UP = /^[A-ZŁŚŻŹĆŃÓĘĄ]/;
const SUFFIXES = '(?:a|y|i|ę|ą|o|u|e|em|ie|owi|om|ami|ach|ów|ego|emu|ej|owie|ek|ka|ki|ce|kę|kiem|ku|ci|cie|zie|rze)?';

function nameTokens(name) { return String(name || '').split(/[\s\-]+/).map((t) => t.replace(/[^\p{L}]/gu, '')).filter((t) => t.length >= 3); }

function nameRegex(token) {
  let stem = token.replace(/[aeiouyąęó]+$/i, '');
  if (stem.length < 3) stem = token;
  if (/(ek|eł|ec)$/i.test(token) && token.length >= 4) stem = token.slice(0, -2);
  const body = stem.length >= 5 ? `${esc(stem.slice(0, -1))}\\p{L}{0,6}` : stem.length >= 4 ? `${esc(stem)}\\p{L}{0,5}` : `${esc(token)}${SUFFIXES}`;
  return new RegExp(`(?<![\\p{L}{])${body}(?![\\p{L}}])`, 'giu');
}

// person: { firstName, lastName, pesel, birthDate, address }; extra: inne nazwiska (pozostali uczestnicy, terapeuci)
function secretsFor(person, extra = []) {
  const p = person || {};
  const list = [];
  const add = (value, ph, kind) => { if (value && String(value).trim().length >= 2) list.push({ value: String(value).trim(), ph, kind: kind || 'text' }); };
  if (p.firstName && p.lastName) { add(`${p.firstName} ${p.lastName}`, 'UCZESTNIK'); add(`${p.lastName} ${p.firstName}`, 'UCZESTNIK'); }
  for (const t of nameTokens(p.lastName)) add(t, 'NAZWISKO', 'name');
  for (const t of nameTokens(p.firstName)) { add(t, 'IMIE', 'name'); for (const d of DIMINUTIVES[t.toLowerCase()] || []) add(d, 'IMIE', 'name'); }
  if (p.pesel) add(String(p.pesel).replace(/\D/g, ''), 'PESEL', 'digits');
  for (const v of dateVariants(p.birthDate)) add(v, 'DATA_URODZENIA');
  add(p.address, 'ADRES');
  if (p.address) {
    const street = p.address.match(/(?:ul\.|ulica|al\.|os\.|pl\.)?\s*([\p{L}][\p{L}.\- ]{2,30}?)\s+\d/iu);
    if (street) add(street[1].trim(), 'ADRES');
    const pc = p.address.match(/\d{2}-\d{3}/); if (pc) add(pc[0], 'ADRES');
  }
  if (p.disability && p.disability.number) add(p.disability.number, 'NR_DOKUMENTU');
  for (const e of extra) {
    if (!e) continue;
    for (const t of nameTokens(e.firstName)) add(t, 'OSOBA', 'name');
    for (const t of nameTokens(e.lastName)) add(t, 'OSOBA', 'name');
    for (const t of nameTokens(e.name)) add(t, 'OSOBA', 'name');
  }
  return list.sort((a, b) => b.value.length - a.value.length);
}

const GENERIC = [
  ['PESEL', /(?<!\d)\d{11}(?!\d)/g],
  ['DATA', /\b\d{1,2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{2,4}\s*(?:r\.|roku)?/g],
  ['DATA', /\b\d{4}-\d{2}-\d{2}\b/g],
  ['DATA', /\b\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrze[sś]nia|pa[zź]dziernika|listopada|grudnia)\s+\d{4}\s*(?:r\.|roku)?/giu],
  ['EMAIL', /[\w.+-]+@[\w-]+\.[\w.]+/g],
  ['TELEFON', /(?:\+48[\s-]?)?(?<!\d)\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/g],
  ['ADRES', /\b\d{2}-\d{3}(?:[ \t]+[A-ZŁŚŻŹĆŃÓĘĄ][\p{L}-]+){0,3}/gu],
  ['ADRES', /\b(?:ul\.|ulica|ulicy|al\.|aleja|alei|os\.|osiedle|osiedlu|pl\.|plac)\s+[^\n,;]{2,40}?\s\d+[a-zA-Z]?(?:\s*\/\s*\d+[a-zA-Z]?)?/giu],
  ['NR_DOKUMENTU', /\b(?:nr|numer|znak|sygn\.?)\s*[:.]?\s*(?=[\w./\-]*\d)[\w./\-]{4,}/giu],
  ['OSOBA', /\b(?:mgr|dr|lek\.|lek|prof\.|prof|inż\.|pan|pani|pana|panią|panu)\s+(?:inż\.\s+|n\.\s*med\.\s+|hab\.\s+)?[A-ZŁŚŻŹĆŃÓĘĄ][\p{L}-]+(?:[ \t]+[A-ZŁŚŻŹĆŃÓĘĄ][\p{L}-]+){0,2}/gu],
  ['OSOBA', /\b(?:Przewodnicz\p{L}*|Członek|Członkowie|Lekarz|Psycholog|Podpis)[ \t]*[:\-–][ \t]*[A-ZŁŚŻŹĆŃÓĘĄ][\p{L}-]+(?:[ \t]+[A-ZŁŚŻŹĆŃÓĘĄ][\p{L}-]+){0,2}/gu]
];

function pseudonymize(text, person, extra) {
  let out = String(text || '');
  const hits = [];
  const mark = (ph, original) => { hits.push({ ph, original }); return `{{${ph}}}`; };
  for (const s of secretsFor(person, extra)) {
    if (s.kind === 'name') out = out.replace(nameRegex(s.value), (m) => (UP.test(m) ? mark(s.ph, m) : m));
    else if (s.kind === 'digits') out = out.replace(new RegExp(s.value.split('').join('\\s?'), 'g'), (m) => mark(s.ph, m));
    else out = out.replace(new RegExp(esc(s.value).replace(/\s+/g, '\\s+'), 'giu'), (m) => mark(s.ph, m));
  }
  for (const [ph, re] of GENERIC) out = out.replace(re, (m) => mark(ph, m));
  out = out.replace(/(\{\{(\w+)\}\})(\s*\{\{\2\}\})+/g, '$1');
  return { text: out, hits: hits.length };
}

const LEAK_LABEL = { UCZESTNIK: 'imię i nazwisko', IMIE: 'imię', NAZWISKO: 'nazwisko', PESEL: 'PESEL', DATA_URODZENIA: 'data urodzenia', ADRES: 'adres', OSOBA: 'dane innej osoby' };

function findLeaks(text, person, extra) {
  const t = String(text || '');
  const leaks = [];
  for (const s of secretsFor(person, extra)) {
    if (s.kind === 'name') { if ([...t.matchAll(nameRegex(s.value))].some((x) => UP.test(x[0]))) leaks.push(LEAK_LABEL[s.ph]); }
    else if (s.kind === 'digits') { if (t.replace(/\s/g, '').includes(s.value)) leaks.push('PESEL'); }
    else if (s.value.length >= 4 && strip(t.toLowerCase()).replace(/\s+/g, ' ').includes(strip(s.value.toLowerCase()).replace(/\s+/g, ' '))) leaks.push(LEAK_LABEL[s.ph] || 'dane osobowe');
  }
  if (/(?<!\d)\d{11}(?!\d)/.test(t)) leaks.push('numer PESEL');
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) leaks.push('adres e-mail');
  return [...new Set(leaks)];
}

// Znaczniki w odpowiedzi AI → bezosobowe określenia (wyniki analizy trafiają do karty uczestnika).
function unmark(text, ref = 'uczestnik') {
  return String(text || '').replace(/\{\{\s*(UCZESTNIK|IMIE|NAZWISKO)\s*\}\}(\s*\{\{\s*(IMIE|NAZWISKO)\s*\}\})?/g, ref).replace(/\{\{\s*[A-Z_]+\s*\}\}/g, '…').replace(/\s{2,}/g, ' ').trim();
}

module.exports = { CODES, DEGREES, DOC_TYPES, ADAPT, DEGREE_ADAPT, SUPERVISION_CODES, emptyDisability, describeDisability, localAdaptations, needsSupervision, isRisky, parseDate, peselValid, peselDecode, parsePersonal, parseDisability, matchSkillLevels, parseGoals, parseDocument, secretsFor, pseudonymize, findLeaks, unmark, norm };
