'use strict';
// Which Raspberry Pi this is, from the revision code the firmware publishes.
// Source: raspberrypi.com/documentation/computers/raspberry-pi.html#raspberry-pi-revision-codes
// and config_txt.html#conditional-filters (which boards each [filter] matches), read 2026-11-02.
const fs = require('fs');

const MEMORY_MB = [256, 512, 1024, 2048, 4096, 8192, 16384, null];
const PROCESSOR = ['bcm2835', 'bcm2836', 'bcm2837', 'bcm2711', 'bcm2712'];
const MANUFACTURER = ['Sony UK', 'Egoman', 'Embest', 'Sony Japan', 'Embest', 'Stadium'];

// type code → name, the config.txt model filters it satisfies, and what the board offers.
// filters: every [tag] whose contents the firmware applies to this board.
// dsi: the DSI ports wired to a connector; the kernel overlays default to DSI1 and take
// ",dsi0" for the other (Compute Modules and Pi 5 have both).
// kms: 'yes' | 'os-omits' (Volumio leaves KMS off: pi.sh "[pi02]" comment) | 'no' (armv6,
// not a Volumio 4 target, or firmware refuses below 512 MB).
const TYPES = {
    0x00: { name: 'Pi A', filters: ['pi1'], hdmi: 1, dsi: [], composite: true, kms: 'no', kmsOverlay: null },
    0x01: { name: 'Pi B', filters: ['pi1'], hdmi: 1, dsi: [], composite: true, kms: 'no', kmsOverlay: null },
    0x02: { name: 'Pi A+', filters: ['pi1'], hdmi: 1, dsi: ['dsi1'], composite: true, kms: 'no', kmsOverlay: null },
    0x03: { name: 'Pi B+', filters: ['pi1'], hdmi: 1, dsi: ['dsi1'], composite: true, kms: 'no', kmsOverlay: null },
    0x04: { name: 'Pi 2B', filters: ['pi2'], hdmi: 1, dsi: ['dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d' },
    0x06: { name: 'CM1', filters: ['pi1', 'cm1'], hdmi: 1, dsi: ['dsi0', 'dsi1'], composite: true, kms: 'no', kmsOverlay: null },
    0x08: { name: 'Pi 3B', filters: ['pi3'], hdmi: 1, dsi: ['dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d' },
    0x09: { name: 'Pi Zero', filters: ['pi0'], hdmi: 1, dsi: [], composite: true, kms: 'no', kmsOverlay: null },
    0x0a: { name: 'CM3', filters: ['pi3', 'cm3'], hdmi: 1, dsi: ['dsi0', 'dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d' },
    0x0c: { name: 'Pi Zero W', filters: ['pi0', 'pi0w'], hdmi: 1, dsi: [], composite: true, kms: 'no', kmsOverlay: null },
    0x0d: { name: 'Pi 3B+', filters: ['pi3', 'pi3+'], hdmi: 1, dsi: ['dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d' },
    0x0e: { name: 'Pi 3A+', filters: ['pi3', 'pi3+'], hdmi: 1, dsi: ['dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d' },
    0x10: { name: 'CM3+', filters: ['pi3', 'pi3+', 'cm3+'], hdmi: 1, dsi: ['dsi0', 'dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d' },
    0x11: { name: 'Pi 4B', filters: ['pi4'], hdmi: 2, dsi: ['dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d-pi4' },
    0x12: { name: 'Pi Zero 2 W', filters: ['pi0', 'pi0w', 'pi02'], hdmi: 1, dsi: [], composite: true, kms: 'os-omits', kmsOverlay: 'vc4-kms-v3d' },
    0x13: { name: 'Pi 400', filters: ['pi4', 'pi400'], hdmi: 2, dsi: [], composite: false, kms: 'yes', kmsOverlay: 'vc4-kms-v3d-pi4' },
    0x14: { name: 'CM4', filters: ['pi4', 'cm4'], hdmi: 2, dsi: ['dsi0', 'dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d-pi4' },
    0x15: { name: 'CM4S', filters: ['pi4', 'cm4s'], hdmi: 1, dsi: ['dsi0', 'dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d-pi4' },
    0x17: { name: 'Pi 5', filters: ['pi5'], hdmi: 2, dsi: ['dsi0', 'dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d-pi5' },
    0x18: { name: 'CM5', filters: ['pi5', 'cm5'], hdmi: 2, dsi: ['dsi0', 'dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d-pi5' },
    0x19: { name: 'Pi 500', filters: ['pi5', 'pi500'], hdmi: 2, dsi: [], composite: false, kms: 'yes', kmsOverlay: 'vc4-kms-v3d-pi5' },
    // CM5 Lite: the documentation lists no [cm5l] filter; it is a CM5 without eMMC.
    0x1a: { name: 'CM5 Lite', filters: ['pi5', 'cm5'], hdmi: 2, dsi: ['dsi0', 'dsi1'], composite: true, kms: 'yes', kmsOverlay: 'vc4-kms-v3d-pi5' },
    0x1b: { name: 'CM0', filters: ['pi0', 'pi0w', 'pi02', 'cm0'], hdmi: 1, dsi: [], composite: true, kms: 'os-omits', kmsOverlay: 'vc4-kms-v3d' },
};

// Old-style codes (Pi 1 era) carry no fields; they are all 'no' for Volumio 4.
const OLD_STYLE = {
    0x0002: 'Pi B', 0x0003: 'Pi B', 0x0004: 'Pi B', 0x0005: 'Pi B', 0x0006: 'Pi B',
    0x0007: 'Pi A', 0x0008: 'Pi A', 0x0009: 'Pi A', 0x000d: 'Pi B', 0x000e: 'Pi B',
    0x000f: 'Pi B', 0x0010: 'Pi B+', 0x0011: 'CM1', 0x0012: 'Pi A+', 0x0013: 'Pi B+',
    0x0014: 'CM1', 0x0015: 'Pi A+',
};

// A revision code as a number, from a hex string ("c04170"), a cpuinfo line, or the
// 4-byte big-endian /proc/device-tree/system/linux,revision.
function parseRevision(input) {
    if (Buffer.isBuffer(input)) return input.length >= 4 ? input.readUInt32BE(input.length - 4) : null;
    if (typeof input === 'number') return input >>> 0;
    if (typeof input !== 'string') return null;
    const line = input.match(/^Revision\s*:\s*(?:0x)?([0-9a-fA-F]{4,8})\s*$/m);
    if (line) return parseInt(line[1], 16) >>> 0;
    const bare = input.trim().match(/^(?:0x)?([0-9a-fA-F]{4,8})$/);
    return bare ? parseInt(bare[1], 16) >>> 0 : null;
}

function decodeRevision(code) {
    if (code === null || code === undefined) return null;
    code = code >>> 0;
    const newStyle = ((code >> 23) & 1) === 1;
    if (!newStyle) {
        const name = OLD_STYLE[code & 0xffff];
        if (!name) return null;
        return {
            code, newStyle: false, type: null, name, revision: null, memoryMb: null,
            processor: 'bcm2835', manufacturer: null, filters: ['pi1'].concat(name === 'CM1' ? ['cm1'] : []),
            hdmi: 1, dsi: [], composite: true, kms: 'no', kmsOverlay: null, known: true,
        };
    }
    const type = (code >> 4) & 0xff;
    const t = TYPES[type];
    const base = t || { name: 'Unknown Raspberry Pi (type 0x' + type.toString(16) + ')', filters: [], hdmi: 0, dsi: [], composite: false, kms: 'no', kmsOverlay: null };
    return {
        code,
        newStyle: true,
        type,
        name: base.name,
        revision: code & 0xf,
        memoryMb: MEMORY_MB[(code >> 20) & 0x7],
        processor: PROCESSOR[(code >> 12) & 0xf] || null,
        manufacturer: MANUFACTURER[(code >> 16) & 0xf] || null,
        filters: base.filters.slice(),
        hdmi: base.hdmi,
        dsi: base.dsi.slice(),
        composite: base.composite,
        kms: base.kms,
        kmsOverlay: base.kmsOverlay,
        known: Boolean(t),
    };
}

// DRM connector name for a DSI port. Boards up to the Pi 4 expose one DSI connector,
// which the kernel names DSI-1. The Pi 5 family exposes both: dsi0 → DSI-1, dsi1 → DSI-2
// (vendor pages for Pi 5 panels all name the default port "DSI-2").
function dsiConnector(board, port) {
    if (board && board.processor === 'bcm2712') return port === 'dsi0' ? 'DSI-1' : 'DSI-2';
    return 'DSI-1';
}

// Reads the running system. Every read is optional; what is missing stays null.
function readSystem(root) {
    root = root || '';
    const read = (p) => { try { return fs.readFileSync(root + p); } catch (e) { return null; } };
    const str = (b) => (b ? b.toString('utf8').replace(/\0/g, '\n').trim() : null);
    let rev = read('/proc/device-tree/system/linux,revision');
    let code = rev ? parseRevision(rev) : null;
    if (code === null) {
        const cpuinfo = str(read('/proc/cpuinfo'));
        if (cpuinfo) code = parseRevision(cpuinfo);
    }
    const compatible = str(read('/proc/device-tree/compatible'));
    const model = str(read('/proc/device-tree/model'));
    const serialRaw = str(read('/proc/device-tree/serial-number'));
    const board = decodeRevision(code);
    return {
        board,
        model,
        compatible: compatible ? compatible.split('\n').filter(Boolean) : [],
        serial: serialRaw ? serialRaw.slice(-8).toLowerCase() : null,
        memoryMb: board ? board.memoryMb : memoryFromMeminfo(str(read('/proc/meminfo'))),
    };
}

// MemTotal under-reports (the GPU and the kernel take their share), so round up to the
// next power of two: a 1 GB board reports about 920 MB.
function memoryFromMeminfo(meminfo) {
    const m = meminfo && meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
    if (!m) return null;
    const mb = parseInt(m[1], 10) / 1024;
    let p = 128;
    while (p < mb) p *= 2;
    return p;
}

module.exports = { TYPES, parseRevision, decodeRevision, dsiConnector, readSystem, memoryFromMeminfo };
