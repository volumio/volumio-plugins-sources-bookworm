'use strict';
// What the running system says about the display stack, independent of any text in
// the boot files: the overlays the firmware applied, the DRM connectors the kernel
// has, the CMA in use, the kernel command line. And the diagnostics report built
// from those plus the boot files as found and as they evaluate for this board.
const fs = require('fs');
const path = require('path');
const configtxt = require('./configtxt');
const cma = require('./cma');

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function listDir(p) { try { return fs.readdirSync(p); } catch (e) { return null; } }

// /proc/device-tree/chosen/overlays holds one node per overlay the firmware applied,
// named as in config.txt (without parameters). Not every firmware writes it: the Pi 5
// bench (firmware 2026-09-25, kernel 6.12.75) has no such node although KMS is up, so
// this is informative only; kmsBound() is the truth for the driver.
function appliedOverlays(root) {
    const names = listDir((root || '') + '/proc/device-tree/chosen/overlays');
    if (!names) return null;
    return names.filter((n) => n !== 'name' && n !== 'phandle' && !n.startsWith('#'));
}

// Whether the KMS driver is up: the vc4 module is loaded, or the vc4-drm platform driver
// has a device bound (/sys/bus/platform/drivers/vc4-drm/<device>), or DRM connectors
// exist. null when none of the three trees is readable.
function kmsBound(root, connectors) {
    root = root || '';
    const mod = listDir(root + '/sys/module/vc4');
    const drv = listDir(root + '/sys/bus/platform/drivers/vc4-drm');
    if (mod === null && drv === null && connectors === null) return null;
    if (mod !== null) return true;
    if (drv && drv.some((n) => !['bind', 'unbind', 'uevent', 'module'].includes(n))) return true;
    return Boolean(connectors && connectors.length);
}

// /sys/class/drm/card<N>-<CONNECTOR>: status, whether it is driving a mode, its modes.
function drmConnectors(root) {
    const base = (root || '') + '/sys/class/drm';
    const entries = listDir(base);
    if (!entries) return null;
    return entries
        .filter((n) => /^card\d+-/.test(n))
        .map((n) => {
            const dir = path.join(base, n);
            const modes = (readText(path.join(dir, 'modes')) || '').split('\n').filter(Boolean);
            return {
                name: n.replace(/^card\d+-/, ''),
                card: n.split('-')[0],
                status: (readText(path.join(dir, 'status')) || 'unknown').trim(),
                enabled: (readText(path.join(dir, 'enabled')) || 'unknown').trim(),
                modes,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

function kernelCmdline(root) {
    const t = readText((root || '') + '/proc/cmdline');
    return t ? t.trim() : null;
}

function cmaInUseMb(root) {
    return cma.appliedMb(readText((root || '') + '/proc/meminfo'));
}

// Compare what the plugin wrote with what the system shows. Each finding is a short
// code the UI can translate, with the two sides for the report.
function findings(expected, actual) {
    const out = [];
    if (expected.kmsOverlay) {
        if (actual.kmsBound === null) out.push({ code: 'KMS_STATE_UNREADABLE' });
        else if (actual.kmsBound === false) out.push({ code: 'KMS_NOT_APPLIED', expected: expected.kmsOverlay, actual: actual.overlays ? (actual.overlays.join(', ') || '(no overlays)') : 'no vc4 driver' });
    } else if (actual.kmsBound === true) {
        out.push({ code: 'KMS_UNEXPECTED', expected: '(none)', actual: 'vc4 driver bound' });
    }
    if (expected.kmsOverlay && expected.cmaMb !== null && expected.cmaMb !== undefined && actual.cmaMb !== null && actual.cmaMb !== expected.cmaMb) {
        out.push({ code: 'CMA_DIFFERS', expected: expected.cmaMb + ' MB', actual: actual.cmaMb + ' MB' });
    }
    if (expected.connector && actual.connectors) {
        const c = actual.connectors.find((x) => x.name === expected.connector);
        if (!c) out.push({ code: 'CONNECTOR_MISSING', expected: expected.connector, actual: actual.connectors.map((x) => x.name).join(', ') || '(none)' });
        else if (c.status !== 'connected') out.push({ code: 'CONNECTOR_NOT_CONNECTED', expected: expected.connector + ' connected', actual: c.status });
    }
    return out;
}

// The text report. `input` carries everything already read by the caller so this is
// pure: { board, system, bootFiles: {name: text|null}, includes: {name: text}, expected,
// actual, pluginState, dmesg, pluginLog }.
function report(input) {
    const L = [];
    const h = (t) => { L.push('', '== ' + t + ' =='); };
    const b = input.board;
    L.push('pi_screen_setup diagnostics ' + new Date().toISOString());
    L.push('plugin ' + (input.pluginVersion || '?') + ', database ' + (input.dbVersion || '?'));
    h('Board');
    if (b) {
        L.push((input.system && input.system.model) || b.name);
        L.push('revision 0x' + b.code.toString(16) + ': ' + b.name + ' rev ' + b.revision + ', ' + b.processor + ', ' + b.memoryMb + ' MB, ' + b.manufacturer);
        L.push('config.txt filters: ' + b.filters.map((f) => '[' + f + ']').join(' ') + (input.system && input.system.serial ? '  serial …' + input.system.serial.slice(-4) : ''));
        L.push('hdmi ' + b.hdmi + ', dsi ' + (b.dsi.join(',') || 'none') + ', composite ' + b.composite + ', kms ' + b.kms + (b.kmsOverlay ? ' (' + b.kmsOverlay + ')' : ''));
    } else {
        L.push('no Raspberry Pi revision code; model: ' + ((input.system && input.system.model) || 'unknown'));
    }
    if (input.system && input.system.compatible) L.push('compatible: ' + input.system.compatible.join(' '));
    h('Kernel');
    L.push('cmdline: ' + (input.actual.cmdline || '(unreadable)'));
    L.push('uname: ' + (input.uname || '?'));
    h('Boot files as found');
    for (const name of Object.keys(input.bootFiles)) {
        L.push('--- ' + name + ' ---');
        const t = input.bootFiles[name];
        L.push(t === null ? '(missing)' : t.replace(/\s+$/, ''));
    }
    h('Effective for this board (firmware filter rules)');
    if (input.effective) {
        const e = input.effective;
        L.push('kms overlay: ' + (e.kmsOverlay || '(none)') + (e.kmsParams ? ',' + e.kmsParams : '') + '  cma: ' + (e.cmaMb === null ? 'kernel default' : e.cmaMb + ' MB'));
        L.push('display_auto_detect: ' + (e.displayAutoDetect === null ? '(unset)' : e.displayAutoDetect));
        L.push('overlays: ' + (e.overlays.join(' | ') || '(none)'));
        const hk = Object.keys(e.hdmi);
        L.push('hdmi_*: ' + (hk.length ? hk.map((k) => k + '=' + e.hdmi[k]).join(' ') : '(none)'));
        if (input.trailingFilters && input.trailingFilters.length) L.push('WARNING volumioconfig.txt ends inside ' + input.trailingFilters.map((f) => '[' + f + ']').join('') + ' — the next include inherits it');
    }
    h('Applied by the firmware (/proc/device-tree/chosen/overlays)');
    L.push(input.actual.overlays === null ? '(node absent on this firmware)' : (input.actual.overlays.join(' ') || '(none)'));
    h('KMS driver');
    L.push(input.actual.kmsBound === null ? '(unreadable)' : (input.actual.kmsBound ? 'vc4 bound' : 'not bound'));
    h('DRM connectors (/sys/class/drm)');
    if (!input.actual.connectors) L.push('(unreadable)');
    else if (!input.actual.connectors.length) L.push('(none — no KMS driver bound)');
    else for (const c of input.actual.connectors) L.push(c.name + ': ' + c.status + ', enabled ' + c.enabled + (c.modes.length ? ', modes ' + c.modes.slice(0, 4).join(' ') + (c.modes.length > 4 ? ' …' : '') : ''));
    h('Memory');
    L.push('CMA in use: ' + (input.actual.cmaMb === null ? '(unreadable)' : input.actual.cmaMb + ' MB'));
    h('Plugin');
    for (const k of Object.keys(input.pluginState || {})) L.push(k + ': ' + JSON.stringify(input.pluginState[k]));
    const f = findings(input.expected || {}, input.actual);
    h('Findings');
    L.push(f.length ? f.map((x) => x.code + (x.expected !== undefined ? ' (expected ' + x.expected + ', found ' + x.actual + ')' : '')).join('\n') : 'none');
    if (input.dmesg) { h('dmesg (vc4, drm, dsi, dpi, cma, hdmi)'); L.push(input.dmesg.trim() || '(nothing)'); }
    if (input.pluginLog) { h('Plugin log (tail)'); L.push(input.pluginLog.trim()); }
    L.push('');
    return L.join('\n');
}

// Read everything from a live system for report(); `root` lets tests point at a tree.
function snapshot(root) {
    const connectors = drmConnectors(root);
    return {
        overlays: appliedOverlays(root),
        kmsBound: kmsBound(root, connectors),
        connectors,
        cmaMb: cmaInUseMb(root),
        cmdline: kernelCmdline(root),
    };
}

module.exports = { appliedOverlays, kmsBound, drmConnectors, kernelCmdline, cmaInUseMb, findings, report, snapshot, configtxt };
