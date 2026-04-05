import {
  type AlbumInfo,
  type ArtistInfo,
  type Channel,
  type Episode,
  type EpisodeList,
  type SongInfo
} from '@patrickkfkan/rp.js';
import { LRUCache } from 'lru-cache';

export type CacheKey =
  | 'channels'
  | `episodes-page-${string}`
  | `song-info-${string}`
  | `artist-info-${string}`
  | `album-info-${string}`
  | `episode-${string}`;
export type CacheRecord<K extends CacheKey> =
  K extends 'channels' ? Promise<Channel[]>
  : K extends `episodes-page-${string}` ? Promise<EpisodeList>
  : K extends `song-info-${string}` ? Promise<SongInfo | null>
  : K extends `artist-info-${string}` ? Promise<ArtistInfo | null>
  : K extends `album-info-${string}` ? Promise<AlbumInfo | null>
  : K extends `episode-${string}` ? Promise<Episode | null>
  : never;
export type CacheValue = Promise<
  Channel[] | EpisodeList | SongInfo | ArtistInfo | AlbumInfo | Episode | null
>;

export class Cache {
  #cache: LRUCache<CacheKey, CacheValue>;

  constructor() {
    this.#cache = new LRUCache({
      max: 500,
      ttl: 1800000 // 30mins
    });
  }

  get<K extends CacheKey>(key: K): CacheRecord<K> | undefined {
    return this.#cache.get(key) as CacheRecord<K> | undefined;
  }

  set<K extends CacheKey>(key: K, value: CacheRecord<K>) {
    this.#cache.set(key, value);
  }

  cacheOrGet<K extends CacheKey>(
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

  clear() {
    this.#cache.clear();
  }
}
