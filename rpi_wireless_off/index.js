'use strict';

// The Volumio side of RPi Wireless Off. lib/ does the work: it rewrites the plugin's block in
// userconfig.txt, reads the chips and the board, and decides what a Save does. This file hooks
// that into Volumio: the start-up checks, the settings page and the messages to the user.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const libQ = require('kew');
const VConf = require('v-conf');

const decide = require('./lib/decide');
const health = require('./lib/health');
const radios = require('./lib/radios');
const run = require('./lib/run');
const userconfig = require('./lib/userconfig');

const NAMESPACE = 'RPI_WIRELESS_OFF';
const LOG_PREFIX = 'rpi_wireless_off: ';
const I18N_DIR = path.join(__dirname, 'i18n');
const SUDO = '/usr/bin/sudo';

// The words for an error. The Error that Volumio's i18nJson rejects with has no message.
const reason = (err) => (err && err.message) || String(err);

const byId = (list, id) => list.find((entry) => entry.id === id);

// A switch's value is true when the chip is on. The page may send false or 'false' for off.
const isOff = (value) => value === false || value === 'false';

// The string that names the chips in a list from comingBackOn.
function chipsKey(chips) {
  if (chips.length === 2) return 'CHIPS_BOTH';
  return chips[0] === 'wifi' ? 'CHIP_WIFI' : 'CHIP_BT';
}

// Volumio expects a kew promise from the methods it calls, and disables a plugin whose onStart
// returns a native one. This turns an async method into one that returns a kew promise.
function viaKew(method) {
  return function (...args) {
    const defer = libQ.defer();
    method.apply(this, args).then(
      (value) => defer.resolve(value),
      (err) => defer.reject(err),
    );
    return defer.promise;
  };
}

module.exports = ControllerRpiWirelessOff;

function ControllerRpiWirelessOff(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.configManager = context.configManager;

  // Where the plugin reads and writes. The tests point these at temp files. interfaces is what
  // os.networkInterfaces() would list, and undefined means to ask the system.
  this.paths = {
    userconfig: '/boot/userconfig.txt',
    generatorTarget: '/lib/systemd/system-generators/rpi-wireless-off-generator',
    dtRoot: undefined,
    sysNet: '/sys/class/net',
    interfaces: undefined,
  };
  this.run = run;
  // The Save that ran last, settled or not. The next Save waits for it.
  this.lastSave = Promise.resolve();
}

ControllerRpiWirelessOff.prototype.onVolumioStart = function () {
  const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config = new VConf();
  this.config.loadFile(configFile);
  return libQ.resolve();
};

ControllerRpiWirelessOff.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

// Volumio calls this to find the strings file for a language.
ControllerRpiWirelessOff.prototype.getI18nFile = function (langCode) {
  const langFile = `strings_${langCode}.json`;
  const found = fs.readdirSync(I18N_DIR).includes(langFile);
  return path.join(I18N_DIR, found ? langFile : 'strings_en.json');
};

// Makes the installed generator match the bundled one, in content and in mode. A Volumio update can
// reset /lib, and install.sh doesn't run again after that. The folder belongs to root, so the writes
// go through sudo, with the three programs the stock sudoers file allows.
ControllerRpiWirelessOff.prototype.ensureGenerator = async function () {
  const target = this.paths.generatorTarget;
  const bundled = await fsp.readFile(radios.GENERATOR);
  // Only a missing file counts as missing. Any other error has to surface.
  const installed = await fsp.readFile(target).catch((err) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  // The right bytes at the wrong mode count as different. systemd skips a generator that isn't
  // executable, and a chmod that failed after tee made the file leaves exactly that behind. Without
  // this check, every later start would answer ok and volumiobt would keep looping.
  if (installed && installed.equals(bundled) && ((await fsp.stat(target)).mode & 0o777) === 0o755) return 'ok';

  await this.run(SUDO, ['/usr/bin/tee', target], { input: bundled });
  await this.run(SUDO, ['/bin/chmod', '755', target]);
  await this.run(SUDO, ['/bin/systemctl', 'daemon-reload']);
  return 'installed';
};

// Each step fails on its own, so one that can't run doesn't hide the other.
ControllerRpiWirelessOff.prototype.onStart = viaKew(async function () {
  this.commandRouter.loadI18nStrings();

  try {
    await this.ensureGenerator();
  } catch (err) {
    this.logError('boot helper', err);
    this.toast('error', 'GENERATOR_FAILED', { error: reason(err) });
  }

  // A chip that is off now and that nothing in the files keeps off comes back on at the next boot.
  // That is the state after an uninstall and a fresh install, because uninstall deletes the block.
  // This one has no toast of its own when it fails, only a line in the log.
  try {
    const parsed = userconfig.parse(await userconfig.readText(this.paths.userconfig));
    const chips = await radios.readChips({ dtRoot: this.paths.dtRoot });
    const back = decide.comingBackOn({ parsed, chips });
    if (back.length) this.toast('warning', 'COMING_BACK_ON', { chips: this.text(chipsKey(back)) });
  } catch (err) {
    this.logError('check for chips that turn back on', err);
  }
});

// The block and the generator stay as they are, so a chip never comes back on by itself.
ControllerRpiWirelessOff.prototype.onStop = function () {
  return libQ.resolve();
};

ControllerRpiWirelessOff.prototype.getUIConfig = viaKew(async function () {
  try {
    const lang = this.commandRouter.sharedVars.get('language_code');
    const uiconf = await this.commandRouter.i18nJson(
      this.getI18nFile(lang),
      path.join(I18N_DIR, 'strings_en.json'),
      path.join(__dirname, 'UIConfig.json'),
    );
    const chips = byId(uiconf.sections, 'section_chips');
    const parsed = userconfig.parse(await userconfig.readText(this.paths.userconfig));

    if (await radios.isSupportedBoard({ dtRoot: this.paths.dtRoot })) {
      const off = decide.effective(parsed);
      const wifi = byId(chips.content, 'wifi_chip');
      const bt = byId(chips.content, 'bt_chip');
      wifi.value = !off.wifiOff;
      bt.value = !off.btOff;
      if (parsed.handSet.wifiOff) wifi.doc = this.text('HAND_SET_DOC');
      if (parsed.handSet.btOff) bt.doc = this.text('HAND_SET_DOC');
    } else {
      chips.description = this.text('NOT_SUPPORTED');
      chips.content = [];
      delete chips.onSave;
      delete chips.saveButton;
    }

    byId(uiconf.sections, 'section_status').description = await this.statusText(parsed);
    return uiconf;
  } catch (err) {
    this.logError('settings page', err);
    throw err;
  }
});

// What each chip does now and at the next boot, then the health line, joined with spaces. A read
// that fails is logged and its sentences are left out, because the page is worth showing without
// them.
ControllerRpiWirelessOff.prototype.statusText = async function (parsed) {
  const sentences = [];

  try {
    const chips = await radios.readChips({ dtRoot: this.paths.dtRoot });
    const status = decide.chipStatus({ parsed, chips });
    for (const chip of ['wifi', 'bt']) {
      // A status like 'turns-off' becomes the key part TURNS_OFF.
      const state = status[chip].toUpperCase().replace('-', '_');
      sentences.push(this.text(`STATUS_${chip.toUpperCase()}_${state}`));
    }
  } catch (err) {
    this.logError('chip status', err);
  }

  try {
    const { restarts, failed } = await health.readHealth({ run: this.run });
    const units = failed.length ? failed.join(', ') : this.text('NONE');
    sentences.push(this.text('HEALTH', { ...restarts, failed: units }));
  } catch (err) {
    this.logError('health', err);
  }

  return sentences.join(' ');
};

// Saves run one at a time. They all write through one temp file, so two at once could garble
// userconfig.txt, which holds the user's other boot settings too. A Save waits for the one before
// it, and a Save that failed doesn't stop the next.
ControllerRpiWirelessOff.prototype.saveSettings = viaKew(function (data) {
  const turn = this.lastSave.then(() => this.save(data));
  this.lastSave = turn.catch(() => {});
  return turn;
});

// One Save. It reads the file when its turn comes, so it sees what an earlier Save wrote. A failure
// to read or write the file is shown as a toast, because a rejection would show the user nothing.
ControllerRpiWirelessOff.prototype.save = async function (data) {
  const requested = { wifiOff: isOff(data.wifi_chip), btOff: isOff(data.bt_chip) };

  try {
    if (!(await radios.isSupportedBoard({ dtRoot: this.paths.dtRoot }))) {
      this.toast('error', 'NOT_SUPPORTED');
      return;
    }

    // readText and writeAtomic are a pair, both latin1, so text outside the block survives byte
    // for byte. Nothing else reads or writes the file.
    const text = await userconfig.readText(this.paths.userconfig);
    const wiredLink = await radios.hasWiredLink({ sysNet: this.paths.sysNet, interfaces: this.paths.interfaces });
    const decision = decide.decideSave({ requested, parsed: userconfig.parse(text), wiredLink });

    if (!decision.ok) {
      this.toast('error', decision.reason === 'no-wired-link' ? 'NO_WIRED_LINK' : 'DAMAGED_BLOCK');
      return;
    }
    if (decision.ignored.length) this.toast('warning', 'HAND_SET_IGNORED');
    if (!decision.changed) {
      this.toast('info', 'NOTHING_CHANGED');
      return;
    }

    await userconfig.writeAtomic(this.paths.userconfig, userconfig.render(text, decision.want));
  } catch (err) {
    this.logError('save', err);
    this.toast('error', 'WRITE_FAILED', { error: reason(err) });
    return;
  } finally {
    // Every way out of a Save pushes a fresh page: a refusal, nothing to change, a failed write and a
    // saved one. After a write it goes out before the reboot modal below, so the modal opens over the
    // new status.
    await this.refreshPage();
  }

  this.toast('success', 'SAVED');
  const common = (key) => this.commandRouter.getI18nString(`COMMON.${key}`);
  this.commandRouter.broadcastMessage('openModal', {
    title: this.text('REBOOT_TITLE'),
    message: this.text('REBOOT_MSG'),
    size: 'lg',
    buttons: [
      { name: common('RESTART'), class: 'btn btn-info', emit: 'reboot', payload: '' },
      { name: common('CONTINUE'), class: 'btn btn-default', emit: 'closeModals', payload: '' },
    ],
  });
};

// Volumio doesn't fetch a plugin's page again after callMethod, so the page that is open would keep
// showing what it showed before the Save. This pushes a fresh one to every open page, the way
// Volumio's alsa_controller and the Flight Mode plugin do. A Save has done its job by now, so a
// failure to build or push the page is logged and not thrown.
ControllerRpiWirelessOff.prototype.refreshPage = async function () {
  try {
    this.commandRouter.broadcastMessage('pushUiConfig', await this.getUIConfig());
  } catch (err) {
    this.logError('refresh the settings page', err);
  }
};

// One of the plugin's strings, with each {{name}} filled in from values. The function form of
// replace keeps a $ in a value from being read as part of a pattern.
ControllerRpiWirelessOff.prototype.text = function (key, values = {}) {
  const template = this.commandRouter.getI18nString(`${NAMESPACE}.${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (token, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
};

// A toast titled with the plugin's name.
ControllerRpiWirelessOff.prototype.toast = function (type, key, values) {
  this.commandRouter.pushToastMessage(type, this.text('PLUGIN_NAME'), this.text(key, values));
};

ControllerRpiWirelessOff.prototype.logError = function (what, err) {
  this.logger.error(`${LOG_PREFIX}${what}: ${reason(err)}`);
};
