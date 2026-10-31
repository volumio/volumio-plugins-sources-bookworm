'use strict';

// The player's state to a daemon the installer started. Volumio stops a
// plugin before replacing its files and does not start the new code
// until the player restarts, so after an update nothing would hand the
// new daemon the state and it would show the boot rows, then the clock.
// This does once what the plugin does on every state change: Volumio's
// state, reduced to what the daemon draws, down its socket.
//
//   NODE_PATH=/volumio/node_modules node resync.js [SOCKET]

const http = require('http');
const net = require('net');
const path = require('path');

const { stateForDaemon } = require(path.join(__dirname, '..', 'index.js'));
const socket = process.argv[2] || '/run/just-oled/just-oled.sock';
const deadline = Date.now() + 15000;

function state(done) {
    http.get('http://127.0.0.1:3000/api/v1/getState', (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
            try { done(null, JSON.parse(body)); } catch (e) { done(e); }
        });
    }).on('error', done);
}

// The daemon's socket appears a moment after the service starts.
function send(line, done) {
    const client = net.createConnection(socket);
    client.on('connect', () => { client.end(line + '\n'); });
    client.on('close', () => done(null));
    client.on('error', (e) => {
        if (Date.now() < deadline) {
            setTimeout(() => send(line, done), 500);
        } else {
            done(e);
        }
    });
}

state((err, s) => {
    if (err || !s || typeof s !== 'object' || !s.status) {
        console.error('resync: no player state: ' + (err && err.message ? err.message : 'empty'));
        process.exit(1);
    }
    send(JSON.stringify(stateForDaemon(s)), (e) => {
        if (e) {
            console.error('resync: daemon not reachable: ' + e.message);
            process.exit(1);
        }
        console.log('resync: the daemon has the player state (' + s.status + ')');
        process.exit(0);
    });
});
