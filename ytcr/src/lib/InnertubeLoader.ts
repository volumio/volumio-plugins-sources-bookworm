import type Logger from './Logger.js';
import ytcr from './YTCRContext.js';
import { InnertubeFactory, type InnertubeWrapper, type PotFnResult } from 'volumio-yt-support';

export default class InnertubeLoader {

  static #instancePromise: Promise<InnertubeWrapper> | null = null;
  static #logger: Logger | null = null;

  static setLogger(logger: Logger) {
    this.#logger = logger;
  }

  static async getInstance(): Promise<InnertubeWrapper> {
    if (!this.#instancePromise) {
      this.#instancePromise = InnertubeFactory.getWrappedInstance({
        locale: {
          region: ytcr.getConfigValue('region'),
          language: ytcr.getConfigValue('language')
        },
        logger: {
          info: (msg) => this.#logger?.info(`[ytcr] ${msg}`),
          warn: (msg) => this.#logger?.warn(`[ytcr] ${msg}`),
          error: (msg) => this.#logger?.error(`[ytcr] ${msg}`),
        }
      });
    }
    return this.#instancePromise;
  }

  static async generatePoToken(identifier: string): Promise<PotFnResult> {
    const instance = await this.getInstance();
    return await instance.generatePoToken(identifier);
  }

  static async reset() {
    if (this.#instancePromise) {
      const instance = await this.#instancePromise;
      await instance.dispose();
      this.#instancePromise = null;
    }
  }

  static async applyI18nConfig() {
    const region = ytcr.getConfigValue('region');
    const language = ytcr.getConfigValue('language');
    if (this.#instancePromise) {
      const instance = await this.#instancePromise;
      instance.setLocale({ region, language });
    }
  }
}
