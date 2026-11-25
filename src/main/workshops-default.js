'use strict';
// Zestaw startowy profili pracowni WTZ. Każdy profil jest w pełni edytowalny w aplikacji
// (nazwa, opis, cele, obszary i umiejętności, bank zajęć). Plany powstają WYŁĄCZNIE z banku zajęć
// danej pracowni, a oceny cząstkowe dotyczą umiejętności z jej profilu.
//
// Profil „Umiejętności ogólne” dotyczy wszystkich uczestników (samoobsługa, komunikacja,
// funkcjonowanie społeczne, przygotowanie do pracy) – jego zajęcia trafiają do bloków ogólnych rozkładu dnia.

function W(id, name, description, goals, areas, activities, extra = {}) {
  const skillId = (s) => `${id}.${s}`;
  return {
    id, name, description, instructor: '', goals,
    areas: areas.map(([aid, aname, skills]) => ({ id: `${id}.${aid}`, name: aname, skills: skills.map(([sid, sname]) => ({ id: skillId(sid), name: sname })) })),
    activities: activities.map(([aname, skills, goal, methods, materials], i) => ({ id: `${id}.z${i + 1}`, name: aname, skills: skills.map(skillId), goal, methods, materials })),
    ...extra
  };
}

const PRAKTYKA = 'pokaz, instruktaż słowny, ćwiczenia praktyczne, praca indywidualna i w parach';

const WORKSHOPS = [
  W('ogolne', 'Umiejętności ogólne (wszystkie pracownie)',
    'Obszary wspólne dla wszystkich uczestników warsztatu: samoobsługa, komunikacja, funkcjonowanie społeczne, zaradność życiowa i przygotowanie do pracy. Zajęcia z tego profilu trafiają do bloków ogólnych rozkładu dnia (np. rozmowa poranna, trening umiejętności społecznych).',
    ['Rozwijanie zaradności osobistej i samodzielności w codziennym funkcjonowaniu.', 'Rozwijanie umiejętności komunikacyjnych i społecznych.', 'Kształtowanie postaw i nawyków potrzebnych do podjęcia pracy.'],
    [
      ['samo', 'Samoobsługa i higiena', [['higiena', 'Higiena osobista'], ['wyglad', 'Dbałość o wygląd i odpowiedni ubiór'], ['posilki', 'Samodzielne i kulturalne spożywanie posiłków']]],
      ['kom', 'Komunikacja', [['potrzeby', 'Wyrażanie potrzeb, opinii i emocji'], ['polecenia', 'Rozumienie i wykonywanie poleceń'], ['rozmowa', 'Prowadzenie rozmowy i słuchanie innych']]],
      ['spol', 'Funkcjonowanie społeczne', [['wspolpraca', 'Współpraca w grupie'], ['zasady', 'Przestrzeganie zasad i norm społecznych'], ['emocje', 'Radzenie sobie z emocjami i sytuacjami trudnymi']]],
      ['zar', 'Zaradność życiowa', [['czas', 'Orientacja w czasie i posługiwanie się kalendarzem'], ['pieniadze', 'Posługiwanie się pieniędzmi'], ['uslugi', 'Korzystanie z komunikacji publicznej i usług']]],
      ['praca', 'Przygotowanie do pracy', [['punktualnosc', 'Punktualność i obowiązkowość'], ['koncentracja', 'Koncentracja na zadaniu i wytrwałość'], ['samodzielnosc', 'Samodzielność w wykonywaniu zadań'], ['jakosc', 'Dbałość o jakość i efekt pracy']]]
    ],
    [
      ['Rozmowa poranna – kalendarz, pogoda, plan dnia', ['czas', 'rozmowa', 'potrzeby'], 'Orientacja w czasie, planowanie dnia i swobodna wypowiedź na forum grupy.', 'rozmowa kierowana, praca z kalendarzem i planem dnia', 'kalendarz, plan dnia z piktogramami'],
      ['Trening umiejętności społecznych – scenki sytuacyjne', ['wspolpraca', 'zasady', 'rozmowa'], 'Ćwiczenie właściwych zachowań w typowych sytuacjach społecznych.', 'drama, odgrywanie ról, omówienie', 'karty sytuacji, rekwizyty'],
      ['Trening ekonomiczny – liczenie pieniędzy i porównywanie cen', ['pieniadze', 'koncentracja'], 'Doskonalenie rozpoznawania nominałów, liczenia pieniędzy i planowania wydatków.', 'ćwiczenia praktyczne, symulacja zakupów', 'monety i banknoty treningowe, gazetki reklamowe'],
      ['Trening higieniczny i dbałość o wygląd', ['higiena', 'wyglad'], 'Utrwalanie nawyków higienicznych i dbałości o estetyczny wygląd.', 'pokaz, instruktaż, ćwiczenia praktyczne', 'środki higieniczne, lustro, plansze'],
      ['Rozmowa o emocjach i zajęcia relaksacyjne', ['emocje', 'potrzeby'], 'Rozpoznawanie i nazywanie emocji, poznawanie sposobów radzenia sobie ze stresem.', 'rozmowa, techniki relaksacyjne, ćwiczenia oddechowe', 'karty emocji, muzyka relaksacyjna'],
      ['Gry stolikowe wspierające współpracę', ['wspolpraca', 'zasady', 'koncentracja'], 'Przestrzeganie reguł gry, oczekiwanie na swoją kolej, współdziałanie.', 'gry i zabawy grupowe', 'gry planszowe i karciane'],
      ['Wyjście do instytucji – poczta, urząd, biblioteka', ['uslugi', 'rozmowa', 'zasady'], 'Praktyczne załatwianie spraw w instytucjach i właściwe zachowanie w miejscach publicznych.', 'trening w naturalnym środowisku', 'dokumenty, lista spraw do załatwienia'],
      ['Trening orientacji – trasa komunikacją miejską', ['uslugi', 'czas'], 'Planowanie trasy, korzystanie z rozkładu jazdy i bezpieczne poruszanie się.', 'trening w naturalnym środowisku, praca z rozkładem jazdy', 'rozkład jazdy, bilety, mapa'],
      ['Rozmowa o pracy – zawody, obowiązki pracownika', ['punktualnosc', 'jakosc', 'rozmowa'], 'Poznawanie zawodów i kształtowanie postaw pracowniczych.', 'pogadanka, film, rozmowa kierowana', 'karty zawodów, materiały wideo'],
      ['Wykonywanie poleceń wieloetapowych', ['polecenia', 'koncentracja', 'samodzielnosc'], 'Rozumienie i samodzielne wykonywanie poleceń złożonych z kilku etapów.', 'ćwiczenia praktyczne z instrukcją słowną i obrazkową', 'instrukcje obrazkowe, materiały do zadań'],
      ['Wspólne drugie śniadanie – kultura stołu', ['posilki', 'higiena', 'wspolpraca'], 'Samodzielne i kulturalne spożywanie posiłku, higiena przed jedzeniem, rozmowa przy stole.', 'trening w naturalnej sytuacji, modelowanie', 'zastawa, serwetki, posiłki uczestników'],
      ['Samoocena – podsumowanie tygodnia', ['potrzeby', 'jakosc', 'rozmowa'], 'Ocena własnej pracy i zachowania, wyznaczanie celów na kolejny tydzień.', 'rozmowa, karta samooceny', 'karty samooceny']
    ], { general: true }),

  W('gospodarstwo', 'Pracownia gospodarstwa domowego',
    'Kształtowanie umiejętności niezbędnych do samodzielnego prowadzenia gospodarstwa domowego: przygotowywania posiłków, obsługi sprzętu AGD, utrzymania porządku, robienia zakupów i nakrywania do stołu.',
    ['Rozwijanie samodzielności w przygotowywaniu prostych posiłków.', 'Nauka bezpiecznej obsługi sprzętu gospodarstwa domowego.', 'Utrwalanie nawyków utrzymywania porządku i higieny w kuchni.', 'Kształtowanie umiejętności planowania posiłków i robienia zakupów.'],
    [
      ['posilki', 'Przygotowywanie posiłków', [['mycie', 'Mycie i obieranie warzyw i owoców'], ['krojenie', 'Krojenie i posługiwanie się nożem'], ['zimne', 'Przygotowywanie potraw na zimno'], ['cieple', 'Przygotowywanie potraw na ciepło']]],
      ['agd', 'Obsługa sprzętu AGD', [['czajnik', 'Obsługa czajnika elektrycznego'], ['kuchenka', 'Obsługa kuchenki i piekarnika'], ['robot', 'Obsługa robota kuchennego, miksera i blendera'], ['pralka', 'Obsługa pralki i zmywarki']]],
      ['porzadek', 'Porządek i higiena', [['zmywanie', 'Zmywanie i wycieranie naczyń'], ['sprzatanie', 'Sprzątanie stanowiska pracy i kuchni'], ['segregacja', 'Segregacja odpadów'], ['pranie', 'Pranie, prasowanie i składanie tekstyliów']]],
      ['zakupy', 'Planowanie, zakupy i stół', [['planowanie', 'Planowanie posiłku i sporządzanie listy zakupów'], ['sklep', 'Robienie zakupów'], ['stol', 'Nakrywanie do stołu i obsługa gości']]]
    ],
    [
      ['Przygotowanie kanapek i sałatki warzywnej', ['mycie', 'krojenie', 'zimne'], 'Doskonalenie samodzielnego przygotowania prostego posiłku na zimno.', PRAKTYKA, 'pieczywo, warzywa, deski, noże, miski'],
      ['Gotowanie zupy jarzynowej', ['mycie', 'krojenie', 'cieple', 'kuchenka'], 'Przygotowanie zupy według przepisu z zachowaniem kolejności czynności i zasad bezpieczeństwa.', PRAKTYKA, 'warzywa, garnek, kuchenka, przepis obrazkowy'],
      ['Pieczenie kruchych ciasteczek', ['kuchenka', 'robot', 'cieple'], 'Odmierzanie składników, przygotowanie ciasta i bezpieczna obsługa piekarnika.', PRAKTYKA, 'mąka, masło, cukier, mikser, foremki, piekarnik'],
      ['Przygotowanie herbaty i kawy dla grupy', ['czajnik', 'stol'], 'Bezpieczne posługiwanie się czajnikiem i podawanie napojów.', PRAKTYKA, 'czajnik, kubki, herbata, kawa, taca'],
      ['Planowanie jadłospisu i listy zakupów', ['planowanie'], 'Planowanie posiłków na kolejne zajęcia i sporządzanie listy potrzebnych produktów.', 'rozmowa kierowana, praca z przepisem i gazetką', 'przepisy, gazetki reklamowe, kartki'],
      ['Zakupy produktów do zajęć w sklepie', ['sklep', 'planowanie'], 'Robienie zakupów według listy, płacenie i sprawdzanie reszty.', 'trening w naturalnym środowisku', 'lista zakupów, portfel, torba'],
      ['Nakrywanie do stołu i przyjmowanie gości', ['stol'], 'Estetyczne nakrywanie do stołu i zasady savoir-vivre przy posiłku.', PRAKTYKA, 'zastawa, sztućce, serwetki, obrus'],
      ['Zmywanie naczyń i porządkowanie kuchni', ['zmywanie', 'sprzatanie', 'pralka'], 'Utrwalanie nawyku sprzątania po posiłku, obsługa zmywarki.', PRAKTYKA, 'płyn do naczyń, gąbki, ściereczki, zmywarka'],
      ['Pranie i prasowanie fartuchów oraz ściereczek', ['pralka', 'pranie'], 'Sortowanie, pranie w pralce, prasowanie i składanie tekstyliów.', PRAKTYKA, 'pralka, proszek, żelazko, deska do prasowania'],
      ['Segregacja odpadów kuchennych', ['segregacja', 'sprzatanie'], 'Rozpoznawanie rodzajów odpadów i prawidłowe ich segregowanie.', 'pogadanka, ćwiczenia praktyczne', 'pojemniki do segregacji, plansze'],
      ['Koktajle owocowe z blendera', ['mycie', 'krojenie', 'robot'], 'Bezpieczna obsługa blendera i przygotowanie zdrowego napoju.', PRAKTYKA, 'owoce, jogurt, blender, kubki'],
      ['Przetwory – dżem lub kiszone ogórki', ['mycie', 'krojenie', 'cieple'], 'Przygotowanie prostych przetworów i bezpieczne posługiwanie się gorącymi naczyniami.', PRAKTYKA, 'owoce lub ogórki, słoiki, przyprawy, garnek']
    ]),

  W('plastyczna', 'Pracownia plastyczna',
    'Rozwijanie zdolności manualnych, wyobraźni i wrażliwości estetycznej poprzez różnorodne techniki plastyczne oraz wykonywanie prac dekoracyjnych i okolicznościowych.',
    ['Usprawnianie motoryki małej i koordynacji wzrokowo-ruchowej.', 'Poznawanie i doskonalenie technik plastycznych.', 'Rozwijanie kreatywności i wrażliwości estetycznej.', 'Kształtowanie dbałości o stanowisko pracy i materiały.'],
    [
      ['malarstwo', 'Rysunek i malarstwo', [['rysunek', 'Rysowanie ołówkiem, kredkami i pastelami'], ['farby', 'Malowanie farbami plakatowymi i akwarelami'], ['szklo', 'Malowanie na szkle i tkaninie']]],
      ['przestrzen', 'Techniki przestrzenne i zdobnicze', [['wycinanie', 'Wycinanie i klejenie'], ['masa', 'Formowanie z masy solnej, papierowej i plasteliny'], ['decoupage', 'Decoupage'], ['dekoracje', 'Wykonywanie dekoracji okolicznościowych']]],
      ['kompozycja', 'Kompozycja i estetyka', [['kolory', 'Planowanie kompozycji i dobór kolorów'], ['estetyka', 'Estetyka i staranność wykonania pracy']]],
      ['organizacja', 'Organizacja pracy', [['stanowisko', 'Przygotowanie i porządkowanie stanowiska pracy'], ['narzedzia', 'Dbałość o narzędzia i materiały']]]
    ],
    [
      ['Martwa natura – rysunek pastelami', ['rysunek', 'kolory', 'estetyka'], 'Obserwacja i przedstawienie kształtów, dobór barw.', 'pokaz, ćwiczenia praktyczne, praca indywidualna', 'pastele, kartony, kompozycja z owoców'],
      ['Pejzaż akwarelą', ['farby', 'kolory'], 'Poznanie techniki laserunku i mieszania barw.', PRAKTYKA, 'farby akwarelowe, pędzle, papier akwarelowy'],
      ['Malowanie na szkle – witraż', ['szklo', 'estetyka'], 'Wykonanie wzoru konturówką i wypełnianie barwami.', PRAKTYKA, 'farby witrażowe, konturówki, szkło lub słoiki'],
      ['Wydzieranka i kolaż', ['wycinanie', 'kolory'], 'Usprawnianie precyzji ruchów dłoni, komponowanie obrazu z elementów.', PRAKTYKA, 'kolorowy papier, gazety, klej, karton'],
      ['Figurki z masy solnej', ['masa', 'estetyka'], 'Formowanie prostych kształtów i ich malowanie po wyschnięciu.', PRAKTYKA, 'mąka, sól, woda, foremki, farby'],
      ['Decoupage na drewnianej skrzynce', ['decoupage', 'estetyka', 'narzedzia'], 'Poznanie etapów techniki decoupage.', PRAKTYKA, 'skrzynki, serwetki, klej, lakier, pędzle'],
      ['Dekoracje okolicznościowe na tablicę i do sali', ['dekoracje', 'wycinanie', 'kolory'], 'Wykonanie dekoracji związanych z porą roku lub świętem.', 'praca w grupie, ćwiczenia praktyczne', 'papier, bibuła, klej, nożyczki, materiały naturalne'],
      ['Kartki okolicznościowe', ['dekoracje', 'wycinanie', 'estetyka'], 'Projektowanie i wykonanie estetycznej kartki.', PRAKTYKA, 'karton, ozdoby, wstążki, klej'],
      ['Malowanie na tkaninie – torba lub koszulka', ['szklo', 'kolory'], 'Przenoszenie wzoru na tkaninę i malowanie farbami do tkanin.', PRAKTYKA, 'torby bawełniane, farby do tkanin, szablony'],
      ['Masa papierowa – miski i ozdoby', ['masa', 'stanowisko'], 'Przygotowanie masy papierowej i formowanie przedmiotu.', PRAKTYKA, 'gazety, klej, miski, farby'],
      ['Porządkowanie pracowni i konserwacja przyborów', ['stanowisko', 'narzedzia'], 'Utrwalanie nawyku dbałości o narzędzia i porządek.', 'instruktaż, ćwiczenia praktyczne', 'pojemniki, ściereczki, woda']
    ]),

  W('stolarska', 'Pracownia stolarska',
    'Nauka podstaw obróbki drewna i wykonywania prostych wyrobów stolarskich z zachowaniem zasad bezpieczeństwa, jako przygotowanie do pracy w warunkach zbliżonych do zawodowych.',
    ['Nauka bezpiecznego posługiwania się narzędziami stolarskimi.', 'Opanowanie podstawowych operacji obróbki drewna.', 'Wykonywanie prostych wyrobów według wzoru.', 'Kształtowanie nawyków pracowniczych i dbałości o porządek.'],
    [
      ['obrobka', 'Obróbka ręczna drewna', [['mierzenie', 'Mierzenie i trasowanie'], ['pilowanie', 'Piłowanie piłą ręczną'], ['szlifowanie', 'Szlifowanie papierem ściernym'], ['wiercenie', 'Wiercenie i wkręcanie']]],
      ['wykonczenie', 'Łączenie i wykończenie', [['klejenie', 'Klejenie i łączenie elementów'], ['malowanie', 'Malowanie, bejcowanie i lakierowanie']]],
      ['bhp', 'Bezpieczeństwo i organizacja pracy', [['ochrona', 'Stosowanie środków ochrony osobistej'], ['narzedzia', 'Bezpieczne posługiwanie się narzędziami'], ['porzadek', 'Porządek na stanowisku pracy']]],
      ['wyroby', 'Wyroby stolarskie', [['wzor', 'Wykonanie wyrobu według wzoru'], ['naprawa', 'Drobne naprawy przedmiotów z drewna']]]
    ],
    [
      ['Zasady BHP w pracowni – pogadanka i ćwiczenia', ['ochrona', 'narzedzia'], 'Poznanie zasad bezpiecznej pracy i stosowanie środków ochrony.', 'pogadanka, pokaz, ćwiczenia praktyczne', 'okulary ochronne, rękawice, plansze BHP'],
      ['Mierzenie i trasowanie elementów', ['mierzenie'], 'Odmierzanie i zaznaczanie wymiarów na desce.', PRAKTYKA, 'miara, ołówek stolarski, kątownik, deski'],
      ['Docinanie elementów piłą ręczną', ['pilowanie', 'mierzenie', 'narzedzia'], 'Prowadzenie piły wzdłuż linii i bezpieczne mocowanie materiału.', PRAKTYKA, 'piła płatnica, ścisk stolarski, deski'],
      ['Szlifowanie elementów', ['szlifowanie'], 'Wygładzanie powierzchni z doborem gradacji papieru.', PRAKTYKA, 'papier ścierny, klocki szlifierskie'],
      ['Karmnik dla ptaków', ['mierzenie', 'pilowanie', 'wiercenie', 'wzor'], 'Wykonanie wyrobu według wzoru krok po kroku.', 'pokaz, instrukcja obrazkowa, praca w parach', 'deski, wkręty, wkrętarka, klej'],
      ['Skrzynka na narzędzia lub doniczkę', ['mierzenie', 'klejenie', 'wzor'], 'Łączenie elementów na klej i wkręty.', PRAKTYKA, 'deski, klej do drewna, wkręty, ściski'],
      ['Malowanie i lakierowanie wyrobów', ['malowanie', 'ochrona'], 'Równomierne nakładanie bejcy i lakieru.', PRAKTYKA, 'bejca, lakier, pędzle, rękawice'],
      ['Wiercenie otworów i wkręcanie wkrętów', ['wiercenie', 'narzedzia'], 'Bezpieczna obsługa wkrętarki pod nadzorem.', PRAKTYKA, 'wkrętarka, wiertła, wkręty, odpady drewna'],
      ['Ozdoby z drewna – podkładki i zawieszki', ['szlifowanie', 'malowanie', 'wzor'], 'Wykonanie drobnych wyrobów dekoracyjnych.', PRAKTYKA, 'plastry drewna, papier ścierny, farby'],
      ['Naprawa drobnych przedmiotów z drewna', ['naprawa', 'klejenie'], 'Ocena uszkodzenia i wykonanie prostej naprawy.', 'instruktaż, ćwiczenia praktyczne', 'klej, ściski, papier ścierny'],
      ['Porządkowanie stanowiska i konserwacja narzędzi', ['porzadek', 'narzedzia'], 'Utrwalanie nawyku sprzątania i odkładania narzędzi na miejsce.', 'ćwiczenia praktyczne', 'zmiotki, odkurzacz, tablica narzędziowa']
    ]),

  W('komputerowa', 'Pracownia komputerowa',
    'Rozwijanie umiejętności obsługi komputera i urządzeń cyfrowych w codziennym życiu i pracy: edycji tekstu, korzystania z internetu, poczty, grafiki i multimediów, z dbałością o bezpieczeństwo w sieci.',
    ['Nauka samodzielnej obsługi komputera i smartfona.', 'Rozwijanie umiejętności tworzenia i edycji dokumentów.', 'Bezpieczne korzystanie z internetu i komunikacji elektronicznej.', 'Rozwijanie kreatywności z wykorzystaniem grafiki i multimediów.'],
    [
      ['obsluga', 'Obsługa komputera', [['start', 'Uruchamianie, logowanie i zamykanie systemu'], ['mysz', 'Posługiwanie się myszą i klawiaturą'], ['pliki', 'Zapisywanie i odnajdywanie plików']]],
      ['tekst', 'Edytor tekstu', [['pisanie', 'Pisanie i poprawianie tekstu'], ['formatowanie', 'Formatowanie tekstu i wstawianie obrazów'], ['druk', 'Drukowanie dokumentów']]],
      ['siec', 'Internet i komunikacja', [['wyszukiwanie', 'Wyszukiwanie informacji w internecie'], ['poczta', 'Korzystanie z poczty e-mail i komunikatorów'], ['bezpieczenstwo', 'Bezpieczeństwo w sieci']]],
      ['multimedia', 'Grafika i multimedia', [['grafika', 'Tworzenie prostych grafik'], ['zdjecia', 'Fotografowanie i obróbka zdjęć'], ['prezentacje', 'Przygotowywanie prezentacji']]],
      ['smartfon', 'Urządzenia mobilne', [['telefon', 'Obsługa smartfona i aplikacji']]]
    ],
    [
      ['Ćwiczenia z myszą i klawiaturą – gry edukacyjne', ['mysz', 'start'], 'Usprawnianie precyzji ruchów i znajomości klawiatury.', 'ćwiczenia praktyczne przy komputerze', 'komputery, programy edukacyjne'],
      ['Pisanie listu lub ogłoszenia w edytorze tekstu', ['pisanie', 'formatowanie', 'pliki'], 'Tworzenie i zapisywanie krótkiego dokumentu.', 'pokaz, instruktaż, praca indywidualna', 'edytor tekstu, wzór dokumentu'],
      ['Projekt zaproszenia z grafiką i wydruk', ['formatowanie', 'grafika', 'druk'], 'Wstawianie obrazów, formatowanie i drukowanie.', 'pokaz, praca indywidualna', 'edytor tekstu, drukarka, papier'],
      ['Wyszukiwanie informacji – rozkład jazdy, pogoda, przepisy', ['wyszukiwanie'], 'Formułowanie zapytań i ocena znalezionych informacji.', 'ćwiczenia praktyczne, praca w parach', 'komputery z internetem'],
      ['Poczta e-mail – wysyłanie wiadomości z załącznikiem', ['poczta', 'pliki'], 'Pisanie, wysyłanie i odbieranie wiadomości.', 'pokaz, ćwiczenia praktyczne', 'konta pocztowe uczestników'],
      ['Bezpieczeństwo w sieci – hasła, oszustwa, prywatność', ['bezpieczenstwo'], 'Rozpoznawanie zagrożeń i zasady bezpiecznego korzystania z internetu.', 'pogadanka, analiza przykładów, quiz', 'prezentacja, karty pracy'],
      ['Kartka okolicznościowa w programie graficznym', ['grafika', 'mysz'], 'Tworzenie grafiki z tekstem i obrazami.', 'pokaz, praca indywidualna', 'program graficzny, szablony'],
      ['Fotografowanie i obróbka zdjęć z zajęć', ['zdjecia', 'pliki'], 'Wykonanie zdjęć, kadrowanie i poprawa jasności.', 'ćwiczenia praktyczne', 'aparat lub smartfon, program do zdjęć'],
      ['Prezentacja o pracowni lub wydarzeniu', ['prezentacje', 'zdjecia', 'pisanie'], 'Przygotowanie kilku slajdów z tekstem i zdjęciami.', 'praca w parach, prezentacja na forum grupy', 'program do prezentacji, rzutnik'],
      ['Smartfon na co dzień – kalendarz, budzik, aplikacje', ['telefon'], 'Korzystanie z podstawowych funkcji telefonu w codziennym życiu.', 'pokaz, ćwiczenia praktyczne', 'smartfony uczestników'],
      ['Porządkowanie plików i folderów', ['pliki', 'start'], 'Tworzenie folderów, nazywanie i przenoszenie plików.', 'ćwiczenia praktyczne', 'komputery, pendrive']
    ]),

  W('krawiecka', 'Pracownia krawiecko-rękodzielnicza',
    'Nauka szycia ręcznego i maszynowego oraz technik rękodzielniczych (dziewiarstwo, haft, filcowanie, makrama), rozwijanie precyzji i cierpliwości oraz wykonywanie użytkowych wyrobów z tkanin i włóczki.',
    ['Usprawnianie motoryki małej i precyzji ruchów.', 'Nauka szycia ręcznego i bezpiecznej obsługi maszyny do szycia.', 'Poznawanie technik rękodzielniczych.', 'Wykonywanie użytkowych wyrobów według wzoru.'],
    [
      ['reczne', 'Szycie ręczne', [['igla', 'Nawlekanie igły i szycie podstawowymi ściegami'], ['guziki', 'Przyszywanie guzików i drobne naprawy odzieży']]],
      ['maszyna', 'Szycie maszynowe', [['obsluga', 'Obsługa maszyny do szycia'], ['wyroby', 'Szycie prostych wyrobów']]],
      ['rekodzielo', 'Techniki rękodzielnicze', [['druty', 'Dzianie na drutach i szydełkowanie'], ['haft', 'Haftowanie'], ['filc', 'Filcowanie i makrama']]],
      ['przygotowanie', 'Przygotowanie materiału', [['wykroj', 'Mierzenie, odrysowywanie i wykrawanie według szablonu'], ['prasowanie', 'Prasowanie elementów']]]
    ],
    [
      ['Nauka ściegów ręcznych – fastryga, ścieg za igłą', ['igla'], 'Opanowanie podstawowych ściegów na próbniku.', PRAKTYKA, 'igły, nici, skrawki tkanin'],
      ['Przyszywanie guzików i cerowanie', ['guziki', 'igla'], 'Wykonanie drobnych napraw odzieży.', PRAKTYKA, 'guziki, nici, odzież do naprawy'],
      ['Obsługa maszyny do szycia – szycie po liniach', ['obsluga'], 'Bezpieczna obsługa maszyny i prowadzenie materiału.', 'pokaz, ćwiczenia praktyczne pod nadzorem', 'maszyna do szycia, karty z liniami'],
      ['Szycie poduszki lub woreczka', ['wykroj', 'obsluga', 'wyroby', 'prasowanie'], 'Wykonanie prostego wyrobu od wykroju do wykończenia.', PRAKTYKA, 'tkanina, szablon, nożyce, maszyna, żelazko'],
      ['Torba na zakupy z tkaniny', ['wykroj', 'wyroby'], 'Szycie użytkowego wyrobu według wzoru.', PRAKTYKA, 'tkanina, taśma, szablon, maszyna'],
      ['Szalik na drutach', ['druty'], 'Nabieranie oczek i przerabianie ściegiem francuskim.', PRAKTYKA, 'druty, włóczka'],
      ['Serwetka szydełkiem', ['druty'], 'Wykonywanie łańcuszka i słupków.', PRAKTYKA, 'szydełka, kordonek'],
      ['Haft krzyżykowy – zakładka do książki', ['haft', 'igla'], 'Odwzorowanie wzoru haftem krzyżykowym.', PRAKTYKA, 'kanwa, mulina, igły, wzory'],
      ['Filcowanie na sucho – broszki i ozdoby', ['filc'], 'Formowanie wełny igłą do filcowania.', 'pokaz, praca indywidualna pod nadzorem', 'wełna czesankowa, igły do filcowania, gąbki'],
      ['Makrama – kwietnik', ['filc'], 'Wiązanie podstawowych węzłów makramowych.', PRAKTYKA, 'sznurek bawełniany, obręcze'],
      ['Ozdoby okolicznościowe z filcu', ['wykroj', 'igla'], 'Wykrawanie według szablonu i zszywanie elementów.', PRAKTYKA, 'filc, szablony, nici, wypełnienie']
    ]),

  W('ogrodnicza', 'Pracownia ogrodnicza',
    'Nauka uprawy i pielęgnacji roślin, prac porządkowych w ogrodzie i na terenie warsztatu oraz florystyki, z wykorzystaniem cykliczności pór roku.',
    ['Poznawanie zasad uprawy i pielęgnacji roślin.', 'Nauka bezpiecznej obsługi narzędzi ogrodniczych.', 'Kształtowanie odpowiedzialności za powierzone zadania.', 'Rozwijanie wrażliwości na przyrodę i estetykę otoczenia.'],
    [
      ['uprawa', 'Uprawa roślin', [['wysiew', 'Wysiew nasion i pikowanie'], ['sadzenie', 'Sadzenie i przesadzanie roślin'], ['podlewanie', 'Podlewanie i nawożenie']]],
      ['pielegnacja', 'Pielęgnacja', [['pielenie', 'Pielenie i spulchnianie gleby'], ['przycinanie', 'Przycinanie roślin'], ['rozpoznawanie', 'Rozpoznawanie roślin i szkodników']]],
      ['porzadek', 'Prace porządkowe', [['grabienie', 'Grabienie i porządkowanie terenu'], ['kompost', 'Kompostowanie'], ['narzedzia', 'Obsługa i konserwacja narzędzi ogrodniczych']]],
      ['florystyka', 'Florystyka', [['kompozycje', 'Wykonywanie kompozycji z roślin'], ['suszenie', 'Suszenie i przechowywanie roślin']]]
    ],
    [
      ['Wysiew nasion warzyw i kwiatów do skrzynek', ['wysiew', 'podlewanie'], 'Przygotowanie podłoża i prawidłowy wysiew nasion.', PRAKTYKA, 'nasiona, ziemia, skrzynki, konewki'],
      ['Pikowanie i przesadzanie rozsady', ['wysiew', 'sadzenie'], 'Delikatne przesadzanie młodych roślin.', PRAKTYKA, 'rozsada, doniczki, ziemia, pikownik'],
      ['Sadzenie roślin na rabacie', ['sadzenie', 'narzedzia'], 'Przygotowanie dołków i sadzenie roślin w odstępach.', PRAKTYKA, 'sadzonki, łopatki, konewki'],
      ['Pielęgnacja roślin doniczkowych w warsztacie', ['podlewanie', 'przycinanie', 'rozpoznawanie'], 'Ocena potrzeb roślin, podlewanie i usuwanie suchych liści.', PRAKTYKA, 'rośliny doniczkowe, konewki, nawóz, nożyczki'],
      ['Pielenie i spulchnianie grządek', ['pielenie', 'rozpoznawanie'], 'Odróżnianie chwastów od roślin uprawnych.', PRAKTYKA, 'motyczki, rękawice, wiadra'],
      ['Grabienie liści i porządkowanie terenu', ['grabienie', 'narzedzia'], 'Systematyczne porządkowanie wyznaczonego terenu.', 'praca w grupie', 'grabie, worki, taczka'],
      ['Zakładanie i pielęgnacja kompostownika', ['kompost', 'grabienie'], 'Poznanie zasad kompostowania i segregacji odpadów zielonych.', 'pogadanka, ćwiczenia praktyczne', 'kompostownik, widły, odpady zielone'],
      ['Przycinanie krzewów i roślin', ['przycinanie', 'narzedzia'], 'Bezpieczne posługiwanie się sekatorem pod nadzorem.', 'pokaz, ćwiczenia praktyczne', 'sekatory, rękawice'],
      ['Kompozycja z roślin sezonowych', ['kompozycje', 'suszenie'], 'Wykonanie bukietu lub stroika z materiału roślinnego.', PRAKTYKA, 'rośliny, gąbka florystyczna, wstążki'],
      ['Suszenie ziół i kwiatów', ['suszenie', 'rozpoznawanie'], 'Zbiór, wiązanie i suszenie roślin.', PRAKTYKA, 'zioła, sznurek, papier'],
      ['Konserwacja narzędzi ogrodniczych', ['narzedzia'], 'Czyszczenie i odkładanie narzędzi na miejsce.', 'ćwiczenia praktyczne', 'szczotki, olej, szmatki']
    ]),

  W('ceramiczna', 'Pracownia ceramiczna',
    'Nauka formowania wyrobów z gliny różnymi technikami, ich zdobienia i szkliwienia, z rozwijaniem sprawności manualnej, wyobraźni przestrzennej i cierpliwości.',
    ['Usprawnianie motoryki małej i siły dłoni.', 'Poznawanie technik formowania i zdobienia gliny.', 'Wykonywanie użytkowych i dekoracyjnych wyrobów ceramicznych.', 'Kształtowanie dokładności i cierpliwości w pracy.'],
    [
      ['glina', 'Przygotowanie gliny', [['ugniatanie', 'Ugniatanie gliny'], ['walkowanie', 'Wałkowanie plastra o równej grubości']]],
      ['formowanie', 'Techniki formowania', [['waleczki', 'Lepienie z wałeczków'], ['plaster', 'Formowanie z plastra i wykrawanie'], ['kolo', 'Toczenie na kole garncarskim'], ['dekor', 'Odciskanie wzorów i zdobienie reliefem']]],
      ['wykonczenie', 'Wykończenie', [['szkliwienie', 'Szkliwienie i malowanie angobami'], ['retusz', 'Szlifowanie i retusz']]],
      ['organizacja', 'Organizacja pracy', [['stanowisko', 'Przygotowanie i porządkowanie stanowiska']]]
    ],
    [
      ['Przygotowanie gliny – ugniatanie i wałkowanie', ['ugniatanie', 'walkowanie'], 'Przygotowanie masy bez pęcherzy powietrza.', PRAKTYKA, 'glina, wałki, listewki'],
      ['Miseczka z wałeczków', ['waleczki', 'ugniatanie'], 'Budowanie naczynia z wałeczków i ich łączenie.', PRAKTYKA, 'glina, narzędzia do modelowania, gąbka'],
      ['Podkładki i kafle z odciskanym wzorem', ['walkowanie', 'plaster', 'dekor'], 'Wykrawanie według szablonu i zdobienie odciskiem.', PRAKTYKA, 'glina, szablony, stemple, liście'],
      ['Zawieszki i aniołki z plastra', ['plaster', 'retusz'], 'Wykrawanie foremkami i wygładzanie krawędzi.', PRAKTYKA, 'glina, foremki, wałek'],
      ['Toczenie na kole garncarskim', ['kolo'], 'Centrowanie gliny i formowanie prostego naczynia z pomocą instruktora.', 'pokaz, ćwiczenia indywidualne', 'koło garncarskie, glina, woda'],
      ['Domki i figurki ceramiczne', ['plaster', 'dekor', 'waleczki'], 'Łączenie elementów techniką szlikru.', PRAKTYKA, 'glina, szlikier, narzędzia'],
      ['Szkliwienie wyrobów po pierwszym wypale', ['szkliwienie'], 'Równomierne nakładanie szkliwa pędzlem lub przez zanurzenie.', PRAKTYKA, 'szkliwa, pędzle, rękawice'],
      ['Malowanie angobami', ['szkliwienie', 'dekor'], 'Zdobienie wyrobów angobami według projektu.', PRAKTYKA, 'angoby, pędzle, wzory'],
      ['Szlifowanie i retusz wyrobów', ['retusz'], 'Wygładzanie powierzchni i usuwanie nierówności.', PRAKTYKA, 'gąbki, papier ścierny, narzędzia'],
      ['Porządkowanie pracowni ceramicznej', ['stanowisko'], 'Utrwalanie nawyku sprzątania i dbałości o narzędzia.', 'ćwiczenia praktyczne', 'gąbki, wiadra, ściereczki']
    ])
];

module.exports = { WORKSHOPS };
