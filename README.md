# 💰 Finanz-Tracker

Wöchentliche Vermögensübersicht mit Supabase (Postgres, EU/Frankfurt) als
Cloud-Speicher. Statische Web-App (kein eigener Server nötig) mit
E-Mail-Login — mehrere Nutzer teilen sich eine App-Kopie, jeder sieht nur
seine eigenen Daten.

## Konzept

- **Eintrag je Kalenderwoche** (ISO-KW, mehrjährig eindeutig über Jahr + KW)
- **3 Level mit eigenem Verlaufsdiagramm** (kumulativ):
  - **Level 1**: Girokonto, Tagesgeld, Geldmarktfonds, Cash, Sparbücher, Kreditkarte, PayPal
  - **Level 2**: Level 1 + Aktien
  - **Level 3**: Level 2 + Private Markets, Crypto, Bausparvertrag, Gold, Riester (= Gesamtvermögen)
- **Mehrjährige Darstellung**: Die Diagramme zeigen alle Jahre als durchgehende
  Zeitachse (Beschriftung „KW07 2026“). Über den Zeitraum-Filter kann auf
  „Letzte 12 Monate“ oder ein einzelnes Jahr eingegrenzt werden.
- **Tabellen-Ansicht**: alle Wochen tabellarisch mit Kategorie-Spalten und
  Level-Summen; Klick auf eine Zeile öffnet die Woche in der Eingabe.
- **Lohnwochen** werden per Häkchen markiert und erscheinen in den Diagrammen
  als grüne Punkte mit grünem Hintergrundstreifen.
- **Kategorien** sind editierbar: umbenennen (inkl. historischer Daten),
  Level ändern, deaktivieren (Historie bleibt erhalten), neue hinzufügen.

## Einrichtung (einmalig pro App-Kopie, ca. 10 Minuten)

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen
   (Region: **Frankfurt** für EU-Datenhaltung).
2. Im Dashboard **SQL Editor → New query** öffnen, den Inhalt von
   [`supabase-setup.sql`](supabase-setup.sql) einfügen und ausführen.
   Das legt die Tabellen `kategorien`, `wochen`, `daten` samt
   Row-Level-Security-Policies an.
3. Unter **Settings → API** die **Project URL** und den **anon public** Key
   kopieren und oben in [`app.js`](app.js) bei `SUPABASE_URL` /
   `SUPABASE_ANON_KEY` eintragen. *(Der anon-Key ist als öffentlich konzipiert —
   der Datenschutz kommt aus den RLS-Policies.)*
4. App öffnen → Tab **Einstellungen** → registrieren & anmelden.
   Optional: im Supabase-Dashboard unter *Authentication → Sign In / Up*
   die E-Mail-Bestätigung deaktivieren, wenn Anmelden ohne
   Bestätigungs-E-Mail gewünscht ist.

**Weitere Nutzer** derselben App-Kopie müssen sich nur registrieren
(Schritte 1–3 entfallen). Jeder Nutzer sieht ausschließlich seine eigenen
Daten. Hinweis: Wer das Supabase-Projekt administriert, kann im Dashboard
technisch alle Daten einsehen.

## Migration aus Google Sheets (einmalig)

Die frühere Version nutzte Google Sheets + Apps Script als Speicher
(Code liegt weiterhin unter [`apps-script/Code.gs`](apps-script/Code.gs)).
Zum Übernehmen der Daten: **Einstellungen → Einmalige Migration aus Google
Sheets** — Apps-Script-URL und Token eintragen (werden aus der alten
Konfiguration vorbefüllt) und **Daten übernehmen** klicken. Die Migration
liest alle Kategorien, Wochen und Werte aus dem Sheet und schreibt sie in
das angemeldete Cloud-Konto.

## App starten

Lokal (wie mein-tracker):

```
python -m http.server 5004 --directory finanz-app
```

Dann http://localhost:5004 öffnen. Alternativ `index.html` auf einem beliebigen
statischen Hosting ablegen (GitHub Pages, Netlify, …) — es gibt keinen Server-Code.

Ohne Anmeldung kann der **Demo-Modus** (Einstellungen) die App mit
Beispieldaten zeigen; zuletzt geladene Daten bleiben als lokaler Cache
sichtbar (offline-fähig als PWA).

## Datenmodell (Supabase)

| Tabelle      | Spalten                                | Bedeutung                           |
|--------------|----------------------------------------|-------------------------------------|
| `kategorien` | user_id, name, level, aktiv, pos       | Kategorien und Level-Zuordnung      |
| `wochen`     | user_id, jahr, kw, lohn                | Lohn-Markierung der Woche           |
| `daten`      | user_id, jahr, kw, kategorie, wert     | Ein Wert pro Woche und Kategorie    |

Row Level Security stellt sicher, dass jede Abfrage nur die Zeilen des
angemeldeten Nutzers (`auth.uid() = user_id`) liest und schreibt.
