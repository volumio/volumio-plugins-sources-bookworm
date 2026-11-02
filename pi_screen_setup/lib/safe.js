'use strict';
// Names and paths the preset editor's HTTP API accepts from a request.
const path = require('path');
const fs = require('fs');

// A backup is addressed by a bare JSON file name, never by a path.
function safeJsonName(name) {
    if (typeof name !== 'string' || path.basename(name) !== name) return null;
    return /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name) ? name : null;
}

const PRESET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function isPresetId(id) {
    return typeof id === 'string' && PRESET_ID_RE.test(id);
}

// Import from a local path is limited to user data and mounted media.
const IMPORT_ROOTS = ['/data', '/mnt', '/media', '/home/volumio'];
function resolveImportPath(p, roots, realpath) {
    roots = roots || IMPORT_ROOTS;
    realpath = realpath || fs.realpathSync;
    if (typeof p !== 'string' || !p.endsWith('.json')) return null;
    let real;
    try { real = realpath(p); } catch (e) { return null; }
    const allowed = roots.some((root) => real.indexOf(root + '/') === 0);
    return allowed ? real : null;
}

module.exports = { safeJsonName, isPresetId, resolveImportPath, IMPORT_ROOTS };
