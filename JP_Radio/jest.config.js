const { createDefaultPreset, pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig');

module.exports = {
  testEnvironment: 'node',
  // testディレクトリ内の.test.tsを対象
  testMatch: ['**/test/**/*.test.ts'],

  // TypeScript path alias(@/*)をJestにマッピング
  // baseUrlが"./src"のため、prefixにsrc/を含める
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/src/' }),

  // TypeScript で import/export を扱えるようにする(test/はsrc/の外にあるためrootDir制約のないtsconfig.test.jsonを使う)
  ...createDefaultPreset({ tsconfig: 'tsconfig.test.json' }),

  // Node.js 標準のモジュール解決を使う
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
};
