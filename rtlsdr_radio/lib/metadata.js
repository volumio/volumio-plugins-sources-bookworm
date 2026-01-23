'use strict';

/*
 * METADATA EXTRACTOR - LAYER 2
 * 
 * Extracts artist/title from RDS RadioText or DAB DLS text.
 * Methods ordered by confidence, tries each until success.
 * 
 * Methods:
 *   A: NLP structure analysis (English, ~85% of broadcasts)
 *   B: Dash separator ' - ' (universal)
 *   C: Pipe separator ' | '
 *   D: Colon separator ': '
 *   E: Slash separator ' / '
 *   F: MusicBrainz raw text search
 *   G: Word separators (all languages)
 * 
 * Usage:
 *   var metadata = require('./lib/metadata');
 *   var result = metadata.extract('Queen - Bohemian Rhapsody');
 *   // { artist: 'Queen', title: 'Bohemian Rhapsody', confidence: 95, method: 'dash' }
 * 
 *   metadata.lookup('Queen', 'Bohemian Rhapsody', function(err, data) {
 *     // { verified: true, mbid: '...', artwork: 'https://...' }
 *   });
 */

var nlp;
var nlpLoaded = false;
var nlpLoading = false;
var nlpCallbacks = [];

// User-defined blocklist phrases (set via setUserPhrases)
var userBlocklistPhrases = [];

// ============================================================================
// CONFIGURATION
// ============================================================================

var config = {
  // MusicBrainz API
  musicbrainzEndpoint: 'https://musicbrainz.org/ws/2',
  musicbrainzUserAgent: 'VolumioRTLSDRRadio/1.3.1 (https://github.com/foonerd/volumio-rtlsdr-radio)',
  musicbrainzRateLimit: 1000,  // 1 request per second
  
  // Last.fm API - primary source for artwork lookups
  lastfmApiKey: '4cb074e4b8ec4ee9ad3eb37d6f7eb240',  // Volumio's API key
  lastfmEndpoint: 'http://ws.audioscrobbler.com/2.0/',
  lastfmRateLimit: 200,  // Last.fm allows faster requests
  
  // Open Opus API - classical music composer portraits
  // Free, no registration, public domain data
  openOpusEndpoint: 'https://api.openopus.org',
  openOpusRateLimit: 200,  // Be respectful to free service
  
  // Cover Art Archive
  coverArtEndpoint: 'https://coverartarchive.org',
  
  // Cache settings
  cacheEnabled: true,
  cacheTTL: 86400000,  // 24 hours in ms
  
  // Confidence thresholds
  minConfidence: 30,  // Below this, don't return result
  
  // Debug logging (controlled by artwork_debug_logging setting)
  debugLogging: false,
  
  // NLP
  nlpEnabled: true
};

// ============================================================================
// CACHE
// ============================================================================

var cache = {
  extractions: {},  // text hash -> { artist, title, confidence, method, timestamp }
  lookups: {},      // 'artist|title' -> { verified, mbid, artwork, timestamp }
  
  set: function(type, key, value) {
    if (!config.cacheEnabled) return;
    this[type][key] = {
      data: value,
      timestamp: Date.now()
    };
  },
  
  get: function(type, key) {
    if (!config.cacheEnabled) return null;
    var entry = this[type][key];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > config.cacheTTL) {
      delete this[type][key];
      return null;
    }
    return entry.data;
  },
  
  clear: function() {
    this.extractions = {};
    this.lookups = {};
  }
};

// ============================================================================
// FUZZY MATCHING (for RDS/DAB corruption tolerance)
// ============================================================================

// Levenshtein distance - counts edits needed to transform s1 into s2
function levenshteinDistance(s1, s2) {
  if (!s1 || !s2) return Math.max((s1 || '').length, (s2 || '').length);
  
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;
  
  var matrix = [];
  
  // Initialize first column
  for (var i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  
  // Initialize first row
  for (var j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }
  
  // Fill in the rest
  for (var i = 1; i <= s1.length; i++) {
    for (var j = 1; j <= s2.length; j++) {
      var cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[s1.length][s2.length];
}

// Calculate similarity ratio (0.0 to 1.0)
function similarity(s1, s2) {
  if (!s1 || !s2) return 0;
  var maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  var distance = levenshteinDistance(s1, s2);
  return (maxLen - distance) / maxLen;
}

// Extract first word from text (for prefix matching)
function extractFirstWord(text) {
  if (!text) return '';
  // Match word characters, allowing for trailing punctuation corruption
  var match = text.match(/^[\w]+/);
  return match ? match[0] : '';
}

// Known broadcast prefixes (canonical forms for fuzzy matching)
var knownPrefixes = [
  'Playing',
  'Now',
  'Listen',
  'Hear',
  'Next',
  'Coming',
  'Up'
];

// Fuzzy prefix detection and stripping
// Returns cleaned text with corrupt prefixes removed
function fuzzyStripPrefix(text) {
  if (!text || typeof text !== 'string') return text;
  
  var firstWord = extractFirstWord(text);
  if (!firstWord || firstWord.length < 3) return text;
  
  // Check against known prefixes with fuzzy matching
  for (var i = 0; i < knownPrefixes.length; i++) {
    var prefix = knownPrefixes[i];
    var sim = similarity(firstWord, prefix);
    
    // 75% similarity threshold for prefix detection
    if (sim >= 0.75) {
      // Verify this looks like a broadcast prefix by checking what follows
      // Must be followed by separator (:.(-) or whitespace+separator, not just any word
      var afterFirst = text.substring(firstWord.length);
      // If next non-space char is a letter, this is probably a station name like "Heart FM"
      if (/^\s*[a-zA-Z]/.test(afterFirst) && !/^\s*[-:(.]/.test(afterFirst)) {
        continue; // Skip - looks like "Heart FM", not "Hear ..."
      }
      
      // Found a fuzzy match - strip up to the next separator or end of prefix pattern
      // Match: fuzzy_prefix + optional punctuation/dots + whitespace
      var stripPattern = new RegExp('^' + firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[.(:]*\\s*', 'i');
      var cleaned = text.replace(stripPattern, '');
      
      // Also try to strip any remaining prefix continuation
      // e.g., "Playink(.. " -> "" so we get clean "Where Is My Husband -- RAYE"
      cleaned = cleaned.replace(/^[.\s(]+/, '');
      
      return cleaned.trim();
    }
  }
  
  return text;
}

// Fuzzy blocklist check
// Returns true if text matches any blocklist phrase with >= threshold similarity
function fuzzyBlocklistMatch(text, threshold) {
  if (!text || userBlocklistPhrases.length === 0) return false;
  if (!threshold) threshold = 0.75;
  
  var textLower = text.toLowerCase();
  var textWords = textLower.split(/\s+/);
  
  for (var i = 0; i < userBlocklistPhrases.length; i++) {
    var phrase = userBlocklistPhrases[i];
    if (!phrase) continue;
    
    var phraseLower = phrase.toLowerCase();
    var phraseWords = phraseLower.split(/\s+/);
    
    // Exact substring match (existing behavior)
    if (textLower.indexOf(phraseLower) !== -1) {
      return true;
    }
    
    // Fuzzy match: check if any word in text fuzzy-matches blocklist phrase
    // For single-word phrases, check each word
    if (phraseWords.length === 1) {
      for (var w = 0; w < textWords.length; w++) {
        if (similarity(textWords[w], phraseLower) >= threshold) {
          return true;
        }
      }
    } else {
      // For multi-word phrases, check consecutive word sequences
      for (var start = 0; start <= textWords.length - phraseWords.length; start++) {
        var matchCount = 0;
        for (var p = 0; p < phraseWords.length; p++) {
          if (similarity(textWords[start + p], phraseWords[p]) >= threshold) {
            matchCount++;
          }
        }
        // If most words match, consider it a blocklist hit
        if (matchCount >= phraseWords.length * 0.75) {
          return true;
        }
      }
    }
  }
  
  return false;
}

// ============================================================================
// NLP LOADER (LAZY)
// ============================================================================

function loadNLP(callback) {
  if (nlpLoaded) {
    return callback(null, nlp);
  }
  
  nlpCallbacks.push(callback);
  
  if (nlpLoading) {
    return;
  }
  
  nlpLoading = true;
  
  try {
    nlp = require('compromise');
    nlpLoaded = true;
    nlpLoading = false;
    nlpCallbacks.forEach(function(cb) {
      cb(null, nlp);
    });
    nlpCallbacks = [];
  } catch (e) {
    nlpLoading = false;
    nlpCallbacks.forEach(function(cb) {
      cb(e, null);
    });
    nlpCallbacks = [];
  }
}

// ============================================================================
// TEXT CLEANUP
// ============================================================================

// Station ident and technical patterns to filter out
var filterPatterns = [
  /^Now on \w{1,3}\s*-\s*(Easy listening|Classic|Pop|Rock|Jazz|Soul|R&B|Country|Dance|Chill)/i,
  /^FM\s+\d+\.?\d*\s*MHz/i,
  /^\d+\.?\d*\s*MHz/i,
  /^DAB\s+\d+[A-Z]?/i,
  /^(AM|FM|DAB)\s+(Radio|Station)$/i,
  /^www\./i,
  /^https?:/i,
  /\.(com|org|net|co\.uk|co|uk|fm|radio|info|eu|de|fr|nl|be|at|ch)$/i,
  /^\w+\.(com|org|net|co\.uk|co|uk|fm|radio|info|eu|de|fr|nl|be|at|ch)\b/i,
  /^\+?\d{10,}/,
  /^Call\s+\d/i,
  /^You'?re listening to\b/i,
  /^This is\s+\w+$/i,
  /^Welcome to\b/i,
  // Time and date announcements
  /^It's\s+\d{1,2}[:.]\d{2}\b/i,
  /\b\d{1,2}[:.]\d{2}\s+(on|this)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
  /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(morning|afternoon|evening)/i,
  /\b\d{1,2}(st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i,
  /\bthe time is\b/i,
  /\bcoming up at\s+\d/i,
  // Broadcast show names (specific patterns, not just words)
  /\bat\s+Breakfast\s+with\b/i,
  /\bat\s+Drivetime\s+with\b/i,
  /\bat\s+Lunch\s+with\b/i,
  /\bwhen you wake up\b/i,
  /\bmore music\b.*\bRadio\b/i,
  /\bnon-stop\s+(music|hits)\b/i,
  // Station name endings
  /^[\w\s]+(Radio|FM|DAB)\.?\s*$/i,
  // Station slogans (not song metadata) - must be specific phrases
  /\bWe love (pop|music|hits|rock|the \d+s)\b/i,
  /\bWe play (the )?(hits|music|best)\b/i,
  /\bThe best (hits|music|of)\b/i,
  /\bThe home of\b/i,
  /\bYour (number|#|no\.?)\s*(one|1)\b/i,
  /\bMore (music|hits)\b/i,
  /\bAll the (hits|music)\b/i,
  /\bFeel good (music|hits)\b/i,
  // Station name with slogan pattern: "[Name] Radio -- [slogan]"
  /^[\w\s]+(Radio|FM)\s*--\s*/i
];

// Prefixes to strip
var prefixPatterns = [
  // Full station names first (specific before generic)
  /^Now on [^:]+:\s*/i,
  /^On [^:]+:\s*/i,
  /^Playing on [^:]+:\s*/i,
  /^Now Playing[:\s]+/i,
  /^Playing[:.]+\s*/i,  // "Playing...", "Playing:", "Playing."
  /^On Air[:\s]+/i,
  /^Up Next[:\s]+/i,
  /^Coming Up[:\s]+/i,
  /^Classic FM:\s*/i,            // "Classic FM:" (full station name)
  /^Capital FM:\s*/i,            // "Capital FM:"
  /^Heart FM:\s*/i,              // "Heart FM:"
  /^Kiss FM:\s*/i,               // "Kiss FM:"
  /^Smooth Radio:\s*/i,          // "Smooth Radio:"
  /^Gold Radio:\s*/i,            // "Gold Radio:"
  /^Now:\s*/i,                   // "Now:" prefix (Classic FM)
  // Truncated station prefixes (DLS buffer truncation) - MUST come after specific patterns
  // "Now on Gold Radio UK:" -> "o UK:", "dio UK:", "adio UK:", "Radio UK:", etc.
  /^[a-z]?\s?UK:\s*/i,           // "o UK:", "k UK:", " UK:"
  /^[a-z]{1,5}\s?UK:\s*/i,       // "dio UK:", "adio UK:", "Radio UK:"
  /^[a-z]{1,6}\s?Radio:\s*/i,    // "d Radio:", "old Radio:", truncated "[X] Radio:"
  /^[a-z]{1,5}\s?FM:\s*/i        // "c FM:", "sic FM:", "ssic FM:"
];

// Genre suffixes to strip
var genreSuffixes = [
  'Easy listening', 'Classic Rock', 'Classic Hits', 'Classic',
  '80s Hits', '90s Hits', '70s Hits', '80s', '90s', '70s',
  'Pop', 'Rock', 'Jazz', 'Soul', 'R&B', 'Country', 'Dance', 
  'Chill', 'Chillout', 'Relaxing', 'Love Songs', 'Hits'
];

function cleanText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  text = text.trim();
  
  if (text.length === 0) {
    return null;
  }
  
  // Check if this is a filter pattern (ident, technical info)
  for (var i = 0; i < filterPatterns.length; i++) {
    if (filterPatterns[i].test(text)) {
      return null;
    }
  }
  
  // Check user-defined blocklist phrases (exact substring match first)
  var textLower = text.toLowerCase();
  for (var u = 0; u < userBlocklistPhrases.length; u++) {
    var phrase = userBlocklistPhrases[u];
    if (phrase && textLower.indexOf(phrase.toLowerCase()) !== -1) {
      return null;
    }
  }
  
  // Fuzzy blocklist check (catches corrupted versions of blocklist phrases)
  if (fuzzyBlocklistMatch(text, 0.75)) {
    return null;
  }
  
  // Fuzzy prefix stripping (handles corrupted prefixes like "Playink(..")
  // This must come BEFORE exact prefix stripping to catch corruptions
  text = fuzzyStripPrefix(text);
  
  // Strip exact prefixes (for clean text)
  for (var j = 0; j < prefixPatterns.length; j++) {
    text = text.replace(prefixPatterns[j], '');
  }
  
  text = text.trim();
  
  // Strip genre suffixes
  for (var k = 0; k < genreSuffixes.length; k++) {
    var suffixRegex = new RegExp('\\s+-\\s+' + genreSuffixes[k] + '$', 'i');
    text = text.replace(suffixRegex, '');
  }
  
  // Strip station suffixes like " -- on Greatest Hits Radio"
  text = text.replace(/\s+--\s+on\s+[\w\s]+$/i, '');
  text = text.replace(/\s+-\s+on\s+[\w\s]+$/i, '');
  
  return text.trim() || null;
}

// ============================================================================
// METHOD A: NLP STRUCTURE ANALYSIS
// ============================================================================

function methodNLP(text, callback) {
  if (!config.nlpEnabled) {
    return callback(null, null);
  }
  
  loadNLP(function(err, nlpLib) {
    if (err || !nlpLib) {
      return callback(null, null);
    }
    
    try {
      var doc = nlpLib(text);
      var nouns = doc.nouns().out('array');
      
      // Need exactly 2 noun groups for artist/title split
      if (nouns.length === 2) {
        var artist = nouns[0].replace(/\s*[-|:\/]\s*$/, '').trim();
        var title = nouns[1].trim();
        
        if (artist && title && artist.length > 0 && title.length > 0) {
          return callback(null, {
            artist: artist,
            title: title,
            confidence: 85,
            method: 'nlp'
          });
        }
      }
      
      callback(null, null);
    } catch (e) {
      callback(null, null);
    }
  });
}

// ============================================================================
// METHOD B-E: SEPARATOR PATTERNS
// ============================================================================

var separatorPatterns = [
  // B: Dash (universal, highest confidence)
  { 
    name: 'dash',
    regex: /^(.+)\s+-\s+(.+)$/,
    confidence: 95,
    artistIndex: 1,
    titleIndex: 2
  },
  // B2: Double-dash reversed (Title -- Artist, common UK radio format)
  {
    name: 'double-dash',
    regex: /^(.+?)\s+--\s+(.+)$/,
    confidence: 90,
    artistIndex: 2,  // Reversed: second part is artist
    titleIndex: 1
  },
  // C: Pipe
  {
    name: 'pipe',
    regex: /^(.+?)\s*\|\s*(.+)$/,
    confidence: 90,
    artistIndex: 1,
    titleIndex: 2
  },
  // D: Colon
  {
    name: 'colon',
    regex: /^([^:]+):\s+(.+)$/,
    confidence: 80,
    artistIndex: 1,
    titleIndex: 2
  },
  // E: Slash (non-greedy to handle AC/DC)
  {
    name: 'slash',
    regex: /^(.+?)\s*\/\s*(.+)$/,
    confidence: 75,
    artistIndex: 1,
    titleIndex: 2
  }
];

// Special pattern: Soundtrack format "Album/Movie - Track by Artist"
// Used by Classic FM and other soundtrack-focused stations
// Example: "Top Gun: Maverick - Top Gun Anthem by Lorne Balfe"
function methodSoundtrack(text) {
  // Pattern: [Album/Movie] - [Track] by [Artist]
  // Must have dash AND "by" to qualify
  var match = text.match(/^(.+?)\s+-\s+(.+?)\s+by\s+(.+)$/i);
  if (match) {
    var album = match[1].trim();
    var track = match[2].trim();
    var artist = match[3].trim();
    
    // Validate: album should look like a movie/album title (allow colons)
    // Track and artist should be reasonable lengths
    if (album && track && artist && 
        album.length > 2 && track.length > 2 && artist.length > 2 &&
        artist.length < 50) {
      return {
        artist: artist,
        title: track,
        album: album,
        confidence: 90,
        method: 'soundtrack'
      };
    }
  }
  
  // Also try: [Track] by [Artist] from [Album]
  match = text.match(/^(.+?)\s+by\s+(.+?)\s+from\s+(.+)$/i);
  if (match) {
    var track = match[1].trim();
    var artist = match[2].trim();
    var album = match[3].trim();
    
    if (album && track && artist && 
        album.length > 2 && track.length > 2 && artist.length > 2 &&
        artist.length < 50) {
      return {
        artist: artist,
        title: track,
        album: album,
        confidence: 90,
        method: 'soundtrack-from'
      };
    }
  }
  
  return null;
}

function methodSeparators(text) {
  // Try soundtrack pattern first (higher specificity)
  var soundtrackResult = methodSoundtrack(text);
  if (soundtrackResult) {
    return soundtrackResult;
  }
  
  for (var i = 0; i < separatorPatterns.length; i++) {
    var pattern = separatorPatterns[i];
    var match = text.match(pattern.regex);
    
    if (match) {
      var artist = match[pattern.artistIndex].trim();
      var title = match[pattern.titleIndex].trim();
      
      if (artist && title && artist.length > 0 && title.length > 0) {
        return {
          artist: artist,
          title: title,
          confidence: pattern.confidence,
          method: pattern.name
        };
      }
    }
  }
  
  return null;
}

// ============================================================================
// METHOD G: WORD SEPARATORS (ALL LANGUAGES)
// ============================================================================

var wordSeparators = [
  // English - LOW CONFIDENCE (triggers extraction but not artwork lookup)
  // Too many false positives: "Greatest Hits at Breakfast with Rossie"
  { word: 'with', confidence: 40 },
  { word: 'by', confidence: 40, reversed: true },
  { word: 'performing', confidence: 40 },
  
  // French
  { word: 'avec', confidence: 40 },
  { word: 'par', confidence: 40, reversed: true },
  
  // German
  { word: 'mit', confidence: 40 },
  { word: 'von', confidence: 40, reversed: true },
  
  // Spanish/Italian
  { word: 'con', confidence: 40 },
  { word: 'por', confidence: 40, reversed: true },
  
  // Portuguese
  { word: 'com', confidence: 40 },
  
  // Dutch
  { word: 'met', confidence: 40 },
  { word: 'door', confidence: 40, reversed: true },
  
  // Swedish/Norwegian/Danish
  { word: 'med', confidence: 40 },
  { word: 'av', confidence: 40, reversed: true },
  
  // Polish
  { word: ' z ', confidence: 40 },  // Space padded to avoid false matches
  
  // Swahili
  { word: 'na', confidence: 35 },
  { word: 'kutoka', confidence: 35, reversed: true },
  
  // Turkish
  { word: 'ile', confidence: 40 }
];

function methodWordSeparators(text) {
  var lowerText = text.toLowerCase();
  
  for (var i = 0; i < wordSeparators.length; i++) {
    var sep = wordSeparators[i];
    var pattern = new RegExp('^(.+?)\\s+' + sep.word + '\\s+(.+)$', 'i');
    var match = text.match(pattern);
    
    if (match) {
      var first = match[1].trim();
      var second = match[2].trim();
      
      if (first && second && first.length > 0 && second.length > 0) {
        return {
          artist: sep.reversed ? second : first,
          title: sep.reversed ? first : second,
          confidence: sep.confidence,
          method: 'word-' + sep.word
        };
      }
    }
  }
  
  return null;
}

// ============================================================================
// MAIN EXTRACT FUNCTION
// ============================================================================

function extract(text, options, callback) {
  // Handle optional options parameter
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  
  options = options || {};
  var sync = !callback;
  
  // Clean text first
  var cleanedText = cleanText(text);
  
  if (!cleanedText) {
    var noResult = { artist: null, title: null, confidence: 0, method: null };
    if (sync) return noResult;
    return callback(null, noResult);
  }
  
  // Check cache
  var cached = cache.get('extractions', cleanedText);
  if (cached) {
    if (sync) return cached;
    return callback(null, cached);
  }
  
  // SYNC PATH: Skip NLP, use separators only
  if (sync) {
    // Try separator patterns (B-E)
    var sepResult = methodSeparators(cleanedText);
    if (sepResult && sepResult.confidence >= config.minConfidence) {
      cache.set('extractions', cleanedText, sepResult);
      return sepResult;
    }
    
    // Try word separators (G)
    var wordResult = methodWordSeparators(cleanedText);
    if (wordResult && wordResult.confidence >= config.minConfidence) {
      cache.set('extractions', cleanedText, wordResult);
      return wordResult;
    }
    
    return { artist: null, title: null, confidence: 0, method: null };
  }
  
  // ASYNC PATH: Try NLP first, then separators
  methodNLP(cleanedText, function(err, nlpResult) {
    if (nlpResult && nlpResult.confidence >= config.minConfidence) {
      cache.set('extractions', cleanedText, nlpResult);
      return callback(null, nlpResult);
    }
    
    // Try separator patterns (B-E)
    var sepResult = methodSeparators(cleanedText);
    if (sepResult && sepResult.confidence >= config.minConfidence) {
      cache.set('extractions', cleanedText, sepResult);
      return callback(null, sepResult);
    }
    
    // Try word separators (G)
    var wordResult = methodWordSeparators(cleanedText);
    if (wordResult && wordResult.confidence >= config.minConfidence) {
      cache.set('extractions', cleanedText, wordResult);
      return callback(null, wordResult);
    }
    
    // All methods failed
    callback(null, { artist: null, title: null, confidence: 0, method: null });
  });
}

// ============================================================================
// MUSICBRAINZ LOOKUP (METHOD F + VERIFICATION)
// ============================================================================

var lastMBRequest = 0;

function musicbrainzRequest(path, callback) {
  var http = require('https');
  
  // Rate limiting
  var now = Date.now();
  var wait = Math.max(0, config.musicbrainzRateLimit - (now - lastMBRequest));
  
  setTimeout(function() {
    lastMBRequest = Date.now();
    
    var url = config.musicbrainzEndpoint + path;
    console.log('[RTL-SDR Radio] MusicBrainz request: ' + url.substring(0, 100) + '...');
    
    var options = {
      headers: {
        'User-Agent': config.musicbrainzUserAgent,
        'Accept': 'application/json'
      }
    };
    
    http.get(url, options, function(res) {
      var data = '';
      
      res.on('data', function(chunk) {
        data += chunk;
      });
      
      res.on('end', function() {
        console.log('[RTL-SDR Radio] MusicBrainz response: ' + res.statusCode + ', length=' + data.length);
        try {
          var json = JSON.parse(data);
          callback(null, json);
        } catch (e) {
          console.log('[RTL-SDR Radio] MusicBrainz parse error: ' + e.message);
          callback(e, null);
        }
      });
    }).on('error', function(e) {
      console.log('[RTL-SDR Radio] MusicBrainz network error: ' + e.message);
      callback(e, null);
    });
  }, wait);
}

// ============================================================================
// LAST.FM LOOKUP (PRIMARY - SIMPLER AND MORE RELIABLE)
// ============================================================================

var lastfmRequestTime = 0;

/**
 * Look up track on Last.fm using track.getInfo API
 * Returns album name AND artwork URL in one call
 * Much more reliable than MusicBrainz for popular music
 */
function lastfmLookup(artist, title, callback) {
  if (config.debugLogging) {
    console.log('[RTL-SDR Radio] Last.fm lookup: artist=' + artist + ', title=' + title);
  }
  
  if (!artist || !title) {
    return callback(null, { found: false });
  }
  
  // Check cache
  var cacheKey = 'lastfm|' + artist.toLowerCase() + '|' + title.toLowerCase();
  var cached = cache.get('lookups', cacheKey);
  if (cached) {
    if (config.debugLogging) {
      console.log('[RTL-SDR Radio] Last.fm cache hit');
    }
    return callback(null, cached);
  }
  
  // Rate limiting
  var now = Date.now();
  var wait = Math.max(0, config.lastfmRateLimit - (now - lastfmRequestTime));
  
  setTimeout(function() {
    lastfmRequestTime = Date.now();
    
    var http = require('http');
    var artistEnc = encodeURIComponent(artist.replace('&', 'and'));
    var titleEnc = encodeURIComponent(title);
    
    var url = config.lastfmEndpoint + '?method=track.getInfo' +
              '&api_key=' + config.lastfmApiKey +
              '&artist=' + artistEnc +
              '&track=' + titleEnc +
              '&autocorrect=1' +  // Let Last.fm fix misspellings
              '&format=json';
    
    if (config.debugLogging) {
      console.log('[RTL-SDR Radio] Last.fm request: ' + url.substring(0, 100) + '...');
    }
    
    http.get(url, function(res) {
      var data = '';
      
      res.on('data', function(chunk) {
        data += chunk;
      });
      
      res.on('end', function() {
        if (config.debugLogging) {
          console.log('[RTL-SDR Radio] Last.fm response: ' + res.statusCode + ', length=' + data.length);
        }
        
        try {
          var json = JSON.parse(data);
          
          // Check for error
          if (json.error) {
            if (config.debugLogging) {
              console.log('[RTL-SDR Radio] Last.fm error: ' + json.message);
            }
            var noResult = { found: false };
            cache.set('lookups', cacheKey, noResult);
            return callback(null, noResult);
          }
          
          if (!json.track) {
            var noResult = { found: false };
            cache.set('lookups', cacheKey, noResult);
            return callback(null, noResult);
          }
          
          var track = json.track;
          var result = {
            found: true,
            artist: track.artist ? track.artist.name : artist,
            title: track.name || title,
            album: null,
            albumArtwork: null,
            listeners: parseInt(track.listeners) || 0
          };
          
          // Get album info if available
          if (track.album) {
            result.album = track.album.title;
            
            // Get artwork from album images (prefer extralarge)
            if (track.album.image && track.album.image.length > 0) {
              // Find extralarge or largest available
              for (var i = track.album.image.length - 1; i >= 0; i--) {
                var img = track.album.image[i];
                if (img['#text'] && img['#text'].length > 0) {
                  // Skip placeholder images (gray star)
                  if (img['#text'].indexOf('2a96cbd8b46e442fc41c2b86b821562f') === -1) {
                    result.albumArtwork = img['#text'];
                    break;
                  }
                }
              }
            }
          }
          
          if (config.debugLogging) {
            console.log('[RTL-SDR Radio] Last.fm found: ' + result.artist + ' - ' + result.title + 
                       (result.album ? ' [' + result.album + ']' : '') +
                       (result.albumArtwork ? ' (artwork available)' : ' (no artwork)'));
          }
          
          cache.set('lookups', cacheKey, result);
          callback(null, result);
          
        } catch (e) {
          if (config.debugLogging) {
            console.log('[RTL-SDR Radio] Last.fm parse error: ' + e.message);
          }
          callback(e, null);
        }
      });
    }).on('error', function(e) {
      if (config.debugLogging) {
        console.log('[RTL-SDR Radio] Last.fm network error: ' + e.message);
      }
      callback(e, null);
    });
  }, wait);
}

// ============================================================================
// OPEN OPUS LOOKUP (Classical Music Composer Portraits)
// ============================================================================

var openOpusRequestTime = 0;

/**
 * Look up composer on Open Opus API
 * Returns composer portrait URL for classical music
 * Free API, no registration required, public domain data
 * 
 * @param {string} composer - Composer name (e.g., "Beethoven", "Mozart")
 * @param {function} callback - callback(err, result)
 *   result: { found: true/false, name: string, portrait: url, epoch: string }
 */
function openOpusLookup(composer, callback) {
  if (config.debugLogging) {
    console.log('[RTL-SDR Radio] Open Opus lookup: composer=' + composer);
  }
  
  if (!composer) {
    return callback(null, { found: false });
  }
  
  // Normalize composer name for lookup
  var searchName = composer.trim().toLowerCase();
  
  // Check cache
  var cacheKey = 'openopus|' + searchName;
  var cached = cache.get('lookups', cacheKey);
  if (cached) {
    if (config.debugLogging) {
      console.log('[RTL-SDR Radio] Open Opus cache hit');
    }
    return callback(null, cached);
  }
  
  // Rate limiting
  var now = Date.now();
  var wait = Math.max(0, config.openOpusRateLimit - (now - openOpusRequestTime));
  
  setTimeout(function() {
    openOpusRequestTime = Date.now();
    
    var https = require('https');
    var composerEnc = encodeURIComponent(composer.trim());
    
    var url = config.openOpusEndpoint + '/composer/list/search/' + composerEnc + '.json';
    
    if (config.debugLogging) {
      console.log('[RTL-SDR Radio] Open Opus request: ' + url);
    }
    
    https.get(url, function(res) {
      var data = '';
      
      res.on('data', function(chunk) {
        data += chunk;
      });
      
      res.on('end', function() {
        if (config.debugLogging) {
          console.log('[RTL-SDR Radio] Open Opus response: ' + res.statusCode + ', length=' + data.length);
        }
        
        try {
          var json = JSON.parse(data);
          
          // Check for error or no results
          if (!json.status || json.status.success !== 'true' || !json.composers || json.composers.length === 0) {
            if (config.debugLogging) {
              console.log('[RTL-SDR Radio] Open Opus: no composers found');
            }
            var noResult = { found: false };
            cache.set('lookups', cacheKey, noResult);
            return callback(null, noResult);
          }
          
          // Take first (best) match
          var comp = json.composers[0];
          var result = {
            found: true,
            id: comp.id,
            name: comp.name,                    // Short name (e.g., "Beethoven")
            completeName: comp.complete_name,   // Full name (e.g., "Ludwig van Beethoven")
            portrait: comp.portrait,            // Direct URL to portrait image
            epoch: comp.epoch,                  // Period (e.g., "Romantic", "Baroque")
            birth: comp.birth,
            death: comp.death
          };
          
          if (config.debugLogging) {
            console.log('[RTL-SDR Radio] Open Opus found: ' + result.completeName + 
                       ' (' + result.epoch + ') - portrait: ' + (result.portrait ? 'yes' : 'no'));
          }
          
          cache.set('lookups', cacheKey, result);
          callback(null, result);
          
        } catch (e) {
          if (config.debugLogging) {
            console.log('[RTL-SDR Radio] Open Opus parse error: ' + e.message);
          }
          callback(e, null);
        }
      });
    }).on('error', function(e) {
      if (config.debugLogging) {
        console.log('[RTL-SDR Radio] Open Opus network error: ' + e.message);
      }
      callback(e, null);
    });
  }, wait);
}

/**
 * Check if artist name looks like a classical or film composer
 * Used to decide whether to try Open Opus lookup
 * 
 * @param {string} artist - Artist name from metadata
 * @returns {boolean} - true if likely classical/film composer
 */
function isLikelyClassicalComposer(artist) {
  if (!artist) return false;
  
  var name = artist.toLowerCase().trim();
  
  // Well-known classical composers (partial list for quick check)
  var knownComposers = [
    'bach', 'beethoven', 'mozart', 'chopin', 'brahms', 'tchaikovsky',
    'vivaldi', 'handel', 'haydn', 'schubert', 'schumann', 'mendelssohn',
    'liszt', 'wagner', 'verdi', 'puccini', 'debussy', 'ravel',
    'stravinsky', 'mahler', 'bruckner', 'dvorak', 'grieg', 'sibelius',
    'rachmaninoff', 'rachmaninov', 'prokofiev', 'shostakovich',
    'elgar', 'holst', 'vaughan williams', 'britten', 'purcell',
    'palestrina', 'monteverdi', 'corelli', 'scarlatti', 'telemann',
    'gluck', 'rossini', 'donizetti', 'bellini', 'berlioz', 'bizet',
    'offenbach', 'saint-saens', 'faure', 'franck', 'massenet',
    'rimsky-korsakov', 'mussorgsky', 'borodin', 'glazunov',
    'smetana', 'janacek', 'bartok', 'kodaly', 'enescu',
    'nielsen', 'stenhammar', 'alfven',
    'respighi', 'poulenc', 'milhaud', 'honegger', 'satie',
    'copland', 'bernstein', 'barber', 'gershwin', 'ives',
    'messiaen', 'boulez', 'stockhausen', 'ligeti', 'penderecki',
    'glass', 'reich', 'adams', 'part', 'gorecki', 'tavener',
    'paganini', 'sarasate', 'kreisler', 'heifetz',
    'casals', 'rostropovich', 'du pre',
    'horowitz', 'rubinstein', 'arrau', 'brendel', 'pollini',
    'gould', 'richter', 'gilels', 'ashkenazy',
    'karajan', 'bernstein', 'solti', 'abbado', 'rattle',
    'callas', 'pavarotti', 'domingo', 'carreras',
    'albinoni', 'pachelbel', 'boccherini', 'clementi', 'czerny',
    'hummel', 'weber', 'spohr', 'meyerbeer', 'lortzing',
    'nicolai', 'flotow', 'lalo', 'chabrier', 'dukas',
    'chausson', 'magnard', 'schmitt', 'roussel', 'ibert',
    'martinu', 'hindemith', 'weill', 'orff', 'henze',
    'nono', 'berio', 'xenakis', 'dutilleux', 'lutoslawski',
    'schnittke', 'gubaidulina', 'kancheli', 'silvestrov',
    'rautavaara', 'saariaho', 'lindberg', 'ades', 'macmillan',
    'gounod', 'delibes', 'lehar', 'strauss', 'johann strauss',
    'suppe', 'waldteufel', 'leoncavallo', 'mascagni', 'giordano',
    'wolf-ferrari', 'zandonai', 'montemezzi', 'cilea',
    'catalani', 'ponchielli', 'boito', 'arrigo boito',
    // Film/TV composers (may not be in Open Opus but worth trying)
    'john williams', 'williams', 'hans zimmer', 'zimmer',
    'james horner', 'horner', 'ennio morricone', 'morricone',
    'howard shore', 'danny elfman', 'elfman', 'james newton howard',
    'thomas newman', 'randy newman', 'alan silvestri', 'silvestri',
    'jerry goldsmith', 'goldsmith', 'john barry', 'barry',
    'bernard herrmann', 'herrmann', 'max steiner', 'steiner',
    'alfred newman', 'franz waxman', 'waxman', 'miklos rozsa', 'rozsa',
    'dmitri tiomkin', 'tiomkin', 'elmer bernstein', 'alex north',
    'henry mancini', 'mancini', 'lalo schifrin', 'schifrin',
    'maurice jarre', 'jarre', 'nino rota', 'rota',
    'vangelis', 'tangerine dream', 'giorgio moroder', 'moroder',
    'basil poledouris', 'poledouris', 'michael kamen', 'kamen',
    'carter burwell', 'burwell', 'david arnold', 'arnold',
    'alexandre desplat', 'desplat', 'dario marianelli', 'marianelli',
    'michael giacchino', 'giacchino', 'ramin djawadi', 'djawadi',
    'ludwig goransson', 'goransson', 'hildur gudnadottir', 'gudnadottir',
    'trent reznor', 'atticus ross', 'jonny greenwood', 'greenwood',
    'nicholas britell', 'britell', 'justin hurwitz', 'hurwitz',
    'john powell', 'powell', 'harry gregson-williams', 'gregson-williams',
    'patrick doyle', 'doyle', 'rachel portman', 'portman',
    'gabriel yared', 'yared', 'elliot goldenthal', 'goldenthal',
    'joe hisaishi', 'hisaishi', 'ryuichi sakamoto', 'sakamoto',
    'mica levi', 'cliff martinez', 'martinez', 'johan johansson', 'johansson'
  ];
  
  // Check if name contains any known composer
  for (var i = 0; i < knownComposers.length; i++) {
    if (name.indexOf(knownComposers[i]) !== -1) {
      return true;
    }
  }
  
  // Check for classical naming patterns
  // e.g., "J.S. Bach", "W.A. Mozart", "L. van Beethoven"
  if (/^[a-z]\.\s*[a-z]?\.\s*[a-z]/i.test(artist)) {
    return true;
  }
  
  // Check for "von", "van", "de" in name (common in classical)
  if (/\b(von|van|de|di)\b/i.test(artist)) {
    return true;
  }
  
  return false;
}

function lookup(artist, title, callback) {
  if (config.debugLogging) {
    console.log('[RTL-SDR Radio] MusicBrainz lookup called: artist=' + artist + ', title=' + title);
  }
  
  if (!artist && !title) {
    return callback(null, { verified: false, mbid: null, album: null });
  }
  
  // Check cache
  var cacheKey = (artist || '') + '|' + (title || '');
  var cached = cache.get('lookups', cacheKey);
  if (cached) {
    return callback(null, cached);
  }
  
  // Build query - request more results to find best album
  var query = '';
  if (artist && title) {
    query = 'recording:"' + encodeURIComponent(title) + '" AND artist:"' + encodeURIComponent(artist) + '"';
  } else if (title) {
    query = 'recording:"' + encodeURIComponent(title) + '"';
  } else if (artist) {
    query = 'artist:"' + encodeURIComponent(artist) + '"';
  }
  
  // Request up to 5 results to find best album match
  var path = '/recording?query=' + query + '&limit=5&fmt=json';
  
  musicbrainzRequest(path, function(err, data) {
    if (err || !data || !data.recordings || data.recordings.length === 0) {
      var noMatch = { verified: false, mbid: null, album: null };
      cache.set('lookups', cacheKey, noMatch);
      return callback(null, noMatch);
    }
    
    var recording = data.recordings[0];
    var score = recording.score || 0;
    
    if (score < 70) {
      var lowScore = { verified: false, mbid: null, album: null };
      cache.set('lookups', cacheKey, lowScore);
      return callback(null, lowScore);
    }
    
    var result = {
      verified: true,
      mbid: recording.id,
      artist: recording['artist-credit'] ? recording['artist-credit'][0].name : artist,
      title: recording.title || title,
      album: null,
      score: score
    };
    
    // Patterns that indicate DJ promos, compilations, etc. (not real albums)
    var compilationPatterns = [
      /\bPromo Only\b/i,
      /\bDMC\b.*\bDJ\b/i,
      /\bDJ Only\b/i,
      /\bClub Promo\b/i,
      /\bHot Video\b/i,
      /\bPure Dubstep\b/i,
      /\bNow That's What I Call\b/i,
      /\bMinistry of Sound\b/i,
      /\bClubland\b/i,
      /\bHedkandi\b/i,
      /\bHits \d{4}\b/i,
      /\bTop \d+ Hits\b/i,
      /\bGreatest Hits\b/i,
      /\bBest of\b/i,
      /\bThe Very Best\b/i,
      /\bUltimate\b.*\bCollection\b/i,
      /\bCompilation\b/i,
      /\bVarious Artists\b/i,
      /\bVol\.\s*\d+\b/i,
      /\bVolume\s+\d+\b/i
    ];
    
    // Find best album from releases - prefer official albums over compilations
    if (recording.releases && recording.releases.length > 0) {
      var bestRelease = null;
      var bestScore = -1000;
      
      for (var i = 0; i < recording.releases.length; i++) {
        var release = recording.releases[i];
        var releaseScore = 0;
        var releaseTitle = release.title || '';
        
        // Check if title matches compilation patterns - heavy penalty
        var isCompilation = false;
        for (var p = 0; p < compilationPatterns.length; p++) {
          if (compilationPatterns[p].test(releaseTitle)) {
            isCompilation = true;
            releaseScore -= 100;
            break;
          }
        }
        
        // Prefer official status
        if (release.status === 'Official') {
          releaseScore += 10;
        }
        
        // Prefer albums over compilations, singles, etc.
        var rgType = release['release-group'] ? release['release-group']['primary-type'] : null;
        var secondaryTypes = release['release-group'] ? release['release-group']['secondary-types'] : [];
        
        if (rgType === 'Album') {
          releaseScore += 20;
        } else if (rgType === 'Single' || rgType === 'EP') {
          releaseScore += 5;
        }
        
        // Penalize compilations by type
        if (secondaryTypes && secondaryTypes.indexOf('Compilation') !== -1) {
          releaseScore -= 50;
        }
        
        // Penalize soundtracks and live albums
        if (secondaryTypes && (secondaryTypes.indexOf('Soundtrack') !== -1 || 
                               secondaryTypes.indexOf('Live') !== -1)) {
          releaseScore -= 30;
        }
        
        // Prefer releases where artist matches (not "Various Artists")
        if (release['artist-credit'] && release['artist-credit'][0]) {
          var releaseArtist = release['artist-credit'][0].name || '';
          if (releaseArtist.toLowerCase() === 'various artists') {
            releaseScore -= 80;
          }
        }
        
        if (releaseScore > bestScore) {
          bestScore = releaseScore;
          bestRelease = release;
        }
      }
      
      if (bestRelease && bestScore > -50) {
        result.album = bestRelease.title;
      } else if (bestRelease) {
        // Even best release is a compilation - still use it but log
        result.album = bestRelease.title;
        console.log('[RTL-SDR Radio] Warning: Best album match is likely a compilation: ' + bestRelease.title);
      }
    }
    
    cache.set('lookups', cacheKey, result);
    callback(null, result);
  });
}

// ============================================================================
// RAW TEXT SEARCH (METHOD F)
// ============================================================================

function searchRaw(text, callback) {
  if (!text || text.trim().length === 0) {
    return callback(null, { artist: null, title: null, confidence: 0, method: null });
  }
  
  var query = encodeURIComponent(text.trim());
  var path = '/recording?query=' + query + '&limit=5&fmt=json';
  
  musicbrainzRequest(path, function(err, data) {
    if (err || !data || !data.recordings || data.recordings.length === 0) {
      return callback(null, { artist: null, title: null, confidence: 0, method: null });
    }
    
    // Find best match
    var best = data.recordings[0];
    var score = best.score || 0;
    
    if (score < 60) {
      return callback(null, { artist: null, title: null, confidence: 0, method: null });
    }
    
    var result = {
      artist: best['artist-credit'] ? best['artist-credit'][0].name : null,
      title: best.title || null,
      confidence: Math.round(score * 0.6),  // Scale MB score to our confidence
      method: 'musicbrainz-raw',
      mbid: best.id
    };
    
    callback(null, result);
  });
}

// ============================================================================
// FULL EXTRACTION WITH MB FALLBACK
// ============================================================================

function extractWithLookup(text, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  
  options = options || {};
  
  extract(text, options, function(err, result) {
    if (err) {
      return callback(err, null);
    }
    
    // If local extraction succeeded with good confidence
    if (result.artist && result.title && result.confidence >= 70) {
      // Optionally verify with MusicBrainz
      if (options.verify) {
        lookup(result.artist, result.title, function(lookupErr, lookupResult) {
          if (lookupResult && lookupResult.verified) {
            result.verified = true;
            result.mbid = lookupResult.mbid;
            result.artwork = lookupResult.artwork;
            // Use MB-corrected values if available
            if (lookupResult.artist) result.artist = lookupResult.artist;
            if (lookupResult.title) result.title = lookupResult.title;
          }
          callback(null, result);
        });
      } else {
        callback(null, result);
      }
      return;
    }
    
    // Local extraction failed or low confidence - try MB raw search
    var cleanedText = cleanText(text);
    if (cleanedText) {
      searchRaw(cleanedText, function(rawErr, rawResult) {
        if (rawResult && rawResult.artist && rawResult.title) {
          callback(null, rawResult);
        } else {
          // Return whatever we have, even if low confidence
          callback(null, result);
        }
      });
    } else {
      callback(null, result);
    }
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

// Set user-defined blocklist phrases
function setUserPhrases(phrases) {
  if (Array.isArray(phrases)) {
    userBlocklistPhrases = phrases.filter(function(p) {
      return typeof p === 'string' && p.trim().length > 0;
    });
  }
}

// Get current user phrases (for debugging)
function getUserPhrases() {
  return userBlocklistPhrases.slice();
}

/**
 * Set debug logging flag
 * Called from index.js based on artwork_debug_logging setting
 */
function setDebugLogging(enabled) {
  config.debugLogging = !!enabled;
}

module.exports = {
  extract: extract,
  extractWithLookup: extractWithLookup,
  lookup: lookup,
  lastfmLookup: lastfmLookup,
  openOpusLookup: openOpusLookup,
  isLikelyClassicalComposer: isLikelyClassicalComposer,
  searchRaw: searchRaw,
  cache: cache,
  config: config,
  setUserPhrases: setUserPhrases,
  getUserPhrases: getUserPhrases,
  setDebugLogging: setDebugLogging,
  // Fuzzy matching utilities (for DAB proximity filtering)
  similarity: similarity,
  levenshteinDistance: levenshteinDistance,
  fuzzyStripPrefix: fuzzyStripPrefix,
  fuzzyBlocklistMatch: fuzzyBlocklistMatch
};
