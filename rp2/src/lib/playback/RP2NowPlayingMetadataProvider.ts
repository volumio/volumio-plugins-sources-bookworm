import {
  type MetadataAlbumInfo,
  type MetadataArtistInfo,
  type MetadataSongInfo,
  type NowPlayingMetadataProvider
} from 'now-playing-common';
import { LRUCache } from 'lru-cache';
import { convert } from 'html-to-text';
import rp2 from '../RP2Context';
import {
  type AlbumInfo,
  type ArtistInfo,
  type SongInfo
} from '@patrickkfkan/rp.js';

type CacheKey =
  | `song-info-${string}`
  | `artist-info-${string}`
  | `album-info-${string}`;
type CacheRecord<K extends CacheKey> =
  K extends `song-info-${string}` ? Promise<SongInfo | null>
  : K extends `artist-info-${string}` ? Promise<ArtistInfo | null>
  : K extends `album-info-${string}` ? Promise<AlbumInfo | null>
  : never;
type CacheValue = Promise<SongInfo | ArtistInfo | AlbumInfo | null>;

export class RP2NowPlayingMetadataProvider implements NowPlayingMetadataProvider {
  version: '1.0.0';

  #cache: LRUCache<CacheKey, CacheValue>;

  constructor() {
    this.version = '1.0.0';
    this.#cache = new LRUCache({
      max: 100,
      ttl: 600000 // 10mins
    });
  }

  #cacheOrGet<K extends CacheKey>(
    key: K,
    get: () => CacheRecord<K>
  ): CacheRecord<K> {
    let v = this.#cache.get(key) as CacheRecord<K> | undefined;
    if (v !== undefined) {
      return v;
    }
    v = get();
    this.#cache.set(key, v);
    return v;
  }

  async #rpGetSongInfo() {
    const rp = rp2.getRpjsLib();
    const track = rp.getStatus().track;
    const trackId = track?.id;
    // Metadata only available for track type 'M' (music)
    if (!track || !trackId || track.type !== 'M') {
      return null;
    }
    return await this.#cacheOrGet(`song-info-${trackId}`, () =>
      rp.getSongInfo({ song_id: trackId })
    );
  }

  async getSongInfo(songTitle: string): Promise<MetadataSongInfo | null> {
    try {
      const info = await this.#rpGetSongInfo();
      if (!info) {
        return null;
      }
      const song: MetadataSongInfo = {
        title: info.title || songTitle,
        image: info.cover,
        artist:
          info.artist?.name ? await this.getArtistInfo(info.artist.name) : null,
        album:
          info.album?.name ?
            await this.getAlbumInfo(info.album.name, info.artist?.name)
          : null,
        description: info.wiki_html ? this.#htmlToText(info.wiki_html) : null
      };
      if (info.timed_lyrics && info.timed_lyrics.length > 0) {
        song.lyrics = {
          type: 'synced',
          lines: info.timed_lyrics.map(({ text, time }) => ({
            text,
            start: time
          }))
        };
      } else if (info.lyrics) {
        song.lyrics = {
          type: 'html',
          lines: info.lyrics
        };
      }
      return song;
    } catch (error: unknown) {
      rp2
        .getLogger()
        .error(rp2.getErrorMessage('[rp2] Error fetching song info:', error));
      return null;
    }
  }

  async getAlbumInfo(
    albumTitle: string,
    artistName?: string
  ): Promise<MetadataAlbumInfo | null> {
    try {
      const rp = rp2.getRpjsLib();
      const songInfo = await this.#rpGetSongInfo();
      const albumId = songInfo?.album?.id;
      if (!albumId) {
        return null;
      }
      const albumInfo = await this.#cacheOrGet(`album-info-${albumId}`, () =>
        rp.getAlbumInfo({ album_id: albumId })
      );
      if (!albumInfo) {
        return null;
      }
      const album: MetadataAlbumInfo = {
        title: albumInfo.name || albumTitle,
        image: albumInfo.cover,
        artist: artistName ? await this.getArtistInfo(artistName) : null,
        releaseDate: albumInfo.release_date
      };
      return album;
    } catch (error: unknown) {
      rp2
        .getLogger()
        .error(rp2.getErrorMessage('[rp2] Error fetching album info:', error));
      return null;
    }
  }

  async getArtistInfo(artistName: string): Promise<MetadataArtistInfo | null> {
    try {
      const rp = rp2.getRpjsLib();
      const songInfo = await this.#rpGetSongInfo();
      const artistId = songInfo?.artist?.id;
      if (!artistId) {
        return null;
      }
      const artistInfo = await this.#cacheOrGet(`artist-info-${artistId}`, () =>
        rp.getArtistInfo({ artist_id: artistId })
      );
      if (!artistInfo) {
        return null;
      }
      const artist: MetadataArtistInfo = {
        name: artistInfo.name || artistName,
        image: artistInfo.images?.default,
        description: artistInfo.bio ? this.#htmlToText(artistInfo.bio) : null
      };
      return artist;
    } catch (error: unknown) {
      rp2
        .getLogger()
        .error(rp2.getErrorMessage('[rp2] Error fetching artist info:', error));
      return null;
    }
  }

  #htmlToText(html: string) {
    const text = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' }
      ]
    });
    return text
      .replace(/\n\s*\n\s*\n+/g, '\n\n') // Collapses 2+ blank lines into 1
      .trim();
  }

  reset() {
    this.#cache.clear();
  }
}
