"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEpisodesPage = getEpisodesPage;
const RP2Context_1 = __importDefault(require("../RP2Context"));
const ITEMS_PER_PAGE = 41;
async function getEpisodesPage(channel, page = 1) {
    const rpjs = RP2Context_1.default.getRpjsLib();
    const { episodes, start, total } = await RP2Context_1.default.cacheOrGet(`episodes-page-${page}`, () => rpjs.getEpisodeList({
        limit: ITEMS_PER_PAGE,
        start: (page - 1) * ITEMS_PER_PAGE
    }));
    const list = {
        title: RP2Context_1.default.getI18n('RP2_EPISODES'),
        items: episodes.map((episode) => {
            const albumart = episode.bioImage.large || episode.episodeImage.large || undefined;
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
            });
            const item = {
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
            title: RP2Context_1.default.getI18n('RP2_MORE'),
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
