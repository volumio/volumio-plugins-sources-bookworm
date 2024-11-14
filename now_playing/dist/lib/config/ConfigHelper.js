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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const windows_locale_1 = __importDefault(require("windows-locale"));
const NowPlayingContext_1 = __importDefault(require("../NowPlayingContext"));
class ConfigHelper {
    static parseCoordinates(str) {
        if (!str) {
            return null;
        }
        const parts = str.split(',');
        if (parts[0] !== undefined && parts[1] !== undefined) {
            const lat = parseFloat(parts[0]);
            const lon = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
                return { lat, lon };
            }
        }
        return null;
    }
    static getVolumioLocale() {
        return NowPlayingContext_1.default.getLanguageCode().replace('_', '-');
    }
    static getLocaleList() {
        let localeList = NowPlayingContext_1.default.get('localeList');
        const matchVolumioLabel = NowPlayingContext_1.default.getI18n('NOW_PLAYING_LOCALE_VOLUMIO', this.getVolumioLocale());
        if (!localeList) {
            localeList = [
                {
                    value: 'matchVolumio',
                    label: matchVolumioLabel
                },
                {
                    value: 'matchClient',
                    label: NowPlayingContext_1.default.getI18n('NOW_PLAYING_LOCALE_CLIENT')
                },
                {
                    value: 'localeListDivider',
                    label: '----------------------------------------'
                }
            ];
            for (const lc of Object.values(windows_locale_1.default)) {
                localeList.push({
                    value: lc.tag,
                    label: `${lc.language + (lc.location ? ` (${lc.location})` : '')} - ${lc.tag}`
                });
            }
            NowPlayingContext_1.default.set('localeList', localeList);
        }
        else {
            localeList[0].label = matchVolumioLabel;
        }
        return localeList;
    }
    static async getTimezoneList() {
        let timezoneList = NowPlayingContext_1.default.get('timezoneList');
        if (!timezoneList) {
            timezoneList = [
                {
                    value: 'matchClient',
                    label: NowPlayingContext_1.default.getI18n('NOW_PLAYING_TIMEZONE_CLIENT')
                },
                {
                    value: 'matchGeoCoordinates',
                    label: NowPlayingContext_1.default.getI18n('NOW_PLAYING_TIMEZONE_GEO_COORD')
                },
                {
                    value: 'timezoneListDivider',
                    label: '----------------------------------------'
                }
            ];
            const ct = await Promise.resolve().then(() => __importStar(require('countries-and-timezones')));
            for (const tz of Object.values(ct.getAllTimezones())) {
                timezoneList.push({
                    value: tz.name,
                    label: `${tz.name} (GMT${tz.utcOffsetStr})`
                });
            }
            NowPlayingContext_1.default.set('timezoneList', timezoneList);
        }
        return timezoneList;
    }
}
exports.default = ConfigHelper;
//# sourceMappingURL=ConfigHelper.js.map