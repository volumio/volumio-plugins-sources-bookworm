import ytmusic from '../YTMusicContext';
import Innertube from 'volumio-youtubei.js';
import BG, { type BgConfig } from 'bgutils-js';
import { JSDOM } from 'jsdom';
import { getAccountInitialInfo } from './AccountModelHelper';

export interface InnertubeLoaderGetInstanceResult {
  innertube: Innertube;
}

enum Stage {
  Init = '1 - Init',
  PO = '2 - PO'
}

interface POToken {
  params: {
    visitorData?: string;
    identifier: {
      type: 'visitorData' | 'datasyncIdToken';
      value: string;
      pageId?: string;
    };
  }
  value: string;
  ttl?: number;
  refreshThreshold?: number;
}

export default class InnertubeLoader {

  static #innertube: Innertube | null = null;
  static #pendingPromise: Promise<InnertubeLoaderGetInstanceResult> | null = null;
  static #poTokenRefreshTimer: NodeJS.Timeout | null = null;

  static async getInstance(): Promise<InnertubeLoaderGetInstanceResult> {
    if (this.#innertube) {
      return {
        innertube: this.#innertube,
      };
    }

    if (this.#pendingPromise) {
      return this.#pendingPromise;
    }

    this.#pendingPromise = new Promise<InnertubeLoaderGetInstanceResult>((resolve, reject) => {
      this.#createInstance(Stage.Init, resolve)
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : Error(String(error)))
        });
    });

    return this.#pendingPromise;
  }

  static async #recreateWithPOToken(innertube: Innertube, resolve: (value: InnertubeLoaderGetInstanceResult) => void, lastToken?: POToken) {
    const visitorData = lastToken?.params.visitorData || innertube.session.context.client.visitorData;
    let identifier: POToken['params']['identifier'] | null = visitorData ? {
      type: 'visitorData',
      value: visitorData
    } : null;

    const lastIdentifier = lastToken?.params.identifier;
    if (lastIdentifier) {
      identifier = lastIdentifier;
    }
    else {
      const account = await getAccountInitialInfo(innertube);
      if (account.isSignedIn) {
        const activeChannelHandle = ytmusic.getConfigValue('activeChannelHandle');
        let target;
        if (activeChannelHandle && account.list.length > 1) {
          target = account.list.find((ac) => ac.handle === activeChannelHandle);
          if (!target) {
            ytmusic.toast('warning', ytmusic.getI18n('YTMUSIC_ERR_UNKNOWN_CHANNEL_HANDLE', activeChannelHandle));
            target = account.active;
          }
        }
        else {
          target = account.active;
        }
        const pageId = target?.pageId || undefined;
        const datasyncIdToken = target?.datasyncIdToken || undefined;
        if (datasyncIdToken) {
          identifier = {
            type: 'datasyncIdToken',
            value: datasyncIdToken,
            pageId
          };
        }
        else {
          ytmusic.getLogger().warn('[ytmusic] InnertubeLoader: signed in but could not get datasyncIdToken for fetching po_token - will use visitorData instead');
        }
      }
    }
    let poTokenResult;
    if (identifier) {
      ytmusic.getLogger().info(`[ytmusic] InnertubeLoader: obtaining po_token by ${identifier.type}...`);
      try {
        poTokenResult = await this.#generatePoToken(identifier.value);
        ytmusic.getLogger().info(`[ytmusic] InnertubeLoader: obtained po_token (expires in ${poTokenResult.ttl} seconds)`);
      }
      catch (error: unknown) {
        ytmusic.getLogger().error(ytmusic.getErrorMessage('[ytmusic] InnertubeLoader: failed to get poToken: ', error, false));
      }
      if (poTokenResult) {
        ytmusic.getLogger().info(`[ytmusic] InnertubeLoader: re-create Innertube instance with po_token`);
        this.#createInstance(Stage.PO, resolve, {
          params: {
            visitorData,
            identifier
          },
          value: poTokenResult.token,
          ttl: poTokenResult.ttl,
          refreshThreshold: poTokenResult.refreshThreshold
        })
          .catch((error: unknown) => {
            ytmusic.getLogger().error(ytmusic.getErrorMessage(`[ytmusic] InnertubeLoader: error creating Innertube instance:`, error));
          });
        return;
      }
    }
    ytmusic.getLogger().warn('[ytmusic] InnertubeLoader: po_token was not used to create Innertube instance. Playback of YouTube content might fail.');
    this.#resolveGetInstanceResult(innertube, resolve);
  }

  static async #createInstance(stage: Stage.PO, resolve: (value: InnertubeLoaderGetInstanceResult) => void, poToken: POToken): Promise<void>;
  static async #createInstance(stage: Stage.Init, resolve: (value: InnertubeLoaderGetInstanceResult) => void, poToken?: undefined): Promise<void>;
  static async #createInstance(stage: Stage.Init | Stage.PO, resolve: (value: InnertubeLoaderGetInstanceResult) => void, poToken?: POToken) {
    const usedParams: string[] = [];
    if (poToken?.value) {
      usedParams.push('po_token');
    }
    if (poToken?.params.identifier.pageId) {
      usedParams.push('page_id');
    }
    const usedParamsStr = usedParams.length > 0 ? ` with ${usedParams.join(' + ')}` : '';
    ytmusic.getLogger().info(`[ytmusic] InnertubeLoader: creating Innertube instance${usedParamsStr}...`);
    const innertube = await Innertube.create({
      cookie: ytmusic.getConfigValue('cookie') || undefined,
      visitor_data: poToken?.params.visitorData,
      on_behalf_of_user: poToken?.params.identifier.pageId,
      po_token: poToken?.value
    });
    switch (stage) {
      case Stage.Init:
        await this.#recreateWithPOToken(innertube, resolve);
        break;
      case Stage.PO:
        this.#resolveGetInstanceResult(innertube, resolve, poToken);
        break;
    }
  }

  static reset() {
    this.#clearPOTokenRefreshTimer();
    if (this.#pendingPromise) {
      this.#pendingPromise = null;
    }
    this.#innertube = null;
  }

  static #clearPOTokenRefreshTimer() {
    if (this.#poTokenRefreshTimer) {
      clearTimeout(this.#poTokenRefreshTimer);
      this.#poTokenRefreshTimer = null;
    }
  }

  static hasInstance() {
    return !!this.#innertube;
  }

  static #resolveGetInstanceResult(innertube: Innertube, resolve: (value: InnertubeLoaderGetInstanceResult) => void, poToken?: POToken) {
    this.#pendingPromise = null;
    this.#innertube = innertube;
    this.applyI18nConfig();
    this.#clearPOTokenRefreshTimer();
    if (poToken) {
      const { ttl, refreshThreshold = 100 } = poToken;
      if (ttl) {
        const timeout = ttl - refreshThreshold;
        ytmusic.getLogger().info(`[ytmusic] InnertubeLoader: going to refresh po_token in ${timeout} seconds`);
        this.#poTokenRefreshTimer = setTimeout(() => this.#refreshPOToken(poToken), timeout * 1000);
      }
    }
    resolve({
      innertube,
    });
  }

  static #refreshPOToken(lastToken: POToken) {
    const innertube = this.#innertube;
    if (!innertube) {
      return;
    }
    this.reset();
    this.#pendingPromise = new Promise((resolve) => {
      ytmusic.getLogger().info('[ytmusic] InnertubeLoader: refresh po_token');
      this.#recreateWithPOToken(innertube, resolve, lastToken)
        .catch((error: unknown) => {
          ytmusic.getLogger().error(ytmusic.getErrorMessage(`[ytmusic] InnertubeLoader: error creating Innertube instance (while refreshing po_token):`, error));
        });
    });
  }

  static applyI18nConfig() {
    if (!this.#innertube) {
      return;
    }

    const region = ytmusic.getConfigValue('region');
    const language = ytmusic.getConfigValue('language');

    this.#innertube.session.context.client.gl = region;
    this.#innertube.session.context.client.hl = language;
  }

  /**
   * Required for initializing innertube, otherwise videos will return 403
   * Much of this taken from https://github.com/LuanRT/BgUtils/blob/main/examples/node/index.ts
   * @returns
   */
  static async #generatePoToken(identifier: string) {
    const requestKey = 'O43z0dpjhgX20SCx4KAo';
    const bgConfig: BgConfig = {
      fetch: (url, options) => fetch(url, options),
      globalObj: globalThis,
      identifier,
      requestKey
    };

    const dom = new JSDOM();
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document
    });

    const bgChallenge = await BG.Challenge.create(bgConfig);
    if (!bgChallenge) {
      throw new Error('Could not get challenge');
    }

    const interpreterJavascript = bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (interpreterJavascript) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function(interpreterJavascript)();
    }
    else throw new Error('Could not load VM');

    const poTokenResult = await BG.PoToken.generate({
      program: bgChallenge.program,
      globalName: bgChallenge.globalName,
      bgConfig
    });

    return {
      token: poTokenResult.poToken,
      ttl: poTokenResult.integrityTokenData.estimatedTtlSecs,
      refreshThreshold: poTokenResult.integrityTokenData.mintRefreshThreshold
    };
  }
}
