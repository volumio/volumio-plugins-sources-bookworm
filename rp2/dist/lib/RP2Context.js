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
var _RP2Context_instances, _RP2Context_singletons, _RP2Context_data, _RP2Context_pluginContext, _RP2Context_pluginConfig, _RP2Context_i18n, _RP2Context_i18nDefaults, _RP2Context_i18CallbackRegistered, _RP2Context_getPlayer, _RP2Context_getSingleton, _RP2Context_loadI18n, _RP2Context_onSystemLanguageChanged;
Object.defineProperty(exports, "__esModule", { value: true });
const string_format_1 = __importDefault(require("string-format"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const plugin_config_1 = require("./config/plugin-config");
const rp_js_1 = require("@patrickkfkan/rp.js");
const MPVPlayer_1 = require("./playback/MPVPlayer");
const StateTransformer_1 = require("./playback/StateTransformer");
const STORE_KEYS = {
    'rp.js': 'rp.js',
    player: 'player',
    stateTransformer: 'stateTransformer'
};
class RP2Context {
    constructor() {
        _RP2Context_instances.add(this);
        _RP2Context_singletons.set(this, void 0);
        _RP2Context_data.set(this, void 0);
        _RP2Context_pluginContext.set(this, void 0);
        _RP2Context_pluginConfig.set(this, void 0);
        _RP2Context_i18n.set(this, void 0);
        _RP2Context_i18nDefaults.set(this, void 0);
        _RP2Context_i18CallbackRegistered.set(this, void 0);
        __classPrivateFieldSet(this, _RP2Context_singletons, {}, "f");
        __classPrivateFieldSet(this, _RP2Context_data, {}, "f");
        __classPrivateFieldSet(this, _RP2Context_i18n, {}, "f");
        __classPrivateFieldSet(this, _RP2Context_i18nDefaults, {}, "f");
        __classPrivateFieldSet(this, _RP2Context_i18CallbackRegistered, false, "f");
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    set(key, value) {
        __classPrivateFieldGet(this, _RP2Context_data, "f")[key] = value;
    }
    get(key, defaultValue) {
        return __classPrivateFieldGet(this, _RP2Context_data, "f")[key] !== undefined ?
            __classPrivateFieldGet(this, _RP2Context_data, "f")[key]
            : defaultValue || null;
    }
    delete(key) {
        delete __classPrivateFieldGet(this, _RP2Context_data, "f")[key];
    }
    init(pluginContext, pluginConfig) {
        __classPrivateFieldSet(this, _RP2Context_pluginContext, pluginContext, "f");
        __classPrivateFieldSet(this, _RP2Context_pluginConfig, pluginConfig, "f");
        __classPrivateFieldGet(this, _RP2Context_instances, "m", _RP2Context_loadI18n).call(this);
        if (!__classPrivateFieldGet(this, _RP2Context_i18CallbackRegistered, "f")) {
            __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").coreCommand.sharedVars.registerCallback('language_code', __classPrivateFieldGet(this, _RP2Context_instances, "m", _RP2Context_onSystemLanguageChanged).bind(this));
            __classPrivateFieldSet(this, _RP2Context_i18CallbackRegistered, true, "f");
        }
    }
    toast(type, message, title = 'RP2') {
        __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").coreCommand.pushToastMessage(type, title, message);
    }
    refreshUIConfig() {
        __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").coreCommand
            .getUIConfigOnPlugin('music_service', 'RP2', {})
            .then((config) => {
            __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").coreCommand.broadcastMessage('pushUiConfig', config);
        });
    }
    getLogger() {
        return __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").logger;
    }
    getErrorMessage(message, error, stack = true) {
        let result = message;
        if (error && typeof error == 'object') {
            if (error.message) {
                result += ` ${error.message}`;
            }
            if (error.cause) {
                result += ` ${this.getErrorMessage(' - ', error.cause, false)}`;
            }
            if (stack && error.stack) {
                result += ` ${error.stack}`;
            }
        }
        else if (typeof error == 'string') {
            result += ` ${error}`;
        }
        else if (error) {
            result += ` ${String(error)}`;
        }
        return result.trim();
    }
    hasConfigKey(key) {
        return __classPrivateFieldGet(this, _RP2Context_pluginConfig, "f").has(key);
    }
    getConfigValue(key) {
        const schema = plugin_config_1.PLUGIN_CONFIG_SCHEMA[key];
        if (__classPrivateFieldGet(this, _RP2Context_pluginConfig, "f").has(key)) {
            const val = __classPrivateFieldGet(this, _RP2Context_pluginConfig, "f").get(key);
            if (schema.json) {
                try {
                    return JSON.parse(val);
                }
                catch (e) {
                    return schema.defaultValue;
                }
            }
            else {
                return val;
            }
        }
        else {
            return schema.defaultValue;
        }
    }
    deleteConfigValue(key) {
        __classPrivateFieldGet(this, _RP2Context_pluginConfig, "f").delete(key);
    }
    setConfigValue(key, value) {
        const schema = plugin_config_1.PLUGIN_CONFIG_SCHEMA[key];
        __classPrivateFieldGet(this, _RP2Context_pluginConfig, "f").set(key, schema.json ? JSON.stringify(value) : value);
    }
    getRpjsLib() {
        let rpjs = this.get(STORE_KEYS['rp.js']);
        const logger = this.getLogger();
        if (!rpjs) {
            const sessionData = this.getConfigValue('persistSession') ?
                this.getConfigValue('sessionData') || undefined
                : undefined;
            const player = __classPrivateFieldGet(this, _RP2Context_instances, "m", _RP2Context_getPlayer).call(this);
            rpjs = new rp_js_1.RadioParadise({
                player,
                quality: this.getConfigValue('audioQuality'),
                logger: {
                    info: (msg) => logger.info(`[rp2] ${msg}`),
                    warn: (msg) => logger.warn(`[rp2] ${msg}`),
                    debug: (msg) => logger.verbose(`[rp2] ${msg}`),
                    error: (msg) => logger.error(`[rp2] ${msg}`)
                },
                sessionData
            });
            rpjs.on('status', (status) => {
                this.getStateTransformer().setRpjsStatus(status);
                player.pushState();
            });
            this.set(STORE_KEYS['rp.js'], rpjs);
        }
        return rpjs;
    }
    getStateTransformer() {
        let transformer = this.get(STORE_KEYS['stateTransformer']);
        if (!transformer) {
            transformer = new StateTransformer_1.StateTransformer();
            this.set(STORE_KEYS['stateTransformer'], transformer);
        }
        return transformer;
    }
    getAlbumArtPlugin() {
        return __classPrivateFieldGet(this, _RP2Context_instances, "m", _RP2Context_getSingleton).call(this, 'albumArtPlugin', () => __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").coreCommand.pluginManager.getPlugin('miscellanea', 'albumart'));
    }
    getMpdPlugin() {
        return __classPrivateFieldGet(this, _RP2Context_instances, "m", _RP2Context_getSingleton).call(this, 'mpdPlugin', () => __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").coreCommand.pluginManager.getPlugin('music_service', 'mpd'));
    }
    getStateMachine() {
        return __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").coreCommand.stateMachine;
    }
    async reset() {
        const rpjs = this.get(STORE_KEYS['rp.js']);
        if (rpjs) {
            await rpjs.dispose();
            rpjs.removeAllListeners();
            this.delete(STORE_KEYS['rp.js']);
        }
        const player = this.get(STORE_KEYS['player']);
        if (player) {
            await player.quit();
            this.delete(STORE_KEYS['player']);
        }
        __classPrivateFieldSet(this, _RP2Context_pluginContext, null, "f");
        __classPrivateFieldSet(this, _RP2Context_pluginConfig, null, "f");
        __classPrivateFieldSet(this, _RP2Context_singletons, {}, "f");
        __classPrivateFieldSet(this, _RP2Context_data, {}, "f");
    }
    getI18n(key, ...formatValues) {
        let str;
        if (key.indexOf('.') > 0) {
            const mainKey = key.split('.')[0];
            const secKey = key.split('.')[1];
            str =
                __classPrivateFieldGet(this, _RP2Context_i18n, "f")[mainKey]?.[secKey] ||
                    __classPrivateFieldGet(this, _RP2Context_i18nDefaults, "f")[mainKey]?.[secKey] ||
                    key;
        }
        else {
            str = (__classPrivateFieldGet(this, _RP2Context_i18n, "f")[key] || __classPrivateFieldGet(this, _RP2Context_i18nDefaults, "f")[key] || key);
        }
        if (str && formatValues.length) {
            str = (0, string_format_1.default)(str, ...formatValues);
        }
        return str;
    }
    get volumioCoreCommand() {
        return __classPrivateFieldGet(this, _RP2Context_pluginContext, "f")?.coreCommand || null;
    }
}
_RP2Context_singletons = new WeakMap(), _RP2Context_data = new WeakMap(), _RP2Context_pluginContext = new WeakMap(), _RP2Context_pluginConfig = new WeakMap(), _RP2Context_i18n = new WeakMap(), _RP2Context_i18nDefaults = new WeakMap(), _RP2Context_i18CallbackRegistered = new WeakMap(), _RP2Context_instances = new WeakSet(), _RP2Context_getPlayer = function _RP2Context_getPlayer() {
    let player = this.get(STORE_KEYS['player']);
    if (!player) {
        player = new MPVPlayer_1.MPVPlayer();
        this.set(STORE_KEYS['player'], player);
    }
    return player;
}, _RP2Context_getSingleton = function _RP2Context_getSingleton(key, getValue) {
    if (__classPrivateFieldGet(this, _RP2Context_singletons, "f")[key] == undefined) {
        __classPrivateFieldGet(this, _RP2Context_singletons, "f")[key] = getValue();
    }
    return __classPrivateFieldGet(this, _RP2Context_singletons, "f")[key];
}, _RP2Context_loadI18n = function _RP2Context_loadI18n() {
    if (__classPrivateFieldGet(this, _RP2Context_pluginContext, "f")) {
        const i18nPath = `${__dirname}/../i18n`;
        try {
            __classPrivateFieldSet(this, _RP2Context_i18nDefaults, fs_extra_1.default.readJsonSync(`${i18nPath}/strings_en.json`), "f");
        }
        catch (e) {
            __classPrivateFieldSet(this, _RP2Context_i18nDefaults, {}, "f");
        }
        try {
            const language_code = __classPrivateFieldGet(this, _RP2Context_pluginContext, "f").coreCommand.sharedVars.get('language_code');
            __classPrivateFieldSet(this, _RP2Context_i18n, fs_extra_1.default.readJsonSync(`${i18nPath}/strings_${language_code}.json`), "f");
        }
        catch (e) {
            __classPrivateFieldSet(this, _RP2Context_i18n, __classPrivateFieldGet(this, _RP2Context_i18nDefaults, "f"), "f");
        }
    }
}, _RP2Context_onSystemLanguageChanged = function _RP2Context_onSystemLanguageChanged() {
    __classPrivateFieldGet(this, _RP2Context_instances, "m", _RP2Context_loadI18n).call(this);
};
exports.default = new RP2Context();
