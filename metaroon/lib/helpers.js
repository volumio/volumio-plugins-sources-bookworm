'use strict';

const fs = require('fs');
const { ROON_TEXT_REGEX, PLAY_ACTION_PRIORITY } = require('./constants');

let cachedHwParams = null;
let cachedHwParamsTrack = '';

function extractRoonCoreIP(core) {
	if (core.moo && core.moo.transport && core.moo.transport.ws) {
		try {
			const ws = core.moo.transport.ws;
			if (ws._socket && ws._socket.remoteAddress) {
				let addr = ws._socket.remoteAddress;
				if (addr.startsWith('::ffff:')) addr = addr.substring(7);
				return addr;
			}
		} catch (e) { /* ignore */ }
	}
	if (core.moo && core.moo.core && core.moo.core.ws && core.moo.core.ws._socket) {
		try {
			let addr = core.moo.core.ws._socket.remoteAddress;
			if (addr.startsWith('::ffff:')) addr = addr.substring(7);
			return addr;
		} catch (e) { /* ignore */ }
	}
	return null;
}

function getRoonImageUrl(roonCoreHost, imageKey, width, height) {
	if (!roonCoreHost || !imageKey) return '/albumart';
	return 'http://' + roonCoreHost + ':9330/api/image/' + imageKey +
		'?scale=fit&width=' + (width || 200) + '&height=' + (height || 200);
}

function cleanRoonText(text) {
	if (!text) return '';
	ROON_TEXT_REGEX.lastIndex = 0;
	return text.replace(ROON_TEXT_REGEX, '$1');
}

function convertRoonItemToVolumio(item, roonCoreHost, currentBrowseListImage, isSearchContext) {
	if (item.hint === 'header') return null;

	var icon = 'fa fa-folder-open-o';
	var type = 'folder';
	var showAlbumart = true;

	if (item.hint === 'action') {
		icon = 'fa fa-play';
		showAlbumart = false;
		type = 'folder';
	} else if (item.hint === 'action_list') {
		icon = 'fa fa-music';
		type = isSearchContext ? 'song' : 'folder';
	}

	var albumart = '';
	if (showAlbumart) {
		if (item.image_key) {
			albumart = getRoonImageUrl(roonCoreHost, item.image_key, 200, 200);
		} else if (currentBrowseListImage) {
			albumart = getRoonImageUrl(roonCoreHost, currentBrowseListImage, 200, 200);
		}
	}

	var uriPrefix = isSearchContext ? 'roon/search:' : 'roon/';

	return {
		service: 'metaroon',
		type: type,
		title: item.title || 'Unknown',
		artist: cleanRoonText(item.subtitle || ''),
		album: isSearchContext ? '' : (item.subtitle || ''),
		icon: icon,
		uri: item.item_key ? uriPrefix + item.item_key : 'roon',
		albumart: albumart
	};
}

function findBestPlayAction(items) {
	if (!items || items.length === 0) return null;

	var actionItems = items.filter(function(i) {
		return i.hint === 'action' || i.hint === 'action_list';
	});

	for (var p = 0; p < PLAY_ACTION_PRIORITY.length; p++) {
		var name = PLAY_ACTION_PRIORITY[p];
		var found = actionItems.find(function(i) {
			return i.title && i.title.toLowerCase() === name;
		});
		if (found) return found;
	}

	var playAction = actionItems.find(function(i) {
		return i.title && i.title.toLowerCase().includes('play');
	});
	return playAction || (actionItems.length > 0 ? actionItems[0] : null);
}

function readAlsaHwParams(currentTrackTitle) {
	if (cachedHwParams && cachedHwParamsTrack === currentTrackTitle) {
		return cachedHwParams;
	}

	var hwParamsPaths = [
		'/proc/asound/card2/pcm0p/sub0/hw_params',
		'/proc/asound/sndrpihifiberry/pcm0p/sub0/hw_params',
		'/proc/asound/card1/pcm0p/sub0/hw_params',
		'/proc/asound/card0/pcm0p/sub0/hw_params'
	];

	for (var p = 0; p < hwParamsPaths.length; p++) {
		try {
			var data = fs.readFileSync(hwParamsPaths[p], 'utf8');
			if (data && data.trim() !== 'closed') {
				cachedHwParams = parseHwParams(data);
				cachedHwParamsTrack = currentTrackTitle;
				return cachedHwParams;
			}
		} catch (e) { /* ignore */ }
	}

	return null;
}

function parseHwParams(data) {
	var result = { samplerate: '', bitdepth: '', channels: 2 };
	var lines = data.split('\n');

	for (var l = 0; l < lines.length; l++) {
		var parts = lines[l].split(':');
		if (parts.length < 2) continue;
		var key = parts[0].trim();
		var value = parts[1].trim();

		if (key === 'format') {
			if (value.includes('S16') || value.includes('U16')) result.bitdepth = '16 bit';
			else if (value.includes('S24') || value.includes('U24')) result.bitdepth = '24 bit';
			else if (value.includes('S32') || value.includes('U32')) result.bitdepth = '32 bit';
			else if (value.includes('DSD')) result.bitdepth = 'DSD';
			else if (value.includes('FLOAT')) result.bitdepth = '32 bit float';
			else result.bitdepth = value;
		} else if (key === 'rate') {
			var rateMatch = value.match(/^(\d+)/);
			if (rateMatch) result.samplerate = formatSampleRate(parseInt(rateMatch[1], 10));
		} else if (key === 'channels') {
			result.channels = parseInt(value, 10) || 2;
		}
	}
	return result;
}

function formatSampleRate(rate) {
	if (rate >= 1000) {
		var khz = rate / 1000;
		return khz === Math.floor(khz) ? khz + ' kHz' : khz.toFixed(1) + ' kHz';
	}
	return rate + ' Hz';
}

function invalidateHwParamsCache() {
	cachedHwParams = null;
	cachedHwParamsTrack = '';
}

module.exports = {
	extractRoonCoreIP,
	getRoonImageUrl,
	cleanRoonText,
	convertRoonItemToVolumio,
	findBestPlayAction,
	readAlsaHwParams,
	formatSampleRate,
	invalidateHwParamsCache
};