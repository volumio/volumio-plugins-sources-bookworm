import format from 'string-format';
import fs from 'fs-extra';
import type winston from 'winston';
import Cache from './util/Cache';

class BandcampContext {

  #singletons: Record<string, any>;
  #data: Record<string, any>;
  #pluginContext?: any;
  #pluginConfig?: any;

  #i18n: Record<string, string | Record<string, string>>;
  #i18nDefaults: Record<string, string | Record<string, string>>;
  #i18CallbackRegistered: boolean;

  #cache: Cache;

  constructor() {
    this.#singletons = {};
    this.#data = {};
    this.#i18n = {};
    this.#i18nDefaults = {};
    this.#i18CallbackRegistered = false;
  }

  set(key: string, value: any) {
    this.#data[key] = value;
  }

  get<T>(key: string, defaultValue: T): T
  get<T>(key: string, defaultValue?: T): T | null {
    return (this.#data[key] !== undefined) ? this.#data[key] : (defaultValue || null);
  }

  delete(key: string) {
    delete this.#data[key];
  }

  init(pluginContext: any, pluginConfig: any) {
    this.#pluginContext = pluginContext;
    this.#pluginConfig = pluginConfig;

    this.#loadI18n();
    if (!this.#i18CallbackRegistered) {
      this.#pluginContext.coreCommand.sharedVars.registerCallback('language_code', this.#onSystemLanguageChanged.bind(this));
      this.#i18CallbackRegistered = true;
    }

    this.#cache = new Cache(this.getConfigValue('cacheTTL', 1800), this.getConfigValue('cacheMaxEntries', 5000));
  }

  toast(type: 'success' | 'info' | 'error' | 'warning', message: string, title = 'Bandcamp Discover') {
    this.#pluginContext.coreCommand.pushToastMessage(type, title, message);
  }

  getLogger(): winston.Logger {
    return this.#pluginContext.logger;
  }

  getConfigValue<T>(key: string, defaultValue: T, json = false): T {
    if (this.#pluginConfig.has(key)) {
      const val = this.#pluginConfig.get(key);
      if (json) {
        try {
          return JSON.parse(val);
        }
        catch (e) {
          return defaultValue;
        }
      }
      else {
        return val;
      }
    }
    else {
      return defaultValue;
    }
  }

  deleteConfigValue(key: string) {
    this.#pluginConfig.delete(key);
  }

  setConfigValue(key: string, value: any, json = false) {
    this.#pluginConfig.set(key, json ? JSON.stringify(value) : value);
  }

  getAlbumArtPlugin() {
    return this.#getSingleton('albumArtPlugin', () => this.#pluginContext.coreCommand.pluginManager.getPlugin('miscellanea', 'albumart'));
  }

  getMpdPlugin(): any {
    return this.#getSingleton('mpdPlugin', () => this.#pluginContext.coreCommand.pluginManager.getPlugin('music_service', 'mpd'));
  }

  getStateMachine(): any {
    return this.#pluginContext.coreCommand.stateMachine;
  }

  getCache() {
    return this.#cache;
  }

  getPlaylistManager(): any {
    return this.#pluginContext.coreCommand.playListManager;
  }

  reset() {
    this.#pluginContext = null;
    this.#pluginConfig = null;

    this.#singletons = {};
    this.#data = {};

    this.#cache.clear();
  }

  #getSingleton(key: string, getValue: () => any): any {
    if (this.#singletons[key] == undefined) {
      this.#singletons[key] = getValue();
    }
    return this.#singletons[key];
  }

  getI18n(key: string, ...formatValues: any[]): string {
    let str;
    if (key.indexOf('.') > 0) {
      const mainKey = key.split('.')[0];
      const secKey = key.split('.')[1];
      str = (this.#i18n[mainKey] as Record<string, string>)?.[secKey] ||
        (this.#i18nDefaults[mainKey] as Record<string, string>)?.[secKey] ||
        key;
    }
    else {
      str = (this.#i18n[key] || this.#i18nDefaults[key] || key) as string;
    }

    if (str && formatValues.length) {
      str = format(str, ...formatValues);
    }

    return str;
  }

  #loadI18n() {
    if (this.#pluginContext) {
      const i18nPath = `${__dirname}/../i18n`;

      try {
        this.#i18nDefaults = fs.readJsonSync(`${i18nPath}/strings_en.json`);
      }
      catch (e) {
        this.#i18nDefaults = {};
      }

      try {
        const language_code = this.#pluginContext.coreCommand.sharedVars.get('language_code');
        this.#i18n = fs.readJsonSync(`${i18nPath}/strings_${language_code}.json`);
      }
      catch (e) {
        this.#i18n = this.#i18nDefaults;
      }
    }
  }

  #onSystemLanguageChanged() {
    this.#loadI18n();
  }

  get volumioCoreCommand(): any {
    return this.#pluginContext?.coreCommand || null;
  }
}

export default new BandcampContext();
