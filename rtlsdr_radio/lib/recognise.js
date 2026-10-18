'use strict';

// Song recognition: what a station is playing, told from the sound itself by a service
// that identifies music from a short piece of audio (AudD), with a key of the user's own.
//
// The plugin feeds it the sound on its way to the loudspeaker; it keeps the last twenty
// seconds. While a station plays it asks the service when the station's own text names
// no song (or always, as set), and trusts an answer that the next answer repeats: one
// odd answer (a remix named for the original, a mash-up) is not shown. Once a song is
// known, nothing is asked until the song is over by the time the service gave, so a
// listener's day costs a request or two a song. Audio leaves the player only with a key.
//
// Options: logger, onSong(song | null), key, when ('missing' | 'always'), and for the
// tests: send(wav) -> Promise of the service's answer, wav(pcm) -> Promise of a WAV
// buffer, now() -> milliseconds, tick (the timer's period in ms).

var childProcess = require('child_process');

var SERVICE = 'https://api.audd.io/';
var SAMPLE_RATE = 48000;      // the PCM fed in: what the plugin hands the loudspeaker
var CHANNELS = 2;
var WINDOW = 20;              // seconds of sound sent
var SENT_RATE = 16000;        // sent as mono at this rate: a fifth of the bytes, the same answer
var FIRST_AFTER = 15000;      // ms after a station starts before the first question
var CONFIRM_AFTER = 30000;    // ms between an answer and the question that confirms it
var LEAST_BETWEEN = 90000;    // ms between questions that found nothing, or after a song's end
var MOST_BACKOFF = 4;         // the wait after empty answers doubles up to this many times LEAST_BETWEEN
var SONG_OVER_SLACK = 10000;  // ms after a song's end, by the service's time, before the next question
var FAILED_WAIT = 300000;     // ms after a failed request (network, service) before another
var MOST_TRIES = 3;           // answers that disagree before giving up on the song at hand
var TIMEOUT = 30000;          // ms a request may take

function Recogniser(options) {
  options = options || {};
  this.logger = options.logger || { info: function() {}, error: function() {} };
  this.onSong = options.onSong || function() {};
  this.send = options.send || null;
  this.toWav = options.wav || null;
  this.now = options.now || Date.now;
  this.tickMs = options.tick || 5000;
  this.key = '';
  this.when = 'missing';
  this.on = true;
  this.configure({ key: options.key, when: options.when, on: options.on });
  this.bytes = SAMPLE_RATE * CHANNELS * 2 * WINDOW;
  this.ring = Buffer.alloc(this.bytes);
  this.filled = 0;
  this.at = 0;
  this.reset();
  this.timer = null;
  this.keyFailed = false;
  this.failedAt = 0;
  this.asked = 0;            // questions sent since the plugin started
  this.lastAskedAt = 0;
  this.lastSong = null;      // the last song recognised, with when
}

// The settings. A changed key is given another chance after a failure.
Recogniser.prototype.configure = function(settings) {
  var key = String((settings && settings.key) || '').trim();
  if (key !== this.key) {
    this.keyFailed = false;
  }
  this.key = key;
  this.when = settings && settings.when === 'always' ? 'always' : 'missing';
  this.on = !(settings && settings.on === false);
};

// On: switched on, with a token the service has not refused
Recogniser.prototype.enabled = function() {
  return this.on && this.key !== '' && !this.keyFailed;
};

// The state in words, for the log and the report
Recogniser.prototype.said = function() {
  if (this.key === '') {
    return 'off: no token';
  }
  if (this.keyFailed) {
    return 'off: the service refused the token';
  }
  if (!this.on) {
    return 'off: switched off, token kept';
  }
  return 'on, asks ' + (this.when === 'always' ? 'for every song' : 'when the station\'s text names no song');
};

Recogniser.prototype.reset = function() {
  this.playing = null;
  this.startedAt = 0;
  this.named = false;
  this.asking = false;
  this.askedAt = 0;
  this.candidate = null;
  this.tries = 0;
  this.song = null;
  this.songOverAt = 0;
  this.nothingAt = 0;
  this.nothings = 0;         // empty answers in a row on this station
  this.saidNothing = false;
  this.filled = 0;
  this.at = 0;
};

// A station starts: the sound from here on is its own
Recogniser.prototype.start = function(uri) {
  var self = this;
  self.reset();
  self.playing = uri;
  self.startedAt = self.now();
  if (!self.timer) {
    self.timer = setInterval(function() { self.consider(); }, self.tickMs);
    if (self.timer.unref) {
      self.timer.unref();
    }
  }
};

Recogniser.prototype.stop = function() {
  if (this.timer) {
    clearInterval(this.timer);
    this.timer = null;
  }
  this.reset();
};

// The station's own text: whether it names a song at the moment
Recogniser.prototype.textNamesSong = function(named) {
  this.named = !!named;
};

// Sound on its way to the loudspeaker: 16-bit signed, SAMPLE_RATE, CHANNELS
Recogniser.prototype.feed = function(chunk) {
  if (!this.playing || !chunk || !chunk.length) {
    return;
  }
  var n = chunk.length;
  if (n >= this.bytes) {
    chunk.copy(this.ring, 0, n - this.bytes);
    this.at = 0;
    this.filled = this.bytes;
    return;
  }
  var first = Math.min(n, this.bytes - this.at);
  chunk.copy(this.ring, this.at, 0, first);
  if (first < n) {
    chunk.copy(this.ring, 0, first);
  }
  this.at = (this.at + n) % this.bytes;
  this.filled = Math.min(this.bytes, this.filled + n);
};

// The last WINDOW seconds, in order
Recogniser.prototype.window = function() {
  if (this.filled < this.bytes) {
    return null;
  }
  return Buffer.concat([this.ring.slice(this.at), this.ring.slice(0, this.at)]);
};

// What the plugin shows of it
Recogniser.prototype.status = function() {
  return {
    enabled: this.enabled(),
    on: this.on,
    when: this.when,
    keyFailed: this.keyFailed,
    song: this.song ? { artist: this.song.artist, title: this.song.title } : null,
    candidate: this.candidate ? { artist: this.candidate.artist, title: this.candidate.title } : null,
    asked: this.asked,
    lastAskedAt: this.lastAskedAt ? new Date(this.lastAskedAt).toISOString() : null,
    lastSong: this.lastSong
  };
};

// Once a tick: is a question due?
Recogniser.prototype.consider = function() {
  var now = this.now();
  if (!this.playing || !this.enabled() || this.asking || this.filled < this.bytes) {
    return;
  }
  if (now - this.startedAt < FIRST_AFTER || now - this.failedAt < FAILED_WAIT) {
    return;
  }
  if (this.when === 'missing' && this.named) {
    return;
  }
  if (this.candidate) {
    if (now - this.askedAt >= CONFIRM_AFTER) {
      this.ask();
    }
    return;
  }
  if (this.song) {
    if (this.songOverAt && now >= this.songOverAt) {
      this.ask();
    }
    return;
  }
  if (now - this.nothingAt >= this.waitAfterNothing()) {
    this.ask();
  }
};

// Talk, however long, must not spend the questions: after each empty answer the wait
// doubles, a minute and a half, three minutes, six, until a song is recognised or
// another station plays
Recogniser.prototype.waitAfterNothing = function() {
  return LEAST_BETWEEN * Math.min(Math.pow(2, Math.max(0, this.nothings - 1)), MOST_BACKOFF);
};

Recogniser.prototype.ask = function() {
  var self = this;
  var pcm = self.window();
  if (!pcm) {
    return;
  }
  var station = self.playing;
  self.asking = true;
  self.askedAt = self.now();
  self.asked++;
  self.lastAskedAt = self.askedAt;
  Promise.resolve(self.toWav ? self.toWav(pcm) : wavOf(pcm)).then(function(wav) {
    return self.send ? self.send(wav) : post(self.key, wav);
  }).then(function(answer) {
    if (self.playing !== station) {
      return;   // another station since: its own questions follow
    }
    self.heard(answer);
  }, function(e) {
    if (self.playing === station) {
      self.failedAt = self.now();
      self.logger.info('[RTL-SDR Radio] Song recognition: the request failed (' + (e && e.message || e) + '); next in ' +
        Math.round(FAILED_WAIT / 60000) + ' minutes');
    }
  }).then(function() {
    self.asking = false;
  });
};

// The service's answer
Recogniser.prototype.heard = function(answer) {
  var now = this.now();
  if (!answer || answer.status !== 'success') {
    var error = answer && answer.error ? answer.error : {};
    var code = Number(error.error_code);
    // 900: a wrong key; 901: no requests left on it. Asking again gets the same answer.
    if (code === 900 || code === 901) {
      this.keyFailed = true;
      this.logger.error('[RTL-SDR Radio] Song recognition is off: the service refused the key (' + (error.error_message || code) + ')');
    } else {
      this.failedAt = now;
      this.logger.info('[RTL-SDR Radio] Song recognition: the service answered ' + JSON.stringify(answer).slice(0, 200) + '; next in ' +
        Math.round(FAILED_WAIT / 60000) + ' minutes');
    }
    return;
  }
  var song = songOf(answer.result, now);
  if (!song) {
    // Nothing recognised: talk, a jingle, an advertisement, or a song the service does
    // not know. Whatever was shown of a song before, the song is over. Said in the log
    // once, not at every question that follows.
    if (this.song || this.candidate || !this.saidNothing) {
      this.logger.info('[RTL-SDR Radio] Song recognition: nothing recognised in the last ' + WINDOW + ' seconds of ' + this.playing);
      this.saidNothing = true;
    }
    this.nothingAt = now;
    this.nothings++;
    this.candidate = null;
    this.tries = 0;
    if (this.song) {
      this.song = null;
      this.songOverAt = 0;
      this.onSong(null);
    }
    return;
  }
  this.saidNothing = false;
  if (this.song && same(this.song, song)) {
    // The same song still: the service's time says when it ends
    this.song = song;
    this.songOverAt = song.endsAt || now + LEAST_BETWEEN;
    return;
  }
  if (this.candidate && same(this.candidate, song)) {
    // Said twice: trusted
    this.song = song;
    this.songOverAt = song.endsAt || now + LEAST_BETWEEN;
    this.candidate = null;
    this.tries = 0;
    this.nothings = 0;
    this.logger.info('[RTL-SDR Radio] Song recognised: ' + song.artist + ' - ' + song.title +
      (song.timecode !== null ? ' (' + clock(song.timecode) + ' into it)' : ''));
    this.lastSong = { artist: song.artist, title: song.title, at: new Date(now).toISOString() };
    this.onSong(song);
    return;
  }
  // A new answer: a candidate, to be confirmed by the next
  this.tries++;
  if (this.tries > MOST_TRIES) {
    this.logger.info('[RTL-SDR Radio] Song recognition: ' + MOST_TRIES + ' answers that disagree; left for now');
    this.candidate = null;
    this.tries = 0;
    this.nothingAt = now;
    this.nothings++;
    return;
  }
  this.candidate = song;
  if (this.song) {
    // what was shown is over; the new one is shown once confirmed
    this.song = null;
    this.songOverAt = 0;
    this.onSong(null);
  }
};

function same(a, b) {
  return a && b && plain(a.artist) === plain(b.artist) && plain(a.title) === plain(b.title);
}

function plain(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function clock(seconds) {
  var s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}

// The service's result as the plugin keeps it: artist, title, album, a cover's address,
// where in the song the window was, and when the song ends by that
function songOf(result, now) {
  if (!result || !result.artist || !result.title) {
    return null;
  }
  var apple = result.apple_music || null;
  var spotify = result.spotify || null;
  var artwork = null;
  if (apple && apple.artwork && apple.artwork.url) {
    artwork = String(apple.artwork.url).replace('{w}', '600').replace('{h}', '600');
  } else if (spotify && spotify.album && spotify.album.images && spotify.album.images[0] && spotify.album.images[0].url) {
    artwork = spotify.album.images[0].url;
  }
  var duration = apple && apple.durationInMillis ? apple.durationInMillis / 1000 :
    spotify && spotify.duration_ms ? spotify.duration_ms / 1000 : null;
  var timecode = null;
  var m = /^(\d+):(\d+)$/.exec(String(result.timecode || ''));
  if (m) {
    timecode = Number(m[1]) * 60 + Number(m[2]);
  }
  var endsAt = duration !== null && timecode !== null ? now + Math.max(0, duration - timecode) * 1000 + SONG_OVER_SLACK : null;
  return {
    artist: String(result.artist).trim(),
    title: String(result.title).trim(),
    album: result.album ? String(result.album).trim() : null,
    artwork: artwork,
    link: result.song_link || null,
    timecode: timecode,
    duration: duration,
    endsAt: endsAt
  };
}

// The window as the service takes it: a WAV, mono, SENT_RATE, through sox
function wavOf(pcm) {
  return new Promise(function(resolve, reject) {
    var sox = childProcess.execFile('sox',
      ['-t', 'raw', '-r', String(SAMPLE_RATE), '-c', String(CHANNELS), '-e', 'signed', '-b', '16', '-',
       '-t', 'wav', '-r', String(SENT_RATE), '-c', '1', '-'],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 20000 }, function(err, stdout) {
        if (err || !stdout || !stdout.length) {
          reject(new Error('sox could not make the window: ' + (err && err.message || 'no output')));
        } else {
          resolve(stdout);
        }
      });
    sox.stdin.on('error', function() {});
    sox.stdin.end(pcm);
  });
}

// The question to the service
function post(key, wav) {
  var form = new FormData();
  form.append('api_token', key);
  form.append('return', 'apple_music,spotify');
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'window.wav');
  var control = new AbortController();
  var timer = setTimeout(function() { control.abort(); }, TIMEOUT);
  return fetch(SERVICE, { method: 'POST', body: form, signal: control.signal }).then(function(response) {
    return response.json();
  }).finally(function() {
    clearTimeout(timer);
  });
}

module.exports = Recogniser;
module.exports.songOf = songOf;
module.exports.WINDOW = WINDOW;
module.exports.SAMPLE_RATE = SAMPLE_RATE;
module.exports.CHANNELS = CHANNELS;
