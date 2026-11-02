'use strict';
// Reads `xinput list` and `xinput list-props <id>`, classifies devices, and builds
// the xinput commands. Pure; nothing here runs a process.

const LIST_LINE = /^[\s⎡⎜⎣↳]*(.*?)\s+id=(\d+)\s+\[(master|slave|floating)\s+(pointer|keyboard)?\s*(?:\((\d+)\))?\]/;

function parseList(text) {
    const devices = [];
    for (const raw of String(text).split('\n')) {
        const m = LIST_LINE.exec(raw);
        if (!m) continue;
        devices.push({
            name: m[1].trim(),
            id: +m[2],
            role: m[3],
            kind: m[4] || null,
            attachedTo: m[5] !== undefined ? +m[5] : null,
            virtual: /^Virtual core/.test(m[1].trim()),
        });
    }
    return devices;
}

// Property lines: "\tName (id):\tvalue" with values comma-separated. One device per
// call; a second "Device '...':" header ends the read.
const PROP_LINE = /^\s*(.+?) \((\d+)\):\s*(.*)$/;

function parseProps(text) {
    const props = {};
    let device = null;
    for (const raw of String(text).split('\n')) {
        const d = /^Device '(.*)':$/.exec(raw.trim());
        if (d) { if (device !== null) break; device = d[1]; continue; }
        const m = PROP_LINE.exec(raw);
        if (!m) continue;
        props[m[1]] = { id: +m[2], value: m[3].trim() };
    }
    return { device, props };
}

// Absolute pointing devices are the ones a transformation matrix is for: touch
// screens, digitisers, tablets and a VM's absolute pointer. The decision uses the
// device's own properties where available (libinput's calibration matrix exists only
// on absolute devices), else the name.
const TOUCH_NAME = /touch|goodix|silead|elan|ft5|ilitek|ili2|atmel|maxtouch|egalax|wacom|hid-multitouch|tablet|digiti[sz]er|pen\b|stylus/i;
const RELATIVE_NAME = /\bmouse\b|trackpoint|touchpad|trackpad|mouse integration/i;

function classify(device, props) {
    if (device.role !== 'slave' || device.kind !== 'pointer' || device.virtual) return 'other';
    if (props && Object.prototype.hasOwnProperty.call(props, 'libinput Calibration Matrix')) return 'absolute';
    if (props && Object.prototype.hasOwnProperty.call(props, 'libinput Accel Speed')) return 'relative';
    if (TOUCH_NAME.test(device.name)) return 'absolute';
    if (RELATIVE_NAME.test(device.name)) return 'relative';
    return 'pointer';
}

function pointerSlaves(devices) {
    return devices.filter((d) => d.role === 'slave' && d.kind === 'pointer' && !d.virtual && !/XTEST/.test(d.name));
}

function currentMatrix(props) {
    const p = props['Coordinate Transformation Matrix'];
    return p ? p.value : null;
}

function nodeOf(props) {
    const p = props['Device Node'];
    return p ? p.value.replace(/^"|"$/g, '') : null;
}

// ---- command builders ----

function setMatrixArgs(id, matrixText) {
    return ['set-prop', String(id), '--type=float', 'Coordinate Transformation Matrix', ...String(matrixText).trim().split(/\s+/)];
}

function mapToOutputArgs(id, outputName) { return ['map-to-output', String(id), outputName]; }

function listPropsArgs(id) { return ['list-props', String(id)]; }

// udev rule text for a persistent libinput calibration (2x3: the top two rows of the
// 3x3), matched by device name. Written by the plugin, read by libinput's udev
// backend at device add, so the matrix holds before X and across restarts.
function udevRule(deviceName, matrixText) {
    const n = String(matrixText).trim().split(/\s+/);
    if (n.length !== 9) throw new RangeError('expected a 3x3 matrix');
    const six = n.slice(0, 6).join(' ');
    const esc = deviceName.replace(/"/g, '\\"');
    return `ACTION=="add|change", KERNEL=="event[0-9]*", ATTRS{name}=="${esc}", ENV{LIBINPUT_CALIBRATION_MATRIX}="${six}"\n`;
}

module.exports = { parseList, parseProps, classify, pointerSlaves, currentMatrix, nodeOf, setMatrixArgs, mapToOutputArgs, listPropsArgs, udevRule };
