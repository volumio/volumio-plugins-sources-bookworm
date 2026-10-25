'use strict';

var fs = require('fs');
var path = require('path');

var SYS_INPUT = '/sys/class/input';

function read(file) {
    try {
        return fs.readFileSync(file, 'utf8').trim();
    } catch (e) {
        return '';
    }
}

// A capability bitmap from sysfs: hex words, any of them non-zero.
function anyBit(text) {
    return String(text).trim().split(/\s+/).some(function (word) {
        return word !== '' && parseInt(word, 16) !== 0;
    });
}

function eventNumber(name) {
    return parseInt(name.slice(5), 10);
}

// Every input device with at least one key, as sysfs describes it, in event
// node order. `root` stands in for /sys/class/input in tests.
function list(root) {
    var base = root || SYS_INPUT;
    var names;

    try {
        names = fs.readdirSync(base);
    } catch (e) {
        return [];
    }

    return names
        .filter(function (name) {
            return /^event\d+$/.test(name);
        })
        .sort(function (a, b) {
            return eventNumber(a) - eventNumber(b);
        })
        .map(function (name) {
            var device = path.join(base, name, 'device');
            if (!anyBit(read(path.join(device, 'capabilities', 'key')))) {
                return null;
            }
            return {
                name: read(path.join(device, 'name')),
                phys: read(path.join(device, 'phys')),
                uniq: read(path.join(device, 'uniq')),
                path: '/dev/input/' + name,
                touch: anyBit(read(path.join(device, 'capabilities', 'abs')))
            };
        })
        .filter(Boolean);
}

module.exports = {
    SYS_INPUT: SYS_INPUT,
    list: list
};
