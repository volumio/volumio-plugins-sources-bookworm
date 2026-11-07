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
        self.startOrStopService();
    }, 1000);
};


// Systemd service control ---------------------------------------------------------------------------
alsaRmeAdi2VolumeControl.prototype.startOrStopService = function() {
    var self = this;

    // Log the current configuration.
    self.logConfiguration();

    //
    // Start or stop the background service,
    // depending on the value of the 'service_active' boolean flag.
    //
    // This allows the end user to keep the plugin installed
    // (along with its configuration, possibly modified)
    // and start/stop the background service directly from the
    // Volumio plugin configuration UI.
    //
    if (self.config.get('service_active')) {
        self.startService();
    } else {
        self.stopService();
    }
}


alsaRmeAdi2VolumeControl.prototype.editServiceConfigurationAndRestart = function() {
    var self = this;

    // Log the current configuration.
    self.logConfiguration();

    // TODO
}

alsaRmeAdi2VolumeControl.prototype.startService = function() {
    var self = this;
    var defer = libQ.defer();

    // Enable and start the background service
    self.logger.info('Enabling and starting service ...');
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

    self.logger.info('Enabling and starting service ... done');
    return defer.promise;
};

alsaRmeAdi2VolumeControl.prototype.stopService = function() {
    var self = this;
    var defer = libQ.defer();

    // Stop and disable the background service
    self.logger.info('Stopping and disabling service ...');
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

    self.logger.info('Stopping and disabling service ... done');
    return defer.promise;
};

alsaRmeAdi2VolumeControl.prototype.applyServiceActive = function(data) {
    var self = this;

    self.config.set('service_active', data['service_active']);  // boolean
    self.config.save();

    // start and stop
    self.startOrStopService();
}

alsaRmeAdi2VolumeControl.prototype.applyServiceSettingsGeneral = function(data) {
    var self = this;

    self.config.set('device_name', data['device_name'].value);  // select
    self.config.set('verbose_log', data['verbose_log']);        // boolean
    self.config.save();

    // modify the service configuration and
    // restart the service so that changes can take effect
    self.editServiceConfigurationAndRestart();
}

alsaRmeAdi2VolumeControl.prototype.applyServiceSettingsLine12 = function(data) {
    var self = this;

    self.config.set('line12_active', data['line12_active']);        // boolean
    self.config.set('line12_min_db', data['line12_min_db'].value);  // select
    self.config.set('line12_max_db', data['line12_max_db'].value);  // select
    self.config.set('line12_volume', data['line12_volume'].value);  // select

    if (
        (!self.config.get('phones34_active')) &&
        (!self.config.get('line12_active'))
    ) {
        self.logger.error('Force line12_active to be true, since outputs cannot be both inactive.');
        self.config.set('line12_active', true);
    }

    var min_db = parseFloat(self.config.get('line12_min_db'));
    var max_db = parseFloat(self.config.get('line12_max_db'));
    if (min_db > max_db) {
        self.logger.error(
            'Force line12_min_db to be equal to line12_max_db, since the former cannot be greater than the latter.'
        );
        self.config.set('line12_min_db', max_db.toFixed(1));
    }

    self.config.save();

    // modify the service configuration and
    // restart the service so that changes can take effect
    self.editServiceConfigurationAndRestart();
}

alsaRmeAdi2VolumeControl.prototype.applyServiceSettingsPhones34 = function(data) {
    var self = this;

    self.config.set('phones34_active', data['phones34_active']);        // boolean
    self.config.set('phones34_min_db', data['phones34_min_db'].value);  // select
    self.config.set('phones34_max_db', data['phones34_max_db'].value);  // select
    self.config.set('phones34_volume', data['phones34_volume'].value);  // select

    if (
        (!self.config.get('line12_active')) &&
        (!self.config.get('phones34_active'))
    ) {
        self.logger.error('Force phones34_active to be true, since outputs cannot be both inactive.');
        self.config.set('phones34_active', true);
    }

    var min_db = parseFloat(self.config.get('phones34_min_db'));
    var max_db = parseFloat(self.config.get('phones34_max_db'));
    if (min_db > max_db) {
        self.logger.error(
            'Force phones34_min_db to be equal to phones34_max_db, since the former cannot be greater than the latter.'
        );
        self.config.set('phones34_min_db', max_db.toFixed(1));
    }

    self.config.save();

    // modify the service configuration and
    // restart the service so that changes can take effect
    self.editServiceConfigurationAndRestart();
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
            var v = '';

            self.logConfiguration();

            // sections[0] == service active
            v = self.config.get('service_active', true);
            uiconf.sections[0].content[0].value = v;

            // sections[1] == general
            v = self.config.get('device_name', 'autodetect');
            uiconf.sections[1].content[0].value.value = v;
            uiconf.sections[1].content[0].value.label = v;

            v = self.config.get('verbose_log', false);
            uiconf.sections[1].content[1].value = v;

            // sections[2] == line12
            v = self.config.get('line12_active', true);
            uiconf.sections[2].content[0].value = v;

            v = self.config.get('line12_min_db', '-60.0');
            uiconf.sections[2].content[1].value.value = v;
            uiconf.sections[2].content[1].value.label = v;

            v = self.config.get('line12_max_db', '-10.0');
            uiconf.sections[2].content[2].value.value = v;
            uiconf.sections[2].content[2].value.label = v;

            v = self.config.get('line12_volume', '50');
            uiconf.sections[2].content[3].value.value = v;
            uiconf.sections[2].content[3].value.label = v;

            // sections[3] == phones34
            v = self.config.get('phones34_active', true);
            uiconf.sections[3].content[0].value = v;

            v = self.config.get('phones34_min_db', '-60.0');
            uiconf.sections[3].content[1].value.value = v;
            uiconf.sections[3].content[1].value.label = v;

            v = self.config.get('phones34_max_db', '-10.0');
            uiconf.sections[3].content[2].value.value = v;
            uiconf.sections[3].content[2].value.label = v;

            v = self.config.get('phones34_volume', '50');
            uiconf.sections[3].content[3].value.value = v;
            uiconf.sections[3].content[3].value.label = v;

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

alsaRmeAdi2VolumeControl.prototype.logConfiguration = function() {
    var self = this;
    self.logger.info('Configuration');
    self.logger.info('  device_name:     ' + self.config.get('device_name', 'missing'));
    self.logger.info('  line12_active:   ' + self.config.get('line12_active', 'missing'));
    self.logger.info('  line12_max_db:   ' + self.config.get('line12_max_db', 'missing'));
    self.logger.info('  line12_min_db:   ' + self.config.get('line12_min_db', 'missing'));
    self.logger.info('  line12_volume:   ' + self.config.get('line12_volume', 'missing'));
    self.logger.info('  phones34_active: ' + self.config.get('phones34_active', 'missing'));
    self.logger.info('  phones34_max_db: ' + self.config.get('phones34_max_db', 'missing'));
    self.logger.info('  phones34_min_db: ' + self.config.get('phones34_min_db', 'missing'));
    self.logger.info('  phones34_volume: ' + self.config.get('phones34_volume', 'missing'));
    self.logger.info('  service_active:  ' + self.config.get('service_active', 'missing'));
    self.logger.info('  verbose_log:     ' + self.config.get('verbose_log', 'missing'));
}

alsaRmeAdi2VolumeControl.prototype.setUIConfig = function(data) {
    var self = this;
};

alsaRmeAdi2VolumeControl.prototype.getConf = function(varName) {
    var self = this;
    // nothing to do
};

alsaRmeAdi2VolumeControl.prototype.setConf = function(varName, varValue) {
    var self = this;
    // nothing to do
};

