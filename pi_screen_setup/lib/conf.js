'use strict';
// The configuration file in the shape v-conf reads and writes.
//
// v-conf stores every value as { type, value } and nests namespaces as plain objects.
// A file in any other shape is read as "nothing": get() returns undefined for every key
// (never the default) and set() on an existing key is silently dropped. Volumio copies a
// plugin's config.json to /data/configuration verbatim, so the shipped file must already
// be in this shape, and files written by earlier releases of this plugin (raw JSON) have
// to be converted once, on load.

const TYPES = ['string', 'boolean', 'number', 'array'];

// Keys whose value is a document (array or object), stored as JSON text under type string.
const JSON_KEYS = ['migration_raw_lines', 'migration_parsed', 'migration_validation'];

function isLeaf(node) {
    return node !== null && typeof node === 'object' && !Array.isArray(node)
        && Object.prototype.hasOwnProperty.call(node, 'value')
        && TYPES.indexOf(node.type) !== -1;
}

function leaf(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return { type: 'string', value: JSON.stringify(value) };
    const t = typeof value;
    if (TYPES.indexOf(t) === -1) return { type: 'string', value: String(value) };
    return { type: t, value: value };
}

// Converts `data` in place to the v-conf shape and returns true when anything changed.
// Namespaces (plain objects) are walked; primitives, arrays and the JSON_KEYS documents
// become leaves; a bare { value } without a type (left by set() on a raw object) is
// re-typed from its value.
function normalize(data, keyPath) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
    let changed = false;
    Object.keys(data).forEach((key) => {
        const node = data[key];
        if (isLeaf(node)) return;
        if (JSON_KEYS.indexOf(key) !== -1 && !keyPath) {
            const doc = node !== null && typeof node === 'object' && !Array.isArray(node)
                && Object.prototype.hasOwnProperty.call(node, 'value') && !('type' in node) ? node.value : node;
            data[key] = { type: 'string', value: typeof doc === 'string' ? doc : JSON.stringify(doc === undefined || doc === null ? (key === 'migration_parsed' ? {} : []) : doc) };
            changed = true;
            return;
        }
        if (node === null || node === undefined) {
            delete data[key];
            changed = true;
            return;
        }
        if (typeof node !== 'object' || Array.isArray(node)) {
            data[key] = leaf(node);
            changed = true;
            return;
        }
        if (Object.prototype.hasOwnProperty.call(node, 'value') && !('type' in node) && Object.keys(node).length === 1) {
            const l = leaf(node.value);
            if (l) data[key] = l; else delete data[key];
            changed = true;
            return;
        }
        if (normalize(node, (keyPath || '') + key + '.')) changed = true;
    });
    return changed;
}

// True when every leaf of `data` is in the v-conf shape (the check.js gate for the shipped file).
function isNormalized(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
    return Object.keys(data).every((key) => {
        const node = data[key];
        if (isLeaf(node)) return true;
        if (node === null || typeof node !== 'object' || Array.isArray(node)) return false;
        if (Object.keys(node).length === 0) return false;
        return isNormalized(node);
    });
}

module.exports = { TYPES, JSON_KEYS, isLeaf, leaf, normalize, isNormalized };
