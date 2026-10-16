'use strict';

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',

        // クラス・インターフェース・型エイリアス・Enum・型パラメータ → PascalCase
        {
          selector: ['class', 'interface', 'typeAlias', 'enum', 'typeParameter'],
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['PascalCase'],
        },

        // モジュール直下のconst(本当に変わらない定数) → UPPER_CASE
        // (camelCaseも許可: 定数だがUPPER_CASEにはしたくない値向け)
        {
          selector: 'variable',
          modifiers: ['const', 'global'],
          format: ['UPPER_CASE', 'camelCase'],
        },

        // それ以外の変数・関数・メソッド・パラメータ・アクセサ → camelCase
        {
          selector: ['variable', 'function', 'parameter', 'parameterProperty', 'method', 'accessor'],
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },

        // オブジェクト/クラス/型のプロパティ → camelCase
        // (Radikoの生XML/APIレスポンスを1:1で写すプロパティ(RegionData, RadikoXMLStationなど)は
        //  外部データ構造との対応を優先し、snake_caseも許可する)
        {
          selector: 'property',
          format: ['camelCase', 'snake_case'],
          leadingUnderscore: 'allow',
        },
        // '@id'のようにクォートが必要なプロパティ名は対象外
        {
          selector: 'property',
          format: null,
          modifiers: ['requiresQuotes'],
        },

        // importされた識別子は元ライブラリの命名規則に従うため対象外
        {
          selector: 'import',
          format: null,
        },
      ],
    },
  },
];
