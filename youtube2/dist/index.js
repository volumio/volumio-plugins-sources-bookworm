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
var _ControllerYouTube2_instances, _ControllerYouTube2_context, _ControllerYouTube2_config, _ControllerYouTube2_commandRouter, _ControllerYouTube2_browseController, _ControllerYouTube2_searchController, _ControllerYouTube2_playController, _ControllerYouTube2_nowPlayingMetadataProvider, _ControllerYouTube2_doGetUIConfig, _ControllerYouTube2_getConfigI18nOptions, _ControllerYouTube2_getConfigAccountInfo, _ControllerYouTube2_configCheckAutoplay, _ControllerYouTube2_addToBrowseSources;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const kew_1 = __importDefault(require("kew"));
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const v_conf_1 = __importDefault(require("v-conf"));
const YouTube2Context_1 = __importDefault(require("./lib/YouTube2Context"));
const browse_1 = __importDefault(require("./lib/controller/browse"));
const SearchController_1 = __importDefault(require("./lib/controller/search/SearchController"));
const PlayController_1 = __importDefault(require("./lib/controller/play/PlayController"));
const util_1 = require("./lib/util");
const model_1 = __importStar(require("./lib/model"));
const ViewHelper_1 = __importDefault(require("./lib/controller/browse/view-handlers/ViewHelper"));
const InnertubeLoader_1 = __importDefault(require("./lib/model/InnertubeLoader"));
const YouTube2NowPlayingMetadataProvider_1 = __importDefault(require("./lib/util/YouTube2NowPlayingMetadataProvider"));
const innertube_1 = require("volumio-yt-support/dist/innertube");
const fs_1 = require("fs");
const UIConfigHelper_1 = __importDefault(require("./config/UIConfigHelper"));
const YtDlp_1 = require("./lib/util/YtDlp");
class ControllerYouTube2 {
    constructor(context) {
        _ControllerYouTube2_instances.add(this);
        _ControllerYouTube2_context.set(this, void 0);
        _ControllerYouTube2_config.set(this, void 0);
        _ControllerYouTube2_commandRouter.set(this, void 0);
        _ControllerYouTube2_browseController.set(this, null);
        _ControllerYouTube2_searchController.set(this, null);
        _ControllerYouTube2_playController.set(this, null);
        _ControllerYouTube2_nowPlayingMetadataProvider.set(this, null);
        __classPrivateFieldSet(this, _ControllerYouTube2_context, context, "f");
        __classPrivateFieldSet(this, _ControllerYouTube2_commandRouter, context.coreCommand, "f");
    }
    getUIConfig() {
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerYouTube2_instances, "m", _ControllerYouTube2_doGetUIConfig).call(this)).fail((error) => {
            YouTube2Context_1.default
                .getLogger()
                .error(`[youtube2] getUIConfig(): Cannot populate configuration - ${error}`);
            throw error;
        });
    }
    onVolumioStart() {
        const configFile = __classPrivateFieldGet(this, _ControllerYouTube2_commandRouter, "f").pluginManager.getConfigurationFile(__classPrivateFieldGet(this, _ControllerYouTube2_context, "f"), 'config.json');
        __classPrivateFieldSet(this, _ControllerYouTube2_config, new v_conf_1.default(), "f");
        __classPrivateFieldGet(this, _ControllerYouTube2_config, "f").loadFile(configFile);
        return kew_1.default.resolve();
    }
    onStart() {
        YouTube2Context_1.default.init(__classPrivateFieldGet(this, _ControllerYouTube2_context, "f"), __classPrivateFieldGet(this, _ControllerYouTube2_config, "f"));
        __classPrivateFieldSet(this, _ControllerYouTube2_browseController, new browse_1.default(), "f");
        __classPrivateFieldSet(this, _ControllerYouTube2_searchController, new SearchController_1.default(), "f");
        __classPrivateFieldSet(this, _ControllerYouTube2_playController, new PlayController_1.default(), "f");
        __classPrivateFieldSet(this, _ControllerYouTube2_nowPlayingMetadataProvider, new YouTube2NowPlayingMetadataProvider_1.default(), "f");
        innertube_1.Parser.setParserErrorHandler(() => null); // Disable Innertube parser error reporting
        __classPrivateFieldGet(this, _ControllerYouTube2_instances, "m", _ControllerYouTube2_addToBrowseSources).call(this);
        return kew_1.default.resolve();
    }
    onStop() {
        __classPrivateFieldGet(this, _ControllerYouTube2_commandRouter, "f").volumioRemoveToBrowseSources('YouTube2');
        __classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")?.reset();
        __classPrivateFieldSet(this, _ControllerYouTube2_browseController, null, "f");
        __classPrivateFieldSet(this, _ControllerYouTube2_searchController, null, "f");
        __classPrivateFieldSet(this, _ControllerYouTube2_playController, null, "f");
        __classPrivateFieldSet(this, _ControllerYouTube2_nowPlayingMetadataProvider, null, "f");
        return (0, util_1.jsPromiseToKew)(InnertubeLoader_1.default.reset()
            .then(() => YouTube2Context_1.default.reset()));
    }
    getConfigurationFiles() {
        return ['config.json'];
    }
    showDisclaimer() {
        const langCode = __classPrivateFieldGet(this, _ControllerYouTube2_commandRouter, "f").sharedVars.get('language_code');
        let disclaimerFile = `${__dirname}/i18n/disclaimer_${langCode}.html`;
        if (!(0, fs_1.existsSync)(disclaimerFile)) {
            disclaimerFile = `${__dirname}/i18n/disclaimer_en.html`;
        }
        try {
            const contents = (0, fs_1.readFileSync)(disclaimerFile, { encoding: 'utf8' });
            const modalData = {
                title: YouTube2Context_1.default.getI18n('YOUTUBE2_DISCLAIMER_HEADING'),
                message: contents,
                size: 'lg',
                buttons: [
                    {
                        name: YouTube2Context_1.default.getI18n('YOUTUBE2_CLOSE'),
                        class: 'btn btn-warning'
                    },
                    {
                        name: YouTube2Context_1.default.getI18n('YOUTUBE2_ACCEPT'),
                        class: 'btn btn-info',
                        emit: 'callMethod',
                        payload: {
                            type: 'controller',
                            endpoint: 'music_service/youtube2',
                            method: 'acceptDisclaimer',
                            data: ''
                        }
                    }
                ]
            };
            YouTube2Context_1.default.volumioCoreCommand.broadcastMessage("openModal", modalData);
        }
        catch (error) {
            YouTube2Context_1.default.getLogger().error(`[youtube2] ${YouTube2Context_1.default.getErrorMessage(`Error reading "${disclaimerFile}"`, error, false)}`);
            YouTube2Context_1.default.toast('error', 'Error loading disclaimer contents');
        }
    }
    acceptDisclaimer() {
        this.configSaveDisclaimer({
            hasAcceptedDisclaimer: true
        });
    }
    configSaveDisclaimer(data) {
        YouTube2Context_1.default.setConfigValue('hasAcceptedDisclaimer', data.hasAcceptedDisclaimer);
        YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_SETTINGS_SAVED'));
        YouTube2Context_1.default.refreshUIConfig();
    }
    async configSaveI18n(data) {
        const oldRegion = YouTube2Context_1.default.hasConfigKey('region') ? YouTube2Context_1.default.getConfigValue('region') : null;
        const oldLanguage = YouTube2Context_1.default.hasConfigKey('language') ? YouTube2Context_1.default.getConfigValue('language') : null;
        const region = data.region.value;
        const language = data.language.value;
        if (oldRegion !== region || oldLanguage !== language) {
            YouTube2Context_1.default.setConfigValue('region', region);
            YouTube2Context_1.default.setConfigValue('language', language);
            await InnertubeLoader_1.default.applyI18nConfig();
            model_1.default.getInstance(model_1.ModelType.Config).clearCache();
            YouTube2Context_1.default.refreshUIConfig();
        }
        YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_SETTINGS_SAVED'));
    }
    async configSaveAccount(data) {
        const oldCookie = YouTube2Context_1.default.hasConfigKey('cookie') ? YouTube2Context_1.default.getConfigValue('cookie') : null;
        const cookie = data.cookie?.trim();
        const oldActiveChannelHandle = YouTube2Context_1.default.getConfigValue('activeChannelHandle');
        const activeChannelHandle = data.activeChannelHandle?.value || '';
        let resetInnertube = false;
        if (oldCookie !== cookie) {
            YouTube2Context_1.default.setConfigValue('cookie', cookie);
            YouTube2Context_1.default.deleteConfigValue('activeChannelHandle');
            resetInnertube = true;
        }
        else if (oldActiveChannelHandle !== activeChannelHandle) {
            YouTube2Context_1.default.setConfigValue('activeChannelHandle', activeChannelHandle);
            resetInnertube = true;
        }
        YtDlp_1.YtDlpWrapper.refresh();
        YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_SETTINGS_SAVED'));
        if (resetInnertube) {
            await InnertubeLoader_1.default.reset();
            YouTube2Context_1.default.refreshUIConfig();
        }
    }
    configSaveBrowse(data) {
        YouTube2Context_1.default.setConfigValue('rootContentType', data.rootContentType.value);
        YouTube2Context_1.default.setConfigValue('loadFullPlaylists', data.loadFullPlaylists);
        YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_SETTINGS_SAVED'));
    }
    configSavePlayback(data) {
        YouTube2Context_1.default.setConfigValue('autoplay', data.autoplay);
        YouTube2Context_1.default.setConfigValue('autoplayClearQueue', data.autoplayClearQueue);
        YouTube2Context_1.default.setConfigValue('autoplayPrefMixRelated', data.autoplayPrefMixRelated);
        YouTube2Context_1.default.setConfigValue('addToHistory', data.addToHistory);
        YouTube2Context_1.default.setConfigValue('liveStreamQuality', data.liveStreamQuality.value);
        YouTube2Context_1.default.setConfigValue('prefetch', data.prefetch);
        YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_SETTINGS_SAVED'));
        __classPrivateFieldGet(this, _ControllerYouTube2_instances, "m", _ControllerYouTube2_configCheckAutoplay).call(this);
    }
    configSaveYtDlp(data) {
        const useYtDlp = data.useYtDlp;
        if (useYtDlp) {
            const installed = YtDlp_1.YtDlpWrapper.getInstance().getInstalled();
            if (installed.length === 0) {
                YouTube2Context_1.default.toast('error', YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_USE_YT_DLP_BUT_NONE_INSTALLED'));
                YouTube2Context_1.default.setConfigValue('useYtDlp', false);
                return YouTube2Context_1.default.refreshUIConfig();
            }
        }
        YouTube2Context_1.default.setConfigValue('useYtDlp', useYtDlp);
        const ytDlpVersion = data.ytDlpVersion.value || null;
        YouTube2Context_1.default.setConfigValue('ytDlpVersion', ytDlpVersion);
        YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_SETTINGS_SAVED'));
    }
    async installLatestYtDlp() {
        const ytDlp = YtDlp_1.YtDlpWrapper.getInstance();
        YouTube2Context_1.default.toast('info', YouTube2Context_1.default.getI18n('YOUTUBE2_YT_DLP_INSTALLING'));
        try {
            const result = await ytDlp.install();
            YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_YT_DLP_INSTALLED', result.version));
            YouTube2Context_1.default.setConfigValue('ytDlpVersion', result.version);
            YouTube2Context_1.default.refreshUIConfig();
        }
        catch (error) {
            YouTube2Context_1.default.getLogger().log('error', YouTube2Context_1.default.getErrorMessage('Error installing yt-dlp:', error));
            YouTube2Context_1.default.toast('error', YouTube2Context_1.default.getErrorMessage('Failed to install yt-dlp:', error, false));
        }
    }
    configEnableAddToHistory() {
        YouTube2Context_1.default.setConfigValue('addToHistory', true);
        YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_SETTINGS_SAVED'));
        YouTube2Context_1.default.refreshUIConfig();
    }
    configSaveYouTubePlaybackMode(data) {
        YouTube2Context_1.default.setConfigValue('ytPlaybackMode', {
            feedVideos: data.feedVideos,
            playlistVideos: data.playlistVideos
        });
        YouTube2Context_1.default.toast('success', YouTube2Context_1.default.getI18n('YOUTUBE2_SETTINGS_SAVED'));
    }
    handleBrowseUri(uri) {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_browseController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        if (!YouTube2Context_1.default.getConfigValue('hasAcceptedDisclaimer')) {
            return kew_1.default.reject({
                errorMessage: YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_ACCEPT_DISCLAIMER_BROWSE')
            });
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerYouTube2_browseController, "f").browseUri(uri));
    }
    explodeUri(uri) {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_browseController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        if (!YouTube2Context_1.default.getConfigValue('hasAcceptedDisclaimer')) {
            YouTube2Context_1.default.toast('error', YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_ACCEPT_DISCLAIMER_PLAY'));
            return kew_1.default.reject(YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_ACCEPT_DISCLAIMER_PLAY'));
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerYouTube2_browseController, "f").explodeUri(uri));
    }
    clearAddPlayTrack(track) {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").clearAddPlayTrack(track));
    }
    stop() {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return __classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").stop();
    }
    pause() {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return __classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").pause();
    }
    resume() {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return __classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").resume();
    }
    seek(position) {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return __classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").seek(position);
    }
    next() {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return __classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").next();
    }
    previous() {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return __classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").previous();
    }
    prefetch(track) {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").prefetch(track));
    }
    search(query) {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_searchController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerYouTube2_searchController, "f").search(query));
    }
    goto(data) {
        if (!__classPrivateFieldGet(this, _ControllerYouTube2_playController, "f")) {
            return kew_1.default.reject('YouTube2 plugin is not started');
        }
        const defer = kew_1.default.defer();
        __classPrivateFieldGet(this, _ControllerYouTube2_playController, "f").getGotoUri(data.type, data.uri).then((uri) => {
            if (uri) {
                if (!__classPrivateFieldGet(this, _ControllerYouTube2_browseController, "f")) {
                    return kew_1.default.reject('YouTube2 plugin is not started');
                }
                defer.resolve(__classPrivateFieldGet(this, _ControllerYouTube2_browseController, "f").browseUri(uri));
            }
            else {
                const view = ViewHelper_1.default.getViewsFromUri(data.uri)?.[1];
                const trackData = view?.explodeTrackData || null;
                const trackTitle = trackData?.title;
                let errMsg;
                if (data.type === 'album') {
                    errMsg = trackTitle ? YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_GOTO_PLAYLIST_NOT_FOUND_FOR', trackTitle) :
                        YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_GOTO_PLAYLIST_NOT_FOUND');
                }
                else if (data.type === 'artist') {
                    errMsg = trackTitle ? YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_GOTO_CHANNEL_NOT_FOUND_FOR', trackTitle) :
                        YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_GOTO_CHANNEL_NOT_FOUND');
                }
                else {
                    errMsg = YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_GOTO_UNKNOWN_TYPE', data.type);
                }
                YouTube2Context_1.default.toast('error', errMsg);
                defer.reject(Error(errMsg));
            }
        })
            .catch((error) => {
            YouTube2Context_1.default.getLogger().error(YouTube2Context_1.default.getErrorMessage('[youtube2] Error obtaining goto URL:', error));
        });
        return defer.promise;
    }
    getNowPlayingMetadataProvider() {
        return __classPrivateFieldGet(this, _ControllerYouTube2_nowPlayingMetadataProvider, "f");
    }
}
_ControllerYouTube2_context = new WeakMap(), _ControllerYouTube2_config = new WeakMap(), _ControllerYouTube2_commandRouter = new WeakMap(), _ControllerYouTube2_browseController = new WeakMap(), _ControllerYouTube2_searchController = new WeakMap(), _ControllerYouTube2_playController = new WeakMap(), _ControllerYouTube2_nowPlayingMetadataProvider = new WeakMap(), _ControllerYouTube2_instances = new WeakSet(), _ControllerYouTube2_doGetUIConfig = async function _ControllerYouTube2_doGetUIConfig() {
    const hasAcceptedDisclaimer = YouTube2Context_1.default.getConfigValue('hasAcceptedDisclaimer');
    const langCode = __classPrivateFieldGet(this, _ControllerYouTube2_commandRouter, "f").sharedVars.get('language_code');
    const _uiconf = await (0, util_1.kewToJSPromise)(__classPrivateFieldGet(this, _ControllerYouTube2_commandRouter, "f").i18nJson(`${__dirname}/i18n/strings_${langCode}.json`, `${__dirname}/i18n/strings_en.json`, `${__dirname}/UIConfig.json`));
    const i18nOptions = hasAcceptedDisclaimer ? await __classPrivateFieldGet(this, _ControllerYouTube2_instances, "m", _ControllerYouTube2_getConfigI18nOptions).call(this) : null;
    const account = hasAcceptedDisclaimer ? await __classPrivateFieldGet(this, _ControllerYouTube2_instances, "m", _ControllerYouTube2_getConfigAccountInfo).call(this) : null;
    const configModel = model_1.default.getInstance(model_1.ModelType.Config);
    const uiconf = UIConfigHelper_1.default.observe(_uiconf);
    const disclaimerUIConf = uiconf.section_disclaimer;
    const i18nUIConf = uiconf.section_i18n;
    const accountUIConf = uiconf.section_account;
    const browseUIConf = uiconf.section_browse;
    const playbackUIConf = uiconf.section_playback;
    const ytPlaybackModeConf = uiconf.section_yt_playback_mode;
    const ytDlpUIConf = uiconf.section_yt_dlp;
    // Disclaimer
    disclaimerUIConf.content.hasAcceptedDisclaimer.value = hasAcceptedDisclaimer;
    if (!hasAcceptedDisclaimer) {
        // hasAcceptedDisclaimer is false
        uiconf.sections = [disclaimerUIConf];
        return uiconf;
    }
    // I18n
    // -- region
    i18nUIConf.content.region.label = i18nOptions.options.region?.label || '';
    i18nUIConf.content.region.options = i18nOptions.options.region?.optionValues || [];
    i18nUIConf.content.region.value = i18nOptions.selected.region;
    i18nUIConf.content.language.label = i18nOptions.options.language?.label || '';
    i18nUIConf.content.language.options = i18nOptions.options.language?.optionValues || [];
    i18nUIConf.content.language.value = i18nOptions.selected.language;
    // Account
    const cookie = YouTube2Context_1.default.getConfigValue('cookie');
    let authStatusDescription;
    if (!account?.isSignedIn || !account.active || account.list.length <= 1) {
        accountUIConf.content.activeChannelHandle.hidden = true;
    }
    if (account?.isSignedIn && account.active) {
        authStatusDescription = YouTube2Context_1.default.getI18n('YOUTUBE2_AUTH_STATUS_SIGNED_IN_AS', account.active.name);
        if (account.list.length > 1) {
            accountUIConf.content.activeChannelHandle.value = {
                label: account.active.name,
                value: account.active.handle
            };
            accountUIConf.content.activeChannelHandle.options = account.list.map((ac) => ({
                label: ac.name,
                value: ac.handle
            }));
            accountUIConf.saveButton.data.push('activeChannelHandle');
        }
    }
    else if (cookie) {
        authStatusDescription = YouTube2Context_1.default.getI18n('YOUTUBE2_AUTH_STATUS_SIGNED_OUT');
    }
    accountUIConf.description = authStatusDescription;
    accountUIConf.content.cookie.value = cookie;
    // Browse
    const rootContentType = YouTube2Context_1.default.getConfigValue('rootContentType');
    const rootContentTypeOptions = configModel.getRootContentTypeOptions();
    const loadFullPlaylists = YouTube2Context_1.default.getConfigValue('loadFullPlaylists');
    browseUIConf.content.rootContentType.options = rootContentTypeOptions;
    browseUIConf.content.rootContentType.value = rootContentTypeOptions.find((o) => o.value === rootContentType) || rootContentTypeOptions[0];
    browseUIConf.content.loadFullPlaylists.value = loadFullPlaylists;
    // Playback
    const autoplay = YouTube2Context_1.default.getConfigValue('autoplay');
    const autoplayClearQueue = YouTube2Context_1.default.getConfigValue('autoplayClearQueue');
    const autoplayPrefMixRelated = YouTube2Context_1.default.getConfigValue('autoplayPrefMixRelated');
    const addToHistory = YouTube2Context_1.default.getConfigValue('addToHistory');
    const liveStreamQuality = YouTube2Context_1.default.getConfigValue('liveStreamQuality');
    const liveStreamQualityOptions = configModel.getLiveStreamQualityOptions();
    const prefetchEnabled = YouTube2Context_1.default.getConfigValue('prefetch');
    playbackUIConf.content.autoplay.value = autoplay;
    playbackUIConf.content.autoplayClearQueue.value = autoplayClearQueue;
    playbackUIConf.content.autoplayPrefMixRelated.value = autoplayPrefMixRelated;
    playbackUIConf.content.addToHistory.value = addToHistory;
    playbackUIConf.content.liveStreamQuality.options = liveStreamQualityOptions;
    playbackUIConf.content.liveStreamQuality.value = liveStreamQualityOptions.find((o) => o.value === liveStreamQuality) || liveStreamQualityOptions[0];
    playbackUIConf.content.prefetch.value = prefetchEnabled;
    playbackUIConf.content.prefetch.hidden = !account?.isSignedIn;
    // YouTube Playback Mode
    const ytPlaybackMode = YouTube2Context_1.default.getConfigValue('ytPlaybackMode');
    ytPlaybackModeConf.content.feedVideos.value = ytPlaybackMode.feedVideos;
    ytPlaybackModeConf.content.playlistVideos.value = ytPlaybackMode.playlistVideos;
    // yt-dlp
    ytDlpUIConf.content.useYtDlp.value = YouTube2Context_1.default.getConfigValue('useYtDlp');
    const ytDlpVersion = YouTube2Context_1.default.getConfigValue('ytDlpVersion');
    const ytDlp = YtDlp_1.YtDlpWrapper.getInstance();
    const installedYDlpVersions = ytDlp.getInstalled();
    const ytDlpVersionOptions = installedYDlpVersions.length > 0 ? installedYDlpVersions.map(({ version }, i) => ({
        label: i === 0 ? YouTube2Context_1.default.getI18n('YOUTUBE2_VERSION_LATEST', version) : version,
        value: version
    })) : [{
            label: YouTube2Context_1.default.getI18n('YOUTUBE2_NONE_INSTALLED'),
            value: ''
        }];
    const selectedYtDlpVersionOption = (ytDlpVersion && ytDlpVersionOptions.length > 1 ? ytDlpVersionOptions.find(({ value }) => value === ytDlpVersion) : null) || ytDlpVersionOptions[0];
    ytDlpUIConf.content.ytDlpVersion.options = ytDlpVersionOptions;
    ytDlpUIConf.content.ytDlpVersion.value = selectedYtDlpVersionOption;
    let latestAvailable;
    try {
        latestAvailable = await ytDlp.getLatestVersion();
    }
    catch (error) {
        YouTube2Context_1.default.getLogger().error(YouTube2Context_1.default.getErrorMessage('[youtube2] Failed to get latest yt-dlp version:', error));
        YouTube2Context_1.default.toast('error', YouTube2Context_1.default.getI18n('YOUTUBE2_ERR_GET_LATEST_YT_DLP_VER'));
        latestAvailable = null;
    }
    const latestInstalled = installedYDlpVersions[0]?.version || null;
    if (latestInstalled && latestAvailable && (new Date(latestAvailable).getTime() - new Date(latestInstalled).getTime() > 0)) {
        ytDlpUIConf.description = YouTube2Context_1.default.getI18n('YOUTUBE2_YT_DLP_NEWER_AVAIL', latestAvailable);
    }
    if (!latestAvailable || latestInstalled === latestAvailable) {
        ytDlpUIConf.content.installLatestYtDlp.hidden = true;
    }
    return uiconf;
}, _ControllerYouTube2_getConfigI18nOptions = async function _ControllerYouTube2_getConfigI18nOptions() {
    const model = model_1.default.getInstance(model_1.ModelType.Config);
    const selected = {
        region: { label: '', value: '' },
        language: { label: '', value: '' }
    };
    try {
        const options = await model.getI18nOptions();
        const selectedValues = {
            region: YouTube2Context_1.default.getConfigValue('region'),
            language: YouTube2Context_1.default.getConfigValue('language')
        };
        Object.keys(selected).forEach((key) => {
            selected[key] = options[key]?.optionValues.find((ov) => ov.value === selectedValues[key]) || { label: '', value: selectedValues[key] };
        });
        return {
            options,
            selected
        };
    }
    catch (error) {
        YouTube2Context_1.default.getLogger().error(YouTube2Context_1.default.getErrorMessage('[youtube2] Error getting i18n options:', error));
        YouTube2Context_1.default.toast('warning', 'Could not obtain i18n options');
        return {
            options: model.getDefaultI18nOptions(),
            selected
        };
    }
}, _ControllerYouTube2_getConfigAccountInfo = function _ControllerYouTube2_getConfigAccountInfo() {
    const model = model_1.default.getInstance(model_1.ModelType.Account);
    try {
        return model.getInfo();
    }
    catch (error) {
        YouTube2Context_1.default.getLogger().warn(YouTube2Context_1.default.getErrorMessage('[youtube2] Failed to get account config:', error));
        return Promise.resolve(null);
    }
}, _ControllerYouTube2_configCheckAutoplay = function _ControllerYouTube2_configCheckAutoplay() {
    const addToHistory = YouTube2Context_1.default.getConfigValue('addToHistory');
    const autoplay = YouTube2Context_1.default.getConfigValue('autoplay');
    if (autoplay && !addToHistory) {
        const modalData = {
            title: YouTube2Context_1.default.getI18n('YOUTUBE2_AUTOPLAY'),
            message: YouTube2Context_1.default.getI18n('YOUTUBE2_MSG_AUTOPLAY_ADD_TO_HISTORY'),
            size: 'lg',
            buttons: [
                {
                    name: YouTube2Context_1.default.getI18n('YOUTUBE2_CONFIRM_ADD_TO_HISTORY'),
                    class: 'btn btn-info',
                    emit: 'callMethod',
                    payload: {
                        endpoint: 'music_service/youtube2',
                        method: 'configEnableAddToHistory'
                    }
                },
                {
                    name: YouTube2Context_1.default.getI18n('YOUTUBE2_NO'),
                    class: 'btn'
                }
            ]
        };
        __classPrivateFieldGet(this, _ControllerYouTube2_commandRouter, "f").broadcastMessage('openModal', modalData);
    }
}, _ControllerYouTube2_addToBrowseSources = function _ControllerYouTube2_addToBrowseSources() {
    const source = {
        name: 'YouTube2',
        uri: 'youtube2',
        plugin_type: 'music_service',
        plugin_name: 'youtube2',
        albumart: '/albumart?sourceicon=music_service/youtube2/dist/assets/images/youtube.svg'
    };
    __classPrivateFieldGet(this, _ControllerYouTube2_commandRouter, "f").volumioAddToBrowseSources(source);
};
module.exports = ControllerYouTube2;
