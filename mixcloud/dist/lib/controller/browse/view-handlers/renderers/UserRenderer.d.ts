import BaseRenderer, { type RenderedHeader, type RenderedListItem } from './BaseRenderer';
import { type UserEntity } from '../../../../entities/UserEntity';
export default class UserRenderer extends BaseRenderer<UserEntity> {
    renderToListItem(user: UserEntity): RenderedListItem | null;
    renderToHeader(user: UserEntity): RenderedHeader | null;
}
//# sourceMappingURL=UserRenderer.d.ts.map