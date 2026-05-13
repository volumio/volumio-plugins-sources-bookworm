'use strict';

/**
 * Pure helpers for grouping MPD `find` results.
 *
 * Extracted from index.js so they can be unit-tested without spinning
 * up the controller.  Nothing in here touches `this`, the filesystem,
 * or any Volumio API — given the same input, output is deterministic.
 *
 * Six functions:
 *   - artistOf(entry)              → string (AlbumArtist / Artist / "Unknown Artist")
 *   - albumTitleOf(entries, fb)    → string (Album tag, with fallback)
 *   - albumArtistOf(entries)       → string | null (album-level artist label)
 *   - groupByAlbum(entries)        → array of album buckets, sorted by recency
 *   - trackNumber(entry)           → integer (parsed Track tag, Infinity if missing)
 *   - discNumber(entry)            → integer (parsed Disc tag, 1 if missing)
 */

/**
 * Determine the artist for grouping.  AlbumArtist is preferred because
 * compilations have a single AlbumArtist (e.g. "Various Artists") even
 * when individual tracks have different per-track Artist values.
 *
 * Falls back to Artist, then to "Unknown Artist".  Note that the literal
 * "Unknown Artist" string is intentionally not localized here — it would
 * conflict with grouping (two locales would produce two buckets for the
 * same set of tag-less files).  Display-side localization, if desired,
 * can map this sentinel value to a translated label at render time.
 */
function artistOf(entry) {
  return entry.AlbumArtist || entry.Artist || 'Unknown Artist';
}

/**
 * Return the most-common Album tag value across the given entries.
 * Used to title an album bucket when we have multiple tracks for the
 * same folder.  Falls back to the supplied `fallback` string if no
 * track in the bucket has an Album tag.
 *
 * Why most-common rather than first?  Sloppy tagging sometimes leaves
 * a stray empty or differently-cased Album value on a single track,
 * and we want the consensus value to win.  For typical well-tagged
 * libraries every track has the same value, so either approach works;
 * for messy ones, mode is a small robustness improvement.
 */
function albumTitleOf(entries, fallback) {
  var counts = {};
  for (var i = 0; i < entries.length; i++) {
    var album = entries[i].Album;
    if (!album) continue;
    counts[album] = (counts[album] || 0) + 1;
  }
  var best = null;
  var bestCount = 0;
  var keys = Object.keys(counts);
  for (var k = 0; k < keys.length; k++) {
    if (counts[keys[k]] > bestCount) {
      best = keys[k];
      bestCount = counts[keys[k]];
    }
  }
  return best || fallback;
}

/**
 * Determine the artist label to display for an album as a whole.
 * Distinct from artistOf(): that's per-track and used for grouping
 * buckets in the Artists section; this is per-album and used as the
 * secondary column on album rows.
 *
 * Returns one of:
 *   - a real artist name (string)
 *   - the literal sentinel 'Various Artists' (caller should localize)
 *   - null when no meaningful artist information is present
 *
 * Algorithm:
 *   1. Collect AlbumArtist values across the album's tracks, treating
 *      empty/whitespace/literal '*' as "no value" (some tagging tools
 *      emit '*' for compilations with no AlbumArtist set).
 *   2. If a single AlbumArtist value dominates (>= half the tracks):
 *      - If it normalizes to a "various artists"-style label
 *        ("Various Artists" / "Various" / "VA", case-insensitive),
 *        return the canonical sentinel for caller-side localization.
 *      - Otherwise return the value as-is.
 *   3. Else inspect per-track Artist values:
 *      - Multiple distinct → 'Various Artists' sentinel.
 *      - Exactly one → return it.
 *      - None → null.
 */
function albumArtistOf(entries) {
  if (!entries || entries.length === 0) return null;

  function meaningful(v) {
    if (typeof v !== 'string') return false;
    var s = v.trim();
    if (!s) return false;
    if (s === '*') return false;
    return true;
  }

  function isVariousLike(v) {
    if (!meaningful(v)) return false;
    var s = v.trim().toLowerCase();
    return s === 'various artists' || s === 'various' || s === 'va';
  }

  // Step 1: find dominant meaningful AlbumArtist
  var aaCounts = {};
  var aaTotal = 0;
  for (var i = 0; i < entries.length; i++) {
    var aa = entries[i].AlbumArtist;
    if (meaningful(aa)) {
      aaCounts[aa] = (aaCounts[aa] || 0) + 1;
      aaTotal++;
    }
  }

  if (aaTotal > 0) {
    var topAA = null;
    var topCount = 0;
    var keys = Object.keys(aaCounts);
    for (var k = 0; k < keys.length; k++) {
      if (aaCounts[keys[k]] > topCount) {
        topAA = keys[k];
        topCount = aaCounts[keys[k]];
      }
    }
    if (topCount >= entries.length / 2) {
      if (isVariousLike(topAA)) return 'Various Artists';
      return topAA;
    }
  }

  // Step 2: AlbumArtist absent or unclear — examine per-track Artist
  var artistSet = {};
  var distinctCount = 0;
  for (var j = 0; j < entries.length; j++) {
    var a = entries[j].Artist;
    if (meaningful(a)) {
      if (!artistSet[a]) {
        artistSet[a] = true;
        distinctCount++;
      }
    }
  }

  if (distinctCount > 1) return 'Various Artists';
  if (distinctCount === 1) return Object.keys(artistSet)[0];
  return null;
}

/**
 * Group `find` entries by parent directory.  Returns array sorted by
 * most-recent modification descending.  Each bucket carries the entries
 * themselves so the caller can derive an Album-tag title.
 *
 * The bucket's `modified` is the MAX across its tracks — re-adding a
 * single track to an existing folder bumps the whole album back to the
 * top of the list, which matches user expectation.
 */
function groupByAlbum(entries) {
  var albumMap = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e.file) continue;
    var albumPath = e.file.split('/').slice(0, -1).join('/');
    if (!albumPath) continue;  // file at root — skip

    var modified = e['Last-Modified'] ? new Date(e['Last-Modified']).getTime() : 0;
    if (!albumMap[albumPath]) {
      albumMap[albumPath] = {
        path: albumPath,
        modified: modified,
        entries: [e]
      };
    } else {
      if (modified > albumMap[albumPath].modified) {
        albumMap[albumPath].modified = modified;
      }
      albumMap[albumPath].entries.push(e);
    }
  }
  var albums = Object.keys(albumMap).map(function (k) { return albumMap[k]; });
  albums.sort(function (a, b) { return b.modified - a.modified; });
  return albums;
}

module.exports = {
  artistOf: artistOf,
  albumTitleOf: albumTitleOf,
  albumArtistOf: albumArtistOf,
  groupByAlbum: groupByAlbum,
  trackNumber: trackNumber,
  discNumber: discNumber
};

/**
 * Parse the Track tag's leading integer.  Handles "1", "01", and
 * "1/12"-style values.  Returns Infinity for missing/unparseable values
 * so that unnumbered tracks sort to the end.
 */
function trackNumber(entry) {
  if (!entry || !entry.Track) return Infinity;
  var m = String(entry.Track).match(/^\d+/);
  return m ? parseInt(m[0], 10) : Infinity;
}

/**
 * Parse the Disc tag's leading integer.  Defaults to 1 when missing
 * (single-disc albums don't always carry the tag).  Used as the primary
 * sort key for multi-disc albums so disc 2 track 1 follows disc 1
 * track 12, not interleaves with disc 1.
 */
function discNumber(entry) {
  if (!entry || !entry.Disc) return 1;
  var m = String(entry.Disc).match(/^\d+/);
  return m ? parseInt(m[0], 10) : 1;
}
