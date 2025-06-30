import type I18nSchema from '../i18n/strings_en.json';
import type winston from 'winston';
export type I18nKey = keyof typeof I18nSchema;
declare class LyrionContext {
    #private;
    constructor();
    init(pluginContext: any): void;
    toast(type: 'success' | 'info' | 'error' | 'warning', message: string, title?: string): void;
    getLogger(): winston.Logger;
    getErrorMessage(message: string, error: any, stack?: boolean): string;
    reset(): void;
    getI18n(key: I18nKey, ...formatValues: any[]): string;
    getDeviceInfo(): any;
    get volumioCoreCommand(): any;
}
declare const _default: LyrionContext;
export default _default;
//# sourceMappingURL=LyrionContext.d.ts.map