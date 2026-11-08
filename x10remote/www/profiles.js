/* Profiluebersicht mit Auswahl des aktiven Profils (inkl. eingebautem Vanilla-Profil) */
(function () {
  'use strict';
  var el = X10.el;
  var VANILLA = 'vanilla';
  var MULTI = '__multi__';

  function problemToast(res) {
    if (res && res.problems && res.problems.length) {
      var p = res.problems[0];
      X10.toast(X10.t('WEB_PROBLEM_' + String(p.code).toUpperCase(), { key: p.key || '', other: p.other || '', profile: p.profile || '' }), 'warn');
      return true;
    }
    return false;
  }

  function select(id) {
    var btn = X10.$('btnSelect');
    btn.disabled = true;
    return X10.api('POST', 'api/profile/select', { id: id }).then(function (res) {
      if (!problemToast(res)) X10.toast(X10.t('WEB_SAVED_ACTIVE'));
      return load();
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); })
      .then(function () { btn.disabled = false; });
  }

  function renderSelect(list) {
    var active = list.filter(function (p) { return p.active; });
    var sel = X10.$('selProfile');
    sel.textContent = '';
    sel.appendChild(el('option', { value: VANILLA, text: X10.t('WEB_VANILLA_NAME') }));
    list.forEach(function (p) { sel.appendChild(el('option', { value: p.id, text: p.name })); });
    if (active.length > 1) {
      sel.appendChild(el('option', { value: MULTI, text: X10.t('WEB_MULTI_ACTIVE', { names: active.map(function (p) { return p.name; }).join(', ') }) }));
      sel.value = MULTI;
    } else {
      sel.value = active.length ? active[0].id : VANILLA;
    }
  }

  function vanillaCard(active) {
    return el('div', { class: 'card' + (active ? ' on' : '') }, [
      el('div', { class: 'row' }, [el('span', { class: 'title', text: X10.t('WEB_VANILLA_NAME') }), el('span', { class: 'spacer' }),
        el('span', { class: 'badge' + (active ? ' on' : ''), text: X10.t(active ? 'WEB_ACTIVE' : 'WEB_INACTIVE') })]),
      el('div', { class: 'muted', text: X10.t('WEB_VANILLA_DESC') }),
      el('div', null, [el('span', { class: 'badge', text: X10.t('WEB_BUILTIN') })]),
      el('div', { class: 'row' }, [el('span', { class: 'spacer' }),
        active ? null : el('button', { class: 'small', type: 'button', text: X10.t('WEB_SELECT_BTN'), onclick: function () { select(VANILLA); } })])
    ]);
  }

  function rename(p) {
    var name = window.prompt(X10.t('WEB_RENAME_PROMPT'), p.name);
    if (name === null) return;
    name = name.trim();
    if (!name) { X10.toast(X10.t('ERR_NAME_REQUIRED'), 'warn'); return; }
    X10.api('POST', 'api/profile/rename', { id: p.id, name: name }).then(function () {
      X10.toast(X10.t('WEB_RENAMED', { name: name }));
      return load();
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  function duplicate(p, btn) {
    btn.disabled = true;
    X10.api('POST', 'api/profile/duplicate', { id: p.id }).then(function (res) {
      X10.toast(X10.t('WEB_DUPLICATED', { name: res.name }));
      return load();
    }).catch(function (e) {
      btn.disabled = false;
      X10.toast(X10.errText(e), 'err');
    });
  }

  function remove(p) {
    if (!confirm(X10.t('WEB_DELETE_CONFIRM', { name: p.name }))) return;
    X10.api('POST', 'api/profile/delete', { id: p.id }).then(function () {
      X10.toast(X10.t('WEB_DELETED', { name: p.name }));
      return load();
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  function receiversText(p) {
    var list = p.receivers && p.receivers.length ? p.receivers : [{ name: (p.device.name || p.device.id) }];
    return X10.t('WEB_RECEIVERS_OF', { list: list.map(function (r) { return r.name || r.device; }).join(', ') });
  }

  function render(list) {
    renderSelect(list);
    var box = X10.$('list');
    box.textContent = '';
    box.appendChild(vanillaCard(!list.some(function (p) { return p.active; })));
    list.forEach(function (p) {
      var href = 'profile.html?id=' + encodeURIComponent(p.id);
      var slot = p.images.indexOf(true);
      var badge = el('span', { class: 'badge' + (p.active ? ' on' : ''), text: X10.t(p.active ? 'WEB_ACTIVE' : 'WEB_INACTIVE') });
      var toggle = el('input', { type: 'checkbox', checked: p.active, onchange: function () {
        toggle.disabled = true;
        X10.api('POST', 'api/profile/activate', { id: p.id, active: toggle.checked }).then(function (res) {
          problemToast(res);
          return load();
        }).catch(function (e) {
          toggle.checked = !toggle.checked;
          toggle.disabled = false;
          X10.toast(X10.errText(e), 'err');
        });
      } });
      box.appendChild(el('div', { class: 'card' + (p.active ? ' on' : '') }, [
        slot !== -1 ? el('a', { href: href }, [el('img', { class: 'thumb', alt: '', src: 'img/' + p.id + '/' + (slot + 1) + '?v=' + encodeURIComponent(p.updated || '') })]) : null,
        el('div', { class: 'row' }, [el('a', { class: 'title', href: href, text: p.name }), el('span', { class: 'spacer' }), badge]),
        el('div', { class: 'muted', text: receiversText(p) }),
        p.rf433 ? el('div', null, [el('span', { class: 'badge', text: '433 MHz' })]) : null,
        el('div', { class: 'muted', text: X10.t('WEB_KEYS_COUNT', { n: p.keys }) }),
        el('div', { class: 'row' }, [el('label', { class: 'check', title: X10.t('WEB_TOGGLE_HELP') }, [toggle, X10.t('WEB_ACTIVE')]),
          el('span', { class: 'spacer' }),
          p.active ? null : el('button', { class: 'small', type: 'button', text: X10.t('WEB_SELECT_ONLY'), onclick: function () { select(p.id); } }),
          el('a', { class: 'btn small', href: href, text: X10.t('WEB_OPEN') })]),
        el('div', { class: 'row tools' }, [
          el('button', { class: 'small', type: 'button', text: X10.t('WEB_RENAME'), onclick: function () { rename(p); } }),
          (function () { var b = el('button', { class: 'small', type: 'button', text: X10.t('WEB_DUPLICATE') }); b.addEventListener('click', function () { duplicate(p, b); }); return b; })(),
          el('a', { class: 'btn small', href: 'print.html?id=' + encodeURIComponent(p.id), target: '_blank', rel: 'noopener', text: X10.t('WEB_PRINT_PROFILE') }),
          el('span', { class: 'spacer' }),
          el('button', { class: 'small danger', type: 'button', text: X10.t('WEB_DELETE'), onclick: function () { remove(p); } })])
      ]));
    });
  }

  // --------------------------------------------------------------- Vorlagen
  function renderPresets(list) {
    var box = X10.$('presets');
    box.textContent = '';
    X10.$('presetSection').classList.toggle('hidden', !list.length);
    list.forEach(function (t) {
      var slot = t.images.indexOf(true);
      var btn = el('button', { class: 'small primary', type: 'button', text: X10.t('WEB_PRESET_CREATE') });
      btn.addEventListener('click', function () {
        btn.disabled = true;
        X10.api('POST', 'api/preset/create', { id: t.id }).then(function (res) {
          location.href = 'profile.html?id=' + encodeURIComponent(res.id) + '&preset=1';
        }).catch(function (e) {
          btn.disabled = false;
          X10.toast(X10.errText(e), 'err');
        });
      });
      box.appendChild(el('div', { class: 'card' }, [
        slot !== -1 ? el('img', { class: 'thumb', alt: '', src: 'pimg/' + t.id + '/' + (slot + 1) }) : null,
        el('div', { class: 'row' }, [el('span', { class: 'title', text: t.name }), el('span', { class: 'spacer' }),
          el('span', { class: 'badge', text: X10.t('WEB_PRESET') })]),
        el('div', { class: 'muted', text: t.description }),
        el('div', { class: 'muted', text: X10.t('WEB_RECEIVERS_OF', { list: t.receivers.map(function (r) { return r.name; }).join(', ') }) }),
        el('div', { class: 'muted', text: X10.t('WEB_KEYS_COUNT', { n: t.keys }) }),
        t.rf433 ? el('div', null, [el('span', { class: 'badge', text: '433 MHz' })]) : null,
        el('div', { class: 'row' }, [el('span', { class: 'spacer' }), btn])
      ]));
    });
  }

  function load() {
    return X10.api('GET', 'api/profiles').then(render).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  X10.$('btnSelect').addEventListener('click', function () {
    var v = X10.$('selProfile').value;
    if (v === MULTI) return;
    select(v);
  });

  X10.init('profiles').then(function () {
    X10.events(function (ev) { if (ev.event === 'reload') load(); });
    X10.api('GET', 'api/presets').then(renderPresets).catch(function () { /* ohne Vorlagen */ });
    return load();
  }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
})();
