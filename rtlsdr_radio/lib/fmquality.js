'use strict';

// How well an FM station is received, measured on its demodulated signal.
//
// An RTL-SDR dongle gives no signal strength, and the error rate of RDS is no measure of
// reception either: it reaches zero long before the sound is clean. What can be measured
// is the 19 kHz stereo pilot, which every stereo station sends at a fixed level, against
// the noise in the band above RDS (62 to 73 kHz), where nothing is transmitted. The better
// the reception, the further the pilot stands above that noise.
//
// A station without a pilot (mono) is read by its carrier: how far a pilot of the usual
// strength would stand above the noise it shows. That is the same scale, and on a stereo
// station the same reading within a decibel; it says nothing below 26 dB, where a
// frequency with no station on it reads 17 to 24. A station too weak to show a pilot or
// such a carrier gives no reading.
//
// Pilot, stereo signal and RDS are the same wherever the pilot-tone system is used, which
// is every country's FM band. What a station sends above RDS differs, and is allowed for
// on any station, whatever the region set:
//   - nothing, in most of the world: the noise is read at 62 to 73 kHz;
//   - a subsidiary carrier at 67 kHz (the Americas, often with another at 92 kHz): it
//     sits where the noise is read, so the noise is read between the two instead (76.5
//     to 82.5 kHz) and referred to the usual place: noise rises with the square of the
//     frequency there;
//   - a data carrier around 76 kHz that covers both places (Japan, Korea): the reading
//     cannot rise above what that carrier leaves, some 47 to 50 dB, which is still the
//     highest level.
// The second and third were tried on made-up signals, not on a broadcast.
//
// One reading a second is taken from an eighth of a second of signal, so the cost is small.

var PILOT = 19000;
var NOISE_BAND = [62000, 63500, 65000, 66500, 68000, 69500, 71000, 72500];
var UPPER_BAND = [76500, 78000, 79500, 81000, 82500];

// The middle of the noise band: where the upper band's noise is referred to
var NOISE_AT = 67000;

// The usual band holding this many times the upper one's noise holds a subsidiary carrier
var OCCUPIED = 4;

// The receiver gives the carrier's swing as 32768 x swing / sample rate, and a pilot
// swings the carrier by 6.75 kHz, some stations a little less or more
var FULL_SCALE = 32768;
var PILOT_SWING = 6750;

// A pilot this far above the noise is one (dB); with none, a carrier this far clear of
// the noise is a station received without one, and stays one while it is clear by
// CARRIER_HELD: a station at the edge would otherwise show a level one second and none
// the next
var PILOT_STANDS = 6;
var CARRIER_CLEAR = 26;
var CARRIER_HELD = 24;

// A station known to send no pilot (the scan listed it so) is read by its carrier from
// this on (dB). Through a wide receiver a weak station's carrier reads lower than in the
// scan: one that surveys at 27 dB read 27.0 at 171k, 24.1 at 240k and 22.7 at 300k,
// where frequencies with nothing on them read 17.4 to 19.8.
var CARRIER_KNOWN = 21;

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

// The signal is the receiver's as it demodulates it: not de-emphasised (that is done to
// the sound, after this), or the noise band would read lower than it is.
// options.mono: the station is known to send no pilot
// options.onReading(smoothedDb, thisReadingDb, mono): called once a second. mono: the
//   reading is taken from the carrier, there being no pilot
function FmQuality(sampleRate, options) {
  options = options || {};
  this.sampleRate = sampleRate;
  this.size = Math.floor(sampleRate / 8);
  this.onReading = options.onReading || function() {};
  this.block = new Float64Array(this.size);
  this.filled = 0;
  this.skip = 0;
  this.carry = null;
  this.smoothed = null;
  this.smoothedQuiet = null;
  this.byCarrier = false;
  this.knownMono = !!options.mono;
  this.lower = null;
  this.upper = null;

  var sum = 0;
  this.window = new Float64Array(this.size);
  for (var i = 0; i < this.size; i++) {
    this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.size - 1));
    sum += this.window[i];
  }
  // what a tone of the usual pilot's swing shows in a block
  this.usualPilot = Math.pow(FULL_SCALE * PILOT_SWING / sampleRate * sum / 2, 2);

  // each place measured; in the upper band its noise is referred to the usual place
  function place(frequency, refer) {
    return { frequency: frequency, weight: refer };
  }
  this.pilotAt = place(PILOT, 1);
  this.lowerAt = NOISE_BAND.map(function(frequency) { return place(frequency, 1); });
  this.upperAt = UPPER_BAND.filter(function(frequency) {
    return frequency + 2000 < sampleRate / 2;
  }).map(function(frequency) {
    return place(frequency, (NOISE_AT / frequency) * (NOISE_AT / frequency));
  });
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

// The mean power of the block at some places, each weighted
FmQuality.prototype._mean = function(places) {
  var sum = 0;
  for (var i = 0; i < places.length; i++) {
    sum += this._power(places[i].frequency) * places[i].weight;
  }
  return sum / places.length;
};

FmQuality.prototype._read = function() {
  var pilot = this._power(this.pilotAt.frequency) * this.pilotAt.weight;
  var noise = this._mean(this.lowerAt);
  var upper = this.upperAt.length ? this._mean(this.upperAt) : 0;

  // Silence in, nothing to say
  if (!(noise > 0) || !(pilot > 0)) {
    return;
  }

  // A subsidiary carrier is there all the time: it is told from what the two bands have
  // held of late, not from one reading, where noise can sit that far apart by chance
  this.lower = this.lower === null ? noise : this.lower * (1 - SMOOTHING) + noise * SMOOTHING;
  this.upper = this.upper === null ? upper : this.upper * (1 - SMOOTHING) + upper * SMOOTHING;
  if (upper > 0 && this.lower > OCCUPIED * this.upper) {
    noise = upper;
  }

  var db = 10 * Math.log10(pilot / noise);
  var quiet = 10 * Math.log10(this.usualPilot / noise);
  this.smoothed = this.smoothed === null ? db : this.smoothed * (1 - SMOOTHING) + db * SMOOTHING;
  this.smoothedQuiet = this.smoothedQuiet === null ? quiet : this.smoothedQuiet * (1 - SMOOTHING) + quiet * SMOOTHING;

  // No pilot, and a carrier clear of the noise: a station without one, read by its carrier
  this.byCarrier = this.smoothed < PILOT_STANDS &&
    this.smoothedQuiet >= (this.knownMono ? CARRIER_KNOWN : this.byCarrier ? CARRIER_HELD : CARRIER_CLEAR);
  if (this.byCarrier) {
    this.onReading(this.smoothedQuiet, quiet, true);
  } else {
    this.onReading(this.smoothed, db, false);
  }
};

module.exports = FmQuality;
module.exports.parseRate = parseRate;
module.exports.level = level;
