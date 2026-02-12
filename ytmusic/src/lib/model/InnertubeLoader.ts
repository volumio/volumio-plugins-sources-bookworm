import ytmusic from '../YTMusicContext';
import { InnertubeFactory, type InnertubeWrapper, type PotFnResult } from 'volumio-yt-support';

export default class InnertubeLoader {

  static #instancePromise: Promise<InnertubeWrapper> | null = null;

  static async getInstance(): Promise<InnertubeWrapper> {
    if (!this.#instancePromise) {
      ytmusic.toast('info', ytmusic.getI18n('YTMUSIC_PREPPING_API'));
      this.#instancePromise = InnertubeFactory.getWrappedInstance({
        account: {
          cookie: ytmusic.getConfigValue('cookie') || undefined,
          activeChannelHandle: ytmusic.getConfigValue('activeChannelHandle')
        },
        locale: {
          region: ytmusic.getConfigValue('region'),
          language: ytmusic.getConfigValue('language')
        },
        logger: {
          info: (msg) => ytmusic.getLogger().info(`[ytmusic] ${msg}`),
          warn: (msg) => ytmusic.getLogger().warn(`[ytmusic] ${msg}`),
          error: (msg) => ytmusic.getLogger().error(`[ytmusic] ${msg}`),
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
    const region = ytmusic.getConfigValue('region');
    const language = ytmusic.getConfigValue('language');
    if (this.#instancePromise) {
      const instance = await this.#instancePromise;
      instance.setLocale({ region, language });
    }
  }
}
