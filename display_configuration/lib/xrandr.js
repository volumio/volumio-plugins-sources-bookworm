'use strict';
// Reads what `xrandr --verbose` and `xrandr --listproviders` print and builds the
// xrandr commands the plugin issues. Parsing is pure; nothing here runs a process.
//
// Shape of --verbose (xrandr 1.5.x): a "Screen N:" line; per output a header line
//   <name> connected|disconnected [primary] [WxH+X+Y] [(0xid)] <rotation> [<reflection>] (<supported>)
//   [<mm>mm x <mm>mm] [panning ...]
// where <reflection> is "X axis", "Y axis" or "X and Y axis" and appears only when set;
// then tab-indented "key: value" lines (Identifier, CRTC, Transform with two
// continuation lines, then driver properties with a "\t\tsupported:" or "\t\trange:"
// line), then two-space-indented mode lines "  WxH (0xid) MHz [+preferred] [*current]"
// each followed by "h:" and "v:" timing lines.

const HEADER = /^(\S+) (connected|disconnected|unknown connection)( primary)?(?: (\d+)x(\d+)\+(\d+)\+(\d+))?(?: \((0x[0-9a-f]+)\))?(?: (normal|left|inverted|right)(?: (X axis|Y axis|X and Y axis))? \(([^)]*)\))?(?: (\d+)mm x (\d+)mm)?(.*)$/;
const REFLECTION = { 'X axis': 'x', 'Y axis': 'y', 'X and Y axis': 'xy' };
const MODE = /^  (\d+)x(\d+)(i)? \((0x[0-9a-f]+)\)\s+([\d.]+)MHz(.*)$/;
const H_TIMING = /^\s+h: width\s+(\d+) start\s+(\d+) end\s+(\d+) total\s+(\d+) skew\s+(\d+) clock\s+([\d.]+)KHz/;
const V_TIMING = /^\s+v: height\s+(\d+) start\s+(\d+) end\s+(\d+) total\s+(\d+)\s+clock\s+([\d.]+)Hz/;
const PROPERTY = /^\t([^\t:][^:]*?):\s?(.*)$/;
const PROVIDER = /^Provider (\d+): id: (0x[0-9a-f]+) cap: (0x[0-9a-f]+)(?:, (.*?))? crtcs: (\d+) outputs: (\d+) associated providers: (\d+) name:(.*)$/;

// Fields xrandr prints for every output that are state, not driver properties.
const BUILTIN = new Set(['Identifier', 'Timestamp', 'Subpixel', 'Gamma', 'Brightness', 'Clones', 'CRTC', 'CRTCs', 'Transform', 'filter', 'EDID', 'Panning', 'Tracking', 'Border', 'non-desktop']);

function parseVerbose(text) {
    const lines = String(text).split('\n');
    const result = { screen: null, outputs: [], warnings: [] };
    let out = null;
    let mode = null;
    let prop = null;

    for (const line of lines) {
        if (line === '') continue;
        if (line.startsWith('xrandr: ')) { result.warnings.push(line.slice(8).trim()); continue; }
        let m;
        if ((m = /^Screen (\d+): minimum (\d+) x (\d+), current (\d+) x (\d+), maximum (\d+) x (\d+)/.exec(line))) {
            result.screen = { index: +m[1], minimum: [+m[2], +m[3]], current: [+m[4], +m[5]], maximum: [+m[6], +m[7]] };
            continue;
        }
        if ((m = HEADER.exec(line))) {
            out = {
                name: m[1],
                connected: m[2] === 'connected',
                primary: Boolean(m[3]),
                active: m[4] !== undefined,
                geometry: m[4] !== undefined ? { width: +m[4], height: +m[5], x: +m[6], y: +m[7] } : null,
                modeId: m[8] || null,
                rotation: m[9] || null,
                reflection: m[9] ? (REFLECTION[m[10]] || 'normal') : null,
                physical: m[12] !== undefined ? { widthMm: +m[12], heightMm: +m[13] } : null,
                rotationsSupported: [],
                reflectionsSupported: [],
                properties: {},
                modes: [],
                raw: line,
            };
            result.outputs.push(out);
            mode = null; prop = null;
            continue;
        }
        if (!out) continue;
        if ((m = MODE.exec(line))) {
            mode = {
                width: +m[1], height: +m[2], interlaced: Boolean(m[3]), id: m[4], clockMHz: +m[5],
                preferred: m[6].includes('+preferred'), current: m[6].includes('*current'),
                hSync: m[6].includes('+HSync') ? '+' : m[6].includes('-HSync') ? '-' : null,
                vSync: m[6].includes('+VSync') ? '+' : m[6].includes('-VSync') ? '-' : null,
                h: null, v: null, refreshHz: null,
            };
            out.modes.push(mode);
            prop = null;
            continue;
        }
        if (mode && (m = H_TIMING.exec(line))) {
            mode.h = { width: +m[1], start: +m[2], end: +m[3], total: +m[4], skew: +m[5], clockKHz: +m[6] };
            continue;
        }
        if (mode && (m = V_TIMING.exec(line))) {
            mode.v = { height: +m[1], start: +m[2], end: +m[3], total: +m[4], clockHz: +m[5] };
            mode.refreshHz = +m[5];
            continue;
        }
        if (line.startsWith('\t\t') && prop) {
            const t = line.trim();
            if (t.startsWith('supported:')) prop.supported = t.slice('supported:'.length).split(',').map((s) => s.trim()).filter(Boolean);
            else if (t.startsWith('range:')) {
                const r = /range: \((-?\d+), (-?\d+)\)/.exec(t);
                if (r) prop.range = [+r[1], +r[2]];
            }
            continue;
        }
        if ((m = PROPERTY.exec(line))) {
            const key = m[1].trim();
            const value = m[2].trim();
            if (BUILTIN.has(key)) {
                if (key === 'CRTC' && value !== '') out.crtc = +value;
                if (key === 'Identifier') out.identifier = value;
                prop = null;
                continue;
            }
            prop = { value, supported: null, range: null };
            out.properties[key] = prop;
            continue;
        }
    }

    // Rotations the server offers are in the header's parenthesised list on the
    // "disconnected" and non-active forms; on active outputs xrandr prints them in
    // the header too, after the geometry. Recover both from the raw header tail.
    for (const o of result.outputs) {
        const list = /\((normal|left|inverted|right)(?: (normal|left|inverted|right))*(?: x axis)?(?: y axis)?\)/.exec(o.raw);
        if (list) {
            const words = list[0].slice(1, -1).split(' ');
            o.rotationsSupported = words.filter((w) => ['normal', 'left', 'inverted', 'right'].includes(w));
            o.reflectionsSupported = [];
            if (list[0].includes('x axis')) o.reflectionsSupported.push('x');
            if (list[0].includes('y axis')) o.reflectionsSupported.push('y');
        }
        const cur = o.modes.find((md) => md.current);
        o.currentMode = cur || null;
        o.preferredMode = o.modes.find((md) => md.preferred) || null;
        const po = o.properties['panel orientation'];
        o.panelOrientation = po ? po.value : null;
    }
    return result;
}

function parseProviders(text) {
    const providers = [];
    for (const line of String(text).split('\n')) {
        const m = PROVIDER.exec(line.trim());
        if (!m) continue;
        providers.push({
            index: +m[1], id: m[2], capabilities: m[3],
            capabilityNames: (m[4] || '').split(',').map((s) => s.trim()).filter(Boolean),
            crtcs: +m[5], outputs: +m[6], associatedProviders: +m[7], name: m[8].trim(),
        });
    }
    return providers;
}

function connectedOutputs(parsed) { return parsed.outputs.filter((o) => o.connected); }

// Whether this output can be turned by RandR at all: the legacy "default" output of
// a non-KMS driver lists no rotations and no properties (virtbookworm under VMSVGA).
function canRotate(output) { return output.rotationsSupported.length > 1; }

function hasProperty(output, name) { return Object.prototype.hasOwnProperty.call(output.properties, name); }

// ---- command builders: arrays of argv tokens, never shell strings ----

function rotateArgs(outputName, xr) {
    return ['--output', outputName, '--rotate', xr.rotate, '--reflect', xr.reflect];
}

function modeArgs(outputName, mode) { return ['--output', outputName, '--mode', mode]; }

function positionArgs(outputName, x, y) { return ['--output', outputName, '--pos', x + 'x' + y]; }

function offArgs(outputName) { return ['--output', outputName, '--off']; }

function setPropertyArgs(outputName, property, value) { return ['--output', outputName, '--set', property, String(value)]; }

// Shrink the picture by a fraction per axis and move it, in output pixels, keeping
// the result centred unless offsets are given. xrandr's transform maps output pixels
// to framebuffer pixels, so a smaller picture means a scale above 1 and the
// translation is negative. The nine values are the row-major matrix.
function fitArgs(outputName, width, height, { scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0, filter = 'bilinear' } = {}) {
    if (!(scaleX > 0 && scaleY > 0)) throw new RangeError('scale must be positive');
    const a = 1 / scaleX, e = 1 / scaleY;
    const c = -((width - width * scaleX) / 2 + offsetX) * a;
    const f = -((height - height * scaleY) / 2 + offsetY) * e;
    const fmt = (n) => (Math.round(n * 1e6) / 1e6).toString();
    return ['--output', outputName, '--transform', [a, 0, c, 0, e, f, 0, 0, 1].map(fmt).join(','), '--filter', filter];
}

function resetTransformArgs(outputName) { return ['--output', outputName, '--transform', 'none']; }

function newModeArgs(name, modeline) { return ['--newmode', name, ...String(modeline).trim().split(/\s+/)]; }

function addModeArgs(outputName, name) { return ['--addmode', outputName, name]; }

// A ModeLine from a mode's timings, the inverse of what --verbose prints: this is
// how a user's adjusted porches become a mode xrandr accepts.
function modeline(mode, { name } = {}) {
    const h = mode.h, v = mode.v;
    if (!h || !v) throw new RangeError('mode has no timings');
    const clock = Math.round(mode.clockMHz * 1000) / 1000;
    const flags = [mode.hSync === '-' ? '-hsync' : '+hsync', mode.vSync === '-' ? '-vsync' : '+vsync'];
    if (mode.interlaced) flags.push('Interlace');
    return [name || (h.width + 'x' + v.height + '_' + (mode.refreshHz || '')), clock, h.width, h.start, h.end, h.total, v.height, v.start, v.end, v.total, ...flags].join(' ');
}

module.exports = {
    parseVerbose, parseProviders, connectedOutputs, canRotate, hasProperty,
    rotateArgs, modeArgs, positionArgs, offArgs, setPropertyArgs, fitArgs, resetTransformArgs,
    newModeArgs, addModeArgs, modeline,
};
