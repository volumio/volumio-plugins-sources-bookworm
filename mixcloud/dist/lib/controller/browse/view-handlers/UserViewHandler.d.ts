import type View from './View';
import { type RenderedPage } from './ViewHandler';
import ExplodableViewHandler from './ExplodableViewHandler';
import { type UserModelGetUsersParams } from '../../../model/UserModel';
export interface UserView extends View {
    name: 'user' | 'users';
    username?: string;
    keywords?: string;
    dateJoined?: UserModelGetUsersParams['dateJoined'];
    userType?: UserModelGetUsersParams['userType'];
    select?: 'dateJoined' | 'userType';
    playTarget?: 'liveStream';
}
export default class UserViewHandler extends ExplodableViewHandler<UserView> {
    #private;
    browse(): Promise<RenderedPage>;
    protected getStreamableEntitiesOnExplode(): Promise<import("../../../entities/CloudcastEntity").CloudcastEntity[] | import("../../../entities/LiveStreamEntity").LiveStreamEntity>;
}
//# sourceMappingURL=UserViewHandler.d.ts.map