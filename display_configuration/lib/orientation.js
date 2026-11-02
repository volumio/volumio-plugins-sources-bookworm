'use strict';
// One orientation of a rectangle: a clockwise turn and an optional mirror, the eight
// elements of the dihedral group D4. Written in xrandr's words so the plugin, its
// settings and its users share one vocabulary: turn normal|right|inverted|left
// (0, 90, 180, 270 degrees clockwise), mirror false|true (reflected across the
// vertical axis before the turn). Every other layer's notation is a conversion from
// here, and each conversion carries its source so a wrong direction can be traced.
//
// Pairings, which are the facts that matter (names differ between layers):
//   xrandr right  <-> fbcon rotate:1 (fbcon.rst: 1 = clockwise 90)
//                 <-> DRM ROTATE_270 (drm_mode.h: DRM rotation is counter-clockwise)
//                 <-> kernel panel orientation "Right Side Up" (drm_client_rotation)
//                 <-> input matrix 0 1 0 / -1 0 1 / 0 0 1 (baseline 0.0.43, Arch wiki)
//   xrandr left   <-> fbcon 3 <-> DRM ROTATE_90 <-> "Left Side Up" <-> 0 -1 1 / 1 0 0 / 0 0 1

const TURNS = ['normal', 'right', 'inverted', 'left'];
const DEGREES = { normal: 0, right: 90, inverted: 180, left: 270 };

// Homogeneous 3x3 matrices mapping normalised device coordinates to screen
// coordinates, as xinput's "Coordinate Transformation Matrix" wants them.
const M = {
    normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    right: [[0, 1, 0], [-1, 0, 1], [0, 0, 1]],
    inverted: [[-1, 0, 1], [0, -1, 1], [0, 0, 1]],
    left: [[0, -1, 1], [1, 0, 0], [0, 0, 1]],
    mirror: [[-1, 0, 1], [0, 1, 0], [0, 0, 1]],
};

function mul(a, b) {
    const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
    return r;
}

function same(a, b) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (a[i][j] !== b[i][j]) return false;
    return true;
}

// The eight elements with their matrices: turn applied after the mirror.
const ELEMENTS = [];
for (const turn of TURNS) {
    ELEMENTS.push({ turn, mirror: false, matrix: M[turn] });
    ELEMENTS.push({ turn, mirror: true, matrix: mul(M[turn], M.mirror) });
}

function make(turn, mirror) {
    if (!TURNS.includes(turn)) throw new RangeError('turn must be one of ' + TURNS.join(', ') + ', got ' + turn);
    return Object.freeze({ turn, mirror: Boolean(mirror) });
}

function matrixOf(o) {
    return ELEMENTS.find((e) => e.turn === o.turn && e.mirror === o.mirror).matrix;
}

function fromMatrix(m) {
    const e = ELEMENTS.find((x) => same(x.matrix, m));
    if (!e) throw new RangeError('matrix is not one of the eight orientations');
    return make(e.turn, e.mirror);
}

const NORMAL = make('normal', false);

// compose(a, b): apply b first, then a. Used as compose(user, panel): the panel's own
// correction first, then what the user asked for on top.
function compose(a, b) { return fromMatrix(mul(matrixOf(a), matrixOf(b))); }

function invert(o) {
    return ELEMENTS.map((e) => make(e.turn, e.mirror)).find((c) => compose(o, c).turn === 'normal' && !compose(o, c).mirror);
}

function fromDegreesClockwise(deg, mirror) {
    const d = ((Number(deg) % 360) + 360) % 360;
    const turn = TURNS.find((t) => DEGREES[t] === d);
    if (!turn) throw new RangeError('degrees must be a multiple of 90, got ' + deg);
    return make(turn, mirror);
}

function toDegreesClockwise(o) { return DEGREES[o.turn]; }

// xrandr: --rotate <turn> --reflect normal|x|y|xy. "y" and "xy" are folded: a
// reflection across both axes is a half turn; across y alone is x plus a half turn.
function toXrandr(o) { return { rotate: o.turn, reflect: o.mirror ? 'x' : 'normal' }; }

function fromXrandr(rotate, reflect) {
    const base = make(rotate, false);
    switch (reflect || 'normal') {
        case 'normal': return base;
        case 'x': return compose(base, make('normal', true));
        case 'y': return compose(base, make('inverted', true));
        case 'xy': return compose(base, make('inverted', false));
        default: throw new RangeError('reflect must be normal, x, y or xy, got ' + reflect);
    }
}

// fbcon=rotate:N and /sys/class/graphics/fbcon/rotate: 0 normal, 1 clockwise 90,
// 2 upside down, 3 counter-clockwise 90 (Documentation/fb/fbcon.rst). No mirror.
function toFbcon(o) { return { value: DEGREES[o.turn] / 90, exact: !o.mirror }; }

// plymouth=N as the Volumio themes consume it: degrees clockwise, same number as
// the baseline 0.0.43 wrote for the same turn. No mirror.
function toPlymouth(o) { return { degrees: DEGREES[o.turn], exact: !o.mirror }; }

// The kernel's connector property "panel orientation" (drm_connector.c enum names),
// mapped through drm_client_rotation(): Upside Down -> ROTATE_180, Left Side Up ->
// ROTATE_90 (counter-clockwise), Right Side Up -> ROTATE_270. As an xrandr turn:
const PANEL_ORIENTATION = {
    'Normal': 'normal',
    'Upside Down': 'inverted',
    'Left Side Up': 'left',
    'Right Side Up': 'right',
};

function fromPanelOrientation(name) {
    if (name === undefined || name === null || name === '') return null;
    const turn = PANEL_ORIENTATION[name];
    if (!turn) throw new RangeError('unknown panel orientation "' + name + '"');
    return make(turn, false);
}

// video=<connector>:...,rotate=N[,reflect_x][,reflect_y] on the kernel line: N is
// DRM's counter-clockwise degrees (drm_modes.c -> DRM_MODE_ROTATE_N). The kernel adds
// it to the panel orientation it already knows (drm_client_rotation), so the caller
// passes the remainder, not the total. Reflection never reaches fbcon (drm_fb_helper:
// a reflect bit leaves fbcon_rotate_hint unrotated), so it is reported, not promised.
function toCmdline(o) {
    return { rotate: (360 - DEGREES[o.turn]) % 360, reflect_x: o.mirror, exact: !o.mirror };
}

// video=...,panel_orientation=<word>: the same four names in the cmdline spelling.
const CMDLINE_PANEL_ORIENTATION = { normal: 'normal', inverted: 'upside_down', left: 'left_side_up', right: 'right_side_up' };
function toCmdlinePanelOrientation(o) { return { value: CMDLINE_PANEL_ORIENTATION[o.turn], exact: !o.mirror }; }

// xinput set-prop <id> "Coordinate Transformation Matrix" <nine floats>
function toInputMatrix(o) { return matrixOf(o).map((row) => row.join(' ')).join(' '); }

function fromInputMatrix(text) {
    const n = String(text).trim().split(/[\s,]+/).map(Number);
    if (n.length !== 9 || n.some((x) => Number.isNaN(x))) throw new RangeError('expected nine numbers');
    return fromMatrix([[n[0], n[1], n[2]], [n[3], n[4], n[5]], [n[6], n[7], n[8]]]);
}

function equals(a, b) { return a.turn === b.turn && a.mirror === b.mirror; }

function toString(o) { return o.mirror ? o.turn + '+mirror' : o.turn; }

function parse(text) {
    const [turn, flag] = String(text).split('+');
    if (flag !== undefined && flag !== 'mirror') throw new RangeError('expected <turn> or <turn>+mirror, got ' + text);
    return make(turn, flag === 'mirror');
}

module.exports = {
    TURNS, NORMAL, make, compose, invert, equals, toString, parse,
    fromDegreesClockwise, toDegreesClockwise,
    toXrandr, fromXrandr, toFbcon, toPlymouth,
    fromPanelOrientation, toCmdline, toCmdlinePanelOrientation,
    toInputMatrix, fromInputMatrix,
    all: () => ELEMENTS.map((e) => make(e.turn, e.mirror)),
};
