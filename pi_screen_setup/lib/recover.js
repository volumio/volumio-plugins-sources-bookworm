'use strict';
// Reads the plugin's own output back: the videoconfig.txt that generateVideoConfig
// writes and the cmdline.txt that updateCmdline writes. Used when the boot files carry
// a configuration the settings file does not (a settings file reset or restored from an
// older backup, or one written by a release that could not persist anything), so the
// settings can be rebuilt from what is actually booting instead of being replaced by
// defaults.
//
// The parse is of the plugin's format only: section comments name the output, one
// dtoverlay/HDMI line per setting. Anything else is left in `unknown`.

const BANNER = '### pi_screen_setup managed - DO NOT EDIT ###';

const SECTION = /^# (HDMI0|HDMI1|DSI0|DSI1|DPI)( Custom)? Configuration$/;

function parseVideoconfig(text) {
    if (typeof text !== 'string' || text.indexOf(BANNER) === -1) return null;
    const out = {
        generated: null,
        model: null,
        migrated: false,
        baseline: false,
        kms: null,
        sections: {},
        headless: false,
        unknown: [],
    };
    let current = null;
    text.split(/\r?\n/).forEach((raw) => {
        const line = raw.trim();
        if (line === '' || line === BANNER || line === '[all]') return;
        let m;
        if ((m = line.match(/^# Generated: (.+)$/))) { out.generated = m[1].trim(); return; }
        if ((m = line.match(/^# Model: (.+)$/))) { out.model = m[1].trim(); return; }
        if (/^# Source: Migrated/.test(line)) { out.migrated = true; return; }
        if (/^# Baseline:/.test(line)) { out.baseline = true; return; }
        if (/^# KMS Display Driver/.test(line)) { current = 'KMS'; return; }
        if ((m = line.match(SECTION))) { current = m[1] + (m[2] ? ' Custom' : ''); out.sections[current] = out.sections[current] || []; return; }
        if (line === '# Composite Output Configuration') { current = 'Composite'; out.sections[current] = []; return; }
        if (line === '# Custom Overlay') { current = 'Custom Overlay'; out.sections[current] = []; return; }
        if (/^# Headless Mode/.test(line)) { out.headless = true; current = null; return; }
        if (/^# No vc4-kms-dsi panel dtoverlay line/.test(line)) { if (current && out.sections[current]) out.sections[current].noPanelOverlay = true; return; }
        if (line.charAt(0) === '#') return;
        if (current === 'KMS') {
            if ((m = line.match(/^dtoverlay=(vc4-[fk]?kms-v3d[^,\s]*)(?:,cma-(\d+))?$/))) {
                out.kms = { overlay: m[1], cmaMb: m[2] ? parseInt(m[2], 10) : null };
                return;
            }
        }
        if (current && out.sections[current]) { out.sections[current].push(line); return; }
        out.unknown.push(line);
    });
    return out;
}

// dtoverlay=<overlay>[,rotation=N][,params] as appendDsiPortLines writes it, where
// <overlay> is the preset's whole dtoverlay value and may itself carry parameters
// (vc4-kms-dsi-waveshare-panel,7_0_inchC). `known` lists the presets' values: the
// longest one the line starts with is the overlay, case-insensitively as the firmware
// reads file names; the rest is the rotation and the user's parameters. Without a match
// the overlay is the first token, as before.
function dsi(lines, known) {
    const result = { overlay: null, rotation: 0, params: '', noPanelOverlay: Boolean(lines && lines.noPanelOverlay) };
    const line = (lines || []).find((l) => l.startsWith('dtoverlay='));
    if (!line) return result;
    const value = line.slice('dtoverlay='.length);
    const lower = value.toLowerCase();
    let overlay = null;
    (known || []).forEach((k) => {
        if (typeof k !== 'string' || !k) return;
        const kl = k.toLowerCase();
        if ((lower === kl || lower.startsWith(kl + ',')) && (!overlay || k.length > overlay.length)) overlay = k;
    });
    let parts;
    if (overlay) {
        parts = value.slice(overlay.length).split(',');
        parts.shift();
    } else {
        parts = value.split(',');
        overlay = parts.shift();
    }
    result.overlay = overlay;
    if (parts.length && /^rotation=\d+$/.test(parts[0])) result.rotation = parseInt(parts.shift().split('=')[1], 10);
    result.params = parts.join(',');
    return result;
}

// First dtoverlay carries the preset's overlay with an optional trailing ,rotate=N; the
// following dtoverlay lines are the preset's dtoverlay_2..n; any other line is timing.
function dpi(lines) {
    const result = { overlays: [], rotation: 0, timing: [] };
    (lines || []).forEach((l) => {
        if (!l.startsWith('dtoverlay=')) { result.timing.push(l); return; }
        const parts = l.slice('dtoverlay='.length).split(',');
        if (result.overlays.length === 0 && parts.length > 1 && /^rotate=\d+$/.test(parts[parts.length - 1])) {
            result.rotation = parseInt(parts.pop().split('=')[1], 10);
        }
        result.overlays.push(parts.join(','));
    });
    return result;
}

function composite(lines) {
    const result = { mode: null, aspect: null };
    (lines || []).forEach((l) => {
        let m;
        if ((m = l.match(/^sdtv_mode=(\d+)$/))) result.mode = parseInt(m[1], 10);
        else if ((m = l.match(/^sdtv_aspect=(\d+)$/))) result.aspect = parseInt(m[1], 10);
    });
    return result;
}

// What generateHDMIConfig wrote for one port: the drive mode and the settings lines that
// parseExistingConfig understands (group, mode, cvt, timings, hotplug, edid, boost).
function hdmi(lines) {
    const result = { drive: null, lines: [], extra: [] };
    (lines || []).forEach((l) => {
        let m;
        if ((m = l.match(/^hdmi_drive(?::\d)?=(\d)$/))) { result.drive = parseInt(m[1], 10); return; }
        if (/^(hdmi_group|hdmi_mode|hdmi_cvt|hdmi_timings|hdmi_force_hotplug|hdmi_ignore_edid|config_hdmi_boost)(:\d)?=/.test(l)) { result.lines.push(l); return; }
        result.extra.push(l);
    });
    return result;
}

// video=CONNECTOR:[MODE][,rotate=N], plymouth=N and fbcon=rotate:K as updateCmdline writes them.
function cmdline(text) {
    const result = { video: null, plymouth: null, fbcon: null };
    if (typeof text !== 'string') return result;
    let m;
    if ((m = text.match(/(?:^|\s)video=([A-Za-z0-9-]+):([^\s,]*)(?:,rotate=(\d+))?/))) {
        result.video = { connector: m[1], mode: m[2] && !/^rotate=/.test(m[2]) ? m[2] : null, rotate: m[3] ? parseInt(m[3], 10) : (m[2] && /^rotate=(\d+)$/.test(m[2]) ? parseInt(m[2].split('=')[1], 10) : null) };
    }
    if ((m = text.match(/(?:^|\s)plymouth=(\d+)/))) result.plymouth = parseInt(m[1], 10);
    if ((m = text.match(/(?:^|\s)fbcon=rotate:([0-3])/))) result.fbcon = parseInt(m[1], 10);
    return result;
}

module.exports = { BANNER, parseVideoconfig, dsi, dpi, composite, hdmi, cmdline };
