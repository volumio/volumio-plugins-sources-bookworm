// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import libQ from 'kew';

import sc from '../../SoundCloudContext';
import Model, { ModelType } from '../../model';
import { jsPromiseToKew, kewToJSPromise } from '../../util/Misc';
import TrackHelper from '../../util/TrackHelper';
import { type QueueItem } from '../browse/view-handlers/ExplodableViewHandler';
import ViewHelper from '../browse/view-handlers/ViewHelper';
import { type PlaylistView } from '../browse/view-handlers/PlaylistViewHandler';
import { type AlbumView } from '../browse/view-handlers/AlbumViewHandler';
import { type UserView } from '../browse/view-handlers/UserViewHandler';
import { type TrackView } from '../browse/view-handlers/TrackViewHandler';
import { ExternalPlayers } from './ExternalPlayers';

export default class PlayController {

  #mpdPlugin: any;

  constructor() {
    this.#mpdPlugin = sc.getMpdPlugin();
  }

  /**
   * Track uri:
   * soundcloud/track@trackId=...
   */
  async clearAddPlayTrack(track: QueueItem) {
    sc.getLogger().info(`[soundcloud] clearAddPlayTrack: ${track.uri}`);

    const trackView = ViewHelper.getViewsFromUri(track.uri).pop() as TrackView | undefined;
    if (!trackView || trackView.name !== 'track' || !trackView.trackId) {
      throw Error(`Invalid track uri: ${track.uri}`);
    }

    const { trackId, origin } = trackView;
    const model = Model.getInstance(ModelType.Track);

    const trackData = await model.getTrack(Number(trackId));
    if (!trackData) {
      throw Error(`Failed to fetch track: ${track.uri}`);
    }

    if (trackData.playableState === 'blocked') {
      sc.toast('warning', sc.getI18n('SOUNDCLOUD_SKIP_BLOCKED_TRACK', track.title));
      sc.getStateMachine().next();
      return;
    }
    else if (trackData.playableState === 'snipped' && sc.getConfigValue('skipPreviewTracks')) {
      sc.toast('warning', sc.getI18n('SOUNDCLOUD_SKIP_PREVIEW_TRACK', track.title));
      sc.getStateMachine().next();
      return;
    }

    const { transcodingUrl, codec, bitrate } = TrackHelper.getPreferredStream(trackData) || {};
    if (!transcodingUrl) {
      throw Error('No transcoding found');
    }

    let streamingUrl = await model.getStreamingUrl(transcodingUrl, trackData.trackAuthorization || undefined);
    if (!streamingUrl) {
      throw Error('No stream found');
    }

    /**
     * Choose suitable player - VLC or mpv:
     * 
     * | Format     | VLC               | mpv                  |
     * |------------|-------------------|----------------------|
     * | Opus HLS   | Fails             | Plays + seek         |
     * | AAC HLS    | Plays + seek      | Plays; seek fails    |
     * | MP3 HLS    | Plays; seek fails | Plays; seek fails    |
     * | MP3 HTTP   | Plays + seek      | Plays + seek         |
     */

    const target = {
      ...track,
      streamUrl: streamingUrl,
      trackType: codec,
      samplerate: bitrate
    };
    // Use VLC for AAC streams; mpv for others.
    const playerName = codec === 'aac' ? 'vlc' : 'mpv';

    // If the other player is active, stop it first to free up audio device.
    if (playerName === 'vlc') {
      await ExternalPlayers.stop('mpv');
    }
    else if (playerName === 'mpv') {
      await ExternalPlayers.stop('vlc');
    }

    const player = await ExternalPlayers.get(playerName);

    if (player) {
      await player.play(target);
    }
    else {
      /**
       * Fallback to mpd if player failed to start
       * 1. Add bitrate info to track
       * 2. Fool MPD plugin to return correct `trackType` in `parseTrackInfo()` by adding
       * track type to URL query string as a dummy param.
       */
      track.samplerate = bitrate;
      streamingUrl += `&_vt=.${codec}`;

      const safeUri = streamingUrl.replace(/"/g, '\\"');
      // Play with MPD
      await this.#playWithMpd(safeUri, track);
    }

    if (sc.getConfigValue('addPlayedToHistory')) {
      await Model.getInstance(ModelType.Me).addToPlayHistory(trackData, origin);
    }
  }

  #playWithMpd(streamUrl: string, track: QueueItem) {
    const mpdPlugin = this.#mpdPlugin;

    return kewToJSPromise(mpdPlugin.sendMpdCommand('stop', [])
      .then(() => {
        return mpdPlugin.sendMpdCommand('clear', []);
      })
      .then(() => {
        return mpdPlugin.sendMpdCommand(`addid "${streamUrl}"`, []);
      })
      .then((addIdResp: { Id: string }) => this.#mpdAddTags(addIdResp, track))
      .then(() => {
        sc.getStateMachine().setConsumeUpdateService('mpd', true, false);
        return mpdPlugin.sendMpdCommand('play', []);
      }));
  }

  // Returns kew promise!
  #mpdAddTags(mpdAddIdResponse: { Id: string }, track: QueueItem) {
    const songId = mpdAddIdResponse?.Id;
    if (songId !== undefined) {
      const cmds = [];
      cmds.push({
        command: 'addtagid',
        parameters: [ songId, 'title', this.#stripNewLine(track.title) ]
      });
      if (track.album) {
        cmds.push({
          command: 'addtagid',
          parameters: [ songId, 'album', this.#stripNewLine(track.album) ]
        });
      }
      if (track.artist) {
        cmds.push({
          command: 'addtagid',
          parameters: [ songId, 'artist', this.#stripNewLine(track.artist) ]
        });
      }

      return this.#mpdPlugin.sendMpdCommandArray(cmds);
    }
    return libQ.resolve();
  }

  // Returns kew promise!
  stop() {
    const player = ExternalPlayers.getActive();
    if (player) {
      return jsPromiseToKew(player.stop());
    }
    sc.getStateMachine().setConsumeUpdateService('mpd', true, false);
    return this.#mpdPlugin.stop();
  }

  // Returns kew promise!
  pause() {
    const player = ExternalPlayers.getActive();
    if (player) {
      return jsPromiseToKew(player.pause());
    }
    sc.getStateMachine().setConsumeUpdateService('mpd', true, false);
    return this.#mpdPlugin.pause();
  }

  // Returns kew promise!
  resume() {
    const player = ExternalPlayers.getActive();
    if (player) {
      return jsPromiseToKew(player.resume());
    }
    sc.getStateMachine().setConsumeUpdateService('mpd', true, false);
    return this.#mpdPlugin.resume();
  }

  play() {
    const player = ExternalPlayers.getActive();
    if (player) {
      return jsPromiseToKew((async () => {
        if (player.getStatus()?.state === 'paused') {
          return player.resume();
        }
      })());
    }
    sc.getStateMachine().setConsumeUpdateService('mpd', true, false);
    return this.#mpdPlugin.play();
  }

  // Returns kew promise!
  seek(position: number) {
    const player = ExternalPlayers.getActive();
    if (player) {
      return jsPromiseToKew(player.seek(position / 1000));
    }
    sc.getStateMachine().setConsumeUpdateService('mpd', true, false);
    return this.#mpdPlugin.seek(position);
  }

  // Returns kew promise!
  next() {
    const player = ExternalPlayers.getActive();
    if (player) {
      return jsPromiseToKew(player.next());
    }
    sc.getStateMachine().setConsumeUpdateService('mpd', true, false);
    return this.#mpdPlugin.next();
  }

  // Returns kew promise!
  previous() {
    const player = ExternalPlayers.getActive();
    if (player) {
      return jsPromiseToKew(player.previous());
    }
    sc.getStateMachine().setConsumeUpdateService(undefined);
    return sc.getStateMachine().previous();
  }

  setRandom(value: boolean) {
    const player = ExternalPlayers.getActive();
    if (player) {
      player.setRandom(value);
    }
  }

  setRepeat(value: boolean, repeatSingle: boolean) {
    const player = ExternalPlayers.getActive();
    if (player) {
      return jsPromiseToKew(player.setRepeat(value, repeatSingle));
    }
  }

  #stripNewLine(str: string) {
    return str.replace(/(\r\n|\n|\r)/gm, '');
  }

  async getGotoUri(type: 'album' | 'artist', uri: QueueItem['uri']): Promise<string | null> {
    const trackView = ViewHelper.getViewsFromUri(uri).pop() as TrackView | undefined;
    if (trackView && trackView.name === 'track' && trackView.trackId && (type === 'album' || type === 'artist')) {
      if (type === 'album' && trackView.origin) {
        const origin = trackView.origin;
        if (origin.type === 'album') {
          const albumView: AlbumView = {
            name: 'albums',
            albumId: origin.albumId.toString()
          };
          return `soundcloud/${ViewHelper.constructUriSegmentFromView(albumView)}`;
        }
        else if (origin.type === 'playlist' || origin.type === 'system-playlist') {
          const playlistView: PlaylistView = {
            name: 'playlists',
            playlistId: origin.playlistId.toString()
          };
          if (origin.type === 'system-playlist') {
            playlistView.type = 'system';
          }
          return `soundcloud/${ViewHelper.constructUriSegmentFromView(playlistView)}`;
        }
      }
      const track = await Model.getInstance(ModelType.Track).getTrack(Number(trackView.trackId));
      if (track && track.user?.id !== undefined) {
        const userView: UserView = {
          name: 'users',
          userId: track.user.id.toString()
        };
        return `soundcloud/${ViewHelper.constructUriSegmentFromView(userView)}`;
      }

    }
    return 'soundcloud';
  }

  async reset() {
    await ExternalPlayers.quitAll();
  }
}
