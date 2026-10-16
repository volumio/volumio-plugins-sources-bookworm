"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const crypto_1 = require("crypto");
const http_client_1 = require("../utils/http-client");
const child_process_1 = require("child_process");
const tough = __importStar(require("tough-cookie"));
const fast_xml_parser_1 = require("fast-xml-parser");
const p_limit_1 = __importDefault(require("p-limit"));
const radiko_urls_1 = require("../consts/radiko-urls");
const area_name_1 = require("../consts/area-name");
const live_entry_selector_1 = require("../logic/live-entry-selector");
const radio_time_1 = require("../utils/radio-time");
const plugin_paths_1 = require("../utils/plugin-paths");
const xmlParser = new fast_xml_parser_1.XMLParser({
    attributeNamePrefix: '@',
    ignoreAttributes: false,
    removeNSPrefix: true,
    allowBooleanAttributes: true,
});
/**
 * Radiko APIとのやり取りを担うModel層。
 * 認証(auth1/auth2)・局一覧取得・ライブ配信プレイリスト解決・ffmpegによるストリーム起動を提供する。
 */
class Radiko {
    logger;
    port;
    token = null;
    areaId = null;
    cookieJar = new tough.CookieJar();
    loginState = null;
    stations = new Map();
    stationData = [];
    areaData = new Map();
    /**
     * @param logger ログ出力先。
     * @param port medialist-proxyへの中継URL生成に使う自身のリッスンポート番号。
     */
    constructor(logger, port) {
        this.logger = logger;
        this.port = port;
    }
    /**
     * プレミアム会員としてのログイン(指定時)と、エリア判定トークンの取得・局一覧の取得を行う。
     * @param acct 指定するとRadikoプレミアム会員としてログインを試みる。
     * @param forceGetStations trueの場合、エリアIDが既に取得済みでも局一覧を再取得する。
     */
    async init(acct = null, forceGetStations = false) {
        if (acct !== null) {
            this.logger.info('RDK_I001');
            let loginOK = await this.checkLogin();
            if (loginOK === null) {
                this.cookieJar = await this.login(acct);
                loginOK = await this.checkLogin();
            }
            this.loginState = loginOK;
        }
        if (forceGetStations === true || this.areaId === null) {
            const [token, areaId] = await this.getToken();
            this.token = token;
            this.areaId = areaId;
            await this.getStations();
        }
    }
    /**
     * 自身のエリアID(例: `JP13`)と会員種別(`AreaFree`など)を`/`区切りで返す。
     */
    async getMyAreaId() {
        let memberType;
        if (this.loginState !== null) {
            memberType = this.loginState.member_type.type;
        }
        else {
            memberType = '';
        }
        return this.areaId + '/' + memberType;
    }
    /**
     * メールアドレス/パスワードでRadikoにログインし、認証済みCookieJarを返す。
     * @param acct ログインに使うアカウント情報。
     */
    async login(acct) {
        this.logger.info('RDK_I002');
        const jar = new tough.CookieJar();
        try {
            await http_client_1.httpClient.post(radiko_urls_1.LOGIN_URL, {
                cookieJar: jar,
                form: { mail: acct.mail, pass: acct.pass },
            });
            return jar;
        }
        catch (error) {
            if (error.statusCode === 302) {
                return jar;
            }
            this.logger.error('RDK_E001', error);
            throw error;
        }
    }
    /**
     * 現在のCookieJarでログイン状態(会員種別)を確認する。未ログイン/失敗時はnullを返す。
     */
    async checkLogin() {
        this.logger.info('RDK_I003');
        try {
            const response = await http_client_1.httpClient.get(radiko_urls_1.CHECK_URL, {
                cookieJar: this.cookieJar,
                responseType: 'json',
            });
            const body = response.body;
            this.logger.info('RDK_I004', body.member_type.type);
            return body;
        }
        catch (error) {
            const statusCode = error?.response?.statusCode;
            if (statusCode === 400) {
                this.logger.info('RDK_I005');
                return null;
            }
            this.logger.error('RDK_E002', error);
            return null;
        }
    }
    /**
     * auth1/auth2の一連の認証フローを実行し、`[token, areaId]`を返す。
     */
    async getToken() {
        this.logger.info('RDK_I006');
        const auth1Headers = await this.auth1();
        const [partialKey, token] = this.getPartialKey(auth1Headers);
        const result = await this.auth2(token, partialKey);
        const [areaId] = result.trim().split(',');
        this.logger.info('RDK_I007', areaId);
        return [token, areaId];
    }
    /**
     * 認証第1段階。レスポンスヘッダーにトークンとパーシャルキー算出用のオフセット/長さが含まれる。
     */
    async auth1() {
        this.logger.info('RDK_I008');
        const res = await http_client_1.httpClient.get(radiko_urls_1.AUTH1_URL, {
            cookieJar: this.cookieJar,
            headers: radiko_urls_1.RADIKO_APP_HEADERS,
        });
        return res.headers;
    }
    /**
     * auth1のレスポンスヘッダーから、auth2に必要なパーシャルキー(base64)とトークンを算出する。
     * @param headers auth1のレスポンスヘッダー。
     * @returns `[partialKey, token]`。
     */
    getPartialKey(headers) {
        this.logger.info('RDK_I009');
        const token = headers['x-radiko-authtoken'];
        const offset = parseInt(headers['x-radiko-keyoffset'], 10);
        const length = parseInt(headers['x-radiko-keylength'], 10);
        const partialKey = Buffer.from(radiko_urls_1.AUTH_KEY.slice(offset, offset + length)).toString('base64');
        return [partialKey, token];
    }
    /**
     * 認証第2段階。成功するとレスポンスボディに`areaId,areaName,...`形式の文字列が返る。
     * @param token auth1で取得したトークン。
     * @param partialKey {@link getPartialKey}で算出したパーシャルキー。
     */
    async auth2(token, partialKey) {
        this.logger.info('RDK_I010');
        const res = await http_client_1.httpClient.get(radiko_urls_1.AUTH2_URL, {
            cookieJar: this.cookieJar,
            headers: {
                'X-Radiko-AuthToken': token,
                'X-Radiko-Partialkey': partialKey,
                'X-Radiko-User': 'dummy_user',
                'X-Radiko-Device': 'pc',
            },
        });
        return res.body;
    }
    /**
     * 全国局データ(`STATION_FULL_URL`)と全47エリアの局リスト(`STATION_AREA_URL`)を取得・突合し、
     * ログイン中またはエリア内から視聴可能な局のみを{@link Radiko.stations}へ格納する。
     */
    async getStations() {
        this.logger.info('RDK_I011');
        this.stations = new Map();
        this.areaData = new Map();
        // 1. フル局データを取得・パース
        const fullRes = await http_client_1.httpClient.get(radiko_urls_1.STATION_FULL_URL);
        const fullParsed = xmlParser.parse(fullRes.body);
        const regionData = fullParsed.region.stations.map((region) => ({
            region_name: region['@region_name'],
            region_id: region['@region_id'],
            ascii_name: region['@ascii_name'],
            stations: region.station.map((s) => ({
                // FM802対策: フル局データでは id が'FM802'という英数字表記だが、エリア別フィード
                // (STATION_AREA_URL)では802という数値表記で返るため、ここで合わせておかないと
                // 非プレミアムユーザーのエリア判定(allowedStations.includes(id))が一致しなくなる
                // (GitHub issue #21)。
                id: (s.id === 'FM802' ? '802' : String(s.id)),
                name: s.name,
                ascii_name: s.ascii_name,
                areafree: s.areafree,
                timefree: s.timefree,
                banner: s.banner,
                area_id: s.area_id,
                logo_url: Radiko.#pickLogoUrl(s.logo),
            })),
        }));
        // 2. 並列数制限付きで47エリア分の取得を並列化
        const limit = (0, p_limit_1.default)(5);
        const areaIDs = Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);
        await Promise.all(areaIDs.map((areaId) => limit(async () => {
            const res = await http_client_1.httpClient.get((0, util_1.format)(radiko_urls_1.STATION_AREA_URL, areaId));
            const parsed = xmlParser.parse(res.body);
            const stations = parsed.stations.station.map((s) => s.id);
            this.areaData.set(areaId, {
                areaName: parsed.stations['@area_name'],
                stations,
            });
        })));
        const areaData = this.areaData;
        let currentAreaID = this.areaId;
        if (currentAreaID === null) {
            currentAreaID = '';
        }
        let allowedStations = areaData.get(currentAreaID)?.stations.map(String);
        if (allowedStations === undefined) {
            allowedStations = [];
        }
        // 3. regionData をもとに stations を構成
        const logoCacheLimit = (0, p_limit_1.default)(5);
        const logoCacheTasks = [];
        for (const region of regionData) {
            for (const station of region.stations) {
                const id = station.id;
                let areaName = areaData.get(station.area_id)?.areaName?.replace(' JAPAN', '');
                if (areaName === undefined) {
                    areaName = '';
                }
                let areaKanji = area_name_1.AREA_KANJI.get(station.area_id);
                if (areaKanji === undefined) {
                    areaKanji = areaName;
                }
                if (this.loginState !== null || allowedStations.includes(id)) {
                    // 'TBS'
                    const stationInfo = {
                        // '関東'
                        regionName: region.region_name,
                        // 'http://radiko.jp/res/banner/radiko_banner.png'
                        bannerUrl: station.banner,
                        // 'JP13'
                        areaId: station.area_id,
                        // 'TOKYO'
                        areaName: areaName,
                        // '東京'
                        areaKanji: areaKanji,
                        // 'TBSラジオ'
                        name: station.name,
                        // 'TBS RADIO'
                        asciiName: station.ascii_name,
                        // '1'
                        areaFree: station.areafree,
                        // キャッシュ完了までの仮値(バナーで代用)
                        logoUrl: station.banner,
                    };
                    this.stations.set(id, stationInfo);
                    const remoteLogoUrl = station.logo_url || station.banner;
                    logoCacheTasks.push(logoCacheLimit(async () => {
                        stationInfo.logoUrl = await this.#cacheStationLogo(id, remoteLogoUrl);
                    }));
                }
            }
        }
        await Promise.all(logoCacheTasks);
        this.stationData = regionData;
    }
    /**
     * XMLからパースした`logo`要素(単一または配列)から、最大幅のロゴ画像URLを選択する。
     * @param logo `fast-xml-parser`でパースした`<logo>`要素(単一オブジェクトまたは配列)。
     */
    static #pickLogoUrl(logo) {
        if (logo === undefined || logo === null) {
            return '';
        }
        const logos = Array.isArray(logo) ? logo : [logo];
        if (logos.length === 0) {
            return '';
        }
        const widest = logos.reduce((best, current) => {
            const bestWidth = Number(best?.['@width']) || 0;
            const currentWidth = Number(current?.['@width']) || 0;
            return currentWidth > bestWidth ? current : best;
        });
        return widest?.['#text'] || '';
    }
    /**
     * 局ロゴをローカルにキャッシュする。Radikoのロゴ画像は透過PNGで見栄えが悪いため、
     * ffmpegで白背景合成してから`ASSETS_IMAGES_DIR`配下に保存する。既にキャッシュ済みならそのまま使い、
     * 変換に失敗した場合はリモートURLをそのまま返す(フェイルセーフ)。
     * @param stationId 局ID。
     * @param logoUrl Radiko側のロゴ(またはバナー)画像URL。
     */
    async #cacheStationLogo(stationId, logoUrl) {
        if (logoUrl === undefined || logoUrl === '') {
            return '';
        }
        const logoFileName = `${stationId}_logo.png`;
        const logoPath = path_1.default.join(plugin_paths_1.ASSETS_IMAGES_DIR, logoFileName);
        const sourceIconUrl = `/albumart?sourceicon=music_service/jp_radio/assets/images/${logoFileName}`;
        if (fs_1.default.existsSync(logoPath) === true) {
            return sourceIconUrl;
        }
        return new Promise((resolve) => {
            const ffmpeg = (0, child_process_1.spawn)('ffmpeg', [
                '-y', '-i', logoUrl, logoPath,
                '-filter_complex',
                'color=white,format=rgb24[c];[c][0]scale2ref[c][i];[c][i]overlay=format=auto:shortest=1,setsar=1',
                '-loglevel', 'error',
            ]);
            ffmpeg.on('close', (code) => {
                if (code === 0 && fs_1.default.existsSync(logoPath) === true) {
                    resolve(sourceIconUrl);
                }
                else {
                    this.logger.warn('RDK_W002', stationId, logoUrl);
                    resolve(logoUrl);
                }
            });
            ffmpeg.on('error', (error) => {
                this.logger.error('RDK_E010', stationId, error);
                resolve(logoUrl);
            });
        });
    }
    /**
     * 局IDから表示用の局名(日本語)を取得する。
     * @param stationId 局ID。
     */
    async getStationName(stationId) {
        let name = this.stations?.get(stationId)?.name;
        if (name === undefined) {
            name = '';
        }
        return name;
    }
    /**
     * 局IDからアスキー名(英語表記)を取得する。
     * @param stationId 局ID。
     */
    async getStationAsciiName(stationId) {
        let asciiName = this.stations?.get(stationId)?.asciiName;
        if (asciiName === undefined) {
            asciiName = '';
        }
        return asciiName;
    }
    /**
     * 指定局のライブストリームURLを解決し、ffmpegでAAC(ADTS)に変換しながらstdoutへ流すプロセスを起動する。
     * トークン取得・プレイリスト解決に失敗した場合は`MAX_RETRY_COUNT`回までトークンを取り直して再試行する。
     * @param station 局ID。
     * @returns 起動したffmpegの{@link ChildProcess}。局が存在しない/解決失敗の場合はnull。
     * @param timeFreeQuery 指定するとタイムフリー再生(過去の番組)を、指定しなければライブ再生を行う。
     * @param tempo タイムフリー再生の速度倍率(`1`以外を指定すると`atempo`フィルタを適用する)。ライブ再生には適用しない。
     * @param resumeSeek 指定すると、タイムフリー再生をこの実時刻(`'yyyyMMddHHmmss'`)から開始する(途中再開用)。
     */
    async play(station, timeFreeQuery, tempo, resumeSeek) {
        this.logger.info('RDK_I012', station);
        if (this.stations?.has(station) === false) {
            this.logger.warn('RDK_W001', station);
            return null;
        }
        let m3u8 = null;
        for (let i = 0; i < radiko_urls_1.MAX_RETRY_COUNT; i++) {
            if (this.token === null) {
                [this.token, this.areaId] = await this.getToken();
            }
            let playlistUrl;
            if (timeFreeQuery !== undefined) {
                playlistUrl = await this.getTimeFreePlaylistUrl(station, timeFreeQuery, resumeSeek);
            }
            else {
                playlistUrl = await this.getLivePlaylistUrl(station);
            }
            if (playlistUrl !== null) {
                m3u8 = await this.genTempChunkM3u8URL(playlistUrl, this.token);
            }
            if (m3u8 !== null) {
                break;
            }
            this.logger.info('RDK_I013');
            [this.token, this.areaId] = await this.getToken();
        }
        if (m3u8 === null) {
            this.logger.error('RDK_E003');
            return null;
        }
        // medialist/m3u8の取得にはAuthTokenだけでなくRadikoアプリ識別ヘッダー一式が必要
        const streamHeaders = [
            `X-Radiko-Authtoken:${this.token}`,
            ...Object.entries(radiko_urls_1.RADIKO_APP_HEADERS).map(([key, value]) => `${key}:${value}`),
        ].join('\r\n') + '\r\n';
        // ffmpegのHLSデマルチプレクサはプレイリストのreload時に-headersを引き継がずRadikoに拒否されるため、
        // プレイリスト取得だけはローカルのプロキシ経由にしてNode側で毎回正しいヘッダーを付けて中継する
        // (セグメント本体は直接Radikoから取得できておりそちらは問題ないので対象外)
        const proxyUrl = `http://127.0.0.1:${this.port}/radiko/medialist-proxy?url=${encodeURIComponent(m3u8)}&token=${encodeURIComponent(this.token)}`;
        // atempoフィルタで速度変更する場合は再エンコードが必要になるため、'-acodec copy'とは排他になる
        let codecArgs;
        if (timeFreeQuery !== undefined && tempo !== undefined && tempo !== 1) {
            codecArgs = ['-af', `atempo=${tempo}`];
        }
        else {
            codecArgs = ['-acodec', 'copy'];
        }
        // ffmpegはデフォルトでRange: bytes=0-を付けてシーク可否を確認しにいくが、
        // Radiko側がこれに対して不正な短いレスポンスを返すため、-seekable 0でRangeヘッダー送信を止める
        // -reconnect_at_eofは、プロキシ経由の正常完了したプレイリスト取得までEOFとして再接続扱いしてしまうため外す
        const args = [
            '-loglevel', 'error',
            '-y', '-seekable', '0',
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2',
            '-headers', streamHeaders,
            '-i', proxyUrl, ...codecArgs, '-f', 'adts', 'pipe:1'
        ];
        // ログに認証トークンをそのまま残さないよう、-headers(Authtoken)と-i(プロキシURLのtoken=)をマスクする
        const redactedArgs = args.map((arg) => {
            if (arg === streamHeaders) {
                return 'X-Radiko-Authtoken:***REDACTED***';
            }
            if (arg === proxyUrl) {
                return arg.replace(/token=[^&]+/, 'token=***REDACTED***');
            }
            return arg;
        });
        this.logger.info('RDK_I014', redactedArgs.join(' '));
        return (0, child_process_1.spawn)('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: true });
    }
    /**
     * ffmpegのHLSデマルチプレクサはプレイリストのreload時に-headersを引き継がないため、
     * ローカルプロキシ経由でこのメソッドを都度呼び出し、正しいRadikoヘッダーを付けて中継する。
     * @param upstreamUrl 中継先のRadiko側プレイリストURL。
     * @param token 付与する`X-Radiko-AuthToken`。
     */
    async fetchMedialist(upstreamUrl, token) {
        const res = await http_client_1.httpClient.get(upstreamUrl, {
            headers: { 'X-Radiko-AuthToken': token, ...radiko_urls_1.RADIKO_APP_HEADERS },
            responseType: 'buffer',
        });
        return {
            contentType: String(res.headers['content-type'] || 'application/vnd.apple.mpegurl'),
            body: res.body,
        };
    }
    /**
     * 局ごとのstream XML(`STATION_STREAM_XML_URL`)からライブ配信用`playlist_create_url`を選び、lsidを付与したURLを組み立てる。
     * @param station 局ID。
     */
    async getLivePlaylistUrl(station) {
        try {
            const res = await http_client_1.httpClient.get((0, util_1.format)(radiko_urls_1.STATION_STREAM_XML_URL, station));
            const parsed = xmlParser.parse(res.body);
            const rawEntries = parsed?.urls?.url;
            const chosen = (0, live_entry_selector_1.selectLiveEntry)(rawEntries, this.loginState !== null);
            const createUrl = chosen?.playlist_create_url;
            if (createUrl === undefined) {
                this.logger.error('RDK_E004', station);
                return null;
            }
            const lsid = (0, crypto_1.randomBytes)(16).toString('hex');
            return createUrl + (0, util_1.format)(radiko_urls_1.PLAY_LIVE_QUERY, station, lsid);
        }
        catch (error) {
            this.logger.error('RDK_E005', error);
            return null;
        }
    }
    /**
     * 局ごとのstream XML(`STATION_STREAM_XML_URL`)からタイムフリー配信用`playlist_create_url`を選び、
     * lsidと再生区間(`start_at`/`ft`/`end_at`/`to`)を付与したURLを組み立てる。
     * Radiko APIには実時刻表記が必要なため、ラジオ時間(24-29時表記)は{@link revCnvRadioTime}で実時刻に戻す。
     * @param station 局ID。
     * @param query 番組の放送区間。
     * @param resumeSeek 指定すると、Radiko側のタイムフリー再生をこの実時刻(`'yyyyMMddHHmmss'`)から開始する`seek`パラメータを付与する。
     */
    async getTimeFreePlaylistUrl(station, query, resumeSeek) {
        try {
            const res = await http_client_1.httpClient.get((0, util_1.format)(radiko_urls_1.STATION_STREAM_XML_URL, station));
            const parsed = xmlParser.parse(res.body);
            const rawEntries = parsed?.urls?.url;
            const chosen = (0, live_entry_selector_1.selectLiveEntry)(rawEntries, this.loginState !== null, '1');
            const createUrl = chosen?.playlist_create_url;
            if (createUrl === undefined) {
                this.logger.error('RDK_E006', station);
                return null;
            }
            const lsid = (0, crypto_1.randomBytes)(16).toString('hex');
            const ft = (0, radio_time_1.revCnvRadioTime)(query.ft);
            const to = (0, radio_time_1.revCnvRadioTime)(query.to);
            let playlistUrl = createUrl + (0, util_1.format)(radiko_urls_1.PLAY_TIME_FREE_QUERY, station, ft, ft, to, to, lsid);
            if (resumeSeek !== undefined) {
                playlistUrl += `&seek=${resumeSeek}`;
            }
            return playlistUrl;
        }
        catch (error) {
            this.logger.error('RDK_E007', error);
            return null;
        }
    }
    /**
     * マスタープレイリスト(m3u8)を取得し、ffmpegに渡すメディアプレイリストURIを1行目から抽出する。
     * @param url マスタープレイリストのURL。
     * @param token 付与する`X-Radiko-AuthToken`。
     */
    async genTempChunkM3u8URL(url, token) {
        try {
            const res = await http_client_1.httpClient.get(url, {
                headers: { 'X-Radiko-AuthToken': token, ...radiko_urls_1.RADIKO_APP_HEADERS },
            });
            // HLSマスタープレイリストから#で始まらない最初の行(メディアプレイリストURI)を取得
            // 新方式では variant URL が「.m3u8」で終わらない(例: /medialist?session=...)ことがあるため拡張子では判定しない
            const chunkUrl = res.body
                .split('\n')
                .map((line) => line.trim())
                .find((line) => line.startsWith('http') && !line.startsWith('#'));
            if (chunkUrl === undefined) {
                this.logger.error('RDK_E008', url, String(res.statusCode), res.body.slice(0, 500));
                return null;
            }
            return chunkUrl;
        }
        catch (error) {
            let bodyOrMessage = error?.response?.body;
            if (bodyOrMessage === undefined) {
                bodyOrMessage = error?.message;
            }
            this.logger.error('RDK_E009', url, String(error?.response?.statusCode), String(bodyOrMessage));
            return null;
        }
    }
}
exports.default = Radiko;
//# sourceMappingURL=radiko-service.js.map