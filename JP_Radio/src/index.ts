import fs from 'fs';
import path from 'path';
import libQ from 'kew';
import VConf from 'v-conf';
import JpRadio from '@/controllers/radio-controller';
import { BrowseResult } from '@/models/browse-result-model';
import { createLoginAccount } from '@/logic/auth';
import { messageCatalog } from '@/utils/message-catalog';
import { I18N_DIR, UI_CONFIG_PATH, ASSETS_IMAGES_DIR } from '@/utils/plugin-paths';
import type { TimeFreeQuery } from '@/models/time-free-query-model';
import type { ProgInfoData } from '@/models/prog-info-model';
import { AREA_KANJI, AREA_REGIONS } from '@/consts/area-name';
import { LoggerEx } from '@/utils/logger';
import { getCurrentRadioTime, getCurrentRadioDate, getProgramTimeStatus, parseRadioTime, addDaysToDateOnly, addDaysToRadioTime, setRadioDelay } from '@/utils/radio-time';

export = ControllerJpRadio;

/**
 * Volumio4のmusic_serviceプラグインとして登録されるコントローラ。
 * Volumioのコア(CoreCommandRouter/CorePlayQueue)から各ライフサイクルメソッドを呼び出され、
 * 実際のRadikoストリーミング処理は{@link JpRadio}(Express製の内部HTTPサーバ)に委譲する。
 *
 * Volumioは一部のメソッドの戻り値に対して`.fail()`(kewのAPI)を呼び出すため、
 * それらのメソッドはネイティブPromiseではなくkew(`libQ`)ベースで実装する必要がある。
 */
class ControllerJpRadio {
  private context: any;
  private commandRouter: any;
  private logger: LoggerEx;
  private configManager: any;
  private config: InstanceType<typeof VConf> | null = null;
  private readonly serviceName = 'jp_radio';
  private appRadio: JpRadio | null = null;
  private mpdPlugin: any;

  /**
   * @param context Volumioコアから渡されるプラグインコンテキスト(coreCommand/logger/configManagerを含む)。
   */
  constructor(context: any) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = new LoggerEx(context.logger);
    this.configManager = context.configManager;
  }

  /**
   * UI設定画面の「再起動」操作から呼ばれる。onStop→onStartの順に再実行してプラグインを再起動する。
   */
  async restartPlugin(): Promise<void> {
    this.logger.info('IDX_I027');
    try {
      await this.onStop();
      await this.onStart();
    } catch {
      this.commandRouter.pushToastMessage(
        'error',
        messageCatalog.get('RESTART_FAILED_TITLE'),
        messageCatalog.get('RESTART_FAILED_MESSAGE'),
      );
    }
  }

  /**
   * 設定変更後にプラグインの再起動が必要な旨をVolumio UIのモーダルで通知する。
   */
  private showRestartModal(): void {
    const message = {
      title: messageCatalog.get('RESTART_MODAL_TITLE'),
      message: messageCatalog.get('RESTART_MODAL_MESSAGE'),
      size: 'lg',
      buttons: [
        {
          name: this.commandRouter.getI18nString('COMMON.RESTART'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'restartPlugin',
            data: {}
          }
        },
        {
          name: this.commandRouter.getI18nString('COMMON.CANCEL'),
          class: 'btn btn-info',
          emit: 'closeModals',
          payload: ''
        }
      ]
    };
    this.commandRouter.broadcastMessage('openModal', message);
  }

  /**
   * 再起動不要で即時反映される設定を保存した際に表示する軽量なトースト通知。
   */
  private pushSettingsSavedToast(): void {
    this.commandRouter.pushToastMessage('success', messageCatalog.get('APP_TITLE'), messageCatalog.get('SETTINGS_SAVED'));
  }

  /**
   * UIConfig.jsonのselect要素(`content.value`/`content.options`)に現在値を反映する。
   * `content.options[].label`はこの時点で既に`i18nJson`によって翻訳済みの文字列になっている。
   * @param content UIConfig.jsonのselect要素(`value`/`options`を持つオブジェクト)。
   * @param currentValue 現在の設定値。
   */
  private populateSelectValue(content: any, currentValue: string): void {
    content.value.value = currentValue;
    for (const option of content.options) {
      if (option.value === currentValue) {
        content.value.label = option.label;
        break;
      }
    }
  }

  /**
   * config.jsonから数値設定を取得する。旧バージョンからのアップグレードで永続化済み設定ファイルに
   * まだキーが存在しない場合、`config.get()`は`undefined`を返し`Number(undefined)`は`NaN`になってしまう
   * (例: node-cronのパターン文字列に混入してクラッシュする)ため、`NaN`ならデフォルト値にフォールバックする。
   * @param key 設定キー。
   * @param defaultValue キーが未設定または不正な場合に使うデフォルト値。
   */
  private getConfigNumber(key: string, defaultValue: number): number {
    const num = Number(this.config?.get(key));
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * 設定画面(`radikoAreas.JP1`~`radikoAreas.JP47`)で選択済みのエリアIDの一覧を返す。
   * 何も選択されていなければ空配列(→全国47エリアを取得するデフォルト動作)。
   */
  private getRadikoAreaIdArray(): string[] {
    if (this.config === null) {
      return [];
    }
    const areaIdArray: string[] = [];
    for (let i = 1; i <= 47; i++) {
      const areaId = `JP${i}`;
      if (this.config.get(`radikoAreas.${areaId}`) === true) {
        areaIdArray.push(areaId);
      }
    }
    return areaIdArray;
  }

  /**
   * エリア選択設定(`radiko_areas`)セクションの内容を、地域ごとにグループ化して動的に構築する。
   * この時点(`i18nJson`実行後)に新規追加する項目は翻訳の対象外になるため、ラベル等は
   * ここで直接最終的な文字列を組み立てる({@link messageCatalog}を使うのはそのため)。
   * @param section UIConfig.jsonの`radiko_areas`セクションオブジェクト。
   */
  private async populateRadikoAreasSection(section: any): Promise<void> {
    if (this.appRadio === null || this.config === null) {
      return;
    }
    section.hidden = false;
    section.content = [];
    section.saveButton.data = [];

    const myAreaInfo = await this.appRadio.getMyAreaId();
    const [myAreaId] = myAreaInfo.split('/');

    for (const region of AREA_REGIONS) {
      section.content.push({ label: region.name });
      for (const areaId of region.areaIdArray) {
        let label = AREA_KANJI.get(areaId);
        if (label === undefined) {
          label = areaId;
        }
        if (areaId === myAreaId) {
          label += messageCatalog.get('RADIKO_MY_AREA');
        }
        let value = this.config.get(`radikoAreas.${areaId}`);
        if (value !== true) {
          value = false;
        }
        section.content.push({
          id: areaId,
          element: 'switch',
          label,
          value,
          description: this.appRadio.getAreaStations(areaId).join(', '),
        });
        section.saveButton.data.push(areaId);
      }
      section.content.push({ label: '' });
    }
  }

  /**
   * UI設定画面で入力されたサービスポート番号・ネットワーク遅延補正値を保存する。
   * サービスポートの変更は内部サーバーの再バインドが必要なため再起動を促すが、ネットワーク遅延補正値は
   * {@link setRadioDelay}で即座に反映できるため、それだけの変更なら再起動は不要。
   * @param data 保存ボタンから渡される入力値。
   */
  async saveNetworkSetting(data: { servicePort: string; networkDelay: string }): Promise<void> {
    this.logger.info('IDX_I028');
    if (this.config === null) {
      return;
    }
    const newPort = Number(data.servicePort);
    const newDelay = Number(data.networkDelay);
    let portChanged = false;
    let delayChanged = false;
    if (isNaN(newPort) === false && this.config.get('servicePort') !== newPort) {
      this.config.set('servicePort', newPort);
      portChanged = true;
    }
    if (isNaN(newDelay) === false && this.config.get('networkDelay') !== newDelay) {
      this.config.set('networkDelay', newDelay);
      delayChanged = true;
    }
    if (portChanged === true) {
      this.showRestartModal();
    } else if (delayChanged === true) {
      setRadioDelay(newDelay);
      this.pushSettingsSavedToast();
    }
  }

  /**
   * UI設定画面で入力されたRadikoプレミアム会員のアカウント情報を保存し、変更があれば再起動を促す。
   * @param data 保存ボタンから渡される入力値。
   */
  async saveRadikoAccount(data: { radikoUser: string; radikoPass: string }): Promise<void> {
    this.logger.info('IDX_I029');
    if (this.config === null) {
      return;
    }
    const updated = (Object.keys(data) as Array<keyof typeof data>).some(
      (key) => this.config!.get(key) !== data[key]
    );
    if (updated === true) {
      this.config.set('radikoUser', data.radikoUser);
      this.config.set('radikoPass', data.radikoPass);
      this.showRestartModal();
    }
  }

  /**
   * UI設定画面で選択されたブラウズ動作(ライブ/タイムフリー選択時に直接再生するか、
   * 番組情報モーダルを表示するか)を保存する。ブラウズ時に都度参照される設定のため、
   * {@link JpRadio.updateBrowseMode}で即座に反映でき、再起動は不要。
   * @param data 保存ボタンから渡される選択値。
   */
  async saveBrowseModeSetting(data: { browseMode1: { value: string }; browseMode2: { value: string } }): Promise<void> {
    this.logger.info('IDX_I030');
    if (this.config === null) {
      return;
    }
    let updated = false;
    if (this.config.get('browseMode1') !== data.browseMode1.value) {
      updated = true;
    }
    if (this.config.get('browseMode2') !== data.browseMode2.value) {
      updated = true;
    }
    if (updated === true) {
      this.config.set('browseMode1', data.browseMode1.value);
      this.config.set('browseMode2', data.browseMode2.value);
      this.appRadio?.updateBrowseMode(data.browseMode1.value, data.browseMode2.value);
      this.pushSettingsSavedToast();
    }
  }

  /**
   * UI設定画面で選択されたタイムフリー再生速度を保存する。再生開始時に都度参照される設定のため、
   * {@link JpRadio.updateTempo}で即座に反映でき、再起動は不要。
   * @param data 保存ボタンから渡される選択値。
   */
  async saveTempoSetting(data: { tempo: { value: string } }): Promise<void> {
    this.logger.info('IDX_I031');
    if (this.config === null) {
      return;
    }
    if (this.config.get('tempo') !== data.tempo.value) {
      this.config.set('tempo', data.tempo.value);
      this.appRadio?.updateTempo(Number(data.tempo.value));
      this.pushSettingsSavedToast();
    }
  }

  /**
   * UI設定画面で選択されたアルバムアート取得方式を保存する。表示時に都度参照される設定のため、
   * {@link JpRadio.updateAlbumartType}で即座に反映でき、再起動は不要。
   * @param data 保存ボタンから渡される選択値。
   */
  async saveAlbumartSetting(data: { albumartType: { value: string } }): Promise<void> {
    this.logger.info('IDX_I032');
    if (this.config === null) {
      return;
    }
    if (this.config.get('albumartType') !== data.albumartType.value) {
      this.config.set('albumartType', data.albumartType.value);
      this.appRadio?.updateAlbumartType(data.albumartType.value);
      this.pushSettingsSavedToast();
    }
  }

  /**
   * UI設定画面の「局ロゴキャッシュのクリア」ボタンから呼ばれる。ローカルにキャッシュした局ロゴ画像
   * (`assets/images/*_logo.png`)を削除する。既存の`StationInfo.logoUrl`は既にこのファイルを指した
   * 状態でメモリ上に残るため、再取得させるためプラグインの再起動を促す。
   */
  async clearStationLogoCache(): Promise<void> {
    this.logger.info('IDX_I021');
    try {
      const files: string[] = await fs.promises.readdir(ASSETS_IMAGES_DIR).catch(() => [] as string[]);
      const logoFiles = files.filter((file: string) => file.endsWith('_logo.png'));
      await Promise.all(logoFiles.map((file: string) => fs.promises.unlink(path.join(ASSETS_IMAGES_DIR, file))));
      this.commandRouter.pushToastMessage('success', messageCatalog.get('APP_TITLE'), messageCatalog.get('STATION_LOGO_CLEAR'));
      this.showRestartModal();
    } catch (error: any) {
      this.logger.error('IDX_E012', error);
      this.commandRouter.pushToastMessage('error', messageCatalog.get('APP_TITLE'), messageCatalog.get('ERROR_GENERIC'));
    }
  }

  /**
   * UI設定画面で入力/選択された番組表のデフォルト表示期間・日時表示書式を保存する。番組表表示時に
   * 都度参照される設定のため、{@link JpRadio.updateTimetableDisplay}で即座に反映でき、再起動は不要。
   * @param data 保存ボタンから渡される入力値。
   */
  async saveTimetableDisplaySetting(data: {
    programPeriodFrom: string;
    programPeriodTo: string;
    timeFormat: { value: string };
  }): Promise<void> {
    this.logger.info('IDX_I033');
    if (this.config === null) {
      return;
    }
    const newFrom = Number(data.programPeriodFrom);
    const newTo = Number(data.programPeriodTo);
    let updated = false;
    if (isNaN(newFrom) === false && this.config.get('programPeriodFrom') !== newFrom) {
      this.config.set('programPeriodFrom', newFrom);
      updated = true;
    }
    if (isNaN(newTo) === false && this.config.get('programPeriodTo') !== newTo) {
      this.config.set('programPeriodTo', newTo);
      updated = true;
    }
    if (this.config.get('timeFormat') !== data.timeFormat.value) {
      this.config.set('timeFormat', data.timeFormat.value);
      updated = true;
    }
    if (updated === true) {
      this.appRadio?.updateTimetableDisplay(
        this.getConfigNumber('programPeriodFrom', 7),
        this.getConfigNumber('programPeriodTo', 0),
        this.config.get('timeFormat') || 'yyyy/MM/dd HH:mm-HH:mm',
      );
      this.pushSettingsSavedToast();
    }
  }

  /**
   * UI設定画面で選択されたエリア選択(`radikoAreas.<areaId>`)を保存し、変更があれば再起動を促す。
   * @param data キーがエリアID(例: 'JP13')、値がそのエリアを取得対象にするかどうかの真偽値。
   */
  async saveRadikoAreasSetting(data: Record<string, boolean>): Promise<void> {
    this.logger.info('IDX_I034');
    if (this.config === null) {
      return;
    }
    let updated = false;
    for (const [areaId, value] of Object.entries(data)) {
      const key = `radikoAreas.${areaId}`;
      if (this.config.get(key) !== value) {
        updated = true;
        this.config.set(key, value);
      }
    }
    if (updated === true) {
      this.showRestartModal();
    }
  }

  /**
   * Volumio起動時に最初に呼ばれるライフサイクルメソッド。config.jsonを読み込む。
   * また、この時点で初めてVolumioの`language_code`が分かるため、messageCatalogの表示言語も
   * ここで確定させる(ブラウズラベル・トースト通知・ログメッセージがVolumioのUI言語に追従するように)。
   * 以降、設定画面で言語が変更された場合もVolumio再起動なしに追従できるよう、
   * `sharedVars`の`language_code`変更コールバックも登録する(Volumioコア自身が
   * `appearance`プラグインの言語切り替え時に使っているのと同じ仕組み)。
   */
  onVolumioStart(): Promise<void> {
    this.logger.info('IDX_I035');
    const defer = libQ.defer();
    try {
      const langCode = this.commandRouter.sharedVars.get('language_code') || 'en';
      messageCatalog.setLanguage(langCode);
      this.commandRouter.sharedVars.registerCallback('language_code', (newLangCode: string) => {
        messageCatalog.setLanguage(newLangCode || 'en');
      });

      const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
      this.config = new VConf();
      this.config.loadFile(configFile);
      defer.resolve();
    } catch (error: any) {
      defer.reject(error);
    }
    return defer.promise;
  }

  /**
   * Volumioのシステムシャットダウン時に呼ばれるライフサイクルメソッド。
   * `onStop`はプラグインを無効化した時にしか自動で呼ばれないため、システム終了時にも内部サーバー・
   * cronタスクを確実に停止させ、再生キューの掃除も行うようここから明示的に呼び出す。
   */
  onVolumioShutdown(): Promise<void> {
    this.logger.info('IDX_I038');
    const defer = libQ.defer();
    this.onStop().then(() => defer.resolve(), (error: any) => defer.reject(error));
    return defer.promise;
  }

  /**
   * Volumioのシステム再起動時に呼ばれるライフサイクルメソッド。{@link onVolumioShutdown}と同様の理由で
   * `onStop`を明示的に呼び出す。
   */
  onVolumioReboot(): Promise<void> {
    this.logger.info('IDX_I039');
    const defer = libQ.defer();
    this.onStop().then(() => defer.resolve(), (error: any) => defer.reject(error));
    return defer.promise;
  }

  /**
   * プラグイン有効化時に呼ばれるライフサイクルメソッド。
   * 設定値からアカウント情報とサービスポートを取り出し、{@link JpRadio}を起動してブラウズソースに登録する。
   */
  onStart(): Promise<void> {
    this.logger.info('IDX_I001');
    const defer = libQ.defer();

    if (this.config === null) {
      this.logger.error('IDX_E001');
      defer.reject(new Error('Config not initialized'));
      return defer.promise;
    }

    // 同期的な初期化処理(設定読み込み・JpRadioの構築)で例外が起きた場合にプラグイン全体が
    // ハングしたりVolumioをクラッシュさせたりしないよう、try/catchで確実にdeferを解決する。
    try {
      this.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

      const radikoUser = this.config.get('radikoUser');
      const radikoPass = this.config.get('radikoPass');
      const servicePort = this.config.get('servicePort');
      const browseMode1 = this.config.get('browseMode1');
      const browseMode2 = this.config.get('browseMode2');
      const radikoAreaIdArray = this.getRadikoAreaIdArray();
      const tempo = this.getConfigNumber('tempo', 1);
      const programPeriodFrom = this.getConfigNumber('programPeriodFrom', 7);
      const programPeriodTo = this.getConfigNumber('programPeriodTo', 0);
      const timeFormat = this.config.get('timeFormat') || 'yyyy/MM/dd HH:mm-HH:mm';
      const albumartType = this.config.get('albumartType') || 'type3';
      const networkDelay = this.getConfigNumber('networkDelay', 20);
      const account = createLoginAccount(radikoUser, radikoPass);

      setRadioDelay(networkDelay);

      this.appRadio = new JpRadio(
        servicePort, this.logger, account, this.commandRouter, this.serviceName,
        browseMode1, browseMode2, radikoAreaIdArray, tempo,
        programPeriodFrom, programPeriodTo, timeFormat, albumartType,
      );
    } catch (error: any) {
      this.logger.error('IDX_E002', error);
      this.commandRouter.pushToastMessage(
        'error',
        messageCatalog.get('ERROR_BOOT_TITLE'),
        error?.message || messageCatalog.get('ERROR_UNKNOWN'),
      );
      defer.reject(error);
      return defer.promise;
    }

    this.appRadio.start()
      .then(() => {
        this.addToBrowseSources();
        defer.resolve();
        this.logger.info('IDX_I002');
      })
      .catch((error: any) => {
        this.logger.error('IDX_E002', error);
        if (error.code === 'EADDRINUSE') {
          const message = messageCatalog.get('ERROR_PORT_IN_USE', this.config!.get('servicePort'));
          this.logger.error('IDX_E003', message);
          this.commandRouter.pushToastMessage('error', messageCatalog.get('ERROR_BOOT_TITLE'), message);
        } else {
          this.commandRouter.pushToastMessage(
            'error',
            messageCatalog.get('ERROR_BOOT_TITLE'),
            error.message || messageCatalog.get('ERROR_UNKNOWN'),
          );
        }
        defer.reject(error);
      });
    this.logger.info('IDX_I003');
    return defer.promise;
  }

  /**
   * プラグイン無効化時に呼ばれるライフサイクルメソッド。JpRadioを停止し、ブラウズソースから除去する。
   * アンインストール時もVolumioは無効化(停止)を経由してから削除するため、ここが両方をカバーする。
   */
  onStop(): Promise<void> {
    this.logger.info('IDX_I004');
    this.removeOwnQueueItems();
    const defer = libQ.defer();
    const stopPromise = this.appRadio !== null ? this.appRadio.stop() : Promise.resolve();
    stopPromise
      .catch((error: any) => {
        this.logger.error('IDX_E004', error);
      })
      .then(() => {
        this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
        defer.resolve();
      });
    return defer.promise;
  }

  /**
   * 再生キューからこのプラグイン(`jp_radio`)が追加した項目を全て取り除く。プラグインを停止・アンインストール
   * すると局を再生できなくなるため、キューに再生不能な項目を残さないようにする({@link onStop}から呼ばれる)。
   */
  private removeOwnQueueItems(): void {
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    const filteredQueue = arrayQueue.filter((item: any) => item.service !== this.serviceName);
    if (filteredQueue.length === arrayQueue.length) {
      return;
    }
    this.logger.info('IDX_I026', arrayQueue.length - filteredQueue.length);
    this.commandRouter.stateMachine.playQueue.arrayQueue = filteredQueue;
    this.commandRouter.stateMachine.playQueue.saveQueue();
    this.commandRouter.volumioPushQueue(filteredQueue);
  }

  /**
   * UI設定画面(UIConfig.json)を多言語化しつつ、現在の設定値を埋め込んで返す。
   */
  getUIConfig(): Promise<any> {
    this.logger.info('IDX_I005');
    const defer = libQ.defer();

    if (this.config === null) {
      const error = new Error('Config not initialized');
      this.logger.error('IDX_E005', error);
      defer.reject(error);
      return defer.promise;
    }

    const langCode = this.commandRouter.sharedVars.get('language_code') || 'en';

    this.commandRouter.i18nJson(
      path.join(I18N_DIR, `strings_${langCode}.json`),
      path.join(I18N_DIR, 'strings_en.json'),
      UI_CONFIG_PATH
    )
      .then(async (uiconf: any) => {
        const servicePort = this.config!.get('servicePort');
        const networkDelay = this.getConfigNumber('networkDelay', 20);
        const radikoUser = this.config!.get('radikoUser');
        const radikoPass = this.config!.get('radikoPass');

        if (uiconf.sections?.[0]?.content?.[0] !== undefined) {
          uiconf.sections[0].content[0].value = servicePort;
        }
        if (uiconf.sections?.[0]?.content?.[1] !== undefined) {
          uiconf.sections[0].content[1].value = networkDelay;
        }
        if (uiconf.sections?.[1]?.content?.[0] !== undefined) {
          uiconf.sections[1].content[0].value = radikoUser;
        }
        if (uiconf.sections?.[1]?.content?.[1] !== undefined) {
          uiconf.sections[1].content[1].value = radikoPass;
        }
        if (uiconf.sections?.[2]?.content?.[0] !== undefined) {
          this.populateSelectValue(uiconf.sections[2].content[0], this.config!.get('browseMode1'));
        }
        if (uiconf.sections?.[2]?.content?.[1] !== undefined) {
          this.populateSelectValue(uiconf.sections[2].content[1], this.config!.get('browseMode2'));
        }
        if (uiconf.sections?.[3]?.content?.[0] !== undefined) {
          this.populateSelectValue(uiconf.sections[3].content[0], this.config!.get('tempo'));
        }
        if (uiconf.sections?.[4]?.content?.[0] !== undefined) {
          this.populateSelectValue(uiconf.sections[4].content[0], this.config!.get('albumartType') || 'type3');
        }
        if (uiconf.sections?.[5]?.content?.[0] !== undefined) {
          uiconf.sections[5].content[0].value = this.getConfigNumber('programPeriodFrom', 7);
        }
        if (uiconf.sections?.[5]?.content?.[1] !== undefined) {
          uiconf.sections[5].content[1].value = this.getConfigNumber('programPeriodTo', 0);
        }
        if (uiconf.sections?.[5]?.content?.[2] !== undefined) {
          this.populateSelectValue(uiconf.sections[5].content[2], this.config!.get('timeFormat') || 'yyyy/MM/dd HH:mm-HH:mm');
        }
        if (uiconf.sections?.[6] !== undefined && radikoUser !== '' && radikoPass !== '') {
          await this.populateRadikoAreasSection(uiconf.sections[6]);
        }

        defer.resolve(uiconf);
      })
      .fail((error: any) => {
        this.logger.error('IDX_E005', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * このプラグインが使用する設定ファイル名の一覧をVolumioに伝える。
   */
  getConfigurationFiles(): string[] {
    this.logger.info('IDX_I036');
    return ['config.json'];
  }

  /**
   * VolumioのBrowseメニューに「RADIKO」ソースを追加する。選択時はカテゴリ選択のルートメニュー
   * ({@link JpRadio.rootMenu})を表示する。
   */
  addToBrowseSources(): void {
    this.logger.info('IDX_I006', this.serviceName);
    this.commandRouter.volumioAddToBrowseSources({
      name: 'RADIKO',
      uri: 'radiko',
      plugin_type: 'music_service',
      plugin_name: this.serviceName,
      albumart: '/albumart?sourceicon=music_service/jp_radio/assets/images/app_radiko.svg'
    });
  }

  /**
   * BrowseメニューでURIが選択された際に呼ばれ、対応するブラウズ結果を返す。
   * `radiko` → ルートメニュー(ライブ/タイムフリー)、`radiko/live` → {@link JpRadio.radioStations}、
   * `radiko/timefree` → {@link JpRadio.timeFreeStations}、
   * `radiko/timetable/<stationId>` → {@link JpRadio.stationTimetable}、
   * `radiko/proginfo/<stationId>[?ft=&to=]` → 番組情報モーダルを表示(ブラウズ結果は返さず空を返す)。
   * @param curUri 選択されたURI。
   */
  handleBrowseUri(curUri: string): Promise<BrowseResult | Record<string, never>> {
    this.logger.info('IDX_I025', curUri);
    const defer = libQ.defer();
    const [baseUri, queryString] = curUri.split('?');

    const appRadio = this.appRadio;
    if (appRadio === null) {
      this.logger.error('IDX_E006');
      defer.resolve({});
      return defer.promise;
    }

    const segments = baseUri.split('/');

    if (segments[0] === 'radiko' && segments[1] === 'proginfo' && segments[2] !== undefined) {
      const stationId = segments[2];
      let timeFreeQuery: TimeFreeQuery | undefined;
      if (queryString !== undefined) {
        const params = new URLSearchParams(queryString);
        const ft = params.get('ft');
        const to = params.get('to');
        if (ft !== null && to !== null) {
          timeFreeQuery = { ft, to };
        }
      }

      libQ.resolve()
        .then(() => appRadio.progInfo(stationId, timeFreeQuery))
        .then((data: ProgInfoData | null) => {
          if (data !== null) {
            this.showProgInfoModal(data);
          }
          defer.resolve({});
        })
        .fail((error: any) => {
          this.logger.error('IDX_E007', error);
          defer.reject(error);
        });

      return defer.promise;
    }

    if (segments[0] === 'radiko' && segments[1] === 'progreg' && segments[2] !== undefined) {
      const stationId = segments[2];
      let timeFreeQuery: TimeFreeQuery | undefined;
      if (queryString !== undefined) {
        const params = new URLSearchParams(queryString);
        const ft = params.get('ft');
        const to = params.get('to');
        if (ft !== null && to !== null) {
          timeFreeQuery = { ft, to };
        }
      }

      libQ.resolve()
        .then(() => appRadio.progInfo(stationId, timeFreeQuery))
        .then((data: ProgInfoData | null) => {
          if (data !== null) {
            // お気に入り一覧から開いた直後は、まだ日付をずらしていないので oldUri === uri
            this.showProgRegModal({ ...data, oldUri: data.uri });
          }
          defer.resolve({});
        })
        .fail((error: any) => {
          this.logger.error('IDX_E007', error);
          defer.reject(error);
        });

      return defer.promise;
    }

    let task: Promise<BrowseResult> | null;
    if (baseUri === 'radiko') {
      task = appRadio.rootMenu();
    } else if (baseUri === 'radiko/live') {
      task = appRadio.radioStations();
    } else if (baseUri === 'radiko/live/favourites') {
      task = appRadio.radioFavouriteStations('live');
    } else if (baseUri === 'radiko/timefree') {
      task = appRadio.timeFreeStations();
    } else if (baseUri === 'radiko/timefree_today') {
      task = appRadio.timeFreeStations('today');
    } else if (baseUri === 'radiko/timefree/favourites') {
      task = appRadio.radioFavouriteStations('timefree');
    } else if (segments[0] === 'radiko' && segments[1] === 'timetable_today' && segments[2] !== undefined) {
      task = appRadio.stationTimetable(segments[2], { isToday: true });
    } else if (segments[0] === 'radiko' && segments[1] === 'timetable' && segments[2] !== undefined) {
      let timetableOpts: { ft?: string; to?: string } | undefined;
      if (queryString !== undefined) {
        const params = new URLSearchParams(queryString);
        const ft = params.get('ft');
        const to = params.get('to');
        if (ft !== null && to !== null) {
          timetableOpts = { ft, to };
        }
      }
      task = appRadio.stationTimetable(segments[2], timetableOpts);
    } else {
      task = null;
    }

    if (task === null) {
      this.logger.error('IDX_E008');
      defer.resolve({});
      return defer.promise;
    }

    libQ.resolve()
      .then(() => task)
      .then((result: any) => defer.resolve(result))
      .fail((error: any) => {
        this.logger.error('IDX_E007', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * 番組情報モーダルを表示する。「再生」「キューに追加」ボタンは{@link playFromProgInfoModal}/
   * {@link addQueueFromProgInfoModal}を`callMethod`で呼び出し、`data`(explodeUriと同形式)をそのまま渡す。
   * @param data モーダルに表示する番組情報(再生キューへそのまま渡せる形式)。
   */
  private showProgInfoModal(data: ProgInfoData): void {
    let message = `<div>${data.artist}</div>`;
    if (data.album !== '') {
      message += `<div>${messageCatalog.get('PROGINFO_PERFORMER')}${data.album}</div>`;
    }
    const modalMessage = {
      title: messageCatalog.get('PROGINFO_PROG_INFO') + data.title,
      message,
      size: 'lg',
      buttons: [
        {
          name: messageCatalog.get('PROGINFO_PLAY'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'playFromProgInfoModal',
            data
          }
        },
        {
          name: messageCatalog.get('PROGINFO_ADD_TO_QUEUE'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'addQueueFromProgInfoModal',
            data
          }
        },
        {
          name: messageCatalog.get('PROGINFO_ADD_TO_FAVOURITES'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'addFavouriteFromProgInfoModal',
            data
          }
        },
        {
          name: this.commandRouter.getI18nString('COMMON.CLOSE'),
          class: 'btn btn-warning',
          emit: 'closeModals',
          payload: ''
        }
      ]
    };

    // タイムフリー番組(?ft=&to=付き)のみ、放送状態に応じて再生系ボタンを出し分ける
    const [, queryStr] = data.uri.split('?');
    if (queryStr !== undefined) {
      const params = new URLSearchParams(queryStr);
      const ft = params.get('ft');
      const to = params.get('to');
      if (ft !== null && to !== null) {
        const currentRadioTime = getCurrentRadioTime();
        const farFutureCutoffDate = addDaysToDateOnly(parseRadioTime(currentRadioTime).date, 7);
        if (parseRadioTime(ft).date > farFutureCutoffDate) {
          // 7日以上先の番組は再生/キュー/お気に入りボタンを全て非表示
          modalMessage.buttons.splice(0, 3);
        } else if (getProgramTimeStatus(ft, to, currentRadioTime) !== 'past') {
          // 配信前・放送中(追っかけ再生になる)は再生/キューボタンのみ非表示
          modalMessage.buttons.splice(0, 2);
        }
      }
    }

    this.commandRouter.broadcastMessage('openModal', modalMessage);
  }

  /**
   * お気に入り一覧から個別番組を選択した際に表示する「登録済みお気に入りの管理」モーダル。
   * 「翌日」「翌週」「翌々週」ボタンで同じ時間帯の別の日の番組に表示を切り替えながら、最終的に
   * 「お気に入りを更新」(表示中の番組で置き換え)または「お気に入りから削除」を選べる。
   * `data.oldUri`が実際に登録されているお気に入りのURI、`data.uri`が現在モーダルに表示中の番組のURIで、
   * 両者が一致する間は「更新」を、日付をずらして一致しなくなったら「削除」を隠す({@link showProgInfoModal}とは
   * 独立したモーダルにしているのは、通常のブラウズ再生と競合させないため)。
   * @param data 表示中の番組情報+`oldUri`(実際に登録されているお気に入りのURI)。
   */
  private showProgRegModal(data: ProgInfoData & { oldUri: string }): void {
    let message = `<div>${data.artist}</div>`;
    if (data.album !== '') {
      message += `<div>${messageCatalog.get('PROGINFO_PERFORMER')}${data.album}</div>`;
    }
    const modalMessage = {
      title: messageCatalog.get('PROGINFO_PROG_INFO') + data.title,
      message,
      size: 'lg',
      buttons: [
        {
          name: messageCatalog.get('PROGREG_NEXT_DAY'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'changeDateFromProgRegModal',
            data: { ...data, days: 1 }
          }
        },
        {
          name: messageCatalog.get('PROGREG_NEXT_WEEK'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'changeDateFromProgRegModal',
            data: { ...data, days: 7 }
          }
        },
        {
          name: messageCatalog.get('PROGREG_NEXT_2WEEK'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'changeDateFromProgRegModal',
            data: { ...data, days: 14 }
          }
        },
        {
          name: messageCatalog.get('PROGREG_UPDATE_FAVOURITES'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'updateFavouriteFromProgRegModal',
            data
          }
        },
        {
          name: messageCatalog.get('PROGREG_REMOVE_FROM_FAVOURITES'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'removeFavouriteFromProgRegModal',
            data
          }
        },
        {
          name: this.commandRouter.getI18nString('COMMON.CLOSE'),
          class: 'btn btn-warning',
          emit: 'closeModals',
          payload: ''
        }
      ]
    };

    if (data.oldUri === data.uri) {
      // まだ日付をずらしていない(登録済みのまま) → 「更新」ボタンは無意味なので消す
      modalMessage.buttons.splice(3, 1);
    } else {
      // 日付をずらした(別の番組に切り替えた) → 「削除」ボタンは無意味なので消す
      modalMessage.buttons.splice(4, 1);
    }

    this.commandRouter.broadcastMessage('openModal', modalMessage);
  }

  /**
   * {@link showProgRegModal}の「翌日」「翌週」「翌々週」ボタンから呼ばれる。表示中の番組の`ft`/`to`を
   * 指定日数分シフトした番組情報を取得し直し、同じモーダルを再表示する(`oldUri`は元の登録URIのまま引き継ぐ)。
   * @param data 表示中の番組情報+`oldUri`+シフトする日数(`days`)。
   */
  async changeDateFromProgRegModal(data: ProgInfoData & { oldUri: string; days: number }): Promise<void> {
    this.logger.info('IDX_I022', data.days);

    const [liveUri, queryStr] = data.uri.split('?');
    if (queryStr === undefined) {
      return;
    }
    const params = new URLSearchParams(queryStr);
    const ft = params.get('ft');
    const to = params.get('to');
    const stationId = liveUri.split('/').pop();
    if (ft === null || to === null || stationId === undefined) {
      return;
    }

    const newFt = addDaysToRadioTime(ft, data.days);
    const newTo = addDaysToRadioTime(to, data.days);

    const appRadio = this.appRadio;
    if (appRadio === null) {
      return;
    }
    const newData = await appRadio.progInfo(stationId, { ft: newFt, to: newTo });
    if (newData !== null) {
      this.showProgRegModal({ ...newData, oldUri: data.oldUri });
    }
  }

  /**
   * {@link showProgRegModal}の「お気に入りを更新」ボタンから呼ばれる。元のお気に入り登録(`oldUri`)を削除し、
   * 現在表示中の番組(`uri`)を新たに登録する。
   * @param data 表示中の番組情報+`oldUri`(削除対象の旧登録URI)。
   */
  async updateFavouriteFromProgRegModal(data: ProgInfoData & { oldUri: string }): Promise<void> {
    this.logger.info('IDX_I023', data.uri);
    await this.commandRouter.playListManager.commonRemoveFromPlaylist(
      this.commandRouter.playListManager.favouritesPlaylistFolder, 'radio-favourites', 'webradio', data.oldUri
    );
    await this.commandRouter.playListManager.commonAddToPlaylist(
      this.commandRouter.playListManager.favouritesPlaylistFolder, 'radio-favourites', 'webradio', data.uri, data.title, data.albumart
    );
    this.commandRouter.pushToastMessage('success', messageCatalog.get('APP_TITLE'), messageCatalog.get('FAVOURITE_UPDATED', data.title));
  }

  /**
   * {@link showProgRegModal}の「お気に入りから削除」ボタンから呼ばれる。
   * @param data `oldUri`(削除対象の登録URI)を含む番組情報。
   */
  async removeFavouriteFromProgRegModal(data: ProgInfoData & { oldUri: string }): Promise<void> {
    this.logger.info('IDX_I024', data.oldUri);
    await this.commandRouter.playListManager.commonRemoveFromPlaylist(
      this.commandRouter.playListManager.favouritesPlaylistFolder, 'radio-favourites', 'webradio', data.oldUri
    );
    this.commandRouter.pushToastMessage('success', messageCatalog.get('APP_TITLE'), messageCatalog.get('FAVOURITE_REMOVED', data.title));
  }

  /**
   * 番組情報モーダルの「再生」ボタンから呼ばれる。対象トラックを再生キューの先頭に追加して即再生する。
   * @param data {@link showProgInfoModal}のボタンから渡されるトラック情報。
   */
  playFromProgInfoModal(data: any): void {
    this.logger.info('IDX_I007', data.uri);
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    arrayQueue.unshift(data);
    this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
    this.commandRouter.volumioPushQueue(arrayQueue);
    this.commandRouter.volumioPlay(0);
  }

  /**
   * 番組情報モーダルの「キューに追加」ボタンから呼ばれる。対象トラックを再生キューの末尾に追加する。
   * @param data {@link showProgInfoModal}のボタンから渡されるトラック情報。
   */
  addQueueFromProgInfoModal(data: any): void {
    this.logger.info('IDX_I008', data.uri);
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    arrayQueue.push(data);
    this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
    this.commandRouter.stateMachine.playQueue.saveQueue();
    this.commandRouter.volumioPushQueue(arrayQueue);
  }

  /**
   * キューのトラック選択時に呼ばれ、mpdのキューをクリアして再生対象のURIを追加・再生する。
   * タイムフリーの`?ft=&to=`が不正、または番組が配信前/放送中(追っかけ再生は不安定なため)の場合は、
   * ライブ再生のURIにフォールバックしてトースト通知する。
   * @param track 再生キュー内のトラック情報(`uri`を含む)。
   */
  async clearAddPlayTrack(track: any): Promise<any> {
    this.logger.info('IDX_I009', track.uri);

    let uri: string = track.uri;
    if (uri.includes('/radiko/play/') === true) {
      const [liveUri, queryStr] = uri.split('?');
      if (queryStr !== undefined && queryStr !== '') {
        const params = new URLSearchParams(queryStr);
        const ft = params.get('ft');
        const to = params.get('to');
        if (ft === null || to === null || ft.length !== 14 || to.length !== 14) {
          this.logger.warn('IDX_W001', uri);
          this.commandRouter.pushToastMessage('error', messageCatalog.get('APP_TITLE'), messageCatalog.get('ERROR_INVALID_TIMEFREE_PARAMS'));
          uri = liveUri;
        } else {
          const status = getProgramTimeStatus(ft, to, getCurrentRadioTime());
          if (status === 'future') {
            this.logger.warn('IDX_W002', uri);
            this.commandRouter.pushToastMessage('info', messageCatalog.get('APP_TITLE'), messageCatalog.get('WARNING_SWITCH_LIVE_FUTURE'));
            uri = liveUri;
          } else if (status === 'live') {
            this.logger.warn('IDX_W003', uri);
            this.commandRouter.pushToastMessage('info', messageCatalog.get('APP_TITLE'), messageCatalog.get('WARNING_SWITCH_LIVE_CATCHUP'));
            uri = liveUri;
          }
        }
      }
    }

    const safeUri = uri.replace(/"/g, '\\"');
    await this.mpdPlugin.sendMpdCommand('stop', []);
    await this.mpdPlugin.sendMpdCommand('clear', []);
    await this.mpdPlugin.sendMpdCommand(`add "${safeUri}"`, []);
    this.commandRouter.stateMachine.setConsumeUpdateService('mpd');
    return this.mpdPlugin.sendMpdCommand('play', []);
  }

  /**
   * タイムフリー再生中はシーク位置付きの新URIに差し替える(`add`でキュー末尾に追加後、再生中だった項目を
   * `delete 0`で削除すると、mpdは残った項目の再生へ自動的に進む)。
   * ライブ再生中は、過去方向へのシークのみ現在放送中の番組の「追っかけ再生」(タイムフリー相当)に切り替える。
   * 未来方向のシークは不可能なため、{@link JpRadio.forcePushSongState}でタイムバーを元の位置に戻してrejectする。
   * @param timepos シーク先の再生位置(ミリ秒)。
   */
  seek(timepos: number): Promise<any> {
    this.logger.info('IDX_I010', timepos);
    const defer = libQ.defer();

    (async () => {
      const currentSong = await this.mpdPlugin.sendMpdCommand('currentsong', []);
      const uri: string = currentSong.file;
      if (typeof uri !== 'string' || uri.includes('/radiko/play/') === false) {
        throw new Error('Not a JP Radio track');
      }

      const [liveUri, queryStr] = uri.split('?');
      if (queryStr === undefined || queryStr === '') {
        // ライブ：過去方向のシークのみ、現在放送中の番組を追っかけ再生に切り替える
        const currentState = this.commandRouter.stateMachine.getState();
        const stationId = liveUri.split('/').pop();
        if (typeof currentState?.seek === 'number' && timepos < currentState.seek && stationId !== undefined) {
          const program = await this.appRadio?.getCurrentProgramWindow(stationId);
          if (program !== null && program !== undefined) {
            const seekSec = Math.round(timepos / 1000);
            const catchUpUri = `${liveUri}?ft=${program.ft}&to=${program.tt}&seek=${seekSec}`;
            await this.mpdPlugin.sendMpdCommand(`add "${catchUpUri}"`, []);
            await this.mpdPlugin.sendMpdCommand('delete 0', []);
            return;
          }
        }
        await this.appRadio?.forcePushSongState();
        throw new Error('Seek is not supported for live playback');
      }

      const seekSec = Math.round(timepos / 1000);
      const newUri = `${liveUri}?${queryStr.replace(/&?seek=\d+/, '')}&seek=${seekSec}`;
      await this.mpdPlugin.sendMpdCommand(`add "${newUri}"`, []);
      await this.mpdPlugin.sendMpdCommand('delete 0', []);
    })()
      .then(() => defer.resolve())
      .catch((error: any) => {
        this.logger.error('IDX_E010', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * mpdへ再生停止コマンドを送る。
   */
  stop(): Promise<any> {
    this.logger.info('IDX_I011');
    return this.mpdPlugin.sendMpdCommand('stop', []);
  }

  /**
   * mpdへ一時停止コマンドを送る。
   */
  pause(): Promise<any> {
    this.logger.info('IDX_I012');
    return this.mpdPlugin.sendMpdCommand('pause', []);
  }

  /**
   * Volumioコアのインターフェース要件上必要だが、本プラグインでは未使用。
   */
  getState(): void {
    this.logger.info('IDX_I013');
  }

  /**
   * Volumioコアのインターフェース要件上必要だが、本プラグインでは未使用。
   */
  parseState(_sState: any): void {
    this.logger.info('IDX_I014');
  }

  /**
   * 再生状態をVolumioコアへプッシュする。
   * @param state プッシュする再生状態。
   */
  pushState(state: any): any {
    this.logger.info('IDX_I015');
    return this.commandRouter.servicePushState(state, this.serviceName);
  }

  /**
   * キュー内のURI(`http://localhost:9000/radiko/play/{stationID}`)を
   * clearAddPlayTrackが要求するトラック情報オブジェクトに展開する。
   * タイトルやアルバムアートなどの表示用メタデータはURIに含めず、{@link JpRadio.getTrackMeta}で都度取得し直す
   * (長い日本語テキストや画像URLをそのままURIに埋め込みたくないため)。
   * タイムフリー再生時は`?ft=&to=`クエリで放送区間を受け取る。
   * @param uri キュー内のURI。
   */
  explodeUri(uri: string): Promise<any> {
    this.logger.info('IDX_I016', uri);
    const defer = libQ.defer();

    // uri=http://localhost:9000/radiko/play/FMT[?ft=...&to=...]
    const parsedUri = new URL(uri);
    const segments = parsedUri.pathname.split('/');
    const serviceId = segments[1];
    const stationId = segments[3];
    const ft = parsedUri.searchParams.get('ft');
    const to = parsedUri.searchParams.get('to');

    const appRadio = this.appRadio;
    if (serviceId !== 'radiko' || appRadio === null) {
      defer.resolve();
      return defer.promise;
    }

    let timeFreeQuery: TimeFreeQuery | undefined;
    if (ft !== null && to !== null) {
      timeFreeQuery = { ft, to };
    } else {
      timeFreeQuery = undefined;
    }

    libQ.resolve()
      .then(() => appRadio.getTrackMeta(stationId, timeFreeQuery))
      .then((meta: any) => {
        if (meta === null) {
          defer.resolve({});
          return;
        }
        defer.resolve({
          // clearAddPlayTrackを呼び出す先のサービス名
          service: this.serviceName,
          type: 'song',
          title: meta.title,
          name: meta.title,
          artist: meta.artist,
          album: meta.album,
          albumart: meta.albumart,
          uri,
        });
      })
      .fail((error: any) => {
        this.logger.error('IDX_E009', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * ユーザーが曲をプレイリストやお気に入りに追加した際にVolumioから呼ばれる。{@link explodeUri}と同じ
   * 情報源(局名・番組情報)を使い、アーティスト名等を含む完全なメタデータを返す
   * (`explodeUri`は単一オブジェクトを返すが、こちらは配列で返す必要がある)。
   * @param uri キュー内のURI。
   */
  getTrackInfo(uri: string): Promise<any[]> {
    this.logger.info('IDX_I040', uri);
    const defer = libQ.defer();

    libQ.resolve()
      .then(() => this.explodeUri(uri))
      .then((track: any) => defer.resolve([track]))
      .fail((error: any) => {
        this.logger.error('IDX_E014', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * Volumioの検索画面から呼ばれる。局名・ローマ字局名にキーワードを含む局を検索結果として返す。
   * @param query `value`に検索キーワードを含むオブジェクト。
   */
  search(query: { value?: string }): Promise<any> {
    this.logger.info('IDX_I037', JSON.stringify(query));
    const defer = libQ.defer();

    const appRadio = this.appRadio;
    const keyword = query?.value?.trim();
    if (appRadio === null || keyword === undefined || keyword === '') {
      defer.resolve([]);
      return defer.promise;
    }

    libQ.resolve()
      .then(() => appRadio.searchStations(keyword))
      .then((result: any) => defer.resolve(result))
      .fail((error: any) => {
        this.logger.error('IDX_E013', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * 再生画面の「アーティストへ移動」「アルバムへ移動」から呼ばれる。対象局の番組表(タイムフリー再生中なら
   * その放送日、ライブ再生中なら当日)へブラウズ画面を遷移させる。
   * @param data `uri`(再生中トラックのURI)を含む。
   */
  goto(data: any): Promise<any> {
    this.logger.info('IDX_I017', JSON.stringify(data));
    const defer = libQ.defer();

    const appRadio = this.appRadio;
    if (typeof data?.uri !== 'string' || data.uri.includes('/radiko/play/') === false || appRadio === null) {
      defer.resolve({});
      return defer.promise;
    }

    const [liveUri, queryStr] = data.uri.split('?');
    const stationId = liveUri.split('/').pop();
    if (stationId === undefined) {
      defer.resolve({});
      return defer.promise;
    }

    let dateOnly = getCurrentRadioDate();
    if (queryStr !== undefined) {
      const ft = new URLSearchParams(queryStr).get('ft');
      if (ft !== null) {
        dateOnly = parseRadioTime(ft).date;
      }
    }

    libQ.resolve()
      .then(() => appRadio.stationTimetable(stationId, { ft: dateOnly, to: dateOnly }))
      .then((result: any) => defer.resolve(result))
      .fail((error: any) => {
        this.logger.error('IDX_E011', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * Volumioのお気に入り機能(`commonAddToPlaylist`)は`title`/`albumart`しか保存できず、アーティスト名を
   * 保存する仕組みが無い。そのため、Volumio標準の「お気に入り」画面から直接再生すると、アーティスト欄が
   * 空になりサービス名の「webradio」がそのまま表示されてしまう。この制約はVolumio側のAPI仕様上直せないため、
   * 代わりに保存する`title`自体に局名・時間帯(`artist`)を含めて、1行で情報が完結するようにする。
   * @param title 番組タイトル。
   * @param artist 局名・時間帯などの補足情報(例: `'東京 / TBSラジオ 21:00-21:30'`)。
   */
  private buildFavouriteTitle(title: string, artist?: string): string {
    if (artist === undefined || artist === '') {
      return title;
    }
    return `${title} (${artist})`;
  }

  /**
   * 番組情報モーダルの「お気に入りに追加」ボタンから呼ばれる。Volumioコアの「radio-favourites」
   * プレイリストへ直接書き込む({@link JpRadio.radioFavouriteStations}が読み出す先と同じ)。
   * @param data {@link showProgInfoModal}のボタンから渡される番組情報。
   */
  addFavouriteFromProgInfoModal(data: ProgInfoData): void {
    this.logger.info('IDX_I018', data.uri);
    this.commandRouter.pushToastMessage(
      'success',
      messageCatalog.get('APP_TITLE'),
      messageCatalog.get('FAVOURITE_ADDED', data.title)
    );
    this.commandRouter.playListManager.commonAddToPlaylist(
      this.commandRouter.playListManager.favouritesPlaylistFolder,
      'radio-favourites',
      'webradio',
      data.uri,
      this.buildFavouriteTitle(data.title, data.artist),
      data.albumart
    );
  }

  /**
   * Browse画面のハートアイコン(お気に入り追加)から、Volumioコアがこのプラグインのサービス名宛てに
   * 呼び出す。{@link addFavouriteFromProgInfoModal}と同じ「radio-favourites」プレイリストへ書き込む。
   * @param data `uri`/`title`/`artist`/`albumart`を含むお気に入り登録対象の情報。
   */
  addToFavourites(data: { uri: string; title?: string; artist?: string; albumart?: string }): Promise<any> {
    this.logger.info('IDX_I019', data.uri);
    return this.commandRouter.playListManager.commonAddToPlaylist(
      this.commandRouter.playListManager.favouritesPlaylistFolder,
      'radio-favourites',
      'webradio',
      data.uri,
      this.buildFavouriteTitle(data.title ?? '', data.artist),
      data.albumart
    );
  }

  /**
   * Browse画面のハートアイコン(お気に入り解除)から、Volumioコアがこのプラグインのサービス名宛てに
   * 呼び出す。
   * @param data `uri`を含むお気に入り解除対象の情報。
   */
  removeFromFavourites(data: { uri: string }): Promise<any> {
    this.logger.info('IDX_I020', data.uri);
    return this.commandRouter.playListManager.commonRemoveFromPlaylist(
      this.commandRouter.playListManager.favouritesPlaylistFolder,
      'radio-favourites',
      'webradio',
      data.uri
    );
  }
}
