'use strict';

// Click prevention: what it puts into the player's ALSA chain, and what
// stands in its way.
//
// A small daemon (Audio Keepalive) holds the audio output open and is the
// only writer on it; the players write to the daemon through an ALSA client
// this contribution names. The output never closes, so the DAC's clocks
// never stop between tracks.

const fs = require('fs');
const path = require('path');

// The PCM the players write to, the ALSA client behind it, and the PCM the
// daemon writes on to.
const IN = 'evosabreKeepalive';
const CLIENT = 'evosabreKeepaliveClient';
const OUT = 'evosabreKeepaliveOut';
// The contribution's file is named <in>.<out>.<rank>.conf; the rank puts it
// last in the chain, next to the hardware.
const CONTRIBUTION = IN + '.' + OUT + '.-1.conf';
const SOCKET = '/run/evosabre-keepalive/ctl.sock';
// The Audio Keepalive plugin does the same work for any output. Where it is
// switched on, a second keeper is not put behind it.
const STANDALONE = '/data/plugins/audio_interface/audio_keepalive/asound/keepaliveProxy.keepaliveProxyOut.-1.conf';

// The contribution: the ALSA client by its path in the plugin's folder, the
// PCM that talks to the daemon, and a copy PCM in front of it.
//
// The copy PCM passes every sample through as it is. It is there for
// Volumio's multiroom switcher, which sits just before this contribution in
// the chain and takes anything but zero as a failure when it asks its
// target for hardware parameters. ALSA answers that question for a client
// of this kind with one where the parameters were narrowed, and with zero
// through a copy PCM.
function contribution(pluginDir) {
    return [
        'pcm_type.keepalive {',
        '    lib "' + path.join(pluginDir, 'keepalive', 'libasound_module_pcm_keepalive.so') + '"',
        '}',
        '',
        'pcm.' + IN + ' {',
        '    type copy',
        '    slave.pcm "' + CLIENT + '"',
        '}',
        '',
        'pcm.' + CLIENT + ' {',
        '    type keepalive',
        '    socket "' + SOCKET + '"',
        '}'
    ].join('\n') + '\n';
}

function standaloneOn() {
    return fs.existsSync(STANDALONE);
}

// Whether the player's ALSA configuration carries the contribution. It does
// once Volumio has rebuilt the configuration with this plugin among those
// it asks, which for a plugin just installed is after the player restarts.
function inChain(asound) {
    return String(asound || '').indexOf('pcm.' + IN + ' ') !== -1;
}

module.exports = { IN, CLIENT, OUT, CONTRIBUTION, SOCKET, STANDALONE, contribution, standaloneOn, inChain };
