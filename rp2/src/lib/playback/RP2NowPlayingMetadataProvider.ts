import {
  type MetadataAlbumInfo,
  type MetadataArtistInfo,
  type MetadataSongInfo,
  type NowPlayingMetadataProvider
} from 'now-playing-common';
import { convert } from 'html-to-text';
import rp2 from '../RP2Context';

export class RP2NowPlayingMetadataProvider implements NowPlayingMetadataProvider {
  version: '1.0.0';

  constructor() {
    this.version = '1.0.0';
  }

  async #rpGetSongInfo() {
    const rp = rp2.getRpjsLib();
    const track = rp.getStatus().track;
    if (track && track.type === 'M' && track.id) {
      const trackId = track.id;
      return {
        type: 'song' as const,
        info: await rp2.cacheOrGet(`song-info-${trackId}`, () =>
          rp.getSongInfo({ songId: trackId })
        )
      };
    }
    if (track && track.type === 'T' && track.episodeId) {
      const episodeId = track.episodeId;
      return {
        type: 'episode' as const,
        info: await rp2.cacheOrGet(`episode-${episodeId}`, () =>
          rp.getEpisode({ episodeId: episodeId })
        )
      };
    }
    return null;
  }

  async getSongInfo(songTitle: string): Promise<MetadataSongInfo | null> {
    try {
      const { type: infoType, info } = (await this.#rpGetSongInfo()) || {};
      if (!info) {
        return null;
      }
      switch (infoType) {
        case 'song': {
          const song: MetadataSongInfo = {
            title: info.title || songTitle,
            image: info.cover,
            artist:
              info.artist?.name ?
                await this.getArtistInfo(info.artist.name)
              : null,
            album:
              info.album?.name ?
                await this.getAlbumInfo(info.album.name, info.artist?.name)
              : null,
            description: info.wikiHtml ? this.#htmlToText(info.wikiHtml) : null
          };
          if (info.timedLyrics && info.timedLyrics.length > 0) {
            song.lyrics = {
              type: 'synced',
              lines: info.timedLyrics.map(({ text, time }) => ({
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
        }
        case 'episode': {
          const episode: MetadataSongInfo = {
            title: info.title,
            image: info.episodeImage.large,
            artist: {
              name: info.guests.map((guest) => guest.name).join(', '),
              image: info.bioImage.large,
              description:
                info.guestBio ? this.#htmlToText(info.guestBio) : null
            },
            description: info.overview ? this.#htmlToText(info.overview) : null
          };
          return episode;
        }
        default:
          return null;
      }
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
      const { type: infoType, info } = (await this.#rpGetSongInfo()) || {};
      switch (infoType) {
        case 'song': {
          const albumId = info?.album?.id;
          if (!albumId) {
            return null;
          }
          const albumInfo = await rp2.cacheOrGet(`album-info-${albumId}`, () =>
            rp.getAlbumInfo({ albumId: albumId })
          );
          if (!albumInfo) {
            return null;
          }
          const album: MetadataAlbumInfo = {
            title: albumInfo.name || albumTitle,
            image: albumInfo.cover,
            artist: artistName ? await this.getArtistInfo(artistName) : null,
            releaseDate: albumInfo.releaseDate
          };
          return album;
        }
        default:
          return null;
      }
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
      const { type: infoType, info } = (await this.#rpGetSongInfo()) || {};
      switch (infoType) {
        case 'song': {
          const artistId = info?.artist?.id;
          if (!artistId) {
            return null;
          }
          const artistInfo = await rp2.cacheOrGet(
            `artist-info-${artistId}`,
            () => rp.getArtistInfo({ artistId })
          );
          if (!artistInfo) {
            return null;
          }
          const artist: MetadataArtistInfo = {
            name: artistInfo.name || artistName,
            image: artistInfo.images?.default,
            description:
              artistInfo.bio ? this.#htmlToText(artistInfo.bio) : null
          };
          return artist;
        }
        case 'episode': {
          if (!info) {
            return null;
          }
          return {
            name: info.guests.map((guest) => guest.name).join(', '),
            image: info.bioImage.large,
            description: info.guestBio ? this.#htmlToText(info.guestBio) : null
          };
        }
        default:
          return null;
      }
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
}
