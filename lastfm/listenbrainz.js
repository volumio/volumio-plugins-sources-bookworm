'use strict';

// Minimal ListenBrainz client used by the scrobbler plugin.
//
// - Only Node core modules (https/http), no extra dependencies.
// - Authentication is a user token sent in the Authorization header: there is no session to keep alive.
// - "now playing" is fire and forget; scrobbles go through a small queue that is retried with back-off
//   when the network or the server fails, so they are not lost.
// - Nothing in here throws into the caller: every failure is logged and reported through the callbacks.

var https = require('https');
var http = require('http');

var DEFAULT_BASE_URL = 'https://api.listenbrainz.org';

// Delays between retries of a failed submission: 30s, 1, 2, 5, 15 minutes, then every 30 minutes.
var RETRY_DELAYS_MS = [30000, 60000, 120000, 300000, 900000, 1800000];
// Scrobbles kept while ListenBrainz cannot be reached.
var MAX_PENDING = 50;
// A request without an answer after this time is abandoned (and retried later).
var REQUEST_TIMEOUT_MS = 30000;

var CLIENT_NAME = 'Volumio LastFM/ListenBrainz scrobbler plugin';
var CLIENT_VERSION = '';
try { CLIENT_VERSION = require('./package.json').version; } catch (e) { /* version is optional */ }

// options:
//   token       user token from https://listenbrainz.org/settings/
//   logger      Volumio logger (info/error)
//   isDebug     function returning true when extended logging is on
//   onScrobble  function(success, data, errorMessage, willRetry): result of a scrobble. success=true: sent;
//               success=false and willRetry=true: could not be sent now, it stays queued;
//               success=false and willRetry unset: refused by the server and dropped
//   onAuthError function(message): the token was rejected (called once until the token changes)
//   baseUrl, retryDelaysMs, requestTimeoutMs   optional, only meant for tests
function ListenBrainz(options)
{
    this.token = (options.token || '').trim();
    this.logger = options.logger;
    this.isDebug = options.isDebug || function () { return false; };
    this.onScrobble = options.onScrobble || function () {};
    this.onAuthError = options.onAuthError || function () {};
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.retryDelays = options.retryDelaysMs || RETRY_DELAYS_MS;
    this.requestTimeoutMs = options.requestTimeoutMs || REQUEST_TIMEOUT_MS;

    this.pending = [];
    this.sending = false;
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.authFailed = false;
    this.stopped = false;
    this.generation = 0;   // bumped on stop / token change: answers from older requests are ignored
    this.activeRequests = [];
}

ListenBrainz.prototype.log = function (msg)
{
    try { this.logger.info('[ListenBrainz] ' + msg); } catch (e) { /* logging must never break scrobbling */ }
};

ListenBrainz.prototype.logError = function (msg)
{
    try { this.logger.error('[ListenBrainz] ' + msg); } catch (e) { /* logging must never break scrobbling */ }
};

ListenBrainz.prototype.hasToken = function ()
{
    return this.token != '';
};

// Replaces the token (settings saved again): clears a previous authentication failure and sends what is waiting.
ListenBrainz.prototype.setToken = function (token)
{
    token = (token || '').trim();
    if (token == this.token)
        return;
    this.token = token;
    this.authFailed = false;
    this.generation++;
    this.sending = false;
    this.abortRequests();
    this.clearRetry();
    this.retryAttempt = 0;
    this.flush();
};

ListenBrainz.prototype.stop = function ()
{
    this.stopped = true;
    this.generation++;
    this.sending = false;
    this.abortRequests();
    this.clearRetry();
};

ListenBrainz.prototype.abortRequests = function ()
{
    var requests = this.activeRequests;
    this.activeRequests = [];
    requests.forEach(function (req) { try { req.destroy(); } catch (e) { /* already closed */ } });
};

ListenBrainz.prototype.clearRetry = function ()
{
    if (this.retryTimer)
    {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }
};

// Low level request ------------------------------------------------------------------------------------

// callback(error, statusCode, body, headers): error is set for network failures and timeouts only;
// an HTTP error status is reported through statusCode. body is the parsed JSON or null.
ListenBrainz.prototype.request = function (method, path, payload, callback)
{
    var self = this;
    var finished = false;
    var generation = self.generation;

    function done(error, status, body, headers)
    {
        if (finished)
            return;
        finished = true;
        // The plugin was stopped or the token changed while this request was running: drop the answer.
        if (generation !== self.generation)
            return;
        try { callback(error, status, body, headers); }
        catch (ex) { self.logError('unexpected error while handling a response: ' + ex); }
    }

    try
    {
        var base = new URL(self.baseUrl);
        var transport = base.protocol == 'http:' ? http : https;
        var data = payload ? JSON.stringify(payload) : null;
        var headers = {
            'Authorization': 'Token ' + self.token,
            'User-Agent': CLIENT_NAME + (CLIENT_VERSION ? '/' + CLIENT_VERSION : '')
        };
        if (data)
        {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(data);
        }

        var req = transport.request({
            protocol: base.protocol,
            hostname: base.hostname,
            port: base.port || (base.protocol == 'http:' ? 80 : 443),
            path: path,
            method: method,
            headers: headers
        }, function (res)
        {
            var chunks = [];
            res.on('data', function (chunk) { chunks.push(chunk); });
            res.on('error', function (err) { done(err); });
            res.on('end', function ()
            {
                var parsed = null;
                try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                catch (e) { /* empty or not JSON: the status code is what matters */ }
                done(null, res.statusCode, parsed, res.headers);
            });
        });

        self.activeRequests.push(req);
        function forget() { var i = self.activeRequests.indexOf(req); if (i > -1) self.activeRequests.splice(i, 1); }
        req.on('close', forget);
        req.setTimeout(self.requestTimeoutMs, function () { req.destroy(new Error('request timed out')); });
        req.on('error', function (err) { done(err); });
        if (data)
            req.write(data);
        req.end();
    }
    catch (ex)
    {
        done(ex);
    }
};

// Token check -----------------------------------------------------------------------------------------

// callback(result): { valid: true, userName } | { valid: false } | { error: 'message' } (could not be checked)
ListenBrainz.prototype.validateToken = function (callback)
{
    var self = this;
    if (!self.hasToken())
    {
        callback({ valid: false });
        return;
    }
    self.request('GET', '/1/validate-token', null, function (error, status, body)
    {
        if (error)
            callback({ error: String(error.message || error) });
        else if (status == 401 || (body && body.valid === false))
            callback({ valid: false });
        else if (status == 200 && body && body.valid === true)
            callback({ valid: true, userName: body.user_name });
        else
            callback({ error: 'unexpected answer (HTTP ' + status + ')' });
    });
};

// Payload ---------------------------------------------------------------------------------------------

function buildListen(track, listenedAt)
{
    var metadata = {
        artist_name: track.artist,
        track_name: track.title,
        additional_info: {
            media_player: 'Volumio',
            submission_client: CLIENT_NAME
        }
    };
    if (CLIENT_VERSION)
        metadata.additional_info.submission_client_version = CLIENT_VERSION;
    if (track.album)
        metadata.release_name = track.album;
    // Volumio reports the duration in seconds
    if (track.duration > 0)
        metadata.additional_info.duration_ms = Math.round(track.duration * 1000);

    var listen = { track_metadata: metadata };
    if (listenedAt)
        listen.listened_at = listenedAt;
    return listen;
}

// Now playing -----------------------------------------------------------------------------------------

// Not queued: a "now playing" that is late is useless, and the next one replaces it anyway.
ListenBrainz.prototype.nowPlaying = function (track)
{
    var self = this;
    if (self.stopped || self.authFailed || !self.hasToken())
        return;
    self.request('POST', '/1/submit-listens', { listen_type: 'playing_now', payload: [buildListen(track)] }, function (error, status, body)
    {
        if (error)
            self.logError('"now playing" failed: ' + (error.message || error));
        else if (status == 401)
            self.handleAuthError();
        else if (status != 200)
            self.logError('"now playing" rejected (HTTP ' + status + ')' + (body && body.error ? ': ' + body.error : ''));
        else if (self.isDebug())
            self.log('updated "now playing" | artist: ' + track.artist + ' | title: ' + track.title);
    });
};

// Scrobbles -------------------------------------------------------------------------------------------

// track: { artist, title, album, duration, timestamp } (timestamp = start of the playback, in seconds)
ListenBrainz.prototype.scrobble = function (track)
{
    var self = this;
    if (self.stopped)
        return;
    self.pending.push({
        artist: track.artist,
        title: track.title,
        album: track.album,
        duration: track.duration,
        timestamp: track.timestamp
    });
    if (self.pending.length > MAX_PENDING)
    {
        var dropped = self.pending.shift();
        self.logError('too many pending scrobbles, dropped: ' + dropped.artist + ' - ' + dropped.title);
    }
    self.flush();
};

// Sends the queued scrobbles one at a time, oldest first.
ListenBrainz.prototype.flush = function ()
{
    var self = this;
    if (self.stopped || self.sending || self.authFailed || !self.hasToken() || self.pending.length == 0)
        return;
    // A retry is already scheduled: it will take care of the queue, no need to hammer the server meanwhile.
    if (self.retryTimer)
        return;

    var item = self.pending[0];
    var generation = self.generation;
    self.sending = true;

    self.request('POST', '/1/submit-listens', { listen_type: 'single', payload: [buildListen(item, item.timestamp)] }, function (error, status, body, headers)
    {
        self.sending = false;
        if (generation !== self.generation || self.stopped)
            return;

        if (!error && status == 200)
        {
            self.pending.shift();
            self.retryAttempt = 0;
            if (self.isDebug())
                self.log('scrobble successful for: ' + item.artist + ' - ' + item.title);
            self.onScrobble(true, item);
            self.flush();
        }
        else if (!error && status == 401)
        {
            // Wrong or revoked token: keep the queue, nothing can be sent until the token is replaced.
            self.handleAuthError();
        }
        else if (!error && status >= 400 && status < 500 && status != 429 && status != 408)
        {
            // The server refuses this listen (for instance invalid metadata): retrying would never help.
            self.pending.shift();
            var reason = 'HTTP ' + status + (body && body.error ? ': ' + body.error : '');
            self.logError('scrobble rejected for ' + item.artist + ' - ' + item.title + ' (' + reason + ')');
            self.onScrobble(false, item, reason);
            self.flush();
        }
        else
        {
            // Network error, timeout, rate limit or server error: keep it and try again later.
            var why = error ? String(error.message || error) : 'HTTP ' + status;
            self.scheduleRetry(why, headers);
        }
    });
};

ListenBrainz.prototype.scheduleRetry = function (why, headers)
{
    var self = this;
    if (self.stopped)
        return;
    self.clearRetry();

    var delay = self.retryDelays[Math.min(self.retryAttempt, self.retryDelays.length - 1)];
    // When the server says how long to wait (rate limit), do not retry sooner than that.
    var serverDelay = headers ? parseFloat(headers['x-ratelimit-reset-in'] || headers['retry-after']) : NaN;
    if (!isNaN(serverDelay) && serverDelay > 0)
        delay = Math.max(delay, Math.min(serverDelay * 1000 + 1000, 1800000));
    self.retryAttempt++;

    self.logError('scrobble not sent (' + why + '), ' + self.pending.length + ' pending, retrying in ' + Math.round(delay / 1000) + 's (attempt ' + self.retryAttempt + ')');
    self.onScrobble(false, self.pending[0], why, true);
    self.retryTimer = setTimeout(function ()
    {
        self.retryTimer = null;
        self.flush();
    }, delay);
};

ListenBrainz.prototype.handleAuthError = function ()
{
    var self = this;
    if (self.authFailed)
        return;
    self.authFailed = true;
    self.logError('the token was rejected by ListenBrainz, nothing will be sent until it is replaced');
    self.onAuthError('The ListenBrainz token was rejected. Please check it in the plugin settings.');
};

module.exports = ListenBrainz;
