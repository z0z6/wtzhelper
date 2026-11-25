'use strict';
// Oceny okresowe (miesięczne, roczne) i kompleksowe – na podstawie ocen cząstkowych terapeuty.
// Ocena cząstkowa = stopień opanowania umiejętności z profilu pracowni w skali 0–4 w danym dniu.

const X = require('./text');
const { allSkills } = require('./planner');

const TYPES = { month: 'miesięczna', year: 'roczna', complex: 'kompleksowa' };

// ───────────── okresy ─────────────

function periodFor(type, date) {
  const d = X.parseIso(date) || new Date();
  const y = d.getFullYear(), m = d.getMonth();
  if (type === 'month') return { from: X.iso(new Date(y, m, 1, 12)), to: X.iso(new Date(y, m + 1, 0, 12)) };
  if (type === 'year') return { from: X.iso(new Date(y, 0, 1, 12)), to: X.iso(new Date(y, 11, 31, 12)) };
  if (type === 'complex') return { from: X.iso(new Date(y - 3, m + 1, 1, 12)), to: X.iso(new Date(y, m + 1, 0, 12)) };
  throw new Error('Nieznany rodzaj oceny.');
}

// Poprzedni okres tej samej długości (do porównań w ocenie miesięcznej).
function previousPeriod(from, to) {
  const a = X.parseIso(from), b = X.parseIso(to);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
  return { from: X.iso(new Date(a.getFullYear(), a.getMonth() - months, 1, 12)), to: X.iso(new Date(a.getFullYear(), a.getMonth(), 0, 12)) };
}

// Kolejne lata oceny kompleksowej (np. 3 okresy roczne).
function yearSlices(from, to) {
  const out = [];
  let a = X.parseIso(from);
  const end = X.parseIso(to);
  while (a <= end) {
    const b = new Date(a.getFullYear() + 1, a.getMonth(), 0, 12);
    out.push({ from: X.iso(a), to: X.iso(b > end ? end : b) });
    a = new Date(a.getFullYear() + 1, a.getMonth(), 1, 12);
  }
  return out;
}

// ───────────── statystyki ─────────────

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const monthKey = (d) => d.slice(0, 7);

function skillStats(marks, skillId, from, to) {
  const list = marks.filter((m) => m.skillId === skillId && m.date >= from && m.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return { n: 0 };
  const months = [...new Set(list.map((m) => monthKey(m.date)))];
  const inMonth = (k) => avg(list.filter((m) => monthKey(m.date) === k).map((m) => m.level));
  const a = avg(list.map((m) => m.level));
  return { n: list.length, avg: a, level: Math.round(a), start: inMonth(months[0]), end: inMonth(months[months.length - 1]), last: list[list.length - 1].level, months: months.length };
}

// Wszystkie statystyki potrzebne do oceny jednego uczestnika.
function computeStats(a, { workshops, marks }) {
  const ws = a.workshopIds.map((id) => workshops.find((w) => w.id === id)).filter(Boolean);
  const prev = previousPeriod(a.from, a.to);
  const years = a.type === 'complex' ? yearSlices(a.from, a.to) : [];
  const mine = marks.filter((m) => m.participantId === a.participantId);
  const skills = {};
  for (const w of ws) for (const s of allSkills(w)) {
    const st = skillStats(mine, s.id, a.from, a.to);
    st.prev = skillStats(mine, s.id, prev.from, prev.to);
    st.years = years.map((y) => skillStats(mine, s.id, y.from, y.to));
    skills[s.id] = st;
  }
  const areaAvg = (area) => avg(area.skills.map((s) => skills[s.id]).filter((x) => x && x.n).map((x) => x.avg));
  const areas = {};
  for (const w of ws) for (const ar of w.areas) areas[ar.id] = { avg: areaAvg(ar), rated: ar.skills.filter((s) => skills[s.id] && skills[s.id].n).length, total: ar.skills.length };
  const all = Object.values(skills).filter((x) => x.n);
  return { skills, areas, years, prev, overall: avg(all.map((x) => x.avg)), rated: all.length, marks: all.reduce((s, x) => s + x.n, 0) };
}

const pct = (v) => (v == null ? '' : Math.round((v / 4) * 100) + '%');
const num = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toString().replace('.', ','));
const signed = (v) => (v == null ? '–' : v > 0.04 ? '+' + num(v) : v < -0.04 ? '−' + num(-v) : '0');

// Zmiana poziomu umiejętności: w ocenie miesięcznej względem poprzedniego miesiąca,
// w rocznej i kompleksowej – między początkiem a końcem okresu.
function change(type, st) {
  if (!st || !st.n) return null;
  if (type === 'month') return st.prev && st.prev.n ? st.avg - st.prev.avg : null;
  if (type === 'complex') { const ys = st.years.filter((y) => y.n); return ys.length >= 2 ? ys[ys.length - 1].avg - ys[0].avg : (st.months >= 2 ? st.end - st.start : null); }
  return st.months >= 2 ? st.end - st.start : null;
}

// ───────────── teksty ─────────────

// {lista} = nazwy umiejętności; przy jednej umiejętności „takich umiejętności, jak:” → „umiejętności:”
const fill = (tpl, person, list, extra = {}) => {
  let t = String(tpl || '');
  if (list.length === 1) t = t.replace(/takich umiejętności, jak:/g, 'umiejętności:').replace(/takich umiejętnościach, jak:/g, 'umiejętnościach:');
  t = t.replace(/\{lista\}/g, X.joinList(list.map(X.lower)));
  for (const [k, v] of Object.entries(extra)) t = t.split(`{${k}}`).join(v);
  return X.personalize(t, person);
};
const COMPARE = { month: 'poprzednim miesiącem', year: 'początkiem okresu oceny', complex: 'początkiem okresu oceny' };

function areaText(area, stats, type, settings, person) {
  const S = settings.scale, PH = settings.phrases;
  const rated = area.skills.filter((s) => stats.skills[s.id] && stats.skills[s.id].n);
  if (!rated.length) return X.personalize(PH.none, person);
  const out = [];
  for (let lv = 4; lv >= 0; lv--) {
    const at = rated.filter((s) => stats.skills[s.id].level === lv).map((s) => s.name);
    if (at.length && S[lv]) out.push(fill(S[lv].text, person, at));
  }
  const up = [], down = [];
  let compared = 0;
  for (const s of rated) {
    const c = change(type, stats.skills[s.id]);
    if (c == null) continue;
    compared++;
    if (c >= 0.5) up.push(s.name); else if (c <= -0.5) down.push(s.name);
  }
  if (up.length) out.push(fill(PH.progress, person, up, { 'porównanie': COMPARE[type] }));
  if (down.length) out.push(fill(PH.regress, person, down));
  if (compared && (up.length || down.length) && up.length + down.length < compared) out.push(X.personalize(PH.stable, person));
  else if (compared && !up.length && !down.length) out.push(X.personalize(PH.stable.replace(/pozostałych /, ''), person));
  return out.join(' ');
}

function levelName(settings, v) { const s = settings.scale[Math.round(v)]; return s ? s.label.toLowerCase() : ''; }

function workshopsOf(a, workshops) { return a.workshopIds.map((id) => workshops.find((w) => w.id === id)).filter(Boolean); }

function autoSummary(a, stats, ctx) {
  const { settings, person } = ctx;
  const ws = workshopsOf(a, ctx.workshops);
  if (!stats.rated) return '';
  const rated = ws.flatMap((w) => w.areas).filter((ar) => stats.areas[ar.id] && stats.areas[ar.id].avg != null);
  const best = [...rated].sort((x, y) => stats.areas[y.id].avg - stats.areas[x.id].avg);
  const per = { month: 'W ocenianym miesiącu', year: 'W ocenianym roku', complex: 'W okresie objętym oceną kompleksową' }[a.type];
  const work = ws.filter((w) => !w.general).map((w) => w.name);
  const parts = [];
  parts.push(`${per} {osoba} [uczestniczył|uczestniczyła] w zajęciach${work.length ? ' ' + X.joinList(work.map((n) => n.replace(/^Pracownia /i, 'pracowni ')), ' i ') : ''}.`);
  parts.push(`Łączny stopień opanowania ocenianych umiejętności wynosi ${pct(stats.overall)} (średnio: ${levelName(settings, stats.overall)}; ${stats.rated} ${X.plural(stats.rated, 'umiejętność', 'umiejętności', 'umiejętności')}, ${stats.marks} ${X.plural(stats.marks, 'ocena cząstkowa', 'oceny cząstkowe', 'ocen cząstkowych')}).`);
  if (best.length >= 2) parts.push(`Najwyższy poziom {osoba} [osiągnął|osiągnęła] w obszarze „${best[0].name}”, a najwięcej wsparcia wymaga w obszarze „${best[best.length - 1].name}”.`);
  const changes = Object.values(stats.skills).map((st) => change(a.type, st)).filter((c) => c != null);
  if (changes.length) {
    const up = changes.filter((c) => c >= 0.5).length, down = changes.filter((c) => c <= -0.5).length;
    if (up > down) parts.push(`W porównaniu z ${a.type === 'month' ? 'poprzednim miesiącem' : 'początkiem okresu'} widoczny jest postęp w ${up} ${up === 1 ? 'umiejętności' : 'umiejętnościach'}.`);
    else if (down > up) parts.push('W części umiejętności widoczne jest obniżenie poziomu wykonania, które wymaga obserwacji i dostosowania form wsparcia.');
    else parts.push('Poziom funkcjonowania w ocenianych obszarach jest stabilny.');
  }
  return X.personalize(parts.join(' '), person);
}

function autoRecommendations(a, stats, ctx) {
  const ws = workshopsOf(a, ctx.workshops);
  const rated = ws.flatMap(allSkills).filter((s) => stats.skills[s.id] && stats.skills[s.id].n);
  if (!rated.length) return '';
  const weak = rated.filter((s) => stats.skills[s.id].level <= 2).sort((x, y) => stats.skills[x.id].avg - stats.skills[y.id].avg).slice(0, 5).map((s) => s.name);
  const mid = rated.filter((s) => stats.skills[s.id].level === 3).slice(0, 4).map((s) => s.name);
  const strong = rated.filter((s) => stats.skills[s.id].level === 4).slice(0, 4).map((s) => s.name);
  const out = [];
  if (weak.length) out.push(`Kontynuowanie ćwiczeń z pomocą terapeuty w zakresie takich umiejętności, jak: ${X.joinList(weak.map(X.lower))}.`);
  if (mid.length) out.push(`Stopniowe zmniejszanie pomocy i dążenie do samodzielności w zakresie takich umiejętności, jak: ${X.joinList(mid.map(X.lower))}.`);
  if (strong.length) out.push(`Utrwalanie opanowanych umiejętności (${X.joinList(strong.map(X.lower))}) i wykorzystywanie ich w nowych, bardziej złożonych zadaniach.`);
  if (a.type !== 'month') out.push('Aktualizacja celów indywidualnego programu rehabilitacji z uwzględnieniem wyników oceny.');
  return out.map((x) => '– ' + x).join('\n');
}

// Odświeża teksty oznaczone jako automatyczne (nieedytowane ręcznie).
function refreshAuto(a, ctx) {
  const stats = computeStats(a, ctx);
  a.sections = a.sections || {};
  for (const w of workshopsOf(a, ctx.workshops)) {
    // profil bez żadnej oceny w okresie (np. inna pracownia) nie trafia do dokumentu
    const any = w.areas.some((ar) => ar.skills.some((s) => stats.skills[s.id] && stats.skills[s.id].n));
    for (const ar of w.areas) {
      const cur = a.sections[ar.id];
      if (!cur || cur.auto) a.sections[ar.id] = { text: any ? areaText(ar, stats, a.type, ctx.settings, ctx.person) : '', auto: true };
    }
  }
  if (a.summaryAuto !== false) a.summary = autoSummary(a, stats, ctx);
  if (a.recommendationsAuto !== false) a.recommendations = autoRecommendations(a, stats, ctx);
  if (a.type === 'complex' && (!a.stance || a.stance.auto !== false)) {
    const opt = ctx.settings.stances.find((s) => s.id === ((a.stance && a.stance.option) || 'kontynuacja')) || ctx.settings.stances[0];
    if (opt) a.stance = { option: opt.id, text: X.personalize(opt.text, ctx.person), auto: true };
  }
  return { assessment: a, stats };
}

function newAssessment(id, { type, participant, date, workshops }) {
  const { from, to } = periodFor(type, date);
  const general = workshops.find((w) => w.general);
  const wids = [participant.workshopId, ...(participant.workshopsHistory || [])].filter((x, i, arr) => x && arr.indexOf(x) === i && workshops.some((w) => w.id === x));
  if (general) wids.push(general.id);
  return {
    id, type, participantId: participant.id, from, to, date: X.today(), workshopIds: wids,
    sections: {}, ipr: {}, summary: '', recommendations: '', summaryAuto: true, recommendationsAuto: true,
    stance: type === 'complex' ? { option: 'kontynuacja', text: '', auto: true } : null, notes: ''
  };
}

const IPR_STATUS = [
  { value: 'zrealizowany', label: 'zrealizowany' },
  { value: 'czesciowo', label: 'zrealizowany częściowo' },
  { value: 'w-trakcie', label: 'w trakcie realizacji' },
  { value: 'niezrealizowany', label: 'niezrealizowany' }
];

// ───────────── dokument ─────────────

function buildAssessmentModel(a, ctx) {
  const { settings, person, workshops } = ctx;
  const T = settings.template, P = settings.profile;
  const stats = computeStats(a, ctx);
  const ws = workshopsOf(a, workshops);
  const blocks = [];
  const just = T.justify ? 'both' : 'left';
  const p = (text, o = {}) => blocks.push({ kind: 'p', align: 'left', runs: [{ text }], ...o });
  const heading = (text) => blocks.push({ kind: 'heading', align: 'left', runs: [{ text, bold: true }] });
  const sub = (text) => blocks.push({ kind: 'subheading', align: 'left', runs: [{ text, bold: true, italic: true }] });
  const body = (text) => { for (const l of String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) blocks.push({ kind: 'body', align: just, runs: [{ text: l }] }); };
  const field = (label, value) => { if (value) blocks.push({ kind: 'field', align: 'left', runs: [{ text: label + ': ' }, { text: value, bold: true }] }); };
  const lines = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  if (P.city || a.date) p([P.city, a.date ? (P.city ? 'dnia ' : '') + X.fmtDate(a.date) : ''].filter(Boolean).join(', '), { align: 'right', kind: 'meta' });
  const header = lines(T.header || P.institution);
  header.forEach((l, i) => p(l, { kind: 'meta', spaceAfter: i === header.length - 1 ? 14 : 0 }));
  const title = T.titles[a.type + '_a'];
  p(title, { align: 'center', kind: 'title', runs: [{ text: title, bold: true }] });

  field('Uczestni' + (person.gender === 'k' ? 'czka' : 'k'), X.fullName(person));
  field('Data urodzenia', X.fmtDate(person.birthDate));
  if (a.type === 'complex') field('Data przyjęcia do warsztatu', X.fmtDate(person.admission));
  const work = ws.filter((w) => !w.general);
  field(work.length > 1 ? 'Pracownie' : 'Pracownia', work.map((w) => w.name).join(', '));
  field('Okres oceny', a.type === 'month' ? `${X.monthLabel(a.from)} (${X.fmtDate(a.from, false)} – ${X.fmtDate(a.to, false)})` : `${X.fmtDate(a.from, false)} – ${X.fmtDate(a.to, false)}`);
  const sc = settings.scale.map((s) => `${s.value} – ${s.label.toLowerCase()}`).join(', ');
  blocks.push({ kind: 'note', align: 'left', runs: [{ text: `Skala ocen cząstkowych (stopień opanowania umiejętności): ${sc}. Wynik procentowy = średnia ocen / 4.`, italic: true }] });

  const tableFor = (w) => {
    const yrs = stats.years;
    let cols, row;
    if (a.type === 'month') {
      cols = [{ text: 'Umiejętność', w: 46 }, { text: 'Liczba ocen', w: 11 }, { text: 'Średnia', w: 11 }, { text: 'Poziom', w: 18 }, { text: 'Zmiana', w: 14 }];
      row = (s, st) => [s.name, String(st.n), num(st.avg), levelName(settings, st.avg), signed(change(a.type, st))];
    } else if (a.type === 'year') {
      cols = [{ text: 'Umiejętność', w: 37 }, { text: 'Początek okresu', w: 13 }, { text: 'Koniec okresu', w: 13 }, { text: 'Średnia', w: 10 }, { text: 'Opanowanie', w: 16 }, { text: 'Zmiana', w: 11 }];
      row = (s, st) => [s.name, num(st.start), num(st.end), num(st.avg), pct(st.avg), signed(change(a.type, st))];
    } else {
      const yw = Math.max(8, Math.floor(36 / Math.max(1, yrs.length)));
      cols = [{ text: 'Umiejętność', w: 100 - yw * yrs.length - 27 }, ...yrs.map((y, i) => ({ text: `Rok ${i + 1}\n${X.fmtDate(y.from, false).slice(3)}–${X.fmtDate(y.to, false).slice(3)}`, w: yw })), { text: 'Opanowanie', w: 16 }, { text: 'Zmiana', w: 11 }];
      row = (s, st) => [s.name, ...st.years.map((y) => num(y.n ? y.avg : null)), pct(st.avg), signed(change(a.type, st))];
    }
    const rows = [];
    for (const ar of w.areas) {
      const rr = ar.skills.filter((s) => stats.skills[s.id] && stats.skills[s.id].n);
      if (!rr.length) continue;
      rows.push({ section: `${ar.name} – ${pct(stats.areas[ar.id].avg)}` });
      for (const s of rr) rows.push(row(s, stats.skills[s.id]));
    }
    if (rows.length) blocks.push({ kind: 'table', cols, rows, small: true });
  };

  let n = 0;
  for (const w of ws) {
    const hasText = w.areas.some((ar) => a.sections[ar.id] && String(a.sections[ar.id].text || '').trim());
    if (!hasText) continue;
    n++;
    heading(`${n}. ${w.general ? 'Funkcjonowanie w obszarach ogólnych' : w.name}`);
    for (const ar of w.areas) {
      const t = a.sections[ar.id] && String(a.sections[ar.id].text || '').trim();
      if (!t) continue;
      sub(ar.name);
      body(t);
    }
    if (T.skillTable !== false) tableFor(w);
  }

  const goals = (person.iprGoals || []).filter((g) => String(g.text || '').trim());
  if (goals.length && a.type !== 'month') {
    n++;
    heading(`${n}. Realizacja celów indywidualnego programu rehabilitacji`);
    const st = (v) => (IPR_STATUS.find((x) => x.value === v) || { label: '–' }).label;
    blocks.push({ kind: 'table', cols: [{ text: 'Cel IPR', w: 48 }, { text: 'Stopień realizacji', w: 20 }, { text: 'Uwagi', w: 32 }], rows: goals.map((g) => [g.text, st((a.ipr[g.id] || {}).status), (a.ipr[g.id] || {}).comment || '']) });
  }
  if (String(a.summary || '').trim()) { n++; heading(`${n}. Podsumowanie`); body(a.summary); }
  if (String(a.recommendations || '').trim()) {
    n++; heading(`${n}. ${a.type === 'month' ? 'Zalecenia do dalszej pracy' : 'Wnioski i zalecenia do dalszej rehabilitacji'}`);
    for (const l of lines(a.recommendations)) { const m = /^[-–•*]\s*(.*)$/.exec(l); blocks.push({ kind: m ? 'bullet' : 'body', align: just, runs: [{ text: m ? m[1] : l }] }); }
  }
  if (a.type === 'complex' && a.stance && String(a.stance.text || '').trim()) { n++; heading(`${n}. Stanowisko rady programowej w kwestii osiągniętych postępów`); body(a.stance.text); }

  if (a.type === 'complex') {
    blocks.push({ kind: 'p', align: 'left', runs: [{ text: 'Podpisy członków rady programowej:' }], spaceBefore: 24 });
    for (const m of lines(T.council)) blocks.push({ kind: 'council', align: 'left', runs: [{ text: '…………………………………………  ' + m }] });
  } else {
    const ins = work.map((w) => w.instructor).filter(Boolean);
    blocks.push({ kind: 'sign', align: 'center', runs: [{ text: '…………………………………………' }], first: true });
    blocks.push({ kind: 'sign', align: 'center', runs: [{ text: [ins[0] || P.name, P.title].filter(Boolean).join(', ') || '(podpis terapeuty)' }] });
  }
  if (String(T.footnote || '').trim()) lines(T.footnote).forEach((l, i) => blocks.push({ kind: 'footnote', align: 'left', runs: [{ text: l, italic: true }], first: i === 0 }));
  return { blocks, stats, format: { font: T.font, size: Number(T.fontSize) || 12, lineSpacing: Number(T.lineSpacing) || 1.15, marginCm: Number(T.marginCm) || 2, indent: !!T.firstLineIndent, landscape: false } };
}

function assessmentTitle(a, person) {
  const kind = { month: 'Ocena miesięczna', year: 'Ocena roczna', complex: 'Ocena kompleksowa' }[a.type];
  return `${kind} – ${X.fullName(person)} – ${a.type === 'month' ? X.monthLabel(a.from) : `${X.fmtDate(a.from, false)}–${X.fmtDate(a.to, false)}`}`;
}

module.exports = { TYPES, IPR_STATUS, periodFor, previousPeriod, yearSlices, skillStats, computeStats, change, areaText, autoSummary, autoRecommendations, refreshAuto, newAssessment, buildAssessmentModel, assessmentTitle, pct, num, signed, workshopsOf };
