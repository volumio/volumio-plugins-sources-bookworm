'use strict';

var libQ = require('kew');
var VConf = require('v-conf');

module.exports = ControllerExamplePlugin;

function ControllerExamplePlugin(context) {
	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
}

ControllerExamplePlugin.prototype.onVolumioStart = function () {
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	this.config = new VConf();
	this.config.loadFile(configFile);
	return libQ.resolve();
};

ControllerExamplePlugin.prototype.onStart = function () {
	this.logger.info('Example Plugin started');
	return libQ.resolve();
};

ControllerExamplePlugin.prototype.onStop = function () {
	this.logger.info('Example Plugin stopped');
	return libQ.resolve();
};

ControllerExamplePlugin.prototype.getConfigurationFiles = function () {
	return ['config.json'];
};

ControllerExamplePlugin.prototype.getUIConfig = function () {
	var self = this;
	var defer = libQ.defer();
	var langCode = self.commandRouter.sharedVars.get('language_code');

	self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + langCode + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(function (uiconf) {
			uiconf.sections[0].content[0].value = self.config.get('greeting');
			defer.resolve(uiconf);
		})
		.fail(function (error) {
			self.logger.error('Example Plugin: cannot load UI configuration: ' + error);
			defer.reject(error);
		});

	return defer.promise;
};

ControllerExamplePlugin.prototype.saveSettings = function (data) {
	this.config.set('greeting', String(data.greeting || ''));
	this.commandRouter.pushToastMessage('success', this.commandRouter.getI18nString('COMMON.CONFIGURATION_UPDATE'), this.commandRouter.getI18nString('COMMON.SETTINGS_SAVED_SUCCESSFULLY'));
	return libQ.resolve();
};
