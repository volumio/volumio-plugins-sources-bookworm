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
    self.logger.info("Enabling and starting service ...");
    self.startService();
    self.logger.info("Enabling and starting service ... done");
    return defer.promise;
};

alsaRmeAdi2VolumeControl.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();
    self.logger.info("Stopping and disabling service ...");
    self.stopService();
    self.logger.info("Stopping and disabling service ... done");
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
alsaRmeAdi2VolumeControl.prototype.startService = function() {
    var self = this;
    var defer = libQ.defer();
    exec('/usr/bin/sudo /bin/systemctl enable alsa-rme-adi2-volume-control.service', { uid: 1000, gid: 1000 },
        function(error, stdout, stderr) {
            if (error !== null) {
                self.logger.error('ALSA RME ADI-2 Volume Control: cannot enable service - ' + error);
                defer.reject(error);
            } else {
                self.logger.info('ALSA RME ADI-2 Volume Control: service enabled');
                exec('/usr/bin/sudo /bin/systemctl start alsa-rme-adi2-volume-control.service', { uid: 1000, gid: 1000 },
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
    return defer.promise;
};

alsaRmeAdi2VolumeControl.prototype.stopService = function() {
    var self = this;
    var defer = libQ.defer();
    exec('/usr/bin/sudo /bin/systemctl stop alsa-rme-adi2-volume-control.service', { uid: 1000, gid: 1000 },
        function(error, stdout, stderr) {
            if (error !== null) {
                self.logger.error('ALSA RME ADI-2 Volume Control: cannot stop service - ' + error);
                defer.reject(error);
            } else {
                self.logger.info('ALSA RME ADI-2 Volume Control: service stopped');
                exec('/usr/bin/sudo /bin/systemctl disable alsa-rme-adi2-volume-control.service', { uid: 1000, gid: 1000 },
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
    return defer.promise;
};


// Configuration Methods -----------------------------------------------------------------------------

alsaRmeAdi2VolumeControl.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

alsaRmeAdi2VolumeControl.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

alsaRmeAdi2VolumeControl.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

alsaRmeAdi2VolumeControl.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

alsaRmeAdi2VolumeControl.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

