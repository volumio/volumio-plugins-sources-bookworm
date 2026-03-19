"use strict";
/**
 * Stream URL Resolver — pure functions that build complete, playable
 * streaming URLs from Plex server connection details and track keys.
 *
 * Supports both direct play (original file) and transcoded streams.
 * No network calls or side effects.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStreamUrl = buildStreamUrl;
exports.buildResourceUrl = buildResourceUrl;
/**
 * Build a complete streaming URL for a Plex track.
 *
 * Direct play returns the original file via the Part key.
 * Transcoded play routes through Plex's universal transcoder.
 */
function buildStreamUrl(options) {
    const { host, port, token, trackKey, transcode = false, format = "mp3", https: useHttps = false } = options;
    const scheme = useHttps ? "https" : "http";
    const base = `${scheme}://${host}:${port}`;
    if (transcode) {
        return buildTranscodeUrl(base, token, trackKey, format, scheme);
    }
    return buildDirectUrl(base, token, trackKey);
}
/**
 * Build a full URL for a relative Plex resource path (e.g. artwork thumbnails).
 * Appends the authentication token as a query parameter.
 */
function buildResourceUrl(connection, path) {
    const { host, port, token, https: useHttps = false } = connection;
    const scheme = useHttps ? "https" : "http";
    const sep = path.includes("?") ? "&" : "?";
    return `${scheme}://${host}:${port}${path}${sep}X-Plex-Token=${encodeURIComponent(token)}`;
}
function buildDirectUrl(base, token, trackKey) {
    const sep = trackKey.includes("?") ? "&" : "?";
    return `${base}${trackKey}${sep}X-Plex-Token=${encodeURIComponent(token)}`;
}
function buildTranscodeUrl(base, token, trackKey, format, scheme = "http") {
    const params = new URLSearchParams({
        path: trackKey,
        mediaIndex: "0",
        partIndex: "0",
        protocol: scheme,
        "X-Plex-Token": token,
    });
    // Set the appropriate container/codec for each format
    const codecMap = {
        mp3: { container: "mp3", audioCodec: "mp3" },
        flac: { container: "flac", audioCodec: "flac" },
        aac: { container: "mp4", audioCodec: "aac" },
    };
    const codec = codecMap[format] ?? codecMap["mp3"];
    params.set("container", codec.container);
    params.set("audioCodec", codec.audioCodec);
    return `${base}/music/:/transcode/universal/start?${params.toString()}`;
}
