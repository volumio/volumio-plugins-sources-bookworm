"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueItems = getQueueItems;
const util_1 = require("../util");
function getQueueItems(uri) {
    const view = (0, util_1.parseUri)(uri).pop();
    if (!view) {
        throw Error(`Invalid URI "${uri}"`);
    }
    if (!view.params.qi) {
        throw Error(`Invalid URI "${uri}"`);
    }
    try {
        const queueItem = JSON.parse(view.params.qi);
        return Promise.resolve([queueItem]);
    }
    catch (error) {
        throw Error(`Queue item could not be parsed from ${uri}`);
    }
}
