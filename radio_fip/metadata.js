'use strict';

const https = require('https');

const CACHE_TIME = 0;
let cache = {};

/*
 * Performs an HTTPS GET request and parses the JSON response.
 */
function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                "User-Agent": "Volumio Radio FIP Plugin"
            }
        }, res => {
            let data = "";
            res.on("data", d => data += d);
            res.on("end", () => {
                if (res.statusCode !== 200) {
                    reject(new Error("HTTP " + res.statusCode));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on("error", reject);
    });
}

/*
 * Retrieves current metadata from the official Radio France LiveMeta endpoint.
 */
async function fetchMetadata(id) {
    const url =
        "https://api.radiofrance.fr/livemeta/live/" +
        id +
        "/transistor_musical_player";
    return await httpGet(url);
}

/*
 * Retrieves the current song information from the official Radio France LiveMeta endpoint.
 */
async function fetchCurrentSong(id) {
    const url =
        "https://api.radiofrance.fr/livemeta/pull/" +
        id;
    const json = await httpGet(url);

    if (!json || !json.steps) {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    let current = null;

    Object.keys(json.steps).forEach(function(key) {
        const step = json.steps[key];

        if (
            step &&
            step.start &&
            step.end &&
            step.start <= now &&
            now <= step.end
        ) {
            current = step;
        }
    });

    return current;
}

/*
 * Cleans a metadata value returned by Radio France.
 */
function clean(v) {
    if (!v) {
        return "";
    }

    return String(v)
        .replace(/^"+|"+$/g, "")
        .trim();
}

/*
 * Parses the current Radio France track metadata.
 */
function parseMetadata(json) {
    if (!json || !json.now) {
        return {
            title: "",
            artist: "",
            album: "",
            label: "",
            image: ""
        };
    }

    const now = json.now;
    const secondLine = clean(now.secondLine);

    let artist = "";
    let title = secondLine;

    const separator = secondLine.indexOf(" • ");

    if (separator >= 0) {
        artist = clean(
            secondLine.substring(0, separator)
        );

        title = clean(
            secondLine.substring(separator + 3)
        );
    }

    return {
        title: title,
        artist: artist,
        album: "",
        label: "",
        image: ""
    };
}

/*
 * Retrieves and caches current metadata for a station.
 */
async function getMetadata(id) {
    const now = Date.now();

    if (
        cache[id] &&
        (now - cache[id].time) < CACHE_TIME
    ) {
        return cache[id].data;
    }

    try {
        const liveJson = await fetchMetadata(id);
        const track = parseMetadata(liveJson);

        let artwork = "";
        let album = "";
        let label = "";

        try {
            const currentSong = await fetchCurrentSong(id);

            if (currentSong) {
                artwork = clean(currentSong.visual);
                album = clean(currentSong.titreAlbum);
                label = clean(currentSong.label);
            }
        } catch (e) {
            // The /pull endpoint is not available for every FIP station.
        }

        const data = {
            title: track.title,
            artist: track.artist,
            album: album,
            label: label,
            albumart: artwork
        };

        cache[id] = {
            time: now,
            data: data
        };

        return data;
    } catch (e) {
        return {
            title: "",
            artist: "",
            album: "",
            label: "",
            albumart: "",
            error: e.message
        };
    }
}

module.exports = {
    getMetadata: getMetadata
};
