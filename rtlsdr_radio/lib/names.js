'use strict';

// Whether two station names mean the same station.
//
// An FM station has a name only where the user gave it one or RDS told it; the same
// station on DAB, and in its broadcaster's list, is named by the broadcaster. The two
// rarely agree to the letter: "Classic" and "Classic FM", "Magic Radio" and "Magic",
// "BBC R2" and "BBC Radio 2", "LBC London" and "LBC". Names are therefore compared as
// the words that tell stations apart, and three ways of agreeing are told from one
// another, the surest first:
//   same    the same words;
//   within  the other name, with something added, gives the wanted one
//           ("BBC Radio 2 National" has "BBC Radio 2" in front);
//   family  the wanted name, with something added, gives the other one ("Heart" and
//           "Heart London"): the same house, perhaps not the same station.

// Words that say "this is a radio station" and nothing about which
var GENERIC = { radio: true, fm: true, the: true, dab: true };

// The words of a name that tell it from other names, in order
function words(name) {
  var all = String(name || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().split(' ').filter(Boolean)
    // "R2" for "Radio 2", as RDS has it
    .map(function(word) { return /^r\d$/.test(word) ? word.slice(1) : word; });
  var telling = all.filter(function(word) { return !GENERIC[word]; });
  return telling.length > 0 ? telling : all;
}

function startsWith(longer, shorter) {
  if (shorter.length >= longer.length) {
    return false;
  }
  for (var i = 0; i < shorter.length; i++) {
    if (longer[i] !== shorter[i]) {
      return false;
    }
  }
  return true;
}

// Find the candidate that a name means. candidates: [{ name, ... }].
// options.sure: only the ways of agreeing that name one station (same, within).
// Returns { found: <candidate>, how: 'same' | 'within' | 'family' }, or null.
function match(wanted, candidates, options) {
  var want = words(wanted);
  if (want.length === 0) {
    return null;
  }
  var same = null;
  var within = null;
  var family = [];

  candidates.forEach(function(candidate) {
    var have = words(candidate.name);
    if (have.length === 0) {
      return;
    }
    if (have.join(' ') === want.join(' ')) {
      same = same || candidate;
    } else if (startsWith(want, have)) {
      // the longest name that fits says the most
      if (!within || have.length > within.length) {
        within = { candidate: candidate, length: have.length };
      }
    } else if (startsWith(have, want)) {
      family.push({ candidate: candidate, added: have.slice(want.length) });
    }
  });

  if (same) {
    return { found: same, how: 'same' };
  }
  if (within) {
    return { found: within.candidate, how: 'within' };
  }
  if (family.length === 0 || (options && options.sure)) {
    return null;
  }
  // Of a family, the member with the least added to the name; a number added ("Heart
  // 80s") marks a station of its own more than a word does ("Heart London")
  function numbered(entry) {
    return entry.added.some(function(word) { return /\d/.test(word); }) ? 1 : 0;
  }
  family.sort(function(a, b) {
    return a.added.length - b.added.length || numbered(a) - numbered(b) ||
      String(a.candidate.name).length - String(b.candidate.name).length ||
      String(a.candidate.name).localeCompare(String(b.candidate.name));
  });
  return { found: family[0].candidate, how: 'family' };
}

module.exports = {
  words: words,
  match: match
};
