# 📅 PlanLekcji — Plan Lekcji Szkolnych

Aplikacja PWA do układania i zarządzania planem lekcji. Działa w całości w przeglądarce — **bez serwera, bez instalacji, bez zbierania danych**. Można ją zainstalować na komputerze lub tablecie jak aplikację natywną.

🔗 **Aplikacja:** https://krzjur-oss.github.io/plan-lekcji/

---

## 📦 Wersja

| | |
|---|---|
| **Aktualna wersja** | v1.0.0 |
| **Ostatnia aktualizacja** | 11 kwietnia 2026 |
| **Autor** | Krzysztof Jureczek |
| **Status** | Aktywny, rozwijany |

---

## ✨ Funkcje

### 🚀 Strona powitalna

Przy pierwszym uruchomieniu wyświetla się strona powitalna z czterema opcjami:

| Opcja | Opis |
|-------|------|
| ✨ Utwórz nowy plan | Kreator od zera — 6 kroków |
| 📋 Nowy rok szkolny | Kopiuje konfigurację z bieżącego roku |
| 📂 Importuj z pliku | Wczytaj plan z pliku `.json` |
| 🎬 Wersja demo | Fikcyjna szkoła z przykładowym planem — dane nie są zapisywane |

---

### 📅 Plan lekcji

- Kliknij komórkę w tabeli, aby dodać lub edytować lekcję — wybierz nauczyciela, klasę/grupę, salę i przedmiot
- Skróty klasy, przedmiotu i inicjały nauczyciela widoczne bezpośrednio w komórce
- **Ctrl+S** — zapisz plan · **Esc** — zamknij okno

---

### 🧙 Kreator nowego roku szkolnego (6 kroków)

| Krok | Opis |
|------|------|
| 1 — Szkoła | Nazwa i skrót szkoły + rok szkolny |
| 2 — Klasy | Lista klas z opcjonalnym podziałem na grupy |
| 3 — Nauczyciele | Lista nauczycieli ze skrótami |
| 4 — Sale | Sale lekcyjne z nazwą i opisem |
| 5 — Przedmioty | Lista przedmiotów ze skrótami (opcjonalne) |
| 6 — Godziny | Godziny rozpoczęcia i zakończenia lekcji |

Kreator automatycznie zapisuje postęp (autosave). Po zakończeniu kreatora możesz edytować wszystkie dane w zakładce **Dane**.

---

### 👥 Klasy i grupy

- Klasy z opcjonalnym podziałem na grupy (np. gr.1, gr.2, j.ang-A)
- Grupy definiowane są w katalogu szkolnym i przypisywane do klas
- Przypisania łączą klasę/grupę z nauczycielem, przedmiotem i salą

---

### ⚠ Wykrywanie kolizji

- Czerwona ramka gdy ten sam nauczyciel lub sala zajęta w dwóch miejscach jednocześnie
- Licznik kolizji widoczny w nagłówku tabeli

---

### 🖱️ Przeciąganie lekcji

- Przeciągnij wypełnioną komórkę na inną godzinę lub dzień — kopiuje wpis
- Gdy cel jest zajęty — pojawi się potwierdzenie przed nadpisaniem

---

### 📄 Płachta szkoły

- Widok zbiorczy całego planu — po klasach, nauczycielach lub salach
- Filtrowanie po dniu tygodnia i wyszukiwarka
- Wydruk bezpośrednio z przeglądarki

---

### 📊 Statystyki

- Obciążenie godzinowe nauczycieli — łączna liczba godzin w tygodniu
- Postęp wypełnienia planu dla każdej klasy
- Przegląd przypisanych i nieumieszczonych lekcji

---

### 🔄 Eksport i import JSON

- Przycisk **⇅ Import / Eksport** → Eksportuj JSON — plik z pełnym planem
- Import JSON lub przeciągnij plik `.json` na okno aplikacji
- Tryby: **Scal** (uzupełnij braki) / **Zastąp** (nadpisz wszystko)

---

## 📲 PWA — instalacja jako aplikacja

### Chrome / Edge (Windows, Android)
Kliknij przycisk **⬇ Zainstaluj** w górnym pasku lub ikonę ⊕ w pasku adresu przeglądarki.

### Safari (iOS / macOS)
Udostępnij → **Dodaj do ekranu głównego**

### Po instalacji
- Pełny tryb offline — Service Worker cache'uje wszystkie pliki
- Przy nowej wersji aplikacja automatycznie się odświeży

---

## ⌨️ Skróty klawiszowe

| Skrót | Akcja |
|-------|-------|
| **Ctrl+S** | Zapisz plan |
| **Escape** | Zamknij okno / modal |

---

## 🚀 Uruchomienie

### GitHub Pages
https://krzjur-oss.github.io/plan-lekcji/

### Lokalnie
Otwórz `index.html` bezpośrednio w przeglądarce — nie wymaga serwera.

---

## 📖 Jak zacząć

1. Otwórz aplikację — pojawi się strona powitalna
2. Wybierz **✨ Utwórz nowy plan** i przejdź przez kreator (6 kroków)
3. Wypełniaj plan klikając komórki w tabeli
4. Regularnie eksportuj kopię zapasową: **⇅ Import / Eksport → Eksportuj JSON**

---

## 🔒 Prywatność i dane

Aplikacja nie zbiera, nie wysyła ani nie przechowuje żadnych danych zewnętrznie. Wszystkie dane w `localStorage` przeglądarki.

| Klucz | Zawartość |
|-------|-----------|
| `planlekcji_v2` | Pełny stan aplikacji (klasy, nauczyciele, sale, plan) |
| `planlekcji_wiz_draft` | Autosave kreatora konfiguracji |
| `pl_sb_collapsed` | Stan zwinięcia sekcji w lewym panelu |

---

## 🗂 Struktura repozytorium

```
plan-lekcji/
├── index.html        # Struktura HTML aplikacji
├── styles.css        # Style CSS
├── app.js            # Logika aplikacji (JavaScript)
├── manifest.json     # PWA manifest
├── sw.js             # Service Worker
├── icon-192.png      # Ikona PWA 192×192 px
├── icon-512.png      # Ikona PWA 512×512 px
├── LICENSE           # Licencja
├── REGULAMIN.md      # Regulamin użytkowania
└── README.md         # Dokumentacja
```

---

## 🛠 Technologie

Czysty HTML + CSS + JavaScript — zero zewnętrznych zależności. Dane: localStorage. Offline: Service Worker (Cache API). Standard: PWA (Web App Manifest).

---

## 🆕 Co nowego

### v1.0.0 — 11 kwietnia 2026

- Pierwsze wydanie aplikacji PlanLekcji
- Kreator konfiguracji szkoły (6 kroków) z autosave
- Plan lekcji dla wielu klas z obsługą grup i podgrup
- Automatyczne wykrywanie kolizji nauczycieli, sal i grup
- Płachta szkoły z widokiem po klasach, nauczycielach i salach
- Statystyki obciążenia nauczycieli
- Eksport/import JSON z trybami scalania i zastępowania
- Przeciąganie lekcji między godzinami i dniami
- PWA — instalacja na urządzeniu, praca offline
- Podział na osobne pliki: `index.html`, `styles.css`, `app.js`

---

## ⚖️ Licencja i prawa autorskie

© 2025–2026 Krzysztof Jureczek. Wszelkie prawa zastrzeżone.

Szczegółowe warunki użytkowania w pliku [`LICENSE`](LICENSE) oraz [`REGULAMIN.md`](REGULAMIN.md). Aplikacja przeznaczona wyłącznie do niekomercyjnego użytku w placówkach oświatowych.
