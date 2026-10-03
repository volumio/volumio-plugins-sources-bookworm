'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const libQ = require('kew');
const Plugin = require('../index');
const catalog = require('../python/volumio_screensaver/fonts/catalog.json');
const pluginDirectory = path.join(__dirname, '..');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pirate-fonts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const toasts = [];
  const modals = [];
  const commands = [];
  const writes = [];
  const router = {
    sharedVars: { get: () => options.language || 'en' },
    pushToastMessage: (...args) => toasts.push(args),
    broadcastMessage: (...args) => modals.push(args),
    i18nJson: () => libQ.resolve(JSON.parse(fs.readFileSync(path.join(pluginDirectory, 'UIConfig.json'), 'utf8')))
  };
  const plugin = new Plugin({ coreCommand: router, logger: { info() {}, warn() {}, error() {} } });
  const schema = JSON.parse(fs.readFileSync(path.join(pluginDirectory, 'config.json'), 'utf8'));
  if (options.legacy) delete schema.enabled_fonts;
  const configFile = path.join(directory, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(schema));
  plugin.config.loadFile(configFile);
  // Exercise the real v-conf value coercion without its delayed background saves.
  delete plugin.config.filePath;
  plugin.persistDir = path.join(directory, 'persist');
  plugin.persistFile = path.join(plugin.persistDir, 'settings.json');
  if (options.persisted) {
    fs.mkdirSync(plugin.persistDir);
    fs.writeFileSync(plugin.persistFile, JSON.stringify(options.persisted));
  }
  plugin.ensureDefaultSettings();
  plugin.loadPersistedSettings();
  plugin.writeRootFile = (filename, content) => {
    writes.push({ filename, content });
    return libQ.resolve();
  };
  plugin.runCommand = command => {
    commands.push(command);
    return options.restartFails ? libQ.reject(new Error('restart failed')) : libQ.resolve();
  };
  return { plugin, toasts, modals, commands, writes, directory };
}

function switches(selected) {
  return Object.fromEntries(catalog.map(font => ['font_' + font.id, selected.includes(font.id)]));
}

test('upgrade from 0.1.5 preserves existing settings and enables every font', t => {
  const { plugin } = fixture(t, { legacy: true, persisted: { idle_delay_seconds: 120, display_rotation: 270 } });
  assert.equal(plugin.getSetting('idle_delay_seconds'), 120);
  assert.equal(plugin.getSetting('display_rotation'), 270);
  assert.deepEqual(plugin.getEnabledFonts(), catalog.map(font => font.id));
  assert.equal(typeof plugin.config.get('enabled_fonts'), 'string');
});

test('UI has 15 saved native switches and correct current values and local previews', async t => {
  const { plugin } = fixture(t, { persisted: { enabled_fonts: ['digital-7', 'poxel'] } });
  const ui = await plugin.getUIConfig();
  const section = ui.sections.find(item => item.id === 'fonts');
  const fields = section.content.filter(item => item.element === 'switch');
  assert.equal(fields.length, 15);
  assert.equal(section.saveButton.data.length, 15);
  assert.equal(section.onSave.endpoint, 'user_interface/pirate_audio_screensaver');
  for (const font of catalog) {
    const field = fields.find(item => item.id === 'font_' + font.id);
    assert.equal(field.value, ['digital-7', 'poxel'].includes(font.id));
    assert.equal(field.label, font.label);
    const encoded = field.doc.match(/src="data:image\/png;base64,([^"]+)"/)[1];
    assert.deepEqual(Buffer.from(encoded, 'base64'), fs.readFileSync(path.join(pluginDirectory, 'previews', font.id + '.png')));
    assert.match(field.doc, /img-responsive/);
  }
  const repeated = await plugin.getUIConfig();
  assert.equal(repeated.sections.find(item => item.id === 'fonts').saveButton.data.length, 15);
});

test('font selection persists, reaches Python environment and survives reload', async t => {
  const f = fixture(t);
  await f.plugin.saveFontSettings(switches(['digital-7', 'poxel']));
  assert.deepEqual(f.plugin.getEnabledFonts(), ['digital-7', 'poxel']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.plugin.persistFile)).enabled_fonts, ['digital-7', 'poxel']);
  assert.match(f.writes[0].content, /^ENABLED_FONTS=digital-7,poxel$/m);
  assert.equal(f.writes[0].filename, path.join(pluginDirectory, 'volumio-screensaver.env'));
  assert.deepEqual(f.commands, ['sudo -n systemctl restart volumio-screensaver.service']);
  f.plugin.config.set('enabled_fonts', f.plugin.defaults.enabled_fonts);
  f.plugin.loadPersistedSettings();
  assert.deepEqual(f.plugin.getEnabledFonts(), ['digital-7', 'poxel']);
});

test('the sole enabled font remains exactly that font', async t => {
  const { plugin, writes } = fixture(t);
  await plugin.saveFontSettings(switches(['poxel']));
  assert.deepEqual(plugin.getEnabledFonts(), ['poxel']);
  assert.match(writes[0].content, /^ENABLED_FONTS=poxel$/m);
});

test('rejecting all-disabled leaves configuration and runtime unchanged', async t => {
  const f = fixture(t, { persisted: { enabled_fonts: ['poxel'] }, language: 'fr' });
  const before = fs.readFileSync(f.plugin.persistFile, 'utf8');
  await assert.rejects(Promise.resolve(f.plugin.saveFontSettings(switches([]))), /au moins une/);
  assert.deepEqual(f.plugin.getEnabledFonts(), ['poxel']);
  assert.equal(fs.readFileSync(f.plugin.persistFile, 'utf8'), before);
  assert.equal(f.commands.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.toasts.at(-1)[0], 'error');
});

test('wrapped boolean fields and partial updates preserve other switches', async t => {
  const { plugin } = fixture(t, { persisted: { enabled_fonts: ['digital-7'] } });
  await plugin.saveFontSettings({ 'font_poxel': { value: true }, 'font_digital-7': { value: false } });
  assert.deepEqual(plugin.getEnabledFonts(), ['poxel']);
  await plugin.saveFontSettings(undefined);
  assert.deepEqual(plugin.getEnabledFonts(), ['poxel']);
});

test('saving general settings preserves font selection', async t => {
  const { plugin, writes } = fixture(t, { persisted: { enabled_fonts: ['poxel'] } });
  await plugin.saveSettings({ idle_delay_seconds: 180, display_rotation: { value: 180 } });
  assert.deepEqual(plugin.getEnabledFonts(), ['poxel']);
  assert.match(writes[0].content, /^IDLE_DELAY_SECONDS=180$/m);
  assert.match(writes[0].content, /^DISPLAY_ROTATION=180$/m);
  assert.match(writes[0].content, /^ENABLED_FONTS=poxel$/m);
});

test('native gallery contains all previews and a translated dismiss button', async t => {
  const { plugin, modals } = fixture(t, { language: 'fr' });
  await plugin.showFontPreviews();
  assert.equal(modals[0][0], 'openModal');
  assert.equal((modals[0][1].message.match(/data:image\/png;base64,/g) || []).length, 15);
  assert.equal(modals[0][1].buttons[0].name, 'Fermer');
  assert.equal(modals[0][1].buttons[0].emit, '');
});

test('persistence failure restores selection and never applies runtime settings', async t => {
  const f = fixture(t, { persisted: { enabled_fonts: ['poxel'] } });
  fs.mkdirSync(path.join(f.directory, 'not-a-file'));
  f.plugin.persistFile = path.join(f.directory, 'not-a-file');
  await assert.rejects(Promise.resolve(f.plugin.saveFontSettings(switches(['digital-7']))));
  assert.deepEqual(f.plugin.getEnabledFonts(), ['poxel']);
  assert.equal(f.commands.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.toasts.at(-1)[0], 'error');
});

test('restart failure is reported without a false success toast', async t => {
  const f = fixture(t, { restartFails: true });
  await assert.rejects(Promise.resolve(f.plugin.saveFontSettings(switches(['poxel']))), /restart failed/);
  assert.equal(f.toasts.some(toast => toast[0] === 'success'), false);
  assert.equal(f.toasts.at(-1)[0], 'error');
});

test('obsolete and malicious IDs never enter the Python environment', async t => {
  const { plugin, writes } = fixture(t, { persisted: { enabled_fonts: ['poxel', 'unknown', "$(touch /tmp/bad)", 'poxel'] } });
  await plugin.writeEnvironmentFile();
  assert.deepEqual(plugin.getEnabledFonts(), ['poxel']);
  assert.match(writes[0].content, /^ENABLED_FONTS=poxel$/m);
  assert.doesNotMatch(writes[0].content, /unknown|touch/);
});

test('corrupt persisted selection recovers to one font', t => {
  const { plugin } = fixture(t, { persisted: { enabled_fonts: [] } });
  assert.deepEqual(plugin.getEnabledFonts(), ['ds-digital']);
});

test('enabling installs the shared display before starting the screensaver', async t => {
  const f = fixture(t);
  await f.plugin.onStart();
  assert.match(f.writes[0].content, /^DISPLAY_BRIDGE_SOCKET=\/run\/volumio-screensaver\/pirateaudio.sock$/m);
  assert.match(f.commands[0], /^sudo -n \/bin\/sh .*display-bridge\.sh' enable$/);
  assert.deepEqual(f.commands.slice(1), [
    'sudo -n systemctl enable volumio-screensaver.service',
    'sudo -n systemctl restart volumio-screensaver.service'
  ]);
});

test('disabling stops the screensaver before restoring the native hardware service', async t => {
  const f = fixture(t);
  await f.plugin.onStop();
  assert.deepEqual(f.commands.slice(0, 2), [
    'sudo -n systemctl stop volumio-screensaver.service || true',
    'sudo -n systemctl disable volumio-screensaver.service || true'
  ]);
  assert.match(f.commands[2], /^sudo -n \/bin\/sh .*display-bridge\.sh' disable$/);
});

test('an enable failure attempts to remove the bridge and does not report success', async t => {
  const f = fixture(t, { restartFails: true });
  // Only activation fails; recovery operations remain possible.
  f.plugin.runCommand = command => {
    f.commands.push(command);
    return command.endsWith(' enable') ? libQ.reject(new Error('hardware unavailable')) : libQ.resolve();
  };
  await assert.rejects(Promise.resolve(f.plugin.onStart()), /hardware unavailable/);
  assert.match(f.commands.at(-1), /display-bridge\.sh' disable$/);
  assert.equal(f.commands.some(command => command === 'sudo -n systemctl restart volumio-screensaver.service'), false);
});
