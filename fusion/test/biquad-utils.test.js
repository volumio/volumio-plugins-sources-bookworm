'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeBiquadCoeffs,
  butterworthBiquads,
  evalBiquadMagnitudeDb,
  computePeakCombinedGain
} = require('../biquad-utils');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Evaluate a single filter type at a given frequency, returning dB. */
function evalFilter(type, params, freq, sampleRate) {
  var biquads = computeBiquadCoeffs(type, params, sampleRate || 44100);
  return evalBiquadMagnitudeDb(biquads, freq, sampleRate || 44100);
}

/** Build a mergedeq string from an array of { label, type, scope, params } objects. */
function buildMergedeq(filters) {
  return filters.map(function (f) {
    return (f.label || 'Eq1') + '|' + f.type + '|' + f.scope + '|' + f.params.join(',');
  }).join('|');
}

// ---------------------------------------------------------------------------
// computeBiquadCoeffs
// ---------------------------------------------------------------------------

describe('computeBiquadCoeffs', function () {
  it('returns empty array for unknown filter type', function () {
    var result = computeBiquadCoeffs('UnknownType', [1000, 6, 1], 44100);
    assert.deepStrictEqual(result, []);
  });

  it('returns one biquad section for Peaking', function () {
    var result = computeBiquadCoeffs('Peaking', [1000, 6, 1.41], 44100);
    assert.strictEqual(result.length, 1);
    assert.ok(typeof result[0].b0 === 'number');
    assert.ok(typeof result[0].a1 === 'number');
  });

  it('returns two biquad sections for Tilt', function () {
    var result = computeBiquadCoeffs('Tilt', [6], 44100);
    assert.strictEqual(result.length, 2);
  });

  it('returns correct number of sections for ButterworthHighpass order 4', function () {
    var result = computeBiquadCoeffs('ButterworthHighpass', [100, 4], 44100);
    assert.strictEqual(result.length, 2); // order 4 = 2 biquad sections
  });

  it('returns correct number of sections for ButterworthLowpass order 5', function () {
    var result = computeBiquadCoeffs('ButterworthLowpass', [5000, 5], 44100);
    assert.strictEqual(result.length, 3); // order 5 = 2 biquad sections + 1 first-order
  });

  it('returns one section for first-order filters', function () {
    var fo = ['LowpassFO', 'HighpassFO', 'LowshelfFO', 'HighshelfFO'];
    fo.forEach(function (type) {
      var params = type.includes('shelf') ? [1000, 6] : [1000];
      var result = computeBiquadCoeffs(type, params, 44100);
      assert.strictEqual(result.length, 1, type + ' should return 1 section');
      // First-order: b2 and a2 should be 0
      assert.strictEqual(result[0].b2, 0, type + ' b2 should be 0');
      assert.strictEqual(result[0].a2, 0, type + ' a2 should be 0');
    });
  });
});

// ---------------------------------------------------------------------------
// evalBiquadMagnitudeDb - Peaking filter
// ---------------------------------------------------------------------------

describe('evalBiquadMagnitudeDb – Peaking', function () {
  it('peak at center frequency approximates the gain', function () {
    // A Peaking filter with Q=1 at 1kHz with +8dB gain
    var db = evalFilter('Peaking', [1000, 8, 1], 1000);
    // At center frequency, gain should be very close to 8dB
    assert.ok(Math.abs(db - 8) < 0.1, 'Expected ~8dB at 1kHz, got ' + db.toFixed(3));
  });

  it('approaches 0dB far from center', function () {
    var db = evalFilter('Peaking', [1000, 8, 1], 20);
    assert.ok(Math.abs(db) < 1, 'Expected ~0dB at 20Hz, got ' + db.toFixed(3));
  });

  it('zero-gain Peaking is 0dB everywhere', function () {
    [20, 100, 1000, 5000, 20000].forEach(function (freq) {
      var db = evalFilter('Peaking', [1000, 0, 1.41], freq);
      assert.ok(Math.abs(db) < 0.001, 'Expected 0dB at ' + freq + 'Hz, got ' + db.toFixed(6));
    });
  });

  it('negative gain produces a dip at center frequency', function () {
    var db = evalFilter('Peaking', [2000, -6, 2], 2000);
    assert.ok(Math.abs(db - (-6)) < 0.1, 'Expected ~-6dB at 2kHz, got ' + db.toFixed(3));
  });
});

// ---------------------------------------------------------------------------
// evalBiquadMagnitudeDb - Shelving filters
// ---------------------------------------------------------------------------

describe('evalBiquadMagnitudeDb – Shelving', function () {
  it('Lowshelf boosts low frequencies', function () {
    var dbLow = evalFilter('Lowshelf', [300, 6, 6], 30);
    var dbHigh = evalFilter('Lowshelf', [300, 6, 6], 10000);
    assert.ok(dbLow > 4, 'Expected significant boost at 30Hz, got ' + dbLow.toFixed(3));
    assert.ok(Math.abs(dbHigh) < 1, 'Expected ~0dB at 10kHz, got ' + dbHigh.toFixed(3));
  });

  it('Highshelf boosts high frequencies', function () {
    var dbLow = evalFilter('Highshelf', [3000, 6, 6], 30);
    var dbHigh = evalFilter('Highshelf', [3000, 6, 6], 15000);
    assert.ok(Math.abs(dbLow) < 1, 'Expected ~0dB at 30Hz, got ' + dbLow.toFixed(3));
    assert.ok(dbHigh > 4, 'Expected significant boost at 15kHz, got ' + dbHigh.toFixed(3));
  });
});

// ---------------------------------------------------------------------------
// evalBiquadMagnitudeDb - Cut filters (Lowpass, Highpass, Notch)
// ---------------------------------------------------------------------------

describe('evalBiquadMagnitudeDb – Cut filters', function () {
  it('Lowpass: 0dB in passband, deep cut in stopband', function () {
    var dbPass = evalFilter('Lowpass', [1000, 0.707], 100);
    var dbStop = evalFilter('Lowpass', [1000, 0.707], 10000);
    assert.ok(Math.abs(dbPass) < 1, 'Expected ~0dB at 100Hz, got ' + dbPass.toFixed(3));
    assert.ok(dbStop < -20, 'Expected deep cut at 10kHz, got ' + dbStop.toFixed(3));
  });

  it('Highpass: deep cut in stopband, 0dB in passband', function () {
    var dbStop = evalFilter('Highpass', [1000, 0.707], 100);
    var dbPass = evalFilter('Highpass', [1000, 0.707], 10000);
    assert.ok(dbStop < -20, 'Expected deep cut at 100Hz, got ' + dbStop.toFixed(3));
    assert.ok(Math.abs(dbPass) < 1, 'Expected ~0dB at 10kHz, got ' + dbPass.toFixed(3));
  });

  it('Notch: deep null at center, 0dB away', function () {
    var dbCenter = evalFilter('Notch', [1000, 2], 1000);
    var dbAway = evalFilter('Notch', [1000, 2], 5000);
    assert.ok(dbCenter < -30, 'Expected deep null at 1kHz, got ' + dbCenter.toFixed(3));
    assert.ok(Math.abs(dbAway) < 1, 'Expected ~0dB at 5kHz, got ' + dbAway.toFixed(3));
  });
});

// ---------------------------------------------------------------------------
// Butterworth filters
// ---------------------------------------------------------------------------

describe('butterworthBiquads', function () {
  it('Butterworth lowpass order 2: -3dB at cutoff', function () {
    var bq = butterworthBiquads(1000, 2, 'lowpass', 44100);
    var dbAtCutoff = evalBiquadMagnitudeDb(bq, 1000, 44100);
    assert.ok(Math.abs(dbAtCutoff - (-3)) < 0.5, 'Expected ~-3dB at cutoff, got ' + dbAtCutoff.toFixed(3));
  });

  it('Butterworth highpass order 4: steep rolloff below cutoff', function () {
    var bq = butterworthBiquads(1000, 4, 'highpass', 44100);
    var dbOctBelow = evalBiquadMagnitudeDb(bq, 500, 44100);
    // 4th-order = 24dB/octave, so 1 octave below should be roughly -24dB
    assert.ok(dbOctBelow < -20, 'Expected steep rolloff 1 octave below cutoff, got ' + dbOctBelow.toFixed(3));
  });

  it('Butterworth odd-order includes first-order section', function () {
    var bq = butterworthBiquads(1000, 3, 'lowpass', 44100);
    assert.strictEqual(bq.length, 2); // 1 biquad + 1 first-order
    // The first-order section should have b2=0, a2=0
    assert.strictEqual(bq[1].b2, 0);
    assert.strictEqual(bq[1].a2, 0);
  });
});

// ---------------------------------------------------------------------------
// computePeakCombinedGain – basic cases
// ---------------------------------------------------------------------------

describe('computePeakCombinedGain – basic', function () {
  it('returns 0 for null/undefined/empty mergedeq', function () {
    assert.strictEqual(computePeakCombinedGain(null, 44100), 0);
    assert.strictEqual(computePeakCombinedGain(undefined, 44100), 0);
    assert.strictEqual(computePeakCombinedGain('', 44100), 0);
  });

  it('returns 0 for all-None filters', function () {
    var meq = 'Eq1|None|L+R|0,0,0|Eq2|None|L+R|0,0,0';
    assert.strictEqual(computePeakCombinedGain(meq, 44100), 0);
  });

  it('single Peaking filter: peak ≈ gain', function () {
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [1000, 8, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(Math.abs(peak - 8) < 0.5, 'Expected ~8dB peak, got ' + peak.toFixed(3));
  });

  it('single cut-only filter (Notch): peak = 0 (no boost)', function () {
    var meq = buildMergedeq([
      { type: 'Notch', scope: 'L+R', params: [1000, 2] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(peak < 0.1, 'Expected ~0dB peak for notch, got ' + peak.toFixed(3));
  });

  it('Lowpass filter alone: peak = 0 (passband is 0dB)', function () {
    var meq = buildMergedeq([
      { type: 'Lowpass', scope: 'L+R', params: [5000, 0.707] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(peak < 0.5, 'Expected ~0dB peak for lowpass, got ' + peak.toFixed(3));
  });
});

// ---------------------------------------------------------------------------
// computePeakCombinedGain – overlapping filters (KEY: proves old algo wrong)
// ---------------------------------------------------------------------------

describe('computePeakCombinedGain – overlapping filters', function () {
  it('two overlapping Peaking filters: combined peak > individual max', function () {
    // Two +8dB Peaking at 1kHz → combined peak should be ~16dB, not 8dB
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [1000, 8, 1] },
      { type: 'Peaking', scope: 'L+R', params: [1000, 8, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(peak > 14, 'Expected combined peak > 14dB, got ' + peak.toFixed(3));
    assert.ok(peak < 18, 'Expected combined peak < 18dB, got ' + peak.toFixed(3));
  });

  it('three adjacent EQ15-style bands: combined peak exceeds individual', function () {
    // Three adjacent +10dB bands at 630Hz, 1kHz, 1.6kHz with Q≈2.15
    // These overlap, so combined peak should exceed 10dB
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [630, 10, 2.15] },
      { type: 'Peaking', scope: 'L+R', params: [1000, 10, 2.15] },
      { type: 'Peaking', scope: 'L+R', params: [1600, 10, 2.15] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(peak > 12, 'Expected combined peak > 12dB with overlapping bands, got ' + peak.toFixed(3));
  });

  it('widely spaced filters do NOT stack significantly', function () {
    // +8dB at 100Hz and +8dB at 10kHz — should peak close to 8dB
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [100, 8, 2] },
      { type: 'Peaking', scope: 'L+R', params: [10000, 8, 2] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(peak < 10, 'Expected peak < 10dB for spaced filters, got ' + peak.toFixed(3));
    assert.ok(peak >= 7.5, 'Expected peak >= 7.5dB, got ' + peak.toFixed(3));
  });
});

// ---------------------------------------------------------------------------
// computePeakCombinedGain – L/R channel handling
// ---------------------------------------------------------------------------

describe('computePeakCombinedGain – L/R channels', function () {
  it('L-only filter does not affect R peak', function () {
    // +10dB on L only
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L', params: [1000, 10, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    // peak should be ~10dB (from L channel)
    assert.ok(Math.abs(peak - 10) < 0.5, 'Expected ~10dB from L channel, got ' + peak.toFixed(3));
  });

  it('R-only filter does not affect L peak', function () {
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'R', params: [1000, 10, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(Math.abs(peak - 10) < 0.5, 'Expected ~10dB from R channel, got ' + peak.toFixed(3));
  });

  it('separate L and R filters: peak is max of both channels', function () {
    // L has +6dB, R has +12dB → peak should be ~12dB
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L', params: [1000, 6, 1] },
      { type: 'Peaking', scope: 'R', params: [1000, 12, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(Math.abs(peak - 12) < 0.5, 'Expected ~12dB (R channel), got ' + peak.toFixed(3));
  });

  it('L+R filter contributes to both channels', function () {
    // L+R +8dB, plus L-only +8dB at same freq → L peaks at ~16dB, R at ~8dB
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [1000, 8, 1] },
      { type: 'Peaking', scope: 'L', params: [1000, 8, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(peak > 14, 'Expected peak > 14dB (L channel stacks), got ' + peak.toFixed(3));
  });
});

// ---------------------------------------------------------------------------
// computePeakCombinedGain – EQ15 scenarios
// ---------------------------------------------------------------------------

describe('computePeakCombinedGain – EQ15 scenarios', function () {
  it('all-zero EQ15 gains returns 0', function () {
    var bands = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
    var filters = bands.map(function (freq) {
      return { type: 'Peaking', scope: 'L+R', params: [freq, 0, 2.15] };
    });
    var meq = buildMergedeq(filters);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(Math.abs(peak) < 0.01, 'Expected 0dB for all-zero EQ15, got ' + peak.toFixed(6));
  });

  it('single boosted EQ15 band: peak ≈ band gain', function () {
    var bands = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
    var filters = bands.map(function (freq) {
      return { type: 'Peaking', scope: 'L+R', params: [freq, freq === 1000 ? 10 : 0, 2.15] };
    });
    var meq = buildMergedeq(filters);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(Math.abs(peak - 10) < 0.5, 'Expected ~10dB for single +10dB band, got ' + peak.toFixed(3));
  });

  it('all EQ15 bands at +10dB: combined peak significantly exceeds 10dB', function () {
    var bands = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
    var filters = bands.map(function (freq) {
      return { type: 'Peaking', scope: 'L+R', params: [freq, 10, 2.15] };
    });
    var meq = buildMergedeq(filters);
    var peak = computePeakCombinedGain(meq, 44100);
    // With all 15 bands overlapping, the combined response should be well above 10dB
    assert.ok(peak > 15, 'Expected combined peak > 15dB, got ' + peak.toFixed(3));
  });
});

// ---------------------------------------------------------------------------
// computePeakCombinedGain – mixed filter types
// ---------------------------------------------------------------------------

describe('computePeakCombinedGain – mixed filter types', function () {
  it('Peaking + Lowshelf: peaks from both contribute', function () {
    var meq = buildMergedeq([
      { type: 'Lowshelf', scope: 'L+R', params: [200, 6, 6] },
      { type: 'Peaking', scope: 'L+R', params: [100, 6, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    // Low shelf + peaking at low freq should stack
    assert.ok(peak > 8, 'Expected peak > 8dB from stacked low-freq boost, got ' + peak.toFixed(3));
  });

  it('boost + equivalent cut = near 0dB', function () {
    // +8dB Peaking at 1kHz and -8dB Peaking at 1kHz with same Q → should cancel
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [1000, 8, 1] },
      { type: 'Peaking', scope: 'L+R', params: [1000, -8, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 44100);
    assert.ok(peak < 1, 'Expected near 0dB when boost and cut cancel, got ' + peak.toFixed(3));
  });
});

// ---------------------------------------------------------------------------
// computePeakCombinedGain – sample rate sensitivity
// ---------------------------------------------------------------------------

describe('computePeakCombinedGain – sample rate', function () {
  it('works correctly at 48kHz', function () {
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [1000, 8, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 48000);
    assert.ok(Math.abs(peak - 8) < 0.5, 'Expected ~8dB at 48kHz, got ' + peak.toFixed(3));
  });

  it('works correctly at 96kHz', function () {
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [1000, 8, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 96000);
    assert.ok(Math.abs(peak - 8) < 0.5, 'Expected ~8dB at 96kHz, got ' + peak.toFixed(3));
  });

  it('defaults to 44100 if sampleRate is falsy', function () {
    var meq = buildMergedeq([
      { type: 'Peaking', scope: 'L+R', params: [1000, 8, 1] }
    ]);
    var peak = computePeakCombinedGain(meq, 0);
    assert.ok(Math.abs(peak - 8) < 0.5, 'Expected ~8dB with default sampleRate, got ' + peak.toFixed(3));
  });
});
