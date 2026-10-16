/**
 * プラグインのインストールルート(`dist/`と同階層。`i18n/`, `UIConfig.json`, `assets/`が配置される場所)。
 * このファイル自身の位置(コンパイル後は`dist/lib/utils/`、ts-node実行時は`src/lib/utils/`)を基準に
 * 3階層上をルートとして解決するため、呼び出し元のファイルがどの深さにあっても影響を受けない。
 * (`src/lib/utils`→プロジェクトルート、`dist/lib/utils`→`$PLUGIN_DIR`のいずれも3階層上で一致する)
 */
export declare const PLUGIN_ROOT: string;
/** `i18n/`ディレクトリへの絶対パス。 */
export declare const I18N_DIR: string;
/** `UIConfig.json`への絶対パス。 */
export declare const UI_CONFIG_PATH: string;
/** 局ロゴのローカルキャッシュ等を保存する`assets/images/`ディレクトリへの絶対パス。 */
export declare const ASSETS_IMAGES_DIR: string;
//# sourceMappingURL=plugin-paths.d.ts.map