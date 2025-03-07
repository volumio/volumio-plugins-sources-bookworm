import type I18nSchema from '../i18n/strings_en.json';
import type winston from 'winston';
import { type PluginConfigKey, type PluginConfigValue } from './config/PluginConfig';
import { type CommonSettingsCategory, type CommonSettingsOf } from 'now-playing-common';
interface DeviceInfo {
    name: string;
    id: string;
    host: string;
}
export type I18nKey = keyof typeof I18nSchema;
declare class NowPlayingContext {
    #private;
    constructor();
    set<T>(key: string, value: T): void;
    get<T>(key: string): T | null;
    get<T>(key: string, defaultValue: T): T;
    delete(key: string): void;
    init(pluginContext: any, pluginConfig: any): void;
    toast(type: 'success' | 'info' | 'error' | 'warning', message: string, title?: string): void;
    broadcastMessage(msg: string, value?: any): any;
    refreshUIConfig(): void;
    getLogger(): winston.Logger;
    getDeviceInfo(): DeviceInfo;
    getLanguageCode(): string;
    getPluginSetting(type: string, plugin: string, setting: string): any;
    getMusicServicePlugin(name: string): any;
    getErrorMessage(message: string, error: any, stack?: boolean): string;
    hasConfigKey(key: PluginConfigKey): boolean;
    getConfigValue(key: PluginConfigKey, raw: true): any;
    getConfigValue<T extends CommonSettingsCategory>(key: T, raw?: false): CommonSettingsOf<T>;
    getConfigValue<T extends PluginConfigKey>(key: T, raw?: false): PluginConfigValue<T>;
    deleteConfigValue(key: string): void;
    setConfigValue<T extends PluginConfigKey>(key: T, value: PluginConfigValue<T>): void;
    getConfigFilePath(): string;
    reset(): void;
    getI18n(key: I18nKey, ...formatValues: any[]): string;
}
declare const _default: NowPlayingContext;
export default _default;
//# sourceMappingURL=NowPlayingContext.d.ts.map