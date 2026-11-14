'use strict';

// What follows a rebuild of the player's audio path, and when.
//
// The DAC board has a microcontroller the player writes to over I2C: the
// volume, the mute, the filter. It does not take those writes well while
// its audio clocks are stopping or starting, which they do whenever the
// output is opened or closed: a write can be lost without a word, or fail,
// and enough of them leave the microcontroller deaf until its power is
// taken away. So the plugin keeps the two apart. Nothing of its own holds
// the output while Volumio rebuilds the path and restores the mixer; the
// volume is put back only after a quiet moment; and the program behind
// Click prevention opens the output only after another.

const volume = require('./volume');

// The quiet left between a write to the DAC board and a change of its
// clocks, and between Volumio's restore of the mixer and the next write.
const SETTLE = 1500;
// Volumio needs the volume before it can be muted at that volume.
const MUTE_AFTER = 1000;

// The steps after a rebuild that finished at 0, in order, each with the
// milliseconds at which it is due:
//   { at, step: 'volume', value }   ask Volumio for a volume, or for 'mute'
//   { at, step: 'start' }           start the program behind Click prevention
// `changed` is whether Volumio wrote a new configuration, which is when it
// restores the mixer; `was` is the volume the player had, as volume.held()
// gives it; `keeper` is whether Click prevention is wanted.
function after(changed, was, keeper) {
    const steps = [];
    let quietFrom = 0;
    let writes = false;
    if (changed) {
        // Volumio's restore wrote to the DAC board as the rebuild ended.
        writes = true;
        volume.steps(was).forEach(function (value, i) {
            const at = SETTLE + i * MUTE_AFTER;
            steps.push({ at: at, step: 'volume', value: value });
            quietFrom = at;
        });
    }
    if (keeper) {
        steps.push({ at: writes ? quietFrom + SETTLE : 0, step: 'start' });
    }
    return steps;
}

module.exports = { SETTLE, MUTE_AFTER, after };
