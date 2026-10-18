'use strict';

async function handleTagAction(action, player, logger) {

    switch (action.action) {

        case 'play':
            return await handlePlay(action, player, logger);

        case 'pause':
            return await player.pause?.();

        case 'next':
            return await player.next?.();

        case 'previous':
            return await player.previous?.();

        default:
            throw new Error(`Onbekende action: ${action.action}`);
    }
}

async function handlePlay(action, player, logger) {

    const { type, source = 'local', data } = action;

    logger.info(
        `NFC Music: play -> type=${type}, source=${source}`
    );

    // -------------------------
    // LOCAL
    // -------------------------
    if (source === 'local') {

        switch (type) {

            case 'track':
                return await player.playTrack(data);

            case 'album':
                return await player.playAlbum(data);

            case 'playlist':
                return await player.playPlaylist(data);

            default:
                throw new Error(`Onbekend local type: ${type}`);
        }
    }

    // -------------------------
    // SPOTIFY (nieuw pad)
    // -------------------------
    if (source === 'spotify') {

        return await player.playSpotify({
            type,
            ...data
        });
    }

    throw new Error(`Onbekende source: ${source}`);
}

module.exports = {
    handleTagAction
};