'use strict';

// Ready poll copied from es9018k2m_dac/index.js (applyStartupVolume / checkSystemReady).
// Interval, attempt cap, status variable, and the ready / retry / give-up branches match that loop.
// The Allo relay attenuator's 2000ms timer is not used.

function pollUntilReady(onRestart) {
    var pollingInterval = 1500; // 1.5 seconds
    var maxAttempts = 60;       // 90 seconds max wait
    var attempts = 0;
    var timer = null;
    var stopped = false;

    function checkSystemReady() {
        if (stopped) {
            return;
        }

        attempts++;

        var systemStatus = process.env.VOLUMIO_SYSTEM_STATUS;

        if (systemStatus === 'ready') {
            onRestart();
        } else if (attempts < maxAttempts) {
            // Not ready yet - check again
            timer = setTimeout(checkSystemReady, pollingInterval);
        } else {
            // Timeout - restart anyway
            onRestart();
        }
    }

    checkSystemReady();

    return function cancel() {
        stopped = true;
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
}

module.exports = {
    pollUntilReady: pollUntilReady
};
