'use strict';

// The Volumio side of Unspike. The work is done by a systemd unit the
// installer puts in place (systemd/unspike.service), which runs before the
// player's services on the one kernel it is for. This file switches that
// unit on with the plugin and off with it, and says on the settings page
// what the unit found.

var libQ = require('kew');
var fs = require('fs');
var os = require('os');
var path = require('path');
var exec = require('child_process').exec;
var status = require('./lib/status');

var SERVICE = 'unspike.service';
// What the unit leaves when it has set the variable at this start.
var MARK = '/run/unspike.set';
var id = 'unspike: ';

module.exports = Unspike;

function Unspike(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
}

Unspike.prototype.onVolumioStart = function () {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

Unspike.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

// Switched on, the unit runs at every start from the next one. It has done
// nothing for the start the player is in: where that matters, the page
// asks for a restart, once.
Unspike.prototype.onStart = function () {
    var self = this;
    self.commandRouter.loadI18nStrings();
    return self.systemctl('enable')
        .then(function () { return self.read(); })
        .then(function (found) {
            if (found.code === 'pending') {
                self.commandRouter.broadcastMessage('openModal', {
                    title: self.commandRouter.getI18nString('UNSPIKE.RESTART_TITLE'),
                    message: self.commandRouter.getI18nString('UNSPIKE.RESTART_MSG'),
                    size: 'lg',
                    buttons: [
                        { name: self.commandRouter.getI18nString('COMMON.RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
                        { name: self.commandRouter.getI18nString('COMMON.CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' }
                    ]
                });
            }
        })
        .fail(function (e) {
            self.commandRouter.pushToastMessage('error', self.commandRouter.getI18nString('UNSPIKE.PLUGIN_NAME'),
                self.commandRouter.getI18nString('UNSPIKE.SERVICE_FAILED').replace('{{error}}', e && e.message ? e.message : e));
        });
};

// Switched off, the unit no longer runs at a start. The start the player is
// in stays as it is.
Unspike.prototype.onStop = function () {
    return this.systemctl('disable').fail(function () { /* said in the log */ });
};

Unspike.prototype.onRestart = function () { };
Unspike.prototype.onInstall = function () { };
Unspike.prototype.onUninstall = function () { };

Unspike.prototype.systemctl = function (verb) {
    var self = this;
    var defer = libQ.defer();
    exec('/usr/bin/sudo /bin/systemctl ' + verb + ' ' + SERVICE, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
        if (error) {
            self.logger.error(id + 'systemctl ' + verb + ': ' + String(stderr || error).trim());
            defer.reject(new Error(String(stderr || error.message || error).trim()));
        } else {
            defer.resolve();
        }
    });
    return defer.promise;
};

// What a command prints, or nothing where it cannot be run.
Unspike.prototype.said = function (command) {
    var defer = libQ.defer();
    exec(command, { maxBuffer: 4 * 1024 * 1024 }, function (error, stdout) {
        defer.resolve(error ? '' : String(stdout));
    });
    return defer.promise;
};

// The state of things on this player: see lib/status.js.
Unspike.prototype.read = function () {
    var self = this;
    return libQ.all([
        self.said('/bin/systemctl show-environment'),
        self.said('/bin/systemctl show -p Environment volumio.service wireless.service'),
        self.said('/bin/ps -eLo comm')
    ]).then(function (out) {
        return status.state({
            release: os.release(),
            manager: out[0],
            services: out[1],
            threads: out[2],
            mark: fs.existsSync(MARK)
        });
    });
};

Unspike.prototype.sentence = function (found) {
    var self = this;
    return status.sentence(found, {
        not_needed: self.commandRouter.getI18nString('UNSPIKE.STATE_NOT_NEEDED'),
        active: self.commandRouter.getI18nString('UNSPIKE.STATE_ACTIVE'),
        system: self.commandRouter.getI18nString('UNSPIKE.STATE_SYSTEM'),
        pending: self.commandRouter.getI18nString('UNSPIKE.STATE_PENDING')
    });
};

// -----------------------------------------------------------------------------
// The settings page: what was found on this player, and what the plugin does.
// -----------------------------------------------------------------------------

Unspike.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();
    var lang = self.commandRouter.sharedVars.get('language_code');
    self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json'))
        .then(function (uiconf) {
            return self.read().then(function (found) {
                uiconf.sections[0].description = self.sentence(found);
                defer.resolve(uiconf);
            });
        })
        .fail(function (e) {
            self.logger.error(id + 'UI config: ' + e);
            defer.reject(new Error());
        });
    return defer.promise;
};

Unspike.prototype.setUIConfig = function () { };
Unspike.prototype.getConf = function (varName) { return this.config.get(varName); };
Unspike.prototype.setConf = function (varName, varValue) { this.config.set(varName, varValue); };

Unspike.prototype.check = function () {
    var self = this;
    return self.read().then(function (found) {
        self.commandRouter.pushToastMessage(found.code === 'pending' ? 'warning' : 'info',
            self.commandRouter.getI18nString('UNSPIKE.PLUGIN_NAME'), self.sentence(found));
    });
};

// called from commandrouter to find the language file
Unspike.prototype.getI18nFile = function (langCode) {
    var i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
    var langFile = 'strings_' + langCode + '.json';
    if (i18nFiles.some(function (f) { return f === langFile; })) {
        return path.join(__dirname, 'i18n', langFile);
    }
    return path.join(__dirname, 'i18n', 'strings_en.json');
};
