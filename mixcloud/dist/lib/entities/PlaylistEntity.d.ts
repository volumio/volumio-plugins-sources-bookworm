import { type UserEntity } from './UserEntity';
export interface PlaylistEntity {
    type: 'playlist';
    id: string;
    name: string;
    description?: string;
    url?: string;
    owner?: UserEntity;
}
//# sourceMappingURL=PlaylistEntity.d.ts.map