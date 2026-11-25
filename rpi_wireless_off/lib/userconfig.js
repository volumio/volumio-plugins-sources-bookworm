'use strict';

// The plugin owns one marked block of overlay lines in /boot/userconfig.txt.
// Everything outside the block is the user's and has to come back byte for byte.

const fsp = require('node:fs/promises');

const BLOCK_START = "# >>> rpi_wireless_off plugin. Managed from the plugin's settings page.";
const BLOCK_END = '# <<< rpi_wireless_off plugin';

// A line that turns a chip off, as the boot loader reads it. Match it after trim(). The firmware
// still maps the old names pi3-disable-wifi and pi3-disable-bt to the same overlays, so they count
// too. render only ever writes the current names.
const OVERLAY = /^dtoverlay\s*=\s*(?:pi3-)?disable-(wifi|bt)$/;

// latin1 maps each byte to one character and back, so a rewrite can't damage text in
// another encoding. The markers and overlay lines are plain ASCII.
const ENCODING = 'latin1';

// Lines with their own terminator, so joining them gives the text back exactly.
function splitLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

// The block is damaged when the markers don't pair up: a start with no end, an end with
// no start, two blocks, or an end above its start. span is [startIndex, endIndex], or null
// when there is no usable block.
function findBlock(lines) {
  const starts = [];
  const ends = [];
  lines.forEach((line, i) => {
    const marker = line.trim();
    if (marker === BLOCK_START) starts.push(i);
    else if (marker === BLOCK_END) ends.push(i);
  });
  if (!starts.length && !ends.length) return { span: null, broken: false };
  const paired = starts.length === 1 && ends.length === 1 && starts[0] < ends[0];
  return { span: paired ? [starts[0], ends[0]] : null, broken: !paired };
}

// In a damaged file there is no block to trust, so every overlay line counts as hand-set.
// That matches what the boot loader does, because it reads every line.
function parse(text) {
  const lines = splitLines(text);
  const { span, broken } = findBlock(lines);
  const block = span ? { wifiOff: false, btOff: false } : null;
  const handSet = { wifiOff: false, btOff: false };
  lines.forEach((line, i) => {
    const overlay = OVERLAY.exec(line.trim());
    if (!overlay) return;
    const inBlock = span !== null && i > span[0] && i < span[1];
    // overlay[1] is 'wifi' or 'bt'.
    (inBlock ? block : handSet)[overlay[1] + 'Off'] = true;
  });
  return { block, handSet, broken };
}

function render(text, want) {
  const lines = splitLines(text);
  const { span, broken } = findBlock(lines);
  if (broken) throw new Error('damaged block');

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const overlays = [];
  if (want.wifiOff) overlays.push('dtoverlay=disable-wifi');
  if (want.btOff) overlays.push('dtoverlay=disable-bt');
  // [all] comes first so the overlays apply even when the file ends inside [pi4] or [hdmi:1].
  const fresh = overlays.length
    ? [BLOCK_START, '[all]', ...overlays, BLOCK_END].map((line) => line + eol)
    : [];

  if (span) {
    lines.splice(span[0], span[1] - span[0] + 1, ...fresh);
    return lines.join('');
  }
  if (!fresh.length) return text;
  const gap = text === '' || text.endsWith('\n') ? '' : eol;
  return text + gap + fresh.join('');
}

// Only a missing file reads as empty. Any other error has to surface, or Save would
// write a file holding just the block over a file it couldn't read.
async function readText(file) {
  try {
    return await fsp.readFile(file, ENCODING);
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

// Write a temp file next to the target, then rename it over the target. A power cut leaves
// the old file or the new one. The sync makes sure the data is on disk before the rename.
async function writeAtomic(file, text) {
  const tmp = file + '.rwo-tmp';
  try {
    const handle = await fsp.open(tmp, 'w');
    try {
      await handle.writeFile(text, ENCODING);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function removeBlock(file) {
  const text = await readText(file);
  const { block, broken } = parse(text);
  if (broken) return 'broken';
  if (!block) return 'none';
  await writeAtomic(file, render(text, { wifiOff: false, btOff: false }));
  return 'removed';
}

// node userconfig.js --remove-block <path>, which uninstall.sh runs as root. It prints what
// it found and always exits 0, because a non-zero exit would fail the uninstall step.
async function cli(args) {
  if (args[0] !== '--remove-block' || !args[1]) return 'usage: node userconfig.js --remove-block <path>';
  try {
    return await removeBlock(args[1]);
  } catch (err) {
    return 'error: ' + err.message;
  }
}

if (require.main === module) {
  cli(process.argv.slice(2)).then((line) => console.log(line));
}

module.exports = { BLOCK_START, BLOCK_END, parse, render, readText, writeAtomic, removeBlock };
