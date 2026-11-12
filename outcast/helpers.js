'use strict';
// The plugin's pure parts, with no dependency on the player: what the tests exercise
// and index.js uses. Nothing here reads a file or talks to the player.

// The title as the player's screen shows it: "Artist - Title", or whichever is there.
function screenTitle(state) {
    if (!state) return '';
    const title = String(state.title || '').trim();
    const artist = String(state.artist || '').trim();
    return artist && title ? artist + ' - ' + title : (title || artist);
}

// The ALSA configuration the preflight plays through: the player's own base
// configuration, the tap's library, and one PCM of the tap writing into nothing. The
// player's chain is not in it.
function checkConfig(library, tag, base) {
    return [
        '<' + (base || '/usr/share/alsa/alsa.conf') + '>',
        'pcm_type.evotap {',
        '  lib ' + library,
        '}',
        'pcm.OutcastCheck {',
        '  type evotap',
        '  slave.pcm "null"',
        '  ring "' + tag + '"',
        '  audio 1',
        '}',
        ''
    ].join('\n');
}

// Whether the player's ALSA file, as written, carries the tap.
function chainHasTap(text) {
    return /^pcm\.Outcast\s*\{/m.test(String(text || ''));
}

// The evotap libraries the chain file names, in order: every `pcm_type.evotap { lib X }`
// block's path. ALSA takes the last one for the type, so another plugin's copy may serve
// this plugin's tap; the last is the one that counts.
function chainLibraries(text) {
    const out = [];
    const re = /pcm_type\.evotap\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        const lib = /\blib\s+("?)([^\s"]+)\1/.exec(m[1]);
        if (lib) out.push(lib[2]);
    }
    return out;
}

// A string of the plugin's dictionary with its {{variables}} filled.
function fill(text, vars) {
    let s = String(text);
    Object.keys(vars || {}).forEach((k) => { s = s.split('{{' + k + '}}').join(String(vars[k])); });
    return s;
}

// The value of a select field as the page sends it, or a plain value.
function sel(v) {
    return v && typeof v === 'object' && 'value' in v ? String(v.value) : String(v === undefined || v === null ? '' : v);
}

const num = (v, fallback) => {
    const n = parseInt(String(v).trim(), 10);
    return Number.isFinite(n) ? n : fallback;
};

// ------------------------------------------------------------------ validation
// Each returns the message to show, or null. `t` translates a key with its variables.

function checkPort(v, field, t) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    const n = parseInt(s, 10);
    return /^\d+$/.test(s) && n >= 1 && n <= 65535 ? null : t('ERR_PORT', { field: t(field) });
}

function checkRange(v, field, min, max, t) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    const n = parseInt(s, 10);
    if (!/^\d+$/.test(s)) return t('ERR_NUMBER', { field: t(field) });
    return n >= min && n <= max ? null : t('ERR_RANGE', { field: t(field), min, max });
}

function checkText(v, field, t) {
    return /["\r\n]/.test(String(v || '')) ? t('ERR_TEXT', { field: t(field) }) : null;
}

// The Icecast uplink speaks Icecast 2 or SHOUTcast v1; the second has no mount and
// no user, a stream number instead.
function protocolOf(data, prefix) {
    return sel(data[prefix + '_protocol']) === 'shoutcast1' ? 'shoutcast1' : 'icecast2';
}

// The Icecast slots on the page, each a section of its own with its fields prefixed.
const ICE_SLOTS = ['ice', 'ice2', 'ice3'];

// ------------------------------------------------------------------ the encoding
// What an uplink sends is a preset, the settings commonly used for its kind of
// destination, or whatever the operator sets under Advanced: any codec evopeg makes, any
// bitrate, any sample rate (0 for the player's own), stereo, mono or the player's own
// channels. The plugin refuses nothing; the destination or the encoder does, and the
// status says so. A player upgraded from a release without presets keeps the values it
// had, as if Advanced were on.
const PRESETS = {
    'mp3-128-44100': { codec: 'mp3', bitrate: 128, rate: 44100, channels: 2 },
    'mp3-192-44100': { codec: 'mp3', bitrate: 192, rate: 44100, channels: 2 },
    'mp3-320-44100': { codec: 'mp3', bitrate: 320, rate: 44100, channels: 2 },
    'aac-96-44100': { codec: 'aac', bitrate: 96, rate: 44100, channels: 2 },
    'aac-96-48000': { codec: 'aac', bitrate: 96, rate: 48000, channels: 2 },
    'aac-128-44100': { codec: 'aac', bitrate: 128, rate: 44100, channels: 2 },
    'aac-128-48000': { codec: 'aac', bitrate: 128, rate: 48000, channels: 2 },
    'aac-160-44100': { codec: 'aac', bitrate: 160, rate: 44100, channels: 2 },
    'aac-192-48000': { codec: 'aac', bitrate: 192, rate: 48000, channels: 2 },
    'aac-256-48000': { codec: 'aac', bitrate: 256, rate: 48000, channels: 2 },
    'mp2-192-48000': { codec: 'mp2', bitrate: 192, rate: 48000, channels: 2 },
    'mp2-256-48000': { codec: 'mp2', bitrate: 256, rate: 48000, channels: 2 },
    'opus-64-48000': { codec: 'opus', bitrate: 64, rate: 48000, channels: 2 },
    'opus-96-48000': { codec: 'opus', bitrate: 96, rate: 48000, channels: 2 },
    'vorbis-128-44100': { codec: 'vorbis', bitrate: 128, rate: 44100, channels: 2 },
    'flac-48000': { codec: 'flac', bitrate: 0, rate: 48000, channels: 2 },
    'flac-0': { codec: 'flac', bitrate: 0, rate: 0, channels: 0 },
    'wav-0': { codec: 'wav', bitrate: 0, rate: 0, channels: 0 }
};
const DEFAULT_PRESET = { ice: 'mp3-128-44100', ice2: 'mp3-128-44100', ice3: 'mp3-128-44100', lan: 'mp3-128-44100', rec: 'flac-0', srt: 'aac-128-48000', rtmp: 'aac-128-44100', ts: 'aac-128-48000', hls: 'aac-128-48000' };

function checkWhole(v, field, t) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    return /^\d+$/.test(s) ? null : t('ERR_NUMBER', { field: t(field) });
}

// The encoding's own fields checked, when Advanced is on: numbers are numbers.
function validateEncoding(data, prefix, t) {
    if (data[prefix + '_advanced'] !== true) return null;
    return checkWhole(data[prefix + '_bitrate'], 'BITRATE', t) ||
        checkWhole(data[prefix + '_rate'], 'RATE', t) ||
        null;
}

function applyEncoding(data, prefix, set) {
    const advanced = data[prefix + '_advanced'] === true;
    set(prefix + '_preset', PRESETS[sel(data[prefix + '_preset'])] ? sel(data[prefix + '_preset']) : DEFAULT_PRESET[prefix]);
    set(prefix + '_advanced', advanced);
    if (!advanced) return;
    set(prefix + '_codec', sel(data[prefix + '_codec']));
    set(prefix + '_bitrate', String(data[prefix + '_bitrate']).trim());
    set(prefix + '_rate', String(data[prefix + '_rate']).trim());
    set(prefix + '_channels', sel(data[prefix + '_channels']));
}

// The encoding for the core: the preset's values, or the operator's own.
function encodingFrom(get, prefix) {
    const preset = String(get(prefix + '_preset', ''));
    const advanced = get(prefix + '_advanced', false) === true || preset === '';
    if (!advanced) {
        const p = PRESETS[preset] || PRESETS[DEFAULT_PRESET[prefix]];
        return { codec: p.codec, bitrate: p.bitrate, rate: p.rate, channels: p.channels };
    }
    const p = PRESETS[DEFAULT_PRESET[prefix]];
    return {
        codec: String(get(prefix + '_codec', p.codec)),
        bitrate: num(get(prefix + '_bitrate', String(p.bitrate)), p.bitrate),
        rate: num(get(prefix + '_rate', String(p.rate)), p.rate),
        channels: num(get(prefix + '_channels', String(p.channels)), p.channels)
    };
}

function validateIcecast(data, t, prefix) {
    const p = prefix || 'ice';
    const f = (k) => data[p + '_' + k];
    if (f('enabled') !== true) return null;
    const shoutcast = protocolOf(data, p) === 'shoutcast1';
    return (!String(f('host') || '').trim() ? t('ERR_HOST') : null) ||
        checkPort(f('port'), 'ICE_PORT', t) ||
        (shoutcast && parseInt(String(f('port')).trim(), 10) === 65535 ? t('ERR_PORT', { field: t('ICE_PORT') }) : null) ||
        (!shoutcast && !/^\/\S*$/.test(String(f('mount') || '').trim()) ? t('ERR_MOUNT') : null) ||
        (shoutcast ? checkRange(f('stream_id'), 'ICE_STREAM_ID', 1, 999, t) : null) ||
        (!f('password') ? t('ERR_PASSWORD') : null) ||
        (!shoutcast ? checkText(f('user'), 'ICE_USER', t) : null) ||
        validateEncoding(data, p, t) ||
        checkText(f('name'), 'STREAM_NAME', t) ||
        (f('more') === true && (
            checkText(f('description'), 'ICE_DESCRIPTION', t) ||
            checkText(f('genre'), 'ICE_GENRE', t) ||
            checkText(f('url'), 'ICE_URL', t))) ||
        null;
}

function validateLan(data, t) {
    if (data.lan_enabled !== true) return null;
    return checkPort(data.lan_port, 'LAN_PORT', t) ||
        validateEncoding(data, 'lan', t) ||
        checkText(data.lan_name, 'STREAM_NAME', t) ||
        checkRange(data.lan_max_listeners, 'LAN_MAX', 1, 64, t) ||
        null;
}

// A signed number, as a level in dBFS.
function checkSigned(v, field, t) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    return /^-?\d+(\.\d+)?$/.test(s) ? null : t('ERR_NUMBER', { field: t(field) });
}

function validateSrt(data, t) {
    if (data.srt_enabled !== true) return null;
    return (!String(data.srt_host || '').trim() ? t('ERR_HOST') : null) ||
        checkPort(data.srt_port, 'SRT_PORT', t) ||
        checkText(data.srt_stream_id, 'SRT_STREAM_ID', t) ||
        checkText(data.srt_passphrase, 'SRT_PASSPHRASE', t) ||
        (String(data.srt_passphrase || '').length > 0 && String(data.srt_passphrase).length < 10 ? t('ERR_PASSPHRASE') : null) ||
        checkWhole(data.srt_latency, 'SRT_LATENCY', t) ||
        validateEncoding(data, 'srt', t) ||
        null;
}

function applySrt(data, set) {
    const on = data.srt_enabled === true;
    set('srt_enabled', on);
    if (!on) return;
    set('srt_host', String(data.srt_host).trim());
    set('srt_port', String(data.srt_port).trim());
    set('srt_stream_id', String(data.srt_stream_id || '').trim());
    set('srt_passphrase', String(data.srt_passphrase || ''));
    set('srt_latency', String(data.srt_latency).trim());
    applyEncoding(data, 'srt', set);
    set('srt_keep_alive', data.srt_keep_alive !== false);
}

function validateRtmp(data, t) {
    if (data.rtmp_enabled !== true) return null;
    const url = String(data.rtmp_url || '').trim();
    return (!/^rtmps?:\/\/[^\s/]+\/\S+$/.test(url) ? t('ERR_RTMP_URL') : null) ||
        (!String(data.rtmp_key || '').trim() ? t('ERR_RTMP_KEY') : null) ||
        checkText(data.rtmp_key, 'RTMP_KEY', t) ||
        validateEncoding(data, 'rtmp', t) ||
        null;
}

function applyRtmp(data, set) {
    const on = data.rtmp_enabled === true;
    set('rtmp_enabled', on);
    if (!on) return;
    set('rtmp_url', String(data.rtmp_url).trim());
    set('rtmp_key', String(data.rtmp_key).trim());
    applyEncoding(data, 'rtmp', set);
    if (data.rtmp_advanced === true) set('rtmp_ca_file', String(data.rtmp_ca_file || '').trim());
    set('rtmp_keep_alive', data.rtmp_keep_alive !== false);
}

function validateTs(data, t) {
    if (data.ts_enabled !== true) return null;
    return (!String(data.ts_host || '').trim() ? t('ERR_HOST') : null) ||
        checkPort(data.ts_port, 'TS_PORT', t) ||
        checkRange(data.ts_ttl, 'TS_TTL', 1, 255, t) ||
        validateEncoding(data, 'ts', t) ||
        null;
}

function applyTs(data, set) {
    const on = data.ts_enabled === true;
    set('ts_enabled', on);
    if (!on) return;
    set('ts_transport', sel(data.ts_transport) === 'udp' ? 'udp' : 'tcp');
    set('ts_host', String(data.ts_host).trim());
    set('ts_port', String(data.ts_port).trim());
    set('ts_ttl', String(data.ts_ttl).trim());
    applyEncoding(data, 'ts', set);
    set('ts_keep_alive', data.ts_keep_alive !== false);
}

function validateHls(data, t) {
    if (data.hls_enabled !== true) return null;
    const serve = data.hls_serve !== false;
    const origin = originKind(data.hls_origin);
    const url = String(data.hls_origin_url || '').trim();
    const endpoint = String(data.hls_s3_endpoint || '').trim();
    return (!serve && origin === 'none' ? t('ERR_HLS_NOWHERE') : null) ||
        (serve ? checkPort(data.hls_port, 'HLS_PORT', t) : null) ||
        (serve ? checkRange(data.hls_max_connections, 'HLS_MAX_CONNECTIONS', 1, 1000, t) : null) ||
        (origin === 'http' && !/^https?:\/\/[^\s/]+(\/\S*)?$/.test(url) ? t('ERR_HLS_ORIGIN_URL') : null) ||
        (origin === 's3' && !/^https?:\/\/[^\s/]+(\/\S*)?$/.test(endpoint) ? t('ERR_HLS_S3_ENDPOINT') : null) ||
        (origin === 's3' && !/^[a-z0-9][a-z0-9.-]{1,62}$/.test(String(data.hls_s3_bucket || '').trim()) ? t('ERR_HLS_S3_BUCKET') : null) ||
        (origin === 's3' && !(String(data.hls_s3_access_key || '').trim() && String(data.hls_s3_secret_key || '')) ? t('ERR_HLS_S3_KEYS') : null) ||
        validateEncoding(data, 'hls', t) ||
        (sel(data.hls_form) !== 'fmp4' && !['aac', 'mp3'].includes(hlsCodec(data)) ? t('ERR_HLS_PACKED_CODEC') : null) ||
        (data.hls_advanced === true ? checkRange(data.hls_segment_seconds, 'HLS_SEGMENT', 1, 30, t) : null) ||
        (data.hls_advanced === true ? checkRange(data.hls_window, 'HLS_WINDOW', 3, 60, t) : null) ||
        null;
}

// The codec the HLS section ends up with: the preset's, or the operator's under Advanced.
function hlsCodec(data) {
    if (data.hls_advanced === true) return String(sel(data.hls_codec) || 'aac');
    const p = PRESETS[sel(data.hls_preset)] || PRESETS[DEFAULT_PRESET.hls];
    return p.codec;
}

function originKind(v) {
    const k = sel(v);
    return k === 'http' || k === 's3' ? k : 'none';
}

function applyHls(data, set) {
    const on = data.hls_enabled === true;
    set('hls_enabled', on);
    if (!on) return;
    set('hls_name', String(data.hls_name || '').trim() || 'stream');
    const form = sel(data.hls_form) === 'fmp4' ? 'fmp4' : 'packed';
    set('hls_form', form);
    set('hls_dash', form === 'fmp4' && data.hls_dash === true);
    applyEncoding(data, 'hls', set);
    if (data.hls_advanced === true) {
        set('hls_segment_seconds', String(data.hls_segment_seconds).trim());
        set('hls_window', String(data.hls_window).trim());
    }
    set('hls_serve', data.hls_serve !== false);
    if (data.hls_serve !== false) {
        set('hls_port', String(data.hls_port).trim());
        set('hls_max_connections', String(data.hls_max_connections).trim());
    }
    set('hls_keep_alive', data.hls_keep_alive !== false);
    const origin = originKind(data.hls_origin);
    set('hls_origin', origin);
    if (origin === 'http') {
        set('hls_origin_url', String(data.hls_origin_url).trim());
        set('hls_origin_user', String(data.hls_origin_user || '').trim());
        set('hls_origin_password', String(data.hls_origin_password || ''));
        set('hls_ca_file', String(data.hls_ca_file || '').trim());
    }
    if (origin === 's3') {
        set('hls_s3_endpoint', String(data.hls_s3_endpoint).trim());
        set('hls_s3_bucket', String(data.hls_s3_bucket).trim());
        set('hls_s3_prefix', String(data.hls_s3_prefix || '').trim().replace(/^\/+|\/+$/g, ''));
        set('hls_s3_region', String(data.hls_s3_region || '').trim() || 'us-east-1');
        set('hls_s3_access_key', String(data.hls_s3_access_key).trim());
        set('hls_s3_secret_key', String(data.hls_s3_secret_key));
        set('hls_s3_path_style', data.hls_s3_path_style !== false);
        set('hls_s3_ca_file', String(data.hls_s3_ca_file || '').trim());
    }
}

// The dashboard's address as the operator sets it: a host name or an IP address,
// nothing else (no scheme, no port, no path); empty means the address found here.
function checkDashboardHost(v, t) {
    const s = String(v == null ? '' : v).trim();
    if (s === '') return null;
    const name = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(s);
    const v6 = /^\[?[0-9A-Fa-f:]+\]?$/.test(s) && s.includes(':');
    return name || v6 ? null : t('ERR_DASHBOARD_HOST');
}

function validateMonitor(data, t) {
    return (data.mon_dashboard === true ? (checkPort(data.mon_dashboard_port, 'MON_DASHBOARD_PORT', t) || checkDashboardHost(data.mon_dashboard_host, t)) : null) ||
        (data.mon_enabled === false ? null : (checkSigned(data.mon_level, 'MON_LEVEL', t) || checkWhole(data.mon_seconds, 'MON_SECONDS', t))) ||
        null;
}

function applyMonitor(data, set) {
    // The dashboard's pair is kept when the page sent it; a save without it leaves it be.
    if (data.mon_dashboard !== undefined) {
        set('mon_dashboard', data.mon_dashboard === true);
        if (data.mon_dashboard === true) {
            set('mon_dashboard_port', String(data.mon_dashboard_port).trim());
            set('mon_dashboard_host', String(data.mon_dashboard_host == null ? '' : data.mon_dashboard_host).trim());
        }
    }
    set('mon_enabled', data.mon_enabled !== false);
    if (data.mon_enabled === false) return;
    set('mon_level', String(data.mon_level).trim());
    set('mon_seconds', String(data.mon_seconds).trim());
}

// The player's address on the network, for the dashboard's link: the first address
// of a wired interface, else of a wireless one, else any that is not the loopback.
function lanAddress(interfaces) {
    const all = [];
    Object.keys(interfaces || {}).forEach((name) => {
        (interfaces[name] || []).forEach((a) => {
            if (!a || a.internal) return;
            const v4 = a.family === 'IPv4' || a.family === 4;
            if (v4 && a.address) all.push({ name, address: a.address });
        });
    });
    const by = (re) => all.find((a) => re.test(a.name));
    const pick = by(/^(eth|en|eno|ens|enp)/) || by(/^(wlan|wl)/) || all[0];
    return pick ? pick.address : null;
}

// The two ways onto the dashboard from the Volumio page. The UI opens an openUrl
// button in a new tab, always, and on the player's own display or in the app that tab
// has no way back; the one button type the UI navigates in place is the oauth one,
// which sets the window's location to its performer URL (two query parameters the
// page ignores). So "here" goes to Volumio's own iframe page holding the dashboard,
// with the UI's arrow back; the page's address is the ui-router parameter, its
// slashes as ~2F. The address is the operator's when set, else the one found here.
function dashboardLinks(address, port, page) {
    const host = /:/.test(address) && !/^\[/.test(address) ? '[' + address + ']' : address;
    const url = 'http://' + host + ':' + String(port) + '/' + (page ? String(page).replace(/^\//, '') : '');
    return { url, here: 'http://' + host + '/iframe-page/' + url.replace(/\//g, '~2F') };
}

function validateRecord(data, t) {
    if (data.rec_enabled !== true) return null;
    const folder = String(data.rec_folder || '').trim();
    return (!/^\/\S/.test(folder) || /["\r\n]/.test(folder) ? t('ERR_FOLDER') : null) ||
        validateEncoding(data, 'rec', t) ||
        null;
}

// ------------------------------------------------------------- the settings kept
// What a save writes into the plugin's configuration: the page's data as plain values.

function applyIcecast(data, set, prefix) {
    const p = prefix || 'ice';
    const f = (k) => data[p + '_' + k];
    const put = (k, v) => set(p + '_' + k, v);
    const on = f('enabled') === true;
    put('enabled', on);
    if (!on) return;
    const shoutcast = protocolOf(data, p) === 'shoutcast1';
    put('protocol', shoutcast ? 'shoutcast1' : 'icecast2');
    put('host', String(f('host')).trim());
    put('port', String(f('port')).trim());
    if (shoutcast) put('stream_id', String(f('stream_id')).trim());
    else put('mount', String(f('mount')).trim());
    if (!shoutcast) put('user', String(f('user') || 'source').trim() || 'source');
    put('password', String(f('password')));
    applyEncoding(data, p, set);
    put('name', String(f('name') || '').trim());
    put('keep_alive', f('keep_alive') !== false);
    put('more', f('more') === true);
    if (f('more') === true) {
        put('description', String(f('description') || '').trim());
        put('genre', String(f('genre') || '').trim());
        put('url', String(f('url') || '').trim());
        put('public', f('public') === true);
    }
}

function applyLan(data, set) {
    const on = data.lan_enabled === true;
    set('lan_enabled', on);
    if (!on) return;
    set('lan_port', String(data.lan_port).trim());
    applyEncoding(data, 'lan', set);
    set('lan_name', String(data.lan_name || '').trim());
    set('lan_max_listeners', String(data.lan_max_listeners).trim());
    set('lan_keep_alive', data.lan_keep_alive !== false);
}

function applyRecord(data, set) {
    const on = data.rec_enabled === true;
    set('rec_enabled', on);
    if (!on) return;
    set('rec_folder', String(data.rec_folder).trim().replace(/\/+$/, '') || '/');
    applyEncoding(data, 'rec', set);
    set('rec_split', sel(data.rec_split));
    set('rec_title_in_name', data.rec_title_in_name !== false);
}

// The file the core reads, from the configuration: one object per uplink, in the
// core's own words (bins/outcast/src/config.rs).
// One Icecast slot for the core, from the configuration, by its prefix.
function icecastFrom(get, p) {
    const str = (k, d) => String(get(p + '_' + k, d));
    const bool = (k) => get(p + '_' + k, false) === true;
    return {
        enabled: bool('enabled'),
        protocol: str('protocol', 'icecast2') === 'shoutcast1' ? 'shoutcast1' : 'icecast2',
        host: str('host', ''),
        port: num(get(p + '_port', '8000'), 8000),
        mount: str('mount', '/volumio.mp3'),
        stream_id: num(get(p + '_stream_id', '1'), 1),
        user: str('user', 'source'),
        password: str('password', ''),
        ...encodingFrom(get, p),
        name: str('name', 'Volumio'),
        description: bool('more') ? str('description', '') : '',
        genre: bool('more') ? str('genre', '') : '',
        url: bool('more') ? str('url', '') : '',
        public: bool('more') && bool('public'),
        keep_alive: get(p + '_keep_alive', true) !== false
    };
}

function uplinksFrom(get) {
    const str = (k, d) => String(get(k, d));
    const bool = (k) => get(k, false) === true;
    return {
        icecast: icecastFrom(get, 'ice'),
        icecasts: ICE_SLOTS.slice(1).map((p) => icecastFrom(get, p)),
        lan: {
            enabled: bool('lan_enabled'),
            port: num(get('lan_port', '8000'), 8000),
            ...encodingFrom(get, 'lan'),
            name: str('lan_name', 'Volumio'),
            max_listeners: num(get('lan_max_listeners', '5'), 5),
            keep_alive: get('lan_keep_alive', true) !== false
        },
        record: {
            enabled: bool('rec_enabled'),
            folder: str('rec_folder', '/data/INTERNAL/outcast/recordings'),
            ...encodingFrom(get, 'rec'),
            split: str('rec_split', 'track'),
            title_in_name: get('rec_title_in_name', true) !== false
        },
        srt: {
            enabled: bool('srt_enabled'),
            host: str('srt_host', ''),
            port: num(get('srt_port', '9000'), 9000),
            stream_id: str('srt_stream_id', ''),
            passphrase: str('srt_passphrase', ''),
            latency_ms: num(get('srt_latency', '120'), 120),
            ...encodingFrom(get, 'srt'),
            keep_alive: get('srt_keep_alive', true) !== false
        },
        rtmp: {
            enabled: bool('rtmp_enabled'),
            url: str('rtmp_url', ''),
            stream_key: str('rtmp_key', ''),
            ca_file: str('rtmp_ca_file', ''),
            ...encodingFrom(get, 'rtmp'),
            keep_alive: get('rtmp_keep_alive', true) !== false
        },
        ts: {
            enabled: bool('ts_enabled'),
            transport: str('ts_transport', 'tcp') === 'udp' ? 'udp' : 'tcp',
            host: str('ts_host', ''),
            port: num(get('ts_port', '5004'), 5004),
            ttl: num(get('ts_ttl', '1'), 1),
            ...encodingFrom(get, 'ts'),
            keep_alive: get('ts_keep_alive', true) !== false
        },
        hls: {
            enabled: bool('hls_enabled'),
            name: str('hls_name', 'stream'),
            ...encodingFrom(get, 'hls'),
            segment_seconds: num(get('hls_segment_seconds', '4'), 4),
            window: num(get('hls_window', '6'), 6),
            form: str('hls_form', 'packed') === 'fmp4' ? 'fmp4' : 'packed',
            dash: get('hls_dash', false) === true,
            port: get('hls_serve', true) === false ? 0 : num(get('hls_port', '8010'), 8010),
            max_connections: num(get('hls_max_connections', '64'), 64),
            keep_alive: get('hls_keep_alive', true) !== false,
            origin: originKind(get('hls_origin', 'none')),
            origin_url: str('hls_origin_url', ''),
            origin_user: str('hls_origin_user', ''),
            origin_password: str('hls_origin_password', ''),
            ca_file: originKind(get('hls_origin', 'none')) === 's3' ? str('hls_s3_ca_file', '') : str('hls_ca_file', ''),
            s3_endpoint: str('hls_s3_endpoint', ''),
            s3_bucket: str('hls_s3_bucket', ''),
            s3_prefix: str('hls_s3_prefix', ''),
            s3_region: str('hls_s3_region', 'us-east-1'),
            s3_access_key: str('hls_s3_access_key', ''),
            s3_secret_key: str('hls_s3_secret_key', ''),
            s3_path_style: get('hls_s3_path_style', true) !== false
        },
        monitor: {
            dead_air_level: Number.isFinite(parseFloat(get('mon_level', '-60'))) ? parseFloat(get('mon_level', '-60')) : -60,
            dead_air_seconds: get('mon_enabled', true) === false ? 0 : num(get('mon_seconds', '30'), 30)
        },
        dashboard: {
            enabled: get('mon_dashboard', true) !== false,
            port: num(get('mon_dashboard_port', '8020'), 8020)
        }
    };
}

// A section switched off shows its switch and nothing else. The page shows a field
// when one other field has one value, and judges that value even when the other field
// is itself hidden, so a field behind a nested switch or select (Advanced, More
// settings, Serve on the player, the origin, the segment form) would still show while
// the section is off and the nested control stands where it stood. Every field whose
// condition is not the section's own switch is therefore marked hidden for the page
// as it is built; the first-level fields keep their live condition on the switch.
function hideWhenOff(content, prefix, get) {
    if (get(prefix + '_enabled', false) === true) return;
    const own = prefix + '_enabled';
    content.forEach((item) => {
        if (item.id === own) return;
        const on = item.visibleIf && item.visibleIf.field;
        if (on && on !== own) item.hidden = true;
    });
}

// -------------------------------------------------------------------- the status
// The status as lines for one toast: the core, the stream, the tap, each uplink.

function summarize(status, audioPath, audioPathError, t, tapNote) {
    const lines = [];
    if (!status) {
        lines.push(t('STATUS_CORE_DOWN'));
    } else if (status.ring) {
        lines.push(t('STATUS_PLAYING', {
            rate: status.ring.rate,
            channels: status.ring.channels,
            format: status.ring.format,
            segments: status.segments,
            mb: (status.bytes / 1048576).toFixed(1)
        }));
    } else {
        lines.push(t('STATUS_IDLE'));
    }
    if (status && status.level && Array.isArray(status.level.rms_db) && status.level.rms_db.length) {
        const top = (a) => Math.max(...a).toFixed(1);
        lines.push(t('STATUS_LEVEL', { peak: top(status.level.peak_db), rms: top(status.level.rms_db) }));
    }
    if (status && status.dead_air === true) lines.push(t('STATUS_DEAD_AIR', { seconds: status.quiet_seconds }));
    if (status && status.system) {
        const y = status.system;
        const vars = { cpu: Number(y.cpu_pct).toFixed(0), outcast: Number(y.outcast_cpu_pct).toFixed(1), mem: y.mem_total_mb ? (100 * y.mem_used_mb / y.mem_total_mb).toFixed(0) : '0' };
        if (y.temp_c != null) lines.push(t('STATUS_SYSTEM_TEMP', Object.assign(vars, { temp: Number(y.temp_c).toFixed(0) })));
        else lines.push(t('STATUS_SYSTEM', vars));
    }
    if (status && status.since && status.since.at) {
        const z = status.since;
        const when = new Date(z.at * 1000);
        lines.push(t('STATUS_SINCE', {
            time: String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0'),
            dead: z.dead_air_events || 0, reconnects: z.reconnects || 0, errors: z.errors || 0, overs: z.overs || 0
        }));
    }
    if (audioPath === 'ready') lines.push(t('STATUS_TAP_READY'));
    else if (audioPath === 'lost') lines.push(t('STATUS_TAP_LOST'));
    else lines.push(t('STATUS_TAP_FAILED', { error: audioPathError || '' }));
    if (audioPath === 'ready' && tapNote && tapNote.key) lines.push(t(tapNote.key, tapNote.vars || {}));
    const names = { icecast: 'UPLINK_ICECAST', lan: 'UPLINK_LAN', record: 'UPLINK_RECORD', srt: 'UPLINK_SRT', rtmp: 'UPLINK_RTMP', ts: 'UPLINK_TS', hls: 'UPLINK_HLS' };
    if (!status || !Array.isArray(status.uplinks) || status.uplinks.length === 0) {
        lines.push(t('STATUS_NO_UPLINKS'));
    } else {
        status.uplinks.forEach((u) => {
            const slot = /^icecast(\d+)$/.exec(u.id);
            const name = (names[u.kind] ? t(names[u.kind]) : u.id) + (slot ? ' ' + slot[1] : '');
            let detail = u.detail || '';
            if (u.kind === 'lan') detail += ', ' + u.listeners + ' listening';
            if (u.kind === 'srt' && u.state === 'connected') detail += ', ' + t('STATUS_SRT_LINK', { rtt: u.rtt_ms, lost: u.lost_packets });
            if (u.kind === 'hls' && u.segments) detail += ', ' + t('STATUS_HLS_SEGMENTS', { segments: u.segments, pending: u.pending || 0 });
            if (u.kind === 'hls' && u.dropped) detail += ', ' + t('STATUS_HLS_REFUSED', { refused: u.dropped });
            if (u.kind === 'hls' && u.last_error && u.state === 'streaming') detail += ', ' + u.last_error;
            if (u.silence) detail += ', silence';
            if (u.kind === 'record' && u.files) detail += ', ' + u.files + ' files';
            if (u.title) detail += ', ' + u.title;
            if (u.last_error && (u.state === 'error' || u.state === 'waiting')) {
                lines.push(t('STATUS_UPLINK_ERROR', { name, state: u.state, error: u.last_error }));
            } else {
                lines.push(t('STATUS_UPLINK', { name, state: u.state, detail }));
            }
        });
    }
    return lines;
}

module.exports = {
    screenTitle, checkConfig, chainHasTap, chainLibraries, lanAddress, dashboardLinks, fill, sel, PRESETS, DEFAULT_PRESET, ICE_SLOTS,
    validateIcecast, validateLan, validateRecord, validateMonitor, validateSrt, validateRtmp, validateTs, validateHls,
    applyIcecast, applyLan, applyRecord, applyMonitor, applySrt, applyRtmp, applyTs, applyHls, uplinksFrom, summarize, hideWhenOff
};
