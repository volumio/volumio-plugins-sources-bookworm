/* Startseite */
(function () {
  'use strict';
  var el = X10.el;
  /** Bericht anzeigen: markierbarer Text, Kopieren, Datei in /data/INTERNAL/X10. */
  function showReport(res) {
    var pre = el('textarea', { class: 'mono report', readonly: 'readonly', spellcheck: 'false' });
    pre.value = res.text;
    var copy = el('button', { type: 'button', text: X10.t('WEB_COPY') });
    var dl = el('a', { class: 'btn', download: res.file.split('/').pop(),
      href: URL.createObjectURL(new Blob([res.text], { type: 'text/plain;charset=utf-8' })), text: X10.t('WEB_DOWNLOAD') });
    var close = el('button', { class: 'primary', type: 'button', text: X10.t('WEB_CLOSE') });
    var back = el('div', { class: 'dlg-back top', role: 'dialog', 'aria-modal': 'true' }, [el('div', { class: 'dlg wide' }, [
      el('h3', { text: X10.t('WEB_RADIO_REPORT') }),
      el('p', { class: 'muted', text: X10.t('WEB_RADIO_REPORT_SAVED', { file: res.file }) }),
      pre,
      el('div', { class: 'actions' }, [copy, dl, el('span', { class: 'spacer' }), close])
    ])]);
    copy.addEventListener('click', function () {
      pre.select();
      (navigator.clipboard ? navigator.clipboard.writeText(res.text) : Promise.reject()).catch(function () { document.execCommand('copy'); })
        .then(function () { X10.toast(X10.t('WEB_COPIED')); });
    });
    close.addEventListener('click', function () { back.remove(); });
    document.body.appendChild(back);
  }

  X10.$('btnCheckAll').addEventListener('click', function () {
    var btn = X10.$('btnCheckAll');
    btn.disabled = true;
    X10.$('checkAllInfo').textContent = X10.t('WEB_RADIO_CHECKING');
    X10.api('POST', 'api/radio/checkall', { lang: X10.langChoice() || undefined }).then(function (res) {
      X10.$('checkAllInfo').textContent = X10.t('WEB_RADIO_CHECKALL_RESULT', { ok: res.ok, uris: res.uris, stations: res.stations, failed: res.failed_stations });
      showReport(res);
    }).catch(function (e) {
      X10.$('checkAllInfo').textContent = '';
      X10.toast(X10.errText(e), 'err');
    }).then(function () { btn.disabled = false; });
  });

  X10.init('home').then(function (info) {
    X10.events(function () {});
    return X10.api('GET', 'api/state').then(function (state) {
      var box = X10.$('status');
      var profiles = {};
      state.keys.forEach(function (k) { profiles[k.profile_name] = (profiles[k.profile_name] || 0) + 1; });
      var names = Object.keys(profiles);
      box.appendChild(el('div', null, [el('b', { text: X10.t('WEB_VERSION') + ': ' }), info.version]));
      box.appendChild(el('div', null, [el('b', { text: X10.t('WEB_MAPPER') + ': ' }), X10.stateText(info.mapper)]));
      box.appendChild(el('div', null, [el('b', { text: X10.t('WEB_ACTIVE_PROFILES') + ': ' }),
        names.length ? names.map(function (n) { return n + ' (' + profiles[n] + ')'; }).join(', ') : X10.t('WEB_VANILLA_NAME')]));
      var problems = state.mapper_problems.concat(state.problems.map(function (p) {
        return X10.t('WEB_PROBLEM_' + String(p.code).toUpperCase(), { key: p.key || '', other: p.other || '', profile: p.profile || '' });
      }));
      problems.forEach(function (p) { box.appendChild(el('div', { class: 'note warn', text: p })); });
    });
  }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
})();
