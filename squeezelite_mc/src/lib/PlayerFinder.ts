import sm from './SqueezeliteMCContext';
import serverDiscovery, { type ServerInfo } from 'lms-discovery';
import {
  LmsPlayerMonitor,
  type Player as MonitoredPlayer
} from 'lms-player-monitor';
import EventEmitter from 'events';
import type Player from './types/Player';
import { type ServerCredentials } from './types/Server';
import type Server from './types/Server';
import { getLmsPlayerMonitorConfig } from './Util';

export enum PlayerFinderStatus {
  Started = 'started',
  Stopped = 'stopped'
}

export interface PlayerFinderOptions {
  serverCredentials?: ServerCredentials;
  // Emit events only when player matches criteria
  eventFilter?: {
    playerIP?: string | string[];
    playerName?: string | string[];
    playerId?: string | string[];
  };
}

export interface PlayerFinderEvents {
  found: (players: Player[]) => void;
  lost: (players: Player[]) => void;
  error: (errorMessage: string) => void;
}

export default class PlayerFinder extends EventEmitter {
  #status: PlayerFinderStatus;
  #foundPlayers: Player[];
  #monitors: {
    [serverIp: string]: LmsPlayerMonitor;
  };
  #opts: PlayerFinderOptions;

  constructor() {
    super();
    this.#status = PlayerFinderStatus.Stopped;
    this.#foundPlayers = [];
    this.#monitors = {};
    this.#opts = {};
  }

  start(opts: PlayerFinderOptions = {}) {
    this.#opts = opts;

    // Start server discovery
    serverDiscovery.on('discovered', this.#handleServerDiscovered.bind(this));
    serverDiscovery.on('lost', this.#handleServerLost.bind(this));
    serverDiscovery.start();
    sm.getLogger().info('[squeezelite_mc] Server discovery started');
    this.#status = PlayerFinderStatus.Started;
    sm.getLogger().info('[squeezelite_mc] Player finder started');
  }

  async stop() {
    serverDiscovery.removeAllListeners('discovered');
    serverDiscovery.removeAllListeners('lost');
    serverDiscovery.stop();
    await Promise.all(
      Object.values(this.#monitors).map((monitor) =>
        this.#clearMonitor(monitor)
      )
    );
    this.#foundPlayers = [];
    this.#monitors = {};
    this.#status = PlayerFinderStatus.Stopped;
  }

  getStatus() {
    return this.#status;
  }

  async #getPlayersOnServer(
    server: Server,
    monitor: LmsPlayerMonitor
  ): Promise<Player[]> {
    try {
      sm.getLogger().info(
        `[squeezelite_mc] Getting players connected to ${server.name} (${server.ip})`
      );
      const players = await monitor.getPlayers();
      /**
       * Filter out players with Id '00:00:00:00:00:00', because it could well
       * be due to Squeezelite starting before network is initialized. If
       * this happens to multiple Squeezlite devices, this will mess up the
       * finder (server will also probably be messed up, but that's not something
       * we can deal with here).
       */
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
      sm.getLogger().info(
        `[squeezelite_mc] Players connected to ${server.name} (${server.ip}): ${JSON.stringify(result)}`
      );
      return result;
    } catch (error) {
      sm.getLogger().error(
        sm.getErrorMessage(
          `[squeezelite_mc] Failed to get players on server ${server.name} (${server.ip}):`,
          error
        )
      );
      this.emit(
        'error',
        sm.getErrorMessage(
          sm.getI18n(
            'SQUEEZELITE_MC_ERR_SERVER_REQUEST',
            server.name,
            server.ip
          ),
          error,
          false
        )
      );
      throw error;
    }
  }

  #handleServerDiscovered(data: ServerInfo | Server) {
    if (!data.cliPort) {
      sm.getLogger().warn(
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
    sm.getLogger().info(
      `[squeezelite_mc] Server discovered: ${JSON.stringify(server)}`
    );

    void (async () => {
      try {
        this.#monitors[server.ip] = this.#createMonitor(server);
        const players = await this.#getPlayersOnServer(
          server,
          this.#monitors[server.ip]
        );
        if (players.length > 0) {
          this.#foundPlayers.push(...players);
          this.#filterAndEmit('found', players);
        }
        try {
          await this.#monitors[server.ip].start();
          sm.getLogger().info('[squeezelite_mc] Player monitor started');
        } catch (error) {
          sm.getLogger().error(
            sm.getErrorMessage(
              `[squeezelite_mc] Failed to start player monitor on ${server.name} (${server.ip}):`,
              error
            )
          );
          this.emit(
            'error',
            sm.getErrorMessage(
              sm.getI18n(
                'SQUEEZELITE_MC_ERR_SERVER_REQUEST',
                server.name,
                server.ip
              ),
              error,
              false
            )
          );
          throw error;
        }
      } catch (error) {
        sm.getLogger().error(
          sm.getErrorMessage(
            '[squeezelite_mc] An error occurred while processing discovered server:',
            error
          )
        );
      }
    })();
  }

  #handleServerLost(server: ServerInfo | Server) {
    sm.getLogger().info(
      `[squeezelite_mc] Server lost: ${JSON.stringify(server)}`
    );
    const lost = this.#foundPlayers.filter(
      (player) => player.server.ip === server.ip
    );
    this.#foundPlayers = this.#foundPlayers.filter(
      (player) => player.server.ip !== server.ip
    );
    if (lost.length > 0) {
      this.#filterAndEmit('lost', lost);
    }
    void (async () => {
      const monitor = this.#monitors[server.ip];
      if (monitor) {
        delete this.#monitors[server.ip];
        await this.#clearMonitor(monitor);
      }
    })();
  }

  async #clearMonitor(monitor: LmsPlayerMonitor) {
    monitor.removeAllListeners('serverDisconnect');
    monitor.removeAllListeners('playerConnect');
    monitor.removeAllListeners('playerDisconnect');
    try {
      await monitor.stop();
    } catch (error) {
      sm.getLogger().error(
        sm.getErrorMessage('Error stopping player monitor:', error, false)
      );
    }
  }

  #removeAndEmitLostByPlayerId(id: string) {
    const foundIndex = this.#foundPlayers.findIndex(
      (player) => id === player.id
    );
    if (foundIndex >= 0) {
      const lost = this.#foundPlayers.splice(foundIndex, 1);
      this.#filterAndEmit('lost', lost);
    }
  }

  #isInFoundPlayers(playerId: string, server: Server) {
    return (
      this.#foundPlayers.findIndex(
        (player) => player.id === playerId && player.server.ip === server.ip
      ) >= 0
    );
  }

  #handlePlayerConnect(server: Server, player: MonitoredPlayer) {
    if (!this.#isInFoundPlayers(player.playerId, server)) {
      const mapped: Player = {
        id: player.playerId,
        ip: player.ip?.split(':')[0],
        name: player.name,
        server
      };
      sm.getLogger().info(
        `[squeezelite_mc] Player connected to ${server.name} (${server.ip}): ${JSON.stringify(
          {
            id: mapped.id,
            ip: mapped.ip,
            name: mapped.name
          }
        )}`
      );
      this.#foundPlayers.push(mapped);
      this.#filterAndEmit('found', [mapped]);
    }
  }

  #handlePlayerDisconnect(player: MonitoredPlayer) {
    this.#removeAndEmitLostByPlayerId(player.playerId);
  }

  #filterAndEmit(eventName: 'found' | 'lost', players: Player[]) {
    const eventFilter = this.#opts.eventFilter;
    if (!eventFilter) {
      this.emit(eventName, players);
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
      this.emit(eventName, filtered);
    }
  }

  #createMonitor(server: Server) {
    const monitor = new LmsPlayerMonitor(
      getLmsPlayerMonitorConfig(server, this.#opts.serverCredentials)
    );
    monitor.on('serverDisconnect', () => this.#handleServerLost(server));
    monitor.on('playerConnect', (players: MonitoredPlayer[]) => {
      players.forEach((player) => this.#handlePlayerConnect(server, player));
    });
    monitor.on('playerDisconnect', (players: MonitoredPlayer[]) => {
      players.forEach((player) => this.#handlePlayerDisconnect(player));
    });
    return monitor;
  }

  on<E extends keyof PlayerFinderEvents>(
    eventName: E,
    listener: PlayerFinderEvents[E]
  ): this {
    return super.on(eventName, listener);
  }
}
