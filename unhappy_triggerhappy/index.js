'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;

var control = require('./control');
var stockMap = require('./stock-map');
var listener = require('./listener');
var devices = require('./devices');
var listenerClient = require('./listener-client');

var LOG_PREFIX = 'Unhappy TriggerHappy: ';
var SYSTEMCTL = '/usr/bin/sudo /bin/systemctl';
var SERVICE = 'triggerhappy';
var PLUGIN_TYPE = 'system_controller';
var PLUGIN_NAME = 'unhappy_triggerhappy';
var CAPTURE_MS = 10000;

module.exports = UnhappyTriggerHappy;

function UnhappyTriggerHappy(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this._cancelPoll = null;
    this._rows = [];
    this._capturing = false;
}

UnhappyTriggerHappy.prototype.onVolumioStart = function () {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    this._configDir = path.dirname(configFile);
    return libQ.resolve();
};

UnhappyTriggerHappy.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

UnhappyTriggerHappy.prototype.onStart = function () {
    var self = this;

    if (self.config.get('happy_forever') === true) {
        self.logger.info(LOG_PREFIX + 'forever is on, polling VOLUMIO_SYSTEM_STATUS');
        self._cancelPoll = control.makeHappyForever({
            restartTriggerhappy: function () {
                self._restartTriggerhappy().catch(function (err) {
                    self.logger.error(LOG_PREFIX + 'restart failed: ' + err.message);
                });
            }
        });
    }

    if (self.config.get('listener_enabled') === true) {
        self._writeListenerConfig();
        self._systemctl('enable --now ' + listener.UNIT).catch(function (err) {
            self.logger.error(LOG_PREFIX + 'listener start failed: ' + err.message);
        });
    }

    return libQ.resolve();
};

UnhappyTriggerHappy.prototype.onStop = function () {
    var self = this;

    if (typeof self._cancelPoll === 'function') {
        self._cancelPoll();
        self._cancelPoll = null;
    }
    // A stopped plugin holds no remote: the listener goes with it.
    self._systemctl('disable --now ' + listener.UNIT).catch(function (err) {
        self.logger.warn(LOG_PREFIX + 'listener stop failed: ' + err.message);
    });
    return libQ.resolve();
};

UnhappyTriggerHappy.prototype.onRestart = function () {
};

UnhappyTriggerHappy.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;
    var langCode = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + langCode + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    ).then(function (uiconf) {
        var forever = self._contentById(uiconf.sections[1], 'happy_forever');
        var more = self._contentById(uiconf.sections[2], 'more_happy');

        forever.value = self.config.get('happy_forever') === true;
        more.value = self.config.get('more_happy') === true;

        stockMap.STOCK_BINDINGS.forEach(function (row) {
            var item = self._contentById(uiconf.sections[2], row.field);
            var stored = self.config.get(row.field);
            item.value = (stored === undefined || stored === null) ? row.command : stored;
        });

        self._fillListenerSection(uiconf.sections[3]);
        self._fillBindingsSection(uiconf.sections[4]);

        self._listenerStatusText().then(function (text) {
            self._contentById(uiconf.sections[3], 'listener_status').value = text;
            defer.resolve(uiconf);
        });
    }).fail(function (e) {
        self.logger.error(LOG_PREFIX + 'Failed to parse UI config: ' + e);
        defer.reject(new Error());
    });

    return defer.promise;
};

// The listener section: the switch and the timing from the config, then one
// "take over" switch per remote, present or stored.
UnhappyTriggerHappy.prototype._fillListenerSection = function (section) {
    var self = this;
    var enabled = self.config.get('listener_enabled') === true;
    var timing = self._timing();

    self._contentById(section, 'listener_enabled').value = enabled;
    Object.keys(timing).forEach(function (field) {
        self._contentById(section, field).value = timing[field];
    });

    self._rows = listener.rows(devices.list(), listener.parseStored(self.config.get('listener_devices')));
    self._rows.forEach(function (row, i) {
        var where = row.present ? row.paths.join(', ') : self._t('NOT_CONNECTED');
        section.content.push({
            id: 'take_' + i,
            element: 'switch',
            label: self._t('TAKE_OVER') + ': ' + row.name + ' (' + where + ')',
            doc: self._t('TAKE_OVER_DOC'),
            value: row.taken,
            visibleIf: { field: 'listener_enabled', value: true }
        });
        section.saveButton.data.push('take_' + i);
    });
};

// The bindings section: one row of key, press, command, and a remove switch
// per binding, ahead of the new-binding fields the page already holds. The
// new row's key is the last capture.
UnhappyTriggerHappy.prototype._fillBindingsSection = function (section) {
    var self = this;
    var bindings = self._bindings();
    var rows = [];

    bindings.forEach(function (binding, i) {
        var p = 'b' + i + '_';
        var tag = '#' + (i + 1) + ' ';
        rows.push({
            id: p + 'key',
            element: 'input',
            type: 'text',
            label: tag + self._t('ROW_KEY'),
            doc: self._t('ROW_KEY_DOC'),
            value: binding.key
        });
        rows.push({
            id: p + 'press',
            element: 'select',
            label: tag + self._t('ROW_PRESS'),
            doc: self._t('ROW_PRESS_DOC'),
            value: self._pressOption(binding.press),
            options: self._pressOptions()
        });
        rows.push({
            id: p + 'command',
            element: 'input',
            type: 'text',
            label: tag + self._t('ROW_COMMAND'),
            doc: self._t('ROW_COMMAND_DOC'),
            value: binding.command
        });
        rows.push({
            id: p + 'remove',
            element: 'switch',
            label: tag + self._t('ROW_REMOVE'),
            doc: self._t('ROW_REMOVE_DOC'),
            value: false
        });
        section.saveButton.data.push(p + 'key', p + 'press', p + 'command', p + 'remove');
    });
    section.content = rows.concat(section.content);

    self._contentById(section, 'new_key').value = String(self.config.get('captured_key') || '');
    self._contentById(section, 'new_press').value = self._pressOption('short');
    self._contentById(section, 'new_press').options = self._pressOptions();
    self._contentById(section, 'new_command').value = '';
};

UnhappyTriggerHappy.prototype._pressOption = function (press) {
    return { value: press, label: this._t('PRESS_' + press.toUpperCase()) };
};

UnhappyTriggerHappy.prototype._pressOptions = function () {
    var self = this;
    return listener.PRESSES.map(function (press) {
        return self._pressOption(press);
    });
};

UnhappyTriggerHappy.prototype._listenerStatusText = function () {
    var self = this;
    var enabled = self.config.get('listener_enabled') === true;

    return self._listener({ cmd: 'status' }, 2000).then(function (status) {
        var taken = (status.devices || []).length;
        var text = self._t('LISTENER_RUNNING')
            .replace('{taken}', String(taken))
            .replace('{wanted}', String(status.wanted || 0))
            .replace('{bindings}', String(status.bindings || 0));
        if (status.config_error) {
            text += ' (' + status.config_error + ')';
        }
        if (status.warnings && status.warnings.length) {
            text += ' (' + self._t('LISTENER_DROPPED') + ' ' + status.warnings.join('. ') + ')';
        }
        return text;
    }).catch(function () {
        return self._t(enabled ? 'LISTENER_NOT_RUNNING' : 'LISTENER_STOPPED');
    });
};

UnhappyTriggerHappy.prototype.restartNow = function () {
    var self = this;
    var defer = libQ.defer();

    self._restartTriggerhappy()
        .then(function () {
            self.commandRouter.pushToastMessage('success', 'Unhappy TriggerHappy',
                self._t('RESTARTED'));
            defer.resolve();
        })
        .catch(function (err) {
            self.logger.error(LOG_PREFIX + 'restart now failed: ' + err.message);
            defer.reject(err);
        });

    return defer.promise;
};

UnhappyTriggerHappy.prototype.saveForever = function (data) {
    var self = this;
    var defer = libQ.defer();
    var enabled = data.happy_forever === true;

    self.config.set('happy_forever', enabled);

    if (!enabled && typeof self._cancelPoll === 'function') {
        self._cancelPoll();
        self._cancelPoll = null;
    }

    self.commandRouter.pushToastMessage('success', 'Unhappy TriggerHappy',
        self._t('FOREVER_SAVED'));
    defer.resolve();
    return defer.promise;
};

UnhappyTriggerHappy.prototype.saveBindings = function (data) {
    var self = this;
    var defer = libQ.defer();

    self.config.set('more_happy', data.more_happy === true);
    stockMap.STOCK_BINDINGS.forEach(function (row) {
        if (data[row.field] !== undefined) {
            self.config.set(row.field, data[row.field]);
        }
    });

    control.saveBindings({
        readForeignTriggers: function () {
            return self._readForeignTriggers();
        },
        writeTriggers: function (body) {
            return self._writeTriggers(body);
        },
        removeTriggers: function () {
            return self._removeTriggers();
        },
        restartTriggerhappy: function () {
            return self._restartTriggerhappy();
        }
    }, data)
        .then(function () {
            // A remote with no list of its own runs the editor's map.
            return self._syncListener();
        })
        .then(function () {
            self.commandRouter.pushToastMessage('success', 'Unhappy TriggerHappy',
                self._t('SAVED'));
            defer.resolve();
        })
        .catch(function (err) {
            self.logger.error(LOG_PREFIX + 'save bindings failed: ' + err.message);
            defer.reject(err);
        });

    return defer.promise;
};

UnhappyTriggerHappy.prototype.saveListener = function (data) {
    var self = this;
    var defer = libQ.defer();
    var enabled = data.listener_enabled === true;
    var timing = listener.timingFrom(data);
    // The rows as the page showed them; the same rows again when no page
    // was rendered since the backend started.
    var rows = self._rows.length
        ? self._rows
        : listener.rows(devices.list(), listener.parseStored(self.config.get('listener_devices')));
    var taken = listener.takenDevices(rows, data);

    self.config.set('listener_enabled', enabled);
    Object.keys(timing).forEach(function (field) {
        self.config.set(field, timing[field]);
    });
    self.config.set('listener_devices', JSON.stringify(taken));

    var step;
    if (enabled) {
        self._writeListenerConfig();
        step = self._systemctl('enable --now ' + listener.UNIT).then(function () {
            return self._listener({ cmd: 'reload' }, 2000).catch(function () {
                // Just started: it read the file on its way up.
            });
        });
    } else {
        step = self._systemctl('disable --now ' + listener.UNIT);
    }

    step.then(function () {
        self.commandRouter.pushToastMessage('success', 'Unhappy TriggerHappy',
            self._t('LISTENER_SAVED'));
        defer.resolve();
    }).catch(function (err) {
        self.logger.error(LOG_PREFIX + 'save listener failed: ' + err.message);
        self.commandRouter.pushToastMessage('error', 'Unhappy TriggerHappy', err.message);
        defer.reject(err);
    });

    return defer.promise;
};

// The bindings page saved: the list edited, rows removed, the new row added.
UnhappyTriggerHappy.prototype.saveListenerBindings = function (data) {
    var self = this;
    var defer = libQ.defer();
    var result = listener.bindingsFromForm(self._bindings(), data);

    if (result.errors.length) {
        self.commandRouter.pushToastMessage('error', 'Unhappy TriggerHappy', result.errors.join('. '));
        defer.reject(new Error(result.errors.join('; ')));
        return defer.promise;
    }

    self.config.set('listener_bindings', JSON.stringify(result.bindings));
    self.config.set('captured_key', '');

    self._syncListener().then(function (answer) {
        if (answer && answer.ok === false) {
            self.commandRouter.pushToastMessage('error', 'Unhappy TriggerHappy',
                self._t('LISTENER_REFUSED') + ' ' + answer.error);
        } else if (answer && answer.warnings && answer.warnings.length) {
            self.commandRouter.pushToastMessage('warning', 'Unhappy TriggerHappy',
                self._t('LISTENER_DROPPED') + ' ' + answer.warnings.join('. '));
        } else {
            self.commandRouter.pushToastMessage('success', 'Unhappy TriggerHappy',
                self._t('BINDINGS_SAVED'));
        }
        self._refreshUi();
        defer.resolve();
    }).catch(function (err) {
        self.logger.error(LOG_PREFIX + 'save listener bindings failed: ' + err.message);
        self.commandRouter.pushToastMessage('error', 'Unhappy TriggerHappy', err.message);
        defer.reject(err);
    });

    return defer.promise;
};

// The wizard: the next key pressed on any remote, into the new row's key.
UnhappyTriggerHappy.prototype.captureKey = function () {
    var self = this;
    var defer = libQ.defer();

    if (self.config.get('listener_enabled') !== true) {
        self.commandRouter.pushToastMessage('error', 'Unhappy TriggerHappy', self._t('LISTENER_OFF'));
        defer.resolve();
        return defer.promise;
    }
    if (self._capturing) {
        defer.resolve();
        return defer.promise;
    }
    self._capturing = true;
    self.commandRouter.pushToastMessage('info', 'Unhappy TriggerHappy', self._t('PRESS_NOW'));

    self._listener({ cmd: 'capture', timeout_ms: CAPTURE_MS }, CAPTURE_MS + 2000).then(function (answer) {
        self._capturing = false;
        if (!answer || answer.ok !== true) {
            var why = answer && answer.error === 'timeout' ? self._t('CAPTURE_TIMEOUT') : String(answer && answer.error);
            self.commandRouter.pushToastMessage('warning', 'Unhappy TriggerHappy', why);
            defer.resolve();
            return;
        }
        var device = answer.device || {};
        var taken = listener.parseStored(self.config.get('listener_devices')).some(function (d) {
            return d.name === device.name;
        });
        self.config.set('captured_key', String(answer.key));
        self.commandRouter.pushToastMessage('success', 'Unhappy TriggerHappy',
            self._t('CAPTURED').replace('{key}', String(answer.key)).replace('{device}', String(device.name || '?'))
            + (taken ? '' : ' ' + self._t('CAPTURED_NOT_TAKEN')));
        self._refreshUi();
        defer.resolve();
    }).catch(function (err) {
        self._capturing = false;
        self.logger.warn(LOG_PREFIX + 'capture: ' + err.message);
        self.commandRouter.pushToastMessage('error', 'Unhappy TriggerHappy', self._t('LISTENER_NOT_RUNNING'));
        defer.resolve();
    });

    return defer.promise;
};

// The settings page again, to every browser that has it open.
UnhappyTriggerHappy.prototype._refreshUi = function () {
    var self = this;

    self.commandRouter.getUIConfigOnPlugin(PLUGIN_TYPE, PLUGIN_NAME, {}).then(function (uiconf) {
        self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
    });
};

UnhappyTriggerHappy.prototype._timing = function () {
    return listener.timingFrom({
        long_ms: this.config.get('long_ms'),
        double_ms: this.config.get('double_ms'),
        debounce_ms: this.config.get('debounce_ms')
    });
};

UnhappyTriggerHappy.prototype._uiFields = function () {
    var self = this;
    var fields = {};

    stockMap.STOCK_BINDINGS.forEach(function (row) {
        var stored = self.config.get(row.field);
        fields[row.field] = (stored === undefined || stored === null) ? row.command : stored;
    });
    return fields;
};

// The remote's bindings: its own list, or the editor's map while it has none.
UnhappyTriggerHappy.prototype._bindings = function () {
    var stored = listener.parseBindings(this.config.get('listener_bindings'));
    return stored.length ? stored : listener.seedBindings(this._uiFields());
};

// The listener's file from the config, and a reload when it is running.
// Resolves with the listener's answer, or nothing when it is not running.
UnhappyTriggerHappy.prototype._syncListener = function () {
    var self = this;

    if (self.config.get('listener_enabled') !== true) {
        return Promise.resolve(null);
    }
    self._writeListenerConfig();
    return self._listener({ cmd: 'reload' }, 2000).catch(function (err) {
        self.logger.warn(LOG_PREFIX + 'listener reload: ' + err.message);
        return null;
    });
};

UnhappyTriggerHappy.prototype._writeListenerConfig = function () {
    var self = this;
    var body = listener.configFor(
        listener.parseStored(self.config.get('listener_devices')),
        self._timing(),
        self._bindings()
    );
    var file = path.join(self._configDir, listener.CONFIG_BASENAME);

    fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
    self.logger.info(LOG_PREFIX + 'wrote ' + file);
};

UnhappyTriggerHappy.prototype._listener = function (body, timeoutMs) {
    return listenerClient.request(listener.SOCKET, body, timeoutMs);
};

UnhappyTriggerHappy.prototype._systemctl = function (args) {
    var self = this;

    return new Promise(function (resolve, reject) {
        exec(SYSTEMCTL + ' ' + args, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
            if (error) {
                self.logger.error(LOG_PREFIX + 'systemctl ' + args + ' failed: ' + (stderr || error.message));
                reject(new Error(stderr || error.message));
                return;
            }
            self.logger.info(LOG_PREFIX + 'systemctl ' + args + ' ok');
            resolve();
        });
    });
};

UnhappyTriggerHappy.prototype._restartTriggerhappy = function () {
    return this._systemctl('restart ' + SERVICE);
};

UnhappyTriggerHappy.prototype._readForeignTriggers = function () {
    var self = this;
    var texts = [];

    try {
        if (!fs.existsSync(stockMap.TRIGGERS_DIR)) {
            return texts;
        }
        var names = fs.readdirSync(stockMap.TRIGGERS_DIR);
        var i;
        for (i = 0; i < names.length; i++) {
            var name = names[i];
            if (!name || name === stockMap.TRIGGERS_BASENAME) {
                continue;
            }
            if (name.slice(-5) !== '.conf') {
                continue;
            }
            try {
                texts.push(fs.readFileSync(path.join(stockMap.TRIGGERS_DIR, name), 'utf8'));
            } catch (err) {
                self.logger.warn(LOG_PREFIX + 'skip unreadable ' + name + ': ' + err.message);
            }
        }
    } catch (err) {
        self.logger.warn(LOG_PREFIX + 'read foreign triggers failed: ' + err.message);
    }

    return texts;
};

UnhappyTriggerHappy.prototype._writeTriggers = function (body) {
    var self = this;

    return new Promise(function (resolve, reject) {
        var child = spawn('/usr/bin/sudo', ['/usr/bin/tee', stockMap.TRIGGERS_FILE], {
            uid: 1000,
            gid: 1000
        });
        var stderr = '';

        child.stderr.on('data', function (chunk) {
            stderr += chunk;
        });
        child.on('error', function (err) {
            reject(err);
        });
        child.on('close', function (code) {
            if (code === 0) {
                self.logger.info(LOG_PREFIX + 'wrote ' + stockMap.TRIGGERS_FILE);
                resolve();
            } else {
                reject(new Error(stderr || ('tee exited ' + code)));
            }
        });
        child.stdin.end(body);
    });
};

UnhappyTriggerHappy.prototype._removeTriggers = function () {
    var self = this;

    return new Promise(function (resolve, reject) {
        exec('/usr/bin/sudo /bin/rm -f ' + stockMap.TRIGGERS_FILE, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
            if (error) {
                self.logger.error(LOG_PREFIX + 'remove ' + stockMap.TRIGGERS_FILE + ' failed: ' +
                    (stderr || error.message));
                reject(error);
                return;
            }
            self.logger.info(LOG_PREFIX + 'removed ' + stockMap.TRIGGERS_FILE);
            resolve();
        });
    });
};

UnhappyTriggerHappy.prototype._t = function (key) {
    if (!this._strings) {
        try {
            this._strings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
        } catch (e) {
            this._strings = {};
        }
    }
    return (this._strings && this._strings[key]) || key;
};

UnhappyTriggerHappy.prototype._contentById = function (section, id) {
    var content = section.content;
    var i;

    for (i = 0; i < content.length; i++) {
        if (content[i].id === id) {
            return content[i];
        }
    }
    return null;
};
