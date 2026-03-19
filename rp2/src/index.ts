// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import vconf from 'v-conf';

import rp2 from './lib/RP2Context';
import { PlayController } from './lib/playback/PlayController';
import { jsPromiseToKew, kewToJSPromise } from './lib/util';
import UIConfigHelper from './lib/config/UIConfigHelper';
import { getAudioQualityOptions } from './lib/config/plugin-config';
import { getPage } from './lib/browse';
import { getQueueItems } from './lib/playback/queue';
import { RP2NowPlayingMetadataProvider } from './lib/playback/RP2NowPlayingMetadataProvider';

const SERVICE_NAME = 'Radio Paradise (RP2)';

class ControllerRP2 {
  #context: any;
  #config: any;
  #commandRouter: any;

  #playController: PlayController | null = null;
  #nowPlayingMetadataProvider: RP2NowPlayingMetadataProvider | null = null;

  constructor(context: any) {
    this.#context = context;
    this.#commandRouter = context.coreCommand;
  }

  getUIConfig() {
    return jsPromiseToKew(this.#doGetUIConfig()).fail((error: any) => {
      rp2
        .getLogger()
        .error(`[rp2] getUIConfig(): Cannot populate configuration - ${error}`);
      throw error;
    });
  }

  async #doGetUIConfig() {
    const langCode = this.#commandRouter.sharedVars.get('language_code');
    const _uiconf = await kewToJSPromise(
      this.#commandRouter.i18nJson(
        `${__dirname}/i18n/strings_${langCode}.json`,
        `${__dirname}/i18n/strings_en.json`,
        `${__dirname}/UIConfig.json`
      )
    );
    const uiconf = UIConfigHelper.observe(_uiconf);

    const generalUIConf = uiconf.section_general;
    const audioQuality = rp2.getConfigValue('audioQuality');
    const audioQualityOptions = getAudioQualityOptions();
    generalUIConf.content.audioQuality.options = audioQualityOptions;
    generalUIConf.content.audioQuality.value = audioQualityOptions.find(
      ({ value }) => audioQuality === value
    ) || {
      label: '',
      value: ''
    };
    generalUIConf.content.persistSession.value =
      rp2.getConfigValue('persistSession');
    generalUIConf.content.showChannel.value =
      rp2.getConfigValue('showChannel');

    return uiconf;
  }

  async configSaveGeneralSettings(data: any) {
    rp2.setConfigValue('persistSession', !!data['persistSession']);
    rp2.setConfigValue('showChannel', !!data['showChannel']);
    const audioQuality = data['audioQuality']?.value;
    if (audioQuality) {
      rp2.setConfigValue('audioQuality', audioQuality);
      await rp2.getRpjsLib().setQuality(audioQuality);
    }
    rp2.toast('success', rp2.getI18n('RP2_SETTINGS_SAVED'));
  }

  onVolumioStart() {
    const configFile = this.#commandRouter.pluginManager.getConfigurationFile(
      this.#context,
      'config.json'
    );
    this.#config = new vconf();
    this.#config.loadFile(configFile);
    return libQ.resolve();
  }

  onStart() {
    rp2.init(this.#context, this.#config);
    this.#playController = new PlayController();
    this.#nowPlayingMetadataProvider = new RP2NowPlayingMetadataProvider();
    this.#addToBrowseSources();
    return libQ.resolve();
  }

  onStop() {
    this.#commandRouter.volumioRemoveToBrowseSources(SERVICE_NAME);
    this.#playController = null;
    this.#nowPlayingMetadataProvider = null;
    return jsPromiseToKew(
      (async () => {
        //await this.#playController?.reset();
        await rp2.reset();
      })()
    );
  }

  getConfigurationFiles() {
    return ['config.json'];
  }

  #addToBrowseSources() {
    const source = {
      name: SERVICE_NAME,
      uri: 'rp2',
      plugin_type: 'music_service',
      plugin_name: 'rp2',
      albumart:
        '/albumart?sourceicon=music_service/rp2/dist/assets/images/rp.png'
    };
    this.#commandRouter.volumioAddToBrowseSources(source);
  }

  handleBrowseUri(uri: string) {
    return jsPromiseToKew(getPage(uri));
  }

  explodeUri(uri: string) {
    return jsPromiseToKew(getQueueItems(uri));
  }

  clearAddPlayTrack(track: any) {
    if (!this.#playController) {
      return libQ.reject('RP2 plugin is not started');
    }
    return jsPromiseToKew(this.#playController.clearAddPlayTrack(track));
  }

  stop() {
    if (!this.#playController) {
      return libQ.reject('RP2 plugin is not started');
    }
    return jsPromiseToKew(this.#playController.stop());
  }

  pause() {
    if (!this.#playController) {
      return libQ.reject('RP2 plugin is not started');
    }
    return jsPromiseToKew(this.#playController.pause());
  }

  resume() {
    if (!this.#playController) {
      return libQ.reject('RP2 plugin is not started');
    }
    return jsPromiseToKew(this.#playController.resume());
  }

  play() {
    if (!this.#playController) {
      return libQ.reject('RP2 plugin is not started');
    }
    return jsPromiseToKew(this.#playController.play());
  }

  seek(position: number) {
    if (!this.#playController) {
      return libQ.reject('RP2 plugin is not started');
    }
    return jsPromiseToKew(this.#playController.seek(position));
  }

  next() {
    if (!this.#playController) {
      return libQ.reject('RP2 plugin is not started');
    }
    return jsPromiseToKew(this.#playController.next());
  }

  previous() {
    if (!this.#playController) {
      return libQ.reject('RP2 plugin is not started');
    }
    return jsPromiseToKew(this.#playController.previous());
  }

  #handleUnsupportedOp() {
    rp2.toast('error', rp2.getI18n('RP2_ERR_OP_NOT_SUPPORTED'));
    return jsPromiseToKew(
      Promise.reject(Error(rp2.getI18n('RP2_ERR_OP_NOT_SUPPORTED')))
    );
  }

  random() {
    return this.#handleUnsupportedOp();
  }

  repeat() {
    return this.#handleUnsupportedOp();
  }

  addToFavourites() {
    return this.#handleUnsupportedOp();
  }

  getNowPlayingMetadataProvider() {
    return this.#nowPlayingMetadataProvider;
  }
}

export = ControllerRP2;
