'use strict';

const PLUGIN_VERSION = '1.0.0';
const RECONNECT_CHECK_DELAY_MS = 10000;
const FAST_RECONNECT_DELAY_MS = 2000;
const STATE_DEBOUNCE_MS = 2000;
const SEEK_PUSH_THRESHOLD_MS = 1500;
const TRACK_CHANGE_GUARD_MS = 3000;
const BROWSE_PAGE_SIZE = 100;
const SEARCH_PAGE_SIZE = 50;

const ROON_TEXT_REGEX = /\[\[\d+\|([^\]]+)\]\]/g;

const STATE_MAP = new Map([
	['playing', 'play'],
	['paused', 'pause'],
	['loading', 'play'],
	['stopped', 'stop']
]);

const PLAY_ACTION_PRIORITY = [
	'play from here', 'play now', 'play', 'play album',
	'play artist', 'play playlist', 'start', 'shuffle'
];

module.exports = {
	PLUGIN_VERSION,
	RECONNECT_CHECK_DELAY_MS,
	FAST_RECONNECT_DELAY_MS,
	STATE_DEBOUNCE_MS,
	SEEK_PUSH_THRESHOLD_MS,
	TRACK_CHANGE_GUARD_MS,
	BROWSE_PAGE_SIZE,
	SEARCH_PAGE_SIZE,
	ROON_TEXT_REGEX,
	STATE_MAP,
	PLAY_ACTION_PRIORITY
};