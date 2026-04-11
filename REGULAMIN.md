# 📄 Regulamin aplikacji PlanLekcji

**Wersja 1.0 · obowiązuje od 1 stycznia 2025 r.**

---

## §1. Postanowienia ogólne

Niniejszy Regulamin określa zasady korzystania z aplikacji internetowej **PlanLekcji — Plan Lekcji Szkolnych** (dalej: „Aplikacja"), udostępnianej pod adresem **https://krzjur-oss.github.io/plan-lekcji/**.

Właścicielem i twórcą Aplikacji jest **Krzysztof Jureczek** (dalej: „Autor"). Korzystanie z Aplikacji jest równoznaczne z akceptacją niniejszego Regulaminu.

---

## §2. Przeznaczenie Aplikacji

Aplikacja przeznaczona jest wyłącznie do **niekomercyjnego użytku w placówkach oświatowych** (szkoły, przedszkola, placówki kształcenia). Umożliwia planowanie i zarządzanie planem lekcji — przypisywanie nauczycieli, przedmiotów i sal do poszczególnych godzin lekcyjnych dla wielu klas jednocześnie.

---

## §3. Warunki korzystania

- Aplikacja jest bezpłatna i dostępna dla każdego użytkownika posiadającego dostęp do przeglądarki internetowej.
- Użytkownik zobowiązuje się korzystać z Aplikacji zgodnie z jej przeznaczeniem oraz obowiązującym prawem.
- Zabronione jest używanie Aplikacji w celach komercyjnych bez pisemnej zgody Autora.
- Zabronione jest podejmowanie działań mogących zakłócić działanie Aplikacji lub narazić innych użytkowników na szkodę.

---

## §4. Prawa autorskie i licencja

Wszelkie prawa do Aplikacji — w tym kod źródłowy, interfejs graficzny, projekt wizualny oraz dokumentacja — należą wyłącznie do Autora i są chronione przepisami prawa autorskiego.

| | |
|---|---|
| ❌ **Zabronione** | Kopiowanie, modyfikowanie, dekompilowanie, rozpowszechnianie lub sprzedaż Aplikacji bądź jej części bez pisemnej zgody Autora |
| ✅ **Dozwolone** | Korzystanie z Aplikacji zgodnie z jej przeznaczeniem oraz udostępnianie linku do Aplikacji innym osobom |

W sprawach licencjonowania komercyjnego prosimy o kontakt z Autorem poprzez repozytorium GitHub.

---

## §5. Dane i prywatność

Aplikacja **nie zbiera, nie przesyła ani nie przechowuje** żadnych danych użytkownika na zewnętrznych serwerach. Wszelkie dane (plan lekcji, lista klas, nauczyciele, przedmioty, sale) przechowywane są wyłącznie lokalnie w pamięci przeglądarki użytkownika (`localStorage`) na jego urządzeniu.

- Dane nie opuszczają urządzenia użytkownika.
- Aplikacja nie używa plików cookie, narzędzi analitycznych ani reklam.
- Użytkownik może w każdej chwili usunąć swoje dane, czyszcząc dane przeglądarki lub korzystając z funkcji eksportu/importu JSON.

### Klucze localStorage używane przez Aplikację

| Klucz | Zawartość |
|-------|-----------|
| `planlekcji_v2` | Pełny stan aplikacji (klasy, nauczyciele, sale, plan) |
| `planlekcji_wiz_draft` | Autosave kreatora konfiguracji |
| `pl_sb_collapsed` | Stan zwinięcia sekcji w lewym panelu |

---

## §6. Odpowiedzialność

Aplikacja udostępniana jest w stanie „takim, jakim jest" (*as is*), bez jakichkolwiek gwarancji — w szczególności gwarancji przydatności do określonego celu czy nieprzerwanego działania.

- Autor nie ponosi odpowiedzialności za utratę danych wynikającą z wyczyszczenia danych przeglądarki, awarii urządzenia lub innych przyczyn niezależnych od Autora.
- Autor nie ponosi odpowiedzialności za szkody wynikające z nieprawidłowego korzystania z Aplikacji.
- Zaleca się regularne tworzenie kopii zapasowych danych za pomocą funkcji **⇅ Import / Eksport → Eksportuj JSON**.

---

## §7. Zmiany Regulaminu

Autor zastrzega sobie prawo do zmiany Regulaminu. O istotnych zmianach użytkownicy będą informowani poprzez komunikat wyświetlany w Aplikacji. Dalsze korzystanie z Aplikacji po opublikowaniu zmian oznacza ich akceptację.

---

## §8. Postanowienia końcowe

W sprawach nieuregulowanych niniejszym Regulaminem zastosowanie mają przepisy prawa polskiego, w szczególności Kodeksu cywilnego oraz ustawy o prawie autorskim i prawach pokrewnych.

Wszelkie pytania dotyczące Aplikacji lub niniejszego Regulaminu można kierować do Autora za pośrednictwem repozytorium GitHub projektu: **https://github.com/krzjur-oss/plan-lekcji**

---

*© 2025–2026 Krzysztof Jureczek · Wszelkie prawa zastrzeżone*
