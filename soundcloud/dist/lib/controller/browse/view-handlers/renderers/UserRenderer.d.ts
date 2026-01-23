import type UserEntity from '../../../../entities/UserEntity';
import BaseRenderer, { type RenderedHeader, type RenderedListItem } from './BaseRenderer';
export default class UserRenderer extends BaseRenderer<UserEntity> {
    renderToListItem(data: UserEntity): RenderedListItem | null;
    renderToHeader(data: UserEntity): RenderedHeader | null;
}
//# sourceMappingURL=UserRenderer.d.ts.map