import type { ChildMessage } from './ChildProcessUtils';
import { type PlayerStatus } from './types/Player';
import type Player from './types/Player';
import { type ServerCredentials } from './types/Server';
import { getErrorMessage, getLmsPlayerMonitorConfig } from './Util';
import type { PlayerStatus as MonitoredPlayerStatus } from 'lms-player-monitor';
import { loadEsm } from 'load-esm';

interface ChildStartPayload {
  player: Player;
  serverCredentials: ServerCredentials;
}

type ParentMessage =
  | { type: 'start'; payload: ChildStartPayload }
  | { type: 'requestUpdate' }
  | { type: 'stop' };

export type PlayerStatusMonitorChildMessage =
  | ChildMessage
  | { type: 'started' }
  | { type: 'update'; payload: { player: Player; status: PlayerStatus } }
  | { type: 'disconnect' }
  | { type: 'error'; payload: { message: string } };

function mapMonitoredPlayerStatus(status: MonitoredPlayerStatus): PlayerStatus {
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

async function runChildProcess() {
  const { LmsPlayerMonitor } =
    await loadEsm<typeof import('lms-player-monitor')>('lms-player-monitor');
  let monitor: InstanceType<typeof LmsPlayerMonitor> | null = null;
  let currentPlayer: Player | null = null;
  let currentServerCredentials: ServerCredentials | null = null;
  let deferredEmitTimer: NodeJS.Timeout | null = null;

  const sendToParent = (message: PlayerStatusMonitorChildMessage) => {
    if (process.send) {
      process.send(message);
    }
  };

  const log = (
    level: (PlayerStatusMonitorChildMessage & {
      type: 'log';
    })['payload']['level'],
    message: string
  ) => {
    sendToParent({
      type: 'log',
      payload: {
        level,
        message
      }
    });
  };

  log('debug', '[squeezelite_mc] PlayerStatusMonitorChild process starting');

  const emitStatus = (player: Player, status: MonitoredPlayerStatus) => {
    sendToParent({
      type: 'update',
      payload: {
        player,
        status: mapMonitoredPlayerStatus(status)
      }
    });
  };

  const cancelPendingEmit = () => {
    if (deferredEmitTimer) {
      clearTimeout(deferredEmitTimer);
      deferredEmitTimer = null;
    }
  };

  const handleDisconnect = () => {
    if (!monitor) {
      return;
    }

    monitor.removeAllListeners('playerStatus');
    monitor.removeAllListeners('playerSync');
    monitor.removeAllListeners('serverDisconnect');
    monitor = null;
    cancelPendingEmit();
    sendToParent({ type: 'disconnect' });
  };

  const createAndStartMonitor = async (
    player: Player,
    serverCredentials: ServerCredentials
  ) => {
    const monitorInstance = new LmsPlayerMonitor(
      getLmsPlayerMonitorConfig(player.server, serverCredentials, {
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

    monitorInstance.on('playerStatus', (status: MonitoredPlayerStatus) => {
      if (status.playerId === player.id) {
        cancelPendingEmit();
        deferredEmitTimer = setTimeout(() => {
          emitStatus(player, status);
        }, 200);
      }
    });

    monitorInstance.on('serverDisconnect', () => {
      handleDisconnect();
    });

    await monitorInstance.start();
    return monitorInstance;
  };

  const stopMonitor = async () => {
    if (!monitor) {
      return;
    }

    try {
      await monitor.stop();
    } catch (error: unknown) {
      sendToParent({
        type: 'error',
        payload: { message: String(error) }
      });
    }

    monitor = null;
  };

  process.on('message', (message: ParentMessage) => {
    if (!message || typeof message.type !== 'string') {
      return;
    }

    void (async () => {
      try {
        switch (message.type) {
          case 'start': {
            currentPlayer = message.payload.player;
            currentServerCredentials = message.payload.serverCredentials;
            monitor = await createAndStartMonitor(
              currentPlayer,
              currentServerCredentials
            );
            sendToParent({ type: 'started' });

            try {
              const status = await monitor.getPlayerStatus(currentPlayer.id);
              emitStatus(currentPlayer, status);
            } catch (error: unknown) {
              sendToParent({
                type: 'error',
                payload: {
                  message: getErrorMessage(
                    '[squeezelite_mc] Error getting player status:',
                    error
                  )
                }
              });
            }

            break;
          }
          case 'requestUpdate': {
            if (!monitor || !currentPlayer) {
              return;
            }

            try {
              const status = await monitor.getPlayerStatus(currentPlayer.id);
              emitStatus(currentPlayer, status);
            } catch (error: unknown) {
              sendToParent({
                type: 'error',
                payload: {
                  message: getErrorMessage(
                    '[squeezelite_mc]: Error handling update request:',
                    error
                  )
                }
              });
            }
            break;
          }
          case 'stop': {
            await stopMonitor();
            process.exit(0);
            break;
          }
        }
      } catch (error: unknown) {
        sendToParent({ type: 'error', payload: { message: String(error) } });
        process.exit(1);
      }
    })();
  });

  process.on('disconnect', () => {
    void stopMonitor();
  });

  process.on('uncaughtException', (error) => {
    sendToParent({ type: 'error', payload: { message: String(error) } });
    process.exit(1);
  });
}

if (process.send) {
  void runChildProcess();
}
