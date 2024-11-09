import { YTNodes } from 'volumio-youtubei.js';
import { type PluginConfig } from '../types';
import { AuthStatus } from '../util/Auth';
import { BaseModel } from './BaseModel';
import InnertubeResultParser from './InnertubeResultParser';

export default class AccountModel extends BaseModel {

  async getInfo(): Promise<PluginConfig.Account | null> {
    const { innertube, auth } = await this.getInnertube();

    if (auth.getStatus().status !== AuthStatus.SignedIn) {
      return null;
    }

    const info = await innertube.account.getInfo();

    // This plugin supports single sign-in, so there should only be one account in contents.
    // But we still get the 'selected' one just to be sure.
    const account = info.contents?.contents.find((ac) => ac instanceof YTNodes.AccountItem && ac.is_selected);

    if (account instanceof YTNodes.AccountItem) {
      const name = InnertubeResultParser.unwrap(account?.account_name);

      if (name) {
        const result: PluginConfig.Account = {
          name,
          photo: InnertubeResultParser.parseThumbnail(account.account_photo)
        };

        return result;
      }
    }

    return null;
  }
}
