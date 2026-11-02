'use strict';
// HDMI under the KMS driver. The firmware lines a preset carries (hdmi_group/hdmi_mode,
// hdmi_cvt, hdmi_timings) are read by the firmware for the boot splash and ignored by
// the kernel, which drives the connector itself (Raspberry Pi documentation, "Legacy
// config.txt options", Raspberry Pi 4 HDMI pipeline). This module turns those lines
// into what the kernel reads:
//
//   - the mode on the kernel line, video=HDMI-A-n:<x>x<y>M[R][@<rate>][e]
//     (Documentation/fb/modedb.rst: M = timings computed by CVT, R = reduced blanking,
//     e = treat the output as connected). When the connector has a mode of that size
//     the kernel prefers it; otherwise it creates one.
//   - for a panel whose timings are not CVT's (hdmi_timings), an EDID carrying that
//     one detailed timing, loaded through drm.edid_firmware=HDMI-A-n:edid/<name>.bin
//     from /lib/firmware. The video= line then names only the size, so the kernel
//     takes the EDID's timing whatever refresh the vendor's numbers work out to.
//
// hdmi_timings field order and the aspect codes: the documentation above.
// EDID structure: VESA E-EDID 1.3 base block; CTA-861 extension when the port carries
// audio, since the kernel treats a sink without the HDMI vendor block as DVI and sends
// it no audio.

const crypto = require('crypto');

// hdmi_group/hdmi_mode → [width, height, rate, reduced blanking], from the documented
// CEA (group 1) and DMT (group 2) tables; the entries the database and the generic
// rows use, plus the common monitor sizes.
const MODES = {
    '1/1': [640, 480, 60], '1/2': [720, 480, 60], '1/3': [720, 480, 60], '1/4': [1280, 720, 60], '1/16': [1920, 1080, 60],
    '1/17': [720, 576, 50], '1/18': [720, 576, 50], '1/19': [1280, 720, 50], '1/31': [1920, 1080, 50], '1/32': [1920, 1080, 24],
    '1/34': [1920, 1080, 30], '1/93': [3840, 2160, 24], '1/94': [3840, 2160, 25], '1/95': [3840, 2160, 30], '1/96': [3840, 2160, 50], '1/97': [3840, 2160, 60],
    '2/4': [640, 480, 60], '2/9': [800, 600, 60], '2/14': [848, 480, 60], '2/16': [1024, 768, 60], '2/22': [1280, 768, 60, true], '2/23': [1280, 768, 60],
    '2/27': [1280, 800, 60, true], '2/28': [1280, 800, 60], '2/32': [1280, 960, 60], '2/35': [1280, 1024, 60], '2/39': [1360, 768, 60],
    '2/41': [1400, 1050, 60, true], '2/42': [1400, 1050, 60], '2/46': [1440, 900, 60, true], '2/47': [1440, 900, 60], '2/51': [1600, 1200, 60],
    '2/57': [1680, 1050, 60, true], '2/58': [1680, 1050, 60], '2/68': [1920, 1200, 60, true], '2/69': [1920, 1200, 60], '2/76': [2560, 1600, 60, true], '2/77': [2560, 1600, 60],
    '2/81': [1366, 768, 60], '2/82': [1920, 1080, 60], '2/83': [1600, 900, 60, true], '2/84': [2048, 1152, 60, true], '2/85': [1280, 720, 60], '2/86': [1366, 768, 60, true],
};

const FIELDS = ['hActive', 'hSyncPositive', 'hFront', 'hSync', 'hBack', 'vActive', 'vSyncPositive', 'vFront', 'vSync', 'vBack', 'vSyncOffsetA', 'vSyncOffsetB', 'pixelRep', 'frameRate', 'interlaced', 'pixelClock', 'aspect'];

// "h_active h_sync_polarity h_front_porch h_sync_pulse h_back_porch v_active v_sync_polarity
//  v_front_porch v_sync_pulse v_back_porch v_sync_offset_a v_sync_offset_b pixel_rep
//  frame_rate interlaced pixel_freq aspect_ratio" → fields, or null. Polarity 1 is a
// positive (active-high) sync, as the vendors' own device-tree readings of the same
// timings have it.
function parseTimings(text) {
    if (typeof text !== 'string') return null;
    const parts = text.trim().split(/\s+/);
    if (parts.length !== 17 || parts.some((p) => !/^\d+$/.test(p))) return null;
    const t = {};
    FIELDS.forEach((f, i) => { t[f] = parseInt(parts[i], 10); });
    if (t.hActive < 1 || t.vActive < 1 || t.pixelClock < 1) return null;
    t.hTotal = t.hActive + t.hFront + t.hSync + t.hBack;
    t.vTotal = t.vActive + t.vFront + t.vSync + t.vBack;
    t.refresh = t.pixelClock / (t.hTotal * t.vTotal);
    return t;
}

// "width height framerate [aspect margins interlace rb]" → fields, or null.
function parseCvt(text) {
    if (typeof text !== 'string') return null;
    const p = text.trim().split(/\s+/);
    if (p.length < 3 || p.length > 7 || p.some((x) => !/^\d+$/.test(x))) return null;
    const n = p.map((x) => parseInt(x, 10));
    if (n[0] < 1 || n[1] < 1 || n[2] < 1) return null;
    return { width: n[0], height: n[1], rate: n[2], aspect: n[3] === undefined ? 3 : n[3], margins: n[4] === 1, interlace: n[5] === 1, reducedBlanking: n[6] === 1 };
}

// The size and rate a preset's firmware lines describe, and where they came from:
// { width, height, rate, source: 'timings' | 'cvt' | 'mode', timings? } or null.
function resolution(config) {
    if (!config || typeof config !== 'object') return null;
    const t = parseTimings(config.hdmi_timings);
    if (t) return { width: t.hActive, height: t.vActive, rate: t.frameRate, source: 'timings', timings: t };
    const c = parseCvt(config.hdmi_cvt);
    if (c) return { width: c.width, height: c.height, rate: c.rate, source: 'cvt', reducedBlanking: c.reducedBlanking };
    const m = MODES[config.hdmi_group + '/' + config.hdmi_mode];
    if (m) return { width: m[0], height: m[1], rate: m[2], source: 'mode', reducedBlanking: Boolean(m[3]) };
    return null;
}

// The mode for video=<connector>:…, or null when the lines describe none.
// opts.forceEnable appends 'e' (the kernel treats the output as connected, as
// hdmi_force_hotplug does for the firmware). A timings row names the size only: the
// EDID this module generates carries the exact timing, and the kernel picks it by size.
function videoMode(config, opts) {
    const r = resolution(config);
    if (!r) return null;
    let s = r.width + 'x' + r.height + 'M';
    if (r.reducedBlanking) s += 'R';
    if (r.source !== 'timings') s += '@' + r.rate;
    if (opts && opts.forceEnable) s += 'e';
    return s;
}

// The parsed firmware lines a user typed as custom timings: 17 numbers are hdmi_timings,
// 3–7 are hdmi_cvt (as generateHDMIConfig decides).
function customConfig(customTimings) {
    if (typeof customTimings !== 'string' || !customTimings.trim()) return null;
    const n = customTimings.trim().split(/\s+/).length;
    return n >= 10 ? { hdmi_timings: customTimings.trim() } : { hdmi_cvt: customTimings.trim() };
}

// The EDID file name for a preset or port: pss-<key>, the helper's name rule.
function edidName(key) {
    const s = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'pss-' + (s || 'hdmi');
}

function checksum(block) {
    let sum = 0;
    for (let i = 0; i < 127; i++) sum = (sum + block[i]) & 0xff;
    block[127] = (256 - sum) & 0xff;
}

// A text descriptor: up to 13 printable ASCII characters, LF-terminated, space-padded.
function descriptorText(block, at, tag, text) {
    block[at] = 0; block[at + 1] = 0; block[at + 2] = 0; block[at + 3] = tag; block[at + 4] = 0;
    const clean = String(text || '').replace(/[^\x20-\x7e]/g, '').slice(0, 13).trim();
    const s = (clean.length < 13 ? clean + '\n' : clean).padEnd(13, ' ');
    for (let i = 0; i < 13; i++) block[at + 5 + i] = s.charCodeAt(i);
}

// Whether an 18-byte detailed timing descriptor can hold these timings (a few vendor
// lines have porches beyond its 6-bit vertical fields; those rows get no EDID and the
// kernel computes a CVT mode of the same size instead).
function fits(timings) {
    const t = typeof timings === 'string' ? parseTimings(timings) : timings;
    if (!t) return false;
    const hBlank = t.hFront + t.hSync + t.hBack;
    const vBlank = t.vFront + t.vSync + t.vBack;
    return t.pixelClock >= 10000000 && Math.round(t.pixelClock / 10000) <= 0xffff && t.hActive <= 4095 && hBlank <= 4095 && t.vActive <= 4095 && vBlank <= 4095
        && t.hFront <= 1023 && t.hSync <= 1023 && t.vFront <= 63 && t.vSync <= 63;
}

// 128 bytes (DVI: picture only) or 256 bytes (HDMI with two-channel PCM audio) for one
// hdmi_timings line. opts: { name: string shown as the monitor name, audio: boolean,
// serial: number }. Throws on timings the 18-byte descriptor cannot hold (see fits).
function edid(timings, opts) {
    const t = typeof timings === 'string' ? parseTimings(timings) : timings;
    if (!t) throw new Error('edid: no timings');
    if (!fits(t)) throw new Error('edid: timing out of range for a detailed timing descriptor');
    opts = opts || {};
    const clock10k = Math.round(t.pixelClock / 10000);
    const hBlank = t.hFront + t.hSync + t.hBack;
    const vBlank = t.vFront + t.vSync + t.vBack;
    const base = Buffer.alloc(128);
    Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]).copy(base, 0);
    base.writeUInt16BE(((16) << 10) | ((19) << 5) | 19, 8); // manufacturer "PSS"
    const product = crypto.createHash('sha256').update(opts.name || '').digest();
    base.writeUInt16LE(product.readUInt16LE(0), 10);
    base.writeUInt32LE(opts.serial >>> 0 || 0, 12);
    base[16] = 0; // week not specified
    base[17] = 2026 - 1990;
    base[18] = 1; base[19] = 3; // EDID 1.3
    base[20] = 0x80; // digital input
    base[21] = 0; base[22] = 0; // image size unknown
    base[23] = 120; // gamma 2.2
    base[24] = 0x06; // sRGB, preferred timing is the first descriptor
    Buffer.from([0xee, 0x91, 0xa3, 0x54, 0x4c, 0x99, 0x26, 0x0f, 0x50, 0x54]).copy(base, 25); // sRGB chromaticity
    base[35] = 0; base[36] = 0; base[37] = 0; // no established timings
    for (let i = 38; i < 54; i++) base[i] = 0x01; // standard timings unused
    // Detailed timing descriptor 1: the panel
    let d = 54;
    base.writeUInt16LE(clock10k, d);
    base[d + 2] = t.hActive & 0xff;
    base[d + 3] = hBlank & 0xff;
    base[d + 4] = ((t.hActive >> 8) << 4) | (hBlank >> 8);
    base[d + 5] = t.vActive & 0xff;
    base[d + 6] = vBlank & 0xff;
    base[d + 7] = ((t.vActive >> 8) << 4) | (vBlank >> 8);
    base[d + 8] = t.hFront & 0xff;
    base[d + 9] = t.hSync & 0xff;
    base[d + 10] = ((t.vFront & 0x0f) << 4) | (t.vSync & 0x0f);
    base[d + 11] = ((t.hFront >> 8) << 6) | ((t.hSync >> 8) << 4) | ((t.vFront >> 4) << 2) | (t.vSync >> 4);
    base[d + 12] = 0; base[d + 13] = 0; base[d + 14] = 0; // image size unknown
    base[d + 15] = 0; base[d + 16] = 0; // no borders
    base[d + 17] = (t.interlaced ? 0x80 : 0) | 0x18 | (t.vSyncPositive ? 0x04 : 0) | (t.hSyncPositive ? 0x02 : 0); // digital separate sync
    // Descriptor 2: range limits around the one timing, and around 640x480p60, which
    // the CTA extension declares as every sink must
    d = 72;
    base[d] = 0; base[d + 1] = 0; base[d + 2] = 0; base[d + 3] = 0xfd; base[d + 4] = 0;
    const hz = t.refresh;
    const hkhz = t.pixelClock / t.hTotal / 1000;
    base[d + 5] = Math.max(1, Math.min(59, Math.floor(hz) - 1));
    base[d + 6] = Math.min(255, Math.max(61, Math.ceil(hz) + 1));
    base[d + 7] = Math.max(1, Math.min(31, Math.floor(hkhz) - 1));
    base[d + 8] = Math.min(255, Math.max(32, Math.ceil(hkhz) + 1));
    base[d + 9] = Math.min(255, Math.max(3, Math.ceil(t.pixelClock / 10000000)));
    base[d + 10] = 0x00; // no secondary timing formula
    base[d + 11] = 0x0a;
    for (let i = 12; i < 18; i++) base[d + i] = 0x20;
    descriptorText(base, 90, 0xfc, opts.name || 'Pi Screen Setup');
    // Descriptor 4: unused
    base[108] = 0; base[109] = 0; base[110] = 0; base[111] = 0x10; base[112] = 0;
    for (let i = 113; i < 126; i++) base[i] = 0;
    base[126] = opts.audio ? 1 : 0;
    checksum(base);
    if (!opts.audio) return base;

    // CTA-861 extension: an HDMI sink with basic audio, two-channel PCM, front speakers.
    // VIC 1 (640x480p60) and the video capability block are what the standard requires of
    // every sink; the panel's timing is repeated here as the one native detailed timing,
    // so it stays the preferred mode.
    const ext = Buffer.alloc(128);
    const blocks = Buffer.from([
        0x23, 0x09, 0x07, 0x07,             // audio: LPCM, 2 channels, 32/44.1/48 kHz, 16/20/24 bit
        0x83, 0x01, 0x00, 0x00,             // speakers: front left/right
        0x41, 0x01,                         // video: VIC 1
        0xe2, 0x00, 0x4a,                   // video capability: RGB quantization selectable, underscanned
        0x65, 0x03, 0x0c, 0x00, 0x10, 0x00, // HDMI vendor block, physical address 1.0.0.0
    ]);
    ext[0] = 0x02; ext[1] = 0x03;
    ext[2] = 4 + blocks.length;
    ext[3] = 0x80 | 0x40 | 0x01; // underscan, basic audio, one native detailed timing
    blocks.copy(ext, 4);
    base.copy(ext, 4 + blocks.length, 54, 72);
    checksum(ext);
    return Buffer.concat([base, ext]);
}

// The drm.edid_firmware= value for a connector and file.
function edidToken(connector, name) {
    return 'drm.edid_firmware=' + connector + ':edid/' + name + '.bin';
}

module.exports = { MODES, parseTimings, parseCvt, resolution, videoMode, customConfig, edidName, fits, edid, edidToken };
