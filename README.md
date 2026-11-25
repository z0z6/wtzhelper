# WTZ Helper

Aplikacja desktopowa (Windows, Linux) dla terapeutów zajęciowych i instruktorów **warsztatów terapii zajęciowej**:

- **plany pracy** pracowni – dzienne, tygodniowe i miesięczne,
- **oceny cząstkowe** – stopień opanowania umiejętności w danym dniu (skala 0–4),
- **oceny okresowe** – miesięczne i roczne (okresowa ocena realizacji IPR),
- **oceny kompleksowe** realizacji IPR – ze stanowiskiem rady programowej,
- **dokumenty i skany** – zdjęcia, zrzuty ekranu i PDF-y orzeczeń, poprzednich arkuszy ocen, IPR i opinii, odczytywane na komputerze i (opcjonalnie) analizowane przez agenta AI.

Dokumenty zapisuje jako **DOCX** i **PDF**. Wszystkie dane zostają na komputerze. AI jest opcjonalne.

## Profile pracowni

Każda pracownia ma profil:

- opis i cele,
- **obszary i umiejętności**, które się ocenia,
- **bank zajęć** – nazwa, cel, metody i formy, materiały oraz umiejętności, które zajęcia rozwijają.

Zestaw startowy obejmuje pracownie: gospodarstwa domowego, plastyczną, stolarską, komputerową, krawiecko-rękodzielniczą, ogrodniczą i ceramiczną. Do tego dochodzi profil **Umiejętności ogólne**, wspólny dla wszystkich uczestników (samoobsługa, komunikacja, funkcjonowanie społeczne, zaradność, przygotowanie do pracy).

Profile można dowolnie zmieniać, dodawać nowe i zapisywać do pliku JSON (*Pracownie → Zapisz / Wczytaj profile*), np. żeby przenieść je na inny komputer. Z AI przycisk **Uzupełnij z AI** proponuje obszary, umiejętności i bank zajęć dla nowej pracowni.

## Plany pracy

- Plan składa się **wyłącznie z zajęć z banku danej pracowni**. W blokach ogólnych są zajęcia z profilu *Umiejętności ogólne*. Aplikacja sprawdza zgodność planu z profilem i pokazuje wynik nad planem.
- Zajęcia są dobierane tak, żeby:
  - w planie były ćwiczone wszystkie umiejętności z profilu,
  - najczęściej wracały umiejętności, w których grupa ma najniższe oceny,
  - te same zajęcia nie powtarzały się dzień po dniu.
- **Praca indywidualna**: przy każdych zajęciach plan wskazuje uczestnikowi umiejętność, w której ma najniższy poziom.
- Rozkład dnia (godziny, bloki pracowni, bloki ogólne, stałe punkty dnia) i tematy przewodnie miesięcy ustawia się w *Ustawienia → Rozkład dnia*.
- Weekendy i dni ustawowo wolne (od 2025 r. także Wigilia) są pomijane.
- Plan można dowolnie poprawiać. Przy każdym dniu są przyciski:
  - *Inne zajęcia* – losuje nowe zajęcia na ten dzień,
  - *Oceń zajęcia* – przechodzi do ocen cząstkowych za ten dzień.

## Oceny

- **Oceny cząstkowe** wystawia się w siatce *umiejętność × uczestnik* za dany dzień:
  - *Zajęcia z planu* – tylko umiejętności z zajęć zaplanowanych na ten dzień,
  - *Wszystkie umiejętności* – cały profil pracowni.
- **Ocena miesięczna, roczna i kompleksowa** powstaje z ocen cząstkowych z wybranego okresu:
  - średnia i procent opanowania każdej umiejętności i obszaru,
  - opis według poziomów skali,
  - porównanie z poprzednim miesiącem albo z początkiem okresu,
  - podsumowanie i zalecenia,
  - tabela umiejętności.
- W ocenie rocznej i kompleksowej dochodzi realizacja celów IPR, a w kompleksowej także stanowisko rady programowej (art. 10a ust. 5 ustawy o rehabilitacji zawodowej i społecznej) i podpisy członków rady.
- Kompleksowa ocena obejmuje domyślnie 3 lata, z podziałem na kolejne lata.
- Teksty ze skali, zdania o zmianach i treść stanowisk ustawia się w *Ustawienia → Skala i opisy*.
- Twoje poprawki w opisach zostają po przeliczeniu ocen. Przycisk *Przywróć z ocen* odtwarza opis automatyczny.

## Dokumenty i skany

Zakładka *Dokumenty i skany* (albo *Uczestnicy → Z dokumentu*, albo przycisk w karcie uczestnika):

1. Wrzucasz zdjęcie, skan lub PDF (przeciągnij, *Wybierz pliki*, **Ctrl+V / Wklej zrzut ekranu**) albo wklejasz sam tekst. Rodzaj dokumentu: orzeczenie, arkusz ocen, IPR, inny.
2. **Odczyt tekstu (OCR) działa na komputerze** – Tesseract z językiem polskim i pdf.js. Obrazy nigdy nie są wysyłane; okno aplikacji nie ma dostępu do internetu.
3. Aplikacja sama odczytuje:
   - dane osobowe: imię i nazwisko, PESEL (z kontrolą sumy, datą urodzenia i płcią), adres,
   - z orzeczenia: stopień niepełnosprawności, symbole przyczyny (01-U … 12-C), numer, datę wydania, ważność, wskazanie do terapii zajęciowej,
   - z poprzednich arkuszy ocen: poziomy umiejętności z profilu pracowni (cyfry 0–4 albo opisy typu „samodzielnie”, „z częściową pomocą”) i cele.
4. Sprawdzasz dane i zapisujesz je w karcie uczestnika – nowego albo istniejącego (domyślnie uzupełniane są tylko puste pola). Skan zostaje w folderze danych.
5. Opcjonalnie **Zapisz i analizuj z AI** – agent dostaje wyłącznie tekst po pseudonimizacji. Imiona (także odmienione i zdrobnienia), nazwiska, PESEL, daty, adresy, telefony, e-maile, numery dokumentów i nazwiska innych osób są zamienione na znaczniki. Strażnik sprawdza tekst przed wysyłką. Agent proponuje:
   - obraz funkcjonowania, mocne strony i trudności,
   - **dostosowania do rodzaju i stopnia niepełnosprawności**,
   - cele IPR,
   - **oceny wyjściowe** umiejętności z profilu pracowni,
   - priorytety.
   Przyjmujesz tylko to, co zaznaczysz.

Karta uczestnika ma sekcję *Orzeczenie i dostosowania* z bazą wiedzy: dostosowania form i metod pracy dla każdego symbolu i stopnia, do uzupełnienia jednym kliknięciem.

W planach:

- **tabela dostosowań** uczestników grupy,
- przy zajęciach z narzędziami ostrymi, gorącymi lub maszynami – **nadzór i asekuracja** dla osób z epilepsją, chorobami narządu wzroku, ruchu, neurologicznymi lub znacznym stopniem niepełnosprawności,
- *Dobierz z AI* uwzględnia rodzaj i stopień niepełnosprawności grupy (bez danych osobowych).

Oceny pokazują orzeczenie w nagłówku, a AI uwzględnia je w podsumowaniu.

## AI i prywatność

Sposób pracy wybiera się w *Ustawienia → AI*:

- **Bez AI** (domyślnie) – nic nie jest nigdzie wysyłane.
- **Lokalny model** (Ollama, polecany Bielik) – działa na komputerze, bezpłatnie i bez limitów.
- **Konto AI** – ChatGPT (Codex CLI), Google Gemini (Antigravity CLI) albo Claude (Claude Code, wymaga planu Pro lub Max):
  - na darmowym planie działa tryb próbny,
  - na płatnym planie aplikacja korzysta z wybranych mocniejszych modeli.
- Gdy skończy się limit konta, aplikacja przełącza się na kolejne połączone konto.

Funkcje AI:

- *Dobierz z AI* w planie – AI dopasowuje zajęcia do tematu, ale może wybrać **tylko zajęcia z banku pracowni**. Inne propozycje są odrzucane.
- *Wygładź z AI* i *Zaproponuj z AI* w ocenach.
- *Uzupełnij z AI* w profilu pracowni.

Do AI nie trafiają imiona, nazwiska, PESEL, daty urodzenia ani adresy. Imię i nazwisko zastępują znaczniki, a **strażnik prywatności** blokuje wysyłkę, jeśli w tekście zostały dane osobowe któregokolwiek uczestnika.

## Dane

- Wszystko jest w jednym pliku `wtzhelper-dane.json` w folderze danych aplikacji (*Ustawienia → Ogólne*).
- Wersja portable dla Windows trzyma dane obok pliku `.exe`, w folderze „WTZ Helper - dane”.
- Uczestników można zaimportować z pliku Excel, CSV lub XML albo wkleić z tabeli.

## Dla programistów

```bash
npm install
npm test        # testy logiki bez Electrona
npm start       # uruchomienie aplikacji
```

Struktura:

- `src/main/workshops-default.js` – zestaw startowy profili,
- `planner.js` – generator planów i dokument planu,
- `assessment.js` – oceny,
- `render.js` – DOCX i HTML/PDF (z tabelami i orientacją poziomą),
- `ai/` – tryby AI (wspólne z aplikacją Skryba),
- `documents.js` – odczyt orzeczeń i arkuszy ocen, pseudonimizacja, baza dostosowań,
- `src/renderer/ocr.js` i `docs.js` – lokalny OCR i widok dokumentów (biblioteki kopiuje `scripts/copy-vendor.js` przy `npm install`),
- `ai/tasks.js` – zadania AI i strażnik prywatności.

Zrzuty ekranu w trybie deweloperskim:

```bash
WTZ_DATA_DIR=/tmp/wd WTZ_SHOTS=/tmp/shots WTZ_STEPS="nazwa=<encodeURIComponent(JS)>,…" \
  xvfb-run -a node_modules/electron/dist/electron . --no-sandbox
```

GitHub Actions buduje AppImage (Linux) i portable `.exe` (Windows). Przy tagu `v*` publikuje wydanie.
