import express, { Application, Request, Response } from 'express';
import cron from 'node-cron';
import RdkProg from '@/services/prog-service';
import Radiko from '@/services/radiko-service';
import StreamSession from '@/services/stream-session-service';
import type { BrowseItem, BrowseList, BrowseResult } from '@/models/browse-result-model';
import type { StationInfo } from '@/models/station-model';
import type { LoginAccount } from '@/models/auth-model';
import type { TrackMeta } from '@/models/track-meta-model';
import type { TimeFreeQuery } from '@/models/time-free-query-model';
import type { ProgInfoData } from '@/models/prog-info-model';

import {
  getRadioDelay, getCurrentRadioTime, getCurrentDate, formatTimeString, formatHourMinute, getTimeSpan,
  revCnvRadioTime, addSecondsToTimeString, parseRadioTime, getProgramTimeStatus, formatDateOnly, addDaysToDateOnly,
  formatRadioTimeRange,
} from '@/utils/radio-time';
import { resolveAreaIdArray, resolveAreaFilter } from '@/logic/area-resolver';
import { messageCatalog } from '@/utils/message-catalog';
import type { LoggerEx } from '@/utils/logger';


/**
 * RadikoストリーミングのためのExpress HTTPサーバ兼コントローラ。
 * {@link Radiko}(Model)から局一覧・番組データを取得してVolumioのBrowse/再生用データに変換し、
 * `/radiko/play/:stationID`へのリクエストごとに{@link StreamSession}でffmpegストリームを開始する。
 */
export default class JpRadio {
  private readonly app: Application;
  private server: ReturnType<Application['listen']> | null = null;
  private readonly task1: ReturnType<typeof cron.schedule>;
  private readonly task2: ReturnType<typeof cron.schedule>;
  private readonly port: number;
  private readonly logger: LoggerEx;
  private readonly acct: LoginAccount | null;
  private readonly commandRouter: any;
  private prg: RdkProg | null = null;
  private rdk: Radiko | null = null;
  private station: string = '';
  private task2Cnt: number = 0;

  private readonly serviceName: string;
  // 以下は設定画面から再起動無しで変更を反映できるよう、あえてreadonlyにしていない
  // (詳細は末尾のupdate*系メソッド群を参照)。
  private browseMode1: string;
  private browseMode2: string;
  private readonly radikoAreaIdArray: string[];
  private tempo: number;
  /** タイムフリー番組表のページングのデフォルト範囲(過去方向、日数)。 */
  private programPeriodFrom: number;
  /** タイムフリー番組表のページングのデフォルト範囲(未来方向、日数)。 */
  private programPeriodTo: number;
  /** 番組表示用の日時フォーマット(`'<日付書式> <開始時刻書式>-<終了時刻書式>'`)。 */
  private timeFormat: string;
  /** アルバムアート取得方式('type1'=バナー, 'type2'=局ロゴ, 'type3'=番組画像)。 */
  private albumartType: string;

  /** タイムフリー再生の途中再開用の進捗(局・番組・再生位置)。同じ番組を選び直した時だけ使う。 */
  private timeFreeProgress: { station: string; ft: string; to: string; positionSec: number } | null = null;
  private timeFreeProgressTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param port `/radiko/play/...`等のURI生成に使う自身のリッスンポート番号。
   * @param logger ログ出力先。
   * @param acct Radikoプレミアム会員としてログインする場合のアカウント情報。未指定ならログインしない。
   * @param commandRouter Volumioコアのコマンドルータ。
   * @param serviceName BrowseItemの`service`に設定するサービス名。
   * @param browseMode1 ライブ局選択時の動作('type1'=直接再生、'type2'=番組情報モーダル)。
   * @param browseMode2 タイムフリー番組選択時の動作('type1'=直接再生、'type2'=番組情報モーダル)。
   * @param radikoAreaIdArray エリアフリー会員が設定画面で選択した、番組表取得対象のエリアID一覧。
   * @param tempo タイムフリー再生の速度倍率。
   * @param programPeriodFrom タイムフリー番組表のページングのデフォルト範囲(過去方向、日数)。
   * @param programPeriodTo タイムフリー番組表のページングのデフォルト範囲(未来方向、日数)。
   * @param timeFormat 番組表示用の日時フォーマット。
   * @param albumartType アルバムアート取得方式。
   */
  constructor(port = 0, logger: LoggerEx, acct: LoginAccount | null = null, commandRouter: any, serviceName: string, browseMode1 = 'type1', browseMode2 = 'type1', radikoAreaIdArray: string[] = [], tempo = 1, programPeriodFrom = 7, programPeriodTo = 7, timeFormat = 'yyyy/MM/dd HH:mm-HH:mm', albumartType = 'type3') {
    this.app = express();
    this.port = port;
    this.logger = logger;
    this.acct = acct;
    this.commandRouter = commandRouter;
    this.serviceName = serviceName;
    this.browseMode1 = browseMode1;
    this.browseMode2 = browseMode2;
    this.radikoAreaIdArray = radikoAreaIdArray;
    this.tempo = tempo;
    this.programPeriodFrom = programPeriodFrom;
    this.programPeriodTo = programPeriodTo;
    this.timeFormat = timeFormat;
    this.albumartType = albumartType;

    // 番組表データ更新（6h間隔）
    this.task1 = cron.schedule('0 5,11,17,23 * * *', this.#pgupdate.bind(this), {
      scheduled: false
    });
    // 再生画面更新（60s間隔;getCurrentRadioTimeに対して1sずらし）
    this.task2 = cron.schedule(`${(getRadioDelay() + 1) % 60} * * * * *`, this.#pushSongState.bind(this), {
      scheduled: false
    });

    this.#setupRoutes();
  }

  /**
   * ブラウズ動作(ライブ/タイムフリー選択時の挙動)を再起動無しで更新する。
   * @param browseMode1 ライブ局選択時の動作('type1'=直接再生、'type2'=番組情報モーダル)。
   * @param browseMode2 タイムフリー番組選択時の動作。
   */
  updateBrowseMode(browseMode1: string, browseMode2: string): void {
    this.browseMode1 = browseMode1;
    this.browseMode2 = browseMode2;
  }

  /**
   * タイムフリー再生速度を再起動無しで更新する。
   * @param tempo タイムフリー再生の速度倍率。
   */
  updateTempo(tempo: number): void {
    this.tempo = tempo;
  }

  /**
   * アルバムアート取得方式を再起動無しで更新する。
   * @param albumartType アルバムアート取得方式。
   */
  updateAlbumartType(albumartType: string): void {
    this.albumartType = albumartType;
  }

  /**
   * タイムフリー番組表のデフォルト表示期間・日時表示書式を再起動無しで更新する。
   * @param programPeriodFrom 表示期間(過去方向、日数)。
   * @param programPeriodTo 表示期間(未来方向、日数)。
   * @param timeFormat 番組表示用の日時フォーマット。
   */
  updateTimetableDisplay(programPeriodFrom: number, programPeriodTo: number, timeFormat: string): void {
    this.programPeriodFrom = programPeriodFrom;
    this.programPeriodTo = programPeriodTo;
    this.timeFormat = timeFormat;
  }

  /**
   * Express上に局一覧取得・プレイリストプロキシ・再生ストリーム配信の各ルートを登録する。
   */
  #setupRoutes(): void {
    this.logger.info('RCT_I001');

    this.app.get('/radiko/all/stations', async (_req: Request, res: Response) => {
      try {
        const data = await this.prg?.allData();
        // 自動で JSON に変換
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: 'Failed to retrieve station data' });
      }
    });


    // ffmpegのHLSデマルチプレクサはプレイリストのreload時に-headersを引き継がないため、
    // プレイリスト取得はここを経由させ、Radiko(Model)側で毎回正しいヘッダーを付けて中継する
    this.app.get('/radiko/medialist-proxy', async (req: Request, res: Response): Promise<void> => {
      if (this.rdk === null) {
        res.status(500).send('JP_Radio::Radiko instance not initialized');
        return;
      }
      const upstreamUrl = String(req.query['url'] || '');
      const token = String(req.query['token'] || '');
      const startedAt = Date.now();
      try {
        const { contentType, body } = await this.rdk.fetchMedialist(upstreamUrl, token);
        // ローカルプロキシは応答が速すぎてffmpegのリロード間隔計算を狂わせるため、最低待機時間を設ける
        // (5sだと体感の遅延が大きいため2sに短縮)
        const minDurationMs = 2000;
        const elapsed = Date.now() - startedAt;
        if (elapsed < minDurationMs) {
          await new Promise(resolve => setTimeout(resolve, minDurationMs - elapsed));
        }
        res.set('Content-Type', contentType);
        res.send(body);
      } catch (error: any) {
        this.logger.error('RCT_E001', error?.message || error);
        res.status(502).send('proxy error');
      }
    });

    this.app.get('/radiko/play/:stationID', async (req: Request, res: Response): Promise<void> => {
      // FM802対策
      this.station = String(req.params['stationID']);
      this.logger.info('RCT_I002', req.originalUrl);

      if (this.rdk === null || this.rdk.stations?.has(this.station) === false) {
        let msg: string;
        if (this.rdk === null) {
          msg = 'JP_Radio::Radiko instance not initialized';
          this.logger.error('RCT_E002');
        } else {
          msg = `JP_Radio::${this.station} not in available stations`;
          this.logger.error('RCT_E003', this.station);
        }
        res.status(500).send(msg);
        return;
      }

      const ft = req.query['ft'];
      const to = req.query['to'];
      let timeFreeQuery: TimeFreeQuery | undefined;
      if (typeof ft === 'string' && typeof to === 'string') {
        timeFreeQuery = { ft, to };
      } else {
        timeFreeQuery = undefined;
      }

      let resumeSeek: string | undefined;
      let resumePositionSec = 0;
      if (timeFreeQuery !== undefined) {
        const seekParam = req.query['seek'];
        if (typeof seekParam === 'string' && seekParam !== '') {
          // 明示的なシーク指定(index.tsのseek()から)。#resolveResumeによる自動再開より優先する。
          resumePositionSec = Number(seekParam);
          resumeSeek = addSecondsToTimeString(revCnvRadioTime(timeFreeQuery.ft), resumePositionSec);
        } else {
          const resume = this.#resolveResume(this.station, timeFreeQuery);
          resumeSeek = resume.seek;
          resumePositionSec = resume.positionSec;
        }
      }

      const session = new StreamSession(
        this.rdk,
        this.station,
        this.logger,
        () => {
          if (timeFreeQuery === undefined) {
            // max60sも待ちたくないのですぐ呼ぶ
            setTimeout(this.#pushSongState.bind(this), 3000);
            this.task2.start();
          } else {
            const query = timeFreeQuery;
            setTimeout(() => this.#pushTimeFreeState(query, resumePositionSec), 3000);
            this.#startTimeFreeProgressTracking();
          }
        },
        () => {
          if (timeFreeQuery === undefined) {
            this.task2.stop();
          } else {
            this.#stopTimeFreeProgressTracking();
          }
        },
        timeFreeQuery,
        this.tempo,
        resumeSeek,
      );
      session.start(res);
    });

    this.app.get('/radiko/', (_req: Request, res: Response) => {
      res.send("Hello, world. You're at the radiko_app index.");
    });
  }

  /**
   * 現在の番組情報を取得し、Volumioのステートマシンへ曲名・アーティスト・再生位置を反映する。
   * @param forceUpdate trueの場合、通常の更新条件(番組切り替わり/10分間隔)を無視して強制的に更新する
   *   (ライブ再生中にシーク操作された際にタイムバーを元に戻すため、{@link forcePushSongState}から使う)。
   */
  async #pushSongState(forceUpdate = false): Promise<void> {
    const state = this.commandRouter.stateMachine.getState();
    // 番組の切り替わりで更新
    if (state.seek >= state.duration * 1000 || --this.task2Cnt <= 0 || forceUpdate === true) {
      // 念のため10分間隔で強制更新
      this.task2Cnt = 10;
      const stationInfo = this.rdk?.stations.get(this.station);
      const progData = await this.prg?.getCurProgram(this.station);
      if (progData !== undefined) {
        const stationName = await this.rdk?.getStationName(this.station);
        const t0 = formatTimeString(progData.ft);
        const t1 = formatTimeString(progData.tt);
        const now = formatTimeString(getCurrentRadioTime());
        const artist = `${stationName} / ${formatRadioTimeRange(progData.ft, progData.tt, this.timeFormat)} ${messageCatalog.get('PLAYBACK_STATUS_LIVE')}`;
        this.logger.info('RCT_I003', t0, t1);
        this.logger.info('RCT_I004', artist, now);

        state.title = progData.title;
        state.artist = artist;
        state.album = progData.pfm;
        state.albumart = this.selectAlbumart(stationInfo?.bannerUrl, stationInfo?.logoUrl, progData.img);
        // sec
        state.duration = getTimeSpan(t0, t1);
        // msec
        state.seek = getTimeSpan(t0, now) * 1000;

        // workaround to allow state to be pushed when not in a volatile state
        const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
        queueItem.name = state.title;
        queueItem.artist = state.artist;
        queueItem.album = state.album;
        queueItem.albumart = state.albumart;
        queueItem.duration = state.duration;

        // reset volumio internal timer
        this.commandRouter.stateMachine.currentSeek = state.seek;
        this.commandRouter.stateMachine.currentSongDuration = state.duration;

        // volumio push state
        this.commandRouter.servicePushState(state, 'mpd');
      }

      await this.#updateQueueInfo();
    }
  }

  /**
   * ライブ再生中にシーク操作(非対応)された場合に、Volumio側のタイムバーを正しい位置へ戻すため、
   * 通常の更新条件を無視して強制的に再生状態を再送信する。
   */
  async forcePushSongState(): Promise<void> {
    await this.#pushSongState(true);
  }

  /**
   * 再生キュー内の未再生ライブ局アイテム(タイムフリーの`?`付きURIは対象外)の番組情報を、
   * 現在再生中かどうかに関わらず最新の内容に更新する。番組の切り替わりをキュー表示にも反映するため。
   */
  async #updateQueueInfo(): Promise<void> {
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    let changed = false;

    for (const queueItem of arrayQueue) {
      if (typeof queueItem.uri !== 'string' || queueItem.uri.includes('?') === true) {
        continue;
      }
      const stationId = queueItem.uri.split('/').pop();
      if (stationId === undefined) {
        continue;
      }
      const progData = await this.prg?.getCurProgram(stationId);
      if (progData === undefined) {
        continue;
      }
      const stationInfo = this.rdk?.stations.get(stationId);
      const stationName = stationInfo?.name ?? stationId;
      const artist = `${stationName} / ${formatHourMinute(progData.ft)}-${formatHourMinute(progData.tt)} ${messageCatalog.get('PLAYBACK_STATUS_LIVE')}`;

      if (queueItem.artist !== artist) {
        queueItem.name = progData.title;
        queueItem.album = progData.pfm;
        queueItem.artist = artist;
        queueItem.albumart = this.selectAlbumart(stationInfo?.bannerUrl, stationInfo?.logoUrl, progData.img);
        changed = true;
      }
    }

    if (changed === true) {
      this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
      this.commandRouter.volumioPushQueue(arrayQueue);
    }
  }

  /**
   * タイムフリー再生の途中再開位置を解決する。直前に再生していたのと同じ局・同じ番組(`ft`/`to`が一致)を
   * 選び直した場合のみ、前回の再生位置(`positionSec`)からの再開に必要な`seek`(実時刻)を返す。
   * それ以外(別の局・別の番組を選んだ場合)は進捗を0にリセットし、先頭から再生する。
   * @param station 局ID。
   * @param query 再生しようとしている番組の放送区間。
   * @returns `seek`は再開先の実時刻(途中再開しない場合はundefined)、`positionSec`は再開位置(秒、0なら先頭から)。
   */
  #resolveResume(station: string, query: TimeFreeQuery): { seek?: string; positionSec: number } {
    const progress = this.timeFreeProgress;
    if (
      progress !== null &&
      progress.station === station &&
      progress.ft === query.ft &&
      progress.to === query.to &&
      progress.positionSec > 0
    ) {
      const seek = addSecondsToTimeString(revCnvRadioTime(query.ft), progress.positionSec);
      return { seek, positionSec: progress.positionSec };
    }
    this.timeFreeProgress = { station, ft: query.ft, to: query.to, positionSec: 0 };
    return { seek: undefined, positionSec: 0 };
  }

  /**
   * タイムフリー再生開始直後に1回だけ、番組の長さと再生位置(途中再開時のみ0以外)をVolumioへ反映する。
   * @param query 再生中の番組の放送区間。
   * @param resumePositionSec 途中再開の場合の再生位置(秒)。先頭からの場合は0。
   */
  #pushTimeFreeState(query: TimeFreeQuery, resumePositionSec: number): void {
    const state = this.commandRouter.stateMachine.getState();
    const t0 = formatTimeString(query.ft);
    const t1 = formatTimeString(query.to);
    state.duration = getTimeSpan(t0, t1);
    state.seek = resumePositionSec * 1000;

    const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
    queueItem.duration = state.duration;

    this.commandRouter.stateMachine.currentSeek = state.seek;
    this.commandRouter.stateMachine.currentSongDuration = state.duration;
    this.commandRouter.servicePushState(state, 'mpd');
  }

  /**
   * タイムフリー再生中、`this.timeFreeProgress.positionSec`を定期的に更新する(次に同じ番組を選んだ時の
   * 途中再開に使う)のに加え、タイトル・アーティスト・アルバムアートも定期的に再送信する。
   * mpd自身の周期的なステータス更新でこれらの情報がリセットされてしまうことがあるため、
   * ライブ再生の`#pushSongState`と同様、継続的に上書きし直して情報が消えないようにしている。
   */
  #startTimeFreeProgressTracking(): void {
    this.#stopTimeFreeProgressTracking();
    this.timeFreeProgressTimer = setInterval(() => {
      if (this.timeFreeProgress === null) {
        return;
      }
      const state = this.commandRouter.stateMachine.getState();
      if (typeof state.seek === 'number') {
        this.timeFreeProgress.positionSec = Math.floor(state.seek / 1000);
      }

      const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
      if (queueItem !== undefined) {
        state.title = queueItem.name;
        state.artist = queueItem.artist;
        state.album = queueItem.album;
        state.albumart = queueItem.albumart;
        this.commandRouter.servicePushState(state, 'mpd');
      }
    }, 5000);
  }

  /**
   * タイムフリー再生の進捗更新タイマーを止める(進捗の値自体は次回の途中再開のために残す)。
   */
  #stopTimeFreeProgressTracking(): void {
    if (this.timeFreeProgressTimer !== null) {
      clearInterval(this.timeFreeProgressTimer);
      this.timeFreeProgressTimer = null;
    }
  }

  /**
   * ルートメニュー(ライブ/タイムフリー/タイムフリー(今日)/お気に入り2種)を返す。各項目は`radio-category`型
   * (お気に入りのみ`radio-favourites`型)で、選択すると{@link radioStations}/{@link timeFreeStations}/
   * {@link radioFavouriteStations}へ遷移する。
   */
  async rootMenu(): Promise<BrowseResult> {
    const items: BrowseItem[] = [
      {
        service: this.serviceName,
        type: 'radio-category',
        title: messageCatalog.get('BROWSE_LABEL_LIVE'),
        icon: 'fa fa-microphone',
        uri: 'radiko/live',
      },
      {
        service: this.serviceName,
        type: 'radio-favourites',
        title: messageCatalog.get('BROWSE_LABEL_LIVE_FAVOURITES'),
        icon: 'fa fa-heart',
        uri: 'radiko/live/favourites',
      },
      {
        service: this.serviceName,
        type: 'radio-category',
        title: messageCatalog.get('BROWSE_LABEL_TIMEFREE'),
        icon: 'fa fa-clock-o',
        uri: 'radiko/timefree',
      },
      {
        service: this.serviceName,
        type: 'radio-category',
        title: messageCatalog.get('BROWSE_LABEL_TIMEFREE_TODAY'),
        icon: 'fa fa-calendar-check-o',
        uri: 'radiko/timefree_today',
      },
      {
        service: this.serviceName,
        type: 'radio-favourites',
        title: messageCatalog.get('BROWSE_LABEL_TIMEFREE_FAVOURITES'),
        icon: 'fa fa-heartbeat',
        uri: 'radiko/timefree/favourites',
      },
    ];

    return {
      navigation: {
        lists: [{
          title: messageCatalog.get('APP_TITLE'),
          availableListViews: ['grid', 'list'],
          items
        }]
      },
      uri: 'radiko'
    };
  }

  /**
   * 局一覧をVolumioのBrowse画面用データ(地域名ごとにグループ化したリスト)に変換して返す。
   */
  async radioStations(): Promise<BrowseResult> {
    this.logger.info('RCT_I005');

    if (this.rdk?.stations === undefined) {
      return {
        navigation: {
          lists: [{
            title: messageCatalog.get('BROWSE_LABEL_LIVE'),
            availableListViews: ['grid', 'list'],
            items: []
          }]
        },
        uri: 'radiko/live'
      };
    }

    const areaFilter = await this.#getSelectedAreaFilter();
    const entries = Array.from(this.rdk.stations.entries())
      .filter(([, stationInfo]) => areaFilter === null || areaFilter.has(stationInfo.areaId));
    // 地域名ごとにグループ化
    const grouped: Record<string, BrowseItem[]> = {};

    const stationPromises = entries.map(async ([stationId, stationInfo]) => {
      try {
        const meta = await this.#buildTrackMeta(stationId, stationInfo);
        const uri = `http://localhost:${this.port}/radiko/play/${stationId}`;

        const item: BrowseItem = {
          // explodeUriを呼び出す先のサービス名
          service   : this.serviceName,
          type      : 'song',
          // 番組タイトル
          title     : meta.title,
          // パーソナリティ名
          album: meta.album,
          // 地域名 / 局名 / 放送時間
          artist    : meta.artist,
          // 番組画像URL
          albumart  : meta.albumart,
          // 再生URI
          uri       : uri,
          // サンプルレート（未使用）
          samplerate: '',
          // ビット深度（未使用）
          bitdepth  : 0,
          // チャンネル数（未使用）
          channels  : 0
        };
        if (this.browseMode1 === 'type2') {
          // 直接再生ではなく番組情報モーダルを経由させる
          item.type = 'radio-category';
          item.uri = `radiko/proginfo/${stationId}`;
        }
        const region = stationInfo.regionName || 'その他';
        if (grouped[region] === undefined) {
          grouped[region] = [];
        }
        grouped[region].push(item);
      } catch (error: any) {
        this.logger.error('RCT_E004', stationId, error);
      }
    });

    await Promise.all(stationPromises);

    const lists: BrowseList[] = Object.entries(grouped)
      // 全国広域局(regionName === '全国')は地域別一覧の最後に表示する
      .sort(([a], [b]) => {
        if (a === '全国') return 1;
        if (b === '全国') return -1;
        return 0;
      })
      .map(([regionName, items]) => ({
        title: regionName,
        availableListViews: ['grid', 'list'],
        items
      }));

    return {
      navigation: {
        lists
      },
      uri: 'radiko/live'
    };
  }

  /**
   * 局名・ローマ字局名にキーワードを含む局を検索し、Volumioの検索結果画面用データを返す。
   * ライブの局一覧と同じ`song`型の項目(直接再生)を返す。
   * @param keyword 検索キーワード(前後の空白を除いたもの)。
   */
  async searchStations(keyword: string): Promise<BrowseList[]> {
    this.logger.info('RCT_I015', keyword);

    if (this.rdk?.stations === undefined) {
      return [];
    }

    const areaFilter = await this.#getSelectedAreaFilter();
    const lowerKeyword = keyword.toLowerCase();
    const matchedEntries = Array.from(this.rdk.stations.entries()).filter(([, stationInfo]) => {
      if (areaFilter !== null && areaFilter.has(stationInfo.areaId) === false) {
        return false;
      }
      return stationInfo.name.toLowerCase().includes(lowerKeyword)
        || stationInfo.asciiName.toLowerCase().includes(lowerKeyword);
    });

    if (matchedEntries.length === 0) {
      return [];
    }

    const items = await Promise.all(matchedEntries.map(async ([stationId, stationInfo]) => {
      const meta = await this.#buildTrackMeta(stationId, stationInfo);
      const uri = `http://localhost:${this.port}/radiko/play/${stationId}`;
      const item: BrowseItem = {
        service: this.serviceName,
        type: 'song',
        title: meta.title,
        album: meta.album,
        artist: meta.artist,
        albumart: meta.albumart,
        uri,
        samplerate: '',
        bitdepth: 0,
        channels: 0
      };
      if (this.browseMode1 === 'type2') {
        item.type = 'radio-category';
        item.uri = `radiko/proginfo/${stationId}`;
      }
      return item;
    }));

    return [{
      title: messageCatalog.get('BROWSE_LABEL_LIVE'),
      availableListViews: ['grid', 'list'],
      items
    }];
  }

  /**
   * お気に入り登録済みの局・番組をBrowse画面用データに変換して返す。
   * @param mode `'live'`ならお気に入りのライブ局一覧、`'timefree'`ならお気に入りの局(番組表への入口)+
   *   お気に入り登録済みの個別番組の一覧。
   */
  async radioFavouriteStations(mode: 'live' | 'timefree'): Promise<BrowseResult> {
    this.logger.info('RCT_I014', mode);
    const [stationItems, programItems] = await this.#commonRadioFavouriteStations(mode);

    const lists: BrowseList[] = [];
    if (mode === 'live') {
      lists.push({
        title: messageCatalog.get('BROWSE_LABEL_LIVE_FAVOURITES'),
        availableListViews: ['grid', 'list'],
        items: stationItems,
      });
    } else {
      lists.push({
        title: messageCatalog.get('BROWSE_TITLE_FAVOURITES_STATION'),
        availableListViews: ['grid', 'list'],
        items: stationItems,
      });
      lists.push({
        title: messageCatalog.get('BROWSE_TITLE_FAVOURITES_TIMEFREE'),
        availableListViews: ['list'],
        items: programItems,
      });
    }

    return {
      navigation: { lists },
      uri: `radiko/${mode}/favourites`
    };
  }

  /**
   * お気に入りプレイリスト(`getRadioFavouritesContent`)の内容を、局一覧(ライブまたはタイムフリー番組表への
   * 入口)と番組一覧(タイムフリーの個別お気に入り番組、`mode==='timefree'`時のみ)の2配列に分類・整形する。
   * @param mode `'live'`または`'timefree'`。
   */
  async #commonRadioFavouriteStations(mode: 'live' | 'timefree'): Promise<[BrowseItem[], BrowseItem[]]> {
    const stationItems: BrowseItem[] = [];
    const programItems: BrowseItem[] = [];

    const favouriteStations: any[] = await this.commandRouter.playListManager.getRadioFavouritesContent() ?? [];

    const tasks = favouriteStations.map(async (data: any) => {
      const uriStr: string = data.uri;
      if (typeof uriStr !== 'string' || uriStr.includes('/radiko/play/') === false) {
        return;
      }
      const [liveUri, queryStr]: string[] = uriStr.split('?');
      const stationId = liveUri.split('/').pop();
      if (stationId === undefined) {
        return;
      }
      const stationInfo = this.rdk?.stations.get(stationId);
      if (stationInfo === undefined) {
        return;
      }

      if (mode === 'live') {
        if (queryStr === undefined) {
          // ライブお気に入り(ft/to無しのURIのみ対象)
          const meta = await this.#buildTrackMeta(stationId, stationInfo);
          stationItems.push({
            service: this.serviceName,
            type: 'song',
            title: meta.title,
            album: meta.album,
            artist: meta.artist,
            albumart: meta.albumart,
            uri: `http://localhost:${this.port}/radiko/play/${stationId}`,
            favourite: true,
            samplerate: '',
            bitdepth: 0,
            channels: 0,
          });
        }
        return;
      }

      // mode === 'timefree'
      if (queryStr === undefined) {
        // 局そのものをお気に入り登録 → タイムフリー番組表への入口として表示
        stationItems.push({
          service: this.serviceName,
          type: 'radio-category',
          title: stationInfo.name,
          artist: `${stationInfo.areaKanji || stationInfo.areaName} / ${stationInfo.name}`,
          albumart: this.selectAlbumart(stationInfo.bannerUrl, stationInfo.logoUrl, undefined),
          uri: `radiko/timetable/${stationId}`,
          favourite: true,
          samplerate: '',
          bitdepth: 0,
          channels: 0,
        });
        return;
      }

      // 特定番組(ft/to付き)をお気に入り登録
      const params = new URLSearchParams(queryStr);
      const ft = params.get('ft');
      const to = params.get('to');
      if (ft === null || to === null) {
        return;
      }
      const program = await this.prg?.findProgram(stationId, ft);
      // お気に入り一覧からの選択は常に、日付ずらし更新・削除ができる番組登録モーダル(progreg)を開く
      // (直接再生ではなく、お気に入りの管理操作を優先する)
      const item: BrowseItem = {
        service: this.serviceName,
        type: 'radio-category',
        title: program?.title ?? '?',
        album: program?.pfm,
        artist: `${stationInfo.name} ${formatHourMinute(ft)}-${formatHourMinute(to)}`,
        albumart: this.selectAlbumart(stationInfo.bannerUrl, stationInfo.logoUrl, program?.img),
        uri: `radiko/progreg/${stationId}?ft=${ft}&to=${to}`,
        time: ft,
        duration: getTimeSpan(formatTimeString(ft), formatTimeString(to)),
        favourite: true,
        samplerate: '',
        bitdepth: 0,
        channels: 0,
      };
      programItems.push(item);
    });

    await Promise.all(tasks);

    stationItems.sort((a, b) => (a.artist ?? '').localeCompare(b.artist ?? ''));
    programItems.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

    return [stationItems, programItems];
  }

  /**
   * タイムフリー用の局一覧をVolumioのBrowse画面用データに変換して返す。
   * 各アイテムは`radio-category`型(直接再生ではなく再度ブラウズを呼び出す)にし、
   * 選択すると{@link stationTimetable}で番組一覧に遷移する。
   * @param mode `'today'`指定時は各局の遷移先URIを`radiko/timetable_today/<stationId>`にする(当日分のみ表示)。
   */
  async timeFreeStations(mode: 'normal' | 'today' = 'normal'): Promise<BrowseResult> {
    this.logger.info('RCT_I006');
    const resultUri = mode === 'today' ? 'radiko/timefree_today' : 'radiko/timefree';

    if (this.rdk?.stations === undefined) {
      return {
        navigation: {
          lists: [{
            title: messageCatalog.get('BROWSE_LABEL_TIMEFREE'),
            availableListViews: ['grid', 'list'],
            items: []
          }]
        },
        uri: resultUri
      };
    }

    const timetableSegment = mode === 'today' ? 'timetable_today' : 'timetable';
    const areaFilter = await this.#getSelectedAreaFilter();
    const grouped: Record<string, BrowseItem[]> = {};
    for (const [stationId, stationInfo] of this.rdk.stations.entries()) {
      if (areaFilter !== null && areaFilter.has(stationInfo.areaId) === false) {
        continue;
      }
      const areaName = stationInfo.areaKanji || stationInfo.areaName;
      const item: BrowseItem = {
        service: this.serviceName,
        type: 'radio-category',
        title: stationInfo.name,
        artist: `${areaName} / ${stationInfo.name}`,
        albumart: this.selectAlbumart(stationInfo.bannerUrl, stationInfo.logoUrl, undefined),
        uri: `radiko/${timetableSegment}/${stationId}`,
        samplerate: '',
        bitdepth: 0,
        channels: 0
      };
      const region = stationInfo.regionName || 'その他';
      if (grouped[region] === undefined) {
        grouped[region] = [];
      }
      grouped[region].push(item);
    }

    const lists: BrowseList[] = Object.entries(grouped).map(([regionName, items]) => ({
      title: regionName,
      availableListViews: ['grid', 'list'],
      items
    }));

    return {
      navigation: {
        lists
      },
      uri: resultUri
    };
  }

  /**
   * 指定局のタイムフリー番組表を日付ごとにグループ化したBrowse画面用データに変換して返す。
   * 前週/前日/次週/翌日への日送りナビゲーションを先頭・末尾に付与し、各番組のタイトルには
   * 放送状態アイコン(★放送中/⬜︎配信前/▷タイムフリー再生可能)を付与する。
   * @param stationId 局ID。
   * @param opts `isToday`指定時は当日分のみ、`ft`/`to`(`'yyyyMMdd'`)指定時はその範囲、
   *   いずれも未指定なら`programPeriodFrom`/`programPeriodTo`設定から算出した範囲を表示する。
   */
  async stationTimetable(stationId: string, opts?: { isToday?: boolean; ft?: string; to?: string }): Promise<BrowseResult> {
    this.logger.info('RCT_I007', stationId);

    const stationInfo = this.rdk?.stations.get(stationId);
    let stationName = stationInfo?.name;
    if (stationName === undefined) {
      stationName = stationId;
    }

    const today = getCurrentDate();
    let fromDateOnly: string;
    let toDateOnly: string;
    if (opts?.isToday === true) {
      fromDateOnly = today;
      toDateOnly = today;
    } else if (opts?.ft !== undefined && opts?.to !== undefined) {
      fromDateOnly = opts.ft;
      toDateOnly = opts.to;
    } else {
      fromDateOnly = addDaysToDateOnly(today, -this.programPeriodFrom);
      toDateOnly = addDaysToDateOnly(today, this.programPeriodTo);
    }

    const programs = await this.prg?.getStationPrograms(stationId) ?? [];

    // getStationPrograms(週次API)は前後1週間分しか返らないため、表示期間設定(最大30日)で
    // それより外側の日付を指定された場合は、日別APIで個別に補う(GitHub issue #21関連の追加報告)。
    const coveredDates = new Set(programs.map((program) => parseRadioTime(program.ft).date));
    const missingDates: string[] = [];
    for (let dateOnly = fromDateOnly; dateOnly <= toDateOnly; dateOnly = addDaysToDateOnly(dateOnly, 1)) {
      if (coveredDates.has(dateOnly) === false) {
        missingDates.push(dateOnly);
      }
    }
    if (missingDates.length > 0) {
      const extraPrograms = await this.prg?.getStationProgramsForDates(stationId, missingDates) ?? [];
      programs.push(...extraPrograms);
    }

    const currentRadioTime = getCurrentRadioTime();

    const buildPlayUri = (ft: string, tt: string): string => {
      const playUrl = new URL(`http://localhost:${this.port}/radiko/play/${stationId}`);
      playUrl.searchParams.set('ft', ft);
      playUrl.searchParams.set('to', tt);
      return playUrl.toString();
    };

    const dayLists: BrowseList[] = [];
    for (let dateOnly = fromDateOnly; dateOnly <= toDateOnly; dateOnly = addDaysToDateOnly(dateOnly, 1)) {
      const items: BrowseItem[] = programs
        .filter((program) => parseRadioTime(program.ft).date === dateOnly)
        .sort((a, b) => (a.ft < b.ft ? -1 : 1))
        .map((program) => {
          const status = getProgramTimeStatus(program.ft, program.tt, currentRadioTime);
          const icon = status === 'live' ? '★' : status === 'future' ? '⬜︎' : '▷';
          const t0 = formatHourMinute(program.ft);
          const t1 = formatHourMinute(program.tt);

          const item: BrowseItem = {
            service: this.serviceName,
            type: 'song',
            title: `${icon} ${program.title}`,
            album: program.pfm,
            artist: `${stationName} ${t0}-${t1}`,
            albumart: this.selectAlbumart(stationInfo?.bannerUrl, stationInfo?.logoUrl, program.img),
            uri: buildPlayUri(program.ft, program.tt),
            time: program.ft,
            duration: getTimeSpan(formatTimeString(program.ft), formatTimeString(program.tt)),
            samplerate: '',
            bitdepth: 0,
            channels: 0
          };
          if (this.browseMode2 === 'type2') {
            // 直接再生ではなく番組情報モーダルを経由させる
            item.type = 'radio-category';
            item.uri = `radiko/proginfo/${stationId}?ft=${program.ft}&to=${program.tt}`;
          }
          return item;
        });

      let title = formatDateOnly(dateOnly, 'M月d日(E)');
      if (dateOnly === today) {
        title += messageCatalog.get('BROWSE_BUTTON_TODAY');
      }
      dayLists.push({ title, availableListViews: ['list'], items });
    }

    const buildNavItem = (title: string, ft: string, to: string): BrowseItem => ({
      service: this.serviceName,
      type: 'item-no-menu',
      title,
      uri: `radiko/timetable/${stationId}?ft=${ft}&to=${to}`,
    });

    const prevWeekNav: BrowseList = {
      title: '<<',
      availableListViews: ['list'],
      items: [
        buildNavItem(messageCatalog.get('BROWSE_BUTTON_PREV_WEEK'), addDaysToDateOnly(fromDateOnly, -7), addDaysToDateOnly(toDateOnly, -7)),
        buildNavItem(messageCatalog.get('BROWSE_BUTTON_PREV_DAY'), addDaysToDateOnly(fromDateOnly, -1), addDaysToDateOnly(fromDateOnly, -1)),
      ],
    };
    const nextWeekNav: BrowseList = {
      title: '>>',
      availableListViews: ['list'],
      items: [
        buildNavItem(messageCatalog.get('BROWSE_BUTTON_NEXT_DAY'), addDaysToDateOnly(toDateOnly, 1), addDaysToDateOnly(toDateOnly, 1)),
        buildNavItem(messageCatalog.get('BROWSE_BUTTON_NEXT_WEEK'), addDaysToDateOnly(fromDateOnly, 7), addDaysToDateOnly(toDateOnly, 7)),
      ],
    };

    return {
      navigation: {
        lists: [prevWeekNav, ...dayLists, nextWeekNav]
      },
      uri: `radiko/timetable/${stationId}`
    };
  }

  /**
   * 指定局IDの現在のトラック情報を返す(explodeUriから呼ばれる)。
   * URIには局IDのみを載せ、タイトルやアルバムアートなどの表示用メタデータは
   * 再生選択のたびにここで最新の状態を取得し直す(長い日本語テキストをURIに含めないため)。
   * @param stationId 局ID。
   * @param timeFreeQuery 指定するとタイムフリー再生時の番組情報を、指定しなければ現在放送中の情報を返す。
   * @returns 局が存在しない場合はnull。
   */
  async getTrackMeta(stationId: string, timeFreeQuery?: TimeFreeQuery): Promise<TrackMeta | null> {
    const stationInfo = this.rdk?.stations.get(stationId);
    if (stationInfo === undefined) {
      return null;
    }
    if (timeFreeQuery !== undefined) {
      return this.#buildTimeFreeTrackMeta(stationId, stationInfo, timeFreeQuery);
    }
    return this.#buildTrackMeta(stationId, stationInfo);
  }

  /**
   * 番組情報モーダル表示用のデータを組み立てる(`handleBrowseUri`の`radiko/proginfo/<stationId>`から呼ばれる)。
   * `explodeUri`の返却値と同じ形にして返すことで、モーダルの「再生」「キューに追加」ボタンから
   * このデータをそのままVolumioの再生キューへ渡せるようにする。
   * @param stationId 局ID。
   * @param timeFreeQuery 指定するとタイムフリー番組の情報を、指定しなければ現在放送中の情報を組み立てる。
   * @returns 局が存在しない場合はnull。
   */
  async progInfo(stationId: string, timeFreeQuery?: TimeFreeQuery): Promise<ProgInfoData | null> {
    const meta = await this.getTrackMeta(stationId, timeFreeQuery);
    if (meta === null) {
      return null;
    }
    const playUrl = new URL(`http://localhost:${this.port}/radiko/play/${stationId}`);
    if (timeFreeQuery !== undefined) {
      playUrl.searchParams.set('ft', timeFreeQuery.ft);
      playUrl.searchParams.set('to', timeFreeQuery.to);
    }
    return {
      service: this.serviceName,
      type: 'song',
      title: meta.title,
      name: meta.title,
      album: meta.album,
      artist: meta.artist,
      albumart: meta.albumart,
      uri: playUrl.toString(),
    };
  }

  /**
   * 指定局の現在放送中の番組の放送区間(ft/tt)を返す。ライブ再生中に過去方向へシークされた際、
   * 「追っかけ再生」(現在放送中の番組をタイムフリー相当でその時点から再生)に切り替えるためのURIを
   * 組み立てるのに使う(`index.ts`の`seek()`から呼ばれる)。
   * @param stationId 局ID。
   * @returns 番組情報が取得できない場合はnull。
   */
  async getCurrentProgramWindow(stationId: string): Promise<{ ft: string; tt: string } | null> {
    const progData = await this.prg?.getCurProgram(stationId);
    if (progData === undefined) {
      return null;
    }
    return { ft: progData.ft, tt: progData.tt };
  }

  /**
   * 自身のエリアID・会員種別を`'JP13/premium'`形式で返す(`Radiko.getMyAreaId()`のパススルー)。
   * エリア選択設定画面で「自分のエリア」を示すために使う。
   */
  async getMyAreaId(): Promise<string> {
    if (this.rdk === null) {
      return '';
    }
    return this.rdk.getMyAreaId();
  }

  /**
   * 指定エリアIDに属する局のID一覧を返す(エリア選択設定画面の説明表示に使う)。
   * @param areaId エリアID(例: 'JP13')。
   */
  getAreaStations(areaId: string): string[] {
    const stations = this.rdk?.areaData.get(areaId)?.stations;
    if (stations === undefined) {
      return [];
    }
    return stations;
  }

  /**
   * 指定局・指定区間のタイムフリー番組情報を組み立てる。DBに該当番組が見つからない場合は
   * タイトル等を空のまま返す(URIのft/toから放送時間だけは表示できるようにする)。
   * @param stationId 局ID。
   * @param stationInfo 局情報(局名・エリア名などの表示に使う)。
   * @param query 番組の放送区間。
   */
  async #buildTimeFreeTrackMeta(stationId: string, stationInfo: StationInfo, query: TimeFreeQuery): Promise<TrackMeta> {
    const program = await this.prg?.findProgram(stationId, query.ft);
    let title = '';
    let album = '';
    let img = '';
    if (program !== undefined) {
      title = program.title;
      album = program.pfm;
      img = program.img;
    }
    const areaName = stationInfo.areaKanji || stationInfo.areaName;
    const t0 = formatHourMinute(query.ft);
    const t1 = formatHourMinute(query.to);
    const albumart = this.selectAlbumart(stationInfo.bannerUrl, stationInfo.logoUrl, img);
    const artist = `${areaName} / ${stationInfo.name} ${t0}-${t1} ${messageCatalog.get('PLAYBACK_STATUS_TIMEFREE')}`;
    return { title, album, artist, albumart };
  }

  /**
   * 指定局の現在のトラック情報(タイトル・パーソナリティ名・表示用アーティスト文字列・アルバムアート)を組み立てる。
   * radioStations()とgetTrackMeta()の両方から共通で使う。
   * @param stationId 局ID。
   * @param stationInfo 局情報(局名・エリア名などの表示に使う)。
   */
  async #buildTrackMeta(stationId: string, stationInfo: StationInfo): Promise<TrackMeta> {
    const progData = await this.prg?.getCurProgram(stationId);
    let title = '';
    let album = '';
    let progImg = '';
    let t0 = '';
    let t1 = '';
    if (progData !== undefined) {
      title = progData.title;
      album = progData.pfm;
      progImg = progData.img;
      t0 = formatHourMinute(progData.ft);
      t1 = formatHourMinute(progData.tt);
    }
    const areaName = stationInfo.areaKanji || stationInfo.areaName;
    const albumart = this.selectAlbumart(stationInfo.bannerUrl, stationInfo.logoUrl, progImg);
    const stationAndTime = `${stationInfo.name} ${t0}-${t1}`;
    const artist = `${areaName} / ${stationAndTime} ${messageCatalog.get('PLAYBACK_STATUS_LIVE')}`;
    return { title, album, artist, albumart };
  }

  /**
   * 設定(`albumartType`)に応じてアルバムアートのURLを選択する。いずれも空の場合はデフォルトアイコンを返す。
   * @param banner 局バナー画像URL。
   * @param logo 局ロゴ画像URL(ローカルキャッシュ済みのURLを想定)。
   * @param progImg 番組画像URL。
   */
  private selectAlbumart(banner: string | undefined, logo: string | undefined, progImg: string | undefined): string {
    let result: string | undefined;
    switch (this.albumartType) {
      case 'type2':
        result = logo;
        break;
      case 'type3':
        result = progImg || logo;
        break;
      case 'type1':
      default:
        result = banner;
        break;
    }
    if (result === undefined || result === '') {
      return '/albumart?sourceicon=music_service/jp_radio/assets/images/app_radiko.svg';
    }
    return result;
  }

  /**
   * HTTPサーバを起動し、局データ・番組表の初期取得と番組表定期更新タスクを開始する。
   */
  async start(): Promise<void> {
    this.logger.info('RCT_I008');
    if (this.server !== null) {
      this.logger.info('RCT_I009');
      this.commandRouter.pushToastMessage('info', messageCatalog.get('APP_TITLE'), messageCatalog.get('ALREADY_STARTED'));
      return;
    }

    this.prg = new RdkProg(this.logger);
    this.rdk = new Radiko(this.logger, this.port);
    // ここで時間かかり過ぎて，
    //   Plugin music_service jp_radio failed to complete 'onStart' in a timely fashion
    // って怒られるので，awaitを外してみた。
    // BOOTは早くなるし問題なさそうなのでこれでいいんじゃない？
    //await this.#init();
    this.#init();

    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(this.port, () => {
          this.logger.info('RCT_I010', this.port);
          this.commandRouter.pushToastMessage('success', messageCatalog.get('APP_TITLE'), messageCatalog.get('BOOT_COMPLETED'));
          this.commandRouter.servicePushState({
            status: 'play',
            service: this.serviceName,
            title: 'Radiko 起動中',
            uri: ''
          });
          this.task1.start();
          resolve();
        })
        .on('error', (error: any) => {
          this.logger.error('RCT_E005', error);
          this.commandRouter.pushToastMessage(
            'error',
            messageCatalog.get('ERROR_START_FAILED_TITLE'),
            error.message || messageCatalog.get('ERROR_GENERIC'),
          );
          reject(error);
        });
    });
  }

  /**
   * 定期更新タスクとHTTPサーバを停止し、Model層(Radiko/RdkProg)の参照を破棄する。
   */
  async stop(): Promise<void> {
    if (this.server !== null) {
      this.task1.stop();
      this.task2.stop();
      this.#stopTimeFreeProgressTracking();
      this.server.close();
      this.server = null;

      await this.prg?.dbClose();
      this.prg = null;
      this.rdk = null;

      this.commandRouter.pushToastMessage('info', messageCatalog.get('APP_TITLE'), messageCatalog.get('STOPPED'));
    }
  }

  /**
   * 「エリア選択」設定による局一覧の絞り込み対象エリアID集合を返す({@link resolveAreaFilter}参照)。
   */
  async #getSelectedAreaFilter(): Promise<Set<string> | null> {
    const myAreaId = await this.rdk?.getMyAreaId();
    return resolveAreaFilter(myAreaId, this.radikoAreaIdArray);
  }

  /**
   * 起動直後にRadikoへログイン・局一覧を取得し、番組表を初回更新する。
   */
  async #init(): Promise<void> {
    this.logger.info('RCT_I011');
    if (this.rdk !== null) {
      await this.rdk.init(this.acct);
    }
    await this.#pgupdate(true);
  }

  /**
   * 番組表を最新化する。エリアフリーでない場合も、局一覧に実際に含まれる全エリア分を対象にする
   * ことで、隣接エリア局(BAYFM78/NACK5/YFMなど)の番組情報が欠落しないようにしている。
   * @param whenBoot trueの場合は起動時呼び出しとしてトースト通知を出す。
   */
  async #pgupdate(whenBoot = false): Promise<void> {
    if (this.prg !== null) {
      this.logger.info('RCT_I012');
      if (whenBoot === true) {
        this.commandRouter.pushToastMessage('info', messageCatalog.get('APP_TITLE'), messageCatalog.get('PROGRAM_DATA_GETTING'));
      }

      // JP**/AreaFree
      const myAreaId = await this.rdk?.getMyAreaId();
      let stationsMap = this.rdk?.stations;
      if (stationsMap === undefined) {
        stationsMap = new Map<string, StationInfo>();
      }

      // エリアフリーでない場合も、局一覧(関東圏の他エリア局など)に実際に含まれる全エリアの番組表を取得する
      // (自分のエリアだけだとBAYFM78/NACK5/YFMのような他エリアの局の番組情報が取れないため)
      const stationAreaIdArray = Array.from(new Set(Array.from(stationsMap.values()).map((s) => s.areaId)));
      const areaIdArray = resolveAreaIdArray(myAreaId, stationAreaIdArray, this.radikoAreaIdArray);
      //const areaIDs = new Array('JP13', 'JP27') // デバッグ用(東京/大阪だけ)

      const updateStartTime = new Date();
      await this.prg.updatePrograms(areaIdArray, stationsMap, whenBoot);
      await this.prg.clearOldProgram();
      const updateEndTime = new Date();
      const processingTime = updateEndTime.getTime() - updateStartTime.getTime();

      if (whenBoot === true) {
        this.commandRouter.pushToastMessage(
          'success',
          messageCatalog.get('APP_TITLE'),
          messageCatalog.get('PROGRAM_DATA_DONE', processingTime),
        );
      }

      this.logger.info('RCT_I013', processingTime);
    }
  }
}
