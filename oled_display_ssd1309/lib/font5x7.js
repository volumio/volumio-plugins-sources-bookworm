'use strict';

/**
 * 5x7 bitmap font with extended Unicode support.
 *
 * Base ASCII (32–126) in FONT_DATA array for fast lookup.
 * Extended characters (128–255) in EXTENDED map, generated from base
 * glyphs with accent modifiers.  Unicode beyond Latin-1 (Polish, Czech,
 * Slovak, Hungarian, Turkish) also in EXTENDED map.
 *
 * Font format: each glyph is an array of 5 bytes (one per column).
 * Each byte encodes 7 vertical pixels: bit 0 = top, bit 6 = bottom.
 */

var CHAR_WIDTH = 5;
var CHAR_HEIGHT = 7;
var CHAR_SPACING = 1;
var LINE_SPACING = 1;

// ─── Base ASCII glyphs: codes 32 (space) through 126 (~) ────────────────

var FONT_DATA = [
  [0x00, 0x00, 0x00, 0x00, 0x00], // 32  (space)
  [0x00, 0x00, 0x5F, 0x00, 0x00], // 33  !
  [0x00, 0x07, 0x00, 0x07, 0x00], // 34  "
  [0x14, 0x7F, 0x14, 0x7F, 0x14], // 35  #
  [0x24, 0x2A, 0x7F, 0x2A, 0x12], // 36  $
  [0x23, 0x13, 0x08, 0x64, 0x62], // 37  %
  [0x36, 0x49, 0x55, 0x22, 0x50], // 38  &
  [0x00, 0x05, 0x03, 0x00, 0x00], // 39  '
  [0x00, 0x1C, 0x22, 0x41, 0x00], // 40  (
  [0x00, 0x41, 0x22, 0x1C, 0x00], // 41  )
  [0x08, 0x2A, 0x1C, 0x2A, 0x08], // 42  *
  [0x08, 0x08, 0x3E, 0x08, 0x08], // 43  +
  [0x00, 0x50, 0x30, 0x00, 0x00], // 44  ,
  [0x08, 0x08, 0x08, 0x08, 0x08], // 45  -
  [0x00, 0x60, 0x60, 0x00, 0x00], // 46  .
  [0x20, 0x10, 0x08, 0x04, 0x02], // 47  /
  [0x3E, 0x51, 0x49, 0x45, 0x3E], // 48  0
  [0x00, 0x42, 0x7F, 0x40, 0x00], // 49  1
  [0x42, 0x61, 0x51, 0x49, 0x46], // 50  2
  [0x21, 0x41, 0x45, 0x4B, 0x31], // 51  3
  [0x18, 0x14, 0x12, 0x7F, 0x10], // 52  4
  [0x27, 0x45, 0x45, 0x45, 0x39], // 53  5
  [0x3C, 0x4A, 0x49, 0x49, 0x30], // 54  6
  [0x01, 0x71, 0x09, 0x05, 0x03], // 55  7
  [0x36, 0x49, 0x49, 0x49, 0x36], // 56  8
  [0x06, 0x49, 0x49, 0x29, 0x1E], // 57  9
  [0x00, 0x36, 0x36, 0x00, 0x00], // 58  :
  [0x00, 0x56, 0x36, 0x00, 0x00], // 59  ;
  [0x00, 0x08, 0x14, 0x22, 0x41], // 60  <
  [0x14, 0x14, 0x14, 0x14, 0x14], // 61  =
  [0x41, 0x22, 0x14, 0x08, 0x00], // 62  >
  [0x02, 0x01, 0x51, 0x09, 0x06], // 63  ?
  [0x32, 0x49, 0x79, 0x41, 0x3E], // 64  @
  [0x7E, 0x11, 0x11, 0x11, 0x7E], // 65  A
  [0x7F, 0x49, 0x49, 0x49, 0x36], // 66  B
  [0x3E, 0x41, 0x41, 0x41, 0x22], // 67  C
  [0x7F, 0x41, 0x41, 0x22, 0x1C], // 68  D
  [0x7F, 0x49, 0x49, 0x49, 0x41], // 69  E
  [0x7F, 0x09, 0x09, 0x01, 0x01], // 70  F
  [0x3E, 0x41, 0x41, 0x51, 0x32], // 71  G
  [0x7F, 0x08, 0x08, 0x08, 0x7F], // 72  H
  [0x00, 0x41, 0x7F, 0x41, 0x00], // 73  I
  [0x20, 0x40, 0x41, 0x3F, 0x01], // 74  J
  [0x7F, 0x08, 0x14, 0x22, 0x41], // 75  K
  [0x7F, 0x40, 0x40, 0x40, 0x40], // 76  L
  [0x7F, 0x02, 0x04, 0x02, 0x7F], // 77  M
  [0x7F, 0x04, 0x08, 0x10, 0x7F], // 78  N
  [0x3E, 0x41, 0x41, 0x41, 0x3E], // 79  O
  [0x7F, 0x09, 0x09, 0x09, 0x06], // 80  P
  [0x3E, 0x41, 0x51, 0x21, 0x5E], // 81  Q
  [0x7F, 0x09, 0x19, 0x29, 0x46], // 82  R
  [0x46, 0x49, 0x49, 0x49, 0x31], // 83  S
  [0x01, 0x01, 0x7F, 0x01, 0x01], // 84  T
  [0x3F, 0x40, 0x40, 0x40, 0x3F], // 85  U
  [0x1F, 0x20, 0x40, 0x20, 0x1F], // 86  V
  [0x7F, 0x20, 0x18, 0x20, 0x7F], // 87  W
  [0x63, 0x14, 0x08, 0x14, 0x63], // 88  X
  [0x03, 0x04, 0x78, 0x04, 0x03], // 89  Y
  [0x61, 0x51, 0x49, 0x45, 0x43], // 90  Z
  [0x00, 0x00, 0x7F, 0x41, 0x41], // 91  [
  [0x02, 0x04, 0x08, 0x10, 0x20], // 92  backslash
  [0x41, 0x41, 0x7F, 0x00, 0x00], // 93  ]
  [0x04, 0x02, 0x01, 0x02, 0x04], // 94  ^
  [0x40, 0x40, 0x40, 0x40, 0x40], // 95  _
  [0x00, 0x01, 0x02, 0x04, 0x00], // 96  `
  [0x20, 0x54, 0x54, 0x54, 0x78], // 97  a
  [0x7F, 0x48, 0x44, 0x44, 0x38], // 98  b
  [0x38, 0x44, 0x44, 0x44, 0x20], // 99  c
  [0x38, 0x44, 0x44, 0x48, 0x7F], // 100 d
  [0x38, 0x54, 0x54, 0x54, 0x18], // 101 e
  [0x08, 0x7E, 0x09, 0x01, 0x02], // 102 f
  [0x08, 0x14, 0x54, 0x54, 0x3C], // 103 g
  [0x7F, 0x08, 0x04, 0x04, 0x78], // 104 h
  [0x00, 0x44, 0x7D, 0x40, 0x00], // 105 i
  [0x20, 0x40, 0x44, 0x3D, 0x00], // 106 j
  [0x00, 0x7F, 0x10, 0x28, 0x44], // 107 k
  [0x00, 0x41, 0x7F, 0x40, 0x00], // 108 l
  [0x7C, 0x04, 0x18, 0x04, 0x78], // 109 m
  [0x7C, 0x08, 0x04, 0x04, 0x78], // 110 n
  [0x38, 0x44, 0x44, 0x44, 0x38], // 111 o
  [0x7C, 0x14, 0x14, 0x14, 0x08], // 112 p
  [0x08, 0x14, 0x14, 0x18, 0x7C], // 113 q
  [0x7C, 0x08, 0x04, 0x04, 0x08], // 114 r
  [0x48, 0x54, 0x54, 0x54, 0x20], // 115 s
  [0x04, 0x3F, 0x44, 0x40, 0x20], // 116 t
  [0x3C, 0x40, 0x40, 0x20, 0x7C], // 117 u
  [0x1C, 0x20, 0x40, 0x20, 0x1C], // 118 v
  [0x3C, 0x40, 0x30, 0x40, 0x3C], // 119 w
  [0x44, 0x28, 0x10, 0x28, 0x44], // 120 x
  [0x0C, 0x50, 0x50, 0x50, 0x3C], // 121 y
  [0x44, 0x64, 0x54, 0x4C, 0x44], // 122 z
  [0x00, 0x08, 0x36, 0x41, 0x00], // 123 {
  [0x00, 0x00, 0x7F, 0x00, 0x00], // 124 |
  [0x00, 0x41, 0x36, 0x08, 0x00], // 125 }
  [0x08, 0x04, 0x08, 0x10, 0x08]  // 126 ~
];


// ─── Extended Latin-1 Supplement (128–255) ───────────────────────────────

// Accent modifier masks.  Lowercase letters have rows 0-1 free for accents.
// Uppercase letters must be shifted down 1 row to make room.
var ACCENT = {
  grave:      [0x00, 0x01, 0x02, 0x00, 0x00],
  acute:      [0x00, 0x00, 0x02, 0x01, 0x00],
  circumflex: [0x00, 0x02, 0x01, 0x02, 0x00],
  umlaut:     [0x00, 0x01, 0x00, 0x01, 0x00],
  tilde:      [0x02, 0x01, 0x02, 0x01, 0x00],
  ring:       [0x00, 0x01, 0x02, 0x01, 0x00]
};

function accentLower(baseCode, accent) {
  var base = FONT_DATA[baseCode - 32];
  if (!base) return [0, 0, 0, 0, 0];
  return [base[0] | accent[0], base[1] | accent[1], base[2] | accent[2],
          base[3] | accent[3], base[4] | accent[4]];
}

var EXTENDED = {};

// ─── Uppercase accented: stripped to base letters ────────────────────────
// At 5x7 pixels, fitting an accent mark above an uppercase letter requires
// shifting the letter down by 1 row, which loses the bottom row and makes
// letters like Z unrecognizable.  Uppercase accented characters are mapped
// to their unaccented base letter instead.  Lowercase accented characters
// work well because they have 2 spare rows at the top for accent marks.
EXTENDED[192] = FONT_DATA[65 - 32];  // À → A
EXTENDED[193] = FONT_DATA[65 - 32];  // Á → A
EXTENDED[194] = FONT_DATA[65 - 32];  // Â → A
EXTENDED[195] = FONT_DATA[65 - 32];  // Ã → A
EXTENDED[196] = FONT_DATA[65 - 32];  // Ä → A
EXTENDED[197] = FONT_DATA[65 - 32];  // Å → A
EXTENDED[198] = [0x7E, 0x09, 0x7F, 0x49, 0x41];    // Æ (hand-designed, works)
EXTENDED[199] = [0x3E, 0x41, 0x41, 0x61, 0x22];    // Ç (hand-designed, works)
EXTENDED[200] = FONT_DATA[69 - 32];  // È → E
EXTENDED[201] = FONT_DATA[69 - 32];  // É → E
EXTENDED[202] = FONT_DATA[69 - 32];  // Ê → E
EXTENDED[203] = FONT_DATA[69 - 32];  // Ë → E
EXTENDED[204] = FONT_DATA[73 - 32];  // Ì → I
EXTENDED[205] = FONT_DATA[73 - 32];  // Í → I
EXTENDED[206] = FONT_DATA[73 - 32];  // Î → I
EXTENDED[207] = FONT_DATA[73 - 32];  // Ï → I
EXTENDED[208] = [0x7F, 0x49, 0x41, 0x22, 0x1C];    // Ð (hand-designed, works)
EXTENDED[209] = FONT_DATA[78 - 32];  // Ñ → N
EXTENDED[210] = FONT_DATA[79 - 32];  // Ò → O
EXTENDED[211] = FONT_DATA[79 - 32];  // Ó → O
EXTENDED[212] = FONT_DATA[79 - 32];  // Ô → O
EXTENDED[213] = FONT_DATA[79 - 32];  // Õ → O
EXTENDED[214] = FONT_DATA[79 - 32];  // Ö → O
EXTENDED[215] = [0x22, 0x14, 0x08, 0x14, 0x22];    // × (symbol, works)
EXTENDED[216] = [0x3E, 0x51, 0x49, 0x45, 0x3E];    // Ø (hand-designed, works)
EXTENDED[217] = FONT_DATA[85 - 32];  // Ù → U
EXTENDED[218] = FONT_DATA[85 - 32];  // Ú → U
EXTENDED[219] = FONT_DATA[85 - 32];  // Û → U
EXTENDED[220] = FONT_DATA[85 - 32];  // Ü → U
EXTENDED[221] = FONT_DATA[89 - 32];  // Ý → Y
EXTENDED[223] = [0x7E, 0x01, 0x49, 0x49, 0x36];    // ß (hand-designed, works)

// ─── Lowercase accented (marks above): these work well ───────────────────
// Lowercase letters have 2 spare rows at the top for accent marks.
EXTENDED[224] = accentLower(97, ACCENT.grave);      // à
EXTENDED[225] = accentLower(97, ACCENT.acute);      // á
EXTENDED[226] = accentLower(97, ACCENT.circumflex); // â
EXTENDED[227] = accentLower(97, ACCENT.tilde);      // ã
EXTENDED[228] = accentLower(97, ACCENT.umlaut);     // ä
EXTENDED[229] = accentLower(97, ACCENT.ring);       // å
EXTENDED[230] = [0x20, 0x54, 0x78, 0x54, 0x18];    // æ (hand-designed)
EXTENDED[231] = [0x38, 0x44, 0x44, 0x64, 0x20];    // ç (hand-designed, cedilla fits)
EXTENDED[232] = accentLower(101, ACCENT.grave);     // è
EXTENDED[233] = accentLower(101, ACCENT.acute);     // é
EXTENDED[234] = accentLower(101, ACCENT.circumflex);// ê
EXTENDED[235] = accentLower(101, ACCENT.umlaut);    // ë
EXTENDED[236] = accentLower(105, ACCENT.grave);     // ì
EXTENDED[237] = accentLower(105, ACCENT.acute);     // í
EXTENDED[238] = accentLower(105, ACCENT.circumflex);// î
EXTENDED[239] = accentLower(105, ACCENT.umlaut);    // ï
EXTENDED[241] = accentLower(110, ACCENT.tilde);     // ñ
EXTENDED[242] = accentLower(111, ACCENT.grave);     // ò
EXTENDED[243] = accentLower(111, ACCENT.acute);     // ó
EXTENDED[244] = accentLower(111, ACCENT.circumflex);// ô
EXTENDED[245] = accentLower(111, ACCENT.tilde);     // õ
EXTENDED[246] = accentLower(111, ACCENT.umlaut);    // ö
EXTENDED[247] = [0x08, 0x08, 0x2A, 0x08, 0x08];    // ÷
EXTENDED[248] = [0x38, 0x64, 0x54, 0x4C, 0x38];    // ø (hand-designed)
EXTENDED[249] = accentLower(117, ACCENT.grave);     // ù
EXTENDED[250] = accentLower(117, ACCENT.acute);     // ú
EXTENDED[251] = accentLower(117, ACCENT.circumflex);// û
EXTENDED[252] = accentLower(117, ACCENT.umlaut);    // ü
EXTENDED[253] = accentLower(121, ACCENT.acute);     // ý
EXTENDED[255] = accentLower(121, ACCENT.umlaut);    // ÿ

// Extra useful symbols
EXTENDED[161] = [0x00, 0x00, 0x7A, 0x00, 0x00];    // ¡
EXTENDED[169] = [0x3E, 0x41, 0x5D, 0x55, 0x3E];    // ©
EXTENDED[176] = [0x00, 0x06, 0x09, 0x06, 0x00];    // °
EXTENDED[191] = [0x30, 0x48, 0x45, 0x40, 0x20];    // ¿

// ─── Unicode beyond Latin-1: Central European characters ─────────────────
// Strategy: lowercase with marks ABOVE → keep (accentLower works)
//           lowercase with marks BELOW → strip to base (no room below baseline)
//           uppercase accented → strip to base (shift-down loses bottom row)
//           hand-designed specials → keep

// Polish
EXTENDED[0x0104] = FONT_DATA[65 - 32];              // Ą → A (uppercase stripped)
EXTENDED[0x0105] = FONT_DATA[97 - 32];              // ą → a (ogonek below baseline)
EXTENDED[0x0106] = FONT_DATA[67 - 32];              // Ć → C
EXTENDED[0x0107] = accentLower(99, ACCENT.acute);    // ć (mark above, works)
EXTENDED[0x0118] = FONT_DATA[69 - 32];              // Ę → E
EXTENDED[0x0119] = FONT_DATA[101 - 32];             // ę → e (ogonek below baseline)
EXTENDED[0x0141] = [0x7F, 0x48, 0x44, 0x40, 0x40]; // Ł (hand-designed, works)
EXTENDED[0x0142] = [0x00, 0x42, 0x7E, 0x48, 0x40]; // ł (hand-designed, works)
EXTENDED[0x0143] = FONT_DATA[78 - 32];              // Ń → N
EXTENDED[0x0144] = accentLower(110, ACCENT.acute);   // ń (mark above, works)
EXTENDED[0x015A] = FONT_DATA[83 - 32];              // Ś → S
EXTENDED[0x015B] = accentLower(115, ACCENT.acute);   // ś (mark above, works)
EXTENDED[0x0179] = FONT_DATA[90 - 32];              // Ź → Z
EXTENDED[0x017A] = accentLower(122, ACCENT.acute);   // ź (mark above, works)
EXTENDED[0x017B] = FONT_DATA[90 - 32];              // Ż → Z
EXTENDED[0x017C] = [0x42, 0x52, 0x4A, 0x46, 0x00]; // ż (hand-designed dot above, works)

// Czech / Slovak
EXTENDED[0x010C] = FONT_DATA[67 - 32];              // Č → C
EXTENDED[0x010D] = accentLower(99, ACCENT.circumflex); // č (mark above, works)
EXTENDED[0x010E] = FONT_DATA[68 - 32];              // Ď → D
EXTENDED[0x010F] = [0x38, 0x44, 0x44, 0x48, 0x7F]; // ď (hand-designed, works)
EXTENDED[0x011A] = FONT_DATA[69 - 32];              // Ě → E
EXTENDED[0x011B] = accentLower(101, ACCENT.circumflex);// ě (mark above, works)
EXTENDED[0x0147] = FONT_DATA[78 - 32];              // Ň → N
EXTENDED[0x0148] = accentLower(110, ACCENT.circumflex);// ň (mark above, works)
EXTENDED[0x0158] = FONT_DATA[82 - 32];              // Ř → R
EXTENDED[0x0159] = accentLower(114, ACCENT.circumflex);// ř (mark above, works)
EXTENDED[0x0160] = FONT_DATA[83 - 32];              // Š → S
EXTENDED[0x0161] = accentLower(115, ACCENT.circumflex);// š (mark above, works)
EXTENDED[0x0164] = FONT_DATA[84 - 32];              // Ť → T
EXTENDED[0x0165] = [0x04, 0x04, 0x7C, 0x0A, 0x04]; // ť (hand-designed, works)
EXTENDED[0x016E] = FONT_DATA[85 - 32];              // Ů → U
EXTENDED[0x016F] = accentLower(117, ACCENT.ring);      // ů (mark above, works)
EXTENDED[0x017D] = FONT_DATA[90 - 32];              // Ž → Z
EXTENDED[0x017E] = accentLower(122, ACCENT.circumflex);// ž (mark above, works)

// Hungarian
EXTENDED[0x0150] = FONT_DATA[79 - 32];              // Ő → O
EXTENDED[0x0151] = accentLower(111, [0x00, 0x02, 0x01, 0x02, 0x01]);// ő (mark above, works)
EXTENDED[0x0170] = FONT_DATA[85 - 32];              // Ű → U
EXTENDED[0x0171] = accentLower(117, [0x00, 0x02, 0x01, 0x02, 0x01]);// ű (mark above, works)

// Turkish
EXTENDED[0x011E] = FONT_DATA[71 - 32];              // Ğ → G
EXTENDED[0x011F] = accentLower(103, ACCENT.circumflex);// ğ (mark above, works)
EXTENDED[0x0130] = FONT_DATA[73 - 32];              // İ → I
EXTENDED[0x0131] = [0x00, 0x40, 0x7C, 0x40, 0x00]; // ı (dotless i, hand-designed)

// Placeholder for unmapped characters: small filled square
var PLACEHOLDER = [0x1C, 0x1C, 0x1C, 0x1C, 0x1C];


// ─── Glyph lookup ────────────────────────────────────────────────────────

/**
 * Get the 5-byte glyph for a Unicode code point.
 * Supports ASCII 32–126, Latin-1 Supplement 128–255,
 * and extended Unicode (Polish, Czech, Slovak, Hungarian, Turkish).
 * Returns a placeholder square for anything else.
 */
function getGlyph(charCode) {
  if (charCode >= 32 && charCode <= 126) {
    return FONT_DATA[charCode - 32];
  }
  if (EXTENDED[charCode]) {
    return EXTENDED[charCode];
  }
  return PLACEHOLDER;
}


// ─── Icons (8x8, row-major: each byte = one row, bit 7 = leftmost) ─────

var ICONS = {
  // Play: right-pointing triangle
  //   col: 76543210
  //   r0:  . . # . . . . .  = 0x20
  //   r1:  . . # # . . . .  = 0x30
  //   r2:  . . # # # . . .  = 0x38
  //   r3:  . . # # # # . .  = 0x3C
  //   r4:  . . # # # . . .  = 0x38
  //   r5:  . . # # . . . .  = 0x30
  //   r6:  . . # . . . . .  = 0x20
  //   r7:  . . . . . . . .  = 0x00
  play: [0x20, 0x30, 0x38, 0x3C, 0x38, 0x30, 0x20, 0x00],

  // Pause: two VERTICAL bars (Issue 3 fix)
  //   col: 76543210
  //   r0:  . # # . . # # .  = 0x66
  //   r1:  . # # . . # # .  = 0x66
  //   r2:  . # # . . # # .  = 0x66
  //   r3:  . # # . . # # .  = 0x66
  //   r4:  . # # . . # # .  = 0x66
  //   r5:  . # # . . # # .  = 0x66
  //   r6:  . # # . . # # .  = 0x66
  //   r7:  . . . . . . . .  = 0x00
  pause: [0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x00],

  // Stop: filled square
  stop: [0x00, 0x7E, 0x7E, 0x7E, 0x7E, 0x7E, 0x00, 0x00],

  // Speaker
  volume: [0x00, 0x0C, 0x1E, 0x7E, 0x7E, 0x1E, 0x0C, 0x00],

  // Musical note
  note: [0x04, 0x06, 0x07, 0x04, 0x04, 0x3C, 0x3C, 0x00]
};


// ─── Large clock digits (12w × 20h, natively designed for smooth curves) ─

var LARGE_CHAR_WIDTH = 12;
var LARGE_CHAR_HEIGHT = 20;
var LARGE_COLON_WIDTH = 4;
var LARGE_CHAR_SPACING = 3;

/**
 * Parse a visual glyph definition (array of row strings) into
 * column-major format.  '#' = pixel on, anything else = off.
 * Each column value is an integer with bit 0 = top row.
 */
function _parseLargeGlyph(rows) {
  var width = rows[0].length;
  var cols = new Array(width);
  for (var c = 0; c < width; c++) {
    var val = 0;
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].charAt(c) === '#') {
        val |= (1 << r);
      }
    }
    cols[c] = val;
  }
  return cols;
}

var LARGE_DIGITS = [
  // 0
  _parseLargeGlyph([
    '....####....',
    '..########..',
    '.###....###.',
    '.##......##.',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '.##......##.',
    '.###....###.',
    '..########..',
    '....####....'
  ]),
  // 1
  _parseLargeGlyph([
    '.....##.....',
    '....###.....',
    '...####.....',
    '..##.##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '..########..',
    '..########..'
  ]),
  // 2
  _parseLargeGlyph([
    '....####....',
    '..########..',
    '.###....###.',
    '.##......##.',
    '..........##',
    '..........##',
    '.........##.',
    '........##..',
    '.......##...',
    '......##....',
    '.....##.....',
    '....##......',
    '...##.......',
    '..##........',
    '.##.........',
    '##..........',
    '##..........',
    '##..........',
    '############',
    '############'
  ]),
  // 3
  _parseLargeGlyph([
    '....####....',
    '..########..',
    '.###....###.',
    '.##......##.',
    '..........##',
    '..........##',
    '..........##',
    '..........##',
    '.........##.',
    '...######...',
    '...######...',
    '.........##.',
    '..........##',
    '..........##',
    '..........##',
    '..........##',
    '.##......##.',
    '.###....###.',
    '..########..',
    '....####....'
  ]),
  // 4
  _parseLargeGlyph([
    '.......###..',
    '......####..',
    '.....##.##..',
    '....##..##..',
    '...##...##..',
    '..##....##..',
    '.##.....##..',
    '##......##..',
    '##......##..',
    '##......##..',
    '############',
    '############',
    '........##..',
    '........##..',
    '........##..',
    '........##..',
    '........##..',
    '........##..',
    '........##..',
    '........##..'
  ]),
  // 5
  _parseLargeGlyph([
    '.##########.',
    '.##########.',
    '.##.........',
    '.##.........',
    '.##.........',
    '.##.........',
    '.########...',
    '.#########..',
    '.###....###.',
    '..........##',
    '..........##',
    '..........##',
    '..........##',
    '..........##',
    '..........##',
    '..........##',
    '.##......##.',
    '.###....###.',
    '..########..',
    '....####....'
  ]),
  // 6
  _parseLargeGlyph([
    '....####....',
    '..########..',
    '.###....###.',
    '.##......##.',
    '##..........',
    '##..........',
    '##..........',
    '##..........',
    '##..####....',
    '##########..',
    '###.....###.',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '.##......##.',
    '.###....###.',
    '..########..',
    '....####....'
  ]),
  // 7
  _parseLargeGlyph([
    '############',
    '############',
    '..........##',
    '..........##',
    '.........##.',
    '.........##.',
    '........##..',
    '........##..',
    '.......##...',
    '.......##...',
    '......##....',
    '......##....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....'
  ]),
  // 8
  _parseLargeGlyph([
    '....####....',
    '..########..',
    '.###....###.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.###....###.',
    '..########..',
    '...######...',
    '..########..',
    '.###....###.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '.###....###.',
    '..########..',
    '....####....'
  ]),
  // 9
  _parseLargeGlyph([
    '....####....',
    '..########..',
    '.###....###.',
    '.##......##.',
    '##........##',
    '##........##',
    '##........##',
    '##........##',
    '.###.....###',
    '..##########',
    '....####..##',
    '..........##',
    '..........##',
    '..........##',
    '..........##',
    '..........##',
    '.##......##.',
    '.###....###.',
    '..########..',
    '....####....'
  ])
];

var LARGE_COLON = _parseLargeGlyph([
  '....',
  '....',
  '....',
  '....',
  '....',
  '.##.',
  '####',
  '####',
  '.##.',
  '....',
  '....',
  '.##.',
  '####',
  '####',
  '.##.',
  '....',
  '....',
  '....',
  '....',
  '....'
]);


module.exports = {
  FONT_DATA: FONT_DATA,
  CHAR_WIDTH: CHAR_WIDTH,
  CHAR_HEIGHT: CHAR_HEIGHT,
  CHAR_SPACING: CHAR_SPACING,
  LINE_SPACING: LINE_SPACING,
  ICONS: ICONS,
  getGlyph: getGlyph,
  LARGE_DIGITS: LARGE_DIGITS,
  LARGE_COLON: LARGE_COLON,
  LARGE_CHAR_WIDTH: LARGE_CHAR_WIDTH,
  LARGE_CHAR_HEIGHT: LARGE_CHAR_HEIGHT,
  LARGE_COLON_WIDTH: LARGE_COLON_WIDTH,
  LARGE_CHAR_SPACING: LARGE_CHAR_SPACING
};
