'use strict';
// Builds the settings page from the template, the configuration and what was probed,
// and reads the page's saved data back into profile fields. Pure: the translation
// function is passed in, nothing here touches Volumio or the device.

const P = require('./profile');
const V = require('./virt');
const O = require('./orientation');
const S = require('./syslinux');

const NS = 'DISPLAY_CONFIGURATION';
const ORIENTATIONS = ['normal', 'right', 'inverted', 'left', 'normal+mirror', 'right+mirror', 'inverted+mirror', 'left+mirror'];
const PANEL_ORIENTATIONS = ['Normal', 'Upside Down', 'Left Side Up', 'Right Side Up'];
const SCREENSAVER_TYPES = ['dpms', 'xscreensaver', 'off'];
const PROFILE_ACTIONS = ['use', 'copy', 'rename', 'delete'];
const BACKUP_ACTIONS = ['create', 'restore', 'delete', 'reset'];

const slug = (name) => String(name).replace(/[^A-Za-z0-9]/g, '_');
const sel = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
const num = (v, dflt) => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : dflt; };
const bool = (v) => v === true || v === 'true';

function orientKey(o) { return 'ORIENT_' + o.toUpperCase().replace('+', '_'); }
function panelKey(p) { return 'PANEL_' + p.toUpperCase().replace(/ /g, '_'); }

function option(t, value, key, vars) { return { value, label: t(key, vars) }; }
function selectField(id, label, doc, value, options) {
    const chosen = options.find((o) => o.value === value) || options[0];
    const f = { id, element: 'select', label, value: chosen, options };
    if (doc) f.doc = doc;
    return f;
}
function numberField(id, label, doc, value, attrs) {
    const f = { id, element: 'input', type: 'number', label, value, attributes: [{ placeholder: String(value) }, { maxlength: 6 }].concat(attrs || []) };
    if (doc) f.doc = doc;
    return f;
}
function switchField(id, label, doc, value) { const f = { id, element: 'switch', label, value: Boolean(value) }; if (doc) f.doc = doc; return f; }
function button(t, id, key, method, endpoint, docKey) {
    const b = { id, element: 'button', label: t(key), onClick: { type: 'plugin', endpoint, method, data: [] } };
    if (docKey) b.doc = t(docKey);
    return b;
}
function section(id, label, icon, description, method, endpoint, content, saveKey, t) {
    const s = { id, element: 'section', label, icon, content };
    if (description) s.description = description;
    if (method) {
        s.onSave = { type: 'controller', endpoint, method };
        s.saveButton = { label: t(saveKey || 'SAVE_APPLY'), data: content.filter((c) => c.element !== 'button').map((c) => c.id) };
    }
    return s;
}

function orientationOptions(t) { return ORIENTATIONS.map((o) => option(t, o, orientKey(o))); }
function turnOptions(t, withFollow) {
    const opts = ORIENTATIONS.slice(0, 4).map((o) => option(t, o, orientKey(o)));
    return withFollow ? [option(t, 'follow', 'FOLLOW_SCREEN')].concat(opts) : opts;
}

function modeOptions(t, out) {
    const seen = new Set();
    const opts = [];
    const pref = out.preferredMode || out.currentMode;
    opts.push(option(t, 'preferred', 'MODE_PREFERRED', { mode: pref ? pref.width + 'x' + pref.height : '-' }));
    for (const m of out.modes || []) {
        const name = m.width + 'x' + m.height;
        if (seen.has(name)) continue;
        seen.add(name);
        const rates = (out.modes || []).filter((x) => x.width === m.width && x.height === m.height && x.refreshHz).map((x) => Math.round(x.refreshHz));
        opts.push({ value: name, label: name + (rates.length ? ' (' + [...new Set(rates)].join('/') + ' Hz)' : '') });
    }
    return opts;
}

// ---------------------------------------------------------------- building

function statusText(t, cfg, probe) {
    const p = cfg.profiles[cfg.activeProfile];
    const parts = [t('STATUS_PROFILE', { name: p.name, mode: t(p.mode === 'follow' ? 'MODE_FOLLOW' : 'MODE_MANUAL') })];
    if (!probe || !probe.xAvailable) parts.push(t('STATUS_NO_X'));
    else {
        const outs = probe.outputs.filter((o) => o.connected);
        if (!outs.length) parts.push(t('STATUS_NO_SCREEN'));
        for (const o of outs) {
            const m = o.currentMode || o.preferredMode;
            let turn = 'normal';
            try { turn = O.toString(O.fromXrandr(o.rotation || 'normal', o.reflection || 'normal')); } catch (e) { turn = o.rotation || 'normal'; }
            parts.push(t('STATUS_SCREEN', { name: o.name, mode: m ? m.width + 'x' + m.height : '-', turn: t(orientKey(turn)), panel: o.panelOrientation || 'Normal' }));
        }
        const touch = (probe.inputs || []).filter((i) => i.kind === 'absolute');
        parts.push(touch.length ? t('STATUS_TOUCH', { names: touch.map((i) => i.name).join(', ') }) : t('STATUS_NO_TOUCH'));
    }
    if (probe && probe.virt && probe.virt.virtual) parts.push(t('STATUS_VIRTUAL', { hypervisor: probe.virt.hypervisor }));
    return parts.join(' ');
}

// Which boot path this player takes and whether the boot that is running already
// carries the configured turn; the plan is computed here because it is pure.
function bootStatus(t, cfg, probe) {
    if (!probe || !probe.bootloader) return [];
    const parts = [t(probe.bootloader === 'grub' ? 'BOOT_LOADER_GRUB' : probe.bootloader === 'syslinux' ? 'BOOT_LOADER_SYSLINUX' : 'BOOT_LOADER_NONE')];
    if (probe.bootloader === 'none') return parts;
    let step = null;
    try { step = P.plan(cfg, probe).steps.find((s) => s.action === 'rotation.cfg'); } catch (e) { step = null; }
    if (!step) return parts;
    parts.push(t(S.inEffect(probe.cmdline, { plymouth: step.plymouth, fbcon: step.fbcon, video: step.video || {} }) ? 'BOOT_IN_EFFECT' : 'BOOT_NOT_IN_EFFECT'));
    return parts;
}

function outputSection(t, endpoint, cfg, probe, out, multi) {
    const p = cfg.profiles[cfg.activeProfile];
    const want = p.outputs[out.name] || p.outputs[P.ANY] || P.defaultOutput();
    const id = slug(out.name);
    const f = (k) => id + '__' + k;
    const m = out.currentMode || out.preferredMode;
    const content = [
        switchField(f('enabled'), t('OUTPUT_ENABLED'), t('OUTPUT_ENABLED_DOC'), want.enabled),
        selectField(f('orientation'), t('ORIENTATION'), t('ORIENTATION_DOC'), want.orientation, orientationOptions(t)),
        selectField(f('panel'), t('PANEL_ORIENTATION'), t('PANEL_ORIENTATION_DOC', { reported: out.panelOrientation || t('PANEL_NOT_REPORTED') }), want.panelOrientation || 'auto',
            [option(t, 'auto', 'PANEL_AS_REPORTED')].concat(PANEL_ORIENTATIONS.map((po) => option(t, po, panelKey(po))))),
        selectField(f('mode'), t('MODE'), t('MODE_DOC'), want.mode || 'preferred', modeOptions(t, out)),
        switchField(f('fit'), t('FIT'), t('FIT_DOC'), Boolean(want.fit)),
        numberField(f('fit_w'), t('FIT_WIDTH'), t('FIT_WIDTH_DOC'), Math.round(((want.fit && want.fit.scaleX) || 1) * 100), [{ min: 50 }, { max: 150 }]),
        numberField(f('fit_h'), t('FIT_HEIGHT'), t('FIT_HEIGHT_DOC'), Math.round(((want.fit && want.fit.scaleY) || 1) * 100), [{ min: 50 }, { max: 150 }]),
        numberField(f('fit_x'), t('FIT_MOVE_X'), t('FIT_MOVE_DOC'), (want.fit && want.fit.offsetX) || 0, [{ min: -2000 }, { max: 2000 }]),
        numberField(f('fit_y'), t('FIT_MOVE_Y'), t('FIT_MOVE_DOC'), (want.fit && want.fit.offsetY) || 0, [{ min: -2000 }, { max: 2000 }]),
    ];
    if (out.properties && Object.prototype.hasOwnProperty.call(out.properties, 'underscan')) {
        content.push(numberField(f('underscan_h'), t('UNDERSCAN_H'), t('UNDERSCAN_DOC'), (want.underscan && want.underscan.hborder) || 0, [{ min: 0 }, { max: 500 }]));
        content.push(numberField(f('underscan_v'), t('UNDERSCAN_V'), t('UNDERSCAN_DOC'), (want.underscan && want.underscan.vborder) || 0, [{ min: 0 }, { max: 500 }]));
    }
    if (multi) {
        content.push(numberField(f('pos_x'), t('POSITION_X'), t('POSITION_DOC'), want.position ? want.position.x : (out.geometry ? out.geometry.x : 0), [{ min: 0 }, { max: 16384 }]));
        content.push(numberField(f('pos_y'), t('POSITION_Y'), t('POSITION_DOC'), want.position ? want.position.y : (out.geometry ? out.geometry.y : 0), [{ min: 0 }, { max: 16384 }]));
    }
    const desc = [t('OUTPUT_DESC', { mode: m ? m.width + 'x' + m.height : '-', panel: out.panelOrientation || t('PANEL_NOT_REPORTED') })];
    if (out.rotationsSupported.length <= 1) desc.push(t('OUTPUT_NO_ROTATION'));
    return section('output_' + id, t('OUTPUT_SECTION', { name: out.name }), 'fa-desktop', desc.join(' '), 'saveOutput', endpoint, content, null, t);
}

function inputsContent(t, cfg, probe, outputs) {
    const p = cfg.profiles[cfg.activeProfile];
    const content = [];
    for (const dev of probe.inputs || []) {
        if (dev.kind !== 'absolute' && dev.kind !== 'relative' && dev.kind !== 'pointer') continue;
        const specific = p.inputs[dev.name];
        const generic = dev.kind === 'relative' ? (p.inputs['relative:*'] || { offset: 'normal', output: null }) : (p.inputs[P.ANY] || { offset: 'normal', output: null });
        const want = specific || generic;
        const id = 'input_' + dev.id;
        const kindKey = dev.kind === 'absolute' ? 'INPUT_KIND_TOUCH' : 'INPUT_KIND_POINTER';
        content.push(selectField(id + '__offset', t('INPUT_OFFSET', { name: dev.name, kind: t(kindKey) }), t('INPUT_OFFSET_DOC'), want.offset, orientationOptions(t)));
        if (outputs.length > 1) {
            content.push(selectField(id + '__output', t('INPUT_OUTPUT', { name: dev.name }), t('INPUT_OUTPUT_DOC'), want.output || 'first',
                [option(t, 'first', 'INPUT_OUTPUT_FIRST')].concat(outputs.map((o) => ({ value: o.name, label: o.name })))));
        }
    }
    return content;
}

// template: the parsed, already translated UIConfig.json. Static sections keep their
// place; one section per connected screen is inserted after the profile section.
function build(template, { cfg, probe, backups, t, endpoint, tools }) {
    const ui = JSON.parse(JSON.stringify(template));
    const p = cfg.profiles[cfg.activeProfile];
    const byId = (id) => ui.sections.find((s) => s.id === id);
    const field = (s, id) => s.content.find((c) => c.id === id);
    const setSelect = (s, id, value) => { const f = field(s, id); if (f) f.value = f.options.find((o) => o.value === value) || f.options[0]; };
    const setValue = (s, id, value) => { const f = field(s, id); if (f) f.value = value; };
    const setOptions = (s, id, options, value) => { const f = field(s, id); if (f) { f.options = options; f.value = options.find((o) => o.value === value) || options[0]; } };

    const profiles = byId('profiles');
    profiles.description = statusText(t, cfg, probe);
    const names = Object.keys(cfg.profiles).sort();
    setOptions(profiles, 'active_profile', names.map((n) => ({ value: n, label: n })), cfg.activeProfile);
    setSelect(profiles, 'profile_action', 'use');
    setSelect(profiles, 'profile_mode', p.mode);
    setValue(profiles, 'profile_name', '');

    const connected = probe && probe.xAvailable ? probe.outputs.filter((o) => o.connected) : [];
    const at = ui.sections.indexOf(profiles) + 1;
    const outputSections = connected.map((o) => outputSection(t, endpoint, cfg, probe, o, connected.length > 1));
    if (!outputSections.length) {
        outputSections.push({ id: 'output_none', element: 'section', label: t('OUTPUT_SECTION', { name: '-' }), icon: 'fa-desktop', description: t(probe && probe.xAvailable ? 'STATUS_NO_SCREEN' : 'STATUS_NO_X'), content: [] });
    }
    ui.sections.splice(at, 0, ...outputSections);

    const inputs = byId('inputs');
    inputs.content = inputsContent(t, cfg, probe || {}, connected);
    if (!inputs.content.length) { inputs.description = t('INPUTS_NONE'); delete inputs.onSave; delete inputs.saveButton; }
    else inputs.saveButton.data = inputs.content.map((c) => c.id);

    const boot = byId('boot');
    setSelect(boot, 'console', p.boot.console);
    setSelect(boot, 'splash', p.boot.splash);
    boot.description = [boot.description].concat(bootStatus(t, cfg, probe)).join(' ');

    const ss = byId('screensaver');
    setSelect(ss, 'screensaver_type', p.screensaver.type);
    setValue(ss, 'screensaver_timeout', p.screensaver.timeout);
    setValue(ss, 'not_while_playing', p.screensaver.notWhilePlaying);
    setValue(ss, 'hide_cursor', p.screensaver.hideCursor);
    setValue(ss, 'brightness', p.brightness);
    if (!(tools && tools.xscreensaver)) {
        ss.content = ss.content.filter((c) => c.id !== 'xscreensaver_settings');
        const type = field(ss, 'screensaver_type');
        type.options = type.options.filter((o) => o.value !== 'xscreensaver');
        if (type.value.value === 'xscreensaver') type.value = type.options[0];
    }
    ss.saveButton.data = ss.content.filter((c) => c.element !== 'button').map((c) => c.id);

    const virt = byId('virtual');
    setValue(virt, 'virtual_enabled', p.virtual.enabled);
    setOptions(virt, 'virtual_resolution', V.RESOLUTIONS.map((r) => ({ value: r, label: r })), p.virtual.resolution);
    virt.description = probe && probe.virt && probe.virt.virtual ? t('VIRTUAL_DETECTED', { hypervisor: probe.virt.hypervisor }) : t('VIRTUAL_NOT_DETECTED');

    const backup = byId('backup');
    const list = (backups || []).map((b) => ({ value: b.name, label: b.name + (b.created ? '  (' + String(b.created).slice(0, 16).replace('T', ' ') + ')' : '') }));
    setOptions(backup, 'selected_backup', list.length ? list : [{ value: '', label: t('BACKUP_NONE_YET') }], list.length ? list[0].value : '');
    setSelect(backup, 'backup_action', 'create');
    setValue(backup, 'backup_name', '');

    const maint = byId('maintenance');
    setValue(maint, 'debug', cfg.debug);
    return ui;
}

// ---------------------------------------------------------------- reading saved data

function readProfiles(data) {
    return { action: sel(data.profile_action) || 'use', profile: sel(data.active_profile), mode: sel(data.profile_mode) || 'manual', name: String(data.profile_name || '').trim() };
}

// One output's saved fields back into its profile entry; `name` is the connector.
function readOutput(data, name, out) {
    const id = slug(name);
    const g = (k) => data[id + '__' + k];
    if (g('orientation') === undefined) return null;
    const o = P.defaultOutput();
    o.enabled = bool(g('enabled'));
    o.orientation = sel(g('orientation'));
    const panel = sel(g('panel'));
    o.panelOrientation = panel && panel !== 'auto' ? panel : null;
    const mode = sel(g('mode'));
    o.mode = mode && mode !== 'preferred' ? mode : null;
    if (bool(g('fit'))) {
        o.fit = { scaleX: Math.round(num(g('fit_w'), 100)) / 100, scaleY: Math.round(num(g('fit_h'), 100)) / 100, offsetX: Math.round(num(g('fit_x'), 0)), offsetY: Math.round(num(g('fit_y'), 0)) };
    }
    if (g('underscan_h') !== undefined || g('underscan_v') !== undefined) {
        const h = Math.round(num(g('underscan_h'), 0)), v = Math.round(num(g('underscan_v'), 0));
        o.underscan = h || v ? { hborder: h, vborder: v } : null;
    }
    if (g('pos_x') !== undefined) o.position = { x: Math.round(num(g('pos_x'), 0)), y: Math.round(num(g('pos_y'), 0)) };
    else if (out && out.geometry && (out.geometry.x || out.geometry.y)) o.position = null;
    return o;
}

function readInputs(data, inputs) {
    const result = {};
    for (const dev of inputs || []) {
        const off = data['input_' + dev.id + '__offset'];
        if (off === undefined) continue;
        const outSel = sel(data['input_' + dev.id + '__output']);
        result[dev.name] = { offset: sel(off), output: outSel && outSel !== 'first' ? outSel : null };
    }
    return result;
}

function readBoot(data) { return { console: sel(data.console) || 'follow', splash: sel(data.splash) || 'follow' }; }

function readScreensaver(data) {
    return {
        screensaver: { type: sel(data.screensaver_type) || 'dpms', timeout: Math.round(num(data.screensaver_timeout, 120)), notWhilePlaying: bool(data.not_while_playing), hideCursor: bool(data.hide_cursor) },
        brightness: Math.round(num(data.brightness, 100)),
    };
}

function readVirtual(data) { return { enabled: bool(data.virtual_enabled), resolution: sel(data.virtual_resolution) || '1280x720' }; }

function readBackup(data) { return { action: sel(data.backup_action) || 'create', name: String(data.backup_name || '').trim(), selected: sel(data.selected_backup) || '' }; }

module.exports = { NS, ORIENTATIONS, PANEL_ORIENTATIONS, SCREENSAVER_TYPES, PROFILE_ACTIONS, BACKUP_ACTIONS, slug, sel, build, statusText, bootStatus, readProfiles, readOutput, readInputs, readBoot, readScreensaver, readVirtual, readBackup };
