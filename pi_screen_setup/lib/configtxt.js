'use strict';
// config.txt as the firmware reads it: lines, includes, and the conditional filters
// that decide which lines apply to a given board. Source: raspberrypi.com
// config_txt.html#conditional-filters (read 2026-11-02): filters of the same type
// replace each other, filters of different types combine (AND), [all] resets every
// type, [none] matches nothing, and `include` inserts the file's content in place —
// so a filter left open at the end of one file still governs the start of the next.

// A filter tag → { type, test(board) }. Unknown tags are a type of their own that never
// matches, so an unrecognised filter can hide lines but never apply them wrongly.
function classify(tag) {
    const t = tag.toLowerCase();
    if (t === 'all') return { type: 'all' };
    if (t === 'none') return { type: 'none', test: () => false };
    if (/^(pi[0-9]+\+?|pi0w|cm[0-9]+\+?|cm4s)$/.test(t)) return { type: 'model', test: (b) => b.filters.indexOf(t) !== -1 };
    let m;
    if ((m = t.match(/^board-type=(0x[0-9a-f]+|[0-9]+)$/))) {
        const want = parseInt(m[1], m[1].startsWith('0x') ? 16 : 10);
        return { type: 'model', test: (b) => b.type === want };
    }
    if ((m = t.match(/^0x([0-9a-f]{1,8})$/))) {
        const want = m[1].padStart(8, '0');
        return { type: 'serial', test: (b) => Boolean(b.serial) && b.serial.toLowerCase().padStart(8, '0') === want };
    }
    if ((m = t.match(/^edid=(.+)$/))) return { type: 'edid', test: (b) => Array.isArray(b.edid) && b.edid.indexOf(tag.slice(5)) !== -1 };
    if ((m = t.match(/^gpio(\d+)=([01])$/))) return { type: 'gpio' + m[1], test: (b) => Boolean(b.gpio) && String(b.gpio[m[1]]) === m[2] };
    if ((m = t.match(/^hdmi:([01])$/))) return { type: 'hdmi', test: () => true, port: Number(m[1]) };
    if (t === 'tryboot') return { type: 'tryboot', test: (b) => Boolean(b.tryboot) };
    if ((m = t.match(/^(boot_arg1|cust_otp[0-7]|bootvar0|boot_count|boot_partition|partition)(=|&|<|>)(.+)$/))) {
        return { type: 'expr:' + m[1], test: (b) => evalExpression(m[1], m[2], m[3], b) };
    }
    return { type: 'unknown:' + t, test: () => false };
}

function evalExpression(name, op, rest, board) {
    const vars = board.bootvars || {};
    if (!(name in vars)) return false;
    const v = vars[name] >>> 0;
    const num = (s) => parseInt(s, /^0x/i.test(s) ? 16 : 10) >>> 0;
    if (op === '=') return v === num(rest);
    if (op === '<') return v < num(rest);
    if (op === '>') return v > num(rest);
    const eq = rest.indexOf('=');
    if (eq === -1) return (v & num(rest)) !== 0;
    return (v & num(rest.slice(0, eq))) === num(rest.slice(eq + 1));
}

// Parse one file into entries. `files` maps a file name (as written after `include`)
// to its text; includes not present in the map are recorded and skipped.
function parse(text, name, files, seen) {
    files = files || {};
    seen = seen || new Set();
    const out = [];
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        if (!line || line.startsWith('#')) { out.push({ kind: 'blank', file: name, line: i + 1, raw }); continue; }
        let m;
        if ((m = line.match(/^\[(.+)\]$/))) { out.push({ kind: 'filter', file: name, line: i + 1, raw, tag: m[1].trim() }); continue; }
        if ((m = line.match(/^include\s+(\S+)$/i))) {
            const inc = m[1];
            out.push({ kind: 'include', file: name, line: i + 1, raw, target: inc, found: inc in files });
            if (inc in files && !seen.has(inc)) {
                seen.add(inc);
                out.push(...parse(files[inc], inc, files, seen));
            }
            continue;
        }
        if ((m = line.match(/^([A-Za-z_][\w.-]*)\s*=\s*(.*)$/))) { out.push({ kind: 'setting', file: name, line: i + 1, raw, key: m[1], value: m[2] }); continue; }
        if ((m = line.match(/^(initramfs|hdmi_cvt|hdmi_timings|dpi_timings)\s+(.+)$/))) { out.push({ kind: 'setting', file: name, line: i + 1, raw, key: m[1], value: m[2] }); continue; }
        out.push({ kind: 'other', file: name, line: i + 1, raw });
    }
    return out;
}

// Walk the entries with the firmware's filter semantics for `board` and mark each
// setting as applied or not. `board` carries filters[], type, serial, and optionally
// edid[], gpio{}, tryboot, bootvars{}.
function evaluate(entries, board) {
    let active = {}; // type → test
    const out = [];
    for (const e of entries) {
        if (e.kind === 'filter') {
            const f = classify(e.tag);
            if (f.type === 'all') active = {};
            else active[f.type] = f.test;
            out.push(Object.assign({}, e, { applies: appliesNow(active, board) }));
            continue;
        }
        if (e.kind === 'setting') { out.push(Object.assign({}, e, { applies: appliesNow(active, board) })); continue; }
        out.push(e);
    }
    return out;
}

function appliesNow(active, board) {
    return Object.keys(active).every((type) => active[type](board));
}

// The settings that apply, in order. For keys that take one value the last one wins;
// dtoverlay/dtparam/gpio/initramfs accumulate (the firmware applies each).
const ACCUMULATE = new Set(['dtoverlay', 'dtparam', 'gpio', 'device_tree_param', 'device_tree_overlay']);
function effective(entries, board) {
    const applied = evaluate(entries, board).filter((e) => e.kind === 'setting' && e.applies);
    const single = {};
    const multi = [];
    for (const e of applied) {
        if (ACCUMULATE.has(e.key)) multi.push({ key: e.key, value: e.value, file: e.file, line: e.line });
        else single[e.key] = { value: e.value, file: e.file, line: e.line };
    }
    return { applied, single, multi };
}

// What the effective configuration says about the display stack.
function displayState(eff) {
    const overlays = eff.multi.filter((m) => m.key === 'dtoverlay').map((m) => m.value);
    const kms = overlays.map((v) => v.match(/^(vc4-f?kms-v3d(?:-pi[45])?)(?:,(.*))?$/)).find(Boolean) || null;
    let cma = null;
    if (kms && kms[2]) {
        const c = kms[2].split(',').map((p) => p.match(/^cma-(\d+|default|size=(\d+))$/)).find(Boolean);
        if (c) cma = c[2] ? Math.round(parseInt(c[2], 10) / 1048576) : (c[1] === 'default' ? 'default' : parseInt(c[1], 10));
    }
    return {
        kmsOverlay: kms ? kms[1] : null,
        kmsParams: kms && kms[2] ? kms[2] : '',
        cmaMb: cma,
        overlays,
        displayAutoDetect: eff.single.display_auto_detect ? eff.single.display_auto_detect.value : null,
        hdmi: Object.keys(eff.single).filter((k) => k.startsWith('hdmi_')).reduce((o, k) => { o[k] = eff.single[k].value; return o; }, {}),
    };
}

// The filter tag that is open when a file ends — the state an `include` after it inherits.
function trailingFilters(entries) {
    let active = [];
    for (const e of entries) {
        if (e.kind !== 'filter') continue;
        const f = classify(e.tag);
        if (f.type === 'all') active = [];
        else { active = active.filter((a) => a.type !== f.type); active.push({ type: f.type, tag: e.tag }); }
    }
    return active.map((a) => a.tag);
}

module.exports = { classify, parse, evaluate, effective, displayState, trailingFilters };
