'use strict';

/**
 * SSD1309 OLED Driver for I2C bus (v1.7.17 – synchronous I2C)
 *
 * Low-level driver using synchronous I2C writes (i2cWriteSync).
 * Pre-allocated framebuffer (1024 bytes) and flush buffer (129 bytes)
 * eliminate per-frame allocations.  Optimised fillRect/hLine write
 * directly to the page buffer.  Supports 180° rotation.
 */

var DISPLAY_WIDTH = 128;
var DISPLAY_HEIGHT = 64;
var PAGES = DISPLAY_HEIGHT / 8;
var BUFFER_SIZE = DISPLAY_WIDTH * PAGES; // 1024 bytes

// I2C control bytes
var CTRL_CMD_STREAM  = 0x00; // Co=0, D/C#=0 – command stream
var CTRL_DATA_STREAM = 0x40; // Co=0, D/C#=1 – data stream

var CMD = {
  DISPLAY_OFF:        0xAE,
  DISPLAY_ON:         0xAF,
  SET_CONTRAST:       0x81,
  ENTIRE_DISPLAY_RAM: 0xA4,
  NORMAL_DISPLAY:     0xA6,
  SET_MUX_RATIO:      0xA8,
  SET_DISPLAY_OFFSET: 0xD3,
  SET_START_LINE:     0x40,
  SET_SEG_REMAP_ON:   0xA1,
  SET_SEG_REMAP_OFF:  0xA0,
  SET_COM_SCAN_DEC:   0xC8,
  SET_COM_SCAN_INC:   0xC0,
  SET_COM_PINS:       0xDA,
  SET_CLOCK_DIV:      0xD5,
  SET_PRECHARGE:      0xD9,
  SET_VCOMH:          0xDB,
  SET_MEMORY_MODE:    0x20,
  SET_COL_ADDR:       0x21,
  SET_PAGE_ADDR:      0x22,
  CHARGE_PUMP:        0x8D
};

// One full page per chunk (128 data bytes + 1 control byte = 129 bytes).
var DATA_CHUNK_BYTES = 128;

function SSD1309(options, logger) {
  this.busNumber = options.busNumber || 1;
  this.address = options.address || 0x3C;
  this.contrast = (options.contrast != null) ? options.contrast : 255;
  this.rotate = !!options.rotate;
  this.logger = logger;

  this.bus = null;
  this.buffer = Buffer.alloc(BUFFER_SIZE, 0x00);
  this.initialised = false;
  this.width = DISPLAY_WIDTH;
  this.height = DISPLAY_HEIGHT;

  // Pre-allocated buffer for flush data chunks (avoids GC churn).
  // Size: 1 control byte + 128 data bytes = 129 bytes.
  this._chunkBuf = Buffer.alloc(DATA_CHUNK_BYTES + 1);
  this._chunkBuf[0] = CTRL_DATA_STREAM;

  // Pre-allocated buffer for the flush address-reset command.
  // Sent on every flush to reset the write pointer to top-left.
  // Avoids one Buffer.alloc per frame in _sendCommands.
  this._flushCmdBuf = Buffer.from([
    CTRL_CMD_STREAM,
    CMD.SET_COL_ADDR, 0x00, 0x7F,
    CMD.SET_PAGE_ADDR, 0x00, 0x07
  ]);

  // Error tracking for circuit breaker in caller
  this.consecutiveErrors = 0;
}

/**
 * Open the I2C bus (synchronous) and send the init command sequence.
 */
SSD1309.prototype.init = function () {
  var i2c = require('i2c-bus');

  try {
    this.bus = i2c.openSync(this.busNumber);
    this.logger.info('OLED: I2C bus ' + this.busNumber + ' opened (sync mode)');
  } catch (err) {
    this.logger.error('OLED: Failed to open I2C bus ' + this.busNumber + ': ' + err.message);
    throw err;
  }

  this._initSequence();
  this.initialised = true;
  this.consecutiveErrors = 0;
  this.logger.info('OLED: Display initialised at 0x' + this.address.toString(16) +
    ', contrast=' + this.contrast +
    ', rotate=' + this.rotate);
};

/**
 * SSD1309 init command sequence.
 * Sent as a single command stream (Co=0) so multi-byte commands like
 * SET_CONTRAST receive their arguments in the same I2C transaction.
 */
SSD1309.prototype._initSequence = function () {
  // Orientation: normal vs 180° rotation
  var segRemap = this.rotate ? CMD.SET_SEG_REMAP_OFF : CMD.SET_SEG_REMAP_ON;
  var comScan  = this.rotate ? CMD.SET_COM_SCAN_INC  : CMD.SET_COM_SCAN_DEC;

  var cmds = [
    CMD.DISPLAY_OFF,

    CMD.SET_CLOCK_DIV, 0x80,       // default oscillator
    CMD.SET_MUX_RATIO, 0x3F,       // 64 lines
    CMD.SET_DISPLAY_OFFSET, 0x00,  // no offset
    CMD.SET_START_LINE | 0x00,     // start line 0

    CMD.CHARGE_PUMP, 0x14,         // enable internal charge pump

    CMD.SET_MEMORY_MODE, 0x00,     // horizontal addressing mode

    segRemap,                       // horizontal orientation
    comScan,                        // vertical orientation

    CMD.SET_COM_PINS, 0x12,        // alt COM pin config
    CMD.SET_CONTRAST, this.contrast & 0xFF,
    CMD.SET_PRECHARGE, 0xF1,       // phase1=1, phase2=15
    CMD.SET_VCOMH, 0x40,           // VCOMH deselect level

    CMD.ENTIRE_DISPLAY_RAM,
    CMD.NORMAL_DISPLAY,

    CMD.SET_COL_ADDR, 0x00, 0x7F,  // columns 0–127
    CMD.SET_PAGE_ADDR, 0x00, 0x07, // pages 0–7

    CMD.DISPLAY_ON
  ];

  var ok = this._sendCommands(cmds);
  if (!ok) {
    throw new Error('Init command sequence failed');
  }
};

/**
 * Send command bytes as a single I2C stream transaction (synchronous).
 * @param {number[]} cmds
 * @returns {boolean} true on success
 */
SSD1309.prototype._sendCommands = function (cmds) {
  if (!this.bus) return false;

  var buf = Buffer.alloc(cmds.length + 1);
  buf[0] = CTRL_CMD_STREAM;
  for (var i = 0; i < cmds.length; i++) {
    buf[i + 1] = cmds[i];
  }

  try {
    this.bus.i2cWriteSync(this.address, buf.length, buf);
    return true;
  } catch (err) {
    this.consecutiveErrors++;
    if (this.consecutiveErrors <= 1) {
      this.logger.error('OLED: Command write failed: ' + err.message);
    }
    return false;
  }
};

/**
 * Flush the entire framebuffer to the display (synchronous).
 *
 * Reuses a pre-allocated chunk buffer to avoid allocating 8 new Buffers
 * per frame (~16 allocs/sec at 2 fps → 0 allocs/sec).
 *
 * Returns { ok: true } on success or { ok: false, error: string }.
 * Does NOT throw.
 */
SSD1309.prototype.flush = function () {
  if (!this.initialised || !this.bus) {
    return { ok: false, error: 'not initialised' };
  }

  // Reset write pointer to top-left using pre-allocated command buffer
  try {
    this.bus.i2cWriteSync(this.address, this._flushCmdBuf.length, this._flushCmdBuf);
  } catch (err) {
    this.consecutiveErrors++;
    if (this.consecutiveErrors <= 1) {
      this.logger.error('OLED: Command write failed: ' + err.message);
    }
    return { ok: false, error: 'address reset failed' };
  }

  // Write framebuffer in page-sized chunks using the pre-allocated buffer
  var chunk = this._chunkBuf;
  for (var offset = 0; offset < BUFFER_SIZE; offset += DATA_CHUNK_BYTES) {
    var end = Math.min(offset + DATA_CHUNK_BYTES, BUFFER_SIZE);
    var chunkLen = end - offset;

    // Copy framebuffer data into the chunk buffer (byte 0 is already CTRL_DATA_STREAM)
    this.buffer.copy(chunk, 1, offset, end);

    try {
      this.bus.i2cWriteSync(this.address, chunkLen + 1, chunk);
    } catch (err) {
      this.consecutiveErrors++;
      if (this.consecutiveErrors <= 1) {
        this.logger.error('OLED: Data write failed at offset ' + offset + ': ' + err.message);
      }
      return { ok: false, error: 'data write at byte ' + offset };
    }
  }

  this.consecutiveErrors = 0;
  return { ok: true };
};

/**
 * Clear the framebuffer.
 */
SSD1309.prototype.clearBuffer = function () {
  this.buffer.fill(0x00);
};

/**
 * Set or clear a single pixel.
 */
SSD1309.prototype.setPixel = function (x, y, on) {
  if (x < 0 || x >= DISPLAY_WIDTH || y < 0 || y >= DISPLAY_HEIGHT) return;
  var idx = (y >> 3) * DISPLAY_WIDTH + x;
  if (on) {
    this.buffer[idx] |= (1 << (y & 7));
  } else {
    this.buffer[idx] &= ~(1 << (y & 7));
  }
};

/**
 * Draw a filled rectangle directly to the page buffer.
 *
 * Computes page index and bit mask once per row instead of per pixel,
 * avoiding the overhead of setPixel() bounds-checking for every cell.
 */
SSD1309.prototype.fillRect = function (x, y, w, h, on) {
  // Clamp to display bounds
  var x0 = Math.max(0, x);
  var y0 = Math.max(0, y);
  var x1 = Math.min(DISPLAY_WIDTH, x + w);
  var y1 = Math.min(DISPLAY_HEIGHT, y + h);

  for (var py = y0; py < y1; py++) {
    var page = py >> 3;
    var mask = 1 << (py & 7);
    var base = page * DISPLAY_WIDTH;
    if (on) {
      for (var px = x0; px < x1; px++) {
        this.buffer[base + px] |= mask;
      }
    } else {
      var invMask = ~mask;
      for (var px2 = x0; px2 < x1; px2++) {
        this.buffer[base + px2] &= invMask;
      }
    }
  }
};

/**
 * Draw a horizontal line directly to the page buffer.
 *
 * All pixels in a horizontal line share the same page and bit mask,
 * so we compute them once and loop only over the x-axis.
 */
SSD1309.prototype.hLine = function (x, y, length, on) {
  if (y < 0 || y >= DISPLAY_HEIGHT) return;

  var x0 = Math.max(0, x);
  var x1 = Math.min(DISPLAY_WIDTH, x + length);
  if (x0 >= x1) return;

  var page = y >> 3;
  var mask = 1 << (y & 7);
  var base = page * DISPLAY_WIDTH;

  if (on) {
    for (var px = x0; px < x1; px++) {
      this.buffer[base + px] |= mask;
    }
  } else {
    var invMask = ~mask;
    for (var px2 = x0; px2 < x1; px2++) {
      this.buffer[base + px2] &= invMask;
    }
  }
};

/**
 * Set display contrast (brightness).
 */
SSD1309.prototype.setContrast = function (value) {
  this.contrast = value & 0xFF;
  if (!this.initialised) return;
  this._sendCommands([CMD.SET_CONTRAST, this.contrast]);
};

/**
 * Turn display on or off.
 */
SSD1309.prototype.setPower = function (on) {
  if (!this.initialised) return;
  this._sendCommands([on ? CMD.DISPLAY_ON : CMD.DISPLAY_OFF]);
};

/**
 * Close the I2C bus.
 */
SSD1309.prototype.close = function () {
  if (this.bus) {
    try {
      this.clearBuffer();
      this.flush();
      this._sendCommands([CMD.DISPLAY_OFF]);
      this.bus.closeSync();
      this.logger.info('OLED: Display closed');
    } catch (err) {
      this.logger.error('OLED: Error during close: ' + err.message);
    }
    this.bus = null;
    this.initialised = false;
  }
};

module.exports = SSD1309;
