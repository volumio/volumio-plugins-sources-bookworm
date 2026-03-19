"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChannelsPage = getChannelsPage;
const RP2Context_1 = __importDefault(require("../RP2Context"));
async function getChannelsPage() {
    const rpjs = RP2Context_1.default.getRpjsLib();
    const channels = await RP2Context_1.default.cacheOrGet('channels', () => rpjs.getChannels());
    const list = {
        title: RP2Context_1.default.getI18n('RP2_CHANNELS'),
        items: channels.map((channel) => {
            let qiUri;
            let liUri;
            let type;
            if (channel.isEpisodicRadio) {
                qiUri = `rp2/episodes@channel=${encodeURIComponent(channel.id)}`;
                type = 'folder';
            }
            else {
                qiUri = `rp2/channel@id=${encodeURIComponent(channel.id)}`;
                type = 'mywebradio';
            }
            const qi = JSON.stringify({
                service: 'rp2',
                uri: qiUri,
                name: channel.title,
                title: channel.title,
                artist: RP2Context_1.default.getI18n('RP2_RP'),
                albumart: channel.images.default ?? undefined
            });
            if (channel.isEpisodicRadio) {
                liUri = `rp2/episodes@channel=${encodeURIComponent(channel.id)}@qi=${encodeURIComponent(qi)}`;
            }
            else {
                liUri = `rp2/channel@qi=${encodeURIComponent(qi)}`;
            }
            const item = {
                service: 'rp2',
                title: channel.title,
                artist: RP2Context_1.default.getI18n('RP2_RP'),
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
