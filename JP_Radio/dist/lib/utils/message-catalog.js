"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageCatalog = exports.MessageCatalog = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ini_1 = __importDefault(require("ini"));
const plugin_paths_1 = require("./plugin-paths");
/** `i18n/`配下で読み込む.iniカタログのファイル名(拡張子・言語コードを除く)。 */
const CATALOG_NAMES = ['log_messages', 'push_messages', 'browse_texts'];
/**
 * `i18n/{name}.{lang}.ini`からメッセージテンプレートを読み込み、`{0}`, `{1}`, ...形式の
 * プレースホルダを引数で置換して返す。英語を土台にして指定言語で上書きするため、まだ翻訳が無い
 * キーは自動的に英語へフォールバックする。
 */
class MessageCatalog {
    messages = {};
    /**
     * @param lang 読み込む言語コード(`i18n/{name}.{lang}.ini`)。実際の値は`setLanguage`で後から
     *   差し替えられる想定(生成時点ではVolumioの`language_code`がまだ分からないため)。
     */
    constructor(lang = 'ja') {
        this.setLanguage(lang);
    }
    /**
     * 言語を切り替えてメッセージカタログを再読込する。Volumioの`language_code`が判明した時点
     * (`onVolumioStart`)で呼ぶ想定。英語を先に読み込んでから指定言語で上書きすることで、
     * 未翻訳のキーは英語にフォールバックする。
     * @param lang 読み込む言語コード。
     */
    setLanguage(lang) {
        const merged = {};
        this.loadInto(merged, 'en');
        if (lang !== 'en') {
            this.loadInto(merged, lang);
        }
        this.messages = merged;
    }
    /**
     * 指定言語の.iniカタログ群を読み込み、`target`へマージする(既存キーは上書き)。
     * ファイルが存在しない/壊れている場合は静かにスキップする(その言語の翻訳が未整備なだけであり、
     * 呼び出し元に例外を伝播させてプラグイン全体を止めるべきではないため)。
     * @param target マージ先のオブジェクト。
     * @param lang 読み込む言語コード。
     */
    loadInto(target, lang) {
        for (const name of CATALOG_NAMES) {
            const filePath = path_1.default.join(plugin_paths_1.I18N_DIR, `${name}.${lang}.ini`);
            if (fs_1.default.existsSync(filePath) === false) {
                continue;
            }
            try {
                const parsed = ini_1.default.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
                Object.assign(target, parsed);
            }
            catch (error) {
                // 壊れた.iniファイル1つのせいでプラグイン全体がロードできなくなるのを防ぐ
                // (messageCatalogはモジュール読み込み時に生成されるシングルトンのため、ここで例外を投げてはいけない)。
                console.error(`[JP_Radio] Failed to load i18n catalog ${filePath}:`, error);
            }
        }
    }
    /**
     * メッセージIDに対応するテンプレートを取得し、`{0}`, `{1}`, ...を引数で置換する。
     * `Error`インスタンスを渡した場合はスタックトレース(無ければメッセージ)に展開する
     * (ログ出力でエラーの詳細をそのまま埋め込めるようにするため)。
     * @param messageId `i18n`の.iniファイルに定義されたキー。
     * @param params プレースホルダに埋め込む値(順序通り)。
     * @returns 該当キーが見つからない場合は`[Unknown message ID: ...]`を返す。
     */
    get(messageId, ...params) {
        const template = this.messages[messageId];
        if (template === undefined) {
            return `[Unknown message ID: ${messageId}]`;
        }
        return template.replace(/\{(\d+)\}/g, (_match, index) => {
            const value = params[Number(index)];
            if (value === undefined) {
                return `{${index}}`;
            }
            if (value instanceof Error) {
                let text = value.stack;
                if (text === undefined) {
                    text = value.message;
                }
                return text;
            }
            return String(value);
        });
    }
}
exports.MessageCatalog = MessageCatalog;
/** アプリ全体で共有するシングルトンインスタンス。 */
exports.messageCatalog = new MessageCatalog();
//# sourceMappingURL=message-catalog.js.map