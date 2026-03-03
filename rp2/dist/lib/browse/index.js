"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPage = getPage;
const channels_1 = require("./channels");
async function getPage(uri) {
    if (uri === 'rp2') {
        return await (0, channels_1.getChannelsPage)();
    }
    throw Error(`Unknown URI: ${uri}`);
}
