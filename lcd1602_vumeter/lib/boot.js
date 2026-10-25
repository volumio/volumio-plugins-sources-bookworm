'use strict';

// The lines the plugin keeps in /boot/userconfig.txt for the I2C bus the
// settings choose, between two marks of its own, so they can be replaced
// or removed without touching anything else in the file.

const MARK_BEGIN = '# >>> lcd1602_vumeter';
const MARK_END = '# <<< lcd1602_vumeter';

// The software bus's number: beyond the Pi's own buses (0, 1, and 20 to 22 on a Pi 4).
const SOFTWARE_BUS = 3;

// The bus number the daemon opens for a mode.
function busFor(mode) {
    switch (mode) {
        case 'hardware0': return 0;
        case 'software': return SOFTWARE_BUS;
        default: return 1;
    }
}

// The boot configuration lines a mode needs; none for the default bus,
// which Volumio's own configuration enables.
function linesFor(mode, sda, scl) {
    switch (mode) {
        case 'hardware0':
            return ['dtparam=i2c_vc=on'];
        case 'software':
            return ['dtoverlay=i2c-gpio,bus=' + SOFTWARE_BUS + ',i2c_gpio_sda=' + pin(sda, 23) + ',i2c_gpio_scl=' + pin(scl, 24) + ',i2c_gpio_delay_us=2'];
        default:
            return [];
    }
}

function pin(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isInteger(n) && n >= 0 && n <= 27 ? n : fallback;
}

// `content` with the plugin's block replaced by `lines`, or removed when
// there are none. Returns the new content and whether it differs.
function rewrite(content, lines) {
    const text = content || '';
    const rows = text.split('\n');
    const kept = [];
    let inside = false;
    for (const row of rows) {
        if (row === MARK_BEGIN) { inside = true; continue; }
        if (row === MARK_END) { inside = false; continue; }
        if (!inside) kept.push(row);
    }
    // One trailing newline, whatever the file had.
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    let out = kept.join('\n');
    if (lines.length) {
        out += (out.length ? '\n' : '') + [MARK_BEGIN].concat(lines, [MARK_END]).join('\n');
    }
    out += '\n';
    const unchanged = out === text || (out === '\n' && text === '');
    return { content: out, changed: !unchanged };
}

module.exports = { MARK_BEGIN, MARK_END, SOFTWARE_BUS, busFor, linesFor, rewrite };
