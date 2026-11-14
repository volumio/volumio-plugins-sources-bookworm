# X10 RF Remote – Volumio-4-Plugin

Macht Tasten von RF/IR-Fernbedienungen in Volumio nutzbar – auch Tasten, die der Kerneltreiber nur als
`MSC_SCAN` meldet (z. B. X10-WTI-Empfänger `0bc7:0006` mit `ati_remote`) und die Triggerhappy deshalb
nicht sieht. Ein Assistent liest neue Fernbedienungen ein, jede Fernbedienung wird ein **Profil** mit
Tastennamen, Beschriftungen, Befehlen, Beschreibung, Notizen und bis zu sechs Bildern. Eigene Befehle können
Volumios Standardbelegung für eine Fernbedienung ersetzen – **ohne `audio.conf` jemals zu verändern**.

Sprachen: English, Italiano, Deutsch, Español, Français. *(English documentation: `README.md`)*

```
Fernbedienung → Treiber (unverändert) → /dev/input/eventX
  → x10mapper.py (Dienst x10mapper, root, Python + evdev)
       → uinput "X10Remote virtual keyboard"   umgesetzte Tasten (KEY_F13 … oder gewählte, z. B. KEY_DVD)
       → uinput "X10Remote passthrough …"      unveränderte Tasten, solange eine Fernbedienung abgefangen wird
  → Triggerhappy (Teil von Volumio) → x10remote-action → Volumio-REST-API
Weboberfläche: Node-HTTP-Server im Plugin-Prozess (ohne Root-Rechte), Port 7710
```

## Bedienung

Plugin-Einstellungen → **Weboberfläche** öffnet `http://<IP des Geräts>:7710/` (Sprache folgt automatisch Volumio, oben rechts für diesen Browser überschreibbar):

* **Fernbedienung einlesen** (Assistent in vier Schritten)
  1. **Profil:** Name, Beschreibung, Notizen, „sofort aktivieren“.
  2. **Fernbedienung:** „Erkennen starten“ und eine Taste drücken – oder aus der Geräteliste wählen.
  3. **Tasten:** Taste drücken → sofort Name, Beschriftung, Aktion (bei Scan-Code-Tasten auch die Triggerhappy-Taste)
     eingeben → „Übernehmen – nächste Taste“ (oder Enter, oder einfach die nächste Taste drücken). Bereits eingelesene
     Tasten öffnen sich zum Ändern. Während des Einlesens löst diese Fernbedienung nichts in Volumio aus.
     **„Fertig – alle Tasten eingelesen“** speichert das Profil.
  4. **Bilder:** bis zu 6 Bilder hochladen oder fotografieren (freiwillig), dann zum Profil.
* **Sender und Empfänger:** Ein Profil ist ein Sender (die Fernbedienung); Empfänger sind die USB-Geräte
  (je ein Ordner direkt in `/data/INTERNAL/X10`, der genau wie der Empfänger heißt, mit `receiver.json`) mit eigenem Namen, Notizen und Bildern (Seite „Empfänger“). Ohne
  **433-MHz-Haken** gehört ein Empfänger genau einem Sender und ein Sender genau einem Empfänger; mit Haken (z. B.
  X10-Funk) arbeitet ein Empfänger mit mehreren Sendern und ein Sender mit mehreren Empfängern – ohne Doppelausführung.
* **Aktion „Radiosender“:** Sendername, bis zu drei URIs (Failover in dieser Reihenfolge), Display-Logo/-Quality/-Format
  für Display-Plugins, Auswahl aus `/data/INTERNAL/X10/radiopresets.txt` (einmalig installiert, frei bearbeitbar),
  Erreichbarkeitsprüfung vor dem Übernehmen. Ausgeführt als `x10remote-action radio <profil>/<taste>` (kein
  Expertenmodus nötig, keine URI in der Triggerhappy-Zeile). Alle Sender stehen in `/data/INTERNAL/X10/radio-stations.json`
  (Schnittstelle zum Lesen für andere Plugins, z. B. HD44780/VFD). Startseite: alle Webradio-URIs prüfen → Bericht
  `webradio-check-<Datum>.txt`. Profilseite: Sender zu Volumios „Meine Webradios“ über Volumios eigenes
  `addToMyWebRadio` (Sicherung in `X10/_backup`; gleicher Name, andere URI → „Name (X10)“).
* **Triggerhappy-Tasten:** dieselbe Taste darf in verschiedenen Profilen vorkommen; im selben Profil nur einmal
  (ausgegraut). Ein inaktives Profil darf Doppelte enthalten, aktivieren erst nach dem Bereinigen.
* **Vorlagen** (`presets/`): mitgelieferte Profile bekannter Fernbedienungen (zuerst Medion RF 20016398), „Profil
  anlegen“ kopiert sie. Texte folgen der Volumio-Sprache, Beschriftungen der Fernbedienung werden nie übersetzt.
* **Gesperrt beim Einlesen:** Ab dem Erkennen liest der Mapper alle Geräte exklusiv – keine Taste (auch nicht die
  Ausschalttaste) löst etwas aus; der Assistent zeigt an, ob das bestätigt ist.
* **Profile** – Übersicht mit Vorschaubild, Aktiv-Schalter, **Umbenennen** (der Ordner wird mit umbenannt),
  **Duplizieren** („<Name> copy“) und **Print Profile** (Tastenliste, optional mit Befehl und Scan-Code / `KEY_*`,
  drucken oder als Text kopieren). Die Profilseite enthält Name, Beschreibung, **Notizen**, bis zu **6 Bilder**
  (hochladen oder „Foto aufnehmen“) und alle Tasten.
* **Je Taste:** Name, Beschriftung auf der Fernbedienung, Aktion (eingebaute Volumio-Aktionen oder eigener Befehl),
  Beschreibung des Befehls, Wiederholen beim Halten und bei Scan-Code-Tasten die **Triggerhappy-Taste**, in die der
  Wrapper umsetzt (Liste von `thd --listevents`, die in audio.conf belegten zuoberst).
* **Tastentest** – LED je Taste: grün = eigene Aktion, blau = unverändert an Volumio, rot = gesperrt, orange = ohne
  Wirkung. Jedes Ereignis zeigt die erzeugte Taste und ihre audio.conf-Belegung und hat den Button **„Konfigurieren“**.
* **Command reference** neben jedem Befehlsfeld: `/data/INTERNAL/X10/command reference.txt`, frei erweiterbar.
  Unverändert wird sie in der eingestellten Sprache angezeigt; eine selbst geänderte Datei bleibt immer unberührt.
* Eingebautes Profil **„Volumio default – vanilla“** = nur Volumios `audio.conf` im Original.

## Plugin-Einstellungen in Volumio

| Abschnitt | Inhalt |
|---|---|
| Weboberfläche | Seiten öffnen (mit der IP des Geräts), Adresse anzeigen, Version |
| Profil | aktives Profil inkl. „Volumio default – vanilla“ |
| Allgemein | Mapper an/aus, Entprellzeit, Wiederholintervall, ignorierte Scan-Codes, Watchdog (alle 5 Minuten), Tastendrücke protokollieren, Port |
| **Expertenmodus** | Schalter Expertenmodus (Standard: aus); nur dann sichtbar: **Eigene Shell-Befehle erlauben** und **Triggerhappy exklusiv** (+ Wartezeit). Expertenmodus aus → beide aus |
| Diagnose | Status, Protokoll, Mapper neu starten |
| Erweiterte Werkzeuge | ersetzte audio.conf-Befehle, Triggerhappy-Datei, Wrapper-Export, X10-Standardprofil neu anlegen |

## Eigene Befehle

Standardmäßig **aus**. Einschalten nur unter **Expertenmodus → „Eigene Shell-Befehle erlauben“**. Vorher erscheint
ein Hinweis mit den konkreten Gefahren (keine Anmeldung an der Weboberfläche, Rechte des Triggerhappy-Benutzers
`nobody`, Netzwerkzugriff, fehlerhafte oder kopierte Befehle) und der Einordnung, dass das Risiko gering ist, solange
das Gerät nicht aus dem Internet erreichbar ist; erst nach „Verstanden – einschalten“ sind sie aktiv. Über die
Weboberfläche lassen sie sich nicht freischalten. Befehle mit `#` werden abgelehnt (Triggerhappy schneidet dort ab).
Beispiele:

```
/usr/local/bin/x10remote-action playlist "Radio"
/usr/local/bin/x10remote-action volume 30
/usr/local/bin/x10remote-action api "random&value=true"
```

## Wie audio.conf unangetastet bleibt

`audio.conf` und alle anderen fremden Triggerhappy-Dateien werden **nur gelesen**. Das Plugin schreibt genau eine
Datei: `/etc/triggerhappy/triggers.d/x10remote.conf`.

* **Erkannte Taste mit eigener Aktion:** Der Mapper fängt nur diese Fernbedienung exklusiv ab (`EVIOCGRAB`), gibt die
  Taste als freie virtuelle Taste aus und reicht alle anderen Tasten unverändert durch. Für alle anderen Geräte gilt
  audio.conf weiter. Stoppt oder stürzt der Dienst ab, gibt der Kernel das Gerät sofort frei.
* **Scan-Code-Taste mit eigener Aktion**, deren gewählte Triggerhappy-Taste schon anderweitig belegt ist: Ausgabe intern
  als freie virtuelle Taste („geschützt“), angezeigt wird die gewählte. Virtuelle Tasten, die eine andere
  Triggerhappy-Datei verwendet, werden nie vergeben. Ergebnis: **nichts wird doppelt ausgeführt**.
* **Triggerhappy exklusiv** (Expertenmodus, Standard aus): `install.sh` legt eine systemd-Ergänzung für
  `triggerhappy.service` an, die nur den Ordner hinter `--triggers` durch eine Variable ersetzt; ohne
  `/run/x10remote/thd.env` ist das der Originalordner – Triggerhappy verhält sich exakt wie vorher. Eingeschaltet
  startet das Plugin Triggerhappy nach der Wartezeit neu; Triggerhappy liest dann nur
  `/run/x10remote/triggers.d` (eigene Belegungen + Kopie der audio.conf-Zeilen). Zurück bei Ausschalten,
  Deaktivieren, Deinstallieren und nach jedem Neustart des Geräts.

## Volumio-Regeln, Robustheit, Sicherheit

* Wirkung nur zwischen `onStart` und `onStop` (Mapper, Watchdog, Exklusivbetrieb, Weboberfläche, Erfassung); keine
  Dienste beim Systemstart aktiviert. `onStart` lehnt bei echten Fehlern ab.
* Protokoll nur über den Volumio-Logger (Präfix `X10Remote::`), kein `console.log`.
* `sudo` nur für `systemctl` (auch die kleinen root-Helfer `x10remote-fixperms.service` und der Watchdog).
* `install.sh` installiert nur fehlende Pakete (`python3-evdev`, `triggerhappy`, `curl`), überschreibt keine fremden
  Dateien, schreibt nichts nach `/volumio`; `uninstall.sh` entfernt nur eigene Dateien (Profile bleiben).
* Mehrsprachig nach Volumio-Vorgabe: `i18n/strings_<code>.json`, Englisch ist Pflicht und Rückfall; `UIConfig.json`
  nur mit `TRANSLATE.X10.*`. Meldungen, Dialoge und Weboberfläche folgen der Sprache von Volumio (ohne Neustart).
  Protokolle und erzeugte Systemdateien sind englisch.
* Weboberfläche ohne Root-Rechte: feste Dateiliste, strenge Prüfung aller Eingaben, Bilder per Dateisignatur geprüft,
  Größenlimits, JSON-Pflicht und Herkunftsprüfung für Schreibzugriffe, Content-Security-Policy ohne Inline-Skripte,
  atomares Schreiben.
* `/data/INTERNAL/X10` ist über die Freigabe „Internal Storage“ voll beschreibbar (Ordner 0777, Dateien 0666).

## Installation (Entwicklung)

```sh
mkdir -p ~/x10remote && cd ~/x10remote
python3 -m zipfile -e ../x10remote.zip .
volumio plugin install
volumio vrestart
```
Danach in Volumio unter *Plugins → Installierte Plugins* aktivieren; die Einstellungen zeigen die Version.

## Speicherorte

| Pfad | Inhalt |
|---|---|
| `/data/INTERNAL/X10/<profil>/profile.json`, `image1..6` | Profile und Bilder |
| `/data/INTERNAL/X10/command reference.txt` | Befehlsreferenz (frei erweiterbar) |
| `/data/configuration/system_hardware/x10remote/config.json`, `mapper.json` | Einstellungen, erzeugte Mapper-Konfiguration |
| `/etc/triggerhappy/triggers.d/x10remote.conf` | Triggerhappy-Datei des Plugins |
| `/etc/systemd/system/x10mapper.service`, `x10remote-watchdog.{service,timer}`, `x10remote-fixperms.service` | Dienste (nur vom Plugin gestartet) |
| `/etc/systemd/system/triggerhappy.service.d/x10remote.conf` | Ergänzung für den Exklusivbetrieb (ohne `/run/x10remote/thd.env` wirkungslos) |
| `/usr/local/bin/x10mapper.py`, `x10remote-action`, `x10remote-watchdog`, `x10remote-fixperms` | Programme |
| `/run/x10mapper-status.json`, `/run/x10remote/watchdog.log` | Status des Mappers, Meldungen des Watchdogs |

## Grenzen

36 gleichzeitig aktive virtuelle Tasten (`KEY_F13`–`KEY_F24`, `KEY_PROG1`–`4`, `KEY_FN_F1`–`12`,
`KEY_BRL_DOT1`–`8`), 100 Tasten je Profil, 50 Profile, 6 Bilder je Profil, Befehle bis 2000 Zeichen.

## Fehlersuche

```sh
systemctl is-active x10mapper triggerhappy
journalctl -u x10mapper -n 50
curl -s http://localhost:7710/api/info
cat /run/x10mapper-status.json
```
