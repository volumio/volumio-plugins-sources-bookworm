'use strict';

var libQ = require('kew');
var fs = require('fs');
var os = require('os');
var path = require('path');
var execFile = require('child_process').execFile;

var CONF_FILE = '/etc/mausberry-switch.conf';
var SERVICE = 'mausberry-switch';
var DEFAULTS = { Out: 23, In: 24, Delay: 0 };

module.exports = ControllerMausberrySwitch;

function ControllerMausberrySwitch(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
}

ControllerMausberrySwitch.prototype.onVolumioStart = function () {
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config = new (require('v-conf'))();
  this.config.loadFile(configFile);
  return libQ.resolve();
};

ControllerMausberrySwitch.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

// Enabling the plugin enables the daemon, disabling it stops the daemon,
// so the switch only acts while the plugin is active.
ControllerMausberrySwitch.prototype.onStart = function () {
  return this.systemctl(['enable', '--now', SERVICE]).fail(function () {
    // Do not block Volumio start-up; the error is already logged.
    return libQ.resolve();
  });
};

ControllerMausberrySwitch.prototype.onStop = function () {
  return this.systemctl(['disable', '--now', SERVICE]).fail(function () {
    return libQ.resolve();
  });
};

// Configuration ---------------------------------------------------------------

ControllerMausberrySwitch.prototype.getUIConfig = function () {
  var self = this;
  var defer = libQ.defer();
  var langCode = this.commandRouter.sharedVars.get('language_code');

  self.commandRouter
    .i18nJson(
      __dirname + '/i18n/strings_' + langCode + '.json',
      __dirname + '/i18n/strings_en.json',
      __dirname + '/UIConfig.json'
    )
    .then(function (uiconf) {
      var values = self.readDaemonConfig();
      var content = uiconf.sections[0].content;
      content[0].value = values.Out;
      content[1].value = values.In;
      content[2].value = values.Delay;
      defer.resolve(uiconf);
    })
    .fail(function (err) {
      self.logger.error('mausberry_switch: getUIConfig failed: ' + err);
      defer.reject(new Error());
    });

  return defer.promise;
};

ControllerMausberrySwitch.prototype.saveConfig = function (data) {
  var self = this;
  var out = toInt(data.out_pin);
  var inp = toInt(data.in_pin);
  var delay = toInt(data.delay);

  if (!isPin(out) || !isPin(inp)) {
    return self.fail('ERR_PIN');
  }
  if (out === inp) {
    return self.fail('ERR_SAME_PIN');
  }
  if (delay === null || delay < 0 || delay > 3600) {
    return self.fail('ERR_DELAY');
  }

  var text;
  try {
    text = fs.readFileSync(CONF_FILE, 'utf8');
  } catch (e) {
    self.logger.error('mausberry_switch: cannot read ' + CONF_FILE + ': ' + e);
    return self.fail('ERR_NOT_INSTALLED');
  }

  // Replace only the three values; comments and ShutdownCommand stay as they are.
  text = setValue(text, 'Out', out);
  text = setValue(text, 'In', inp);
  text = setValue(text, 'Delay', delay);

  var tmp = path.join(os.tmpdir(), 'mausberry-switch.conf.' + process.pid);
  try {
    fs.writeFileSync(tmp, text, 'utf8');
  } catch (e) {
    self.logger.error('mausberry_switch: cannot write ' + tmp + ': ' + e);
    return self.fail('ERR_WRITE');
  }

  return self
    .run('sudo', ['/usr/bin/install', '-m', '0644', '-o', 'root', '-g', 'root', tmp, CONF_FILE])
    .then(function () {
      return self.systemctl(['restart', SERVICE]);
    })
    .then(function () {
      self.toast('success', 'SAVED');
    })
    .fail(function () {
      self.toast('error', 'ERR_WRITE');
    })
    .fin(function () {
      fs.unlink(tmp, function () {});
    });
};

// Helpers ---------------------------------------------------------------------

ControllerMausberrySwitch.prototype.readDaemonConfig = function () {
  var values = { Out: DEFAULTS.Out, In: DEFAULTS.In, Delay: DEFAULTS.Delay };
  var text;
  try {
    text = fs.readFileSync(CONF_FILE, 'utf8');
  } catch (e) {
    return values;
  }
  Object.keys(values).forEach(function (key) {
    var m = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*(\\d+)\\s*$', 'm'));
    if (m) {
      values[key] = parseInt(m[1], 10);
    }
  });
  return values;
};

ControllerMausberrySwitch.prototype.systemctl = function (args) {
  return this.run('sudo', ['/bin/systemctl'].concat(args));
};

ControllerMausberrySwitch.prototype.run = function (cmd, args) {
  var self = this;
  var defer = libQ.defer();
  execFile(cmd, args, { timeout: 30000 }, function (err, stdout, stderr) {
    if (err) {
      self.logger.error('mausberry_switch: ' + cmd + ' ' + args.join(' ') + ' failed: ' + (stderr || err));
      defer.reject(err);
    } else {
      defer.resolve(stdout);
    }
  });
  return defer.promise;
};

ControllerMausberrySwitch.prototype.toast = function (type, key) {
  this.commandRouter.pushToastMessage(type, 'Mausberry Switch', this.getString(key));
};

ControllerMausberrySwitch.prototype.fail = function (key) {
  this.toast('error', key);
  return libQ.reject(new Error(key));
};

ControllerMausberrySwitch.prototype.getString = function (key) {
  var lang = this.commandRouter.sharedVars.get('language_code');
  var strings;
  try {
    strings = JSON.parse(fs.readFileSync(__dirname + '/i18n/strings_' + lang + '.json', 'utf8'));
  } catch (e) {
    strings = {};
  }
  if (strings[key] === undefined) {
    strings = JSON.parse(fs.readFileSync(__dirname + '/i18n/strings_en.json', 'utf8'));
  }
  return strings[key] || key;
};

function toInt(v) {
  if (v === undefined || v === null || !/^\s*\d+\s*$/.test(String(v))) {
    return null;
  }
  return parseInt(v, 10);
}

function isPin(n) {
  return n !== null && n >= 2 && n <= 27;
}

function setValue(text, key, value) {
  var re = new RegExp('^(\\s*' + key + '\\s*=).*$', 'm');
  if (re.test(text)) {
    return text.replace(re, '$1' + value);
  }
  // Key missing: append it to the matching section.
  var section = key === 'Delay' ? '[Config]' : '[Pins]';
  var idx = text.indexOf(section);
  if (idx === -1) {
    return text + '\n' + section + '\n' + key + '=' + value + '\n';
  }
  var end = idx + section.length;
  return text.slice(0, end) + '\n' + key + '=' + value + text.slice(end);
}
