'use strict';

// Facts about the machine: which radio chips are on, whether the board is one the plugin
// supports, and whether a network cable is plugged in.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const run = require('./run');

// The boot-time generator ships inside the plugin folder.
const GENERATOR = path.join(__dirname, '..', 'systemd', 'rpi-wireless-off-generator');

// The generator reads the device tree, so this gives the same answer the boot-time run sees.
// dtRoot sets RWO_DT_ROOT to point it at another tree, which the tests use. Without dtRoot,
// the program gets the normal environment.
async function readChips({ dtRoot } = {}) {
  const env = dtRoot ? { ...process.env, RWO_DT_ROOT: dtRoot } : undefined;
  const report = await run('/bin/sh', [GENERATOR, '--report'], { env });
  const wifi = /^wifi=(on|off|absent)$/m.exec(report);
  const bt = /^bt=(on|off|absent)$/m.exec(report);
  if (!wifi || !bt) throw new Error(`unreadable generator report: ${JSON.stringify(report)}`);
  return { wifi: wifi[1], bt: bt[1] };
}

// The Pi 4, Pi 400 and CM4 list brcm,bcm2711 in compatible, a run of NUL-terminated strings.
// No compatible file means a board the plugin doesn't know.
async function isSupportedBoard({ dtRoot = '/proc/device-tree' } = {}) {
  try {
    const compatible = await fsp.readFile(path.join(dtRoot, 'compatible'), 'utf8');
    return compatible.split('\0').includes('brcm,bcm2711');
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

// True when the entry exists. lstat counts a symlink without following it, and sysfs makes
// device and phy80211 symlinks. Any error means the entry isn't there.
const exists = (file) => fsp.lstat(file).then(() => true, () => false);

// The text of a sysfs file, or '' when it can't be read. Reading carrier fails with EINVAL
// while an interface is down, and that has to count as no carrier.
const readSysfs = (file) => fsp.readFile(file, 'utf8').then((text) => text.trim(), () => '');

// os.networkInterfaces() gives the family as 'IPv4'. Node 18.0 to 18.3 gave the number 4. An address in
// 169.254.0.0/16 doesn't count. An interface gives itself one when DHCP fails, so it says nothing
// about a link that works.
const isIPv4 = (address) =>
  !address.internal &&
  (address.family === 'IPv4' || address.family === 4) &&
  !address.address.startsWith('169.254.');

// An interface is a cable when it is real hardware (it has a device entry), is Ethernet
// (type 1), is not wireless, and has carrier.
async function isCable(dir) {
  const at = (entry) => path.join(dir, entry);
  return (
    (await exists(at('device'))) &&
    !(await exists(at('wireless'))) &&
    !(await exists(at('phy80211'))) &&
    (await readSysfs(at('type'))) === '1' &&
    (await readSysfs(at('carrier'))) === '1'
  );
}

// True when some interface is a cable and has an IPv4 address. A Wi-Fi dongle, docker0 and a
// bridge can show carrier and an address too, which is why isCable rules them out. lo is
// skipped by name, though it would fail the device check anyway.
async function hasWiredLink({ sysNet = '/sys/class/net', interfaces = os.networkInterfaces() } = {}) {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (name !== 'lo' && addresses.some(isIPv4) && (await isCable(path.join(sysNet, name)))) return true;
  }
  return false;
}

module.exports = { GENERATOR, readChips, isSupportedBoard, hasWiredLink };
