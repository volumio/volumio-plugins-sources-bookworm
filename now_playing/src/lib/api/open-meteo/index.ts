import np from '../../NowPlayingContext';
import { fetchWeatherApi } from "openmeteo";
import { type WeatherApiResponse } from "@openmeteo/sdk/weather-api-response";
import OpenStreetMapAPI from "../openstreetmap";

export interface OpenMeteoAPIConstructorOptions {
  lat?: number;
  lon?: number;
  lang?: string;
  units?: 'metric' | 'imperial';
}

export interface OpenMeteoAPIGetWeatherResult {
  location: {
    name?: string;
    country?: string;
  };
  current: {
    temp: {
      now?: number;
      min?: number;
      max?: number;
    };
    humidity?: number;
    windSpeed?: number;
    icon?: string;
  };
  daily: {
    temp: {
      min?: number;
      max?: number;
    };
    humidity?: number;
    windSpeed?: number;
    icon?: string;
    dateTimeMillis?: number;
  }[];
  hourly: {
    temp?: number;
    humidity?: number;
    windSpeed?: number;
    icon?: string;
    dateTimeMillis?: number;
  }[];
}

const OM_FORECAST_API_URL = 'https://api.open-meteo.com/v1/forecast';

export default class OpenMeteoAPI {
  #coordinates: { lat: number, lon: number } | null;
  #lang: string | null;
  #timezone?: string;
  #units: 'metric' | 'imperial';

  constructor(args?: OpenMeteoAPIConstructorOptions) {
    this.#coordinates = null;
    this.#lang = null;
    this.#units = 'metric';

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

  setCoordinates(lat: number, lon: number) {
    if (typeof lat === 'number' && typeof lon === 'number' && -90 <= lat && lat <= 90 && -180 <= lon && lon <= 180) {
      this.#coordinates = { lat, lon };
      return;
    }
    throw Error('Invalid coordinates');
  }

  setTimzone(tz: string | undefined) {
    this.#timezone = tz;
  }

  setLang(lang: string) {
    this.#lang = lang;
  }

  setUnits(units: 'metric' | 'imperial') {
    this.#units = units;
  }

  async #getLocation() {
    if (!this.#coordinates) {
      return { name: undefined, country: undefined };
    }
    try {
      return await OpenStreetMapAPI.reverse(this.#coordinates.lat, this.#coordinates.lon, this.#lang || undefined);
    }
    catch (error) {
      np.getLogger().error(np.getErrorMessage('[now-playing] Error getting location from OpenStreetMap:', error));
      return { name: undefined, country: undefined };
    }
  }

  async getWeather(): Promise<OpenMeteoAPIGetWeatherResult> {
    const data = (await fetchWeatherApi(OM_FORECAST_API_URL, this.#getForecastApiParams()))[0];
    if (!data) {
      throw Error('No data obtained');
    }
    const sanitized = this.sanitizeWeatherApiResponse(data);
    return {
      location: await this.#getLocation(),
      current: this.#parseCurrent(sanitized),
      daily: this.#parseDaily(sanitized),
      hourly: this.#parseHourly(sanitized)
    };
  }

  #getForecastApiParams() {
    if (!this.#coordinates) {
      throw Error('No coordinates specified');
    }

    const params: Record<string, any> = {
      latitude: this.#coordinates.lat,
      longitude: this.#coordinates.lon,
      daily: ["temperature_2m_max", "temperature_2m_min", "weather_code", "wind_speed_10m_max", "relative_humidity_2m_mean"],
      hourly: ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "weather_code", "is_day"],
      current: ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "weather_code", "is_day"],
      forecast_days: 7,
      forecast_hours: 24,
      wind_speed_unit: this.#units === 'metric' ? 'ms' : 'mph',
      temperature_unit: this.#units === 'metric' ? 'celsius' : 'fahrenheit',
    };

    if (this.#timezone) {
      params.timezone = this.#timezone;
    }

    return params;
  }

  private sanitizeWeatherApiResponse(res: WeatherApiResponse) {

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
      temperature_2m: current.variables(0)!.value(),
      relative_humidity_2m: current.variables(1)!.value(),
      wind_speed_10m: current.variables(2)!.value(),
      weather_code: current.variables(3)!.value(),
      is_day: current.variables(4)!.value()
    } : null;

    const sanitizedDaily = daily ? {
      time: Array.from(
        { length: (Number(daily.timeEnd()) - Number(daily.time())) / daily.interval() }, 
        (_ , i) => new Date((Number(daily.time()) + i * daily.interval() + utcOffsetSeconds) * 1000)
      ),
      temperature_2m_max: daily.variables(0)!.valuesArray(),
      temperature_2m_min: daily.variables(1)!.valuesArray(),
      weather_code: daily.variables(2)!.valuesArray(),
      wind_speed_10m_max: daily.variables(3)!.valuesArray(),
      relative_humidity_2m_mean: daily.variables(4)!.valuesArray()
    } : null;

    const sanitizedHourly = hourly ? {
      time: Array.from(
        { length: (Number(hourly.timeEnd()) - Number(hourly.time())) / hourly.interval() }, 
        (_ , i) => new Date((Number(hourly.time()) + i * hourly.interval() + utcOffsetSeconds) * 1000)
      ),
      temperature_2m: hourly.variables(0)!.valuesArray(),
      relative_humidity_2m: hourly.variables(1)!.valuesArray(),
      wind_speed_10m: hourly.variables(2)!.valuesArray(),
      weather_code: hourly.variables(3)!.valuesArray(),
      is_day: hourly.variables(4)!.valuesArray()
    } : null;

    return {
      current: sanitizedCurrent,
      daily: sanitizedDaily,
      hourly: sanitizedHourly
    };
  }

  #parseCurrent(data: ReturnType<OpenMeteoAPI['sanitizeWeatherApiResponse']>): OpenMeteoAPIGetWeatherResult['current'] {
    const currentData = data.current;
    if (!currentData) {
      return {
        temp: {}
      };
    }
    const mapped: OpenMeteoAPIGetWeatherResult['current'] = {
      temp: {
        now: currentData.temperature_2m,
        // First day of daily forecast is current day
        min: data.daily?.temperature_2m_min?.[0],
        max: data.daily?.temperature_2m_max?.[0]
      },
      humidity: currentData.relative_humidity_2m,
      windSpeed: currentData.wind_speed_10m,
      icon: this.#getWeatherIconName(currentData.weather_code, currentData.is_day === 1)
    };
    return mapped;
  }

  #parseDaily(data: ReturnType<OpenMeteoAPI['sanitizeWeatherApiResponse']>): OpenMeteoAPIGetWeatherResult['daily'] {
    const dailyData = data.daily;
    if (!dailyData) {
      return [];
    }
    const mapped = dailyData.time.map<OpenMeteoAPIGetWeatherResult['daily'][number]>((time, i) => ({
      temp: {
        min: dailyData.temperature_2m_min?.[i],
        max: dailyData.temperature_2m_max?.[i],
      },
      humidity: dailyData.relative_humidity_2m_mean?.[i],
      windSpeed: dailyData.wind_speed_10m_max?.[i],
      icon: dailyData.weather_code?.[i] !== undefined ? this.#getWeatherIconName(dailyData.weather_code[i], true) : undefined,
      dateTimeMillis: time.getTime()
    }));
    return mapped;
  }

  #parseHourly(data: ReturnType<OpenMeteoAPI['sanitizeWeatherApiResponse']>): OpenMeteoAPIGetWeatherResult['hourly'] {
    const hourlyData = data.hourly;
    if (!hourlyData) {
      return [];
    }
    const mapped = hourlyData.time.map<OpenMeteoAPIGetWeatherResult['hourly'][number]>((time, i) => ({
      temp: hourlyData.temperature_2m?.[i],
      humidity: hourlyData.temperature_2m?.[i],
      windSpeed: hourlyData.wind_speed_10m?.[i],
      icon: hourlyData.weather_code?.[i] !== undefined ? this.#getWeatherIconName(hourlyData.weather_code[i], (hourlyData.is_day?.[i] ?? 1) === 1) : undefined,
      dateTimeMillis: time.getTime()
    }));
    return mapped;
  }

  /**
   * Map `code` to OpenWeatherMap icon name.
   * @param code WMO weather interpretation code.
   * @returns 
   */
  #getWeatherIconName(code: number, isDay: boolean) {
    const suffix = isDay ? 'd' : 'n';

    const mapping: Record<number, string> = {
      0: '01',           // Clear sky
      1: '01',           // Mainly clear
      2: '02',           // Partly cloudy
      3: '03',           // Overcast
      45: '50',          // Fog
      48: '50',          // Depositing rime fog
      51: '09',          // Drizzle: Light
      53: '09',          // Drizzle: Moderate
      55: '09',          // Drizzle: Dense intensity
      56: '09',          // Freezing Drizzle: Light
      57: '09',          // Freezing Drizzle: Dense
      61: '10',          // Rain: Slight
      63: '10',          // Rain: Moderate
      65: '10',          // Rain: Heavy
      66: '13',          // Freezing Rain: Light
      67: '13',          // Freezing Rain: Heavy
      71: '13',          // Snow fall: Slight
      73: '13',          // Snow fall: Moderate
      75: '13',          // Snow fall: Heavy
      77: '13',          // Snow grains
      80: '09',          // Rain showers: Slight
      81: '09',          // Rain showers: Moderate
      82: '09',          // Rain showers: Violent
      85: '13',          // Snow showers: Slight
      86: '13',          // Snow showers: Heavy
      95: '11',          // Thunderstorm: Slight or moderate
      96: '11',          // Thunderstorm with slight hail
      99: '11',          // Thunderstorm with heavy hail
    };

    const icon = mapping[code];

    if (!icon) {
      np.getLogger().warn(`[now-playing] (open-meteo) Weather code ${code} has no corresponding icon`);
    }

    return icon ? `${icon}${suffix}` : undefined;
  }
}