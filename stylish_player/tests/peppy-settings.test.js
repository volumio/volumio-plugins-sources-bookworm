const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const libQ = require('kew');
const Config = require('v-conf');
const Controller = require('../index');

const makeController = (initial = {}) => {
  const toasts = [];
  const broadcasts = [];
  const values = new Map(Object.entries(initial));
  const controller = new Controller({
    coreCommand: {
      sharedVars: { get: () => 'en' },
      pushToastMessage: (...args) => toasts.push(args),
      broadcastMessage: (...args) => broadcasts.push(args),
      i18nJson: () => libQ.resolve(JSON.parse(fs.readFileSync(path.join(__dirname, '../UIConfig.json'), 'utf8'))),
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  controller.config = {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    set: (key, value) => values.set(key, value),
  };
  controller.checkVolumioKiosk = () => ({ exists: false });
  return { controller, values, toasts, broadcasts };
};

test('defaults and migration preserve the existing meter response', () => {
  const { controller, values } = makeController();
  assert.equal(controller._buildConfigData().peppyNeedleSensitivity, 0.5);
  assert.equal(controller._buildConfigData().peppySmoothness, 6);
  controller._migrateConfig();
  assert.equal(values.get('peppyNeedleSensitivity'), 0.5);
  assert.equal(values.get('peppySmoothness'), 6);
  values.set('peppyNeedleSensitivity', 2.3);
  values.set('peppySmoothness', 17);
  controller._migrateConfig();
  assert.equal(values.get('peppyNeedleSensitivity'), 2.3);
  assert.equal(values.get('peppySmoothness'), 17);
});

test('saves both pack types independently of visualization and broadcasts numeric settings', () => {
  const { controller, values, toasts, broadcasts } = makeController({ vizType: 'spectrum' });
  controller.configSavePeppy({
    peppyMeterFolder: { value: '1280x400-test', label: 'Test' },
    peppyMeterModel: { value: 'meter', label: 'Meter' },
    peppySpectrumFolder: '800x200-spectrum',
    peppySpectrumModel: 'random',
    peppyNeedleSensitivity: '2.3',
    peppySmoothness: '17',
  });
  assert.equal(values.get('peppyMeterFolder'), '1280x400-test');
  assert.equal(values.get('peppyMeterModel'), 'meter');
  assert.equal(values.get('peppySpectrumFolder'), '800x200-spectrum');
  assert.equal(values.get('peppySpectrumModel'), 'random');
  assert.equal(values.get('vizType'), 'spectrum');
  assert.equal(toasts[0][0], 'success');
  assert.equal(broadcasts[0][0], 'pushStylishPlayerConfig');
  assert.equal(broadcasts[0][1].peppyNeedleSensitivity, 2.3);
  assert.equal(broadcasts[0][1].peppySmoothness, 17);
});

test('accepts the exact lower and upper limits', () => {
  for (const [sensitivity, smoothness] of [[0.1, 1], [5, 30]]) {
    const { controller, toasts } = makeController();
    controller.configSavePeppy({ peppyNeedleSensitivity: sensitivity, peppySmoothness: smoothness });
    assert.equal(toasts[0][0], 'success');
  }
});

test('rejects invalid values without partially saving or broadcasting', () => {
  const invalidValues = [null, '', ' ', true, {}, [], NaN, Infinity, 'bad', '1x'];
  const invalidPairs = [
    ...[...invalidValues, 0, 0.09, 5.01].map((value) => [value, 6]),
    ...[...invalidValues, 0, 1.5, 31].map((value) => [0.5, value]),
  ];
  for (const [sensitivity, smoothness] of invalidPairs) {
    const { controller, values, toasts, broadcasts } = makeController({ peppyMeterFolder: 'original' });
    const before = [...values];
    controller.configSavePeppy({
      peppyMeterFolder: 'changed',
      peppyNeedleSensitivity: sensitivity,
      peppySmoothness: smoothness,
    });
    assert.deepEqual([...values], before);
    assert.equal(toasts[0][0], 'error');
    assert.equal(broadcasts.length, 0);
  }
});

test('older imports preserve response settings and player saves do not clear Peppy selections', () => {
  const { controller, values } = makeController({ peppyNeedleSensitivity: 2, peppySmoothness: 12 });
  controller.configSavePeppy({ peppyMeterFolder: 'pack', peppyMeterModel: 'model' });
  controller.configSavePlayerConfig({ vizType: { value: 'peppyMeter' } });
  assert.equal(values.get('peppyMeterFolder'), 'pack');
  assert.equal(values.get('peppyMeterModel'), 'model');
  assert.equal(values.get('peppyNeedleSensitivity'), 2);
  assert.equal(values.get('peppySmoothness'), 12);
  controller.configSavePlayerConfig({
    vizType: { value: 'peppySpectrum' },
    peppySpectrumFolder: { value: 'legacy-pack' },
    peppySpectrumModel: { value: 'legacy-model' },
  });
  assert.equal(values.get('peppySpectrumFolder'), 'legacy-pack');
  assert.equal(values.get('peppySpectrumModel'), 'legacy-model');
});

test('Volumio UI hydrates the new section and its save fields', async () => {
  const { controller } = makeController({ peppyNeedleSensitivity: 1.7, peppySmoothness: 9 });
  const ui = await controller.getUIConfig();
  const peppy = ui.sections.find((section) => section.id === 'section_peppy');
  const player = ui.sections.find((section) => section.id === 'section_player_config');
  assert.equal(peppy.onSave.method, 'configSavePeppy');
  assert.deepEqual(peppy.saveButton.data, peppy.content.map((field) => field.id));
  assert.equal(peppy.content.find((field) => field.id === 'peppyNeedleSensitivity').value, 1.7);
  assert.equal(peppy.content.find((field) => field.id === 'peppySmoothness').value, 9);
  assert.ok(!player.content.some((field) => field.id.startsWith('peppy')));
});

test('response settings survive a v-conf save and reload', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stylish-peppy-test-'));
  const filename = path.join(directory, 'config.json');
  try {
    fs.copyFileSync(path.join(__dirname, '../config.json'), filename);
    const { controller } = makeController();
    controller.config = new Config();
    controller.config.syncSave = true;
    controller.config.loadFile(filename);
    controller.configSavePeppy({ peppyNeedleSensitivity: 4.2, peppySmoothness: 25 });
    t.mock.timers.runAll();
    const reloaded = new Config();
    reloaded.loadFile(filename);
    assert.equal(reloaded.get('peppyNeedleSensitivity'), 4.2);
    assert.equal(reloaded.get('peppySmoothness'), 25);
  } finally {
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

test('all 25 languages contain every new Peppy translation', () => {
  const directory = path.join(__dirname, '../i18n');
  const files = fs.readdirSync(directory).filter((file) => /^strings_.*\.json$/.test(file));
  assert.equal(files.length, 25);
  const keys = ['PEPPY', 'PEPPY_NEEDLE_SENSITIVITY', 'PEPPY_NEEDLE_SENSITIVITY_DESC',
    'PEPPY_SMOOTHNESS', 'PEPPY_SMOOTHNESS_DESC', 'PEPPY_SETTINGS_SAVED', 'PEPPY_INVALID_SETTINGS'];
  for (const file of files) {
    const strings = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    for (const key of keys) assert.ok(strings[key]?.trim(), `${file}: missing ${key}`);
  }
});
