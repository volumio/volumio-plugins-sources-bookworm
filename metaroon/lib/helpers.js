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
		} catch (e) { 
			// Not ideal to absorb exception silently but works in this case
		}
	}
	if (core.moo && core.moo.core && core.moo.core.ws && core.moo.core.ws._socket) {
		try {
			let addr = core.moo.core.ws._socket.remoteAddress;
			if (addr.startsWith('::ffff:')) addr = addr.substring(7);
			return addr;
		} catch (e) {
			// Same as above
		 }
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
		} catch (e) { 
			// Another silent exception absorb
		 }
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

function getLocalAlsaDeviceNames(commandRouter) {
	var names = [];
	try {
		var cards = commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getAplayInfo', '');
		var outputDeviceId = commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'outputdevice');
		if (cards && cards.length > 0) {
			cards.forEach(function(card) {
				if (card.name) names.push(card.name);
			});
			if (outputDeviceId) {
				var selected = cards.find(function(c) { return c.id === outputDeviceId; });
				if (selected && selected.name) {
					names = names.filter(function(n) { return n !== selected.name; });
					names.unshift(selected.name);
				}
			}
		}
	} catch (e) { 
		// And another one
	}
	return names;
}

function getLocalHostname() {
	try { return require('os').hostname(); } catch (e) { return ''; }
}

function findLocalZone(zones, commandRouter) {
	if (!zones || zones.length === 0) return null;

	var localDeviceNames = getLocalAlsaDeviceNames(commandRouter);
	var hostname = getLocalHostname().toLowerCase();

	if (localDeviceNames.length > 0) {
		for (var z = 0; z < zones.length; z++) {
			var zone = zones[z];
			if (!zone.outputs) continue;
			for (var o = 0; o < zone.outputs.length; o++) {
				var output = zone.outputs[o];
				if (!output.source_controls) continue;
				for (var s = 0; s < output.source_controls.length; s++) {
					var scName = (output.source_controls[s].display_name || '').toLowerCase();
					for (var d = 0; d < localDeviceNames.length; d++) {
						if (scName && scName === localDeviceNames[d].toLowerCase()) {
							return zone;
						}
					}
				}
			}
		}
	}

	if (hostname) {
		var byName = zones.find(function(z) {
			if (z.display_name && z.display_name.toLowerCase() === hostname) return true;
			if (z.outputs) {
				return z.outputs.some(function(o) {
					return o.display_name && o.display_name.toLowerCase() === hostname;
				});
			}
			return false;
		});
		if (byName) return byName;
	}

	try {
		var systemName = commandRouter.sharedVars.get('system.name');
		if (systemName) {
			var sysNameLower = systemName.toLowerCase();
			var bySysName = zones.find(function(z) {
				if (z.display_name && z.display_name.toLowerCase() === sysNameLower) return true;
				if (z.outputs) {
					return z.outputs.some(function(o) {
						return o.display_name && o.display_name.toLowerCase() === sysNameLower;
					});
				}
				return false;
			});
			if (bySysName) return bySysName;
		}
	} catch (e) {
		// And another
	 }

	return null;
}

module.exports = {
	extractRoonCoreIP,
	getRoonImageUrl,
	cleanRoonText,
	convertRoonItemToVolumio,
	findBestPlayAction,
	readAlsaHwParams,
	formatSampleRate,
	invalidateHwParamsCache,
	findLocalZone
};
