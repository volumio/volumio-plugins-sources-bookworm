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
    #private;
    constructor(args?: OpenWeatherMapAPIConstructorOptions);
    setCoordinates(lat: number, lon: number): void;
    setLang(lang: string): void;
    setUnits(units: string): void;
    setApiKey(apiKey: string | null, targetVersion?: APIKey['targetVersion']): void;
    getWeather(): Promise<OpenWeatherMapAPIGetWeatherResult>;
}
export {};
//# sourceMappingURL=index.d.ts.map