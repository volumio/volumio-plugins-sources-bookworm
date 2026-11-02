'use strict';
// The display presets database: what a row may hold (schema 2, a superset of what
// releases before 1.0 read), how a name resolves to a row, and whether a row applies
// to this board and kernel.
//
// Schema 2 adds, all optional and ignored by older readers:
//   aliases          other product names for the same lines; unique across the database
//   provenance       where the lines come from: a URL, "vendor" (the vendor's lines, no stable
//                    page on record) or "community"
//   rotation_param   the overlay's own rotation parameter: "rotation", "rotate", or null
//   min_kernel       the first kernel that carries the overlay or token ("6.18.55")
//   boards           config.txt filter names the panel is for (["pi5", "cm5"])
//   requires_overlay overlay names that are not in the kernel; the plugin ships them
//                    as pss-<name>.dtbo (an entry without a shipped file is a note)
//   deprecated       kept for the users whose settings name it; superseded_by names the row to use
//   bus              "spi" for panels driven over SPI (experimental)
//   experimental     true: works in the field for some, not verified by the vendor
//   edid             name of a shipped EDID binary for a panel that reports none

const TYPES = ['hdmi', 'dsi', 'dpi', 'spi', 'composite'];
const BOARDS = ['pi0', 'pi0w', 'pi02', 'pi1', 'pi2', 'pi3', 'pi3+', 'pi4', 'pi400', 'pi5', 'pi500', 'cm1', 'cm3', 'cm3+', 'cm4', 'cm4s', 'cm5', 'cm0'];
const ROTATION_PARAMS = ['rotation', 'rotate'];
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isPresetKey(key) {
    return typeof key === 'string' && !key.startsWith('_comment');
}

function keys(db) {
    return Object.keys((db && db.presets) || {}).filter(isPresetKey);
}

function count(presets) {
    return Object.keys(presets || {}).filter(isPresetKey).length;
}

// Every alias in the database, lower-cased, mapped to its key.
function aliasIndex(presets) {
    const index = {};
    Object.keys(presets || {}).filter(isPresetKey).forEach((key) => {
        ((presets[key] && presets[key].aliases) || []).forEach((a) => { index[String(a).toLowerCase()] = key; });
    });
    return index;
}

// A key, or a name (key, preset name or alias, any case) -> the key, or null.
function resolve(presets, idOrName) {
    if (!presets || typeof idOrName !== 'string') return null;
    if (isPresetKey(idOrName) && presets[idOrName]) return idOrName;
    const wanted = idOrName.trim().toLowerCase();
    const byAlias = aliasIndex(presets)[wanted];
    if (byAlias) return byAlias;
    const byName = Object.keys(presets).filter(isPresetKey).find((k) => presets[k] && String(presets[k].name).toLowerCase() === wanted);
    return byName || null;
}

// Number of names a user can find: keys plus aliases.
function nameCount(presets) {
    return Object.keys(presets || {}).filter(isPresetKey).reduce((n, k) => n + 1 + (((presets[k] || {}).aliases || []).length), 0);
}

// Picker options for one type: the canonical name and every alias, each pointing at the
// key. `label(preset, alias)` renders an alias; the default reads "<alias> (as <name>)".
function options(presets, type, label) {
    const out = [];
    const types = Array.isArray(type) ? type : [type];
    const render = label || ((p, alias) => alias + ' (as ' + p.name + ')');
    Object.keys(presets || {}).filter(isPresetKey).forEach((key) => {
        const p = presets[key];
        if (!p || types.indexOf(p.type) === -1 || p.deprecated) return;
        out.push({ value: key, label: p.name });
        (p.aliases || []).forEach((alias) => out.push({ value: key, label: render(p, alias) }));
    });
    return out;
}

// "6.12.75-v8+" vs "6.18.55": numeric part by part.
function compareKernel(a, b) {
    const pa = String(a || '').match(/\d+/g) || [];
    const pb = String(b || '').match(/\d+/g) || [];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = parseInt(pa[i] || '0', 10);
        const y = parseInt(pb[i] || '0', 10);
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

// Whether `preset` can be used here. `ctx`: { kernel: uname -r, boardFilters: [...] from
// lib/board, shippedOverlays: Set of the vendor overlay names the plugin ships, lower
// case (lib/overlays names()); overlay file names are matched as the firmware matches
// them on the boot partition, without regard to case }.
// Never refuses outright: the notes tell the user what is missing.
function applicable(preset, ctx) {
    const notes = [];
    ctx = ctx || {};
    if (!preset) return { ok: false, notes: [{ code: 'UNKNOWN' }] };
    if (preset.deprecated) notes.push({ code: 'DEPRECATED', detail: preset.superseded_by || '' });
    if (preset.experimental) notes.push({ code: 'EXPERIMENTAL' });
    if (preset.min_kernel && ctx.kernel && compareKernel(ctx.kernel, preset.min_kernel) < 0) notes.push({ code: 'MIN_KERNEL', detail: preset.min_kernel, running: ctx.kernel });
    if (Array.isArray(preset.boards) && preset.boards.length && Array.isArray(ctx.boardFilters) && ctx.boardFilters.length
        && !preset.boards.some((b) => ctx.boardFilters.indexOf(b) !== -1)) notes.push({ code: 'BOARD', detail: preset.boards.join(', ') });
    (preset.requires_overlay || []).forEach((name) => {
        if (!ctx.shippedOverlays || !ctx.shippedOverlays.has(String(name).toLowerCase())) notes.push({ code: 'NEEDS_OVERLAY', detail: name });
    });
    const blocking = notes.some((n) => n.code === 'MIN_KERNEL' || n.code === 'BOARD' || n.code === 'NEEDS_OVERLAY');
    return { ok: !blocking, notes };
}

// The rotation parameter the generator may append to the overlay line, if any.
function rotationParam(preset) {
    if (!preset) return null;
    if (preset.rotation_param === 'rotation' || preset.rotation_param === 'rotate') return preset.rotation_param;
    if (preset.rotation_param === null) return null;
    // Rows from before schema 2: the boolean said "the overlay takes rotation="; DPI rows took rotate=.
    if (preset.overlay_rotation_param === true) return 'rotation';
    if (preset.type === 'dpi' && preset.overlay_rotation_param === undefined) return 'rotate';
    return null;
}

// One row against the schema; `tokens` (test/overlay-tokens.json .overlays) is optional and
// enables the kernel checks. Returns the list of problems, empty when the row is sound.
function validateOne(key, p, tokens, allKeys) {
    const errors = [];
    const at = (m) => errors.push('presets.' + key + ': ' + m);
    if (!KEY.test(key)) at('key not in [A-Za-z0-9._-]');
    if (!p || typeof p !== 'object') { at('not an object'); return errors; }
    if (typeof p.name !== 'string' || !p.name.trim()) at('no name');
    if (TYPES.indexOf(p.type) === -1) at('type ' + p.type);
    if (!p.config || typeof p.config !== 'object') at('no config object');
    ['vc4_kms', 'emit_dsi_overlay', 'overlay_rotation_param', 'deprecated', 'experimental'].forEach((k) => {
        if (k in p && typeof p[k] !== 'boolean') at(k + ' must be boolean');
    });
    ['aliases', 'boards', 'requires_overlay'].forEach((k) => {
        if (k in p && (!Array.isArray(p[k]) || p[k].some((x) => typeof x !== 'string' || !x.trim()))) at(k + ' must be an array of strings');
    });
    if ('provenance' in p && (typeof p.provenance !== 'string' || !(/^https?:\/\//.test(p.provenance) || p.provenance === 'vendor' || p.provenance === 'community'))) at('provenance must be a URL, "vendor" or "community"');
    if ('rotation_param' in p && p.rotation_param !== null && ROTATION_PARAMS.indexOf(p.rotation_param) === -1) at('rotation_param must be rotation, rotate or null');
    if ('min_kernel' in p && !/^\d+\.\d+(\.\d+)?$/.test(String(p.min_kernel))) at('min_kernel must be X.Y[.Z]');
    if (Array.isArray(p.boards)) p.boards.forEach((b) => { if (BOARDS.indexOf(b) === -1) at('boards: unknown ' + b); });
    if ('superseded_by' in p && (!allKeys || allKeys.indexOf(p.superseded_by) === -1)) at('superseded_by names no preset');
    if (p.deprecated && !p.superseded_by) at('deprecated without superseded_by');
    if ('bus' in p && p.bus !== 'spi') at('bus must be spi');
    if ('edid' in p && !/^pss-[a-z0-9-]+$/.test(String(p.edid))) at('edid must be a pss- name');
    (p.requires_overlay || []).forEach((n) => { if (!/^[A-Za-z0-9_.-]+$/.test(n)) at('requires_overlay: bad name ' + n); });

    if (tokens && p.config && typeof p.config === 'object') {
        const required = p.requires_overlay || [];
        Object.keys(p.config).filter((k) => /^dtoverlay(_\d+)?$/.test(k)).forEach((k) => {
            const parts = String(p.config[k]).split(',');
            const base = parts.shift();
            if (tokens[base]) {
                parts.forEach((param) => {
                    const name = param.split('=')[0];
                    if (tokens[base].indexOf(name) === -1 && !(p.min_kernel && compareKernel(p.min_kernel, '6.12') > 0)) at(base + ' has no parameter ' + name + ' in the kernel');
                });
            } else if (required.indexOf(base) === -1) {
                at(base + ' is not in the kernel and not in requires_overlay');
            }
        });
        const main = p.config.dtoverlay ? String(p.config.dtoverlay).split(',')[0] : null;
        const rp = rotationParam(p);
        if (rp && main && tokens[main] && tokens[main].indexOf(rp) === -1 && !(p.min_kernel && compareKernel(p.min_kernel, '6.12') > 0)) at('rotation_param ' + rp + ' but ' + main + ' has no such parameter');
    }
    return errors;
}

// The whole database: every row, plus alias uniqueness across keys and aliases.
function validate(db, tokens) {
    const errors = [];
    if (!db || typeof db !== 'object') return ['database: not an object'];
    if (!/^\d+\.\d+\.\d+$/.test(String(db.version))) errors.push('database: version ' + db.version + ' is not X.Y.Z');
    if (!db.presets || typeof db.presets !== 'object') return errors.concat('database: no presets object');
    const all = keys(db);
    const seen = {};
    all.forEach((k) => { seen[k.toLowerCase()] = 'key ' + k; });
    Object.keys(db.presets).forEach((k) => {
        if (!isPresetKey(k)) { if (typeof db.presets[k] !== 'string') errors.push('presets.' + k + ': a _comment entry must be a string'); return; }
        errors.push.apply(errors, validateOne(k, db.presets[k], tokens, all));
        (db.presets[k] && db.presets[k].aliases || []).forEach((a) => {
            const low = String(a).toLowerCase();
            if (seen[low]) errors.push('presets.' + k + ': alias "' + a + '" collides with ' + seen[low]);
            else seen[low] = 'alias of ' + k;
        });
    });
    return errors;
}

module.exports = { TYPES, BOARDS, isPresetKey, keys, count, nameCount, aliasIndex, resolve, options, compareKernel, applicable, rotationParam, validateOne, validate };
