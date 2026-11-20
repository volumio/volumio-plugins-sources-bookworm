/* Mobile Remote - phone page: title/artist/album from Volumio, 20 buttons (5 x 4), volume, previous/pause/play/next */
(function () {
  'use strict';
  var POLL_MS = 1500;
  var $ = function (id) { return document.getElementById(id); };
  var pad = $('pad');
  var slider = $('slider');
  var now = document.querySelector('.now');
  var keys = [];
  var text = {};
  var holdUntil = 0;          // while the user operates the volume control, polling does not overwrite it
  var sendTimer = null;
  var pending = null;
  var timer = null;
  var forced = null;          // forced mode (simulation)
  var graphic = null;         // { light, dark } - addresses of the chosen picture or null

  function api(method, path, body) {
    var opts = { method: method, cache: 'no-store', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || String(res.status));
        return data;
      });
    });
  }

  function flash(node, cls) {
    node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, 450);
  }

  function press(n, node) {
    api('POST', 'api/press', { button: n }).then(function () { flash(node, 'sent'); })
      .catch(function () { flash(node, 'fail'); });
  }

  /**
   * Simulation in the web interface: ?theme=light|dark forces the mode (otherwise the page follows the device).
   */
  function applyTheme() {
    var m = /[?&]theme=(light|dark)\b/.exec(location.search);
    if (!m) return;
    document.documentElement.classList.add('theme-' + m[1]);
    forced = m[1];
  }

  function theme() {
    if (forced) return forced;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /** Above the volume control: the picture chosen by the user (light/dark), otherwise the word as text. */
  function showGraphic() {
    var img = $('gimg');
    var src = graphic && graphic[theme()];
    if (src) {
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      img.hidden = false;
      $('vtext').hidden = true;
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      $('vtext').hidden = false;
    }
  }

  function build(count) {
    for (var n = keys.length + 1; n <= count; n++) {
      (function (n) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'key';
        b.textContent = String(n);
        b.disabled = true;
        b.addEventListener('click', function () { press(n, b); });
        pad.appendChild(b);
        keys.push(b);
      })(n);
    }
  }

  function setText(id, value) {
    var node = $(id);
    var v = value || ' ';
    if (node.textContent !== v) node.textContent = v;
  }

  function render(st) {
    text = st.text || {};
    if (st.lang) document.documentElement.lang = String(st.lang).slice(0, 2);
    now.classList.remove('offline');
    setText('host', st.host);
    setText('ip', st.ip);
    setText('vtext', text.volume || 'Volume');
    graphic = st.graphic || null;
    showGraphic();
    var idle = !st.title && !st.artist && !st.album;
    setText('title', idle ? text.nothing : st.title);
    setText('artist', st.artist);
    setText('album', st.album);
    if ((st.buttons || []).length > keys.length) build(st.buttons.length);
    (st.buttons || []).forEach(function (b, i) {
      var node = keys[i];
      if (!node) return;
      var label = String(b.label || b.n);
      if (node.textContent !== label) node.textContent = label;
      node.classList.toggle('long', label.length > 6 && label.length <= 13);
      node.classList.toggle('xlong', label.length > 13);
      node.disabled = !b.on;
      node.setAttribute('aria-label', b.on ? label : (text.unassigned || '') + ' ' + b.n);
    });
    $('minus').setAttribute('aria-label', text.quieter || '-');
    $('plus').setAttribute('aria-label', text.louder || '+');
    slider.setAttribute('aria-label', text.volume || 'Volume');
    var hasVolume = typeof st.volume === 'number';
    slider.disabled = !hasVolume;
    $('minus').disabled = !hasVolume;
    $('plus').disabled = !hasVolume;
    document.body.classList.toggle('muted', st.mute === true);
    ['prev', 'pause', 'play', 'next'].forEach(function (a) { if (text[a]) $(a).setAttribute('aria-label', text[a]); });
    // what currently applies is highlighted: play while playing, pause while paused
    $('play').classList.toggle('cur', st.status === 'play');
    $('pause').classList.toggle('cur', st.status === 'pause');
    if (hasVolume && Date.now() > holdUntil) slider.value = String(st.volume);
  }

  function offline() {
    now.classList.add('offline');
    setText('title', text.offline || 'Volumio …');
    setText('artist', '');
    setText('album', '');
  }

  function poll() {
    clearTimeout(timer);
    if (document.hidden) return;
    api('GET', 'api/state').then(render, offline).then(function () {
      timer = setTimeout(poll, POLL_MS);
    });
  }

  /** Volume: while dragging send at most every 150 ms, the last value always. */
  function sendVolume(value) {
    holdUntil = Date.now() + 2500;
    pending = value;
    if (sendTimer) return;
    sendTimer = setTimeout(function () {
      sendTimer = null;
      var v = pending;
      pending = null;
      api('POST', 'api/volume', { value: v }).catch(function () { /* the next poll shows the real value */ });
    }, 150);
  }

  function step(dir) {
    // visible at once; Volumio delivers the real value with the next poll
    var v = Math.max(0, Math.min(100, parseInt(slider.value, 10) + (dir === '+' ? 1 : -1)));
    slider.value = String(v);
    holdUntil = Date.now() + 1200;
    api('POST', 'api/volume', { step: dir }).then(function () { setTimeout(poll, 250); }).catch(function () { /* ignore */ });
  }

  applyTheme();
  build(20);
  slider.addEventListener('input', function () { sendVolume(parseInt(slider.value, 10)); });
  slider.addEventListener('change', function () { sendVolume(parseInt(slider.value, 10)); });
  $('minus').addEventListener('click', function () { step('-'); });
  $('plus').addEventListener('click', function () { step('+'); });
  ['prev', 'pause', 'play', 'next'].forEach(function (a) {
    var node = $(a);
    node.addEventListener('click', function () {
      api('POST', 'api/transport', { action: a }).then(function () { setTimeout(poll, 300); })
        .catch(function () { flash(node, 'fail'); });
    });
  });
  $('gimg').addEventListener('error', function () { graphic = null; showGraphic(); });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', showGraphic);
  }
  document.addEventListener('visibilitychange', poll);
  window.addEventListener('pageshow', poll);
  poll();
})();
