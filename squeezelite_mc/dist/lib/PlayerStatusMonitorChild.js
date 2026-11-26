"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Util_1 = require("./Util");
const load_esm_1 = require("load-esm");
function mapMonitoredPlayerStatus(status) {
    const mapped = {
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
    const { LmsPlayerMonitor } = await (0, load_esm_1.loadEsm)('lms-player-monitor');
    let monitor = null;
    let currentPlayer = null;
    let currentServerCredentials = null;
    let deferredEmitTimer = null;
    const sendToParent = (message) => {
        if (process.send) {
            process.send(message);
        }
    };
    const log = (level, message) => {
        sendToParent({
            type: 'log',
            payload: {
                level,
                message
            }
        });
    };
    log('debug', '[squeezelite_mc] PlayerStatusMonitorChild process starting');
    const emitStatus = (player, status) => {
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
    const createAndStartMonitor = async (player, serverCredentials) => {
        const monitorInstance = new LmsPlayerMonitor((0, Util_1.getLmsPlayerMonitorConfig)(player.server, serverCredentials, {
            debug: (msg) => log('debug', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
            info: (msg) => log('info', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
            warn: (msg) => log('warn', `[squeezelite_mc] (lms-player-monitor) ${msg}`),
            error: (msg) => log('error', `[squeezelite_mc] (lms-player-monitor) ${msg}`)
        }));
        monitorInstance.on('playerStatus', (status) => {
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
        }
        catch (error) {
            sendToParent({
                type: 'error',
                payload: { message: String(error) }
            });
        }
        monitor = null;
    };
    process.on('message', (message) => {
        if (!message || typeof message.type !== 'string') {
            return;
        }
        void (async () => {
            try {
                switch (message.type) {
                    case 'start': {
                        currentPlayer = message.payload.player;
                        currentServerCredentials = message.payload.serverCredentials;
                        monitor = await createAndStartMonitor(currentPlayer, currentServerCredentials);
                        sendToParent({ type: 'started' });
                        try {
                            const status = await monitor.getPlayerStatus(currentPlayer.id);
                            emitStatus(currentPlayer, status);
                        }
                        catch (error) {
                            sendToParent({
                                type: 'error',
                                payload: {
                                    message: (0, Util_1.getErrorMessage)('[squeezelite_mc] Error getting player status:', error)
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
                        }
                        catch (error) {
                            sendToParent({
                                type: 'error',
                                payload: {
                                    message: (0, Util_1.getErrorMessage)('[squeezelite_mc]: Error handling update request:', error)
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
            }
            catch (error) {
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
