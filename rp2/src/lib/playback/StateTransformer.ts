import {
  type VolumioState,
  type VolumioStateTranformer
} from 'volumio-ext-players';
import rp2 from '../RP2Context';
import { type PlayerStatus } from '@patrickkfkan/rp.js';

export class StateTransformer implements VolumioStateTranformer {
  #status: PlayerStatus | null = null;

  setRpjsStatus(status: PlayerStatus) {
    this.#status = status;
  }

  modifyVolatileSeekBeforeSet(playerTime: number): number {
    if (!this.#status || !this.#status.channel || !this.#status.track) {
      return playerTime;
    }
    const { track } = this.#status;
    if (!track.duration) {
      return 0;
    }
    return Math.max(0, playerTime - track.positionInStream);
  }

  transformStateBeforePush(state: VolumioState): VolumioState {
    if (!this.#status || !this.#status.channel || !this.#status.track) {
      return state;
    }
    const { track, channel } = this.#status;
    const positionInTrack =
      state.seek && track.duration ? state.seek - track.positionInStream : 0;
    const transformed = {
      ...state,
      uri: `rp2/channel@id=${encodeURIComponent(channel.id)}`,
      title: track.title ?? channel.title,
      artist: track.artist ?? rp2.getI18n('RP2_RP'),
      album: track.album ?? undefined,
      albumart:
        track.cover.large ||
        track.cover.medium ||
        track.cover.small ||
        undefined,
      seek: positionInTrack,
      duration: track.duration ? track.duration / 1000 : 0,
      trackType: track.format ?? state.trackType,
      bitrate: track.bitrate ?? state.bitrate,
      stream: !track.duration,
      random: false,
      repeat: false
    };
    if (transformed.bitrate) {
      // The following ensures the bitrate will be shown.
      transformed.samplerate = transformed.bitrate;
      transformed.bitrate = undefined;
      transformed.bitdepth = undefined;
    }
    if (rp2.getConfigValue('showChannel')) {
      if (!transformed.samplerate) {
        transformed.samplerate = channel.title;
      } else {
        transformed.samplerate = `${transformed.samplerate} - ${channel.title}`;
      }
    }
    return transformed;
  }
}
