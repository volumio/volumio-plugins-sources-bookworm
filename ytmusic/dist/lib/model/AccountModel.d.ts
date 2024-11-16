import { type PluginConfig } from '../types';
import { BaseModel } from './BaseModel';
export default class AccountModel extends BaseModel {
    getInfo(): Promise<{
        isSignedIn: boolean;
        info: null;
    } | {
        isSignedIn: boolean;
        info: PluginConfig.Account;
    }>;
}
//# sourceMappingURL=AccountModel.d.ts.map