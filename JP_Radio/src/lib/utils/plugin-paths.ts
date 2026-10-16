import path from 'path';

/**
 * プラグインのインストールルート(`dist/`と同階層。`i18n/`, `UIConfig.json`, `assets/`が配置される場所)。
 * このファイル自身の位置(コンパイル後は`dist/lib/utils/`、ts-node実行時は`src/lib/utils/`)を基準に
 * 3階層上をルートとして解決するため、呼び出し元のファイルがどの深さにあっても影響を受けない。
 * (`src/lib/utils`→プロジェクトルート、`dist/lib/utils`→`$PLUGIN_DIR`のいずれも3階層上で一致する)
 */
export const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');

/** `i18n/`ディレクトリへの絶対パス。 */
export const I18N_DIR = path.join(PLUGIN_ROOT, 'i18n');

/** `UIConfig.json`への絶対パス。 */
export const UI_CONFIG_PATH = path.join(PLUGIN_ROOT, 'UIConfig.json');

/** 局ロゴのローカルキャッシュ等を保存する`assets/images/`ディレクトリへの絶対パス。 */
export const ASSETS_IMAGES_DIR = path.join(PLUGIN_ROOT, 'assets', 'images');
