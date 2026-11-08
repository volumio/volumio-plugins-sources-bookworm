/* Tastentest: LED je Taste der aktiven Profile */
(function () {
  'use strict';
  var el = X10.el;
  var cards = {};      // id -> card
  var unknown = {};    // device|type|code -> card
  var audioconf = {};  // Befehle aus audio.conf (nur lesend)

  function info0() { return X10.info() || {}; }

  /** Info, ob die Taste in audio.conf belegt ist. */
  function audioInfo(ev, c) {
    if (ev.type === 'scan') {
      // umgesetzte Scan-Code-Taste: Triggerhappy sieht die erzeugte Taste (ev.key)
      if (ev.event === 'press' && ev.key) {
        if (c && c.key.shielded && c.key.shown_key) {
          return X10.t('WEB_EV_THD_SHIELDED', { key: c.key.shown_key, out: ev.key });
        }
        var t = X10.audioText(ev.key, audioconf);
        var virt = (info0().virtual_keys || []).indexOf(ev.key) !== -1;
        if (t) return X10.t('WEB_EV_THD_AUDIO', { key: ev.key, cmd: t });
        return X10.t(virt ? 'WEB_EV_THD_VIRTUAL' : 'WEB_EV_THD_NONE', { key: ev.key });
      }
      return X10.t('WEB_EV_SCAN_ONLY');
    }
    var kn = ev.key_name || (c && c.key.key_name);
    var cmd = kn ? X10.audioText(kn, audioconf) : '';
    if (!cmd) return X10.t('WEB_EV_NOT_IN_AUDIO');
    if (ev.event === 'press' || ev.event === 'swallowed') return X10.t('WEB_EV_AUDIO_REPLACED', { cmd: cmd });
    return X10.t('WEB_EV_AUDIO', { cmd: cmd });
  }

  function card(vk, label, sub, extra) {
    var c = { n: 0 };
    c.led = el('div', { class: 'led' });
    c.count = el('span', { class: 'count', text: '0×' });
    c.node = el('div', { class: 'card tk' }, [c.led, el('div', { class: 'vk', text: vk }), el('div', { class: 'lab', text: label }),
      el('div', { class: 'meta' }, [el('span', { class: 'mono', text: sub }), c.count])].concat(extra || []));
    c.lab = c.node.querySelector('.lab');
    return c;
  }

  function hit(c, cls) {
    c.n++;
    c.count.textContent = c.n + '×';
    X10.flash(c.led, cls);
    X10.flash(c.node, 'on');
    c.node.classList.toggle('warn', cls === 'warn');
    c.node.classList.toggle('pass', cls === 'pass');
  }

  function render(state) {
    var box = X10.$('groups');
    var old = cards;
    cards = {};
    box.textContent = '';
    var groups = {};
    state.keys.forEach(function (k) { (groups[k.profile] = groups[k.profile] || { name: k.profile_name, keys: [] }).keys.push(k); });
    Object.keys(groups).forEach(function (pid) {
      var g = groups[pid];
      var grid = el('div', { class: 'grid' });
      g.keys.forEach(function (k) {
        var vk = k.mode === 'emit' ? (k.shown_key || k.key) : (k.mode === 'swallow' ? X10.t('WEB_LOCKED') : (k.mode === 'default' ? (k.key || X10.source(k)) : '–'));
        var c = card(vk, k.label + (k.remote_label ? '  [' + k.remote_label + ']' : ''), X10.source(k) + ' · ' + k.device,
          [el('div', { class: 'muted', text: k.action }),
            k.shielded ? el('div', { class: 'muted', text: X10.t('WEB_THD_SHIELDED_TAG', { out: k.key }) }) : null,
            k.description ? el('div', { class: 'muted', text: k.description }) : null]);
        c.key = k;
        if (old[k.id]) { c.n = old[k.id].n; c.count.textContent = c.n + '×'; }
        cards[k.id] = c;
        grid.appendChild(c.node);
      });
      box.appendChild(el('h2', { text: g.name }));
      box.appendChild(grid);
    });
    if (!state.keys.length) box.appendChild(el('div', { class: 'note warn', text: X10.t('WEB_TEST_NO_PROFILES') }));
  }

  function findBy(device, type, code) {
    var ids = Object.keys(cards);
    for (var i = 0; i < ids.length; i++) {
      var k = cards[ids[i]].key;
      if (k.device === device && k.type === type && Number(k.code) === Number(code)) return cards[ids[i]];
    }
    return null;
  }

  function last(cls, big, sub) {
    X10.$('lastKey').textContent = big;
    X10.$('lastSub').textContent = sub;
    X10.$('lastLed').className = 'led';
    X10.flash(X10.$('lastLed'), cls);
  }

  function cfgButton(ev) {
    return el('button', { class: 'small cfg', type: 'button', text: X10.t('WEB_CONFIGURE'), onclick: function () {
      X10.configureKey({ device: ev.device, type: ev.type, code: ev.code, key_name: ev.key_name, scan: ev.scan }, function () {
        var u = unknown[ev.device + '|' + ev.code];
        if (ev.type === 'scan' && u) {           // jetzt konfiguriert: aus "Unbekannte Tasten" entfernen
          u.node.remove();
          delete unknown[ev.device + '|' + ev.code];
        }
        load();
      });
    } });
  }

  function log(cls, text, ev, info) {
    var box = X10.$('log');
    box.insertBefore(el('div', null, [el('span', { class: 't', text: new Date().toLocaleTimeString() }), el('span', { class: cls, text: text }),
      info ? el('span', { class: 'ai', text: '  ·  ' + info }) : null,
      ev && ev.device && ev.type ? cfgButton(ev) : null]), box.firstChild);
    while (box.childNodes.length > 200) box.removeChild(box.lastChild);
  }

  function onEvent(ev) {
    var c;
    var info;
    var src = X10.source({ type: ev.type, code: ev.code, key_name: ev.key_name });
    if (ev.event === 'press') {
      c = cards[ev.id] || findBy(ev.device, ev.type, ev.code);
      if (c) hit(c, 'on');
      info = audioInfo(ev, c);
      var shown = c && c.key.shown_key ? c.key.shown_key : ev.key;
      last('on', shown, (ev.label ? ev.label + ' · ' : '') + src + ' · ' + ev.device + (c ? ' · ' + c.key.action : '') + ' · ' + info);
      log('m', ev.device + '  ' + src + '  →  ' + shown, ev, info);
    } else if (ev.event === 'swallowed') {
      c = cards[ev.id] || findBy(ev.device, ev.type, ev.code);
      if (c) hit(c, 'stop');
      info = audioInfo(ev, c);
      last('stop', X10.t('WEB_LOCKED'), (ev.label ? ev.label + ' · ' : '') + src + ' · ' + ev.device + ' · ' + info);
      log('s', ev.device + '  ' + src + '  →  ' + X10.t('WEB_LOCKED'), ev, info);
    } else if (ev.event === 'passthrough') {
      c = findBy(ev.device, 'key', ev.code);
      if (c) hit(c, 'pass');
      info = audioInfo(ev, c);
      last('pass', ev.key_name, X10.t('WEB_PASSTHROUGH') + ' · ' + ev.device + ' · ' + info);
      log('p', ev.device + '  ' + ev.key_name + '  →  ' + X10.t('WEB_PASSTHROUGH'), ev, info);
    } else if (ev.event === 'unmapped') {
      c = findBy(ev.device, 'scan', ev.code);
      if (c) {
        hit(c, 'warn');
      } else {
        var id = ev.device + '|' + ev.code;
        var u = unknown[id];
        if (!u) {
          var empty = X10.$('unknownEmpty');
          if (empty) empty.remove();
          u = unknown[id] = card(src, X10.t('WEB_NOT_MAPPED'), ev.device, [cfgButton(ev)]);
          X10.$('unknown').appendChild(u.node);
        }
        hit(u, 'warn');
      }
      info = audioInfo(ev, c);
      last('warn', src, X10.t('WEB_NOT_MAPPED') + ' · ' + ev.device + ' · ' + info);
      log('u', ev.device + '  ' + src + '  →  ' + X10.t('WEB_NOT_MAPPED'), ev, info);
    } else if (ev.event === 'reload') {
      load();
    }
  }

  function load() {
    return Promise.all([X10.api('GET', 'api/state'), X10.api('GET', 'api/audioconf'), X10.api('GET', 'api/info')]).then(function (r) {
      audioconf = r[1] || {};
      var note = X10.$('exclNote');
      if (!note) {
        note = el('div', { id: 'exclNote', class: 'note hidden', text: X10.t('WEB_EXCL_NOTE') });
        X10.$('last').parentNode.insertBefore(note, X10.$('last'));
      }
      note.classList.toggle('hidden', !(r[2] && r[2].thd_mode === 'on'));
      render(r[0]);
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  X10.$('btnClear').addEventListener('click', function () {
    X10.$('log').textContent = '';
    Object.keys(cards).forEach(function (id) { cards[id].n = 0; cards[id].count.textContent = '0×'; });
    Object.keys(unknown).forEach(function (id) { unknown[id].node.remove(); });
    unknown = {};
  });

  X10.init('test').then(load).then(function () { X10.events(onEvent); })
    .catch(function (e) { X10.toast(X10.errText(e), 'err'); });
})();
