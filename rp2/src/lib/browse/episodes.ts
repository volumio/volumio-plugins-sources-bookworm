import { type Display } from './types';
import rp2 from '../RP2Context';
import { type QueueItem } from '../playback/types';

const ITEMS_PER_PAGE = 41;

export async function getEpisodesPage(
  channel: string,
  page = 1
): Promise<Display.Page> {
  const rpjs = rp2.getRpjsLib();
  const { episodes, start, total } = await rp2.cacheOrGet(
    `episodes-page-${page}`,
    () =>
      rpjs.getEpisodeList({
        limit: ITEMS_PER_PAGE,
        start: (page - 1) * ITEMS_PER_PAGE
      })
  );
  const list: Display.List = {
    title: rp2.getI18n('RP2_EPISODES'),
    items: episodes.map((episode) => {
      const albumart =
        episode.bioImage.large || episode.episodeImage.large || undefined;
      const guests = episode.guests.map((guest) => guest.name).join(', ');
      const date = episode.date.split('T').at(0);
      const qi = JSON.stringify({
        service: 'rp2',
        uri: `rp2/episode@id=${encodeURIComponent(episode.id)}@channel=${encodeURIComponent(channel)}`,
        name: episode.title,
        title: episode.title,
        artist: guests,
        album: date,
        albumart
      } satisfies QueueItem);
      const item: Display.ListItem = {
        service: 'rp2',
        title: episode.title,
        artist: guests,
        album: date,
        type: 'mywebradio',
        albumart,
        uri: `rp2/episode@qi=${encodeURIComponent(qi)}`
      };
      return item;
    }),
    availableListViews: ['grid', 'list']
  };
  if (start + episodes.length < total) {
    list.items.push({
      service: 'rp2',
      uri: `rp2/episodes@channel=${encodeURIComponent(channel)}@p=${page + 1}`,
      title: rp2.getI18n('RP2_MORE'),
      type: 'item-no-menu',
      icon: 'fa fa-arrow-circle-right'
    });
  }
  return {
    navigation: {
      prev: {
        uri: 'rp2'
      },
      lists: [list]
    }
  };
}
