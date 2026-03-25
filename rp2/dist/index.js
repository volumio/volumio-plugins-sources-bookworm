"use strict";
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
var _ControllerRP2_instances, _ControllerRP2_context, _ControllerRP2_config, _ControllerRP2_commandRouter, _ControllerRP2_playController, _ControllerRP2_nowPlayingMetadataProvider, _ControllerRP2_doGetUIConfig, _ControllerRP2_addToBrowseSources, _ControllerRP2_handleUnsupportedOp;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const kew_1 = __importDefault(require("kew"));
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const v_conf_1 = __importDefault(require("v-conf"));
const RP2Context_1 = __importDefault(require("./lib/RP2Context"));
const PlayController_1 = require("./lib/playback/PlayController");
const util_1 = require("./lib/util");
const UIConfigHelper_1 = __importDefault(require("./lib/config/UIConfigHelper"));
const plugin_config_1 = require("./lib/config/plugin-config");
const browse_1 = require("./lib/browse");
const queue_1 = require("./lib/playback/queue");
const RP2NowPlayingMetadataProvider_1 = require("./lib/playback/RP2NowPlayingMetadataProvider");
const SERVICE_NAME = 'Radio Paradise (RP2)';
class ControllerRP2 {
    constructor(context) {
        _ControllerRP2_instances.add(this);
        _ControllerRP2_context.set(this, void 0);
        _ControllerRP2_config.set(this, void 0);
        _ControllerRP2_commandRouter.set(this, void 0);
        _ControllerRP2_playController.set(this, null);
        _ControllerRP2_nowPlayingMetadataProvider.set(this, null);
        __classPrivateFieldSet(this, _ControllerRP2_context, context, "f");
        __classPrivateFieldSet(this, _ControllerRP2_commandRouter, context.coreCommand, "f");
    }
    getUIConfig() {
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_instances, "m", _ControllerRP2_doGetUIConfig).call(this)).fail((error) => {
            RP2Context_1.default
                .getLogger()
                .error(`[rp2] getUIConfig(): Cannot populate configuration - ${error}`);
            throw error;
        });
    }
    async configSaveGeneralSettings(data) {
        RP2Context_1.default.setConfigValue('persistSession', !!data['persistSession']);
        RP2Context_1.default.setConfigValue('showChannel', !!data['showChannel']);
        const audioQuality = data['audioQuality']?.value;
        if (audioQuality) {
            RP2Context_1.default.setConfigValue('audioQuality', audioQuality);
            await RP2Context_1.default.getRpjsLib().setQuality(audioQuality);
        }
        RP2Context_1.default.toast('success', RP2Context_1.default.getI18n('RP2_SETTINGS_SAVED'));
    }
    onVolumioStart() {
        const configFile = __classPrivateFieldGet(this, _ControllerRP2_commandRouter, "f").pluginManager.getConfigurationFile(__classPrivateFieldGet(this, _ControllerRP2_context, "f"), 'config.json');
        __classPrivateFieldSet(this, _ControllerRP2_config, new v_conf_1.default(), "f");
        __classPrivateFieldGet(this, _ControllerRP2_config, "f").loadFile(configFile);
        return kew_1.default.resolve();
    }
    onStart() {
        RP2Context_1.default.init(__classPrivateFieldGet(this, _ControllerRP2_context, "f"), __classPrivateFieldGet(this, _ControllerRP2_config, "f"));
        __classPrivateFieldSet(this, _ControllerRP2_playController, new PlayController_1.PlayController(), "f");
        __classPrivateFieldSet(this, _ControllerRP2_nowPlayingMetadataProvider, new RP2NowPlayingMetadataProvider_1.RP2NowPlayingMetadataProvider(), "f");
        __classPrivateFieldGet(this, _ControllerRP2_instances, "m", _ControllerRP2_addToBrowseSources).call(this);
        return kew_1.default.resolve();
    }
    onStop() {
        __classPrivateFieldGet(this, _ControllerRP2_commandRouter, "f").volumioRemoveToBrowseSources(SERVICE_NAME);
        __classPrivateFieldSet(this, _ControllerRP2_playController, null, "f");
        __classPrivateFieldSet(this, _ControllerRP2_nowPlayingMetadataProvider, null, "f");
        return (0, util_1.jsPromiseToKew)((async () => {
            //await this.#playController?.reset();
            await RP2Context_1.default.reset();
        })());
    }
    getConfigurationFiles() {
        return ['config.json'];
    }
    handleBrowseUri(uri) {
        return (0, util_1.jsPromiseToKew)((0, browse_1.getPage)(uri));
    }
    explodeUri(uri) {
        return (0, util_1.jsPromiseToKew)((0, queue_1.getQueueItems)(uri));
    }
    clearAddPlayTrack(track) {
        if (!__classPrivateFieldGet(this, _ControllerRP2_playController, "f")) {
            return kew_1.default.reject('RP2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_playController, "f").clearAddPlayTrack(track));
    }
    stop() {
        if (!__classPrivateFieldGet(this, _ControllerRP2_playController, "f")) {
            return kew_1.default.reject('RP2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_playController, "f").stop());
    }
    pause() {
        if (!__classPrivateFieldGet(this, _ControllerRP2_playController, "f")) {
            return kew_1.default.reject('RP2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_playController, "f").pause());
    }
    resume() {
        if (!__classPrivateFieldGet(this, _ControllerRP2_playController, "f")) {
            return kew_1.default.reject('RP2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_playController, "f").resume());
    }
    play() {
        if (!__classPrivateFieldGet(this, _ControllerRP2_playController, "f")) {
            return kew_1.default.reject('RP2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_playController, "f").play());
    }
    seek(position) {
        if (!__classPrivateFieldGet(this, _ControllerRP2_playController, "f")) {
            return kew_1.default.reject('RP2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_playController, "f").seek(position));
    }
    next() {
        if (!__classPrivateFieldGet(this, _ControllerRP2_playController, "f")) {
            return kew_1.default.reject('RP2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_playController, "f").next());
    }
    previous() {
        if (!__classPrivateFieldGet(this, _ControllerRP2_playController, "f")) {
            return kew_1.default.reject('RP2 plugin is not started');
        }
        return (0, util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerRP2_playController, "f").previous());
    }
    random() {
        return __classPrivateFieldGet(this, _ControllerRP2_instances, "m", _ControllerRP2_handleUnsupportedOp).call(this);
    }
    repeat() {
        return __classPrivateFieldGet(this, _ControllerRP2_instances, "m", _ControllerRP2_handleUnsupportedOp).call(this);
    }
    addToFavourites() {
        return __classPrivateFieldGet(this, _ControllerRP2_instances, "m", _ControllerRP2_handleUnsupportedOp).call(this);
    }
    getNowPlayingMetadataProvider() {
        return __classPrivateFieldGet(this, _ControllerRP2_nowPlayingMetadataProvider, "f");
    }
}
_ControllerRP2_context = new WeakMap(), _ControllerRP2_config = new WeakMap(), _ControllerRP2_commandRouter = new WeakMap(), _ControllerRP2_playController = new WeakMap(), _ControllerRP2_nowPlayingMetadataProvider = new WeakMap(), _ControllerRP2_instances = new WeakSet(), _ControllerRP2_doGetUIConfig = async function _ControllerRP2_doGetUIConfig() {
    const langCode = __classPrivateFieldGet(this, _ControllerRP2_commandRouter, "f").sharedVars.get('language_code');
    const _uiconf = await (0, util_1.kewToJSPromise)(__classPrivateFieldGet(this, _ControllerRP2_commandRouter, "f").i18nJson(`${__dirname}/i18n/strings_${langCode}.json`, `${__dirname}/i18n/strings_en.json`, `${__dirname}/UIConfig.json`));
    const uiconf = UIConfigHelper_1.default.observe(_uiconf);
    const generalUIConf = uiconf.section_general;
    const audioQuality = RP2Context_1.default.getConfigValue('audioQuality');
    const audioQualityOptions = (0, plugin_config_1.getAudioQualityOptions)();
    generalUIConf.content.audioQuality.options = audioQualityOptions;
    generalUIConf.content.audioQuality.value = audioQualityOptions.find(({ value }) => audioQuality === value) || {
        label: '',
        value: ''
    };
    generalUIConf.content.persistSession.value =
        RP2Context_1.default.getConfigValue('persistSession');
    generalUIConf.content.showChannel.value = RP2Context_1.default.getConfigValue('showChannel');
    return uiconf;
}, _ControllerRP2_addToBrowseSources = function _ControllerRP2_addToBrowseSources() {
    const source = {
        name: SERVICE_NAME,
        uri: 'rp2',
        plugin_type: 'music_service',
        plugin_name: 'rp2',
        albumart: '/albumart?sourceicon=music_service/rp2/dist/assets/images/rp.png'
    };
    __classPrivateFieldGet(this, _ControllerRP2_commandRouter, "f").volumioAddToBrowseSources(source);
}, _ControllerRP2_handleUnsupportedOp = function _ControllerRP2_handleUnsupportedOp() {
    RP2Context_1.default.toast('error', RP2Context_1.default.getI18n('RP2_ERR_OP_NOT_SUPPORTED'));
    return (0, util_1.jsPromiseToKew)(Promise.reject(Error(RP2Context_1.default.getI18n('RP2_ERR_OP_NOT_SUPPORTED'))));
};
module.exports = ControllerRP2;
