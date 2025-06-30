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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
var _ControllerLyrion_instances, _ControllerLyrion_context, _ControllerLyrion_commandRouter, _ControllerLyrion_serverStatus, _ControllerLyrion_doGetUIConfig;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const kew_1 = __importDefault(require("kew"));
const LyrionContext_1 = __importDefault(require("./lib/LyrionContext"));
const Util_1 = require("./lib/Util");
const System = __importStar(require("./lib/System"));
class ControllerLyrion {
    constructor(context) {
        _ControllerLyrion_instances.add(this);
        _ControllerLyrion_context.set(this, void 0);
        _ControllerLyrion_commandRouter.set(this, void 0);
        _ControllerLyrion_serverStatus.set(this, void 0);
        __classPrivateFieldSet(this, _ControllerLyrion_context, context, "f");
        __classPrivateFieldSet(this, _ControllerLyrion_commandRouter, __classPrivateFieldGet(this, _ControllerLyrion_context, "f").coreCommand, "f");
        __classPrivateFieldSet(this, _ControllerLyrion_serverStatus, 'stopped', "f");
    }
    getUIConfig() {
        return (0, Util_1.jsPromiseToKew)(__classPrivateFieldGet(this, _ControllerLyrion_instances, "m", _ControllerLyrion_doGetUIConfig).call(this))
            .fail((error) => {
            LyrionContext_1.default.getLogger().error(`[lyrion] getUIConfig(): Cannot populate configuration - ${error}`);
            throw error;
        });
    }
    onVolumioStart() {
        return kew_1.default.resolve(true);
    }
    onStart() {
        const defer = kew_1.default.defer();
        LyrionContext_1.default.init(__classPrivateFieldGet(this, _ControllerLyrion_context, "f"));
        LyrionContext_1.default.toast('info', LyrionContext_1.default.getI18n('LYRION_STARTING'));
        System.startService()
            .then(() => {
            LyrionContext_1.default.toast('success', LyrionContext_1.default.getI18n('LYRION_STARTED'));
            __classPrivateFieldSet(this, _ControllerLyrion_serverStatus, 'started', "f");
            defer.resolve();
        })
            .catch((e) => {
            LyrionContext_1.default.toast('error', LyrionContext_1.default.getI18n('LYRION_ERR_START', LyrionContext_1.default.getErrorMessage('', e, false)));
            defer.reject(e);
        });
        return defer.promise;
    }
    onStop() {
        if (__classPrivateFieldGet(this, _ControllerLyrion_serverStatus, "f") === 'stopped') {
            return kew_1.default.resolve(true);
        }
        const defer = kew_1.default.defer();
        LyrionContext_1.default.toast('info', LyrionContext_1.default.getI18n('LYRION_STOPPING'));
        System.stopService()
            .then(() => {
            LyrionContext_1.default.toast('success', LyrionContext_1.default.getI18n('LYRION_STOPPED'));
            __classPrivateFieldSet(this, _ControllerLyrion_serverStatus, 'stopped', "f");
            defer.resolve();
        })
            .catch((e) => {
            LyrionContext_1.default.toast('error', LyrionContext_1.default.getI18n('LYRION_ERR_STOP', LyrionContext_1.default.getErrorMessage('', e, false)));
            // Do not reject, in case user is uninstalling a possibly broken installation - rejecting will abort the process.
            defer.resolve();
        });
        return defer.promise;
    }
}
_ControllerLyrion_context = new WeakMap(), _ControllerLyrion_commandRouter = new WeakMap(), _ControllerLyrion_serverStatus = new WeakMap(), _ControllerLyrion_instances = new WeakSet(), _ControllerLyrion_doGetUIConfig = async function _ControllerLyrion_doGetUIConfig() {
    const langCode = __classPrivateFieldGet(this, _ControllerLyrion_commandRouter, "f").sharedVars.get('language_code');
    const uiconf = await (0, Util_1.kewToJSPromise)(__classPrivateFieldGet(this, _ControllerLyrion_commandRouter, "f").i18nJson(`${__dirname}/i18n/strings_${langCode}.json`, `${__dirname}/i18n/strings_en.json`, `${__dirname}/UIConfig.json`));
    const status = await System.getServiceStatus();
    const infoSectionConf = uiconf.sections[0];
    // Info section
    switch (status) {
        case 'active':
            infoSectionConf.description = LyrionContext_1.default.getI18n('LYRION_INFO_DESC_ACTIVE');
            break;
        case 'activating':
            infoSectionConf.description = LyrionContext_1.default.getI18n('LYRION_INFO_DESC_ACTIVATING');
            break;
        default:
            infoSectionConf.description = LyrionContext_1.default.getI18n('LYRION_INFO_DESC_INACTIVE');
    }
    if (status !== 'active') {
        const viewReadme = infoSectionConf.content[2];
        infoSectionConf.content = [viewReadme];
    }
    else {
        const thisDevice = LyrionContext_1.default.getDeviceInfo();
        const host = thisDevice.host;
        const port = System.getServerPort();
        const url = `${host}:${port}`;
        infoSectionConf.content[0].value = url;
        infoSectionConf.content[1].onClick.url = url;
    }
    return uiconf;
};
module.exports = ControllerLyrion;
//# sourceMappingURL=index.js.map