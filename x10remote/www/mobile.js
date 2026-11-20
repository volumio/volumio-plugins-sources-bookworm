/* Mobile Remote: switching on, port and assignment of the 20 buttons of the phone page */
(function () {
  'use strict';
  var el = X10.el;
  var table = null;
  var info = null;
  var data = null;
  var dirty = false;
  var audio = {};

  function setDirty(v) {
    dirty = v;
    X10.$('btnSave').textContent = X10.t(v ? 'WEB_SAVE_CHANGES' : 'WEB_SAVE');
  }

  function showProblems(list) {
    var box = X10.$('problems');
    box.textContent = '';
    (list || []).forEach(function (p) {
      box.appendChild(el('div', { class: 'note warn', text: X10.t('WEB_PROBLEM_' + String(p.code).toUpperCase(), { key: p.key || '', other: p.other || '', profile: p.profile || '', max: p.max || '' }) }));
    });
  }

  /** State and addresses of the phone page (as a link and as copyable text). */
  function showState() {
    var st = X10.$('mState');
    var urls = X10.$('mUrls');
    st.textContent = '';
    urls.textContent = '';
    if (!data.enabled) {
      st.appendChild(el('div', { class: 'muted', text: X10.t('WEB_MOBILE_OFF') }));
      return;
    }
    if (!data.running_port) {
      st.appendChild(el('div', { class: 'note warn', text: X10.t('WEB_MOBILE_NOT_RUNNING', { error: data.error || '' }) }));
      return;
    }
    if (data.running_port !== data.port) {
      st.appendChild(el('div', { class: 'note warn', text: X10.t('WEB_MOBILE_PORT_MOVED', { port: String(data.running_port) }) }));
    }
    if (!data.mapper) st.appendChild(el('div', { class: 'note warn', text: X10.t('WEB_MOBILE_MAPPER_OFF') }));
    urls.appendChild(el('div', { class: 'muted', text: X10.t('WEB_MOBILE_URLS') }));
    data.urls.forEach(function (u) {
      urls.appendChild(el('div', null, [el('a', { href: u, target: '_blank', rel: 'noopener', class: 'mono', text: u })]));
    });
    urls.appendChild(el('div', { class: 'muted small', text: X10.t('WEB_MOBILE_HOMESCREEN') }));
  }

  /** Own picture above the volume control, one each for light and dark mode (uploaded unmodified). */
  function renderGraphics(g) {
    var box = X10.$('graphics');
    box.textContent = '';
    ['light', 'dark'].forEach(function (theme) {
      var has = !!g[theme];
      var input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: function () {
        var f = input.files && input.files[0];
        input.value = '';
        if (!f) return;
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { X10.toast(X10.t('ERR_IMAGE_INVALID'), 'warn'); return; }
        if (f.size > 2 * 1024 * 1024) { X10.toast(X10.t('WEB_MOBILE_GRAPHIC_TOO_BIG'), 'warn'); return; }
        var reader = new FileReader();
        reader.onload = function () { send(theme, String(reader.result), add); };
        reader.onerror = function () { X10.toast(X10.t('ERR_IMAGE_INVALID'), 'err'); };
        reader.readAsDataURL(f);
      } });
      var add = el('button', { class: 'small', type: 'button', text: X10.t(has ? 'WEB_IMAGE_REPLACE' : 'WEB_MOBILE_GRAPHIC_CHOOSE'),
        onclick: function () { input.click(); } });
      var remove = has ? el('button', { class: 'small danger', type: 'button', text: X10.t('WEB_IMAGE_DELETE'),
        onclick: function () { send(theme, '', remove); } }) : null;
      box.appendChild(el('div', { class: 'slot' }, [
        el('div', { class: 'title', text: X10.t(theme === 'light' ? 'WEB_SIM_LIGHT' : 'WEB_SIM_DARK') }),
        has ? el('div', { class: 'gprev ' + theme }, [el('img', { alt: '', src: 'sim/graphic-' + theme + '?v=' + encodeURIComponent(g.v || '') })])
          : el('div', { class: 'empty', text: X10.t(g.light || g.dark ? 'WEB_MOBILE_GRAPHIC_OTHER' : 'WEB_MOBILE_GRAPHIC_NONE') }),
        el('div', { class: 'row' }, [add, remove, input])
      ]));
    });
  }

  function send(theme, dataUrl, btn) {
    btn.disabled = true;
    X10.api('POST', 'api/mobile/graphic', { theme: theme, data: dataUrl }).then(function (res) {
      data.graphics = res.graphics;
      renderGraphics(res.graphics);
      X10.toast(X10.t(dataUrl ? 'WEB_IMAGE_SAVED' : 'WEB_SAVED'));
    }).catch(function (e) {
      btn.disabled = false;
      X10.toast(X10.errText(e), 'err');
    });
  }

  function loadThdUsed() {
    return X10.api('GET', 'api/thdused?exclude=' + encodeURIComponent(data.id) + '&devices=')
      .then(function (res) { if (table) table.setThdUsed(res.used); }).catch(function () { /* display only */ });
  }

  function render(d, audioconf) {
    data = d;
    X10.$('mEnabled').checked = d.enabled;
    X10.$('mPort').value = d.port;
    showState();
    renderGraphics(d.graphics || {});
    showProblems(d.problems);
    if (d.duplicates && d.duplicates.length) {
      X10.$('problems').appendChild(el('div', { class: 'note', text: X10.t('WEB_THD_DUPLICATES', {
        list: d.duplicates.map(function (x) { return x.key + ' (' + x.names.join(', ') + ')'; }).join('; ') }) }));
    }
    audio = audioconf || {};
    buildTable(d.keys);
    X10.$('btnPrint').setAttribute('href', 'print.html?id=' + encodeURIComponent(d.id));
    var saved = d.keys.some(function (k) { return k.id; });
    X10.$('btnPrint').classList.toggle('hidden', !saved);
    X10.$('btnTemplate').classList.toggle('hidden', !saved);
    setDirty(false);
    return loadThdUsed();
  }

  function buildTable(keys) {
    X10.$('keyTable').textContent = '';
    table = new X10.KeyTable({ container: X10.$('keyTable'), keys: keys, audioconf: audio, profileId: data.id,
      allowShell: info.allow_shell, mapped: data.mapped, fixed: true, nameHeader: 'WEB_MOBILE_COL_LABEL', nameMax: 20,
      signalHeader: 'WEB_MOBILE_COL_BUTTON',
      sourceText: function (key) { return X10.t('WEB_MOBILE_BUTTON_N', { n: String(key.code) }); },
      onChange: function () { setDirty(true); } });
  }

  // ---- templates: load an assignment (only "Save" applies it) and save the own assignment as template
  function emptyKey(n) {
    return { id: null, name: '', type: 'scan', code: n, scan: n, action: 'none', command: '', thd_key: '', repeat: false,
      remote_label: '', description: '' };
  }

  function applyTemplate(id, ask) {
    return X10.api('GET', 'api/template?id=' + encodeURIComponent(id)).then(function (t) {
      if (t.kind !== 'mobile') return;
      var used = table.getKeys().some(function (k) { return (k.action && k.action !== 'none') || k.thd_key; });
      if (ask && used && !confirm(X10.t('WEB_TEMPLATE_LOAD_CONFIRM', { name: t.name }))) return;
      var byCode = {};
      t.keys.forEach(function (k) {
        var n = parseInt(k.code, 10);
        if (k.type === 'scan' && n >= 1 && n <= data.keys.length && !byCode[n]) byCode[n] = Object.assign(emptyKey(n), k, { id: null, type: 'scan', code: n, scan: n });
      });
      var keys = data.keys.map(function (k, i) { return byCode[i + 1] || emptyKey(i + 1); });
      data.mapped = {};
      buildTable(keys);
      setDirty(true);
      loadThdUsed();
      X10.toast(X10.t('WEB_TEMPLATE_LOADED', { name: t.name }) + (t.skipped_custom ? ' ' + X10.t('WEB_TEMPLATE_CUSTOM_SKIPPED', { n: String(t.skipped_custom) }) : ''), null, 9000);
    }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
  }

  function loadTemplates() {
    var sel = X10.$('selTemplate');
    return X10.api('GET', 'api/templates').then(function (list) {
      list = list.filter(function (t) { return t.kind === 'mobile'; });
      sel.textContent = '';
      sel.appendChild(el('option', { value: '', text: X10.t('WEB_TEMPLATE_LOAD') }));
      list.forEach(function (t) { sel.appendChild(el('option', { value: t.id, text: t.name + (t.user ? ' – ' + X10.t('WEB_TEMPLATE_OWN') : '') })); });
      sel.classList.toggle('hidden', !list.length);
    }).catch(function () { sel.classList.add('hidden'); });
  }

  function load() {
    return Promise.all([X10.api('GET', 'api/mobile'), X10.api('GET', 'api/audioconf')]).then(function (res) {
      return render(res[0], res[1]);
    });
  }

  function save() {
    var port = parseInt(X10.$('mPort').value, 10);
    if (!(port >= 1024 && port <= 65535)) { X10.toast(X10.t('ERR_MOBILE_PORT_INVALID'), 'warn'); return; }
    var btn = X10.$('btnSave');
    btn.disabled = true;
    X10.api('POST', 'api/mobile/save', { enabled: X10.$('mEnabled').checked, port: port, keys: table.getKeys() }).then(function () {
      X10.toast(X10.t('WEB_SAVED'));
      return load();
    }).catch(function (e) {
      X10.toast(X10.errText(e), 'err');
    }).then(function () { btn.disabled = false; });
  }

  function onEvent(ev) {
    if (!table || !data || ev.event !== 'press' || !ev.id || ev.id.indexOf(data.id + '/') !== 0) return;
    table.light(table.findById(ev.id.slice(data.id.length + 1)), 'on');
  }

  X10.$('btnSave').addEventListener('click', save);
  X10.$('selTemplate').addEventListener('change', function () {
    var sel = X10.$('selTemplate');
    var id = sel.value;
    sel.value = '';
    if (id) applyTemplate(id, true);
  });
  X10.$('btnTemplate').addEventListener('click', function () {
    if (dirty && !confirm(X10.t('WEB_TEMPLATE_UNSAVED'))) return;
    var btn = X10.$('btnTemplate');
    btn.disabled = true;
    X10.api('POST', 'api/template/save', { id: data.id }).then(function (res) {
      X10.toast(X10.t('WEB_TEMPLATE_SAVED', { folder: res.folder }), null, 9000);
      return loadTemplates();
    }).catch(function (e) {
      X10.toast(X10.errText(e), 'err');
    }).then(function () { btn.disabled = false; });
  });
  X10.$('mEnabled').addEventListener('change', function () { setDirty(true); });
  X10.$('mPort').addEventListener('input', function () { setDirty(true); });
  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  X10.init('mobile').then(function (i) {
    info = i;
    return load();
  }).then(function () {
    X10.events(onEvent);
    loadTemplates();
    if (X10.query('template')) return applyTemplate(X10.query('template'), true);
  }).catch(function (e) {
    X10.$('actions').classList.add('hidden');
    X10.toast(X10.errText(e), 'err');
  });
})();
