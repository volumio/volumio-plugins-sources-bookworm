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
var _OpenWeatherMapAPI_instances, _OpenWeatherMapAPI_configuredApiKey, _OpenWeatherMapAPI_fetchedApiKey, _OpenWeatherMapAPI_coordinates, _OpenWeatherMapAPI_lang, _OpenWeatherMapAPI_units, _OpenWeatherMapAPI_getApiKey, _OpenWeatherMapAPI_scrapeApiKey, _OpenWeatherMapAPI_createFullApiUrl, _OpenWeatherMapAPI_parseLocation, _OpenWeatherMapAPI_parseCurrent, _OpenWeatherMapAPI_parseDaily, _OpenWeatherMapAPI_parseHourly;
Object.defineProperty(exports, "__esModule", { value: true });
const NowPlayingContext_1 = __importDefault(require("../../NowPlayingContext"));
const BASE_URL = 'https://openweathermap.org';
const API_URL = 'https://api.openweathermap.org';
const ONECALL_URL = {
    'web': `${BASE_URL}/api/widget/onecall`, // Used by OWM website
    '3.0': `${API_URL}/data/3.0/onecall` // Public API - user provides key
};
const WEATHER_URL = `${API_URL}/data/2.5/weather`;
async function fetchPage(url, json = false) {
    try {
        const response = await fetch(url);
        if (response.ok) {
            return await (json ? response.json() : response.text());
        }
        throw Error(`Response error: ${response.status} - ${response.statusText}`);
    }
    catch (error) {
        NowPlayingContext_1.default.getLogger().error(NowPlayingContext_1.default.getErrorMessage(`[now-playing] Error fetching OpenWeatherMap resource "${url}":`, error, false));
        throw error;
    }
}
class OpenWeatherMapAPI {
    constructor(args) {
        _OpenWeatherMapAPI_instances.add(this);
        // Contains API key provided by user in plugin settings; targets API v3.0.
        _OpenWeatherMapAPI_configuredApiKey.set(this, void 0);
        // Contains API key scraped from OWM website; targets 'web' version.
        _OpenWeatherMapAPI_fetchedApiKey.set(this, void 0);
        _OpenWeatherMapAPI_coordinates.set(this, void 0);
        _OpenWeatherMapAPI_lang.set(this, void 0);
        _OpenWeatherMapAPI_units.set(this, void 0);
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_configuredApiKey, null, "f");
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_fetchedApiKey, null, "f");
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_coordinates, null, "f");
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_lang, null, "f");
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_units, null, "f");
        if (args?.lat !== undefined && args?.lon !== undefined && !isNaN(args.lat) && !isNaN(args.lon)) {
            this.setCoordinates(args.lat, args.lon);
        }
        if (args?.lang) {
            this.setLang(args.lang);
        }
        if (args?.units) {
            this.setUnits(args.units);
        }
    }
    setCoordinates(lat, lon) {
        if (typeof lat === 'number' && typeof lon === 'number' && -90 <= lat && lat <= 90 && -180 <= lon && lon <= 180) {
            __classPrivateFieldSet(this, _OpenWeatherMapAPI_coordinates, { lat, lon }, "f");
            return;
        }
        throw Error('Invalid coordinates');
    }
    setLang(lang) {
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_lang, lang, "f");
    }
    setUnits(units) {
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_units, units, "f");
    }
    setApiKey(apiKey, targetVersion = '3.0') {
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_configuredApiKey, apiKey && apiKey.trim() ? {
            value: apiKey,
            targetVersion
        } : null, "f");
    }
    async getWeather() {
        const fetchData = async (forceRefreshApiKey = false) => {
            if (forceRefreshApiKey) {
                __classPrivateFieldSet(this, _OpenWeatherMapAPI_fetchedApiKey, null, "f");
            }
            const { targetVersion } = await __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_getApiKey).call(this);
            const [oneCallUrl, weatherUrl] = await Promise.all([
                __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_createFullApiUrl).call(this, ONECALL_URL[targetVersion]),
                __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_createFullApiUrl).call(this, WEATHER_URL)
            ]);
            // Note that location data is actually resolved from
            // WeatherUrl, whereas the rest is from onecall.
            try {
                return await Promise.all([
                    fetchPage(oneCallUrl, true),
                    fetchPage(weatherUrl, true)
                ]);
            }
            catch (error) {
                if (!forceRefreshApiKey && !__classPrivateFieldGet(this, _OpenWeatherMapAPI_configuredApiKey, "f")) {
                    // Retry with forceRefreshApiKey
                    // Note we only do this if user hasn't configured their own API key
                    return fetchData(true);
                }
                throw error;
            }
        };
        const [weatherData, locationData] = await fetchData();
        const result = {
            location: __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_parseLocation).call(this, locationData),
            current: __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_parseCurrent).call(this, weatherData),
            daily: __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_parseDaily).call(this, weatherData),
            hourly: __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_parseHourly).call(this, weatherData)
        };
        return result;
    }
}
_OpenWeatherMapAPI_configuredApiKey = new WeakMap(), _OpenWeatherMapAPI_fetchedApiKey = new WeakMap(), _OpenWeatherMapAPI_coordinates = new WeakMap(), _OpenWeatherMapAPI_lang = new WeakMap(), _OpenWeatherMapAPI_units = new WeakMap(), _OpenWeatherMapAPI_instances = new WeakSet(), _OpenWeatherMapAPI_getApiKey = async function _OpenWeatherMapAPI_getApiKey() {
    if (__classPrivateFieldGet(this, _OpenWeatherMapAPI_configuredApiKey, "f")) {
        return __classPrivateFieldGet(this, _OpenWeatherMapAPI_configuredApiKey, "f");
    }
    if (!__classPrivateFieldGet(this, _OpenWeatherMapAPI_fetchedApiKey, "f")) {
        __classPrivateFieldSet(this, _OpenWeatherMapAPI_fetchedApiKey, __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_scrapeApiKey).call(this), "f");
    }
    try {
        return await __classPrivateFieldGet(this, _OpenWeatherMapAPI_fetchedApiKey, "f");
    }
    catch (error) {
        NowPlayingContext_1.default.getLogger().error(NowPlayingContext_1.default.getErrorMessage('[now-playing] Failed to fetch OpenWeatherMap API key:', error, false));
        throw Error(NowPlayingContext_1.default.getI18n('NOW_PLAYING_ERR_WEATHER_API_KEY_NOT_CONFIGURED'));
    }
}, _OpenWeatherMapAPI_scrapeApiKey = async function _OpenWeatherMapAPI_scrapeApiKey() {
    const html = await fetchPage(BASE_URL);
    const regex = /\\"(static\/chunks\/app\/%5B%5B\.\.\.slug%5D%5D\/page-.+?\.js)\\"/gm;
    const pageChunkPathnames = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        const p = `_next/${match[1]}`;
        if (!pageChunkPathnames.includes(p)) {
            pageChunkPathnames.push(p);
        }
    }
    const pageChunkUrls = pageChunkPathnames.map((p) => new URL(p, BASE_URL).toString());
    const keyPromises = pageChunkUrls.map((url) => {
        return (async () => {
            try {
                const js = await fetchPage(url);
                const keyRegex = /OWM_API_KEY\|\|"(.+?)"/gm;
                const match = keyRegex.exec(js);
                if (match && match[1]) {
                    return match[1];
                }
                return null;
            }
            catch (error) {
                NowPlayingContext_1.default.getLogger().error(NowPlayingContext_1.default.getErrorMessage(`[now-playing] Error finding OpenWeatherMap API key from "${url}"`, error, false));
                return null;
            }
        })();
    });
    const key = (await Promise.all(keyPromises)).find((key) => key) ?? null;
    if (key) {
        return {
            value: key,
            targetVersion: 'web'
        };
    }
    throw Error(`Key not found (tried ${pageChunkUrls.length} URLs`);
}, _OpenWeatherMapAPI_createFullApiUrl = async function _OpenWeatherMapAPI_createFullApiUrl(apiUrl) {
    if (!__classPrivateFieldGet(this, _OpenWeatherMapAPI_coordinates, "f")) {
        throw Error('No coordinates specified');
    }
    const url = new URL(apiUrl);
    const { value: apiKey } = await __classPrivateFieldGet(this, _OpenWeatherMapAPI_instances, "m", _OpenWeatherMapAPI_getApiKey).call(this);
    url.searchParams.append('appid', apiKey);
    url.searchParams.append('lat', __classPrivateFieldGet(this, _OpenWeatherMapAPI_coordinates, "f").lat.toString());
    url.searchParams.append('lon', __classPrivateFieldGet(this, _OpenWeatherMapAPI_coordinates, "f").lon.toString());
    if (__classPrivateFieldGet(this, _OpenWeatherMapAPI_lang, "f")) {
        url.searchParams.append('lang', __classPrivateFieldGet(this, _OpenWeatherMapAPI_lang, "f"));
    }
    if (__classPrivateFieldGet(this, _OpenWeatherMapAPI_units, "f")) {
        url.searchParams.append('units', __classPrivateFieldGet(this, _OpenWeatherMapAPI_units, "f"));
    }
    return url.toString();
}, _OpenWeatherMapAPI_parseLocation = function _OpenWeatherMapAPI_parseLocation(data) {
    return {
        name: data.name,
        country: data.sys?.country
    };
}, _OpenWeatherMapAPI_parseCurrent = function _OpenWeatherMapAPI_parseCurrent(data) {
    const current = data.current || {};
    const parsed = {
        temp: {
            now: current.temp,
            // First day of daily forecast is current day
            min: data.daily?.[0]?.temp?.min,
            max: data.daily?.[0]?.temp?.max
        },
        humidity: current.humidity,
        windSpeed: current.wind_speed,
        icon: current.weather?.[0]?.icon
    };
    return parsed;
}, _OpenWeatherMapAPI_parseDaily = function _OpenWeatherMapAPI_parseDaily(data) {
    return data.daily?.map((daily) => {
        const parsed = {
            temp: {
                min: daily.temp?.min,
                max: daily.temp?.max
            },
            humidity: daily.humidity,
            windSpeed: daily.wind_speed,
            icon: daily.weather?.[0]?.icon,
            dateTimeMillis: daily.dt * 1000
        };
        return parsed;
    }) || [];
}, _OpenWeatherMapAPI_parseHourly = function _OpenWeatherMapAPI_parseHourly(data) {
    return data.hourly?.map((hourly) => {
        const parsed = {
            temp: hourly.temp,
            humidity: hourly.humidity,
            windSpeed: hourly.wind_speed,
            icon: hourly.weather?.[0]?.icon,
            dateTimeMillis: hourly.dt * 1000
        };
        return parsed;
    }) || [];
};
exports.default = OpenWeatherMapAPI;
//# sourceMappingURL=index.js.map