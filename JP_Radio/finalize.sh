#!/bin/bash

PLUGIN_DIR="/data/plugins/music_service/jp_radio"

# 旧バージョンがあれば削除
if [ -d "$PLUGIN_DIR" ]; then
    rm -rf "$PLUGIN_DIR"
fi

# 親ディレクトリがなければ作成
mkdir -p "$PLUGIN_DIR"

cat >dist/package.json <<!EOF
{
  "type": "commonjs"
}
!EOF

cp -r dist "$PLUGIN_DIR/"
cp -r node_modules "$PLUGIN_DIR/"
cp -r UIConfig.json "$PLUGIN_DIR/"
cp -r i18n "$PLUGIN_DIR/"
cp -r assets "$PLUGIN_DIR/"
cp config.json "$PLUGIN_DIR/"
cp package.json "$PLUGIN_DIR/"
cp install.sh uninstall.sh "$PLUGIN_DIR/"