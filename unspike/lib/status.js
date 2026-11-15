'use strict';

// What Unspike has to say about this player: whether its kernel is the one
// the plugin is for, and what became of the guard at this start. Everything
// here works on what it is given, so it can be tested without a player.

// The variable that has Node do without io_uring, and the value that does.
const VARIABLE = 'UV_USE_IO_URING';

// The 32-bit kernel of the Raspberry Pi 4 family: its name ends in -v7l+.
function affected(release) {
    return /-v7l\+$/.test(String(release || '').trim());
}

// The value a block of NAME=value lines gives the variable, or undefined.
// systemd lists its own environment a line each, and a unit's as one line
// of words after "Environment=".
function valueIn(text) {
    const words = String(text || '').split(/\s+/);
    for (const word of words) {
        const pair = word.replace(/^Environment=/, '');
        if (pair.indexOf(VARIABLE + '=') === 0) {
            return pair.slice(VARIABLE.length + 1);
        }
    }
    return undefined;
}

// How many of the names of a system's threads are io_uring's: the kernel
// names them iou-sqp-<pid> and iou-wrk-<pid>.
function uringThreads(names) {
    return String(names || '').split('\n').filter(function (name) {
        return name.trim().indexOf('iou-') === 0;
    }).length;
}

// The state of things, from what was read on the player:
//   release      the kernel's name (os.release())
//   manager      systemd's own environment (systemctl show-environment)
//   services     the environment of the player's services
//                (systemctl show -p Environment volumio.service wireless.service)
//   mark         whether the guard left its mark at this start
//   threads      the names of the system's threads (ps -eLo comm)
//
//   not_needed   another kernel: the plugin does nothing here
//   active       the guard set the variable at this start
//   system       the system sets the variable itself: the plugin does nothing
//   pending      the guard has not run yet: it does at the next start
function state(read) {
    const threads = uringThreads(read.threads);
    const release = String(read.release || '').trim();
    if (!affected(release)) {
        return { code: 'not_needed', kernel: release, threads: threads };
    }
    const manager = valueIn(read.manager);
    const services = valueIn(read.services);
    if (read.mark && manager !== undefined) {
        return { code: 'active', kernel: release, threads: threads };
    }
    if (manager !== undefined || services !== undefined) {
        return { code: 'system', kernel: release, threads: threads };
    }
    return { code: 'pending', kernel: release, threads: threads };
}

// The sentence for a state, from the page's own strings: one for each code,
// with {{kernel}} and {{threads}} where the values go.
function sentence(found, strings) {
    return String(strings[found.code] || '')
        .replace('{{kernel}}', found.kernel)
        .replace('{{threads}}', String(found.threads));
}

module.exports = { VARIABLE, affected, valueIn, uringThreads, state, sentence };
