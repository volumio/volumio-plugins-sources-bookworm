/**
 * @file        index.js
 * @description Volumio music service plugin for DMD2 Music (dmd2.com).
 *              Provides browse, playback, and account management via the
 *              DMD2 Music v1 REST API.
 *
 * @version     3.0.0
 * @date        2025-04-07
 *
 * ---------------------------------------------------------------------------
 * Changelog
 * ---------------------------------------------------------------------------
 *
 * 2.0.3  2025-04-07
 *   - Replaced all var declarations with const/let throughout.
 *
 * 2.0.2  2025-04-07
 *   - Introduced this.serviceName in the constructor to centralise the plugin
 *     name; all previous hardcoded occurrences replaced with self.serviceName.
 *   - Fixed TypeError in handleCategoryBrowseUri and explodeUri where
 *     this.serviceName was used inside callbacks (this is undefined in strict
 *     mode inside function() callbacks; must use self).
 *
 * 2.0.1  2025-04-07
 *   - Replaced i18nJson with direct fs.readJson + translateKeys in getUIConfig
 *     to work around a broken i18nJson implementation on this Volumio version.
 *   - Removed language-specific URL switch block from getUIConfig; button URLs
 *     are now read directly from UIConfig.json.
 *   - Fixed reset-password button always hidden by hardcoded content[3].hidden.
 *   - Added || 'en' fallback for sharedVars.get('language_code') in both
 *     getUIConfig and loadI18n.
 *   - Converted loadI18n to return a kew promise; onStart now waits for i18n
 *     to fully load before proceeding with login and cron startup.
 *   - Added null guards to getI18n to prevent crashes when called before
 *     i18n strings are loaded.
 *
 * 2.0.0  2025-04-07
 *   - Ported plugin structure to the current Volumio plugin template format:
 *     renamed constructor to ControllerDMD2Music, added onRestart stub, added
 *     setUIConfig / getConf / setConf stubs, added seek / pause / getState /
 *     parseState / pushState / search / _search* / goto stubs.
 *   - Removed unirest dependency entirely; replaced with native Node.js fetch
 *     (available from Node v18+) via two shared helpers: apiGet and apiPost.
 *   - Moved mpdPlugin assignment from onVolumioStart to onStart to avoid a
 *     race condition where MPD may not yet be initialised at boot time.
 *   - Fixed handleBrowseUri to re-authenticate on demand when authToken is
 *     absent (e.g. first browse after reboot before startup login completes).
 *   - saveAccountCredentials now correctly extracts .value from Volumio's
 *     { value: '...' } field objects before passing to loginToHotelRadio.
 *   - Added .fail() error handlers to all API call sites for network errors.
 *   - Replaced arrow functions with function() expressions for ES5
 *     compatibility with the Volumio runtime.
 *   - onVolumioStart now returns libQ.resolve() directly instead of using a
 *     manual defer.
 *   - onStop now returns libQ.resolve() as required by the template.
 *
 * ---------------------------------------------------------------------------
 * Dependencies
 * ---------------------------------------------------------------------------
 *   kew            Promise library (Volumio standard)
 *   fs-extra       File system helpers (callback API — old version bundled)
 *   node-schedule  Cron-style job scheduler (token refresh)
 *   moment         Date/time helpers (cron string construction)
 *   v-conf         Volumio configuration file helper
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *   Auth  : POST https://music-api.dmd2.com/v1/auth/
 *           JWT returned in response header 'token'
 *   Browse: GET  https://music-api.dmd2.com/v1/categories/
 *           GET  https://music-api.dmd2.com/v1/channels/category/<id>
 */

// ---------------------------------------------------------------------------------------------------------------------------
//  strict
// ---------------------------------------------------------------------------------------------------------------------------
'use strict';

// ---------------------------------------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------------------------------------
const libQ   = require('kew');
const fs     = require('fs-extra');
const cron   = require('node-schedule');
const moment = require('moment');

// ---------------------------------------------------------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------------------------------------------------------
module.exports = ControllerDMD2Music;

function ControllerDMD2Music(context) {
    this.context       = context;
    this.commandRouter = this.context.coreCommand;
    this.logger        = this.context.logger;
    this.configManager = this.context.configManager;
    this.serviceName   = 'my_dmd2_music';
}

// ---------------------------------------------------------------------------------------------------------------------------
// HTTP helper — wraps native fetch in a kew-compatible promise.
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.apiGet = function (url, token) {
    const defer = libQ.defer();

    fetch(url, {
        method:  'GET',
        headers: { 'auth': token }
    })
    .then(function (res) {
        if (!res.ok) {
            throw new Error('HTTP ' + res.status);
        }
        return res.json();
    })
    .then(function (body) {
        defer.resolve(body);
    })
    .catch(function (err) {
        defer.reject(err);
    });

    return defer.promise;
};

ControllerDMD2Music.prototype.apiPost = function (url, formFields) {
    const defer = libQ.defer();
    const body  = Object.keys(formFields)
                    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(formFields[k]); })
                    .join('&');

    fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body
    })
    .then(function (res) {
        const headers = {};
        res.headers.forEach(function (value, name) { headers[name] = value; });
        if (!res.ok) {
            throw new Error('HTTP ' + res.status);
        }
        return res.json().then(function (json) {
            defer.resolve({ body: json, headers: headers });
        });
    })
    .catch(function (err) {
        defer.reject(err);
    });

    return defer.promise;
};

// ---------------------------------------------------------------------------------------------------------------------------
// Volumio lifecycle events
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

ControllerDMD2Music.prototype.onVolumioStart = function () {
    const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    return libQ.resolve();
};

ControllerDMD2Music.prototype.onStart = function () {
    const self  = this;
    const defer = libQ.defer();

    self.mpdPlugin = self.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

    self.loadI18n()
        .then(function () {
            self.startupLogin();
            self.startRefreshCron();
            defer.resolve();
        })
        .fail(function (e) {
            self.logger.error('DMD2 Music: onStart failed: ' + e);
            defer.reject(e);
        });

    return defer.promise;
};

ControllerDMD2Music.prototype.onStop = function () {
    const self  = this;
    const defer = libQ.defer();

    self.commandRouter.volumioRemoveToBrowseSources(self.serviceName);
    self.stopRefreshCron();

    defer.resolve();
    return libQ.resolve();
};

ControllerDMD2Music.prototype.onRestart = function () {
    // Optional — reserved for future use.
};

// ---------------------------------------------------------------------------------------------------------------------------
// Configuration methods
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.getUIConfig = function () {
    const self  = this;
    const defer = libQ.defer();

    // Load UIConfig.json directly — avoids i18nJson compatibility issues.
    fs.readJson(__dirname + '/UIConfig.json', function (err, uiconf) {
        if (err) {
            self.logger.error('Could not fetch DMD2 Music UI Configuration: ' + err);
            defer.reject(new Error());
            return;
        }

        if (self.isLoggedIn()) {
            uiconf.sections[0].content[0].hidden = true;
            uiconf.sections[0].content[1].hidden = true;
            uiconf.sections[0].content[2].hidden = true;
            uiconf.sections[0].content[3].hidden = true;

            uiconf.sections[0].description      = self.getI18n('HOTELRADIO.LOGGED_IN_EMAIL') + self.userEmail;
            uiconf.sections[0].saveButton.label  = self.getI18n('COMMON.LOGOUT');
            uiconf.sections[0].onSave.method     = 'clearAccountCredentials';
        } else {
            uiconf.sections[0].content[0].hidden = false;
            uiconf.sections[0].content[1].hidden = false;
            uiconf.sections[0].content[2].hidden = false;
            uiconf.sections[0].content[3].hidden = false;

            uiconf.sections[0].description      = self.getI18n('HOTELRADIO.ACCOUNT_LOGIN_DESC');
            uiconf.sections[0].saveButton.label  = self.getI18n('COMMON.LOGIN');
            uiconf.sections[0].onSave.method     = 'saveAccountCredentials';
        }

        self.commandRouter.translateKeys(uiconf, self.i18nStrings, self.i18nStringsDefaults);

        defer.resolve(uiconf);
    });

    return defer.promise;
};

ControllerDMD2Music.prototype.setUIConfig = function (data) {
    // Reserved for future use.
};

ControllerDMD2Music.prototype.getConf = function (varName) {
    return this.config.get(varName);
};

ControllerDMD2Music.prototype.setConf = function (varName, varValue) {
    this.config.set(varName, varValue);
};

// ---------------------------------------------------------------------------------------------------------------------------
// i18n helpers
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.loadI18n = function () {
    const self          = this;
    const defer         = libQ.defer();
    const language_code = this.commandRouter.sharedVars.get('language_code') || 'en';

    fs.readJson(__dirname + '/i18n/strings_en.json', function (err, defaulti18n) {
        if (err) {
            self.logger.error('DMD2 Music: failed to load default i18n strings: ' + err);
            self.i18nStringsDefaults = {};
            self.i18nStrings         = {};
            defer.resolve();
            return;
        }

        self.i18nStringsDefaults = defaulti18n;

        fs.readJson(__dirname + '/i18n/strings_' + language_code + '.json', function (err, langi18n) {
            self.i18nStrings = err ? self.i18nStringsDefaults : langi18n;
            defer.resolve();
        });
    });

    return defer.promise;
};

ControllerDMD2Music.prototype.getI18n = function (key) {
    const self = this;

    if (!self.i18nStrings || !self.i18nStringsDefaults) { return key; }

    if (key.indexOf('.') > 0) {
        const mainKey = key.split('.')[0];
        const secKey  = key.split('.')[1];
        if (self.i18nStrings[mainKey] && self.i18nStrings[mainKey][secKey] !== undefined) {
            return self.i18nStrings[mainKey][secKey];
        }
        if (self.i18nStringsDefaults[mainKey]) {
            return self.i18nStringsDefaults[mainKey][secKey];
        }
        return key;
    }

    return (self.i18nStrings[key] !== undefined)
        ? self.i18nStrings[key]
        : (self.i18nStringsDefaults[key] !== undefined ? self.i18nStringsDefaults[key] : key);
};

// ---------------------------------------------------------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.startupLogin = function () {
    const self = this;

    self.shallLogin()
        .then(function () { return self.loginToHotelRadio(self.config.get('username'), self.config.get('password')); })
        .then(function () { return self.addToBrowseSources(); });
};

ControllerDMD2Music.prototype.shallLogin = function () {
    const defer = libQ.defer();

    if (this.config.get('loggedin', false)
        && this.config.get('username')
        && this.config.get('username') !== ''
        && this.config.get('password')
        && this.config.get('password') !== '')
    {
        defer.resolve();
    } else {
        defer.reject();
    }

    return defer.promise;
};

ControllerDMD2Music.prototype.loginToHotelRadio = function (username, password) {
    const defer = libQ.defer();
    const self  = this;

    self.logger.info('Logging in to DMD2 Music');

    self.apiPost('https://music-api.dmd2.com/v1/auth/', { username: username, password: password })
        .then(function (response) {
            if (response.body &&
                response.body.code === 200 &&
                response.body.data &&
                response.headers['token'])
            {
                self.authToken = response.headers['token'];
                self.userId    = response.body.data.user;
                self.userUuid  = response.body.data.uuid;
                self.userEmail = username;

                self.config.set('loggedin', true);
                defer.resolve();
            } else {
                self.logger.error('DMD2 Music login failed: ' + JSON.stringify(response.body));
                defer.reject();
            }
        })
        .fail(function (err) {
            self.logger.error('DMD2 Music login error: ' + err);
            defer.reject();
        });

    return defer.promise;
};

ControllerDMD2Music.prototype.saveAccountCredentials = function (settings) {
    const self  = this;
    const defer = libQ.defer();

    const username = settings['hotelradio_username'] && settings['hotelradio_username'].value !== undefined
        ? settings['hotelradio_username'].value
        : settings['hotelradio_username'];
    const password = settings['hotelradio_password'] && settings['hotelradio_password'].value !== undefined
        ? settings['hotelradio_password'].value
        : settings['hotelradio_password'];

    self.logger.info('DMD2 Music: attempting login for user: ' + username);

    self.loginToHotelRadio(username, password)
        .then(function () { return self.addToBrowseSources(); })
        .then(function () {
            self.config.set('username', username);
            self.config.set('password', password);

            self.getUIConfig().then(function (conf) {
                self.commandRouter.broadcastMessage('pushUiConfig', conf);
            });

            self.commandRouter.pushToastMessage('success', self.getI18n('COMMON.LOGGED_IN'));
            defer.resolve({});
        })
        .fail(function (e) {
            self.logger.error('DMD2 Music: saveAccountCredentials failed: ' + e);
            self.commandRouter.pushToastMessage('error', self.getI18n('COMMON.ERROR_LOGGING_IN'));
            defer.reject();
        });

    return defer.promise;
};

ControllerDMD2Music.prototype.clearAccountCredentials = function () {
    const self  = this;
    const defer = libQ.defer();

    self.authToken = null;
    self.userId    = null;
    self.userUuid  = null;
    self.userEmail = null;

    self.config.set('username', '');
    self.config.set('password', '');
    self.config.set('loggedin', false);

    self.commandRouter.volumioRemoveToBrowseSources(self.serviceName);

    self.getUIConfig().then(function (conf) {
        self.commandRouter.broadcastMessage('pushUiConfig', conf);
    });

    self.commandRouter.pushToastMessage('success', self.getI18n('COMMON.LOGGED_OUT'));
    defer.resolve({});

    return defer.promise;
};

ControllerDMD2Music.prototype.isLoggedIn = function () {
    return this.config.get('loggedin', false);
};

// ---------------------------------------------------------------------------------------------------------------------------
// Browse sources
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.addToBrowseSources = function () {
    const self = this;
    self.logger.info('Adding DMD2 Music to Browse Sources');

    const data = {
        name:        'DMD2 Music',
        uri:         'hotelradio://',
        plugin_type: 'music_service',
        plugin_name: self.serviceName,
        albumart:    '/albumart?sectionimage=music_service/' + self.serviceName + '/icons/dmd2_music-icon.png'
    };
    return self.commandRouter.volumioAddToBrowseSources(data);
};

ControllerDMD2Music.prototype.handleBrowseUri = function (curUri) {
    const self = this;

    const ready = self.authToken
        ? libQ.resolve()
        : self.loginToHotelRadio(self.config.get('username'), self.config.get('password'));

    switch (curUri) {
        case 'hotelradio://':
            return ready.then(function () { return self.handleRootBrowseUri(); });
        default:
            return ready.then(function () { return self.handleCategoryBrowseUri(curUri); });
    }
};

ControllerDMD2Music.prototype.handleRootBrowseUri = function () {
    const defer = libQ.defer();
    const self  = this;

    self.apiGet('https://music-api.dmd2.com/v1/categories/', self.authToken)
        .then(function (body) {
            if (body && body.data && 'categories' in body.data) {
                const categoryItems = body.data['categories'].map(function (category) {
                    return {
                        type:     'item-no-menu',
                        title:    category['group_name'],
                        albumart: category['group_cover'],
                        uri:      'hotelradio://' + category['id']
                    };
                });

                const browseResponse = {
                    navigation: {
                        lists: [{
                            type:               'title',
                            title:              'TRANSLATE.HOTELRADIO.GROUPS',
                            availableListViews: ['grid', 'list'],
                            items:              categoryItems
                        }]
                    }
                };

                self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);
                defer.resolve(browseResponse);
            } else {
                self.logger.error('DMD2 Music: failed to fetch categories: ' + JSON.stringify(body));
                defer.reject();
            }
        })
        .fail(function (err) {
            self.logger.error('DMD2 Music: error fetching categories: ' + err);
            defer.reject();
        });

    return defer.promise;
};

ControllerDMD2Music.prototype.handleCategoryBrowseUri = function (curUri) {
    const defer      = libQ.defer();
    const self       = this;
    const categoryId = curUri.split('/')[2];

    self.apiGet('https://music-api.dmd2.com/v1/channels/category/' + categoryId, self.authToken)
        .then(function (body) {
            if (body && body.data && 'channels' in body.data) {
                const channelItems = body.data['channels'].map(function (channel) {
                    return {
                        type:     'webradio',
                        title:    channel['stream_name'],
                        albumart: channel['channel_cover'],
                        uri:      'hotelradio://' + categoryId + '/' + channel['id'],
                        service:  self.serviceName
                    };
                });

                const browseResponse = {
                    navigation: {
                        lists: [{
                            type:               'title',
                            title:              'TRANSLATE.HOTELRADIO.CHANNELS',
                            availableListViews: ['grid', 'list'],
                            items:              channelItems
                        }]
                    }
                };

                self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);
                defer.resolve(browseResponse);
            } else {
                self.logger.error('DMD2 Music: failed to fetch channels for category ' + categoryId + ': ' + JSON.stringify(body));
                defer.reject();
            }
        })
        .fail(function (err) {
            self.logger.error('DMD2 Music: error fetching channels for category ' + categoryId + ': ' + err);
            defer.reject();
        });

    return defer.promise;
};

// ---------------------------------------------------------------------------------------------------------------------------
// Playback controls
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.explodeUri = function (curUri) {
    const defer      = libQ.defer();
    const self       = this;
    const categoryId = curUri.split('/')[2];
    const channelId  = curUri.split('/')[3];

    self.apiGet('https://music-api.dmd2.com/v1/channels/category/' + categoryId, self.authToken)
        .then(function (body) {
            if (body && body.data && 'channels' in body.data) {
                const explodeResp = {
                    uri:      curUri,
                    service:  self.serviceName,
                    name:     '',
                    title:    '',
                    album:    '',
                    type:     'track',
                    albumart: '/albumart?sectionimage=music_service/' + self.serviceName + '/icons/dmd2_music-icon.png'
                };

                body.data['channels'].forEach(function (channel) {
                    if (channel['id'] == channelId) {
                        explodeResp.name     = channel['stream_name'];
                        explodeResp.title    = channel['stream_name'];
                        explodeResp.albumart = channel['channel_cover'];
                    }
                });

                defer.resolve([explodeResp]);
            } else {
                defer.reject();
            }
        })
        .fail(function (err) {
            self.logger.error('DMD2 Music: error in explodeUri: ' + err);
            defer.reject();
        });

    return defer.promise;
};

ControllerDMD2Music.prototype.getStreamUrl = function (curUri) {
    const defer      = libQ.defer();
    const self       = this;
    const categoryId = curUri.split('/')[2];
    const channelId  = curUri.split('/')[3];

    self.apiGet('https://music-api.dmd2.com/v1/channels/category/' + categoryId, self.authToken)
        .then(function (body) {
            if (body && body.data && 'channels' in body.data) {
                const streamUri = { uri: '' };

                body.data['channels'].forEach(function (channel) {
                    if (channel['id'] == channelId) {
                        if (channel['mp3128_stream_dir'] && channel['mp3128_stream_dir'] !== '') {
                            streamUri.uri = channel['stream_path'] + channel['mp3128_stream_dir'];
                        } else if (channel['aacp_stream_dir'] && channel['aacp_stream_dir'] !== '') {
                            streamUri.uri = channel['stream_path'] + channel['aacp_stream_dir'];
                        } else {
                            streamUri.uri = channel['stream_path'] + channel['stream_dir'];
                        }
                    }
                });

                defer.resolve(streamUri);
            } else {
                defer.reject();
            }
        })
        .fail(function (err) {
            self.logger.error('DMD2 Music: error in getStreamUrl: ' + err);
            defer.reject();
        });

    return defer.promise;
};

ControllerDMD2Music.prototype.clearAddPlayTrack = function (track) {
    const self  = this;
    const defer = libQ.defer();

    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerDMD2Music::clearAddPlayTrack');

    self.getStreamUrl(track.uri)
        .then(function (stream) {
            return self.mpdPlugin.sendMpdCommand('stop', [])
                .then(function () {
                    return self.mpdPlugin.sendMpdCommand('clear', []);
                })
                .then(function () {
                    return self.mpdPlugin.sendMpdCommand('load "' + stream.uri + '"', []);
                })
                .fail(function () {
                    return self.mpdPlugin.sendMpdCommand('add "' + stream.uri + '"', []);
                })
                .then(function () {
                    self.commandRouter.stateMachine.setConsumeUpdateService('mpd');
                    return self.mpdPlugin.sendMpdCommand('play', []);
                })
                .fail(function (e) {
                    self.logger.error('Could not Clear and Play DMD2 Music Track: ' + e);
                    defer.reject(new Error());
                });
        })
        .fail(function (e) {
            self.logger.error('Could not get DMD2 Music Stream URL: ' + e);
            defer.reject(new Error());
        });

    return defer;
};

ControllerDMD2Music.prototype.stop = function () {
    const self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerDMD2Music::stop');
    return self.mpdPlugin.sendMpdCommand('stop', []);
};

ControllerDMD2Music.prototype.pause = function () {
    const self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerDMD2Music::pause');
    return self.mpdPlugin.sendMpdCommand('stop', []);
};

ControllerDMD2Music.prototype.seek = function (timepos) {
    this.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerDMD2Music::seek to ' + timepos);
    return libQ.resolve();
};

ControllerDMD2Music.prototype.getState = function () {
    this.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerDMD2Music::getState');
};

ControllerDMD2Music.prototype.parseState = function (sState) {
    this.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerDMD2Music::parseState');
};

ControllerDMD2Music.prototype.pushState = function (state) {
    const self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerDMD2Music::pushState');
    return self.commandRouter.servicePushState(state, self.serviceName);
};

// ---------------------------------------------------------------------------------------------------------------------------
// Search (not supported for this service)
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.search = function (query) {
    return libQ.resolve([]);
};

ControllerDMD2Music.prototype._searchArtists   = function (results) {};
ControllerDMD2Music.prototype._searchAlbums    = function (results) {};
ControllerDMD2Music.prototype._searchPlaylists = function (results) {};
ControllerDMD2Music.prototype._searchTracks    = function (results) {};

ControllerDMD2Music.prototype.goto = function (data) {
    return libQ.resolve();
};

// ---------------------------------------------------------------------------------------------------------------------------
// Token refresh cron
// ---------------------------------------------------------------------------------------------------------------------------

ControllerDMD2Music.prototype.startRefreshCron = function () {
    const self = this;

    this.stopRefreshCron();

    const m          = moment();
    const cronString = m.second() + ' ' + m.minute() + ' ' + m.hour() + ',' + (m.hour() + 12) % 24 + ' * * *';

    this.accessTokenRefreshCron = cron.scheduleJob(cronString, function () {
        self.startupLogin();
    });

    this.logger.info('AccessToken refresher cron started for DMD2 Music');
};

ControllerDMD2Music.prototype.stopRefreshCron = function () {
    if (this.accessTokenRefreshCron) {
        this.accessTokenRefreshCron.cancel();
        this.accessTokenRefreshCron = undefined;
    }

    this.logger.info('Stopping AccessToken refresher cron for DMD2 Music');
};