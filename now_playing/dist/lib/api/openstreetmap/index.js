"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _OpenStreetMapAPI_getReverseApiUrl;
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = __importDefault(require("lodash"));
const OSM_REVERSE_API_URL = 'https://nominatim.openstreetmap.org/reverse';
class OpenStreetMapAPI {
    /**
     * Note 'country` is always undefined. Back in the days of using OpenWeatherMap API to fetch weather + location data,
     * the `country` value is the country code returned by said API.
     * Since OpenStreetMap API returns the full country name, we don't need the `country` property anymore. But we leave it
     * there for compatibility with the Weather API.
     * @param lat
     * @param lon
     * @param lang
     * @returns
     */
    static async reverse(lat, lon, lang = 'en') {
        const res = await fetch(__classPrivateFieldGet(this, _a, "m", _OpenStreetMapAPI_getReverseApiUrl).call(this, lat, lon, lang), {
            "headers": {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0",
            },
            "method": "GET",
        });
        const data = await res.json();
        const displayName = lodash_1.default.get(data, 'display_name');
        if (displayName && typeof displayName === 'string') {
            let parts = displayName.split(', ');
            // Remove postcode, if any.
            const postcode = lodash_1.default.get(data, 'address.postcode');
            if (postcode) {
                parts = parts.filter((value) => value !== postcode);
            }
            // Limit parts count to 3
            if (parts.length > 3) {
                parts.splice(1, parts.length - 3);
            }
            return {
                name: parts.join(', '),
                country: undefined
            };
        }
        return {
            name: undefined,
            country: undefined
        };
    }
}
_a = OpenStreetMapAPI, _OpenStreetMapAPI_getReverseApiUrl = function _OpenStreetMapAPI_getReverseApiUrl(lat, lon, lang) {
    const urlObj = new URL(OSM_REVERSE_API_URL);
    const acceptLang = [lang];
    const langParts = lang.split('-');
    if (langParts.length === 2) { // e.g. en-GB
        acceptLang.push(langParts[0]); // Push 'en'
    }
    if (acceptLang.at(-1) !== 'en') {
        // Fallback
        acceptLang.push('en');
    }
    urlObj.searchParams.set('lat', String(lat));
    urlObj.searchParams.set('lon', String(lon));
    urlObj.searchParams.set('accept-language', acceptLang.join(','));
    urlObj.searchParams.set('zoom', '12');
    urlObj.searchParams.set('format', 'json');
    return urlObj;
};
exports.default = OpenStreetMapAPI;
