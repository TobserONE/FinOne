# 💰 Finanz-Tracker

Wöchentliche Vermögensübersicht mit Google Sheets als Datenspeicher.
Statische Web-App (kein eigener Server nötig) + Google Apps Script als Backend.

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

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Google Sheet + Apps Script

1. Neues Google Sheet erstellen, z. B. **„Finanz-Tracker“**.
2. Im Sheet: **Erweiterungen → Apps Script** öffnen.
3. Den kompletten Inhalt von [`apps-script/Code.gs`](apps-script/Code.gs) in den
   Editor kopieren (vorhandenen Beispielcode ersetzen).
4. Oben im Code das **`TOKEN`** ändern — beliebige geheime Zeichenkette,
   z. B. `mein-super-geheimes-token-2026`.
5. **Bereitstellen → Neue Bereitstellung**:
   - Typ (Zahnrad): **Web-App**
   - Ausführen als: **Ich**
   - Zugriff: **Jeder** *(nötig, damit die App ohne Google-Login zugreifen kann —
     geschützt wird der Zugriff über das Token)*
6. Beim ersten Mal die Berechtigungen bestätigen
   („Nicht sicher“ → Erweitert → Trotzdem öffnen ist hier normal, es ist dein eigenes Script).
7. Die angezeigte **Web-App-URL** kopieren (`https://script.google.com/macros/s/…/exec`).

### 2. App verbinden

1. App öffnen (siehe unten) → Tab **Einstellungen**.
2. Web-App-URL und Token eintragen → **Speichern & verbinden**.
3. Beim ersten Verbinden legt das Script die Tabellenblätter
   `Kategorien`, `Daten` und `Wochen` automatisch an und füllt die
   Standard-Kategorien ein.

> ⚠️ **Nach Änderungen am Apps-Script-Code** immer *Bereitstellen →
> Bereitstellungen verwalten → ✏️ → Version: Neue Version → Bereitstellen*
> wählen — sonst läuft weiterhin der alte Code.

## App starten

Lokal (wie mein-tracker):

```
python -m http.server 5004 --directory finanz-app
```

Dann http://localhost:5004 öffnen. Alternativ `index.html` auf einem beliebigen
statischen Hosting ablegen (GitHub Pages, Netlify, …) — es gibt keinen Server-Code.

Ohne Verbindung kann der **Demo-Modus** (Einstellungen) die App mit
Beispieldaten zeigen.

## Datenmodell im Sheet

| Blatt        | Spalten                    | Bedeutung                              |
|--------------|----------------------------|----------------------------------------|
| `Kategorien` | Name, Level, Aktiv         | Unterkategorien und Level-Zuordnung    |
| `Daten`      | Jahr, KW, Kategorie, Wert  | Ein Wert pro Woche und Kategorie       |
| `Wochen`     | Jahr, KW, Lohn             | Lohn-Markierung der Woche              |

Das Langformat (eine Zeile pro Wert) macht das Hinzufügen/Umbenennen von
Kategorien robust — es müssen nie Spalten verschoben werden. Auswertungen im
Sheet selbst gehen z. B. per Pivot-Tabelle.

## Sicherheitshinweis

Die Web-App-URL + Token schützen den Zugriff nur einfach (wer beides kennt,
kann Daten lesen/schreiben). Für persönliche Finanzdaten okay, solange du
URL und Token nicht weitergibst. Die App speichert beides nur lokal im
Browser (localStorage).
