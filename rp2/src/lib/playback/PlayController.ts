import rp2 from '../RP2Context';
import { parseUri } from '../util';
import { type QueueItem } from './types';

export class PlayController {
  /**
   * track.uri:
   * rp2/channel@id=...
   * rp2/episode@id=...@channel=...
   * rp2/episodes@channel=...
   */
  async clearAddPlayTrack(track: QueueItem) {
    rp2.getLogger().info(`[rp2] clearAddPlayTrack: ${track.uri}`);
    const view = parseUri(track.uri).pop();
    if (!view) {
      throw Error(`Invalid URI "${track.uri}`);
    }
    const rpjs = rp2.getRpjsLib();
    if (view.name === 'channel' && view.params.id) {
      await rpjs.play(view.params.id);
    } else if (
      view.name === 'episode' &&
      view.params.id &&
      view.params.channel
    ) {
      await rpjs.play(view.params.channel, view.params.id);
    } else if (view.name === 'episodes' && view.params.channel) {
      await rpjs.play(view.params.channel);
    } else {
      throw Error(`Invalid URI "${track.uri}`);
    }
    if (rp2.getConfigValue('persistSession')) {
      rp2.setConfigValue('sessionData', rpjs.getSessionData());
    }
  }

  async stop() {
    await rp2.getRpjsLib().stop();
  }

  async pause() {
    await rp2.getRpjsLib().pause();
  }

  async resume() {
    await rp2.getRpjsLib().resume();
  }

  async seek(position: number) {
    await rp2.getRpjsLib().seek(position);
  }

  async play() {
    const rpjs = rp2.getRpjsLib();
    if (rpjs.getStatus().state === 'paused') {
      await rpjs.resume();
    }
  }

  async next() {
    await rp2.getRpjsLib().skip();
  }

  async previous() {
    await rp2.getRpjsLib().seek(0);
  }
}
