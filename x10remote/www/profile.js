/* Profilseite: Beschreibung, bis zu 3 Bilder, Tasten mit Namen und Befehlen */
(function () {
  'use strict';
  var el = X10.el;
  var id = X10.query('id');
  var profile = null;
  var table = null;
  var info = null;
  var dirty = false;
  var receivers = [];           // Auswahl: { device, name, rf433, assigned, others[], connected, id }

  function setDirty(v) {
    dirty = v;
    X10.$('btnSave').textContent = X10.t(v ? 'WEB_SAVE_CHANGES' : 'WEB_SAVE');
  }

  function setActive(active) {
    X10.$('pActive').checked = active;
    X10.$('activeBadge').className = 'badge' + (active ? ' on' : '');
    X10.$('activeBadge').textContent = X10.t(active ? 'WEB_ACTIVE' : 'WEB_INACTIVE');
  }

  function showProblems(list) {
    var box = X10.$('problems');
    box.textContent = '';
    (list || []).forEach(function (p) {
      box.appendChild(el('div', { class: 'note warn', text: X10.t('WEB_PROBLEM_' + String(p.code).toUpperCase(), { key: p.key || '', other: p.other || '', profile: p.profile || '' }) }));
    });
  }

  // ------------------------------------------------------------- Empfaenger
  /**
   * Zuordnung: Ohne 433-MHz-Haken genau ein Empfaenger (Auswahlknopf), mit Haken mehrere (Haekchen).
   * Ein Empfaenger ohne 433 MHz, der schon einem anderen Sender gehoert, ist nicht waehlbar.
   */
  function renderReceivers() {
    var box = X10.$('recvList');
    box.textContent = '';
    var multi = X10.$('pRf433').checked;
    receivers.forEach(function (r) {
      var blocked = !r.rf433 && r.others.length > 0;
      var input = el('input', { type: multi ? 'checkbox' : 'radio', name: 'recv', checked: r.assigned, disabled: blocked && !r.assigned,
        onchange: function () {
          if (!multi) receivers.forEach(function (x) { x.assigned = false; });
          r.assigned = input.checked;
          if (!multi) renderReceivers();
          setDirty(true);
        } });
      var info = [];
      info.push(r.usb_name ? r.usb_name + ' · ' + r.device : r.device);
      if (r.others.length) info.push(X10.t('WEB_RECV_ALSO', { list: r.others.join(', ') }));
      box.appendChild(el('label', { class: blocked && !r.assigned ? 'disabled' : '' }, [
        input,
        r.image ? el('img', { class: 'mini', alt: '', src: 'rimg/' + encodeURIComponent(r.id) + '/' + r.image + '?v=' + encodeURIComponent(r.updated || '') }) : null,
        el('div', { class: 'spacer' }, [
          el('div', null, [el('a', { href: 'receiver.html?id=' + encodeURIComponent(r.id), text: r.name }), ' ',
            r.rf433 ? el('span', { class: 'badge', text: '433 MHz' }) : null, ' ',
            el('span', { class: 'badge' + (r.connected ? ' on' : ''), text: X10.t(r.connected ? 'WEB_CONNECTED' : 'WEB_NOT_CONNECTED') })]),
          el('div', { class: 'muted small', text: info.join(' · ') }),
          blocked && !r.assigned ? el('div', { class: 'muted small', text: X10.t('WEB_RECV_BLOCKED') }) : null
        ])
      ]));
    });
  }

  /** Im Profil doppelt gewaehlte Triggerhappy-Tasten: erlaubt, solange das Profil nicht aktiv ist. */
  function showDuplicates(list) {
    var box = X10.$('dupNote');
    box.textContent = '';
    if (!list || !list.length) return;
    box.appendChild(el('div', { class: 'note warn', text: X10.t('WEB_THD_DUPLICATES', {
      list: list.map(function (d) { return d.key + ' (' + d.names.join(', ') + ')'; }).join('; ') }) }));
  }

  /** Sender dieses Profils zu Volumios "Meine Webradios" hinzufuegen. */
  function toFavourites() {
    if (dirty) { X10.toast(X10.t('WEB_SAVE_FIRST'), 'warn'); return; }
    if (!confirm(X10.t('WEB_RADIO_FAV_CONFIRM'))) return;
    X10.api('POST', 'api/radio/favourites', { id: profile.id }).then(function (r) {
      var parts = [];
      if (r.added.length) parts.push(X10.t('WEB_RADIO_FAV_ADDED', { list: r.added.map(function (x) { return x.name; }).join(', ') }));
      if (r.renamed.length) parts.push(X10.t('WEB_RADIO_FAV_RENAMED', { list: r.renamed.map(function (x) { return x.name + ' → ' + x.as; }).join(', ') }));
      if (r.skipped.length) parts.push(X10.t('WEB_RADIO_FAV_SKIPPED', { list: r.skipped.map(function (x) { return x.name + ' (= ' + x.as + ')'; }).join(', ') }));
      if (r.backup) parts.push(X10.t('WEB_RADIO_FAV_BACKUP', { file: r.backup }));
      X10.toast(parts.join(' · '), 'ok', 12000);
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  function chosenReceivers() {
    return receivers.filter(function (r) { return r.assigned; }).map(function (r) { return r.device; });
  }

  function loadThdUsed() {
    var devs = chosenReceivers().join(',');
    return X10.api('GET', 'api/thdused?exclude=' + encodeURIComponent(profile.id) + '&devices=' + encodeURIComponent(devs))
      .then(function (res) { if (table) table.setThdUsed(res.used); }).catch(function () { /* nur Anzeige */ });
  }

  // ---------------------------------------------------------------- Bilder
  function renderImages() {
    X10.imageSlots(X10.$('images'), profile);
  }

  // --------------------------------------------------------------- Laden/Speichern
  function load() {
    return Promise.all([X10.api('GET', 'api/profile?id=' + encodeURIComponent(id)), X10.api('GET', 'api/audioconf')]).then(function (res) {
      var data = res[0];
      profile = data.profile;
      document.title = 'X10 – ' + profile.name;
      X10.$('title').textContent = profile.name;
      X10.$('deviceLine').textContent = (profile.device.name ? profile.device.name + ' · ' : '') + profile.device.id;
      X10.$('pName').value = profile.name;
      X10.$('pDesc').value = profile.description || '';
      X10.$('pNotes').value = profile.notes || '';
      X10.$('pRf433').checked = !!profile.rf433;
      receivers = data.receivers || [];
      renderReceivers();
      X10.$('btnAddKeys').setAttribute('href', 'wizard.html?profile=' + encodeURIComponent(profile.id));
      X10.$('btnPrint').setAttribute('href', 'print.html?id=' + encodeURIComponent(profile.id));
      setActive(data.active);
      showProblems(data.problems);
      renderImages();
      table = new X10.KeyTable({ container: X10.$('keyTable'), keys: profile.keys, audioconf: res[1] || {}, profileId: profile.id,
        allowShell: info.allow_shell, mapped: data.mapped, onChange: function () { setDirty(true); } });
      setDirty(false);
      showDuplicates(data.duplicates);
      X10.$('btnFavourites').classList.toggle('hidden', !profile.keys.some(function (k) { return k.action === 'radio'; }));
    });
  }

  function save() {
    var btn = X10.$('btnSave');
    var payload = {
      id: profile.id, name: X10.$('pName').value.trim(), description: X10.$('pDesc').value, notes: X10.$('pNotes').value,
      device: profile.device, receivers: chosenReceivers(), rf433: X10.$('pRf433').checked, keys: table.getKeys()
    };
    if (!payload.name) { X10.toast(X10.t('ERR_NAME_REQUIRED'), 'warn'); return; }
    if (!payload.receivers.length) { X10.toast(X10.t('WEB_RECV_NEED'), 'warn'); return; }
    btn.disabled = true;
    X10.api('POST', 'api/profile/save', { profile: payload }).then(function (res) {
      if (res.id && res.id !== id) {
        // Name geaendert: der Ordner (Kennung) heisst jetzt wie das Profil
        id = res.id;
        history.replaceState(null, '', 'profile.html?id=' + encodeURIComponent(id));
      }
      showProblems(res.problems);
      X10.toast(X10.t(res.active ? 'WEB_SAVED_ACTIVE' : 'WEB_SAVED') + (res.old_id ? ' ' + X10.t('WEB_FOLDER_RENAMED', { id: res.id }) : ''));
      return load();
    }).catch(function (e) {
      X10.toast(X10.errText(e), 'err');
    }).then(function () { btn.disabled = false; });
  }

  function onEvent(ev) {
    if (!table || !profile) return;
    if (ev.event === 'reload') return;
    var row = null;
    var cls = 'on';
    if ((ev.event === 'press' || ev.event === 'swallowed') && ev.id && ev.id.indexOf(profile.id + '/') === 0) {
      row = table.findById(ev.id.slice(profile.id.length + 1));
      cls = ev.event === 'swallowed' ? 'stop' : 'on';
    } else if (ev.device === profile.device.id) {
      if (ev.event === 'passthrough') { row = table.find('key', ev.code); cls = 'pass'; }
      if (ev.event === 'unmapped') { row = table.find('scan', ev.code); cls = 'warn'; }
    }
    table.light(row, cls);
  }

  X10.$('btnSave').addEventListener('click', save);
  X10.$('pName').addEventListener('input', function () { setDirty(true); });
  X10.$('pDesc').addEventListener('input', function () { setDirty(true); });
  X10.$('pNotes').addEventListener('input', function () { setDirty(true); });
  X10.$('pRf433').addEventListener('change', function () {
    if (!X10.$('pRf433').checked) {
      // nur ein Empfaenger: den ersten gewaehlten behalten
      var first = true;
      receivers.forEach(function (r) { if (r.assigned) { r.assigned = first; first = false; } });
    }
    renderReceivers();
    setDirty(true);
  });
  X10.$('pActive').addEventListener('change', function () {
    var box = X10.$('pActive');
    box.disabled = true;
    X10.api('POST', 'api/profile/activate', { id: profile.id, active: box.checked }).then(function (res) {
      setActive(res.active);
      showProblems(res.problems);
      return X10.api('GET', 'api/profile?id=' + encodeURIComponent(id)).then(function (d) { table.setMapped(d.mapped); });
    }).catch(function (e) {
      box.checked = !box.checked;
      X10.toast(X10.errText(e), 'err');
    }).then(function () { box.disabled = false; });
  });
  X10.$('btnFavourites').addEventListener('click', toFavourites);
  X10.$('btnDuplicate').addEventListener('click', function () {
    if (dirty && !confirm(X10.t('WEB_DUPLICATE_UNSAVED'))) return;
    var btn = X10.$('btnDuplicate');
    btn.disabled = true;
    X10.api('POST', 'api/profile/duplicate', { id: profile.id }).then(function (res) {
      dirty = false;
      location.href = 'profile.html?id=' + encodeURIComponent(res.id) + '&duplicated=1';
    }).catch(function (e) {
      btn.disabled = false;
      X10.toast(X10.errText(e), 'err');
    });
  });
  X10.$('pName').addEventListener('input', function () {
    X10.$('title').textContent = X10.$('pName').value.trim() || profile.name;
  });
  X10.$('btnDelete').addEventListener('click', function () {
    if (!confirm(X10.t('WEB_DELETE_CONFIRM', { name: profile.name }))) return;
    X10.api('POST', 'api/profile/delete', { id: profile.id }).then(function () {
      dirty = false;
      location.href = 'profiles.html';
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  });
  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  X10.init('profiles').then(function (i) {
    info = i;
    if (!id) throw Object.assign(new Error('id'), { code: 'profile_id_invalid' });
    return load();
  }).then(function () {
    X10.events(onEvent);
    if (X10.query('saved')) X10.toast(X10.t('WEB_PROFILE_CREATED'));
    if (X10.query('duplicated')) X10.toast(X10.t('WEB_DUPLICATED', { name: profile.name }));
    if (X10.query('preset')) X10.toast(X10.t('WEB_PRESET_CREATED', { name: profile.name }));
  }).catch(function (e) {
    X10.$('actions').classList.add('hidden');
    X10.toast(X10.errText(e), 'err');
  });
})();
