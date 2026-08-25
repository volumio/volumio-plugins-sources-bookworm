// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import vconf from 'v-conf';

import geoTZ from 'geo-tz';
import np from './lib/NowPlayingContext';
import { jsPromiseToKew, kewToJSPromise } from './lib/utils/Misc';
import * as App from './app';
import CommonSettingsLoader from './lib/config/CommonSettingsLoader';
import ConfigHelper from './lib/config/ConfigHelper';
import * as SystemUtils from './lib/utils/System';
import * as KioskUtils from './lib/utils/Kiosk';
import ConfigUpdater from './lib/config/ConfigUpdater';
import metadataAPI from './lib/api/MetadataAPI';
import { getWeatherAPI } from './lib/api/WeatherAPI';
import { CommonSettingsCategory, type LocalizationSettings, type NowPlayingScreenSettings, type PerformanceSettings, type ThemeSettings } from 'now-playing-common';
import UIConfigHelper from './lib/config/UIConfigHelper';
import ConfigBackupHelper from './lib/config/ConfigBackupHelper';
import myBackgroundMonitor from './lib/utils/MyBackgroundMonitor';
import { type MetadataServiceOptions } from './lib/config/PluginConfig';
import { HostMonitor } from './lib/utils/HostMonitor';
 
type DockedComponentKey<T = keyof NowPlayingScreenSettings> = T extends `docked${infer _X}` ? T : never;

class ControllerNowPlaying {
  #context: any;
  #config: any;
  #commandRouter: any;
  #volumioLanguageChangeCallback: (() => void) | null;
  // For DHCP networks, when plugin starts, there's no guarantee that the IP address 
  // has been obtained. Use HostMonitor to check periodically and refresh host-dependent
  // components on change.
  #hostMonitor: HostMonitor | null;

  constructor(context: any) {
    this.#context = context;
    this.#commandRouter = this.#context.coreCommand;
    this.#volumioLanguageChangeCallback = null;
    this.#hostMonitor = null;
  }

  getUIConfig() {
    return jsPromiseToKew(this.#doGetUIConfig())
      .fail((error: any) => {
        np.getLogger().error(`[now-playing] getUIConfig(): Cannot populate configuration - ${error}`);
        throw error;
      });
  }

  async #doGetUIConfig() {
    const langCode = this.#commandRouter.sharedVars.get('language_code');
    const uiconf = await kewToJSPromise(this.#commandRouter.i18nJson(
      `${__dirname}/i18n/strings_${langCode}.json`,
      `${__dirname}/i18n/strings_en.json`,
      `${__dirname}/UIConfig.json`)) ;
    return UIConfigHelper.populate(UIConfigHelper.observe(uiconf));
  }

  configureVolumioKiosk(data: { display: 'nowPlaying' | 'default' }) {
    KioskUtils.configureVolumioKiosk(data.display)
      .catch((error: unknown) => this.#stdLogError('KioskUtils.configureVolumioKiosk()', error))
      .finally(() => {
        np.refreshUIConfig();
      });
  }

  restoreVolumioKioskBak() {
    KioskUtils.restoreVolumioKiosk()
      .catch((error: unknown) => this.#stdLogError('KioskUtils.restoreVolumioKiosk()', error))
      .finally(() => {
        np.refreshUIConfig();
      });
  }

  configSaveDaemon(data: Record<string, any>) {
    const oldPort = np.getConfigValue('port');
    const port = parseInt(data['port'], 10);
    if (port < 1024 || port > 65353) {
      np.toast('error', np.getI18n('NOW_PLAYING_INVALID_PORT'));
      return;
    }

    if (oldPort !== port) {
      const modalData = {
        title: np.getI18n('NOW_PLAYING_CONFIGURATION'),
        message: np.getI18n('NOW_PLAYING_CONF_RESTART_CONFIRM'),
        size: 'lg',
        buttons: [
          {
            name: np.getI18n('NOW_PLAYING_NO'),
            class: 'btn btn-warning'
          },
          {
            name: np.getI18n('NOW_PLAYING_YES'),
            class: 'btn btn-info',
            emit: 'callMethod',
            payload: {
              'endpoint': 'user_interface/now_playing',
              'method': 'configConfirmSaveDaemon',
              'data': { port, oldPort }
            }
          }
        ]
      };
      np.broadcastMessage('openModal', modalData);
    }
    else {
      np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
    }
  }

  configConfirmSaveDaemon(data: Record<string, any>) {
    // Obtain kiosk info before saving new port
    const kiosk = KioskUtils.checkVolumioKiosk();

    np.setConfigValue('port', data.port);

    this.#restartApp().then(() => {
      np.toast('success', np.getI18n('NOW_PLAYING_RESTARTED'));

      // Update cached plugin info and broadcast it
      np.delete('pluginInfo');
      this.#broadcastPluginInfo();

      /**
       * Check if kiosk script was set to show Now Playing, and update
       * to new port (do not restart volumio-kiosk service because
       * the screen will reload itself when app is started).
       */
      if (kiosk.exists && kiosk.display == 'nowPlaying') {
        KioskUtils
          .modifyVolumioKioskScript(data.oldPort, data.port, false)
          .catch((error: unknown) => this.#stdLogError('KioskUtils.modifyVolumioKioskScript()', error));
      }

      np.refreshUIConfig();
    })
      .catch(() => {
        np.setConfigValue('port', data['oldPort']);
        np.refreshUIConfig();
      });
  }

  configSaveStartupOptions(data: Record<string, any>) {
    const apply = this.#parseConfigSaveData(data);
    np.setConfigValue('startup', apply);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    /**
     * Note here we don't broadcast 'settings updated' message, because
     * startup options are applied only once during app startup.
     */
  }

  configSaveLayouts(data: Record<string, any>) {
    const apply = this.#parseConfigSaveData(data);
    const screen = np.getConfigValue('screen.nowPlaying');
    const infoViewLayout = screen.infoViewLayout || {};
    infoViewLayout.type = apply.npInfoViewLayoutType;
    infoViewLayout.layout = apply.npInfoViewLayout;
    infoViewLayout.preferBiggerAlbumArt = apply.npInfoViewLayoutPreferBiggerAlbumArt;
    screen.infoViewLayout = infoViewLayout;
    np.setConfigValue('screen.nowPlaying', screen);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.NowPlayingScreen);
  }

  configSaveContentRegionSettings(data: Record<string, any>) {
    const apply = this.#parseConfigSaveData(data);
    const current = np.getConfigValue('contentRegion');
    const updated = Object.assign(current, apply);
    np.setConfigValue('contentRegion', updated);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.ContentRegion);
  }

  configSaveTextStyles(data: Record<string, any>) {
    const maxTitleLines = data.maxTitleLines !== '' ? parseInt(data.maxTitleLines, 10) : '';
    const maxArtistLines = data.maxArtistLines !== '' ? parseInt(data.maxArtistLines, 10) : '';
    const maxAlbumLines = data.maxAlbumLines !== '' ? parseInt(data.maxAlbumLines, 10) : '';
    const trackInfoTitleOrder = data.trackInfoTitleOrder !== '' ? parseInt(data.trackInfoTitleOrder, 10) : '';
    const trackInfoArtistOrder = data.trackInfoArtistOrder !== '' ? parseInt(data.trackInfoArtistOrder, 10) : '';
    const trackInfoAlbumOrder = data.trackInfoAlbumOrder !== '' ? parseInt(data.trackInfoAlbumOrder, 10) : '';
    const trackInfoMediaInfoOrder = data.trackInfoMediaInfoOrder !== '' ? parseInt(data.trackInfoMediaInfoOrder, 10) : '';
    const apply: {[k in keyof NowPlayingScreenSettings]: any} = {
      trackInfoVisibility: data.trackInfoVisibility.value,
      titleVisibility: data.titleVisibility,
      artistVisibility: data.artistVisibility,
      albumVisibility: data.albumVisibility,
      mediaInfoVisibility: data.mediaInfoVisibility,
      fontStyles: data.fontStyles.value,
      titleFontStyle: data.titleFontStyle.value,
      artistFontStyle: data.artistFontStyle.value,
      albumFontStyle: data.albumFontStyle.value,
      mediaInfoFontStyle: data.mediaInfoFontStyle.value,
      seekTimeFontStyle: data.seekTimeFontStyle.value,
      metadataFontStyle: data.metadataFontStyle.value,
      fontSizes: data.fontSizes.value,
      titleFontSize: data.titleFontSize,
      artistFontSize: data.artistFontSize,
      albumFontSize: data.albumFontSize,
      mediaInfoFontSize: data.mediaInfoFontSize,
      seekTimeFontSize: data.seekTimeFontSize,
      metadataFontSize: data.metadataFontSize,
      syncedLyricsCurrentLineFontSize: data.syncedLyricsCurrentLineFontSize,
      fontColors: data.fontColors.value,
      titleFontColor: data.titleFontColor,
      artistFontColor: data.artistFontColor,
      albumFontColor: data.albumFontColor,
      mediaInfoFontColor: data.mediaInfoFontColor,
      seekTimeFontColor: data.seekTimeFontColor,
      metadataFontColor: data.metadataFontColor,
      syncedLyricsColor: data.syncedLyricsColor,
      syncedLyricsCurrentLineColor: data.syncedLyricsCurrentLineColor,
      textAlignmentH: data.textAlignmentH.value,
      textAlignmentV: data.textAlignmentV.value,
      textAlignmentLyrics: data.textAlignmentLyrics.value,
      textMargins: data.textMargins.value,
      titleMargin: data.titleMargin,
      artistMargin: data.artistMargin,
      albumMargin: data.albumMargin,
      mediaInfoMargin: data.mediaInfoMargin,
      maxLines: data.maxLines.value,
      maxTitleLines,
      maxArtistLines,
      maxAlbumLines,
      trackInfoOrder: data.trackInfoOrder.value,
      trackInfoTitleOrder,
      trackInfoArtistOrder,
      trackInfoAlbumOrder,
      trackInfoMediaInfoOrder,
      trackInfoMarqueeTitle: data.trackInfoMarqueeTitle
    };
    const current = np.getConfigValue('screen.nowPlaying');
    const updated = Object.assign(current, apply);
    np.setConfigValue('screen.nowPlaying', updated);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.NowPlayingScreen);
  }

  configSaveWidgetStyles(data: Record<string, any>) {
    const apply = {
      widgetColors: data.widgetColors.value,
      widgetPrimaryColor: data.widgetPrimaryColor,
      widgetHighlightColor: data.widgetHighlightColor,
      widgetVisibility: data.widgetVisibility.value,
      playbackButtonsVisibility: data.playbackButtonsVisibility,
      seekbarVisibility: data.seekbarVisibility,
      playbackButtonSizeType: data.playbackButtonSizeType.value,
      playbackButtonSize: data.playbackButtonSize,
      seekbarStyling: data.seekbarStyling.value,
      seekbarThickness: data.seekbarThickness,
      seekbarBorderRadius: data.seekbarBorderRadius,
      seekbarShowThumb: data.seekbarShowThumb,
      seekbarThumbSize: data.seekbarThumbSize,
      widgetMargins: data.widgetMargins.value,
      playbackButtonsMargin: data.playbackButtonsMargin,
      seekbarMargin: data.seekbarMargin
    };
    const current = np.getConfigValue('screen.nowPlaying');
    const updated = Object.assign(current, apply);
    np.setConfigValue('screen.nowPlaying', updated);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.NowPlayingScreen);
  }

  #parseConfigSaveData(data: object) {
    const apply: Record<string, any> = {};
    for (const [ key, value ] of Object.entries(data)) {
      // Check if dropdown selection
      if (typeof value === 'object' && Reflect.has(value, 'value')) {
        apply[key] = value.value;
      }
      else {
        apply[key] = value;
      }
    }
    return apply;
  }

  configSaveAlbumartStyles(data: Record<string, any>) {
    const apply = this.#parseConfigSaveData(data);
    const current = np.getConfigValue('screen.nowPlaying');
    const normalizedCurrent = CommonSettingsLoader.get(CommonSettingsCategory.NowPlayingScreen);
    const refresh = normalizedCurrent.albumartVisibility !== apply.albumartVisibility;
    const updated = Object.assign(current, apply);
    np.setConfigValue('screen.nowPlaying', updated);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.NowPlayingScreen);

    if (refresh) {
      np.refreshUIConfig();
    }
  }

  configSaveBackgroundStyles(data: Record<string, any>) {
    const apply = this.#parseConfigSaveData(data);
    if (apply.myBackgroundImage === '/RANDOM/') {
      apply.myBackgroundImageType = 'random';
      apply.myBackgroundImage = '';
    }
    else {
      apply.myBackgroundImageType = 'fixed';
    }
    apply.myBackgroundRandomRefreshInterval = apply.myBackgroundRandomRefreshInterval ? parseInt(apply.myBackgroundRandomRefreshInterval, 10) : 0;
    if (apply.myBackgroundImage === '/SEPARATOR/') {
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_INVALID_BACKGROUND'));
      return;
    }

    const current = np.getConfigValue('background');
    const updated = Object.assign(current, apply);
    np.setConfigValue('background', updated);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.Background);
  }

  configSaveActionPanelSettings(data: Record<string, any>) {
    const settings = {
      showVolumeSlider: data.showVolumeSlider
    };
    const current = np.getConfigValue('actionPanel');
    const updated = Object.assign(current, settings);
    np.setConfigValue('actionPanel', updated);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.ActionPanel);
  }

  configSaveDockedMenuSettings(data: Record<string, any>) {
    this.#configSaveDockedComponentSettings(data, 'dockedMenu');
  }

  configSaveDockedActionPanelTriggerSettings(data: Record<string, any>) {
    this.#configSaveDockedComponentSettings(data, 'dockedActionPanelTrigger');
  }

  configSaveDockedVolumeIndicatorSettings(data: Record<string, any>) {
    this.#configSaveDockedComponentSettings(data, 'dockedVolumeIndicator');
  }

  configSaveDockedClockSettings(data: Record<string, any>) {
    this.#configSaveDockedComponentSettings(data, 'dockedClock');
  }

  configSaveDockedWeatherSettings(data: Record<string, any>) {
    this.#configSaveDockedComponentSettings(data, 'dockedWeather');
  }

  configSaveDockedMediaFormatSettings(data: Record<string, any>) {
    this.#configSaveDockedComponentSettings(data, 'dockedMediaFormat');
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  #configSaveDockedComponentSettings<T extends DockedComponentKey>(data: Record<string, any>, componentName: T) {
    const apply = this.#parseConfigSaveData(data);
    const screen = np.getConfigValue('screen.nowPlaying');
    const current = screen[componentName] || {};
    const normalizedCurrent = CommonSettingsLoader.get(CommonSettingsCategory.NowPlayingScreen)[componentName];
    const refresh = normalizedCurrent.enabled !== apply.enabled;
    const updated = Object.assign(current, apply);
    screen[componentName] = updated;
    np.setConfigValue('screen.nowPlaying', screen);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.NowPlayingScreen);

    if (refresh) {
      np.refreshUIConfig();
    }
  }

  configSaveLocalizationSettings(data: Record<string, any>) {
    const settings: LocalizationSettings = {
      geoCoordinates: data.geoCoordinates,
      locale: data.locale.value,
      timezone: data.timezone.value,
      unitSystem: data.unitSystem.value
    };

    if (settings.locale === 'localeListDivider') {
      np.toast('error', np.getI18n('NOW_PLAYING_LOCALE_SELECTION_INVALID'));
      return;
    }
    if (settings.timezone === 'timezoneListDivider') {
      np.toast('error', np.getI18n('NOW_PLAYING_TIMEZONE_SELECTION_INVALID'));
      return;
    }

    let successMessage: string | null = np.getI18n('NOW_PLAYING_SETTINGS_SAVED');
    if (settings.timezone === 'matchGeoCoordinates') {
      const coord = ConfigHelper.parseCoordinates(settings.geoCoordinates || '');
      if (!coord) {
        np.toast('error', np.getI18n('NOW_PLAYING_INVALID_GEO_COORD'));
        return;
      }
      const matchTimezones = geoTZ.find(coord.lat, coord.lon);
      if (Array.isArray(matchTimezones) && matchTimezones.length > 0) {
        settings.geoTimezone = matchTimezones[0];
        successMessage = np.getI18n('NOW_PLAYING_TZ_SET_BY_GEO_COORD', matchTimezones[0]);
      }
      else {
        settings.geoTimezone = null;
        successMessage = null;
        np.toast('warning', np.getI18n('NOW_PLAYING_TZ_BY_GEO_COORD_NOT_FOUND'));
      }
    }

    np.setConfigValue('localization', settings);
    if (successMessage) {
      np.toast('success', successMessage);
    }

    this.#configureWeatherApi();

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.Localization);
  }

  #configureWeatherApi() {
    const localization = CommonSettingsLoader.get(CommonSettingsCategory.Localization);
    const weather = np.getConfigValue('weather');
    getWeatherAPI().setConfig({
      coordinates: localization.geoCoordinates,
      locale: localization.resolvedLocale || ConfigHelper.getVolumioLocale(),
      timezone: localization.resolvedTimezone || localization.geoTimezone || undefined,
      units: localization.unitSystem,
      cacheMinutes: weather?.cacheMinutes ?? 10,
      appUrl: this.getPluginInfo().payload.appUrl
    });
  }

  configSaveWeatherServiceSettings(data: Record<string, any>) {
    const raw = data['weatherCacheMinutes']?.value ?? data['weatherCacheMinutes'];
    const num = typeof raw === 'number' ? raw : parseInt(raw, 10);
    const allowedCacheValues = [10, 30, 60, 120, 360, 720, 1440];
    const cacheMinutes = (Number.isInteger(num) && allowedCacheValues.includes(num)) ? num : 10;
    const settings = {
      cacheMinutes
    };
    np.setConfigValue('weather', settings);
    this.#configureWeatherApi();
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
  }

  configSaveMetadataServiceSettings(data: Record<string, any>) {
    const token = data['geniusAccessToken'].trim();
    const settings: MetadataServiceOptions = {
      geniusAccessToken: token,
      excludeParenthesized: data['excludeParenthesized'],
      parenthesisType: data['parenthesisType'].value,
      queryMusicServices: data['queryMusicServices'],
      enableSyncedLyrics: data['enableSyncedLyrics']
    };
    np.setConfigValue('metadataService', settings);
    metadataAPI.updateSettings(settings);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));
  }

  configSaveIdleScreenSettings(data: Record<string, any>) {
    const apply = this.#parseConfigSaveData(data);
    if (apply.waitTime) {
      apply.waitTime = parseInt(apply.waitTime, 10);
    }
    if (apply.myBackgroundImage === '/RANDOM/') {
      apply.myBackgroundImageType = 'random';
      apply.myBackgroundImage = '';
    }
    else {
      apply.myBackgroundImageType = 'fixed';
    }
    apply.myBackgroundRandomRefreshInterval = apply.myBackgroundRandomRefreshInterval ? parseInt(apply.myBackgroundRandomRefreshInterval, 10) : 10;
    apply.unsplashRefreshInterval = data.unsplashRefreshInterval ? parseInt(apply.unsplashRefreshInterval, 10) : 10;
    if (apply.waitTime < 10) {
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_IDLE_SCREEN_WAIT_TIME'));
      return;
    }
    if (apply.myBackgroundImage === '/SEPARATOR/') {
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_INVALID_BACKGROUND'));
      return;
    }
    if (apply.unsplashRefreshInterval !== 0 && apply.unsplashRefreshInterval < 10) {
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_UNSPLASH_REFRESH_INTERVAL'));
      return;
    }
    apply.mainAlignmentCycleInterval = data.mainAlignmentCycleInterval ? parseInt(apply.mainAlignmentCycleInterval, 10) : 60;
    if (apply.mainAlignmentCycleInterval !== 0 && apply.mainAlignmentCycleInterval < 10) {
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_CYCLE_INTERVAL'));
      return;
    }

    const current = np.getConfigValue('screen.idle');
    const normalizedCurrent = CommonSettingsLoader.get(CommonSettingsCategory.IdleScreen);
    const refresh = (normalizedCurrent.enabled !== 'disabled' && apply.enabled === 'disabled') ||
      (normalizedCurrent.enabled === 'disabled' && apply.enabled !== 'disabled');
    const updated = Object.assign(current, apply);
    np.setConfigValue('screen.idle', updated);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.IdleScreen);

    if (refresh) {
      np.refreshUIConfig();
    }
  }

  configSaveExtraScreenSettings(data: Record<string, any>) {
    const theme: ThemeSettings = {
      active: data.theme.value
    };
    np.setConfigValue('theme', theme);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.Theme);
  }

  configSavePerformanceSettings(data: Record<string, any>) {
    const syncedLyricsDelay = data.syncedLyricsDelay !== '' ? parseInt(data.syncedLyricsDelay, 10) : 0;
    const settings: PerformanceSettings = {
      transitionEffectsKiosk: data.transitionEffectsKiosk,
      transitionEffectsOtherDevices: data.transitionEffectsOtherDevices,
      unmountScreensOnExit: data.unmountScreensOnExit.value,
      unmountNowPlayingScreenOnExit: data.unmountNowPlayingScreenOnExit,
      unmountBrowseScreenOnExit: data.unmountBrowseScreenOnExit,
      unmountQueueScreenOnExit: data.unmountQueueScreenOnExit,
      unmountVolumioScreenOnExit: data.unmountVolumioScreenOnExit,
      syncedLyricsDelay
    };
    np.setConfigValue('performance', settings);
    np.toast('success', np.getI18n('NOW_PLAYING_SETTINGS_SAVED'));

    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.Performance);
  }

  configBackupConfig(data: any) {
    const backupName = data.backupName?.trim();
    if (!backupName) {
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_NO_BACKUP_NAME'));
      return;
    }
    try {
      ConfigBackupHelper.createBackup(backupName);
    }
    catch (error: any) {
      np.getLogger().error(`[now-playing] Failed to backup config: ${error.message}`);
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_BACKUP_CONFIG', np.getErrorMessage('', error, false)));
      return;
    }
    np.toast('success', np.getI18n('NOW_PLAYING_BACKUP_CREATED'));
    np.refreshUIConfig();
  }

  async configRestoreConfigFromBackup(data: any) {
    const backupName = data.backupName?.trim();
    if (!backupName) {
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_NO_BACKUP_NAME'));
      return;
    }

    try {
      await ConfigBackupHelper.replacePluginConfigWithBackup(backupName);
    }
    catch (error: any) {
      np.getLogger().error(`[now-playing] Failed to restore config: ${error.message}`);
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_RESTORE_CONFIG', np.getErrorMessage('', error, false)));
      return;
    }

    /**
     * ConfigBackupHelper only replaces the plugin config with backup. We still need
     * to restart the plugin for changed config to take effect.
     */
    const configFilePath = np.getConfigFilePath();
    await this.#doOnStop();
    this.#config.loadFile(configFilePath);
    await this.#doOnStart();

    this.broadcastRefresh();
    np.toast('success', np.getI18n('NOW_PLAYING_CONFIG_RESTORED', backupName));
    np.refreshUIConfig();
  }

  configDeleteConfigBackup(data: any) {
    const backupName = data.backupName?.trim();
    if (!backupName) {
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_NO_BACKUP_NAME'));
      return;
    }

    try {
      ConfigBackupHelper.deleteBackup(backupName);
    }
    catch (error: any) {
      np.getLogger().error(`[now-playing] Failed to delete config backup: ${error.message}`);
      np.toast('error', np.getI18n('NOW_PLAYING_ERR_DELETE_BACKUP', np.getErrorMessage('', error, false)));
      return;
    }

    np.toast('success', np.getI18n('NOW_PLAYING_BACKUP_DELETED'));
    np.refreshUIConfig();
  }

  clearMetadataCache() {
    metadataAPI.clearCache();
    np.toast('success', np.getI18n('NOW_PLAYING_CACHE_CLEARED'));
  }

  clearWeatherCache() {
    getWeatherAPI().clearCache();
    np.toast('success', np.getI18n('NOW_PLAYING_CACHE_CLEARED'));
  }

  broadcastRefresh() {
    np.broadcastMessage('nowPlayingRefresh');
    np.toast('success', np.getI18n('NOW_PLAYING_BROADCASTED_COMMAND'));
  }

  #broadcastPluginInfo() {
    const {message, payload} = this.getPluginInfo();
    np.broadcastMessage(message, payload);
  }

  #notifyCommonSettingsUpdated(category: CommonSettingsCategory) {
    np.broadcastMessage('nowPlayingPushSettings', {
      category,
      data: CommonSettingsLoader.get(category)
    });
  }

  // Socket callMethod
  getPluginInfo() {
    return {
      message: 'nowPlayingPluginInfo',
      payload: SystemUtils.getPluginInfo()
    };
  }

  // Plugin lifecycle

  onVolumioStart() {
    const configFile = this.#commandRouter.pluginManager.getConfigurationFile(this.#context, 'config.json');
    this.#config = new vconf();
    this.#config.loadFile(configFile);

    return libQ.resolve(true);
  }

  onStart() {
    return jsPromiseToKew(this.#doOnStart());
  }

  async #doOnStart() {
    np.init(this.#context, this.#config);

    await ConfigUpdater.checkAndUpdate();

    metadataAPI.updateSettings(np.getConfigValue('metadataService'));
    this.#configureWeatherApi();

    // Host monitor
    const host = np.getDeviceInfo().host;
    if (host === 'http://127.0.0.1') {
      this.#hostMonitor = new HostMonitor();
      this.#hostMonitor.on('change', (previous, current) => {
        np.getLogger().info(`[now-playing] Detected host change: ${previous} => ${current}`);

        if (current !== 'http://127.0.0.1') {
          this.#hostMonitor?.stop();
        }

        // Delete any cached instance of device / plugin info and broadcast updated one
        np.delete('deviceInfo');
        np.delete('pluginInfo');
        this.#broadcastPluginInfo();

        // Refesh UI config to show updated preview URL
        np.refreshUIConfig();

        // Refesh weather service since icons URLs would have changed
        this.#configureWeatherApi();
      });
      this.#hostMonitor.start();
    }

    // Register language change listener
    this.#volumioLanguageChangeCallback = this.#onVolumioLanguageChanged.bind(this);
    this.#context.coreCommand.sharedVars.registerCallback('language_code', this.#volumioLanguageChangeCallback);

    await this.#startApp();

    const display = np.getConfigValue('kioskDisplay');
    if (display == 'nowPlaying') {
      const kiosk = KioskUtils.checkVolumioKiosk();
      if (kiosk.exists && kiosk.display == 'default') {
        await KioskUtils.modifyVolumioKioskScript(3000, np.getConfigValue('port'));
      }
    }

    myBackgroundMonitor.start();
  }

  onStop() {
    return jsPromiseToKew(this.#doOnStop());
  }

  async #doOnStop() {
    this.#stopApp();

    if (this.#hostMonitor) {
      this.#hostMonitor.stop();
      this.#hostMonitor.removeAllListeners();
    }

    // Remove language change listener (this is hacky but prevents a potential
    // Memory leak)
    if (this.#config.callbacks && this.#volumioLanguageChangeCallback) {
      this.#config.callbacks.delete('language_code', this.#volumioLanguageChangeCallback);
      this.#volumioLanguageChangeCallback = null;
    }

    // If kiosk is set to Now Playing, restore it back to default
    const kiosk = KioskUtils.checkVolumioKiosk();
    if (kiosk.exists && kiosk.display == 'nowPlaying') {
      try {
        await KioskUtils.modifyVolumioKioskScript(np.getConfigValue('port'), 3000);
      }
      catch (error) {
        // Do nothing
      }
    }

    await myBackgroundMonitor.stop();

    np.reset();
  }

  getConfigurationFiles() {
    return [ 'config.json' ];
  }

  async #startApp() {
    try {
      await App.start();
    }
    catch (error: any) {
      np.toast('error', np.getI18n('NOW_PLAYING_DAEMON_START_ERR', error.message));
      throw error;
    }
  }

  #stopApp() {
    App.stop();
  }

  #restartApp() {
    this.#stopApp();
    return this.#startApp();
  }

  #onVolumioLanguageChanged() {
    // Push localization settings
    np.getLogger().info('[now-playing] Volumio language changed - pushing localization settings');
    this.#notifyCommonSettingsUpdated(CommonSettingsCategory.Localization);
  }

  #stdLogError(fn: string, error: unknown) {
    np.getLogger().error(np.getErrorMessage(`[now-playing] Caught error in ${fn}:`, error, false));
  }
}

export = ControllerNowPlaying;
