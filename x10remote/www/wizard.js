/*
 * Read-in wizard:
 *   1 transmitter/profile (name, description, notes, 433 MHz) -> 2 detect and name the receiver ->
 *   3 read in the keys one after another, name and assign each at once -> "Done" saves -> 4 pictures.
 * With ?profile=<id> keys are added to an existing profile (starts at step 3).
 *
 * Detecting: the mapper only grabs remote-like devices; keyboards are only observed, mice and
 * touchscreens not at all (a kiosk display stays usable). A device only counts as detected when the
 * same key arrives twice or the user clicks "Use". After that only this device is grabbed: none of
 * its keys triggers anything while being read in (not even the power key).
 */
(function () {
  'use strict';
  var el = X10.el;
  var device = null;            // { id, name } - USB device of the receiver
  var receiver = null;          // receiver entry (after step 2)
  var receiverList = [];
  var existing = null;          // profile when extending one
  var keys = [];                // keys read in (X10.normKey)
  var current = null;           // { key, isNew } - key in the editor
  var editor = null;
  var audioconf = {};
  var serverUsed = {};          // Triggerhappy keys of other profiles
  var mode = 'idle';            // idle | identify | capture
  var keepTimer = null;
  var identifyTimer = null;
  var dirty = false;
  var saved = null;             // saved profile (step 4)
  var lastGrab = null;
  var candidate = null;         // detecting: { id, name, code, t } - waits for confirmation

  function step(n) {
    [1, 2, 3, 4].forEach(function (i) {
      X10.$('step' + i).classList.toggle('hidden', i !== n);
      X10.$('st' + i).className = i === n ? 'on' : (i < n ? 'done' : '');
    });
    window.scrollTo(0, 0);
  }

  function stopCapture() {
    clearInterval(keepTimer);
    clearInterval(identifyTimer);
    keepTimer = identifyTimer = null;
    var was = mode;
    mode = 'idle';
    X10.$('identifyRun').classList.add('hidden');
    X10.$('btnIdentify').disabled = false;
    if (was !== 'idle') return X10.api('POST', 'api/capture/stop', {}).catch(function () {});
    return Promise.resolve();
  }

  function keepAlive() {
    clearInterval(keepTimer);
    keepTimer = setInterval(function () {
      X10.api('POST', 'api/capture/keepalive', {}).catch(function () {});
    }, 20000);
  }

  /** Notice whether the keys are locked while being read in. */
  function showGrab(grab) {
    lastGrab = grab;
    ['grabNote', 'grabNote3'].forEach(function (id) {
      var box = X10.$(id);
      box.textContent = '';
      if (!grab) return;
      box.appendChild(el('div', { class: 'note ' + (grab.ok ? 'ok' : 'warn'),
        text: grab.ok ? X10.t('WEB_WIZ_GRAB_OK') : X10.t('WEB_WIZ_GRAB_FAIL', {
          list: (grab.devices || []).filter(function (d) { return !d.grabbed; }).map(function (d) { return d.name + (d.error ? ' (' + d.error + ')' : ''); }).join(', ') || '–' }) }));
    });
  }

  // ------------------------------------------------------------- 1 · profile
  function toStep2() {
    var name = X10.$('pName').value.trim();
    if (!name) {
      X10.toast(X10.t('ERR_NAME_REQUIRED'), 'warn');
      X10.$('pName').focus();
      return;
    }
    step(2);
    if (!device) showChooser();
    loadDevices();
  }

  // ------------------------------------------------------- 2 · receiver
  function showChooser() {
    X10.$('recvPanel').classList.add('hidden');
    X10.$('recvChoose').classList.remove('hidden');
  }

  function loadDevices() {
    var box = X10.$('devices');
    box.textContent = '';
    return Promise.all([X10.api('GET', 'api/devices'), X10.api('GET', 'api/receivers')]).then(function (res) {
      receiverList = res[1] || [];
      var devs = res[0].devices;
      if (!devs.length) box.appendChild(el('div', { class: 'muted', text: X10.t('WEB_WIZ_NO_DEVICES') }));
      devs.forEach(function (d) {
        var r = recvFor(d.id);
        box.appendChild(el('label', null, [
          el('div', { class: 'spacer' }, [el('div', { text: r ? r.name : (d.name || d.id) }),
            el('div', { class: 'muted mono', text: (r ? (d.name || '') + ' · ' : '') + d.id })]),
          el('button', { class: 'small', type: 'button', text: X10.t('WEB_WIZ_USE'), onclick: function () { chooseDevice(d); } })
        ]));
      });
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  function recvFor(devId) {
    return receiverList.filter(function (r) { return r.device.id === devId; })[0] || null;
  }

  function identify() {
    var left = 60;
    candidate = null;
    X10.$('detected').textContent = '';
    X10.api('POST', 'api/capture/identify', {}).then(function (res) {
      mode = 'identify';
      keepAlive();
      if (res.grab && !res.grab.ok) showGrab(res.grab);
      X10.$('btnIdentify').disabled = true;
      X10.$('identifyRun').classList.remove('hidden');
      X10.$('identifyText').textContent = X10.t('WEB_WIZ_PRESS_NOW', { s: left });
      identifyTimer = setInterval(function () {
        left--;
        X10.$('identifyText').textContent = X10.t('WEB_WIZ_PRESS_NOW', { s: left });
        if (left <= 0) stopCapture();
      }, 1000);
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  /**
   * Key while detecting: a candidate at first; the same key on the same device a second time (within
   * 15 s) confirms it. This way a keyboard is not taken over by accident.
   */
  function onIdentified(ev) {
    if (mode !== 'identify') return;
    var code = ev.key_code !== null && ev.key_code !== undefined ? 'k' + ev.key_code : 's' + ev.scan;
    var now = Date.now();
    // Keyboards are never taken over automatically (only by button) - the mapper does not report their keys either.
    var isKeyboard = ev['class'] === 'keyboard' || ev.hidden;
    if (!isKeyboard && candidate && candidate.id === ev.device && candidate.code === code && now - candidate.t < 15000) {
      var d = candidate;
      candidate = null;
      X10.$('detected').textContent = '';
      chooseDevice({ id: d.id, name: d.name });
      return;
    }
    candidate = { id: ev.device, name: ev.name || '', code: code, t: now, cls: ev['class'] || '' };
    showCandidate();
  }

  function showCandidate() {
    var box = X10.$('detected');
    box.textContent = '';
    if (!candidate) return;
    var d = candidate;
    var rows = [el('div', { class: 'spacer' }, [el('div', { text: d.name || d.id }),
      el('div', { class: 'muted mono', text: d.id }),
      el('div', { class: 'muted small', text: X10.t(d.cls === 'keyboard' ? 'WEB_WIZ_CANDIDATE_BUTTON' : 'WEB_WIZ_CANDIDATE') })])];
    if (d.cls === 'keyboard') rows.push(el('div', { class: 'note warn small', text: X10.t('WEB_WIZ_CANDIDATE_KEYBOARD') }));
    rows.push(el('button', { class: 'small', type: 'button', text: X10.t('WEB_WIZ_USE'), onclick: function () {
      candidate = null;
      box.textContent = '';
      chooseDevice({ id: d.id, name: d.name });
    } }));
    box.appendChild(el('label', null, rows));
  }

  function chooseDevice(d) {
    if (device && device.id !== d.id && keys.length) {
      if (!confirm(X10.t('WEB_WIZ_OTHER_DEVICE', { n: keys.length }))) return;
      keys = [];
      current = null;
    }
    clearInterval(identifyTimer);
    identifyTimer = null;
    X10.$('identifyRun').classList.add('hidden');
    X10.$('btnIdentify').disabled = false;
    device = { id: d.id, name: d.name || '' };
    mode = 'capture';                                 // from now on events count as keys of this device
    return X10.api('POST', 'api/capture/start', { device: device.id }).then(function (res) {
      keepAlive();
      showGrab(res.grab);
      return X10.api('GET', 'api/receivers');
    }).then(function (list) {
      receiverList = list || [];
      showReceiverPanel();
    }).catch(function (e) {
      mode = 'idle';
      X10.toast(X10.errText(e), 'err');
    });
  }

  function showReceiverPanel() {
    var r = recvFor(device.id);
    X10.$('recvChoose').classList.add('hidden');
    X10.$('recvPanel').classList.remove('hidden');
    X10.$('recvDev').textContent = (device.name ? device.name + ' · ' : '') + device.id;
    X10.$('rName').value = r ? r.name : (device.name || device.id);
    X10.$('rRf433').checked = r ? !!r.rf433 : /^0bc7:/.test(device.id);
    updateReceiverInfo();
    X10.$('rName').focus();
  }

  /** Assignment of the receiver: without 433 MHz it belongs to exactly one transmitter. */
  function updateReceiverInfo() {
    var r = recvFor(device.id);
    var others = r ? r.transmitters.filter(function (t) { return !existing || t.id !== existing.id; }) : [];
    var blocked = others.length > 0 && !X10.$('rRf433').checked;
    var box = X10.$('recvInfo');
    box.textContent = '';
    if (others.length) {
      box.appendChild(el('div', { class: 'note ' + (blocked ? 'warn' : ''),
        text: X10.t(blocked ? 'WEB_WIZ_RECV_TAKEN' : 'WEB_WIZ_RECV_SHARED', { list: others.map(function (t) { return t.name; }).join(', ') }) }));
    } else {
      box.appendChild(el('div', { class: 'muted small', text: X10.t(r ? 'WEB_WIZ_RECV_KNOWN' : 'WEB_WIZ_RECV_NEW') }));
    }
    X10.$('btnTo3').disabled = blocked;
  }

  /** Save the receiver (create it or change name/433 MHz) and go on to the keys. */
  function toStep3() {
    var name = X10.$('rName').value.trim();
    if (!name) { X10.toast(X10.t('ERR_NAME_REQUIRED'), 'warn'); return; }
    var r = recvFor(device.id);
    var payload = { name: name, rf433: X10.$('rRf433').checked, device: { id: device.id, name: device.name } };
    if (r) payload.id = r.id;
    if (r && r.description !== undefined) payload.description = r.description;
    var btn = X10.$('btnTo3');
    btn.disabled = true;
    X10.api('POST', 'api/receiver/save', { receiver: payload }).then(function (res) {
      receiver = res.receiver;
      startKeys();
    }).catch(function (e) {
      X10.toast(X10.errText(e), 'err');
    }).then(function () { btn.disabled = false; });
  }

  // ------------------------------------------------------------- 3 · keys
  function sameKey(a, type, code) { return a.type === type && Number(a.code) === Number(code); }
  function findKey(type, code) {
    for (var i = 0; i < keys.length; i++) if (sameKey(keys[i], type, code)) return keys[i];
    return null;
  }
  function keyTitle(k) { return k.remote_label || k.name || X10.source(k); }

  function receiverIds() {
    if (existing) {
      var ids = (existing.receivers && existing.receivers.length) ? existing.receivers.slice() : [existing.device.id];
      if (ids.indexOf(device.id) === -1) ids.push(device.id);
      return ids;
    }
    return [device.id];
  }

  function startKeys() {
    X10.$('devLabel').textContent = (receiver ? receiver.name + ' · ' : (device.name ? device.name + ' · ' : '')) + device.id;
    step(3);
    showGrab(lastGrab);
    showCurrent();
    renderList();
    X10.api('GET', 'api/thdused?exclude=' + encodeURIComponent(existing ? existing.id : '') + '&devices=' + encodeURIComponent(receiverIds().join(',')))
      .then(function (res) { serverUsed = res.used || {}; if (current) showCurrent(); }).catch(function () { /* display only */ });
  }

  /** Upper area: either "press a key" or the editor of the current key. */
  function showCurrent() {
    var editing = !!current;
    X10.$('waitBox').classList.toggle('hidden', editing);
    X10.$('editBox').classList.toggle('hidden', !editing);
    X10.$('curPanel').classList.toggle('editing', editing);
    X10.$('cTotal').textContent = keys.length;
    if (!editing) {
      editor.clear();
      X10.$('waitTitle').textContent = X10.t(keys.length ? 'WEB_WIZ_WAIT_NEXT' : 'WEB_WIZ_WAIT_FIRST', { n: keys.length + 1 });
      return;
    }
    X10.$('editTitle').textContent = current.isNew ? X10.t('WEB_WIZ_NEW_KEY', { n: keys.length + 1 }) : X10.t('WEB_WIZ_EDIT_KEY', { name: keyTitle(current.key) });
    X10.$('editNote').textContent = current.isNew ? '' : X10.t('WEB_WIZ_ALREADY');
    X10.$('btnDiscard').textContent = X10.t(current.isNew ? 'WEB_WIZ_DISCARD' : 'WEB_WIZ_REMOVE');
    editor.edit(current.key).focus();
  }

  /** Accept the current key. Returns the key (or null). */
  function accept() {
    if (!current) return null;
    var k = current.key;
    if (!String(k.name).trim()) k.name = k.type === 'key' ? X10.prettyKeyName(k.key_name) : X10.t('WEB_KEY_N', { n: keys.length + 1 });
    if (current.isNew) keys.push(k);
    current = null;
    dirty = true;
    showCurrent();
    renderList(k);
    return k;
  }

  function discard() {
    if (!current) return;
    if (!current.isNew) keys = keys.filter(function (k) { return k !== current.key; });
    current = null;
    showCurrent();
    renderList();
  }

  function open(k, isNew) {
    current = { key: k, isNew: isNew };
    showCurrent();
    renderList();
    X10.$('curPanel').scrollIntoView({ block: 'nearest' });
  }

  function onCaptured(ev) {
    if (!device || ev.device !== device.id) return;
    if (X10.$('step3').classList.contains('hidden')) {           // step 2: only show the key (locked)
      X10.flash(X10.$('recvPanel'), 'flash', 500);
      return;
    }
    var isKey = ev.key_code !== null && ev.key_code !== undefined;
    var type = isKey ? 'key' : 'scan';
    var code = isKey ? ev.key_code : ev.scan;
    if (current && sameKey(current.key, type, code)) {           // the same key again / held
      X10.flash(X10.$('curPanel'), 'flash', 500);
      return;
    }
    if (current) {                                                // another key: accept the current one automatically
      var done = accept();
      if (done) X10.toast(X10.t('WEB_WIZ_TAKEN', { name: keyTitle(done) }));
    }
    var known = findKey(type, code);
    if (known) { open(known, false); return; }
    open(X10.normKey({
      type: type, code: code, scan: ev.scan, key_name: ev.key_name,
      name: isKey ? X10.prettyKeyName(ev.key_name) : X10.t('WEB_KEY_N', { n: keys.length + 1 })
    }), true);
  }

  function renderList(flashKey) {
    var box = X10.$('keyList');
    box.textContent = '';
    if (!keys.length) {
      box.appendChild(el('div', { class: 'muted', text: X10.t('WEB_WIZ_NO_KEYS_YET') }));
      return;
    }
    var rows = keys.map(function (k, i) {
      var tr = el('tr', { class: current && current.key === k ? 'sel' : '' }, [
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', null, [el('div', { text: k.name }), k.remote_label ? el('div', { class: 'muted', text: k.remote_label }) : null]),
        el('td', null, [el('span', { class: 'mono', text: X10.source(k) }), ' ',
          el('span', { class: 'badge ' + k.type, text: X10.t(k.type === 'key' ? 'WEB_TYPE_KEY' : 'WEB_TYPE_SCAN') }),
          k.type === 'scan' && k.thd_key ? el('div', { class: 'muted mono small', text: '→ ' + k.thd_key }) : null]),
        el('td', { class: 'summary', text: X10.keySummary(k) }),
        el('td', { class: 'btns' }, [
          el('button', { class: 'small', type: 'button', text: X10.t('WEB_WIZ_CHANGE'), onclick: function () {
            if (current && current.key === k) return;
            if (current) accept();
            open(k, false);
          } }),
          el('button', { class: 'small danger', type: 'button', title: X10.t('WEB_DELETE_KEY'), text: '✕', onclick: function () {
            if (current && current.key === k) current = null;
            keys = keys.filter(function (x) { return x !== k; });
            dirty = true;
            showCurrent();
            renderList();
          } })
        ])
      ]);
      if (k === flashKey) X10.flash(tr, 'flash', 900);
      return tr;
    });
    box.appendChild(el('table', { class: 'keys wizlist' }, [el('thead', null, [el('tr', null, [
      el('th', { text: '#' }), el('th', { text: X10.t('WEB_COL_NAME') }), el('th', { text: X10.t('WEB_COL_SIGNAL') }),
      el('th', { text: X10.t('WEB_COL_ACTION') }), el('th', { text: '' })])]), el('tbody', null, rows)]));
  }

  function done() {
    if (current) accept();
    if (!keys.length) {
      X10.toast(X10.t('WEB_WIZ_NEED_KEYS'), 'warn');
      return;
    }
    var btn = X10.$('btnDone');
    var profile = {
      id: existing ? existing.id : undefined,
      name: X10.$('pName').value.trim(),
      description: X10.$('pDesc').value,
      notes: X10.$('pNotes').value,
      rf433: X10.$('pRf433').checked,
      device: existing ? existing.device : device,
      receivers: receiverIds(),
      keys: keys.map(X10.keyOut)
    };
    if (!profile.name) {
      X10.toast(X10.t('ERR_NAME_REQUIRED'), 'warn');
      return;
    }
    btn.disabled = true;
    stopCapture().then(function () {
      return X10.api('POST', 'api/profile/save', { profile: profile, activate: X10.$('pActivate').checked });
    }).then(function (res) {
      dirty = false;
      return X10.api('GET', 'api/profile?id=' + encodeURIComponent(res.id)).then(function (d) {
        saved = d.profile;
        X10.$('savedNote').textContent = X10.t(existing ? 'WEB_WIZ_SAVED_MORE' : 'WEB_WIZ_SAVED', { name: saved.name, n: saved.keys.length });
        X10.$('btnToProfile').setAttribute('href', 'profile.html?id=' + encodeURIComponent(saved.id));
        X10.imageSlots(X10.$('images'), saved);
        // offer pictures of the receiver as long as it has none
        var rec = receiver;
        var recPromise = rec ? Promise.resolve({ receiver: rec }) : X10.api('GET', 'api/receivers').then(function (list) {
          var r = (list || []).filter(function (x) { return x.device.id === device.id; })[0];
          return r ? X10.api('GET', 'api/receiver?id=' + encodeURIComponent(r.id)) : null;
        });
        return recPromise.then(function (rd) {
          var r = rd && rd.receiver;
          var show = r && !r.images.some(Boolean);
          X10.$('recvImgSection').classList.toggle('hidden', !show);
          if (show) {
            X10.$('recvImgTitle').textContent = X10.t('WEB_WIZ_IMAGES_RECEIVER', { name: r.name });
            X10.imageSlots(X10.$('recvImages'), r, 'receiver');
          }
          step(4);
        });
      });
    }).catch(function (e) {
      btn.disabled = false;
      X10.toast(X10.errText(e), 'err');
      if (mode === 'idle' && device) {
        mode = 'capture';
        X10.api('POST', 'api/capture/start', { device: device.id }).then(function (r) { keepAlive(); showGrab(r.grab); })
          .catch(function () { mode = 'idle'; });
      }
    });
  }

  // ------------------------------------------------------------------ Start
  function onEvent(ev) {
    if (ev.event !== 'capture') return;
    if (mode === 'identify') onIdentified(ev);
    else if (mode === 'capture') onCaptured(ev);
  }

  X10.$('btnTo2').addEventListener('click', toStep2);
  X10.$('pName').addEventListener('keydown', function (e) { if (e.key === 'Enter') toStep2(); });
  ['pName', 'pDesc', 'pNotes'].forEach(function (id) { X10.$(id).addEventListener('input', function () { dirty = true; }); });
  X10.$('btnIdentify').addEventListener('click', identify);
  X10.$('btnReload').addEventListener('click', loadDevices);
  X10.$('btnBack1').addEventListener('click', function () { stopCapture(); step(1); });
  X10.$('btnOtherRecv').addEventListener('click', function () {
    stopCapture().then(function () {
      showChooser();
      showGrab(null);
      loadDevices();
    });
  });
  X10.$('rRf433').addEventListener('change', updateReceiverInfo);
  X10.$('rName').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !X10.$('btnTo3').disabled) toStep3(); });
  X10.$('btnTo3').addEventListener('click', toStep3);
  X10.$('btnBack2').addEventListener('click', function () {
    if (current) accept();
    if (existing) {
      stopCapture();
      location.href = 'profile.html?id=' + encodeURIComponent(existing.id);
    } else {
      step(2);                    // capture stays active (keys locked)
      showReceiverPanel();
    }
  });
  X10.$('btnNext').addEventListener('click', accept);
  X10.$('btnDiscard').addEventListener('click', discard);
  X10.$('editor').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); accept(); }
  });
  X10.$('btnDone').addEventListener('click', done);
  window.addEventListener('pagehide', function () {
    if (mode !== 'idle' && navigator.sendBeacon) navigator.sendBeacon('api/capture/stop', '');
  });
  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  X10.init('wizard').then(function () {
    editor = new X10.KeyEditor({ container: X10.$('editor'), audioconf: audioconf, onChange: function () { dirty = true; },
      used: function (key) { return X10.thdUsedMap(serverUsed, keys.concat(current && current.isNew ? [current.key] : []), key); } });
    return X10.api('GET', 'api/audioconf');
  }).then(function (ac) {
    audioconf = ac || {};
    editor.opts.audioconf = audioconf;
    X10.events(onEvent);
    var pid = X10.query('profile');
    if (pid) {
      return X10.api('GET', 'api/profile?id=' + encodeURIComponent(pid)).then(function (res) {
        existing = res.profile;
        editor.opts.profileId = existing.id;
        X10.$('pName').value = existing.name;
        X10.$('pDesc').value = existing.description || '';
        X10.$('pNotes').value = existing.notes || '';
        X10.$('pRf433').checked = !!existing.rf433;
        X10.$('pActivate').checked = res.active;
        keys = (existing.keys || []).map(X10.normKey);
        device = existing.device;
        receiver = null;
        mode = 'capture';
        return X10.api('POST', 'api/capture/start', { device: device.id }).then(function (r) {
          keepAlive();
          lastGrab = r.grab;
          startKeys();
        }).catch(function (e) {
          mode = 'idle';
          startKeys();
          X10.toast(X10.errText(e), 'err');
        });
      });
    }
    step(1);
    X10.$('pName').focus();
  }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
})();
