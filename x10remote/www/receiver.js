/* Empfaengerseite: Name, Beschreibung, Notizen, 433 MHz, Bilder, zugeordnete Sender */
(function () {
  'use strict';
  var el = X10.el;
  var id = X10.query('id');
  var rec = null;
  var dirty = false;

  function setDirty(v) {
    dirty = v;
    X10.$('btnSave').textContent = X10.t(v ? 'WEB_SAVE_CHANGES' : 'WEB_SAVE');
  }

  function load() {
    return X10.api('GET', 'api/receiver?id=' + encodeURIComponent(id)).then(function (data) {
      rec = data.receiver;
      document.title = 'X10 – ' + rec.name;
      X10.$('title').textContent = rec.name;
      X10.$('deviceLine').textContent = (rec.device.name ? rec.device.name + ' · ' : '') + rec.device.id;
      X10.$('connBadge').className = 'badge' + (data.connected ? ' on' : '');
      X10.$('connBadge').textContent = X10.t(data.connected ? 'WEB_CONNECTED' : 'WEB_NOT_CONNECTED');
      X10.$('rName').value = rec.name;
      X10.$('rDesc').value = rec.description || '';
      X10.$('rNotes').value = rec.notes || '';
      X10.$('rRf433').checked = !!rec.rf433;
      var tx = X10.$('txList');
      tx.textContent = '';
      if (!data.transmitters.length) tx.appendChild(el('div', { class: 'muted', text: X10.t('WEB_RECV_NO_TRANSMITTER') }));
      data.transmitters.forEach(function (t) {
        tx.appendChild(el('div', { class: 'row' }, [el('a', { href: 'profile.html?id=' + encodeURIComponent(t.id), text: t.name }),
          t.rf433 ? el('span', { class: 'badge', text: '433 MHz' }) : null]));
      });
      tx.appendChild(el('p', { class: 'muted small', text: X10.t('WEB_RECV_ASSIGN_HELP') }));
      X10.imageSlots(X10.$('images'), rec, 'receiver');
      setDirty(false);
    });
  }

  function save() {
    var btn = X10.$('btnSave');
    var payload = { id: rec.id, name: X10.$('rName').value.trim(), description: X10.$('rDesc').value,
      notes: X10.$('rNotes').value, rf433: X10.$('rRf433').checked };
    if (!payload.name) { X10.toast(X10.t('ERR_NAME_REQUIRED'), 'warn'); return; }
    btn.disabled = true;
    X10.api('POST', 'api/receiver/save', { receiver: payload }).then(function (res) {
      if (res.id !== id) {
        id = res.id;
        history.replaceState(null, '', 'receiver.html?id=' + encodeURIComponent(id));
      }
      X10.toast(X10.t('WEB_SAVED') + (res.old_id ? ' ' + X10.t('WEB_FOLDER_RENAMED', { id: res.id }) : ''));
      return load();
    }).catch(function (e) {
      X10.toast(X10.errText(e), 'err');
    }).then(function () { btn.disabled = false; });
  }

  X10.$('btnSave').addEventListener('click', save);
  ['rName', 'rDesc', 'rNotes'].forEach(function (f) { X10.$(f).addEventListener('input', function () { setDirty(true); }); });
  X10.$('rRf433').addEventListener('change', function () { setDirty(true); });
  X10.$('btnDelete').addEventListener('click', function () {
    if (!confirm(X10.t('WEB_RECV_DELETE_CONFIRM', { name: rec.name }))) return;
    X10.api('POST', 'api/receiver/delete', { id: rec.id }).then(function () {
      dirty = false;
      location.href = 'receivers.html';
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  });
  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  X10.init('receivers').then(function () {
    if (!id) throw Object.assign(new Error('id'), { code: 'receiver_id_invalid' });
    return load();
  }).then(function () {
    if (X10.query('created')) X10.toast(X10.t('WEB_RECV_CREATED'));
  }).catch(function (e) {
    X10.$('actions').classList.add('hidden');
    X10.toast(X10.errText(e), 'err');
  });
})();
