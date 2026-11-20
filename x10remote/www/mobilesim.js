/* Simulation of the phone page (Mobile Remote) in the web interface: the same page inside a phone frame. */
(function () {
  'use strict';
  var el = X10.el;
  var theme = 'light';

  function show(t) {
    theme = t;
    try { localStorage.setItem('x10.simtheme', t); } catch (e) { /* without storage */ }
    X10.$('btnLight').classList.toggle('primary', t === 'light');
    X10.$('btnDark').classList.toggle('primary', t === 'dark');
    X10.$('phone').classList.toggle('dark', t === 'dark');
    X10.$('simFrame').setAttribute('src', 'sim/?theme=' + t);
  }

  function notes(m) {
    var box = X10.$('simNote');
    box.textContent = '';
    if (!m.mapper) box.appendChild(el('div', { class: 'note warn', text: X10.t('WEB_MOBILE_MAPPER_OFF') }));
    if (!m.keys.some(function (k) { return k.id; })) box.appendChild(el('div', { class: 'note', text: X10.t('WEB_SIM_EMPTY') }));
    box.appendChild(el('div', { class: 'muted small', text: X10.t(m.enabled && m.running_port ? 'WEB_SIM_PORT_ON' : 'WEB_SIM_PORT_OFF',
      { url: (m.urls && m.urls[0]) || '' }) }));
  }

  X10.$('btnLight').addEventListener('click', function () { show('light'); });
  X10.$('btnDark').addEventListener('click', function () { show('dark'); });

  X10.init('mobile').then(function () {
    var saved = null;
    try { saved = localStorage.getItem('x10.simtheme'); } catch (e) { /* ignore */ }
    if (saved !== 'light' && saved !== 'dark') {
      saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    show(saved);
    return X10.api('GET', 'api/mobile').then(notes);
  }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
})();
