"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_client_1 = require("../utils/http-client");
const nedb_promises_1 = __importDefault(require("nedb-promises"));
const fast_xml_parser_1 = require("fast-xml-parser");
const util_1 = require("util");
const p_limit_1 = __importDefault(require("p-limit"));
const radiko_urls_1 = require("../consts/radiko-urls");
const radio_time_1 = require("../utils/radio-time");
const xml_1 = require("../utils/xml");
const station_filter_1 = require("../logic/station-filter");
const EMPTY_PROGRAM = {
    station: '',
    id: '',
    ft: '',
    tt: '',
    title: '',
    pfm: '',
    img: '',
};
/**
 * 番組表データを管理するModel層。取得したXMLをパースし、nedbのインメモリDBに保存・検索する。
 * 現在放送中の番組を高速に引けるよう、直近の検索結果を`cachedProgram`にキャッシュする。
 */
class RdkProg {
    logger;
    db = nedb_promises_1.default.create({ inMemoryOnly: true });
    xmlParser = new fast_xml_parser_1.XMLParser({
        attributeNamePrefix: '@',
        ignoreAttributes: false,
        allowBooleanAttributes: true,
    });
    lastStation = '';
    lastTime = '';
    cachedProgram = { ...EMPTY_PROGRAM };
    /**
     * @param logger ログ出力先。
     */
    constructor(logger) {
        this.logger = logger;
        this.initDBIndexes();
    }
    /**
     * 指定局の現在放送中の番組を返す。直前と同じ局・同じ分であればキャッシュを返す。
     * @param station 局ID。
     */
    async getCurProgram(station) {
        const currentTime = (0, radio_time_1.toMinutePrecision)((0, radio_time_1.getCurrentRadioTime)());
        if (station !== this.lastStation || currentTime !== this.lastTime) {
            try {
                // TODO: TBS,YFM,MBS,NORTHWAVE,etcでヒットしない問題
                //       (常にってわけじゃなく時々なのが非常に厄介)
                const result = await this.db.findOne({
                    station,
                    ft: { $lt: currentTime + '01' },
                    tt: { $gt: currentTime + '01' },
                });
                if (result !== null) {
                    this.cachedProgram = result;
                }
                else {
                    this.logger.warn('PRG_W001', station, currentTime);
                    this.cachedProgram = { ...EMPTY_PROGRAM };
                }
                this.lastStation = station;
                this.lastTime = currentTime;
            }
            catch (error) {
                this.logger.error('PRG_E002', station, error);
            }
        }
        if (this.cachedProgram.id !== '') {
            return this.cachedProgram;
        }
        return undefined;
    }
    /**
     * 指定局・指定放送開始時刻(`ft`)に一致する番組をDBから検索する。
     * タイムフリー再生時に、URIで指定された`ft`から番組のタイトル等を引くために使う。
     * @param station 局ID。
     * @param ft 放送開始時刻(ラジオ時間、`'yyyyMMddHHmmss'`)。
     */
    async findProgram(station, ft) {
        try {
            const result = await this.db.findOne({ station, ft });
            if (result !== null) {
                return result;
            }
            return undefined;
        }
        catch (error) {
            this.logger.error('PRG_E003', station, ft, error);
            return undefined;
        }
    }
    /**
     * 番組データを1件DBへ挿入する。重複挿入(`uniqueViolated`)はエラーログを出さず無視する。
     * @param prog 挿入する番組データ。
     */
    async putProgram(prog) {
        try {
            await this.db.insert(prog);
        }
        catch (error) {
            if (error?.errorType !== 'uniqueViolated') {
                this.logger.error('PRG_E004', error);
            }
        }
    }
    /**
     * 終了時刻が現在時刻より前の古い番組データをDBから削除する。
     */
    async clearOldProgram() {
        try {
            // TODO: TBS,MBS消しすぎてない??
            const currentTime = (0, radio_time_1.toMinutePrecision)((0, radio_time_1.getCurrentRadioTime)());
            await this.db.remove({ tt: { $lt: currentTime } }, { multi: true });
        }
        catch (error) {
            this.logger.error('PRG_E005', error);
        }
    }
    /**
     * 指定エリア群の番組表XML(`PROG_DATE_AREA_URL`)を並列(最大5並列)で取得し、DBへ格納する。
     * 全国広域局(RN1/RN2/JOAK-FM)は`JP13`のみで処理し、NHK地方局(JO**)はエリアフリー局と
     * 重複しないよう1度だけ処理することで、同一番組の多重登録を防いでいる。
     * @param areaIdArray 取得対象のエリアID一覧(例: `['JP13', 'JP14']`)。
     * @param stationsMap 局IDから{@link StationInfo}を引くためのマップ(所属エリア判定に使用)。
     * @param whenBoot trueの場合は起動時取得としてラジオ時間(`getCurrentRadioDate`)基準の日付を使う。
     */
    async updatePrograms(areaIdArray, stationsMap, whenBoot) {
        // boot時はラジオ時間で，cron時は実時間で取得
        let currentDate;
        let bootOrCron;
        if (whenBoot === true) {
            currentDate = (0, radio_time_1.getCurrentRadioDate)();
            bootOrCron = 'boot';
        }
        else {
            currentDate = (0, radio_time_1.getCurrentDate)();
            bootOrCron = 'cron';
        }
        this.logger.info('PRG_I001', bootOrCron, currentDate);
        const limit = (0, p_limit_1.default)(5);
        const doneAreaFree = new Set();
        const tasks = areaIdArray.map((areaId) => limit(async () => {
            const url = (0, util_1.format)(radiko_urls_1.PROG_DATE_AREA_URL, currentDate, areaId);
            try {
                const response = await http_client_1.httpClient.get(url);
                const xmlData = this.xmlParser.parse(response.body);
                const stations = (0, xml_1.toArray)(xmlData?.radiko?.stations?.station);
                for (const stationData of stations) {
                    // FM802対策
                    const stationId = String(stationData['@id']);
                    // 広域局の多重処理をスキップ
                    const station = stationsMap?.get(stationId);
                    if (station === undefined) {
                        // 情報がなければスキップ(nonAreaFreeでエリア外)
                        continue;
                    }
                    if ((0, station_filter_1.isStationRelevantForArea)(station, areaId) === false) {
                        continue;
                    }
                    // NHK地方局(JO**)
                    if ((0, station_filter_1.isDuplicateAreaFreeStation)(station, stationId, doneAreaFree) === true) {
                        continue;
                    }
                    else {
                        doneAreaFree.add(stationId);
                    }
                    const progRaw = stationData.progs?.prog;
                    if (progRaw === undefined) {
                        continue;
                    }
                    const progs = (0, xml_1.toArray)(progRaw);
                    const today = (0, radio_time_1.parseRadioTime)(progs[0]['@ft']).date;
                    for (const prog of progs) {
                        let pfm = prog['pfm'];
                        if (pfm === undefined) {
                            pfm = '';
                        }
                        const program = {
                            // FM802対策
                            station: String(stationId),
                            id: stationId + prog['@id'],
                            ft: (0, radio_time_1.cnvRadioTime)(prog['@ft'], today),
                            tt: (0, radio_time_1.cnvRadioTime)(prog['@to'], today),
                            title: prog['title'],
                            pfm,
                            img: prog['img'],
                        };
                        await this.putProgram(program);
                    }
                }
            }
            catch (error) {
                this.logger.error('PRG_E006', areaId, error);
            }
        }));
        await Promise.all(tasks);
    }
    /**
     * 指定局の前後1週間分(`PROG_WEEKLY_STATION_URL`)の番組表を取得し、DBへ保存した上で配列として返す。
     * タイムフリーのブラウズ一覧を組み立てるために使う。
     * 週次レスポンスは日ごとに`progs`ブロックが分かれているため、`updatePrograms`と同様に
     * 各ブロックの先頭番組の日付をその日の基準日として個別に`cnvRadioTime`で正規化する。
     * @param stationId 局ID。
     */
    async getStationPrograms(stationId) {
        const url = (0, util_1.format)(radiko_urls_1.PROG_WEEKLY_STATION_URL, stationId);
        const programs = [];
        try {
            const response = await http_client_1.httpClient.get(url);
            const xmlData = this.xmlParser.parse(response.body);
            const stations = (0, xml_1.toArray)(xmlData?.radiko?.stations?.station);
            for (const stationData of stations) {
                const progsBlocks = (0, xml_1.toArray)(stationData.progs);
                for (const block of progsBlocks) {
                    const progs = (0, xml_1.toArray)(block?.prog);
                    if (progs.length === 0) {
                        continue;
                    }
                    const today = (0, radio_time_1.parseRadioTime)(progs[0]['@ft']).date;
                    for (const prog of progs) {
                        let pfm = prog['pfm'];
                        if (pfm === undefined) {
                            pfm = '';
                        }
                        const program = {
                            station: String(stationId),
                            id: stationId + prog['@id'],
                            ft: (0, radio_time_1.cnvRadioTime)(prog['@ft'], today),
                            tt: (0, radio_time_1.cnvRadioTime)(prog['@to'], today),
                            title: prog['title'],
                            pfm,
                            img: prog['img'],
                        };
                        programs.push(program);
                        await this.putProgram(program);
                    }
                }
            }
        }
        catch (error) {
            this.logger.error('PRG_E007', stationId, error);
        }
        return programs;
    }
    /**
     * 指定局・指定日の番組表XML(`PROG_DAILY_STATION_URL`)を取得し、DBへ保存した上で配列として返す。
     * `getStationPrograms`(前後1週間分)ではカバーできない、7日より前/後の日付を個別に補うために使う。
     * @param stationId 局ID。
     * @param date 対象日(`'yyyyMMdd'`)。
     */
    async getStationProgramsForDate(stationId, date) {
        const url = (0, util_1.format)(radiko_urls_1.PROG_DAILY_STATION_URL, date, stationId);
        const programs = [];
        try {
            const response = await http_client_1.httpClient.get(url);
            const xmlData = this.xmlParser.parse(response.body);
            const stations = (0, xml_1.toArray)(xmlData?.radiko?.stations?.station);
            for (const stationData of stations) {
                const progsBlocks = (0, xml_1.toArray)(stationData.progs);
                for (const block of progsBlocks) {
                    const progs = (0, xml_1.toArray)(block?.prog);
                    if (progs.length === 0) {
                        continue;
                    }
                    const today = (0, radio_time_1.parseRadioTime)(progs[0]['@ft']).date;
                    for (const prog of progs) {
                        let pfm = prog['pfm'];
                        if (pfm === undefined) {
                            pfm = '';
                        }
                        const program = {
                            station: String(stationId),
                            id: stationId + prog['@id'],
                            ft: (0, radio_time_1.cnvRadioTime)(prog['@ft'], today),
                            tt: (0, radio_time_1.cnvRadioTime)(prog['@to'], today),
                            title: prog['title'],
                            pfm,
                            img: prog['img'],
                        };
                        programs.push(program);
                        await this.putProgram(program);
                    }
                }
            }
        }
        catch (error) {
            this.logger.error('PRG_E008', stationId, date, error);
        }
        return programs;
    }
    /**
     * 指定局について、複数日分の番組表(`getStationProgramsForDate`)を並列(最大5並列)で取得する。
     * @param stationId 局ID。
     * @param dates 対象日(`'yyyyMMdd'`)の配列。
     */
    async getStationProgramsForDates(stationId, dates) {
        const limit = (0, p_limit_1.default)(5);
        const results = await Promise.all(dates.map((date) => limit(() => this.getStationProgramsForDate(stationId, date))));
        return results.flat();
    }
    /**
     * DBファイルをコンパクションして終了する(プラグイン停止時に呼ばれる)。
     */
    async dbClose() {
        this.logger.info('PRG_I002');
        await this.db.persistence.compactDatafile();
    }
    /**
     * DB内の全番組データを返す(デバッグ/確認用エンドポイント`/radiko/all/stations`向け)。
     */
    async allData() {
        return await this.db.find({});
    }
    /**
     * 検索頻度の高いフィールド(id/station/ft/tt)にインデックスを張る。idはユニーク制約。
     */
    initDBIndexes() {
        this.db.ensureIndex({ fieldName: 'id', unique: true });
        this.db.ensureIndex({ fieldName: 'station' });
        this.db.ensureIndex({ fieldName: 'ft' });
        this.db.ensureIndex({ fieldName: 'tt' });
    }
}
exports.default = RdkProg;
//# sourceMappingURL=prog-service.js.map