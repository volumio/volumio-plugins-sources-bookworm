'use strict';
// The second bootloader. The x86 image boots through GRUB on UEFI firmware and
// through syslinux on legacy BIOS; only grub.cfg sources rotation.cfg. On a BIOS boot
// the same three tokens have to stand on the APPEND line of /boot/syslinux.cfg, which
// syslinux hands to the kernel verbatim (with BOOT_IMAGE= in front and initrd= behind).
// The image regenerates that file on every OS update, so the plugin re-asserts the
// line at every start. This module is pure: it decides what the line must be and
// whether the running kernel got it; the root helper does the writing and holds its
// own, independent check that nothing but these tokens changed.

const G = require('./grub');

const PATH = '/boot/syslinux.cfg';
const EFI_DIR = '/sys/firmware/efi';

const APPEND = /^([ \t]*APPEND)([ \t]+|$)/;
const LABEL = /^[ \t]*LABEL[ \t]+volumio[ \t]*$/;
const CONNECTOR_VIDEO = /^video=(?:efifb|[A-Za-z]+(?:-[A-Z])?-\d+:[0-9A-Za-z@,=_]+)$/;

// A token is ours when it is one the plugin renders; a hand-written video= of
// another shape is left alone.
function isOurs(token) {
    return /^plymouth=\d+$/.test(token) || /^fbcon=rotate:[0-3]$/.test(token) || CONNECTOR_VIDEO.test(token);
}

// The GRUB order, `$screen $efifb $fbcon`, kept so both boot paths read the same.
// The all-default turn needs no tokens: absence is normal, and a stock file is left
// as the image wrote it.
function tokens({ plymouth = 0, fbcon = 0, video } = {}) {
    const v = G.videoOption(video || {});
    if (plymouth === 0 && fbcon === 0 && v === 'video=efifb') return [];
    if (![0, 90, 180, 270].includes(plymouth)) throw new RangeError('plymouth must be 0, 90, 180 or 270, got ' + plymouth);
    if (![0, 1, 2, 3].includes(fbcon)) throw new RangeError('fbcon must be 0, 1, 2 or 3, got ' + fbcon);
    return ['plymouth=' + plymouth, v, 'fbcon=rotate:' + fbcon];
}

// The file as it must read with `wanted` on the APPEND line: every other byte kept,
// our earlier tokens gone, the wanted ones appended in order. Throws when the file is
// not the one syslinux.cfg the image writes (one LABEL volumio, one APPEND).
function render(text, wanted) {
    if (typeof text !== 'string') throw new Error('syslinux.cfg is not readable');
    for (const t of wanted) if (!isOurs(t)) throw new RangeError('refusing a token the plugin does not own: ' + t);
    const nl = text.endsWith('\n');
    const lines = text.split('\n');
    if (nl) lines.pop();
    if (lines.filter((l) => LABEL.test(l)).length !== 1) throw new Error('syslinux.cfg: expected exactly one "LABEL volumio"');
    const appends = lines.map((l, i) => (APPEND.test(l) ? i : -1)).filter((i) => i >= 0);
    if (appends.length !== 1) throw new Error('syslinux.cfg: expected exactly one APPEND line, found ' + appends.length);
    const i = appends[0];
    const m = APPEND.exec(lines[i]);
    const kept = lines[i].slice(m[1].length).split(/[ \t]+/).filter((t) => t !== '' && !isOurs(t));
    const line = m[1] + (kept.length || wanted.length ? ' ' : '') + kept.concat(wanted).join(' ');
    if (line.length > 1024) throw new Error('syslinux.cfg: the APPEND line would exceed 1024 characters');
    lines[i] = line;
    return lines.join('\n') + (nl ? '\n' : '');
}

// What the APPEND line carries of ours today.
function parse(text) {
    const out = { plymouth: null, fbcon: null, video: null, ours: [] };
    if (typeof text !== 'string') return out;
    for (const l of text.split('\n')) {
        const m = APPEND.exec(l);
        if (!m) continue;
        for (const t of l.slice(m[1].length).split(/[ \t]+/)) if (isOurs(t)) out.ours.push(t);
        break;
    }
    return Object.assign(out, effective(out.ours.join(' ')));
}

// The turn the running kernel was given, read from a command line; absent means 0,
// and the bare video=efifb the GRUB path always carries means "no mode".
function effective(cmdline) {
    const out = { plymouth: 0, fbcon: 0, video: null };
    for (const t of String(cmdline || '').trim().split(/\s+/)) {
        let m;
        if ((m = /^plymouth=(\d+)$/.exec(t))) out.plymouth = +m[1];
        else if ((m = /^fbcon=rotate:([0-3])$/.exec(t))) out.fbcon = +m[1];
        else if (CONNECTOR_VIDEO.test(t)) out.video = t === 'video=efifb' ? null : t;
    }
    return out;
}

// grub: UEFI firmware, the image's grub.cfg sources rotation.cfg. syslinux: legacy
// BIOS with the image's syslinux.cfg present. none: neither (not an x86 image).
function detect({ efi, syslinuxCfg }) {
    if (efi) return 'grub';
    if (syslinuxCfg) return 'syslinux';
    return 'none';
}

// Whether the boot that is running carries the configured turn.
function inEffect(cmdline, { plymouth = 0, fbcon = 0, video } = {}) {
    const have = effective(cmdline);
    const v = G.videoOption(video || {});
    return have.plymouth === plymouth && have.fbcon === fbcon && have.video === (v === 'video=efifb' ? null : v);
}

module.exports = { PATH, EFI_DIR, tokens, render, parse, effective, detect, inEffect, isOurs };
