'use strict';

// SNR Measurement Module for RTL-SDR Radio
// Measures signal-to-noise ratio across gain settings for DAB channels
//
// Based on snrd-api_V2.sh by Wheaten
// Original shell script adapted to Node.js module for Volumio plugin integration
//
// Credits: Wheaten - original SNR measurement algorithm and gain optimization logic

var libQ = require('kew');
var spawn = require('child_process').spawn;

// DAB channel frequencies (Band III) in Hz
var DAB_FREQS = {
  '5A': 174928000, '5B': 176640000, '5C': 178352000, '5D': 180064000,
  '6A': 181936000, '6B': 183648000, '6C': 185360000, '6D': 187072000,
  '7A': 188928000, '7B': 190640000, '7C': 192352000, '7D': 194064000,
  '8A': 195936000, '8B': 197648000, '8C': 199360000, '8D': 201072000,
  '9A': 202928000, '9B': 204640000, '9C': 206352000, '9D': 208064000,
  '10A': 209936000, '10B': 211648000, '10C': 213360000, '10D': 215072000,
  '11A': 216928000, '11B': 218640000, '11C': 220352000, '11D': 222064000,
  '12A': 223936000, '12B': 225648000, '12C': 227360000, '12D': 229072000,
  '13A': 230784000, '13B': 232496000, '13C': 234208000, '13D': 235776000,
  '13E': 237488000, '13F': 239200000
};

var DAB_BW = 1536000; // DAB channel bandwidth in Hz
var STEP = 10000;     // Frequency step for rtl_power

/**
 * Get frequency for a DAB channel
 * @param {string} channel - Channel name (e.g., '11C')
 * @returns {number|null} - Frequency in Hz or null if invalid
 */
function getChannelFrequency(channel) {
  var ch = channel.toUpperCase();
  return DAB_FREQS[ch] || null;
}

/**
 * Validate channel names
 * @param {string[]} channels - Array of channel names
 * @returns {string[]} - Array of valid channel names (uppercase)
 */
function validateChannels(channels) {
  var valid = [];
  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i].toUpperCase();
    if (DAB_FREQS[ch]) {
      valid.push(ch);
    }
  }
  return valid;
}

/**
 * Calculate frequency span for channels
 * @param {string[]} channels - Array of channel names
 * @returns {object} - { start: Hz, stop: Hz }
 */
function calculateFrequencySpan(channels) {
  var minFreq = Number.MAX_VALUE;
  var maxFreq = 0;
  
  for (var i = 0; i < channels.length; i++) {
    var freq = DAB_FREQS[channels[i]];
    if (freq < minFreq) minFreq = freq;
    if (freq > maxFreq) maxFreq = freq;
  }
  
  return {
    start: minFreq - DAB_BW,
    stop: maxFreq + DAB_BW
  };
}

/**
 * Parse rtl_power CSV output and calculate SNR for each channel
 * @param {string} csvOutput - Raw CSV output from fn-rtl_power
 * @param {string[]} channels - Channels to measure
 * @param {number} gain - Current gain setting
 * @returns {object[]} - Array of { channel, gain, peak, noise, snr }
 */
function parseRtlPowerOutput(csvOutput, channels, gain) {
  var results = [];
  var lines = csvOutput.trim().split('\n');
  
  // Build channel info
  var channelInfo = [];
  for (var i = 0; i < channels.length; i++) {
    channelInfo.push({
      name: channels[i],
      center: DAB_FREQS[channels[i]]
    });
  }
  
  // Process each line of rtl_power output
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    if (!line.match(/^\d{4}-\d{2}-\d{2},/)) continue;
    
    var parts = line.split(',');
    if (parts.length < 7) continue;
    
    var freqStart = parseInt(parts[2], 10);
    var freqStop = parseInt(parts[3], 10);
    var rbw = parseFloat(parts[4]);
    
    // Extract power values (start at index 6)
    var powerValues = [];
    for (var pi = 6; pi < parts.length; pi++) {
      var pv = parseFloat(parts[pi]);
      // Handle invalid values - replace with -999 marker
      if (isNaN(pv) || !isFinite(pv)) {
        powerValues.push(-999);
      } else {
        powerValues.push(pv);
      }
    }
    var numBins = powerValues.length;
    
    // Process each channel
    for (var ci = 0; ci < channelInfo.length; ci++) {
      var ch = channelInfo[ci];
      var center = ch.center;
      
      // Skip if channel not in this frequency range
      if (center < freqStart || center > freqStop) continue;
      
      // Calculate bin indices for channel bandwidth
      var loIdx = Math.round((center - DAB_BW / 2 - freqStart) / rbw);
      var hiIdx = Math.round((center + DAB_BW / 2 - freqStart) / rbw);
      if (loIdx < 0) loIdx = 0;
      if (hiIdx >= numBins) hiIdx = numBins - 1;
      
      // Find peak power within channel window
      var peak = -999;
      for (var bi = loIdx; bi <= hiIdx; bi++) {
        if (powerValues[bi] > -900 && powerValues[bi] > peak) {
          peak = powerValues[bi];
        }
      }
      
      if (peak <= -900) continue;
      
      // Calculate noise floor from bins outside channel (skip invalid values)
      var noiseSum = 0;
      var noiseCount = 0;
      
      for (var ni = 0; ni < loIdx; ni++) {
        if (powerValues[ni] > -900) {
          noiseSum += powerValues[ni];
          noiseCount++;
        }
      }
      for (var ni2 = hiIdx + 1; ni2 < numBins; ni2++) {
        if (powerValues[ni2] > -900) {
          noiseSum += powerValues[ni2];
          noiseCount++;
        }
      }
      
      // Skip if we couldn't calculate valid noise floor
      if (noiseCount === 0) continue;
      
      var noise = noiseSum / noiseCount;
      var snr = peak - noise;
      
      // Skip if SNR is invalid
      if (isNaN(snr) || !isFinite(snr)) continue;
      
      results.push({
        channel: ch.name,
        gain: gain,
        peak: Math.round(peak * 100) / 100,
        noise: Math.round(noise * 100) / 100,
        snr: Math.round(snr * 100) / 100
      });
    }
  }
  
  return results;
}

/**
 * Run SNR measurement for a single gain setting
 * @param {string[]} channels - Channels to measure
 * @param {number} gain - Gain setting
 * @param {number} integration - Integration time in seconds
 * @param {object} logger - Logger instance
 * @returns {promise} - Resolves with array of results
 */
function measureAtGain(channels, gain, integration, logger) {
  var defer = libQ.defer();
  
  var span = calculateFrequencySpan(channels);
  var freqArg = span.start + ':' + span.stop + ':' + STEP;
  
  var args = ['-f', freqArg, '-g', String(gain), '-i', String(integration), '-1'];
  
  if (logger) {
    logger.info('[SNR] Running fn-rtl_power with gain=' + gain);
  }
  
  var rtlPower = spawn('fn-rtl_power', args);
  var csvOutput = '';
  var stderrOutput = '';
  
  rtlPower.stdout.on('data', function(data) {
    csvOutput += data.toString();
  });
  
  rtlPower.stderr.on('data', function(data) {
    stderrOutput += data.toString();
  });
  
  rtlPower.on('close', function(code) {
    if (code !== 0) {
      if (logger) {
        logger.error('[SNR] fn-rtl_power failed: ' + stderrOutput);
      }
      defer.resolve([]); // Return empty results on failure
      return;
    }
    
    var results = parseRtlPowerOutput(csvOutput, channels, gain);
    defer.resolve(results);
  });
  
  rtlPower.on('error', function(err) {
    if (logger) {
      logger.error('[SNR] fn-rtl_power error: ' + err.toString());
    }
    defer.resolve([]);
  });
  
  return defer.promise;
}

/**
 * Calculate summary statistics from all measurements
 * @param {object[]} allResults - All measurement results
 * @returns {object} - { byGain: {...}, bestGain: number, bestAvgSnr: number }
 */
function calculateSummary(allResults) {
  var byGain = {};
  
  // Group by gain
  for (var i = 0; i < allResults.length; i++) {
    var r = allResults[i];
    var g = r.gain;
    
    if (!byGain[g]) {
      byGain[g] = {
        gain: g,
        min: r.snr,
        max: r.snr,
        sum: r.snr,
        count: 1
      };
    } else {
      if (r.snr < byGain[g].min) byGain[g].min = r.snr;
      if (r.snr > byGain[g].max) byGain[g].max = r.snr;
      byGain[g].sum += r.snr;
      byGain[g].count++;
    }
  }
  
  // Calculate averages and find best gain
  var bestGain = -999;
  var bestAvgSnr = -999;
  var gainSummaries = [];
  
  var gains = Object.keys(byGain).map(function(k) { return parseInt(k, 10); }).sort(function(a, b) { return a - b; });
  
  for (var gi = 0; gi < gains.length; gi++) {
    var gain = gains[gi];
    var data = byGain[gain];
    var avg = data.sum / data.count;
    
    gainSummaries.push({
      gain: gain,
      minSnr: Math.round(data.min * 100) / 100,
      maxSnr: Math.round(data.max * 100) / 100,
      avgSnr: Math.round(avg * 100) / 100,
      samples: data.count
    });
    
    if (avg > bestAvgSnr) {
      bestAvgSnr = avg;
      bestGain = gain;
    }
  }
  
  return {
    byGain: gainSummaries,
    bestGain: bestGain,
    bestAvgSnr: Math.round(bestAvgSnr * 100) / 100
  };
}

/**
 * Run full SNR scan across gain range
 * @param {object} options - Scan options
 * @param {string[]} options.channels - Channels to measure
 * @param {number} options.gainStart - Start gain (default -10)
 * @param {number} options.gainStop - Stop gain (default 49)
 * @param {number} options.gainStep - Gain step (default 5)
 * @param {number} options.integration - Integration time in seconds (default 2)
 * @param {object} options.logger - Logger instance
 * @param {function} options.onProgress - Progress callback(gain, results)
 * @returns {promise} - Resolves with { measurements: [], summary: {} }
 */
function runSnrScan(options) {
  var defer = libQ.defer();
  
  var channels = validateChannels(options.channels || []);
  if (channels.length === 0) {
    defer.reject('No valid channels specified');
    return defer.promise;
  }
  
  var gainStart = (options.gainStart !== undefined) ? options.gainStart : -10;
  var gainStop = (options.gainStop !== undefined) ? options.gainStop : 49;
  var gainStep = (options.gainStep !== undefined) ? options.gainStep : 5;
  var integration = options.integration || 2;
  var logger = options.logger;
  var onProgress = options.onProgress;
  
  // Build gain values array
  var gainValues = [];
  for (var g = gainStart; g <= gainStop; g += gainStep) {
    gainValues.push(g);
  }
  
  if (gainValues.length === 0) {
    defer.reject('Invalid gain range');
    return defer.promise;
  }
  
  var allResults = [];
  var currentIndex = 0;
  
  function measureNext() {
    if (currentIndex >= gainValues.length) {
      // All done - calculate summary
      var summary = calculateSummary(allResults);
      defer.resolve({
        measurements: allResults,
        summary: summary,
        channels: channels,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    var gain = gainValues[currentIndex];
    currentIndex++;
    
    measureAtGain(channels, gain, integration, logger)
      .then(function(results) {
        // Add to all results
        for (var i = 0; i < results.length; i++) {
          allResults.push(results[i]);
        }
        
        // Call progress callback if provided
        if (onProgress) {
          onProgress(gain, results, currentIndex, gainValues.length);
        }
        
        // Small delay between measurements to let device settle
        setTimeout(measureNext, 200);
      });
  }
  
  measureNext();
  return defer.promise;
}

/**
 * Get list of all valid DAB channel names
 * @returns {string[]} - Array of channel names
 */
function getAllChannels() {
  return Object.keys(DAB_FREQS).sort(function(a, b) {
    // Sort by frequency
    return DAB_FREQS[a] - DAB_FREQS[b];
  });
}

module.exports = {
  DAB_FREQS: DAB_FREQS,
  DAB_BW: DAB_BW,
  getChannelFrequency: getChannelFrequency,
  validateChannels: validateChannels,
  calculateFrequencySpan: calculateFrequencySpan,
  measureAtGain: measureAtGain,
  calculateSummary: calculateSummary,
  runSnrScan: runSnrScan,
  getAllChannels: getAllChannels
};
