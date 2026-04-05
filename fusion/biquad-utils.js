'use strict';

// ========== Biquad coefficient computation ==========

function computeBiquadCoeffs(type, params, sampleRate) {
  var w0, alpha, A, cosw0, sinw0, b0, b1, b2, a0, a1, a2;
  var freq, gain, Q, bandwidth, slope, order;

  switch (type) {
    case 'Peaking':
      freq = params[0]; gain = params[1]; Q = params[2];
      A = Math.pow(10, gain / 40);
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * Q);
      b0 = 1 + alpha * A; b1 = -2 * cosw0; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cosw0; a2 = 1 - alpha / A;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'Peaking2':
      freq = params[0]; gain = params[1]; bandwidth = params[2];
      A = Math.pow(10, gain / 40);
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 * Math.sinh(Math.log(2) / 2 * bandwidth * w0 / sinw0);
      b0 = 1 + alpha * A; b1 = -2 * cosw0; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cosw0; a2 = 1 - alpha / A;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'Lowshelf':
      freq = params[0]; gain = params[1]; slope = params[2];
      A = Math.pow(10, gain / 40);
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / 2 * Math.sqrt((A + 1/A) * (1/(slope / 12) - 1) + 2);
      var sqA = Math.sqrt(A);
      b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * sqA * alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
      b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * sqA * alpha);
      a0 = (A + 1) + (A - 1) * cosw0 + 2 * sqA * alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosw0);
      a2 = (A + 1) + (A - 1) * cosw0 - 2 * sqA * alpha;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'Lowshelf2':
      freq = params[0]; gain = params[1]; Q = params[2];
      A = Math.pow(10, gain / 40);
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * Q);
      sqA = Math.sqrt(A);
      b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * sqA * alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
      b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * sqA * alpha);
      a0 = (A + 1) + (A - 1) * cosw0 + 2 * sqA * alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosw0);
      a2 = (A + 1) + (A - 1) * cosw0 - 2 * sqA * alpha;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'Highshelf':
      freq = params[0]; gain = params[1]; slope = params[2];
      A = Math.pow(10, gain / 40);
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / 2 * Math.sqrt((A + 1/A) * (1/(slope / 12) - 1) + 2);
      sqA = Math.sqrt(A);
      b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * sqA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
      b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * sqA * alpha);
      a0 = (A + 1) - (A - 1) * cosw0 + 2 * sqA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosw0);
      a2 = (A + 1) - (A - 1) * cosw0 - 2 * sqA * alpha;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'Highshelf2':
      freq = params[0]; gain = params[1]; Q = params[2];
      A = Math.pow(10, gain / 40);
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * Q);
      sqA = Math.sqrt(A);
      b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * sqA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
      b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * sqA * alpha);
      a0 = (A + 1) - (A - 1) * cosw0 + 2 * sqA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosw0);
      a2 = (A + 1) - (A - 1) * cosw0 - 2 * sqA * alpha;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'LowshelfFO':
      freq = params[0]; gain = params[1];
      A = Math.pow(10, gain / 20);
      var wc = 2 * Math.PI * freq;
      var fs2 = sampleRate;
      var sqrtA = Math.sqrt(A);
      var wp = 2 * fs2 * Math.tan(wc / (2 * fs2));
      var bn = 2 * fs2 + wp * sqrtA;
      var bn1 = wp * sqrtA - 2 * fs2;
      var an = 2 * fs2 + wp / sqrtA;
      var an1 = wp / sqrtA - 2 * fs2;
      return [{ b0: bn / an, b1: bn1 / an, b2: 0, a1: an1 / an, a2: 0 }];

    case 'HighshelfFO':
      freq = params[0]; gain = params[1];
      A = Math.pow(10, gain / 20);
      sqrtA = Math.sqrt(A);
      wp = 2 * sampleRate * Math.tan(Math.PI * freq / sampleRate);
      var b0n = A * (2 * sampleRate + wp / sqrtA);
      var b1n = A * (wp / sqrtA - 2 * sampleRate);
      var a0n = 2 * sampleRate + wp * sqrtA;
      var a1n = wp * sqrtA - 2 * sampleRate;
      return [{ b0: b0n / a0n, b1: b1n / a0n, b2: 0, a1: a1n / a0n, a2: 0 }];

    case 'Lowpass':
      freq = params[0]; Q = params[1];
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * Q);
      b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = (1 - cosw0) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'Highpass':
      freq = params[0]; Q = params[1];
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * Q);
      b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = (1 + cosw0) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'LowpassFO':
      freq = params[0];
      w0 = 2 * Math.PI * freq / sampleRate;
      var k = Math.tan(w0 / 2);
      return [{ b0: k / (k + 1), b1: k / (k + 1), b2: 0, a1: (k - 1) / (k + 1), a2: 0 }];

    case 'HighpassFO':
      freq = params[0];
      w0 = 2 * Math.PI * freq / sampleRate;
      k = Math.tan(w0 / 2);
      return [{ b0: 1 / (k + 1), b1: -1 / (k + 1), b2: 0, a1: (k - 1) / (k + 1), a2: 0 }];

    case 'Notch':
      freq = params[0]; Q = params[1];
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * Q);
      b0 = 1; b1 = -2 * cosw0; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'Notch2':
      freq = params[0]; bandwidth = params[1];
      w0 = 2 * Math.PI * freq / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 * Math.sinh(Math.log(2) / 2 * bandwidth * w0 / sinw0);
      b0 = 1; b1 = -2 * cosw0; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      return [{ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 }];

    case 'LinkwitzTransform':
      var Fa = params[0], Qa = params[1], Ft = params[2], Qt = params[3];
      w0 = 2 * Math.PI * Fa / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * Qa);
      var a0a = 1 + alpha, a1a = -2 * cosw0, a2a = 1 - alpha;
      w0 = 2 * Math.PI * Ft / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * Qt);
      var a0t = 1 + alpha, a1t = -2 * cosw0, a2t = 1 - alpha;
      return [{ b0: a0a/a0t, b1: a1a/a0t, b2: a2a/a0t, a1: a1t/a0t, a2: a2t/a0t }];

    case 'ButterworthHighpass':
      freq = params[0]; order = Math.round(params[1]);
      return butterworthBiquads(freq, order, 'highpass', sampleRate);

    case 'ButterworthLowpass':
      freq = params[0]; order = Math.round(params[1]);
      return butterworthBiquads(freq, order, 'lowpass', sampleRate);

    case 'Tilt':
      gain = params[0];
      var tiltQ = 0.35;
      var halfGainLow = -gain / 2;
      A = Math.pow(10, halfGainLow / 40);
      w0 = 2 * Math.PI * 110 / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * tiltQ);
      sqA = Math.sqrt(A);
      b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * sqA * alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
      b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * sqA * alpha);
      a0 = (A + 1) + (A - 1) * cosw0 + 2 * sqA * alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosw0);
      a2 = (A + 1) + (A - 1) * cosw0 - 2 * sqA * alpha;
      var lowSection = { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 };
      var halfGainHigh = gain / 2;
      A = Math.pow(10, halfGainHigh / 40);
      w0 = 2 * Math.PI * 3500 / sampleRate;
      sinw0 = Math.sin(w0); cosw0 = Math.cos(w0);
      alpha = sinw0 / (2 * tiltQ);
      sqA = Math.sqrt(A);
      b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * sqA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
      b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * sqA * alpha);
      a0 = (A + 1) - (A - 1) * cosw0 + 2 * sqA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosw0);
      a2 = (A + 1) - (A - 1) * cosw0 - 2 * sqA * alpha;
      var highSection = { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 };
      return [lowSection, highSection];

    default:
      return [];
  }
}

function butterworthBiquads(freq, order, type, sampleRate) {
  var sections = [];
  var nSections = Math.floor(order / 2);
  for (var i = 0; i < nSections; i++) {
    var Q = 1 / (2 * Math.cos(Math.PI * (2 * i + 1) / (2 * order)));
    var w0 = 2 * Math.PI * freq / sampleRate;
    var sinw0 = Math.sin(w0), cosw0 = Math.cos(w0);
    var alpha = sinw0 / (2 * Q);
    var b0, b1, b2;
    if (type === 'lowpass') {
      b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = (1 - cosw0) / 2;
    } else {
      b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = (1 + cosw0) / 2;
    }
    var a0 = 1 + alpha, a1 = -2 * cosw0, a2 = 1 - alpha;
    sections.push({ b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 });
  }
  if (order % 2 === 1) {
    var k = Math.tan(Math.PI * freq / sampleRate);
    if (type === 'lowpass') {
      sections.push({ b0: k/(k+1), b1: k/(k+1), b2: 0, a1: (k-1)/(k+1), a2: 0 });
    } else {
      sections.push({ b0: 1/(k+1), b1: -1/(k+1), b2: 0, a1: (k-1)/(k+1), a2: 0 });
    }
  }
  return sections;
}

// ========== Transfer function evaluation ==========

function evalBiquadMagnitudeDb(biquads, freq, sampleRate) {
  var w = 2 * Math.PI * freq / sampleRate;
  var cosw = Math.cos(w), cos2w = Math.cos(2 * w);
  var sinw = Math.sin(w), sin2w = Math.sin(2 * w);
  var totalMagSq = 1;
  for (var i = 0; i < biquads.length; i++) {
    var c = biquads[i];
    var numRe = c.b0 + c.b1 * cosw + c.b2 * cos2w;
    var numIm = -(c.b1 * sinw + c.b2 * sin2w);
    var denRe = 1 + c.a1 * cosw + c.a2 * cos2w;
    var denIm = -(c.a1 * sinw + c.a2 * sin2w);
    var numMagSq = numRe * numRe + numIm * numIm;
    var denMagSq = denRe * denRe + denIm * denIm;
    if (denMagSq === 0) denMagSq = 1e-20;
    totalMagSq *= numMagSq / denMagSq;
  }
  return 10 * Math.log10(totalMagSq);
}

// ========== Combined peak computation ==========

/**
 * Compute the peak combined gain (in dB) from the mergedeq string.
 * Evaluates the combined frequency response for L and R channels separately
 * at 200 log-spaced points from 20Hz-20kHz, returns the overall maximum.
 */
function computePeakCombinedGain(mergedeq, sampleRate) {
  if (!mergedeq) return 0;
  sampleRate = sampleRate || 44100;

  // Parse filters from mergedeq
  var parts = mergedeq.toString().split('|');
  var filters = [];
  for (var i = 0; i + 3 < parts.length; i += 4) {
    var type = parts[i + 1];
    var scope = parts[i + 2];
    var paramStr = parts[i + 3];
    if (!type || type === 'None' || type === 'undefined') continue;
    var params = paramStr.split(',').map(Number);
    var biquads = computeBiquadCoeffs(type, params, sampleRate);
    if (biquads.length === 0) continue;
    filters.push({ scope: scope, biquads: biquads });
  }

  if (filters.length === 0) return 0;

  // Generate 200 log-spaced frequency points from 20Hz to 20kHz
  var numPoints = 200;
  var logMin = Math.log10(20), logMax = Math.log10(20000);
  var peakL = 0, peakR = 0;

  for (var j = 0; j < numPoints; j++) {
    var freq = Math.pow(10, logMin + (logMax - logMin) * j / (numPoints - 1));
    var totalL = 0, totalR = 0;
    for (var fi = 0; fi < filters.length; fi++) {
      var f = filters[fi];
      var db = evalBiquadMagnitudeDb(f.biquads, freq, sampleRate);
      if (f.scope === 'L' || f.scope === 'L+R') totalL += db;
      if (f.scope === 'R' || f.scope === 'L+R') totalR += db;
    }
    if (totalL > peakL) peakL = totalL;
    if (totalR > peakR) peakR = totalR;
  }

  return Math.max(peakL, peakR);
}

module.exports = {
  computeBiquadCoeffs,
  butterworthBiquads,
  evalBiquadMagnitudeDb,
  computePeakCombinedGain
};
