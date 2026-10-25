'use strict';

var net = require('net');

// One request to the listener's control socket: a JSON object in, one JSON
// object back, then the connection closes.
function request(socketPath, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
        var client = net.createConnection(socketPath);
        var buffer = '';
        var done = false;
        var timer = setTimeout(function () {
            finish(new Error('the listener did not answer within ' + (timeoutMs || 3000) + ' ms'));
        }, timeoutMs || 3000);

        function finish(err, value) {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            client.destroy();
            if (err) {
                reject(err);
            } else {
                resolve(value);
            }
        }

        function parse(text) {
            try {
                finish(null, JSON.parse(text));
            } catch (e) {
                finish(new Error('the listener answered with something that is not JSON'));
            }
        }

        client.on('connect', function () {
            client.write(JSON.stringify(body) + '\n');
        });
        client.on('data', function (chunk) {
            buffer += chunk;
            var newline = buffer.indexOf('\n');
            if (newline !== -1) {
                parse(buffer.slice(0, newline));
            }
        });
        client.on('error', function (err) {
            finish(err);
        });
        client.on('close', function () {
            if (buffer.trim()) {
                parse(buffer);
            } else {
                finish(new Error('the listener closed the connection without an answer'));
            }
        });
    });
}

module.exports = {
    request: request
};
