import { type Category, type Cloudcast, type LiveStream, type Playlist, type Tag, type User } from 'mixcloud-fetch';
import { type UserEntity } from '../entities/UserEntity.js';
import { type CloudcastEntity } from '../entities/CloudcastEntity.js';
import { type PlaylistEntity } from '../entities/PlaylistEntity.js';
import { type SlugEntity } from '../entities/SlugEntity.js';
import { type LiveStreamEntity } from '../entities/LiveStreamEntity.js';
export default class EntityConverter {
    static convertCloudcast(data: Cloudcast): CloudcastEntity;
    static convertUser(data: User): UserEntity;
    static convertPlaylist(data: Playlist): PlaylistEntity;
    static convertSlugLike(data: Category | Tag): SlugEntity;
    static convertLiveStream(data: LiveStream): LiveStreamEntity;
}
//# sourceMappingURL=EntityConverter.d.ts.map