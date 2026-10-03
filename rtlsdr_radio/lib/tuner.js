'use strict';

// One owner for the tuner.
//
// An RTL-SDR dongle can be held by one process at a time, and it needs a moment after
// that process has gone before the next one can open it. Everything that uses the dongle
// (playing FM or DAB, scanning, the antenna tools) therefore runs as a job of this
// module. A job is started only when
//   - every process of the job before it has exited,
//   - any other process holding the dongle has been removed, and
//   - the dongle has had its moment.
//
// Processes are started directly, never through a shell, and are stopped by their own
// process ids, in stages: asked to end, given time, then killed, then waited for.
// Stopping is safe at any time and any number of times: it only ever reaches the
// processes of the job it was asked to stop.

var childProcess = require('child_process');
var fs = require('fs');
var libQ = require('kew');

// The programs that open the dongle. A process with one of these names that is not part
// of the running job is a stray (left by a crash, or started by hand) and is removed
// before a job starts, so that the job finds the dongle free.
var HOLDERS = ['fn-rtl_fm', 'fn-rtl_power', 'fn-dab', 'fn-dab-scanner'];

var POLL = 50;  // ms between looks at whether processes have gone

function Tuner(options) {
  options = options || {};
  this.logger = options.logger || { info: function() {}, error: function() {} };
  this.settle = options.settle !== undefined ? options.settle : 600;        // ms for the dongle after its holder has gone
  this.grace = options.grace !== undefined ? options.grace : 1500;          // ms a process has to end when asked
  this.killWait = options.killWait !== undefined ? options.killWait : 2000; // ms to wait after killing
  this.holders = options.holders || HOLDERS;
  this.current = null;        // the running job, or null
  this.lastRelease = 0;       // when the dongle was last let go
  this.requested = 0;         // counts requests; a later one takes the place of an earlier one not yet started
  this.chain = libQ.resolve();
}

Tuner.prototype.log = function(message) {
  this.logger.info('[RTL-SDR Radio] Tuner: ' + message);
};

// The name of the running job, or null when the tuner is free.
Tuner.prototype.busy = function() {
  return this.current && !this.current.finished ? this.current.name : null;
};

// Ask for the tuner. Resolves with a new job once the tuner is free for it.
// Rejects with an error marked `superseded` when a later request (or a stop) came
// before this one got its turn: the caller then has nothing to do.
//
// options.keepOpen: the job runs several processes one after another (the antenna
// tools) and ends only when it is stopped, not when a process of it has ended.
Tuner.prototype.acquire = function(name, options) {
  var self = this;
  var ticket = ++self.requested;
  var defer = libQ.defer();

  function superseded() {
    var error = new Error('superseded by a later request');
    error.superseded = true;
    defer.reject(error);
  }

  self.chain = self.chain.then(function() {
    if (ticket !== self.requested) {
      superseded();
      return;
    }
    return self._release('making way for ' + name).then(function() {
      if (ticket !== self.requested) {
        superseded();
        return;
      }
      var job = new Job(self, name, options);
      self.current = job;
      self.log('"' + name + '" has the tuner');
      defer.resolve(job);
    });
  }).fail(function(e) {
    self.logger.error('[RTL-SDR Radio] Tuner: could not start "' + name + '": ' + e);
    defer.reject(e);
  });

  return defer.promise;
};

// Stop whatever has the tuner and withdraw requests that have not had their turn.
// Resolves when the processes are gone. Never rejects.
Tuner.prototype.stop = function(reason) {
  var self = this;
  var defer = libQ.defer();
  self.requested++;

  self.chain = self.chain.then(function() {
    return self._release(reason || 'stop');
  }).fail(function(e) {
    self.logger.error('[RTL-SDR Radio] Tuner: error while stopping: ' + e);
  }).then(function() {
    defer.resolve();
  });

  return defer.promise;
};

// Free the tuner: stop the running job, remove strays, give the dongle its moment.
Tuner.prototype._release = function(reason) {
  var self = this;
  var job = self.current;
  var stopped = job ? job.stop(reason) : libQ.resolve();

  return stopped.then(function() {
    if (self.current === job) {
      self.current = null;
    }
    return self._removeStrays();
  }).then(function() {
    return self._settled();
  });
};

// Resolves when the dongle has had its moment since it was last let go.
Tuner.prototype._settled = function() {
  var wait = this.lastRelease + this.settle - Date.now();
  if (wait <= 0) {
    return libQ.resolve();
  }
  var settled = libQ.defer();
  // Rounded up: a timer may fire a fraction of a millisecond early
  setTimeout(function() { settled.resolve(); }, Math.ceil(wait) + 1);
  return settled.promise;
};

// Processes named like a holder of the dongle that are still running.
Tuner.prototype._strays = function() {
  var self = this;
  var found = [];
  var entries;
  try {
    entries = fs.readdirSync('/proc');
  } catch (e) {
    return found;
  }
  entries.forEach(function(entry) {
    if (!/^\d+$/.test(entry)) {
      return;
    }
    try {
      var name = fs.readFileSync('/proc/' + entry + '/comm', 'utf8').trim();
      if (self.holders.indexOf(name) === -1) {
        return;
      }
      // A process that has ended and waits to be collected by its parent holds nothing
      var stat = fs.readFileSync('/proc/' + entry + '/stat', 'utf8');
      var state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
      if (state !== 'Z') {
        found.push({ pid: parseInt(entry, 10), name: name });
      }
    } catch (e) {
      // gone while we looked
    }
  });
  return found;
};

Tuner.prototype._removeStrays = function() {
  var self = this;
  var strays = self._strays();
  if (strays.length === 0) {
    return libQ.resolve();
  }

  self.log('removing ' + strays.map(function(s) { return s.name + ' (' + s.pid + ')'; }).join(', '));

  function signal(name) {
    self._strays().forEach(function(stray) {
      try {
        process.kill(stray.pid, name);
      } catch (e) {
        if (e.code !== 'ESRCH') {
          self.logger.error('[RTL-SDR Radio] Tuner: cannot signal ' + stray.name + ' (' + stray.pid + '): ' + e.code);
        }
      }
    });
  }

  return staged(signal, function() { return self._strays().length; }, self.grace, self.killWait)
    .then(function(left) {
      self.lastRelease = Date.now();
      if (left > 0) {
        self.logger.error('[RTL-SDR Radio] Tuner: ' + left + ' process(es) still hold the dongle');
      }
    });
};

// Ask to end, wait, kill what is left, wait. Resolves with the number still there.
function staged(signal, countLeft, grace, killWait) {
  var defer = libQ.defer();
  if (countLeft() === 0) {
    defer.resolve(0);
    return defer.promise;
  }

  signal('SIGTERM');
  var waited = 0;
  var killed = false;
  var timer = setInterval(function() {
    waited += POLL;
    var left = countLeft();
    if (left === 0) {
      clearInterval(timer);
      defer.resolve(0);
      return;
    }
    if (!killed && waited >= grace) {
      killed = true;
      signal('SIGKILL');
    }
    if (waited >= grace + killWait) {
      clearInterval(timer);
      defer.resolve(left);
    }
  }, POLL);

  return defer.promise;
}

// A job: the processes that together use the tuner for one purpose.
function Job(tuner, name, options) {
  this.tuner = tuner;
  this.name = name;
  this.keepOpen = !!(options && options.keepOpen);
  this.children = [];
  this.stopping = false;      // true from the moment the job is told to stop
  this.finished = false;      // true when the job was stopped or all its processes have gone
  this.timedOut = false;
  this.stopPromise = null;
  this.limitTimer = null;
  this.unexpectedExitHandlers = [];
}

// Start a process as part of the job. Takes what child_process.spawn takes.
// Errors on the process's pipes (a reader that has gone away) are absorbed here, so
// that a pipe closing during a stop can never bring the caller down.
Job.prototype.spawn = function(command, args, options) {
  var self = this;
  if (self.stopping || self.finished) {
    throw new Error('the job "' + self.name + '" has ended');
  }

  var child = childProcess.spawn(command, args || [], options || {});
  var entry = { child: child, command: command, exited: false, code: null, signal: null, error: null, said: '' };
  self.children.push(entry);

  [child.stdin, child.stdout, child.stderr].forEach(function(stream) {
    if (stream) {
      stream.on('error', function() {});
    }
  });

  // The last of what the process wrote to its error stream is kept: when it ends by
  // itself, that is usually the reason. Reading it also keeps the pipe from filling.
  if (child.stderr) {
    child.stderr.on('data', function(data) {
      entry.said = (entry.said + data.toString()).slice(-600);
    });
  }

  function gone() {
    if (entry.exited) {
      return;
    }
    entry.exited = true;
    self._childGone(entry);
    if (child.pid === undefined) {
      ended();
    }
  }
  // Told once, when the process has ended and everything it wrote has been read
  function ended() {
    if (entry.done) {
      var done = entry.done;
      entry.done = null;
      done(entry);
    }
  }
  child.on('close', ended);
  child.on('exit', function(code, signal) {
    entry.code = code;
    entry.signal = signal;
    gone();
  });
  child.on('error', function(error) {
    // The process could not be started, or could not be signalled
    entry.error = error;
    if (child.pid === undefined) {
      gone();
    }
  });

  return child;
};

// Start a process and be told once when it has ended, however it ended, and after all
// its output has been delivered: done({ command, code, signal, error }).
Job.prototype.run = function(command, args, options, done) {
  var child = this.spawn(command, args, options);
  this.children[this.children.length - 1].done = done;
  if (child.pid === undefined) {
    // It could not be started; the error event follows and reports it
    return child;
  }
  return child;
};

// Between two processes of a job that runs them one after another: resolves when the
// one that ended has let the dongle go and the dongle has had its moment.
Job.prototype.settle = function() {
  var tuner = this.tuner;
  return tuner._removeStrays().then(function() {
    return tuner._settled();
  });
};

// Be told when a process of the job ends without the job having been stopped:
// handler({ command, code, signal, error, said }).
Job.prototype.onUnexpectedExit = function(handler) {
  this.unexpectedExitHandlers.push(handler);
};

// Stop the job by itself after a time; job.timedOut then says so.
Job.prototype.limit = function(ms) {
  var self = this;
  clearTimeout(self.limitTimer);
  self.limitTimer = setTimeout(function() {
    if (!self.finished && !self.stopping) {
      self.timedOut = true;
      self.tuner.log('"' + self.name + '" ran out of time');
      self.stop('time limit');
    }
  }, ms);
};

Job.prototype._alive = function() {
  return this.children.filter(function(entry) { return !entry.exited; });
};

Job.prototype._childGone = function(entry) {
  var self = this;
  if (!self.stopping) {
    self.unexpectedExitHandlers.forEach(function(handler) {
      try {
        handler(entry);
      } catch (e) {
        self.tuner.logger.error('[RTL-SDR Radio] Tuner: error in exit handler: ' + e);
      }
    });
  }
  if (self._alive().length === 0) {
    self.tuner.lastRelease = Date.now();
    if (!self.keepOpen) {
      self._finish();
    }
  }
};

Job.prototype._finish = function() {
  if (this.finished) {
    return;
  }
  this.finished = true;
  clearTimeout(this.limitTimer);
  this.tuner.lastRelease = Date.now();
  if (this.tuner.current === this) {
    this.tuner.current = null;
  }
};

// Stop the job. Resolves when its processes are gone. Never rejects.
Job.prototype.stop = function(reason) {
  var self = this;
  if (self.stopPromise) {
    return self.stopPromise;
  }
  self.stopping = true;
  clearTimeout(self.limitTimer);

  var alive = self._alive();
  if (alive.length > 0) {
    self.tuner.log('stopping "' + self.name + '" (' + (reason || 'stop') + '): ' +
      alive.map(function(entry) { return entry.command; }).join(', '));
  }

  function signal(name) {
    self._alive().forEach(function(entry) {
      try {
        entry.child.kill(name);
      } catch (e) {
        // already gone
      }
    });
  }

  self.stopPromise = staged(signal, function() { return self._alive().length; },
    self.tuner.grace, self.tuner.killWait).then(function(left) {
    if (left > 0) {
      self.tuner.logger.error('[RTL-SDR Radio] Tuner: ' + left + ' process(es) of "' + self.name + '" did not end');
    }
    self._finish();
  });
  return self.stopPromise;
};

module.exports = Tuner;
module.exports.HOLDERS = HOLDERS;
