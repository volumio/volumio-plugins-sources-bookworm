/* Empfaengeruebersicht: alle Empfaenger mit Bild, 433-MHz-Kennzeichen und zugeordneten Sendern */
(function () {
  'use strict';
  var el = X10.el;
  var known = [];

  function remove(r) {
    if (r.transmitters.length) {
      X10.toast(X10.t('ERR_RECEIVER_IN_USE') + ' (' + r.transmitters.map(function (t) { return t.name; }).join(', ') + ')', 'warn');
      return;
    }
    if (!confirm(X10.t('WEB_RECV_DELETE_CONFIRM', { name: r.name }))) return;
    X10.api('POST', 'api/receiver/delete', { id: r.id }).then(function () {
      X10.toast(X10.t('WEB_DELETED', { name: r.name }));
      return load();
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  function render(list) {
    known = list;
    var box = X10.$('list');
    box.textContent = '';
    if (!list.length) box.appendChild(el('div', { class: 'muted', text: X10.t('WEB_RECV_NONE') }));
    list.forEach(function (r) {
      var href = 'receiver.html?id=' + encodeURIComponent(r.id);
      var slot = r.images.indexOf(true);
      box.appendChild(el('div', { class: 'card' }, [
        slot !== -1 ? el('a', { href: href }, [el('img', { class: 'thumb', alt: '', src: 'rimg/' + encodeURIComponent(r.id) + '/' + (slot + 1) + '?v=' + encodeURIComponent(r.updated || '') })]) : null,
        el('div', { class: 'row' }, [el('a', { class: 'title', href: href, text: r.name }), el('span', { class: 'spacer' }),
          el('span', { class: 'badge' + (r.connected ? ' on' : ''), text: X10.t(r.connected ? 'WEB_CONNECTED' : 'WEB_NOT_CONNECTED') })]),
        el('div', { class: 'muted mono', text: (r.device.name ? r.device.name + ' · ' : '') + r.device.id }),
        r.description ? el('div', { class: 'muted', text: r.description }) : null,
        el('div', null, [r.rf433 ? el('span', { class: 'badge', text: '433 MHz' }) : el('span', { class: 'badge', text: X10.t('WEB_RECV_SINGLE') })]),
        el('div', { class: 'muted' }, r.transmitters.length ? [X10.t('WEB_RECV_TRANSMITTERS') + ' ']
          .concat(r.transmitters.map(function (t, i) { return el('span', null, [i ? ', ' : '', el('a', { href: 'profile.html?id=' + encodeURIComponent(t.id), text: t.name })]); }))
          : [X10.t('WEB_RECV_NO_TRANSMITTER')]),
        el('div', { class: 'row' }, [el('span', { class: 'spacer' }),
          el('button', { class: 'small danger', type: 'button', text: X10.t('WEB_DELETE'), onclick: function () { remove(r); } }),
          el('a', { class: 'btn small', href: href, text: X10.t('WEB_OPEN') })])
      ]));
    });
  }

  /** Angeschlossene Geraete ohne Empfaenger-Eintrag: als Empfaenger anlegen. */
  function loadDevices() {
    var box = X10.$('devices');
    box.textContent = '';
    return X10.api('GET', 'api/devices').then(function (res) {
      var have = known.map(function (r) { return r.device.id; });
      var free = res.devices.filter(function (d) { return have.indexOf(d.id) === -1; });
      if (!free.length) box.appendChild(el('div', { class: 'muted', text: X10.t('WEB_RECV_NO_NEW') }));
      free.forEach(function (d) {
        var btn = el('button', { class: 'small', type: 'button', text: X10.t('WEB_RECV_ADD') });
        btn.addEventListener('click', function () {
          btn.disabled = true;
          X10.api('POST', 'api/receiver/save', { receiver: { name: d.name || d.id, device: { id: d.id, name: d.name || '' } } }).then(function (res) {
            location.href = 'receiver.html?id=' + encodeURIComponent(res.id) + '&created=1';
          }).catch(function (e) { btn.disabled = false; X10.toast(X10.errText(e), 'err'); });
        });
        box.appendChild(el('label', null, [
          el('div', { class: 'spacer' }, [el('div', { text: d.name || d.id }), el('div', { class: 'muted mono', text: d.id + ' · ' + d.paths.join(', ') })]), btn]));
      });
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  function load() {
    return X10.api('GET', 'api/receivers').then(render).then(loadDevices).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  X10.$('btnReload').addEventListener('click', loadDevices);
  X10.init('receivers').then(load).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
})();
