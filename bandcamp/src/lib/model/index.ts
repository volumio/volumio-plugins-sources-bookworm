import bcfetch, { type Logger } from 'bandcamp-fetch';
import AlbumModel from './AlbumModel';
import ArticleModel from './ArticleModel';
import BandModel from './BandModel';
import DiscoverModel from './DiscoverModel';
import FanModel from './FanModel';
import SearchModel from './SearchModel';
import ShowModel from './ShowModel';
import TagModel from './TagModel';
import TrackModel from './TrackModel';
import bandcamp from '../BandcampContext';
import PlaylistModel from './PlaylistModel';

export enum ModelType {
  Album = 'Album',
  Article = 'Article',
  Band = 'Band',
  Discover = 'Discover',
  Fan = 'Fan',
  Search = 'Search',
  Show = 'Show',
  Tag = 'Tag',
  Track = 'Track',
  Playlist = 'Playlist'
}

const MODEL_TYPE_TO_CLASS: Record<any, any> = {
  [ModelType.Album]: AlbumModel,
  [ModelType.Article]: ArticleModel,
  [ModelType.Band]: BandModel,
  [ModelType.Discover]: DiscoverModel,
  [ModelType.Fan]: FanModel,
  [ModelType.Search]: SearchModel,
  [ModelType.Show]: ShowModel,
  [ModelType.Tag]: TagModel,
  [ModelType.Track]: TrackModel,
  [ModelType.Playlist]: PlaylistModel
};

export default class Model {
  static #logger: Logger;

  static {
    bcfetch.setPuppeteerExecutablePath('/usr/bin/chromium-headless-shell');
    this.#logger = {
      info: (msg) => bandcamp.getLogger().info(`[bandcamp] (bcfetch) ${msg}`),
      warn: (msg) => bandcamp.getLogger().warn(`[bandcamp] (bcfetch) ${msg}`),
      debug: (msg) =>
        bandcamp.getLogger().verbose(`[bandcamp] (bcfetch) ${msg}`),
      error: (msg) => bandcamp.getLogger().error(`[bandcamp] (bcfetch) ${msg}`)
    };
  }

  static getInstance(type: ModelType.Album): AlbumModel;
  static getInstance(type: ModelType.Article): ArticleModel;
  static getInstance(type: ModelType.Band): BandModel;
  static getInstance(type: ModelType.Discover): DiscoverModel;
  static getInstance(type: ModelType.Fan): FanModel;
  static getInstance(type: ModelType.Search): SearchModel;
  static getInstance(type: ModelType.Playlist): PlaylistModel;
  static getInstance(type: ModelType.Show): ShowModel;
  static getInstance(type: ModelType.Tag): TagModel;
  static getInstance(type: ModelType.Track): TrackModel;
  static getInstance(type: ModelType) {
    if (MODEL_TYPE_TO_CLASS[type]) {
      return new MODEL_TYPE_TO_CLASS[type]();
    }
    throw Error(`Model not found for type ${type}`);
  }

  static setCookie(value?: string | null) {
    bcfetch.setCookie(value);
  }

  static get cookie() {
    return bcfetch.cookie;
  }

  static setLogDebugMessages(value: boolean) {
    if (value) {
      bcfetch.setLogger(this.#logger);
    } else {
      bcfetch.setLogger(null);
    }
  }

  static reset() {
    bcfetch.setCookie();
    this.clearLibCache();
  }

  static clearLibCache() {
    bcfetch.cache.clear();
  }

  static async ensureStreamURL(url: string) {
    const testResult = await bcfetch.stream.test(url);
    if (testResult.ok) {
      return url;
    }
    return await bcfetch.stream.refresh(url);
  }
}
