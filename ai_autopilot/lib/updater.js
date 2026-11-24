'use strict';

/**
 * In-place self-updater.
 *
 * Pulls the latest code from the GitHub `main` branch and overlays it onto the
 * running plugin directory, preserving user data (history, feedback, prompts)
 * and only re-running `npm install` when dependencies actually change.
 *
 * The running plugin lives at /data/plugins/music_service/ai_autopilot, which is
 * a plain copy (not a git checkout), so we fetch a tarball rather than `git pull`.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const fetch = require('node-fetch');

const REPO = 'samadi81/volumio-ai-autopilot';
const BRANCH = 'main';
const API_COMMITS = 'https://api.github.com/repos/' + REPO + '/commits/' + BRANCH;
const TARBALL = 'https://codeload.github.com/' + REPO + '/tar.gz/refs/heads/' + BRANCH;
const UA = 'volumio-ai-autopilot-updater';

// Names in the plugin folder that must never be overwritten by an update:
// installed deps, git metadata, and the user's own data files.
const PRESERVE = new Set([
  'node_modules', '.git',
  'history.json', 'feedback.json',
  'system_prompt.txt', 'hints.txt'
]);

async function fetchLatestSha() {
  const res = await fetch(API_COMMITS, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) {
    throw new Error('GitHub API ' + res.status + ': ' + (await res.text()).slice(0, 200));
  }
  const data = await res.json();
  if (!data || !data.sha) throw new Error('GitHub response had no commit SHA');
  return data.sha;
}

async function _downloadTarball(destFile) {
  const res = await fetch(TARBALL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Tarball download failed (' + res.status + ')');
  fs.writeFileSync(destFile, await res.buffer());
}

function _depsChanged(oldPkgPath, newPkgPath) {
  try {
    const a = JSON.stringify((fs.readJsonSync(oldPkgPath) || {}).dependencies || {});
    const b = JSON.stringify((fs.readJsonSync(newPkgPath) || {}).dependencies || {});
    return a !== b;
  } catch (e) {
    return true; // when in doubt, install
  }
}

function _overlay(srcDir, destDir) {
  for (const name of fs.readdirSync(srcDir)) {
    if (PRESERVE.has(name)) continue;
    fs.copySync(path.join(srcDir, name), path.join(destDir, name), { overwrite: true });
  }
}

/**
 * Check for and apply an update.
 *
 * @param {object} opts
 * @param {string} opts.pluginDir  absolute path of the running plugin
 * @param {string} [opts.currentSha] last installed commit SHA (for skip-if-same)
 * @param {object} [opts.logger]
 * @returns {Promise<{updated:boolean, fromSha?:string, toSha:string, depsChanged?:boolean}>}
 */
async function update({ pluginDir, currentSha, logger }) {
  const log = (m) => { try { if (logger) logger.info('[ai_autopilot][updater] ' + m); } catch (e) {} };

  const latestSha = await fetchLatestSha();
  if (currentSha && latestSha === currentSha) {
    return { updated: false, toSha: latestSha };
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai_autopilot_upd_'));
  const tarFile = path.join(tmpRoot, 'src.tar.gz');
  try {
    log('downloading latest main tarball');
    await _downloadTarball(tarFile);

    execSync('tar -xzf ' + JSON.stringify(tarFile) + ' -C ' + JSON.stringify(tmpRoot));

    // GitHub tarballs extract into a single top-level directory.
    const dirs = fs.readdirSync(tmpRoot)
      .filter((n) => fs.statSync(path.join(tmpRoot, n)).isDirectory());
    if (!dirs.length) throw new Error('Extracted tarball had no source directory');
    const srcDir = path.join(tmpRoot, dirs[0]);
    if (!fs.existsSync(path.join(srcDir, 'package.json'))) {
      throw new Error('Extracted update is missing package.json');
    }

    const depsChanged = _depsChanged(
      path.join(pluginDir, 'package.json'),
      path.join(srcDir, 'package.json')
    );

    _overlay(srcDir, pluginDir);
    log('files overlaid onto ' + pluginDir);

    if (depsChanged) {
      log('dependencies changed -> npm install');
      execSync('npm install --omit=dev --no-audit --no-fund', { cwd: pluginDir, stdio: 'ignore' });
    }

    return { updated: true, fromSha: currentSha || '(unknown)', toSha: latestSha, depsChanged };
  } finally {
    try { fs.removeSync(tmpRoot); } catch (e) {}
  }
}

module.exports = { update, fetchLatestSha };
