'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var childProcess = require('child_process');
var exec = childProcess.exec;
var execFile = childProcess.execFile;
var http = require('http');
var path = require('path');

var CONFIG_TOML = '/data/configuration/user_interface/vinyltron/config.toml';
var BUNDLED_CONFIG_TOML = __dirname + '/vinyltron/config.toml';
var DEFAULT_IDLE_FOLDER = '/data/INTERNAL/Vinyltron/idle-images';
var IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'];
var SYSTEMCTL = '/usr/bin/sudo /bin/systemctl';
// Binds to all interfaces — designed for trusted home LAN use, no authentication
var PHOTO_MANAGER_HOST = '0.0.0.0';
var PHOTO_MANAGER_PORT_DEFAULT = 3018;
var PHOTO_MANAGER_PORT_MIN = 1024;
var PHOTO_MANAGER_PORT_MAX = 65535;
var PHOTO_MANAGER_MAX_BYTES = 32 * 1024 * 1024;

module.exports = ControllerVinyltron;

function ControllerVinyltron(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
    this.photoServer = null;
    this.photoManagerError = null;
}

ControllerVinyltron.prototype.onVolumioStart = function() {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    this._ensureDaemonConfig();
    this._syncVConfFromToml();
    return libQ.resolve();
};

ControllerVinyltron.prototype.onStart = function() {
    this._startPhotoManager();
    return this._service('start', 'plugin start', true);
};

ControllerVinyltron.prototype.onStop = function() {
    this._stopPhotoManager();
    return this._service('stop', 'plugin stop');
};

ControllerVinyltron.prototype.onRestart = function() {
    return this._service('restart', 'plugin restart', true);
};

ControllerVinyltron.prototype.onInstall = function() {
    return libQ.resolve();
};

ControllerVinyltron.prototype.onUninstall = function() {
    return libQ.resolve();
};

ControllerVinyltron.prototype.setUIConfig = function(data) {
    return libQ.resolve();
};

ControllerVinyltron.prototype.getAdditionalConf = function() {
    var self = this;
    var defer = libQ.defer();
    exec(SYSTEMCTL + ' is-active vinyltron', function(error, stdout) {
        defer.resolve({
            service_active: !error && stdout && stdout.trim() === 'active',
            config_path: CONFIG_TOML,
            photo_manager_url: self._photoManagerUrl(),
            photo_manager_error: self.photoManagerError
        });
    });
    return defer.promise;
};

ControllerVinyltron.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    try {
        var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');
        var s = uiconf.sections;

        var brightness = self.config.get('brightness').toString();
        s[0].content[0].value = {value: brightness, label: brightness + '%'};
        var gamma = self.config.get('gamma');
        s[0].content[1].value = {value: gamma, label: gamma};
        s[0].content[2].value = self.config.get('volumio_artwork_enabled') !== false;
        var saved_progress_bar_height = self.config.get('progress_bar_height');
        var progress_bar_height = (saved_progress_bar_height === undefined || saved_progress_bar_height === null ? 0 : saved_progress_bar_height).toString();
        s[0].content[3].value = progress_bar_height;
        var progress_bar_foreground = self.config.get('progress_bar_foreground') || '255,255,255';
        s[0].content[4].value = progress_bar_foreground;
        var progress_bar_background = self.config.get('progress_bar_background');
        if (progress_bar_background === undefined || progress_bar_background === null) progress_bar_background = '';
        s[0].content[5].value = progress_bar_background;
        s[0].content[6].value = self.config.get('format_badge');
        var format_font = self.config.get('format_font') || 'tom_thumb';
        s[0].content[7].value = {value: format_font, label: self._labelForFormatFont(format_font)};
        var badge_duration = (self.config.get('badge_duration') || 10).toString();
        s[0].content[8].value = badge_duration;
        var startup_delay_seconds = self._validStartupDelaySeconds(self.config.get('startup_delay_seconds'));
        s[0].content[9].value = startup_delay_seconds.toString();

        var fallback_mode = self._validFallbackMode(self.config.get('fallback_mode') || 'single');
        var fallback_image_folder = self.config.get('fallback_image_folder') || DEFAULT_IDLE_FOLDER;
        var fallback_selected_image = self.config.get('fallback_selected_image') || '';
        var fallback_rotate_seconds = self.config.get('fallback_rotate_seconds');
        if (fallback_rotate_seconds === undefined || fallback_rotate_seconds === null) fallback_rotate_seconds = 300;
        fallback_rotate_seconds = self._validFallbackRotateSeconds(fallback_rotate_seconds);
        var idle_options = self._idleImageOptions(fallback_image_folder);
        s[1].content[0].value = {value: fallback_mode, label: self._labelForFallbackMode(fallback_mode)};
        s[1].content[1].value = fallback_image_folder;
        s[1].content[2].options = idle_options;
        s[1].content[2].value = {
            value: fallback_selected_image,
            label: self._labelForIdleImage(fallback_selected_image, idle_options)
        };
        s[1].content[3].value = fallback_rotate_seconds.toString();
        var photo_manager_port = self._photoManagerPort();
        if (self.photoManagerError) {
            s[1].content[4].value = 'Unavailable on port ' + photo_manager_port + ': ' + self.photoManagerError + '. Change Photo Manager Port below and save.';
        } else {
            s[1].content[4].value = self._photoManagerUrl();
        }
        s[1].content[5].value = photo_manager_port.toString();

        var screensaver_engine = self._validScreensaverEngine(self.config.get('screensaver_engine') || 'brians_brain');
        s[2].content[0].value = {value: screensaver_engine, label: self._labelForScreensaverEngine(screensaver_engine)};
        var screensaver_palette = self.config.get('screensaver_palette') || 'cyan_amber';
        screensaver_palette = self._validScreensaverPalette(screensaver_palette);
        s[2].content[1].value = {value: screensaver_palette, label: self._labelForScreensaverPalette(screensaver_palette)};
        var screensaver_fps = self._validScreensaverFps(self.config.get('screensaver_fps'));
        s[2].content[2].value = {value: screensaver_fps.toString(), label: self._labelForScreensaverFps(screensaver_fps)};
        var screensaver_reset_seconds = self._validScreensaverResetSeconds(self.config.get('screensaver_reset_seconds'));
        s[2].content[3].value = screensaver_reset_seconds.toString();

        s[5].content[0].value = self.config.get('weather_location_label') || '';
        var weather_latitude = self._validWeatherLatitude(self.config.get('weather_latitude'));
        s[5].content[1].value = weather_latitude.toString();
        var weather_longitude = self._validWeatherLongitude(self.config.get('weather_longitude'));
        s[5].content[2].value = weather_longitude.toString();
        var weather_units = self._validWeatherUnits(self.config.get('weather_units') || 'imperial');
        s[5].content[3].value = {value: weather_units, label: self._labelForWeatherUnits(weather_units)};
        var weather_refresh_minutes = self._validWeatherRefreshMinutes(self.config.get('weather_refresh_minutes'));
        s[5].content[4].value = {value: weather_refresh_minutes.toString(), label: weather_refresh_minutes + ' minutes'};
        var weather_night_icon = self._validWeatherNightIcon(self.config.get('weather_night_icon') || 'moon');
        s[5].content[5].value = {value: weather_night_icon, label: self._labelForWeatherNightIcon(weather_night_icon)};
        var weather_secondary_metric = self._validWeatherSecondaryMetric(self.config.get('weather_secondary_metric') || 'humidity');
        s[5].content[6].value = {value: weather_secondary_metric, label: self._labelForWeatherSecondaryMetric(weather_secondary_metric)};
        var weather_fps = self._validWeatherFps(self.config.get('weather_fps'));
        s[5].content[7].value = {value: weather_fps.toString(), label: self._labelForWeatherFps(weather_fps)};

        var rotation = self.config.get('rotation');
        s[3].content[0].value = {value: rotation, label: rotation + '°'};
        var hardware_mapping = self.config.get('hardware_mapping') || 'adafruit-hat-pwm';
        s[3].content[1].value = {value: hardware_mapping, label: self._labelForHardwareMapping(hardware_mapping)};
        var limit_refresh_rate_hz = self.config.get('limit_refresh_rate_hz');
        if (limit_refresh_rate_hz === undefined || limit_refresh_rate_hz === null) limit_refresh_rate_hz = 0;
        limit_refresh_rate_hz = parseInt(limit_refresh_rate_hz);
        if (isNaN(limit_refresh_rate_hz)) limit_refresh_rate_hz = 0;
        limit_refresh_rate_hz = self._validRefreshLimit(limit_refresh_rate_hz);
        s[3].content[2].value = limit_refresh_rate_hz.toString();

        s[4].content[0].value = self.config.get('display_on');
        s[4].content[1].value = self.config.get('schedule_enabled');
        s[4].content[2].value = self.config.get('schedule_on_time') || '08:00';
        s[4].content[3].value = self.config.get('schedule_off_time') || '23:00';

        defer.resolve(uiconf);
    } catch (e) {
        self.logger.error('Vinyltron: getUIConfig failed: ' + e);
        defer.reject(new Error(e));
    }

    return defer.promise;
};

ControllerVinyltron.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

ControllerVinyltron.prototype._ensureDaemonConfig = function() {
    try {
        if (fs.existsSync(CONFIG_TOML)) return;
        fs.ensureDirSync(path.dirname(CONFIG_TOML));
        fs.copySync(BUNDLED_CONFIG_TOML, CONFIG_TOML);
        this.logger.info('Vinyltron: created daemon config at ' + CONFIG_TOML);
    } catch (e) {
        this.logger.error('Vinyltron: failed to create daemon config: ' + e);
    }
};

ControllerVinyltron.prototype._service = function(action, reason, rejectOnError) {
    var self = this;
    var defer = libQ.defer();
    var allowed = ['start', 'stop', 'restart', 'reload'];
    if (allowed.indexOf(action) === -1) {
        defer.reject(new Error('Unsupported service action: ' + action));
        return defer.promise;
    }

    exec(SYSTEMCTL + ' ' + action + ' vinyltron', function(error) {
        if (error) {
            self.logger.error('Vinyltron: service ' + action + ' failed after ' + reason + ': ' + error);
            if (rejectOnError) {
                defer.reject(error);
                return;
            }
        } else {
            self.logger.info('Vinyltron: service ' + action + ' requested after ' + reason);
        }
        defer.resolve();
    });
    return defer.promise;
};

ControllerVinyltron.prototype._syncVConfFromToml = function() {
    try {
        var content = fs.readFileSync(CONFIG_TOML, 'utf8');
        var mappings = [
            ['display', 'brightness', 'brightness', 'number'],
            ['display', 'gamma', 'gamma', 'string'],
            ['display', 'rotation', 'rotation', 'string'],
            ['display', 'hardware_mapping', 'hardware_mapping', 'string'],
            ['display', 'limit_refresh_rate_hz', 'limit_refresh_rate_hz', 'number'],
            ['display', 'startup_delay_seconds', 'startup_delay_seconds', 'number'],
            ['display', 'display_on', 'display_on', 'boolean'],
            ['volumio', 'artwork_enabled', 'volumio_artwork_enabled', 'boolean'],
            ['fallback', 'mode', 'fallback_mode', 'string'],
            ['fallback', 'image_folder', 'fallback_image_folder', 'string'],
            ['fallback', 'selected_image', 'fallback_selected_image', 'string'],
            ['fallback', 'rotate_seconds', 'fallback_rotate_seconds', 'number'],
            ['screensaver', 'engine', 'screensaver_engine', 'string'],
            ['screensaver', 'palette', 'screensaver_palette', 'string'],
            ['screensaver', 'fps', 'screensaver_fps', 'number'],
            ['screensaver', 'reset_seconds', 'screensaver_reset_seconds', 'number'],
            ['weather', 'source', 'weather_source', 'string'],
            ['weather', 'latitude', 'weather_latitude', 'number'],
            ['weather', 'longitude', 'weather_longitude', 'number'],
            ['weather', 'location_label', 'weather_location_label', 'string'],
            ['weather', 'units', 'weather_units', 'string'],
            ['weather', 'refresh_minutes', 'weather_refresh_minutes', 'number'],
            ['weather', 'night_icon', 'weather_night_icon', 'string'],
            ['weather', 'fps', 'weather_fps', 'number'],
            ['weather', 'mock_condition', 'weather_mock_condition', 'string'],
            ['weather', 'mock_night', 'weather_mock_night', 'boolean'],
            ['weather', 'mock_moon_phase', 'weather_mock_moon_phase', 'number'],
            ['weather', 'secondary_metric', 'weather_secondary_metric', 'string'],
            ['overlays', 'progress_bar', 'progress_bar', 'boolean'],
            ['overlays', 'progress_bar_height', 'progress_bar_height', 'number'],
            ['overlays', 'progress_bar_foreground', 'progress_bar_foreground', 'rgb'],
            ['overlays', 'progress_bar_background', 'progress_bar_background', 'rgb'],
            ['overlays', 'format_badge', 'format_badge', 'boolean'],
            ['overlays', 'format_font', 'format_font', 'string'],
            ['overlays', 'badge_duration', 'badge_duration', 'number'],
            ['schedule', 'enabled', 'schedule_enabled', 'boolean'],
            ['schedule', 'on_time', 'schedule_on_time', 'string'],
            ['schedule', 'off_time', 'schedule_off_time', 'string']
        ];

        for (var i = 0; i < mappings.length; i++) {
            var m = mappings[i];
            var raw = this._tomlValue(content, m[0], m[1]);
            if (raw !== null) {
                this.config.set(m[2], this._coerceTomlValue(raw, m[3]));
            }
        }
        this.logger.info('Vinyltron: synchronized plugin settings from ' + CONFIG_TOML);
    } catch (e) {
        this.logger.error('Vinyltron: failed to synchronize plugin settings from TOML: ' + e);
    }
};

// Save idle image settings — hot via SIGHUP, no restart needed
ControllerVinyltron.prototype.saveIdle = function(data) {
    var self = this;
    data = data || {};

    var fallback_mode = data['fallback_mode'] ? data['fallback_mode']['value'] : 'single';
    var fallback_image_folder = data['fallback_image_folder'] && data['fallback_image_folder']['value'] !== undefined ? data['fallback_image_folder']['value'] : data['fallback_image_folder'];
    var fallback_selected_image = data['fallback_selected_image'] ? data['fallback_selected_image']['value'] : '';
    var fallback_rotate_seconds_value = data['fallback_rotate_seconds'] && data['fallback_rotate_seconds']['value'] !== undefined ? data['fallback_rotate_seconds']['value'] : data['fallback_rotate_seconds'];
    var fallback_rotate_seconds = self._validFallbackRotateSeconds(fallback_rotate_seconds_value);
    var photo_manager_port_value = data['photo_manager_port'] && data['photo_manager_port']['value'] !== undefined ? data['photo_manager_port']['value'] : data['photo_manager_port'];
    var photo_manager_port = self._validPhotoManagerPort(photo_manager_port_value);

    fallback_mode = self._validFallbackMode(fallback_mode);
    fallback_image_folder = fallback_image_folder || DEFAULT_IDLE_FOLDER;
    fallback_selected_image = self._sanitizeFilename(fallback_selected_image);

    fs.ensureDirSync(fallback_image_folder);

    var photo_manager_port_changed = photo_manager_port !== self._photoManagerPort();

    self.config.set('fallback_mode', fallback_mode);
    self.config.set('fallback_image_folder', fallback_image_folder);
    self.config.set('fallback_selected_image', fallback_selected_image);
    self.config.set('fallback_rotate_seconds', fallback_rotate_seconds);
    self.config.set('photo_manager_port', photo_manager_port);

    self.logger.info('Vinyltron: saving idle settings: ' + JSON.stringify({
        fallback_mode: fallback_mode,
        fallback_image_folder: fallback_image_folder,
        fallback_selected_image: fallback_selected_image,
        fallback_rotate_seconds: fallback_rotate_seconds,
        photo_manager_port: photo_manager_port
    }));

    self._patchConfigToml({
        fallback_mode: fallback_mode,
        fallback_image_folder: fallback_image_folder,
        fallback_selected_image: fallback_selected_image,
        fallback_rotate_seconds: fallback_rotate_seconds
    });

    if (photo_manager_port_changed) {
        self.logger.info('Vinyltron: restarting photo manager on port ' + photo_manager_port);
        self._stopPhotoManager();
        self._startPhotoManager();
    }

    self._service('reload', 'idle settings save');

    return libQ.resolve();
};

// Save screensaver settings — hot via SIGHUP, no restart needed
ControllerVinyltron.prototype.saveScreensaver = function(data) {
    var self = this;
    data = data || {};

    var screensaver_engine_value = data['screensaver_engine'] && data['screensaver_engine']['value'] !== undefined ? data['screensaver_engine']['value'] : data['screensaver_engine'];
    var screensaver_engine = self._validScreensaverEngine(screensaver_engine_value);
    var screensaver_palette_value = data['screensaver_palette'] && data['screensaver_palette']['value'] !== undefined ? data['screensaver_palette']['value'] : data['screensaver_palette'];
    var screensaver_palette = self._validScreensaverPalette(screensaver_palette_value);
    var screensaver_fps_value = data['screensaver_fps'] && data['screensaver_fps']['value'] !== undefined ? data['screensaver_fps']['value'] : data['screensaver_fps'];
    var screensaver_fps = self._validScreensaverFps(screensaver_fps_value);
    var screensaver_reset_seconds_value = data['screensaver_reset_seconds'] && data['screensaver_reset_seconds']['value'] !== undefined ? data['screensaver_reset_seconds']['value'] : data['screensaver_reset_seconds'];
    var screensaver_reset_seconds = self._validScreensaverResetSeconds(screensaver_reset_seconds_value);

    self.config.set('screensaver_engine', screensaver_engine);
    self.config.set('screensaver_palette', screensaver_palette);
    self.config.set('screensaver_fps', screensaver_fps);
    self.config.set('screensaver_reset_seconds', screensaver_reset_seconds);

    self.logger.info('Vinyltron: saving screensaver settings: ' + JSON.stringify({
        screensaver_engine: screensaver_engine,
        screensaver_palette: screensaver_palette,
        screensaver_fps: screensaver_fps,
        screensaver_reset_seconds: screensaver_reset_seconds
    }));

    self._patchConfigToml({
        screensaver_engine: screensaver_engine,
        screensaver_palette: screensaver_palette,
        screensaver_fps: screensaver_fps,
        screensaver_reset_seconds: screensaver_reset_seconds
    });

    self._service('reload', 'screensaver settings save');

    return libQ.resolve();
};

// Save weather settings — hot via SIGHUP, no restart needed
ControllerVinyltron.prototype.saveWeather = function(data) {
    var self = this;
    data = data || {};

    var source_value = data['weather_source'] && data['weather_source']['value'] !== undefined ? data['weather_source']['value'] : data['weather_source'];
    if (source_value === undefined || source_value === null || source_value === '') source_value = 'open_meteo';
    var source = self._validWeatherSource(source_value);
    var location_label_value = data['weather_location_label'] && data['weather_location_label']['value'] !== undefined ? data['weather_location_label']['value'] : data['weather_location_label'];
    var location_label = (location_label_value === undefined || location_label_value === null) ? '' : location_label_value.toString().trim();
    var latitude_value = data['weather_latitude'] && data['weather_latitude']['value'] !== undefined ? data['weather_latitude']['value'] : data['weather_latitude'];
    var latitude = self._validWeatherLatitude(latitude_value);
    var longitude_value = data['weather_longitude'] && data['weather_longitude']['value'] !== undefined ? data['weather_longitude']['value'] : data['weather_longitude'];
    var longitude = self._validWeatherLongitude(longitude_value);
    var units_value = data['weather_units'] && data['weather_units']['value'] !== undefined ? data['weather_units']['value'] : data['weather_units'];
    var units = self._validWeatherUnits(units_value);
    var refresh_value = data['weather_refresh_minutes'] && data['weather_refresh_minutes']['value'] !== undefined ? data['weather_refresh_minutes']['value'] : data['weather_refresh_minutes'];
    var refresh_minutes = self._validWeatherRefreshMinutes(refresh_value);
    var night_icon_value = data['weather_night_icon'] && data['weather_night_icon']['value'] !== undefined ? data['weather_night_icon']['value'] : data['weather_night_icon'];
    var night_icon = self._validWeatherNightIcon(night_icon_value);
    var metric_value = data['weather_secondary_metric'] && data['weather_secondary_metric']['value'] !== undefined ? data['weather_secondary_metric']['value'] : data['weather_secondary_metric'];
    var metric = self._validWeatherSecondaryMetric(metric_value);
    var fps_value = data['weather_fps'] && data['weather_fps']['value'] !== undefined ? data['weather_fps']['value'] : data['weather_fps'];
    var fps = self._validWeatherFps(fps_value);
    var has_mock_condition = Object.prototype.hasOwnProperty.call(data, 'weather_mock_condition');
    var has_mock_night = Object.prototype.hasOwnProperty.call(data, 'weather_mock_night');
    var has_mock_moon_phase = Object.prototype.hasOwnProperty.call(data, 'weather_mock_moon_phase');
    var condition;
    var night;
    var moon_phase;
    if (has_mock_condition) {
        var condition_value = data['weather_mock_condition'] && data['weather_mock_condition']['value'] !== undefined ? data['weather_mock_condition']['value'] : data['weather_mock_condition'];
        condition = self._validWeatherCondition(condition_value);
    }
    if (has_mock_night) {
        night = data['weather_mock_night'] === true || data['weather_mock_night'] === 'true';
    }
    if (has_mock_moon_phase) {
        var moon_phase_value = data['weather_mock_moon_phase'] && data['weather_mock_moon_phase']['value'] !== undefined ? data['weather_mock_moon_phase']['value'] : data['weather_mock_moon_phase'];
        moon_phase = self._validWeatherMoonPhase(moon_phase_value);
    }

    self.config.set('weather_source', source);
    self.config.set('weather_location_label', location_label);
    self.config.set('weather_latitude', latitude);
    self.config.set('weather_longitude', longitude);
    self.config.set('weather_units', units);
    self.config.set('weather_refresh_minutes', refresh_minutes);
    self.config.set('weather_night_icon', night_icon);
    if (has_mock_condition) self.config.set('weather_mock_condition', condition);
    if (has_mock_night) self.config.set('weather_mock_night', night);
    if (has_mock_moon_phase) self.config.set('weather_mock_moon_phase', moon_phase);
    self.config.set('weather_secondary_metric', metric);
    self.config.set('weather_fps', fps);

    self.logger.info('Vinyltron: saving weather settings: ' + JSON.stringify({
        weather_source: source,
        weather_location_label: location_label,
        weather_latitude: latitude,
        weather_longitude: longitude,
        weather_units: units,
        weather_refresh_minutes: refresh_minutes,
        weather_night_icon: night_icon,
        weather_secondary_metric: metric,
        weather_fps: fps
    }));

    var fields = {
        weather_source: source,
        weather_location_label: location_label,
        weather_latitude: latitude,
        weather_longitude: longitude,
        weather_units: units,
        weather_refresh_minutes: refresh_minutes,
        weather_night_icon: night_icon,
        weather_secondary_metric: metric,
        weather_fps: fps
    };
    if (has_mock_condition) fields.weather_mock_condition = condition;
    if (has_mock_night) fields.weather_mock_night = night;
    if (has_mock_moon_phase) fields.weather_mock_moon_phase = moon_phase;

    self._patchConfigToml(fields);

    self._service('reload', 'weather settings save');

    return libQ.resolve();
};

// Save display settings — hot via SIGHUP, no restart needed
ControllerVinyltron.prototype.saveDisplay = function(data) {
    var self = this;
    data = data || {};

    var brightness_value = data['brightness'] && data['brightness']['value'] !== undefined ? data['brightness']['value'] : data['brightness'];
    var brightness   = parseInt(brightness_value);
    if (isNaN(brightness)) brightness = 80;
    var gamma        = data['gamma'] && data['gamma']['value'] !== undefined ? data['gamma']['value'] : data['gamma'];
    if (gamma === undefined || gamma === null) gamma = '2.2';
    var volumio_artwork_enabled = data['volumio_artwork_enabled'] !== false && data['volumio_artwork_enabled'] !== 'false';
    var progress_bar_height_value = data['progress_bar_height'] && data['progress_bar_height']['value'] !== undefined ? data['progress_bar_height']['value'] : data['progress_bar_height'];
    var progress_bar_height = progress_bar_height_value !== undefined ? parseInt(progress_bar_height_value) : 0;
    var progress_bar_foreground = data['progress_bar_foreground'] && data['progress_bar_foreground']['value'] !== undefined ? data['progress_bar_foreground']['value'] : (data['progress_bar_foreground'] || '255,255,255');
    var progress_bar_background = data['progress_bar_background'] && data['progress_bar_background']['value'] !== undefined ? data['progress_bar_background']['value'] : (data['progress_bar_background'] !== undefined ? data['progress_bar_background'] : '');
    var format_badge = data['format_badge'] === true || data['format_badge'] === 'true';
    var format_font = data['format_font'] ? data['format_font']['value'] : 'tom_thumb';
    var badge_duration_value = data['badge_duration'] && data['badge_duration']['value'] !== undefined ? data['badge_duration']['value'] : data['badge_duration'];
    var badge_duration = badge_duration_value !== undefined ? parseInt(badge_duration_value) : 10;
    var startup_delay_seconds_value = data['startup_delay_seconds'] && data['startup_delay_seconds']['value'] !== undefined ? data['startup_delay_seconds']['value'] : data['startup_delay_seconds'];
    var startup_delay_seconds = self._validStartupDelaySeconds(startup_delay_seconds_value);
    if (isNaN(progress_bar_height)) progress_bar_height = 0;
    progress_bar_height = Math.max(0, Math.min(64, progress_bar_height));
    var progress_bar = progress_bar_height > 0;
    if (isNaN(badge_duration)) badge_duration = 10;

    self.config.set('brightness', brightness);
    self.config.set('gamma', gamma);
    self.config.set('volumio_artwork_enabled', volumio_artwork_enabled);
    self.config.set('progress_bar', progress_bar);
    self.config.set('progress_bar_height', progress_bar_height);
    self.config.set('progress_bar_foreground', progress_bar_foreground);
    self.config.set('progress_bar_background', progress_bar_background);
    self.config.set('format_badge', format_badge);
    self.config.set('format_font', format_font);
    self.config.set('badge_duration', badge_duration);
    self.config.set('startup_delay_seconds', startup_delay_seconds);

    self.logger.info('Vinyltron: saving display settings: ' + JSON.stringify({
        brightness: brightness,
        gamma: gamma,
        volumio_artwork_enabled: volumio_artwork_enabled,
        progress_bar: progress_bar,
        progress_bar_height: progress_bar_height,
        progress_bar_foreground: progress_bar_foreground,
        progress_bar_background: progress_bar_background,
        format_badge: format_badge,
        format_font: format_font,
        badge_duration: badge_duration,
        startup_delay_seconds: startup_delay_seconds
    }));

    self._patchConfigToml({brightness: brightness, gamma: gamma,
                           volumio_artwork_enabled: volumio_artwork_enabled,
                           progress_bar: progress_bar,
                           progress_bar_height: progress_bar_height,
                           progress_bar_foreground: progress_bar_foreground,
                           progress_bar_background: progress_bar_background,
                           format_badge: format_badge,
                           format_font: format_font,
                           badge_duration: badge_duration,
                           startup_delay_seconds: startup_delay_seconds});

    self._service('reload', 'display settings save');

    return libQ.resolve();
};

// Save hardware settings — requires service restart (rotation changes matrix geometry)
ControllerVinyltron.prototype.saveHardware = function(data) {
    var self = this;
    data = data || {};

    var rotation = data['rotation'] && data['rotation']['value'] !== undefined ? data['rotation']['value'] : data['rotation'];
    if (rotation === undefined || rotation === null) rotation = '270';
    var hardware_mapping = data['hardware_mapping'] ? data['hardware_mapping']['value'] : 'adafruit-hat-pwm';
    var limit_refresh_rate_hz_value = data['limit_refresh_rate_hz'] && data['limit_refresh_rate_hz']['value'] !== undefined ? data['limit_refresh_rate_hz']['value'] : data['limit_refresh_rate_hz'];
    var limit_refresh_rate_hz = limit_refresh_rate_hz_value !== undefined ? parseInt(limit_refresh_rate_hz_value) : 0;
    hardware_mapping = self._validHardwareMapping(hardware_mapping);
    limit_refresh_rate_hz = self._validRefreshLimit(limit_refresh_rate_hz);
    var disable_hardware_pulsing = hardware_mapping === 'regular';

    self.config.set('rotation', rotation);
    self.config.set('hardware_mapping', hardware_mapping);
    self.config.set('limit_refresh_rate_hz', limit_refresh_rate_hz);
    self.logger.info('Vinyltron: saving hardware settings: ' + JSON.stringify({
        rotation: rotation,
        hardware_mapping: hardware_mapping,
        disable_hardware_pulsing: disable_hardware_pulsing,
        limit_refresh_rate_hz: limit_refresh_rate_hz
    }));
    self._patchConfigToml({
        rotation: rotation,
        hardware_mapping: hardware_mapping,
        disable_hardware_pulsing: disable_hardware_pulsing,
        limit_refresh_rate_hz: limit_refresh_rate_hz
    });

    self._service('restart', 'hardware settings save');

    return libQ.resolve();
};

// Toggle display on/off — hot via SIGHUP, no restart needed
ControllerVinyltron.prototype.toggleDisplay = function(data) {
    var self = this;
    data = data || {};

    var display_on = data['display_on'] === true || data['display_on'] === 'true';
    var schedule_enabled = data['schedule_enabled'] === true || data['schedule_enabled'] === 'true';
    var schedule_on_time = self._validTimeOfDay(data['schedule_on_time'] && data['schedule_on_time']['value'] !== undefined ? data['schedule_on_time']['value'] : data['schedule_on_time'], '08:00');
    var schedule_off_time = self._validTimeOfDay(data['schedule_off_time'] && data['schedule_off_time']['value'] !== undefined ? data['schedule_off_time']['value'] : data['schedule_off_time'], '23:00');
    self.config.set('display_on', display_on);
    self.config.set('schedule_enabled', schedule_enabled);
    self.config.set('schedule_on_time', schedule_on_time);
    self.config.set('schedule_off_time', schedule_off_time);
    self.logger.info('Vinyltron: saving power setting: ' + JSON.stringify({
        display_on: display_on,
        schedule_enabled: schedule_enabled,
        schedule_on_time: schedule_on_time,
        schedule_off_time: schedule_off_time
    }));
    self._patchConfigToml({
        display_on: display_on,
        schedule_enabled: schedule_enabled,
        schedule_on_time: schedule_on_time,
        schedule_off_time: schedule_off_time
    });

    self._service('reload', 'power setting save');

    return libQ.resolve();
};

ControllerVinyltron.prototype._startPhotoManager = function() {
    var self = this;
    if (self.photoServer) return;

    self.photoManagerError = null;
    self.photoServer = http.createServer(function(req, res) {
        self._handlePhotoManagerRequest(req, res);
    });
    self.photoServer.on('error', function(e) {
        self.logger.error('Vinyltron: photo manager server failed: ' + e);
        self.photoManagerError = e.message || String(e);
        var failedServer = self.photoServer;
        self.photoServer = null;
        try {
            failedServer.close();
        } catch (closeErr) {
            // already not listening after a bind error — nothing to clean up
        }
    });
    var port = self._photoManagerPort();
    self.photoServer.listen(port, PHOTO_MANAGER_HOST, function() {
        self.logger.info('Vinyltron: photo manager listening on port ' + port);
    });
};

ControllerVinyltron.prototype._stopPhotoManager = function() {
    if (!this.photoServer) return;
    try {
        this.photoServer.close();
    } catch (e) {
        this.logger.warn('Vinyltron: photo manager close failed: ' + e);
    }
    this.photoServer = null;
};

ControllerVinyltron.prototype._handlePhotoManagerRequest = function(req, res) {
    var self = this;
    var parsed = new URL(req.url || '/', 'http://localhost');
    var pathname = parsed.pathname || '/';

    if (req.method === 'GET' && (pathname === '/' || pathname === '/photos' || pathname === '/photo-manager.html')) {
        self._sendFile(res, path.join(__dirname, 'photo-manager.html'), 'text/html; charset=utf-8');
        return;
    }

    if (req.method === 'GET' && pathname === '/api/images') {
        self._json(res, 200, {ok: true, images: self._idleImages()});
        return;
    }

    if (req.method === 'GET' && pathname.indexOf('/image/') === 0) {
        var imageName = decodeURIComponent(pathname.slice('/image/'.length));
        var imagePath = self._safeIdleImagePath(imageName);
        if (!imagePath) {
            self._json(res, 404, {ok: false, error: 'Image not found'});
            return;
        }
        self._sendFile(res, imagePath, self._imageContentType(imagePath));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/upload') {
        self._readJsonBody(req, res, function(body) {
            self._uploadIdleImage(body, res);
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/delete') {
        self._readJsonBody(req, res, function(body) {
            self._deleteIdleImage(body, res);
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/select') {
        self._readJsonBody(req, res, function(body) {
            self._selectIdleImage(body, res);
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/random') {
        self._readJsonBody(req, res, function() {
            self._setRandomIdleMode(res);
        });
        return;
    }

    self._json(res, 404, {ok: false, error: 'Not found'});
};

ControllerVinyltron.prototype._readJsonBody = function(req, res, callback) {
    var self = this;
    var chunks = [];
    var total = 0;
    var rejected = false;

    req.on('data', function(chunk) {
        if (rejected) return;
        total += chunk.length;
        if (total > PHOTO_MANAGER_MAX_BYTES) {
            rejected = true;
            self._json(res, 413, {ok: false, error: 'Upload is too large'});
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', function() {
        if (rejected) return;
        try {
            var text = Buffer.concat(chunks).toString('utf8');
            callback(text ? JSON.parse(text) : {});
        } catch (e) {
            self._json(res, 400, {ok: false, error: 'Invalid JSON'});
        }
    });
    req.on('error', function(e) {
        self.logger.warn('Vinyltron: photo manager request failed: ' + e);
    });
};

ControllerVinyltron.prototype._uploadIdleImage = function(body, res) {
    var self = this;
    var filename = self._sanitizeFilename(body.filename || 'photo');
    var data = body.data || '';
    if (!data) {
        self._json(res, 400, {ok: false, error: 'No image data received'});
        return;
    }

    var buffer;
    try {
        buffer = Buffer.from(data, 'base64');
    } catch (e) {
        self._json(res, 400, {ok: false, error: 'Invalid image data'});
        return;
    }
    if (!buffer.length || buffer.length > PHOTO_MANAGER_MAX_BYTES) {
        self._json(res, 413, {ok: false, error: 'Upload is too large'});
        return;
    }

    var folder = self._idleFolder();
    var tmpDir, tmpPath;
    try {
        tmpDir = fs.mkdtempSync('/tmp/vinyltron-upload-');
        tmpPath = path.join(tmpDir, filename || 'photo');
        fs.ensureDirSync(folder);
        fs.writeFileSync(tmpPath, buffer);
    } catch (e) {
        self.logger.error('Vinyltron: photo upload staging failed: ' + e);
        self._json(res, 500, {ok: false, error: 'Could not save upload'});
        return;
    }

    execFile('/usr/bin/python3', [
        self._photoConverterPath(),
        tmpPath,
        folder,
        '--source-name',
        filename || 'photo'
    ], {timeout: 60000, maxBuffer: 1024 * 1024}, function(error, stdout, stderr) {
        fs.remove(tmpDir, function() {});
        if (error) {
            self.logger.error('Vinyltron: photo upload conversion failed: ' + error + ' ' + stderr);
            self._json(res, 500, {ok: false, error: 'Could not convert image'});
            return;
        }

        try {
            var result = JSON.parse(stdout);
            self._service('reload', 'idle photo upload');
            self._json(res, 200, {ok: true, image: result, images: self._idleImages()});
        } catch (e) {
            self.logger.error('Vinyltron: photo upload returned invalid JSON: ' + stdout);
            self._json(res, 500, {ok: false, error: 'Could not read conversion result'});
        }
    });
};

ControllerVinyltron.prototype._deleteIdleImage = function(body, res) {
    var filename = this._sanitizeFilename(body.filename || '');
    var imagePath = this._safeIdleImagePath(filename);
    if (!imagePath) {
        this._json(res, 404, {ok: false, error: 'Image not found'});
        return;
    }

    fs.removeSync(imagePath);
    if ((this.config.get('fallback_selected_image') || '') === filename) {
        this.config.set('fallback_selected_image', '');
        this._patchConfigToml({fallback_selected_image: ''});
    }
    this._service('reload', 'idle photo delete');
    this._json(res, 200, {ok: true, images: this._idleImages()});
};

ControllerVinyltron.prototype._selectIdleImage = function(body, res) {
    var filename = this._sanitizeFilename(body.filename || '');
    if (!this._safeIdleImagePath(filename)) {
        this._json(res, 404, {ok: false, error: 'Image not found'});
        return;
    }

    this.config.set('fallback_mode', 'selected');
    this.config.set('fallback_selected_image', filename);
    this._patchConfigToml({fallback_mode: 'selected', fallback_selected_image: filename});
    this._service('reload', 'idle photo select');
    this._json(res, 200, {ok: true, images: this._idleImages()});
};

ControllerVinyltron.prototype._setRandomIdleMode = function(res) {
    this.config.set('fallback_mode', 'random_folder');
    this._patchConfigToml({fallback_mode: 'random_folder'});
    this._service('reload', 'idle random photo mode');
    this._json(res, 200, {ok: true, images: this._idleImages()});
};

ControllerVinyltron.prototype._idleImages = function() {
    var self = this;
    var selected = self.config.get('fallback_selected_image') || '';
    return self._idleImageOptions(self._idleFolder()).filter(function(option) {
        return option.value;
    }).map(function(option) {
        var imagePath = path.join(self._idleFolder(), option.value);
        var stat = fs.statSync(imagePath);
        return {
            name: option.value,
            selected: option.value === selected,
            size: stat.size,
            modified: stat.mtime.toISOString()
        };
    });
};

ControllerVinyltron.prototype._idleFolder = function() {
    return this.config.get('fallback_image_folder') || DEFAULT_IDLE_FOLDER;
};

ControllerVinyltron.prototype._safeIdleImagePath = function(filename) {
    filename = this._sanitizeFilename(filename);
    if (!filename) return null;
    var ext = path.extname(filename).toLowerCase();
    if (IMAGE_EXTENSIONS.indexOf(ext) === -1) return null;
    var imagePath = path.join(this._idleFolder(), filename);
    try {
        if (!fs.statSync(imagePath).isFile()) return null;
    } catch (e) {
        return null;
    }
    return imagePath;
};

ControllerVinyltron.prototype._photoConverterPath = function() {
    var bundled = path.join(__dirname, 'vinyltron', 'photo_upload_convert.py');
    if (fs.existsSync(bundled)) return bundled;
    return path.join(__dirname, '..', 'photo_upload_convert.py');
};

ControllerVinyltron.prototype._sendFile = function(res, filePath, contentType) {
    fs.readFile(filePath, function(error, data) {
        if (error) {
            res.writeHead(404, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ok: false, error: 'Not found'}));
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store'
        });
        res.end(data);
    });
};

ControllerVinyltron.prototype._imageContentType = function(filePath) {
    var ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.bmp') return 'image/bmp';
    return 'image/png';
};

ControllerVinyltron.prototype._json = function(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
};

ControllerVinyltron.prototype._photoManagerHostLabel = function() {
    return 'volumio.local';
};

ControllerVinyltron.prototype._photoManagerUrl = function() {
    return 'http://' + this._photoManagerHostLabel() + ':' + this._photoManagerPort() + '/photos';
};

ControllerVinyltron.prototype._photoManagerPort = function() {
    return this._validPhotoManagerPort(this.config.get('photo_manager_port'));
};

ControllerVinyltron.prototype._validPhotoManagerPort = function(value) {
    value = parseInt(value);
    if (isNaN(value) || value < PHOTO_MANAGER_PORT_MIN || value > PHOTO_MANAGER_PORT_MAX) return PHOTO_MANAGER_PORT_DEFAULT;
    return value;
};

// Patch specific keys in config.toml without touching unmanaged values
ControllerVinyltron.prototype._patchConfigToml = function(fields) {
    var self = this;
    try {
        var content = fs.readFileSync(CONFIG_TOML, 'utf8');

        if (fields.brightness !== undefined) content = this._patchTomlInSection(content, 'display', 'brightness', fields.brightness);
        if (fields.gamma !== undefined) content = this._patchTomlInSection(content, 'display', 'gamma', fields.gamma);
        if (fields.volumio_artwork_enabled !== undefined) content = this._patchTomlInSection(content, 'volumio', 'artwork_enabled', fields.volumio_artwork_enabled, 'port');
        if (fields.rotation !== undefined) content = this._patchTomlInSection(content, 'display', 'rotation', parseInt(fields.rotation));
        if (fields.hardware_mapping !== undefined) content = this._patchTomlInSection(content, 'display', 'hardware_mapping', this._tomlString(fields.hardware_mapping), 'display_on');
        if (fields.disable_hardware_pulsing !== undefined) content = this._patchTomlInSection(content, 'display', 'disable_hardware_pulsing', fields.disable_hardware_pulsing, 'hardware_mapping');
        if (fields.limit_refresh_rate_hz !== undefined) content = this._patchTomlInSection(content, 'display', 'limit_refresh_rate_hz', fields.limit_refresh_rate_hz, 'slowdown_gpio');
        if (fields.startup_delay_seconds !== undefined) content = this._patchTomlInSection(content, 'display', 'startup_delay_seconds', fields.startup_delay_seconds, 'limit_refresh_rate_hz');
        if (fields.display_on !== undefined) content = this._patchTomlInSection(content, 'display', 'display_on', fields.display_on);
        if (fields.fallback_image_folder !== undefined) content = this._patchTomlInSection(content, 'fallback', 'image_folder', this._tomlString(fields.fallback_image_folder), 'image');
        if (fields.fallback_mode !== undefined) content = this._patchTomlInSection(content, 'fallback', 'mode', this._tomlString(fields.fallback_mode), 'image_folder');
        if (fields.fallback_selected_image !== undefined) content = this._patchTomlInSection(content, 'fallback', 'selected_image', this._tomlString(fields.fallback_selected_image), 'mode');
        if (fields.fallback_rotate_seconds !== undefined) content = this._patchTomlInSection(content, 'fallback', 'rotate_seconds', fields.fallback_rotate_seconds, 'selected_image');
        if (fields.screensaver_engine !== undefined) content = this._patchTomlInSection(content, 'screensaver', 'engine', this._tomlString(fields.screensaver_engine));
        if (fields.screensaver_palette !== undefined) content = this._patchTomlInSection(content, 'screensaver', 'palette', this._tomlString(fields.screensaver_palette), 'engine');
        if (fields.screensaver_fps !== undefined) content = this._patchTomlInSection(content, 'screensaver', 'fps', fields.screensaver_fps, 'palette');
        if (fields.screensaver_reset_seconds !== undefined) content = this._patchTomlInSection(content, 'screensaver', 'reset_seconds', fields.screensaver_reset_seconds, 'fps');
        if (fields.weather_source !== undefined) content = this._patchTomlInSection(content, 'weather', 'source', this._tomlString(fields.weather_source));
        if (fields.weather_latitude !== undefined) content = this._patchTomlInSection(content, 'weather', 'latitude', fields.weather_latitude, 'source');
        if (fields.weather_longitude !== undefined) content = this._patchTomlInSection(content, 'weather', 'longitude', fields.weather_longitude, 'latitude');
        if (fields.weather_location_label !== undefined) content = this._patchTomlInSection(content, 'weather', 'location_label', this._tomlString(fields.weather_location_label), 'longitude');
        if (fields.weather_units !== undefined) content = this._patchTomlInSection(content, 'weather', 'units', this._tomlString(fields.weather_units), 'location_label');
        if (fields.weather_refresh_minutes !== undefined) content = this._patchTomlInSection(content, 'weather', 'refresh_minutes', fields.weather_refresh_minutes, 'units');
        if (fields.weather_night_icon !== undefined) content = this._patchTomlInSection(content, 'weather', 'night_icon', this._tomlString(fields.weather_night_icon), 'refresh_minutes');
        if (fields.weather_fps !== undefined) content = this._patchTomlInSection(content, 'weather', 'fps', fields.weather_fps, 'secondary_metric');
        if (fields.weather_mock_condition !== undefined) content = this._patchTomlInSection(content, 'weather', 'mock_condition', this._tomlString(fields.weather_mock_condition), 'fps');
        if (fields.weather_mock_night !== undefined) content = this._patchTomlInSection(content, 'weather', 'mock_night', fields.weather_mock_night, 'mock_condition');
        if (fields.weather_mock_moon_phase !== undefined) content = this._patchTomlInSection(content, 'weather', 'mock_moon_phase', fields.weather_mock_moon_phase, 'mock_night');
        if (fields.weather_secondary_metric !== undefined) content = this._patchTomlInSection(content, 'weather', 'secondary_metric', this._tomlString(fields.weather_secondary_metric), 'mock_moon_phase');
        if (fields.progress_bar !== undefined) content = this._patchTomlInSection(content, 'overlays', 'progress_bar', fields.progress_bar);
        if (fields.progress_bar_height !== undefined) content = this._patchTomlInSection(content, 'overlays', 'progress_bar_height', fields.progress_bar_height, 'progress_bar');
        if (fields.progress_bar_foreground !== undefined) content = this._patchTomlInSection(content, 'overlays', 'progress_bar_foreground', this._tomlRgb(fields.progress_bar_foreground), 'progress_bar_height');
        if (fields.progress_bar_background !== undefined) content = this._patchTomlInSection(content, 'overlays', 'progress_bar_background', this._tomlRgb(fields.progress_bar_background), 'progress_bar_foreground');
        if (fields.format_badge !== undefined) content = this._patchTomlInSection(content, 'overlays', 'format_badge', fields.format_badge, 'progress_bar_background');
        if (fields.format_font !== undefined) content = this._patchTomlInSection(content, 'overlays', 'format_font', this._tomlString(fields.format_font), 'format_badge');
        if (fields.badge_duration !== undefined) content = this._patchTomlInSection(content, 'overlays', 'badge_duration', fields.badge_duration, 'format_font');
        if (fields.schedule_enabled !== undefined) content = this._patchTomlInSection(content, 'schedule', 'enabled', fields.schedule_enabled);
        if (fields.schedule_on_time !== undefined) content = this._patchTomlInSection(content, 'schedule', 'on_time', this._tomlString(fields.schedule_on_time), 'enabled');
        if (fields.schedule_off_time !== undefined) content = this._patchTomlInSection(content, 'schedule', 'off_time', this._tomlString(fields.schedule_off_time), 'on_time');

        fs.writeFileSync(CONFIG_TOML, content, 'utf8');
        self.logger.info('Vinyltron: updated config.toml fields: ' + Object.keys(fields).join(', '));
    } catch (e) {
        self.logger.error('Vinyltron: failed to update config.toml: ' + e);
    }
};

ControllerVinyltron.prototype._patchTomlInSection = function(content, section, key, value, afterKey) {
    var line = key + ' = ' + value;
    var sectionRe = new RegExp('^\\[' + section + '\\]\\s*$', 'm');
    var sectionMatch = sectionRe.exec(content);
    if (!sectionMatch) {
        return content + '\n\n[' + section + ']\n' + line + '\n';
    }

    var sectionStart = sectionMatch.index;
    var bodyStart = sectionStart + sectionMatch[0].length;
    var nextSection = content.slice(bodyStart).search(/\n\[[^\]]+\]\s*/);
    var sectionEnd = nextSection === -1 ? content.length : bodyStart + nextSection;
    var before = content.slice(0, bodyStart);
    var body = content.slice(bodyStart, sectionEnd);
    var after = content.slice(sectionEnd);
    var keyRe = new RegExp('^(\\s*)' + key + '\\s*=.*$', 'm');

    if (keyRe.test(body)) {
        body = body.replace(keyRe, '$1' + line);
    } else if (afterKey) {
        var afterKeyRe = new RegExp('^(\\s*)' + afterKey + '\\s*=.*$', 'm');
        if (afterKeyRe.test(body)) {
            body = body.replace(afterKeyRe, function(afterLine) {
                return afterLine + '\n' + line;
            });
        } else {
            body += '\n' + line;
        }
    } else {
        body += '\n' + line;
    }

    return before + body + after;
};

ControllerVinyltron.prototype._tomlValue = function(content, section, key) {
    var sectionRe = new RegExp('^\\[' + section + '\\]\\s*$', 'm');
    var sectionMatch = sectionRe.exec(content);
    if (!sectionMatch) return null;

    var bodyStart = sectionMatch.index + sectionMatch[0].length;
    var nextSection = content.slice(bodyStart).search(/\n\[[^\]]+\]\s*/);
    var sectionEnd = nextSection === -1 ? content.length : bodyStart + nextSection;
    var body = content.slice(bodyStart, sectionEnd);
    var keyRe = new RegExp('^\\s*' + key + '\\s*=\\s*(.*?)\\s*(?:#.*)?$', 'm');
    var keyMatch = keyRe.exec(body);
    return keyMatch ? keyMatch[1].trim() : null;
};

ControllerVinyltron.prototype._coerceTomlValue = function(value, type) {
    if (type === 'boolean') return value === 'true';
    if (type === 'number') {
        var number = parseFloat(value);
        return isNaN(number) ? 0 : number;
    }
    if (type === 'rgb') {
        if (value === '[]') return '';
        var rgb = /^\[(.*)\]$/.exec(value);
        if (!rgb) return '';
        return rgb[1].split(',').map(function(part) {
            return parseInt(part.trim());
        }).filter(function(part) {
            return !isNaN(part);
        }).slice(0, 3).join(',');
    }
    var stringMatch = /^"(.*)"$/.exec(value);
    if (stringMatch) return stringMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return value;
};

ControllerVinyltron.prototype._idleImageOptions = function(folder) {
    var options = [];
    try {
        var files = fs.readdirSync(folder).filter(function(name) {
            var ext = path.extname(name).toLowerCase();
            return name[0] !== '.' && IMAGE_EXTENSIONS.indexOf(ext) !== -1 && fs.statSync(path.join(folder, name)).isFile();
        }).sort();
        options = files.map(function(name) {
            return {value: name, label: name};
        });
    } catch (e) {
        this.logger.warn('Vinyltron: could not scan idle image folder ' + folder + ': ' + e);
    }

    if (options.length === 0) {
        options.push({value: '', label: 'No image found'});
    }
    return options;
};

ControllerVinyltron.prototype._sanitizeFilename = function(value) {
    if (!value) return '';
    return path.basename(value.toString());
};

ControllerVinyltron.prototype._validFallbackMode = function(value) {
    if (value === 'screensaver_brians_brain') return 'screensaver';
    if (value === 'selected' || value === 'random_folder' || value === 'screensaver' || value === 'weather') return value;
    return 'single';
};

ControllerVinyltron.prototype._validFallbackRotateSeconds = function(value) {
    value = parseInt(value);
    if (isNaN(value) || value < 0) return 0;
    return value;
};

ControllerVinyltron.prototype._validScreensaverEngine = function(value) {
    if (value === 'brians_brain' || value === 'langtons_ant' || value === 'chaos_game' || value === 'gray_scott') return value;
    return 'brians_brain';
};

ControllerVinyltron.prototype._validScreensaverPalette = function(value) {
    if (value === 'green_magenta' || value === 'blue_red' || value === 'white_violet') return value;
    return 'cyan_amber';
};

ControllerVinyltron.prototype._validScreensaverFps = function(value) {
    value = parseInt(value);
    if (isNaN(value)) return 6;
    return Math.max(2, Math.min(24, value));
};

ControllerVinyltron.prototype._validScreensaverResetSeconds = function(value) {
    value = parseInt(value);
    if (isNaN(value) || value < 0) return 0;
    return value;
};

ControllerVinyltron.prototype._validWeatherSource = function(value) {
    if (value === 'open_meteo') return value;
    return 'mock';
};

ControllerVinyltron.prototype._validWeatherLatitude = function(value) {
    value = parseFloat(value);
    if (isNaN(value)) return 0;
    return Math.max(-90, Math.min(90, value));
};

ControllerVinyltron.prototype._validWeatherLongitude = function(value) {
    value = parseFloat(value);
    if (isNaN(value)) return 0;
    return Math.max(-180, Math.min(180, value));
};

ControllerVinyltron.prototype._validWeatherUnits = function(value) {
    if (value === 'metric') return value;
    return 'imperial';
};

ControllerVinyltron.prototype._validWeatherRefreshMinutes = function(value) {
    value = parseInt(value);
    if (isNaN(value)) return 10;
    return Math.max(5, Math.min(60, value));
};

ControllerVinyltron.prototype._validWeatherNightIcon = function(value) {
    if (value === 'weather') return value;
    return 'moon';
};

ControllerVinyltron.prototype._validWeatherCondition = function(value) {
    if (value === 'clear' || value === 'partly_cloudy' || value === 'cloudy' || value === 'rain' || value === 'storm' || value === 'snow' || value === 'fog') return value;
    return 'partly_cloudy';
};

ControllerVinyltron.prototype._validWeatherSecondaryMetric = function(value) {
    if (value === 'aqi' || value === 'wind') return value;
    return 'humidity';
};

ControllerVinyltron.prototype._validWeatherFps = function(value) {
    value = parseInt(value);
    if (isNaN(value)) return 1;
    return Math.max(1, Math.min(10, value));
};

ControllerVinyltron.prototype._validWeatherMoonPhase = function(value) {
    value = parseFloat(value);
    if (isNaN(value)) return 0.55;
    return Math.max(0, Math.min(1, value));
};

ControllerVinyltron.prototype._validStartupDelaySeconds = function(value) {
    value = parseInt(value);
    if (isNaN(value) || value < 0) return 5;
    return value;
};

ControllerVinyltron.prototype._validHardwareMapping = function(value) {
    if (value === 'adafruit-hat-pwm' || value === 'adafruit-hat' || value === 'regular') return value;
    return 'adafruit-hat-pwm';
};

ControllerVinyltron.prototype._validRefreshLimit = function(value) {
    value = parseInt(value);
    if (isNaN(value) || value < 0) return 0;
    return value;
};

ControllerVinyltron.prototype._validTimeOfDay = function(value, fallback) {
    var text = (value === undefined || value === null) ? '' : value.toString().trim();
    var match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match) return fallback;
    var hour = parseInt(match[1]);
    var minute = parseInt(match[2]);
    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
    return (hour < 10 ? '0' : '') + hour + ':' + (minute < 10 ? '0' : '') + minute;
};

ControllerVinyltron.prototype._labelForFallbackMode = function(value) {
    var labels = {
        'single': 'Built-in Idle Image',
        'selected': 'Selected Folder Image',
        'random_folder': 'Random Folder Image',
        'screensaver': 'Screensaver',
        'weather': 'Current Weather'
    };
    return labels[value] || labels['single'];
};

ControllerVinyltron.prototype._labelForScreensaverEngine = function(value) {
    var labels = {
        'brians_brain': 'Brian\'s Brain',
        'langtons_ant': 'Langton\'s Ant',
        'chaos_game': 'Chaos Game',
        'gray_scott': 'Reaction-Diffusion'
    };
    return labels[value] || labels['brians_brain'];
};

ControllerVinyltron.prototype._labelForScreensaverPalette = function(value) {
    var labels = {
        'cyan_amber': 'Cyan / Amber',
        'green_magenta': 'Green / Magenta',
        'blue_red': 'Blue / Red',
        'white_violet': 'White / Violet'
    };
    return labels[value] || labels['cyan_amber'];
};

ControllerVinyltron.prototype._labelForScreensaverFps = function(value) {
    if (value <= 4) return 'Slow';
    if (value >= 10) return 'Fast';
    return 'Medium';
};

ControllerVinyltron.prototype._labelForWeatherSource = function(value) {
    var labels = {
        'mock': 'Mock',
        'open_meteo': 'Open-Meteo'
    };
    return labels[value] || labels['mock'];
};

ControllerVinyltron.prototype._labelForWeatherUnits = function(value) {
    return value === 'metric' ? 'Metric' : 'Imperial';
};

ControllerVinyltron.prototype._labelForWeatherNightIcon = function(value) {
    return value === 'weather' ? 'Weather Icon' : 'Moon Phase';
};

ControllerVinyltron.prototype._labelForWeatherCondition = function(value) {
    var labels = {
        'clear': 'Clear',
        'partly_cloudy': 'Partly Cloudy',
        'cloudy': 'Cloudy',
        'rain': 'Rain',
        'storm': 'Storm',
        'snow': 'Snow',
        'fog': 'Fog'
    };
    return labels[value] || labels['partly_cloudy'];
};

ControllerVinyltron.prototype._labelForWeatherSecondaryMetric = function(value) {
    var labels = {
        'humidity': 'Humidity',
        'aqi': 'AQI',
        'wind': 'Wind'
    };
    return labels[value] || labels['humidity'];
};

ControllerVinyltron.prototype._labelForWeatherFps = function(value) {
    if (value <= 1) return 'Slow';
    if (value >= 4) return 'Fast';
    return 'Medium';
};

ControllerVinyltron.prototype._labelForIdleImage = function(value, options) {
    for (var i = 0; i < options.length; i++) {
        if (options[i].value === value) return options[i].label;
    }
    return value || 'No image found';
};

ControllerVinyltron.prototype._tomlRgb = function(value) {
    if (value === undefined || value === null || value === '') return '[]';
    var parts = value.split(',').map(function(part) {
        var n = parseInt(part.trim());
        if (isNaN(n)) n = 0;
        return Math.max(0, Math.min(255, n));
    });
    while (parts.length < 3) parts.push(0);
    return '[' + parts.slice(0, 3).join(', ') + ']';
};

ControllerVinyltron.prototype._tomlString = function(value) {
    var text = (value === undefined || value === null) ? '' : value.toString();
    return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
};


ControllerVinyltron.prototype._labelForFormatFont = function(value) {
    var labels = {
        'tom_thumb': 'Tom Thumb',
        'tiny5': 'Tiny5',
        'spleen': 'Spleen 5x8'
    };
    return labels[value] || value;
};

ControllerVinyltron.prototype._labelForHardwareMapping = function(value) {
    var labels = {
        'adafruit-hat-pwm': 'Bonnet PWM',
        'adafruit-hat': 'Bonnet',
        'regular': 'Direct GPIO'
    };
    return labels[value] || labels['adafruit-hat-pwm'];
};
