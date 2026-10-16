"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSETS_IMAGES_DIR = exports.UI_CONFIG_PATH = exports.I18N_DIR = exports.PLUGIN_ROOT = void 0;
const path_1 = __importDefault(require("path"));
/**
 * プラグインのインストールルート(`dist/`と同階層。`i18n/`, `UIConfig.json`, `assets/`が配置される場所)。
 * このファイル自身の位置(コンパイル後は`dist/lib/utils/`、ts-node実行時は`src/lib/utils/`)を基準に
 * 3階層上をルートとして解決するため、呼び出し元のファイルがどの深さにあっても影響を受けない。
 * (`src/lib/utils`→プロジェクトルート、`dist/lib/utils`→`$PLUGIN_DIR`のいずれも3階層上で一致する)
 */
exports.PLUGIN_ROOT = path_1.default.resolve(__dirname, '..', '..', '..');
/** `i18n/`ディレクトリへの絶対パス。 */
exports.I18N_DIR = path_1.default.join(exports.PLUGIN_ROOT, 'i18n');
/** `UIConfig.json`への絶対パス。 */
exports.UI_CONFIG_PATH = path_1.default.join(exports.PLUGIN_ROOT, 'UIConfig.json');
/** 局ロゴのローカルキャッシュ等を保存する`assets/images/`ディレクトリへの絶対パス。 */
exports.ASSETS_IMAGES_DIR = path_1.default.join(exports.PLUGIN_ROOT, 'assets', 'images');
//# sourceMappingURL=plugin-paths.js.map