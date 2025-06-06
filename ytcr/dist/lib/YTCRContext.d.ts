import { type PluginConfigKey, type PluginConfigValue } from './PluginConfig';
interface DeviceInfo {
    name: string;
    uuid: string;
    time: string;
}
export interface PluginInfo {
    prettyName: string;
    name: string;
    category: string;
    version: string;
    icon: string;
    isManuallyInstalled: boolean;
    enabled: boolean;
    active: boolean;
}
declare class YTCRContext {
    #private;
    constructor();
    set(key: string, value: any): void;
    get(key: string, defaultValue?: any): any;
    init(pluginContext: any, pluginConfig: any): void;
    toast(type: string, message: string, title?: string): void;
    getDeviceInfo(): DeviceInfo;
    getConfigValue<T extends PluginConfigKey>(key: T): PluginConfigValue<T>;
    deleteConfigValue(key: PluginConfigKey): void;
    setConfigValue<T extends PluginConfigKey>(key: T, value: PluginConfigValue<T>): void;
    getMpdPlugin(): any;
    getMusicServicePlugin(name: string): any;
    getPluginInfo(name: string, category?: string): Promise<PluginInfo | null>;
    getStateMachine(): any;
    reset(): void;
    getI18n(key: string, ...formatValues: any[]): string;
}
declare const _default: YTCRContext;
export default _default;
//# sourceMappingURL=YTCRContext.d.ts.map