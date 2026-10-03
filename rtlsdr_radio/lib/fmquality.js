'use strict';

// How well an FM station is received, measured on its demodulated signal.
//
// An RTL-SDR dongle gives no signal strength, and the error rate of RDS is no measure of
// reception either: it reaches zero long before the sound is clean. What can be measured
// is the 19 kHz stereo pilot, which every stereo station sends at a fixed level, against
// the noise in the band above RDS (62 to 73 kHz), where nothing is transmitted. The better
// the reception, the further the pilot stands above that noise. A station without a pilot
// (mono), or too weak to show one, gives no reading.
//
// One reading a second is taken from an eighth of a second of signal, so the cost is small.

var PILOT = 19000;
var NOISE_BAND = [62000, 63500, 65000, 66500, 68000, 69500, 71000, 72500];

// The receiver's de-emphasis lowers the noise band by this much more than the pilot (dB),
// which would flatter the reading; it is taken off when de-emphasis is on.
var DEEMPHASIS_TILT = 11;

// How much a new reading counts against the ones before it
var SMOOTHING = 0.3;

// A sample rate as the plugin's settings give it ("171k", "240k") or as a number, in Hz.
// Returns null when it is not a rate this measurement can work at.
function parseRate(rate) {
  var hz = null;
  var match = /^(\d+(?:\.\d+)?)k$/i.exec(String(rate));
  if (match) {
    hz = Math.round(parseFloat(match[1]) * 1000);
  } else if (isFinite(Number(rate))) {
    hz = Math.round(Number(rate));
  }
  // The noise band must lie below half the sample rate
  if (!hz || hz / 2 <= NOISE_BAND[NOISE_BAND.length - 1] + 2000) {
    return null;
  }
  return hz;
}

// The tune level (1 to 5) for a reading in dB, or null when no pilot stands out.
function level(db) {
  if (db === null || db === undefined || db < 6) {
    return null;
  }
  if (db < 12) return 1;
  if (db < 20) return 2;
  if (db < 30) return 3;
  if (db < 40) return 4;
  return 5;
}

// options.deemphasis: the signal has passed the receiver's de-emphasis
// options.onReading(smoothedDb, thisReadingDb): called once a second
function FmQuality(sampleRate, options) {
  options = options || {};
  this.sampleRate = sampleRate;
  this.size = Math.floor(sampleRate / 8);
  this.deemphasis = !!options.deemphasis;
  this.onReading = options.onReading || function() {};
  this.block = new Float64Array(this.size);
  this.filled = 0;
  this.skip = 0;
  this.carry = null;
  this.smoothed = null;

  this.window = new Float64Array(this.size);
  for (var i = 0; i < this.size; i++) {
    this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.size - 1));
  }
}

// Take the next piece of the signal: 16-bit little-endian samples, in whatever pieces
// they arrive.
FmQuality.prototype.feed = function(buffer) {
  var offset = 0;

  // A sample cut in two by the boundary between pieces
  if (this.carry !== null && buffer.length > 0) {
    this._sample((buffer[0] << 8 | this.carry) << 16 >> 16);
    this.carry = null;
    offset = 1;
  }

  var end = offset + ((buffer.length - offset) & ~1);
  for (var i = offset; i < end; i += 2) {
    this._sample(buffer.readInt16LE(i));
  }
  if (end < buffer.length) {
    this.carry = buffer[end];
  }
};

FmQuality.prototype._sample = function(value) {
  if (this.skip > 0) {
    this.skip--;
    return;
  }
  this.block[this.filled] = value * this.window[this.filled];
  this.filled++;
  if (this.filled === this.size) {
    this.filled = 0;
    this.skip = this.sampleRate - this.size;
    this._read();
  }
};

// The power of the block at one frequency (Goertzel)
FmQuality.prototype._power = function(frequency) {
  var coefficient = 2 * Math.cos(2 * Math.PI * frequency / this.sampleRate);
  var s1 = 0;
  var s2 = 0;
  var block = this.block;
  for (var i = 0; i < block.length; i++) {
    var s0 = block[i] + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coefficient * s1 * s2;
};

FmQuality.prototype._read = function() {
  var pilot = this._power(PILOT);
  var noise = 0;
  for (var i = 0; i < NOISE_BAND.length; i++) {
    noise += this._power(NOISE_BAND[i]);
  }
  noise /= NOISE_BAND.length;

  // Silence in, nothing to say
  if (!(noise > 0) || !(pilot > 0)) {
    return;
  }

  var db = 10 * Math.log10(pilot / noise);
  if (this.deemphasis) {
    db -= DEEMPHASIS_TILT;
  }
  this.smoothed = this.smoothed === null ? db : this.smoothed * (1 - SMOOTHING) + db * SMOOTHING;
  this.onReading(this.smoothed, db);
};

module.exports = FmQuality;
module.exports.parseRate = parseRate;
module.exports.level = level;
