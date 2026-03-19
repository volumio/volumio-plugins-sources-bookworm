"use strict";
// ── URI encoding helpers ─────────────────────────────────────────────
// Plex keys contain slashes (e.g. "/library/metadata/1001/children").
// We encode them for safe embedding in our URI scheme using percent-encoding.
//
// Legacy: older plugin versions used __ as a slash substitute.  Plex keys
// always begin with /, so old segments start with __ and new ones start with
// %2F — the two formats are unambiguous and both are handled on decode.
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodePathSegment = encodePathSegment;
exports.decodePathSegment = decodePathSegment;
exports.shuffleArray = shuffleArray;
exports.parsePaginationUri = parsePaginationUri;
function encodePathSegment(key) {
    return encodeURIComponent(key);
}
function decodePathSegment(encoded) {
    if (encoded.startsWith("%")) {
        return decodeURIComponent(encoded);
    }
    // Legacy __ encoding: replace every __ back to /
    return encoded.replace(/__/g, "/");
}
/** Fisher-Yates in-place shuffle. */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
function parsePaginationUri(uri) {
    const atIndex = uri.indexOf("@");
    if (atIndex === -1) {
        return { libraryKey: null, offset: 0 };
    }
    const paginationPart = uri.slice(atIndex + 1);
    const colonIndex = paginationPart.indexOf(":");
    if (colonIndex === -1) {
        return { libraryKey: paginationPart, offset: 0 };
    }
    return {
        libraryKey: paginationPart.slice(0, colonIndex),
        offset: parseInt(paginationPart.slice(colonIndex + 1), 10) || 0,
    };
}
