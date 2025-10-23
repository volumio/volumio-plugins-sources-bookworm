'use strict';

const libQ = require('kew');
const fs = require('fs-extra');
const { exec } = require('child_process');
const path = require('path');
const configItems = ['show_more', 'media_dir_a', 'media_dir_p', 'media_dir_v', 'merge_media_dirs',
  'db_dir', 'log_dir', 'root_container', 'network_interface', 'port', 'presentation_url',
  'friendly_name', 'serial', 'model_name', 'model_number', 'inotify', 'album_art_names', 'strict_dlna',
  'enable_tivo', 'tivo_discovery', 'notify_interval', 'minissdpdsocket', 'force_sort_criteria',
  'max_connections', 'loglevel_general', 'loglevel_artwork', 'loglevel_database', 'loglevel_inotify',
  'loglevel_scanner', 'loglevel_metadata', 'loglevel_http', 'loglevel_ssdp', 'loglevel_tivo', 'wide_links',
  'enable_subtitles'];
let minidlnaVersion, systemdLogging;

module.exports = minidlna;

function minidlna (context) {
  const self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.commandRouter.logger;
  self.configManager = self.context.configManager;
  self.pluginName = self.commandRouter.pluginManager.getPackageJson(__dirname).name;
  self.pluginType = self.commandRouter.pluginManager.getPackageJson(__dirname).volumio_info.plugin_type;
  self.minidlnaConf = path.join('data', 'configuration', self.pluginType, self.pluginName, 'minidlna.conf');
}

minidlna.prototype.onVolumioStart = function () {
  const self = this;
  const configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');

  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
  return libQ.resolve();
};

minidlna.prototype.onStart = function () {
  const self = this;
  const defer = libQ.defer();
  let minidlnad = '/usr/sbin/minidlnad';

  self.commandRouter.loadI18nStrings();
  try {
    const defaultConfig = fs.readJsonSync(path.join(__dirname, 'config.json'));
    for (const configItem in defaultConfig) {
      if (!self.config.has(configItem)) {
        self.config.set(configItem, defaultConfig[configItem].value);
      }
    }
  } catch (e) {
    self.logger.error(self.pluginName + ': Failed to read default configuration from ' + path.join(__dirname, 'config.json: ') + e);
  }
  try {
    if (!fs.statSync(minidlnad).isFile()) {
      throw new Error();
    }
  } catch (e) {
    minidlnad = '/usr/bin/minidlnad';
  }
  exec(minidlnad + ' -V', { uid: 1000, gid: 1000 }, (error, stdout, stderr) => {
    if (error !== null) {
      self.logger.error(self.pluginName + ': Failed to query miniDLNA version: ' + error);
      minidlnaVersion = '0';
    } else {
      minidlnaVersion = stdout.slice(8);
      self.logger.info(self.pluginName + ': Found miniDLNA version ' + minidlnaVersion);
    }
    self.initialConf()
      .then(() => {
        self.logger.info(self.pluginName + ': Starting minidlna.service');
        self.systemctl('start minidlna.service')
          .then(() => {
            self.systemctl('status minidlna')
              .then(r => {
                systemdLogging = / -S | -S$/m.test(r);
              });
            defer.resolve();
          });
      })
      .fail(e => defer.reject(e));
  });
  return defer.promise;
};

minidlna.prototype.onStop = function () {
  const self = this;
  const defer = libQ.defer();

  self.logger.info(self.pluginName + ': Stopping minidlna.service');
  self.systemctl('stop minidlna.service')
    .fin(() => defer.resolve());
  return defer.promise;
};

// Configuration Methods -----------------------------------------------------------------------------

minidlna.prototype.getLabelForSelect = function (options, key) {
  for (let i = 0, n = options.length; i < n; i++) {
    if (options[i].value === key) {
      return options[i].label;
    }
  }
  return 'VALUE NOT FOUND BETWEEN SELECT OPTIONS!';
};

minidlna.prototype.getUIConfig = function () {
  const self = this;
  const defer = libQ.defer();
  const langCode = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + langCode + '.json'),
    path.join(__dirname, 'i18n', 'strings_en.json'),
    path.join(__dirname, 'UIConfig.json'))
    .then(uiconf => {
      configItems.forEach((configItem, i) => {
        const value = self.config.get(configItem);
        switch (configItem) {
          case 'root_container':
          case 'tivo_discovery':
          case 'loglevel_general':
          case 'loglevel_artwork':
          case 'loglevel_database':
          case 'loglevel_inotify':
          case 'loglevel_scanner':
          case 'loglevel_metadata':
          case 'loglevel_http':
          case 'loglevel_ssdp':
          case 'loglevel_tivo':
            uiconf.sections[0].content[i].value.value = value;
            uiconf.sections[0].content[i].value.label = self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[0].content[' + i + '].options'), value);
            break;
          default:
            uiconf.sections[0].content[i].value = value;
        }
        switch (configItem) {
          case 'log_dir':
            uiconf.sections[0].content[i].hidden = systemdLogging;
            break;
          case 'merge_media_dirs':
          case 'tivo_discovery':
          case 'wide_links':
            uiconf.sections[0].content[i].hidden = (minidlnaVersion.localeCompare('1.2.1', 'en-u-kn-true') < 0);
            break;
          case 'enable_subtitles':
            uiconf.sections[0].content[i].hidden = (minidlnaVersion.localeCompare('1.3.0', 'en-u-kn-true') < 0);
        }
      });
      uiconf.sections[1].content[1].hidden = (minidlnaVersion.localeCompare('1.2.0', 'en-u-kn-true') < 0);
      defer.resolve(uiconf);
    })
    .fail(e => {
      self.logger.error(self.pluginName + ': Could not fetch UI configuration: ' + e);
      defer.reject(new Error());
    });
  return defer.promise;
};

minidlna.prototype.updateUIConfig = function () {
  const self = this;

  self.commandRouter.getUIConfigOnPlugin(self.pluginType, self.pluginName, {})
    .then(uiconf => self.commandRouter.broadcastMessage('pushUiConfig', uiconf));
  self.commandRouter.broadcastMessage('pushUiConfig');
};

minidlna.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

minidlna.prototype.getI18nFile = function (langCode) {
  const self = this;
  const langFile = 'strings_' + langCode + '.json';

  try {
    // check for i18n file fitting the system language
    if (fs.readdirSync(path.join(__dirname, 'i18n'), { withFileTypes: true })
      .some(item => item.isFile() && item.name === langFile)) {
      return path.join(__dirname, 'i18n', langFile);
    }
    throw new Error('i18n file complementing the system language not found.');
  } catch (e) {
    self.logger.error(self.pluginName + ': Fetching language file: ' + e);
    // return default i18n file
    return path.join(__dirname, 'i18n', 'strings_en.json');
  }
};

minidlna.prototype.saveConf = function (data) {
  const self = this;
  const defer = libQ.defer();
  const changes = [];

  configItems.forEach(configItem => {
    switch (configItem) {
      case 'media_dir_a':
        changes.push(self.handlePath(configItem, data[configItem], 'AUDIO_FOLDER'));
        break;
      case 'media_dir_p':
        changes.push(self.handlePath(configItem, data[configItem], 'PICTURE_FOLDER'));
        break;
      case 'media_dir_v':
        changes.push(self.handlePath(configItem, data[configItem], 'VIDEO_FOLDER'));
        break;
      case 'db_dir':
        changes.push(self.handlePath(configItem, data[configItem], 'DB_DIR'));
        break;
      case 'log_dir':
        changes.push(self.handlePath(configItem, data[configItem], 'LOG_DIR'));
        break;
      case 'root_container':
      case 'tivo_discovery':
      case 'loglevel_general':
      case 'loglevel_artwork':
      case 'loglevel_database':
      case 'loglevel_inotify':
      case 'loglevel_scanner':
      case 'loglevel_metadata':
      case 'loglevel_http':
      case 'loglevel_ssdp':
      case 'loglevel_tivo':
        if (self.config.get(configItem) !== data[configItem].value) {
          self.config.set(configItem, data[configItem].value);
          changes.push(true);
        }
        break;
      case 'port':
        changes.push(self.handleNum(configItem, 0, 8, data[configItem], 0, 65535));
        break;
      case 'notify_interval':
        changes.push(self.handleNum(configItem, 0, 18, data[configItem], 0, Number.MAX_SAFE_INTEGER));
        break;
      case 'max_connections':
        changes.push(self.handleNum(configItem, 0, 21, data[configItem], 0, Number.MAX_SAFE_INTEGER));
        break;
      default:
        if (self.config.get(configItem) !== data[configItem]) {
          self.config.set(configItem, data[configItem]);
          changes.push(true);
        }
    }
  });
  if (!changes.includes(true) && !changes.includes('err')) {
    self.commandRouter.pushToastMessage('info', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.NO_CHANGES'));
    defer.resolve();
  } else if (changes.includes(true)) {
    self.createMinidlnaConf()
      .then(() => {
        self.logger.info(self.pluginName + ': Restarting minidlna.service');
        self.systemctl('restart minidlna.service')
          .then(() => {
            if (!changes.includes('err')) {
              self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.CONF_UPDATED'));
            }
            self.logger.success('The miniDLNA configuration has been updated.');
            defer.resolve();
          });
      })
      .fail(() => defer.reject());
  }
  return defer.promise;
};

// Plugin Methods ------------------------------------------------------------------------------------

minidlna.prototype.handleNum = function (item, sectionId, contentId, value, min, max) {
  const self = this;

  if (!Number.isNaN(parseInt(value, 10)) && isFinite(value)) {
    if (value < min || value > max) {
      self.updateUIConfig();
      self.commandRouter.pushToastMessage('stickyerror', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.' + item.toUpperCase()) + self.commandRouter.getI18nString('MINIDLNA.INFO_RANGE') + '(' + min + '-' + max + ').');
      return 'err';
    }
    if (self.config.get(item) !== parseInt(value, 10)) {
      self.config.set(item, parseInt(value, 10));
      return true;
    }
  } else {
    self.updateUIConfig();
    self.commandRouter.pushToastMessage('stickyerror', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.' + item.toUpperCase()) + self.commandRouter.getI18nString('MINIDLNA.NAN'));
    return 'err';
  }
};

minidlna.prototype.handlePath = function (item, value, UIkeyname) {
  const self = this;
  const separator = item.startsWith('media_dir_') ? ' // ' : undefined;
  let changes;

  value.split(separator).forEach(p => {
    try {
      if (!path.isAbsolute(p.trim()) || !fs.statSync(p.trim()).isDirectory()) {
        throw new Error();
      }
    } catch (e) {
      self.updateUIConfig();
      if (e.toString().includes('ENOENT')) {
        self.logger.error(self.pluginName + ': ' + item + ' "' + p.trim() + '" does not exist');
        self.commandRouter.pushToastMessage('stickyerror', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.' + UIkeyname) + ' "' + p.trim() + '" ' + self.commandRouter.getI18nString('MINIDLNA.DIR_MISSING'));
      } else {
        self.logger.error(self.pluginName + ': ' + item + ' "' + p.trim() + '" is not an absolute path specification');
        self.commandRouter.pushToastMessage('stickyerror', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.' + UIkeyname) + ' "' + p.trim() + '" ' + self.commandRouter.getI18nString('MINIDLNA.ERR_ABSOLUTE_PATH'));
      }
      changes = 'err';
    }
  });
  if (self.config.get(item) !== value && changes !== 'err') {
    self.config.set(item, value);
    changes = true;
  }
  return changes;
};

minidlna.prototype.initialConf = function () {
  const self = this;
  const defer = libQ.defer();

  try {
    if (!fs.statSync(self.minidlnaConf).isFile()) {
      throw new Error();
    }
    defer.resolve();
  } catch (e) {
    self.createMinidlnaConf()
      .then(() => defer.resolve())
      .fail(() => {
        self.commandRouter.pushToastMessage('stickyerror', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.ERR_CREATE') + self.minidlnaConf);
        defer.reject('Creating ' + self.minidlnaConf + ' failed');
      });
  }
  return defer.promise;
};

minidlna.prototype.createMinidlnaConf = function () {
// derived from balbuze's "createVolumiominidlnaFile" function of his volumiominidlna plugin - many thanks to balbuze
  const self = this;
  const defer = libQ.defer();

  fs.readFile(path.join(__dirname, 'minidlna.conf.tmpl'), 'utf8', (err, data) => {
    if (err) {
      self.logger.error(self.pluginName + ': Failed to read ' + path.join(__dirname, 'minidlna.conf.tmpl: ') + err);
      self.commandRouter.pushToastMessage('stickyerror', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.ERR_READ') + path.join(__dirname, 'minidlna.conf.tmpl: ') + err);
      defer.reject();
    } else {
      configItems.forEach(configItem => {
        let value;
        switch (self.config.get(configItem)) {
          case false:
            value = 'no';
            break;
          case true:
            value = 'yes';
            break;
          default:
            value = self.config.get(configItem);
        }
        switch (configItem) {
          case 'media_dir_a':
          case 'media_dir_p':
          case 'media_dir_v':
            value.split('//').forEach((p, i) => {
              if (i === 0) {
                value = p.trim();
              } else {
                value = value + '\nmedia_dir=' + configItem.slice(-1).toUpperCase() + ',' + p.trim();
              }
            });
            data = data.replace('${' + configItem + '}', value);
            break;
          case 'merge_media_dirs':
          case 'tivo_discovery':
          case 'wide_links':
            if (minidlnaVersion.localeCompare('1.2.1', 'en-u-kn-true') < 0) {
              data = data.replace(new RegExp('^' + configItem + '\\=\\${', 'gm'), '#' + configItem + '=${');
            } else {
              data = data.replace('${' + configItem + '}', value);
            }
            break;
          case 'enable_subtitles':
            if (minidlnaVersion.localeCompare('1.3.0', 'en-u-kn-true') < 0) {
              data = data.replace(new RegExp('^' + configItem + '\\=\\${', 'gm'), '#' + configItem + '=${');
              break;
            }
            // fall through to default
          default:
            data = data.replace('${' + configItem + '}', value);
        }
      });
      fs.writeFile(self.minidlnaConf, data, 'utf8', err => {
        if (err) {
          self.logger.error(self.pluginName + ': Failed to write ' + self.minidlnaConf + ': ' + err);
          self.commandRouter.pushToastMessage('stickyerror', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.ERR_WRITE') + '/data/minidlna.conf: ' + err);
          defer.reject();
        } else {
          self.logger.info(self.pluginName + ': ' + self.minidlnaConf + ' written');
          defer.resolve();
        }
      });
    }
  });
  return defer.promise;
};

minidlna.prototype.forceRescan = function (option) {
  const self = this;
  const defer = libQ.defer();

  fs.writeFile(path.join('data', 'configuration', self.pluginType, self.pluginName, 'r_opt'), 'R_OPT=-' + option, 'utf8', err => {
    if (err !== null) {
      self.logger.error(self.pluginName + ': Failed to write rescan option "-' + option + '" to ' + path.join('data', 'configuration', self.pluginType, self.pluginName, 'r_opt') + ': ' + err);
      self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.ERR_WRITE') + path.join('data', 'configuration', self.pluginType, self.pluginName, 'r_opt') + ': ' + err);
      defer.reject(err);
    } else {
      self.systemctl('restart minidlna.service')
        .then(() => {
          self.logger.info(self.pluginName + ': Rescanning the media directories (' + option === 'R' ? 're-creating' : 'updating' + 'the DB).');
          self.commandRouter.pushToastMessage('info', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.RESCANNING'));
          defer.resolve();
        })
        .fail(e => {
          self.logger.error(self.pluginName + ': Failed to rescan the media directories (' + option === 'R' ? 're-creating' : 'updating' + 'the DB): ' + e);
          self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.RESCAN_FAILED') + e);
          defer.reject();
        })
        .fin(() => {
          fs.unlink(path.join('data', 'configuration', self.pluginType, self.pluginName, 'r_opt'), err => {
            if (err !== null) {
              self.logger.error(self.pluginName + ': Failed to remove ' + path.join('data', 'configuration', self.pluginType, self.pluginName, 'r_opt') + ': ' + err);
              self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.ERR_REMOVE') + path.join('data', 'configuration', self.pluginType, self.pluginName, 'r_opt') + ': ' + err);
            }
          });
        });
    }
  });
  return defer.promise;
};

minidlna.prototype.systemctl = function (systemctlCmd) {
  const self = this;
  const defer = libQ.defer();

  exec('/usr/bin/sudo /bin/systemctl ' + systemctlCmd, { uid: 1000, gid: 1000 }, (error, stdout, stderr) => {
    if (error !== null) {
      self.logger.error(self.pluginName + ': Failed to ' + systemctlCmd + ': ' + error);
      self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('MINIDLNA.PLUGIN_NAME'), self.commandRouter.getI18nString('MINIDLNA.GENERIC_FAILED') + systemctlCmd + ' ' + ': ' + error);
      defer.reject(error);
    } else {
      self.logger.info(self.pluginName + ': systemctl ' + systemctlCmd + ' succeeded.');
      defer.resolve(stdout);
    }
  });
  return defer.promise;
};
