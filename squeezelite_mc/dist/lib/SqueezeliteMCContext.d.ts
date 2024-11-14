import type I18nSchema from '../i18n/strings_en.json';
import type winston from 'winston';
import { type PluginConfigKey, type PluginConfigValue } from './Config';
export type I18nKey = keyof typeof I18nSchema;
declare class SqueezeliteMCContext {
    #private;
    constructor();
    set<T>(key: string, value: T): void;
    get<T>(key: string): T | null;
    get<T>(key: string, defaultValue: T): T;
    delete(key: string): void;
    init(pluginContext: any, pluginConfig: any): void;
    toast(type: 'success' | 'info' | 'error' | 'warning', message: string, title?: string): void;
    refreshUIConfig(): any;
    getLogger(): winston.Logger;
    getErrorMessage(message: string, error: any, stack?: boolean): string;
    hasConfigKey(key: PluginConfigKey): boolean;
    getConfigValue<T extends PluginConfigKey>(key: T, getDefault?: boolean): PluginConfigValue<T>;
    deleteConfigValue(key: string): void;
    setConfigValue<T extends PluginConfigKey>(key: T, value: PluginConfigValue<T>): void;
    getAlbumArtPlugin(): any;
    getMpdPlugin(): any;
    getStateMachine(): any;
    reset(): void;
    getI18n(key: I18nKey, ...formatValues: any[]): string;
    get volumioCoreCommand(): any;
}
declare const _default: SqueezeliteMCContext;
export default _default;
//# sourceMappingURL=SqueezeliteMCContext.d.ts.map