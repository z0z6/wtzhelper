'use strict';
// Testy logiki bez Electrona: node test/run-tests.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const JSZip = require('jszip');

const { Store } = require('../src/main/store');
const { WORKSHOPS } = require('../src/main/workshops-default');
const X = require('../src/main/text');
const PL = require('../src/main/planner');
const AS = require('../src/main/assessment');
const { renderDocx, renderHtml } = require('../src/main/render');
const P = require('../src/main/ai/providers');
const { extractJson } = P;
const ollama = require('../src/main/ai/ollama');
const { Accounts } = require('../src/main/accounts');
const { anonymizer, findLeaks, polishAssessment, proposeConclusions, proposePlan, proposeProfile } = require('../src/main/ai/tasks');
const imp = require('../src/main/import');
const DOC = require('../src/main/documents');
const { analyzeDocument } = require('../src/main/ai/tasks');

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('✓', name); }, (e) => { console.error('✗', name, '\n ', e.stack); process.exitCode = 1; });

const jan = { id: 'p1', firstName: 'Jan', lastName: 'Kowalski', gender: 'm', birthDate: '1990-03-07', address: 'ul. Lipowa 3, Kraków', refStyle: 'imie', workshopId: 'gospodarstwo', admission: '2023-09-01', iprGoals: [{ id: 'g1', text: 'Samodzielne przygotowanie kanapki' }] };
const anna = { id: 'p2', firstName: 'Anna', lastName: 'Nowak', gender: 'k', refStyle: 'imie', workshopId: 'gospodarstwo', iprGoals: [] };
let mid = 0;
const newId = () => 'm' + (mid++);

function freshStore() { return new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'wtz-test-'))); }

(async () => {
  // ───────────── profile pracowni ─────────────
  await t('Zestaw startowy pracowni: unikalne identyfikatory, zajęcia tylko z umiejętnościami z profilu', () => {
    assert.strictEqual(WORKSHOPS.filter((w) => w.general).length, 1);
    assert(WORKSHOPS.filter((w) => !w.general).length >= 7);
    const ids = new Set();
    for (const w of WORKSHOPS) {
      assert(!ids.has(w.id), w.id); ids.add(w.id);
      assert(w.description && w.goals.length >= 3, w.name);
      assert(w.areas.length >= 3, w.name);
      assert(w.activities.length >= 10, w.name);
      const skills = new Set();
      for (const a of w.areas) { assert(!ids.has(a.id), a.id); ids.add(a.id); for (const s of a.skills) { assert(!ids.has(s.id), s.id); ids.add(s.id); skills.add(s.id); } }
      const used = new Set();
      for (const a of w.activities) {
        assert(!ids.has(a.id), a.id); ids.add(a.id);
        assert(a.skills.length && a.goal && a.methods && a.materials, a.name);
        for (const s of a.skills) { assert(skills.has(s), `${w.name}: ${a.name} → ${s}`); used.add(s); }
      }
      assert.strictEqual(used.size, skills.size, `${w.name}: każda umiejętność ma przynajmniej jedno zajęcie`);
    }
  });

  await t('Personalizacja: imię, formy płci, wielka litera; listy z „oraz”', () => {
    assert.strictEqual(X.personalize('{osoba} [osiągnął|osiągnęła] postęp.', anna), 'Anna osiągnęła postęp.');
    assert.strictEqual(X.personalize('z pomocą {osoba} pracuje.', { ...jan, refStyle: 'uczestnik' }), 'Z pomocą uczestnik pracuje.');
    assert.strictEqual(X.joinList(['a', 'b i c', 'd']), 'a, b i c oraz d');
    assert.strictEqual(X.plural(22, 'ocena', 'oceny', 'ocen'), 'oceny');
    assert.strictEqual(X.plural(12, 'ocena', 'oceny', 'ocen'), 'ocen');
  });

  // ───────────── kalendarz i plany ─────────────
  await t('Kalendarz: dni wolne (Wielkanoc, Boże Ciało, Wigilia od 2025), zakresy planów', () => {
    const h26 = PL.holidays(2026);
    for (const d of ['2026-04-05', '2026-04-06', '2026-05-24', '2026-06-04', '2026-11-11', '2026-12-24']) assert(h26.has(d), d);
    assert(!PL.holidays(2024).has('2024-12-24'));
    assert.deepStrictEqual(PL.planRange('week', '2026-11-25'), { from: '2026-11-23', to: '2026-11-27' });
    assert.deepStrictEqual(PL.planRange('month', '2026-11-25'), { from: '2026-11-01', to: '2026-11-30' });
    assert.strictEqual(PL.workDays('2026-11-01', '2026-11-30').length, 20, '11 listopada pominięty');
    assert.strictEqual(PL.workDays('2026-11-09', '2026-11-13', false).length, 5);
    assert.deepStrictEqual(PL.weeksIn('2026-11-01', '2026-11-30').map((w) => w.from), ['2026-11-01', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    assert.strictEqual(PL.themeFor([[], [], [], [], [], [], [], [], [], [], ['A', 'B', 'C', 'D'], []], '2026-11-25'), 'D');
  });

  const store = freshStore();
  const W = (id) => store.workshop(id);
  const G = store.general();
  // oceny cząstkowe: Jan słabo kroi i nakrywa do stołu, dobrze myje warzywa
  const markList = [];
  for (const s of PL.allSkills(W('gospodarstwo'))) {
    const lv = /krojenie|stol/.test(s.id) ? 1 : 4;
    markList.push({ participantId: 'p1', workshopId: 'gospodarstwo', skillId: s.id, date: '2026-10-15', level: Math.max(0, lv - 1) });
    markList.push({ participantId: 'p1', workshopId: 'gospodarstwo', skillId: s.id, date: '2026-11-10', level: lv });
  }

  await t('Magazyn: uczestnicy, oceny cząstkowe (zapis, nadpisanie, usunięcie), kaskadowe usuwanie', () => {
    store.put('participants', { ...jan }); store.put('participants', { ...anna });
    assert.deepStrictEqual(store.list('participants').map((p) => p.lastName), ['Kowalski', 'Nowak']);
    assert.strictEqual(store.setMarks(markList, newId), markList.length);
    store.setMarks([{ participantId: 'p1', skillId: 'gospodarstwo.mycie', date: '2026-11-10', level: 3 }], newId);
    assert.strictEqual(store.marksFor({ participantId: 'p1', from: '2026-11-10', to: '2026-11-10' }).find((m) => m.skillId === 'gospodarstwo.mycie').level, 3);
    store.setMarks([{ participantId: 'p1', skillId: 'gospodarstwo.mycie', date: '2026-11-10', level: 4 }], newId);
    assert.throws(() => store.setMarks([{ participantId: 'p1', skillId: 'x', date: '2026-11-10', level: 7 }], newId), /Nieprawidłowa/);
    store.setMarks([{ participantId: 'p2', skillId: 'gospodarstwo.mycie', date: '2026-11-10', level: 2 }], newId);
    store.setMarks([{ participantId: 'p2', skillId: 'gospodarstwo.mycie', date: '2026-11-10', level: null }], newId);
    assert.strictEqual(store.marksFor({ participantId: 'p2' }).length, 0);
    const again = new Store(store.dir);
    assert.strictEqual(again.data.marks.length, markList.length);
    const tmp = freshStore();
    tmp.put('participants', { ...anna }); tmp.setMarks([{ participantId: 'p2', skillId: 's', date: '2026-01-01', level: 1 }], newId);
    tmp.remove('participants', 'p2');
    assert.strictEqual(tmp.data.marks.length, 0);
  });

  await t('Plany: każdy rodzaj, każda pracownia – wyłącznie zajęcia z banku i umiejętności z profilu', () => {
    for (const w of store.workshops.filter((x) => !x.general)) for (const type of ['day', 'week', 'month']) {
      const plan = PL.generatePlan({ id: 'x', type, start: '2026-11-25', workshop: w, general: G, participants: [jan], marks: store.data.marks, settings: store.settings, seed: 3 });
      assert.deepStrictEqual(PL.validatePlan(plan, w, G), [], `${w.name} ${type}`);
      assert.strictEqual(plan.days.length, { day: 1, week: 5, month: 20 }[type]);
      const own = new Set(w.activities.map((a) => a.id)), gen = new Set(G.activities.map((a) => a.id));
      for (const d of plan.days) for (const b of d.blocks) {
        if (b.kind === 'activity') assert(own.has(b.activityId), `${w.name}: ${b.title}`);
        if (b.kind === 'general') assert(gen.has(b.activityId), b.title);
        if (b.kind === 'fixed') assert.strictEqual(b.activityId, null);
      }
      // w jednym dniu te same zajęcia się nie powtarzają
      for (const d of plan.days) { const ids = d.blocks.filter((b) => b.activityId).map((b) => b.activityId); assert.strictEqual(new Set(ids).size, ids.length); }
    }
  });

  await t('Plany: miesiąc obejmuje wszystkie umiejętności pracowni, potrzeby grupy mają pierwszeństwo, praca indywidualna', () => {
    const w = W('gospodarstwo');
    const plan = PL.generatePlan({ id: 'x', type: 'month', start: '2026-11-25', workshop: w, general: G, participants: [jan], marks: store.data.marks, settings: store.settings, seed: 11 });
    const covered = new Set(plan.days.flatMap((d) => d.blocks.filter((b) => b.kind === 'activity').flatMap((b) => b.skills)));
    assert.strictEqual(covered.size, PL.allSkills(w).length, 'wszystkie umiejętności w miesiącu');
    assert(/krojenie|nakrywanie/.test(plan.goals.split('\n')[0]), plan.goals);
    const blk = plan.days.flatMap((d) => d.blocks).find((b) => b.skills.includes('gospodarstwo.krojenie'));
    assert.deepStrictEqual(blk.individual, [{ participantId: 'p1', skillId: 'gospodarstwo.krojenie', level: 1 }]);
    assert.strictEqual(plan.weeks.length, 6);
    // ten sam los = ten sam plan; inny dzień po wylosowaniu – reszta bez zmian
    const again = PL.generatePlan({ id: 'x', type: 'month', start: '2026-11-25', workshop: w, general: G, participants: [jan], marks: store.data.marks, settings: store.settings, seed: 11 });
    assert.deepStrictEqual(again.days.map((d) => d.blocks.map((b) => b.activityId)), plan.days.map((d) => d.blocks.map((b) => b.activityId)));
    const before = JSON.stringify(plan.days.slice(1).map((d) => d.blocks.map((b) => b.activityId)));
    PL.regenerateDay(plan, plan.days[0].date, PL.makeCtx({ workshop: w, general: G, participants: [jan], marks: store.data.marks, settings: store.settings }), 99);
    assert.strictEqual(JSON.stringify(plan.days.slice(1).map((d) => d.blocks.map((b) => b.activityId))), before);
    plan.days[0].blocks[1].activityId = 'plastyczna.z1';
    assert(PL.validatePlan(plan, w, G).some((x) => /spoza banku/.test(x)));
    assert.throws(() => PL.generatePlan({ id: 'x', type: 'day', start: '2026-11-28', workshop: w, general: G, participants: [], marks: [], settings: store.settings }), /nie ma dni zajęć/);
    assert.throws(() => PL.generatePlan({ id: 'x', type: 'day', start: '2026-11-25', workshop: { ...w, activities: [] }, general: G, participants: [], marks: [], settings: store.settings }), /pusty/);
  });

  await t('Plan: dokument DOCX (poziomo, tabele) i HTML', async () => {
    const w = W('gospodarstwo');
    for (const type of ['day', 'week', 'month']) {
      const plan = PL.generatePlan({ id: 'x', type, start: '2026-11-25', workshop: w, general: G, participants: [jan, anna], marks: store.data.marks, settings: store.settings, seed: 5 });
      plan.notes = 'Uwaga <b> & "test"';
      const m = PL.buildPlanModel(plan, { workshop: w, general: G, participants: [jan, anna], settings: store.settings, scale: store.settings.scale });
      assert.strictEqual(m.blocks.find((b) => b.kind === 'title').runs[0].text, store.settings.template.titles[type]);
      assert(m.blocks.some((b) => b.kind === 'table'));
      const zip = await JSZip.loadAsync(await renderDocx(m, { title: 'Plan' }));
      const xml = await zip.file('word/document.xml').async('string');
      assert(xml.includes('w:orient="landscape"') && xml.includes('<w:tbl>') && xml.includes('Jan K.'));
      assert(xml.includes('&lt;b&gt; &amp; &quot;test&quot;'));
      const html = renderHtml(m);
      assert(html.includes('size: A4 landscape') && html.includes('<table') && !html.includes('<b> &'));
      if (type === 'week') fs.writeFileSync(path.join(store.dir, 'plan-tygodniowy.docx'), await renderDocx(m, {}));
    }
  });

  // ───────────── oceny ─────────────
  const ctx = (person) => ({ workshops: store.workshops, marks: store.data.marks, settings: store.settings, person });

  await t('Ocena miesięczna: stopień opanowania, opis według poziomów, postęp względem poprzedniego miesiąca', () => {
    assert.deepStrictEqual(AS.periodFor('month', '2026-11-25'), { from: '2026-11-01', to: '2026-11-30' });
    assert.deepStrictEqual(AS.previousPeriod('2026-11-01', '2026-11-30'), { from: '2026-10-01', to: '2026-10-31' });
    const a = AS.newAssessment('a1', { type: 'month', participant: jan, date: '2026-11-25', workshops: store.workshops });
    assert.deepStrictEqual(a.workshopIds, ['gospodarstwo', 'ogolne']);
    const { stats } = AS.refreshAuto(a, ctx(jan));
    assert.strictEqual(stats.skills['gospodarstwo.krojenie'].avg, 1);
    assert.strictEqual(AS.change('month', stats.skills['gospodarstwo.krojenie']), 1);
    const t1 = a.sections['gospodarstwo.posilki'].text;
    assert(t1.startsWith('Jan samodzielnie i poprawnie wykonuje zadania w zakresie takich umiejętności, jak: mycie i obieranie warzyw i owoców, przygotowywanie potraw na zimno oraz przygotowywanie potraw na ciepło.'), t1);
    assert(t1.includes('Jan wymaga pełnej pomocy terapeuty w zakresie umiejętności: krojenie i posługiwanie się nożem.'), t1);
    assert(t1.includes('W porównaniu z poprzednim miesiącem Jan osiągnął postęp'), t1);
    assert.strictEqual(a.sections['ogolne.samo'].text, '', 'profil bez ocen w okresie jest pomijany');
    assert.strictEqual(a.sections['gospodarstwo.agd'].text.includes('nie odnotowano'), false);
    assert(/uczestniczył w zajęciach pracowni gospodarstwa domowego/.test(a.summary), a.summary);
    assert(/oceny cząstkowe|ocen cząstkowych/.test(a.summary));
    assert(a.recommendations.split('\n')[0].includes('krojenie i posługiwanie się nożem'), a.recommendations);
    // poprawki terapeuty zostają po przeliczeniu
    a.sections['gospodarstwo.posilki'] = { text: 'Mój opis.', auto: false };
    a.summary = 'Moje podsumowanie.'; a.summaryAuto = false;
    AS.refreshAuto(a, ctx(jan));
    assert.strictEqual(a.sections['gospodarstwo.posilki'].text, 'Mój opis.');
    assert.strictEqual(a.summary, 'Moje podsumowanie.');
    assert.notStrictEqual(a.recommendations, '');
  });

  await t('Ocena roczna i kompleksowa: okresy, porównanie z początkiem okresu, cele IPR, stanowisko rady programowej', async () => {
    const y = AS.newAssessment('a2', { type: 'year', participant: jan, date: '2026-11-25', workshops: store.workshops });
    AS.refreshAuto(y, ctx(jan));
    assert.deepStrictEqual([y.from, y.to], ['2026-01-01', '2026-12-31']);
    assert(y.sections['gospodarstwo.posilki'].text.includes('W porównaniu z początkiem okresu oceny Jan osiągnął postęp'));
    y.ipr.g1 = { status: 'czesciowo', comment: 'z pomocą' };
    const ym = AS.buildAssessmentModel(y, ctx(jan));
    const texts = ym.blocks.map((b) => (b.runs ? b.runs.map((r) => r.text).join('') : ''));
    assert(texts.includes(store.settings.template.titles.year_a));
    assert(texts.some((x) => x.includes('Realizacja celów indywidualnego programu rehabilitacji')));
    const iprTable = ym.blocks.find((b) => b.kind === 'table' && b.cols[0].text === 'Cel IPR');
    assert.deepStrictEqual(iprTable.rows[0], ['Samodzielne przygotowanie kanapki', 'zrealizowany częściowo', 'z pomocą']);

    const c = AS.newAssessment('a3', { type: 'complex', participant: { ...anna, gender: 'k' }, date: '2026-11-25', workshops: store.workshops });
    assert.deepStrictEqual([c.from, c.to], ['2023-12-01', '2026-11-30']);
    assert.deepStrictEqual(AS.yearSlices(c.from, c.to).map((s) => s.from), ['2023-12-01', '2024-12-01', '2025-12-01']);
    AS.refreshAuto(c, ctx(anna));
    assert(c.stance.text.includes('uczestniczkę') && c.stance.text.includes('kontynuowanie uczestnictwa'), c.stance.text);
    c.stance = { option: 'praca', text: '', auto: true };
    AS.refreshAuto(c, ctx(anna));
    assert(c.stance.text.includes('podjęcie zatrudnienia'));
    store.updateSettings({ template: { council: 'kierownik warsztatu\npsycholog' } });
    const cm = AS.buildAssessmentModel(c, ctx(anna));
    assert.deepStrictEqual(cm.blocks.filter((b) => b.kind === 'council').map((b) => b.runs[0].text.trim()), ['…………………………………………  kierownik warsztatu', '…………………………………………  psycholog']);
    const zip = await JSZip.loadAsync(await renderDocx(ym, { title: 'Ocena' }));
    const xml = await zip.file('word/document.xml').async('string');
    assert(xml.includes('<w:gridSpan') && xml.includes('Jan Kowalski') && !xml.includes('landscape'));
    fs.writeFileSync(path.join(store.dir, 'ocena-roczna.docx'), await renderDocx(ym, {}));
  });

  await t('Import uczestników: CSV, przypisanie do pracowni, ponowny import bez dublowania', () => {
    const st = freshStore();
    const a = imp.textToPeople('Nazwisko;Imię;Data urodzenia;PESEL\nLis;Ola;1995-05-09;\nKot;Jan;1993-12-01;');
    assert.deepStrictEqual(st.mergeParticipants(a, { workshopId: 'plastyczna' }), { added: 2, updated: 0, total: 2 });
    assert(st.list('participants').every((p) => p.workshopId === 'plastyczna' && Array.isArray(p.iprGoals)));
    st.list('participants').find((p) => p.lastName === 'Lis').iprGoals.push({ id: 'x', text: 'cel' });
    const b = imp.textToPeople('Nazwisko;Imię;Data urodzenia\nLis;Ola;1995-05-09\nBąk;Ela;1990-01-01');
    assert.deepStrictEqual(st.mergeParticipants(b), { added: 1, updated: 1, total: 3 });
    assert.deepStrictEqual(st.list('participants').map((p) => p.lastName), ['Bąk', 'Kot', 'Lis']);
    assert.strictEqual(st.list('participants').find((p) => p.lastName === 'Lis').iprGoals.length, 1, 'cele IPR zostają po ponownym imporcie');
  });

  // ───────────── zadania AI ─────────────
  await t('AI: redakcja opisów oceny i wnioski – bez danych osobowych w zapytaniu', async () => {
    let seen = '';
    const p1 = { run: async ({ prompt }) => { seen = prompt; return { text: '```json\n{"items":[{"id":"a","tekst":"«OSOBA» samodzielnie kroi warzywa."},{"id":"obcy","tekst":"x"}]}\n```' }; } };
    const out = await polishAssessment(p1, { items: [{ id: 'a', name: 'Posiłki', text: 'Jan Kowalski samodzielnie kroi warzywa.' }], person: jan, refName: 'Jan', type: 'month', notes: 'Kowalski lubi gotować.' });
    assert(!/Kowalski|\bJan\b/.test(seen), 'dane osobowe w zapytaniu');
    assert.deepStrictEqual(out, { a: 'Jan samodzielnie kroi warzywa.' });
    const p2 = { run: async ({ prompt }) => { seen = prompt; return { text: '{"summary":"«OSOBA» robi postępy.","recommendations":["1. Ćwiczyć krojenie."],"stance":"Uzasadnienie dla «OSOBA»."}' }; } };
    const r = await proposeConclusions(p2, { sections: [{ name: 'Posiłki', text: 'Jan kroi.' }], person: jan, refName: 'Jan', type: 'complex', ipr: [{ text: 'Cel Jana', status: 'zrealizowany' }], stance: 'Kontynuacja terapii w WTZ' });
    assert(!/\bJan\b|Jana/.test(seen));
    assert(seen.includes('Kontynuacja terapii w WTZ'));
    assert.deepStrictEqual(r, { summary: 'Jan robi postępy.', recommendations: '– Ćwiczyć krojenie.', stance: 'Uzasadnienie dla Jan.' });
    await assert.rejects(() => polishAssessment(p1, { items: [], person: jan }), /nie ma jeszcze/);
  });

  await t('AI: dobór zajęć do planu – zajęcia spoza banku pracowni są odrzucane', async () => {
    const w = W('gospodarstwo');
    const plan = PL.generatePlan({ id: 'x', type: 'day', start: '2026-11-25', workshop: w, general: G, participants: [], marks: [], settings: store.settings, seed: 1 });
    const [b0, b1] = plan.days[0].blocks.filter((b) => b.kind !== 'fixed');
    let seen = '';
    const prov = { run: async ({ prompt }) => { seen = prompt; return { text: JSON.stringify({ bloki: [
      { blok: b1.id, id: 'gospodarstwo.z3', tytul: 'Pierniczki andrzejkowe', notatka: 'Wróżby przy pieczeniu.' },
      { blok: b0.id, id: 'plastyczna.z1', tytul: 'Coś z innej pracowni' },
      { blok: 'nieznany', id: 'gospodarstwo.z1' }
    ] }) }; } };
    const out = await proposePlan(prov, { workshop: w, general: G, plan, needs: ['Krojenie'] });
    assert.deepStrictEqual(Object.keys(out), [b1.id]);
    assert.deepStrictEqual(out[b1.id], { activityId: 'gospodarstwo.z3', title: 'Pierniczki andrzejkowe', note: 'Wróżby przy pieczeniu.' });
    assert(seen.includes('gospodarstwo.z1') && seen.includes('Nie wymyślaj zajęć spoza banku'));
    const bad = { run: async () => ({ text: '{"bloki":[{"blok":"' + b1.id + '","id":"x.y"}]}' }) };
    await assert.rejects(() => proposePlan(bad, { workshop: w, general: G, plan }), /nie wybrał żadnych zajęć/);
  });

  await t('AI: propozycja profilu pracowni – umiejętności zajęć muszą pochodzić z obszarów', async () => {
    const prov = { run: async () => ({ text: '```json\n' + JSON.stringify({ opis: 'Opis.', cele: ['Cel 1'], obszary: [{ nazwa: 'Obróbka', umiejetnosci: ['Piłowanie', 'Szlifowanie'] }, { nazwa: 'Pusty', umiejetnosci: [] }], zajecia: [{ nazwa: 'Skrzynka', umiejetnosci: ['Piłowanie', 'Latanie'], cel: 'c', metody: 'm', materialy: 'x' }, { nazwa: 'Nic', umiejetnosci: ['Latanie'] }] }) + '\n```' }) };
    const r = await proposeProfile(prov, { name: 'Pracownia stolarska' });
    assert.deepStrictEqual(r.areas, [{ name: 'Obróbka', skills: ['Piłowanie', 'Szlifowanie'] }]);
    assert.deepStrictEqual(r.activities.map((a) => [a.name, a.skills]), [['Skrzynka', ['Piłowanie']]]);
    await assert.rejects(() => proposeProfile(prov, { name: '' }), /nazwę/);
  });

  // ───────────── dokumenty i skany ─────────────
  const orz = fs.readFileSync(path.join(__dirname, 'fixtures', 'orzeczenie-wtz.txt'), 'utf8');

  await t('Dokumenty: odczyt orzeczenia o stopniu niepełnosprawności (dane, stopień, symbole, ważność, wskazanie)', () => {
    const r = DOC.parseDocument('orzeczenie', orz);
    assert.deepStrictEqual(r.personal, { firstName: 'Jan', lastName: 'Kowalski', pesel: '90010712358', birthDate: '1990-01-07', gender: 'm', address: 'ul. Lipowa 3/4, 30-001 Kraków' });
    assert.deepStrictEqual({ ...r.disability, notes: undefined }, { degree: 'znaczny', codes: ['01-U', '12-C'], number: 'PZON.8230.1234.2024', issued: '2024-03-12', validUntil: 'na stałe', therapy: 'wskazane', notes: undefined });
    const ocr = 'ORZECZENIE O STOPNIU NIEPEŁNOSPRAWNOŚCI\nNazwisko i imię\nNOWAK ANNA MARIA\nzaliczona do umiarkowanego stopnia niepelnosprawnosci\nSymbol przyczyny: 02—P  05 -R\nOrzeczenie wydaje się na okres do dnia 31.03.2027 r.\nterapii zajęciowej: nie wymaga';
    const r2 = DOC.parseDocument('orzeczenie', ocr);
    assert.deepStrictEqual([r2.personal.firstName, r2.personal.lastName, r2.personal.gender], ['Anna Maria', 'Nowak', 'k']);
    assert.deepStrictEqual([r2.disability.degree, r2.disability.codes, r2.disability.validUntil, r2.disability.therapy], ['umiarkowany', ['02-P', '05-R'], '2027-03-31', 'nie wskazane']);
    assert.strictEqual(DOC.describeDisability(r.disability), 'stopień znaczny; 01-U (upośledzenie umysłowe), 12-C (całościowe zaburzenia rozwojowe)');
    const ad = DOC.localAdaptations(r.disability);
    assert(ad.some((a) => /piktogram/.test(a)) && ad.some((a) => /Praca indywidualna/.test(a)));
    assert(DOC.needsSupervision({ disability: { codes: ['06-E'] } }) && !DOC.needsSupervision({ disability: { degree: 'umiarkowany', codes: ['01-U'] } }));
  });

  await t('Dokumenty: poprzedni arkusz ocen – poziomy umiejętności z profilu (cyfry i opisy), cele', () => {
    const w = W('gospodarstwo');
    const sheet = 'ARKUSZ OCENY – PRACOWNIA GOSPODARSTWA DOMOWEGO\nData oceny: 15.06.2025\nMycie i obieranie warzyw   3\nKrojenie i posługiwanie się nożem – z częściową pomocą\nObsługa czajnika elektrycznego: samodzielnie\nSegregacja odpadów 1\nCele na kolejny okres:\n- Samodzielne przygotowanie herbaty dla grupy\n- Bezpieczne posługiwanie się nożem przy krojeniu warzyw';
    const r = DOC.parseDocument('ocena', sheet, { skills: PL.allSkills(w) });
    assert.strictEqual(r.date, '2025-06-15');
    assert.deepStrictEqual(r.levels.map((l) => [l.skillId, l.level]), [['gospodarstwo.mycie', 3], ['gospodarstwo.krojenie', 2], ['gospodarstwo.czajnik', 4], ['gospodarstwo.segregacja', 1]]);
    assert.deepStrictEqual(r.goals, ['Samodzielne przygotowanie herbaty dla grupy', 'Bezpieczne posługiwanie się nożem przy krojeniu warzyw']);
  });

  await t('Dokumenty: pseudonimizacja i strażnik (odmiana, zdrobnienia, PESEL, adres, inne osoby)', () => {
    const person = DOC.parsePersonal(orz);
    const extra = [{ firstName: 'Ewa', lastName: 'Lewandowska' }];
    const txt = orz + '\nKuba? Nie – Jana odwiedziła Ewa Lewandowska, tel. 600 100 200, jan@poczta.pl. Kowalskiemu pomaga mgr Zofia Wrona.';
    const r = DOC.pseudonymize(txt, person, extra);
    assert(!DOC.pseudonymize(orz, { ...person, disability: { number: 'PZON.8230.1234.2024' } }).text.includes('1234'), 'numer orzeczenia');
    assert(!r.text.includes('PZON.8230'), 'znak sprawy');
    for (const bad of ['Kowalski', 'Jana', 'Lewandowska', '90010712358', 'Lipowa', '600 100 200', 'jan@poczta.pl', 'Wrona', '12.03.2024', 'Adam Nowicki']) assert(!r.text.includes(bad), bad);
    assert(r.text.includes('01-U, 12-C') && r.text.includes('znacznego stopnia'), 'treść merytoryczna zostaje');
    assert.deepStrictEqual(DOC.findLeaks(r.text, person, extra), []);
    assert.deepStrictEqual(DOC.findLeaks('Rozmowa z Kowalskim i Lewandowską.', person, extra).sort(), ['dane innej osoby', 'nazwisko']);
    assert(DOC.findLeaks('PESEL 90010712358', person).includes('PESEL'));
    assert.strictEqual(DOC.unmark('{{IMIE}} {{NAZWISKO}} kroi z pomocą, ur. {{DATA}}.'), 'uczestnik kroi z pomocą, ur. ….');
  });

  await t('AI: analiza dokumentu – walidacja wyniku, brak danych osobowych w zapytaniu', async () => {
    const person = DOC.parsePersonal(orz);
    const anon = DOC.pseudonymize(orz, person).text;
    let seen = '';
    const prov = { run: async ({ prompt }) => { seen = prompt; return { text: '```json\n' + JSON.stringify({
      podsumowanie: '{{IMIE}} wymaga stałej pomocy.', stopien: 'Znaczny', symbole: ['01-U', '12 C', '99-X'],
      mocne_strony: ['Samodzielne mycie'], trudnosci: ['- Przygotowanie posiłków'], dostosowania: ['Instrukcje obrazkowe', 'Plan dnia z piktogramami'],
      cele_ipr: ['1. Samodzielne przygotowanie kanapki'],
      oceny: [{ id: 'gospodarstwo.zimne', poziom: 1, uzasadnienie: 'stała pomoc przy posiłkach' }, { id: 'obca.umiejetnosc', poziom: 3 }, { id: 'ogolne.higiena', poziom: 7 }],
      priorytety: ['gospodarstwo.zimne', 'x']
    }) + '\n```' }; } };
    const skills = [...PL.allSkills(W('gospodarstwo')), ...PL.allSkills(G)];
    const r = await analyzeDocument(prov, { type: 'orzeczenie', text: anon, skills, scale: store.settings.scale, workshop: 'Pracownia gospodarstwa domowego', disability: 'stopień znaczny' });
    assert(!/Kowalski|\bJan\b|90010712358|Lipowa/.test(seen), 'dane osobowe w zapytaniu');
    assert(seen.includes('gospodarstwo.zimne') && seen.includes('01-U'));
    assert.strictEqual(r.summary, 'Uczestnik wymaga stałej pomocy.');
    assert.deepStrictEqual([r.degree, r.codes], ['znaczny', ['01-U', '12C'].filter((c) => c === '01-U')]);
    assert.deepStrictEqual(r.difficulties, ['Przygotowanie posiłków']);
    assert.deepStrictEqual(r.goals, ['Samodzielne przygotowanie kanapki']);
    assert.deepStrictEqual(r.levels, [{ skillId: 'gospodarstwo.zimne', level: 1, reason: 'Stała pomoc przy posiłkach' }]);
    assert.deepStrictEqual(r.priorities, ['gospodarstwo.zimne']);
    await assert.rejects(() => analyzeDocument(prov, { type: 'ocena', text: ' ', skills, scale: store.settings.scale }), /Brak tekstu/);
  });

  await t('Plany: nadzór przy narzędziach dla uczestników z epilepsją / znacznym stopniem i tabela dostosowań', async () => {
    const w = W('gospodarstwo');
    const ewa = { id: 'p3', firstName: 'Ewa', lastName: 'Lis', gender: 'k', workshopId: 'gospodarstwo', disability: { degree: 'umiarkowany', codes: ['06-E'] }, adaptations: ['Nadzór przy kuchence.'] };
    const ctx = PL.makeCtx({ workshop: w, general: G, participants: [ewa, anna], marks: [], settings: store.settings });
    assert.deepStrictEqual(PL.individualFor(ctx, ['gospodarstwo.krojenie'], 'Sałatka'), [{ participantId: 'p3', supervision: true }]);
    assert.deepStrictEqual(PL.individualFor(ctx, ['gospodarstwo.planowanie'], 'Planowanie jadłospisu'), []);
    const plan = PL.generatePlan({ id: 'x', type: 'week', start: '2026-11-25', workshop: w, general: G, participants: [ewa, anna], marks: [], settings: store.settings, seed: 2 });
    const m = PL.buildPlanModel(plan, { workshop: w, general: G, participants: [ewa, anna], settings: store.settings, scale: store.settings.scale });
    const tbl = m.blocks.find((b) => b.kind === 'table' && b.cols[0].text === 'Uczestnik');
    assert.deepStrictEqual(tbl.rows, [['Ewa L.', 'stopień umiarkowany; 06-E (epilepsja)', '– Nadzór przy kuchence.']]);
    const html = renderHtml(m);
    assert(html.includes('Dostosowania do rodzaju i stopnia niepełnosprawności') && html.includes('nadzór i asekuracja przy narzędziach'));
  });

  await t('extractJson radzi sobie z tekstem wokół JSON', () => {
    assert.deepStrictEqual(extractJson('Oto wynik:\n```json\n{"a":1}\n```\nGotowe.'), { a: 1 });
  });

  // ───────────── AI: tryby, konta, plany, model lokalny ─────────────
  const aiBase = () => JSON.parse(JSON.stringify(require('../src/main/store').DEFAULT_SETTINGS.ai));

  await t('AI: domyślnie „Bez AI”, nieznany tryb z pliku → Bez AI', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wtz-ai-'));
    assert.strictEqual(new Store(d).settings.ai.provider, 'none');
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wtz-ai-'));
    fs.writeFileSync(path.join(d2, 'wtzhelper-dane.json'), JSON.stringify({ version: 1, settings: { ai: { provider: 'cos-dziwnego' } } }));
    const st = new Store(d2);
    assert.strictEqual(st.settings.ai.provider, 'none');
    assert.strictEqual(st.settings.ai.local.url, 'http://127.0.0.1:11434');
    assert.strictEqual(st.settings.scale.length, 5);
  });

  await t('AI: plany kont – rozpoznanie darmowego i płatnego planu', () => {
    const jwt = (claims) => 'x.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': claims })).toString('base64url') + '.y';
    assert.deepStrictEqual(P.codexPlanFromAuth({ tokens: { id_token: jwt({ chatgpt_plan_type: 'free' }) } }), { tier: 'free', plan: 'darmowy' });
    assert.deepStrictEqual(P.codexPlanFromAuth({ tokens: { id_token: jwt({ chatgpt_plan_type: 'plus' }) } }), { tier: 'paid', plan: 'Plus' });
    assert.deepStrictEqual(P.codexPlanFromAuth({ tokens: { id_token: jwt({ chatgpt_plan_type: 'pro', chatgpt_subscription_active_until: '2020-01-01T00:00:00Z' }) } }).tier, 'free');
    assert.strictEqual(P.codexPlanFromAuth({ OPENAI_API_KEY: 'sk' }), null);
    assert.deepStrictEqual(P.claudePlan({ loggedIn: true, subscriptionType: 'max' }), { tier: 'paid', plan: 'Max' });
    assert.strictEqual(P.claudePlan({ loggedIn: true }), null);
    const free = P.geminiPlanFromModels('Available models:\n  gemini-4-hydrogen\n  gemini-3.8-flash-high\n  gpt-oss-120b\n');
    assert.strictEqual(free.tier, 'free');
    assert(free.models.includes('gemini-3.8-flash-high'));
    assert.strictEqual(P.geminiPlanFromModels('gemini-4-hydrogen\ngemini-4-argon\nclaude-opus-5.5-thinking').tier, 'paid');
    assert.strictEqual(P.geminiPlanFromModels(''), null);

    const ai = aiBase();
    assert.strictEqual(P.effectiveTier(ai, 'codex'), 'free');
    assert.strictEqual(P.effectiveTier(ai, 'claude-code'), 'paid');
    ai.detected = { codex: { tier: 'paid', plan: 'Plus' } };
    assert.strictEqual(P.effectiveTier(ai, 'codex'), 'paid');
    ai.plans = { codex: 'free' };
    assert.strictEqual(P.effectiveTier(ai, 'codex'), 'free', 'ręczne ustawienie ma pierwszeństwo');
  });

  await t('AI: plan darmowy = domyślny model konta, płatny = wybrany mocniejszy model', () => {
    const ai = aiBase();
    ai.codexModel = 'gpt-mocny'; ai.geminiModel = 'gemini-4-argon'; ai.model = 'opus';
    assert.strictEqual(P.modelFor(ai, 'codex'), '');
    assert.strictEqual(P.modelFor(ai, 'gemini'), '');
    ai.detected = { codex: { tier: 'paid' }, gemini: { tier: 'paid' } };
    assert.strictEqual(P.modelFor(ai, 'codex'), 'gpt-mocny');
    assert.strictEqual(P.modelFor(ai, 'gemini'), 'gemini-4-argon');
    assert.strictEqual(P.modelFor(ai, 'claude-code'), 'opus');
    ai.paidModels = false;
    assert.strictEqual(P.modelFor(ai, 'codex'), '');
    assert.strictEqual(P.modelFor(ai, 'claude-code'), 'haiku');

    const settings = { ai: aiBase() };
    const cx = new P.CodexProvider(settings).args({ outFile: '/tmp/o.txt', model: '' });
    assert(!cx.includes('-m'), 'bez wymuszania modelu na darmowym planie');
    assert(cx.includes('web_search=disabled') && cx.includes('features.shell_tool=false') && cx[cx.length - 1] === '-');
    assert.deepStrictEqual(new P.CodexProvider(settings).args({ outFile: 'o', model: 'gpt-mocny' }).slice(-3), ['-m', 'gpt-mocny', '-']);
    const ag = new P.GeminiProvider(settings).args({ model: 'gemini-4-argon', full: 'TREŚĆ', stream: false });
    assert.deepStrictEqual(ag.slice(-2), ['-p', 'TREŚĆ']);
    assert(ag.includes('--sandbox') && ag.includes('--model'));
    const cl = new P.ClaudeCodeProvider(settings).args({ model: 'sonnet', bin: '/x/claude' });
    assert.deepStrictEqual(cl.slice(-2), ['--tools', '']);
  });

  await t('AI: kolejność kont przy limicie – najpierw darmowe, klucz API i model lokalny bez zastępstw', () => {
    const ai = aiBase();
    assert.deepStrictEqual(P.providerChain(ai), ['none']);
    ai.provider = 'local';
    assert.deepStrictEqual(P.providerChain(ai), ['local']);
    ai.provider = 'api'; ai.connected = { codex: true };
    assert.deepStrictEqual(P.providerChain(ai), ['api']);
    ai.provider = 'claude-code';
    ai.connected = { codex: true, gemini: true, 'claude-code': true };
    ai.detected = { codex: { tier: 'paid' }, gemini: { tier: 'free' } };
    assert.deepStrictEqual(P.providerChain(ai), ['claude-code', 'gemini', 'codex']);
    ai.provider = 'gemini'; ai.plans = { 'claude-code': 'free' };
    assert.deepStrictEqual(P.providerChain(ai), ['gemini', 'codex'], 'Claude bez płatnego planu pomijany');
    ai.fallback = false;
    assert.deepStrictEqual(P.providerChain(ai), ['gemini']);
  });

  await t('Strażnik prywatności: odmienione imię i nazwisko, PESEL, data urodzenia, adres', () => {
    const p = { firstName: 'Anna', lastName: 'Kowalska', pesel: '90030712345', birthDate: '1990-03-07', address: 'ul. Lipowa 3, Kraków' };
    assert.deepStrictEqual(findLeaks('«OSOBA» chętnie pracuje. Nowa sytuacja ją stresuje.', p), []);
    assert.deepStrictEqual(findLeaks('Rozmawiano z Kowalską.', p), ['nazwisko']);
    assert.deepStrictEqual(findLeaks('Annie trudno się skupić.', p), ['imię']);
    assert.deepStrictEqual(findLeaks('PESEL 90030712345', p), ['PESEL']);
    assert.deepStrictEqual(findLeaks('ur. 07.03.1990', p), ['data urodzenia']);
    assert.deepStrictEqual(findLeaks('mieszka: ul. Lipowa 3', p), ['adres']);
    const an = anonymizer(p, 'Pani Anna');
    const hidden = an.hide('Pani Anna pracuje. Pani Kowalskiej pomaga Annie mama.');
    assert.deepStrictEqual(findLeaks(hidden, p), []);
    assert.strictEqual(an.show(hidden), 'Pani Anna pracuje. Pani Kowalskiej pomaga Annie mama.');
  });

  // atrapy programów: codex, agy, claude w PATH
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'wtz-bin-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wtz-home-'));
  const sh = (name, body) => { fs.writeFileSync(path.join(bin, name), '#!/bin/bash\n' + body, { mode: 0o755 }); };
  sh('codex', `case "$1" in
  --version) echo "codex-cli 9.9.9";;
  login) if [ "$2" = status ]; then echo "Logged in using ChatGPT"; exit 0; fi;;
  exec) echo "$@" > "${home}/codex-args.txt"; out=""; while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done; cat > "${home}/codex-in.txt"; echo '{"ok":true}' > "$out";;
esac`);
  sh('agy', `case "$1" in
  --version) echo "agy 1.5.16";;
  models) printf 'Available models\\n  gemini-4-hydrogen\\n  gemini-3.8-flash-high\\n';;
  *) echo '{"status":"ERROR","error":"Individual quota reached for this week"}';;
esac`);
  sh('claude', `case "$1" in
  --version) echo "2.9.0 (Claude Code)";;
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.pl","subscriptionType":"pro"}';;
esac`);
  const oldPath = process.env.PATH;
  const oldCodexHome = process.env.CODEX_HOME;

  await t('Konta: stan, plan i zapytanie przez atrapy programów (Codex, Antigravity, Claude Code)', async () => {
    process.env.PATH = bin + path.delimiter + oldPath;
    process.env.CODEX_HOME = home;
    const jwt = 'x.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } })).toString('base64url') + '.y';
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ tokens: { id_token: jwt } }));
    const settings = { ai: { ...aiBase(), connected: { gemini: true } } };
    const plans = {};
    const acc = new Accounts({ getSettings: () => settings, emit: () => {}, onPlan: (id, pl) => { plans[id] = pl; settings.ai.detected[id] = pl; } });
    const cs = await acc.status('codex');
    assert(cs.installed && cs.loggedIn);
    assert.strictEqual(cs.tier, 'paid');
    assert.strictEqual(cs.planName, 'Plus');
    const gs = await acc.status('gemini');
    assert.strictEqual(gs.tier, 'free');
    assert.deepStrictEqual(gs.models, ['gemini-4-hydrogen', 'gemini-3.8-flash-high']);
    const ks = await acc.status('claude-code');
    assert.strictEqual(ks.email, 'a@b.pl');
    assert.strictEqual(ks.tier, 'paid');
    settings.ai.plans = { codex: 'free' };
    assert.strictEqual((await acc.status('codex')).tier, 'free');
    assert.strictEqual((await acc.status('codex')).detectedTier, 'paid');

    // płatny plan → wybrany model; zapytanie przez stdin, bez danych na wierszu poleceń
    settings.ai.plans = {};
    settings.ai.codexModel = 'gpt-mocny';
    const r = await new P.CodexProvider(settings).run({ system: 'S', prompt: 'TREŚĆ ZAPYTANIA' });
    assert.strictEqual(r.text.trim(), '{"ok":true}');
    assert(/-m gpt-mocny/.test(fs.readFileSync(path.join(home, 'codex-args.txt'), 'utf8')));
    assert(fs.readFileSync(path.join(home, 'codex-in.txt'), 'utf8').includes('TREŚĆ ZAPYTANIA'));
    await assert.rejects(() => new P.GeminiProvider(settings).run({ system: 'S', prompt: 'x' }), (e) => e.code === 'AI_LIMIT');
    await assert.rejects(() => new P.NoneProvider().run({}), (e) => e.code === 'AI_OFF');
  });
  process.env.PATH = oldPath;
  if (oldCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldCodexHome;

  await t('Model lokalny (Ollama): stan, pomijanie modeli chmurowych, pobieranie z postępem, zapytanie', async () => {
    let lastChat = null;
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.40.10' }));
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M', size: 6.7e9, details: { parameter_size: '11.2B' } }, { name: 'gemma4:cloud', size: 0 }] }));
        if (req.url === '/api/pull') { res.write(JSON.stringify({ status: 'pulling', total: 100, completed: 50 }) + '\n'); res.write(JSON.stringify({ status: 'pulling', total: 100, completed: 100 }) + '\n'); return res.end(JSON.stringify({ status: 'success' }) + '\n'); }
        if (req.url === '/api/chat') { lastChat = JSON.parse(body); return res.end(JSON.stringify({ message: { role: 'assistant', content: '<think>hmm</think>```json\n{"ok":true}\n```' } })); }
        res.statusCode = 404; res.end('{}');
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const st = await ollama.status(base, '/nie/ma/ollama');
      assert(st.running && st.installed);
      assert.deepStrictEqual(st.models.map((m) => m.name), ['SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M']);
      const prog = [];
      await ollama.pull(base, 'x', (p) => prog.push(p.completed));
      assert.deepStrictEqual(prog.slice(0, 2), [50, 100]);
      const settings = { ai: { ...aiBase(), provider: 'local', local: { url: base, model: 'SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M' } } };
      const lp = new P.LocalProvider(settings);
      assert(lp.isLocal);
      const r = await lp.run({ system: 'SYS', prompt: 'PYTANIE' });
      assert.deepStrictEqual(extractJson(r.text), { ok: true });
      assert.strictEqual(lastChat.model, 'SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M');
      assert.strictEqual(lastChat.messages[0].content, 'SYS');
      settings.ai.local.model = 'gemma4:cloud';
      await assert.rejects(() => lp.run({ system: 'S', prompt: 'p' }), /chmurze/);
      await assert.rejects(() => ollama.request('http://example.com', 'GET', '/api/tags'), /tym komputerze/);
    } finally { srv.close(); }
    const off = new P.LocalProvider({ ai: { ...aiBase(), local: { url: 'http://127.0.0.1:9', model: 'm' } } });
    await assert.rejects(() => off.run({ system: 'S', prompt: 'p' }), /nie jest uruchomiony/);
  });

  console.log(`\n${passed} testów zakończonych powodzeniem. Próbki DOCX: ${store.dir}`);
})();
