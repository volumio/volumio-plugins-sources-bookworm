'use strict';

// execFile as a native promise. The program starts from a file and an argument array with no
// shell, so nothing in an argument is read as shell syntax.

const childProcess = require('node:child_process');

// Resolves with stdout. Rejects with an Error holding the trimmed stderr, or the error's own
// message when the program printed nothing there. execFile has no input option, so this writes
// input to the program's stdin itself. It always closes stdin, so a program that reads it sees
// the end of the input and doesn't wait for more. env replaces the environment, as in execFile.
function run(file, args, { input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.execFile(file, args, { env }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message.trim()));
      else resolve(stdout);
    });
    // A program that exits without reading its input breaks the pipe. The exit status already
    // says how it went, and an unhandled stream error would crash the whole process.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// Callers can import it either way: require('./run') or const { run } = require('./run').
module.exports = run;
module.exports.run = run;
