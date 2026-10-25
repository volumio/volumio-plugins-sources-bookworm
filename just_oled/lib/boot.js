'use strict';

// The wiring presets and the lines the plugin keeps in /boot/userconfig.txt
// for a custom I2C bus, between two marks of its own, so they can be
// replaced or removed without touching anything else in the file.

const MARK_BEGIN = '# >>> just_oled';
const MARK_END = '# <<< just_oled';

// The pins each preset stands for. `custom` leaves the stored values alone.
const PRESETS = {
    i2c: { bus: 'i2c', i2c_bus: 1, i2c_sda: 2, i2c_scl: 3, i2c_address: 'auto' },
    i2c_custom: { bus: 'i2c' },
    // The luma library's and mpd_oled's defaults.
    spi: { bus: 'spi', spi_bus: 0, spi_cs: 0, gpio_dc: 24, gpio_reset: 25 },
    // The mapping printed on Waveshare's module pages.
    spi_waveshare: { bus: 'spi', spi_bus: 0, spi_cs: 0, gpio_dc: 25, gpio_reset: 27 },
    spi_custom: { bus: 'spi' },
};

// The preset's fixed values for a connection, or the custom one's bus alone.
function preset(connection) {
    return PRESETS[connection] || PRESETS.i2c;
}

function pin(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isInteger(n) && n >= 0 && n <= 27 ? n : fallback;
}

// The boot configuration lines an I2C bus needs: none for bus 1 at the
// Pi's 100 kHz, which Volumio enables; the HAT bus for 0; a software bus
// on two GPIOs for 3 and above. A faster clock (`speedKhz` 400 or 1000)
// is written for the two hardware buses; the software bus keeps its
// delay, as bit-banging does not reach it. The hardware buses the SoC
// numbers beyond 1 (Pi 4's 3 to 6) are not reachable this way, so the
// software bus takes the number.
function linesFor(connection, bus, sda, scl, speedKhz) {
    if (preset(connection).bus !== 'i2c') {
        return [];
    }
    const n = parseInt(bus, 10);
    const khz = parseInt(speedKhz, 10);
    const faster = khz === 400 || khz === 1000 ? khz * 1000 : 0;
    if (n === 0) {
        return ['dtparam=i2c_vc=on'].concat(faster ? ['dtparam=i2c_vc_baudrate=' + faster] : []);
    }
    if (Number.isInteger(n) && n >= 3) {
        return ['dtoverlay=i2c-gpio,bus=' + n + ',i2c_gpio_sda=' + pin(sda, 2) + ',i2c_gpio_scl=' + pin(scl, 3) + ',i2c_gpio_delay_us=2'];
    }
    return faster ? ['dtparam=i2c_arm_baudrate=' + faster] : [];
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

module.exports = { MARK_BEGIN, MARK_END, PRESETS, preset, linesFor, rewrite };
