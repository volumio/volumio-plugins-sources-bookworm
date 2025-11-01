'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;


module.exports = mupihat;
function mupihat(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
}

mupihat.prototype.onVolumioStart = function () {
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	return libQ.resolve();
}

mupihat.prototype.onStart = function () {
	var self = this;
	var defer = libQ.defer();

	// Generate the MuPiHAT configuration file on startup
	self.generateMuPiHATConfig();

	// Start the service (plugin enabled means service should run)
	self.startMuPiHATService();

	defer.resolve();

	return defer.promise;
};

mupihat.prototype.onStop = function () {
	var self = this;
	var defer = libQ.defer();

	self.stopMuPiHATService();
	defer.resolve();

	return defer.promise;
};

mupihat.prototype.onRestart = function () {
	var self = this;
	var defer = libQ.defer();

	self.stopMuPiHATService()
		.then(function () {
			setTimeout(function () {
				self.startMuPiHATService()
					.then(function () {
						defer.resolve();
					})
					.fail(function (err) {
						defer.reject(err);
					});
			}, 2000);
		})
		.fail(function (err) {
			defer.reject(err);
		});

	return defer.promise;
};

// Configuration Methods -----------------------------------------------------------------------------

mupihat.prototype.getUIConfig = function () {
	var defer = libQ.defer();
	var self = this;

	var lang_code = this.commandRouter.sharedVars.get('language_code');

	self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(function (uiconf) {
			// Battery Configuration section (now the only section)
			var batteryType = self.config.get('battery_type') || 'Custom';
			var currentLimit = self.config.get('current_limit') || 'safe';

			// Find and set battery type and current limit by ID instead of position
			for (var i = 0; i < uiconf.sections[0].content.length; i++) {
				var field = uiconf.sections[0].content[i];
				if (field.id === 'battery_type') {
					field.value = batteryType;
				} else if (field.id === 'current_limit') {
					field.value = currentLimit;
					// Ensure the field element is set to select
					field.element = 'select';
				}
			}

			// Custom battery settings (flattened to same level)
			// Find and update custom settings fields by their IDs
			for (var i = 0; i < uiconf.sections[0].content.length; i++) {
				var field = uiconf.sections[0].content[i];
				switch (field.id) {
					case 'custom_v_100':
						var configValue = self.config.get('custom_v_100');
						field.value = (configValue !== undefined && configValue !== null) ? configValue : 8100;
						break;
					case 'custom_v_75':
						var configValue = self.config.get('custom_v_75');
						field.value = (configValue !== undefined && configValue !== null) ? configValue : 7800;
						break;
					case 'custom_v_50':
						var configValue = self.config.get('custom_v_50');
						field.value = (configValue !== undefined && configValue !== null) ? configValue : 7400;
						break;
					case 'custom_v_25':
						var configValue = self.config.get('custom_v_25');
						field.value = (configValue !== undefined && configValue !== null) ? configValue : 7000;
						break;
					case 'custom_v_0':
						var configValue = self.config.get('custom_v_0');
						field.value = (configValue !== undefined && configValue !== null) ? configValue : 6700;
						break;
					case 'custom_th_warning':
						var configValue = self.config.get('custom_th_warning');
						field.value = (configValue !== undefined && configValue !== null) ? configValue : 7000;
						break;
					case 'custom_th_shutdown':
						var configValue = self.config.get('custom_th_shutdown');
						field.value = (configValue !== undefined && configValue !== null) ? configValue : 6700;
						break;
				}
			}

			defer.resolve(uiconf);
		})
		.fail(function () {
			defer.reject(new Error());
		});

	return defer.promise;
};

mupihat.prototype.getConfigurationFiles = function () {
	return ['config.json'];
}

mupihat.prototype.setUIConfig = function (data) {
	var self = this;
	var defer = libQ.defer();

	// Update battery configuration
	if (data['battery_type'] !== undefined) {
		self.config.set('battery_type', data['battery_type']);
	}
	if (data['current_limit'] !== undefined) {
		self.config.set('current_limit', data['current_limit']);
	}

	// Update custom battery settings
	if (data['custom_v_100'] !== undefined) {
		self.config.set('custom_v_100', data['custom_v_100']);
	}
	if (data['custom_v_75'] !== undefined) {
		self.config.set('custom_v_75', data['custom_v_75']);
	}
	if (data['custom_v_50'] !== undefined) {
		self.config.set('custom_v_50', data['custom_v_50']);
	}
	if (data['custom_v_25'] !== undefined) {
		self.config.set('custom_v_25', data['custom_v_25']);
	}
	if (data['custom_v_0'] !== undefined) {
		self.config.set('custom_v_0', data['custom_v_0']);
	}
	if (data['custom_th_warning'] !== undefined) {
		self.config.set('custom_th_warning', data['custom_th_warning']);
	}
	if (data['custom_th_shutdown'] !== undefined) {
		self.config.set('custom_th_shutdown', data['custom_th_shutdown']);
	}

	// Generate the MuPiHAT configuration file
	self.generateMuPiHATConfig();

	// Restart service when configuration changes (plugin is enabled by default)
	self.stopMuPiHATService()
		.then(function () {
			return self.startMuPiHATService();
		})
		.then(function () {
			self.commandRouter.pushToastMessage('success', "MuPiHAT", "Configuration updated");
			defer.resolve();
		})
		.fail(function (err) {
			self.logger.error('Failed to restart MuPiHAT service: ' + err);
			self.commandRouter.pushToastMessage('error', "MuPiHAT", "Configuration updated but service restart failed");
			defer.reject(err);
		});

	return defer.promise;
};

mupihat.prototype.getConf = function (varName) {
	var self = this;
	return self.config.get(varName);
};

mupihat.prototype.setConf = function (varName, varValue) {
	var self = this;
	self.config.set(varName, varValue);
};

mupihat.prototype.generateMuPiHATConfig = function () {
	var self = this;

	// Define predefined battery configurations
	var batteryConfigs = {
		"Ansmann 2S1P": {
			"v_100": "8100",
			"v_75": "7800",
			"v_50": "7400",
			"v_25": "7000",
			"v_0": "6700",
			"th_warning": "7000",
			"th_shutdown": "6800"
		},
		"ENERpower 2S2P 10.000mAh": {
			"v_100": "8000",
			"v_75": "7700",
			"v_50": "7300",
			"v_25": "6900",
			"v_0": "6000",
			"th_warning": "6500",
			"th_shutdown": "6150"
		},
		"USB-C mode (no battery)": {
			"v_100": "1",
			"v_75": "1",
			"v_50": "1",
			"v_25": "1",
			"v_0": "1",
			"th_warning": "0",
			"th_shutdown": "0"
		}
	};

	var batteryType = self.config.get('battery_type');
	var batteryConfig;

	// Get battery configuration
	if (batteryType === 'Custom') {
		// Use custom values from plugin configuration
		batteryConfig = {
			"v_100": (self.config.get('custom_v_100') || 8100).toString(),
			"v_75": (self.config.get('custom_v_75') || 7800).toString(),
			"v_50": (self.config.get('custom_v_50') || 7400).toString(),
			"v_25": (self.config.get('custom_v_25') || 7000).toString(),
			"v_0": (self.config.get('custom_v_0') || 6700).toString(),
			"th_warning": (self.config.get('custom_th_warning') || 7000).toString(),
			"th_shutdown": (self.config.get('custom_th_shutdown') || 6700).toString()
		};
	} else {
		// Use predefined configuration
		batteryConfig = batteryConfigs[batteryType] || batteryConfigs["Ansmann 2S1P"];
	}

	// Create the full MuPiHAT configuration object
	var mupihatConfig = {
		"mupihat": {
			"battery_types": Object.keys(batteryConfigs).map(function (name) {
				return {
					"name": name,
					"config": batteryConfigs[name]
				};
			}).concat([{
				"name": "Custom",
				"config": batteryType === 'Custom' ? batteryConfig : {
					"v_100": "8100",
					"v_75": "7800",
					"v_50": "7400",
					"v_25": "7000",
					"v_0": "6700",
					"th_warning": "7000",
					"th_shutdown": "6700"
				}
			}]),
			"selected_battery": batteryType
		}
	};

	// Write the configuration file
	var configPath = '/data/INTERNAL/mupihat/mupihatconfig.json';
	try {
		fs.writeFileSync(configPath, JSON.stringify(mupihatConfig, null, 2));
		self.logger.info('MuPiHAT configuration file updated: ' + configPath);
	} catch (err) {
		self.logger.error('Failed to write MuPiHAT configuration file: ' + err);
	}
};

// MuPiHAT Service Management -------------------------------------------------------------------------

mupihat.prototype.startMuPiHATService = function () {
	var self = this;
	var defer = libQ.defer();

	self.logger.info('Starting MuPiHAT Service');

	exec('sudo systemctl start mupi_hat.service', function (error, stdout, stderr) {
		if (error) {
			self.logger.error('Failed to start MuPiHAT service: ' + error);
			defer.reject(error);
		} else {
			self.logger.info('MuPiHAT service started successfully');
			defer.resolve();
		}
	});

	return defer.promise;
};

mupihat.prototype.stopMuPiHATService = function () {
	var self = this;
	var defer = libQ.defer();

	self.logger.info('Stopping MuPiHAT Service');

	exec('sudo systemctl stop mupi_hat.service', function (error, stdout, stderr) {
		if (error) {
			self.logger.error('Failed to stop MuPiHAT service: ' + error);
			defer.reject(error);
		} else {
			self.logger.info('MuPiHAT service stopped successfully');
			defer.resolve();
		}
	});

	return defer.promise;
};

mupihat.prototype.getMuPiHATStatus = function () {
	var self = this;
	var defer = libQ.defer();

	exec('sudo systemctl is-active mupi_hat.service', function (error, stdout, stderr) {
		if (error) {
			defer.resolve({ status: 'inactive', error: error.message });
		} else {
			var status = stdout.trim();
			defer.resolve({ status: status });
		}
	});

	return defer.promise;
};

mupihat.prototype.getBatteryStatus = function () {
	var self = this;
	var defer = libQ.defer();

	fs.readJson('/tmp/mupihat.json', function (err, data) {
		if (err) {
			// File doesn't exist or can't be read
			defer.resolve({ error: 'Battery data not available' });
		} else {
			defer.resolve(data);
		}
	});

	return defer.promise;
};

mupihat.prototype.showMuPiHATStatus = function () {
	var self = this;

	self.getMuPiHATStatus()
		.then(function (serviceStatus) {
			return self.getBatteryStatus()
				.then(function (batteryStatus) {
					var statusContent = '';

					// Service status
					statusContent += '<h4>Service Status</h4>';
					statusContent += '<ul><li>MuPiHAT Service: <strong>' + (serviceStatus.status === 'active' ? 'Running' : 'Stopped') + '</strong></li></ul>';

					// Battery/Power information
					if (batteryStatus && !batteryStatus.error) {
						statusContent += '<h4>Power Information</h4><ul>';

						if (batteryStatus.BatteryConnected !== undefined) {
							statusContent += '<li>Battery Connected: <strong>' + (batteryStatus.BatteryConnected ? 'Yes' : 'No') + '</strong></li>';
						}

						// Only show battery-specific information if battery is connected
						if (batteryStatus.BatteryConnected) {
							if (batteryStatus.Charger_Status !== undefined) {
								statusContent += '<li>Charger Status: <strong>' + batteryStatus.Charger_Status + '</strong></li>';
							}
							if (batteryStatus.Bat_Type !== undefined) {
								statusContent += '<li>Battery Type: <strong>' + batteryStatus.Bat_Type + '</strong></li>';
							}
							if (batteryStatus.Bat_SOC !== undefined && batteryStatus.Bat_SOC !== '') {
								statusContent += '<li>Battery Level: <strong>' + batteryStatus.Bat_SOC + '</strong></li>';
							}
							if (batteryStatus.Bat_Stat !== undefined && batteryStatus.Bat_Stat !== '') {
								statusContent += '<li>Battery Status: <strong>' + batteryStatus.Bat_Stat + '</strong></li>';
							}
							if (batteryStatus.Vbat !== undefined) {
								statusContent += '<li>Battery Voltage: <strong>' + batteryStatus.Vbat + ' mV</strong></li>';
							}
							if (batteryStatus.Ibat !== undefined) {
								statusContent += '<li>Battery Current: <strong>' + batteryStatus.Ibat + ' mA</strong></li>';
							}
						}

						if (batteryStatus.Vbus !== undefined) {
							statusContent += '<li>USB-C Voltage: <strong>' + batteryStatus.Vbus + ' mV</strong></li>';
						}
						if (batteryStatus.IBus !== undefined) {
							statusContent += '<li>USB-C Current: <strong>' + batteryStatus.IBus + ' mA</strong></li>';
						}
						if (batteryStatus.Input_Current_Limit !== undefined) {
							statusContent += '<li>Input Current Limit: <strong>' + batteryStatus.Input_Current_Limit + ' mA</strong></li>';
						}
						if (batteryStatus.Temp !== undefined) {
							statusContent += '<li>Temperature: <strong>' + batteryStatus.Temp + ' °C</strong></li>';
						}

						statusContent += '</ul>';
					} else {
						statusContent += '<h4>Power Information</h4>';
						statusContent += '<ul><li><em>No data available. Ensure the MuPiHAT service is running.</em></li></ul>';
					}

					var modalData = {
						title: 'MuPiHAT Status',
						message: statusContent,
						size: 'lg',
						buttons: [{
							name: 'Close',
							class: 'btn btn-warning',
							emit: 'closeModals',
							payload: ''
						}]
					};
					self.commandRouter.broadcastMessage('openModal', modalData);
				})
				.fail(function () {
					var modalData = {
						title: 'MuPiHAT Status',
						message: '<p>Unable to retrieve status information.</p>',
						size: 'lg',
						buttons: [{
							name: 'Close',
							class: 'btn btn-warning',
							emit: 'closeModals',
							payload: ''
						}]
					};
					self.commandRouter.broadcastMessage('openModal', modalData);
				});
		})
		.fail(function () {
			var modalData = {
				title: 'MuPiHAT Status',
				message: '<p>Unable to retrieve service status.</p>',
				size: 'lg',
				buttons: [{
					name: 'Close',
					class: 'btn btn-warning',
					emit: 'closeModals',
					payload: ''
				}]
			};
			self.commandRouter.broadcastMessage('openModal', modalData);
		});
};