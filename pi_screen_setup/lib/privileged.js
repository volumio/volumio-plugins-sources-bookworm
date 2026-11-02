'use strict';
// Writes to the boot partition and the clean exit, through the one root helper
// (plugin/scripts/pi-screen-setup-root.sh, installed by install.sh as
// /usr/local/bin/pi-screen-setup-root and named alone in sudoers). Arguments go as a
// vector and the file content on stdin; no shell strings, no paths from the caller.
//
// `sudo` is the production path. `direct(root)` runs the same script from the plugin
// folder, unprivileged, against a relocated root (PSS_ROOT): the test suite exercises
// the helper itself, not a stand-in.

const path = require('path');
const { execFileSync } = require('child_process');

const HELPER = '/usr/local/bin/pi-screen-setup-root';
const SCRIPT = path.join(__dirname, '..', 'scripts', 'pi-screen-setup-root.sh');
const BOOT_NAMES = ['videoconfig', 'config', 'cmdline', 'volumioconfig', 'userconfig'];

function run(cmd, args, input, env) {
    return execFileSync(cmd, args, {
        input: input === undefined ? '' : input,
        env: env ? Object.assign({}, process.env, env) : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 20000,
        encoding: 'utf8',
    });
}

function make(invoke) {
    return {
        writeBoot(name, text) { return invoke(['write-boot', name], text); },
        removeBoot(name) { return invoke(['remove-boot', name]); },
        cleanExit() { return invoke(['clean-exit']); },
        installOverlay(name, bytes) { return invoke(['install-overlay', name], bytes); },
        removeOverlay(name) { return invoke(['remove-overlay', name]); },
        installEdid(name, bytes) { return invoke(['install-edid', name], bytes); },
        removeEdid(name) { return invoke(['remove-edid', name]); },
    };
}

const sudo = make((args, input) => run('sudo', ['-n', HELPER].concat(args), input));

function direct(root) {
    return make((args, input) => run('sh', [SCRIPT].concat(args), input, { PSS_ROOT: root || '' }));
}

// /boot/<name>.txt -> name, or null for a path the helper does not serve.
function bootName(filePath, bootDir) {
    const m = path.basename(filePath).match(/^([a-z]+)\.txt$/);
    if (!m || BOOT_NAMES.indexOf(m[1]) === -1) return null;
    if (bootDir && path.dirname(filePath) !== bootDir) return null;
    return m[1];
}

module.exports = { HELPER, SCRIPT, BOOT_NAMES, sudo, direct, bootName };
