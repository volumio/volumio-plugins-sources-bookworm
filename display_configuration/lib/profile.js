'use strict';
// The plugin's settings as named profiles, one active. A profile is a complete
// description of what the user wants from every screen and input on the device;
// `plan()` turns a profile plus what was probed into the per-layer actions. Pure:
// no files, no processes. Reading and writing the files is index.js's job.

const O = require('./orientation');

const SCHEMA = 1;
const ANY = '*'; // the one-screen case: applies to whichever output is connected

const TURN_WORDS = new Set(O.TURNS);

function defaultOutput() {
    return {
        orientation: 'normal',      // what the user wants, relative to the panel's upright picture
        panelOrientation: null,     // override of the kernel's "panel orientation" (null = as probed)
        mode: null,                 // e.g. "1280x720" or "1280x720@60"; null = preferred
        fit: null,                  // { scaleX, scaleY, offsetX, offsetY } software geometry, or null
        underscan: null,            // { hborder, vborder } for drivers with the property, or null
        enabled: true,
        position: null,             // { x, y } in the layout, null = xrandr's choice
    };
}

function defaultProfile(name) {
    return {
        name,
        mode: 'manual',             // "follow": derive turns from the kernel's panel orientation (and a sensor when one exists)
        outputs: { [ANY]: defaultOutput() },
        inputs: { [ANY]: { offset: 'normal', output: null } },
        boot: { console: 'follow', splash: 'follow' },
        screensaver: { type: 'dpms', timeout: 120, notWhilePlaying: true, hideCursor: false },
        brightness: 100,
        virtual: { enabled: false, resolution: '1280x720' },
    };
}

function defaults() {
    return { schema: SCHEMA, activeProfile: 'default', profiles: { default: defaultProfile('default') }, debug: false };
}

// ---- validation, the one gate every profile passes (UI save, restore, migration) ----

function fail(path, msg) { const e = new RangeError(path + ': ' + msg); e.path = path; return e; }

function validateOrientationWord(v, path) {
    try { O.parse(v); } catch (e) { throw fail(path, e.message); }
}

function validateOutput(o, path) {
    if (typeof o !== 'object' || o === null) throw fail(path, 'must be an object');
    validateOrientationWord(o.orientation, path + '.orientation');
    if (o.panelOrientation !== null && o.panelOrientation !== undefined) {
        try { O.fromPanelOrientation(o.panelOrientation); } catch (e) { throw fail(path + '.panelOrientation', e.message); }
    }
    if (o.mode !== null && o.mode !== undefined && !/^\d{3,5}x\d{3,5}(@\d{2,3})?$/.test(o.mode)) throw fail(path + '.mode', 'must look like 1280x720 or 1280x720@60');
    if (o.fit) {
        for (const k of ['scaleX', 'scaleY']) if (!(typeof o.fit[k] === 'number' && o.fit[k] >= 0.5 && o.fit[k] <= 1.5)) throw fail(path + '.fit.' + k, 'must be a number in [0.5, 1.5]');
        for (const k of ['offsetX', 'offsetY']) if (!(Number.isInteger(o.fit[k]) && Math.abs(o.fit[k]) <= 2000)) throw fail(path + '.fit.' + k, 'must be an integer within 2000 pixels');
    }
    if (o.underscan) {
        for (const k of ['hborder', 'vborder']) if (!(Number.isInteger(o.underscan[k]) && o.underscan[k] >= 0 && o.underscan[k] <= 500)) throw fail(path + '.underscan.' + k, 'must be an integer in [0, 500]');
    }
    if (typeof o.enabled !== 'boolean') throw fail(path + '.enabled', 'must be boolean');
    if (o.position !== null && o.position !== undefined) {
        for (const k of ['x', 'y']) if (!(Number.isInteger(o.position[k]) && o.position[k] >= 0 && o.position[k] <= 16384)) throw fail(path + '.position.' + k, 'must be an integer in [0, 16384]');
    }
}

function validateProfile(p, path) {
    if (typeof p !== 'object' || p === null) throw fail(path, 'must be an object');
    if (typeof p.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(p.name)) throw fail(path + '.name', 'must be 1 to 40 characters of letters, digits, space, dot, underscore or dash');
    if (p.mode !== 'manual' && p.mode !== 'follow') throw fail(path + '.mode', 'must be manual or follow');
    if (typeof p.outputs !== 'object' || p.outputs === null || Object.keys(p.outputs).length === 0) throw fail(path + '.outputs', 'must name at least one output or "*"');
    for (const [k, v] of Object.entries(p.outputs)) {
        if (k !== ANY && !/^[A-Za-z]+(?:-[A-Z])?-\d+$/.test(k)) throw fail(path + '.outputs.' + k, 'must be a connector name or "*"');
        validateOutput(v, path + '.outputs.' + k);
    }
    if (typeof p.inputs !== 'object' || p.inputs === null) throw fail(path + '.inputs', 'must be an object');
    for (const [k, v] of Object.entries(p.inputs)) {
        if (typeof v !== 'object' || v === null) throw fail(path + '.inputs.' + k, 'must be an object');
        validateOrientationWord(v.offset, path + '.inputs.' + k + '.offset');
        if (v.output !== null && v.output !== undefined && typeof v.output !== 'string') throw fail(path + '.inputs.' + k + '.output', 'must be a connector name or null');
    }
    for (const k of ['console', 'splash']) {
        const v = p.boot && p.boot[k];
        if (v !== 'follow') validateOrientationWord(v, path + '.boot.' + k);
    }
    const s = p.screensaver || {};
    if (!['dpms', 'xscreensaver', 'off'].includes(s.type)) throw fail(path + '.screensaver.type', 'must be dpms, xscreensaver or off');
    if (!(Number.isInteger(s.timeout) && s.timeout >= 0 && s.timeout <= 86400)) throw fail(path + '.screensaver.timeout', 'must be an integer number of seconds up to a day');
    if (typeof s.notWhilePlaying !== 'boolean' || typeof s.hideCursor !== 'boolean') throw fail(path + '.screensaver', 'notWhilePlaying and hideCursor must be boolean');
    if (!(Number.isInteger(p.brightness) && p.brightness >= 1 && p.brightness <= 100)) throw fail(path + '.brightness', 'must be an integer percent in [1, 100]');
    const v = p.virtual || {};
    if (typeof v.enabled !== 'boolean') throw fail(path + '.virtual.enabled', 'must be boolean');
    if (!/^\d{3,5}x\d{3,5}$/.test(v.resolution)) throw fail(path + '.virtual.resolution', 'must look like 1280x720');
}

function validate(cfg) {
    if (typeof cfg !== 'object' || cfg === null) throw fail('config', 'must be an object');
    if (cfg.schema !== SCHEMA) throw fail('config.schema', 'must be ' + SCHEMA);
    if (typeof cfg.profiles !== 'object' || cfg.profiles === null || Object.keys(cfg.profiles).length === 0) throw fail('config.profiles', 'must hold at least one profile');
    for (const [k, p] of Object.entries(cfg.profiles)) {
        validateProfile(p, 'config.profiles.' + k);
        if (p.name !== k) throw fail('config.profiles.' + k + '.name', 'must equal its key');
    }
    if (!Object.prototype.hasOwnProperty.call(cfg.profiles, cfg.activeProfile)) throw fail('config.activeProfile', 'names no profile');
    if (typeof cfg.debug !== 'boolean') throw fail('config.debug', 'must be boolean');
    return cfg;
}

// ---- migration from the 0.0.43 config.json (v-conf shape: { key: { value, ... } }) ----

// v-conf stores a select either as { value: "right" } (the shipped defaults) or, after
// a save by the 0.0.x plugin, as { value: { value: "right", label: "Right (90 CW)" } }.
function valueOf(old, key, fallback) {
    const e = old && old[key];
    if (!e || e.value === undefined || e.value === null) return fallback;
    let v = e.value;
    if (typeof v === 'object' && v !== null && 'value' in v) v = v.value;
    if (v === undefined || v === null || v === '') return fallback;
    return v;
}

function migrateFrom043(old) {
    const cfg = defaults();
    const p = cfg.profiles.default;
    const rotate = String(valueOf(old, 'rotatescreen', 'normal'));
    const orientation = TURN_WORDS.has(rotate) ? rotate : 'normal';
    const out = p.outputs[ANY];
    out.orientation = orientation;

    const overscan = parseInt(valueOf(old, 'overscan', '0'), 10);
    if (Number.isInteger(overscan) && overscan > 0 && overscan <= 20) {
        const s = Math.round((1 - overscan / 100) * 1000) / 1000;
        out.fit = { scaleX: s, scaleY: s, offsetX: 0, offsetY: 0 };
    }

    const degreesOr = (v, dflt) => { const n = parseInt(v, 10); return [0, 90, 180, 270].includes(n) ? n : dflt; };
    const touch = degreesOr(valueOf(old, 'touch_offset', '0'), 0);
    p.inputs[ANY] = { offset: O.toString(O.fromDegreesClockwise(touch, false)), output: null };
    const pointer = degreesOr(valueOf(old, 'pointer_offset', '0'), 0);
    if (pointer !== 0) p.inputs['relative:*'] = { offset: O.toString(O.fromDegreesClockwise(pointer, false)), output: null };

    const display = O.make(orientation, false);
    for (const [oldKey, newKey] of [['fbcon_offset', 'console'], ['plymouth_offset', 'splash']]) {
        const v = valueOf(old, oldKey, 'same');
        if (v === 'same') p.boot[newKey] = 'follow';
        else p.boot[newKey] = O.toString(O.compose(display, O.fromDegreesClockwise(degreesOr(v, 0), false)));
    }

    p.screensaver.hideCursor = Boolean(valueOf(old, 'hidecursor', false));
    const type = valueOf(old, 'screensavertype', 'dpms');
    p.screensaver.type = ['dpms', 'xscreensaver'].includes(type) ? type : 'dpms';
    const timeout = parseInt(valueOf(old, 'timeout', 120), 10);
    p.screensaver.timeout = Number.isInteger(timeout) && timeout >= 0 ? Math.min(timeout, 86400) : 120;
    if (p.screensaver.timeout === 0) p.screensaver.type = 'off';
    p.screensaver.notWhilePlaying = Boolean(valueOf(old, 'noifplay', true));

    const b = Number(valueOf(old, 'brightness', 1));
    p.brightness = Number.isFinite(b) && b > 0 && b <= 1 ? Math.max(1, Math.round(b * 100)) : 100;
    cfg.debug = Boolean(valueOf(old, 'debug_logging', false));
    return validate(cfg);
}

function isLegacy(raw) { return raw && typeof raw === 'object' && raw.schema === undefined && raw.rotatescreen !== undefined; }

// ---- planning: profile + probe -> what each layer must be told ----

// probe: { outputs: [{ name, connected, panelOrientation, currentMode, preferredMode, rotationsSupported, properties }],
//          inputs: [{ id, name, kind: 'absolute'|'relative'|'pointer'|'other' }] }
function plan(cfg, probe) {
    const p = cfg.profiles[cfg.activeProfile];
    const connected = probe.outputs.filter((o) => o.connected);
    const steps = [];
    const notes = [];
    const perOutput = [];

    for (const out of connected) {
        const want = p.outputs[out.name] || p.outputs[ANY];
        if (!want) { notes.push('no settings for ' + out.name + ', left as is'); continue; }
        if (!want.enabled) { steps.push({ layer: 'x', output: out.name, action: 'off' }); continue; }

        const panelName = want.panelOrientation !== null && want.panelOrientation !== undefined ? want.panelOrientation : out.panelOrientation;
        const panel = O.fromPanelOrientation(panelName) || O.NORMAL;
        const user = O.parse(want.orientation);
        // X comes up unturned even on a quirked panel (xserver 21.1.7), so X needs
        // the panel's correction and the user's turn on top of it.
        const forX = p.mode === 'follow' ? panel : O.compose(user, panel);
        // The kernel applies the panel orientation itself; the kernel line carries the
        // user's turn only (drm_client_rotation adds them).
        const forKernel = p.mode === 'follow' ? O.NORMAL : user;

        const canRotate = Array.isArray(out.rotationsSupported) && out.rotationsSupported.length > 1;
        if (!canRotate && forX.turn !== 'normal') notes.push(out.name + ' offers no rotation to RandR (legacy driver); the turn cannot be applied in X');
        const xr = O.toXrandr(forX);
        perOutput.push({ output: out.name, forX, forKernel, panel: panelName || null });
        steps.push({ layer: 'x', output: out.name, action: 'rotate', rotate: canRotate ? xr.rotate : 'normal', reflect: canRotate ? xr.reflect : 'normal' });
        if (want.mode) steps.push({ layer: 'x', output: out.name, action: 'mode', mode: want.mode });
        if (want.position) steps.push({ layer: 'x', output: out.name, action: 'position', x: want.position.x, y: want.position.y });
        if (want.underscan && out.properties && Object.prototype.hasOwnProperty.call(out.properties, 'underscan')) {
            steps.push({ layer: 'x', output: out.name, action: 'underscan', hborder: want.underscan.hborder, vborder: want.underscan.vborder });
        } else if (want.underscan) {
            notes.push(out.name + ' has no underscan property; use fit instead');
        }
        if (want.fit) {
            const m = out.currentMode || out.preferredMode;
            if (m) steps.push({ layer: 'x', output: out.name, action: 'fit', width: m.width, height: m.height, fit: want.fit });
            else notes.push(out.name + ' has no known mode; fit skipped');
        } else {
            steps.push({ layer: 'x', output: out.name, action: 'fit-reset' });
        }
    }

    // Inputs: the orientation an absolute device needs is X's turn for the output it
    // belongs to, times the device's own offset (a mirrored controller, a rotated glass).
    const primary = perOutput[0] || null;
    for (const dev of probe.inputs || []) {
        if (dev.kind !== 'absolute' && dev.kind !== 'relative' && dev.kind !== 'pointer') continue;
        const specific = p.inputs[dev.name];
        const generic = dev.kind === 'relative' ? (p.inputs['relative:*'] || null) : (dev.kind === 'pointer' ? null : p.inputs[ANY]);
        const want = specific || generic;
        if (!want) continue; // relative pointers already move in screen space; an unclassified one is turned only by name
        const target = (want.output && perOutput.find((x) => x.output === want.output)) || primary;
        // A relative device's motion is in screen coordinates (the server rotates the
        // framebuffer, not the motion), so only the user's own offset applies to it.
        const base = dev.kind === 'relative' ? O.NORMAL : (target ? target.forX : O.NORMAL);
        const m = O.compose(base, O.parse(want.offset));
        steps.push({ layer: 'input', device: dev.id, name: dev.name, action: 'matrix', matrix: O.toInputMatrix(m) });
        if (target && connected.length > 1 && dev.kind === 'absolute') steps.push({ layer: 'input', device: dev.id, name: dev.name, action: 'map-to-output', output: target.output });
    }

    // Boot: console and splash follow the primary output unless set apart. fbcon has
    // one rotation for the whole machine (drm_fb_helper), so a second output with a
    // different turn is reported, not pretended.
    const bootBase = primary ? primary.forKernel : O.NORMAL;
    const consoleO = p.boot.console === 'follow' ? bootBase : O.parse(p.boot.console);
    const splashO = p.boot.splash === 'follow' ? bootBase : O.parse(p.boot.splash);
    const fb = O.toFbcon(consoleO);
    const ply = O.toPlymouth(splashO);
    if (!fb.exact || !ply.exact) notes.push('the console and the splash cannot mirror; the turn is applied without the mirror');
    const distinct = new Set(perOutput.map((x) => x.forKernel.turn));
    if (distinct.size > 1) notes.push('outputs ask for different turns; the console can follow only the first');
    // The kernel line carries a connector only when there is a mode to name (a chosen
    // mode, or a virtual guest's fixed resolution). A rotation alone adds nothing here:
    // for 90 and 270 the DRM client can only hint fbcon, and fbcon=rotate: already
    // sets that and wins when both are given (fbcon.c, initial_rotation). The GOLE 2
    // Pro runs upright on exactly fbcon=rotate:1 plus plymouth=90 and bare video=efifb.
    const primaryOut = primary ? connected.find((o) => o.name === primary.output) : null;
    const wantPrimary = primaryOut ? (p.outputs[primaryOut.name] || p.outputs[ANY]) : null;
    const modeForKernel = wantPrimary ? (p.virtual.enabled ? p.virtual.resolution : wantPrimary.mode) : null;
    steps.push({
        layer: 'boot', action: 'rotation.cfg',
        plymouth: ply.degrees, fbcon: fb.value,
        video: primaryOut && modeForKernel
            ? { connector: primaryOut.name !== 'default' ? primaryOut.name : null, mode: modeForKernel, rotate: O.toCmdline(bootBase).rotate }
            : null,
        gfxpayload: p.virtual.enabled ? 'keep' : null,
    });
    if (steps[steps.length - 1].video && !steps[steps.length - 1].video.connector) {
        steps[steps.length - 1].video = null;
        notes.push('the display driver names no connector; the kernel line keeps video=efifb');
    }

    steps.push({ layer: 'session', action: 'screensaver', ...p.screensaver });
    steps.push({ layer: 'session', action: 'brightness', percent: p.brightness });
    if (p.virtual.enabled) steps.push({ layer: 'xorg', action: 'fixed-resolution', resolution: p.virtual.resolution });
    else steps.push({ layer: 'xorg', action: 'fixed-resolution-remove' });

    return { profile: p.name, mode: p.mode, steps, notes };
}

module.exports = { SCHEMA, ANY, defaults, defaultProfile, defaultOutput, validate, migrateFrom043, isLegacy, plan };
