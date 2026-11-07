'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;

module.exports = alsaRmeAdi2VolumeControl;

function alsaRmeAdi2VolumeControl(context) {
    var self = this;

    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;

    this.sudo_systemctl = '/usr/bin/sudo /bin/systemctl';
    this.service_name = 'alsa-rme-adi2-volume-control.service';
}

alsaRmeAdi2VolumeControl.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
}

alsaRmeAdi2VolumeControl.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();
    self.startOrStopService();
    return libQ.resolve();
};

alsaRmeAdi2VolumeControl.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();
    self.stopService();
    return libQ.resolve();
};

alsaRmeAdi2VolumeControl.prototype.onRestart = function() {
    var self = this;
    self.stopService();
    setTimeout(function() {
        self.startService();
    }, 1000);
};


// Systemd service control ---------------------------------------------------------------------------
alsaRmeAdi2VolumeControl.prototype.startOrStopService = function() {
    var self = this;
    if (self.config.get('service_active')) {
        self.startService();
    } else {
        self.stopService();
    }
}

alsaRmeAdi2VolumeControl.prototype.startService = function() {
    var self = this;
    var defer = libQ.defer();
    self.logger.info("Enabling and starting service ...");
    exec(self.sudo_systemctl + ' enable ' + self.service_name, { uid: 1000, gid: 1000 },
        function(error, stdout, stderr) {
            if (error !== null) {
                self.logger.error('ALSA RME ADI-2 Volume Control: cannot enable service - ' + error);
                defer.reject(error);
            } else {
                self.logger.info('ALSA RME ADI-2 Volume Control: service enabled');
                exec(self.sudo_systemctl + ' start ' + self.service_name, { uid: 1000, gid: 1000 },
                    function(error, stdout, stderr) {
                        if (error !== null) {
                            self.logger.error('ALSA RME ADI-2 Volume Control: cannot start service - ' + error);
                            defer.reject(error);
                        } else {
                            self.logger.info('ALSA RME ADI-2 Volume Control: service started');
                            defer.resolve();
                        }
                    }
                );
            }
        }
    );
    self.logger.info("Enabling and starting service ... done");
    return defer.promise;
};

alsaRmeAdi2VolumeControl.prototype.stopService = function() {
    var self = this;
    var defer = libQ.defer();
    self.logger.info("Stopping and disabling service ...");
    exec(self.sudo_systemctl + ' stop ' + self.service_name, { uid: 1000, gid: 1000 },
        function(error, stdout, stderr) {
            if (error !== null) {
                self.logger.error('ALSA RME ADI-2 Volume Control: cannot stop service - ' + error);
                defer.reject(error);
            } else {
                self.logger.info('ALSA RME ADI-2 Volume Control: service stopped');
                exec(self.sudo_systemctl + ' disable ' + self.service_name, { uid: 1000, gid: 1000 },
                    function(error, stdout, stderr) {
                        if (error !== null) {
                            self.logger.error('ALSA RME ADI-2 Volume Control: cannot disable service - ' + error);
                            defer.reject(error);
                        } else {
                            self.logger.info('ALSA RME ADI-2 Volume Control: service disabled');
                            defer.resolve();
                        }
                    }
                );
            }
        }
    );
    self.logger.info("Stopping and disabling service ... done");
    return defer.promise;
};

alsaRmeAdi2VolumeControl.prototype.applyServiceActive = function(data) {
    var self = this;

    var new_value = data['service_active'];
    self.config.set('service_active', new_value);
    self.config.save();
    self.logger.info('New value for service_active: ' + new_value);
    if (new_value) {
        self.onStart();
    } else {
        self.onStop();
    }
}


// Configuration Methods -----------------------------------------------------------------------------

alsaRmeAdi2VolumeControl.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    ).then(
        function(uiconf) {
            // service_active
            uiconf.sections[0].content[0].value = self.config.get("service_active", true);

            defer.resolve(uiconf);
        }
    ).fail(
        function() {
            defer.reject(new Error());
        }
    );

    return defer.promise;
};

alsaRmeAdi2VolumeControl.prototype.getConfigurationFiles = function() {
    return ['config.json'];
}

alsaRmeAdi2VolumeControl.prototype.logConfiguration = function(data) {
    self.logger.info('Configuration');
    self.logger.info('  device_name:     ' + data['device_name']);
    self.logger.info('  line12_max_db:   ' + data['line12_max_db']);
    self.logger.info('  line12_min_db:   ' + data['line12_min_db']);
    self.logger.info('  phones34_max_db: ' + data['phones34_max_db']);
    self.logger.info('  phones34_min_db: ' + data['phones34_min_db']);
    self.logger.info('  service_active:  ' + data['service_active']);
}

alsaRmeAdi2VolumeControl.prototype.setUIConfig = function(data) {
    var self = this;
    self.logConfiguration(data);
};

alsaRmeAdi2VolumeControl.prototype.getConf = function(varName) {
    var self = this;
    //Perform your installation tasks here
};

alsaRmeAdi2VolumeControl.prototype.setConf = function(varName, varValue) {
    var self = this;
    //Perform your installation tasks here
};

