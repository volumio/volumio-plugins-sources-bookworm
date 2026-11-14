'use strict';

// The player's volume across a rebuild of Volumio's ALSA configuration.
//
// When that file changes, Volumio has ALSA restore the mixer state it last
// stored. On the EVO Sabre the stored state is rarely the present one: the
// volume moves to what was stored, and the DAC's switch, which the kernel
// also turns off whenever nothing plays, comes back off, so the player
// reports itself muted while it plays. What the player had is noted before
// the rebuild and asked for again after it.

// What to hold: the volume and the mute of a player state, or nothing where
// the player has no volume of its own to put back.
function held(state) {
    if (!state || state.disableVolumeControl === true) {
        return null;
    }
    const volume = typeof state.volume === 'string' && state.volume.trim() !== ''
        ? Number(state.volume)
        : state.volume;
    if (typeof volume !== 'number' || !isFinite(volume) || volume < 0 || volume > 100) {
        return null;
    }
    return { volume: Math.round(volume), mute: state.mute === true };
}

// What to ask of Volumio to put it back, in order: the volume, which also
// unmutes, then the mute where the player was muted.
function steps(was) {
    if (!was) {
        return [];
    }
    return was.mute ? [was.volume, 'mute'] : [was.volume];
}

module.exports = { held, steps };
