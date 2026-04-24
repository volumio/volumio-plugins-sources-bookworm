import EventEmitter from 'events';
import sm from './SqueezeliteMCContext';
import { type PlayerStatus } from './types/Player';
import type Player from './types/Player';
import { type ServerCredentials } from './types/Server';
import { getLmsPlayerMonitorConfig } from './Util';
import {
  LmsPlayerMonitor,
  type PlayerStatus as MonitoredPlayerStatus
} from 'lms-player-monitor';

export default class PlayerStatusMonitor extends EventEmitter {
  #player: Player;
  #serverCredentials: ServerCredentials;
  #monitor: LmsPlayerMonitor | null;
  #deferredEmitTimer: NodeJS.Timeout | null;

  constructor(player: Player, serverCredentials: ServerCredentials) {
    super();
    this.#player = player;
    this.#serverCredentials = serverCredentials;
    this.#monitor = null;
    this.#deferredEmitTimer = null;
  }

  async start() {
    this.#monitor = await this.#createAndStartMonitor();
    try {
      const status = await this.#monitor.getPlayerStatus(this.#player.id);
      this.#emitStatus(status);
    } catch (error: unknown) {
      sm.getLogger().error(
        sm.getErrorMessage(
          '[squeezelite_mc] Error getting player status:',
          error
        )
      );
    }
  }

  async stop() {
    if (!this.#monitor) {
      return;
    }
    try {
      await this.#monitor.stop();
    } catch (error: unknown) {
      sm.getLogger().error(
        sm.getErrorMessage('Error stopping player monitor:', error, false)
      );
    }
  }

  getPlayer() {
    return this.#player;
  }

  requestUpdate() {
    if (!this.#monitor) {
      return;
    }
    this.#monitor
      .getPlayerStatus(this.#player.id)
      .then((status) => {
        this.#emitStatus(status);
      })
      .catch((error: unknown) => {
        sm.getLogger().error(
          sm.getErrorMessage(
            '[squeezelite_mc]: Error handling update request:',
            error
          )
        );
      });
  }

  #handleDisconnect() {
    if (!this.#monitor) {
      return;
    }
    this.#monitor.removeAllListeners('playerStatus');
    this.#monitor.removeAllListeners('playerSync');
    this.#monitor.removeAllListeners('serverDisconnect');
    this.#monitor = null;
    this.#cancelPendingEmit();

    this.emit('disconnect', this.#player);
  }

  #handleStatusUpdate(status: MonitoredPlayerStatus) {
    if (status.playerId === this.#player.id) {
      this.#emitStatusAfterDelay(status);
    }
  }

  #emitStatusAfterDelay(status: MonitoredPlayerStatus) {
    this.#cancelPendingEmit();
    this.#deferredEmitTimer = setTimeout(() => {
      this.#emitStatus(status);
    }, 200);
  }

  #emitStatus(status: MonitoredPlayerStatus) {
    this.emit('update', {
      player: this.#player,
      status: this.#mapMonitoredPlayerStatus(status)
    });
  }

  #cancelPendingEmit() {
    if (this.#deferredEmitTimer) {
      clearTimeout(this.#deferredEmitTimer);
      this.#deferredEmitTimer = null;
    }
  }

  #mapMonitoredPlayerStatus(status: MonitoredPlayerStatus) {
    const mapped: PlayerStatus = {
      mode: status.status ?? 'stop',
      time: status.currentTime,
      volume: status.volume,
      repeatMode: status.repeatMode,
      shuffleMode: status.shuffleMode,
      canSeek: status.canSeek
    };

    const track = status.track;
    if (track) {
      mapped.currentTrack = {
        type: track.audioFormat,
        title: track.title,
        artist: track.artist,
        trackArtist: track.trackArtist,
        albumArtist: track.albumArtist,
        album: track.album,
        remoteTitle: track.remoteTitle,
        artworkUrl: track.artworkUrl,
        coverId: track.coverId,
        duration: track.duration,
        sampleRate: track.sampleRate,
        sampleSize: track.sampleSize,
        bitrate: track.bitrate
      };
    }
    return mapped;
  }

  async #createAndStartMonitor() {
    const monitor = new LmsPlayerMonitor(
      getLmsPlayerMonitorConfig(this.#player.server, this.#serverCredentials)
    );
    monitor.on('playerStatus', (status) => this.#handleStatusUpdate(status));
    monitor.on('serverDisconnect', () => this.#handleDisconnect());
    await monitor.start();
    return monitor;
  }

  emit(
    event: 'update',
    data: { player: Player; status: PlayerStatus }
  ): boolean;
  emit(event: 'disconnect', player: Player): boolean;
  emit<K>(eventName: string | symbol, ...args: any[]): boolean {
    return super.emit(eventName, ...args);
  }

  on(
    event: 'update',
    listener: (data: { player: Player; status: PlayerStatus }) => void
  ): this;
  on(event: 'disconnect', listener: (player: Player) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
