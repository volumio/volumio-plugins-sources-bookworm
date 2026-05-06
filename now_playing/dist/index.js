"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _ControllerNowPlaying_instances, _ControllerNowPlaying_context, _ControllerNowPlaying_config, _ControllerNowPlaying_commandRouter, _ControllerNowPlaying_volumioLanguageChangeCallback, _ControllerNowPlaying_hostMonitor, _ControllerNowPlaying_doGetUIConfig, _ControllerNowPlaying_parseConfigSaveData, _ControllerNowPlaying_configSaveDockedComponentSettings, _ControllerNowPlaying_configureWeatherApi, _ControllerNowPlaying_broadcastPluginInfo, _ControllerNowPlaying_notifyCommonSettingsUpdated, _ControllerNowPlaying_doOnStart, _ControllerNowPlaying_doOnStop, _ControllerNowPlaying_startApp, _ControllerNowPlaying_stopApp, _ControllerNowPlaying_restartApp, _ControllerNowPlaying_onVolumioLanguageChanged, _ControllerNowPlaying_stdLogError;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const kew_1 = __importDefault(require("kew"));
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const v_conf_1 = __importDefault(require("v-conf"));
const geo_tz_1 = __importDefault(require("geo-tz"));
const NowPlayingContext_1 = __importDefault(require("./lib/NowPlayingContext"));
const Misc_1 = require("./lib/utils/Misc");
const App = __importStar(require("./app"));
const CommonSettingsLoader_1 = __importDefault(require("./lib/config/CommonSettingsLoader"));
const ConfigHelper_1 = __importDefault(require("./lib/config/ConfigHelper"));
const SystemUtils = __importStar(require("./lib/utils/System"));
const KioskUtils = __importStar(require("./lib/utils/Kiosk"));
const ConfigUpdater_1 = __importDefault(require("./lib/config/ConfigUpdater"));
const MetadataAPI_1 = __importDefault(require("./lib/api/MetadataAPI"));
const WeatherAPI_1 = require("./lib/api/WeatherAPI");
const now_playing_common_1 = require("now-playing-common");
const UIConfigHelper_1 = __importDefault(require("./lib/config/UIConfigHelper"));
const ConfigBackupHelper_1 = __importDefault(require("./lib/config/ConfigBackupHelper"));
const MyBackgroundMonitor_1 = __importDefault(require("./lib/utils/MyBackgroundMonitor"));
const HostMonitor_1 = require("./lib/utils/HostMonitor");
class ControllerNowPlaying {
    constructor(context) {
        _ControllerNowPlaying_instances.add(this);
        _ControllerNowPlaying_context.set(this, void 0);
        _ControllerNowPlaying_config.set(this, void 0);
        _ControllerNowPlaying_commandRouter.set(this, void 0);
        _ControllerNowPlaying_volumioLanguageChangeCallback.set(this, void 0);
        // For DHCP networks, when plugin starts, there's no guarantee that the IP address 
        // has been obtained. Use HostMonitor to check periodically and refresh host-dependent
        // components on change.
        _ControllerNowPlaying_hostMonitor.set(this, void 0);
        __classPrivateFieldSet(this, _ControllerNowPlaying_context, context, "f");
        __classPrivateFieldSet(this, _ControllerNowPlaying_commandRouter, __classPrivateFieldGet(this, _ControllerNowPlaying_context, "f").coreCommand, "f");
        __classPrivateFieldSet(this, _ControllerNowPlaying_volumioLanguageChangeCallback, null, "f");
        __classPrivateFieldSet(this, _ControllerNowPlaying_hostMonitor, null, "f");
    }
    getUIConfig() {
        return (0, Misc_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_doGetUIConfig).call(this))
            .fail((error) => {
            NowPlayingContext_1.default.getLogger().error(`[now-playing] getUIConfig(): Cannot populate configuration - ${error}`);
            throw error;
        });
    }
    configureVolumioKiosk(data) {
        KioskUtils.configureVolumioKiosk(data.display)
            .catch((error) => __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_stdLogError).call(this, 'KioskUtils.configureVolumioKiosk()', error))
            .finally(() => {
            NowPlayingContext_1.default.refreshUIConfig();
        });
    }
    restoreVolumioKioskBak() {
        KioskUtils.restoreVolumioKiosk()
            .catch((error) => __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_stdLogError).call(this, 'KioskUtils.restoreVolumioKiosk()', error))
            .finally(() => {
            NowPlayingContext_1.default.refreshUIConfig();
        });
    }
    configSaveDaemon(data) {
        const oldPort = NowPlayingContext_1.default.getConfigValue('port');
        const port = parseInt(data['port'], 10);
        if (port < 1024 || port > 65353) {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_INVALID_PORT'));
            return;
        }
        if (oldPort !== port) {
            const modalData = {
                title: NowPlayingContext_1.default.getI18n('NOW_PLAYING_CONFIGURATION'),
                message: NowPlayingContext_1.default.getI18n('NOW_PLAYING_CONF_RESTART_CONFIRM'),
                size: 'lg',
                buttons: [
                    {
                        name: NowPlayingContext_1.default.getI18n('NOW_PLAYING_NO'),
                        class: 'btn btn-warning'
                    },
                    {
                        name: NowPlayingContext_1.default.getI18n('NOW_PLAYING_YES'),
                        class: 'btn btn-info',
                        emit: 'callMethod',
                        payload: {
                            'endpoint': 'user_interface/now_playing',
                            'method': 'configConfirmSaveDaemon',
                            'data': { port, oldPort }
                        }
                    }
                ]
            };
            NowPlayingContext_1.default.broadcastMessage('openModal', modalData);
        }
        else {
            NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        }
    }
    configConfirmSaveDaemon(data) {
        // Obtain kiosk info before saving new port
        const kiosk = KioskUtils.checkVolumioKiosk();
        NowPlayingContext_1.default.setConfigValue('port', data.port);
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_restartApp).call(this).then(() => {
            NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_RESTARTED'));
            // Update cached plugin info and broadcast it
            NowPlayingContext_1.default.delete('pluginInfo');
            __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_broadcastPluginInfo).call(this);
            /**
             * Check if kiosk script was set to show Now Playing, and update
             * to new port (do not restart volumio-kiosk service because
             * the screen will reload itself when app is started).
             */
            if (kiosk.exists && kiosk.display == 'nowPlaying') {
                KioskUtils
                    .modifyVolumioKioskScript(data.oldPort, data.port, false)
                    .catch((error) => __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_stdLogError).call(this, 'KioskUtils.modifyVolumioKioskScript()', error));
            }
            NowPlayingContext_1.default.refreshUIConfig();
        })
            .catch(() => {
            NowPlayingContext_1.default.setConfigValue('port', data['oldPort']);
            NowPlayingContext_1.default.refreshUIConfig();
        });
    }
    configSaveStartupOptions(data) {
        const apply = __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_parseConfigSaveData).call(this, data);
        NowPlayingContext_1.default.setConfigValue('startup', apply);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        /**
         * Note here we don't broadcast 'settings updated' message, because
         * startup options are applied only once during app startup.
         */
    }
    configSaveLayouts(data) {
        const apply = __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_parseConfigSaveData).call(this, data);
        const screen = NowPlayingContext_1.default.getConfigValue('screen.nowPlaying');
        const infoViewLayout = screen.infoViewLayout || {};
        infoViewLayout.type = apply.npInfoViewLayoutType;
        infoViewLayout.layout = apply.npInfoViewLayout;
        infoViewLayout.preferBiggerAlbumArt = apply.npInfoViewLayoutPreferBiggerAlbumArt;
        screen.infoViewLayout = infoViewLayout;
        NowPlayingContext_1.default.setConfigValue('screen.nowPlaying', screen);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.NowPlayingScreen);
    }
    configSaveContentRegionSettings(data) {
        const apply = __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_parseConfigSaveData).call(this, data);
        const current = NowPlayingContext_1.default.getConfigValue('contentRegion');
        const updated = Object.assign(current, apply);
        NowPlayingContext_1.default.setConfigValue('contentRegion', updated);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.ContentRegion);
    }
    configSaveTextStyles(data) {
        const maxTitleLines = data.maxTitleLines !== '' ? parseInt(data.maxTitleLines, 10) : '';
        const maxArtistLines = data.maxArtistLines !== '' ? parseInt(data.maxArtistLines, 10) : '';
        const maxAlbumLines = data.maxAlbumLines !== '' ? parseInt(data.maxAlbumLines, 10) : '';
        const trackInfoTitleOrder = data.trackInfoTitleOrder !== '' ? parseInt(data.trackInfoTitleOrder, 10) : '';
        const trackInfoArtistOrder = data.trackInfoArtistOrder !== '' ? parseInt(data.trackInfoArtistOrder, 10) : '';
        const trackInfoAlbumOrder = data.trackInfoAlbumOrder !== '' ? parseInt(data.trackInfoAlbumOrder, 10) : '';
        const trackInfoMediaInfoOrder = data.trackInfoMediaInfoOrder !== '' ? parseInt(data.trackInfoMediaInfoOrder, 10) : '';
        const apply = {
            trackInfoVisibility: data.trackInfoVisibility.value,
            titleVisibility: data.titleVisibility,
            artistVisibility: data.artistVisibility,
            albumVisibility: data.albumVisibility,
            mediaInfoVisibility: data.mediaInfoVisibility,
            fontStyles: data.fontStyles.value,
            titleFontStyle: data.titleFontStyle.value,
            artistFontStyle: data.artistFontStyle.value,
            albumFontStyle: data.albumFontStyle.value,
            mediaInfoFontStyle: data.mediaInfoFontStyle.value,
            seekTimeFontStyle: data.seekTimeFontStyle.value,
            metadataFontStyle: data.metadataFontStyle.value,
            fontSizes: data.fontSizes.value,
            titleFontSize: data.titleFontSize,
            artistFontSize: data.artistFontSize,
            albumFontSize: data.albumFontSize,
            mediaInfoFontSize: data.mediaInfoFontSize,
            seekTimeFontSize: data.seekTimeFontSize,
            metadataFontSize: data.metadataFontSize,
            syncedLyricsCurrentLineFontSize: data.syncedLyricsCurrentLineFontSize,
            fontColors: data.fontColors.value,
            titleFontColor: data.titleFontColor,
            artistFontColor: data.artistFontColor,
            albumFontColor: data.albumFontColor,
            mediaInfoFontColor: data.mediaInfoFontColor,
            seekTimeFontColor: data.seekTimeFontColor,
            metadataFontColor: data.metadataFontColor,
            syncedLyricsColor: data.syncedLyricsColor,
            syncedLyricsCurrentLineColor: data.syncedLyricsCurrentLineColor,
            textAlignmentH: data.textAlignmentH.value,
            textAlignmentV: data.textAlignmentV.value,
            textAlignmentLyrics: data.textAlignmentLyrics.value,
            textMargins: data.textMargins.value,
            titleMargin: data.titleMargin,
            artistMargin: data.artistMargin,
            albumMargin: data.albumMargin,
            mediaInfoMargin: data.mediaInfoMargin,
            maxLines: data.maxLines.value,
            maxTitleLines,
            maxArtistLines,
            maxAlbumLines,
            trackInfoOrder: data.trackInfoOrder.value,
            trackInfoTitleOrder,
            trackInfoArtistOrder,
            trackInfoAlbumOrder,
            trackInfoMediaInfoOrder,
            trackInfoMarqueeTitle: data.trackInfoMarqueeTitle
        };
        const current = NowPlayingContext_1.default.getConfigValue('screen.nowPlaying');
        const updated = Object.assign(current, apply);
        NowPlayingContext_1.default.setConfigValue('screen.nowPlaying', updated);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.NowPlayingScreen);
    }
    configSaveWidgetStyles(data) {
        const apply = {
            widgetColors: data.widgetColors.value,
            widgetPrimaryColor: data.widgetPrimaryColor,
            widgetHighlightColor: data.widgetHighlightColor,
            widgetVisibility: data.widgetVisibility.value,
            playbackButtonsVisibility: data.playbackButtonsVisibility,
            seekbarVisibility: data.seekbarVisibility,
            playbackButtonSizeType: data.playbackButtonSizeType.value,
            playbackButtonSize: data.playbackButtonSize,
            seekbarStyling: data.seekbarStyling.value,
            seekbarThickness: data.seekbarThickness,
            seekbarBorderRadius: data.seekbarBorderRadius,
            seekbarShowThumb: data.seekbarShowThumb,
            seekbarThumbSize: data.seekbarThumbSize,
            widgetMargins: data.widgetMargins.value,
            playbackButtonsMargin: data.playbackButtonsMargin,
            seekbarMargin: data.seekbarMargin
        };
        const current = NowPlayingContext_1.default.getConfigValue('screen.nowPlaying');
        const updated = Object.assign(current, apply);
        NowPlayingContext_1.default.setConfigValue('screen.nowPlaying', updated);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.NowPlayingScreen);
    }
    configSaveAlbumartStyles(data) {
        const apply = __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_parseConfigSaveData).call(this, data);
        const current = NowPlayingContext_1.default.getConfigValue('screen.nowPlaying');
        const normalizedCurrent = CommonSettingsLoader_1.default.get(now_playing_common_1.CommonSettingsCategory.NowPlayingScreen);
        const refresh = normalizedCurrent.albumartVisibility !== apply.albumartVisibility;
        const updated = Object.assign(current, apply);
        NowPlayingContext_1.default.setConfigValue('screen.nowPlaying', updated);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.NowPlayingScreen);
        if (refresh) {
            NowPlayingContext_1.default.refreshUIConfig();
        }
    }
    configSaveBackgroundStyles(data) {
        const apply = __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_parseConfigSaveData).call(this, data);
        if (apply.myBackgroundImage === '/RANDOM/') {
            apply.myBackgroundImageType = 'random';
            apply.myBackgroundImage = '';
        }
        else {
            apply.myBackgroundImageType = 'fixed';
        }
        apply.myBackgroundRandomRefreshInterval = apply.myBackgroundRandomRefreshInterval ? parseInt(apply.myBackgroundRandomRefreshInterval, 10) : 0;
        if (apply.myBackgroundImage === '/SEPARATOR/') {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_INVALID_BACKGROUND'));
            return;
        }
        const current = NowPlayingContext_1.default.getConfigValue('background');
        const updated = Object.assign(current, apply);
        NowPlayingContext_1.default.setConfigValue('background', updated);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.Background);
    }
    configSaveActionPanelSettings(data) {
        const settings = {
            showVolumeSlider: data.showVolumeSlider
        };
        const current = NowPlayingContext_1.default.getConfigValue('actionPanel');
        const updated = Object.assign(current, settings);
        NowPlayingContext_1.default.setConfigValue('actionPanel', updated);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.ActionPanel);
    }
    configSaveDockedMenuSettings(data) {
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configSaveDockedComponentSettings).call(this, data, 'dockedMenu');
    }
    configSaveDockedActionPanelTriggerSettings(data) {
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configSaveDockedComponentSettings).call(this, data, 'dockedActionPanelTrigger');
    }
    configSaveDockedVolumeIndicatorSettings(data) {
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configSaveDockedComponentSettings).call(this, data, 'dockedVolumeIndicator');
    }
    configSaveDockedClockSettings(data) {
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configSaveDockedComponentSettings).call(this, data, 'dockedClock');
    }
    configSaveDockedWeatherSettings(data) {
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configSaveDockedComponentSettings).call(this, data, 'dockedWeather');
    }
    configSaveDockedMediaFormatSettings(data) {
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configSaveDockedComponentSettings).call(this, data, 'dockedMediaFormat');
    }
    configSaveLocalizationSettings(data) {
        const settings = {
            geoCoordinates: data.geoCoordinates,
            locale: data.locale.value,
            timezone: data.timezone.value,
            unitSystem: data.unitSystem.value
        };
        if (settings.locale === 'localeListDivider') {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_LOCALE_SELECTION_INVALID'));
            return;
        }
        if (settings.timezone === 'timezoneListDivider') {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_TIMEZONE_SELECTION_INVALID'));
            return;
        }
        let successMessage = NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED');
        if (settings.timezone === 'matchGeoCoordinates') {
            const coord = ConfigHelper_1.default.parseCoordinates(settings.geoCoordinates || '');
            if (!coord) {
                NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_INVALID_GEO_COORD'));
                return;
            }
            const matchTimezones = geo_tz_1.default.find(coord.lat, coord.lon);
            if (Array.isArray(matchTimezones) && matchTimezones.length > 0) {
                settings.geoTimezone = matchTimezones[0];
                successMessage = NowPlayingContext_1.default.getI18n('NOW_PLAYING_TZ_SET_BY_GEO_COORD', matchTimezones[0]);
            }
            else {
                settings.geoTimezone = null;
                successMessage = null;
                NowPlayingContext_1.default.toast('warning', NowPlayingContext_1.default.getI18n('NOW_PLAYING_TZ_BY_GEO_COORD_NOT_FOUND'));
            }
        }
        NowPlayingContext_1.default.setConfigValue('localization', settings);
        if (successMessage) {
            NowPlayingContext_1.default.toast('success', successMessage);
        }
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configureWeatherApi).call(this);
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.Localization);
    }
    configSaveWeatherServiceSettings(data) {
        const raw = data['weatherCacheMinutes']?.value ?? data['weatherCacheMinutes'];
        const num = typeof raw === 'number' ? raw : parseInt(raw, 10);
        const allowedCacheValues = [10, 30, 60, 120, 360, 720, 1440];
        const cacheMinutes = (Number.isInteger(num) && allowedCacheValues.includes(num)) ? num : 10;
        const settings = {
            cacheMinutes
        };
        NowPlayingContext_1.default.setConfigValue('weather', settings);
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configureWeatherApi).call(this);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
    }
    configSaveMetadataServiceSettings(data) {
        const token = data['geniusAccessToken'].trim();
        const settings = {
            geniusAccessToken: token,
            excludeParenthesized: data['excludeParenthesized'],
            parenthesisType: data['parenthesisType'].value,
            queryMusicServices: data['queryMusicServices'],
            enableSyncedLyrics: data['enableSyncedLyrics']
        };
        NowPlayingContext_1.default.setConfigValue('metadataService', settings);
        MetadataAPI_1.default.updateSettings(settings);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
    }
    configSaveIdleScreenSettings(data) {
        const apply = __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_parseConfigSaveData).call(this, data);
        if (apply.waitTime) {
            apply.waitTime = parseInt(apply.waitTime, 10);
        }
        if (apply.myBackgroundImage === '/RANDOM/') {
            apply.myBackgroundImageType = 'random';
            apply.myBackgroundImage = '';
        }
        else {
            apply.myBackgroundImageType = 'fixed';
        }
        apply.myBackgroundRandomRefreshInterval = apply.myBackgroundRandomRefreshInterval ? parseInt(apply.myBackgroundRandomRefreshInterval, 10) : 10;
        apply.unsplashRefreshInterval = data.unsplashRefreshInterval ? parseInt(apply.unsplashRefreshInterval, 10) : 10;
        if (apply.waitTime < 10) {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_IDLE_SCREEN_WAIT_TIME'));
            return;
        }
        if (apply.myBackgroundImage === '/SEPARATOR/') {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_INVALID_BACKGROUND'));
            return;
        }
        if (apply.unsplashRefreshInterval !== 0 && apply.unsplashRefreshInterval < 10) {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_UNSPLASH_REFRESH_INTERVAL'));
            return;
        }
        apply.mainAlignmentCycleInterval = data.mainAlignmentCycleInterval ? parseInt(apply.mainAlignmentCycleInterval, 10) : 60;
        if (apply.mainAlignmentCycleInterval !== 0 && apply.mainAlignmentCycleInterval < 10) {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_CYCLE_INTERVAL'));
            return;
        }
        const current = NowPlayingContext_1.default.getConfigValue('screen.idle');
        const normalizedCurrent = CommonSettingsLoader_1.default.get(now_playing_common_1.CommonSettingsCategory.IdleScreen);
        const refresh = (normalizedCurrent.enabled !== 'disabled' && apply.enabled === 'disabled') ||
            (normalizedCurrent.enabled === 'disabled' && apply.enabled !== 'disabled');
        const updated = Object.assign(current, apply);
        NowPlayingContext_1.default.setConfigValue('screen.idle', updated);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.IdleScreen);
        if (refresh) {
            NowPlayingContext_1.default.refreshUIConfig();
        }
    }
    configSaveExtraScreenSettings(data) {
        const theme = {
            active: data.theme.value
        };
        NowPlayingContext_1.default.setConfigValue('theme', theme);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.Theme);
    }
    configSavePerformanceSettings(data) {
        const syncedLyricsDelay = data.syncedLyricsDelay !== '' ? parseInt(data.syncedLyricsDelay, 10) : 0;
        const settings = {
            transitionEffectsKiosk: data.transitionEffectsKiosk,
            transitionEffectsOtherDevices: data.transitionEffectsOtherDevices,
            unmountScreensOnExit: data.unmountScreensOnExit.value,
            unmountNowPlayingScreenOnExit: data.unmountNowPlayingScreenOnExit,
            unmountBrowseScreenOnExit: data.unmountBrowseScreenOnExit,
            unmountQueueScreenOnExit: data.unmountQueueScreenOnExit,
            unmountVolumioScreenOnExit: data.unmountVolumioScreenOnExit,
            syncedLyricsDelay
        };
        NowPlayingContext_1.default.setConfigValue('performance', settings);
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.Performance);
    }
    configBackupConfig(data) {
        const backupName = data.backupName?.trim();
        if (!backupName) {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_NO_BACKUP_NAME'));
            return;
        }
        try {
            ConfigBackupHelper_1.default.createBackup(backupName);
        }
        catch (error) {
            NowPlayingContext_1.default.getLogger().error(`[now-playing] Failed to backup config: ${error.message}`);
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_BACKUP_CONFIG', NowPlayingContext_1.default.getErrorMessage('', error, false)));
            return;
        }
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_BACKUP_CREATED'));
        NowPlayingContext_1.default.refreshUIConfig();
    }
    async configRestoreConfigFromBackup(data) {
        const backupName = data.backupName?.trim();
        if (!backupName) {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_NO_BACKUP_NAME'));
            return;
        }
        try {
            await ConfigBackupHelper_1.default.replacePluginConfigWithBackup(backupName);
        }
        catch (error) {
            NowPlayingContext_1.default.getLogger().error(`[now-playing] Failed to restore config: ${error.message}`);
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_RESTORE_CONFIG', NowPlayingContext_1.default.getErrorMessage('', error, false)));
            return;
        }
        /**
         * ConfigBackupHelper only replaces the plugin config with backup. We still need
         * to restart the plugin for changed config to take effect.
         */
        const configFilePath = NowPlayingContext_1.default.getConfigFilePath();
        await __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_doOnStop).call(this);
        __classPrivateFieldGet(this, _ControllerNowPlaying_config, "f").loadFile(configFilePath);
        await __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_doOnStart).call(this);
        this.broadcastRefresh();
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_CONFIG_RESTORED', backupName));
        NowPlayingContext_1.default.refreshUIConfig();
    }
    configDeleteConfigBackup(data) {
        const backupName = data.backupName?.trim();
        if (!backupName) {
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_NO_BACKUP_NAME'));
            return;
        }
        try {
            ConfigBackupHelper_1.default.deleteBackup(backupName);
        }
        catch (error) {
            NowPlayingContext_1.default.getLogger().error(`[now-playing] Failed to delete config backup: ${error.message}`);
            NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_DELETE_BACKUP', NowPlayingContext_1.default.getErrorMessage('', error, false)));
            return;
        }
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_BACKUP_DELETED'));
        NowPlayingContext_1.default.refreshUIConfig();
    }
    clearMetadataCache() {
        MetadataAPI_1.default.clearCache();
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_CACHE_CLEARED'));
    }
    clearWeatherCache() {
        (0, WeatherAPI_1.getWeatherAPI)().clearCache();
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_CACHE_CLEARED'));
    }
    broadcastRefresh() {
        NowPlayingContext_1.default.broadcastMessage('nowPlayingRefresh');
        NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_BROADCASTED_COMMAND'));
    }
    // Socket callMethod
    getPluginInfo() {
        return {
            message: 'nowPlayingPluginInfo',
            payload: SystemUtils.getPluginInfo()
        };
    }
    // Plugin lifecycle
    onVolumioStart() {
        const configFile = __classPrivateFieldGet(this, _ControllerNowPlaying_commandRouter, "f").pluginManager.getConfigurationFile(__classPrivateFieldGet(this, _ControllerNowPlaying_context, "f"), 'config.json');
        __classPrivateFieldSet(this, _ControllerNowPlaying_config, new v_conf_1.default(), "f");
        __classPrivateFieldGet(this, _ControllerNowPlaying_config, "f").loadFile(configFile);
        return kew_1.default.resolve(true);
    }
    onStart() {
        return (0, Misc_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_doOnStart).call(this));
    }
    onStop() {
        return (0, Misc_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_doOnStop).call(this));
    }
    getConfigurationFiles() {
        return ['config.json'];
    }
}
_ControllerNowPlaying_context = new WeakMap(), _ControllerNowPlaying_config = new WeakMap(), _ControllerNowPlaying_commandRouter = new WeakMap(), _ControllerNowPlaying_volumioLanguageChangeCallback = new WeakMap(), _ControllerNowPlaying_hostMonitor = new WeakMap(), _ControllerNowPlaying_instances = new WeakSet(), _ControllerNowPlaying_doGetUIConfig = async function _ControllerNowPlaying_doGetUIConfig() {
    const langCode = __classPrivateFieldGet(this, _ControllerNowPlaying_commandRouter, "f").sharedVars.get('language_code');
    const uiconf = await (0, Misc_1.kewToJSPromise)(__classPrivateFieldGet(this, _ControllerNowPlaying_commandRouter, "f").i18nJson(`${__dirname}/i18n/strings_${langCode}.json`, `${__dirname}/i18n/strings_en.json`, `${__dirname}/UIConfig.json`));
    return UIConfigHelper_1.default.populate(UIConfigHelper_1.default.observe(uiconf));
}, _ControllerNowPlaying_parseConfigSaveData = function _ControllerNowPlaying_parseConfigSaveData(data) {
    const apply = {};
    for (const [key, value] of Object.entries(data)) {
        // Check if dropdown selection
        if (typeof value === 'object' && Reflect.has(value, 'value')) {
            apply[key] = value.value;
        }
        else {
            apply[key] = value;
        }
    }
    return apply;
}, _ControllerNowPlaying_configSaveDockedComponentSettings = function _ControllerNowPlaying_configSaveDockedComponentSettings(data, componentName) {
    const apply = __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_parseConfigSaveData).call(this, data);
    const screen = NowPlayingContext_1.default.getConfigValue('screen.nowPlaying');
    const current = screen[componentName] || {};
    const normalizedCurrent = CommonSettingsLoader_1.default.get(now_playing_common_1.CommonSettingsCategory.NowPlayingScreen)[componentName];
    const refresh = normalizedCurrent.enabled !== apply.enabled;
    const updated = Object.assign(current, apply);
    screen[componentName] = updated;
    NowPlayingContext_1.default.setConfigValue('screen.nowPlaying', screen);
    NowPlayingContext_1.default.toast('success', NowPlayingContext_1.default.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
    __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.NowPlayingScreen);
    if (refresh) {
        NowPlayingContext_1.default.refreshUIConfig();
    }
}, _ControllerNowPlaying_configureWeatherApi = function _ControllerNowPlaying_configureWeatherApi() {
    const localization = CommonSettingsLoader_1.default.get(now_playing_common_1.CommonSettingsCategory.Localization);
    const weather = NowPlayingContext_1.default.getConfigValue('weather');
    (0, WeatherAPI_1.getWeatherAPI)().setConfig({
        coordinates: localization.geoCoordinates,
        locale: localization.resolvedLocale || ConfigHelper_1.default.getVolumioLocale(),
        timezone: localization.resolvedTimezone || localization.geoTimezone || undefined,
        units: localization.unitSystem,
        cacheMinutes: weather?.cacheMinutes ?? 10,
        appUrl: this.getPluginInfo().payload.appUrl
    });
}, _ControllerNowPlaying_broadcastPluginInfo = function _ControllerNowPlaying_broadcastPluginInfo() {
    const { message, payload } = this.getPluginInfo();
    NowPlayingContext_1.default.broadcastMessage(message, payload);
}, _ControllerNowPlaying_notifyCommonSettingsUpdated = function _ControllerNowPlaying_notifyCommonSettingsUpdated(category) {
    NowPlayingContext_1.default.broadcastMessage('nowPlayingPushSettings', {
        category,
        data: CommonSettingsLoader_1.default.get(category)
    });
}, _ControllerNowPlaying_doOnStart = async function _ControllerNowPlaying_doOnStart() {
    NowPlayingContext_1.default.init(__classPrivateFieldGet(this, _ControllerNowPlaying_context, "f"), __classPrivateFieldGet(this, _ControllerNowPlaying_config, "f"));
    await ConfigUpdater_1.default.checkAndUpdate();
    MetadataAPI_1.default.updateSettings(NowPlayingContext_1.default.getConfigValue('metadataService'));
    __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configureWeatherApi).call(this);
    // Host monitor
    const host = NowPlayingContext_1.default.getDeviceInfo().host;
    if (host === 'http://127.0.0.1') {
        __classPrivateFieldSet(this, _ControllerNowPlaying_hostMonitor, new HostMonitor_1.HostMonitor(), "f");
        __classPrivateFieldGet(this, _ControllerNowPlaying_hostMonitor, "f").on('change', (previous, current) => {
            NowPlayingContext_1.default.getLogger().info(`[now-playing] Detected host change: ${previous} => ${current}`);
            if (current !== 'http://127.0.0.1') {
                __classPrivateFieldGet(this, _ControllerNowPlaying_hostMonitor, "f")?.stop();
            }
            // Delete any cached instance of device / plugin info and broadcast updated one
            NowPlayingContext_1.default.delete('deviceInfo');
            NowPlayingContext_1.default.delete('pluginInfo');
            __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_broadcastPluginInfo).call(this);
            // Refesh UI config to show updated preview URL
            NowPlayingContext_1.default.refreshUIConfig();
            // Refesh weather service since icons URLs would have changed
            __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_configureWeatherApi).call(this);
        });
        __classPrivateFieldGet(this, _ControllerNowPlaying_hostMonitor, "f").start();
    }
    // Register language change listener
    __classPrivateFieldSet(this, _ControllerNowPlaying_volumioLanguageChangeCallback, __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_onVolumioLanguageChanged).bind(this), "f");
    __classPrivateFieldGet(this, _ControllerNowPlaying_context, "f").coreCommand.sharedVars.registerCallback('language_code', __classPrivateFieldGet(this, _ControllerNowPlaying_volumioLanguageChangeCallback, "f"));
    await __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_startApp).call(this);
    const display = NowPlayingContext_1.default.getConfigValue('kioskDisplay');
    if (display == 'nowPlaying') {
        const kiosk = KioskUtils.checkVolumioKiosk();
        if (kiosk.exists && kiosk.display == 'default') {
            await KioskUtils.modifyVolumioKioskScript(3000, NowPlayingContext_1.default.getConfigValue('port'));
        }
    }
    MyBackgroundMonitor_1.default.start();
}, _ControllerNowPlaying_doOnStop = async function _ControllerNowPlaying_doOnStop() {
    __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_stopApp).call(this);
    if (__classPrivateFieldGet(this, _ControllerNowPlaying_hostMonitor, "f")) {
        __classPrivateFieldGet(this, _ControllerNowPlaying_hostMonitor, "f").stop();
        __classPrivateFieldGet(this, _ControllerNowPlaying_hostMonitor, "f").removeAllListeners();
    }
    // Remove language change listener (this is hacky but prevents a potential
    // Memory leak)
    if (__classPrivateFieldGet(this, _ControllerNowPlaying_config, "f").callbacks && __classPrivateFieldGet(this, _ControllerNowPlaying_volumioLanguageChangeCallback, "f")) {
        __classPrivateFieldGet(this, _ControllerNowPlaying_config, "f").callbacks.delete('language_code', __classPrivateFieldGet(this, _ControllerNowPlaying_volumioLanguageChangeCallback, "f"));
        __classPrivateFieldSet(this, _ControllerNowPlaying_volumioLanguageChangeCallback, null, "f");
    }
    // If kiosk is set to Now Playing, restore it back to default
    const kiosk = KioskUtils.checkVolumioKiosk();
    if (kiosk.exists && kiosk.display == 'nowPlaying') {
        try {
            await KioskUtils.modifyVolumioKioskScript(NowPlayingContext_1.default.getConfigValue('port'), 3000);
        }
        catch (error) {
            // Do nothing
        }
    }
    await MyBackgroundMonitor_1.default.stop();
    NowPlayingContext_1.default.reset();
}, _ControllerNowPlaying_startApp = async function _ControllerNowPlaying_startApp() {
    try {
        await App.start();
    }
    catch (error) {
        NowPlayingContext_1.default.toast('error', NowPlayingContext_1.default.getI18n('NOW_PLAYING_DAEMON_START_ERR', error.message));
        throw error;
    }
}, _ControllerNowPlaying_stopApp = function _ControllerNowPlaying_stopApp() {
    App.stop();
}, _ControllerNowPlaying_restartApp = function _ControllerNowPlaying_restartApp() {
    __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_stopApp).call(this);
    return __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_startApp).call(this);
}, _ControllerNowPlaying_onVolumioLanguageChanged = function _ControllerNowPlaying_onVolumioLanguageChanged() {
    // Push localization settings
    NowPlayingContext_1.default.getLogger().info('[now-playing] Volumio language changed - pushing localization settings');
    __classPrivateFieldGet(this, _ControllerNowPlaying_instances, "m", _ControllerNowPlaying_notifyCommonSettingsUpdated).call(this, now_playing_common_1.CommonSettingsCategory.Localization);
}, _ControllerNowPlaying_stdLogError = function _ControllerNowPlaying_stdLogError(fn, error) {
    NowPlayingContext_1.default.getLogger().error(NowPlayingContext_1.default.getErrorMessage(`[now-playing] Caught error in ${fn}:`, error, false));
};
module.exports = ControllerNowPlaying;
