'use strict';
// The plugin's pure parts, with no dependency on the player: what the tests exercise
// and index.js uses. Nothing here reads a file or talks to the player.

const DEFAULT_PORT = 6218;

// A port as typed: an integer from 1024 to 65535.
function validatePort(value) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (!/^\d{1,5}$/.test(text)) return { ok: false };
    const n = parseInt(text, 10);
    if (n < 1024 || n > 65535) return { ok: false };
    return { ok: true, value: n };
}

// An address as typed: empty (the one found on the player is used), or a host name or
// an IP address, nothing with a space, a quote or a slash in it.
function validateAddress(value) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (text === '') return { ok: true, value: '' };
    if (!/^[A-Za-z0-9.\-:[\]]{1,253}$/.test(text)) return { ok: false };
    return { ok: true, value: text };
}

// The player's language as Volumio says it (its codes: en, de, ..., zh_TW), kept to
// the shape of one; English when it is not one. The core picks the catalogue.
function languageCode(value) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    return /^[a-z]{2,3}(_[A-Z]{2})?$/.test(text) ? text : 'en';
}

const MB_PUBLIC = 'https://musicbrainz.org';

// A MusicBrainz base URL as typed for a local mirror: http(s), host, optional port
// and path; trailing slashes and a trailing /ws/2 are dropped. Empty is refused.
function validateMbUrl(value) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (text === '') return { ok: false };
    let u;
    try { u = new URL(text); } catch (e) { return { ok: false }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
    if (u.username || u.password) return { ok: false };
    if (!u.hostname) return { ok: false };
    let base = u.origin + (u.pathname || '/');
    base = base.replace(/\/+$/, '');
    if (base.endsWith('/ws/2')) base = base.slice(0, -5);
    if (!base || base === 'http:' || base === 'https:') return { ok: false };
    return { ok: true, value: base };
}

// Where release lookups go: the public site, or the operator's mirror when the
// switch is on and the URL is one.
function mbEndpoint(mirror, url) {
    if (!mirror) return MB_PUBLIC;
    const checked = validateMbUrl(url);
    return checked.ok ? checked.value : null;
}

// The settings as the core reads them, from the configuration's values and the
// player's language.
function settingsFrom(get, language) {
    const port = validatePort(get('port', DEFAULT_PORT));
    const mirror = get('mb_mirror', false) === true;
    const url = validateMbUrl(get('mb_url', ''));
    return {
        port: port.ok ? port.value : DEFAULT_PORT,
        language: languageCode(language),
        mb_mirror: mirror,
        mb_url: mirror && url.ok ? url.value : ''
    };
}

// The IPv4 address browsers reach the player by: a wired interface first, else
// wireless, else any that is not loopback.
function lanAddress(interfaces) {
    const all = [];
    Object.keys(interfaces || {}).forEach((name) => {
        (interfaces[name] || []).forEach((a) => {
            if (!a || a.internal) return;
            const v4 = a.family === 'IPv4' || a.family === 4;
            if (v4 && a.address) all.push({ name, address: a.address });
        });
    });
    const by = (re) => all.find((a) => re.test(a.name));
    const pick = by(/^(eth|en|eno|ens|enp)/) || by(/^(wlan|wl)/) || all[0];
    return pick ? pick.address : null;
}

// The two ways onto the core's pages from the Volumio page. The UI opens an openUrl
// button in a new tab, always, and on the player's own display or in the app that tab
// has no way back; the one button type the UI navigates in place is the oauth one,
// which sets the window's location to its performer URL (two query parameters the
// page ignores). So "here" goes to Volumio's own iframe page holding the core's page,
// with the UI's arrow back; the page's address is the ui-router parameter, its slashes
// as ~2F. The address is the operator's when set, else the one found on the player.
function pageLinks(address, port, page) {
    const host = /:/.test(address) && !/^\[/.test(address) ? '[' + address + ']' : address;
    const url = 'http://' + host + ':' + String(port) + '/' + (page ? String(page).replace(/^\//, '') : '');
    return { url, here: 'http://' + host + '/iframe-page/' + url.replace(/\//g, '~2F') };
}

// The Avahi service group the plugin writes to /etc/avahi/services, so a browser or a
// phone that lists the network's services finds the pages: the player's host name in
// the name (Avahi fills %h), HTTP on the port, the path in the record.
function avahiService(port) {
    return [
        '<?xml version="1.0" standalone="no"?>',
        '<!DOCTYPE service-group SYSTEM "avahi-service.dtd">',
        '<service-group>',
        '  <name replace-wildcards="yes">MPDantic on %h</name>',
        '  <service>',
        '    <type>_http._tcp</type>',
        '    <port>' + String(port) + '</port>',
        '    <txt-record>path=/</txt-record>',
        '  </service>',
        '</service-group>',
        ''
    ].join('\n');
}

// The core's status as one line for a toast; t translates a key with its variables;
// the buffer line, when given, goes after the port.
function summarize(status, t, buffer) {
    if (!status || typeof status !== 'object') return t('STATUS_DOWN');
    const version = String(status.version || '?');
    if (status.state === 'error') return t('STATUS_ERROR', { version, error: String(status.error || '?') });
    return t('STATUS_UP', { version, port: String(status.port || '?'), buffer: buffer || '' });
}

// ------------------------------------------------------- the output buffer

const MIB = 1048576;

// The output buffer of MPD (max_output_buffer_size) sized to the player: MPD holds a
// client's pending reply in a buffer of at most that size and closes the client past
// it, which is how the album list of a large library comes up empty; the reply must
// then fit the backend, which holds it as one string and parses it. The rule and its
// constants, each measured or taken from Volumio's own values; see the README.
const BUFFER = {
    // Volumio's own template value; never below it, and at it nothing is appended.
    floorKib: 81920,
    // A reply of that size is a library no player holds.
    ceilingKib: 1048576,
    // Large replies in flight at once.
    concurrent: 2,
    // What a reply costs the backend's heap: four times retained (the string, two
    // bytes a character, and the parsed objects), twice more while it is flattened.
    nodeFactor: 6,
    // MPD's peak buffer holds the reply once.
    mpdFactor: 1,
    // The backend's heap at rest, with margin.
    heapBaseline: 128 * MIB,
    // Volumio, the kiosk browser, MPD, the core.
    memoryReserve: 512 * MIB,
    // The longest the album list may take the backend to take in: its client re-scans
    // its buffer on every chunk, so the time grows with the square of the reply, by
    // these seconds per MiB squared (measured on x86 and on a Pi 5; older Pis are
    // slower, and their heap bounds them first).
    seconds: 120,
    quadratic: { x64: 0.0073, arm: 0.016, arm64: 0.016 },
    // MPD takes the later of two top-level values since this version.
    mpdSince: [0, 21, 19]
};

// The marker every line the plugin appends to mpd.conf is under.
const MPD_MARKER = '# MPDantic: the output buffer';

// "Music Player Daemon 0.24.6 (b6f106b+)" as [0, 24, 6]; null when not read.
function parseMpdVersion(text) {
    const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || '0', 10)] : null;
}

function mpdOverrides(version) {
    if (!version) return false;
    const s = BUFFER.mpdSince;
    for (let i = 0; i < 3; i++) {
        if (version[i] > s[i]) return true;
        if (version[i] < s[i]) return false;
    }
    return true;
}

// The buffer the player gets, from what is read on it: the memory (bytes), the
// backend's heap limit (bytes), the architecture and MPD's version.
function bufferPlan(input) {
    const b = BUFFER;
    const memTotal = Number(input.memTotal) || 0;
    const heapLimit = Number(input.heapLimit) || 0;
    const arch = String(input.arch || '');
    const k = b.quadratic[arch] || b.quadratic.arm;
    const floorMib = b.floorKib / 1024;
    const ceilingMib = b.ceilingKib / 1024;
    const heapMib = Math.max(0, Math.floor((heapLimit - b.heapBaseline) / (b.concurrent * b.nodeFactor) / MIB));
    const memoryMib = Math.max(0, Math.floor((memTotal - b.memoryReserve) / (b.concurrent * (b.nodeFactor + b.mpdFactor)) / MIB));
    const timeMib = Math.floor(Math.sqrt(b.seconds / k));
    const bounds = { heap: heapMib, memory: memoryMib, time: timeMib };
    let limiting = 'heap';
    Object.keys(bounds).forEach((name) => { if (bounds[name] < bounds[limiting]) limiting = name; });
    const wanted = Math.min(ceilingMib, bounds[limiting]);
    const mib = Math.max(floorMib, wanted);
    const enabled = input.enabled !== false;
    const version = input.mpdVersion || null;
    const supported = mpdOverrides(version);
    const raised = mib > floorMib;
    let reason;
    if (!enabled) reason = 'off';
    else if (!version) reason = 'mpd_unknown';
    else if (!supported) reason = 'mpd_old';
    else reason = raised ? 'raised' : 'floor';
    return {
        enabled,
        supported,
        reason,
        raised,
        mib,
        kib: mib * 1024,
        floorMib,
        bounds,
        limiting,
        inputs: {
            memTotalGb: Math.round(memTotal / (1024 * MIB) * 10) / 10,
            heapLimitMib: Math.round(heapLimit / MIB),
            arch,
            mpdVersion: version ? version.join('.') : null
        }
    };
}

// What the hook appends to mpd.conf: the line under its marker when the buffer is
// raised, else nothing (the template's value stands).
function mpdConfigText(plan) {
    if (!plan || !plan.enabled || !plan.supported || !plan.raised) return '';
    return '\n' + MPD_MARKER + ' sized to this player: ' + plan.mib + ' MiB\n' +
        'max_output_buffer_size "' + plan.kib + '"\n';
}

// Whether mpd.conf carries what the hook would give now: the text when there is one,
// no marker when there is none.
function mpdConfCurrent(conf, text) {
    const current = String(conf || '');
    return text === '' ? !current.includes(MPD_MARKER) : current.includes(text);
}

// The plan as the core reads it for the player report, written beside the settings:
// the summary line, the figures, the rule's time constant for this architecture.
function bufferPlanFile(plan, line, when) {
    return JSON.stringify({
        line: String(line || ''),
        mib: plan.mib,
        floor_mib: plan.floorMib,
        raised: plan.raised,
        reason: plan.reason,
        limiting: plan.limiting,
        bounds: plan.bounds,
        inputs: plan.inputs,
        quadratic: BUFFER.quadratic[plan.inputs.arch] || BUFFER.quadratic.arm,
        when: Math.floor((when === undefined ? Date.now() : when) / 1000)
    }, null, 2) + '\n';
}

// The plan as one line for the settings page and the status toast; t translates.
function bufferSummary(plan, t) {
    const vars = {
        mib: String(plan.mib),
        floor: String(plan.floorMib),
        mem: String(plan.inputs.memTotalGb),
        heap: String(plan.inputs.heapLimitMib),
        version: String(plan.inputs.mpdVersion || '?'),
        limit: t('LIMIT_' + plan.limiting.toUpperCase())
    };
    return t('BUFFER_' + plan.reason.toUpperCase(), vars);
}

// Register this plugin's MPD config hook once on the MPD plugin's callback list.
function registerMpdHook(mpd, type, name) {
    if (!mpd || typeof mpd.registerConfigCallback !== 'function') return false;
    const list = Array.isArray(mpd.registeredCallbacks) ? mpd.registeredCallbacks : [];
    if (!list.some((c) => c && c.type === type && c.plugin === name)) {
        mpd.registerConfigCallback({ type: type, plugin: name, data: 'getMpdConfig' });
    }
    return true;
}

// Drop this plugin's hook from the list; the backend has no unregister of its own.
function unregisterMpdHook(mpd, type, name) {
    if (mpd && Array.isArray(mpd.registeredCallbacks)) {
        mpd.registeredCallbacks = mpd.registeredCallbacks.filter(
            (c) => !(c && c.type === type && c.plugin === name)
        );
    }
}

// How the announcement file is written: direct when the folder allows it, else sudo.
// writeFileSync and the error's code are injected so the shell path is tested without
// touching /etc/avahi.
function announceWrite(writeFileSync, text) {
    try {
        writeFileSync(text);
        return { via: 'direct' };
    } catch (e) {
        if (e && (e.code === 'EACCES' || e.code === 'EPERM')) return { via: 'sudo' };
        return { via: 'error', error: e };
    }
}

module.exports = {
    DEFAULT_PORT, MB_PUBLIC, validatePort, validateAddress, validateMbUrl, mbEndpoint, languageCode, settingsFrom, lanAddress, pageLinks, avahiService, summarize,
    BUFFER, MPD_MARKER, parseMpdVersion, mpdOverrides, bufferPlan, mpdConfigText, mpdConfCurrent, bufferSummary, bufferPlanFile,
    registerMpdHook, unregisterMpdHook, announceWrite
};
