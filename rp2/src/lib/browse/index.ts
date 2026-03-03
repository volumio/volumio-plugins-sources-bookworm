import { getChannelsPage } from './channels';

export async function getPage(uri: string) {
  if (uri === 'rp2') {
    return await getChannelsPage();
  }
  throw Error(`Unknown URI: ${uri}`);
}
