'use strict';
/* global UI, icon, api, state, render, go, field, errToast, aiOn, aiReady, aiName, needAi, autoGrow, fullName, fmtDate, todayIso, plural, wsById, workWorkshops, generalWs, skillsOf, scaleLabel, OCR, rerenderKeep */
// Dokumenty i skany: zdjęcia, zrzuty ekranu i PDF-y (orzeczenia, poprzednie arkusze ocen, IPR, opinie).
// 1) OCR na tym komputerze (Tesseract, język polski) – obrazy nigdy nie są wysyłane,
// 2) odczyt danych osobowych, stopnia i symboli niepełnosprawności, poziomów umiejętności i celów,
// 3) tekst dla AI po pseudonimizacji + strażnik prywatności,
// 4) opcjonalna analiza agenta AI: dostosowania, cele IPR, oceny wyjściowe – do przyjęcia po sprawdzeniu.

const DEGREE_OPTS = [{ value: '', label: '— nie ustalono —' }, { value: 'lekki', label: 'lekki' }, { value: 'umiarkowany', label: 'umiarkowany' }, { value: 'znaczny', label: 'znaczny' }];
const describeDis = (d) => { if (!d) return ''; const p = []; if (d.degree) p.push(`stopień ${d.degree}`); if ((d.codes || []).length) p.push(d.codes.join(', ')); return p.join(' · '); };
const localAdapt = (d) => { const out = []; for (const c of (d && d.codes) || []) for (const a of state.info.adapt[c] || []) if (!out.includes(a)) out.push(a); for (const a of state.info.degreeAdapt[(d && d.degree) || ''] || []) if (!out.includes(a)) out.push(a); return out; };

function newDocState(pid) { return { stage: 'pick', type: 'orzeczenie', participantId: pid || '', pages: [], loading: false, progress: null, text: '', parsed: null, personal: {}, disability: null, anonText: '', hits: 0, leaks: [], manualAnon: false, overwrite: false, pickLevels: {}, pickGoals: {}, date: '' }; }

const docFileInput = UI.h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, style: { display: 'none' } });
document.body.append(docFileInput);
docFileInput.addEventListener('change', () => { addDocFiles([...docFileInput.files]); docFileInput.value = ''; });
// Ctrl+V ze zrzutem ekranu w widoku dokumentów
document.addEventListener('paste', (e) => {
  if (state.view !== 'docs' || !state.doc || state.doc.stage !== 'pick') return;
  if (/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '')) return;
  const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); addDocFiles(files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `zrzut-ekranu-${Date.now()}-${i + 1}.png`, { type: f.type }))); }
});

function openDocs(pid) { state.doc = newDocState(pid); go('docs'); }

async function addDocFiles(files) {
  if (!files.length) return;
  if (!state.doc || state.doc.stage !== 'pick') state.doc = newDocState(state.doc && state.doc.participantId);
  const D = state.doc;
  D.loading = true; render();
  for (const f of files) {
    try {
      const pages = await OCR.fileToPages(f);
      pages.forEach((c, i) => D.pages.push({ canvas: c, name: pages.length > 1 ? `${f.name} – str. ${i + 1}` : f.name, thumb: OCR.toJpeg(c, 360, 0.8) }));
    } catch (e) { errToast(e); }
  }
  D.loading = false;
  render();
}

async function pasteScreenshot() {
  try {
    const b64 = await api.clipboardImage();
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await addDocFiles([new File([arr], `zrzut-ekranu-${new Date().toLocaleTimeString('pl').replace(/:/g, '-')}.png`, { type: 'image/png' })]);
  } catch (e) { errToast(e); }
}

const currentPerson = (D) => {
  const p = D.participantId ? state.participants.find((x) => x.id === D.participantId) : null;
  return { ...(p || {}), ...Object.fromEntries(Object.entries(D.personal).filter(([, v]) => v)), disability: D.disability || (p && p.disability) || null };
};

async function refreshAnon(D) {
  if (D.manualAnon) { D.leaks = await api.docGuard(D.anonText, currentPerson(D), D.participantId); return; }
  const r = await api.docAnonymize(D.text, currentPerson(D), D.participantId);
  D.anonText = r.text; D.hits = r.hits; D.leaks = r.leaks;
}

async function runDocOcr() {
  const D = state.doc;
  D.stage = 'ocr'; D.progress = null; render();
  const texts = [];
  try {
    for (let i = 0; i < D.pages.length; i++) {
      D.progress = { page: i + 1, total: D.pages.length }; render();
      const r = await OCR.recognize(D.pages[i].canvas, (p) => { const bar = document.getElementById('ocr-bar'); if (bar) bar.style.width = `${Math.round(((i + p) / D.pages.length) * 100)}%`; });
      texts.push(r.text);
    }
  } catch (e) { D.stage = 'pick'; errToast(new Error('Odczyt tekstu nie powiódł się: ' + (e.message || e))); render(); return; }
  await toReview(texts.join('\n\n'));
}

async function toReview(text) {
  const D = state.doc;
  try {
    D.text = text;
    D.parsed = await api.docParse(D.type, text, D.participantId);
    D.personal = { ...D.parsed.personal };
    if (!D.participantId) D.personal.workshopId = (workWorkshops()[0] || {}).id || '';
    D.disability = D.parsed.disability ? { ...D.parsed.disability } : null;
    D.date = D.parsed.date || todayIso();
    D.pickLevels = Object.fromEntries(D.parsed.levels.map((l) => [l.skillId, true]));
    D.pickGoals = Object.fromEntries(D.parsed.goals.map((g, i) => [i, true]));
    await refreshAnon(D);
    D.stage = 'review';
  } catch (e) { D.stage = 'pick'; errToast(e); }
  render();
}

function pasteTextSheet() {
  const ta = UI.h('textarea', { class: 'input', rows: 12, placeholder: 'Wklej tekst dokumentu skopiowany z pliku PDF, Worda lub systemu…' });
  UI.sheet({ title: 'Wklej tekst dokumentu', wide: true, body: ta, actions: [{ label: 'Anuluj' }, { label: 'Dalej', kind: 'primary', onClick: async () => { if (!ta.value.trim()) return false; await toReview(ta.value); } }] });
  setTimeout(() => ta.focus(), 100);
}

// ───────── widok ─────────
function viewDocs() {
  const { h, iconEl, segmented, select, spinner } = UI;
  if (!state.doc) state.doc = newDocState();
  const D = state.doc;
  if (D.stage === 'review') return viewDocReview();
  const people = state.participants;
  const typeSeg = segmented(Object.entries(state.info.docTypes).map(([value, label]) => ({ value, label: label.replace(/ \(.*\)$/, '').replace('Orzeczenie o stopniu niepełnosprawności', 'Orzeczenie').replace('Indywidualny program rehabilitacji', 'IPR').replace('Poprzednia ocena / arkusz ocen', 'Arkusz ocen').replace('Inny dokument', 'Inny') })), D.type, (v) => { D.type = v; });
  const dz = h('div', { class: 'dropzone', onclick: () => docFileInput.click() },
    h('div', { class: 'dz-ic', html: icon('scan', 30) }),
    h('h2', null, 'Upuść tutaj zdjęcia, zrzuty ekranu lub PDF-y'),
    h('p', { class: 'muted' }, 'Orzeczenie o stopniu niepełnosprawności, poprzednie arkusze ocen, IPR, opinie. JPG, PNG, WEBP lub PDF. Zrzut ekranu wkleisz skrótem Ctrl+V.'),
    h('div', { class: 'dz-actions' },
      h('button', { class: 'btn primary', onclick: (e) => { e.stopPropagation(); docFileInput.click(); } }, iconEl('upload', 15), 'Wybierz pliki'),
      h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); pasteScreenshot(); } }, iconEl('photo', 15), 'Wklej zrzut ekranu'),
      h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); pasteTextSheet(); } }, iconEl('doc', 15), 'Wklej tekst')));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); addDocFiles([...e.dataTransfer.files]); });

  const thumbs = D.pages.length ? h('div', { class: 'thumbs' }, D.pages.map((p, i) => h('div', { class: 'thumb' }, h('img', { src: p.thumb, alt: p.name }), h('span', { class: 'pg' }, String(i + 1)),
    D.stage === 'pick' ? h('button', { class: 'rm', title: 'Usuń', onclick: () => { D.pages.splice(i, 1); render(); }, html: icon('x', 12) }) : null)),
  D.stage === 'pick' ? h('div', { class: 'thumb add', onclick: () => docFileInput.click() }, iconEl('plus', 22), h('span', { class: 'small muted' }, 'Dodaj stronę')) : null) : null;

  const ocrBox = D.stage === 'ocr' ? h('div', { class: 'card card-pad', style: { marginTop: '14px' } },
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, spinner(20), h('div', { style: { flex: 1 } },
      h('b', null, D.progress ? `Odczytuję stronę ${D.progress.page} z ${D.progress.total}…` : 'Przygotowuję odczyt tekstu…'),
      h('div', { class: 'muted small' }, 'Rozpoznawanie tekstu (język polski) działa na tym komputerze – obrazy nie są nigdzie wysyłane. Pierwsze uruchomienie trwa dłużej.'),
      h('div', { class: 'progress', style: { marginTop: '8px' } }, h('div', { id: 'ocr-bar', style: { width: '0%' } }))))) : null;

  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Dokumenty i skany'), h('div', { class: 'spacer' }),
      D.pages.length && D.stage === 'pick' ? h('button', { class: 'btn', onclick: () => { state.doc = newDocState(D.participantId); render(); } }, 'Wyczyść') : null),
    h('div', { class: 'page' },
      h('div', { class: 'card card-pad ed-card' },
        h('div', { class: 'form-grid two' },
          field('Uczestnik', select([{ value: '', label: '＋ Nowy uczestnik – dane z dokumentu' }, ...people.map((p) => ({ value: p.id, label: `${p.lastName} ${p.firstName}` }))], D.participantId, (v) => { D.participantId = v; }, { style: 'width:100%' })),
          field('Rodzaj dokumentu', typeSeg))),
      D.pages.length ? null : dz,
      D.loading ? h('div', { class: 'muted', style: { margin: '12px 0' } }, spinner(14), ' Wczytuję pliki…') : null,
      thumbs, ocrBox,
      D.pages.length && D.stage === 'pick' ? h('div', { class: 'action-bar' },
        h('div', { class: 'muted small', style: { flex: 1 } }, iconEl('lock', 13), ` ${D.pages.length} ${plural(D.pages.length, 'strona', 'strony', 'stron')} · odczyt na tym komputerze, bez internetu`),
        h('button', { class: 'btn', onclick: pasteScreenshot }, iconEl('photo', 14), 'Wklej zrzut'),
        h('button', { class: 'btn primary lg', onclick: runDocOcr }, iconEl('scan', 16), 'Odczytaj dokument')) : null,
      D.pages.length ? null : h('div', { class: 'grid grid-3', style: { marginTop: '18px' } },
        stepCard('1', 'scan', 'Odczyt lokalny', 'Tekst rozpoznawany jest na tym komputerze. Aplikacja odczytuje dane osobowe, stopień i symbole niepełnosprawności, poziomy umiejętności i cele.'),
        stepCard('2', 'shield', 'Sprawdzenie i anonimizacja', 'Poprawiasz odczytane dane i uzupełniasz kartę uczestnika. Z tekstu dla AI usuwane są imiona, nazwiska, PESEL, daty i adresy.'),
        stepCard('3', 'sparkles', 'Analiza agenta AI', 'Opcjonalnie AI proponuje dostosowania do rodzaju i stopnia niepełnosprawności, cele IPR i oceny wyjściowe – przyjmujesz tylko to, co zaznaczysz.'))));
}

function stepCard(n, ic, title, text) {
  const { h } = UI;
  return h('div', { class: 'card step-card' }, h('div', { class: 'step-n' }, n), h('div', { class: 'step-ic', html: icon(ic, 22) }), h('h3', null, title), h('p', { class: 'muted small' }, text));
}

function guardLine(D) {
  const { h, iconEl } = UI;
  return D.leaks.length
    ? h('div', { class: 'status-line bad' }, iconEl('warn', 14), `Strażnik: w tekście zostały dane osobowe (${D.leaks.join(', ')}) – wysyłka do AI zostanie zablokowana. Popraw dane uczestnika albo usuń je z tekstu.`)
    : h('div', { class: 'status-line ok' }, iconEl('shield', 14), 'Strażnik: w tekście dla AI nie ma danych osobowych.');
}

function codesToggles(dis, onChange) {
  const { h } = UI;
  return h('div', { class: 'code-toggles' }, Object.entries(state.info.codes).map(([c, label]) => h('button', {
    class: 'pick' + ((dis.codes || []).includes(c) ? ' on' : ''), type: 'button', title: label,
    onclick: (e) => { dis.codes = (dis.codes || []).includes(c) ? dis.codes.filter((x) => x !== c) : [...(dis.codes || []), c]; e.currentTarget.classList.toggle('on'); onChange(); }
  }, `${c} ${label}`)));
}

function viewDocReview() {
  const { h, iconEl, segmented, select, busy } = UI;
  const D = state.doc;
  const P = D.personal;
  const existing = D.participantId ? state.participants.find((p) => p.id === D.participantId) : null;
  const onPersonal = async () => { await refreshAnon(D); const ta = document.getElementById('anon-ta'); if (ta && !D.manualAnon) ta.value = D.anonText; const g = document.getElementById('guard-line'); if (g) g.replaceChildren(guardLine(D)); };
  const inp = (k, label, attrs = {}) => field(label, h('input', { class: 'input full', value: P[k] || '', placeholder: existing && existing[k] ? `w karcie: ${existing[k]}` : '', ...attrs, onchange: (e) => { P[k] = e.target.value.trim(); onPersonal(); } }));

  const personCard = h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('person', 16), existing ? `Dane z dokumentu → ${fullName(existing)}` : 'Nowy uczestnik – dane z dokumentu', h('div', { class: 'spacer' }), h('span', { class: 'chip green' }, iconEl('lock', 11), ' tylko na tym komputerze')),
    h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, 'Odczytane automatycznie – popraw ewentualne błędy odczytu. Dane trafią do karty uczestnika i posłużą do anonimizacji tekstu.'),
    h('div', { class: 'form-grid' },
      inp('firstName', 'Imię'), inp('lastName', 'Nazwisko'),
      field('Płeć', segmented([{ value: 'm', label: 'Mężczyzna' }, { value: 'k', label: 'Kobieta' }], P.gender || (existing && existing.gender) || 'm', (v) => { P.gender = v; }), { gridColumn: 'span 2' }),
      inp('birthDate', 'Data urodzenia', { type: 'date' }), inp('pesel', 'PESEL', { maxlength: 11 }),
      field('Pracownia', select([{ value: '', label: existing ? '— bez zmian —' : '— nieprzypisany —' }, ...workWorkshops().map((w) => ({ value: w.id, label: w.name }))], P.workshopId || '', (v) => { P.workshopId = v; }, { style: 'width:100%' }), { gridColumn: 'span 2' })),
    inp('address', 'Adres zamieszkania'),
    existing ? h('label', { class: 'check', style: { marginTop: '6px' } }, h('input', { type: 'checkbox', checked: D.overwrite, onchange: (e) => { D.overwrite = e.target.checked; } }), 'Nadpisz dane już wpisane w karcie (domyślnie uzupełniane są tylko puste pola)') : null);

  if (!D.disability && D.type === 'orzeczenie') D.disability = { degree: '', codes: [], number: '', issued: '', validUntil: '', therapy: '', notes: '' };
  const dis = D.disability;
  const adaptBox = h('div', { class: 'adapt-preview' });
  const drawAdapt = () => { const a = dis ? localAdapt(dis) : []; adaptBox.replaceChildren(...(a.length ? [h('div', { class: 'muted small' }, 'Dostosowania z bazy wiedzy (trafią do karty, jeśli jest pusta):'), h('ul', { class: 'bullets' }, a.map((x) => h('li', null, x)))] : [])); };
  drawAdapt();
  const disCard = dis ? h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('flag', 16), 'Orzeczenie – rodzaj i stopień niepełnosprawności'),
    h('div', { class: 'form-grid' },
      field('Stopień niepełnosprawności', select(DEGREE_OPTS, dis.degree || '', (v) => { dis.degree = v; drawAdapt(); }, { style: 'width:100%' })),
      field('Nr orzeczenia', h('input', { class: 'input full', value: dis.number || '', onchange: (e) => { dis.number = e.target.value.trim(); onPersonal(); } })),
      field('Data wydania', h('input', { class: 'input full', type: 'date', value: dis.issued || '', onchange: (e) => { dis.issued = e.target.value; } })),
      field('Ważne do', h('input', { class: 'input full', value: dis.validUntil || '', placeholder: 'np. na stałe albo 2027-03-31', onchange: (e) => { dis.validUntil = e.target.value.trim(); } }))),
    field('Symbole przyczyny niepełnosprawności (najwyżej 3)', codesToggles(dis, drawAdapt)),
    dis.therapy ? h('div', { class: 'muted small' }, `Wskazanie do uczestnictwa w terapii zajęciowej: ${dis.therapy}`) : null,
    adaptBox) : null;

  const lv = D.parsed.levels;
  const skills = new Map([...(existing ? [wsById(existing.workshopId), generalWs()] : [generalWs()])].filter(Boolean).flatMap(skillsOf).map((s) => [s.id, s.name]));
  const levelsCard = lv.length ? h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('table', 16), `Poziomy umiejętności odczytane z dokumentu (${lv.length})`),
    h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, 'Zaznaczone trafią jako oceny cząstkowe z wybranej daty – staną się punktem wyjścia do planów i ocen okresowych.'),
    field('Data ocen', h('input', { class: 'input', type: 'date', value: D.date, onchange: (e) => { D.date = e.target.value; } })),
    h('table', { class: 'tbl' }, h('tbody', null, lv.map((l) => h('tr', null,
      h('td', null, h('input', { type: 'checkbox', checked: !!D.pickLevels[l.skillId], onchange: (e) => { D.pickLevels[l.skillId] = e.target.checked; } })),
      h('td', null, skills.get(l.skillId) || l.skillId), h('td', null, h('span', { class: 'chip pv' + l.level }, `${l.level} – ${scaleLabel(l.level).toLowerCase()}`)), h('td', { class: 'muted small' }, l.line)))))) : null;
  const goalsCard = D.parsed.goals.length ? h('div', { class: 'card card-pad ed-card' },
    h('div', { class: 'card-title' }, iconEl('flag', 16), 'Cele odczytane z dokumentu'),
    D.parsed.goals.map((g, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!D.pickGoals[i], onchange: (e) => { D.pickGoals[i] = e.target.checked; } }), g))) : null;

  const anon = h('textarea', { class: 'input full mono-sm', id: 'anon-ta', rows: 18, value: D.anonText, oninput: (e) => { D.anonText = e.target.value; D.manualAnon = true; clearTimeout(anon._t); anon._t = setTimeout(async () => { D.leaks = await api.docGuard(D.anonText, currentPerson(D), D.participantId); const g = document.getElementById('guard-line'); if (g) g.replaceChildren(guardLine(D)); }, 400); } });
  const textCard = h('div', { class: 'card card-pad sticky-card' },
    h('div', { class: 'card-title' }, iconEl('shield', 16), 'Tekst dla agenta AI (zanonimizowany)'),
    h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, `Tylko ten tekst może trafić do AI. Ukryto ${D.hits} ${plural(D.hits, 'fragment', 'fragmenty', 'fragmentów')} z danymi osobowymi. Możesz go poprawić, np. usunąć wzmianki o innych osobach.`),
    anon, h('div', { id: 'guard-line', style: { marginTop: '8px' } }, guardLine(D)),
    h('details', { class: 'raw' }, h('summary', null, 'Pełny odczytany tekst (zostaje na komputerze)'), h('pre', { class: 'mono-sm' }, D.text)));

  const save = async (analyze) => {
    if (!existing && (!String(P.firstName || '').trim() || !String(P.lastName || '').trim())) { UI.toast('Uzupełnij imię i nazwisko uczestnika.', 'error'); return; }
    if (analyze && D.leaks.length) { UI.toast('Tekst dla AI nadal zawiera dane osobowe – popraw go przed analizą.', 'error', 7000); return; }
    try {
      const scans = D.pages.map((p) => OCR.toJpeg(p.canvas, 1800, 0.85).split(',')[1]);
      const r = await api.docSave({ participantId: D.participantId || null, personal: P, disability: dis && (dis.degree || (dis.codes || []).length || dis.number) ? dis : null, doc: { type: D.type, name: D.pages[0] ? D.pages[0].name : state.info.docTypes[D.type], date: D.date, text: D.text, anonText: D.anonText }, scans, overwrite: D.overwrite });
      const pid = r.participant.id;
      const marks = lv.filter((l) => D.pickLevels[l.skillId]).map((l) => ({ skillId: l.skillId, level: l.level }));
      const goals = D.parsed.goals.filter((g, i) => D.pickGoals[i]);
      if (marks.length || goals.length) await api.docApply(pid, { marks, goals, date: D.date });
      state.participants = await api.listParticipants();
      UI.toast(existing ? 'Zapisano dokument w karcie uczestnika' : 'Utworzono uczestnika z danych dokumentu', 'success', 3500);
      state.doc = newDocState(pid);
      render();
      if (analyze) await analyzeDoc(pid, r.docId);
    } catch (e) { errToast(e); }
  };

  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Sprawdź odczytane dane'), h('span', { class: 'chip blue' }, state.info.docTypes[D.type]), h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => { D.stage = 'pick'; render(); } }, iconEl('chevronL', 13), 'Wróć'),
      h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, () => save(false), 'Zapisuję…') }, 'Zapisz w karcie'),
      aiOn() ? h('button', { class: 'btn primary', title: aiReady() ? `${aiName()} przeanalizuje zanonimizowany tekst` : 'Wymaga połączenia z AI', onclick: (e) => { if (needAi()) busy(e.currentTarget, () => save(true), 'Analizuję…'); } }, iconEl('sparkles', 14), 'Zapisz i analizuj z AI') : null),
    h('div', { class: 'page' }, h('div', { class: 'review-grid' }, h('div', null, personCard, disCard, levelsCard, goalsCard), h('div', null, textCard))));
}

// ───────── analiza AI i przyjęcie wyników ─────────
async function analyzeDoc(pid, docId) {
  try {
    const a = await api.docAnalyze(pid, docId);
    state.participants = await api.listParticipants();
    showAnalysis(pid, docId, a);
  } catch (e) { errToast(e); render(); }
}

function showAnalysis(pid, docId, a) {
  const { h, iconEl } = UI;
  const p = state.participants.find((x) => x.id === pid);
  const doc = ((p && p.documents) || []).find((d) => d.id === docId) || {};
  const skills = new Map([wsById(p.workshopId), generalWs()].filter(Boolean).flatMap(skillsOf).map((s) => [s.id, s.name]));
  const pick = { adapt: Object.fromEntries(a.adaptations.map((_, i) => [i, true])), goals: Object.fromEntries(a.goals.map((_, i) => [i, true])), levels: Object.fromEntries(a.levels.map((l) => [l.skillId, true])), dis: !!(a.degree || a.codes.length) && !(p.disability && (p.disability.degree || (p.disability.codes || []).length)) };
  let date = doc.date || todayIso();
  const chk = (obj, k, label, extra) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!obj[k], onchange: (e) => { obj[k] = e.target.checked; } }), label, extra || null);
  const list = (title, items) => (items.length ? h('div', { class: 'an-block' }, h('div', { class: 'an-title' }, title), h('ul', { class: 'bullets' }, items.map((x) => h('li', null, x)))) : null);
  UI.sheet({
    title: `Analiza dokumentu – ${fullName(p)}`, wide: true,
    subtitle: `${a.provider ? a.provider + ' · ' : ''}Zaznacz, co przyjąć do karty uczestnika. Dostosowania i cele IPR wpływają na plany i oceny, oceny wyjściowe – na dobór zajęć i porównania postępów.`,
    body: h('div', { class: 'analysis' },
      a.summary ? h('div', { class: 'an-block' }, h('div', { class: 'an-title' }, 'Obraz funkcjonowania'), h('p', null, a.summary)) : null,
      h('div', { class: 'an-cols' }, list('Mocne strony', a.strengths), list('Trudności', a.difficulties)),
      a.degree || a.codes.length ? h('div', { class: 'an-block' }, h('div', { class: 'an-title' }, 'Orzeczenie'), chk(pick, 'dis', `Wpisz do karty: ${[a.degree ? 'stopień ' + a.degree : '', a.codes.join(', ')].filter(Boolean).join(' · ')}`, p.disability && (p.disability.degree || (p.disability.codes || []).length) ? h('span', { class: 'muted small' }, ` (w karcie: ${describeDis(p.disability)})`) : null)) : null,
      a.adaptations.length ? h('div', { class: 'an-block' }, h('div', { class: 'an-title' }, 'Dostosowania do rodzaju i stopnia niepełnosprawności'), a.adaptations.map((x, i) => chk(pick.adapt, i, x))) : null,
      a.goals.length ? h('div', { class: 'an-block' }, h('div', { class: 'an-title' }, 'Propozycje celów IPR'), a.goals.map((x, i) => chk(pick.goals, i, x))) : null,
      a.levels.length ? h('div', { class: 'an-block' }, h('div', { class: 'an-title' }, 'Oceny wyjściowe umiejętności'),
        field('Data ocen', h('input', { class: 'input', type: 'date', value: date, onchange: (e) => { date = e.target.value; } })),
        h('table', { class: 'tbl' }, h('tbody', null, a.levels.map((l) => h('tr', null,
          h('td', null, h('input', { type: 'checkbox', checked: true, onchange: (e) => { pick.levels[l.skillId] = e.target.checked; } })),
          h('td', null, skills.get(l.skillId) || l.skillId), h('td', null, h('span', { class: 'chip pv' + l.level }, `${l.level} – ${scaleLabel(l.level).toLowerCase()}`)), h('td', { class: 'muted small' }, l.reason || '')))))) : null,
      a.priorities.length ? h('div', { class: 'an-block' }, h('div', { class: 'an-title' }, 'Priorytety w planowaniu'), h('div', { class: 'skill-chips' }, a.priorities.map((id) => h('span', { class: 'chip green' }, skills.get(id) || id)))) : null),
    actions: [{ label: 'Zamknij' }, { label: 'Przyjmij zaznaczone', kind: 'primary', onClick: async () => {
      try {
        const r = await api.docApply(pid, {
          adaptations: a.adaptations.filter((_, i) => pick.adapt[i]), goals: a.goals.filter((_, i) => pick.goals[i]),
          marks: a.levels.filter((l) => pick.levels[l.skillId]).map((l) => ({ skillId: l.skillId, level: l.level })), date,
          disability: pick.dis ? { degree: a.degree, codes: a.codes } : null
        });
        state.participants = await api.listParticipants();
        UI.toast(`Zapisano w karcie uczestnika${r.marks ? ` (${r.marks} ${plural(r.marks, 'ocena', 'oceny', 'ocen')} wyjściowych)` : ''}`, 'success', 4000);
        render();
      } catch (e) { errToast(e); return false; }
    } }]
  });
}

// ───────── karta uczestnika: orzeczenie, dostosowania, dokumenty ─────────
function participantDisabilitySection(d) {
  const { h, iconEl, select } = UI;
  d.disability = d.disability || { degree: '', codes: [], number: '', issued: '', validUntil: '', therapy: '', notes: '' };
  d.adaptations = d.adaptations || [];
  const dis = d.disability;
  const ta = autoGrow(h('textarea', { class: 'input', rows: 3, value: d.adaptations.join('\n'), placeholder: 'Każde dostosowanie w osobnej linii – trafia do planów (tabela dostosowań) i do zapytań AI (bez danych osobowych).', oninput: (e) => { d.adaptations = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); } }));
  return h('div', { class: 'dis-section' },
    h('div', { class: 'form-grid' },
      field('Stopień niepełnosprawności', select(DEGREE_OPTS, dis.degree || '', (v) => { dis.degree = v; }, { style: 'width:100%' })),
      field('Nr orzeczenia', h('input', { class: 'input full', value: dis.number || '', onchange: (e) => { dis.number = e.target.value.trim(); } })),
      field('Data wydania', h('input', { class: 'input full', type: 'date', value: dis.issued || '', onchange: (e) => { dis.issued = e.target.value; } })),
      field('Ważne do', h('input', { class: 'input full', value: dis.validUntil || '', placeholder: 'na stałe / data', onchange: (e) => { dis.validUntil = e.target.value.trim(); } }))),
    field('Symbole przyczyny niepełnosprawności', codesToggles(dis, () => {})),
    field('Dostosowania form i metod pracy', h('div', null, ta,
      h('button', { class: 'btn plain sm', onclick: () => { const add = localAdapt(dis).filter((x) => !d.adaptations.includes(x)); d.adaptations.push(...add); ta.value = d.adaptations.join('\n'); ta.dispatchEvent(new Event('input')); UI.toast(add.length ? `Dodano ${add.length} z bazy wiedzy` : 'Brak nowych dostosowań dla wybranego stopnia i symboli', 'info', 2500); } }, iconEl('plus', 12), 'Uzupełnij z bazy wiedzy (wg stopnia i symboli)'))));
}

function participantDocsSection(d, closeSheet) {
  const { h, iconEl } = UI;
  const docs = d.documents || [];
  return h('div', { class: 'doc-list' },
    docs.length ? docs.map((doc) => h('div', { class: 'doc-row' },
      h('span', { class: 'doc-ic', html: icon('doc', 15) }),
      h('div', { style: { flex: 1, minWidth: 0 } }, h('b', null, state.info.docTypes[doc.type] || doc.type), h('div', { class: 'muted small' }, [doc.name, doc.date ? fmtDate(doc.date) : '', doc.analysis ? 'przeanalizowany przez AI' : ''].filter(Boolean).join(' · '))),
      doc.analysis ? h('button', { class: 'btn sm', onclick: () => { closeSheet(); showAnalysis(d.id, doc.id, doc.analysis); } }, 'Wyniki analizy') : null,
      aiOn() ? h('button', { class: 'btn sm ai', onclick: (e) => { if (needAi()) UI.busy(e.currentTarget, async () => { closeSheet(); await analyzeDoc(d.id, doc.id); }, 'Analizuję…'); } }, iconEl('sparkles', 12), doc.analysis ? 'Ponownie' : 'Analizuj z AI') : null,
      (doc.scans || []).length ? h('button', { class: 'icon-btn', title: 'Otwórz skan', onclick: () => api.docOpenScan(d.id, doc.scans[0]), html: icon('eye', 14) }) : null,
      h('button', { class: 'icon-btn', title: 'Usuń dokument', onclick: async () => { try { const p = await api.docRemove(d.id, doc.id); d.documents = p.documents; state.participants = await api.listParticipants(); closeSheet(); UI.toast('Usunięto dokument', 'success', 1500); } catch (e) { errToast(e); } }, html: icon('trash', 14) })))
      : h('div', { class: 'muted small' }, 'Brak dokumentów. Wczytaj zdjęcie orzeczenia, poprzedni arkusz ocen albo IPR.'),
    h('button', { class: 'btn plain sm', onclick: () => { closeSheet(); openDocs(d.id); } }, iconEl('scan', 12), 'Wczytaj dokument lub zrzut ekranu'));
}
