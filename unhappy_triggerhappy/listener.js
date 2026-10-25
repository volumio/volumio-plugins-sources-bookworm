'use strict';

var stockMap = require('./stock-map');

// The unit as the sudoers file names it: the argument must match exactly.
var UNIT = 'unhappy-listener.service';
var SOCKET = '/tmp/unhappy-listener.sock';
var CONFIG_BASENAME = 'listener.json';

// Field: [least, most, default], in milliseconds. The listener refuses a
// configuration outside these, so they are held here too.
var TIMING = {
    long_ms: [100, 5000, 400],
    double_ms: [50, 2000, 300],
    debounce_ms: [0, 500, 30]
};

var PRESSES = ['short', 'long', 'double'];

// The shape of a kernel key name; the listener checks it against the table.
var KEY_NAME = /^(KEY|BTN)_[A-Z0-9_]+$/;

// The timing fields out of a form or a config, each within its range.
function timingFrom(source) {
    var out = {};
    Object.keys(TIMING).forEach(function (field) {
        var range = TIMING[field];
        var value = parseInt(source ? source[field] : undefined, 10);
        if (isNaN(value)) {
            value = range[2];
        }
        out[field] = Math.min(range[1], Math.max(range[0], value));
    });
    return out;
}

// A stored device: a name, as the listener matches it. A remote with several
// event nodes (keyboard, consumer control) has them all under one name, and
// taking the remote over means taking all of them.
function stored(name) {
    return { name: String(name), phys: '', uniq: '' };
}

function parseStored(text) {
    try {
        var value = JSON.parse(text);
        if (!Array.isArray(value)) {
            return [];
        }
        return value
            .filter(function (item) {
                return item && typeof item.name === 'string' && item.name !== '';
            })
            .map(function (item) {
                return stored(item.name);
            });
    } catch (e) {
        return [];
    }
}

// The rows the page shows: one per name among the present key devices that
// are not touchscreens, then the stored names that are not connected.
function rows(present, storedDevices) {
    var byName = [];
    var index = {};

    present.forEach(function (device) {
        if (device.touch || !device.name) {
            return;
        }
        if (index[device.name] === undefined) {
            index[device.name] = byName.length;
            byName.push({ name: device.name, paths: [], present: true, taken: false });
        }
        byName[index[device.name]].paths.push(device.path);
    });
    storedDevices.forEach(function (device) {
        if (index[device.name] !== undefined) {
            byName[index[device.name]].taken = true;
        } else {
            index[device.name] = byName.length;
            byName.push({ name: device.name, paths: [], present: false, taken: true });
        }
    });
    return byName;
}

// The names the switches on the page leave taken over.
function takenDevices(pageRows, data) {
    return pageRows
        .filter(function (row, i) {
            return data && data['take_' + i] === true;
        })
        .map(function (row) {
            return stored(row.name);
        });
}

// A command as the listener gets it: one line, single spaces. Empty when
// it spans lines or says nothing.
function normalizeCommand(command) {
    var text = String(command === undefined || command === null ? '' : command);
    if (text.indexOf('\n') !== -1 || text.indexOf('\r') !== -1) {
        return '';
    }
    return text.trim().replace(/\s+/g, ' ');
}

// A select comes back from the page as {value, label}; a config holds the value.
function selectValue(value) {
    if (value && typeof value === 'object') {
        return value.value;
    }
    return value;
}

function validBinding(binding) {
    return binding
        && typeof binding.key === 'string' && KEY_NAME.test(binding.key)
        && PRESSES.indexOf(binding.press) !== -1
        && typeof binding.command === 'string' && normalizeCommand(binding.command) !== '';
}

// The stored binding list; rows that do not hold up are left out.
function parseBindings(text) {
    try {
        var value = JSON.parse(text);
        if (!Array.isArray(value)) {
            return [];
        }
        return value
            .map(function (item) {
                return item && typeof item === 'object'
                    ? { key: item.key, press: item.press || 'short', command: item.command }
                    : null;
            })
            .filter(validBinding)
            .map(function (item) {
                return { key: item.key, press: item.press, command: normalizeCommand(item.command) };
            });
    } catch (e) {
        return [];
    }
}

// The editor's eight commands as short presses: what a remote taken over
// runs until its own list is written. Blank commands are left out.
function seedBindings(uiFields) {
    return stockMap.bindingsFromUi(uiFields)
        .map(function (row) {
            var command = normalizeCommand(row.command);
            return command ? { key: row.key, press: 'short', command: command } : null;
        })
        .filter(Boolean);
}

// The list after a save of the bindings page: each row edited or removed,
// then the new row if it names a key. Errors name the row; with any error
// the old list stands.
function bindingsFromForm(existing, data) {
    var out = [];
    var errors = [];
    var seen = {};
    var form = data || {};

    function take(key, press, command, where) {
        var binding = {
            key: String(key === undefined || key === null ? '' : key).trim(),
            press: String(selectValue(press) || 'short'),
            command: normalizeCommand(command)
        };
        if (!KEY_NAME.test(binding.key)) {
            errors.push(where + ': ' + (binding.key ? binding.key + ' is not a key name' : 'no key name'));
            return;
        }
        if (PRESSES.indexOf(binding.press) === -1) {
            errors.push(where + ': ' + binding.press + ' is not a press');
            return;
        }
        if (!binding.command) {
            errors.push(where + ': ' + binding.key + ' ' + binding.press + ' has no single-line command');
            return;
        }
        var pair = binding.key + ' ' + binding.press;
        if (seen[pair]) {
            errors.push(where + ': ' + pair + ' is bound twice');
            return;
        }
        seen[pair] = true;
        out.push(binding);
    }

    existing.forEach(function (binding, i) {
        var p = 'b' + i + '_';
        if (form[p + 'remove'] === true) {
            return;
        }
        take(
            form[p + 'key'] !== undefined ? form[p + 'key'] : binding.key,
            form[p + 'press'] !== undefined ? form[p + 'press'] : binding.press,
            form[p + 'command'] !== undefined ? form[p + 'command'] : binding.command,
            'row ' + (i + 1)
        );
    });

    var newKey = String(form.new_key === undefined || form.new_key === null ? '' : form.new_key).trim();
    if (newKey !== '' || normalizeCommand(form.new_command) !== '') {
        take(newKey, form.new_press, form.new_command, 'new binding');
    }

    return { bindings: errors.length ? existing : out, errors: errors };
}

// What the listener reads: the devices, the timing, and the bindings.
function configFor(devices, timing, bindings) {
    return {
        devices: devices.map(function (device) {
            return stored(device.name);
        }),
        timing: timingFrom(timing),
        bindings: bindings.filter(validBinding).map(function (binding) {
            return { key: binding.key, press: binding.press, command: normalizeCommand(binding.command) };
        })
    };
}

module.exports = {
    UNIT: UNIT,
    SOCKET: SOCKET,
    CONFIG_BASENAME: CONFIG_BASENAME,
    TIMING: TIMING,
    PRESSES: PRESSES,
    KEY_NAME: KEY_NAME,
    timingFrom: timingFrom,
    parseStored: parseStored,
    rows: rows,
    takenDevices: takenDevices,
    normalizeCommand: normalizeCommand,
    selectValue: selectValue,
    parseBindings: parseBindings,
    seedBindings: seedBindings,
    bindingsFromForm: bindingsFromForm,
    configFor: configFor
};
