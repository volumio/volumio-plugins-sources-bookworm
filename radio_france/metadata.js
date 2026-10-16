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
                "User-Agent": "Volumio Radio France Plugin"
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
 * Retrieves current programme metadata for an ICI local station.
 */
async function fetchIciMetadata(id) {
    const url =
        "https://api.radiofrance.fr/livemeta/live/" +
        id +
        "/new_apprf_bleu";
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
 * Converts Radio France image UUIDs to URLs supported by Volumio.
 */
function getArtworkUrl(value) {
    const image = clean(value);

    if (!image) {
        return "";
    }

    if (/^https?:\/\//i.test(image)) {
        return image;
    }

    if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            .test(image)
    ) {
        return "https://www.radiofrance.fr/pikapi/images/" +
            image +
            "/600x600?webp=false";
    }

    return "";
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
        image: getArtworkUrl(now.cover)
    };
}

/*
 * Parses the current programme and segment for an ICI local station.
 */
function parseIciMetadata(json) {
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
    const firstLine = clean(now.firstLine);
    const secondLine = clean(now.secondLine);
    const isGenericDirect =
        firstLine.toLowerCase() === "le direct";

    return {
        title: isGenericDirect ?
            (secondLine || firstLine) :
            (firstLine || secondLine),
        artist: "",
        album: !isGenericDirect &&
            secondLine !== firstLine ?
            secondLine :
            "",
        label: "",
        image: getArtworkUrl(
            now.cover_square ||
            now.cover_main ||
            now.cover
        )
    };
}

/*
 * Retrieves and caches current metadata for a station.
 */
async function getMetadata(id, type) {
    const now = Date.now();
    const cacheKey = (type || "radio_france") + ":" + id;

    if (
        cache[cacheKey] &&
        (now - cache[cacheKey].time) < CACHE_TIME
    ) {
        return cache[cacheKey].data;
    }

    try {
        const isIci = type === "ici";
        let track;

        if (isIci) {
            const musicalJson = await fetchMetadata(id);
            const nowPlaying = musicalJson && musicalJson.now;
            const secondLine = clean(
                nowPlaying && nowPlaying.secondLine
            );
            const hasTrackMetadata =
                nowPlaying &&
                (
                    nowPlaying.secondLineSongUuid ||
                    nowPlaying.songUuid ||
                    secondLine.indexOf(" • ") >= 0
                );

            if (hasTrackMetadata) {
                track = parseMetadata(musicalJson);
            } else {
                const programmeJson =
                    await fetchIciMetadata(id);
                track = parseIciMetadata(programmeJson);
            }
        } else {
            const liveJson = await fetchMetadata(id);
            track = parseMetadata(liveJson);
        }

        let artwork = "";
        let album = track.album || "";
        let label = "";

        if (!isIci) {
            try {
                const currentSong = await fetchCurrentSong(id);

                if (currentSong) {
                    artwork = getArtworkUrl(currentSong.visual);
                    album = clean(currentSong.titreAlbum);
                    label = clean(currentSong.label);
                }
            } catch (e) {
                // The /pull endpoint is not available for every FIP station.
            }
        }

        const data = {
            title: track.title,
            artist: track.artist,
            album: album,
            label: label,
            albumart: artwork || getArtworkUrl(track.image)
        };

        cache[cacheKey] = {
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
