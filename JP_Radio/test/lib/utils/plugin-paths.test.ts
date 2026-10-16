import fs from 'fs';
import path from 'path';
import { PLUGIN_ROOT, I18N_DIR, UI_CONFIG_PATH } from '@/utils/plugin-paths';

describe('plugin-paths', () => {
  it('PLUGIN_ROOTはpackage.jsonがある場所(プラグインルート)を指す', () => {
    expect(fs.existsSync(path.join(PLUGIN_ROOT, 'package.json'))).toBe(true);
  });

  it('I18N_DIRは実際のi18nディレクトリを指す', () => {
    expect(fs.existsSync(path.join(I18N_DIR, 'push_messages.ja.ini'))).toBe(true);
  });

  it('UI_CONFIG_PATHは実際のUIConfig.jsonを指す', () => {
    expect(fs.existsSync(UI_CONFIG_PATH)).toBe(true);
  });
});
