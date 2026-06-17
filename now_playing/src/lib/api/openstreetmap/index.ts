import _ from 'lodash';

const OSM_REVERSE_API_URL = 'https://nominatim.openstreetmap.org/reverse';

export default class OpenStreetMapAPI {

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
  static async reverse(lat: number, lon: number, lang = 'en'): Promise<{name?: string; country?: string}> {
    const res = await fetch(this.#getReverseApiUrl(lat, lon, lang), {
        "headers": {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0",
         },
        "method": "GET",
    });
    const data = await res.json();
    const displayName = _.get(data, 'display_name');
    if (displayName && typeof displayName === 'string') {
      let parts = displayName.split(', ');
      // Remove postcode, if any.
      const postcode = _.get(data, 'address.postcode');
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
    }
  }

  static #getReverseApiUrl(lat: number, lon: number, lang: string) {
    const urlObj = new URL(OSM_REVERSE_API_URL);
    const acceptLang: string[] = [lang];
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
  }
}
