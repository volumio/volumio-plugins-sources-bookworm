import sc from '../../../../SoundCloudContext';
import type UserEntity from '../../../../entities/UserEntity';
import { type UserView } from '../UserViewHandler';
import ViewHelper from '../ViewHelper';
import BaseRenderer, { type RenderedHeader, type RenderedListItem } from './BaseRenderer';

export default class UserRenderer extends BaseRenderer<UserEntity> {

  renderToListItem(data: UserEntity): RenderedListItem | null {
    if (typeof data.id !== 'number' || !data.id || !data.username) {
      return null;
    }

    const userView: UserView = {
      name: 'users',
      userId: data.id.toString()
    };

    return {
      service: 'soundcloud',
      type: 'folder',
      title: data.username,
      artist: data.fullName || data.location,
      album: sc.getI18n('SOUNDCLOUD_USER_PARSER_ALBUM'),
      albumart: data.thumbnail || this.getAvatarIcon(),
      uri: `${this.uri}/${ViewHelper.constructUriSegmentFromView(userView)}`
    };
  }

  renderToHeader(data: UserEntity): RenderedHeader | null {
    return {
      uri: this.uri,
      service: 'soundcloud',
      type: 'album',
      title: data.username,
      artist: data.fullName,
      year: data.location,
      albumart: data.thumbnail || this.getAvatarIcon()
    };
  }
}
