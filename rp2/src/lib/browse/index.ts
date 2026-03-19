import { parseUri } from '../util';
import { getChannelsPage } from './channels';
import { getEpisodesPage } from './episodes';

export async function getPage(uri: string) {
  const view = parseUri(uri).pop();
  switch (view?.name) {
    case 'episodes':
      if (!view.params.channel) {
        throw Error(`Invalid URI: ${uri}`);
      }
      return await getEpisodesPage(view.params.channel, view.params.p && !isNaN(Number(view.params.p)) ? Number(view.params.p) : undefined);
    case 'root':
      return await getChannelsPage();
    default:
      throw Error(`Invalid URI: ${uri}`);
  }
}
