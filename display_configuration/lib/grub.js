'use strict';
// Renders the file GRUB sources at boot: /data/plugins/user_interface/
// display_configuration/rotation.cfg, read by the image's grub.cfg as GRUB script and
// expanded on the kernel line as `$screen $efifb $fbcon`. The contract and its
// consumers are the image's (build-platform-x64 grub.cfg, volumio-os initramfs); the
// plugin may only write values the image understands. Everything here is validated
// before it is rendered, because a malformed line breaks the only menuentry.

const PLYMOUTH = new Set([0, 90, 180, 270]);
const CONNECTOR = /^[A-Za-z]+(?:-[A-Z])?-\d+$/; // eDP-1, HDMI-A-1, DP-2, DSI-1, Virtual-1, LVDS-1
const MODE = /^\d{3,5}x\d{3,5}(?:@\d{2,3})?$/;

function assertInt(name, v, lo, hi) {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(name + ' must be an integer in [' + lo + ', ' + hi + '], got ' + v);
}

// video=<connector>:<mode>[,rotate=N][,reflect_x][,reflect_y] in the kernel's own
// grammar (drm_modes.c). With no connector the bare "video=efifb" the image has
// always carried is kept, so a device without a chosen mode boots as before.
function videoOption({ connector, mode, rotate, reflectX, reflectY } = {}) {
    if (!connector) {
        if (mode || rotate || reflectX || reflectY) throw new RangeError('a connector is required for a video= mode or rotation');
        return 'video=efifb';
    }
    if (!CONNECTOR.test(connector)) throw new RangeError('connector name "' + connector + '" is not a DRM connector name');
    const parts = [];
    if (mode !== undefined && mode !== null) {
        if (!MODE.test(mode)) throw new RangeError('mode must look like 1280x720 or 1280x720@60, got ' + mode);
        parts.push(mode);
    }
    const opts = [];
    if (rotate !== undefined && rotate !== null && rotate !== 0) {
        if (![90, 180, 270].includes(rotate)) throw new RangeError('rotate must be 0, 90, 180 or 270 (DRM counter-clockwise), got ' + rotate);
        opts.push('rotate=' + rotate);
    }
    if (reflectX) opts.push('reflect_x');
    if (reflectY) opts.push('reflect_y');
    if (parts.length === 0 && opts.length === 0) return 'video=efifb';
    if (parts.length === 0) parts.push('e'); // a connector with options but no mode: keep it enabled
    return 'video=' + connector + ':' + parts.join('') + (opts.length ? ',' + opts.join(',') : '');
}

// The three variables the image reads, plus gfxpayload for GRUB's own framebuffer
// hand-over (F1, virtual guests). Values are GRUB-script `set` lines.
function render({ plymouth = 0, fbcon = 0, video, gfxpayload } = {}) {
    if (!PLYMOUTH.has(plymouth)) throw new RangeError('plymouth must be 0, 90, 180 or 270, got ' + plymouth);
    assertInt('fbcon', fbcon, 0, 3);
    const lines = [
        'set screen=plymouth=' + plymouth,
        'set efifb=' + videoOption(video || {}),
        'set fbcon=fbcon=rotate:' + fbcon,
    ];
    if (gfxpayload !== undefined && gfxpayload !== null) {
        if (gfxpayload !== 'keep' && gfxpayload !== 'text' && !MODE.test(gfxpayload)) throw new RangeError('gfxpayload must be keep, text or WxH[@r], got ' + gfxpayload);
        lines.push('set gfxpayload=' + gfxpayload);
    }
    for (const l of lines) if (/[^A-Za-z0-9=:,.@_ -]/.test(l)) throw new RangeError('refusing to render a GRUB line with unexpected characters: ' + l);
    return lines.join('\n') + '\n';
}

// Reads a rotation.cfg back, for diagnostics and for migrating a 0.0.43 file.
function parse(text) {
    const out = { plymouth: null, fbcon: null, video: null, gfxpayload: null, unknown: [] };
    for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        let m;
        if ((m = /^set screen=plymouth=(\d+)$/.exec(line))) out.plymouth = +m[1];
        else if ((m = /^set fbcon=fbcon=rotate:(\d)$/.exec(line))) out.fbcon = +m[1];
        else if ((m = /^set efifb=(video=.*)$/.exec(line))) out.video = m[1];
        else if ((m = /^set gfxpayload=(.+)$/.exec(line))) out.gfxpayload = m[1];
        else out.unknown.push(line);
    }
    return out;
}

const PATH = '/data/plugins/user_interface/display_configuration/rotation.cfg';

module.exports = { render, parse, videoOption, PATH };
