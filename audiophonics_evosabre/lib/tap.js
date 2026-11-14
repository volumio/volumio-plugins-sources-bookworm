'use strict';

// The level meters: what they put into the player's ALSA chain.
//
// evotap is an ALSA plugin the player's stream passes through byte for
// byte. On the way it measures the stream and publishes the peak and RMS of
// each channel under /dev/shm, where the display reads them. Nothing in it
// waits on a reader.

const path = require('path');

// The PCM the players write to, and the one the tap writes on to.
const IN = 'evosabreTap';
const OUT = 'evosabreTapOut';
// Ahead of the player's volume, whose contribution has no rank and so
// stands at 0: the meters show the stream, not the volume it is played at.
const RANK = 4;
const CONTRIBUTION = IN + '.' + OUT + '.' + RANK + '.conf';
// The tag in the names of what the tap publishes. Another plugin's tap in
// the same chain publishes under its own; the display reads this one.
const TAG = 'evosabre';

// The contribution: the tap by its path in the plugin's folder, and the PCM
// that is one.
function contribution(pluginDir) {
    return [
        'pcm_type.evotap {',
        '    lib "' + path.join(pluginDir, 'evotap', 'libevotap.so') + '"',
        '}',
        '',
        'pcm.' + IN + ' {',
        '    type evotap',
        '    slave.pcm "' + OUT + '"',
        '    ring "' + TAG + '"',
        '}'
    ].join('\n') + '\n';
}

// Whether the player's ALSA configuration carries the tap.
function inChain(asound) {
    return String(asound || '').indexOf('pcm.' + IN + ' ') !== -1;
}

module.exports = { IN, OUT, RANK, CONTRIBUTION, TAG, contribution, inChain };
