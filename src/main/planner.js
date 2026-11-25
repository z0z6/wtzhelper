'use strict';
// Generator planów pracy (dzień / tydzień / miesiąc) dla pracowni WTZ.
// Zasada: zajęcia w blokach pracowni pochodzą WYŁĄCZNIE z banku zajęć tej pracowni, a w blokach ogólnych –
// z profilu „Umiejętności ogólne”. Dobór uwzględnia potrzeby grupy (oceny cząstkowe) i równomierne
// pokrycie wszystkich umiejętności z profilu.

const X = require('./text');
const DOC = require('./documents');

// ───────────── kalendarz ─────────────

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day, 12);
}

// Dni ustawowo wolne od pracy w Polsce (od 2025 r. także Wigilia).
function holidays(y) {
  const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return X.iso(x); };
  const e = easter(y);
  const fixed = ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26'];
  if (y >= 2025) fixed.push('12-24');
  return new Set([...fixed.map((d) => `${y}-${d}`), X.iso(e), add(e, 1), add(e, 49), add(e, 60)]);
}

const isWeekday = (d) => d.getDay() >= 1 && d.getDay() <= 5;

function mondayOf(s) {
  const d = X.parseIso(s);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

// Zakres dat planu i lista dni zajęć.
function planRange(type, start) {
  const d = X.parseIso(start);
  if (!d) throw new Error('Podaj datę planu.');
  if (type === 'day') return { from: X.iso(d), to: X.iso(d) };
  if (type === 'week') { const m = mondayOf(start); const f = new Date(m); f.setDate(f.getDate() + 4); return { from: X.iso(m), to: X.iso(f) }; }
  if (type === 'month') return { from: X.iso(new Date(d.getFullYear(), d.getMonth(), 1, 12)), to: X.iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)) };
  throw new Error('Nieznany rodzaj planu.');
}

function workDays(from, to, skipHolidays = true) {
  const out = [];
  const d = X.parseIso(from), end = X.parseIso(to);
  const hol = new Map();
  while (d <= end) {
    const y = d.getFullYear();
    if (!hol.has(y)) hol.set(y, holidays(y));
    const s = X.iso(d);
    if (isWeekday(d) && !(skipHolidays && hol.get(y).has(s))) out.push(s);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// Tygodnie (poniedziałek–piątek) w zakresie dat.
function weeksIn(from, to) {
  const weeks = [];
  let m = mondayOf(from);
  const end = X.parseIso(to);
  while (m <= end) {
    const f = new Date(m); f.setDate(f.getDate() + 4);
    const a = X.iso(m) < from ? from : X.iso(m);
    const b = X.iso(f) > to ? to : X.iso(f);
    weeks.push({ from: a, to: b });
    m = new Date(m); m.setDate(m.getDate() + 7);
  }
  return weeks;
}

// Temat tygodnia z listy tematów miesiąca (kolejny tydzień = kolejny temat).
function themeFor(themes, date) {
  const d = X.parseIso(date);
  const list = (themes && themes[d.getMonth()]) || [];
  if (!list.length) return '';
  const firstMon = mondayOf(X.iso(new Date(d.getFullYear(), d.getMonth(), 1, 12)));
  const idx = Math.max(0, Math.floor((mondayOf(date) - firstMon) / (7 * 864e5)));
  return list[Math.min(idx, list.length - 1)] || list[idx % list.length];
}

// ───────────── potrzeby grupy ─────────────

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Ostatnia ocena cząstkowa każdego uczestnika z każdej umiejętności (do daty włącznie).
function latestLevels(marks, until) {
  const out = new Map(); // participantId -> Map(skillId -> {level, date})
  for (const m of marks) {
    if (until && m.date > until) continue;
    if (!out.has(m.participantId)) out.set(m.participantId, new Map());
    const cur = out.get(m.participantId).get(m.skillId);
    if (!cur || m.date >= cur.date) out.get(m.participantId).set(m.skillId, { level: m.level, date: m.date });
  }
  return out;
}

// Priorytet umiejętności: im niższy poziom grupy, tym wyższy priorytet (brak ocen = średni).
function skillNeeds(skillIds, participants, levels) {
  const need = new Map();
  for (const s of skillIds) {
    const vals = participants.map((p) => levels.get(p.id) && levels.get(p.id).get(s)).filter(Boolean).map((x) => x.level);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 2;
    need.set(s, 5 - avg); // 1 (opanowane) … 5 (brak umiejętności)
  }
  return need;
}

const allSkills = (w) => (w ? w.areas.flatMap((a) => a.skills) : []);
const skillMap = (...ws) => new Map(ws.filter(Boolean).flatMap(allSkills).map((s) => [s.id, s]));

// ───────────── generowanie ─────────────

function makeCtx({ workshop, general, participants = [], marks = [], settings, until }) {
  const levels = latestLevels(marks, until);
  const ids = [...allSkills(workshop), ...allSkills(general)].map((s) => s.id);
  return { workshop, general, participants, settings, levels, need: skillNeeds(ids, participants, levels), skills: skillMap(workshop, general) };
}

// Praca indywidualna: najsłabsza umiejętność uczestnika w danych zajęciach oraz – przy narzędziach ostrych,
// gorących i maszynach – nadzór dla osób, których rodzaj lub stopień niepełnosprawności tego wymaga.
function individualFor(ctx, skills, title) {
  if (!ctx.settings.planning || ctx.settings.planning.individual === false) return [];
  const risky = DOC.isRisky(title, ...skills.map((s) => (ctx.skills.get(s) || {}).name));
  const out = [];
  for (const p of ctx.participants) {
    const lv = ctx.levels.get(p.id);
    let best = null;
    if (lv) for (const s of skills) {
      const x = lv.get(s);
      if (x && x.level < 4 && (!best || x.level < best.level)) best = { skillId: s, level: x.level };
    }
    const supervision = risky && DOC.needsSupervision(p);
    if (best || supervision) out.push({ participantId: p.id, ...(best || {}), ...(supervision ? { supervision: true } : {}) });
  }
  return out;
}

const newBlockId = (r) => 'b' + Math.floor(r() * 1e9).toString(36);

// Wypełnia wskazane dni planu. Liczniki użycia uwzględniają dni, których nie zmieniamy.
function fillDays(plan, dates, ctx, seed) {
  const r = rng(seed);
  const schedule = ctx.settings.schedule || [];
  const used = new Map(); // activityId -> liczba użyć w planie
  const covered = new Map(); // skillId -> liczba ćwiczeń w planie
  const keep = plan.days.filter((d) => !dates.includes(d.date));
  for (const d of keep) for (const b of d.blocks) if (b.activityId) { used.set(b.activityId, (used.get(b.activityId) || 0) + 1); for (const s of b.skills || []) covered.set(s, (covered.get(s) || 0) + 1); }
  let yesterday = new Set();
  const newDays = [];
  for (const date of dates) {
    const today = new Set();
    const blocks = schedule.map((slot) => {
      const base = { id: newBlockId(r), start: slot.start, end: slot.end, kind: slot.kind, label: slot.label, activityId: null, title: slot.label, goal: '', methods: '', materials: '', skills: [], individual: [], note: '' };
      const src = slot.kind === 'activity' ? ctx.workshop : slot.kind === 'general' ? (ctx.general && ctx.general.id !== ctx.workshop.id ? ctx.general : null) : null;
      if (!src || !src.activities.length) return base;
      let pool = src.activities.filter((a) => !today.has(a.id) && a.skills.length);
      if (!pool.length) pool = src.activities.filter((a) => a.skills.length);
      if (!pool.length) return base;
      const score = (a) => {
        const need = a.skills.reduce((s, id) => s + (ctx.need.get(id) || 3), 0) / a.skills.length;
        const fresh = a.skills.filter((id) => !covered.get(id)).length / a.skills.length;
        return need + 2.5 * fresh - 2 * (used.get(a.id) || 0) - (yesterday.has(a.id) ? 3 : 0) + r() * 1.6;
      };
      const best = pool.map((a) => [a, score(a)]).sort((x, y) => y[1] - x[1])[0][0];
      today.add(best.id);
      used.set(best.id, (used.get(best.id) || 0) + 1);
      for (const s of best.skills) covered.set(s, (covered.get(s) || 0) + 1);
      return { ...base, activityId: best.id, title: best.name, goal: best.goal || '', methods: best.methods || '', materials: best.materials || '', skills: [...best.skills], individual: slot.kind === 'activity' ? individualFor(ctx, best.skills, best.name) : [] };
    });
    yesterday = today;
    newDays.push({ date, blocks, note: '' });
  }
  plan.days = [...keep, ...newDays].sort((a, b) => a.date.localeCompare(b.date));
  return plan;
}

// Cele planu: najbardziej potrzebne umiejętności spośród ćwiczonych w planie.
function autoGoals(plan, ctx) {
  const counts = new Map();
  for (const d of plan.days) for (const b of d.blocks) if (b.kind === 'activity') for (const s of b.skills) counts.set(s, (counts.get(s) || 0) + 1);
  const ranked = [...counts.keys()].sort((a, b) => (ctx.need.get(b) || 3) - (ctx.need.get(a) || 3) || counts.get(b) - counts.get(a));
  const top = ranked.slice(0, plan.type === 'day' ? 3 : plan.type === 'week' ? 4 : 6).map((s) => X.lower(ctx.skills.get(s).name));
  const goals = [];
  if (top.length) goals.push(`Doskonalenie umiejętności: ${X.joinList(top)}.`);
  for (const g of (ctx.workshop.goals || []).slice(0, plan.type === 'month' ? 3 : 1)) goals.push(g);
  return goals.join('\n');
}

function generatePlan({ id, type, start, workshop, general, participants, marks, settings, seed = 1, theme }) {
  if (!workshop) throw new Error('Wybierz pracownię.');
  if (!workshop.activities.some((a) => a.skills.length)) throw new Error(`Bank zajęć pracowni „${workshop.name}” jest pusty – dodaj zajęcia w profilu pracowni.`);
  const { from, to } = planRange(type, start);
  const dates = workDays(from, to, !settings.planning || settings.planning.skipHolidays !== false);
  if (!dates.length) throw new Error('W wybranym okresie nie ma dni zajęć (weekend lub dzień ustawowo wolny).');
  const ctx = makeCtx({ workshop, general, participants, marks, settings, until: to });
  const plan = {
    id, type, workshopId: workshop.id, from, to, seed,
    participantIds: participants.map((p) => p.id),
    theme: theme != null ? theme : themeFor(settings.themes, from),
    weeks: type === 'month' ? weeksIn(from, to).map((w) => ({ ...w, theme: themeFor(settings.themes, w.from) })) : [],
    goals: '', notes: '', days: []
  };
  fillDays(plan, dates, ctx, seed);
  plan.goals = autoGoals(plan, ctx);
  return plan;
}

function regenerateDay(plan, date, ctx, seed) {
  return fillDays(plan, [date], ctx, seed);
}

// Sprawdza, czy plan w pełni odpowiada profilowi pracowni (zajęcia i umiejętności z profilu).
function validatePlan(plan, workshop, general) {
  const acts = new Map([...(workshop ? workshop.activities : []), ...(general ? general.activities : [])].map((a) => [a.id, a]));
  const skills = skillMap(workshop, general);
  const problems = [];
  for (const d of plan.days) for (const b of d.blocks) {
    if (b.activityId && !acts.has(b.activityId)) problems.push(`${X.fmtDate(d.date, false)} ${b.start}: zajęcia „${b.title}” spoza banku pracowni`);
    for (const s of b.skills || []) if (!skills.has(s)) problems.push(`${X.fmtDate(d.date, false)} ${b.start}: umiejętność spoza profilu`);
  }
  return problems;
}

// ───────────── dokument ─────────────

function rangeLabel(plan) {
  if (plan.type === 'day') return X.dayLabel(plan.from);
  if (plan.type === 'month') return `${X.monthLabel(plan.from)} (${X.fmtDate(plan.from, false)} – ${X.fmtDate(plan.to, false)})`;
  return `${X.fmtDate(plan.from, false)} – ${X.fmtDate(plan.to, false)}`;
}

function planTitle(plan, workshop) {
  const kind = { day: 'Plan dzienny', week: 'Plan tygodniowy', month: 'Plan miesięczny' }[plan.type];
  return `${kind} – ${workshop ? workshop.name : ''} – ${rangeLabel(plan)}`;
}

function buildPlanModel(plan, { workshop, general, participants, settings, scale }) {
  const T = settings.template;
  const P = settings.profile;
  const skills = skillMap(workshop, general);
  const sname = (id) => (skills.get(id) ? skills.get(id).name : '');
  const byId = new Map(participants.map((p) => [p.id, p]));
  const blocks = [];
  const p = (text, o = {}) => blocks.push({ kind: 'p', align: 'left', runs: [{ text }], ...o });
  const heading = (text) => blocks.push({ kind: 'heading', align: 'left', runs: [{ text, bold: true }] });
  const field = (label, value) => { if (value) blocks.push({ kind: 'field', align: 'left', runs: [{ text: label + ': ' }, { text: value, bold: true }] }); };
  const lines = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const place = [P.city, X.fmtDate(X.today())].filter(Boolean).join(', ');
  if (P.city) p(place, { align: 'right', kind: 'meta' });
  const header = lines(T.header || P.institution);
  header.forEach((l, i) => p(l, { kind: 'meta', spaceAfter: i === header.length - 1 ? 10 : 0 }));
  p(T.titles[plan.type], { align: 'center', kind: 'title', runs: [{ text: T.titles[plan.type], bold: true }] });
  field('Pracownia', workshop ? workshop.name : '');
  field('Prowadzący', (workshop && workshop.instructor) || P.name);
  field('Okres', rangeLabel(plan));
  if (plan.type !== 'month') field('Temat przewodni', plan.theme);
  const people = plan.participantIds.map((id) => byId.get(id)).filter(Boolean);
  field('Uczestnicy', people.map(X.shortName).join(', '));

  const goalLines = lines(plan.goals);
  if (goalLines.length) {
    heading({ day: 'Cele dnia', week: 'Cele tygodnia', month: 'Cele miesiąca' }[plan.type]);
    for (const g of goalLines) blocks.push({ kind: 'bullet', align: 'left', runs: [{ text: g.replace(/^[-–•*]\s*/, '') }] });
  }

  const lvl = (v) => (scale[v] ? scale[v].label.toLowerCase() : '');
  // dostosowania do rodzaju i stopnia niepełnosprawności uczestników grupy
  const adaptRows = people.filter((pp) => (pp.disability && (pp.disability.degree || (pp.disability.codes || []).length)) || (pp.adaptations || []).length)
    .map((pp) => [X.shortName(pp), DOC.describeDisability(pp.disability) || '—', (pp.adaptations && pp.adaptations.length ? pp.adaptations : DOC.localAdaptations(pp.disability)).map((a) => '– ' + a).join('\n')]);
  if (adaptRows.length) {
    heading('Dostosowania do rodzaju i stopnia niepełnosprawności uczestników');
    blocks.push({ kind: 'table', small: true, cols: [{ text: 'Uczestnik', w: 14 }, { text: 'Orzeczenie', w: 26 }, { text: 'Dostosowania form i metod pracy', w: 60 }], rows: adaptRows });
  }
  const indiv = (b) => (b.individual || []).map((x) => {
    const pp = byId.get(x.participantId);
    if (!pp) return '';
    const parts = [];
    if (x.skillId && sname(x.skillId)) parts.push(`${X.lower(sname(x.skillId))} (obecnie: ${lvl(x.level)})`);
    if (x.supervision) parts.push('nadzór i asekuracja przy narzędziach');
    return parts.length ? `${X.shortName(pp)}: ${parts.join('; ')}` : '';
  }).filter(Boolean).join('\n');
  const showIndiv = plan.days.some((d) => d.blocks.some((b) => (b.individual || []).length));
  const dayTable = (d) => {
    const cols = [{ text: 'Godz.', w: 9 }, { text: 'Zajęcia', w: 26 }, { text: 'Cel i rozwijane umiejętności', w: 30 }, { text: 'Metody, formy i materiały', w: 20 }];
    if (showIndiv) cols.push({ text: 'Praca indywidualna', w: 20 });
    const rows = d.blocks.map((b) => {
      const sk = (b.skills || []).map(sname).filter(Boolean);
      const row = [
        `${b.start}–${b.end}`,
        [{ text: b.title, bold: !!b.activityId }, b.note ? { text: b.note, italic: true } : null].filter(Boolean),
        [b.goal, sk.length ? 'Umiejętności: ' + sk.map(X.lower).join(', ') + '.' : ''].filter(Boolean).join('\n'),
        [b.methods ? 'Metody: ' + b.methods : '', b.materials ? 'Materiały: ' + b.materials : ''].filter(Boolean).join('\n')
      ];
      if (showIndiv) row.push(indiv(b));
      return row;
    });
    blocks.push({ kind: 'table', cols, rows });
    if (d.note) p('Uwagi: ' + d.note, { kind: 'body' });
  };

  if (plan.type === 'day') {
    heading('Przebieg dnia');
    dayTable(plan.days[0] || { blocks: [] });
  } else if (plan.type === 'week') {
    for (const d of plan.days) { heading(X.dayLabel(d.date).replace(/^./, (c) => c.toUpperCase())); dayTable(d); }
  } else {
    heading('Plan miesiąca w podziale na tygodnie');
    const rows = (plan.weeks || []).map((w) => {
      const days = plan.days.filter((d) => d.date >= w.from && d.date <= w.to);
      const acts = []; const sk = new Set();
      for (const d of days) for (const b of d.blocks) if (b.activityId && b.kind === 'activity') { if (!acts.includes(b.title)) acts.push(b.title); b.skills.forEach((s) => sk.add(s)); }
      return [`${X.fmtDate(w.from, false)} – ${X.fmtDate(w.to, false)}`, w.theme || '', acts.map((a) => '– ' + a).join('\n'), [...sk].map(sname).filter(Boolean).map(X.lower).join(', ')];
    }).filter((r, i) => plan.days.some((d) => d.date >= plan.weeks[i].from && d.date <= plan.weeks[i].to));
    blocks.push({ kind: 'table', cols: [{ text: 'Tydzień', w: 14 }, { text: 'Temat przewodni', w: 18 }, { text: 'Planowane zajęcia w pracowni', w: 36 }, { text: 'Rozwijane umiejętności', w: 32 }], rows });
    if (T.monthDetail !== false) {
      heading('Harmonogram dzienny');
      blocks.push({ kind: 'table', cols: [{ text: 'Dzień', w: 18 }, { text: 'Zajęcia w pracowni', w: 47 }, { text: 'Zajęcia ogólne', w: 35 }], rows: plan.days.map((d) => [
        X.dayLabel(d.date),
        d.blocks.filter((b) => b.kind === 'activity').map((b) => `${b.start} ${b.title}`).join('\n'),
        d.blocks.filter((b) => b.kind === 'general').map((b) => `${b.start} ${b.title}`).join('\n')
      ]) });
    }
  }

  if (String(plan.notes || '').trim()) { heading('Uwagi'); for (const l of lines(plan.notes)) p(l, { kind: 'body', align: T.justify ? 'both' : 'left' }); }
  blocks.push({ kind: 'sign', align: 'center', runs: [{ text: '…………………………………………' }], first: true });
  blocks.push({ kind: 'sign', align: 'center', runs: [{ text: [(workshop && workshop.instructor) || P.name, P.title].filter(Boolean).join(', ') || '(podpis prowadzącego)' }] });
  return { blocks, format: { font: T.font, size: Number(T.fontSize) || 12, lineSpacing: Number(T.lineSpacing) || 1.15, marginCm: Number(T.marginCm) || 2, indent: false, landscape: T.landscapePlans !== false } };
}

module.exports = { individualFor, easter, holidays, planRange, workDays, weeksIn, themeFor, latestLevels, skillNeeds, makeCtx, generatePlan, regenerateDay, fillDays, autoGoals, validatePlan, buildPlanModel, planTitle, rangeLabel, allSkills, skillMap, rng };
