'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var path = require('path');
var os = require('os');
var mqtt = require('mqtt');

module.exports = ControllerMqttClient;

function ControllerMqttClient(context) {
  var self = this;

  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;

  self.mqttClient = null;
  self.connected = false;
  self.connectionStatus = 'Disconnected';

  self.currentState = null;
  self.lastPublishedState = null;
  self.stateUpdateTimer = null;

  self.deviceId = null;
  self.baseTopic = null;

  self.i18nStrings = {};
  self.i18nStringsDefaults = {};
}

// ============================================================================
// LIFECYCLE METHODS
// ============================================================================

ControllerMqttClient.prototype.onVolumioStart = function() {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(
    self.context, 'config.json'
  );
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);

  return libQ.resolve();
};

ControllerMqttClient.prototype.onStart = function() {
  var self = this;
  var defer = libQ.defer();

  self.infoLog('Starting MQTT Client plugin');

  self.loadI18nStrings();

  self.deviceId = self.config.get('device_id', '');
  if (!self.deviceId || self.deviceId.trim() === '') {
    self.deviceId = os.hostname();
  }
  self.baseTopic = self.config.get('base_topic', 'volumio');

  self.infoLog('Device ID: ' + self.deviceId);
  self.infoLog('Base topic: ' + self.baseTopic);

  self.registerVolumioStateListener();

  if (self.config.get('enabled', false)) {
    self.connectMqtt()
      .then(function() {
        defer.resolve();
      })
      .fail(function(err) {
        self.errorLog('Failed to connect on startup: ' + err);
        defer.resolve();
      });
  } else {
    self.infoLog('MQTT client is disabled');
    defer.resolve();
  }

  return defer.promise;
};

ControllerMqttClient.prototype.onStop = function() {
  var self = this;
  var defer = libQ.defer();

  self.infoLog('Stopping MQTT Client plugin');

  if (self.stateUpdateTimer) {
    clearInterval(self.stateUpdateTimer);
    self.stateUpdateTimer = null;
  }

  self.disconnectMqtt()
    .then(function() {
      defer.resolve();
    })
    .fail(function(err) {
      self.errorLog('Error during disconnect: ' + err);
      defer.resolve();
    });

  return defer.promise;
};

ControllerMqttClient.prototype.onRestart = function() {
  var self = this;
  self.infoLog('Restarting MQTT Client plugin');
};

ControllerMqttClient.prototype.getConfigurationFiles = function() {
  return ['config.json'];
};

// ============================================================================
// UI CONFIGURATION
// ============================================================================

ControllerMqttClient.prototype.getUIConfig = function() {
  var self = this;
  var defer = libQ.defer();
  var lang_code = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + lang_code + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  )
    .then(function(uiconf) {
      // Connection Settings (section 0)
      uiconf.sections[0].content[0].value = self.config.get('enabled', false);
      uiconf.sections[0].content[1].value = self.config.get('broker_host', 'localhost');
      uiconf.sections[0].content[2].value = self.config.get('broker_port', 1883);
      uiconf.sections[0].content[3].value = self.config.get('broker_username', '');
      uiconf.sections[0].content[4].value = self.config.get('broker_password', '');

      // Topic Settings (section 1)
      uiconf.sections[1].content[0].value = self.config.get('base_topic', 'volumio');
      uiconf.sections[1].content[1].value = self.config.get('device_id', '');
      uiconf.sections[1].content[2].value = self.config.get('publish_full_state', true);
      uiconf.sections[1].content[3].value = self.config.get('publish_individual_topics', true);
      uiconf.sections[1].content[4].value = self.config.get('state_update_interval', 10);
      uiconf.sections[1].content[5].value = self.config.get('retain_state', true);

      // TLS Settings (section 2)
      uiconf.sections[2].content[0].value = self.config.get('tls_enabled', false);
      uiconf.sections[2].content[1].value = self.config.get('tls_ca_cert', '');
      uiconf.sections[2].content[2].value = self.config.get('tls_client_cert', '');
      uiconf.sections[2].content[3].value = self.config.get('tls_client_key', '');
      uiconf.sections[2].content[4].value = self.config.get('tls_reject_unauthorized', true);

      // Advanced Settings (section 3)
      uiconf.sections[3].content[0].value = self.config.get('client_id', '');
      uiconf.sections[3].content[1].value = self.config.get('keepalive', 60);
      uiconf.sections[3].content[2].value = self.config.get('reconnect_interval', 5000);

      var qosState = self.config.get('qos_state', 0);
      uiconf.sections[3].content[3].value = self.getQosOption(qosState);

      var qosCommand = self.config.get('qos_command', 1);
      uiconf.sections[3].content[4].value = self.getQosOption(qosCommand);

      var protocolVersion = self.config.get('protocol_version', 4);
      uiconf.sections[3].content[5].value = self.getProtocolVersionOption(protocolVersion);

      // Group Settings (section 4)
      uiconf.sections[4].content[0].value = self.config.get('group_topic_enabled', false);
      uiconf.sections[4].content[1].value = self.config.get('group_id', 'all');

      // Debug Settings (section 5)
      uiconf.sections[5].content[0].value = self.config.get('debug_enabled', false);
      uiconf.sections[5].content[1].value = self.connectionStatus;

      defer.resolve(uiconf);
    })
    .fail(function(err) {
      self.errorLog('Failed to load UI config: ' + err);
      defer.reject(new Error());
    });

  return defer.promise;
};

ControllerMqttClient.prototype.getQosOption = function(qos) {
  var labels = {
    0: '0 - At most once',
    1: '1 - At least once',
    2: '2 - Exactly once'
  };
  return {
    value: qos,
    label: labels[qos] || labels[0]
  };
};

ControllerMqttClient.prototype.getProtocolVersionOption = function(version) {
  var labels = {
    3: '3 - MQTT 3.1 (legacy)',
    4: '4 - MQTT 3.1.1 (recommended)',
    5: '5 - MQTT 5.0'
  };
  return {
    value: version,
    label: labels[version] || labels[4]
  };
};

// ============================================================================
// SAVE CONFIGURATION METHODS
// ============================================================================

ControllerMqttClient.prototype.saveConnectionSettings = function(data) {
  var self = this;
  var defer = libQ.defer();

  self.config.set('enabled', data.enabled);
  self.config.set('broker_host', data.broker_host);
  self.config.set('broker_port', data.broker_port);
  self.config.set('broker_username', data.broker_username);
  self.config.set('broker_password', data.broker_password);

  self.commandRouter.pushToastMessage(
    'success',
    self.getI18nString('TOAST_SETTINGS_SAVED'),
    self.getI18nString('TOAST_SETTINGS_SAVED_DESC')
  );

  self.reconnectMqtt();

  defer.resolve();
  return defer.promise;
};

ControllerMqttClient.prototype.saveTopicSettings = function(data) {
  var self = this;
  var defer = libQ.defer();

  self.config.set('base_topic', data.base_topic);
  self.config.set('device_id', data.device_id);
  self.config.set('publish_full_state', data.publish_full_state);
  self.config.set('publish_individual_topics', data.publish_individual_topics);
  self.config.set('state_update_interval', data.state_update_interval);
  self.config.set('retain_state', data.retain_state);

  self.baseTopic = data.base_topic || 'volumio';
  self.deviceId = data.device_id || os.hostname();

  self.commandRouter.pushToastMessage(
    'success',
    self.getI18nString('TOAST_SETTINGS_SAVED'),
    self.getI18nString('TOAST_SETTINGS_SAVED_DESC')
  );

  self.reconnectMqtt();

  defer.resolve();
  return defer.promise;
};

ControllerMqttClient.prototype.saveTlsSettings = function(data) {
  var self = this;
  var defer = libQ.defer();

  self.config.set('tls_enabled', data.tls_enabled);
  self.config.set('tls_ca_cert', data.tls_ca_cert);
  self.config.set('tls_client_cert', data.tls_client_cert);
  self.config.set('tls_client_key', data.tls_client_key);
  self.config.set('tls_reject_unauthorized', data.tls_reject_unauthorized);

  self.commandRouter.pushToastMessage(
    'success',
    self.getI18nString('TOAST_SETTINGS_SAVED'),
    self.getI18nString('TOAST_SETTINGS_SAVED_DESC')
  );

  self.reconnectMqtt();

  defer.resolve();
  return defer.promise;
};

ControllerMqttClient.prototype.saveAdvancedSettings = function(data) {
  var self = this;
  var defer = libQ.defer();

  self.config.set('client_id', data.client_id);
  self.config.set('keepalive', data.keepalive);
  self.config.set('reconnect_interval', data.reconnect_interval);
  self.config.set('qos_state', data.qos_state.value);
  self.config.set('qos_command', data.qos_command.value);
  self.config.set('protocol_version', data.protocol_version.value);

  self.commandRouter.pushToastMessage(
    'success',
    self.getI18nString('TOAST_SETTINGS_SAVED'),
    self.getI18nString('TOAST_SETTINGS_SAVED_DESC')
  );

  self.reconnectMqtt();

  defer.resolve();
  return defer.promise;
};

ControllerMqttClient.prototype.saveGroupSettings = function(data) {
  var self = this;
  var defer = libQ.defer();

  self.config.set('group_topic_enabled', data.group_topic_enabled);
  self.config.set('group_id', data.group_id);

  self.commandRouter.pushToastMessage(
    'success',
    self.getI18nString('TOAST_SETTINGS_SAVED'),
    self.getI18nString('TOAST_SETTINGS_SAVED_DESC')
  );

  self.reconnectMqtt();

  defer.resolve();
  return defer.promise;
};

ControllerMqttClient.prototype.saveDebugSettings = function(data) {
  var self = this;
  var defer = libQ.defer();

  self.config.set('debug_enabled', data.debug_enabled);

  self.commandRouter.pushToastMessage(
    'success',
    self.getI18nString('TOAST_SETTINGS_SAVED'),
    self.getI18nString('TOAST_SETTINGS_SAVED_DESC')
  );

  defer.resolve();
  return defer.promise;
};

ControllerMqttClient.prototype.testConnection = function() {
  var self = this;
  var defer = libQ.defer();

  self.infoLog('Testing MQTT connection');

  if (self.connected && self.mqttClient) {
    self.commandRouter.pushToastMessage(
      'success',
      self.getI18nString('TOAST_CONNECTION_SUCCESS'),
      self.getI18nString('TOAST_CONNECTION_SUCCESS_DESC')
    );
    defer.resolve();
    return defer.promise;
  }

  self.connectMqtt()
    .then(function() {
      self.commandRouter.pushToastMessage(
        'success',
        self.getI18nString('TOAST_CONNECTION_SUCCESS'),
        self.getI18nString('TOAST_CONNECTION_SUCCESS_DESC')
      );
      defer.resolve();
    })
    .fail(function(err) {
      self.commandRouter.pushToastMessage(
        'error',
        self.getI18nString('TOAST_CONNECTION_FAILED'),
        err.message || self.getI18nString('TOAST_CONNECTION_FAILED_DESC')
      );
      defer.resolve();
    });

  return defer.promise;
};

// ============================================================================
// MQTT CONNECTION MANAGEMENT
// ============================================================================

ControllerMqttClient.prototype.connectMqtt = function() {
  var self = this;
  var defer = libQ.defer();
  var promiseSettled = false;

  if (!self.config.get('enabled', false)) {
    self.debugLog('MQTT client disabled, not connecting');
    defer.resolve();
    return defer.promise;
  }

  var host = self.config.get('broker_host', 'localhost');
  var port = self.config.get('broker_port', 1883);
  var tlsEnabled = self.config.get('tls_enabled', false);
  var protocol = tlsEnabled ? 'mqtts' : 'mqtt';
  var brokerUrl = protocol + '://' + host + ':' + port;

  self.infoLog('Connecting to MQTT broker: ' + brokerUrl);

  var options = {
    clientId: self.config.get('client_id', '') || 'mqtt_' + self.deviceId + '_' + Date.now(),
    keepalive: self.config.get('keepalive', 60),
    reconnectPeriod: self.config.get('reconnect_interval', 5000),
    connectTimeout: 30000,
    clean: true,
    protocolVersion: self.config.get('protocol_version', 4)
  };

  var username = self.config.get('broker_username', '');
  var password = self.config.get('broker_password', '');
  if (username && username.trim() !== '') {
    options.username = username;
    options.password = password;
  }

  if (tlsEnabled) {
    options.rejectUnauthorized = self.config.get('tls_reject_unauthorized', true);

    var caCert = self.config.get('tls_ca_cert', '');
    if (caCert && fs.existsSync(caCert)) {
      options.ca = fs.readFileSync(caCert);
      self.debugLog('Loaded CA certificate: ' + caCert);
    }

    var clientCert = self.config.get('tls_client_cert', '');
    if (clientCert && fs.existsSync(clientCert)) {
      options.cert = fs.readFileSync(clientCert);
      self.debugLog('Loaded client certificate: ' + clientCert);
    }

    var clientKey = self.config.get('tls_client_key', '');
    if (clientKey && fs.existsSync(clientKey)) {
      options.key = fs.readFileSync(clientKey);
      self.debugLog('Loaded client key: ' + clientKey);
    }
  }

  var availabilityTopic = self.baseTopic + '/' + self.deviceId + '/available';
  options.will = {
    topic: availabilityTopic,
    payload: 'offline',
    qos: 1,
    retain: true
  };

  self.debugLog('MQTT options: ' + JSON.stringify({
    clientId: options.clientId,
    keepalive: options.keepalive,
    reconnectPeriod: options.reconnectPeriod,
    tls: tlsEnabled,
    hasCredentials: !!options.username
  }));

  try {
    self.mqttClient = mqtt.connect(brokerUrl, options);
  } catch (err) {
    self.errorLog('Failed to create MQTT client: ' + err);
    self.connectionStatus = 'Error: ' + err.message;
    defer.reject(err);
    return defer.promise;
  }

  self.mqttClient.on('connect', function() {
    self.infoLog('Connected to MQTT broker');
    self.connected = true;
    self.connectionStatus = 'Connected';

    self.mqttClient.publish(availabilityTopic, 'online', { qos: 1, retain: true });

    self.subscribeToCommands();
    self.startStatePublishing();
    self.publishCurrentState();

    if (!promiseSettled) {
      promiseSettled = true;
      defer.resolve();
    }
  });

  self.mqttClient.on('error', function(err) {
    self.errorLog('MQTT connection error: ' + err);
    self.connectionStatus = 'Error: ' + err.message;
    // Only reject the initial connection promise, not on reconnect errors
    if (!promiseSettled && !self.connected) {
      promiseSettled = true;
      defer.reject(err);
    }
  });

  self.mqttClient.on('close', function() {
    self.debugLog('MQTT connection closed');
    self.connected = false;
    self.connectionStatus = 'Disconnected';
  });

  self.mqttClient.on('reconnect', function() {
    self.debugLog('MQTT reconnecting...');
    self.connectionStatus = 'Reconnecting';
  });

  self.mqttClient.on('offline', function() {
    self.debugLog('MQTT client offline');
    self.connected = false;
    self.connectionStatus = 'Offline';
  });

  self.mqttClient.on('message', function(topic, message) {
    self.handleMqttMessage(topic, message.toString());
  });

  return defer.promise;
};

ControllerMqttClient.prototype.disconnectMqtt = function() {
  var self = this;
  var defer = libQ.defer();

  if (self.stateUpdateTimer) {
    clearInterval(self.stateUpdateTimer);
    self.stateUpdateTimer = null;
  }

  if (self.mqttClient) {
    var availabilityTopic = self.baseTopic + '/' + self.deviceId + '/available';
    self.mqttClient.publish(availabilityTopic, 'offline', { qos: 1, retain: true }, function() {
      self.mqttClient.end(true, {}, function() {
        self.infoLog('Disconnected from MQTT broker');
        self.mqttClient = null;
        self.connected = false;
        self.connectionStatus = 'Disconnected';
        defer.resolve();
      });
    });
  } else {
    defer.resolve();
  }

  return defer.promise;
};

ControllerMqttClient.prototype.reconnectMqtt = function() {
  var self = this;

  self.disconnectMqtt()
    .then(function() {
      return self.connectMqtt();
    })
    .fail(function(err) {
      self.errorLog('Reconnection failed: ' + err);
    });
};

// ============================================================================
// MQTT SUBSCRIPTIONS
// ============================================================================

ControllerMqttClient.prototype.subscribeToCommands = function() {
  var self = this;

  if (!self.mqttClient || !self.connected) {
    return;
  }

  var qos = self.config.get('qos_command', 1);
  var deviceTopic = self.baseTopic + '/' + self.deviceId;

  var commandTopics = [
    deviceTopic + '/command',
    deviceTopic + '/set/+'
  ];

  if (self.config.get('group_topic_enabled', false)) {
    var groupId = self.config.get('group_id', 'all');
    var groupTopic = self.baseTopic + '/group/' + groupId;
    commandTopics.push(groupTopic + '/set/+');
    self.debugLog('Subscribing to group topic: ' + groupTopic + '/set/+');
  }

  commandTopics.forEach(function(topic) {
    self.mqttClient.subscribe(topic, { qos: qos }, function(err) {
      if (err) {
        self.errorLog('Failed to subscribe to ' + topic + ': ' + err);
      } else {
        self.debugLog('Subscribed to: ' + topic);
      }
    });
  });
};

// ============================================================================
// MESSAGE HANDLING - COMMANDS
// ============================================================================

ControllerMqttClient.prototype.handleMqttMessage = function(topic, message) {
  var self = this;

  self.debugLog('Received message on topic: ' + topic + ' - payload: ' + message);

  var topicParts = topic.split('/');
  var command = topicParts[topicParts.length - 1];

  if (command === 'command') {
    self.handleJsonCommand(message);
    return;
  }

  var setIndex = topicParts.indexOf('set');
  if (setIndex !== -1 && setIndex < topicParts.length - 1) {
    command = topicParts[setIndex + 1];
    self.handleSetCommand(command, message);
    return;
  }

  self.debugLog('Unknown topic structure: ' + topic);
};

ControllerMqttClient.prototype.handleJsonCommand = function(message) {
  var self = this;

  try {
    var cmd = JSON.parse(message);
    var command = cmd.command || cmd.cmd || cmd.action;
    var value = cmd.value || cmd.val || cmd.data;

    if (command) {
      self.handleSetCommand(command, value !== undefined ? String(value) : '');
    } else {
      self.errorLog('JSON command missing command field: ' + message);
    }
  } catch (err) {
    self.errorLog('Failed to parse JSON command: ' + err);
  }
};

ControllerMqttClient.prototype.handleSetCommand = function(command, value) {
  var self = this;

  self.debugLog('Executing command: ' + command + ' with value: ' + value);

  switch (command.toLowerCase()) {
    case 'play':
      self.commandRouter.volumioPlay();
      break;

    case 'pause':
      self.commandRouter.volumioPause();
      break;

    case 'toggle':
      self.commandRouter.volumioToggle();
      break;

    case 'stop':
      self.commandRouter.volumioStop();
      break;

    case 'next':
      self.commandRouter.volumioNext();
      break;

    case 'previous':
    case 'prev':
      self.commandRouter.volumioPrevious();
      break;

    case 'volume':
      var vol = parseInt(value, 10);
      if (!isNaN(vol) && vol >= 0 && vol <= 100) {
        self.commandRouter.volumiosetvolume(vol);
      } else {
        self.errorLog('Invalid volume value: ' + value);
      }
      break;

    case 'mute':
      if (value === 'true' || value === '1' || value === 'on') {
        self.commandRouter.volumiosetvolume('mute');
      } else if (value === 'false' || value === '0' || value === 'off') {
        self.commandRouter.volumiosetvolume('unmute');
      } else if (value === 'toggle' || value === '') {
        self.commandRouter.volumiosetvolume('toggle');
      }
      break;

    case 'unmute':
      self.commandRouter.volumiosetvolume('unmute');
      break;

    case 'volumeplus':
    case 'volume_plus':
    case 'volplus':
    case 'vol+':
    case 'volumeup':
    case 'volume_up':
    case 'volup':
      self.commandRouter.volumiosetvolume('+');
      break;

    case 'volumeminus':
    case 'volume_minus':
    case 'volminus':
    case 'vol-':
    case 'volumedown':
    case 'volume_down':
    case 'voldown':
      self.commandRouter.volumiosetvolume('-');
      break;

    case 'seek':
      if (value === 'plus' || value === '+') {
        self.commandRouter.volumioSeek('+');
      } else if (value === 'minus' || value === '-') {
        self.commandRouter.volumioSeek('-');
      } else {
        var seekPos = parseInt(value, 10);
        if (!isNaN(seekPos)) {
          self.commandRouter.volumioSeek(seekPos);
        }
      }
      break;

    case 'repeat':
      if (value === 'true' || value === '1') {
        self.commandRouter.volumioRepeat(true);
      } else if (value === 'false' || value === '0') {
        self.commandRouter.volumioRepeat(false);
      } else {
        self.commandRouter.volumioRepeat();
      }
      break;

    case 'random':
    case 'shuffle':
      if (value === 'true' || value === '1') {
        self.commandRouter.volumioRandom(true);
      } else if (value === 'false' || value === '0') {
        self.commandRouter.volumioRandom(false);
      } else {
        self.commandRouter.volumioRandom();
      }
      break;

    case 'clear':
      self.commandRouter.volumioClearQueue();
      break;

    case 'vrestart':
    case 'restart':
      self.commandRouter.volumioRestart();
      break;

    default:
      self.debugLog('Unknown command: ' + command);
  }
};

// ============================================================================
// STATE PUBLISHING
// ============================================================================

ControllerMqttClient.prototype.registerVolumioStateListener = function() {
  var self = this;

  self.commandRouter.addCallback('volumioPushState', function(state) {
    self.onVolumioStateChange(state);
  });
};

ControllerMqttClient.prototype.onVolumioStateChange = function(state) {
  var self = this;

  self.currentState = state;

  if (self.connected && self.mqttClient) {
    self.publishState(state);
  }
};

ControllerMqttClient.prototype.startStatePublishing = function() {
  var self = this;

  if (self.stateUpdateTimer) {
    clearInterval(self.stateUpdateTimer);
    self.stateUpdateTimer = null;
  }

  var interval = self.config.get('state_update_interval', 10);

  if (interval > 0) {
    self.stateUpdateTimer = setInterval(function() {
      self.publishCurrentState();
    }, interval * 1000);

    self.debugLog('State publishing interval: ' + interval + ' seconds');
  }
};

ControllerMqttClient.prototype.publishCurrentState = function() {
  var self = this;

  if (!self.connected || !self.mqttClient) {
    return;
  }

  try {
    // volumioGetState returns state directly, not a promise
    var state = self.commandRouter.volumioGetState();
    if (state) {
      self.publishState(state);
    }
  } catch (err) {
    self.errorLog('Failed to get Volumio state: ' + err);
  }
};

ControllerMqttClient.prototype.publishState = function(state) {
  var self = this;

  if (!self.connected || !self.mqttClient || !state) {
    return;
  }

  var qos = self.config.get('qos_state', 0);
  var retain = self.config.get('retain_state', true);
  var baseTopic = self.baseTopic + '/' + self.deviceId;

  var mqttState = {
    status: state.status || 'unknown',
    title: state.title || '',
    artist: state.artist || '',
    album: state.album || '',
    albumart: state.albumart || '',
    volume: state.volume !== undefined ? state.volume : 0,
    mute: state.mute || false,
    repeat: state.repeat || false,
    repeatSingle: state.repeatSingle || false,
    random: state.random || false,
    seek: state.seek || 0,
    duration: state.duration || 0,
    samplerate: state.samplerate || '',
    bitdepth: state.bitdepth || '',
    channels: state.channels || 0,
    service: state.service || '',
    uri: state.uri || '',
    trackType: state.trackType || ''
  };

  if (self.config.get('publish_full_state', true)) {
    var fullStateTopic = baseTopic + '/status';
    var payload = JSON.stringify(mqttState);
    
    self.mqttClient.publish(fullStateTopic, payload, { qos: qos, retain: retain });
    self.debugLog('Published full state to: ' + fullStateTopic);
  }

  if (self.config.get('publish_individual_topics', true)) {
    var individualTopics = {
      'status/state': mqttState.status,
      'status/title': mqttState.title,
      'status/artist': mqttState.artist,
      'status/album': mqttState.album,
      'status/albumart': mqttState.albumart,
      'status/volume': String(mqttState.volume),
      'status/mute': String(mqttState.mute),
      'status/repeat': String(mqttState.repeat),
      'status/random': String(mqttState.random),
      'status/seek': String(mqttState.seek),
      'status/duration': String(mqttState.duration),
      'status/samplerate': mqttState.samplerate,
      'status/bitdepth': mqttState.bitdepth,
      'status/service': mqttState.service
    };

    Object.keys(individualTopics).forEach(function(subTopic) {
      var topic = baseTopic + '/' + subTopic;
      var value = individualTopics[subTopic];
      
      self.mqttClient.publish(topic, value, { qos: qos, retain: retain });
    });

    self.debugLog('Published individual state topics');
  }

  self.lastPublishedState = mqttState;
};

// ============================================================================
// I18N - INTERNATIONALIZATION
// ============================================================================

ControllerMqttClient.prototype.loadI18nStrings = function() {
  var self = this;

  try {
    var lang_code = self.commandRouter.sharedVars.get('language_code');
    var langFile = __dirname + '/i18n/strings_' + lang_code + '.json';

    if (fs.existsSync(langFile)) {
      self.i18nStrings = fs.readJsonSync(langFile);
    } else {
      self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }
  } catch (e) {
    self.i18nStrings = {};
  }

  try {
    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
  } catch (e) {
    self.i18nStringsDefaults = {};
  }
};

ControllerMqttClient.prototype.getI18nString = function(key) {
  var self = this;

  if (self.i18nStrings[key] !== undefined) {
    return self.i18nStrings[key];
  }
  if (self.i18nStringsDefaults[key] !== undefined) {
    return self.i18nStringsDefaults[key];
  }
  return key;
};

// ============================================================================
// LOGGING
// ============================================================================

ControllerMqttClient.prototype.infoLog = function(message) {
  var self = this;
  self.logger.info('[MQTT] ' + message);
};

ControllerMqttClient.prototype.errorLog = function(message) {
  var self = this;
  self.logger.error('[MQTT] ' + message);
};

ControllerMqttClient.prototype.debugLog = function(message) {
  var self = this;
  if (self.config && self.config.get('debug_enabled', false)) {
    self.logger.info('[MQTT-Debug] ' + message);
  }
};
