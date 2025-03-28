import type SetEntity from './SetEntity';

interface AlbumEntity extends SetEntity {
  type: 'album';
  id?: number;
}

export default AlbumEntity;
