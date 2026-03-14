// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import vconf from 'v-conf';

import sc from './lib/SoundCloudContext';
import BrowseController from './lib/controller/browse/BrowseController';
import SearchController, { type SearchQuery } from './lib/controller/search/SearchController';
import PlayController from './lib/controller/play/PlayController';
import { jsPromiseToKew, kewToJSPromise } from './lib/util/Misc';
import { type QueueItem } from './lib/controller/browse/view-handlers/ExplodableViewHandler';
import locales from './assets/locales.json';
import Model from './lib/model';
import UIConfigHelper from './lib/config/UIConfigHelper';

interface GotoParams extends QueueItem {
  type: 'album' | 'artist';
}

class ControllerSoundCloud {
  #context: any;
  #config: any;
  #commandRouter: any;

  #browseController: BrowseController | null;
  #searchController: SearchController | null;
  #playController: PlayController | null;

  constructor(context: any) {
    this.#context = context;
    this.#commandRouter = context.coreCommand;
  }

  getUIConfig() {
    return jsPromiseToKew(this.#doGetUIConfig())
      .fail((error: any) => {
        sc.getLogger().error(`[soundcloud] getUIConfig(): Cannot populate configuration - ${error}`);
        throw error;
      });
  }

  async #doGetUIConfig() {
    const langCode = this.#commandRouter.sharedVars.get('language_code');
    const _uiconf = await kewToJSPromise(this.#commandRouter.i18nJson(
      `${__dirname}/i18n/strings_${langCode}.json`,
      `${__dirname}/i18n/strings_en.json`,
      `${__dirname}/UIConfig.json`)) ;
    const uiconf = UIConfigHelper.observe(_uiconf);

    const generalUIConf = uiconf.section_general;
    const playbackConf = uiconf.section_playback;
    const cacheUIConf = uiconf.section_cache;

    // General
    const localeOptions = this.#configGetLocaleOptions();
    const credentialsType = sc.getConfigValue('credentialsType');
    const accessToken = sc.getConfigValue('accessToken');
    const cookie = sc.getConfigValue('cookie');
    generalUIConf.content.credentialsType.value = {
      value: credentialsType,
      label: credentialsType === 'accessToken' ? sc.getI18n('SOUNDCLOUD_ACCESS_TOKEN') : sc.getI18n('SOUNDCLOUD_COOKIE')
    };
    generalUIConf.content.accessToken.value = accessToken;
    generalUIConf.content.cookie.value = cookie;
    generalUIConf.content.locale.value = localeOptions.selected;
    generalUIConf.content.locale.options = localeOptions.options;
    generalUIConf.content.itemsPerPage.value = sc.getConfigValue('itemsPerPage');
    generalUIConf.content.itemsPerSection.value = sc.getConfigValue('itemsPerSection');
    generalUIConf.content.combinedSearchResults.value = sc.getConfigValue('combinedSearchResults');
    generalUIConf.content.loadFullPlaylistAlbum.value = sc.getConfigValue('loadFullPlaylistAlbum');

    // Playback
    playbackConf.content.skipPreviewTracks.value = sc.getConfigValue('skipPreviewTracks');
    playbackConf.content.addPlayedToHistory.value = sc.getConfigValue('addPlayedToHistory');
    playbackConf.content.addPlayedToHistory.hidden = credentialsType === 'accessToken' || !cookie;
    // Soundcloud-testing
    playbackConf.content.logTranscodings.value = sc.getConfigValue('logTranscodings');

    // Cache
    const cacheMaxEntries = sc.getConfigValue('cacheMaxEntries');
    const cacheTTL = sc.getConfigValue('cacheTTL');
    const cacheEntryCount = sc.getCache().getEntryCount();
    cacheUIConf.content.cacheMaxEntries.value = cacheMaxEntries;
    cacheUIConf.content.cacheTTL.value = cacheTTL;
    cacheUIConf.description = cacheEntryCount > 0 ?
      sc.getI18n('SOUNDCLOUD_CACHE_STATS', cacheEntryCount, Math.round(sc.getCache().getMemoryUsageInKB()).toLocaleString())
      : sc.getI18n('SOUNDCLOUD_CACHE_EMPTY');

    return uiconf;
  }

  configSaveGeneralSettings(data: any) {
    const itemsPerPage = parseInt(data['itemsPerPage'], 10);
    const itemsPerSection = parseInt(data['itemsPerSection'], 10);
    const combinedSearchResults = parseInt(data['combinedSearchResults'], 10);
    if (!itemsPerPage) {
      sc.toast('error', sc.getI18n('SOUNDCLOUD_SETTINGS_ERR_ITEMS_PER_PAGE'));
      return;
    }
    if (!itemsPerSection) {
      sc.toast('error', sc.getI18n('SOUNDCLOUD_SETTINGS_ERR_ITEMS_PER_SECTION'));
      return;
    }
    if (!combinedSearchResults) {
      sc.toast('error', sc.getI18n('SOUNDCLOUD_SETTINGS_ERR_COMBINED_SEARCH_RESULTS'));
      return;
    }

    const oldCredentialsType = sc.getConfigValue('credentialsType');
    const newCredentialsType = data['credentialsType'].value;
    const oldAccessToken = sc.getConfigValue('accessToken');
    const newAccessToken = data['accessToken'].trim();
    const oldCookie = sc.getConfigValue('cookie');
    const newCookie = data['cookie'].trim();
    const oldLocale = sc.getConfigValue('locale');
    const newLocale = data['locale'].value;
    const credentialsTypeChanged = oldCredentialsType !== newCredentialsType;
    const accessTokenChanged = oldAccessToken !== newAccessToken;
    const cookieChanged = oldCookie !== newCookie;
    const localeChanged = oldLocale !== newLocale;

    sc.setConfigValue('credentialsType', newCredentialsType);
    sc.setConfigValue('accessToken', newAccessToken);
    sc.setConfigValue('cookie', newCookie);
    sc.setConfigValue('locale', newLocale);
    sc.setConfigValue('itemsPerPage', itemsPerPage);
    sc.setConfigValue('itemsPerSection', itemsPerSection);
    sc.setConfigValue('combinedSearchResults', combinedSearchResults);
    sc.setConfigValue('loadFullPlaylistAlbum', !!data['loadFullPlaylistAlbum']);

    if (credentialsTypeChanged ||
      (oldCredentialsType === 'accessToken' && accessTokenChanged) ||
      (oldCredentialsType === 'cookie' && cookieChanged) ||
      localeChanged
    ) {
      sc.getCache().clear();
    }

    if (localeChanged) {
      Model.setLocale(newLocale);
    }

    if (newCredentialsType === 'accessToken' && (credentialsTypeChanged || accessTokenChanged)) {
      Model.setAccessToken(newAccessToken);
      sc.refreshUIConfig();
    }
    else if (newCredentialsType === 'cookie' && (credentialsTypeChanged || cookieChanged)) {
      Model.setCookie(newCookie);
      sc.refreshUIConfig();
    }

    sc.toast('success', sc.getI18n('SOUNDCLOUD_SETTINGS_SAVED'));
  }

  configSaveCacheSettings(data: any) {
    const cacheMaxEntries = parseInt(data['cacheMaxEntries'], 10);
    const cacheTTL = parseInt(data['cacheTTL'], 10);
    if (cacheMaxEntries < 1000) {
      sc.toast('error', sc.getI18n('SOUNDCLOUD_SETTINGS_ERR_CACHE_MAX_ENTRIES'));
      return;
    }
    if (cacheTTL < 600) {
      sc.toast('error', sc.getI18n('SOUNDCLOUD_SETTINGS_ERR_CACHE_TTL'));
      return;
    }

    sc.setConfigValue('cacheMaxEntries', cacheMaxEntries);
    sc.setConfigValue('cacheTTL', cacheTTL);

    sc.getCache().setMaxEntries(cacheMaxEntries);
    sc.getCache().setTTL(cacheTTL);

    sc.toast('success', sc.getI18n('SOUNDCLOUD_SETTINGS_SAVED'));
    sc.refreshUIConfig();
  }

  configSavePlaybackSettings(data: any) {
    sc.setConfigValue('skipPreviewTracks', !!data['skipPreviewTracks']);
    sc.setConfigValue('addPlayedToHistory', !!data['addPlayedToHistory']);

    // Soundcloud-testing
    sc.setConfigValue('logTranscodings', !!data['logTranscodings']);

    sc.toast('success', sc.getI18n('SOUNDCLOUD_SETTINGS_SAVED'));
  }

  configClearCache() {
    sc.getCache().clear();
    sc.toast('success', sc.getI18n('SOUNDCLOUD_CACHE_CLEARED'));
    sc.refreshUIConfig();
  }

  #configGetLocaleOptions() {
    const options = locales.map((data) => ({
      value: data.locale,
      label: data.name
    }));

    const configValue = sc.getConfigValue('locale');
    const selected = options.find((option) => option.value === configValue) || {
      value: '',
      label: ''
    };

    return {
      options,
      selected
    };
  }

  onVolumioStart() {
    const configFile = this.#commandRouter.pluginManager.getConfigurationFile(this.#context, 'config.json');
    this.#config = new vconf();
    this.#config.loadFile(configFile);
    return libQ.resolve();
  }

  onStart() {
    sc.init(this.#context, this.#config);

    this.#browseController = new BrowseController();
    this.#searchController = new SearchController();
    this.#playController = new PlayController();

    const credentialsType = sc.getConfigValue('credentialsType');
    switch (credentialsType) {
      case 'accessToken': {
        const accessToken = sc.getConfigValue('accessToken');
        if (accessToken) {
          Model.setAccessToken(accessToken);
        }
        break;
      }
      case 'cookie': {
        const cookie = sc.getConfigValue('cookie');
        if (cookie) {
          Model.setCookie(cookie);
        }
        break;
      }
    }

    Model.setLocale(sc.getConfigValue('locale'));

    this.#addToBrowseSources();

    return libQ.resolve();
  }

  onStop() {
    this.#commandRouter.volumioRemoveToBrowseSources('SoundCloud');

    return jsPromiseToKew((async ()=> {
      await this.#playController?.reset();
      this.#browseController = null;
      this.#searchController = null;
      this.#playController = null;
      sc.reset();
    })());
  }

  getConfigurationFiles() {
    return [ 'config.json' ];
  }

  #addToBrowseSources() {
    const source = {
      name: 'SoundCloud',
      uri: 'soundcloud',
      plugin_type: 'music_service',
      plugin_name: 'soundcloud',
      albumart: '/albumart?sourceicon=music_service/soundcloud/dist/assets/images/soundcloud.png'
    };
    this.#commandRouter.volumioAddToBrowseSources(source);
  }

  handleBrowseUri(uri: string) {
    if (!this.#browseController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return jsPromiseToKew(this.#browseController.browseUri(uri));
  }

  explodeUri(uri: string) {
    if (!this.#browseController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return jsPromiseToKew(this.#browseController.explodeUri(uri));
  }

  clearAddPlayTrack(track: any) {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return jsPromiseToKew(this.#playController.clearAddPlayTrack(track));
  }

  stop() {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.stop();
  }

  pause() {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.pause();
  }

  resume() {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.resume();
  }

  play() {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.play();
  }

  seek(position: number) {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.seek(position);
  }

  next() {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.next();
  }

  previous() {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.previous();
  }

  search(query: SearchQuery) {
    if (!this.#searchController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return jsPromiseToKew(this.#searchController.search(query));
  }

  random(value: boolean) {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.setRandom(value);
  }

  repeat(value: boolean, repeatSingle: boolean) {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }
    return this.#playController.setRepeat(value, repeatSingle);
  }

  goto(data: GotoParams) {
    if (!this.#playController) {
      return libQ.reject('SoundCloud plugin is not started');
    }

    const defer = libQ.defer();

    this.#playController.getGotoUri(data.type, data.uri).then((uri) => {
      if (uri) {
        if (!this.#browseController) {
          return libQ.reject('SoundCloud plugin is not started');
        }
        defer.resolve(this.#browseController.browseUri(uri));
      }
    })
    .catch((error: unknown) => {
      defer.reject(error);
    });

    return defer.promise;
  }
}

export = ControllerSoundCloud;
