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
Weboberfläche: Node-HTTP-Server im Plugin-Prozess (ohne Root-Rechte), Port 7810
```

## Bedienung

Plugin-Einstellungen → **Weboberfläche** öffnet `http://<IP des Geräts>:7810/` (Sprache folgt automatisch Volumio, oben rechts für diesen Browser überschreibbar):

* **Fernbedienung einlesen** (Assistent in vier Schritten)
  1. **Profil:** Name, Beschreibung, Notizen, „sofort aktivieren“.
  2. **Fernbedienung:** „Erkennen starten“ und dieselbe Taste zweimal drücken (Bestätigung) – oder aus der
     Geräteliste wählen.
  3. **Tasten:** Taste drücken → sofort Name, Beschriftung, Aktion (bei Scan-Code-Tasten auch die Triggerhappy-Taste)
     eingeben → „Übernehmen – nächste Taste“ (oder Enter, oder einfach die nächste Taste drücken). Bereits eingelesene
     Tasten öffnen sich zum Ändern. Während des Einlesens löst diese Fernbedienung nichts in Volumio aus.
     **„Fertig – alle Tasten eingelesen“** speichert das Profil.
  4. **Bilder:** bis zu 6 Bilder hochladen oder fotografieren (freiwillig), dann zum Profil.
* **Sender und Empfänger:** Ein Profil ist ein Sender (die Fernbedienung); Empfänger sind die USB-Geräte
  (je ein Ordner direkt in `/data/INTERNAL/X10`, der `receiver-<Name des Empfängers>` heißt, mit `receiver.json`) mit eigenem Namen, Notizen und Bildern (Seite „Empfänger“). Ohne
  **433-MHz-Haken** gehört ein Empfänger genau einem Sender und ein Sender genau einem Empfänger; mit Haken (z. B.
  X10-Funk) arbeitet ein Empfänger mit mehreren Sendern und ein Sender mit mehreren Empfängern – ohne Doppelausführung.
* **Aktion „Radiosender“:** Sendername, bis zu drei URIs (Failover in dieser Reihenfolge), Display-Logo/-Quality/-Format
  für Display-Plugins, Auswahl aus `/data/INTERNAL/X10/radiopresets.txt` (einmalig installiert, frei bearbeitbar),
  Erreichbarkeitsprüfung vor dem Übernehmen. Ausgeführt als `x10remote-action radio <profil>/<taste>` (kein
  Expertenmodus nötig, keine URI in der Triggerhappy-Zeile). Alle Sender stehen in `/data/INTERNAL/X10/radio-stations.json`
  (Schnittstelle zum Lesen für andere Plugins, z. B. HD44780/VFD). Startseite: alle Webradio-URIs prüfen → Bericht
  `webradio-check-<Datum>.txt`. Profilseite: Sender zu Volumios „Meine Webradios“ über Volumios eigenes
  `addToMyWebRadio` (Sicherung in `X10/_backup`; gleicher Name, andere URI → „Name (X10)“).
* **Vorlagen** (`templates/template-<name>/template.json` + Bilder): mitgelieferte Profile bekannter Fernbedienungen
  (Medion RF 20016398 / 20018268 / 20029724 mit X10-WTI-Empfänger, G21 Pro, eine No-Name-2,4-GHz-Fernbedienung, eine
  Belegung der Mobile Remote mit vier Radiosendern), „Profil anlegen“ kopiert sie. Texte folgen der Volumio-Sprache,
  Beschriftungen der Fernbedienung werden nie übersetzt. **„Als Vorlage speichern“** (Profilseite, Mobile-Remote-Seite)
  legt ein Profil samt Bildern, Senderlogos und den Daten seiner Empfänger als `/data/INTERNAL/X10/template-<name>/`
  ab – es steht sofort bei den Vorlagen und kann zum Mitliefern eingeschickt werden. Eigene Vorlagen liegen auf der
  Freigabe und werden beim Anlegen eines Profils wie jedes Profil geprüft; eigene Befehle aus einer Vorlage entfallen,
  solange sie nicht erlaubt sind.
* **Ordnernamen zeigen, was ein Ordner ist:** `sender-<name>` (Profil einer Fernbedienung), `receiver-<Name>`
  (Empfänger), `template-<name>` (Vorlage). Ordner aus älteren Versionen – auch von Hand hineinkopierte – werden beim
  Start umbenannt; aktive Profile bleiben aktiv.
* **Gesperrt beim Einlesen – aber nie die Bedienung vor Ort:** Beim Erkennen sperrt der Mapper nur
  fernbedienungsartige Geräte (X10/ati_remote, IR-Empfänger, HDMI-CEC); Tastaturen werden nur beobachtet, Mäuse und
  Touchscreens gar nicht geöffnet – ein Kiosk-Display bleibt bedienbar. Erkannt ist ein Gerät erst, wenn dieselbe
  Taste zweimal kommt (oder „Diese einlesen“ geklickt wird). Beim Einlesen ist nur dieses bestätigte Gerät gesperrt
  (mit Zeitlimit) – keine seiner Tasten, auch nicht die Ausschalttaste, löst etwas aus.
* **Mobile Remote** (Standard aus): eine Seite für das Handy auf eigenem Port (Standard 7812) mit 20 frei belegbaren
  Tasten, Titel/Interpret/Album aus Volumio, Lautstärke (− / Regler / +) und darunter vier fest belegten Tasten
  (zurück, Pause, Play, weiter – Volumios eigene Befehle), hell oder dunkel je nach Einstellung des
  Handys. Ganz oben stehen Hostname und IP-Adresse des Geräts. Über der Lautstärke kann ein eigenes Bild gezeigt
  werden (je eines für hell und dunkel); das Plugin liefert kein Bild mit, ohne Bild steht dort „Lautstärke“. Die Tasten werden auf einer eigenen Seite der Weboberfläche wie Fernbedienungstasten belegt: freie
  Triggerhappy-Taste aus der Liste (oder automatisch), eingebaute Aktion, Radiosender oder – im Expertenmodus – ein
  eigener Befehl. Der Handy-Port kann nichts konfigurieren: nur Zustand lesen, eine der 20 Tasten drücken, Lautstärke
  stellen. Ein Tastendruck läuft Plugin → Mapper (Unix-Socket, nur root/volumio) → virtuelle Taste → Triggerhappy.
* **Simulation:** Die Weboberfläche zeigt dieselbe Handy-Seite in einem Handy-Rahmen (hell/dunkel umschaltbar) –
  erreichbar aus den Plugin-Einstellungen, von der Startseite und von der Mobile-Remote-Seite. Es ist die echte Seite,
  alle Tasten funktionieren.
* **Triggerhappy-Tasten dürfen mehrfach gewählt werden.** Tasten mit demselben Befehl teilen sich die Taste und eine
  Befehlszeile; die erste Taste mit anderem Befehl behält die gewählte Taste, jede weitere bekommt intern eine
  virtuelle Taste – ein Druck löst nie zwei Befehle aus. Die Auswahlliste zeigt, wofür eine Taste im bearbeiteten
  Profil schon verwendet wird.
* **Ports:** Alle drei sind vorbelegt und in den Plugin-Einstellungen frei änderbar (1024–65535, untereinander
  verschieden): Weboberfläche 7810, Mobile-Remote-Seite 7812, interne Tastenereignisse 7811 (UDP, nur 127.0.0.1).
* **Gehaltene Tasten:** Eine Taste ohne Wiederholen löst beim Halten genau einmal aus. Neuer Druck erst, wenn der Code
  für die Entprellzeit nicht mehr kam (Standard 600 ms – `ati_remote` hält Wiederholungen 500 ms zurück). Bei
  IR-Empfängern (rc-core) gelten die reinen Scan-Code-Frames beim Halten als Wiederholung der erkannten Taste.
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
| Allgemein | Mapper an/aus, Entprellzeit, Wiederholintervall, ignorierte Scan-Codes, Watchdog (alle 5 Minuten, Standard aus), Tastendrücke protokollieren, Port |
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
* Triggerhappy öffnet Eingabegeräte nur beim eigenen Start; später angelegte bekommt es über seine udev-Regel gemeldet,
  worauf nicht überall Verlass ist. Der Mapper prüft deshalb (`/proc/<thd>/fd`), ob Triggerhappy die virtuelle Tastatur
  und jedes Passthrough-Gerät geöffnet hat, meldet ein fehlendes mit `th-cmd --passfd --add` an, und nur wenn das nicht
  hilft, startet das Plugin Triggerhappy neu (höchstens einmal pro Minute).
* Änderungen übernimmt Triggerhappy per **SIGHUP** (`systemctl kill -s HUP --kill-who=main triggerhappy.service`) –
  kein Neustart; laufende Befehle bekommen das Signal nicht.
* Das Plugin prüft, welchen `--triggers`-Pfad Triggerhappy wirklich verwendet. Zeigt ein anderes Plugin oder eine
  Änderung von Hand woandershin, meldet „Status anzeigen“ und die Weboberfläche das.
* **Triggerhappy exklusiv** (Expertenmodus, Standard aus): Bei der Installation wird dafür nichts angelegt. Erst beim
  Einschalten legt der root-Helfer `x10remote-thd-exclusive@on.service` eine **Laufzeit-Ergänzung**
  `/run/systemd/system/triggerhappy.service.d/x10remote-exclusive.conf` an, die nur den Ordner hinter `--triggers`
  auf `/run/x10remote/triggers.d` setzt (eigene Belegungen + Kopie der audio.conf-Zeilen). Überschreibt schon eine
  andere Ergänzung (z. B. vom Bluetooth-Remote-Plugin) `ExecStart`, verweigert der Helfer und nennt die Datei.
  Zurück bei Ausschalten, Deaktivieren, Deinstallieren und nach jedem Neustart (`/run` ist dann leer).

## Volumio-Regeln, Robustheit, Sicherheit

* Wirkung nur zwischen `onStart` und `onStop` (Mapper, Watchdog, Exklusivbetrieb, Weboberfläche, Erfassung); keine
  Dienste beim Systemstart aktiviert. `onStart` lehnt bei echten Fehlern ab.
* Protokoll nur über den Volumio-Logger (Präfix `X10Remote::`), kein `console.log`.
* `sudo` nur für `systemctl` (auch die kleinen root-Helfer `x10remote-fixperms.service`,
  `x10remote-thd-exclusive@.service` und der Watchdog; sie nehmen keine Eingaben entgegen).
* `install.sh` installiert nur fehlende Pakete (`python3-evdev`, `triggerhappy`, `curl`), überschreibt keine fremden
  Dateien, schreibt nichts nach `/volumio` und **bricht mit Fehler ab**, wenn `python3-evdev` oder Triggerhappy nicht
  installiert werden können. Der Mapper endet mit Code 78, wenn evdev oder `/dev/uinput` fehlen – systemd startet ihn
  dann nicht endlos neu. `uninstall.sh` entfernt nur eigene Dateien (Profile bleiben).
* **Watchdog** standardmäßig aus; eingeschaltet startet er nur abgestürzte Dienste neu, nie absichtlich gestoppte.
* Erster Start: Das X10-Standardprofil wird nur angelegt und aktiviert, wenn ein X10-Empfänger (0bc7:0006)
  angeschlossen ist; sonst bleibt „Volumio default – vanilla“ aktiv.
* Mehrsprachig nach Volumio-Vorgabe: `i18n/strings_<code>.json`, Englisch ist Pflicht und Rückfall; `UIConfig.json`
  nur mit `TRANSLATE.X10.*`. Meldungen, Dialoge und Weboberfläche folgen der Sprache von Volumio (ohne Neustart).
  Protokolle und erzeugte Systemdateien sind englisch.
* Weboberfläche ohne Root-Rechte: feste Dateiliste, strenge Prüfung aller Eingaben, Bilder per Dateisignatur geprüft,
  Größenlimits, JSON-Pflicht und Herkunftsprüfung für Schreibzugriffe, Content-Security-Policy ohne Inline-Skripte,
  atomares Schreiben.
* `/data/INTERNAL/X10` ist über die Freigabe „Internal Storage“ voll beschreibbar (Ordner 0777, Dateien 0666).
  Deshalb wird **alles, was von dort gelesen wird, bei jedem Einlesen geprüft** – nicht nur beim Speichern über die
  Weboberfläche. Eine von Hand geänderte `profile.json` durchläuft dieselbe Prüfung oder wird mit Protokollmeldung
  ignoriert. Zusätzlich entfernt der Schreiber der Triggerhappy-Datei alle Steuerzeichen (auch in Kommentaren) und
  akzeptiert nur `KEY_*`/`BTN_*`-Namen.

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
| `/etc/systemd/system/x10mapper.service`, `x10remote-watchdog.{service,timer}`, `x10remote-fixperms.service`, `x10remote-thd-exclusive@.service` | Dienste (nur vom Plugin gestartet) |
| `/run/systemd/system/triggerhappy.service.d/x10remote-exclusive.conf` | Laufzeit-Ergänzung, nur solange der Exklusivbetrieb an ist |
| `/usr/local/bin/x10mapper.py`, `x10remote-action`, `x10remote-radio`, `x10remote-watchdog`, `x10remote-fixperms`, `x10remote-thd-exclusive` | Programme |
| `/run/x10mapper-status.json`, `/run/x10remote/watchdog.log` | Status des Mappers, Meldungen des Watchdogs |

## Grenzen

66 gleichzeitig aktive virtuelle Tasten (`KEY_F13`–`KEY_F24`, `KEY_PROG1`–`4`, `KEY_FN_F1`–`12`,
`KEY_BRL_DOT1`–`8`, `KEY_MACRO1`–`30`; die letzten 30 nur, wenn `thd --listevents` sie nennt – sonst 36), 100 Tasten je Profil, 50 Profile, 6 Bilder je Profil, Befehle bis 2000 Zeichen.

## Fehlersuche

```sh
systemctl is-active x10mapper triggerhappy
journalctl -u x10mapper -n 50
curl -s http://localhost:7810/api/info
cat /run/x10mapper-status.json
cat /proc/$(systemctl show -p MainPID --value triggerhappy)/cmdline | tr '\0' ' '; echo   # welcher --triggers-Pfad
```

Gehaltene Tasten prüfen (mit „Tastendrücke protokollieren“): Taste eine Sekunde halten und die `Key:`-Zeilen zählen –
ohne Wiederholen genau eine:

```sh
journalctl -u x10mapper -f
```
