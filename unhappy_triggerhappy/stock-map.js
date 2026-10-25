'use strict';

var path = require('path');

var VOLUMIO = '/usr/local/bin/volumio';

// Hanger /etc/triggerhappy/triggers.d/audio.conf command lines.
// Event value stays 1, which is the value in that file. This is not audio.conf.
var STOCK_BINDINGS = [
    { field: 'key_mute', key: 'KEY_MUTE', comment: 'MUTE TOGGLE', command: VOLUMIO + ' volume toggle' },
    { field: 'key_volumeup', key: 'KEY_VOLUMEUP', comment: 'VOLUME UP', command: VOLUMIO + ' volume plus' },
    { field: 'key_volumedown', key: 'KEY_VOLUMEDOWN', comment: 'VOLUME DOWN', command: VOLUMIO + ' volume minus' },
    { field: 'key_stop', key: 'KEY_STOP', comment: 'STOP', command: VOLUMIO + ' stop' },
    { field: 'key_play', key: 'KEY_PLAY', comment: 'START', command: VOLUMIO + ' play' },
    { field: 'key_playpause', key: 'KEY_PLAYPAUSE', comment: 'PLAY PAUSE TOGGLE', command: VOLUMIO + ' toggle' },
    { field: 'key_nextsong', key: 'KEY_NEXTSONG', comment: 'NEXT', command: VOLUMIO + ' next' },
    { field: 'key_previoussong', key: 'KEY_PREVIOUSSONG', comment: 'PREVIOUS', command: VOLUMIO + ' previous' }
];

var TRIGGERS_DIR = '/etc/triggerhappy/triggers.d';
var TRIGGERS_BASENAME = 'unhappy_triggerhappy.conf';
var TRIGGERS_FILE = path.join(TRIGGERS_DIR, TRIGGERS_BASENAME);

function bindingsFromUi(data) {
    return STOCK_BINDINGS.map(function (row) {
        var command = row.command;
        if (data && Object.prototype.hasOwnProperty.call(data, row.field) && data[row.field] !== undefined && data[row.field] !== null) {
            command = String(data[row.field]);
        }
        return {
            field: row.field,
            key: row.key,
            comment: row.comment,
            command: command
        };
    });
}

function normalizeCommand(command) {
    return String(command).replace(/\r/g, '').trim().replace(/\s+/g, ' ');
}

function bindingSignature(key, event, command) {
    return String(key) + ' ' + String(event) + ' ' + normalizeCommand(command);
}

// Parse triggerhappy lines. Comments and blanks are ignored.
function parseTriggerLines(text) {
    var out = [];
    var lines = String(text || '').split(/\n/);
    var i;

    for (i = 0; i < lines.length; i++) {
        var raw = lines[i].replace(/\r/g, '').trim();
        if (!raw || raw.charAt(0) === '#') {
            continue;
        }
        var parts = raw.split(/\s+/);
        if (parts.length < 3) {
            continue;
        }
        var key = parts[0];
        var event = parts[1];
        var command = parts.slice(2).join(' ');
        out.push({
            key: key,
            event: event,
            command: command,
            signature: bindingSignature(key, event, command)
        });
    }

    return out;
}

// Signatures already loaded from files this plugin did not write.
function foreignSignatures(texts) {
    var set = Object.create(null);
    var i;
    var j;
    var parsed;

    for (i = 0; i < texts.length; i++) {
        parsed = parseTriggerLines(texts[i]);
        for (j = 0; j < parsed.length; j++) {
            set[parsed[j].signature] = true;
        }
    }

    return set;
}

// Keep only UI bindings that are not already present in foreign confs.
// Comparison is key + event value 1 + normalized command.
function filterDifferences(bindings, foreignSet) {
    var out = [];
    var i;

    for (i = 0; i < bindings.length; i++) {
        var row = bindings[i];
        var command = normalizeCommand(row.command);
        if (!command || command.indexOf('\n') !== -1) {
            continue;
        }
        var signature = bindingSignature(row.key, '1', command);
        if (foreignSet && foreignSet[signature]) {
            continue;
        }
        out.push({
            field: row.field,
            key: row.key,
            comment: row.comment,
            command: command
        });
    }

    return out;
}

function renderMap(bindings) {
    var rows = bindings || STOCK_BINDINGS;
    var lines = [
        '# Unhappy TriggerHappy',
        '# Differences only. Not a second copy of audio.conf.',
        '',
        '#VOLUMIO TRIGGERHAPPY CONFIGURATION FILE',
        ''
    ];

    rows.forEach(function (row) {
        var command = normalizeCommand(row.command);
        if (!command || command.indexOf('\n') !== -1) {
            return;
        }
        lines.push('#' + row.comment);
        lines.push(row.key + ' 1 ' + command);
        lines.push('#');
    });

    if (lines.length && lines[lines.length - 1] === '#') {
        lines.pop();
    }

    return lines.join('\n') + '\n';
}

module.exports = {
    STOCK_BINDINGS: STOCK_BINDINGS,
    TRIGGERS_DIR: TRIGGERS_DIR,
    TRIGGERS_BASENAME: TRIGGERS_BASENAME,
    TRIGGERS_FILE: TRIGGERS_FILE,
    bindingsFromUi: bindingsFromUi,
    parseTriggerLines: parseTriggerLines,
    foreignSignatures: foreignSignatures,
    filterDifferences: filterDifferences,
    bindingSignature: bindingSignature,
    renderMap: renderMap
};
