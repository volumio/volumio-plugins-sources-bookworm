import lyrion from './LyrionContext';
import { exec } from 'child_process';
import fs from 'fs';
import { EOL } from 'os';

const SYSTEMD_SERVICE_NAME = 'logitechmediaserver'
const PREFS_FILE = '/var/lib/squeezeboxserver/prefs/server.prefs';
const DEFAULT_SERVER_PORT = '9000';

function execCommand(cmd: string, sudo = false) {
  return new Promise<string>((resolve, reject) => {
    lyrion.getLogger().info(`[lyrion] Executing ${cmd}`);
    exec(sudo ? `echo volumio | sudo -S ${cmd}` : cmd, { uid: 1000, gid: 1000 }, function (error, stdout, stderr) {
      if (error) {
        lyrion.getLogger().error(lyrion.getErrorMessage(`[lyrion] Failed to execute ${cmd}: ${stderr.toString()}`, error));
        reject(error);
      }
      else {
        resolve(stdout.toString());
      }
    });
  });
}

function systemctl(cmd: string, service = '') {
  const fullCmd = `/usr/bin/sudo /bin/systemctl ${cmd} ${service} || true`;
  return execCommand(fullCmd);
}

function resolveOnServiceStatusMatch(status: string | string[], matchConsecutive = 1, retries = 5) {
  let consecutiveCount = 0;
  let tryCount = 0;

  const startCheckTimer = (resolve: (value?: unknown) => void, reject: () => void) => {
    setTimeout(() => {
      void (async() => {
        const _status = await getServiceStatus();
        if (Array.isArray(status) ? status.includes(_status) : _status === status) {
          consecutiveCount++;
          if (consecutiveCount === matchConsecutive) {
            resolve();
          }
          else {
            startCheckTimer(resolve, reject);
          }
        }
        else if (_status === 'failed') {
          reject();
        }
        else if (_status === 'activating') {
          consecutiveCount = 0;
          startCheckTimer(resolve, reject);
        }
        else if (tryCount < retries - 1) {
          consecutiveCount = 0;
          tryCount++;
          startCheckTimer(resolve, reject);
        }
        else {
          reject();
        }
      })();
    }, 500);
  };


  return new Promise((resolve, reject) => {
    startCheckTimer(resolve, reject);
  });
}

export async function startService() {
  await systemctl('start', SYSTEMD_SERVICE_NAME);
  await resolveOnServiceStatusMatch('active', 5);
}

export async function stopService() {
  await systemctl('stop', SYSTEMD_SERVICE_NAME);
  return resolveOnServiceStatusMatch([ 'inactive', 'failed' ]);
}

export async function getServiceStatus() {
  const recognizedStatuses = [ 'inactive', 'active', 'activating', 'failed' ];
  const regex = /Active: (.*) \(.*\)/gm;
  const out = await systemctl('status', SYSTEMD_SERVICE_NAME);
  const matches = [ ...out.matchAll(regex) ];
  if (matches[0] && matches[0][1] && recognizedStatuses.includes(matches[0][1])) {
    return matches[0][1];
  }

  return 'inactive';
}

export function getServerPrefs() {
  if (!fs.existsSync(PREFS_FILE)) {
    return {};
  }
  try {
    const prefs = fs.readFileSync(PREFS_FILE, 'utf8');
    const parsed = prefs.split(EOL).reduce<Record<string, string>>((result, row) => {
      const h = row.split(':');
      if (h.length === 2) {
        const prop = h[0].trim();
        const value = h[1].trim();
        let parsedValue = value;
        if (value.startsWith('\'') && value.endsWith('\'')) {
          parsedValue = value.substring(1, value.length - 1);
        }
        Reflect.set(result, prop, parsedValue);
      }
      return result;
    }, {});
    return parsed;
    
  }
  catch (error: unknown) {
    lyrion.getLogger().error(lyrion.getErrorMessage('[lyrion] Error reading server prefs file:', error));
    return {};
  }
}

export function getServerPort() {
  const prefs = getServerPrefs();
  return prefs['httpport'] || DEFAULT_SERVER_PORT;
}
