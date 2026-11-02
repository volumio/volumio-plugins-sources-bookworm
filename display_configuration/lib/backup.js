'use strict';
// Named backups of the whole configuration under /data/INTERNAL, outside the plugin
// folder and its config.json, so they survive uninstall and reinstall. Each is the
// validated config plus a little provenance. Reading one back goes through
// profile.validate before anything is applied.

const fs = require('fs');
const path = require('path');
const P = require('./profile');

const DIR = '/data/INTERNAL/display_configuration/backups';
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;

function createStore({ dir = DIR, fsys = fs, now = () => new Date() } = {}) {
    function fileOf(name) {
        if (!NAME.test(name)) throw new RangeError('backup name must be 1 to 40 characters of letters, digits, space, dot, underscore or dash');
        return path.join(dir, name + '.json');
    }

    function list() {
        let names;
        try { names = fsys.readdirSync(dir); } catch (e) { return []; }
        const out = [];
        for (const f of names) {
            if (!f.endsWith('.json')) continue;
            const name = f.slice(0, -5);
            if (!NAME.test(name)) continue;
            let meta = null;
            try { meta = JSON.parse(fsys.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
            out.push({ name, created: meta && meta.created || null, pluginVersion: meta && meta.pluginVersion || null, activeProfile: meta && meta.config && meta.config.activeProfile || null });
        }
        return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    }

    function write(name, cfg, { pluginVersion = null, hostname = null } = {}) {
        const file = fileOf(name);
        const body = { kind: 'display_configuration.backup', schema: P.SCHEMA, created: now().toISOString(), pluginVersion, hostname, config: P.validate(cfg) };
        fsys.mkdirSync(dir, { recursive: true });
        const tmp = path.join(dir, '.' + name + '.' + process.pid + '.tmp');
        fsys.writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n', { mode: 0o644 });
        fsys.renameSync(tmp, file);
        return body;
    }

    function read(name) {
        const text = fsys.readFileSync(fileOf(name), 'utf8');
        const body = JSON.parse(text);
        if (!body || body.kind !== 'display_configuration.backup' || typeof body.config !== 'object') throw new RangeError('not a Display Configuration backup');
        return { created: body.created || null, pluginVersion: body.pluginVersion || null, hostname: body.hostname || null, config: P.validate(body.config) };
    }

    function remove(name) { fsys.unlinkSync(fileOf(name)); }

    // The default name when the user leaves the field empty: the date, to the minute.
    function suggestName() {
        const d = now();
        const pad = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes());
    }

    return { list, write, read, remove, suggestName, dir };
}

module.exports = { createStore, DIR, NAME };
