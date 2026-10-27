'use strict';
// Runtime check of the settings backup path with a stubbed Volumio: create, list, restore (valid and
// rejected), delete. Needs the dependencies installed (`npm install`), writes under BACKUP_DIR.
//   node test/backup.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpdoutput-'));
const toasts = [];
const strings = require('../i18n/strings_en.json').MPDOUTPUT;
const context = {
    coreCommand: {
        logger: { info() { }, warn() { }, error(m) { console.error('   log.error', m); } },
        getI18nString: (k) => (k.startsWith('MPDOUTPUT.') && strings[k.slice(10)]) || k,
        pushToastMessage: (type, title, text) => toasts.push({ type, text }),
        getUIConfigOnPlugin: () => ({ then: (f) => { f({}); return { fail() { } }; } }),
        broadcastMessage() { },
        pluginManager: { getConfigurationFile: () => path.join(tmp, 'config.json'), getPlugin: () => null },
        sharedVars: { get: () => 'en' },
    },
};

const MpdOutput = require('../index.js');
const plugin = new MpdOutput(context);
plugin.onVolumioStart();
plugin.saveAndApply = () => ({ then: (f) => { f(); return { fail() { } }; } }); // no MPD here
plugin.active = true;

// A configured plugin: both streams on.
plugin.applyHttp({ httpstream: true, servername: 'Study', encoder: { value: 'vorbis' }, bitrate: { value: '192' }, format: { value: '44100:16:2' }, portn: '8002', httpadd: false });
plugin.applyIce({
    icestream: true, iceservername: 'ice.example.org', icepublishport: '8000', icemountp: '/', iceuser: 'player', icepassword: 'secret',
    iceencoder: { value: 'lame' }, icebitrate: { value: '192' }, iceformat: { value: '44100:16:2' }, icestreamname: 'Chapel', icepublic: false, iceadd: true,
    icedescription: 'Music', icegenre: 'Spiritual', iceurl: '', icefeedport: '8010'
});

const last = () => toasts[toasts.length - 1];

plugin.createBackup({ backup_name: '../x' });
assert.strictEqual(last().type, 'error', 'path-ish name rejected');
plugin.createBackup({ backup_name: 'chapel 2026' });
assert.strictEqual(last().type, 'success', 'backup saved: ' + last().text);
const file = path.join('/data/INTERNAL/mpdoutput/backups', 'chapel 2026.json');
assert.ok(fs.existsSync(file), 'file written');
assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'owner-only');
const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.strictEqual(snap.schema_version, 1);
assert.strictEqual(snap.values.icemountp, '/');
assert.strictEqual(snap.values.icepublic, 'no');
assert.strictEqual(snap.values.icepassword, 'secret');

assert.deepStrictEqual(plugin.listBackups().map((b) => b.value), ['chapel 2026']);

// Change settings, restore, expect the snapshot back.
plugin.applyIce({ icestream: false });
plugin.applyHttp({ httpstream: false });
plugin.restoreBackup({ selected_backup: { value: 'chapel 2026' } });
assert.strictEqual(last().type, 'success', 'restored: ' + last().text);
assert.strictEqual(plugin.config.get('icestream'), true);
assert.strictEqual(plugin.config.get('httpstream'), true);
assert.strictEqual(plugin.config.get('iceuser'), 'player');
assert.strictEqual(plugin.config.get('portn'), '8002');

// A snapshot that breaks the rules (feed port equals HTTP port) is rejected, settings untouched.
const bad = JSON.parse(JSON.stringify(snap)); bad.values.icefeedport = '8002';
fs.writeFileSync(path.join('/data/INTERNAL/mpdoutput/backups', 'bad.json'), JSON.stringify(bad));
plugin.restoreBackup({ selected_backup: { value: 'bad' } });
assert.strictEqual(last().type, 'error', 'rejected');
assert.ok(last().text.includes(strings.ERR_PORTS_DIFFER), 'reason named: ' + last().text);
assert.strictEqual(plugin.config.get('icefeedport'), '8010', 'untouched');

// Not a snapshot at all.
fs.writeFileSync(path.join('/data/INTERNAL/mpdoutput/backups', 'junk.json'), '{"hello":1}');
plugin.restoreBackup({ selected_backup: { value: 'junk' } });
assert.strictEqual(last().text, strings.ERR_BACKUP_INVALID);
assert.deepStrictEqual(plugin.listBackups().map((b) => b.value).sort(), ['bad', 'chapel 2026'], 'junk not listed');

plugin.deleteBackup({ selected_backup_delete: { value: 'chapel 2026' } });
assert.strictEqual(last().type, 'success');
plugin.deleteBackup({ selected_backup_delete: { value: 'chapel 2026' } });
assert.strictEqual(last().text, strings.ERR_BACKUP_MISSING);

for (const f of ['bad.json', 'junk.json']) fs.unlinkSync(path.join('/data/INTERNAL/mpdoutput/backups', f));
console.log('backup.test: ok');
