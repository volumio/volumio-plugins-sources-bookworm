import YouTubeCastReceiver, { Constants, type PlayerState, type Sender, type YouTubeCastReceiverOptions } from 'yt-cast-receiver';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import vconf from 'v-conf';
import i18nConfOptions from './config/i18n.json';
import ytcr from './lib/YTCRContext.js';
import Logger from './lib/Logger.js';
import MPDPlayer, { type ActionEvent, type MPDPlayerError, type VolumioState } from './lib/MPDPlayer.js';
import VolumeControl, { type VolumioVolume } from './lib/VolumeControl.js';
import * as utils from './lib/Utils.js';
import VideoLoader from './lib/VideoLoader.js';
import PairingHelper from './lib/PairingHelper.js';
import ReceiverDataStore from './lib/ReceiverDataStore.js';
import { type NowPlayingPluginSupport } from 'now-playing-common';
import YTCRNowPlayingMetadataProvider from './lib/YTCRNowPlayingMetadataProvider';
import InnertubeLoader from './lib/InnertubeLoader';
import { existsSync, readFileSync } from 'fs';

const IDLE_STATE = {
  status: 'stop',
  service: 'ytcr',
  title: undefined,
  artist: undefined,
  album: undefined,
  albumart: '/albumart',
  uri: '',
  trackType: undefined,
  seek: 0,
  duration: 0,
  samplerate: undefined,
  bitdepth: undefined,
  bitrate: undefined,
  channels: undefined
};

class ControllerYTCR implements NowPlayingPluginSupport {

  #serviceName = 'ytcr';
  #context: any;
  #config: any;
  #commandRouter: any;
  #volatileCallback: any;
  #previousTrackTimer: NodeJS.Timeout | null;

  #logger: Logger;
  #player: MPDPlayer | null;
  #volumeControl: VolumeControl | null;
  #receiver: YouTubeCastReceiver | null;
  #dataStore: ReceiverDataStore;

  #nowPlayingMetadataProvider: YTCRNowPlayingMetadataProvider | null;

  constructor(context: any) {
    this.#context = context;
    this.#commandRouter = context.coreCommand;
    this.#dataStore = new ReceiverDataStore();
    this.#logger = new Logger(context.logger);
    this.#previousTrackTimer = null;
    this.#player = null;
    this.#volumeControl = null;
    this.#receiver = null;
    this.#serviceName = 'ytcr';
  }

  getUIConfig() {
    const defer = libQ.defer();

    const hasAcceptedDisclaimer = ytcr.getConfigValue('hasAcceptedDisclaimer');
    const langCode = this.#commandRouter.sharedVars.get('language_code');

    const loadConfigPromises = [
      utils.kewToJSPromise(this.#commandRouter.i18nJson(`${__dirname}/i18n/strings_${langCode}.json`,
        `${__dirname}/i18n/strings_en.json`,
        `${__dirname}/UIConfig.json`)),
      hasAcceptedDisclaimer && this.#receiver ? PairingHelper.getManualPairingCode(this.#receiver, this.#logger) : Promise.resolve(null)
    ] as const;

    Promise.all(loadConfigPromises)
      .then(([ uiconf, pairingCode ]) => {
        const [
          disclaimerUIConf,
          connectionUIConf,
          manualPairingUIConf,
          i18nUIConf,
          otherUIConf ] = uiconf.sections;

        // Disclaimer
        disclaimerUIConf.content[1].value = hasAcceptedDisclaimer;

        if (!hasAcceptedDisclaimer) {
          // hasAcceptedDisclaimer is false
          uiconf.sections = [ disclaimerUIConf ];
          return defer.resolve(uiconf);
        }

        const receiverRunning = this.#receiver?.status === Constants.STATUSES.RUNNING;

        const port = ytcr.getConfigValue('port');
        const enableAutoplayOnConnect = ytcr.getConfigValue('enableAutoplayOnConnect');
        const resetPlayerOnDisconnect = ytcr.getConfigValue('resetPlayerOnDisconnect');
        const debug = ytcr.getConfigValue('debug');
        const bindToIf = ytcr.getConfigValue('bindToIf');
        const i18n = {
          region: ytcr.getConfigValue('region'),
          language: ytcr.getConfigValue('language')
        };
        const prefetch = ytcr.getConfigValue('prefetch');
        const preferOpus = ytcr.getConfigValue('preferOpus');
        const liveStreamQuality = ytcr.getConfigValue('liveStreamQuality');
        const liveStreamQualityOptions = otherUIConf.content[2].options;

        const availableIf = utils.getNetworkInterfaces();
        const ifOpts = [ {
          value: '',
          label: ytcr.getI18n('YTCR_BIND_TO_ALL_IF')
        } ];
        connectionUIConf.content[1].value = ifOpts[0];
        availableIf.forEach((info) => {
          const opt = {
            value: info.name,
            label: `${info.name} (${info.ip})`
          };
          ifOpts.push(opt);
          if (bindToIf === info.name) {
            connectionUIConf.content[1].value = opt;
          }
        });

        connectionUIConf.content[0].value = port;
        connectionUIConf.content[1].options = ifOpts;

        if (!receiverRunning) {
          manualPairingUIConf.content[0].value = ytcr.getI18n('YTCR_NO_CODE_NOT_RUNNING');
        }
        else {
          manualPairingUIConf.content[0].value = pairingCode || ytcr.getI18n('YTCR_NO_CODE_ERR');
        }

        i18nUIConf.content[0].options = i18nConfOptions.region;
        i18nUIConf.content[0].value = i18nConfOptions.region.find((r) => i18n.region === r.value);
        i18nUIConf.content[1].options = i18nConfOptions.language;
        i18nUIConf.content[1].value = i18nConfOptions.language.find((r) => i18n.language === r.value);

        otherUIConf.content[0].value = prefetch;
        otherUIConf.content[1].value = preferOpus;
        otherUIConf.content[2].value = liveStreamQualityOptions.find((o: any) => o.value === liveStreamQuality);
        otherUIConf.content[3].value = enableAutoplayOnConnect;
        otherUIConf.content[4].options = [
          {
            value: Constants.RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_DISCONNECTED,
            label: ytcr.getI18n('YTCR_RESET_PLAYER_ON_DISCONNECT_ALWAYS')
          },
          {
            value: Constants.RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_EXPLICITLY_DISCONNECTED,
            label: ytcr.getI18n('YTCR_RESET_PLAYER_ON_DISCONNECT_EXPLICIT')
          }
        ];
        otherUIConf.content[4].value = otherUIConf.content[4].options.find((o: any) => o.value === resetPlayerOnDisconnect);
        otherUIConf.content[5].value = debug;

        let connectionStatus;
        if (!receiverRunning) {
          connectionStatus = ytcr.getI18n('YTCR_IDLE_NOT_RUNNING');
        }
        else if (this.#hasConnectedSenders()) {
          const senders = this.#receiver?.getConnectedSenders() || [];
          if (senders.length > 1) {
            connectionStatus = ytcr.getI18n('YTCR_CONNECTED_MULTIPLE', senders[0].name, senders.length - 1);
          }
          else {
            connectionStatus = ytcr.getI18n('YTCR_CONNECTED', senders[0].name);
          }
        }
        else {
          connectionStatus = ytcr.getI18n('YTCR_IDLE');
        }
        connectionUIConf.label = ytcr.getI18n('YTCR_CONNECTION', connectionStatus);

        defer.resolve(uiconf);
      })
      .catch((error: unknown) => {
        this.#logger.error('[ytmusic] getUIConfig(): Cannot populate YouTube Cast Receiver configuration:', error);
        defer.reject(Error());
      });

    return defer.promise;
  }

  onVolumioStart() {
    const configFile = this.#commandRouter.pluginManager.getConfigurationFile(this.#context, 'config.json');
    this.#config = new vconf();
    this.#config.loadFile(configFile);
    return libQ.resolve();
  }

  onStart() {
    
    ytcr.init(this.#context, this.#config);
    
    if (!ytcr.getConfigValue('hasAcceptedDisclaimer')) {
      ytcr.toast('warning', ytcr.getI18n('YTCR_ACCEPT_DISCLAIMER_MSG'));
      return libQ.resolve();
    }
    
    const defer = libQ.defer();

    if (this.#dataStore.isExpired()) {
      this.#logger.info('[ytcr] Data store TTL expired - clearing it...');
      this.#dataStore.clear();
    }

    const volumeControl = this.#volumeControl = new VolumeControl(this.#commandRouter, this.#logger);

    const playerConfig = {
      mpd: this.#getMpdConfig(),
      volumeControl: this.#volumeControl,
      videoLoader: new VideoLoader(this.#logger),
      prefetch: ytcr.getConfigValue('prefetch')
    };
    const player = this.#player = new MPDPlayer(playerConfig);

    const bindToIf = ytcr.getConfigValue('bindToIf');
    const receiverOptions: YouTubeCastReceiverOptions = {
      dial: {
        port: ytcr.getConfigValue('port'),
        bindToInterfaces: utils.hasNetworkInterface(bindToIf) ? [ bindToIf ] : undefined
      },
      app: {
        enableAutoplayOnConnect: ytcr.getConfigValue('enableAutoplayOnConnect'),
        resetPlayerOnDisconnectPolicy: ytcr.getConfigValue('resetPlayerOnDisconnect')
      },
      dataStore: this.#dataStore,
      logger: this.#logger,
      logLevel: ytcr.getConfigValue('debug') ? Constants.LOG_LEVELS.DEBUG : Constants.LOG_LEVELS.INFO
    };
    const deviceInfo = ytcr.getDeviceInfo();
    if (deviceInfo.name) {
      receiverOptions.device = {
        name: deviceInfo.name
      };
    }
    const receiver = this.#receiver = new YouTubeCastReceiver(this.#player, receiverOptions);

    receiver.on('senderConnect', (sender: Sender) => {
      this.#logger.info('[ytcr] ***** Sender connected *****');
      ytcr.toast('success', ytcr.getI18n('YTCR_CONNECTED', sender.name));
      this.refreshUIConfig();
    });

    receiver.on('senderDisconnect', (sender: Sender) => {
      this.#logger.info('[ytcr] ***** Sender disconnected *****');
      ytcr.toast('warning', ytcr.getI18n('YTCR_DISCONNECTED', sender.name));
      this.refreshUIConfig();
    });

    player.on('action', (action: ActionEvent) => {
      void (async () => {
        if (action.name === 'play' && !this.isCurrentService()) {
          this.#logger.debug('[ytcr] \'play\' command received while not being the current service.');
          // Stop any playback by the currently active service
          this.#logger.debug('[ytcr] Stopping playback by current service...');
          try {
            await utils.kewToJSPromise(this.#commandRouter.volumioStop());
          }
          catch (error) {
            this.#logger.debug('[ytcr] An error occurred while stopping playback by current service: ', error);
            this.#logger.debug('[ytcr] Continuing anyway...');
          }
          // Unset any volatile state of currently active service
          const sm = ytcr.getStateMachine();
          if (sm.isVolatile) {
            sm.unSetVolatile(); // Why isn't this async?!
          }
          this.#logger.debug('[ytcr] Setting ourselves as the current service...');
          this.setVolatile();
          this.pushIdleState();
          // Update volume on sender apps
          await player.notifyExternalStateChange();
        }
        else if (action.name === 'setVolume' && !this.isCurrentService()) {
          this.#logger.debug('[ytcr] setVolume command received, but we are not the current service. Putting player to sleep...');
          player.sleep();
        }
      })();
    });

    // Listen for changes in volume on Volumio's end
    volumeControl.registerVolumioVolumeChangeListener(async (volumioVol: VolumioVolume) => {
      const volume = {
        level: volumioVol.vol,
        muted: volumioVol.mute
      };
      if (this.isCurrentService() && this.#hasConnectedSenders()) {
        // SetVolume() will trigger volumioupdatevolume() which will trigger the statemachine's
        // PushState() - but old volatile state with outdated info will be used.
        // So we push the latest state here to refresh the old volatile state.
        this.#logger.debug('[ytcr] Captured change in Volumio\'s volume:', volumioVol);
        await this.pushState();
        volumeControl.setVolume(volume, true);
        await this.pushState(); // Do it once more
        await player.notifyExternalStateChange();
      }
      else {
        // Even if not current service, we keep track of the updated volume
        volumeControl.setVolume(volume, true);
      }
    });

    player.on('state', (states: { current: PlayerState, previous: PlayerState }) => {
      void (async () => {
        if (this.isCurrentService()) {
          const state = states.current;
          this.#logger.debug('[ytcr] Received state change event from MPDPlayer:', state);
          if (state.status === Constants.PLAYER_STATUSES.STOPPED || state.status === Constants.PLAYER_STATUSES.IDLE) {
            player.sleep();
            if (state.status === Constants.PLAYER_STATUSES.STOPPED && player.queue.videoIds.length > 0) {
              // If queue is not empty, it is possible that we are just moving to another song. In this case, we don't push
              // Idle state to avoid ugly flickering of the screen caused by the temporary Idle state.
              const currentVolumioState = ytcr.getStateMachine().getState() as VolumioState;
              currentVolumioState.status = 'pause'; // Don't use 'stop' - will display Volumio logo leading to flicker!
              await this.pushState(currentVolumioState);
            }
            else {
              this.pushIdleState();
            }
          }
          else {
            await this.pushState();
          }
        }
      })();
    });

    player.on('error', (error: MPDPlayerError) => {
      ytcr.toast('error', error.message);
    });

    receiver.start().then(async () => {
      await volumeControl.init();
      await player.init();
      this.#logger.debug('[ytcr] Receiver started with options:', receiverOptions);
      this.#nowPlayingMetadataProvider = new YTCRNowPlayingMetadataProvider(player, this.#logger);
      ytcr.toast('success', ytcr.getI18n('YTCR_RECEIVER_STARTED'));
      defer.resolve();
    })
      .catch((error: unknown) => {
        this.#logger.error('[ytcr] Failed to start plugin:', error);
        if (receiver.status === Constants.STATUSES.RUNNING) {
          receiver.stop().catch((error: unknown) => this.#logger.error('[ytcr] Caught error while stopping receiver:', error));
        }
        else {
          ytcr.toast('error', ytcr.getI18n('YTCR_RECEIVER_START_ERR', error instanceof Error ? error.message : String(error)));
        }
        // Still resolve, in case error is caused by wrong setting (e.g. conflicting port).
        defer.resolve();
      });


    return defer.promise;
  }

  #getMpdConfig() {
    return {
      path: '/run/mpd/socket'
    };
  }

  #hasConnectedSenders(): boolean {
    return this.#receiver ? this.#receiver.getConnectedSenders().length > 0 : false;
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
        title: ytcr.getI18n('YTCR_DISCLAIMER_HEADING'),
        message: contents,
        size: 'lg',
        buttons: [
          {
            name: ytcr.getI18n('YTCR_CLOSE'),
            class: 'btn btn-warning'
          },
          {
            name: ytcr.getI18n('YTCR_ACCEPT'),
            class: 'btn btn-info',
            emit: 'callMethod',
            payload: {
              type: 'controller',
              endpoint: 'music_service/ytcr',
              method:'acceptDisclaimer',
              data: ''
            } 
          }
        ]
      };
      ytcr.volumioCoreCommand.broadcastMessage("openModal", modalData);
    }
    catch (error) {
      this.#logger.error(`[ytcr] Error reading "${disclaimerFile}":`, error);
      ytcr.toast('error', 'Error loading disclaimer contents');
    }
  }

  acceptDisclaimer() {
    this.configSaveDisclaimer({
      hasAcceptedDisclaimer: true
    });
  }

  async configSaveDisclaimer(data: any) {
    const changed = ytcr.getConfigValue('hasAcceptedDisclaimer') !== data.hasAcceptedDisclaimer;
    ytcr.setConfigValue('hasAcceptedDisclaimer', data.hasAcceptedDisclaimer);
    ytcr.toast('success', ytcr.getI18n('YTCR_SETTINGS_SAVED'));
    if (changed) {
      await utils.kewToJSPromise(this.restart());
      ytcr.refreshUIConfig();
    }
  }

  configSaveConnection(data: any) {
    const oldPort = ytcr.getConfigValue('port');
    const port = parseInt(data['port'], 10);
    if (port < 1024 || port > 65353) {
      ytcr.toast('error', ytcr.getI18n('YTCR_INVALID_PORT'));
      return;
    }
    const oldBindToIf = ytcr.getConfigValue('bindToIf');
    const bindToIf = data['bindToIf'].value;

    if (oldPort !== port || oldBindToIf !== bindToIf) {
      this.#checkSendersAndPromptBeforeRestart(
        this.configConfirmSaveConnection.bind(this, { port, bindToIf }),
        {
          'endpoint': 'music_service/ytcr',
          'method': 'configConfirmSaveConnection',
          'data': { port, bindToIf }
        }
      );
    }
    else {
      ytcr.toast('success', ytcr.getI18n('YTCR_SETTINGS_SAVED'));
    }
  }

  configConfirmSaveConnection(data: any) {
    ytcr.setConfigValue('port', data['port']);
    ytcr.setConfigValue('bindToIf', data['bindToIf']);
    this.restart().then(() => {
      this.refreshUIConfig();
      ytcr.toast('success', ytcr.getI18n('YTCR_RESTARTED'));
    });
  }

  async configSaveI18n(data: any) {
    const oldRegion = ytcr.getConfigValue('region');
    const oldLanguage = ytcr.getConfigValue('language');
    const region = data.region.value;
    const language = data.language.value;

    if (oldRegion !== region || oldLanguage !== language) {
      ytcr.setConfigValue('region', region);
      ytcr.setConfigValue('language', language);

      if (this.#player) {
        await this.#player.videoLoader.refreshI18nConfig();
      }
    }

    ytcr.toast('success', ytcr.getI18n('YTCR_SETTINGS_SAVED'));
  }

  async configSaveOther(data: any) {
    ytcr.setConfigValue('prefetch', data['prefetch']);
    ytcr.setConfigValue('preferOpus', data['preferOpus']);
    ytcr.setConfigValue('liveStreamQuality', data['liveStreamQuality'].value);
    ytcr.setConfigValue('enableAutoplayOnConnect', data['enableAutoplayOnConnect']);
    ytcr.setConfigValue('resetPlayerOnDisconnect', data['resetPlayerOnDisconnect'].value);
    ytcr.setConfigValue('debug', data['debug']);

    if (this.#receiver) {
      this.#receiver.setLogLevel(data['debug'] ? Constants.LOG_LEVELS.DEBUG : Constants.LOG_LEVELS.INFO);
      this.#receiver.enableAutoplayOnConnect(data['enableAutoplayOnConnect']);
      this.#receiver.setResetPlayerOnDisconnectPolicy(data['resetPlayerOnDisconnect'].value);
    }

    if (this.#player) {
      await this.#player.enablePrefetch(data['prefetch']);
    }

    ytcr.toast('success', ytcr.getI18n('YTCR_SETTINGS_SAVED'));
  }

  configClearDataStore() {
    this.#checkSendersAndPromptBeforeRestart(
      this.configConfirmClearDataStore.bind(this),
      {
        'endpoint': 'music_service/ytcr',
        'method': 'configConfirmClearDataStore'
      }
    );
  }

  configConfirmClearDataStore() {
    this.#dataStore.clear();
    this.restart().then(() => {
      this.refreshUIConfig();
      ytcr.toast('success', ytcr.getI18n('YTCR_RESTARTED'));
    });
  }

  #checkSendersAndPromptBeforeRestart(onCheckPass: () => void, modalOnConfirmPayload: { endpoint: string, method: string, data?: Record<string, any> }) {
    if (this.#hasConnectedSenders()) {
      const modalData: any = {
        title: ytcr.getI18n('YTCR_CONFIGURATION'),
        size: 'lg',
        buttons: [
          {
            name: ytcr.getI18n('YTCR_NO'),
            class: 'btn btn-warning'
          },
          {
            name: ytcr.getI18n('YTCR_YES'),
            class: 'btn btn-info',
            emit: 'callMethod',
            payload: modalOnConfirmPayload
          }
        ]
      };
      const senders = this.#receiver?.getConnectedSenders() || [];
      if (senders.length > 1) {
        modalData.message = ytcr.getI18n('YTCR_CONF_RESTART_CONFIRM_M', senders[0].name, senders.length - 1);
      }
      else {
        modalData.message = ytcr.getI18n('YTCR_CONF_RESTART_CONFIRM', senders[0].name);
      }
      this.#commandRouter.broadcastMessage('openModal', modalData);
    }
    else {
      onCheckPass();
    }
  }

  refreshUIConfig() {
    this.#commandRouter.getUIConfigOnPlugin('music_service', 'ytcr', {}).then((config: any) => {
      this.#commandRouter.broadcastMessage('pushUiConfig', config);
    });
  }

  onStop() {
    const defer = libQ.defer();

    void (async() => {
      try {
        if (this.#receiver) {
          this.#receiver.removeAllListeners();    
          await this.#receiver.stop();
          this.#logger.debug('[ytcr] Receiver stopped');
        }
        this.unsetVolatile();
        if (this.#volumeControl) {
          this.#volumeControl.unregisterVolumioVolumeChangeListener();
        }
        if (this.#player) {
          await this.#player.destroy();
        }
        await InnertubeLoader.reset();
        if (this.#receiver) {
          ytcr.toast('success', ytcr.getI18n('YTCR_RECEIVER_STOPPED'));
        }
        ytcr.reset();
        this.#nowPlayingMetadataProvider = null;
        defer.resolve();
      }
      catch (error: unknown) {
        this.#logger.error('[ytcr] Failed to stop receiver:', error);
        defer.reject(error);
      }
    })();
    
    return defer.promise;
  }

  restart() {
    return this.onStop().then(() => {
      return this.onStart();
    });
  }

  getConfigurationFiles(): string[] {
    return [ 'config.json' ];
  }

  setVolatile() {
    if (!this.#volatileCallback) {
      this.#volatileCallback = this.onUnsetVolatile.bind(this);
    }
    if (!this.isCurrentService()) {
      ytcr.getStateMachine().setVolatile({
        service: this.#serviceName,
        callback: this.#volatileCallback
      });
      ytcr.getMpdPlugin().ignoreUpdate(true);
      ytcr.getStateMachine().setConsumeUpdateService(undefined);
    }
  }

  unsetVolatile() {
    ytcr.getStateMachine().unSetVolatile();
  }

  async onUnsetVolatile() {
    this.pushIdleState();
    ytcr.getMpdPlugin().ignoreUpdate(false);
    if (this.#player) {
      return this.#player.stop();
    }
    return true;
  }

  pushIdleState() {
    this.#logger.debug('[ytcr] Pushing idle state...');
    // Need to first push empty state with pause status first so the empty volatileState gets registered
    // By statemachine.
    this.#commandRouter.servicePushState(Object.assign(IDLE_STATE, { status: 'pause' }), this.#serviceName);
    // Then push empty state with stop status
    this.#commandRouter.servicePushState(IDLE_STATE, this.#serviceName);
  }

  async pushState(state?: VolumioState) {
    const volumioState = state || await this.#player?.getVolumioState();
    if (volumioState) {
      this.#logger.debug('[ytcr] pushState(): ', volumioState);
      this.#commandRouter.servicePushState(volumioState, this.#serviceName);
    }
  }

  isCurrentService() {
    // Check what is the current Volumio service
    const currentstate = this.#commandRouter.volumioGetState();
    if (currentstate !== undefined && currentstate.service !== undefined && currentstate.service !== this.#serviceName) {
      return false;
    }
    return true;
  }

  stop() {
    return this.#player ? utils.jsPromiseToKew(this.#player.stop()) : libQ.resolve(false);
  }

  play() {
    return this.#player ? utils.jsPromiseToKew(this.#player.resume()) : libQ.resolve(false);
  }

  pause() {
    return this.#player ? utils.jsPromiseToKew(this.#player.pause()) : libQ.resolve(false);
  }

  resume() {
    return this.#player ? utils.jsPromiseToKew(this.#player.resume()) : libQ.resolve(false);
  }

  seek(position: number) {
    return this.#player ? utils.jsPromiseToKew(this.#player.seek(Math.round(position / 1000))) : libQ.resolve(false);
  }

  next() {
    return this.#player ? utils.jsPromiseToKew(this.#player.next()) : libQ.resolve(false);
  }

  previous() {
    if (!this.#player) {
      return libQ.resolve(false);
    }
    if (this.#previousTrackTimer) {
      clearTimeout(this.#previousTrackTimer);
      this.#previousTrackTimer = null;
      return utils.jsPromiseToKew(this.#player.previous());
    }
    if (this.#player.status === Constants.PLAYER_STATUSES.PLAYING ||
      this.#player.status === Constants.PLAYER_STATUSES.PAUSED) {
      this.#previousTrackTimer = setTimeout(() => {
        this.#previousTrackTimer = null;
      }, 3000);
      return this.#player.seek(0);
    }
    return utils.jsPromiseToKew(this.#player.previous());
  }

  getNowPlayingMetadataProvider() {
    return this.#nowPlayingMetadataProvider;
  }
}

export = ControllerYTCR;
