'use strict';

// Station logos from the broadcasters themselves, found through RadioDNS.
//
// A broadcast service is named by identifiers it transmits. RadioDNS turns them into a
// DNS name; that name leads to the broadcaster, who publishes a list of its services
// (SI.xml) with their logos. Nothing is kept or licensed by this plugin: the pictures
// come from whoever runs the station.
//
//   DAB: <scids>.<sid>.<eid>.<gcc>.dab.radiodns.org
//   FM:  <frequency>.<pi>.<gcc>.fm.radiodns.org
//
// gcc is the service's country digit followed by the extended country code of its
// country. A receiver learns the extended code from the broadcast; the decoder here does
// not hand it on, so the few codes of the listener's part of the world are tried in turn.

var dns = require('dns');
var http = require('http');
var https = require('https');

// The extended country codes by part of the world, as the RDS and DAB standards assign
// them. Asia and the Pacific share one block: Australia is F0, New Zealand F1, Japan F2.
var EXTENDED_CODES = {
  europe: ['e1', 'e0', 'e2', 'e3', 'e4'],
  americas: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
  asia_pacific: ['f0', 'f1', 'f2', 'f3', 'f4'],
  africa: ['d0', 'd1', 'd2', 'd3']
};

// The plugin's FM region setting, as a hint of where the listener is
var REGION_OF_SETTING = {
  europe: 'europe', italy: 'europe', oirt: 'europe',
  americas: 'americas',
  japan: 'asia_pacific', east_asia: 'asia_pacific', australia: 'asia_pacific'
};

var TIMEOUT = 10000;
var SI_MAX_BYTES = 4 * 1024 * 1024;
var IMAGE_MAX_BYTES = 2 * 1024 * 1024;

// The gcc values to try for a service, likeliest first.
// countryDigit: the first hex digit of a DAB service id or of an FM PI code.
function gccCandidates(countryDigit, regionSetting) {
  var digit = String(countryDigit).toLowerCase();
  if (!/^[1-9a-f]$/.test(digit)) {
    return [];
  }
  var first = REGION_OF_SETTING[regionSetting] || 'europe';
  var regions = [first].concat(Object.keys(EXTENDED_CODES).filter(function(r) { return r !== first; }));
  var list = [];
  regions.forEach(function(region) {
    EXTENDED_CODES[region].forEach(function(code) {
      list.push(digit + code);
    });
  });
  return list;
}

function hex(value, digits) {
  var text = String(value).toLowerCase().replace(/^0x/, '');
  return new RegExp('^[0-9a-f]{' + digits + '}$').test(text) ? text : null;
}

// The bearer of a DAB service as SI.xml writes it, or null when an identifier is not
// what such identifiers look like.
function dabBearer(gcc, ensembleId, serviceId, component) {
  var eid = hex(ensembleId, 4);
  var sid = hex(serviceId, 4) || hex(serviceId, 8);
  if (!/^[0-9a-f]{3}$/.test(gcc) || !eid || !sid) {
    return null;
  }
  return 'dab:' + gcc + '.' + eid + '.' + sid + '.' + (component || 0);
}

function dabName(gcc, ensembleId, serviceId, component) {
  var bearer = dabBearer(gcc, ensembleId, serviceId, component);
  if (!bearer) {
    return null;
  }
  return bearer.slice(4).split('.').reverse().join('.') + '.dab.radiodns.org';
}

// frequency in MHz; the name carries it in units of 10 kHz, five digits
function fmBearer(gcc, pi, frequency) {
  var code = hex(pi, 4);
  var units = Math.round(parseFloat(frequency) * 100);
  if (!/^[0-9a-f]{3}$/.test(gcc) || !code || !(units >= 6500 && units <= 10800)) {
    return null;
  }
  return 'fm:' + gcc + '.' + code + '.' + ('00000' + units).slice(-5);
}

function fmName(gcc, pi, frequency) {
  var bearer = fmBearer(gcc, pi, frequency);
  if (!bearer) {
    return null;
  }
  return bearer.slice(3).split('.').reverse().join('.') + '.fm.radiodns.org';
}

// The pictures a piece of SI.xml lists: [{ url, width, height, mime }]
function multimediaOf(fragment) {
  return (fragment.match(/<multimedia\b[^>]*>/g) || []).map(function(tag) {
    function attribute(name) {
      var found = new RegExp('\\b' + name + '="([^"]*)"').exec(tag);
      return found ? found[1].replace(/&amp;/g, '&') : null;
    }
    return {
      url: attribute('url'),
      width: parseInt(attribute('width'), 10) || 0,
      height: parseInt(attribute('height'), 10) || 0,
      mime: attribute('mimeValue') || ''
    };
  }).filter(function(logo) {
    return logo.url && /^https?:\/\//i.test(logo.url);
  });
}

function servicesOf(siXml) {
  return siXml.match(/<service\b[\s\S]*?<\/service>/g) || [];
}

function bearersOf(service) {
  return (service.match(/<bearer\b[^>]*>/g) || []).map(function(tag) {
    var id = /\bid="([^"]*)"/.exec(tag);
    return id ? id[1].toLowerCase() : '';
  });
}

// The service of a list that is broadcast on the given bearer, or null. An FM programme
// is named by its country and PI code; the frequency only says where it is heard, and
// lists name some of a programme's frequencies, all of them, or none ("*").
function serviceOf(siXml, bearer) {
  var wanted = bearer.toLowerCase();
  var programme = /^(fm:[0-9a-f]{3}\.[0-9a-f]{4}\.)/.exec(wanted);
  var services = servicesOf(siXml);
  for (var i = 0; i < services.length; i++) {
    var carried = bearersOf(services[i]).some(function(listed) {
      return listed === wanted || (programme && listed.indexOf(programme[1]) === 0);
    });
    if (carried) {
      return services[i];
    }
  }
  return null;
}

// The logos SI.xml lists for the service with the given bearer: [{ url, width, height, mime }]
function logosOf(siXml, bearer) {
  var service = serviceOf(siXml, bearer);
  return service ? multimediaOf(service) : [];
}

// What a list calls a service: the name made for a display of 16 characters, failing
// that the long one, failing that the short one
function nameOf(service) {
  return textOf(service, 'mediumName') || textOf(service, 'longName') || textOf(service, 'shortName');
}

// Every DAB service of a list that has a logo, by country and service id:
// { '<gcc>.<sid>': logo url }. A service id names the same station on every ensemble that
// carries it, so a station heard on an ensemble its broadcaster did not register can
// still be given its logo.
function dabServicesOf(siXml) {
  var found = {};
  servicesOf(siXml).forEach(function(service) {
    var logo = null;
    bearersOf(service).forEach(function(bearer) {
      var parts = /^dab:([0-9a-f]{3})\.[0-9a-f]{4}\.([0-9a-f]{4}|[0-9a-f]{8})\.[0-9a-f]$/.exec(bearer);
      if (!parts) {
        return;
      }
      logo = logo || bestLogo(multimediaOf(service));
      if (logo) {
        found[parts[1] + '.' + parts[2]] = logo.url;
      }
    });
  });
  return found;
}

// Every FM programme of a list that has a logo, by country and PI code:
// { '<gcc>.<pi>': { url, name } }, name being what the list calls the programme
function fmServicesOf(siXml) {
  var found = {};
  servicesOf(siXml).forEach(function(service) {
    var logo = null;
    bearersOf(service).forEach(function(bearer) {
      var parts = /^fm:([0-9a-f]{3})\.([0-9a-f]{4})\./.exec(bearer);
      if (!parts) {
        return;
      }
      logo = logo || bestLogo(multimediaOf(service));
      if (logo) {
        found[parts[1] + '.' + parts[2]] = { url: logo.url, name: nameOf(service) || null };
      }
    });
  });
  return found;
}

// Every service of a list that has a logo, by the names the list gives it:
// { '<name>': { url, small } }, url being the logo to show and small the one to show
// among many (the square one nearest 128 pixels). The short name (8 characters) is left
// out: it abbreviates, and abbreviations of different stations look alike.
function namedServicesOf(siXml) {
  var found = {};
  servicesOf(siXml).forEach(function(service) {
    var logos = multimediaOf(service);
    var logo = bestLogo(logos);
    if (!logo) {
      return;
    }
    var small = logos.filter(function(l) { return l.width >= 64 && l.width === l.height; })
      .sort(function(a, b) { return Math.abs(a.width - 128) - Math.abs(b.width - 128); })[0] || logo;
    ['mediumName', 'longName'].forEach(function(tag) {
      var name = textOf(service, tag);
      if (name && !(name in found)) {
        found[name] = { url: logo.url, small: small.url };
      }
    });
  });
  return found;
}

// Whether a name begins with the given words and goes on, if at all, with something that
// is not a letter: "BBC Radio 4" and "BBC6" begin with "BBC", "BBCX" does not.
function startsWith(name, lead) {
  var text = String(name).toLowerCase();
  var words = String(lead).toLowerCase();
  if (!words || text.indexOf(words) !== 0) {
    return false;
  }
  var next = text.charAt(words.length);
  return next === '' || next.toLowerCase() === next.toUpperCase();
}

function textOf(fragment, tag) {
  var found = new RegExp('<' + tag + '\\b[^>]*>([^<]*)<').exec(fragment);
  return found ? found[1].replace(/&amp;/g, '&').trim() : '';
}

// What a list says of the broadcaster itself: { names, leads, logo }.
// names: what the broadcaster calls itself. leads: those of its names that most of its
// own stations carry in front ("BBC" does; "Global", whose stations are Heart, Capital
// and so on, does not), which is what makes such a name a sign of belonging.
// logo: the url of the broadcaster's own logo, or null.
function providerOf(siXml) {
  var entry = /<serviceProvider\b[\s\S]*?<\/serviceProvider>/.exec(siXml);
  if (!entry) {
    return { names: [], leads: [], logo: null };
  }
  var names = [];
  ['shortName', 'mediumName'].forEach(function(tag) {
    var name = textOf(entry[0], tag);
    if (name && names.indexOf(name) === -1) {
      names.push(name);
    }
  });

  var services = servicesOf(siXml);
  var leads = names.filter(function(name) {
    if (name.length < 3) {
      return false;
    }
    var carrying = services.filter(function(service) {
      return ['shortName', 'mediumName', 'longName'].some(function(tag) {
        return startsWith(textOf(service, tag), name);
      });
    }).length;
    return carrying >= 2 && carrying * 2 >= services.length;
  });

  var logo = bestLogo(multimediaOf(entry[0]));
  return { names: names, leads: leads, logo: logo ? logo.url : null };
}

// The logos worth showing, the best first: a square one of the size screens ask for
// (600 pixels, the largest the standard defines), then the larger squares, then the
// smaller ones, then whatever else is not a banner.
var LOGO_SIZE = 600;

function rankLogos(logos) {
  var square = logos.filter(function(l) { return l.width > 0 && l.width === l.height; });
  var enough = square.filter(function(l) { return l.width >= LOGO_SIZE; })
    .sort(function(a, b) { return a.width - b.width; });
  var smaller = square.filter(function(l) { return l.width < LOGO_SIZE; })
    .sort(function(a, b) { return b.width - a.width; });
  var others = logos.filter(function(l) { return l.height > 0 && l.width !== l.height && l.width / l.height <= 2; })
    .sort(function(a, b) { return b.width * b.height - a.width * a.height; });
  return enough.concat(smaller, others);
}

function bestLogo(logos) {
  return rankLogos(logos)[0] || null;
}

// --- the network, replaceable for tests -------------------------------------------------

// Node reads the system's name servers when a resolver is made. One made after the
// player changed networks knows the servers of the network that is there now, so a new
// one is made at every check of the network.
var resolver = null;

function freshResolver() {
  resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
  return resolver;
}

// Whether RadioDNS can be asked at all. The name servers of its own zone are looked up:
// a network that is down gives none, and neither does a hotspot or a sign-in page that
// answers every name with its own address.
function reachable() {
  return freshResolver().resolveNs('radiodns.org').then(function(servers) {
    return servers.length > 0;
  }, function() {
    return false;
  });
}

// "There is no such name" is an answer; anything else is a failure of the network
function noSuchName(error) {
  return !!error && (error.code === 'ENOTFOUND' || error.code === 'ENODATA');
}

// The broadcaster a service name leads to: { host, port }, or null when the service is
// not registered. Rejects when the network gave no answer.
function resolveProvider(name) {
  var use = resolver || freshResolver();
  return use.resolveCname(name).then(function(names) {
    return use.resolveSrv('_radioepg._tcp.' + names[0]).then(function(records) {
      if (!records.length) {
        return null;
      }
      records.sort(function(a, b) { return a.priority - b.priority; });
      return { host: records[0].name, port: records[0].port };
    });
  }).catch(function(error) {
    if (noSuchName(error)) {
      return null;
    }
    throw error;
  });
}

// known: { etag, modified } of the copy already held; the answer is then
// { unchanged: true } when the server says it has nothing newer.
function get(url, maxBytes, known, redirects) {
  return new Promise(function(resolve, reject) {
    var client = /^https:/i.test(url) ? https : http;
    var headers = { 'User-Agent': 'rtlsdr_radio (Volumio plugin)' };
    if (known && known.etag) {
      headers['If-None-Match'] = known.etag;
    } else if (known && known.modified) {
      headers['If-Modified-Since'] = known.modified;
    }
    var request = client.get(url, { timeout: TIMEOUT, headers: headers }, function(response) {
      var status = response.statusCode;
      if (status >= 300 && status < 400 && status !== 304 && response.headers.location && (redirects || 0) < 4) {
        response.resume();
        resolve(get(new URL(response.headers.location, url).toString(), maxBytes, known, (redirects || 0) + 1));
        return;
      }
      if (status === 304 && known) {
        response.resume();
        resolve({ unchanged: true });
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(Object.assign(new Error('HTTP ' + status + ' for ' + url), { status: status }));
        return;
      }
      var chunks = [];
      var size = 0;
      response.on('data', function(chunk) {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error('answer larger than ' + maxBytes + ' bytes'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', function() {
        resolve({
          body: Buffer.concat(chunks),
          type: String(response.headers['content-type'] || ''),
          etag: response.headers.etag || null,
          modified: response.headers['last-modified'] || null
        });
      });
    });
    request.on('timeout', function() { request.destroy(new Error('timeout for ' + url)); });
    request.on('error', reject);
  });
}

// A lookup with its own short memory of the service lists it has fetched, so that the
// stations of one broadcaster cost one download. onList(url, xml) is called once for
// every list fetched; forget() drops the lists when the work is done.
function Lookup(network) {
  this.network = network || { reachable: reachable, resolveProvider: resolveProvider, get: get };
  this.lists = {};
  this.onList = null;
}

Lookup.prototype.reachable = function() {
  return this.network.reachable ? this.network.reachable() : Promise.resolve(true);
};

Lookup.prototype.forget = function() {
  this.lists = {};
};

function listUrl(provider) {
  var port = provider.port === 80 || provider.port === 443 ? '' : ':' + provider.port;
  return (provider.port === 443 ? 'https' : 'http') + '://' + provider.host + port + '/radiodns/spi/3.1/SI.xml';
}

Lookup.prototype._list = function(provider) {
  return this.listAt(listUrl(provider));
};

// A broadcaster's list by its address, as an earlier lookup named it
Lookup.prototype.listAt = function(url) {
  var self = this;
  if (!self.lists[url]) {
    self.lists[url] = self.network.get(url, SI_MAX_BYTES).then(function(answer) {
      var xml = answer.body.toString('utf8');
      // A sign-in page of a guest network answers for every address; it is not a list
      if (xml.indexOf('<serviceInformation') === -1) {
        throw new Error('not a service list: ' + url);
      }
      if (self.onList) {
        self.onList(url, xml);
      }
      return xml;
    });
    self.lists[url].catch(function() { delete self.lists[url]; });
  }
  return self.lists[url];
};

// Find the logos of a service. candidates: [{ gcc, name, bearer }], tried in turn.
// Resolves with { gcc, list, logos: [{ url, width, height, mime }], called } for a service
// whose broadcaster is found (list names the broadcaster's service list; logos are the
// ones worth showing, the best first; called is what the list calls the service, or
// null), or with null when the service is not registered.
// Rejects when the network gave no answer: that is not an answer about the station.
Lookup.prototype.find = function(candidates) {
  var self = this;
  var at = 0;

  function next() {
    if (at >= candidates.length) {
      return Promise.resolve(null);
    }
    var candidate = candidates[at++];
    return self.network.resolveProvider(candidate.name).then(function(provider) {
      if (!provider) {
        return next();
      }
      // The broadcaster is found; whether it lists a logo or not, the search ends here
      return self._list(provider).then(function(xml) {
        var service = serviceOf(xml, candidate.bearer);
        return {
          gcc: candidate.gcc,
          list: listUrl(provider),
          logos: rankLogos(service ? multimediaOf(service) : []),
          called: service ? nameOf(service) || null : null
        };
      });
    });
  }
  return next();
};

// Fetch the picture itself. known: { etag, modified } of the copy already held.
// Resolves with { body, extension, etag, modified }, or { unchanged: true }. A picture of
// a kind that cannot be shown is rejected with error.unusable set.
Lookup.prototype.fetchImage = function(url, known) {
  return this.network.get(url, IMAGE_MAX_BYTES, known).then(function(answer) {
    if (answer.unchanged) {
      return { unchanged: true };
    }
    var body = answer.body;
    var extension = null;
    if (body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) {
      extension = 'png';
    } else if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8) {
      extension = 'jpg';
    }
    if (!extension) {
      // A page of text is some server's way of saying no; anything else is a picture
      // of another kind
      throw Object.assign(new Error('not a PNG or JPEG picture: ' + url), { unusable: !/^text\//i.test(answer.type || '') });
    }
    return { body: body, extension: extension, etag: answer.etag || null, modified: answer.modified || null };
  });
};

function dabCandidates(ensembleId, serviceId, regionSetting, knownGcc) {
  var sid = hex(serviceId, 4) || hex(serviceId, 8);
  if (!sid) {
    return [];
  }
  // A 16-bit service id starts with the country digit; a 32-bit one carries the
  // extended code in its first two digits and the country digit third
  var gccs = sid.length === 8 ? [sid[2] + sid.slice(0, 2)] : gccCandidates(sid[0], regionSetting);
  if (knownGcc && gccs.indexOf(knownGcc) !== -1) {
    gccs = [knownGcc].concat(gccs.filter(function(g) { return g !== knownGcc; }));
  }
  return gccs.map(function(gcc) {
    return { gcc: gcc, name: dabName(gcc, ensembleId, sid), bearer: dabBearer(gcc, ensembleId, sid) };
  }).filter(function(candidate) { return candidate.name; });
}

function fmCandidates(pi, frequency, regionSetting, knownGcc) {
  var code = hex(pi, 4);
  if (!code) {
    return [];
  }
  var gccs = gccCandidates(code[0], regionSetting);
  if (knownGcc && gccs.indexOf(knownGcc) !== -1) {
    gccs = [knownGcc].concat(gccs.filter(function(g) { return g !== knownGcc; }));
  }
  return gccs.map(function(gcc) {
    return { gcc: gcc, name: fmName(gcc, code, frequency), bearer: fmBearer(gcc, code, frequency) };
  }).filter(function(candidate) { return candidate.name; });
}

module.exports = {
  Lookup: Lookup,
  gccCandidates: gccCandidates,
  dabName: dabName,
  dabBearer: dabBearer,
  fmName: fmName,
  fmBearer: fmBearer,
  dabCandidates: dabCandidates,
  fmCandidates: fmCandidates,
  logosOf: logosOf,
  dabServicesOf: dabServicesOf,
  fmServicesOf: fmServicesOf,
  namedServicesOf: namedServicesOf,
  providerOf: providerOf,
  startsWith: startsWith,
  rankLogos: rankLogos,
  bestLogo: bestLogo
};
