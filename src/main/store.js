'use strict';
// Trwały magazyn danych w pliku JSON (zapis atomowy): ustawienia, pracownie, uczestnicy, plany, oceny.
const fs = require('fs');
const path = require('path');
const { WORKSHOPS } = require('./workshops-default');
const MODES = ['none', 'local', 'codex', 'gemini', 'claude-code', 'api'];

// Skala ocen cząstkowych: stopień opanowania umiejętności (0–4).
// „text” to zdanie do oceny opisowej; {lista} = umiejętności na tym poziomie.
const SCALE = [
  { value: 0, label: 'Nie podejmuje', desc: 'nie podejmuje czynności lub odmawia jej wykonania', text: '{osoba} nie podejmuje jeszcze samodzielnych prób w zakresie takich umiejętności, jak: {lista}.' },
  { value: 1, label: 'Pełna pomoc', desc: 'wykonuje czynność z pełną pomocą fizyczną i słowną', text: '{osoba} wymaga pełnej pomocy terapeuty w zakresie takich umiejętności, jak: {lista}.' },
  { value: 2, label: 'Częściowa pomoc', desc: 'wykonuje czynność z częściową pomocą', text: 'Z częściową pomocą terapeuty {osoba} wykonuje zadania w zakresie takich umiejętności, jak: {lista}.' },
  { value: 3, label: 'Ukierunkowanie', desc: 'wykonuje czynność z niewielką pomocą lub podpowiedzią słowną', text: 'Z niewielką pomocą lub po ukierunkowaniu słownym {osoba} wykonuje zadania w zakresie takich umiejętności, jak: {lista}.' },
  { value: 4, label: 'Samodzielnie', desc: 'wykonuje czynność samodzielnie i poprawnie', text: '{osoba} samodzielnie i poprawnie wykonuje zadania w zakresie takich umiejętności, jak: {lista}.' }
];

const PHRASES = {
  progress: 'W porównaniu z {porównanie} {osoba} [osiągnął|osiągnęła] postęp w zakresie takich umiejętności, jak: {lista}.',
  regress: 'Obniżenie poziomu wykonania zaobserwowano w zakresie takich umiejętności, jak: {lista}.',
  stable: 'Poziom pozostałych umiejętności w tym obszarze utrzymuje się bez istotnych zmian.',
  none: 'W ocenianym okresie nie odnotowano ocen cząstkowych w tym obszarze.'
};

// Stanowisko rady programowej po kompleksowej ocenie (art. 10a ust. 5 ustawy o rehabilitacji) – treść do edycji.
const STANCES = [
  { id: 'praca', label: 'Zatrudnienie / rehabilitacja zawodowa', text: 'Rada programowa stwierdza, że osiągnięte przez [uczestnika|uczestniczkę] postępy w rehabilitacji uzasadniają podjęcie zatrudnienia i kontynuowanie rehabilitacji zawodowej w warunkach pracy chronionej lub na przystosowanym stanowisku pracy.' },
  { id: 'kontynuacja', label: 'Kontynuacja terapii w WTZ', text: 'Rada programowa stwierdza, że osiągnięte przez [uczestnika|uczestniczkę] postępy w rehabilitacji uzasadniają kontynuowanie uczestnictwa w terapii zajęciowej w warsztacie.' },
  { id: 'inna', label: 'Skierowanie do innej formy wsparcia', text: 'Rada programowa stwierdza, że stan funkcjonowania [uczestnika|uczestniczki] uzasadnia potrzebę skierowania do innej formy wsparcia, odpowiedniej do [jego|jej] potrzeb.' }
];

// Rozkład dnia: bloki „activity” wypełnia bank zajęć pracowni, „general” – profil Umiejętności ogólne, „fixed” – stały tekst.
const SCHEDULE = [
  { start: '08:00', end: '08:30', kind: 'general', label: 'Powitanie, rozmowa poranna, omówienie planu dnia' },
  { start: '08:30', end: '10:00', kind: 'activity', label: 'Zajęcia w pracowni' },
  { start: '10:00', end: '10:30', kind: 'fixed', label: 'Przerwa śniadaniowa – trening samoobsługi i higieny' },
  { start: '10:30', end: '12:00', kind: 'activity', label: 'Zajęcia w pracowni' },
  { start: '12:00', end: '13:00', kind: 'general', label: 'Trening umiejętności społecznych / zaradności' },
  { start: '13:00', end: '13:30', kind: 'fixed', label: 'Obiad – trening samoobsługi' },
  { start: '13:30', end: '14:00', kind: 'fixed', label: 'Porządkowanie stanowisk pracy, podsumowanie dnia, samoocena uczestników' }
];

// Tematy przewodnie miesięcy – podpowiedzi do planów tygodniowych i miesięcznych.
const THEMES = [
  ['Zima i sporty zimowe', 'Nowy rok – plany i postanowienia', 'Dzień Babci i Dziadka', 'Bezpieczne ferie'],
  ['Walentynki – przyjaźń i życzliwość', 'Tłusty czwartek', 'Zimowa przyroda', 'Dbamy o zdrowie zimą'],
  ['Dzień Kobiet', 'Powitanie wiosny', 'Pierwszy dzień wiosny', 'Wielkanoc – tradycje'],
  ['Wielkanoc – zwyczaje i dekoracje', 'Dzień Ziemi – ekologia', 'Wiosenne porządki', 'Światowy Dzień Autyzmu'],
  ['Święta majowe – Polska', 'Dzień Matki', 'Wiosna w ogrodzie', 'Bezpieczeństwo na co dzień'],
  ['Dzień Ojca', 'Lato – wakacyjne plany', 'Zdrowe odżywianie latem', 'Podsumowanie półrocza'],
  ['Wakacje i wypoczynek', 'Bezpieczne lato', 'Owoce lata', 'Turystyka i podróże'],
  ['Lato w pełni', 'Przetwory na zimę', 'Rocznica Powstania Warszawskiego', 'Pożegnanie lata'],
  ['Powrót po wakacjach – nowe cele', 'Dary jesieni', 'Dzień Chłopaka', 'Jesienne porządki'],
  ['Jesień w przyrodzie', 'Dzień Edukacji Narodowej', 'Zdrowie psychiczne – emocje', 'Wspomnienie bliskich – Wszystkich Świętych'],
  ['Święto Niepodległości', 'Jesień w kuchni', 'Andrzejki', 'Dzień Pluszowego Misia'],
  ['Mikołajki', 'Boże Narodzenie – tradycje', 'Ozdoby świąteczne', 'Podsumowanie roku']
];

const DEFAULT_SETTINGS = {
  profile: { name: '', title: 'terapeuta zajęciowy', institution: '', city: '' },
  ai: {
    provider: 'none',
    order: ['codex', 'gemini', 'claude-code'],
    fallback: true,
    connected: {}, consent: {}, paths: {}, plans: {}, detected: {},
    paidModels: true,
    model: 'sonnet', codexModel: '', geminiModel: '', apiModel: 'claude-sonnet-5-5', claudePath: '',
    local: { url: 'http://127.0.0.1:11434', model: '' }
  },
  template: {
    titles: {
      day: 'DZIENNY PLAN PRACY',
      week: 'TYGODNIOWY PLAN PRACY',
      month: 'MIESIĘCZNY PLAN PRACY',
      month_a: 'MIESIĘCZNA OCENA POSTĘPÓW UCZESTNIKA',
      year_a: 'ROCZNA OKRESOWA OCENA REALIZACJI INDYWIDUALNEGO PROGRAMU REHABILITACJI',
      complex_a: 'KOMPLEKSOWA OCENA REALIZACJI INDYWIDUALNEGO PROGRAMU REHABILITACJI'
    },
    header: '', // puste = nazwa i adres warsztatu z zakładki Ogólne
    council: 'kierownik warsztatu\npsycholog\nterapeuta zajęciowy\nrehabilitant', // skład rady programowej (podpisy pod oceną kompleksową)
    footnote: '',
    skillTable: true, // tabela umiejętności w ocenach
    monthDetail: true, // w planie miesięcznym także zestawienie dzienne
    font: 'Times New Roman', fontSize: 12, lineSpacing: 1.15, marginCm: 2, justify: true, firstLineIndent: false,
    landscapePlans: true
  },
  scale: SCALE,
  phrases: PHRASES,
  stances: STANCES,
  schedule: SCHEDULE,
  themes: THEMES,
  planning: { skipHolidays: true, individual: true },
  ui: { theme: 'system' }
};

const DATA_VERSION = 1;

const DEFAULT_DATA = {
  version: DATA_VERSION,
  settings: DEFAULT_SETTINGS,
  workshops: null, // null = zestaw startowy
  participants: [],
  plans: [],
  marks: [], // oceny cząstkowe: { id, participantId, workshopId, skillId, date, level }
  assessments: []
};

const clone = (x) => JSON.parse(JSON.stringify(x));

function deepMerge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const k of Object.keys(extra)) out[k] = k in base ? deepMerge(base[k], extra[k]) : extra[k];
    }
    return out;
  }
  return extra === undefined ? base : extra;
}

function migrate(data) {
  const ai = data.settings.ai;
  if (!MODES.includes(ai.provider)) ai.provider = 'none';
  data.version = DATA_VERSION;
  return data;
}

const COLLECTIONS = ['participants', 'plans', 'assessments'];

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'wtzhelper-dane.json');
    this.data = this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return migrate(deepMerge(clone(DEFAULT_DATA), raw));
    } catch (e) {
      if (fs.existsSync(this.file)) {
        try { fs.copyFileSync(this.file, this.file + '.uszkodzony-' + Date.now()); } catch (_) { /* ignore */ }
      }
      return clone(DEFAULT_DATA);
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get settings() { return this.data.settings; }
  updateSettings(patch) { this.data.settings = deepMerge(this.data.settings, patch); this.save(); return this.data.settings; }

  // ── pracownie ──
  get workshops() {
    if (!Array.isArray(this.data.workshops)) this.data.workshops = clone(WORKSHOPS);
    return this.data.workshops;
  }
  setWorkshops(list) { this.data.workshops = list; this.save(); return list; }
  resetWorkshops() { this.data.workshops = clone(WORKSHOPS); this.save(); return this.data.workshops; }
  workshop(id) { return this.workshops.find((w) => w.id === id) || null; }
  general() { return this.workshops.find((w) => w.general) || null; }

  // ── uczestnicy, plany, oceny ──
  list(kind) { if (!COLLECTIONS.includes(kind)) throw new Error('Nieznany rodzaj danych.'); return this.data[kind]; }
  get(kind, id) { return this.list(kind).find((x) => x.id === id) || null; }
  put(kind, obj) {
    const list = this.list(kind);
    obj.updatedAt = new Date().toISOString();
    if (!obj.createdAt) obj.createdAt = obj.updatedAt;
    const i = list.findIndex((x) => x.id === obj.id);
    if (i >= 0) list[i] = obj; else list.unshift(obj);
    if (kind === 'participants') list.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'pl'));
    this.save();
    return obj;
  }
  remove(kind, id) {
    this.data[kind] = this.list(kind).filter((x) => x.id !== id);
    if (kind === 'participants') {
      this.data.marks = this.data.marks.filter((m) => m.participantId !== id);
      this.data.assessments = this.data.assessments.filter((a) => a.participantId !== id);
    }
    this.save();
  }

  // Dodaje lub aktualizuje uczestników z importu (klucz: PESEL albo nazwisko + imię + data urodzenia).
  mergeParticipants(list, defaults = {}) {
    const key = (p) => (p.pesel ? 'p:' + p.pesel : `n:${p.lastName}|${p.firstName}|${p.birthDate || ''}`.toLowerCase());
    const map = new Map(this.data.participants.map((p) => [key(p), p]));
    let added = 0, updated = 0;
    const now = new Date().toISOString();
    for (const p of list) {
      const k = key(p);
      const src = { firstName: p.firstName, lastName: p.lastName, gender: p.gender || 'm', birthDate: p.birthDate || '', pesel: p.pesel || '', address: p.address || '' };
      if (map.has(k)) { Object.assign(map.get(k), src); updated++; } else {
        const np = { id: p.id, refStyle: 'imie', workshopId: defaults.workshopId || '', admission: '', iprGoals: [], notes: '', active: true, createdAt: now, updatedAt: now, ...src };
        map.set(k, np); this.data.participants.push(np); added++;
      }
    }
    this.data.participants.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'pl'));
    this.save();
    return { added, updated, total: this.data.participants.length };
  }

  // ── oceny cząstkowe ──
  // entries: [{ participantId, workshopId, skillId, date, level }], level null = usuń ocenę
  setMarks(entries, newId) {
    let n = 0;
    for (const e of entries) {
      const i = this.data.marks.findIndex((m) => m.participantId === e.participantId && m.skillId === e.skillId && m.date === e.date);
      if (e.level === null || e.level === undefined || e.level === '') { if (i >= 0) { this.data.marks.splice(i, 1); n++; } continue; }
      const level = Number(e.level);
      if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('Nieprawidłowa ocena cząstkowa.');
      if (i >= 0) this.data.marks[i].level = level;
      else this.data.marks.push({ id: newId(), participantId: e.participantId, workshopId: e.workshopId || '', skillId: e.skillId, date: e.date, level });
      n++;
    }
    this.save();
    return n;
  }
  marksFor({ participantId, workshopId, from, to } = {}) {
    return this.data.marks.filter((m) => (!participantId || m.participantId === participantId) && (!workshopId || m.workshopId === workshopId) && (!from || m.date >= from) && (!to || m.date <= to));
  }
}

module.exports = { Store, DEFAULT_SETTINGS, DATA_VERSION, migrate, SCALE, PHRASES, STANCES, SCHEDULE, THEMES };
