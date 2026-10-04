'use strict';

// Which channels of an FM band survey are stations.
//
// The survey (fn-rtl-gain -b) measures every channel of the band; it does not decide.
// Power alone says little: next to a strong station its neighbours hold power too, and
// a tuner driven too hard manufactures signals that are not on the air. A channel is
// taken for a station when
//   - it holds more than both its neighbours (a station spills into the channels next
//     to it, and the pilot can be heard there too),
//   - the 19 kHz pilot of a stereo broadcast stands clear of the noise, throughout the
//     time it was listened to,
//   - its carrier lies on the channel, and
//   - the pilot is still there with the gain taken down: a station keeps it, a signal
//     made in the tuner goes with the overload that made it.
//
// Noise alone does not pass: a pilot reading of noise is around 0 dB and scattered, and
// every reading of the time listened must stand clear.

var FmQuality = require('./fmquality');

// How far a carrier may lie from the centre of its channel (Hz). A transmitter is
// within a kilohertz or two; the reading of a faint station wanders by a few more.
var OFF_CHANNEL = 15000;

// The pilot must stay within this (dB) of the threshold in its weakest reading
var MAY_DIP = 4;

// A pilot that falls by more than this (dB) when the gain is lowered was made in the tuner
var MAY_FALL = 10;

function fields(line) {
  var out = {};
  line.split(/\s+/).slice(1).forEach(function(pair) {
    var at = pair.indexOf('=');
    if (at > 0) {
      out[pair.slice(0, at)] = pair.slice(at + 1);
    }
  });
  return out;
}

function number(text) {
  var value = Number(text);
  return text === undefined || text === '-' || !isFinite(value) ? null : value;
}

// What the survey printed: { slices: [...], channels: [...] }, numbers as numbers,
// what was not measured as null.
function parse(text) {
  var survey = { slices: [], channels: [] };
  String(text || '').split('\n').forEach(function(line) {
    if (line.indexOf('SLICE:') === 0) {
      var s = fields(line);
      survey.slices.push({
        freq: number(s.freq), gain: number(s.gain), step: number(s.step), of: number(s.of),
        level: number(s.level), cut: number(s.cut), backoff: number(s.backoff) || 0, floor: number(s.floor)
      });
    } else if (line.indexOf('CHANNEL:') === 0) {
      var c = fields(line);
      if (number(c.freq) !== null) {
        survey.channels.push({
          freq: number(c.freq), rf: number(c.rf), top: c.top === '1',
          pilot: number(c.pilot), low: number(c.low), offset: number(c.offset), again: number(c.again)
        });
      }
    }
  });
  return survey;
}

// The pilot (dB above the noise) a channel must show for the scan sensitivity the user
// chose: the setting is that figure, from "weaker signals" (+3 dB) to "very strong
// signals only" (+15 dB).
function threshold(sensitivity) {
  var value = Number(sensitivity);
  if (!isFinite(value)) {
    value = 8;
  }
  return Math.max(3, Math.min(30, value));
}

// Why a channel is no station, or null when it is one
function refused(channel, needed) {
  if (!channel.top) {
    return 'neighbour';
  }
  if (channel.pilot === null || channel.pilot < needed || channel.low === null || channel.low < needed - MAY_DIP) {
    return 'no pilot';
  }
  if (channel.offset !== null && Math.abs(channel.offset) > OFF_CHANNEL) {
    return 'off channel';
  }
  if (channel.again !== null && channel.again < channel.pilot - MAY_FALL) {
    return 'made in the tuner';
  }
  return null;
}

// The stations of a survey: [{ freq (Hz), rf, pilot, low, offset, level (1 to 5) }],
// rising in frequency. options.sensitivity: the scan sensitivity setting.
function stations(survey, options) {
  var needed = threshold(options && options.sensitivity);
  return survey.channels.filter(function(channel) {
    return refused(channel, needed) === null;
  }).map(function(channel) {
    return {
      freq: channel.freq, rf: channel.rf, pilot: channel.pilot, low: channel.low,
      offset: channel.offset, level: FmQuality.level(channel.pilot)
    };
  }).sort(function(a, b) { return a.freq - b.freq; });
}

// The channels that looked like stations and were found to be made in the tuner
function ghosts(survey, options) {
  var needed = threshold(options && options.sensitivity);
  return survey.channels.filter(function(channel) {
    return refused(channel, needed) === 'made in the tuner';
  });
}

module.exports = {
  parse: parse,
  stations: stations,
  ghosts: ghosts,
  threshold: threshold
};
