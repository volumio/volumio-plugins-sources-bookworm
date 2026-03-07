import AlbumModel from './AlbumModel';
import BaseModel from './BaseModel';
import FeedModel from './FeedModel';
import HistoryModel from './HistoryModel';
import MeModel from './MeModel';
import PlaylistModel from './PlaylistModel';
import SelectionModel from './SelectionModel';
import TrackModel from './TrackModel';
import UserModel from './UserModel';

export enum ModelType {
  Album = 'Album',
  Playlist = 'Playlist',
  Selection = 'Selection',
  Track = 'Track',
  User = 'User',
  History = 'History',
  Me = 'Me',
  Feed = 'Feed'
}

export type ModelOf<T extends ModelType> =
  T extends ModelType.Album ? AlbumModel :
  T extends ModelType.Playlist ? PlaylistModel :
  T extends ModelType.Selection ? SelectionModel :
  T extends ModelType.Track ? TrackModel :
  T extends ModelType.User ? UserModel :
  T extends ModelType.History ? HistoryModel :
  T extends ModelType.Me ? MeModel :
  T extends ModelType.Feed ? FeedModel :
  never;

const MODEL_TYPE_TO_CLASS: Record<ModelType, any> = {
  [ModelType.Album]: AlbumModel,
  [ModelType.Playlist]: PlaylistModel,
  [ModelType.Selection]: SelectionModel,
  [ModelType.Track]: TrackModel,
  [ModelType.User]: UserModel,
  [ModelType.History]: HistoryModel,
  [ModelType.Me]: MeModel,
  [ModelType.Feed]: FeedModel
};

export default class Model {

  static getInstance<T extends ModelType>(type: T): ModelOf<T> {
    if (MODEL_TYPE_TO_CLASS[type]) {
      return new MODEL_TYPE_TO_CLASS[type]();
    }
    throw Error(`Model not found for type ${type}`);
  }

  static setAccessToken(value: string) {
    BaseModel.setAccessToken(value);
  }

  static setCookie(value: string) {
    BaseModel.setCookie(value);
  }

  static setLocale(value: string) {
    BaseModel.setLocale(value);
  }
}
