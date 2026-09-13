import serverDiscovery, { type ServerInfo } from 'lms-discovery';
import { type Player as MonitoredPlayer } from 'lms-player-monitor';
import type Player from './types/Player';
import { type ServerCredentials } from './types/Server';
import type Server from './types/Server';
import { getLmsPlayerMonitorConfig } from './Util';
import { loadEsm } from 'load-esm';
import { getErrorMessage } from './Util';
import type { ChildMessage, ChildProcessLogLevel } from './ChildProcessUtils';

interface ChildStartPayload {
  serverCredentials?: ServerCredentials;
  eventFilter?: {
    playerIP?: string | string[];
    playerName?: string | string[];
    playerId?: string | string[];
  };
}

type ParentMessage =
  | { type: 'start'; payload: ChildStartPayload }
  | { type: 'stop' };

export type PlayerFinderChildMessage =
  | ChildMessage
  | { type: 'started' }
  | { type: 'found'; payload: Player[] }
  | { type: 'lost'; payload: Player[] }
  | { type: 'error'; payload: { message: string } };

async function runChildProcess() {
  const { LmsPlayerMonitor } =
    await loadEsm<typeof import('lms-player-monitor')>('lms-player-monitor');

  const sendToParent = (message: PlayerFinderChildMessage) => {
    if (process.send) {
      process.send(message);
    }
  };

  const log = (level: ChildProcessLogLevel, message: string) => {
    sendToParent({
      type: 'log',
      payload: {
        level,
        message
      }
    });
  };

  log('debug', '[squeezelite_mc] PlayerFinderChild process starting');

  const foundPlayers: Player[] = [];
  const monitors: {
    [serverIp: string]: InstanceType<typeof LmsPlayerMonitor>;
  } = {};
  let opts: { serverCredentials?: ServerCredentials; eventFilter?: any } = {};

  const getPlayersOnServer = async (
    server: Server,
    monitor: InstanceType<typeof LmsPlayerMonitor>
  ): Promise<Player[]> => {
    try {
      log(
        'info',
        `[squeezelite_mc] Getting players connected to ${server.name} (${server.ip})`
      );
      const players = await monitor.getPlayers();
      const result = players
        .filter(
          (player) =>
            player.isConnected && player.playerId !== '00:00:00:00:00:00'
        )
        .map((player) => ({
          id: player.playerId,
          ip: player.ip?.split(':')[0],
          name: player.name,
          server
        }));
      log(
        'info',
        `[squeezelite_mc] Players connected to ${server.name} (${server.ip}): ${JSON.stringify(result)}`
      );
      return result;
    } catch (error) {
      log(
        'error',
        getErrorMessage(
          `[squeezelite_mc] Failed to get players on server ${server.name} (${server.ip}):`,
          error
        )
      );
      sendToParent({
        type: 'error',
        payload: {
          message: getErrorMessage(
            `Request to ${server.name} (${server.ip}) failed with error:`,
            error,
            false
          )
        }
      });
      throw error;
    }
  };

  const createMonitor = (server: Server) => {
    const monitor = new LmsPlayerMonitor(
      getLmsPlayerMonitorConfig(server, opts.serverCredentials, {
        debug: (msg) =>
          log('debug', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
        info: (msg) =>
          log('info', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
        warn: (msg) =>
          log('warn', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
        error: (msg) =>
          log('error', `[squeezelite_mc] (lms-player-monitor) ${msg}`)
      })
    );
    monitor.on('serverDisconnect', () => handleServerLost(server));
    monitor.on('playerConnect', (players: MonitoredPlayer[]) => {
      players.forEach((player) => handlePlayerConnect(server, player));
    });
    monitor.on('playerDisconnect', (players: MonitoredPlayer[]) => {
      players.forEach((player) => handlePlayerDisconnect(player));
    });
    return monitor;
  };

  const clearMonitor = async (
    monitor: InstanceType<typeof LmsPlayerMonitor>
  ) => {
    monitor.removeAllListeners('serverDisconnect');
    monitor.removeAllListeners('playerConnect');
    monitor.removeAllListeners('playerDisconnect');
    try {
      await monitor.stop();
    } catch (error) {
      log(
        'error',
        getErrorMessage('Error stopping player monitor:', error, false)
      );
    }
  };

  const removeAndEmitLostByPlayerId = (id: string) => {
    const foundIndex = foundPlayers.findIndex((player) => id === player.id);
    if (foundIndex >= 0) {
      const lost = foundPlayers.splice(foundIndex, 1);
      filterAndEmit('lost', lost);
    }
  };

  const isInFoundPlayers = (playerId: string, server: Server) => {
    return (
      foundPlayers.findIndex(
        (player) => player.id === playerId && player.server.ip === server.ip
      ) >= 0
    );
  };

  const handlePlayerConnect = (server: Server, player: MonitoredPlayer) => {
    if (!isInFoundPlayers(player.playerId, server)) {
      const mapped: Player = {
        id: player.playerId,
        ip: player.ip?.split(':')[0],
        name: player.name,
        server
      };
      log(
        'info',
        `[squeezelite_mc] Player connected to ${server.name} (${server.ip}): ${JSON.stringify(
          {
            id: mapped.id,
            ip: mapped.ip,
            name: mapped.name
          }
        )}`
      );
      foundPlayers.push(mapped);
      filterAndEmit('found', [mapped]);
    }
  };

  const handlePlayerDisconnect = (player: MonitoredPlayer) => {
    removeAndEmitLostByPlayerId(player.playerId);
  };

  const filterAndEmit = (eventName: 'found' | 'lost', players: Player[]) => {
    const eventFilter = opts.eventFilter;
    if (!eventFilter) {
      sendToParent({ type: eventName, payload: players });
      return;
    }
    const predicates: ((player: Player) => boolean)[] = [];
    if (eventFilter.playerIP) {
      const pip = eventFilter.playerIP;
      predicates.push(
        Array.isArray(pip) ?
          (player) => player.ip !== undefined && pip.includes(player.ip)
        : (player) => pip === player.ip
      );
    }
    if (eventFilter.playerName) {
      const pn = eventFilter.playerName;
      predicates.push(
        Array.isArray(pn) ?
          (player) => pn.includes(player.name)
        : (player) => pn === player.name
      );
    }
    if (eventFilter.playerId) {
      const pid = eventFilter.playerId;
      predicates.push(
        Array.isArray(pid) ?
          (player) => pid.includes(player.id)
        : (player) => pid === player.id
      );
    }
    let filtered = players;
    for (let i = 0; i < predicates.length; i++) {
      filtered = filtered.filter(predicates[i]);
    }

    if (filtered.length > 0) {
      sendToParent({ type: eventName, payload: filtered });
    }
  };

  const handleServerDiscovered = (data: ServerInfo | Server) => {
    if (!data.cliPort) {
      log(
        'warn',
        `[squeezelite_mc] Disregarding discovered server due to missing CLI port: ${JSON.stringify(data)}`
      );
      return;
    }
    const server: Server = {
      ip: data.ip,
      name: data.name,
      ver: data.ver,
      uuid: data.uuid,
      jsonPort: data.jsonPort,
      cliPort: data.cliPort
    };
    log(
      'info',
      `[squeezelite_mc] Server discovered: ${JSON.stringify(server)}`
    );

    void (async () => {
      try {
        monitors[server.ip] = createMonitor(server);
        const players = await getPlayersOnServer(server, monitors[server.ip]);
        if (players.length > 0) {
          foundPlayers.push(...players);
          filterAndEmit('found', players);
        }
        try {
          await monitors[server.ip].start();
          log('info', '[squeezelite_mc] Player monitor started');
        } catch (error) {
          log(
            'error',
            getErrorMessage(
              `[squeezelite_mc] Failed to start player monitor on ${server.name} (${server.ip}):`,
              error
            )
          );
          sendToParent({
            type: 'error',
            payload: {
              message: getErrorMessage(
                `Request to ${server.name} (${server.ip}) failed with error:`,
                error,
                false
              )
            }
          });
          throw error;
        }
      } catch (error) {
        log(
          'error',
          getErrorMessage(
            '[squeezelite_mc] An error occurred while processing discovered server:',
            error
          )
        );
      }
    })();
  };

  const handleServerLost = (server: ServerInfo | Server) => {
    log('info', `[squeezelite_mc] Server lost: ${JSON.stringify(server)}`);
    const lost = foundPlayers.filter(
      (player) => player.server.ip === server.ip
    );
    foundPlayers.splice(
      0,
      foundPlayers.length,
      ...foundPlayers.filter((player) => player.server.ip !== server.ip)
    );
    if (lost.length > 0) {
      filterAndEmit('lost', lost);
    }
    void (async () => {
      const monitor = monitors[server.ip];
      if (monitor) {
        delete monitors[server.ip];
        await clearMonitor(monitor);
      }
    })();
  };

  process.on('message', (message: ParentMessage) => {
    if (!message || typeof message.type !== 'string') {
      return;
    }

    void (async () => {
      try {
        switch (message.type) {
          case 'start': {
            log(
              'debug',
              '[squeezelite_mc] PlayerFinderChild handling start request'
            );
            opts = message.payload;

            // Start server discovery
            serverDiscovery.on('discovered', handleServerDiscovered);
            serverDiscovery.on('lost', handleServerLost);
            serverDiscovery.start();
            log('info', '[squeezelite_mc] Server discovery started');
            sendToParent({ type: 'started' });
            break;
          }
          case 'stop': {
            log(
              'debug',
              '[squeezelite_mc] PlayerFinderChild handling stop request'
            );
            serverDiscovery.removeAllListeners('discovered');
            serverDiscovery.removeAllListeners('lost');
            serverDiscovery.stop();
            await Promise.all(
              Object.values(monitors).map((monitor) => clearMonitor(monitor))
            );
            foundPlayers.splice(0, foundPlayers.length);
            Object.keys(monitors).forEach((key) => delete monitors[key]);
            process.exit(0);
            break;
          }
        }
      } catch (error: unknown) {
        sendToParent({
          type: 'error',
          payload: { message: String(error) }
        });
        process.exit(1);
      }
    })();
  });

  process.on('disconnect', () => {
    void (async () => {
      log(
        'debug',
        '[squeezelite_mc] PlayerFinderChild process disconnect event'
      );
      serverDiscovery.removeAllListeners('discovered');
      serverDiscovery.removeAllListeners('lost');
      serverDiscovery.stop();
      await Promise.all(
        Object.values(monitors).map((monitor) => clearMonitor(monitor))
      );
    })();
  });

  process.on('uncaughtException', (error) => {
    log(
      'error',
      getErrorMessage(
        '[squeezelite_mc] PlayerFinderChild uncaught exception',
        error
      )
    );
    sendToParent({ type: 'error', payload: { message: String(error) } });
    process.exit(1);
  });
}

if (process.send) {
  void runChildProcess();
}
