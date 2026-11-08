'use strict';

// Gemeinsame Konstanten des Plugins "X10 RF Remote"

var PLUGIN_TYPE = 'system_hardware';
var PLUGIN_NAME = 'x10remote';

module.exports = {
  PLUGIN_TYPE: PLUGIN_TYPE,
  PLUGIN_NAME: PLUGIN_NAME,
  ENDPOINT: PLUGIN_TYPE + '/' + PLUGIN_NAME,
  LOG_PREFIX: 'X10Remote::',

  SERVICE: 'x10mapper.service',
  MAPPER_BIN: '/usr/local/bin/x10mapper.py',
  ACTION_BIN: '/usr/local/bin/x10remote-action',
  MAPPER_STATUS: '/run/x10mapper-status.json',

  THD_DIR: '/etc/triggerhappy/triggers.d',
  THD_CONF_NAME: 'x10remote.conf',
  THD_SOCKET: '/run/thd.socket',

  // Exklusivbetrieb: Triggerhappy liest nur den Ordner des Plugins (audio.conf bleibt unveraendert, wird
  // aber nicht geladen). Die systemd-Ergaenzung legt install.sh an; wirksam nur solange THD_ENV existiert.
  // /run ist ein tmpfs: nach einem Neustart des Geraets startet Triggerhappy immer zuerst normal.
  THD_DROPIN: '/etc/systemd/system/triggerhappy.service.d/x10remote.conf',
  THD_ENV_VAR: 'X10_THD_TRIGGERS',
  RUN_DIR: '/run/x10remote',
  THD_ENV: '/run/x10remote/thd.env',
  EXCL_DIR: '/run/x10remote/triggers.d',
  EXCL_DELAY_DEFAULT: 10,

  // Watchdog (systemd-Timer alle 5 Minuten, laeuft nur zwischen onStart und onStop)
  WATCHDOG_TIMER: 'x10remote-watchdog.timer',
  MAPPER_WANTED: '/run/x10remote/mapper.wanted',
  WATCHDOG_LOG: '/run/x10remote/watchdog.log',
  WATCHDOG_LAST: '/run/x10remote/watchdog.last',
  EXCL_DELAY_MAX: 600,

  PROFILE_DIR: '/data/INTERNAL/X10',
  // /data/INTERNAL ist die SMB-Freigabe "Internal Storage" (Gastzugriff, schreibbar). Alles, was das Plugin
  // dort anlegt, muss auch fuer Windows-Gaeste beschreibbar sein.
  SHARE_DIR_MODE: 0o777,
  SHARE_FILE_MODE: 0o666,
  FIXPERMS_SERVICE: 'x10remote-fixperms.service',
  CMDREF_NAME: 'command reference.txt',   // Befehlsreferenz, liegt in PROFILE_DIR (vom Nutzer erweiterbar)
  CMDREF_TEMPLATE: 'command_reference_{lang}.txt', // Vorlagen je Sprache im Plugin (ohne Leerzeichen)
  CMDREF_MAX_BYTES: 512 * 1024,
  // SHA-256 frueherer, unveraenderter Vorlagen: diese werden bei einem Update durch die neue Vorlage ersetzt.
  // Vom Nutzer geaenderte Dateien bleiben immer unberuehrt.
  CMDREF_OLD_TEMPLATES: ['7b7cd31f8788d25174c8c5273aa4f44f7e52ad592f03922a4def4324e52baa4d',
    '0edbc0ad825371a8639e2cdda46cc7f44ef5439411b3c693cc2ad5b4e58d98c2'],
  RECEIVER_DIR: '_receivers',       // Empfaenger, Unterordner von PROFILE_DIR (kein gueltiger Profilname)
  PRESET_DIR: 'presets',             // mitgelieferte Vorlagen im Plugin-Ordner
  VANILLA_ID: 'vanilla',             // eingebautes Profil (nur audio.conf), wird nie gespeichert
  EXPORT_BASE: '/data/INTERNAL',

  DEFAULT_WEB_PORT: 7710,
  DEFAULT_EVENT_PORT: 7711,

  // Pool der virtuellen Tasten - identisch mit x10mapper.py
  VIRTUAL_KEYS: []
    .concat([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map(function (n) { return 'KEY_F' + n; }))
    .concat(['KEY_PROG1', 'KEY_PROG2', 'KEY_PROG3', 'KEY_PROG4'])
    .concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) { return 'KEY_FN_F' + n; }))
    .concat([1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return 'KEY_BRL_DOT' + n; })),

  // Aktionen von x10remote-action
  BUILTIN_ACTIONS: ['toggle', 'play', 'pause', 'stop', 'next', 'prev', 'volup', 'voldown',
    'mute', 'unmute', 'mutetoggle', 'random', 'repeat', 'clearqueue'],

  // Erlaubte Aktionen je Tastentyp
  //  scan: Taste liefert nur MSC_SCAN (Triggerhappy sieht sie nicht)
  //  key : Taste liefert bereits einen KEY_*-Code (Triggerhappy/audio.conf sieht sie)
  //        'default' = unveraendert lassen (audio.conf gilt), 'none' = Taste sperren
  ACTIONS_SCAN: ['none', 'toggle', 'play', 'pause', 'stop', 'next', 'prev', 'volup', 'voldown',
    'mute', 'unmute', 'mutetoggle', 'random', 'repeat', 'clearqueue', 'radio', 'custom'],
  ACTIONS_KEY: ['default', 'none', 'toggle', 'play', 'pause', 'stop', 'next', 'prev', 'volup', 'voldown',
    'mute', 'unmute', 'mutetoggle', 'random', 'repeat', 'clearqueue', 'radio', 'custom'],

  // Radiosender (Aktion "radio"): Daten im Profil, Katalog fuer x10remote-action und andere Plugins
  RADIO_CATALOG: 'radio-stations.json',
  RADIO_PRESETS: 'radiopresets.txt',
  RADIO_REPORT_PREFIX: 'webradio-check-',
  RADIO_BACKUP_DIR: '_backup',
  FAVOURITES_FILE: '/data/favourites/my-web-radio',

  // Rueckfall-Liste der Triggerhappy-Tasten, falls `thd --listevents` nicht verfuegbar ist.
  // Normalerweise liest das Plugin die vollstaendige Liste direkt von Triggerhappy.
  THD_BIN_CANDIDATES: ['/usr/sbin/thd', '/usr/bin/thd'],
  FALLBACK_THD_KEYS: ['KEY_OK', 'KEY_ENTER', 'KEY_SELECT', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT', 'KEY_BACK',
    'KEY_ESC', 'KEY_EXIT', 'KEY_HOME', 'KEY_MENU', 'KEY_INFO', 'KEY_PLAYPAUSE', 'KEY_PLAY', 'KEY_PAUSE', 'KEY_STOP',
    'KEY_STOPCD', 'KEY_PLAYCD', 'KEY_PAUSECD', 'KEY_NEXTSONG', 'KEY_PREVIOUSSONG', 'KEY_NEXT', 'KEY_PREVIOUS',
    'KEY_FASTFORWARD', 'KEY_REWIND', 'KEY_RECORD', 'KEY_EJECTCD', 'KEY_VOLUMEUP', 'KEY_VOLUMEDOWN', 'KEY_MUTE',
    'KEY_POWER', 'KEY_SLEEP', 'KEY_SHUFFLE', 'KEY_MEDIA_REPEAT', 'KEY_AUDIO', 'KEY_RADIO', 'KEY_TUNER', 'KEY_CD',
    'KEY_DVD', 'KEY_TV', 'KEY_FAVORITES', 'KEY_BOOKMARKS', 'KEY_PLAYER', 'KEY_RED', 'KEY_GREEN', 'KEY_YELLOW',
    'KEY_BLUE', 'KEY_CHANNELUP', 'KEY_CHANNELDOWN', 'KEY_PAGEUP', 'KEY_PAGEDOWN', 'KEY_SPACE',
    'KEY_0', 'KEY_1', 'KEY_2', 'KEY_3', 'KEY_4', 'KEY_5', 'KEY_6', 'KEY_7', 'KEY_8', 'KEY_9',
    'KEY_F1', 'KEY_F2', 'KEY_F3', 'KEY_F4', 'KEY_F5', 'KEY_F6', 'KEY_F7', 'KEY_F8', 'KEY_F9', 'KEY_F10', 'KEY_F11', 'KEY_F12'],

  LIMITS: {
    PROFILE_NAME: 80,
    DESCRIPTION: 4000,
    KEY_NAME: 60,
    REMOTE_LABEL: 40,
    KEY_DESCRIPTION: 200,
    COMMAND: 2000,
    KEYS_PER_PROFILE: 100,
    PROFILES: 50,
    RECEIVERS: 50,
    RECEIVERS_PER_PROFILE: 10,
    RADIO_URIS: 3,
    RADIO_NAME: 100,
    RADIO_URI: 2000,
    RADIO_TEXT: 40,
    RADIO_LOGO_BYTES: 512 * 1024,
    RADIO_CHECK_MS: 6000,
    IMAGE_SLOTS: 6,
    NOTES: 8000,
    IMAGE_BYTES: 6 * 1024 * 1024,
    BODY_BYTES: 256 * 1024,
    PROFILE_BODY_BYTES: 2 * 1024 * 1024,
    IMAGE_BODY_BYTES: 9 * 1024 * 1024,
    CAPTURE_SECONDS: 600,
    IDENTIFY_SECONDS: 60
  }
};
