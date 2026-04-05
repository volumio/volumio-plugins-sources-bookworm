import { type Display } from './types';
import rp2 from '../RP2Context';
import { type QueueItem } from '../playback/types';

export async function getChannelsPage(): Promise<Display.Page> {
  const rpjs = rp2.getRpjsLib();
  const channels = await rp2.cacheOrGet('channels', () => rpjs.getChannels());
  const list: Display.List = {
    title: rp2.getI18n('RP2_CHANNELS'),
    items: channels.map((channel) => {
      let qiUri: string;
      let liUri: string;
      let type: Display.ListItem['type'];
      if (channel.isEpisodicRadio) {
        qiUri = `rp2/episodes@channel=${encodeURIComponent(channel.id)}`;
        type = 'folder';
      } else {
        qiUri = `rp2/channel@id=${encodeURIComponent(channel.id)}`;
        type = 'mywebradio';
      }
      const qi = JSON.stringify({
        service: 'rp2',
        uri: qiUri,
        name: channel.title,
        title: channel.title,
        artist: rp2.getI18n('RP2_RP'),
        albumart: channel.images.default ?? undefined
      } satisfies QueueItem);
      if (channel.isEpisodicRadio) {
        liUri = `rp2/episodes@channel=${encodeURIComponent(channel.id)}@qi=${encodeURIComponent(qi)}`;
      } else {
        liUri = `rp2/channel@qi=${encodeURIComponent(qi)}`;
      }
      const item: Display.ListItem = {
        service: 'rp2',
        title: channel.title,
        artist: rp2.getI18n('RP2_RP'),
        type,
        albumart: channel.images.default,
        uri: liUri
      };
      return item;
    }),
    availableListViews: ['grid', 'list']
  };
  return {
    navigation: {
      prev: {
        uri: '/'
      },
      lists: [list]
    }
  };
}
