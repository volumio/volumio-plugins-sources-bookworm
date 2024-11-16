import type Innertube from 'volumio-youtubei.js';
import { YTNodes, Endpoints, YT } from 'volumio-youtubei.js';
import { type PluginConfig } from '../types';
import { BaseModel } from './BaseModel';
import InnertubeResultParser from './InnertubeResultParser';
import { getAccountInitialInfo } from './AccountModelHelper';

export default class AccountModel extends BaseModel {

  async getInfo() {
    const { innertube } = await this.getInnertube();
    const { isSignedIn, response } = await getAccountInitialInfo(innertube);

    if (!isSignedIn) {
      return {
        isSignedIn: false,
        info: null
      };
    }

    const info = new YT.AccountInfo(response);   
    // This plugin supports single sign-in, so there should only be one account in contents.
    // But we still get the 'selected' one just to be sure.
    const account = info.contents?.contents.find((ac) => ac.is(YTNodes.AccountItem) && ac.is_selected);

    if (account?.is(YTNodes.AccountItem)) {
      const name = InnertubeResultParser.unwrap(account?.account_name);

      if (name) {
        const result: PluginConfig.Account = {
          name,
          photo: InnertubeResultParser.parseThumbnail(account.account_photo)
        };

        return {
          isSignedIn: true,
          info: result
        };
      }
    }

    throw Error('Signed in but unable to get account info')
  }
}
