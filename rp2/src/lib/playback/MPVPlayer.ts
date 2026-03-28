import { MPVService } from 'volumio-ext-players';
import rp2 from '../RP2Context';
import { Player } from '@patrickkfkan/rp.js';

export class MPVPlayer extends Player {
  #service: MPVService | null = null;
  onUnsetVolatile?: () => void;

  async #getService() {
    if (!this.#service) {
      rp2.getLogger().info(`[rp2] Starting mpv`);
      try {
        const p = await this.#startMpv();
        p.once('close', (code) => {
          if (code && code !== 0) {
            rp2.toast(
              'warning',
              rp2.getI18n('RP2_PLAYER_CLOSED_UNEXPECTEDLY', 'mpv')
            );
          }
          rp2.getLogger().info(`[rp2] mpv process closed`);
          this.#service?.removeAllListeners();
          this.#service = null;
        });
        p.on('unsetVolatile', () => {
          console.log('MPVPlayer onunsetVolatile called');
          if (this.onUnsetVolatile) {
            console.log('MPVPlayer calling onunsetVolatile callbacks');
            this.onUnsetVolatile();
          }
        });
        this.#service = p;
        return p;
      } catch (error) {
        rp2.toast(
          'error',
          rp2.getErrorMessage(rp2.getI18n('RP2_ERR_PLAYER_START', 'mpv'), error)
        );
        return null;
      }
    }
    return this.#service;
  }

  async #startMpv() {
    rp2.toast('info', rp2.getI18n('RP2_STARTING_PLAYER', 'mpv'));
    try {
      const mpv = new MPVService({
        serviceName: 'rp2',
        logger: rp2.getLogger(),
        volumio: {
          commandRouter: rp2.volumioCoreCommand,
          mpdPlugin: rp2.getMpdPlugin(),
          statemachine: rp2.getStateMachine(),
          stateTransformer: rp2.getStateTransformer(),
          unsetVolatileOnStop: 'manual'
        }
      });
      mpv.on('status', (status) => {
        if (status.state === 'stopped') {
          this.notifyStopped();
        }
      });
      await mpv.start();
      return mpv;
    } catch (error) {
      throw Error(
        rp2.getErrorMessage(rp2.getI18n('RP2_ERR_PLAYER_START', 'mpv'), error)
      );
    }
  }

  async play(url: string, position: number) {
    const service = await this.#getService();
    if (!service) {
      return;
    }
    await service.play(
      {
        uri: url,
        streamUrl: url
      },
      position / 1000
    );
    this.notifyPlaying((service.getStatus()?.time || 0) * 1000);
  }

  async pause() {
    if (!this.#service) {
      rp2.toast('error', rp2.getI18n('RP2_ERR_PLAYER_GONE'));
      return;
    }
    await this.#service.pause();
    this.notifyPaused((this.#service.getStatus()?.time || 0) * 1000);
  }

  async resume() {
    if (!this.#service) {
      rp2.toast('error', rp2.getI18n('RP2_ERR_PLAYER_GONE'));
      return;
    }
    await this.#service.resume();
    this.notifyPlaying((this.#service.getStatus()?.time || 0) * 1000);
  }

  async seek(position: number) {
    if (!this.#service) {
      rp2.toast('error', rp2.getI18n('RP2_ERR_PLAYER_GONE'));
      return;
    }
    await this.#service.seek(position / 1000);
    this.notifySeeked((this.#service.getStatus()?.time || 0) * 1000);
  }

  getPosition = () => {
    return (this.getStatus()?.time ?? 0) * 1000;
  };

  async stop() {
    if (!this.#service) {
      rp2.toast('error', rp2.getI18n('RP2_ERR_PLAYER_GONE'));
      return;
    }
    await this.#service.stop();
    this.notifyStopped();
  }

  async quit() {
    if (!this.#service) {
      rp2.toast('error', rp2.getI18n('RP2_ERR_PLAYER_GONE'));
      return;
    }
    await this.#service.quit();
  }

  getStatus() {
    if (!this.#service) {
      rp2.toast('error', rp2.getI18n('RP2_ERR_PLAYER_GONE'));
      return null;
    }
    return this.#service.getStatus();
  }

  pushState() {
    if (!this.#service) {
      return;
    }
    this.#service.pushState();
  }
}
