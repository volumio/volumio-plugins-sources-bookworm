'use strict';

// Which channels of an FM band survey are stations.
//
// The survey (fn-rtl-gain -b) measures every channel of the band; it does not decide.
// Power alone says little: next to a strong station its neighbours hold power too, and
// a tuner driven too hard manufactures signals that are not on the air. A channel is
// taken for a station when
//   - it is not one of a neighbour's: neither channel next to it holds clearly more (a
//     station spills into the channels next to it, and the pilot can be heard there
//     too), and of channels next to each other that all pass for stations, as those
//     either side of a weak station can, it is the one that shows the station best
//     (unless it shows a carrier of its own: two weak stations can sit 100 kHz apart),
//   - the 19 kHz pilot of a stereo broadcast stands clear of the noise, throughout the
//     time it was listened to,
//   - its carrier lies on the channel,
//   - beside a far stronger station, a faint pilot reads no worse with the channel
//     taken in more narrowly: a weak station reads better so, while what the strong one
//     spills 200 kHz from its carrier, its pilot with it, lies to one side of the
//     channel and reads worse, and
//   - the pilot is still there with the gain taken down: a station keeps it, a signal
//     made in the tuner goes with the overload that made it (where the tuner is driven
//     hard, beside a very strong station, it may hardly fall at all), and
//   - where the survey found it to be largely the turned-over copy of a stronger channel
//     at its mirror place (a tuner that mixes straight to zero, an E4000, makes such
//     copies, pilot and all), the pilot is still there with the tuner set elsewhere: a
//     station stays, a copy moves away with the tuning.
//
// A station that sends no pilot (mono) has only its carrier to be known by, and is
// taken for one when
//   - the carrier stands clear of the noise by what a fair stereo station's pilot does
//     (quiet: a channel with no station reads 17 to 24 dB on that measure, so a mono
//     station has to be received fairly well to be told from one),
//   - a weak one is free of the clicks of a signal the receiver cannot hold, which
//     throw the carrier far beyond where a broadcast goes,
//   - a programme swings it, at the first look or at the one with the gain lower: a bare
//     carrier (a spur) is swung by nothing, and so is a mono station in a pause, which
//     cannot be told from one,
//   - and it passes the same second looks, on the same measure.
//
// Noise alone does not pass: a pilot reading of noise is around 0 dB and scattered, and
// every reading of the time listened must stand clear.
//
// A station the list holds already stays on a little less than a new one must show.
// Reception moves by a few decibels from day to day, and a station at the edge of what
// is asked would otherwise come and go from scan to scan. A weak one beside a strong
// station moves most: the strong one's programme reaches into its channel. Read more
// narrowly its pilot is steady, and that reading holds it in the list.

var FmQuality = require('./fmquality');

// How far a carrier may lie from the centre of its channel (Hz). A transmitter is
// within a kilohertz or two; the reading of a faint station wanders by a few more.
var OFF_CHANNEL = 15000;

// The pilot must stay within this (dB) of the threshold in its weakest reading
var MAY_DIP = 4;

// A pilot that falls by more than this (dB) when the gain is lowered was made in the
// tuner, unless what is left is still a plain pilot (STILL_PLAIN, dB): the reading of a
// very strong station moves by that much from one look to the next (57 dB, then 45, on
// a station of 55), while what a tuner made was never above 6 dB at the lower gain.
var MAY_FALL = 10;
var STILL_PLAIN = 25;

// Where the tuner is driven hard it makes many such signals, and faint ones that fall by
// less. That is in a slice of the band the survey had to take the gain down for, or
// one it surveyed with this much less gain (dB) than another: a very strong station
// is in it. There a station's pilot holds or rises with the gain lowered (it fell by
// 2.6 dB at most, in 35 readings beside a station of 55 dB), and what the tuner made
// fell by 3.7 dB and more: a faint pilot may fall by no more than HARD_MAY_FALL. (What
// the tuner made was faint every time, 7 to 14 dB. A strong station's reading moves
// with its programme, 56 dB at one look and 51 at the next, and is judged as anywhere.)
var HARD_BELOW = 12;
var HARD_MAY_FALL = 3;
var HARD_FAINT = 25;

// And so was one that is not there at all with the gain lowered: a reading of noise is
// around 0 dB, the faintest station seen kept 3 dB. (A faint signal the tuner made
// cannot fall by MAY_FALL: it has not that far to fall.)
var STILL_THERE = 2;

// A pilot from here on (dB) is no chance reading of noise: gone with the gain lowered,
// it was made in the tuner. A fainter one that is gone was noise.
var PLAIN_PILOT = 6;

// A station this much stronger (dB of pilot) no further away than this (Hz) may be
// what a faint pilot comes from: its spill. Then the faint one may read this much
// worse (dB) through the narrower filter and still be a station's own: weak stations
// read 1 to 7 dB better through it, a strong neighbour's spill 3 to 9 dB worse.
var SPILL_OVER = 20;
var SPILL_REACH = 300000;
var NARROW_MAY_LOSE = 1;

// A station without a pilot: its carrier this far clear of the noise (dB, on the scale
// of the pilot: of some 250 channels with no station on them, surveyed with five
// dongles, none read above 24.2), and still this far with the gain lowered;
var MONO_QUIET = 26;
var MONO_HELD = 24;
// unless it is received plainly (dB), beyond a broadcast's limit no more than this
// share of the time (percent: a weak carrier reads 0.2 to 0.6 through an R820T and up
// to 1.1 through an E4000, a channel with none 2 and more; a plain station modulating
// as far as 95 kHz reads 1.5, and is a station);
var MONO_PLAIN = 40;
var MONO_WIDE = 1.5;
// swung by a programme at least this far (kHz rms: a carrier that wanders and hums
// reads up to 1.7, a quiet passage 26 dB under full modulation 3.3)
var MONO_SWING = 2.5;

// Stations cannot be received this close to each other (Hz): of channels no further
// apart that pass for stations, one is the station and the others hear it
var TOO_CLOSE = 100000;

// A weak station beside another has a carrier of its own when the power at the centre
// of its channel stands this far (dB) above the places 50 kHz either side, and its
// pilot reads this much better (dB) through the narrower filter. As surveyed: two weak
// stations on 96.6 and 96.7 MHz, 0.8 to 5.3 dB and 2 to 6 dB; channels that only heard
// the station next to them, 0.5 dB at most, and most of them worse through the filter.
var OWN_PEAK = 0.6;
var OWN_NARROWER = 2;

// A station the list holds already: its pilot may be this much weaker than a new one's
// (dB), down to the least any setting asks for, or stand as far above the noise as a
// new one's must when read through the narrower filter; one without a pilot may show
// its carrier as it must with the gain lowered, and may be in a pause
var HELD_BY = 3;

// The carriers of stations received this well (dB) tell how far the dongle tunes off;
// from this many of them, when half of them or more lie within this (ppm) of the middle
// one. (Not all of them will: the transmitters of one network can share an error of
// their own. As surveyed, six stations of twenty-two sat 4 kHz low together.)
var ERROR_FROM = 25;
var ERROR_STATIONS = 5;
var ERROR_AGREE = 10;

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
  var within = [];
  String(text || '').split('\n').forEach(function(line) {
    if (line.indexOf('SLICE:') === 0) {
      var s = fields(line);
      survey.slices.push({
        freq: number(s.freq), gain: number(s.gain), step: number(s.step), of: number(s.of),
        level: number(s.level), cut: number(s.cut), backoff: number(s.backoff) || 0, floor: number(s.floor)
      });
    } else if (line.indexOf('CHANNEL:') === 0) {
      within.push(survey.slices.length - 1);
      var c = fields(line);
      if (number(c.freq) !== null) {
        survey.channels.push({
          freq: number(c.freq), rf: number(c.rf), top: c.top === '1',
          pilot: number(c.pilot), low: number(c.low), offset: number(c.offset), again: number(c.again),
          mirror: number(c.mirror), moved: number(c.moved), least: number(c.least),
          quiet: number(c.quiet), swing: number(c.swing), wide: number(c.wide), narrow: number(c.narrow), own: number(c.own),
          againq: number(c.againq), agains: number(c.agains), movedq: number(c.movedq), hard: false
        });
      } else {
        within.pop();
      }
    }
  });
  // The channels of a slice the tuner was driven hard in: see HARD_BELOW
  var most = Math.max.apply(null, survey.slices.map(function(slice) { return slice.gain === null ? -Infinity : slice.gain; }));
  survey.channels.forEach(function(channel, i) {
    var slice = survey.slices[within[i]];
    channel.hard = !!slice && (slice.backoff > 0 || (slice.gain !== null && slice.gain <= most - HARD_BELOW));
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

// Whether a channel without a pilot shows the carrier of a mono station. known: the list
// holds a station there already.
function mono(channel, known) {
  return channel.quiet !== null && channel.quiet >= (known ? MONO_HELD : MONO_QUIET) &&
    (channel.quiet >= MONO_PLAIN || (channel.wide !== null && channel.wide <= MONO_WIDE)) &&
    (known || (channel.swing !== null && Math.max(channel.swing, channel.agains === null ? 0 : channel.agains) >= MONO_SWING));
}

// What a channel is: { station: 'stereo' | 'mono' } or { refused: why }. needed: the
// pilot a station must show. known: the list holds a station there already.
function verdict(channel, needed, known) {
  if (!channel.top) {
    return { refused: 'neighbour' };
  }
  var narrowly = known && channel.narrow !== null && channel.narrow >= needed;
  if (known) {
    needed = Math.max(threshold(0), needed - HELD_BY);
  }
  var stereo = channel.pilot !== null && ((channel.pilot >= needed && channel.low !== null && channel.low >= needed - MAY_DIP) || narrowly);
  if (!stereo && !mono(channel, known)) {
    return { refused: 'no pilot' };
  }
  if (channel.offset !== null && Math.abs(channel.offset) > OFF_CHANNEL) {
    return { refused: 'off channel' };
  }
  if (stereo) {
    var fell = channel.again !== null && channel.again < STILL_PLAIN &&
      channel.again < channel.pilot - (channel.hard && channel.pilot < HARD_FAINT ? HARD_MAY_FALL : MAY_FALL);
    if (channel.again !== null && (fell || channel.again < STILL_THERE)) {
      // a pilot too faint to have been anything but a reading of noise: just not there again
      return { refused: channel.pilot < PLAIN_PILOT ? 'not there again' : 'made in the tuner' };
    }
    // Doubted as a mirror and looked at with the tuner set elsewhere: what is there must be
    // a station by the same measure as at first, the pilot and its weakest reading. One
    // reading of noise can look like a pilot; every reading of a look does not.
    // (Doubted and not looked at, the second look having failed: it is left in.)
    if (channel.mirror !== null && channel.moved !== null &&
        (channel.moved < needed || (channel.least !== null && channel.least < needed - MAY_DIP))) {
      return { refused: 'mirror' };
    }
    return { station: 'stereo' };
  }
  // The same two looks for a station without a pilot, on its carrier
  if (channel.againq !== null && (channel.againq < channel.quiet - MAY_FALL || channel.againq < MONO_HELD)) {
    return { refused: 'made in the tuner', mono: true };
  }
  if (channel.mirror !== null && channel.movedq !== null && channel.movedq < (known ? MONO_HELD : MONO_QUIET)) {
    return { refused: 'mirror', mono: true };
  }
  return { station: 'mono' };
}

// The frequencies (Hz) the list holds stations on, as a test: options.known is a list of them
function knownIn(options) {
  var held = {};
  ((options && options.known) || []).forEach(function(hz) {
    held[Math.round(Number(hz) / 1000)] = true;
  });
  return function(channel) {
    return held[Math.round(channel.freq / 1000)] === true;
  };
}

// The stations of a survey: [{ freq (Hz), rf, pilot, low, offset, level (1 to 5), mono, held }],
// rising in frequency. options.sensitivity: the scan sensitivity setting. options.known:
// the frequencies (Hz) the list holds stations on already; held marks a station that is
// one only because it is among them.
// A station that had a stronger one's mirror lying on it is given the pilot and the
// weakest reading measured with the tuner set elsewhere: those are the station's own.
// A mono station has no pilot: it is given, as its pilot, what a pilot would read on it.
function stations(survey, options) {
  return judged(survey, options).stations;
}

// The survey judged: { stations, beside, spill }. beside: the channels that pass for
// stations and are left out for a channel next to them that shows the station better.
// spill: those left out as what a far stronger station spills.
function judged(survey, options) {
  var needed = threshold(options && options.sensitivity);
  var known = knownIn(options);
  var list = [];
  // Channels that carry a strong signal the scan refuses as no station of theirs (made
  // in the tuner, the tuner's mirror; below, what a stronger station spills): what
  // stands beside one of them and shows the signal less well is its skirt and no station
  // of its own. Nothing else shadows: a weak station is what is on the air, and is
  // listed; what is not wanted is the user's to delete.
  var shadow = [];
  survey.channels.forEach(function(channel) {
    var found = verdict(channel, needed, known(channel));
    if (found.refused) {
      if (!found.mono && (found.refused === 'made in the tuner' || found.refused === 'mirror') && channel.pilot !== null) {
        shadow.push({ freq: channel.freq, shows: channel.narrow !== null ? channel.narrow : 100 + channel.pilot });
      }
      return;
    }
    var held = known(channel) && !!verdict(channel, needed, false).refused;
    if (found.station === 'mono') {
      var quiet = channel.mirror !== null && channel.movedq !== null ? channel.movedq : channel.quiet;
      list.push({ freq: channel.freq, rf: channel.rf, pilot: quiet, low: quiet, offset: channel.offset, level: FmQuality.level(quiet), mono: true, held: held,
        narrow: null });
      return;
    }
    var own = channel.mirror !== null && channel.moved !== null;
    var pilot = own ? channel.moved : channel.pilot;
    list.push({
      freq: channel.freq, rf: channel.rf, pilot: pilot, low: own && channel.least !== null ? channel.least : Math.min(channel.low, pilot),
      offset: channel.offset, level: FmQuality.level(pilot), mono: false, held: held, narrow: channel.narrow,
      // a carrier of its own: the peak, and for a faint pilot the better reading more narrowly
      // (a pilot that is not faint is given no such reading, and needs none)
      ownCarrier: channel.own !== null && channel.own >= OWN_PEAK &&
        (channel.narrow !== null ? channel.narrow >= channel.pilot + OWN_NARROWER : channel.pilot >= HARD_FAINT)
    });
  });

  // What a far stronger station spills: a faint pilot beside it that reads worse with
  // the channel taken in more narrowly
  var spill = [];
  list = list.filter(function(station) {
    var spilt = station.narrow !== null && station.narrow < station.pilot - NARROW_MAY_LOSE && list.some(function(other) {
      return other.pilot >= station.pilot + SPILL_OVER && Math.abs(other.freq - station.freq) <= SPILL_REACH + 1;
    });
    if (spilt) {
      spill.push(station);
    }
    return !spilt;
  });

  // Of channels too close to each other, the one that shows the station best is it: the
  // strongest first (a faint one by its reading through the narrower filter, which tells
  // a station's own channel from the one next to it far better), and none taken that
  // lies too close to one taken already, unless it shows a carrier of its own. One the
  // list holds counts for a little more: it is not given up for its neighbour on a
  // reading that is as good by chance.
  // (A pilot that is not faint has no reading through the narrower filter, and comes
  // before every faint one: the two readings are not on one scale.)
  // Nor is a channel taken that lies too close to a stronger signal that was refused
  // (spilt by a stronger station, made in the tuner, the tuner's mirror): the channels
  // either side of such a signal would otherwise stand in its place.
  function shows(station) {
    return (station.narrow !== null ? station.narrow : 100 + station.pilot) + (known(station) ? HELD_BY : 0);
  }
  spill.forEach(function(station) {
    shadow.push({ freq: station.freq, shows: station.narrow !== null ? station.narrow : 100 + station.pilot });
  });
  var taken = [];
  var beside = [];
  list.slice().sort(function(a, b) { return shows(b) - shows(a) || a.freq - b.freq; }).forEach(function(station) {
    var close = taken.some(function(other) { return Math.abs(other.freq - station.freq) <= TOO_CLOSE + 1; }) ||
      (!station.mono && shadow.some(function(other) { return Math.abs(other.freq - station.freq) <= TOO_CLOSE + 1 && other.shows > shows(station); }));
    if (close && !station.ownCarrier) {
      beside.push(station);
      // and what it shadows in turn, it keeps from standing in its place
      if (!station.mono) {
        shadow.push({ freq: station.freq, shows: shows(station) });
      }
    } else {
      taken.push(station);
    }
  });
  function rising(a, b) { return a.freq - b.freq; }
  function plain(station) {
    delete station.narrow;
    delete station.ownCarrier;
    return station;
  }
  return { stations: taken.sort(rising).map(plain), beside: beside.sort(rising).map(plain), spill: spill.sort(rising).map(plain) };
}

// What a scan would say of every channel of a survey, for showing to the user. says:
// 'stereo' or 'mono' for a channel it would list; else why not: 'beside' (the channel
// next to it shows the same station better), 'spill' (what a far stronger station
// spills), or the reason the channel was refused for ('neighbour', 'no pilot', 'off
// channel', 'made in the tuner', 'not there again', 'mirror'). reading: what the channel
// is judged by, in dB: the pilot over the noise, or for a station without a pilot how
// clear its carrier is of it; null where the channel was not listened to.
function said(survey, options) {
  var needed = threshold(options && options.sensitivity);
  var known = knownIn(options);
  var result = judged(survey, options);
  var listed = {};
  result.stations.forEach(function(station) { listed[station.freq] = { says: station.mono ? 'mono' : 'stereo', station: station }; });
  result.beside.forEach(function(station) { listed[station.freq] = { says: 'beside', station: station }; });
  result.spill.forEach(function(station) { listed[station.freq] = { says: 'spill', station: station }; });
  return survey.channels.map(function(channel) {
    var found = listed[channel.freq];
    if (found) {
      return { freq: channel.freq, says: found.says, reading: found.station.pilot, level: found.station.level,
        mono: found.station.mono, offset: channel.offset };
    }
    var why = verdict(channel, needed, known(channel));
    var reading = why.mono ? channel.quiet : channel.pilot;
    return { freq: channel.freq, says: why.refused, reading: reading === undefined ? null : reading, level: null,
      mono: !!why.mono, offset: channel.offset === undefined ? null : channel.offset };
  });
}

// How far the dongle tunes off, told from the carriers of a survey's stations: a
// dongle's crystal is off by a fixed share of the frequency, so every station lies off
// its channel by the same share. { ppm, stations }: the correction, in parts per
// million, that puts the stations on their channels (what the tools take as -p, on top
// of the one the survey was made with), and how many stations it was told from. null
// when too few stations are received well enough to tell, or they do not agree.
// Transmitters that are themselves off their frequency, alone or several together, are
// a minority among them: the middle one is taken, and then the middle of those that
// agree with it.
function tuningError(survey, options) {
  var errors = stations(survey, options).filter(function(station) {
    return station.pilot >= ERROR_FROM && station.offset !== null;
  }).map(function(station) {
    return -station.offset / station.freq * 1e6;
  }).sort(function(a, b) { return a - b; });
  if (errors.length < ERROR_STATIONS) {
    return null;
  }
  function middle(list) {
    return list.length % 2 ? list[(list.length - 1) / 2] : (list[list.length / 2 - 1] + list[list.length / 2]) / 2;
  }
  var centre = middle(errors);
  var agreeing = errors.filter(function(error) { return Math.abs(error - centre) <= ERROR_AGREE; });
  if (agreeing.length < ERROR_STATIONS || agreeing.length * 2 < errors.length) {
    return null;
  }
  return { ppm: Math.round(middle(agreeing)), stations: agreeing.length };
}

// The channels that looked like stations and were refused for one reason. One that was
// taken for a station without a pilot is marked mono: it was judged by its carrier
// (quiet, againq, movedq), not by a pilot.
function refusedAs(survey, options, why) {
  var needed = threshold(options && options.sensitivity);
  var known = knownIn(options);
  var list = [];
  survey.channels.forEach(function(channel) {
    var found = verdict(channel, needed, known(channel));
    if (found.refused === why) {
      list.push(found.mono ? Object.assign({}, channel, { mono: true }) : channel);
    }
  });
  return list;
}

// The channels that looked like stations and were found to be made in the tuner
function ghosts(survey, options) {
  return refusedAs(survey, options, 'made in the tuner');
}

// The channels that looked like stations and were found to be a tuner's mirror of another
function mirrors(survey, options) {
  return refusedAs(survey, options, 'mirror');
}

module.exports = {
  parse: parse,
  stations: stations,
  ghosts: ghosts,
  mirrors: mirrors,
  judged: judged,
  said: said,
  tuningError: tuningError,
  threshold: threshold
};
