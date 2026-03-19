// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import vconf from 'v-conf';

import ytmusic from './lib/YTMusicContext';
import BrowseController from './lib/controller/browse/BrowseController';
import SearchController, { type SearchQuery } from './lib/controller/search/SearchController';
import PlayController from './lib/controller/play/PlayController';
import { jsPromiseToKew, kewToJSPromise } from './lib/util';
import Model, { ModelType } from './lib/model';
import { type I18nOptionValue, type I18nOptions } from './lib/types/PluginConfig';
import { type QueueItem } from './lib/controller/browse/view-handlers/ExplodableViewHandler';
import ViewHelper from './lib/controller/browse/view-handlers/ViewHelper';
import InnertubeLoader from './lib/model/InnertubeLoader';
import YTMusicNowPlayingMetadataProvider from './lib/util/YTMusicNowPlayingMetadataProvider';
import { type NowPlayingPluginSupport } from 'now-playing-common';
import { Parser } from 'volumio-yt-support/dist/innertube';
import { existsSync, readFileSync } from 'fs';
import UIConfigHelper from './config/UIConfigHelper';
import { YtDlpWrapper } from './lib/util/YtDlp';

interface GotoParams extends QueueItem {
  type: 'album' | 'artist';
}

class ControllerYTMusic implements NowPlayingPluginSupport {
  #context: any;
  #config: any;
  #commandRouter: any;

  #browseController: BrowseController | null = null;
  #searchController: SearchController | null = null;
  #playController: PlayController | null = null;

  #nowPlayingMetadataProvider: YTMusicNowPlayingMetadataProvider | null = null;

  constructor(context: any) {
    this.#context = context;
    this.#commandRouter = context.coreCommand;
  }

  getUIConfig() {
    return jsPromiseToKew(this.#doGetUIConfig()).fail((error: any) => {
      ytmusic
        .getLogger()
        .error(`[ytmusic] getUIConfig(): Cannot populate configuration - ${error}`);
      throw error;
    });
  }


  async #doGetUIConfig() {
    const hasAcceptedDisclaimer = ytmusic.getConfigValue('hasAcceptedDisclaimer');
    const langCode = this.#commandRouter.sharedVars.get('language_code');
    const _uiconf = await kewToJSPromise(
      this.#commandRouter.i18nJson(
        `${__dirname}/i18n/strings_${langCode}.json`,
        `${__dirname}/i18n/strings_en.json`,
        `${__dirname}/UIConfig.json`
      )
    );
    const i18nOptions = hasAcceptedDisclaimer ? await this.#getConfigI18nOptions() : null;
    const account = hasAcceptedDisclaimer ? await this.#getConfigAccountInfo() : null;
    const uiconf = UIConfigHelper.observe(_uiconf);

    const disclaimerUIConf = uiconf.section_disclaimer;
    const i18nUIConf = uiconf.section_i18n;
    const accountUIConf = uiconf.section_account;
    const browseUIConf = uiconf.section_browse;
    const playbackUIConf = uiconf.section_playback;
    const ytDlpUIConf = uiconf.section_yt_dlp;

    // Disclaimer
    disclaimerUIConf.content.hasAcceptedDisclaimer.value = hasAcceptedDisclaimer;

    if (!hasAcceptedDisclaimer) {
      // hasAcceptedDisclaimer is false
      uiconf.sections = [ disclaimerUIConf ];
      return uiconf;
    }

    // I18n
    // -- region
    i18nUIConf.content.region.label = i18nOptions!.options.region.label;
    i18nUIConf.content.region.options = i18nOptions!.options.region.optionValues;
    i18nUIConf.content.region.value = i18nOptions!.selected.region;
    i18nUIConf.content.language.label = i18nOptions!.options.language.label;
    i18nUIConf.content.language.options = i18nOptions!.options.language.optionValues;
    i18nUIConf.content.language.value = i18nOptions!.selected.language;

    // Account
    const cookie = ytmusic.getConfigValue('cookie');
    let authStatusDescription;
    if (!account?.isSignedIn || !account.active || account.list.length <= 1) {
        accountUIConf.content.activeChannelHandle.hidden = true;
    }
    if (account?.isSignedIn && account.active) {
      authStatusDescription = ytmusic.getI18n('YTMUSIC_AUTH_STATUS_SIGNED_IN_AS', account.active.name);
      if (account.list.length > 1) {
        accountUIConf.content.activeChannelHandle.value ={
          label: account.active.name,
          value: account.active.handle
        };
        accountUIConf.content.activeChannelHandle.options = account.list.map((ac) => ({
          label: ac.name,
          value: ac.handle
        }));
        (accountUIConf.saveButton!.data as string[]).push('activeChannelHandle');
      }
    }
    else if (cookie) {
      authStatusDescription = ytmusic.getI18n('YTMUSIC_AUTH_STATUS_SIGNED_OUT');
    }
    accountUIConf.description = authStatusDescription;
    accountUIConf.content.cookie.value = cookie;

    // Browse
    const loadFullPlaylists = ytmusic.getConfigValue('loadFullPlaylists');
    browseUIConf.content.loadFullPlaylists.value = loadFullPlaylists;

    // Playback
    const autoplay = ytmusic.getConfigValue('autoplay');
    const autoplayClearQueue = ytmusic.getConfigValue('autoplayClearQueue');
    const addToHistory = ytmusic.getConfigValue('addToHistory');
    const prefetchEnabled = ytmusic.getConfigValue('prefetch');
    const preferOpus = ytmusic.getConfigValue('preferOpus');
    playbackUIConf.content.autoplay.value = autoplay;
    playbackUIConf.content.autoplayClearQueue.value = autoplayClearQueue;
    playbackUIConf.content.addToHistory.value = addToHistory;
    playbackUIConf.content.prefetch.value = prefetchEnabled;
    playbackUIConf.content.preferOpus.value = preferOpus;


    // yt-dlp
    ytDlpUIConf.content.useYtDlp.value = ytmusic.getConfigValue('useYtDlp');
    const ytDlpVersion = ytmusic.getConfigValue('ytDlpVersion');
    const ytDlp = YtDlpWrapper.getInstance();
    const installedYDlpVersions = ytDlp.getInstalled();
    const ytDlpVersionOptions = installedYDlpVersions.length > 0 ? installedYDlpVersions.map(({version}, i) => ({
      label: i === 0 ? ytmusic.getI18n('YTMUSIC_VERSION_LATEST', version) : version,
      value: version
    })) : [{
      label: ytmusic.getI18n('YTMUSIC_NONE_INSTALLED'),
      value: ''
    }];
    const selectedYtDlpVersionOption = (ytDlpVersion && ytDlpVersionOptions.length > 1 ? ytDlpVersionOptions.find(({value}) => value === ytDlpVersion) : null) || ytDlpVersionOptions[0];
    ytDlpUIConf.content.ytDlpVersion.options = ytDlpVersionOptions;
    ytDlpUIConf.content.ytDlpVersion.value = selectedYtDlpVersionOption;
    let latestAvailable;
    try {
      latestAvailable = await ytDlp.getLatestVersion();
    }
    catch (error: unknown) {
      ytmusic.getLogger().error(ytmusic.getErrorMessage('[ytmusic] Failed to get latest yt-dlp version:', error));
      ytmusic.toast('error', ytmusic.getI18n('YTMUSIC_ERR_GET_LATEST_YT_DLP_VER'));
      latestAvailable = null;
    }
    const latestInstalled = installedYDlpVersions[0]?.version || null;
    if (latestInstalled && latestAvailable && (new Date(latestAvailable).getTime() - new Date(latestInstalled).getTime() > 0)) {
      ytDlpUIConf.description = ytmusic.getI18n('YTMUSIC_YT_DLP_NEWER_AVAIL', latestAvailable);
    }
    if (!latestAvailable || latestInstalled === latestAvailable) {
      ytDlpUIConf.content.installLatestYtDlp.hidden = true;
    }

    return uiconf;
  }

  onVolumioStart() {
    const configFile = this.#commandRouter.pluginManager.getConfigurationFile(this.#context, 'config.json');
    this.#config = new vconf();
    this.#config.loadFile(configFile);
    return libQ.resolve();
  }

  onStart() {
    ytmusic.init(this.#context, this.#config);

    this.#browseController = new BrowseController();
    this.#searchController = new SearchController();
    this.#playController = new PlayController();

    this.#nowPlayingMetadataProvider = new YTMusicNowPlayingMetadataProvider();
    Parser.setParserErrorHandler(() => null); // Disable Innertube parser error reporting
    
    this.#addToBrowseSources();

    return libQ.resolve();
  }

  onStop() {
    this.#commandRouter.volumioRemoveToBrowseSources('YouTube Music');

    this.#playController?.reset();

    this.#browseController = null;
    this.#searchController = null;
    this.#playController = null;

    this.#nowPlayingMetadataProvider = null;

    return jsPromiseToKew(
      InnertubeLoader.reset()
        .then(() => ytmusic.reset())
      );
  }

  getConfigurationFiles() {
    return [ 'config.json' ];
  }

  async #getConfigI18nOptions() {
    const model = Model.getInstance(ModelType.Config);
    const selected: Record<keyof I18nOptions, I18nOptionValue> = {
      region: { label: '', value: '' },
      language: { label: '', value: '' }
    };
    try {
      const options = await model.getI18nOptions();
      const selectedValues = {
        region: ytmusic.getConfigValue('region'),
        language: ytmusic.getConfigValue('language')
      };
      
      (Object.keys(selected) as (keyof I18nOptions)[]).forEach((key) => {
        selected[key] = options[key]?.optionValues.find((ov) => ov.value === selectedValues[key]) || { label: '', value: selectedValues[key] };
      });

      return {
        options,
        selected
      };
    }
    catch (error: unknown) {
      ytmusic.getLogger().error(ytmusic.getErrorMessage('[ytmusic] Error getting i18n options:', error));
      ytmusic.toast('warning', 'Could not obtain i18n options');
      return {
        options: model.getDefaultI18nOptions(),
        selected
      };
    }
  }

  async #getConfigAccountInfo() {
    const model = Model.getInstance(ModelType.Account);
    try {
      return await model.getInfo();
    }
    catch (error: unknown) {
      ytmusic.getLogger().warn(ytmusic.getErrorMessage('[ytmusic] Failed to get account config:', error));
      return null;
    }
  }

  showDisclaimer() {
    const langCode = this.#commandRouter.sharedVars.get('language_code');
    let disclaimerFile = `${__dirname}/i18n/disclaimer_${langCode}.html`;
    if (!existsSync(disclaimerFile)) {
      disclaimerFile = `${__dirname}/i18n/disclaimer_en.html`;
    }
    try {
      const contents = readFileSync(disclaimerFile, { encoding: 'utf8' });
      const modalData = {
        title: ytmusic.getI18n('YTMUSIC_DISCLAIMER_HEADING'),
        message: contents,
        size: 'lg',
        buttons: [
          {
            name: ytmusic.getI18n('YTMUSIC_CLOSE'),
            class: 'btn btn-warning'
          },
          {
            name: ytmusic.getI18n('YTMUSIC_ACCEPT'),
            class: 'btn btn-info',
            emit: 'callMethod',
            payload: {
              type: 'controller',
              endpoint: 'music_service/ytmusic',
              method:'acceptDisclaimer',
              data: ''
            } 
          }
        ]
      };
      ytmusic.volumioCoreCommand.broadcastMessage("openModal", modalData);
    }
    catch (error) {
      ytmusic.getLogger().error(`[ytmusic] ${ytmusic.getErrorMessage(`Error reading "${disclaimerFile}"`, error, false)}`)
      ytmusic.toast('error', 'Error loading disclaimer contents');
    }
  }

  acceptDisclaimer() {
    this.configSaveDisclaimer({
      hasAcceptedDisclaimer: true
    });
  }

  configSaveDisclaimer(data: any) {
    ytmusic.setConfigValue('hasAcceptedDisclaimer', data.hasAcceptedDisclaimer);
    ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_SETTINGS_SAVED'));
    ytmusic.refreshUIConfig();
  }

  async configSaveI18n(data: any) {
    const oldRegion = ytmusic.hasConfigKey('region') ? ytmusic.getConfigValue('region') : null;
    const oldLanguage = ytmusic.hasConfigKey('language') ? ytmusic.getConfigValue('language') : null;
    const region = data.region.value;
    const language = data.language.value;

    if (oldRegion !== region || oldLanguage !== language) {
      ytmusic.setConfigValue('region', region);
      ytmusic.setConfigValue('language', language);

      await InnertubeLoader.applyI18nConfig();
      Model.getInstance(ModelType.Config).clearCache();
      ytmusic.refreshUIConfig();
    }

    ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_SETTINGS_SAVED'));
  }

  async configSaveAccount(data: any) {
    const oldCookie = ytmusic.hasConfigKey('cookie') ? ytmusic.getConfigValue('cookie') : null;
    const cookie = data.cookie?.trim();
    const oldActiveChannelHandle = ytmusic.getConfigValue('activeChannelHandle');
    const activeChannelHandle = data.activeChannelHandle?.value || '';
    let resetInnertube = false;
    if (oldCookie !== cookie) {
      ytmusic.setConfigValue('cookie', cookie);
      ytmusic.deleteConfigValue('activeChannelHandle');
      resetInnertube = true;
    }
    else if (oldActiveChannelHandle !== activeChannelHandle) {
      ytmusic.setConfigValue('activeChannelHandle', activeChannelHandle);
      resetInnertube =  true;
    }
    YtDlpWrapper.refresh();
    ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_SETTINGS_SAVED'));
    if (resetInnertube) {
      await InnertubeLoader.reset();
      ytmusic.refreshUIConfig();
    }
  }

  configSaveBrowse(data: any) {
    ytmusic.setConfigValue('loadFullPlaylists', data.loadFullPlaylists);

    ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_SETTINGS_SAVED'));
  }

  configSavePlayback(data: any) {
    ytmusic.setConfigValue('autoplay', data.autoplay);
    ytmusic.setConfigValue('autoplayClearQueue', data.autoplayClearQueue);
    ytmusic.setConfigValue('addToHistory', data.addToHistory);
    ytmusic.setConfigValue('prefetch', data.prefetch);
    ytmusic.setConfigValue('preferOpus', data.preferOpus);

    ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_SETTINGS_SAVED'));
  }


  configSaveYtDlp(data: any) {
    const useYtDlp = data.useYtDlp;
    if (useYtDlp) {
      const installed = YtDlpWrapper.getInstance().getInstalled();
      if (installed.length === 0) {
        ytmusic.toast('error', ytmusic.getI18n('YTMUSIC_ERR_USE_YT_DLP_BUT_NONE_INSTALLED'));
        ytmusic.setConfigValue('useYtDlp', false);
        return ytmusic.refreshUIConfig();
      }
    }
    ytmusic.setConfigValue('useYtDlp', useYtDlp);
    const ytDlpVersion = data.ytDlpVersion.value || null;
    ytmusic.setConfigValue('ytDlpVersion', ytDlpVersion);
    ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_SETTINGS_SAVED'));
  }

  async installLatestYtDlp() {
    const ytDlp = YtDlpWrapper.getInstance();
    ytmusic.toast('info', ytmusic.getI18n('YTMUSIC_YT_DLP_INSTALLING'));
    try {
      const result = await ytDlp.install();
      ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_YT_DLP_INSTALLED', result.version));
      ytmusic.setConfigValue('ytDlpVersion', result.version);
      ytmusic.refreshUIConfig();
    }
    catch (error: unknown) {
      ytmusic.getLogger().log('error', ytmusic.getErrorMessage('Error installing yt-dlp:', error));
      ytmusic.toast('error', ytmusic.getErrorMessage('Failed to install yt-dlp:', error, false));
    }
  }

  #addToBrowseSources() {
    const source = {
      name: 'YouTube Music',
      uri: 'ytmusic',
      plugin_type: 'music_service',
      plugin_name: 'ytmusic',
      albumart: '/albumart?sourceicon=music_service/ytmusic/dist/assets/images/ytmusic-mono-s.png'
    };
    this.#commandRouter.volumioAddToBrowseSources(source);
  }

  handleBrowseUri(uri: string) {
    if (!this.#browseController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    if (!ytmusic.getConfigValue('hasAcceptedDisclaimer')) {
      return libQ.reject({
        errorMessage: ytmusic.getI18n('YTMUSIC_ERR_ACCEPT_DISCLAIMER_BROWSE')
      });
    }
    return jsPromiseToKew(this.#browseController.browseUri(uri));
  }

  explodeUri(uri: string) {
    if (!this.#browseController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    if (!ytmusic.getConfigValue('hasAcceptedDisclaimer')) {
      ytmusic.toast('error', ytmusic.getI18n('YTMUSIC_ERR_ACCEPT_DISCLAIMER_PLAY'));
      return libQ.reject(ytmusic.getI18n('YTMUSIC_ERR_ACCEPT_DISCLAIMER_PLAY'));
    }
    return jsPromiseToKew(this.#browseController.explodeUri(uri));
  }

  clearAddPlayTrack(track: any) {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return jsPromiseToKew(this.#playController.clearAddPlayTrack(track));
  }

  stop() {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return this.#playController.stop();
  }

  pause() {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return this.#playController.pause();
  }

  resume() {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return this.#playController.resume();
  }

  seek(position: number) {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return this.#playController.seek(position);
  }

  next() {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return this.#playController.next();
  }

  previous() {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return this.#playController.previous();
  }

  search(query: SearchQuery) {
    if (!this.#searchController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return jsPromiseToKew(this.#searchController.search(query));
  }

  prefetch(track: QueueItem) {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }
    return jsPromiseToKew(this.#playController.prefetch(track));
  }

  goto(data: GotoParams) {
    if (!this.#playController) {
      return libQ.reject('YouTube Music plugin is not started');
    }

    const defer = libQ.defer();

    this.#playController.getGotoUri(data.type, data.uri).then((uri) => {
      if (uri) {
        if (!this.#browseController) {
          return libQ.reject('YouTube Music plugin is not started');
        }
        defer.resolve(this.#browseController.browseUri(uri));
      }
      else {
        const view = ViewHelper.getViewsFromUri(data.uri)?.[1];
        const trackData = view?.explodeTrackData || null;
        const trackTitle = trackData?.title;
        let errMsg;
        if (data.type === 'album') {
          errMsg = trackTitle ? ytmusic.getI18n('YTMUSIC_ERR_GOTO_ALBUM_NOT_FOUND_FOR', trackTitle) :
            ytmusic.getI18n('YTMUSIC_ERR_GOTO_ALBUM_NOT_FOUND');
        }
        else if (data.type === 'artist') {
          errMsg = trackTitle ? ytmusic.getI18n('YTMUSIC_ERR_GOTO_ARTIST_NOT_FOUND_FOR', trackTitle) :
            ytmusic.getI18n('YTMUSIC_ERR_GOTO_ARTIST_NOT_FOUND');
        }
        else {
          errMsg = ytmusic.getI18n('YTMUSIC_ERR_GOTO_UNKNOWN_TYPE', data.type);
        }

        ytmusic.toast('error', errMsg);
        defer.reject(Error(errMsg));
      }
    })
    .catch((error: unknown) => {
      ytmusic.getLogger().error(ytmusic.getErrorMessage('[ytmusic] Error obtaining goto URL:', error));
    });

    return defer.promise;
  }

  getNowPlayingMetadataProvider() {
    return this.#nowPlayingMetadataProvider;
  }
}

export = ControllerYTMusic;
