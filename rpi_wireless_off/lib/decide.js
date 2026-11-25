'use strict';

// These functions decide what Save does and what the status line says. Each one works from the
// parse() result of userconfig.js and the readChips() result of radios.js, so none of them reads a
// file or the device tree.

const CHIPS = ['wifi', 'bt'];

// A chip is off when the block turns it off or a hand-set line does. A damaged file has no block, and
// parse() counts every overlay line in it as hand-set, so this still matches what the boot loader does.
function effective({ block, handSet }) {
  return {
    wifiOff: Boolean(block && block.wifiOff) || handSet.wifiOff,
    btOff: Boolean(block && block.btOff) || handSet.btOff,
  };
}

// Save only writes the block. A hand-set line lives outside it, so the block never repeats that chip,
// and Save can't switch the chip on. A request to do so puts the chip into ignored instead.
function decideSave({ requested, parsed, wiredLink }) {
  // A damaged block can't be rewritten safely, so this check comes before every other one.
  if (parsed.broken) return { ok: false, reason: 'damaged-block' };

  const { block, handSet } = parsed;
  const current = block || { wifiOff: false, btOff: false };
  const want = {
    wifiOff: requested.wifiOff && !handSet.wifiOff,
    btOff: requested.btOff && !handSet.btOff,
  };

  // Only Wi-Fi going from on to off can lock the user out. Without Wi-Fi, Volumio can't start its
  // rescue hotspot, so a dead cable would leave the SD card as the only way back in.
  if (want.wifiOff && !current.wifiOff && !wiredLink) return { ok: false, reason: 'no-wired-link' };

  // The page shows a hand-set chip as off. Leaving that switch alone asks for nothing, so only a request
  // to switch the chip on differs from what is in effect.
  const inEffect = effective(parsed);
  const ignored = [];
  if (handSet.wifiOff && requested.wifiOff !== inEffect.wifiOff) ignored.push('wifi');
  if (handSet.btOff && requested.btOff !== inEffect.btOff) ignored.push('bt');

  const changed = want.wifiOff !== current.wifiOff || want.btOff !== current.btOff;
  return { ok: true, want, changed, ignored };
}

// Compares one chip's setting in the files with its running state. A chip changes state only when the
// Pi starts, so a difference between the two means the change waits for the next boot.
function statusOf(configuredOff, running) {
  if (running === 'absent') return 'absent';
  const isOff = running === 'off';
  if (configuredOff) return isOff ? 'off' : 'turns-off';
  return isOff ? 'turns-on' : 'on';
}

function chipStatus({ parsed, chips }) {
  const configured = effective(parsed);
  return { wifi: statusOf(configured.wifiOff, chips.wifi), bt: statusOf(configured.btOff, chips.bt) };
}

// Lists the chips that are off now and that nothing in the files keeps off. After an uninstall and a
// fresh install the list isn't empty, because uninstall deleted the block.
function comingBackOn(state) {
  const status = chipStatus(state);
  return CHIPS.filter((chip) => status[chip] === 'turns-on');
}

module.exports = { effective, decideSave, chipStatus, comingBackOn };
