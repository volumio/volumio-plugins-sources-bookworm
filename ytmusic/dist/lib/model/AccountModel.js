"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const volumio_youtubei_js_1 = require("volumio-youtubei.js");
const BaseModel_1 = require("./BaseModel");
const InnertubeResultParser_1 = __importDefault(require("./InnertubeResultParser"));
const AccountModelHelper_1 = require("./AccountModelHelper");
class AccountModel extends BaseModel_1.BaseModel {
    async getInfo() {
        const { innertube } = await this.getInnertube();
        const { isSignedIn, response } = await (0, AccountModelHelper_1.getAccountInitialInfo)(innertube);
        if (!isSignedIn) {
            return {
                isSignedIn: false,
                info: null
            };
        }
        const info = new volumio_youtubei_js_1.YT.AccountInfo(response);
        // This plugin supports single sign-in, so there should only be one account in contents.
        // But we still get the 'selected' one just to be sure.
        const account = info.contents?.contents.find((ac) => ac.is(volumio_youtubei_js_1.YTNodes.AccountItem) && ac.is_selected);
        if (account?.is(volumio_youtubei_js_1.YTNodes.AccountItem)) {
            const name = InnertubeResultParser_1.default.unwrap(account?.account_name);
            if (name) {
                const result = {
                    name,
                    photo: InnertubeResultParser_1.default.parseThumbnail(account.account_photo)
                };
                return {
                    isSignedIn: true,
                    info: result
                };
            }
        }
        throw Error('Signed in but unable to get account info');
    }
}
exports.default = AccountModel;
//# sourceMappingURL=AccountModel.js.map