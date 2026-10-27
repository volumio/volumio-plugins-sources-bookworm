'use strict';
// Static checks for the plugin, run by `npm test`. Fails on the first class of error that
// would reach a user: unresolvable UI keys, a language missing keys or placeholders,
// a save button naming a field the section does not have.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const json = (f) => JSON.parse(read(f));
let failures = 0;
const fail = (msg) => { failures += 1; console.error('FAIL ' + msg); };

for (const f of ['index.js', 'relay/relay.js']) {
    try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); }
    catch (e) { fail(f + ': ' + e.stderr.toString().trim()); }
}
for (const f of ['package.json', 'config.json', 'UIConfig.json']) {
    try { json(f); if (!read(f).endsWith('\n')) fail(f + ': no final newline'); } catch (e) { fail(f + ': ' + e.message); }
}

// Plugin UI translation sees only the plugin's own dictionary: every TRANSLATE key must be MPDOUTPUT.<key>.
const ui = json('UIConfig.json');
const en = json('i18n/strings_en.json').MPDOUTPUT || {};
const walk = (o, where) => {
    if (typeof o === 'string') {
        if (o.startsWith('TRANSLATE.')) {
            const k = o.slice('TRANSLATE.'.length);
            if (!k.startsWith('MPDOUTPUT.') || !(k.slice('MPDOUTPUT.'.length) in en)) fail(where + ': unresolvable key ' + o);
        }
    } else if (o && typeof o === 'object') {
        Object.entries(o).forEach(([k, v]) => walk(v, where + '.' + k));
    }
};
walk(ui, 'UIConfig');
for (const s of ui.sections) {
    for (const id of (s.saveButton && s.saveButton.data) || []) {
        if (!s.content.find((c) => c.id === id)) fail(`UIConfig section ${s.id}: saveButton names missing field ${id}`);
    }
}

// Runtime strings used from index.js must exist too.
const idx = read('index.js');
for (const m of idx.matchAll(/(?:i18n|toast)\((?:'[a-z]+',\s*)?'([A-Z_]+)'/g)) {
    if (!(m[1] in en)) fail('index.js uses missing string ' + m[1]);
}

// Every language carries every English key with the same placeholders.
const placeholders = (s) => (String(s).match(/{{\w+}}/g) || []).sort().join(',');
for (const f of fs.readdirSync(path.join(root, 'i18n'))) {
    const b = json('i18n/' + f).MPDOUTPUT || {};
    for (const k of Object.keys(en)) {
        if (!(k in b)) fail(`${f}: missing ${k}`);
        else if (placeholders(en[k]) !== placeholders(b[k])) fail(`${f}: placeholders differ in ${k}`);
    }
    for (const k of Object.keys(b)) if (!(k in en)) fail(`${f}: extra key ${k}`);
    if (!read('i18n/' + f).endsWith('\n')) fail(f + ': no final newline');
}

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('check: ok');
