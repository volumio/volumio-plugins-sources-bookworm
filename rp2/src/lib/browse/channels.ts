import { type Display } from './types';
import rp2 from '../RP2Context';
import { type QueueItem } from '../playback/types';

export async function getChannelsPage(): Promise<Display.Page> {
  const rpjs = rp2.getRpjsLib();
  const channels = await rpjs.getChannels();
  const list: Display.List = {
    title: rp2.getI18n('RP2_CHANNELS'),
    items: channels.map((channel) => {
      const qi = JSON.stringify({
        service: 'rp2',
        uri: `rp2/channel@id=${encodeURIComponent(channel.id)}`,
        name: channel.title,
        title: channel.title,
        artist: rp2.getI18n('RP2_RP'),
        albumart: channel.images.default
      } satisfies QueueItem);
      const item: Display.ListItem = {
        service: 'rp2',
        title: channel.title,
        artist: rp2.getI18n('RP2_RP'),
        type: 'mywebradio',
        albumart: channel.images.default,
        uri: `rp2/channel@qi=${encodeURIComponent(qi)}`
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
