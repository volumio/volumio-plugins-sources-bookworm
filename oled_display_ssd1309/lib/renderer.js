'use strict';

/**
 * Renderer for the 128x64 OLED display (v1.7.17).
 *
 * Three playback layouts (Classic, Minimal, Clock Focus), idle screen
 * with large clock digits, volume overlay, screensavers with randomised
 * bounce, and frame-counting colon blink.
 */

var font = require('./font5x7');
var getGlyph = font.getGlyph;
var CHAR_WIDTH = font.CHAR_WIDTH;
var CHAR_SPACING = font.CHAR_SPACING;
var ICONS = font.ICONS;

var DISPLAY_W = 128;
var DISPLAY_H = 64;
var FULL_CHAR_W = CHAR_WIDTH + CHAR_SPACING; // 6px per character

// ── Playback layout Y-coordinates ───────────────────────────────────────
var Y_CLOCK_VOL  = 0;
var Y_TITLE      = 11;
var Y_ARTIST     = 21;
var Y_PROGRESS   = 32;
var Y_TIME       = 43;
var Y_BITDEPTH   = 54;

// ── Idle layout Y-coordinates ───────────────────────────────────────────
var Y_IDLE_CLOCK = 8;
var Y_IDLE_DATE  = 35;
var Y_IDLE_VOL   = 49;

// Default day/month names (English fallback)
var DEFAULT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var DEFAULT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Scroll pause: frames to hold at start position before scrolling begins
var SCROLL_PAUSE_FRAMES = 8;

// Track types to exclude from the audio info display.
// These are transport/service names, not actual codecs.
// Anything NOT in this list is treated as a codec and shown uppercase.
var SKIP_TRACK_TYPES = {
  'airplay': true,
  'webradio': true,
  'spotify': true,
  'tidal': true,
  'qobuz': true,
  'upnp': true,
  'bluetooth': true
};

// Maximum characters that fit on the display (128px / 6px per char)
var MAX_DISPLAY_CHARS = 21;


function Renderer(display, options) {
  this.display = display;
  this.scrollSpeed = (options && options.scrollSpeed) || 3;
  this.clock24h = (options && options.clock24h !== undefined) ? options.clock24h : true;
  this.colonBlink = (options && options.colonBlink !== undefined) ? options.colonBlink : true;

  // Localized day/month names and date format (from i18n)
  this._dayNames = (options && options.dayNames) || DEFAULT_DAYS;
  this._monthNames = (options && options.monthNames) || DEFAULT_MONTHS;
  this._dateFormat = (options && options.dateFormat) || 'day_month_name';

  // Frame-counting colon blink: toggle every N frames where N = 1000ms / renderInterval.
  // This avoids timestamp drift that caused every ~5th blink to be uneven.
  var renderInterval = (options && options.renderInterval) || 500;
  this._colonVisible = true;
  this._colonFrameCount = 0;
  this._colonToggleFrames = Math.max(1, Math.round(1000 / renderInterval));

  // Per-field scroll state objects
  this._scroll = {
    title:  { px: 0, pauseCounter: 0, lastText: '' },
    artist: { px: 0, pauseCounter: 0, lastText: '' }
  };

  // Screensaver bounce state.
  // Starting position and direction are randomised by resetScreensaver()
  // on each activation.
  this._saver = {
    x: 0, y: 0,
    dx: 1, dy: 1,
    // Bouncing clock repositions every ~10 seconds (time-based, not frame-based)
    clockRepoTimer: 0,
    clockRepoInterval: Math.max(1, Math.round(10000 / renderInterval))
  };

  // Splash screen frame counter
  this._splashFrame = 0;
}


// ═══════════════════════════════════════════════════════════════════════════
// Public render entry points
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main render dispatch.  Called by index.js on every frame.
 * @param {Object} state  Volumio playback state
 * @param {Object} opts   Per-frame options from index.js:
 *   - showVolumeOverlay {boolean}  true if volume changed recently
 *   - screensaverMode {string}     'none', 'bouncing_clock', 'bouncing_dot', 'drifting_text'
 *   - screensaverActive {boolean}  true if screensaver should be shown
 *   - playbackLayout {string}      'classic', 'minimal', 'clock_focus'
 */
Renderer.prototype.render = function (state, opts) {
  this.display.clearBuffer();

  opts = opts || {};

  // Priority 1: Volume overlay (shown on any screen when volume changes)
  if (opts.showVolumeOverlay) {
    this._renderVolumeOverlay(state.volume);
    return;
  }

  // Priority 2: Screensaver (when active and configured)
  if (opts.screensaverActive && opts.screensaverMode && opts.screensaverMode !== 'none') {
    this._renderScreensaver(opts.screensaverMode);
    return;
  }

  // Priority 3: Normal screens
  var isPlaying = (state.status === 'play' || state.status === 'pause');
  if (isPlaying) {
    this._renderPlayback(state, opts.playbackLayout || 'classic');
  } else {
    this._renderIdle(state);
  }
};

/**
 * Render splash screen.  Called by index.js during the startup phase.
 */
Renderer.prototype.renderSplash = function () {
  this.display.clearBuffer();

  // "Volumio" centered, large-ish (use 1x font, it's what we have)
  var label = 'Volumio';
  var labelW = label.length * FULL_CHAR_W;
  this._drawText(Math.floor((DISPLAY_W - labelW) / 2), 24, label);

  // Animated dots: cycle through ".", "..", "..." every few frames
  var dotCount = (this._splashFrame % 3) + 1;
  var dots = '';
  for (var i = 0; i < dotCount; i++) dots += '.';
  // Pad to 3 chars so the text doesn't jump
  while (dots.length < 3) dots += ' ';
  var dotsW = 3 * FULL_CHAR_W;
  this._drawText(Math.floor((DISPLAY_W - dotsW) / 2), 36, dots);

  this._splashFrame++;
};


// ═══════════════════════════════════════════════════════════════════════════
// Volume overlay (Option B – full-screen takeover)
// ═══════════════════════════════════════════════════════════════════════════

Renderer.prototype._renderVolumeOverlay = function (volume) {
  var d = this.display;
  var volVal = (volume != null) ? volume : 0;

  // Large percentage centered
  var pctStr = String(volVal) + '%';
  var pctW = this._calcLargeClockWidth(pctStr);
  var pctX = Math.floor((DISPLAY_W - pctW) / 2);
  // Use large digit glyphs for the number, small font for the % sign
  this._drawLargeClockDigitsAndPercent(pctX, 6, volVal);

  // Progress bar: 100px wide, centered
  var barW = 100;
  var barX = Math.floor((DISPLAY_W - barW) / 2);
  var barY = 38;
  var barH = 6;

  // Border: top/bottom lines and left/right edge columns
  d.hLine(barX, barY, barW, true);
  d.hLine(barX, barY + barH - 1, barW, true);
  d.fillRect(barX, barY + 1, 1, barH - 2, true);
  d.fillRect(barX + barW - 1, barY + 1, 1, barH - 2, true);

  // Fill
  var fillW = Math.round((barW - 4) * Math.min(volVal / 100, 1.0));
  if (fillW > 0) {
    d.fillRect(barX + 2, barY + 1, fillW, barH - 2, true);
  }

  // "Volume" label centered below
  var label = 'Volume';
  var labelW = label.length * FULL_CHAR_W;
  this._drawText(Math.floor((DISPLAY_W - labelW) / 2), 52, label);
};

/**
 * Draw volume value using large digit glyphs + small '%' sign.
 *
 * NOTE: centering relies on _calcLargeClockWidth treating '%' as
 * FULL_CHAR_W (6px = CHAR_WIDTH + CHAR_SPACING), while this method
 * draws it as a 1px gap + 5px char (also 6px total).  If CHAR_SPACING
 * changes from 1, both methods must be updated together.
 */
Renderer.prototype._drawLargeClockDigitsAndPercent = function (x, y, volume) {
  var numStr = String(volume);
  var curX = x;

  // Draw each digit large
  for (var i = 0; i < numStr.length; i++) {
    var digit = parseInt(numStr[i], 10);
    if (!isNaN(digit) && font.LARGE_DIGITS[digit]) {
      this._drawLargeGlyph(curX, y, font.LARGE_DIGITS[digit],
        font.LARGE_CHAR_WIDTH, font.LARGE_CHAR_HEIGHT);
      curX += font.LARGE_CHAR_WIDTH + font.LARGE_CHAR_SPACING;
    }
  }

  // Draw '%' in small font, vertically centered with the large digits
  var pctY = y + Math.floor((font.LARGE_CHAR_HEIGHT - 7) / 2);
  this._drawChar(curX + 1, pctY, 37); // ASCII 37 = '%'
};


// ═══════════════════════════════════════════════════════════════════════════
// Screensavers
// ═══════════════════════════════════════════════════════════════════════════

Renderer.prototype._renderScreensaver = function (mode) {
  switch (mode) {
    case 'bouncing_clock':
      this._renderScreensaverClock();
      break;
    case 'bouncing_dot':
      this._renderScreensaverDot();
      break;
    case 'drifting_text':
      this._renderScreensaverText();
      break;
    default:
      // Unknown mode — just blank screen
      break;
  }
};

/**
 * Bouncing clock: small "HH:MM" text repositions to a random location
 * every ~10 seconds (clockRepoInterval frames).
 */
Renderer.prototype._renderScreensaverClock = function () {
  var s = this._saver;
  var clockStr = this._formatClock();
  var textW = clockStr.length * FULL_CHAR_W;
  var textH = 7;

  s.clockRepoTimer++;
  if (s.clockRepoTimer >= s.clockRepoInterval) {
    s.clockRepoTimer = 0;
    // Random position, clamped to display bounds
    s.x = Math.floor(Math.random() * (DISPLAY_W - textW));
    s.y = Math.floor(Math.random() * (DISPLAY_H - textH));
  }

  this._drawText(s.x, s.y, clockStr);
};

/**
 * Bouncing dot: 3×3 pixel dot bounces off screen edges every frame.
 * Each bounce adds a small random speed variation (±10%) so the path
 * gradually evolves and never traces the same route twice.
 */
Renderer.prototype._renderScreensaverDot = function () {
  var s = this._saver;
  var dotSize = 3;

  // Move
  s.x += s.dx;
  s.y += s.dy;

  // Bounce off edges with random speed nudge
  if (s.x <= 0 || s.x >= DISPLAY_W - dotSize) {
    s.dx = this._nudgeBounce(-s.dx);
    s.x = Math.max(0, Math.min(s.x, DISPLAY_W - dotSize));
  }
  if (s.y <= 0 || s.y >= DISPLAY_H - dotSize) {
    s.dy = this._nudgeBounce(-s.dy);
    s.y = Math.max(0, Math.min(s.y, DISPLAY_H - dotSize));
  }

  this.display.fillRect(Math.floor(s.x), Math.floor(s.y), dotSize, dotSize, true);
};

/**
 * Drifting Volumio: "Volumio" text bounces off screen edges.
 * DVD-logo style with randomized bounce angle.
 */
Renderer.prototype._renderScreensaverText = function () {
  var s = this._saver;
  var label = 'Volumio';
  var textW = label.length * FULL_CHAR_W;
  var textH = 7;

  // Move
  s.x += s.dx;
  s.y += s.dy;

  // Bounce off edges with random speed nudge
  if (s.x <= 0 || s.x >= DISPLAY_W - textW) {
    s.dx = this._nudgeBounce(-s.dx);
    s.x = Math.max(0, Math.min(s.x, DISPLAY_W - textW));
  }
  if (s.y <= 0 || s.y >= DISPLAY_H - textH) {
    s.dy = this._nudgeBounce(-s.dy);
    s.y = Math.max(0, Math.min(s.y, DISPLAY_H - textH));
  }

  this._drawText(Math.floor(s.x), Math.floor(s.y), label);
};

/**
 * Apply a small random speed variation on bounce (±10%), clamped
 * to a min/max range so it never stalls or gets too fast.
 */
Renderer.prototype._nudgeBounce = function (v) {
  var nudged = v * (0.9 + Math.random() * 0.2);
  // Clamp absolute value to 0.5–1.8
  var sign = nudged >= 0 ? 1 : -1;
  var abs = Math.abs(nudged);
  if (abs < 0.5) abs = 0.5;
  if (abs > 1.8) abs = 1.8;
  return sign * abs;
};

/**
 * Reset screensaver state (called when entering screensaver).
 * Randomises starting position and direction so each activation
 * produces a different path.
 */
Renderer.prototype.resetScreensaver = function () {
  this._saver.x = Math.floor(Math.random() * (DISPLAY_W - 50));
  this._saver.y = Math.floor(Math.random() * (DISPLAY_H - 20));
  this._saver.dx = (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random() * 0.4);
  this._saver.dy = (Math.random() > 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.4);
  this._saver.clockRepoTimer = 0;
};


// ═══════════════════════════════════════════════════════════════════════════
// Playback screen (layout dispatcher + layout methods)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dispatch to the selected playback layout.
 */
Renderer.prototype._renderPlayback = function (state, layout) {
  switch (layout) {
    case 'minimal':
      this._renderPlaybackMinimal(state);
      break;
    case 'clock_focus':
      this._renderPlaybackClockFocus(state);
      break;
    default:
      this._renderPlaybackClassic(state);
      break;
  }
};

/**
 * Helper: compute seek/duration/progress values used by all layouts.
 */
Renderer.prototype._calcProgress = function (state) {
  var seekSec = (state.seek || 0) / 1000;
  var durSec = state.duration || 0;
  if (durSec > 0 && seekSec > durSec) seekSec = durSec;
  var progress = (durSec > 0) ? Math.min(seekSec / durSec, 1.0) : 0;
  return { seekSec: seekSec, durSec: durSec, progress: progress };
};

/**
 * Helper: draw a bordered progress bar with fill.
 */
Renderer.prototype._drawProgressBar = function (x, y, w, h, progress) {
  var d = this.display;
  d.hLine(x, y, w, true);
  d.hLine(x, y + h - 1, w, true);
  d.fillRect(x, y + 1, 1, h - 2, true);
  d.fillRect(x + w - 1, y + 1, 1, h - 2, true);
  var fillW = Math.round((w - 4) * progress);
  if (fillW > 0) {
    d.fillRect(x + 2, y + 1, fillW, h - 2, true);
  }
};


// ── Classic ──────────────────────────────────────────────────────────────
// Clock+Vol | Icon+Title | Artist | Progress | Time | Audio info

Renderer.prototype._renderPlaybackClassic = function (state) {
  var title = state.title || 'Unknown Title';
  var artist = state.artist || 'Unknown Artist';

  // Row 1: Clock (left) and Volume (right)
  var clockStr = this._formatClock();
  this._drawText(0, Y_CLOCK_VOL, clockStr);
  var volStr = 'Vol:' + String(state.volume != null ? state.volume : '--') + '%';
  var volWidth = volStr.length * FULL_CHAR_W;
  this._drawText(DISPLAY_W - volWidth, Y_CLOCK_VOL, volStr);

  // Row 2: Status icon + Title (scrolling)
  var icon = (state.status === 'play') ? ICONS.play : ICONS.pause;
  this._drawIcon8x8(0, Y_TITLE, icon);
  this._drawScrollingText(10, Y_TITLE, DISPLAY_W - 10, title, 'title');

  // Row 3: Artist (scrolling)
  this._drawScrollingText(0, Y_ARTIST, DISPLAY_W, artist, 'artist');

  // Row 4: Progress bar (4px thin, matching Clock Focus)
  var p = this._calcProgress(state);
  this._drawProgressBar(0, Y_PROGRESS, DISPLAY_W, 4, p.progress);

  // Row 5: Time (centered)
  var timeStr = this._formatTime(p.seekSec) + ' / ' + this._formatTime(p.durSec);
  var timeWidth = timeStr.length * FULL_CHAR_W;
  this._drawText(Math.max(0, Math.floor((DISPLAY_W - timeWidth) / 2)), Y_TIME, timeStr);

  // Row 6: Audio info (centered)
  var bdStr = this._formatAudioInfo(state.bitdepth, state.samplerate, state.bitrate, state.trackType);
  var bdWidth = bdStr.length * FULL_CHAR_W;
  this._drawText(Math.max(0, Math.floor((DISPLAY_W - bdWidth) / 2)), Y_BITDEPTH, bdStr);
};


// ── Minimal ──────────────────────────────────────────────────────────────
// Title (centered) | Artist (centered, dimmed) | Thin progress | Time

Renderer.prototype._renderPlaybackMinimal = function (state) {
  var title = state.title || 'Unknown Title';
  var artist = state.artist || 'Unknown Artist';

  // Title: centered, scrolling (y=10)
  var titleW = title.length * FULL_CHAR_W;
  if (titleW <= DISPLAY_W) {
    // Static, centered
    this._drawText(Math.floor((DISPLAY_W - titleW) / 2), 10, title);
  } else {
    // Scrolling, full width
    this._drawScrollingText(0, 10, DISPLAY_W, title, 'title');
  }

  // Artist: centered (y=22)
  var artistW = artist.length * FULL_CHAR_W;
  if (artistW <= DISPLAY_W) {
    this._drawText(Math.floor((DISPLAY_W - artistW) / 2), 22, artist);
  } else {
    this._drawScrollingText(0, 22, DISPLAY_W, artist, 'artist');
  }

  // Thin progress bar (y=36, height 3px)
  var p = this._calcProgress(state);
  this._drawProgressBar(10, 36, DISPLAY_W - 20, 3, p.progress);

  // Time: centered (y=46)
  var timeStr = this._formatTime(p.seekSec) + ' / ' + this._formatTime(p.durSec);
  var timeWidth = timeStr.length * FULL_CHAR_W;
  this._drawText(Math.max(0, Math.floor((DISPLAY_W - timeWidth) / 2)), 46, timeStr);
};


// ── Clock Focus ──────────────────────────────────────────────────────────
// Large clock | Separator | Icon+Title | Artist | Progress | Time+Audio

Renderer.prototype._renderPlaybackClockFocus = function (state) {
  var title = state.title || 'Unknown Title';
  var artist = state.artist || 'Unknown Artist';
  var d = this.display;

  // Large clock centered at top (y=0)
  var now = new Date();
  var hours = now.getHours();
  var mins = now.getMinutes();
  var clockStr, clockW;

  if (this.clock24h) {
    clockStr = String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
    clockW = this._calcLargeClockWidth(clockStr);
    this._drawLargeClock(Math.floor((DISPLAY_W - clockW) / 2), 0, clockStr, true);
  } else {
    var ampm = (hours >= 12) ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    clockStr = String(hours) + ':' + String(mins).padStart(2, '0');
    var bigW = this._calcLargeClockWidth(clockStr);
    var smallW = ampm.length * FULL_CHAR_W;
    var totalW = bigW + 4 + smallW;
    var startX = Math.floor((DISPLAY_W - totalW) / 2);
    this._drawLargeClock(startX, 0, clockStr, true);
    var ampmY = Math.floor((font.LARGE_CHAR_HEIGHT - 7) / 2);
    this._drawText(startX + bigW + 4, ampmY, ampm);
  }

  // Thin separator line (y=23)
  d.hLine(0, 23, DISPLAY_W, true);

  // Icon + Title (scrolling, y=27)
  var icon = (state.status === 'play') ? ICONS.play : ICONS.pause;
  this._drawIcon8x8(0, 27, icon);
  this._drawScrollingText(10, 27, DISPLAY_W - 10, title, 'title');

  // Artist (scrolling, y=37)
  this._drawScrollingText(0, 37, DISPLAY_W, artist, 'artist');

  // Progress bar (y=48, height 4px)
  var p = this._calcProgress(state);
  this._drawProgressBar(0, 48, DISPLAY_W, 4, p.progress);

  // Time compact (left) + Audio info without codec (right) (y=55)
  var timeStr = this._formatTime(p.seekSec) + '/' + this._formatTime(p.durSec);
  this._drawText(0, 55, timeStr);
  var bdStr = this._formatAudioInfoCompact(state.bitdepth, state.samplerate, state.bitrate, '');
  var bdWidth = bdStr.length * FULL_CHAR_W;
  this._drawText(DISPLAY_W - bdWidth, 55, bdStr);
};


// ═══════════════════════════════════════════════════════════════════════════
// Idle screen (native large clock digits, date, volume)
// ═══════════════════════════════════════════════════════════════════════════

Renderer.prototype._renderIdle = function (state) {
  var now = new Date();
  var hours = now.getHours();
  var mins = now.getMinutes();

  // Colon blink: toggle every N render frames (N = 1000ms / renderInterval).
  // Frame counting is perfectly even — no timestamp drift accumulation.
  var showColon = true;
  if (this.colonBlink) {
    this._colonFrameCount++;
    if (this._colonFrameCount >= this._colonToggleFrames) {
      this._colonFrameCount = 0;
      this._colonVisible = !this._colonVisible;
    }
    showColon = this._colonVisible;
  }

  // ── Large clock with native glyphs ────────────────────────────────────
  if (this.clock24h) {
    var clockStr24 = String(hours).padStart(2, '0') + ':' +
                     String(mins).padStart(2, '0');
    var clockW24 = this._calcLargeClockWidth(clockStr24);
    var clockX24 = Math.floor((DISPLAY_W - clockW24) / 2);
    this._drawLargeClock(clockX24, Y_IDLE_CLOCK, clockStr24, showColon);
  } else {
    var ampm = (hours >= 12) ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    var clockStr12 = String(hours) + ':' + String(mins).padStart(2, '0');
    var bigW = this._calcLargeClockWidth(clockStr12);
    var smallW = ampm.length * FULL_CHAR_W;
    var totalW = bigW + 4 + smallW;
    var startX = Math.floor((DISPLAY_W - totalW) / 2);

    this._drawLargeClock(startX, Y_IDLE_CLOCK, clockStr12, showColon);
    var ampmX = startX + bigW + 4;
    var ampmY = Y_IDLE_CLOCK + Math.floor((font.LARGE_CHAR_HEIGHT - 7) / 2);
    this._drawText(ampmX, ampmY, ampm);
  }

  // ── Date, centred (localized) ───────────────────────────────────────
  var day = String(now.getDate()).padStart(2, '0');
  var dayName = this._dayNames[now.getDay()] || DEFAULT_DAYS[now.getDay()];
  var monthName = this._monthNames[now.getMonth()] || DEFAULT_MONTHS[now.getMonth()];
  var month = String(now.getMonth() + 1).padStart(2, '0');
  var year = String(now.getFullYear());
  var dateStr;
  switch (this._dateFormat) {
    case 'dd_mm_yyyy':
      dateStr = day + '.' + month + '.' + year;
      break;
    case 'mm_dd_yyyy':
      dateStr = month + '/' + day + '/' + year;
      break;
    case 'yyyy_mm_dd':
      dateStr = year + '-' + month + '-' + day;
      break;
    default: // day_month_name
      dateStr = dayName + ' ' + day + ' ' + monthName + ' ' + year;
      break;
  }
  var dateW = dateStr.length * FULL_CHAR_W;
  this._drawText(Math.floor((DISPLAY_W - dateW) / 2), Y_IDLE_DATE, dateStr);

  // ── Volume, centred ───────────────────────────────────────────────────
  var volStr = 'Vol: ' + String(state.volume != null ? state.volume : '--') + '%';
  var volW = volStr.length * FULL_CHAR_W;
  this._drawText(Math.floor((DISPLAY_W - volW) / 2), Y_IDLE_VOL, volStr);

  // Reset scroll state
  this._resetScrollState();
};


// ═══════════════════════════════════════════════════════════════════════════
// Large clock digit drawing
// ═══════════════════════════════════════════════════════════════════════════

Renderer.prototype._calcLargeClockWidth = function (timeStr) {
  var w = 0;
  for (var i = 0; i < timeStr.length; i++) {
    if (i > 0) w += font.LARGE_CHAR_SPACING;
    if (timeStr[i] === ':') w += font.LARGE_COLON_WIDTH;
    else if (timeStr[i] === '%') w += FULL_CHAR_W; // '%' uses small font
    else w += font.LARGE_CHAR_WIDTH;
  }
  return w;
};

Renderer.prototype._drawLargeClock = function (x, y, timeStr, showColon) {
  var curX = x;
  for (var i = 0; i < timeStr.length; i++) {
    var ch = timeStr[i];
    if (ch === ':') {
      if (showColon) {
        this._drawLargeGlyph(curX, y, font.LARGE_COLON,
          font.LARGE_COLON_WIDTH, font.LARGE_CHAR_HEIGHT);
      }
      curX += font.LARGE_COLON_WIDTH + font.LARGE_CHAR_SPACING;
    } else {
      var digit = parseInt(ch, 10);
      if (!isNaN(digit) && font.LARGE_DIGITS[digit]) {
        this._drawLargeGlyph(curX, y, font.LARGE_DIGITS[digit],
          font.LARGE_CHAR_WIDTH, font.LARGE_CHAR_HEIGHT);
        curX += font.LARGE_CHAR_WIDTH + font.LARGE_CHAR_SPACING;
      }
    }
  }
};

Renderer.prototype._drawLargeGlyph = function (x, y, glyphData, charWidth, charHeight) {
  for (var col = 0; col < charWidth; col++) {
    var px = x + col;
    if (px < 0 || px >= DISPLAY_W) continue;
    var colData = glyphData[col];
    for (var row = 0; row < charHeight; row++) {
      if ((colData >> row) & 1) {
        var py = y + row;
        if (py >= 0 && py < DISPLAY_H) {
          this.display.setPixel(px, py, true);
        }
      }
    }
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// Small text drawing (5×7 font)
// ═══════════════════════════════════════════════════════════════════════════

Renderer.prototype._drawText = function (x, y, text) {
  for (var i = 0; i < text.length; i++) {
    var cx = x + i * FULL_CHAR_W;
    if (cx + CHAR_WIDTH < 0) continue;
    if (cx >= DISPLAY_W) break;
    this._drawChar(cx, y, text.charCodeAt(i));
  }
};

Renderer.prototype._drawChar = function (x, y, charCode) {
  var glyph = getGlyph(charCode);
  for (var col = 0; col < CHAR_WIDTH; col++) {
    var px = x + col;
    if (px < 0 || px >= DISPLAY_W) continue;
    var colData = glyph[col];
    for (var row = 0; row < 7; row++) {
      if ((colData >> row) & 1) {
        this.display.setPixel(px, y + row, true);
      }
    }
  }
};

Renderer.prototype._drawScrollingText = function (x, y, areaWidth, text, field) {
  var textWidthPx = text.length * FULL_CHAR_W;
  var sc = this._scroll[field];

  if (text !== sc.lastText) {
    sc.px = 0;
    sc.pauseCounter = 0;
    sc.lastText = text;
  }

  if (textWidthPx <= areaWidth) {
    this._drawText(x, y, text);
    return;
  }

  var gap = '      ';
  var loopText = text + gap;
  var loopWidthPx = loopText.length * FULL_CHAR_W;

  if (sc.pauseCounter < SCROLL_PAUSE_FRAMES) {
    sc.pauseCounter++;
    sc.px = 0;
  }

  var maxChars = Math.ceil(areaWidth / FULL_CHAR_W) + 1;
  for (var i = 0; i < maxChars; i++) {
    var px = x + i * FULL_CHAR_W - (sc.px % FULL_CHAR_W);
    var charIdx = (Math.floor(sc.px / FULL_CHAR_W) + i) % loopText.length;
    if (px + CHAR_WIDTH < x) continue;
    if (px >= x + areaWidth) break;
    this._drawCharClipped(px, y, loopText.charCodeAt(charIdx), x, x + areaWidth);
  }

  if (sc.pauseCounter >= SCROLL_PAUSE_FRAMES) {
    sc.px += this.scrollSpeed;
    if (sc.px >= loopWidthPx) {
      sc.px = 0;
      sc.pauseCounter = 0;
    }
  }
};

Renderer.prototype._drawCharClipped = function (x, y, charCode, clipLeft, clipRight) {
  var glyph = getGlyph(charCode);
  for (var col = 0; col < CHAR_WIDTH; col++) {
    var px = x + col;
    if (px < clipLeft || px >= clipRight) continue;
    var colData = glyph[col];
    for (var row = 0; row < 7; row++) {
      if ((colData >> row) & 1) {
        this.display.setPixel(px, y + row, true);
      }
    }
  }
};

Renderer.prototype._resetScrollState = function () {
  var fields = Object.keys(this._scroll);
  for (var i = 0; i < fields.length; i++) {
    var sc = this._scroll[fields[i]];
    sc.px = 0;
    sc.pauseCounter = 0;
    sc.lastText = '';
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// Icon drawing
// ═══════════════════════════════════════════════════════════════════════════

Renderer.prototype._drawIcon8x8 = function (x, y, iconData) {
  for (var row = 0; row < 8; row++) {
    var rowByte = iconData[row];
    for (var col = 0; col < 8; col++) {
      if ((rowByte >> (7 - col)) & 1) {
        this.display.setPixel(x + col, y + row, true);
      }
    }
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

Renderer.prototype._formatTime = function (totalSeconds) {
  var s = Math.floor(totalSeconds);
  var mins = Math.floor(s / 60);
  var secs = s % 60;
  return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
};

Renderer.prototype._formatClock = function () {
  var now = new Date();
  var hours = now.getHours();
  var mins = now.getMinutes();
  if (!this.clock24h) {
    var ampm = (hours >= 12) ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return String(hours) + ':' + String(mins).padStart(2, '0') + ' ' + ampm;
  }
  return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
};

Renderer.prototype._formatAudioInfo = function (bitdepth, samplerate, bitrate, trackType) {
  var parts = [];
  if (bitdepth) {
    var bd = String(bitdepth).replace(/\s+/g, '').toLowerCase();
    if (bd.indexOf('bit') === -1 && bd.indexOf('dsd') === -1) bd += 'bit';
    parts.push(bd);
  }
  if (samplerate) {
    var sr = String(samplerate).replace(/\s+/g, '').toLowerCase();
    if (/^\d+$/.test(sr)) {
      var num = parseInt(sr, 10);
      if (num >= 1000) {
        var khz = num / 1000;
        sr = (khz % 1 === 0 ? String(khz) : khz.toFixed(1)) + 'kHz';
      } else {
        sr += 'kHz';
      }
    } else if (sr.indexOf('hz') === -1) {
      sr += 'kHz';
    }
    parts.push(sr);
  }

  var audioStr;
  if (parts.length > 0) {
    audioStr = parts.join(' / ');
  } else if (bitrate) {
    // Fallback: use bitrate for webradio streams (e.g. "128 Kbps")
    var br = String(bitrate).trim();
    if (/^\d+$/.test(br)) br += ' Kbps';
    audioStr = br;
  } else {
    audioStr = 'PCM';
  }

  // Prefix with codec name if trackType is a real codec (not in skip list)
  if (trackType) {
    var tt = String(trackType).trim().toLowerCase();
    if (tt && !SKIP_TRACK_TYPES[tt]) {
      var codec = tt.toUpperCase();
      var combined = codec + ' ' + audioStr;
      // Only add if it fits on the display; otherwise show audio info alone
      if (combined.length <= MAX_DISPLAY_CHARS) {
        return combined;
      }
    }
  }

  return audioStr;
};

/**
 * Compact audio info for layouts that share a line with time.
 * Produces shortened output like "FLAC 24/192k" or "128Kbps".
 * Fits within ~8 characters to coexist with "02:34 / 05:12" on 128px.
 */
Renderer.prototype._formatAudioInfoCompact = function (bitdepth, samplerate, bitrate, trackType) {
  var parts = [];

  if (bitdepth && samplerate) {
    // Compact: "24/192k" or "16/44.1k"
    var bd = String(bitdepth).replace(/\s+/g, '').replace(/bit$/i, '');
    var sr = String(samplerate).replace(/\s+/g, '');
    if (/^\d+$/.test(sr)) {
      var num = parseInt(sr, 10);
      if (num >= 1000) {
        var khz = num / 1000;
        sr = (khz % 1 === 0 ? String(khz) : khz.toFixed(1)) + 'k';
      } else {
        sr += 'k';
      }
    } else {
      sr = sr.replace(/kHz$/i, 'k').replace(/Hz$/i, '');
    }
    parts.push(bd + '/' + sr);
  } else if (bitrate) {
    var br = String(bitrate).trim().replace(/\s+/g, '');
    if (/^\d+$/.test(br)) br += 'Kbps';
    parts.push(br);
  } else {
    parts.push('PCM');
  }

  var audioStr = parts.join('/');

  // Prefix with codec if trackType is a real codec
  if (trackType) {
    var tt = String(trackType).trim().toLowerCase();
    if (tt && !SKIP_TRACK_TYPES[tt]) {
      var codec = tt.toUpperCase();
      var combined = codec + ' ' + audioStr;
      if (combined.length <= 12) return combined;
    }
  }

  return audioStr;
};

module.exports = Renderer;
