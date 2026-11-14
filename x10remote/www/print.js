/* Druck-/Kopierliste eines Profils: Beschriftung + Beschreibung, optional Befehl und Scan-Code/KEY_* */
(function () {
  'use strict';
  var el = X10.el;
  var id = X10.query('id');
  var data = null;
  var KEY = 'x10.print.tech';

  function techOn() { return X10.$('chkTech').checked; }

  /** Beschriftung auf der Fernbedienung; nur wenn keine eingetragen ist, der Name der Taste. */
  function labelOf(r) { return r.remote_label || r.name; }
  function descOf(r) { return r.description || r.action; }
  function commandOf(r) {
    if (r.source === 'audio') return 'audio.conf: ' + r.command;
    return r.command;
  }
  function signalOf(r) {
    return r.signal + '  →  ' + r.thd_key + (r.internal ? '  (' + X10.t('WEB_PRINT_INTERNAL', { key: r.internal }) + ')' : '');
  }

  function render() {
    var tech = techOn();
    var head = [X10.t('WEB_PRINT_COL_LABEL'), X10.t('WEB_PRINT_COL_DESC')];
    if (tech) head.push(X10.t('WEB_PRINT_COL_COMMAND'), X10.t('WEB_PRINT_COL_SIGNAL'));
    var table = X10.$('plist');
    table.textContent = '';
    table.classList.toggle('tech', tech);
    table.appendChild(el('thead', null, [el('tr', null, head.map(function (h) { return el('th', { text: h }); }))]));
    var body = el('tbody');
    data.rows.forEach(function (r) {
      var cells = [
        el('td', { class: 'lab' }, [el('b', { text: labelOf(r) })]),
        el('td', null, [el('span', { class: r.description ? '' : 'fallback', text: descOf(r) })])
      ];
      if (tech) {
        cells.push(el('td', { class: 'mono ' + r.source, text: commandOf(r) }));
        cells.push(el('td', { class: 'mono', text: signalOf(r) }));
      }
      body.appendChild(el('tr', null, cells));
    });
    table.appendChild(body);
  }

  /** Tabelle als Text (Tabulator-getrennt, laesst sich in Word/Excel einfuegen). */
  function asText() {
    var tech = techOn();
    var lines = [data.name];
    if (data.description) lines.push(data.description);
    lines.push('');
    var head = [X10.t('WEB_PRINT_COL_LABEL'), X10.t('WEB_PRINT_COL_DESC')];
    if (tech) head.push(X10.t('WEB_PRINT_COL_COMMAND'), X10.t('WEB_PRINT_COL_SIGNAL'));
    lines.push(head.join('\t'));
    data.rows.forEach(function (r) {
      var c = [labelOf(r), descOf(r)];
      if (tech) c.push(commandOf(r), signalOf(r));
      lines.push(c.map(function (x) { return String(x).replace(/[\t\r\n]+/g, ' '); }).join('\t'));
    });
    return lines.join('\n') + '\n';
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    // ohne HTTPS: klassischer Weg ueber ein verstecktes Textfeld
    return new Promise(function (resolve, reject) {
      var ta = el('textarea', { class: 'offscreen', readonly: true });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) resolve(); else reject(new Error('copy'));
    });
  }

  X10.$('chkTech').addEventListener('change', function () {
    try { localStorage.setItem(KEY, techOn() ? '1' : '0'); } catch (e) { /* ignore */ }
    if (data) render();
  });
  X10.$('btnPrintNow').addEventListener('click', function () { window.print(); });
  X10.$('btnCopy').addEventListener('click', function () {
    if (!data) return;
    copyText(asText()).then(function () { X10.toast(X10.t('WEB_PRINT_COPIED')); }, function () {
      // letzter Ausweg: Tabelle markieren, Nutzer kopiert mit Strg+C
      var range = document.createRange();
      range.selectNodeContents(X10.$('sheet'));
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      X10.toast(X10.t('WEB_PRINT_SELECTED'), 'warn');
    });
  });

  try { X10.$('chkTech').checked = localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }
  if (X10.query('tech') === '1') X10.$('chkTech').checked = true;

  X10.init('profiles').then(function () {
    if (!id) throw Object.assign(new Error('id'), { code: 'profile_id_invalid' });
    X10.$('btnBack').setAttribute('href', 'profile.html?id=' + encodeURIComponent(id));
    return X10.api('GET', 'api/profile/print?id=' + encodeURIComponent(id));
  }).then(function (d) {
    data = d;
    document.title = 'X10 – ' + d.name;
    X10.$('pName').textContent = d.name;
    X10.$('pSub').textContent = (d.device.name ? d.device.name + ' · ' : '') + d.device.id + ' · ' +
      X10.t(d.active ? 'WEB_ACTIVE' : 'WEB_INACTIVE') + ' · ' + X10.t('WEB_PRINT_KEYS', { n: d.rows.length });
    X10.$('pDesc').textContent = d.description;
    X10.$('pFoot').textContent = X10.t('WEB_PRINT_FOOT', { date: new Date().toLocaleString(), version: d.version }) +
      (d.active ? '' : ' ' + X10.t('WEB_PRINT_INACTIVE_NOTE'));
    render();
  }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
})();
