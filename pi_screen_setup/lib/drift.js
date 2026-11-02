'use strict';
// What changed under the plugin, and why. The boot files the plugin wrote are compared
// with the copies it saved at the last apply; this module says whether a difference
// is an OS update (Volumio's version moved) or something else, and lists the lines in
// userconfig.txt that work against the plugin's configuration.

const fs = require('fs');

// VOLUMIO_VERSION from /etc/os-release, or null off a Volumio system.
function osVersion(root) {
    try {
        const text = fs.readFileSync((root || '') + '/etc/os-release', 'utf8');
        const m = text.match(/^VOLUMIO_VERSION="?([^"\n]+)"?$/m);
        return m ? m[1].trim() : null;
    } catch (e) { return null; }
}

// One word for the drift: 'os-update' when Volumio's version differs from the one
// recorded at the apply, 'missing' when the plugin's own file is gone, else 'changed'.
function classify(errors, savedVersion, currentVersion) {
    const list = errors || [];
    if (savedVersion && currentVersion && savedVersion !== currentVersion) return 'os-update';
    if (list.indexOf('ERR_VIDEOCONFIG_MISSING') !== -1) return 'missing';
    return 'changed';
}

// Lines in userconfig.txt (which the plugin leaves alone) that act on the display.
// The Touch Display plugin writes the legacy rotation keys; under KMS they do nothing,
// and a reader comparing the two files would be misled. The others are plain conflicts.
const CONFLICTS = [
    { re: /^display_(lcd_|hdmi_)?rotate=/, code: 'LEGACY_ROTATE' },
    { re: /^dtoverlay=vc4-f?kms-v3d/, code: 'KMS_LINE' },
    { re: /^dtoverlay=.*(dsi|dpi|hyperpixel|vga666)/i, code: 'PANEL_OVERLAY' },
    { re: /^(hdmi_|config_hdmi_boost|max_framebuffer_|sdtv_|framebuffer_|enable_tvout|display_auto_detect|display_default_lcd)/, code: 'DISPLAY_SETTING' },
];

function conflicts(text) {
    if (typeof text !== 'string') return [];
    const out = [];
    text.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim();
        if (line === '' || line.charAt(0) === '#' || line.charAt(0) === '[') return;
        const hit = CONFLICTS.find((c) => c.re.test(line));
        if (hit) out.push({ line, code: hit.code });
    });
    return out;
}

module.exports = { osVersion, classify, conflicts, CONFLICTS };
