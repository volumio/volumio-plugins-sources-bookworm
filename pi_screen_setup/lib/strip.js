'use strict';
// Taking the display lines out of Volumio's boot files, and keeping what was taken.
//
// The plugin owns the display configuration while it is installed: lines the OS or
// the user put in volumioconfig.txt / userconfig.txt that would fight with videoconfig.txt
// are removed. What was removed is recorded (the whole original file and the digest of
// what was left), so that a clean exit — uninstall, or "remove the plugin's display
// configuration" — can put the file back exactly, and only when nobody has touched it
// since. The record lives under /data/INTERNAL/pi_screen_setup/strip, which survives
// the plugin folder.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The lines that belong to the display configuration. The same set drives the migration
// offer in the wizard, the strip of volumioconfig.txt after an OS update, and the
// detection grep in install.sh.
const PATTERNS = [
    /^dtoverlay=vc4-kms-v3d/,
    /^dtoverlay=vc4-fkms-v3d/,
    /^dtoverlay=.*dsi/i,
    /^dtoverlay=.*dpi/i,
    /^dtoverlay=.*hyperpixel/i,
    /^dtoverlay=.*vga666/i,
    /^hdmi_/,                      // every hdmi_ setting
    /^config_hdmi_boost/,
    /^max_framebuffer_/,
    /^display_auto_detect/,
    /^display_default_lcd/,
    // display_rotate, display_lcd_rotate, display_hdmi_rotate belong to the Touch Display plugin
    /^sdtv_/,
    /^framebuffer_/,
    /^enable_tvout/,
];

const FILTER = /^\[.*\]$/;

function matches(line) {
    const t = line.trim();
    return PATTERNS.some((re) => re.test(t));
}

// Removes the matching lines. Comments and filters stay; a filter header is kept even
// when everything under it went, so the file's structure (and the firmware's filter
// state at the end of it) is unchanged. Returns the new text, the removed lines with
// the filter they were under, and whether anything changed.
function apply(text) {
    const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const kept = [];
    const removed = [];
    let section = '[all]';
    lines.forEach((line, index) => {
        const t = line.trim();
        if (FILTER.test(t)) { section = t; kept.push(line); return; }
        if (t !== '' && t.charAt(0) !== '#' && matches(line)) { removed.push({ line: t, section, index }); return; }
        kept.push(line);
    });
    return { text: kept.join(eol), removed, changed: removed.length > 0 };
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// The record for one boot file: the original beside the digest of the stripped text.
function record(dir, name, original, stripped) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name + '.original'), original, 'utf8');
    fs.writeFileSync(path.join(dir, name + '.sha256'), sha256(stripped) + '\n', 'utf8');
}

function readRecord(dir, name) {
    try {
        return {
            original: fs.readFileSync(path.join(dir, name + '.original'), 'utf8'),
            sha256: fs.readFileSync(path.join(dir, name + '.sha256'), 'utf8').trim(),
        };
    } catch (e) { return null; }
}

// What a clean exit would do with the file now: put the original back (the file is
// as the plugin left it), leave it (it changed since, or there is no record), or
// nothing (no file).
function exitPlan(dir, name, currentText) {
    const rec = readRecord(dir, name);
    if (currentText === null || currentText === undefined) return { action: 'none', reason: 'no file' };
    if (!rec) return { action: 'leave', reason: 'no record' };
    if (sha256(currentText) !== rec.sha256) return { action: 'leave', reason: 'changed since the plugin stripped it' };
    return { action: 'restore', original: rec.original };
}

module.exports = { PATTERNS, matches, apply, sha256, record, readRecord, exitPlan };
