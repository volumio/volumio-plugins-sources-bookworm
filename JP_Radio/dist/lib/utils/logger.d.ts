/**
 * Volumio標準のLoggerをラップし、メッセージID + 引数を渡すだけでログ出力できるようにする。
 * `i18n/log_messages.ja.ini`のIDから{@link messageCatalog}経由でメッセージ本文を解決し、
 * タイムスタンプ・プラグイン名・レベル・メッセージIDを付けて出力する。
 */
export declare class LoggerEx {
    private readonly logger;
    /**
     * @param logger 実際の出力先となるVolumio標準Logger。
     */
    constructor(logger: Console);
    /**
     * @param msgId `log_messages.ja.ini`に定義されたメッセージID。
     * @param params メッセージ内の`{0}`, `{1}`, ...に埋め込む値。
     */
    info(msgId: string, ...params: (string | number | Error)[]): void;
    /**
     * @param msgId `log_messages.ja.ini`に定義されたメッセージID。
     * @param params メッセージ内の`{0}`, `{1}`, ...に埋め込む値。
     */
    warn(msgId: string, ...params: (string | number | Error)[]): void;
    /**
     * @param msgId `log_messages.ja.ini`に定義されたメッセージID。
     * @param params メッセージ内の`{0}`, `{1}`, ...に埋め込む値。
     */
    error(msgId: string, ...params: (string | number | Error)[]): void;
    /**
     * @param level ログレベル。
     * @param msgId `log_messages.ja.ini`に定義されたメッセージID。
     * @param params メッセージ内の`{0}`, `{1}`, ...に埋め込む値。
     */
    private log;
}
//# sourceMappingURL=logger.d.ts.map