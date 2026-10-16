"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggerEx = void 0;
const message_catalog_1 = require("./message-catalog");
/**
 * Volumio標準のLoggerをラップし、メッセージID + 引数を渡すだけでログ出力できるようにする。
 * `i18n/log_messages.ja.ini`のIDから{@link messageCatalog}経由でメッセージ本文を解決し、
 * タイムスタンプ・プラグイン名・レベル・メッセージIDを付けて出力する。
 */
class LoggerEx {
    logger;
    /**
     * @param logger 実際の出力先となるVolumio標準Logger。
     */
    constructor(logger) {
        this.logger = logger;
    }
    /**
     * @param msgId `log_messages.ja.ini`に定義されたメッセージID。
     * @param params メッセージ内の`{0}`, `{1}`, ...に埋め込む値。
     */
    info(msgId, ...params) {
        this.log('info', msgId, ...params);
    }
    /**
     * @param msgId `log_messages.ja.ini`に定義されたメッセージID。
     * @param params メッセージ内の`{0}`, `{1}`, ...に埋め込む値。
     */
    warn(msgId, ...params) {
        this.log('warn', msgId, ...params);
    }
    /**
     * @param msgId `log_messages.ja.ini`に定義されたメッセージID。
     * @param params メッセージ内の`{0}`, `{1}`, ...に埋め込む値。
     */
    error(msgId, ...params) {
        this.log('error', msgId, ...params);
    }
    /**
     * @param level ログレベル。
     * @param msgId `log_messages.ja.ini`に定義されたメッセージID。
     * @param params メッセージ内の`{0}`, `{1}`, ...に埋め込む値。
     */
    log(level, msgId, ...params) {
        const message = message_catalog_1.messageCatalog.get(msgId, ...params);
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] [JP_Radio] [${level.toUpperCase()}] [${msgId}] ${message}`;
        this.logger[level](formatted);
    }
}
exports.LoggerEx = LoggerEx;
//# sourceMappingURL=logger.js.map