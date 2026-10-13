'use strict';

// A report on the dongle that is plugged in.
//
// There are hundreds of RTL-SDR dongles, and what one of them does in the plugin can
// only be seen on that dongle. The report runs the plugin's own tools on it in a fixed
// order and keeps what they say, with short recordings of what the dongle delivers:
//   - what the dongle calls itself, its tuner and its gain steps, and whether it loses
//     samples (fn-rtl_test),
//   - the gain tool's check of itself, which needs no dongle (fn-rtl-gain -t),
//   - the survey of the FM band the scan is made from (fn-rtl-gain -b), and the stations
//     the scan would list from it at each sensitivity,
//   - the gain measured for the strongest stations (fn-rtl-gain -f),
//   - recordings (fn-rtl_sdr): the FM slice with the strongest station at a row of gains
//     and once with the tuner set half a megahertz higher (what moves with the tuning is
//     made in the dongle), the slice with the most stations, and two DAB channels of the
//     user's own list.
// It ends as a folder with a summary to read (report.txt), the same as data
// (report.json), the tools' own output and the recordings; the Station Manager hands it
// out as one ZIP file. The recordings are named as the project's bench names them, so
// the tools that read a survey taken on the test player read a user's report too.
//
// The dongle is taken as a job of the tuner, like a scan: nothing else can use it
// meanwhile, and whatever was playing is stopped before. A station started while the
// report is being made takes the dongle back, and the report ends there.
//
// The report is put together on the player's own storage, not in memory: the recordings
// come to some forty megabytes, and the smallest boards have little memory to spare.
// With too little room left for them the recordings are left out and the report says so.

var fs = require('fs-extra');
var path = require('path');
var fmscan = require('./fmscan');
var snr = require('./snr');

// The shape of report.json; raised when it changes
var REPORT_FORM = 3;

var FM_RATE = 2400000;       // samples a second of an FM recording: one slice of the survey
var DAB_RATE = 2048000;      // of a DAB recording: what the decoder works at
var MOVED = 500000;          // Hz the tuner is set higher for the second look at a slice
var SLICE_HALF = 1000000;    // a station belongs to the slice whose centre is within this

var TEST_MS = 8000;          // fn-rtl_test reads this long: time enough to lose samples
var RECORD_MS = 1700;        // a recording: about a second of samples once the tuner has settled
var SELFTEST_LIMIT = 30000;
var SURVEY_LIMIT = 600000;   // the survey takes under a minute on a Pi 5, minutes on the slowest boards
var GAIN_LIMIT = 120000;
var END_WAIT = 2500;         // a tool asked to end has this long before it is killed
var STRONGEST = 6;           // stations whose gain is measured one by one
var DAB_CHANNELS = 2;        // DAB channels recorded
var ROOM_NEEDED = 200 * 1048576;  // bytes free before recordings are made: they are kept twice for a moment

var SENSITIVITIES = [8, 5, 3];

// What went wrong, as a word the page can put into the user's language
function ReportError(code, message) {
  var error = new Error(message || code);
  error.code = code;
  error.report = true;
  return error;
}

// --- reading what the tools print ------------------------------------------------------

// What fn-rtl_test printed: the dongle's own name, its tuner, its gain steps, and
// whether samples were lost while it read.
function parseTest(text) {
  text = String(text || '');
  var device = /^\s*0:\s*(.+)$/m.exec(text);
  var tuner = /^Found (.+) tuner\s*$/m.exec(text);
  var gains = /Supported gain values \(\d+\):\s*([-\d. ]+)/.exec(text);
  var perMillion = /Samples per million lost \(minimum\):\s*(-?\d+)/.exec(text);
  var lost = 0;
  text.replace(/lost at least (\d+) bytes/g, function(all, bytes) {
    lost += Number(bytes);
    return all;
  });
  return {
    found: !!tuner,
    // a dongle without a serial number ends its name with an empty "SN:"
    device: device ? device[1].trim().replace(/,\s*SN:\s*$/, '') : null,
    tuner: tuner ? tuner[1].trim() : null,
    gains: gains ? gains[1].trim().split(/\s+/).map(Number).filter(isFinite) : [],
    lostBytes: lost,
    lostPerMillion: perMillion ? Number(perMillion[1]) : null
  };
}

// The gain tool's verdict on itself: { ok, line }
function parseSelftest(text) {
  var line = /^selftest:.*$/m.exec(String(text || ''));
  return { ok: !!line && /^selftest:\s*ok\b/.test(line[0]), line: line ? line[0].trim() : null };
}

// The gains measured station by station: [{ freq, gain, step, of, level, cut, backoff }]
function parseGains(text) {
  var list = [];
  String(text || '').split('\n').forEach(function(line) {
    if (line.indexOf('GAIN:') !== 0) {
      return;
    }
    var found = {};
    line.split(/\s+/).slice(1).forEach(function(pair) {
      var at = pair.indexOf('=');
      if (at > 0 && isFinite(Number(pair.slice(at + 1)))) {
        found[pair.slice(0, at)] = Number(pair.slice(at + 1));
      }
    });
    if (found.freq) {
      list.push(found);
    }
  });
  return list;
}

// --- choosing what to record -----------------------------------------------------------

function gainName(gain) {
  return Number(gain).toFixed(1);
}

function sliceOf(survey, freq) {
  var best = null;
  survey.slices.forEach(function(slice) {
    if (Math.abs(slice.freq - freq) <= SLICE_HALF && (!best || Math.abs(slice.freq - freq) < Math.abs(best.freq - freq))) {
      best = slice;
    }
  });
  return best;
}

// The recordings to make: [{ kind, freq (Hz the tuner is set to), rate, gain, file, why }].
// survey: the FM survey as fmscan.parse gives it; stations: what the scan lists from it;
// gains: the tuner's gain steps, rising; dabChannels: the DAB channels of the user's
// list, the fullest first.
function recordings(survey, stations, gains, dabChannels) {
  var plan = [];
  var steps = (gains || []).filter(function(gain) { return gain >= 0; });
  if (steps.length === 0) {
    return plan;
  }
  var top = steps[steps.length - 1];
  var low = steps[Math.floor(steps.length / 4)];
  var middle = steps[Math.floor(steps.length * 2 / 3)];

  function add(kind, freq, rate, gain, why) {
    var file = kind + '-' + Math.round(freq) + '-' + gainName(gain) + '.iq';
    if (!plan.some(function(entry) { return entry.file === file; })) {
      plan.push({ kind: kind, freq: Math.round(freq), rate: rate, gain: Number(gain), file: file, why: why });
    }
  }
  function measured(slice) {
    return slice && slice.gain !== null ? slice.gain : middle;
  }

  var strongest = (stations || []).slice().sort(function(a, b) { return b.rf - a.rf; })[0];
  var strongSlice = strongest ? sliceOf(survey, strongest.freq) : survey.slices[Math.floor(survey.slices.length / 2)];
  if (strongSlice) {
    add('fm', strongSlice.freq, FM_RATE, top, 'the slice with the strongest station, at the highest gain');
    add('fm', strongSlice.freq, FM_RATE, measured(strongSlice), 'the same at the gain the survey chose');
    add('fm', strongSlice.freq, FM_RATE, low, 'the same at a low gain');
    add('fm', strongSlice.freq + MOVED, FM_RATE, measured(strongSlice), 'the same stations with the tuner set 500 kHz higher');
  }

  // The slice with the most stations, when it is another one
  var counts = {};
  (stations || []).forEach(function(station) {
    var slice = sliceOf(survey, station.freq);
    if (slice) {
      counts[slice.freq] = (counts[slice.freq] || 0) + 1;
    }
  });
  var fullest = survey.slices.filter(function(slice) {
    return counts[slice.freq] && (!strongSlice || slice.freq !== strongSlice.freq);
  }).sort(function(a, b) { return counts[b.freq] - counts[a.freq]; })[0];
  if (fullest) {
    add('fm', fullest.freq, FM_RATE, measured(fullest), 'the slice with the most stations, at the gain the survey chose');
  }

  (dabChannels || []).filter(function(channel) {
    return snr.DAB_FREQS[channel];
  }).slice(0, DAB_CHANNELS).forEach(function(channel) {
    add('dab', snr.DAB_FREQS[channel], DAB_RATE, top, 'DAB channel ' + channel + ' at the highest gain');
    add('dab', snr.DAB_FREQS[channel], DAB_RATE, middle, 'DAB channel ' + channel + ' at a middle gain');
  });
  return plan;
}

// --- the summary -----------------------------------------------------------------------

function mhz(hz) {
  return (hz / 1e6).toFixed(hz % 100000 === 0 ? 1 : 2);
}

function pad(text, width) {
  text = String(text);
  return text.length >= width ? text : text + new Array(width - text.length + 1).join(' ');
}

function megabytes(bytes) {
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// The report as text, to be read and to be pasted where a report is asked for.
function text(report) {
  var lines = [];
  function row(label, value) {
    lines.push('  ' + pad(label + ':', 22) + value);
  }
  // A table under a title: columns as [heading, width], rows as lists of values
  function table(title, columns, rows) {
    function line(values) {
      return '    ' + values.map(function(value, i) { return pad(value === null || value === undefined ? '-' : value, columns[i][1]); }).join('').replace(/\s+$/, '');
    }
    lines.push('  ' + title);
    lines.push(line(columns.map(function(column) { return column[0]; })));
    rows.forEach(function(values) { lines.push(line(values)); });
  }
  var dongle = report.dongle || {};
  var player = report.player || {};
  var fm = report.fm || {};

  lines.push('FM/DAB Radio dongle report (form ' + report.form + ')');
  lines.push('Made ' + report.made + ' by plugin ' + (player.plugin || '?') + ' on ' +
    [player.board, player.volumio ? 'Volumio ' + player.volumio : null, player.arch].filter(Boolean).join(', '));
  lines.push('');

  lines.push('Dongle');
  row('Calls itself', dongle.device || 'nothing');
  if (dongle.usb) {
    row('USB', [dongle.usb.id, dongle.usb.manufacturer, dongle.usb.product].filter(Boolean).join(' | ') +
      (dongle.usb.port ? ', port ' + dongle.usb.port : '') + (dongle.usb.speed ? ', ' + dongle.usb.speed + ' Mbit/s' : ''));
  }
  row('Tuner', dongle.tuner || 'not recognised');
  row('Gain steps', dongle.gains && dongle.gains.length ?
    dongle.gains.length + ', from ' + gainName(dongle.gains[0]) + ' to ' + gainName(dongle.gains[dongle.gains.length - 1]) +
    ' dB (' + dongle.gains.map(gainName).join(' ') + ')' : 'none reported');
  row('Samples lost', dongle.lostBytes ?
    dongle.lostBytes + ' bytes in ' + (TEST_MS / 1000) + ' s at ' + (FM_RATE / 1e6) + ' million samples a second' :
    'none in ' + (TEST_MS / 1000) + ' s at ' + (FM_RATE / 1e6) + ' million samples a second');
  row('Gain tool check', report.selftest ? (report.selftest.line || 'no answer') : 'not run');
  lines.push('');

  lines.push('FM' + (fm.band ? ' (' + fm.band + ')' : ''));
  if (fm.error) {
    row('Survey', 'failed: ' + fm.error);
  } else if (fm.slices) {
    var backed = fm.slices.filter(function(slice) { return slice.backoff > 0; });
    var chosen = fm.slices.map(function(slice) { return slice.gain; }).filter(function(gain) { return gain !== null; });
    row('Survey', (fm.seconds !== undefined ? fm.seconds.toFixed(1) + ' s, ' : '') + fm.slices.length + ' slices, ' + fm.channels + ' channels');
    row('Gain chosen', chosen.length ? gainName(Math.min.apply(null, chosen)) + ' to ' + gainName(Math.max.apply(null, chosen)) + ' dB; taken down for overload in ' +
      backed.length + ' of ' + fm.slices.length + ' slices' : 'none');
    row('Stations', SENSITIVITIES.map(function(s) {
      return fm.counts[s] + ' at +' + s + ' dB';
    }).join(', ') + ' (the setting here: +' + fm.sensitivity + ' dB)');
    row('Made in the tuner', fm.ghosts.length ? fm.ghosts.map(function(c) { return mhz(c.freq); }).join(', ') + ' MHz (refused)' : 'none refused');
    row('Tuner\'s mirrors', fm.mirrors && fm.mirrors.length ? fm.mirrors.map(function(c) { return mhz(c.freq); }).join(', ') + ' MHz (refused)' : 'none refused');
    row('Dongle\'s tuning', fm.tuning ? (fm.tuning.ppm === 0 ? 'on frequency' : Math.abs(fm.tuning.ppm) + ' parts per million ' +
      (fm.tuning.ppm > 0 ? 'high' : 'low') + ' (' + (Math.abs(fm.tuning.ppm) / 10).toFixed(1) + ' kHz at 100 MHz)') +
      ', by the carriers of ' + fm.tuning.stations + ' stations' : 'not told: too few stations received well, or they do not agree');
    lines.push('');
    table('Slices', [['MHz', 9], ['gain', 7], ['level of 127', 14], ['cut off %', 11], ['taken down', 12], ['floor', 0]],
      fm.slices.map(function(slice) {
        return [mhz(slice.freq), slice.gain === null ? '-' : gainName(slice.gain), slice.level, slice.cut, slice.backoff, slice.floor === null ? '-' : slice.floor];
      }));
    lines.push('');
    table('Stations at +' + fm.sensitivity + ' dB', [['MHz', 9], ['pilot dB', 10], ['weakest', 9], ['carrier Hz', 12], ['power dB', 10], ['', 0]],
      fm.stations.map(function(station) {
        return [mhz(station.freq), station.pilot, station.low, station.offset === null ? '-' : Math.round(station.offset), station.rf,
          station.mono ? 'no pilot (mono): read by its carrier' : ''];
      }));
    if (fm.gains && fm.gains.length) {
      lines.push('');
      table('Gain station by station, on the slice the receiver reads', [['MHz', 9], ['gain', 7], ['step', 8], ['level', 7], ['cut off %', 11], ['taken down', 0]],
        fm.gains.map(function(gain) {
          return [mhz(gain.freq), gainName(gain.gain), gain.step + '/' + gain.of, gain.level, gain.cut, gain.backoff];
        }));
    }
  }
  lines.push('');

  lines.push('Recordings');
  if (!report.recordings || report.recordings.length === 0) {
    lines.push('  none' + (report.recordingsAsked === false ? ' (not asked for)' : ''));
  } else {
    report.recordings.forEach(function(recording) {
      lines.push('  ' + pad(recording.file, 30) + pad(recording.bytes !== undefined ? megabytes(recording.bytes) : 'failed', 10) + recording.why);
    });
  }
  lines.push('');

  lines.push('Settings');
  Object.keys(report.settings || {}).forEach(function(key) {
    row(key, String(report.settings[key]));
  });
  if (report.problems && report.problems.length) {
    lines.push('');
    lines.push('Problems');
    report.problems.forEach(function(problem) {
      lines.push('  ' + problem);
    });
  }
  return lines.join('\n') + '\n';
}

// --- running it ------------------------------------------------------------------------

// options:
//   acquire   function() -> promise of a job of the plugin's tuner that may run several
//             processes one after another (lib/tuner.js, keepOpen)
//   logger    { info, error }
//   dir       a folder of the report's own: emptied at every start, it holds the files
//             while the report is made and the ZIP file afterwards
//   room      function(dir) -> promise of the bytes free there (for tests)
//   band      function() -> { range: what fn-rtl-gain -b takes, label: the band in words }
//   settings  function() -> { name: value } of the settings that bear on reception
//   player    function() -> { plugin, volumio, board, arch }
//   usb       function() -> { id, manufacturer, product, serial, port, speed } or null
//   dabChannels function() -> the DAB channels of the user's list, the fullest first
//   sensitivity function() -> the scan sensitivity setting
//   slice     function() -> the samples a second the receiver reads the dongle at with
//             the settings as they are: the gain for a station is measured on that slice
//   pack      function(dir, file) -> promise: makes the ZIP file of the folder
//   times     the waits above, for tests
function DongleReport(options) {
  this.options = options;
  this.logger = options.logger || { info: function() {}, error: function() {} };
  this.dir = options.dir;
  this.files = path.join(options.dir, 'files');
  this.room = options.room || function(dir) {
    return fs.promises.statfs(dir).then(function(stats) { return stats.bavail * stats.bsize; });
  };
  this.times = Object.assign({ test: TEST_MS, record: RECORD_MS, selftest: SELFTEST_LIMIT, survey: SURVEY_LIMIT,
    gain: GAIN_LIMIT, end: END_WAIT }, options.times || {});
  this.job = null;
  this.cancelled = false;
  this.state = { phase: 'idle', step: 0, of: 0, at: null, doing: null, error: null, startedAt: null, endedAt: null, summary: null, zip: null };
  this.restore();
}

// The report made before the plugin was last started, if its files are still there:
// it is offered again as it was.
DongleReport.prototype.restore = function() {
  try {
    var report = fs.readJsonSync(path.join(this.files, 'report.json'));
    var name = fs.readdirSync(this.dir).filter(function(entry) { return /^dongle-report-[\d-]+\.zip$/.test(entry); }).sort().pop();
    if (!name || !report.summary) {
      return;
    }
    var stat = fs.statSync(path.join(this.dir, name));
    var steps = report.recordingsAsked === false ? 5 : 6;
    this.state = { phase: 'done', step: steps, of: steps, at: null, doing: null, error: null, startedAt: report.made,
      endedAt: stat.mtime.toISOString(), summary: report.summary, zip: { name: name, path: path.join(this.dir, name), bytes: stat.size } };
  } catch (e) {
    // no report was left, or it cannot be read: there is none to offer
  }
};

// What the page shows: { phase: idle | running | done | failed | cancelled, step, of,
// at, doing, error: { code, message } | null, startedAt, endedAt, summary, zip: { name, bytes } }
DongleReport.prototype.view = function() {
  var view = JSON.parse(JSON.stringify(this.state));
  if (view.zip) {
    delete view.zip.path;
  }
  return view;
};

// The ZIP file of the last report: { name, path, bytes }, or null
DongleReport.prototype.zipFile = function() {
  return this.state.phase === 'done' && this.state.zip ? this.state.zip : null;
};

// The summary of the last report as text, or null
DongleReport.prototype.summaryText = function() {
  try {
    return this.state.phase === 'done' ? fs.readFileSync(path.join(this.files, 'report.txt'), 'utf8') : null;
  } catch (e) {
    return null;
  }
};

DongleReport.prototype.running = function() {
  return this.state.phase === 'running';
};

DongleReport.prototype.log = function(message) {
  this.logger.info('[RTL-SDR Radio] Dongle report: ' + message);
};

// Run a tool of the job to its end. It is asked to end after `ms` (how: the signal; the
// rtl tools end properly on SIGINT and say what they found), killed if it does not.
// Resolves with { code, signal, out, err, overdue }; never rejects.
DongleReport.prototype.tool = function(command, args, ms, how) {
  var self = this;
  return new Promise(function(resolve) {
    var out = '';
    var err = '';
    var overdue = false;
    var child;
    var timer = null;
    var killer = null;
    try {
      child = self.job.run(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }, function(entry) {
        clearTimeout(timer);
        clearTimeout(killer);
        resolve({ code: entry.code, signal: entry.signal, out: out, err: err + (entry.error ? String(entry.error.message || entry.error) : ''), overdue: overdue });
      });
    } catch (e) {
      // The job has been stopped under us
      resolve({ code: null, signal: null, out: '', err: String(e.message || e), overdue: false });
      return;
    }
    if (child.stdout) {
      child.stdout.on('data', function(data) { out += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on('data', function(data) { err += data.toString(); });
    }
    timer = setTimeout(function() {
      overdue = how !== 'SIGINT';
      try { child.kill(how || 'SIGTERM'); } catch (e) { /* gone */ }
      killer = setTimeout(function() {
        overdue = true;
        try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
      }, self.times.end);
    }, ms);
  });
};

// Whether the report may go on: not when it was cancelled, and not when the dongle has
// been taken for something else (a station started meanwhile)
DongleReport.prototype.mayGoOn = function() {
  if (this.cancelled) {
    throw ReportError('cancelled', 'the report was cancelled');
  }
  if (!this.job || this.job.stopping || this.job.finished) {
    throw ReportError('interrupted', 'the dongle was taken for something else');
  }
};

// Go on to the next step. at: its name for the page (test, selftest, survey, gains,
// record, together); doing: the same in words, for the log.
DongleReport.prototype.step = function(at, doing) {
  this.mayGoOn();
  this.state.step++;
  this.state.at = at;
  this.state.doing = doing;
  this.log('step ' + this.state.step + ' of ' + this.state.of + ': ' + doing);
};

// Start a report. options.recordings: false leaves the recordings out. Resolves with
// the view at once; the work goes on and view() tells how far it is.
// Rejects with a ReportError `busy` when one is running.
DongleReport.prototype.start = function(options) {
  var self = this;
  if (self.running()) {
    return Promise.reject(ReportError('busy', 'a report is being made'));
  }
  var wanted = !(options && options.recordings === false);
  self.cancelled = false;
  self.state = { phase: 'running', step: 0, of: wanted ? 6 : 5, at: null, doing: 'waiting for the dongle', error: null,
    startedAt: new Date().toISOString(), endedAt: null, summary: null, zip: null };

  // The report is 'done' (or 'failed', or 'cancelled') only once the dongle is free
  // again: what the view says is then true of the dongle too
  self.work = Promise.resolve(self.options.acquire()).then(function(job) {
    self.job = job;
    return self.make(wanted);
  }).then(function(report) {
    return { phase: 'done', summary: report.summary, error: null };
  }, function(error) {
    var code = error && error.report ? error.code : (error && error.superseded ? 'superseded' : 'failed');
    return { phase: code === 'cancelled' || code === 'superseded' ? 'cancelled' : 'failed', summary: null,
      error: { code: code, message: String((error && error.message) || error) } };
  }).then(function(outcome) {
    var job = self.job;
    self.job = null;
    return Promise.resolve(job ? job.stop('dongle report ended') : null).then(function() {
      return outcome;
    }, function() {
      return outcome;
    });
  }).then(function(outcome) {
    self.state.endedAt = new Date().toISOString();
    self.state.at = null;
    self.state.doing = null;
    self.state.summary = outcome.summary;
    self.state.error = outcome.error;
    self.state.phase = outcome.phase;
    if (outcome.phase === 'done') {
      self.log('done: ' + self.state.zip.name + ', ' + megabytes(self.state.zip.bytes));
    } else {
      self.log(outcome.phase + ': ' + outcome.error.message);
    }
  });
  return Promise.resolve(self.view());
};

// Stop a report that is being made. Resolves when the dongle is free again.
DongleReport.prototype.cancel = function() {
  var self = this;
  if (!self.running()) {
    return Promise.resolve(self.view());
  }
  self.cancelled = true;
  var stopped = self.job ? self.job.stop('dongle report cancelled') : null;
  return Promise.resolve(stopped).then(function() {
    return self.work;
  }).then(function() {
    return self.view();
  });
};

// The steps, one after another. Resolves with the report.
DongleReport.prototype.make = function(wanted) {
  var self = this;
  var o = self.options;
  var job = self.job;
  var report = {
    form: REPORT_FORM,
    made: new Date().toISOString(),
    player: o.player ? o.player() : {},
    settings: o.settings ? o.settings() : {},
    dongle: {},
    selftest: null,
    fm: {},
    recordingsAsked: wanted,
    recordings: [],
    problems: []
  };
  var sensitivity = o.sensitivity ? Number(o.sensitivity()) || 8 : 8;
  var band = o.band();
  var survey = { slices: [], channels: [] };
  var listed = [];

  function keep(name, content) {
    return fs.writeFile(path.join(self.files, name), content);
  }
  function between() {
    self.mayGoOn();
    return job.settle();
  }
  function record(entry) {
    var file = path.join(self.files, entry.file);
    return self.tool('fn-rtl_sdr', ['-f', String(entry.freq), '-s', String(entry.rate), '-g', gainName(entry.gain), file],
      self.times.record, 'SIGINT').then(function(ran) {
      var made = { file: entry.file, kind: entry.kind, freq: entry.freq, rate: entry.rate, gain: entry.gain, why: entry.why };
      return fs.stat(file).then(function(stat) {
        if (stat.size > 0) {
          made.bytes = stat.size;
        }
      }, function() { /* no file */ }).then(function() {
        if (made.bytes === undefined) {
          report.problems.push('recording ' + entry.file + ': ' + (ran.err.trim().split('\n').pop() || 'nothing was written'));
        }
        report.recordings.push(made);
      });
    });
  }

  return fs.emptyDir(self.dir).then(function() {
    return fs.ensureDir(self.files);
  }).then(function() {
    self.step('test', 'asking the dongle what it is and reading from it for ' + Math.round(self.times.test / 1000) + ' seconds');
    return self.tool('fn-rtl_test', ['-s', String(FM_RATE)], self.times.test, 'SIGINT');
  }).then(function(ran) {
    var said = ran.out + ran.err;
    var test = parseTest(said);
    report.dongle = test;
    report.dongle.usb = o.usb ? o.usb() : null;
    return keep('rtl_test.txt', said).then(function() {
      if (!test.found) {
        throw ReportError('no-dongle', (said.trim().split('\n').pop() || 'the dongle did not answer').trim());
      }
      if (ran.overdue) {
        report.problems.push('fn-rtl_test did not end when asked and was killed');
      }
      return between();
    });
  }).then(function() {
    self.step('selftest', 'the gain tool checks itself');
    return self.tool('fn-rtl-gain', ['-t'], self.times.selftest);
  }).then(function(ran) {
    report.selftest = parseSelftest(ran.out);
    if (!report.selftest.ok) {
      report.problems.push('the gain tool\'s check of itself did not pass: ' + (report.selftest.line || ran.err.trim().split('\n').pop() || 'no answer'));
    }
    return keep('selftest.txt', ran.out + ran.err);
  }).then(function() {
    self.step('survey', 'surveying the FM band');
    var began = Date.now();
    return self.tool('fn-rtl-gain', ['-b', band.range].concat(band.args || []), self.times.survey).then(function(ran) {
      report.fm.band = band.label;
      report.fm.sensitivity = sensitivity;
      report.fm.seconds = (Date.now() - began) / 1000;
      return keep('fm-survey.txt', ran.out).then(function() {
        return keep('fm-survey.err', ran.err);
      }).then(function() {
        if (ran.code !== 0) {
          report.fm.error = ran.overdue ? 'the survey did not end in time' : (ran.err.trim().split('\n').pop() || 'fn-rtl-gain ended with code ' + ran.code);
          report.problems.push('FM survey: ' + report.fm.error);
          return;
        }
        survey = fmscan.parse(ran.out);
        listed = fmscan.stations(survey, { sensitivity: sensitivity });
        report.fm.slices = survey.slices;
        report.fm.channels = survey.channels.length;
        report.fm.stations = listed;
        report.fm.ghosts = fmscan.ghosts(survey, { sensitivity: sensitivity });
        report.fm.mirrors = fmscan.mirrors(survey, { sensitivity: sensitivity });
        report.fm.tuning = fmscan.tuningError(survey, { sensitivity: sensitivity });
        report.fm.counts = {};
        SENSITIVITIES.forEach(function(s) {
          report.fm.counts[s] = fmscan.stations(survey, { sensitivity: s }).length;
        });
      });
    });
  }).then(between).then(function() {
    self.step('gains', 'measuring the gain for the strongest stations');
    var strongest = listed.slice().sort(function(a, b) { return b.rf - a.rf; }).slice(0, STRONGEST)
      .sort(function(a, b) { return a.freq - b.freq; });
    if (strongest.length === 0) {
      report.fm.gains = [];
      return;
    }
    var args = [];
    strongest.forEach(function(station) { args.push('-f', String(station.freq)); });
    if (o.slice) {
      args.push('-s', String(o.slice()));
    }
    return self.tool('fn-rtl-gain', args, self.times.gain).then(function(ran) {
      report.fm.gains = parseGains(ran.out);
      if (ran.code !== 0) {
        report.problems.push('gain station by station: ' + (ran.overdue ? 'did not end in time' : (ran.err.trim().split('\n').pop() || 'code ' + ran.code)));
      }
      return keep('fm-gain.txt', ran.out + ran.err);
    });
  }).then(function() {
    if (!wanted) {
      return;
    }
    var plan = recordings(survey, listed, report.dongle.gains, o.dabChannels ? o.dabChannels() : []);
    self.step('record', 'recording what the dongle delivers (' + plan.length + ' recordings)');
    return Promise.resolve(self.room(self.dir)).catch(function() { return Infinity; }).then(function(free) {
      if (free < ROOM_NEEDED) {
        report.problems.push('no recordings: only ' + megabytes(free) + ' free on the player');
        plan = [];
      }
      return plan.reduce(function(before, entry) {
        return before.then(between).then(function() {
          self.mayGoOn();
          return record(entry);
        });
      }, Promise.resolve());
    });
  }).then(function() {
    self.step('together', 'putting the report together');
    report.summary = {
      device: report.dongle.device,
      tuner: report.dongle.tuner,
      gainSteps: report.dongle.gains.length,
      lostBytes: report.dongle.lostBytes,
      selftest: report.selftest ? report.selftest.ok : null,
      stations: report.fm.stations ? report.fm.stations.length : null,
      sensitivity: sensitivity,
      overloaded: report.fm.slices ? report.fm.slices.filter(function(slice) { return slice.backoff > 0; }).length : null,
      mirrors: report.fm.mirrors ? report.fm.mirrors.length : null,
      slices: report.fm.slices ? report.fm.slices.length : null,
      recordings: report.recordings.filter(function(recording) { return recording.bytes !== undefined; }).length,
      problems: report.problems
    };
    return keep('report.json', JSON.stringify(report, null, 2)).then(function() {
      return keep('report.txt', text(report));
    }).then(function() {
      var name = 'dongle-report-' + report.made.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-') + '.zip';
      var zip = path.join(self.dir, name);
      return Promise.resolve(o.pack(self.files, zip)).then(function() {
        return fs.stat(zip);
      }).then(function(stat) {
        self.state.zip = { name: name, path: zip, bytes: stat.size };
        // The recordings are in the ZIP file now; the summary stays to be shown
        return Promise.all(report.recordings.map(function(recording) {
          return fs.remove(path.join(self.files, recording.file));
        }));
      }).then(function() {
        return report;
      });
    });
  });
};

module.exports = DongleReport;
module.exports.REPORT_FORM = REPORT_FORM;
module.exports.parseTest = parseTest;
module.exports.parseSelftest = parseSelftest;
module.exports.parseGains = parseGains;
module.exports.recordings = recordings;
module.exports.text = text;
