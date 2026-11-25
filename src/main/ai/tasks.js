'use strict';
// Zadania AI w WTZ Helper: redakcja opisów oceny, propozycja podsumowania i zaleceń,
// dobór zajęć do planu (wyłącznie z banku zajęć pracowni) i propozycja profilu nowej pracowni.
// Do modelu nie trafiają dane osobowe: imię i nazwisko zastępują znaczniki, daty urodzenia, PESEL-u i adresu nie wysyłamy.

const { extractJson } = require('./providers');

const SYSTEM = `Jesteś doświadczonym terapeutą zajęciowym i redaktorem dokumentacji warsztatu terapii zajęciowej (WTZ) w Polsce.
Zasady:
- Piszesz po polsku, stylem rzeczowym i opisowym, w trzeciej osobie i czasie teraźniejszym – jak w dokumentacji WTZ (plany pracy, oceny okresowe, oceny kompleksowe IPR).
- Nie dodajesz faktów, diagnoz ani ocen, których nie ma w otrzymanym materiale. Nie zmieniasz poziomu opanowania umiejętności opisanego w tekście.
- Znaczniki «OSOBA», «IMIĘ» i «NAZWISKO» (także z numerem, np. «IMIĘ-2») przepisujesz dokładnie w tej postaci. Znacznik «OSOBA» występuje zawsze w mianowniku jako podmiot zdania.
- Zachowujesz rodzaj gramatyczny podany w zadaniu.`;

const TOKENS = { osoba: '«OSOBA»', first: '«IMIĘ»', last: '«NAZWISKO»' };

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Wzorzec imienia lub nazwiska z typowymi polskimi końcówkami odmiany
// (Kowalski → Kowalskiego, Kowalskiemu…; Anna → Anny, Annie, Annę…; Jan → Jana, Janem…).
function namePattern(value) {
  const v = String(value || '').trim();
  if (v.length < 2) return null;
  let stem = v;
  let suffixes = 'a|y|i|ie|e|ę|ą|o|u|owi|em|iem|ów|owie|owa|owej|ową|owa';
  if (/(sk|ck|dzk)i$/i.test(v)) { stem = v.slice(0, -1); suffixes = 'i|iego|iemu|im|a|iej|ą'; }
  else if (/(sk|ck|dzk)a$/i.test(v)) { stem = v.slice(0, -1); suffixes = 'a|iej|ą|i|iego|iemu|im'; }
  else if (/a$/i.test(v) && v.length > 3) { stem = v.slice(0, -1); suffixes = 'a|y|i|ie|ę|ą|o|u|ach|om'; }
  const body = stem === v ? `${escRe(v)}(?:${suffixes})?` : `${escRe(stem)}(?:${suffixes})`;
  return new RegExp(`(?<![\\p{L}])${body}(?![\\p{L}])`, 'gu');
}

// Zamienia dane osobowe na znaczniki; zwraca funkcję odwracającą.
function anonymizer(person, refName) {
  const pairs = [];
  const ref = String(refName || '').trim();
  const first = String((person && person.firstName) || '').trim();
  const last = String((person && person.lastName) || '').trim();
  if (first.length >= 2 && ref.includes(first)) pairs.push([ref, TOKENS.osoba, new RegExp(`(?<![\\p{L}])${escRe(ref)}(?![\\p{L}])`, 'giu')]);
  if (last.length >= 2) pairs.push([last, TOKENS.last, namePattern(last)]);
  if (first.length >= 2) pairs.push([first, TOKENS.first, namePattern(first)]);
  // Każda odmieniona forma dostaje własny znacznik (np. «IMIĘ-2» = „Jana”), żeby po odpowiedzi
  // wróciła dokładnie ta sama forma – bez psucia odmiany.
  const forms = new Map(); // token -> forma
  const hide = (text) => {
    let out = String(text || '');
    for (const [value, token, rx] of pairs) {
      out = out.replace(rx, (m) => {
        if (m === value || token === TOKENS.osoba) { forms.set(token, value); return token; }
        for (const [t, f] of forms) if (f === m) return t;
        let n = 2;
        while (forms.has(token.replace('»', `-${n}»`))) n++;
        const t = token.replace('»', `-${n}»`);
        forms.set(t, m);
        return t;
      });
    }
    return out;
  };
  const show = (text) => {
    let out = String(text || '');
    const all = [...forms.entries(), ...pairs.map(([value, token]) => [token, value])]
      .sort((a, b) => b[0].length - a[0].length);
    for (const [token, value] of all) out = out.split(token).join(value);
    // model mógł pominąć cudzysłowy ostrokątne
    return out.replace(/«|»/g, '');
  };
  return { hide, show };
}

// Strażnik prywatności: zwraca listę danych osobowych, które zostały w tekście
// (imię, nazwisko – także odmienione, PESEL, data urodzenia, adres). Pusta lista = można wysłać.
function findLeaks(text, person) {
  const t = String(text || '');
  const leaks = [];
  const P = person || {};
  for (const [label, v] of [['imię', P.firstName], ['nazwisko', P.lastName]]) {
    const rx = namePattern(v);
    if (rx && rx.test(t)) leaks.push(label);
  }
  if (/(?<!\d)\d{11}(?!\d)/.test(t) || (P.pesel && t.includes(String(P.pesel)))) leaks.push('PESEL');
  const bd = String(P.birthDate || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bd);
  if (bd && (t.includes(bd) || (m && (t.includes(`${m[3]}.${m[2]}.${m[1]}`) || t.includes(`${+m[3]}.${m[2]}.${m[1]}`))))) leaks.push('data urodzenia');
  const addr = String(P.address || '').trim();
  if (addr.length >= 6 && t.toLowerCase().includes(addr.toLowerCase())) leaks.push('adres');
  const street = (addr.match(/^((?:ul\.|al\.|os\.|pl\.)?\s*[\p{L}.\- ]{3,}?\s+\d+[a-z]?)/iu) || [])[1];
  if (street && street.length >= 6 && t.toLowerCase().includes(street.toLowerCase().trim())) leaks.push('adres');
  return [...new Set(leaks)];
}

const genderLabel = (person) => (person && person.gender === 'k' ? 'żeński (kobieta)' : 'męski (mężczyzna)');

const KIND = { month: 'ocena miesięczna postępów', year: 'roczna okresowa ocena realizacji IPR', complex: 'kompleksowa ocena realizacji IPR' };

async function polishAssessment(provider, { items, person, refName, type, notes }) {
  if (!items.length) throw new Error('W tej ocenie nie ma jeszcze opisów do zredagowania.');
  const an = anonymizer(person, refName);
  const prompt = `Dokument: ${KIND[type] || 'ocena'} uczestnika WTZ.
Rodzaj gramatyczny opisywanej osoby: ${genderLabel(person)}.
${notes ? `Dodatkowe obserwacje terapeuty (uwzględnij je tam, gdzie pasują, nie dopisuj nic ponad nie):\n${an.hide(notes)}\n` : ''}
Poniżej są opisy kolejnych obszarów umiejętności, złożone automatycznie z ocen cząstkowych. Zredaguj każdy opis tak, aby był płynnym, naturalnym tekstem:
usuń powtórzenia (zwłaszcza znacznika osoby na początku zdań), dodaj łączniki, popraw styl. Listy umiejętności możesz przeformułować, ale nie pomijaj żadnej umiejętności i nie zmieniaj poziomu jej opanowania.
Każdy opis ma pozostać osobnym fragmentem o tym samym "id".

${JSON.stringify(items.map((x) => ({ id: x.id, obszar: x.name, tekst: an.hide(x.text) })), null, 2)}

Zwróć WYŁĄCZNIE obiekt JSON w bloku \`\`\`json o strukturze:
{ "items": [ { "id": "…", "tekst": "…" } ] }`;
  const r = await provider.run({ system: SYSTEM, prompt });
  const json = extractJson(r.text);
  const list = Array.isArray(json) ? json : json.items;
  if (!Array.isArray(list)) throw new Error('Model zwrócił odpowiedź w nieoczekiwanym formacie.');
  const known = new Set(items.map((x) => x.id));
  const out = {};
  for (const it of list) {
    const text = it && (it.tekst || it.text);
    if (it && known.has(it.id) && typeof text === 'string' && text.trim()) out[it.id] = an.show(text.trim());
  }
  if (!Object.keys(out).length) throw new Error('Model nie zwrócił żadnego opisu.');
  return out;
}

async function proposeConclusions(provider, { sections, person, refName, type, ipr = [], stance, notes, disability }) {
  if (!sections.length) throw new Error('Najpierw wystaw oceny cząstkowe – na ich podstawie powstaje podsumowanie.');
  const an = anonymizer(person, refName);
  const complex = type === 'complex';
  const prompt = `Dokument: ${KIND[type] || 'ocena'} uczestnika warsztatu terapii zajęciowej.
Na podstawie poniższych opisów przygotuj:
1) "summary" – podsumowanie (jeden akapit, 4–7 zdań): mocne strony, główne trudności, postępy i ogólny obraz funkcjonowania w ocenianym okresie;
2) "recommendations" – 3–6 konkretnych zaleceń do dalszej pracy terapeutycznej, wynikających wprost z opisu (każde jako osobne zdanie)${complex ? ';\n3) "stance" – uzasadnienie stanowiska rady programowej (2–4 zdania), zgodne ze wskazanym kierunkiem' : ''}.
Rodzaj gramatyczny opisywanej osoby: ${genderLabel(person)}.
${disability ? `Niepełnosprawność (z orzeczenia): ${disability}\n` : ''}${notes ? `Dodatkowe obserwacje terapeuty:\n${an.hide(notes)}\n` : ''}${ipr.length ? `Realizacja celów IPR:\n${ipr.map((g) => `- ${an.hide(g.text)}: ${g.status || 'brak oceny'}`).join('\n')}\n` : ''}${complex && stance ? `Kierunek stanowiska rady programowej: ${an.hide(stance)}\n` : ''}
Opisy:
${sections.map((s) => `## ${s.name}\n${an.hide(s.text)}`).join('\n\n')}

Zwróć WYŁĄCZNIE obiekt JSON w bloku \`\`\`json o strukturze:
{ "summary": "…", "recommendations": ["…", "…"]${complex ? ', "stance": "…"' : ''} }`;
  const r = await provider.run({ system: SYSTEM, prompt });
  const json = extractJson(r.text);
  const summary = typeof json.summary === 'string' ? an.show(json.summary.trim()) : '';
  const recs = (Array.isArray(json.recommendations) ? json.recommendations : String(json.recommendations || '').split(/\n+/))
    .map((x) => an.show(String(x || '').replace(/^[-–•*\d.)\s]+/, '').trim())).filter(Boolean);
  if (!summary && !recs.length) throw new Error('Model nie zwrócił podsumowania.');
  return { summary, recommendations: recs.map((x) => '– ' + x).join('\n'), stance: complex && typeof json.stance === 'string' ? an.show(json.stance.trim()) : '' };
}

// Dobór zajęć do bloków planu. Model wybiera WYŁĄCZNIE zajęcia z banku pracowni (po id);
// może dopasować tytuł do tematu przewodniego i dopisać krótką notatkę o przebiegu.
async function proposePlan(provider, { workshop, general, plan, needs, group }) {
  const bank = (w) => (w ? w.activities.filter((a) => a.skills.length).map((a) => ({ id: a.id, nazwa: a.name, umiejetnosci: a.skills.map((s) => (w.areas.flatMap((x) => x.skills).find((k) => k.id === s) || {}).name).filter(Boolean), cel: a.goal })) : []);
  const slots = [];
  for (const d of plan.days) for (const b of d.blocks) if (b.kind === 'activity' || (b.kind === 'general' && general)) slots.push({ data: d.date, blok: b.id, godz: `${b.start}–${b.end}`, rodzaj: b.kind === 'activity' ? 'pracownia' : 'ogolne' });
  if (!slots.length) throw new Error('W rozkładzie dnia nie ma bloków zajęć do zaplanowania.');
  const themes = plan.type === 'month' ? (plan.weeks || []).map((w) => `${w.from}–${w.to}: ${w.theme || 'bez tematu'}`).join('\n') : (plan.theme || 'bez tematu');
  const prompt = `Zaplanuj zajęcia dla: ${workshop.name}.
Profil pracowni: ${workshop.description}
Cele pracowni:\n${(workshop.goals || []).map((g) => '- ' + g).join('\n')}
Temat przewodni:\n${themes}
${needs && needs.length ? `Umiejętności wymagające największego wsparcia grupy: ${needs.join(', ')}.\n` : ''}${group && group.length ? `Rodzaj i stopień niepełnosprawności uczestników grupy (bez danych osobowych):\n${group.map((g) => '- ' + g).join('\n')}\nDostosuj dobór zajęć i notatki do tych potrzeb (np. bezpieczeństwo przy narzędziach, struktura i przewidywalność, komunikacja).\n` : ''}
Bank zajęć pracowni (rodzaj "pracownia"):
${JSON.stringify(bank(workshop), null, 1)}
${general ? `Bank zajęć ogólnych (rodzaj "ogolne"):\n${JSON.stringify(bank(general), null, 1)}\n` : ''}
Bloki do wypełnienia:
${JSON.stringify(slots, null, 1)}

Zasady: dla każdego bloku wybierz JEDNO zajęcie z odpowiedniego banku (pole "id" dokładnie z listy). Nie wymyślaj zajęć spoza banku.
Rozłóż zajęcia równomiernie, tak aby w planie ćwiczone były wszystkie umiejętności z profilu, unikaj powtarzania tych samych zajęć dzień po dniu,
częściej wybieraj zajęcia rozwijające umiejętności wymagające wsparcia. Możesz dopasować "tytul" do tematu przewodniego (np. „Dekoracje andrzejkowe”), zachowując charakter zajęcia,
i dopisać "notatka" – jedno zdanie o przebiegu lub związku z tematem.

Zwróć WYŁĄCZNIE obiekt JSON w bloku \`\`\`json o strukturze:
{ "bloki": [ { "blok": "…", "id": "…", "tytul": "…", "notatka": "…" } ] }`;
  const r = await provider.run({ system: SYSTEM, prompt });
  const json = extractJson(r.text);
  const list = Array.isArray(json) ? json : json.bloki || json.blocks;
  if (!Array.isArray(list)) throw new Error('Model zwrócił odpowiedź w nieoczekiwanym formacie.');
  const ok = { activity: new Map(workshop.activities.map((a) => [a.id, a])), general: new Map(((general && general.activities) || []).map((a) => [a.id, a])) };
  const kindOf = new Map(slots.map((s) => [s.blok, s.rodzaj === 'pracownia' ? 'activity' : 'general']));
  const out = {};
  for (const it of list) {
    if (!it || !kindOf.has(it.blok)) continue;
    const act = ok[kindOf.get(it.blok)].get(it.id);
    if (!act) continue; // zajęcie spoza banku – odrzucone
    out[it.blok] = { activityId: act.id, title: String(it.tytul || it.title || '').trim() || act.name, note: String(it.notatka || it.note || '').trim() };
  }
  if (!Object.keys(out).length) throw new Error('Model nie wybrał żadnych zajęć z banku pracowni.');
  return out;
}

// Analiza dokumentu uczestnika (orzeczenie, poprzednia ocena, IPR, opinia) – tekst po pseudonimizacji.
// Wynik: obraz funkcjonowania, dostosowania, cele IPR i poziomy umiejętności z profilu pracowni (0–4).
const DOC_KIND = { orzeczenie: 'orzeczenie o stopniu niepełnosprawności', ocena: 'poprzednia ocena / arkusz ocen uczestnika', ipr: 'indywidualny program rehabilitacji', inny: 'dokument dotyczący uczestnika (opinia, zaświadczenie)' };
const CODES_LIST = ['01-U', '02-P', '03-L', '04-O', '05-R', '06-E', '07-S', '08-T', '09-M', '10-N', '11-I', '12-C'];

async function analyzeDocument(provider, { type, text, skills, scale, workshop, disability }) {
  if (!String(text || '').trim()) throw new Error('Brak tekstu dokumentu do analizy.');
  const prompt = `Przeanalizuj dokument uczestnika warsztatu terapii zajęciowej: ${DOC_KIND[type] || DOC_KIND.inny}.
Dane osobowe zastąpiono znacznikami w podwójnych nawiasach klamrowych (np. {{IMIE}}). Nie próbuj ich odtwarzać i nie używaj ich w odpowiedzi – pisz bezosobowo („uczestnik”).
${disability ? `Znane dane z orzeczenia: ${disability}.\n` : ''}${workshop ? `Pracownia uczestnika: ${workshop}.\n` : ''}
Skala ocen umiejętności: ${scale.map((x) => `${x.value} – ${x.label.toLowerCase()} (${x.desc})`).join('; ')}.
Umiejętności z profilu pracowni (id i nazwa):
${JSON.stringify(skills.map((s) => ({ id: s.id, nazwa: s.name })), null, 0)}

Przygotuj:
- "podsumowanie" – 3–5 zdań o funkcjonowaniu uczestnika wynikającym z dokumentu,
- "stopien" i "symbole" – tylko jeśli wynikają z dokumentu (stopień: lekki | umiarkowany | znaczny; symbole: ${CODES_LIST.join(', ')}),
- "mocne_strony" i "trudnosci" – krótkie punkty,
- "dostosowania" – 3–8 konkretnych dostosowań form i metod pracy w pracowni do rodzaju i stopnia niepełnosprawności oraz opisanych trudności,
- "cele_ipr" – 2–6 celów do indywidualnego programu rehabilitacji (konkretnych, obserwowalnych),
- "oceny" – poziom (0–4) umiejętności z listy, TYLKO gdy dokument zawiera wyraźne informacje o tej umiejętności (np. poprzednia ocena); w "uzasadnienie" krótko wskaż podstawę,
- "priorytety" – id 3–6 umiejętności z listy, które warto rozwijać w pierwszej kolejności.
Nie wymyślaj informacji, których nie ma w dokumencie.

Dokument:
${text}

Zwróć WYŁĄCZNIE obiekt JSON w bloku \`\`\`json o strukturze:
{ "podsumowanie": "…", "stopien": "", "symbole": [], "mocne_strony": ["…"], "trudnosci": ["…"], "dostosowania": ["…"], "cele_ipr": ["…"], "oceny": [ { "id": "…", "poziom": 0, "uzasadnienie": "…" } ], "priorytety": ["…"] }`;
  const r = await provider.run({ system: SYSTEM, prompt });
  const j = extractJson(r.text);
  const clean = (x) => String(x || '').replace(/\{\{\s*(UCZESTNIK|IMIE|NAZWISKO)\s*\}\}/g, 'uczestnik').replace(/\{\{\s*[A-Z_]+\s*\}\}/g, '…').replace(/\s{2,}/g, ' ').trim().replace(/^\p{Ll}/u, (c) => c.toLocaleUpperCase('pl'));
  const list = (x) => (Array.isArray(x) ? x : String(x || '').split(/\n+/)).map((v) => clean(String(v).replace(/^[-–•*\d.)\s]+/, ''))).filter(Boolean);
  const known = new Set(skills.map((s) => s.id));
  const levels = [];
  for (const o of Array.isArray(j.oceny) ? j.oceny : []) {
    const lv = Number(o && o.poziom);
    if (o && known.has(o.id) && Number.isInteger(lv) && lv >= 0 && lv <= 4 && !levels.some((x) => x.skillId === o.id)) levels.push({ skillId: o.id, level: lv, reason: clean(o.uzasadnienie) });
  }
  const degree = ['lekki', 'umiarkowany', 'znaczny'].includes(String(j.stopien || '').toLowerCase()) ? String(j.stopien).toLowerCase() : '';
  return {
    summary: clean(j.podsumowanie), degree,
    codes: (Array.isArray(j.symbole) ? j.symbole : []).map((c) => String(c).toUpperCase().replace(/\s/g, '')).filter((c) => CODES_LIST.includes(c)).slice(0, 3),
    strengths: list(j.mocne_strony), difficulties: list(j.trudnosci), adaptations: list(j.dostosowania), goals: list(j.cele_ipr),
    levels, priorities: (Array.isArray(j.priorytety) ? j.priorytety : []).filter((id) => known.has(id))
  };
}

// Propozycja profilu pracowni: obszary, umiejętności i bank zajęć.
async function proposeProfile(provider, { name, description }) {
  if (!String(name || '').trim()) throw new Error('Podaj nazwę pracowni.');
  const prompt = `Przygotuj profil pracowni terapeutycznej warsztatu terapii zajęciowej: „${name}”.
${description ? `Opis od terapeuty: ${description}\n` : ''}
Profil ma odpowiadać rzeczywistej pracy tej pracowni w polskim WTZ i służyć do planowania zajęć oraz oceniania postępów uczestników.
Przygotuj:
- "opis" – 2–3 zdania o profilu pracowni,
- "cele" – 3–5 celów pracowni,
- "obszary" – 3–5 obszarów, w każdym 2–5 konkretnych, obserwowalnych umiejętności (nazwy jako rzeczowniki odczasownikowe, np. „Krojenie i posługiwanie się nożem”),
- "zajecia" – 10–14 zajęć; każde z nazwą, listą umiejętności (dokładne nazwy z obszarów), celem, metodami i formami pracy oraz materiałami.

Zwróć WYŁĄCZNIE obiekt JSON w bloku \`\`\`json o strukturze:
{ "opis": "…", "cele": ["…"], "obszary": [ { "nazwa": "…", "umiejetnosci": ["…"] } ], "zajecia": [ { "nazwa": "…", "umiejetnosci": ["…"], "cel": "…", "metody": "…", "materialy": "…" } ] }`;
  const r = await provider.run({ system: SYSTEM, prompt });
  const j = extractJson(r.text);
  const areas = (Array.isArray(j.obszary) ? j.obszary : []).map((a) => ({ name: String(a.nazwa || a.name || '').trim(), skills: (a.umiejetnosci || a.skills || []).map((s) => String(s).trim()).filter(Boolean) })).filter((a) => a.name && a.skills.length);
  if (!areas.length) throw new Error('Model nie zaproponował obszarów umiejętności.');
  const known = new Set(areas.flatMap((a) => a.skills.map((s) => s.toLowerCase())));
  const activities = (Array.isArray(j.zajecia) ? j.zajecia : []).map((a) => ({
    name: String(a.nazwa || a.name || '').trim(),
    skills: (a.umiejetnosci || a.skills || []).map((s) => String(s).trim()).filter((s) => known.has(s.toLowerCase())),
    goal: String(a.cel || '').trim(), methods: String(a.metody || '').trim(), materials: String(a.materialy || '').trim()
  })).filter((a) => a.name && a.skills.length);
  return { description: String(j.opis || '').trim(), goals: (j.cele || []).map((g) => String(g).trim()).filter(Boolean), areas, activities };
}

module.exports = { SYSTEM, analyzeDocument, polishAssessment, proposeConclusions, proposePlan, proposeProfile, anonymizer, findLeaks, namePattern, TOKENS };
