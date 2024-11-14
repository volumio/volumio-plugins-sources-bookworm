// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';

import js from './lib/LyrionContext';
import { jsPromiseToKew, kewToJSPromise } from './lib/Util';
import * as System from './lib/System';

class ControllerLyrion {
  #context: any;
  #commandRouter: any;
  #serverStatus: 'started' | 'stopped';

  constructor(context: any) {
    this.#context = context;
    this.#commandRouter = this.#context.coreCommand;
    this.#serverStatus = 'stopped';
  }

  getUIConfig() {
    return jsPromiseToKew(this.#doGetUIConfig())
      .fail((error: any) => {
        js.getLogger().error(`[lyrion] getUIConfig(): Cannot populate configuration - ${error}`);
        throw error;
      });
  }

  async #doGetUIConfig() {
    const langCode = this.#commandRouter.sharedVars.get('language_code');
    const uiconf = await kewToJSPromise(this.#commandRouter.i18nJson(
      `${__dirname}/i18n/strings_${langCode}.json`,
      `${__dirname}/i18n/strings_en.json`,
      `${__dirname}/UIConfig.json`));
    const status = await System.getServiceStatus();

    const infoSectionConf = uiconf.sections[0];

    // Info section
    switch (status) {
      case 'active':
        infoSectionConf.description = js.getI18n('LYRION_INFO_DESC_ACTIVE');
        break;
      case 'activating':
        infoSectionConf.description = js.getI18n('LYRION_INFO_DESC_ACTIVATING');
        break;
      default:
        infoSectionConf.description = js.getI18n('LYRION_INFO_DESC_INACTIVE');
    }

    if (status !== 'active') {
      const viewReadme = infoSectionConf.content[2];
      infoSectionConf.content = [ viewReadme ];
    }
    else {
      const thisDevice = js.getDeviceInfo();
      const host = thisDevice.host;
      const port = System.getServerPort();
      const url = `${host}:${port}`;
      infoSectionConf.content[0].value = url;
      infoSectionConf.content[1].onClick.url = url;
    }

    return uiconf;
  }

  onVolumioStart() {
    return libQ.resolve(true);
  }

  onStart() {
    const defer = libQ.defer();

    js.init(this.#context);

    js.toast('info', js.getI18n('LYRION_STARTING'));
    System.startService()
      .then(() => {
        js.toast('success', js.getI18n('LYRION_STARTED'));
        this.#serverStatus = 'started';
        defer.resolve();
      })
      .catch((e: unknown) => {
        js.toast('error', js.getI18n('LYRION_ERR_START', js.getErrorMessage('', e, false)));
        defer.reject(e);
      });

    return defer.promise;
  }

  onStop() {
    if (this.#serverStatus === 'stopped') {
      return libQ.resolve(true);
    }

    const defer = libQ.defer();

    js.toast('info', js.getI18n('LYRION_STOPPING'));
    System.stopService()
      .then(() => {
        js.toast('success', js.getI18n('LYRION_STOPPED'));
        this.#serverStatus = 'stopped';
        defer.resolve();
      })
      .catch((e: unknown) => {
        js.toast('error', js.getI18n('LYRION_ERR_STOP', js.getErrorMessage('', e, false)));
        // Do not reject, in case user is uninstalling a possibly broken installation - rejecting will abort the process.
        defer.resolve();
      });

    return defer.promise;
  }
}

export = ControllerLyrion;
