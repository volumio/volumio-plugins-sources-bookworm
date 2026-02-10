"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _ExternalPlayers_players, _ExternalPlayers_getPlayerName;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExternalPlayers = void 0;
const SoundCloudContext_1 = __importDefault(require("../../SoundCloudContext"));
const volumio_ext_players_1 = require("volumio-ext-players");
async function startMpv() {
    SoundCloudContext_1.default.toast('info', SoundCloudContext_1.default.getI18n('SOUNDCLOUD_STARTING_PLAYER', 'mpv'));
    try {
        const mpv = new volumio_ext_players_1.MPVService({
            serviceName: 'soundcloud',
            logger: SoundCloudContext_1.default.getLogger(),
            volumio: {
                commandRouter: SoundCloudContext_1.default.volumioCoreCommand,
                mpdPlugin: SoundCloudContext_1.default.getMpdPlugin(),
                statemachine: SoundCloudContext_1.default.getStateMachine()
            },
            mpvArgs: [
                '--force-seekable=yes',
                '--demuxer=lavf',
                '--demuxer-lavf-o=extension_picky=0,allowed_extensions=ALL,allowed_segment_extensions=ALL'
            ]
        });
        await mpv.start();
        return mpv;
    }
    catch (error) {
        throw Error(SoundCloudContext_1.default.getErrorMessage(SoundCloudContext_1.default.getI18n('SOUNDCLOUD_ERR_PLAYER_START', 'mpv'), error));
    }
}
async function startVLC() {
    SoundCloudContext_1.default.toast('info', SoundCloudContext_1.default.getI18n('SOUNDCLOUD_STARTING_PLAYER', 'VLC'));
    try {
        const vlc = new volumio_ext_players_1.VLCService({
            serviceName: 'soundcloud',
            logger: SoundCloudContext_1.default.getLogger(),
            volumio: {
                commandRouter: SoundCloudContext_1.default.volumioCoreCommand,
                mpdPlugin: SoundCloudContext_1.default.getMpdPlugin(),
                statemachine: SoundCloudContext_1.default.getStateMachine()
            }
        });
        await vlc.start();
        return vlc;
    }
    catch (error) {
        throw Error(SoundCloudContext_1.default.getErrorMessage(SoundCloudContext_1.default.getI18n('SOUNDCLOUD_ERR_PLAYER_START', 'VLC'), error));
    }
}
class ExternalPlayers {
    static async get(player) {
        if (__classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)[player]) {
            return __classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)[player];
        }
        let startPromise;
        switch (player) {
            case 'mpv':
                startPromise = startMpv();
                break;
            case 'vlc':
                startPromise = startVLC();
                break;
        }
        SoundCloudContext_1.default.getLogger().info(`[soundcloud] Going to start ${player} for playback`);
        const playerName = __classPrivateFieldGet(this, _a, "m", _ExternalPlayers_getPlayerName).call(this, player);
        try {
            const p = await startPromise;
            p.once('close', (code) => {
                if (code && code !== 0) {
                    SoundCloudContext_1.default.toast('warning', SoundCloudContext_1.default.getI18n('SOUNDCLOUD_PLAYER_CLOSED_UNEXPECTEDLY', playerName));
                }
                SoundCloudContext_1.default.getLogger().info(`[soundcloud] ${player} process closed`);
                __classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)[player] = null;
            });
            __classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)[player] = p;
            return p;
        }
        catch (error) {
            SoundCloudContext_1.default.toast('error', SoundCloudContext_1.default.getErrorMessage(SoundCloudContext_1.default.getI18n('SOUNDCLOUD_ERR_PLAYER_START', playerName), error));
            return null;
        }
    }
    static stop(player) {
        const p = __classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)[player];
        if (p && p.isActive()) {
            return p.stop();
        }
    }
    static getActive() {
        return Object.values(__classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)).find((p) => p && p.isActive()) ?? null;
    }
    static async quit(player) {
        const p = __classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)[player];
        if (p) {
            try {
                await p.quit();
            }
            catch (error) {
                SoundCloudContext_1.default.toast('error', SoundCloudContext_1.default.getI18n('SOUNDCLOUD_ERR_PLAYER_QUIT', __classPrivateFieldGet(this, _a, "m", _ExternalPlayers_getPlayerName).call(this, player), SoundCloudContext_1.default.getErrorMessage('', error, false)));
            }
            finally {
                __classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)[player] = null;
            }
        }
    }
    static quitAll() {
        return Promise.all(Object.keys(__classPrivateFieldGet(this, _a, "f", _ExternalPlayers_players)).map((player) => this.quit(player)));
    }
}
exports.ExternalPlayers = ExternalPlayers;
_a = ExternalPlayers, _ExternalPlayers_getPlayerName = function _ExternalPlayers_getPlayerName(player) {
    switch (player) {
        case 'mpv':
            return 'mpv';
        case 'vlc':
            return 'VLC';
    }
};
_ExternalPlayers_players = { value: {
        vlc: null,
        mpv: null
    } };
//# sourceMappingURL=ExternalPlayers.js.map