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
var _OpenMeteoAPI_instances, _OpenMeteoAPI_coordinates, _OpenMeteoAPI_lang, _OpenMeteoAPI_timezone, _OpenMeteoAPI_units, _OpenMeteoAPI_getLocation, _OpenMeteoAPI_getForecastApiParams, _OpenMeteoAPI_parseCurrent, _OpenMeteoAPI_parseDaily, _OpenMeteoAPI_parseHourly, _OpenMeteoAPI_getWeatherIconName;
Object.defineProperty(exports, "__esModule", { value: true });
const NowPlayingContext_1 = __importDefault(require("../../NowPlayingContext"));
const openmeteo_1 = require("openmeteo");
const openstreetmap_1 = __importDefault(require("../openstreetmap"));
const OM_FORECAST_API_URL = 'https://api.open-meteo.com/v1/forecast';
class OpenMeteoAPI {
    constructor(args) {
        _OpenMeteoAPI_instances.add(this);
        _OpenMeteoAPI_coordinates.set(this, void 0);
        _OpenMeteoAPI_lang.set(this, void 0);
        _OpenMeteoAPI_timezone.set(this, void 0);
        _OpenMeteoAPI_units.set(this, void 0);
        __classPrivateFieldSet(this, _OpenMeteoAPI_coordinates, null, "f");
        __classPrivateFieldSet(this, _OpenMeteoAPI_lang, null, "f");
        __classPrivateFieldSet(this, _OpenMeteoAPI_units, 'metric', "f");
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
            __classPrivateFieldSet(this, _OpenMeteoAPI_coordinates, { lat, lon }, "f");
            return;
        }
        throw Error('Invalid coordinates');
    }
    setTimzone(tz) {
        __classPrivateFieldSet(this, _OpenMeteoAPI_timezone, tz, "f");
    }
    setLang(lang) {
        __classPrivateFieldSet(this, _OpenMeteoAPI_lang, lang, "f");
    }
    setUnits(units) {
        __classPrivateFieldSet(this, _OpenMeteoAPI_units, units, "f");
    }
    async getWeather() {
        const data = (await (0, openmeteo_1.fetchWeatherApi)(OM_FORECAST_API_URL, __classPrivateFieldGet(this, _OpenMeteoAPI_instances, "m", _OpenMeteoAPI_getForecastApiParams).call(this)))[0];
        if (!data) {
            throw Error('No data obtained');
        }
        const sanitized = this.sanitizeWeatherApiResponse(data);
        return {
            location: await __classPrivateFieldGet(this, _OpenMeteoAPI_instances, "m", _OpenMeteoAPI_getLocation).call(this),
            current: __classPrivateFieldGet(this, _OpenMeteoAPI_instances, "m", _OpenMeteoAPI_parseCurrent).call(this, sanitized),
            daily: __classPrivateFieldGet(this, _OpenMeteoAPI_instances, "m", _OpenMeteoAPI_parseDaily).call(this, sanitized),
            hourly: __classPrivateFieldGet(this, _OpenMeteoAPI_instances, "m", _OpenMeteoAPI_parseHourly).call(this, sanitized)
        };
    }
    sanitizeWeatherApiResponse(res) {
        // utcOffsetSeconds is the offset based on timezone.
        // The client takes date/time in UTC, so we set this to zero.
        const utcOffsetSeconds = 0;
        // const utcOffsetSeconds = res.utcOffsetSeconds();
        const current = res.current();
        const hourly = res.hourly();
        const daily = res.daily();
        // Note: The order of weather variables in the URL query and the indices below need to match!
        const sanitizedCurrent = current ? {
            time: new Date((Number(current.time()) + utcOffsetSeconds) * 1000),
            temperature_2m: current.variables(0).value(),
            relative_humidity_2m: current.variables(1).value(),
            wind_speed_10m: current.variables(2).value(),
            weather_code: current.variables(3).value(),
            is_day: current.variables(4).value()
        } : null;
        const sanitizedDaily = daily ? {
            time: Array.from({ length: (Number(daily.timeEnd()) - Number(daily.time())) / daily.interval() }, (_, i) => new Date((Number(daily.time()) + i * daily.interval() + utcOffsetSeconds) * 1000)),
            temperature_2m_max: daily.variables(0).valuesArray(),
            temperature_2m_min: daily.variables(1).valuesArray(),
            weather_code: daily.variables(2).valuesArray(),
            wind_speed_10m_max: daily.variables(3).valuesArray(),
            relative_humidity_2m_mean: daily.variables(4).valuesArray()
        } : null;
        const sanitizedHourly = hourly ? {
            time: Array.from({ length: (Number(hourly.timeEnd()) - Number(hourly.time())) / hourly.interval() }, (_, i) => new Date((Number(hourly.time()) + i * hourly.interval() + utcOffsetSeconds) * 1000)),
            temperature_2m: hourly.variables(0).valuesArray(),
            relative_humidity_2m: hourly.variables(1).valuesArray(),
            wind_speed_10m: hourly.variables(2).valuesArray(),
            weather_code: hourly.variables(3).valuesArray(),
            is_day: hourly.variables(4).valuesArray()
        } : null;
        return {
            current: sanitizedCurrent,
            daily: sanitizedDaily,
            hourly: sanitizedHourly
        };
    }
}
_OpenMeteoAPI_coordinates = new WeakMap(), _OpenMeteoAPI_lang = new WeakMap(), _OpenMeteoAPI_timezone = new WeakMap(), _OpenMeteoAPI_units = new WeakMap(), _OpenMeteoAPI_instances = new WeakSet(), _OpenMeteoAPI_getLocation = async function _OpenMeteoAPI_getLocation() {
    if (!__classPrivateFieldGet(this, _OpenMeteoAPI_coordinates, "f")) {
        return { name: undefined, country: undefined };
    }
    try {
        return await openstreetmap_1.default.reverse(__classPrivateFieldGet(this, _OpenMeteoAPI_coordinates, "f").lat, __classPrivateFieldGet(this, _OpenMeteoAPI_coordinates, "f").lon, __classPrivateFieldGet(this, _OpenMeteoAPI_lang, "f") || undefined);
    }
    catch (error) {
        NowPlayingContext_1.default.getLogger().error(NowPlayingContext_1.default.getErrorMessage('[now-playing] Error getting location from OpenStreetMap:', error));
        return { name: undefined, country: undefined };
    }
}, _OpenMeteoAPI_getForecastApiParams = function _OpenMeteoAPI_getForecastApiParams() {
    if (!__classPrivateFieldGet(this, _OpenMeteoAPI_coordinates, "f")) {
        throw Error('No coordinates specified');
    }
    const params = {
        latitude: __classPrivateFieldGet(this, _OpenMeteoAPI_coordinates, "f").lat,
        longitude: __classPrivateFieldGet(this, _OpenMeteoAPI_coordinates, "f").lon,
        daily: ["temperature_2m_max", "temperature_2m_min", "weather_code", "wind_speed_10m_max", "relative_humidity_2m_mean"],
        hourly: ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "weather_code", "is_day"],
        current: ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "weather_code", "is_day"],
        forecast_days: 7,
        forecast_hours: 24,
        wind_speed_unit: __classPrivateFieldGet(this, _OpenMeteoAPI_units, "f") === 'metric' ? 'ms' : 'mph',
        temperature_unit: __classPrivateFieldGet(this, _OpenMeteoAPI_units, "f") === 'metric' ? 'celsius' : 'fahrenheit',
    };
    if (__classPrivateFieldGet(this, _OpenMeteoAPI_timezone, "f")) {
        params.timezone = __classPrivateFieldGet(this, _OpenMeteoAPI_timezone, "f");
    }
    return params;
}, _OpenMeteoAPI_parseCurrent = function _OpenMeteoAPI_parseCurrent(data) {
    const currentData = data.current;
    if (!currentData) {
        return {
            temp: {}
        };
    }
    const mapped = {
        temp: {
            now: currentData.temperature_2m,
            // First day of daily forecast is current day
            min: data.daily?.temperature_2m_min?.[0],
            max: data.daily?.temperature_2m_max?.[0]
        },
        humidity: currentData.relative_humidity_2m,
        windSpeed: currentData.wind_speed_10m,
        icon: __classPrivateFieldGet(this, _OpenMeteoAPI_instances, "m", _OpenMeteoAPI_getWeatherIconName).call(this, currentData.weather_code, currentData.is_day === 1)
    };
    return mapped;
}, _OpenMeteoAPI_parseDaily = function _OpenMeteoAPI_parseDaily(data) {
    const dailyData = data.daily;
    if (!dailyData) {
        return [];
    }
    const mapped = dailyData.time.map((time, i) => ({
        temp: {
            min: dailyData.temperature_2m_min?.[i],
            max: dailyData.temperature_2m_max?.[i],
        },
        humidity: dailyData.relative_humidity_2m_mean?.[i],
        windSpeed: dailyData.wind_speed_10m_max?.[i],
        icon: dailyData.weather_code?.[i] !== undefined ? __classPrivateFieldGet(this, _OpenMeteoAPI_instances, "m", _OpenMeteoAPI_getWeatherIconName).call(this, dailyData.weather_code[i], true) : undefined,
        dateTimeMillis: time.getTime()
    }));
    return mapped;
}, _OpenMeteoAPI_parseHourly = function _OpenMeteoAPI_parseHourly(data) {
    const hourlyData = data.hourly;
    if (!hourlyData) {
        return [];
    }
    const mapped = hourlyData.time.map((time, i) => ({
        temp: hourlyData.temperature_2m?.[i],
        humidity: hourlyData.temperature_2m?.[i],
        windSpeed: hourlyData.wind_speed_10m?.[i],
        icon: hourlyData.weather_code?.[i] !== undefined ? __classPrivateFieldGet(this, _OpenMeteoAPI_instances, "m", _OpenMeteoAPI_getWeatherIconName).call(this, hourlyData.weather_code[i], (hourlyData.is_day?.[i] ?? 1) === 1) : undefined,
        dateTimeMillis: time.getTime()
    }));
    return mapped;
}, _OpenMeteoAPI_getWeatherIconName = function _OpenMeteoAPI_getWeatherIconName(code, isDay) {
    const suffix = isDay ? 'd' : 'n';
    const mapping = {
        0: '01', // Clear sky
        1: '01', // Mainly clear
        2: '02', // Partly cloudy
        3: '03', // Overcast
        45: '50', // Fog
        48: '50', // Depositing rime fog
        51: '09', // Drizzle: Light
        53: '09', // Drizzle: Moderate
        55: '09', // Drizzle: Dense intensity
        56: '09', // Freezing Drizzle: Light
        57: '09', // Freezing Drizzle: Dense
        61: '10', // Rain: Slight
        63: '10', // Rain: Moderate
        65: '10', // Rain: Heavy
        66: '13', // Freezing Rain: Light
        67: '13', // Freezing Rain: Heavy
        71: '13', // Snow fall: Slight
        73: '13', // Snow fall: Moderate
        75: '13', // Snow fall: Heavy
        77: '13', // Snow grains
        80: '09', // Rain showers: Slight
        81: '09', // Rain showers: Moderate
        82: '09', // Rain showers: Violent
        85: '13', // Snow showers: Slight
        86: '13', // Snow showers: Heavy
        95: '11', // Thunderstorm: Slight or moderate
        96: '11', // Thunderstorm with slight hail
        99: '11', // Thunderstorm with heavy hail
    };
    const icon = mapping[code];
    if (!icon) {
        NowPlayingContext_1.default.getLogger().warn(`[now-playing] (open-meteo) Weather code ${code} has no corresponding icon`);
    }
    return icon ? `${icon}${suffix}` : undefined;
};
exports.default = OpenMeteoAPI;
