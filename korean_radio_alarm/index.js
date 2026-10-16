'use strict';

var fs = require('fs-extra');
var path = require('path');
var libQ = require('kew');
var cron = require('node-cron');
var childProcess = require('child_process');
var VConf = require('v-conf');
var https = require('https');

var AlarmHelpers = require('./lib/alarm');

var PLUGIN_NAME = 'korean_radio_alarm';
var SOURCE_ID = 'korean_radio_alarm';
var SOURCE_URI = AlarmHelpers.SOURCE_URI || 'korean_radio_alarm://';
var STATION_URI_PREFIX = AlarmHelpers.STATION_URI_PREFIX || (SOURCE_URI + 'station/');
var BROWSE_SOURCE_NAME = 'Korean Radio Alarm';
var WEBRADIO_SERVICE = 'webradio';
var KBS_PLAY_API_URL_BASE = 'https://static.api.kbs.co.kr/play/1.2/live/channel/';
var KBS_PLAY_API_AUTHORIZATION = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwbGF0Zm9ybUlkIjoia2JzLWhvbWUiLCJ1c2VySWQiOiIiLCJkYXRhIjoiIiwic2NvcGUiOlsiZGVmYXVsdCIsImFkbWluIl0sInRva2VuRXhwaXJlVGltZSI6MjIyNDkxMTMwODIwM30.hb4K_Wn2ekzNO84xfAOrPnj2OyAeRt7HgSr2TzgQvJQ';
var STREAM_RESOLVER_CACHE_TTL_MS = 20 * 60 * 1000;
var WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
var ALARM_DEFAULT_ACTION = 'play';
var ALARM_SLOT_ID_REGEXP = /^alarm_(\d+)$/;
var ALARM_SLOT_FIELD_REGEXP = /^alarm_(\d+)_(.+)$/;

function KoreanRadioAlarm(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context && this.context.logger ? this.context.logger : {
    info: function () {},
    error: function () {}
  };
  this.configManager = this.context.configManager || new VConf();

  this.configFile = null;
  this.catalogFile = path.join(__dirname, 'radio_stations.json');
  this.catalog = { groups: [] };

  this.pluginName = PLUGIN_NAME;
  this.scheduledJobs = [];
  this._streamResolverCache = {};
  this._streamResolverInFlight = {};
  this.alarmConfig = null;
  this.i18n = null;
  this.mpdPlugin = null;
  this.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function safePromise(fn) {
  var defer = libQ.defer();
  var promise;

  try {
    promise = fn();

    if (promise && typeof promise.then === 'function') {
      promise.then(function (value) {
        defer.resolve(value);
      }).catch ? promise.catch(function (err) {
        defer.reject(err);
      }) : promise.fail(function (err) {
        defer.reject(err);
      });
    } else {
      defer.resolve(promise);
    }
  } catch (e) {
    defer.reject(e);
  }

  return defer.promise;
}

function callPluginMethod(context, methodName, args) {
  var defer = libQ.defer();
  var fn = context && context[methodName];

  if (typeof fn !== 'function') {
    defer.resolve(false);
    return defer.promise;
  }

  var consumed = false;
  var callbackCount = fn.length;

  try {
    if (callbackCount > (args ? args.length : 0)) {
      var cb = function (err, result) {
        if (consumed) {
          return;
        }
        consumed = true;
        if (err) {
          defer.reject(err);
        } else {
          defer.resolve(result);
        }
      };

      var invocationArgs = (args || []).concat([cb]);
      var ret = fn.apply(context, invocationArgs);
      if (ret && typeof ret.then === 'function') {
        if (typeof ret.catch === 'function') {
          ret.then(function (value) {
            if (!consumed) {
              consumed = true;
              defer.resolve(value);
            }
          }).catch(function (err) {
            if (!consumed) {
              consumed = true;
              defer.reject(err);
            }
          });
        } else {
          ret.then(function (value) {
            if (!consumed) {
              consumed = true;
              defer.resolve(value);
            }
          }).fail(function (err) {
            if (!consumed) {
              consumed = true;
              defer.reject(err);
            }
          });
        }
      }
    } else {
      var value = fn.apply(context, args || []);
      if (value && typeof value.then === 'function') {
        if (typeof value.catch === 'function') {
          value.then(function (result) {
            defer.resolve(result);
          }).catch(function (err) {
            defer.reject(err);
          });
        } else {
          value.then(function (result) {
            defer.resolve(result);
          }).fail(function (err) {
            defer.reject(err);
          });
        }
      } else {
        defer.resolve(value);
      }
    }
  } catch (e) {
    defer.reject(e);
  }

  return defer.promise;
}

function toLabel(value, width) {
  var str = String(value);
  while (str.length < width) {
    str = '0' + str;
  }
  return str;
}

function stripSlotIdPrefix(fieldId) {
  var match = ALARM_SLOT_FIELD_REGEXP.exec(fieldId);
  return match ? match[1] : '';
}

function alarmSlotLabelFor(slotId) {
  var numberPart = parseInt((slotId || '').split('_')[1], 10);
  if (!isNaN(numberPart) && numberPart >= 1 && numberPart <= 3) {
    return 'TRANSLATE.SECTION.ALARM_SLOT_' + numberPart;
  }

  return 'TRANSLATE.SECTION.ALARM_SLOT';
}

function buildAlarmSection(slotId, slotIndex, alarmConfig, stationOptions, hourOptions, minuteOptions, volumeOptions) {
  var keys = alarmSlotConfigKeys(slotId);
  var actionOptions = [
    { value: 'play', label: 'TRANSLATE.ALARM.ACTION_PLAY' },
    { value: 'stop', label: 'TRANSLATE.ALARM.ACTION_STOP' }
  ];

  return {
    id: 'alarm_settings_' + slotIndex,
    element: 'section',
    label: alarmSlotLabelFor(slotId),
    icon: 'fa-clock-o',
    onSave: {
      type: 'controller',
      endpoint: 'music_service/korean_radio_alarm',
      method: 'saveAlarm'
    },
    saveButton: {
      label: 'TRANSLATE.BUTTON.SAVE',
      data: [keys.enabled, keys.action, keys.hour, keys.minute, keys.station, keys.volume, keys.monday, keys.tuesday, keys.wednesday, keys.thursday, keys.friday, keys.saturday, keys.sunday]
    },
    content: [
      { type: 'boolean', element: 'switch', id: keys.enabled, label: 'TRANSLATE.ALARM.ENABLED', value: !!alarmConfig.alarm_enabled },
      {
        element: 'select',
        id: keys.action,
        label: 'TRANSLATE.ALARM.ACTION',
        value: alarmConfig.alarm_action || ALARM_DEFAULT_ACTION,
        options: actionOptions
      },
      { element: 'select', id: keys.hour, label: 'TRANSLATE.ALARM.HOUR', value: alarmConfig.alarm_hour, options: hourOptions },
      { element: 'select', id: keys.minute, label: 'TRANSLATE.ALARM.MINUTE', value: alarmConfig.alarm_minute, options: minuteOptions },
      { element: 'select', id: keys.station, label: 'TRANSLATE.ALARM.STATION', value: alarmConfig.alarm_station_uri, options: stationOptions },
      { element: 'select', id: keys.volume, label: 'TRANSLATE.ALARM.VOLUME', value: alarmConfig.alarm_volume, options: volumeOptions },
      { type: 'boolean', element: 'switch', id: keys.monday, label: 'TRANSLATE.WEEKDAY.MONDAY', value: !!alarmConfig.monday },
      { type: 'boolean', element: 'switch', id: keys.tuesday, label: 'TRANSLATE.WEEKDAY.TUESDAY', value: !!alarmConfig.tuesday },
      { type: 'boolean', element: 'switch', id: keys.wednesday, label: 'TRANSLATE.WEEKDAY.WEDNESDAY', value: !!alarmConfig.wednesday },
      { type: 'boolean', element: 'switch', id: keys.thursday, label: 'TRANSLATE.WEEKDAY.THURSDAY', value: !!alarmConfig.thursday },
      { type: 'boolean', element: 'switch', id: keys.friday, label: 'TRANSLATE.WEEKDAY.FRIDAY', value: !!alarmConfig.friday },
      { type: 'boolean', element: 'switch', id: keys.saturday, label: 'TRANSLATE.WEEKDAY.SATURDAY', value: !!alarmConfig.saturday },
      { type: 'boolean', element: 'switch', id: keys.sunday, label: 'TRANSLATE.WEEKDAY.SUNDAY', value: !!alarmConfig.sunday },
      {
        element: 'button',
        id: slotId + '_delete',
        label: 'TRANSLATE.BUTTON.DELETE_ALARM',
        onClick: {
          type: 'emit',
          message: 'callMethod',
          data: {
            endpoint: 'music_service/korean_radio_alarm',
            method: 'deleteAlarm',
            data: {
              slotId: slotId
            }
          }
        }
      }
    ]
  };
}

function streamResolverCacheKey(resolverType, channelId) {
  return resolverType + ':' + channelId;
}

function getSlotIdForKey(key) {
  var match = ALARM_SLOT_FIELD_REGEXP.exec(key);
  if (!match) {
    return null;
  }
  return 'alarm_' + match[1];
}

function isLegacyAlarmKey(key) {
  return key === 'alarm_enabled' || key === 'alarm_hour' || key === 'alarm_minute' || key === 'alarm_station_uri' || key === 'alarm_volume' || key === 'monday' || key === 'tuesday' || key === 'wednesday' || key === 'thursday' || key === 'friday' || key === 'saturday' || key === 'sunday';
}

function defaultAlarmConfig(alarmSlot, catalog) {
  var defaultStation = AlarmHelpers.firstStationUriFromCatalog(catalog) || '';
  return {
    alarm_enabled: false,
    alarm_action: ALARM_DEFAULT_ACTION,
    alarm_hour: 7,
    alarm_minute: 0,
    alarm_station_uri: defaultStation,
    alarm_volume: 45,
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false
  };
}

function defaultAlarmConfigForMigration(slotId, catalog) {
  var defaults = defaultAlarmConfig(slotId, catalog);
  if (slotId === 'alarm_1') {
    return defaults;
  }

  return {
    alarm_enabled: false,
    alarm_action: ALARM_DEFAULT_ACTION,
    alarm_hour: defaults.alarm_hour,
    alarm_minute: defaults.alarm_minute,
    alarm_station_uri: defaults.alarm_station_uri,
    alarm_volume: defaults.alarm_volume,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false
  };
}

function normalizeAlarmSlotId(slotId) {
  var candidate = String(slotId || '').trim();
  var match = ALARM_SLOT_ID_REGEXP.exec(candidate);
  if (match) {
    return 'alarm_' + match[1];
  }

  if (/^\d+$/.test(candidate)) {
    return 'alarm_' + parseInt(candidate, 10);
  }

  return null;
}

function buildActionValue(value) {
  var action = typeof value === 'string' ? value : (value === null || value === undefined ? '' : String(value));
  if (action === 'play' || action === 'stop') {
    return action;
  }
  return ALARM_DEFAULT_ACTION;
}

function parseAlarmIds(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return [];
  }

  var valueAsString = String(value).trim();
  if (valueAsString.length === 0) {
    return [];
  }

  return valueAsString.split(',').map(function (part) {
    return part.trim();
  }).filter(function (part) {
    return part.length > 0;
  });
}

function normalizeAlarmSlotIds(values) {
  var dedup = {};
  var normalized = [];

  (values || []).forEach(function (value) {
    var slotId = normalizeAlarmSlotId(value);
    if (!slotId) {
      return;
    }

    if (dedup[slotId]) {
      return;
    }

    dedup[slotId] = true;
    normalized.push(slotId);
  });

  normalized.sort(function (a, b) {
    var aNum = parseInt(a.split('_')[1], 10);
    var bNum = parseInt(b.split('_')[1], 10);
    return aNum - bNum;
  });

  return normalized;
}

function alarmSlotConfigKeys(slotId) {
  return {
    enabled: slotId + '_enabled',
    action: slotId + '_action',
    hour: slotId + '_hour',
    minute: slotId + '_minute',
    station: slotId + '_station_uri',
    volume: slotId + '_volume',
    monday: slotId + '_monday',
    tuesday: slotId + '_tuesday',
    wednesday: slotId + '_wednesday',
    thursday: slotId + '_thursday',
    friday: slotId + '_friday',
    saturday: slotId + '_saturday',
    sunday: slotId + '_sunday'
  };
}

function readJsonOrDefault(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readJsonSync(filePath);
    }
  } catch (e) {
    return fallback;
  }

  return fallback;
}

function resolveLanguageCode(commandRouter) {
  var sharedVars = commandRouter && commandRouter.sharedVars ? commandRouter.sharedVars : null;
  if (sharedVars) {
    var sharedLanguage;
    if (typeof sharedVars.get === 'function') {
      sharedLanguage = sharedVars.get('language_code');
    } else if (typeof sharedVars.language_code === 'string') {
      sharedLanguage = sharedVars.language_code;
    }

    if (typeof sharedLanguage === 'string' && sharedLanguage.length > 0) {
      return sharedLanguage;
    }
  }

  var lang = commandRouter && commandRouter.getLanguage ? commandRouter.getLanguage() : null;
  if (typeof lang === 'string' && lang.length > 0) {
    return lang;
  }

  return 'en';
}

function addBrowseSource(context, source) {
  if (!context) {
    return null;
  }

  if (typeof context.addToBrowseSources === 'function') {
    return context.addToBrowseSources(source);
  }

  if (typeof context.volumioAddToBrowseSources === 'function') {
    return context.volumioAddToBrowseSources(source);
  }

  return null;
}

function removeBrowseSource(context, sourceUri) {
  if (!context) {
    return null;
  }

  if (typeof context.removeBrowseSource === 'function') {
    return context.removeBrowseSource(sourceUri);
  }

  if (typeof context.volumioRemoveBrowseSource === 'function') {
    return context.volumioRemoveBrowseSource(sourceUri);
  }

  if (typeof context.volumioRemoveBrowseSources === 'function') {
    return context.volumioRemoveBrowseSources(sourceUri);
  }

  if (typeof context.removeFromBrowseSources === 'function') {
    return context.removeFromBrowseSources(sourceUri);
  }

  return null;
}

KoreanRadioAlarm.prototype.onVolumioStart = function () {
  var configFile = null;

  if (this.commandRouter && this.commandRouter.pluginManager && typeof this.commandRouter.pluginManager.getConfigurationFile === 'function') {
    configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  }

  this.configFile = configFile || path.join(__dirname, 'config.json');
  this.configManager = new VConf();
  this.configManager.loadFile(this.configFile);

  this._loadCatalog();
  return libQ.resolve();
};

KoreanRadioAlarm.prototype.onStart = function () {
  var self = this;

  this._loadCatalog();

  return this._loadI18n()
    .then(function () {
      if (self.commandRouter && self.commandRouter.pluginManager && typeof self.commandRouter.pluginManager.getPlugin === 'function') {
        self.mpdPlugin = self.commandRouter.pluginManager.getPlugin('music_service', 'mpd');
      }

      self._addBrowseSource();
      self._rescheduleAlarm();
      safePromise(function () {
        return self._warmUpStreamResolverCache();
      }).fail(function (err) {
        if (self.logger && typeof self.logger.error === 'function') {
          var message = err && err.message ? err.message : 'Unknown error';
          self.logger.error('KBS stream resolver warm-up failed: ' + message);
        }
      });
    });
};

KoreanRadioAlarm.prototype.onStop = function () {
  this._clearScheduledJobs();
  this._removeBrowseSource();
  return libQ.resolve();
};

KoreanRadioAlarm.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

KoreanRadioAlarm.prototype.getUIConfig = function () {
  var self = this;
  var lang = resolveLanguageCode(this.commandRouter);

  return safePromise(function () {
    if (!self.commandRouter || typeof self.commandRouter.i18nJson !== 'function') {
      return readJsonOrDefault(path.join(__dirname, 'UIConfig.json'), {});
    }

    var requested = path.join(__dirname, 'i18n', 'strings_' + lang + '.json');
    var fallback = path.join(__dirname, 'i18n', 'strings_en.json');
    return self.commandRouter.i18nJson(requested, fallback, path.join(__dirname, 'UIConfig.json'));
  }).then(function (uiConfig) {
    if (!uiConfig || !uiConfig.sections || !Array.isArray(uiConfig.sections)) {
      return uiConfig;
    }

    var alarmIds = self._getStoredAlarmIds();
    var stationOptions = AlarmHelpers.stationOptionsFromCatalog(self.catalog);
    var hourOptions = [];
    for (var h = 0; h <= 23; h++) {
      hourOptions.push({ value: h, label: toLabel(h, 2) });
    }

    var minuteOptions = [];
    for (var m = 0; m <= 59; m++) {
      minuteOptions.push({ value: m, label: toLabel(m, 2) });
    }

    var volumeOptions = [];
    for (var v = 0; v <= 100; v += 5) {
      volumeOptions.push({ value: v, label: String(v) });
    }

    var builtSections = [];
    uiConfig.sections.forEach(function (section) {
      if (!section) {
        return;
      }

      if (section.id === 'alarm_actions') {
        builtSections.push(section);
      }
    });

    alarmIds.forEach(function (slotId, index) {
      var alarmConfig = self._getStoredAlarmConfig(slotId);
      builtSections.push(buildAlarmSection(slotId, index + 1, alarmConfig, stationOptions, hourOptions, minuteOptions, volumeOptions));
    });

    uiConfig.sections = builtSections;
    return uiConfig;
  });
};

KoreanRadioAlarm.prototype.saveAlarm = function (data) {
  var self = this;
  data = data || {};
  if (data.value && typeof data.value === 'object') {
    data = data.value;
  }

  var slotId = this._extractSlotIdFromPayload(data);
  if (!slotId) {
    slotId = 'alarm_1';
  }

  var storedAlarmIds = this._getStoredAlarmIds();

  var prefix = slotId + '_';
  var existing = this._getStoredAlarmConfig(slotId);
  var useLegacyPayload = slotId === 'alarm_1' &&
    (Object.prototype.hasOwnProperty.call(data, 'alarm_enabled') ||
      Object.prototype.hasOwnProperty.call(data, 'alarm_hour') ||
      Object.prototype.hasOwnProperty.call(data, 'alarm_minute') ||
      Object.prototype.hasOwnProperty.call(data, 'alarm_station_uri') ||
      Object.prototype.hasOwnProperty.call(data, 'alarm_volume') ||
      Object.prototype.hasOwnProperty.call(data, 'monday') ||
      Object.prototype.hasOwnProperty.call(data, 'tuesday') ||
      Object.prototype.hasOwnProperty.call(data, 'wednesday') ||
      Object.prototype.hasOwnProperty.call(data, 'thursday') ||
      Object.prototype.hasOwnProperty.call(data, 'friday') ||
      Object.prototype.hasOwnProperty.call(data, 'saturday') ||
      Object.prototype.hasOwnProperty.call(data, 'sunday'));

  var stationUri = this._normalizeStationValue(useLegacyPayload ? data.alarm_station_uri : data[prefix + 'station_uri']);
  var station = stationUri ? AlarmHelpers.findStationByUri(this.catalog, stationUri) : null;

  var setEnabled = Object.prototype.hasOwnProperty.call(data, prefix + 'enabled') ||
    (useLegacyPayload && Object.prototype.hasOwnProperty.call(data, 'alarm_enabled'));
  var setHour = Object.prototype.hasOwnProperty.call(data, prefix + 'hour') ||
    (useLegacyPayload && Object.prototype.hasOwnProperty.call(data, 'alarm_hour'));
  var setMinute = Object.prototype.hasOwnProperty.call(data, prefix + 'minute') ||
    (useLegacyPayload && Object.prototype.hasOwnProperty.call(data, 'alarm_minute'));
  var setVolume = Object.prototype.hasOwnProperty.call(data, prefix + 'volume') ||
    (useLegacyPayload && Object.prototype.hasOwnProperty.call(data, 'alarm_volume'));
  var setStation = Object.prototype.hasOwnProperty.call(data, prefix + 'station_uri') ||
    (useLegacyPayload && Object.prototype.hasOwnProperty.call(data, 'alarm_station_uri'));
  var setAction = Object.prototype.hasOwnProperty.call(data, prefix + 'action');

  var enabled = this._normalizeBooleanValue(setEnabled ? (useLegacyPayload ? data.alarm_enabled : data[prefix + 'enabled']) : existing.alarm_enabled);
  var hour = AlarmHelpers.normalizeSelectValue(setHour ? (useLegacyPayload ? data.alarm_hour : data[prefix + 'hour']) : existing.alarm_hour, 0, 23, 1, existing.alarm_hour);
  var minute = AlarmHelpers.normalizeSelectValue(setMinute ? (useLegacyPayload ? data.alarm_minute : data[prefix + 'minute']) : existing.alarm_minute, 0, 59, 1, existing.alarm_minute);
  var volume = AlarmHelpers.normalizeSelectValue(setVolume ? (useLegacyPayload ? data.alarm_volume : data[prefix + 'volume']) : existing.alarm_volume, 0, 100, 5, existing.alarm_volume);
  var action = buildActionValue(setAction ? data[prefix + 'action'] : existing.alarm_action);
  var weekdays = this._getWeekdayValuesFromPayload(slotId, data, existing);

  if (!station) {
    station = { uri: existing.alarm_station_uri };
    if (setStation) {
      var noStation = this._t('ALARM.NO_STATION', 'No valid station');
      this._pushToast('error', this._t('ALARM.TITLE', 'Korean Radio Alarm'), noStation);
      return libQ.reject(new Error(noStation));
    }
  }

  if ((setHour || setMinute || setEnabled || setVolume || setStation) && (!AlarmHelpers.isValidTime(hour, minute) || volume === null)) {
    var msg = this._t('ALARM.SAVE_ERROR', this._t('ALARM.SAVE_ERROR', 'Failed to save alarm settings'));
    this._pushToast('error', this._t('ALARM.TITLE', 'Korean Radio Alarm'), msg);
    return libQ.reject(new Error(msg));
  }

  if (storedAlarmIds.indexOf(slotId) === -1) {
    this._saveAlarmIdList(storedAlarmIds.concat([slotId]));
  }

  if (setEnabled) {
    this.configManager.set(prefix + 'enabled', !!enabled);
  }
  if (setHour) {
    this.configManager.set(prefix + 'hour', hour);
  }
  if (setMinute) {
    this.configManager.set(prefix + 'minute', minute);
  }
  if (setVolume) {
    this.configManager.set(prefix + 'volume', volume);
  }
  if (setAction) {
    this.configManager.set(prefix + 'action', action);
  }
  if (setStation) {
    this.configManager.set(prefix + 'station_uri', station.uri || stationUri);
  }

  WEEKDAY_KEYS.forEach(function (weekday) {
    var field = prefix + weekday;
    var legacyField = weekday;

    if (Object.prototype.hasOwnProperty.call(data, field)) {
      self.configManager.set(field, self._normalizeBooleanValue(data[field]));
      return;
    }

    if (slotId === 'alarm_1' && Object.prototype.hasOwnProperty.call(data, legacyField)) {
      self.configManager.set(field, self._normalizeBooleanValue(data[legacyField]));
    }
  });

  this._persistConfig();
  this.alarmConfig = this._getStoredAlarmConfig(slotId);
  this._rescheduleAlarm();
  this._pushToast('success', this._t('ALARM.TITLE', 'Korean Radio Alarm'), this._t('ALARM.SAVE_SUCCESS', 'Alarm settings saved and rescheduled'));

  return libQ.resolve({
    success: true,
    slot: slotId,
    alarm: this.alarmConfig
  });
};

KoreanRadioAlarm.prototype.addAlarm = function () {
  var slotIds = this._getStoredAlarmIds();
  var nextSlotId = this._getNextAvailableAlarmId(slotIds);
  var slotConfig = defaultAlarmConfig(nextSlotId, this.catalog);
  var keys = alarmSlotConfigKeys(nextSlotId);

  this.configManager.set(keys.enabled, this._normalizeBooleanValue(slotConfig.alarm_enabled));
  this.configManager.set(keys.action, slotConfig.alarm_action);
  this.configManager.set(keys.hour, slotConfig.alarm_hour);
  this.configManager.set(keys.minute, slotConfig.alarm_minute);
  this.configManager.set(keys.station, slotConfig.alarm_station_uri);
  this.configManager.set(keys.volume, slotConfig.alarm_volume);
  this.configManager.set(keys.monday, this._normalizeBooleanValue(slotConfig.monday));
  this.configManager.set(keys.tuesday, this._normalizeBooleanValue(slotConfig.tuesday));
  this.configManager.set(keys.wednesday, this._normalizeBooleanValue(slotConfig.wednesday));
  this.configManager.set(keys.thursday, this._normalizeBooleanValue(slotConfig.thursday));
  this.configManager.set(keys.friday, this._normalizeBooleanValue(slotConfig.friday));
  this.configManager.set(keys.saturday, this._normalizeBooleanValue(slotConfig.saturday));
  this.configManager.set(keys.sunday, this._normalizeBooleanValue(slotConfig.sunday));

  this._saveAlarmIdList(slotIds.concat([nextSlotId]));
  this._persistConfig();
  this._rescheduleAlarm();
  this._pushToast('success', this._t('ALARM.TITLE', 'Korean Radio Alarm'), this._t('ALARM.ADD_SUCCESS', 'Alarm added successfully'));

  return libQ.resolve({
    success: true,
    slot: nextSlotId,
    alarmIds: this._getStoredAlarmIds()
  });
};

KoreanRadioAlarm.prototype.deleteAlarm = function (data) {
  data = data || {};
  var slotId = this._extractSlotIdFromPayload(data);
  if (!slotId) {
    var missing = this._t('ALARM.DELETE_MISSING_SLOT', 'No slot provided');
    this._pushToast('error', this._t('ALARM.TITLE', 'Korean Radio Alarm'), missing);
    return libQ.reject(new Error(missing));
 }

  var alarmIds = this._getStoredAlarmIds().filter(function (value) {
    return value !== slotId;
  });
  this._saveAlarmIdList(alarmIds);

  var keys = alarmSlotConfigKeys(slotId);
  if (typeof this.configManager.delete === 'function') {
    Object.keys(keys).forEach(function (key) {
      this.configManager.delete(keys[key]);
    }, this);
  } else {
    this._setDefaultConfigForSlot(slotId);
  }

  this._persistConfig();
  this._rescheduleAlarm();
  this._pushToast('success', this._t('ALARM.TITLE', 'Korean Radio Alarm'), this._t('ALARM.DELETE_SUCCESS', 'Alarm deleted successfully'));

  return libQ.resolve({
    success: true,
    slot: slotId,
    alarmIds: alarmIds
  });
};

KoreanRadioAlarm.prototype.explodeUri = function (uri) {
  var station = AlarmHelpers.findStationByUri(this.catalog, uri);
  if (!station) {
    return libQ.reject(new Error('Invalid uri'));
  }

  return this._resolveStationStreamUrl(station).then(function (resolvedStreamUrl) {
    var stationUri = station.uri || (STATION_URI_PREFIX + station.id);
    var track = {
      service: 'mpd',
      type: 'track',
      stationUri: stationUri,
      trackType: 'webradio',
      duration: 0,
      isStreaming: true,
      album: station.name,
      artist: station.name,
      uri: resolvedStreamUrl,
      realUri: resolvedStreamUrl,
      path: resolvedStreamUrl,
      name: station.name,
      title: station.name
    };

    return [track];
  });
};

KoreanRadioAlarm.prototype.handleBrowseUri = function (uri) {
  uri = uri || SOURCE_URI;

  if (uri === SOURCE_URI) {
    return this._buildRootNavigation();
  }

  if (uri.indexOf(SOURCE_URI + 'group/') === 0) {
    var groupId = decodeURIComponent(uri.substring((SOURCE_URI + 'group/').length));
    return this._buildGroupNavigation(groupId);
  }

  return this._buildRootNavigation();
};

KoreanRadioAlarm.prototype._stopPlayback = function () {
  var self = this;
  var stopPromise = null;

  if (this.mpdPlugin && typeof this.mpdPlugin.sendMpdCommand === 'function') {
    stopPromise = callPluginMethod(this.mpdPlugin, 'sendMpdCommand', ['stop', []]);
  } else if (this.commandRouter) {
    if (typeof this.commandRouter.volumioStop === 'function') {
      stopPromise = callPluginMethod(this.commandRouter, 'volumioStop', []);
    } else if (typeof this.commandRouter.stop === 'function') {
      stopPromise = callPluginMethod(this.commandRouter, 'stop', []);
    } else {
      stopPromise = libQ.resolve(false);
    }
  } else {
    stopPromise = libQ.resolve(false);
  }

  return stopPromise.then(function () {
    if (!self.commandRouter || !self.commandRouter.stateMachine || typeof self.commandRouter.stateMachine.syncState !== 'function') {
      return libQ.resolve();
    }

    var currentState = {
      service: 'mpd',
      status: 'stop',
      title: '',
      album: '',
      artist: '',
      uri: '',
      path: '',
      trackType: 'webradio',
      isStreaming: false,
      duration: 0,
      stationUri: '',
      pluginUri: ''
    };

    if (!self.mpdPlugin || typeof self.mpdPlugin.getState !== 'function') {
      return callPluginMethod(self.commandRouter.stateMachine, 'syncState', [currentState, 'mpd']);
    }

    return callPluginMethod(self.mpdPlugin, 'getState', [])
      .then(function (state) {
        if (!state) {
          state = currentState;
        } else {
          currentState.service = state.service || currentState.service;
          currentState.status = state.status || currentState.status;
          currentState.uri = state.uri || currentState.uri;
          currentState.path = state.path || currentState.path;
          currentState.title = state.title || currentState.title;
          currentState.trackType = state.trackType || currentState.trackType;
          currentState.duration = typeof state.duration === 'number' ? state.duration : currentState.duration;
          currentState.album = state.album || currentState.album;
          currentState.artist = state.artist || currentState.artist;
          if (state.stationUri) {
            currentState.stationUri = state.stationUri;
          }
          if (state.pluginUri) {
            currentState.pluginUri = state.pluginUri;
          }

          currentState.status = 'stop';
          currentState.isStreaming = false;

          return currentState;
        }

        return currentState;
      })
      .fail(function () {
        return currentState;
      })
      .then(function (state) {
        state.status = 'stop';
        state.isStreaming = false;
        return callPluginMethod(self.commandRouter.stateMachine, 'syncState', [state, state.service || 'mpd']);
      });
  });
};

KoreanRadioAlarm.prototype.clearAddPlayTrack = function (track) {
  if (!this.mpdPlugin) {
    var noMpd = this._t('ALARM.NO_MPD', 'MPD is unavailable');
    this._pushToast('error', this._t('ALARM.TITLE', 'Korean Radio Alarm'), noMpd);
    return libQ.reject(new Error(noMpd));
  }

  var playTrack = track;
  if (!playTrack || typeof playTrack !== 'object') {
    return libQ.reject(new Error(this._t('ALARM.NO_URI', 'No track URI')));
  }

  var hasUri = typeof playTrack.uri === 'string' && playTrack.uri.length > 0;
  var hasRealUri = typeof playTrack.realUri === 'string' && playTrack.realUri.length > 0;

  if (!hasUri && !hasRealUri) {
    return libQ.reject(new Error(this._t('ALARM.NO_URI', 'No track URI')));
  }

  var self = this;
  var serviceName = typeof playTrack.service === 'string' && playTrack.service.length > 0 ? playTrack.service : PLUGIN_NAME;
  var syncService = serviceName === PLUGIN_NAME || serviceName === WEBRADIO_SERVICE ? 'mpd' : serviceName;

  return self._preparePlayTrackForPlayback(playTrack)
    .then(function (preparedTrack) {
      playTrack = preparedTrack;

      if (!playTrack.realUri) {
        playTrack.realUri = playTrack.uri;
      }

      return callPluginMethod(self.mpdPlugin, 'sendMpdCommand', ['stop', []]);
    })
    .then(function () {
      return callPluginMethod(self.mpdPlugin, 'sendMpdCommand', ['clear', []]);
    })
    .then(function () {
      return callPluginMethod(self.mpdPlugin, 'sendMpdCommand', ['add "' + playTrack.realUri + '"', []]);
    })
    .then(function () {
      return callPluginMethod(self.mpdPlugin, 'sendMpdCommand', ['play', []]);
    })
    .then(function () {
      if (!self.commandRouter.stateMachine || typeof self.commandRouter.stateMachine.syncState !== 'function') {
        return true;
      }

      if (typeof self.mpdPlugin.getState !== 'function') {
        return true;
      }

      return callPluginMethod(self.mpdPlugin, 'getState', []).then(function (state) {
        if (!state) {
          return true;
        }

        state.service = syncService;
        state.title = playTrack.name || playTrack.title || state.title;
        if (syncService === 'mpd') {
          state.uri = playTrack.realUri || playTrack.uri || state.uri;
        } else {
          state.uri = playTrack.uri || playTrack.realUri || state.uri;
        }
        state.path = playTrack.realUri || playTrack.path || state.path;
        state.trackType = playTrack.trackType || 'webradio';
        state.isStreaming = playTrack.isStreaming !== undefined ? playTrack.isStreaming : true;
        state.duration = typeof playTrack.duration === 'number' ? playTrack.duration : 0;
        if (playTrack.stationUri) {
          state.stationUri = playTrack.stationUri;
        } else if (playTrack.pluginUri) {
          state.stationUri = playTrack.pluginUri;
        } else if (typeof playTrack.uri === 'string' && playTrack.uri.indexOf(SOURCE_URI) === 0) {
          state.stationUri = playTrack.uri;
        }

        if (playTrack.pluginUri) {
          state.pluginUri = playTrack.pluginUri;
        } else if (playTrack.stationUri) {
          state.pluginUri = playTrack.stationUri;
        }
        if (!state.album) {
          state.album = playTrack.album || playTrack.name;
        }
        if (!state.artist) {
          state.artist = playTrack.artist || playTrack.name;
        }

        return callPluginMethod(self.commandRouter.stateMachine, 'syncState', [state, syncService]);
      });
    });
};

KoreanRadioAlarm.prototype._preparePlayTrackForPlayback = function (track) {
  var self = this;

  if (!track) {
    return libQ.reject(new Error(this._t('ALARM.NO_URI', 'No track URI')));
  }

  var hasUri = typeof track.uri === 'string' && track.uri.length > 0;
  var hasRealUri = typeof track.realUri === 'string' && track.realUri.length > 0;

  if (!hasUri && !hasRealUri) {
    return libQ.reject(new Error(this._t('ALARM.NO_URI', 'No track URI')));
  }

  var shouldResolve = typeof track.uri === 'string' &&
    track.uri.indexOf(STATION_URI_PREFIX) === 0 &&
    (!hasRealUri || track.realUri === track.uri);

  if (!shouldResolve) {
    return libQ.resolve(track);
  }

  var station = AlarmHelpers.findStationByUri(this.catalog, track.uri);
  if (!station) {
    return libQ.resolve(track);
  }

  return this._resolveStationStreamUrl(station).then(function (resolvedStreamUrl) {
    track.realUri = resolvedStreamUrl;
    track.path = resolvedStreamUrl;
    return track;
  });
};

KoreanRadioAlarm.prototype._onAlarmFire = function (slotId) {
  var self = this;
  var alarmConfig = this._getStoredAlarmConfig(slotId || 'alarm_1');
  if (!alarmConfig || !alarmConfig.alarm_enabled) {
    return libQ.resolve(false);
  }

  if ((alarmConfig.alarm_action || ALARM_DEFAULT_ACTION) === 'stop') {
    return this._stopPlayback();
  }

  var station = AlarmHelpers.findStationByUri(this.catalog, alarmConfig.alarm_station_uri);
  if (!station) {
    this._pushToast('error', this._t('ALARM.TITLE', 'Korean Radio Alarm'), this._t('ALARM.NO_STATION', 'No valid station'));
    return libQ.resolve(false);
  }

  return this._setAlarmVolume(alarmConfig.alarm_volume)
    .then(function () {
      return self.explodeUri(station.uri || (STATION_URI_PREFIX + station.id));
    })
    .then(function (tracks) {
      if (!Array.isArray(tracks) || tracks.length === 0) {
        return libQ.reject(new Error(self._t('ALARM.NO_URI', 'No track URI')));
      }
      return self.clearAddPlayTrack(tracks[0]);
    });
};

KoreanRadioAlarm.prototype._loadI18n = function () {
  var self = this;
  var lang = resolveLanguageCode(this.commandRouter);
  var requested = path.join(__dirname, 'i18n', 'strings_' + lang + '.json');
  var fallback = path.join(__dirname, 'i18n', 'strings_en.json');

  var i18n = readJsonOrDefault(requested, null);
  if (!i18n || typeof i18n !== 'object') {
    i18n = readJsonOrDefault(fallback, {});
  }

  if (!i18n || typeof i18n !== 'object') {
    i18n = {};
  }

  self.i18n = i18n;
  return libQ.resolve(self.i18n);
};

KoreanRadioAlarm.prototype._t = function (path, fallback) {
  if (!this.i18n || !path) {
    return fallback || path;
  }

  var value = this.i18n;
  var parts = path.split('.');

  for (var i = 0; i < parts.length; i++) {
    if (!value || typeof value !== 'object' || !(parts[i] in value)) {
      return fallback || path;
    }
    value = value[parts[i]];
  }

  if (value === undefined || value === null) {
    return fallback || path;
  }

  return value;
};

KoreanRadioAlarm.prototype._pushToast = function (type, title, message) {
  if (!this.commandRouter || typeof this.commandRouter.pushToastMessage !== 'function') {
    return;
  }

  this.commandRouter.pushToastMessage(type, title, message);
};

KoreanRadioAlarm.prototype._unwrapConfigValue = function (value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'object' && value !== null && value.value !== undefined) {
    return this._unwrapConfigValue(value.value);
  }

  return value;
};

KoreanRadioAlarm.prototype._extractSlotIdFromPayload = function (data) {
  var directSlot = function (candidate) {
    return normalizeAlarmSlotId(candidate || '');
  };

  if (typeof data === 'string') {
    return directSlot(data);
  }

  var slotId = null;
  if (data && Object.prototype.hasOwnProperty.call(data, 'slotId')) {
    slotId = directSlot(data.slotId);
  }

  if (!slotId && data && data.value && typeof data.value === 'string') {
    slotId = directSlot(data.value);
  }

  if (!slotId && data && data.value && typeof data.value === 'object' && !Array.isArray(data.value)) {
    slotId = directSlot(data.value.slotId);
  }

  if (!slotId && data && data.value && typeof data.value === 'object' && !Array.isArray(data.value)) {
    var payloadKeys = Object.keys(data.value);
    for (var j = 0; j < payloadKeys.length; j++) {
      var payloadKey = payloadKeys[j];
      var valueMatch = ALARM_SLOT_FIELD_REGEXP.exec(payloadKey);
      if (valueMatch) {
        return 'alarm_' + valueMatch[1];
      }
    }
  }

  var keys = Object.keys(data || {});
  keys.forEach(function (key) {
    if (isLegacyAlarmKey(key)) {
      slotId = 'alarm_1';
      return;
    }

    var match = ALARM_SLOT_FIELD_REGEXP.exec(key);
    if (match) {
      slotId = 'alarm_' + match[1];
    }
  });

  return slotId;
};

KoreanRadioAlarm.prototype._getStoredAlarmIds = function () {
  var raw = this.configManager && typeof this.configManager.get === 'function' ? this.configManager.get('alarm_ids', undefined) : undefined;
  var explicitAlarmIds = false;

  if (this.configManager && typeof this.configManager.getKeys === 'function') {
    try {
      var allKeys = this.configManager.getKeys();
      if (Array.isArray(allKeys) && allKeys.indexOf('alarm_ids') >= 0) {
        explicitAlarmIds = true;
      }
    } catch (e) {}
  } else if (raw !== undefined) {
    explicitAlarmIds = true;
  }

  if (explicitAlarmIds) {
    return normalizeAlarmSlotIds(parseAlarmIds(raw));
  }

  var discovered = this._discoverAlarmIdsFromKeys();
  var meaningful = [];
  var i;
  for (i = 0; i < discovered.length; i++) {
    if (discovered[i] === 'alarm_1') {
      continue;
    }

    if (this._hasMeaningfulSlotConfigValues(discovered[i])) {
      meaningful.push(discovered[i]);
    }
  }

  return normalizeAlarmSlotIds(['alarm_1'].concat(meaningful));
};

KoreanRadioAlarm.prototype._discoverAlarmIdsFromKeys = function () {
  if (!this.configManager || typeof this.configManager.getKeys !== 'function') {
    return [];
  }

  var keys = [];
  try {
    keys = this.configManager.getKeys() || [];
  } catch (e) {
    return [];
  }

  var discovered = [];
  var dedup = {};
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var match = ALARM_SLOT_FIELD_REGEXP.exec(key);
    if (!match) {
      continue;
    }

    var slotId = 'alarm_' + match[1];
    if (!dedup[slotId]) {
      dedup[slotId] = true;
      discovered.push(slotId);
    }
  }

  return normalizeAlarmSlotIds(discovered);
};

KoreanRadioAlarm.prototype._hasMeaningfulSlotConfigValues = function (slotId) {
  var normalized = normalizeAlarmSlotId(slotId);
  if (!normalized || !this.configManager || typeof this.configManager.get !== 'function') {
    return false;
  }

  var prefix = normalized + '_';
  var defaults = defaultAlarmConfigForMigration(normalized, this.catalog);
  var enabled = this._unwrapConfigValue(this.configManager.get(prefix + 'enabled', defaults.alarm_enabled));
  var action = this._unwrapConfigValue(this.configManager.get(prefix + 'action', defaults.alarm_action));
  var hour = this._unwrapConfigValue(this.configManager.get(prefix + 'hour', defaults.alarm_hour));
  var minute = this._unwrapConfigValue(this.configManager.get(prefix + 'minute', defaults.alarm_minute));
  var volume = this._unwrapConfigValue(this.configManager.get(prefix + 'volume', defaults.alarm_volume));
  var station = this._unwrapConfigValue(this.configManager.get(prefix + 'station_uri', defaults.alarm_station_uri));
  var monday = this._unwrapConfigValue(this.configManager.get(prefix + 'monday', defaults.monday));
  var tuesday = this._unwrapConfigValue(this.configManager.get(prefix + 'tuesday', defaults.tuesday));
  var wednesday = this._unwrapConfigValue(this.configManager.get(prefix + 'wednesday', defaults.wednesday));
  var thursday = this._unwrapConfigValue(this.configManager.get(prefix + 'thursday', defaults.thursday));
  var friday = this._unwrapConfigValue(this.configManager.get(prefix + 'friday', defaults.friday));
  var saturday = this._unwrapConfigValue(this.configManager.get(prefix + 'saturday', defaults.saturday));
  var sunday = this._unwrapConfigValue(this.configManager.get(prefix + 'sunday', defaults.sunday));

  if (!!enabled !== !!defaults.alarm_enabled) {
    return true;
  }
  if (buildActionValue(action) !== defaults.alarm_action) {
    return true;
  }
  if (hour !== defaults.alarm_hour || minute !== defaults.alarm_minute || volume !== defaults.alarm_volume) {
    return true;
  }
  if (station !== defaults.alarm_station_uri) {
    return true;
  }

  return !!monday !== defaults.monday ||
    !!tuesday !== defaults.tuesday ||
    !!wednesday !== defaults.wednesday ||
    !!thursday !== defaults.thursday ||
    !!friday !== defaults.friday ||
    !!saturday !== defaults.saturday ||
    !!sunday !== defaults.sunday;
};

KoreanRadioAlarm.prototype._getNextAvailableAlarmId = function (slotIds) {
  var used = {};
  for (var i = 0; i < slotIds.length; i++) {
    used[slotIds[i]] = true;
  }

  for (var n = 1; n < 1000; n++) {
    var candidate = 'alarm_' + n;
    if (!used[candidate]) {
      return candidate;
    }
  }

  return 'alarm_1000';
};

KoreanRadioAlarm.prototype._saveAlarmIdList = function (slotIds) {
  var sorted = normalizeAlarmSlotIds(slotIds || []);
  if (!this.configManager || typeof this.configManager.set !== 'function') {
    return sorted;
  }

  this.configManager.set('alarm_ids', sorted.join(','));
  return sorted;
};

KoreanRadioAlarm.prototype._setDefaultConfigForSlot = function (slotId) {
  var defaults = defaultAlarmConfig(slotId, this.catalog);
  var keys = alarmSlotConfigKeys(slotId);
  var disabledDefaults = {
    enabled: false,
    action: ALARM_DEFAULT_ACTION,
    hour: 7,
    minute: 0,
    station_uri: defaults.alarm_station_uri,
    volume: 45,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false
  };

  this.configManager.set(keys.enabled, disabledDefaults.enabled);
  this.configManager.set(keys.action, disabledDefaults.action);
  this.configManager.set(keys.hour, disabledDefaults.hour);
  this.configManager.set(keys.minute, disabledDefaults.minute);
  this.configManager.set(keys.station, disabledDefaults.station_uri);
  this.configManager.set(keys.volume, disabledDefaults.volume);
  this.configManager.set(keys.monday, disabledDefaults.monday);
  this.configManager.set(keys.tuesday, disabledDefaults.tuesday);
  this.configManager.set(keys.wednesday, disabledDefaults.wednesday);
  this.configManager.set(keys.thursday, disabledDefaults.thursday);
  this.configManager.set(keys.friday, disabledDefaults.friday);
  this.configManager.set(keys.saturday, disabledDefaults.saturday);
  this.configManager.set(keys.sunday, disabledDefaults.sunday);
};

KoreanRadioAlarm.prototype._getWeekdayValuesFromPayload = function (slotId, data, existing) {
  var weekdays = {};
  var prefix = slotId + '_';
  var self = this;

  WEEKDAY_KEYS.forEach(function (weekday) {
    var key = prefix + weekday;
    var legacyKey = weekday;

    if (slotId === 'alarm_1' && data && Object.prototype.hasOwnProperty.call(data, legacyKey)) {
      weekdays[weekday] = self._normalizeBooleanValue(data[legacyKey]);
      return;
    }

    if (data && Object.prototype.hasOwnProperty.call(data, key)) {
      weekdays[weekday] = self._normalizeBooleanValue(data[key]);
      return;
    }
    weekdays[weekday] = existing[weekday];
  }, this);

  return weekdays;
};

KoreanRadioAlarm.prototype._persistConfig = function () {
  if (!this.configManager || typeof this.configManager.save !== 'function') {
    return;
  }

  this.configManager.save();
};

KoreanRadioAlarm.prototype._normalizeBooleanValue = function (value) {
  value = this._unwrapConfigValue(value);
  if (typeof value === 'string') {
    if (value === 'false') {
      return false;
    }
    if (value === 'true') {
      return true;
    }
  }

  return !!value;
};

KoreanRadioAlarm.prototype._normalizeStationValue = function (value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    value = this._unwrapConfigValue(value);
    if (value === null || value === undefined) {
      return '';
    }
  }

  return String(value);
};

KoreanRadioAlarm.prototype._hasSlotConfigValues = function (slotId) {
  slotId = normalizeAlarmSlotId(slotId);
  if (!slotId || !this.configManager || typeof this.configManager.get !== 'function') {
    return false;
  }
  var prefix = slotId + '_';
  return this.configManager.get(prefix + 'enabled', undefined) !== undefined ||
    this.configManager.get(prefix + 'action', undefined) !== undefined ||
    this.configManager.get(prefix + 'hour', undefined) !== undefined ||
    this.configManager.get(prefix + 'minute', undefined) !== undefined ||
    this.configManager.get(prefix + 'station_uri', undefined) !== undefined ||
    this.configManager.get(prefix + 'volume', undefined) !== undefined ||
    this.configManager.get(prefix + 'monday', undefined) !== undefined ||
    this.configManager.get(prefix + 'tuesday', undefined) !== undefined ||
    this.configManager.get(prefix + 'wednesday', undefined) !== undefined ||
    this.configManager.get(prefix + 'thursday', undefined) !== undefined ||
    this.configManager.get(prefix + 'friday', undefined) !== undefined ||
    this.configManager.get(prefix + 'saturday', undefined) !== undefined ||
    this.configManager.get(prefix + 'sunday', undefined) !== undefined;
};

KoreanRadioAlarm.prototype._hasLegacyAlarmValues = function () {
  return this.configManager.get('alarm_enabled', undefined) !== undefined ||
    this.configManager.get('alarm_hour', undefined) !== undefined ||
    this.configManager.get('alarm_minute', undefined) !== undefined ||
    this.configManager.get('alarm_station_uri', undefined) !== undefined ||
    this.configManager.get('alarm_volume', undefined) !== undefined ||
    this.configManager.get('monday', undefined) !== undefined ||
    this.configManager.get('tuesday', undefined) !== undefined ||
    this.configManager.get('wednesday', undefined) !== undefined ||
    this.configManager.get('thursday', undefined) !== undefined ||
    this.configManager.get('friday', undefined) !== undefined ||
    this.configManager.get('saturday', undefined) !== undefined ||
    this.configManager.get('sunday', undefined) !== undefined;
};

KoreanRadioAlarm.prototype._rescheduleAlarm = function () {
  this._clearScheduledJobs();

  var self = this;
  var scheduleCount = 0;
  var nowEnabled = [];
  var slotIds = this._getStoredAlarmIds();
  this.alarmConfig = {};

  slotIds.forEach(function (slotId) {
    var alarmConfig = self._getStoredAlarmConfig(slotId);
    self.alarmConfig[slotId] = alarmConfig;

    if (!alarmConfig.alarm_enabled) {
      return;
    }

    var expressions = AlarmHelpers.buildCronExpressions(
      alarmConfig.alarm_hour,
      alarmConfig.alarm_minute,
      {
        monday: alarmConfig.monday,
        tuesday: alarmConfig.tuesday,
        wednesday: alarmConfig.wednesday,
        thursday: alarmConfig.thursday,
        friday: alarmConfig.friday,
        saturday: alarmConfig.saturday,
        sunday: alarmConfig.sunday
      }
    );

    expressions.forEach(function (expr) {
      var task = cron.schedule(expr, function () {
        self._onAlarmFire(slotId);
      }, {
        timezone: self.timezone,
        scheduled: true
      });

      self.scheduledJobs.push(task);
      scheduleCount += 1;
      nowEnabled.push(slotId);
    });
  });

  return {
    scheduled: scheduleCount,
    enabledSlots: nowEnabled
  };
};

KoreanRadioAlarm.prototype._clearScheduledJobs = function () {
  if (!Array.isArray(this.scheduledJobs)) {
    this.scheduledJobs = [];
    return;
  }

  this.scheduledJobs.forEach(function (job) {
    if (!job) {
      return;
    }

    if (typeof job.stop === 'function') {
      job.stop();
    }

    if (typeof job.destroy === 'function') {
      job.destroy();
    }
  });

  this.scheduledJobs = [];
};

KoreanRadioAlarm.prototype._addBrowseSource = function () {
  if (!this.commandRouter) {
    return;
  }

  var entry = {
    name: this._t('ALARM.TITLE', BROWSE_SOURCE_NAME),
    uri: SOURCE_URI,
    plugin_name: PLUGIN_NAME,
    plugin_type: 'music_service',
    source: SOURCE_ID,
    icon: 'fa-clock-o',
    sourceicon: 'fa-clock-o',
    albumart: '/albumart?source=' + SOURCE_ID
  };

  addBrowseSource(this.commandRouter, entry);
};

KoreanRadioAlarm.prototype._removeBrowseSource = function () {
  if (!this.commandRouter) {
    return;
  }

  removeBrowseSource(this.commandRouter, SOURCE_URI);
};

KoreanRadioAlarm.prototype._setAlarmVolume = function (volume) {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    return libQ.reject(new Error(this._t('ALARM.BAD_VOLUME', 'Invalid volume')));
  }

  if (!this.commandRouter) {
    return libQ.resolve();
  }

  if (typeof this.commandRouter.volumiosetvolume === 'function') {
    return safePromise(function () {
      return this.commandRouter.volumiosetvolume(volume);
    }.bind(this));
  }

  if (typeof this.commandRouter.volumioSetVolume === 'function') {
    return safePromise(function () {
      return this.commandRouter.volumioSetVolume(volume);
    }.bind(this));
  }

  var defer = libQ.defer();
  childProcess.exec('volumio volume ' + volume, function (err) {
    if (err) {
      defer.reject(err);
      return;
    }
    defer.resolve(true);
  });
  return defer.promise;
};

KoreanRadioAlarm.prototype._buildRootNavigation = function () {
  var groups = Array.isArray(this.catalog.groups) ? this.catalog.groups : [];
  var items = groups.map(function (group) {
    return {
      service: PLUGIN_NAME,
      type: 'folder',
      title: group.name || group.id,
      icon: 'fa-broadcast-tower',
      uri: SOURCE_URI + 'group/' + encodeURIComponent(group.id)
    };
  });

  return libQ.resolve({
    title: this._t('BROWSE.ROOT', 'Korean Radio'),
    navigation: {
      lists: [
        {
          title: this._t('BROWSE.GROUPS', 'Radio groups'),
          icon: 'fa-broadcast-tower',
          availableListViews: ['list'],
          items: items
        }
      ],
      prev: {
        uri: SOURCE_URI
      }
    },
    prev: {
      uri: SOURCE_URI
    },
    path: SOURCE_URI,
    isFolder: true,
    plugin: this.pluginName
  });
};

KoreanRadioAlarm.prototype._buildGroupNavigation = function (groupId) {
  var groups = Array.isArray(this.catalog.groups) ? this.catalog.groups : [];
  var target = null;

  for (var i = 0; i < groups.length; i++) {
    if (groups[i].id === groupId) {
      target = groups[i];
      break;
    }
  }

  if (!target) {
    return this._buildRootNavigation();
  }

  var stations = Array.isArray(target.stations) ? target.stations : [];
  var items = stations.map(function (station) {
    var streamPath = station.streamUrl || '';
    var item = {
      service: PLUGIN_NAME,
      type: 'webradio',
      stationUri: STATION_URI_PREFIX + station.id,
      trackType: 'webradio',
      duration: 0,
      isStreaming: true,
      title: station.name,
      album: target.name || target.id,
      artist: target.name || target.id,
      icon: 'fa-broadcast-tower',
      uri: station.uri || (STATION_URI_PREFIX + station.id),
      name: station.name
    };

    if (streamPath && streamPath.length > 0) {
      item.path = streamPath;
      item.realUri = streamPath;
    }

    return item;
  });

  return libQ.resolve({
    title: target.name || target.id,
    navigation: {
      prev: {
        uri: SOURCE_URI
      },
      lists: [
        {
          title: target.name || target.id,
          icon: 'fa-broadcast-tower',
          availableListViews: ['list'],
          items: items
        }
      ]
    }
  });
};

KoreanRadioAlarm.prototype._ensureStationUris = function () {
  if (!this.catalog || !Array.isArray(this.catalog.groups)) {
    return;
  }

  this.catalog.groups.forEach(function (group) {
    if (!Array.isArray(group.stations)) {
      return;
    }

    group.stations.forEach(function (station) {
      if (!station.uri && station.id) {
        station.uri = STATION_URI_PREFIX + station.id;
      }
    });
  });
};

KoreanRadioAlarm.prototype._loadCatalog = function () {
  this.catalog = readJsonOrDefault(this.catalogFile, { groups: [] });
  this._ensureStationUris();
};

KoreanRadioAlarm.prototype._requestJson = function (url, options) {
  var headers = options && options.headers ? options.headers : {};
  var defer = libQ.defer();
  var consumed = false;

  var done = function (err, result) {
    if (consumed) {
      return;
    }
    consumed = true;
    if (err) {
      defer.reject(err);
      return;
    }
    defer.resolve(result);
  };

  if (typeof url !== 'string' || !url) {
    return libQ.reject(new Error('Missing request url'));
  }

  var req;
  try {
    req = https.get(url, { headers: headers }, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        done(new Error('KBS play api request failed with status ' + res.statusCode));
        res.resume();
        return;
      }

      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        body += chunk;
      });
      res.on('end', function () {
        try {
          done(null, JSON.parse(body));
        } catch (e) {
          done(e);
        }
      });
      res.on('error', function (err) {
        done(err);
      });
    });
  } catch (e) {
    return done(e), defer.promise;
  }

  req.on('error', function (err) {
    done(err);
  });
  req.setTimeout(10000, function () {
    done(new Error('KBS play api request timeout'));
    req.destroy();
  });
  return defer.promise;
};

KoreanRadioAlarm.prototype._getCachedResolvedStreamUrl = function (cacheKey) {
  var cacheEntry = this._streamResolverCache[cacheKey];
  if (!cacheEntry) {
    return null;
  }

  if (!cacheEntry.streamUrl || cacheEntry.expiresAt <= Date.now()) {
    delete this._streamResolverCache[cacheKey];
    return null;
  }

  return cacheEntry.streamUrl;
};

KoreanRadioAlarm.prototype._setStreamResolverCache = function (cacheKey, streamUrl) {
  this._streamResolverCache[cacheKey] = {
    streamUrl: streamUrl,
    expiresAt: Date.now() + STREAM_RESOLVER_CACHE_TTL_MS
  };
};

KoreanRadioAlarm.prototype._warmUpStreamResolverCache = function () {
  var self = this;

  if (!self.catalog || !Array.isArray(self.catalog.groups)) {
    return libQ.resolve();
  }

  var stationsByResolver = {};
  self.catalog.groups.forEach(function (group) {
    if (!group || !Array.isArray(group.stations)) {
      return;
    }

    group.stations.forEach(function (station) {
      if (!station || !station.streamResolver || !station.streamResolver.type) {
        return;
      }

      var resolverType = station.streamResolver.type;
      var channelId = station.streamResolver.channelId;
      if (typeof resolverType !== 'string' || !resolverType.length || typeof channelId !== 'string' || !channelId.length) {
        return;
      }

      stationsByResolver[streamResolverCacheKey(resolverType, channelId)] = station;
    });
  });

  var warmups = [];
  Object.keys(stationsByResolver).forEach(function (cacheKey) {
    warmups.push(self._resolveStationStreamUrl(stationsByResolver[cacheKey]).then(function () {
      return true;
    }));
  });

  if (warmups.length === 0) {
    return libQ.resolve();
  }

  return libQ.all(warmups);
};

KoreanRadioAlarm.prototype._resolveStationStreamUrl = function (station) {
  var self = this;

  if (!station) {
    return libQ.reject(new Error('Invalid station'));
  }

  if (!station.streamResolver || !station.streamResolver.type) {
    if (typeof station.streamUrl === 'string' && station.streamUrl.length > 0) {
      return libQ.resolve(station.streamUrl);
    }
    return libQ.reject(new Error('No static stream URL for station ' + station.id));
  }

  if (station.streamResolver.type === 'kbs-play-api') {
    var channelId = station.streamResolver.channelId;

    if (typeof channelId !== 'string' || !channelId) {
      return libQ.reject(new Error('Missing channelId for KBS play resolver on station ' + station.id));
    }

    var cacheKey = streamResolverCacheKey(station.streamResolver.type, channelId);
    var cachedStreamUrl = self._getCachedResolvedStreamUrl(cacheKey);
    if (cachedStreamUrl) {
      return libQ.resolve(cachedStreamUrl);
    }

    if (self._streamResolverInFlight[cacheKey]) {
      return self._streamResolverInFlight[cacheKey];
    }

    var endpoint = KBS_PLAY_API_URL_BASE + encodeURIComponent(channelId);
    var headers = {
      Authorization: KBS_PLAY_API_AUTHORIZATION
    };

    var resolvedPromise = safePromise(function () {
      return self._requestJson(endpoint, { headers: headers });
    }).then(function (payload) {
      if (!payload || typeof payload.streamUrl !== 'string' || !payload.streamUrl) {
        var invalid = new Error('Invalid KBS play api response for station ' + station.id);
        if (self.logger && typeof self.logger.error === 'function') {
          self.logger.error(invalid.message);
        }
        throw invalid;
      }

      return payload.streamUrl;
    }).then(function (streamUrl) {
      self._setStreamResolverCache(cacheKey, streamUrl);
      return streamUrl;
    }).fail(function (err) {
      if (self.logger && typeof self.logger.error === 'function') {
        var message = err && err.message ? err.message : 'Unknown error';
        self.logger.error('Failed to resolve stream URL for station ' + station.id + ': ' + message);
      }
      throw err;
    });

    self._streamResolverInFlight[cacheKey] = resolvedPromise.then(function (streamUrl) {
      delete self._streamResolverInFlight[cacheKey];
      return streamUrl;
    }, function (err) {
      delete self._streamResolverInFlight[cacheKey];
      throw err;
    });

    return self._streamResolverInFlight[cacheKey];
  }

  return libQ.reject(new Error('Unsupported stream resolver type ' + station.streamResolver.type + ' for station ' + station.id));
};

KoreanRadioAlarm.prototype._getStoredAlarmConfig = function (slotId) {
  slotId = normalizeAlarmSlotId(slotId) || 'alarm_1';
  var prefix = slotId + '_';
  var defaultStation = AlarmHelpers.firstStationUriFromCatalog(this.catalog) || '';
  var defaults = defaultAlarmConfig(slotId, this.catalog);

  if (slotId === 'alarm_1' && !this._hasSlotConfigValues(slotId) && this._hasLegacyAlarmValues()) {
    defaults = {
      alarm_enabled: this._unwrapConfigValue(this.configManager.get('alarm_enabled', defaults.alarm_enabled)),
      alarm_action: this._unwrapConfigValue(this.configManager.get('alarm_action', defaults.alarm_action)),
      alarm_hour: this._unwrapConfigValue(this.configManager.get('alarm_hour', defaults.alarm_hour)),
      alarm_minute: this._unwrapConfigValue(this.configManager.get('alarm_minute', defaults.alarm_minute)),
      alarm_station_uri: this._unwrapConfigValue(this.configManager.get('alarm_station_uri', defaults.alarm_station_uri)),
      alarm_volume: this._unwrapConfigValue(this.configManager.get('alarm_volume', defaults.alarm_volume)),
      monday: this._unwrapConfigValue(this.configManager.get('monday', defaults.monday)),
      tuesday: this._unwrapConfigValue(this.configManager.get('tuesday', defaults.tuesday)),
      wednesday: this._unwrapConfigValue(this.configManager.get('wednesday', defaults.wednesday)),
      thursday: this._unwrapConfigValue(this.configManager.get('thursday', defaults.thursday)),
      friday: this._unwrapConfigValue(this.configManager.get('friday', defaults.friday)),
      saturday: this._unwrapConfigValue(this.configManager.get('saturday', defaults.saturday)),
      sunday: this._unwrapConfigValue(this.configManager.get('sunday', defaults.sunday))
    };
  } else {
    defaults = {
      alarm_enabled: this._unwrapConfigValue(this.configManager.get(prefix + 'enabled', defaults.alarm_enabled)),
      alarm_action: this._unwrapConfigValue(this.configManager.get(prefix + 'action', defaults.alarm_action)),
      alarm_hour: this._unwrapConfigValue(this.configManager.get(prefix + 'hour', defaults.alarm_hour)),
      alarm_minute: this._unwrapConfigValue(this.configManager.get(prefix + 'minute', defaults.alarm_minute)),
      alarm_station_uri: this._unwrapConfigValue(this.configManager.get(prefix + 'station_uri', defaults.alarm_station_uri)),
      alarm_volume: this._unwrapConfigValue(this.configManager.get(prefix + 'volume', defaults.alarm_volume)),
      monday: this._unwrapConfigValue(this.configManager.get(prefix + 'monday', defaults.monday)),
      tuesday: this._unwrapConfigValue(this.configManager.get(prefix + 'tuesday', defaults.tuesday)),
      wednesday: this._unwrapConfigValue(this.configManager.get(prefix + 'wednesday', defaults.wednesday)),
      thursday: this._unwrapConfigValue(this.configManager.get(prefix + 'thursday', defaults.thursday)),
      friday: this._unwrapConfigValue(this.configManager.get(prefix + 'friday', defaults.friday)),
      saturday: this._unwrapConfigValue(this.configManager.get(prefix + 'saturday', defaults.saturday)),
      sunday: this._unwrapConfigValue(this.configManager.get(prefix + 'sunday', defaults.sunday))
    };
  }

  var stored = {
    alarm_enabled: this._normalizeBooleanValue(defaults.alarm_enabled),
    alarm_action: buildActionValue(defaults.alarm_action),
    alarm_hour: AlarmHelpers.normalizeSelectValue(defaults.alarm_hour, 0, 23, 1, defaults.alarm_hour),
    alarm_minute: AlarmHelpers.normalizeSelectValue(defaults.alarm_minute, 0, 59, 1, defaults.alarm_minute),
    alarm_volume: AlarmHelpers.normalizeSelectValue(defaults.alarm_volume, 0, 100, 5, defaults.alarm_volume),
    alarm_station_uri: this._normalizeStationValue(defaults.alarm_station_uri),
    monday: this._normalizeBooleanValue(defaults.monday),
    tuesday: this._normalizeBooleanValue(defaults.tuesday),
    wednesday: this._normalizeBooleanValue(defaults.wednesday),
    thursday: this._normalizeBooleanValue(defaults.thursday),
    friday: this._normalizeBooleanValue(defaults.friday),
    saturday: this._normalizeBooleanValue(defaults.saturday),
    sunday: this._normalizeBooleanValue(defaults.sunday)
  };

  if (!AlarmHelpers.findStationByUri(this.catalog, stored.alarm_station_uri)) {
    stored.alarm_station_uri = defaultStation;
  }

  return stored;
};

KoreanRadioAlarm.prototype.getBrowseList = function (uris) {
  return this.handleBrowseUri(uris);
};

module.exports = KoreanRadioAlarm;
