"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPage = getPage;
const util_1 = require("../util");
const channels_1 = require("./channels");
const episodes_1 = require("./episodes");
async function getPage(uri) {
    const view = (0, util_1.parseUri)(uri).pop();
    switch (view?.name) {
        case 'episodes':
            if (!view.params.channel) {
                throw Error(`Invalid URI: ${uri}`);
            }
            return await (0, episodes_1.getEpisodesPage)(view.params.channel, view.params.p && !isNaN(Number(view.params.p)) ?
                Number(view.params.p)
                : undefined);
        case 'root':
            return await (0, channels_1.getChannelsPage)();
        default:
            throw Error(`Invalid URI: ${uri}`);
    }
}
