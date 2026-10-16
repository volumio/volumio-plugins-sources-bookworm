'use strict';

// A picture a user hands the player as a station's logo: what it is, how large it is,
// and whether it can be used.
//
// The Station Manager prepares a picture before it sends it (fits it into a square,
// scales it down), but the player is reached by other means too and takes nothing on
// trust: the kind is read from the picture's own first bytes, not from its name; the
// dimensions from its header.
//
// An SVG picture is a text that can carry script. Shown as a picture it never runs;
// opened by itself on the player's address it would. One that holds script, event
// handlers, embedded documents or references to anything outside itself is refused.

// The largest picture taken, and the largest SVG text
var MAX_BYTES = 2 * 1024 * 1024;
var MAX_SVG_BYTES = 512 * 1024;

// A picture smaller than this on either side cannot look sharp on a screen
var MIN_SIDE = 128;
var MAX_SIDE = 4096;

// The kind of picture a buffer holds: 'png', 'jpg', 'svg', or null
function kind(body) {
  if (!Buffer.isBuffer(body) || body.length < 8) {
    return null;
  }
  if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) {
    return 'png';
  }
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return 'jpg';
  }
  // An SVG: text whose first element, after what may stand before it, is <svg
  var head = body.slice(0, 4096).toString('utf8').replace(/^﻿/, '');
  head = head.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^\[>]*(\[[\s\S]*?\])?\s*>/gi, '');
  return /^\s*<svg[\s>]/i.test(head) ? 'svg' : null;
}

// The dimensions of a PNG or JPEG picture: { width, height }, or null when its header
// cannot be read
function size(body, what) {
  if (what === 'png') {
    // The first chunk is the header: width and height, four bytes each
    if (body.length < 24 || body.toString('latin1', 12, 16) !== 'IHDR') {
      return null;
    }
    return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
  }
  if (what === 'jpg') {
    var at = 2;
    while (at + 9 < body.length) {
      if (body[at] !== 0xff) {
        return null;
      }
      var marker = body[at + 1];
      if (marker === 0xff) {          // padding
        at++;
        continue;
      }
      // The frame header: any start-of-frame marker but the three that are no frames
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: body.readUInt16BE(at + 7), height: body.readUInt16BE(at + 5) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2;                      // markers that stand alone
        continue;
      }
      at += 2 + body.readUInt16BE(at + 2);
    }
    return null;
  }
  return null;
}

// What an SVG holds that it may not: 'script', 'outside', 'entity', or null when it
// can be used
function svgProblem(text) {
  if (/<!ENTITY/i.test(text)) {
    return 'entity';
  }
  if (/<\s*(script|foreignObject|iframe|embed|object|audio|video)\b/i.test(text) ||
      /<[^>]*\son[a-z]+\s*=/i.test(text) || /javascript\s*:/i.test(text)) {
    return 'script';
  }
  // A reference may point into the picture itself (#name) or hold a picture (data:image/...)
  var references = text.match(/\b(?:xlink:href|href|src)\s*=\s*(?:"[^"]*"|'[^']*')/gi) || [];
  var outside = references.some(function(reference) {
    var value = reference.replace(/^[^=]*=\s*["']/, '').replace(/["']$/, '').trim();
    return !(value === '' || value[0] === '#' || /^data:image\/(png|jpe?g|gif|webp);/i.test(value));
  });
  // The same for what a style points to
  var targets = text.match(/url\(\s*["']?[^"')]*/gi) || [];
  outside = outside || targets.some(function(target) {
    var value = target.replace(/^url\(\s*["']?/i, '').trim();
    return !(value[0] === '#' || /^data:image\/(png|jpe?g|gif|webp);/i.test(value));
  });
  if (outside || /@import/i.test(text)) {
    return 'outside';
  }
  return null;
}

// Whether a picture can be a station's logo.
// Returns { ok: true, kind, extension, width, height } (width and height null for an
// SVG), or { ok: false, reason, ... } with reason one of
//   'not-a-picture'   neither PNG, JPEG nor SVG
//   'too-large'       more bytes than taken (limit: the limit in bytes)
//   'too-small'       fewer pixels than look sharp (width, height, least)
//   'too-many'        more pixels than any screen needs (width, height, most)
//   'unsafe'          an SVG holding script or references outside itself (what)
function check(body) {
  var what = kind(body);
  if (!what) {
    return { ok: false, reason: 'not-a-picture' };
  }
  var limit = what === 'svg' ? MAX_SVG_BYTES : MAX_BYTES;
  if (body.length > limit) {
    return { ok: false, reason: 'too-large', limit: limit };
  }
  if (what === 'svg') {
    var problem = svgProblem(body.toString('utf8'));
    return problem ? { ok: false, reason: 'unsafe', what: problem } :
      { ok: true, kind: 'svg', extension: 'svg', width: null, height: null };
  }
  var dimensions = size(body, what);
  if (!dimensions || !dimensions.width || !dimensions.height) {
    return { ok: false, reason: 'not-a-picture' };
  }
  if (dimensions.width < MIN_SIDE || dimensions.height < MIN_SIDE) {
    return { ok: false, reason: 'too-small', width: dimensions.width, height: dimensions.height, least: MIN_SIDE };
  }
  if (dimensions.width > MAX_SIDE || dimensions.height > MAX_SIDE) {
    return { ok: false, reason: 'too-many', width: dimensions.width, height: dimensions.height, most: MAX_SIDE };
  }
  return { ok: true, kind: what, extension: what, width: dimensions.width, height: dimensions.height };
}

module.exports = {
  kind: kind,
  size: size,
  svgProblem: svgProblem,
  check: check,
  MAX_BYTES: MAX_BYTES,
  MAX_SVG_BYTES: MAX_SVG_BYTES,
  MIN_SIDE: MIN_SIDE
};
