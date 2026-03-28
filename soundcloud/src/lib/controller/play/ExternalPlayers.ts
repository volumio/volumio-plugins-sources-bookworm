import sc from '../../SoundCloudContext';
import { MPVService, VLCService } from 'volumio-ext-players';

export type ExternalPlayer = 'vlc' | 'mpv';

type PlayerMap = Record<ExternalPlayer, MPVService | VLCService | null>;

async function startMpv() {
  sc.toast('info', sc.getI18n('SOUNDCLOUD_STARTING_PLAYER', 'mpv'));
  try {
    const mpv = new MPVService({
      serviceName: 'soundcloud',
      logger: sc.getLogger(),
      volumio: {
        commandRouter: sc.volumioCoreCommand,
        mpdPlugin: sc.getMpdPlugin(),
        statemachine: sc.getStateMachine()
      },
      mpvArgs: [
        '--force-seekable=yes',
        '--demuxer=lavf',
        '--demuxer-lavf-o=extension_picky=0,allowed_extensions=ALL,allowed_segment_extensions=ALL'
      ]
    });
    await mpv.start();
    return mpv;
  }
  catch (error) {
   throw Error(sc.getErrorMessage(sc.getI18n('SOUNDCLOUD_ERR_PLAYER_START', 'mpv'), error));
  }
}

async function startVLC() {
  sc.toast('info', sc.getI18n('SOUNDCLOUD_STARTING_PLAYER', 'VLC'));
  try {
    const vlc = new VLCService({
      serviceName: 'soundcloud',
      logger: sc.getLogger(),
      volumio: {
        commandRouter: sc.volumioCoreCommand,
        mpdPlugin: sc.getMpdPlugin(),
        statemachine: sc.getStateMachine()
      }
    });
    await vlc.start();
    return vlc;
  }
  catch (error) {
    throw Error(sc.getErrorMessage(sc.getI18n('SOUNDCLOUD_ERR_PLAYER_START', 'VLC'), error));
  }
}

export class ExternalPlayers {
  static #players: PlayerMap = {
    vlc: null,
    mpv: null
  };

  static async get(player: ExternalPlayer) {
    if (this.#players[player]) {
      return this.#players[player];
    }
    let startPromise;
    switch (player) {
      case 'mpv':
        startPromise = startMpv();
        break;
      case 'vlc':
        startPromise = startVLC();
        break;
    }
    sc.getLogger().info(`[soundcloud] Going to start ${player} for playback`);
    const playerName = this.#getPlayerName(player);
    try {
      const p = await startPromise;
      p.once('close', (code) => {
        if (code && code !== 0) {
          sc.toast('warning', sc.getI18n('SOUNDCLOUD_PLAYER_CLOSED_UNEXPECTEDLY', playerName))
        }
        sc.getLogger().info(`[soundcloud] ${player} process closed`);
        this.#players[player] = null;
      });
      this.#players[player] = p;
      return p;
    }
    catch (error) {
      sc.toast('error', sc.getErrorMessage(sc.getI18n('SOUNDCLOUD_ERR_PLAYER_START', playerName), error));
      return null;
    }
  }

  static stop(player: ExternalPlayer) {
    const p = this.#players[player];
    if (p && p.isActive()) {
      return p.stop();
    }
  }

  static getActive() {
    return Object.values(this.#players).find((p) => p && p.isActive()) ?? null;
  }

  static async quit(player: ExternalPlayer) {
    const p = this.#players[player];
    if (p) {
      try {
        await p.quit();
      }
      catch (error) {
        sc.toast('error', sc.getI18n('SOUNDCLOUD_ERR_PLAYER_QUIT', this.#getPlayerName(player), sc.getErrorMessage('', error, false)));
      }
      finally {
        this.#players[player] = null;
      }
    }
  }

  static quitAll() {
    return Promise.all(Object.keys(this.#players).map((player) => this.quit(player as ExternalPlayer)));
  }

  static #getPlayerName(player: ExternalPlayer) {
    switch (player) {
      case 'mpv':
        return 'mpv';
      case 'vlc':
        return 'VLC';
    }
  }
}