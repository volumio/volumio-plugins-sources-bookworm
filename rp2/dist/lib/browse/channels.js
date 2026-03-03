"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChannelsPage = getChannelsPage;
const RP2Context_1 = __importDefault(require("../RP2Context"));
async function getChannelsPage() {
    const rpjs = RP2Context_1.default.getRpjsLib();
    const channels = await rpjs.getChannels();
    const list = {
        title: RP2Context_1.default.getI18n('RP2_CHANNELS'),
        items: channels.map((channel) => {
            const qi = JSON.stringify({
                service: 'rp2',
                uri: `rp2/channel@id=${encodeURIComponent(channel.id)}`,
                name: channel.title,
                title: channel.title,
                artist: RP2Context_1.default.getI18n('RP2_RP'),
                albumart: channel.images.default
            });
            const item = {
                service: 'rp2',
                title: channel.title,
                artist: RP2Context_1.default.getI18n('RP2_RP'),
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
