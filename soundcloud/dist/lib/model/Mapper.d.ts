import { Album, type LibraryItem, Playlist, type Selection, SystemPlaylist, Track, User } from 'soundcloud-fetch';
import type UserEntity from '../entities/UserEntity';
import type PlaylistEntity from '../entities/PlaylistEntity';
import type TrackEntity from '../entities/TrackEntity';
import type AlbumEntity from '../entities/AlbumEntity';
import type SelectionEntity from '../entities/SelectionEntity';
export default class Mapper {
    #private;
    static mapUser(data: User): Promise<UserEntity>;
    static mapPlaylist(data: Playlist | SystemPlaylist): Promise<PlaylistEntity>;
    static mapTrack(data: Track): Promise<TrackEntity>;
    static mapLibraryItem(data: LibraryItem): Promise<AlbumEntity | PlaylistEntity | null>;
    static mapAlbum(data: Album): Promise<AlbumEntity>;
    static mapSelection(data: Selection): Promise<SelectionEntity>;
}
//# sourceMappingURL=Mapper.d.ts.map