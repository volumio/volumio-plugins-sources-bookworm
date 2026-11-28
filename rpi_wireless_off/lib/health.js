'use strict';

// Feeds the health line on the settings page: how often Volumio's two services restarted since boot,
// and which units failed. Neither systemctl call needs sudo.

const run = require('./run');

const SYSTEMCTL = '/bin/systemctl';

// show -p NRestarts --value prints one value per unit with a blank line between the units: 0\n\n3\n.
// Output that doesn't look like that is an error. Reading it as zero restarts would hide a loop, which
// is what the health line is there to catch.
function parseRestarts(stdout) {
  const match = /^(\d+)\n\n(\d+)\n?$/.exec(stdout);
  if (!match) throw new Error(`unreadable NRestarts output: ${JSON.stringify(stdout)}`);
  return { volumio: Number(match[1]), volumiobt: Number(match[2]) };
}

// list-units --plain --no-legend prints one unit per line, name first, then load, active and sub
// state and a description.
function parseFailed(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// The run option lets a test pass a stub.
async function readHealth({ run: runProgram = run } = {}) {
  const restarts = await runProgram(SYSTEMCTL, [
    'show', '-p', 'NRestarts', '--value', 'volumio.service', 'volumiobt.service',
  ]);
  const failed = await runProgram(SYSTEMCTL, ['list-units', '--failed', '--plain', '--no-legend']);
  return { restarts: parseRestarts(restarts), failed: parseFailed(failed) };
}

module.exports = { parseRestarts, parseFailed, readHealth };
