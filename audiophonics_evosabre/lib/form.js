'use strict';

// The settings page's values: into the page when it is opened, and out of
// a saved section, checked, on their way to the store.

// The whole numbers the page takes, each with the range the display accepts.
const NUMBERS = {
    contrast: [1, 255],
    meters_gain: [-12, 12],
    clock_after: [0, 86400],
    sleep_after: [0, 86400],
    deep_sleep_after: [0, 86400]
};
const SWITCHES = ['oled_active', 'remote_active', 'click_prevention', 'meters', 'snake'];
const SELECTS = {
    track_time_size: ['off', 'small', 'medium', 'large', 'extra_large'],
    meters_style: ['horizontal', 'horizontal_beside', 'vertical_left', 'vertical_right'],
    clock_segments: ['off', 'very_faint', 'faint', 'dim'],
    log_level: ['error', 'info', 'debug']
};

// A switch as the store may hold it: a boolean, or its text.
function isOn(value, fallback) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return fallback;
}

// A store as the page reads it. Before the track time had sizes the store
// held a switch for it, track_time, and on was the size that is now the
// smallest: a store with the switch and no size reads as that.
function stored(get) {
    return function (key) {
        const value = get(key);
        if (key !== 'track_time_size' || value !== undefined) return value;
        const was = get('track_time');
        if (was === undefined) return undefined;
        return isOn(was, true) ? 'small' : 'off';
    };
}

// The stored values into the page's controls. `get(key)` answers undefined
// for a key the store does not hold, which leaves the page's default.
function fill(uiconf, get) {
    (uiconf.sections || []).forEach(function (section) {
        (section.content || []).forEach(function (element) {
            const value = get(element.id);
            if (value === undefined) return;
            if (element.element === 'select') {
                const chosen = (element.options || []).filter(function (o) { return String(o.value) === String(value); })[0];
                if (chosen) element.value = { value: chosen.value, label: chosen.label };
            } else if (element.element === 'switch') {
                element.value = isOn(value, element.value);
            } else if (element.element === 'input') {
                element.value = value;
            }
        });
    });
    return uiconf;
}

// The values of a saved section, by the kind of control each came from.
// Returns { values } to store, or { bad: { key, min, max } } for the first
// number that is not a whole number in its range; nothing is stored then.
function take(data, keys) {
    const values = {};
    for (const key of keys) {
        if (!data || !(key in data)) continue;
        const raw = data[key];
        if (key in NUMBERS) {
            const [min, max] = NUMBERS[key];
            const text = String(raw === null || raw === undefined ? '' : raw).trim();
            const n = Number(text);
            if (text === '' || !Number.isInteger(n) || n < min || n > max) {
                return { bad: { key: key, min: min, max: max } };
            }
            values[key] = n;
        } else if (SWITCHES.indexOf(key) !== -1) {
            values[key] = isOn(raw, false);
        } else if (key in SELECTS) {
            const chosen = String(raw && typeof raw === 'object' ? raw.value : raw);
            if (SELECTS[key].indexOf(chosen) !== -1) values[key] = chosen;
        }
    }
    // The switch the track time had before it had sizes is kept in step, so
    // that a player put back to the version that reads it shows the time, or
    // leaves it out, as it was last set.
    if ('track_time_size' in values) values.track_time = values.track_time_size !== 'off';
    return { values: values };
}

module.exports = { NUMBERS, isOn, stored, fill, take };
