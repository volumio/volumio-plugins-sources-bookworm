import np from '../../NowPlayingContext';

const BASE_URL = 'https://openweathermap.org';
const API_URL = 'https://api.openweathermap.org';
const ONECALL_URL: Record<APIKey['targetVersion'], string> = {
  'web': `${BASE_URL}/api/widget/onecall`, // Used by OWM website
  '3.0': `${API_URL}/data/3.0/onecall` // Public API - user provides key
};
const WEATHER_URL = `${API_URL}/data/2.5/weather`;

async function fetchPage(url: string, json: true): Promise<any>;
async function fetchPage(url: string, json?: false): Promise<string>;
async function fetchPage(url: string, json = false) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await (json ? response.json() : response.text());
    }
    throw Error(`Response error: ${response.status} - ${response.statusText}`);
  }
  catch (error) {
    np.getLogger().error(np.getErrorMessage(`[now-playing] Error fetching OpenWeatherMap resource "${url}":`, error, false));
    throw error;
  }
}

interface APIKey {
  value: string;
  targetVersion: 'web' | '3.0';
}

export interface OpenWeatherMapAPIConstructorOptions {
  lat?: number;
  lon?: number;
  lang?: string;
  units?: string;
}

export interface OpenWeatherMapAPIGetWeatherResult {
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

export default class OpenWeatherMapAPI {

  // Contains API key provided by user in plugin settings; targets API v3.0.
  #configuredApiKey: APIKey | null;

  // Contains API key scraped from OWM website; targets 'web' version.
  #fetchedApiKey: Promise<APIKey> | null;

  #coordinates: { lat: number, lon: number } | null;
  #lang: string | null;
  #units: string | null;

  constructor(args?: OpenWeatherMapAPIConstructorOptions) {
    this.#configuredApiKey = null;
    this.#fetchedApiKey = null;
    this.#coordinates = null;
    this.#lang = null;
    this.#units = null;

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

  setLang(lang: string) {
    this.#lang = lang;
  }

  setUnits(units: string) {
    this.#units = units;
  }

  setApiKey(apiKey: string | null, targetVersion: APIKey['targetVersion'] = '3.0') {
    this.#configuredApiKey = apiKey && apiKey.trim() ? {
      value: apiKey,
      targetVersion
    } : null;
  }

  async #getApiKey() {
    if (this.#configuredApiKey) {
      return this.#configuredApiKey;
    }
    if (!this.#fetchedApiKey) {
      this.#fetchedApiKey = this.#scrapeApiKey();
    }
    try {
      return await this.#fetchedApiKey;
    }
    catch (error) {
      np.getLogger().error(np.getErrorMessage('[now-playing] Failed to fetch OpenWeatherMap API key:', error, false));
      throw Error(np.getI18n('NOW_PLAYING_ERR_WEATHER_API_KEY_NOT_CONFIGURED'));
    }
  }

  async #scrapeApiKey(): Promise<APIKey> {
    const html = await fetchPage(BASE_URL);
    const regex = /\\"(static\/chunks\/app\/%5B%5B\.\.\.slug%5D%5D\/page-.+?\.js)\\"/gm;
    const pageChunkPathnames: string[] = [];
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
          np.getLogger().error(np.getErrorMessage(`[now-playing] Error finding OpenWeatherMap API key from "${url}"`, error, false));
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
  }

  async getWeather(): Promise<OpenWeatherMapAPIGetWeatherResult> {
    const fetchData = async (forceRefreshApiKey = false): Promise<any> => {
      if (forceRefreshApiKey) {
        this.#fetchedApiKey = null;
      }

      const { targetVersion } = await this.#getApiKey();

      const [ oneCallUrl, weatherUrl ] = await Promise.all([
        this.#createFullApiUrl(ONECALL_URL[targetVersion]),
        this.#createFullApiUrl(WEATHER_URL)
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
        if (!forceRefreshApiKey && !this.#configuredApiKey) {
          // Retry with forceRefreshApiKey
          // Note we only do this if user hasn't configured their own API key
          return fetchData(true);
        }

        throw error;
      }
    };

    const [ weatherData, locationData ] = await fetchData();
    const result = {
      location: this.#parseLocation(locationData),
      current: this.#parseCurrent(weatherData),
      daily: this.#parseDaily(weatherData),
      hourly: this.#parseHourly(weatherData)
    };
    return result;
  }

  async #createFullApiUrl(apiUrl: string) {
    if (!this.#coordinates) {
      throw Error('No coordinates specified');
    }
    const url = new URL(apiUrl);
    const { value: apiKey } = await this.#getApiKey();
    url.searchParams.append('appid', apiKey);
    url.searchParams.append('lat', this.#coordinates.lat.toString());
    url.searchParams.append('lon', this.#coordinates.lon.toString());

    if (this.#lang) {
      url.searchParams.append('lang', this.#lang);
    }
    if (this.#units) {
      url.searchParams.append('units', this.#units);
    }

    return url.toString();
  }

  #parseLocation(data: any) {
    return {
      name: data.name,
      country: data.sys?.country
    };
  }

  #parseCurrent(data: any): OpenWeatherMapAPIGetWeatherResult['current'] {
    const current = data.current || {};
    const parsed: OpenWeatherMapAPIGetWeatherResult['current'] = {
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
  }

  #parseDaily(data: any): OpenWeatherMapAPIGetWeatherResult['daily'] {
    return data.daily?.map((daily: any) => {
      const parsed: OpenWeatherMapAPIGetWeatherResult['daily'][number] = {
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
  }

  #parseHourly(data: any): OpenWeatherMapAPIGetWeatherResult['hourly'] {
    return data.hourly?.map((hourly: any) => {
      const parsed: OpenWeatherMapAPIGetWeatherResult['hourly'][number] = {
        temp: hourly.temp,
        humidity: hourly.humidity,
        windSpeed: hourly.wind_speed,
        icon: hourly.weather?.[0]?.icon,
        dateTimeMillis: hourly.dt * 1000
      };
      return parsed;
    }) || [];
  }
}
