'use strict';

// Shared constants of the plugin "X10 RF Remote"

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

  // Exclusive mode: Triggerhappy reads only the plugin's folder (audio.conf stays unchanged but is not
  // loaded). The systemd drop-in is created by the root helper x10remote-thd-exclusive@on only when the
  // mode is switched on - as a runtime drop-in in /run (gone after every reboot).
  EXCL_HELPER: '/usr/local/bin/x10remote-thd-exclusive',
  EXCL_UNIT_ON: 'x10remote-thd-exclusive@on.service',
  EXCL_UNIT_OFF: 'x10remote-thd-exclusive@off.service',
  EXCL_DROPIN: '/run/systemd/system/triggerhappy.service.d/x10remote-exclusive.conf',
  EXCL_RESULT: '/run/x10remote/exclusive.result',
  RUN_DIR: '/run/x10remote',
  EXCL_DIR: '/run/x10remote/triggers.d',
  EXCL_DELAY_DEFAULT: 10,
  THD_CHECK_MS: 5 * 60 * 1000,   // periodic re-check of how Triggerhappy was started (read-only)

  // watchdog (systemd timer every 5 minutes, runs only between onStart and onStop)
  WATCHDOG_TIMER: 'x10remote-watchdog.timer',
  MAPPER_WANTED: '/run/x10remote/mapper.wanted',
  WATCHDOG_LOG: '/run/x10remote/watchdog.log',
  WATCHDOG_LAST: '/run/x10remote/watchdog.last',
  EXCL_DELAY_MAX: 600,

  PROFILE_DIR: '/data/INTERNAL/X10',
  // /data/INTERNAL is the SMB share "Internal Storage" (guest access, writable). Everything the plugin
  // creates there must be writable for Windows guests as well.
  SHARE_DIR_MODE: 0o777,
  SHARE_FILE_MODE: 0o666,
  FIXPERMS_SERVICE: 'x10remote-fixperms.service',
  CMDREF_NAME: 'command reference.txt',   // command reference, lives in PROFILE_DIR (the user may extend it)
  CMDREF_TEMPLATE: 'command_reference_{lang}.txt', // templates per language in the plugin (no spaces in the name)
  CMDREF_MAX_BYTES: 512 * 1024,
  RECEIVER_DIR: '_receivers',       // receivers, subfolder of PROFILE_DIR (not a valid profile name)
  TEMPLATE_DIR: 'templates',         // templates shipped in the plugin folder (one folder template-<short name> per template)
  TEMPLATE_FILE: 'template.json',
  // prefix of the folders in /data/INTERNAL/X10 - shows in the file explorer what a folder contains
  SENDER_PREFIX: 'sender-',          // profile of a remote (profile.json)
  RECEIVER_PREFIX: 'receiver-',      // receiver (receiver.json)
  TEMPLATE_PREFIX: 'template-',      // profile saved as template (template.json)
  VANILLA_ID: 'vanilla',             // built-in profile (audio.conf only), never stored
  EXPORT_BASE: '/data/INTERNAL',

  // All ports are preset and can be changed in the settings (1024-65535, all different)
  DEFAULT_WEB_PORT: 7810,
  DEFAULT_EVENT_PORT: 7811,      // UDP, 127.0.0.1 only: events from the mapper to the plugin
  OLD_DEFAULT_PORTS: { web_port: 7710, mobile_port: 7720 },   // presets up to 0.61.0
  // Mobile Remote: separate phone page on its own port (off by default), its buttons form a pseudo device
  DEFAULT_MOBILE_PORT: 7812,
  MOBILE_ID: 'mobile-remote',                       // folder in /data/INTERNAL/X10
  MOBILE_NAME: 'Mobile Remote',
  MOBILE_DEVICE: 'name:X10Remote mobile remote',    // same as MOBILE_DEVICE in x10mapper.py
  MOBILE_BUTTONS: 20,                               // 5 rows x 4; same as MOBILE_BUTTONS in x10mapper.py
  INJECT_SOCKET: '/run/x10mapper.sock',             // same as INJECT_SOCKET in x10mapper.py
  DEFAULT_DEBOUNCE_MS: 600,   // > 500 ms: ati_remote (X10) holds repeats back for 500 ms

  // Pool of virtual keys - identical to x10mapper.py (order = order of assignment).
  // Every Triggerhappy knows the first 36. KEY_MACRO1-30 (kernel 5.5+) are added only if
  // `thd --listevents` lists them (triggers.listThdKeys -> pool); on Volumio 4 (Bookworm) it does.
  VIRTUAL_KEYS_BASE: 36,
  VIRTUAL_KEYS: []
    .concat([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map(function (n) { return 'KEY_F' + n; }))
    .concat(['KEY_PROG1', 'KEY_PROG2', 'KEY_PROG3', 'KEY_PROG4'])
    .concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) { return 'KEY_FN_F' + n; }))
    .concat([1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return 'KEY_BRL_DOT' + n; }))
    .concat(Array.apply(null, { length: 30 }).map(function (x, i) { return 'KEY_MACRO' + (i + 1); })),

  // actions of x10remote-action
  BUILTIN_ACTIONS: ['toggle', 'play', 'pause', 'stop', 'next', 'prev', 'volup', 'voldown',
    'mute', 'unmute', 'mutetoggle', 'random', 'repeat', 'clearqueue'],

  // allowed actions per key type
  //  scan: the key only delivers MSC_SCAN (Triggerhappy does not see it)
  //  key : the key already delivers a KEY_* code (Triggerhappy/audio.conf sees it)
  //        'default' = leave unchanged (audio.conf applies), 'none' = disable the key
  ACTIONS_SCAN: ['none', 'toggle', 'play', 'pause', 'stop', 'next', 'prev', 'volup', 'voldown',
    'mute', 'unmute', 'mutetoggle', 'random', 'repeat', 'clearqueue', 'radio', 'custom'],
  ACTIONS_KEY: ['default', 'none', 'toggle', 'play', 'pause', 'stop', 'next', 'prev', 'volup', 'voldown',
    'mute', 'unmute', 'mutetoggle', 'random', 'repeat', 'clearqueue', 'radio', 'custom'],

  // radio stations (action "radio"): data in the profile, catalogue for x10remote-action and other plugins
  RADIO_CATALOG: 'radio-stations.json',
  RADIO_PRESETS: 'radiopresets.txt',
  RADIO_REPORT_PREFIX: 'webradio-check-',
  RADIO_BACKUP_DIR: '_backup',
  FAVOURITES_FILE: '/data/favourites/my-web-radio',

  // Fallback list of Triggerhappy keys in case `thd --listevents` is not available.
  // Normally the plugin reads the complete list directly from Triggerhappy.
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
