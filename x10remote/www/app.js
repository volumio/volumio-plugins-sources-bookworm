/* Gemeinsame Hilfen der Weboberflaeche (X10 RF Remote) */
(function () {
  'use strict';

  var X10 = window.X10 = {};
  var T = {};
  var info = null;

  // ------------------------------------------------------------------ Grundlagen
  X10.t = function (key, vars) {
    var s = T[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  };

  X10.el = function (tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'value') e.value = v;
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  };

  X10.$ = function (id) { return document.getElementById(id); };

  X10.CMD_MAX = 2000;     // wie LIMITS.COMMAND im Plugin

  /** systemd-Zustand (active, inactive, failed …) uebersetzt. */
  X10.stateText = function (state) {
    var s = String(state || '').trim().toLowerCase();
    return X10.t('WEB_STATE_' + (/^(active|inactive|failed|activating|deactivating|reloading)$/.test(s) ? s.toUpperCase() : 'UNKNOWN'));
  };

  /**
   * Mehrzeilig angezeigtes, aber einzeiliges Befehlsfeld: waechst mit dem Inhalt, Enter fuegt keinen
   * Zeilenumbruch ein (Triggerhappy erwartet einen Befehl pro Zeile).
   */
  X10.commandInput = function (value, onInput) {
    var ta = X10.el('textarea', { class: 'cmdtext', rows: '2', maxlength: String(X10.CMD_MAX), spellcheck: 'false',
      autocomplete: 'off', placeholder: '/usr/local/bin/x10remote-action volume 30' });
    ta.value = value || '';
    var grow = function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight + 2, 320) + 'px';
    };
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    ta.addEventListener('input', function () {
      if (/[\r\n]/.test(ta.value)) ta.value = ta.value.replace(/[\r\n]+/g, ' ');
      grow();
      if (onInput) onInput(ta.value);
    });
    ta.grow = grow;
    setTimeout(grow, 0);
    return ta;
  };

  X10.hex = function (n) {
    var h = Number(n).toString(16);
    return '0x' + (h.length < 2 ? '0' + h : h);
  };

  X10.source = function (k) {
    return k.type === 'scan' ? 'Scan ' + X10.hex(k.code) : (k.key_name || ('Key ' + k.code));
  };

  X10.query = function (name) {
    return new URLSearchParams(location.search).get(name);
  };

  // ---------------------------------------------------------------------- API
  X10.api = function (method, url, body) {
    var opts = { method: method, headers: { 'Accept': 'application/json' }, cache: 'no-store' };
    // Texte, die der Server liefert (z. B. Aktionsnamen), in der Sprache der Weboberflaeche
    var lang = X10.langChoice ? X10.langChoice() : '';
    if (lang && method === 'GET' && !/[?&]lang=/.test(url)) url += (url.indexOf('?') === -1 ? '?' : '&') + 'lang=' + encodeURIComponent(lang);
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || ('HTTP ' + r.status));
          err.code = data.error || 'http_' + r.status;
          err.detail = data.detail || '';
          throw err;
        }
        return data;
      });
    });
  };

  X10.errText = function (e) {
    var code = (e && e.code) || 'internal_error';
    var text = T['ERR_' + String(code).toUpperCase()];
    if (!text) text = X10.t('ERR_GENERIC', { code: code });
    if (e && e.detail) text += ' (' + e.detail + ')';
    return text;
  };

  var toastTimer = null;
  X10.toast = function (msg, type, ms) {
    var box = X10.$('toast');
    if (!box) {
      box = X10.el('div', { id: 'toast', class: 'toast', role: 'status' });
      document.body.appendChild(box);
    }
    box.className = 'toast' + (type ? ' ' + type : '');
    box.textContent = msg;
    box.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.add('hidden'); }, ms || (type === 'err' ? 8000 : 4000));
  };

  X10.flash = function (node, cls, ms) {
    if (!node) return;
    clearTimeout(node._x10t);
    node.classList.remove('on', 'warn', 'pass', 'stop');
    void node.offsetWidth;
    node.classList.add(cls);
    node._x10t = setTimeout(function () { node.classList.remove(cls); }, ms || 700);
  };

  // ----------------------------------------------------------------- Seitenaufbau
  var LANG_KEY = 'x10.lang';
  var LANG_NAMES = { de: 'Deutsch', en: 'English', es: 'Español', fr: 'Français', it: 'Italiano' };
  var i18nInfo = null;

  /**
   * Sprache der Weboberflaeche: standardmaessig wie Volumio. Eine feste Wahl im Kopf gilt nur, solange die
   * Sprache in Volumio dieselbe bleibt wie beim Auswaehlen - stellt man Volumio um, folgt die Oberflaeche wieder
   * automatisch. Gespeichert je Browser (reine Bequemlichkeit).
   */
  function readChoice() {
    try {
      var v = JSON.parse(localStorage.getItem(LANG_KEY) || 'null');
      if (v && typeof v === 'object' && v.l) return v;
    } catch (e) { /* alter Eintrag (nur Text) */ }
    try { localStorage.removeItem(LANG_KEY); } catch (e) { /* ignore */ }   // alte/ungueltige Eintraege verwerfen
    return null;
  }
  function writeChoice(l, volumioLang) {
    try {
      if (l) localStorage.setItem(LANG_KEY, JSON.stringify({ l: l, v: volumioLang }));
      else localStorage.removeItem(LANG_KEY);
    } catch (e) { /* ohne Speicher: gilt nur bis zum Neuladen */ }
  }
  X10.langChoice = function () {
    var c = readChoice();
    return c ? c.l : '';
  };

  X10.init = function (page) {
    var choice = X10.langChoice();
    var loadTexts = function (lang) {
      return X10.api('GET', 'api/i18n' + (lang ? '?lang=' + encodeURIComponent(lang) : ''));
    };
    return Promise.all([loadTexts(choice), X10.api('GET', 'api/info')]).then(function (res) {
      var c = readChoice();
      // feste Wahl verfaellt, wenn Volumio inzwischen auf eine andere Sprache gestellt wurde
      if (c && (c.v !== res[0].volumio_lang || c.l === res[0].volumio_lang)) {
        writeChoice('');
        return loadTexts('').then(function (t) { return [t, res[1]]; });
      }
      return res;
    }).then(function (res) {
      T = res[0].text || {};
      i18nInfo = res[0];
      info = res[1];
      document.documentElement.lang = res[0].lang || 'en';
      document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = X10.t(n.getAttribute('data-i18n')); });
      document.querySelectorAll('[data-i18n-ph]').forEach(function (n) { n.setAttribute('placeholder', X10.t(n.getAttribute('data-i18n-ph'))); });
      buildHeader(page);
      return info;
    }).catch(function (e) {
      document.body.insertBefore(X10.el('div', { class: 'wrap' }, [
        X10.el('div', { class: 'note err', text: 'X10 RF Remote: ' + (e.message || e) })]), document.body.firstChild);
      throw e;
    });
  };

  X10.info = function () { return info; };

  function buildHeader(page) {
    var links = [
      ['index.html', 'WEB_NAV_HOME', 'home'], ['test.html', 'WEB_NAV_TEST', 'test'],
      ['wizard.html', 'WEB_NAV_WIZARD', 'wizard'], ['profiles.html', 'WEB_NAV_PROFILES', 'profiles'],
      ['receivers.html', 'WEB_NAV_RECEIVERS', 'receivers']
    ];
    var nav = X10.el('nav', null, links.map(function (l) {
      return X10.el('a', { href: l[0], class: l[2] === page ? 'on' : null, text: X10.t(l[1]) });
    }));
    var mapperOk = info && info.mapper === 'active';
    var status = X10.el('div', { class: 'status' }, [
      X10.el('span', null, [X10.el('i', { class: 'dot', id: 'dotConn' }), X10.el('b', { id: 'txtConn', text: '…' })]),
      X10.el('span', null, [X10.el('i', { class: 'dot ' + (mapperOk ? 'ok' : 'bad') }),
        X10.el('b', { text: X10.t('WEB_MAPPER') + ': ' + X10.stateText(info ? info.mapper : '') })])
    ]);
    var langSel = X10.el('select', { class: 'lang', title: X10.t('WEB_LANGUAGE'), 'aria-label': X10.t('WEB_LANGUAGE') });
    var langs = (i18nInfo && i18nInfo.languages) || ['en'];
    langSel.appendChild(X10.el('option', { value: '', text: X10.t('WEB_LANG_AUTO', { lang: LANG_NAMES[i18nInfo && i18nInfo.volumio_lang] || (i18nInfo && i18nInfo.volumio_lang) || 'English' }) }));
    langs.forEach(function (l) { langSel.appendChild(X10.el('option', { value: l, text: LANG_NAMES[l] || l })); });
    langSel.value = X10.langChoice();
    langSel.addEventListener('change', function () {
      var vl = i18nInfo && i18nInfo.volumio_lang;
      writeChoice(langSel.value === vl ? '' : langSel.value, vl);
      location.reload();
    });
    status.appendChild(langSel);
    var top = X10.el('header', { class: 'top' }, [X10.el('div', { class: 'wrap' }, [
      X10.el('a', { class: 'brand', href: 'index.html' }, ['X10 ', X10.el('span', { text: 'RF Remote' })]), nav, status])]);
    document.body.insertBefore(top, document.body.firstChild);
    if (info && !mapperOk) {
      var main = document.querySelector('main');
      if (main) main.insertBefore(X10.el('div', { class: 'note warn', text: X10.t('WEB_MAPPER_DOWN') }), main.firstChild);
    }
  }

  // ------------------------------------------------------------- Live-Ereignisse
  X10.events = function (handler) {
    var es = new EventSource('api/events');
    var set = function (ok) {
      var d = X10.$('dotConn');
      var t = X10.$('txtConn');
      if (d) d.className = 'dot ' + (ok ? 'ok' : 'bad');
      if (t) t.textContent = X10.t(ok ? 'WEB_CONNECTED' : 'WEB_DISCONNECTED');
    };
    es.onopen = function () { set(true); };
    es.onerror = function () { set(false); };
    es.onmessage = function (msg) {
      var ev;
      try { ev = JSON.parse(msg.data); } catch (e) { return; }
      try { handler(ev); } catch (e) { /* Anzeigefehler nicht weitergeben */ }
    };
    return es;
  };

  // ---------------------------------------------------------------- Aktionen
  X10.actionLabel = function (type, action) {
    if (type === 'key' && action === 'none') return X10.t('ACTION_NONE_KEY');
    return X10.t('ACTION_' + String(action).toUpperCase());
  };

  X10.prettyKeyName = function (keyName) {
    var map = {
      KEY_VOLUMEUP: 'WEB_KN_VOLUP', KEY_VOLUMEDOWN: 'WEB_KN_VOLDOWN', KEY_MUTE: 'WEB_KN_MUTE',
      KEY_PLAYPAUSE: 'WEB_KN_PLAYPAUSE', KEY_PLAY: 'WEB_KN_PLAY', KEY_PAUSE: 'WEB_KN_PAUSE',
      KEY_STOP: 'WEB_KN_STOP', KEY_STOPCD: 'WEB_KN_STOP', KEY_NEXTSONG: 'WEB_KN_NEXT', KEY_PREVIOUSSONG: 'WEB_KN_PREV',
      KEY_NEXT: 'WEB_KN_NEXT', KEY_PREVIOUS: 'WEB_KN_PREV', KEY_POWER: 'WEB_KN_POWER'
    };
    if (map[keyName] && T[map[keyName]]) return T[map[keyName]];
    var s = String(keyName || '').replace(/^(KEY|BTN)_/, '').toLowerCase().replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  /** Vorschlag fuer eine Aktion anhand des erkannten Tastencodes (nur als Vorbelegung). */
  X10.suggestAction = function (k) {
    return k.type === 'key' ? 'default' : 'none';
  };

  // ------------------------------------------------------- gemeinsame Bausteine
  /** Befehle aus audio.conf (und anderen fremden Dateien) fuer eine Taste als Text. */
  X10.audioText = function (keyName, audioconf) {
    var list = (audioconf || {})[keyName] || [];
    return list.map(function (a) { return (a.file === 'audio.conf' ? '' : a.file + ': ') + a.command; }).join(' · ');
  };

  /** Erster audio.conf-Befehl (Tastendruck) einer Taste - Vorbelegung fuer "Eigener Befehl". */
  X10.audioCommand = function (keyName, audioconf) {
    var list = keyName ? ((audioconf || {})[keyName] || []) : [];
    var press = list.filter(function (a) { return a.value === 1; })[0] || list[0];
    return press ? press.command : '';
  };

  /** Hinweis zu einer Tastenbelegung: { text, replace }. thdKey = gewaehlte bzw. automatische Triggerhappy-Taste. */
  X10.keyHint = function (type, action, keyName, thdKey, audioconf, isAuto) {
    if (type === 'scan') {
      var cmd = thdKey ? X10.audioText(thdKey, audioconf) : '';
      var base;
      if (isAuto || !thdKey) base = X10.t('WEB_HINT_THD_AUTO', { key: thdKey || X10.t('WEB_THD_AUTO_SHORT') });
      else if (cmd) base = X10.t('WEB_HINT_THD_AUDIO', { key: thdKey, cmd: cmd });
      else base = X10.t('WEB_HINT_THD_NONE', { key: thdKey });
      if (action !== 'none' && cmd && !isAuto) return { text: base + ' ' + X10.t('WEB_HINT_THD_BOTH', { key: thdKey, cmd: cmd }), replace: true };
      if (action === 'none' && (isAuto || !thdKey)) return { text: base + ' ' + X10.t('WEB_HINT_THD_AUTO_NONE'), replace: false };
      return { text: base, replace: false };
    }
    var audio = X10.audioText(keyName, audioconf);
    if (audio) {
      return action === 'default' ? { text: X10.t('WEB_HINT_AUDIO_KEEP', { cmd: audio }), replace: false }
        : { text: X10.t('WEB_HINT_AUDIO_REPLACE', { cmd: audio }), replace: true };
    }
    return { text: X10.t(action === 'default' ? 'WEB_HINT_KEY_DEFAULT' : 'WEB_HINT_KEY_OVERRIDE'), replace: false };
  };

  /**
   * Auswahl der Triggerhappy-Taste, in die der Wrapper einen Scan-Code umsetzt.
   * Leerer Wert = automatisch (freie virtuelle Taste). autoKey = derzeit automatisch vergebene Taste (Anzeige).
   */
  X10.thdSelect = function (current, autoKey, audioconf, onChange) {
    var info = X10.info() || {};
    var all = (info.thd_keys || []).slice();
    var pool = info.virtual_keys || [];
    if (current && all.indexOf(current) === -1) all.unshift(current);
    var inAudio = all.filter(function (k) { return X10.audioText(k, audioconf); });
    var poolKeys = all.filter(function (k) { return pool.indexOf(k) !== -1; });
    var rest = all.filter(function (k) { return pool.indexOf(k) === -1 && !X10.audioText(k, audioconf); });
    var opt = function (k) {
      var cmd = X10.audioText(k, audioconf);
      return X10.el('option', { value: k, text: k + (cmd ? '  –  ' + cmd : '') });
    };
    var sel = X10.el('select', { 'aria-label': X10.t('WEB_THD_KEY'), onchange: function () { onChange(sel.value); } }, [
      X10.el('option', { value: '', text: autoKey ? X10.t('WEB_THD_AUTO_IS', { key: autoKey }) : X10.t('WEB_THD_AUTO') }),
      inAudio.length ? X10.el('optgroup', { label: X10.t('WEB_THD_GROUP_AUDIO') }, inAudio.map(opt)) : null,
      X10.el('optgroup', { label: X10.t('WEB_THD_GROUP_POOL') }, poolKeys.map(opt)),
      X10.el('optgroup', { label: X10.t('WEB_THD_GROUP_ALL', { n: rest.length }) }, rest.map(opt))
    ]);
    sel.value = current || '';
    return sel;
  };

  /**
   * Belegte Triggerhappy-Tasten zusammenstellen: server = { KEY: {profile, key} } (andere Profile),
   * keys = Tasten des bearbeiteten Profils, self = die Taste, deren Auswahl gerade gilt (zaehlt nicht).
   * Rueckgabe { KEY: "wer" }.
   */
  X10.thdUsedMap = function (server, keys, self) {
    // Gleiche Triggerhappy-Taste in verschiedenen Profilen ist erlaubt (gleiche Funktion) - geprueft wird
    // nur innerhalb des Profils. server bleibt fuer Aufrufer erhalten, wird aber nicht mehr verwendet.
    var used = {};
    (keys || []).forEach(function (k) {
      if (k === self) return;
      var who = k.remote_label || k.name || X10.source(k);
      if (k.type === 'scan' && k.thd_key) used[k.thd_key] = who;
      if (k.type === 'key' && k.key_name) used[k.key_name] = who;      // diese Taste erzeugt sie bereits
    });
    return used;
  };

  /** Vergebene Tasten in einer Triggerhappy-Auswahl ausgrauen (die eigene Auswahl bleibt waehlbar). */
  X10.thdMark = function (sel, used) {
    if (!sel) return;
    Array.prototype.forEach.call(sel.querySelectorAll('option'), function (o) {
      if (!o.value) return;
      if (o.getAttribute('data-base') === null) o.setAttribute('data-base', o.textContent);
      var who = used[o.value];
      var taken = !!who && o.value !== sel.value;
      o.disabled = taken;
      o.textContent = o.getAttribute('data-base') + (taken ? '  –  ' + X10.t('WEB_THD_TAKEN', { by: who }) : '');
    });
  };

  /**
   * Hinweis, wenn eigene Befehle gesperrt sind. Freischalten geht bewusst nur im Expertenmodus der
   * Volumio-Einstellungen (mit Hinweis auf die Risiken) - nicht ueber die Weboberflaeche.
   */
  X10.shellNotice = function () {
    var node = X10.el('div', { class: 'hint replace hidden' }, [X10.el('div', { text: X10.t('WEB_SHELL_LOCKED_EXPERT') })]);
    return {
      node: node,
      update: function (custom) {
        var allowed = !!(X10.info() && X10.info().allow_shell);
        node.classList.toggle('hidden', !(custom && !allowed));
      }
    };
  };

  // ------------------------------------------------------------ Befehlsreferenz
  /**
   * Zeigt "command reference.txt" zum Markieren und Kopieren. input (optional): Befehlsfeld, in das
   * "Markierung übernehmen" bzw. ein Doppelklick auf eine Zeile den Befehl schreibt.
   */
  X10.commandRef = function (input) {
    var pre = X10.el('div', { class: 'cmdref', tabindex: '0' });
    var file = X10.el('div', { class: 'muted mono' });
    var filter = X10.el('input', { type: 'search', placeholder: X10.t('WEB_CMDREF_FILTER') });
    var take = input ? X10.el('button', { class: 'primary', type: 'button', text: X10.t('WEB_CMDREF_TAKE') }) : null;
    var close = X10.el('button', { type: 'button', text: X10.t('WEB_CLOSE') });
    var lines = [];
    var back = X10.el('div', { class: 'dlg-back top', role: 'dialog', 'aria-modal': 'true' }, [X10.el('div', { class: 'dlg wide' }, [
      X10.el('h3', { text: X10.t('WEB_CMDREF_TITLE') }), file,
      X10.el('p', { class: 'muted', text: X10.t(input ? 'WEB_CMDREF_HELP' : 'WEB_CMDREF_HELP_RO') }),
      filter, pre,
      X10.el('div', { class: 'actions' }, [close, take])
    ])]);

    function commandPart(text) {
      var line = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l; })[0] || '';
      return line.split(/\s{3,}/)[0].trim();
    }
    function use(text) {
      var cmd = commandPart(text);
      if (!cmd || !input) return false;
      input.value = cmd.slice(0, X10.CMD_MAX);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      done();
      input.focus();
      X10.toast(X10.t('WEB_CMDREF_TAKEN'));
      return true;
    }
    function render() {
      var q = filter.value.trim().toLowerCase();
      pre.textContent = '';
      lines.forEach(function (l) {
        if (q && l.toLowerCase().indexOf(q) === -1) return;
        var isCmd = /^\s*(\/|https?:)/.test(l);
        pre.appendChild(X10.el('div', { class: 'ln' + (isCmd ? ' cmd' : ''), text: l || ' ',
          title: isCmd && input ? X10.t('WEB_CMDREF_DBL') : null,
          ondblclick: isCmd && input ? function () { use(l); } : null }));
      });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); done(); }
    }
    function done() {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    filter.addEventListener('input', render);
    close.addEventListener('click', done);
    if (take) {
      take.addEventListener('click', function () {
        if (!use(window.getSelection ? window.getSelection().toString() : '')) X10.toast(X10.t('WEB_CMDREF_SELECT_FIRST'), 'warn');
      });
    }
    back.addEventListener('click', function (e) { if (e.target === back) done(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    X10.api('GET', 'api/commandref').then(function (r) {
      file.textContent = r.file + (r.truncated ? ' (' + X10.t('WEB_CMDREF_TRUNCATED') + ')' : '');
      lines = String(r.text).replace(/\r\n?/g, '\n').split('\n');
      render();
    }).catch(function (e) {
      pre.textContent = X10.errText(e);
    });
  };

  /** Button "Command reference" neben einem Befehlsfeld. */
  X10.cmdRefButton = function (input) {
    return X10.el('button', { class: 'small', type: 'button', text: X10.t('WEB_CMDREF_BTN'), title: X10.t('WEB_CMDREF_TITLE'),
      onclick: function (e) { e.preventDefault(); X10.commandRef(input); } });
  };

  /** Befehlsfeld + Button als eine Zeile. */
  X10.cmdLine = function (input) {
    return X10.el('div', { class: 'cmdline' }, [input, X10.cmdRefButton(input)]);
  };

  // ------------------------------------------------------------ Tastentabelle
  /**
   * Editierbare Tabelle der Tasten eines Profils.
   * opts: { container, keys, audioconf, allowShell, mapped, onChange }
   */
  X10.KeyTable = function (opts) {
    this.opts = opts;
    this.rows = [];
    this.tbody = X10.el('tbody');
    var head = X10.el('thead', null, [X10.el('tr', null, [
      X10.el('th', { text: '' }), X10.el('th', { text: X10.t('WEB_COL_NAME') }), X10.el('th', { text: X10.t('WEB_COL_SIGNAL') }),
      X10.el('th', { text: X10.t('WEB_COL_ACTION') }), X10.el('th', { text: '' })])]);
    this.table = X10.el('table', { class: 'keys' }, [head, this.tbody]);
    this.empty = X10.el('div', { class: 'muted', text: X10.t('WEB_NO_KEYS') });
    opts.container.textContent = '';
    opts.container.appendChild(this.table);
    opts.container.appendChild(this.empty);
    var self = this;
    (opts.keys || []).forEach(function (k) { self.add(k, true); });
    this.refreshEmpty();
  };

  X10.KeyTable.prototype.ident = function (k) { return k.type + ':' + k.code; };

  X10.KeyTable.prototype.find = function (type, code) {
    for (var i = 0; i < this.rows.length; i++) {
      if (this.rows[i].key.type === type && Number(this.rows[i].key.code) === Number(code)) return this.rows[i];
    }
    return null;
  };

  X10.KeyTable.prototype.findById = function (id) {
    for (var i = 0; i < this.rows.length; i++) if (this.rows[i].key.id === id) return this.rows[i];
    return null;
  };

  X10.KeyTable.prototype.refreshEmpty = function () {
    this.empty.classList.toggle('hidden', this.rows.length > 0);
    this.table.classList.toggle('hidden', this.rows.length === 0);
  };

  X10.KeyTable.prototype.changed = function () {
    if (this.opts.onChange) this.opts.onChange();
  };

  /** Neue Taste hinzufuegen (oder vorhandene Zeile liefern). */
  X10.KeyTable.prototype.add = function (k, silent) {
    var existing = this.find(k.type, k.code);
    if (existing) return existing;
    var self = this;
    var key = X10.normKey(k);
    var row = { key: key };
    var info = X10.info() || { actions: { scan: [], key: [] } };
    var acts = key.type === 'key' ? info.actions.key : info.actions.scan;
    var input = function (field, max, ph) {
      return X10.el('input', { type: 'text', maxlength: String(max), value: key[field], placeholder: X10.t(ph), 'aria-label': X10.t(ph),
        oninput: function (e) { key[field] = e.target.value; self.changed(); } });
    };

    row.led = X10.el('div', { class: 'led' });
    row.name = input('name', 60, 'WEB_COL_NAME');
    row.remote = input('remote_label', 40, 'WEB_REMOTE_LABEL_SHORT');
    row.desc = input('description', 200, 'WEB_KEY_DESCRIPTION');

    var badge = X10.el('span', { class: 'badge ' + key.type, text: X10.t(key.type === 'key' ? 'WEB_TYPE_KEY' : 'WEB_TYPE_SCAN') });
    var orig = X10.el('div', { class: 'orig' }, [X10.source(key) + (key.type === 'key' && key.scan !== null ? '  (Scan ' + X10.hex(key.scan) + ')' : ''), ' ', badge]);
    row.hint = X10.el('div', { class: 'hint' });
    row.vkey = X10.el('div', { class: 'vkey' });

    row.prevAction = key.action;
    row.radio = X10.radioBox(key, { profileId: self.opts.profileId, onChange: function () { self.changed(); },
      onCancelNew: function () { key.action = row.prevAction === 'radio' ? 'none' : row.prevAction; row.select.value = key.action; self.update(row); } });
    row.select = X10.el('select', { 'aria-label': X10.t('WEB_COL_ACTION'),
      onchange: function () {
        key.action = row.select.value;
        if (key.action === 'radio' && !key.radio) row.radio.open(true);
        if (key.action !== 'radio') row.prevAction = key.action;
        if (key.action === 'custom' && !key.command.trim()) {
          var pre = X10.audioCommand(key.type === 'key' ? key.key_name : key.thd_key, self.opts.audioconf);
          if (pre) {
            key.command = pre;
            row.cmd.value = pre;
            X10.toast(X10.t('WEB_CMD_FROM_AUDIO') + ': ' + pre, 'ok');
          }
        }
        self.update(row);
        self.changed();
      } },
    acts.map(function (a) { return X10.el('option', { value: a, text: X10.actionLabel(key.type, a) }); }));
    row.select.value = acts.indexOf(key.action) !== -1 ? key.action : acts[0];
    key.action = row.select.value;
    var m0 = key.id && self.opts.mapped ? self.opts.mapped[key.id] : null;
    row.autoKey = m0 && m0.virtual ? m0.key : '';
    if (key.type === 'scan') {
      row.thd = X10.thdSelect(key.thd_key, row.autoKey, self.opts.audioconf, function (v) { key.thd_key = v; self.update(row); self.markThd(); self.changed(); });
      row.thdBox = X10.el('label', { class: 'field cmd' }, [X10.el('span', { text: X10.t('WEB_THD_KEY') }), row.thd]);
    } else {
      row.thdBox = X10.el('div', { class: 'vkey', text: X10.t('WEB_THD_KEY_FIXED', { key: key.key_name || ('Key ' + key.code) }) });
    }
    row.cmd = X10.commandInput(key.command, function (v) { key.command = v; self.changed(); });
    row.cmdBox = X10.cmdLine(row.cmd);
    // eigene Zeile ueber die volle Tabellenbreite, damit auch lange Befehle lesbar bleiben
    row.cmdTr = X10.el('tr', { class: 'cmdrow' }, [X10.el('td', { class: 'ledcell' }),
      X10.el('td', { colspan: '4' }, [X10.el('div', { class: 'cmdlabel', text: X10.t('WEB_CFG_COMMAND') }), row.cmdBox])]);
    row.shell = X10.shellNotice(function () { self.rows.forEach(function (r) { self.update(r); }); });
    row.repeat = X10.el('input', { type: 'checkbox', checked: key.repeat,
      onchange: function () { key.repeat = row.repeat.checked; self.changed(); } });
    row.repeatLabel = X10.el('label', { class: 'check' }, [row.repeat, X10.t('WEB_REPEAT')]);
    var del = X10.el('button', { class: 'small danger', type: 'button', title: X10.t('WEB_DELETE_KEY'), text: '✕',
      onclick: function () {
        self.rows = self.rows.filter(function (r) { return r !== row; });
        row.tr.remove();
        row.cmdTr.remove();
        self.refreshEmpty();
        self.markThd();
        self.changed();
      } });

    row.tr = X10.el('tr', null, [
      X10.el('td', { class: 'ledcell' }, [row.led]),
      X10.el('td', { class: 'name' }, [row.name, X10.el('div', { class: 'cmd' }, [row.remote])]),
      X10.el('td', null, [orig, row.hint, row.vkey]),
      X10.el('td', { class: 'act' }, [row.thdBox, row.select, row.radio.node, row.shell.node,
        X10.el('div', { class: 'cmd' }, [row.desc]), X10.el('div', { class: 'cmd' }, [row.repeatLabel])]),
      X10.el('td', null, [del])
    ]);
    this.rows.push(row);
    this.tbody.appendChild(row.tr);
    this.tbody.appendChild(row.cmdTr);
    this.update(row);
    this.refreshEmpty();
    this.markThd();
    if (!silent) this.changed();
    return row;
  };

  /** Triggerhappy-Auswahl aller Zeilen: von anderen Tasten belegte Eintraege ausgrauen. */
  X10.KeyTable.prototype.markThd = function () {
    var self = this;
    var keys = this.rows.map(function (r) { return r.key; });
    this.rows.forEach(function (r) {
      if (r.thd) X10.thdMark(r.thd, X10.thdUsedMap(self.opts.thdUsed, keys, r.key));
    });
  };

  X10.KeyTable.prototype.setThdUsed = function (server) {
    this.opts.thdUsed = server || {};
    this.markThd();
  };

  X10.KeyTable.prototype.update = function (row) {
    var k = row.key;
    var hint = X10.keyHint(k.type, k.action, k.key_name, k.thd_key || row.autoKey, this.opts.audioconf, !k.thd_key);
    row.hint.textContent = hint.text;
    row.hint.classList.toggle('replace', hint.replace);
    var custom = k.action === 'custom';
    row.cmdTr.classList.toggle('hidden', !custom);
    row.tr.classList.toggle('hascmd', custom);
    if (custom) row.cmd.grow();
    row.shell.update(custom);
    row.repeatLabel.classList.toggle('hidden', k.action === 'none' || k.action === 'default');
    row.desc.parentNode.classList.toggle('hidden', k.action === 'default');
    row.radio.update();
    row.vkey.textContent = '';
  };

  X10.KeyTable.prototype.setMapped = function (mapped) {
    var self = this;
    this.opts.mapped = mapped || {};
    this.rows.forEach(function (r) {
      var m = r.key.id ? self.opts.mapped[r.key.id] : null;
      r.autoKey = m && m.virtual ? m.key : '';
      if (r.thd && r.thd.options.length) {
        r.thd.options[0].text = r.autoKey ? X10.t('WEB_THD_AUTO_IS', { key: r.autoKey }) : X10.t('WEB_THD_AUTO');
      }
      self.update(r);
    });
  };

  X10.KeyTable.prototype.light = function (row, cls) {
    if (!row) return;
    X10.flash(row.led, cls || 'on');
    X10.flash(row.tr, 'flash', 600);
  };

  X10.KeyTable.prototype.getKeys = function () {
    return this.rows.map(function (r) { return X10.keyOut(r.key); });
  };

  /** Taste in die bearbeitbare Form bringen (gemeinsam fuer Tabelle und Einzel-Editor). */
  X10.normKey = function (k) {
    var key = {
      id: k.id || null, name: k.name || '', type: k.type, code: k.code, scan: k.scan === undefined ? null : k.scan,
      key_name: k.key_name || null, action: k.action || X10.suggestAction(k), command: k.command || '', repeat: !!k.repeat,
      thd_key: k.type === 'scan' ? (k.thd_key || (k.action === 'tkey' ? k.target : '') || '') : null,
      remote_label: k.remote_label || '', description: k.description || '',
      radio: k.radio ? JSON.parse(JSON.stringify(k.radio)) : null
    };
    if (key.action === 'tkey') key.action = 'none';
    return key;
  };

  /** Taste fuer das Speichern. */
  X10.keyOut = function (k) {
    return { id: k.id || undefined, name: String(k.name || '').trim(), type: k.type, code: k.code, scan: k.scan,
      key_name: k.key_name, action: k.action, command: k.action === 'custom' ? String(k.command || '').trim() : '', repeat: !!k.repeat,
      thd_key: k.type === 'scan' ? (k.thd_key || '') : null, remote_label: String(k.remote_label || '').trim(),
      description: String(k.description || '').trim(),
      radio: k.action === 'radio' && k.radio ? k.radio : undefined };
  };

  /** Kurzbeschreibung einer Taste fuer Listen: Aktion bzw. eigener Befehl. */
  X10.keySummary = function (k) {
    if (k.action === 'custom') return X10.t('ACTION_CUSTOM').replace(/\s*…$/, '') + (k.command ? ': ' + k.command : '');
    if (k.action === 'radio') return X10.t('ACTION_RADIO').replace(/\s*…$/, '') + (k.radio ? ': ' + k.radio.name : '');
    return X10.actionLabel(k.type, k.action);
  };

  // ------------------------------------------------------------ Einzel-Editor
  /**
   * Formular fuer genau eine Taste (Assistent). opts: { container, audioconf, onChange }.
   * edit(key) zeigt die Taste (das Objekt wird direkt veraendert), clear() leert das Formular.
   */
  X10.KeyEditor = function (opts) {
    this.opts = opts;
    this.key = null;
  };

  X10.KeyEditor.prototype.clear = function () {
    this.key = null;
    this.opts.container.textContent = '';
  };

  X10.KeyEditor.prototype.edit = function (key) {
    var self = this;
    var el = X10.el;
    var info = X10.info() || { actions: { scan: [], key: [] } };
    var acts = key.type === 'key' ? info.actions.key : info.actions.scan;
    var changed = function () { if (self.opts.onChange) self.opts.onChange(key); };
    this.key = key;
    var c = this.opts.container;
    c.textContent = '';

    var text = function (field, max, label, ph) {
      var inp = el('input', { type: 'text', maxlength: String(max), value: key[field], placeholder: ph ? X10.t(ph) : '',
        oninput: function () { key[field] = inp.value; changed(); } });
      return { input: inp, node: el('label', { class: 'field' }, [el('span', { text: X10.t(label) }), inp]) };
    };
    var name = text('name', 60, 'WEB_COL_NAME');
    var label = text('remote_label', 40, 'WEB_REMOTE_LABEL', 'WEB_REMOTE_LABEL_PH');
    var desc = text('description', 200, 'WEB_KEY_DESCRIPTION', 'WEB_KEY_DESCRIPTION_PH');
    var hint = el('div', { class: 'hint' });
    var prevAction = key.action;
    var radioBox = X10.radioBox(key, { profileId: self.opts.profileId, onChange: changed,
      onCancelNew: function () { key.action = prevAction === 'radio' ? 'none' : prevAction; select.value = key.action; update(); } });
    var select = el('select', { onchange: function () {
      key.action = select.value;
      if (key.action === 'radio' && !key.radio) radioBox.open(true);
      if (key.action !== 'radio') prevAction = key.action;
      if (key.action === 'custom' && !key.command.trim()) {
        var pre = X10.audioCommand(key.type === 'key' ? key.key_name : key.thd_key, self.opts.audioconf);
        if (pre) { key.command = pre; cmd.value = pre; }
      }
      update(); changed();
    } }, acts.map(function (a) { return el('option', { value: a, text: X10.actionLabel(key.type, a) }); }));
    select.value = acts.indexOf(key.action) !== -1 ? key.action : acts[0];
    key.action = select.value;
    var thdBox = null;
    if (key.type === 'scan') {
      var thd = X10.thdSelect(key.thd_key, '', self.opts.audioconf, function (v) { key.thd_key = v; update(); changed(); });
      if (self.opts.used) X10.thdMark(thd, self.opts.used(key));
      thdBox = el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_THD_KEY') }), thd]);
    }
    var cmd = X10.commandInput(key.command, function (v) { key.command = v; changed(); });
    var cmdBox = el('div', { class: 'field' }, [el('span', { text: X10.t('WEB_CFG_COMMAND') }), X10.cmdLine(cmd)]);
    var shell = X10.shellNotice();
    var repeat = el('input', { type: 'checkbox', checked: key.repeat, onchange: function () { key.repeat = repeat.checked; changed(); } });
    var repeatLabel = el('label', { class: 'check' }, [repeat, ' ', X10.t('WEB_REPEAT')]);

    function update() {
      var h = X10.keyHint(key.type, key.action, key.key_name, key.thd_key, self.opts.audioconf, !key.thd_key);
      hint.textContent = h.text;
      hint.classList.toggle('replace', h.replace);
      var custom = key.action === 'custom';
      cmdBox.classList.toggle('hidden', !custom);
      if (custom) cmd.grow();
      shell.update(custom);
      repeatLabel.classList.toggle('hidden', key.action === 'none' || key.action === 'default');
      desc.node.classList.toggle('hidden', key.action === 'default');
      radioBox.update();
    }

    var badge = el('span', { class: 'badge ' + key.type, text: X10.t(key.type === 'key' ? 'WEB_TYPE_KEY' : 'WEB_TYPE_SCAN') });
    c.appendChild(el('div', { class: 'keyedit' }, [
      el('div', { class: 'row signal' }, [el('span', { class: 'mono', text: X10.source(key) +
        (key.type === 'key' && key.scan !== null ? '  (Scan ' + X10.hex(key.scan) + ')' : '') }), badge]),
      el('div', { class: 'grid2' }, [name.node, label.node]),
      el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_COL_ACTION') }), select]),
      radioBox.node, shell.node, thdBox, hint, cmdBox, desc.node, repeatLabel
    ]));
    update();
    this.nameInput = name.input;
    return this;
  };

  X10.KeyEditor.prototype.focus = function () {
    if (this.nameInput) { this.nameInput.focus(); this.nameInput.select(); }
  };

  // ------------------------------------------------------------- Radiosender
  var RADIO_API = 'http://127.0.0.1:3000/api/v1/replaceAndPlay';

  /** Entsprechender curl-Befehl (Anzeige; ausgefuehrt wird x10remote-action radio mit Failover). */
  X10.radioCurl = function (name, uri) {
    var json = JSON.stringify({ service: 'webradio', type: 'webradio', title: name || '', uri: uri || '' });
    return "curl -s -X POST -H 'Content-Type: application/json' -d '" + json.replace(/'/g, "'\\''") + "' " + RADIO_API;
  };

  /**
   * Anzeige "Radiosender" unter der Aktionsauswahl einer Taste. opts: { profileId, onChange, onCancelNew }.
   * open(isNew): Dialog; bei Abbruch eines neuen Senders wird die vorige Aktion wiederhergestellt.
   */
  X10.radioBox = function (key, opts) {
    var el = X10.el;
    var summary = el('div', { class: 'radiosum' });
    var btn = el('button', { class: 'small', type: 'button', text: X10.t('WEB_RADIO_EDIT') });
    var node = el('div', { class: 'radiobox hidden' }, [summary, btn]);
    function update() {
      var on = key.action === 'radio';
      node.classList.toggle('hidden', !on);
      if (!on) return;
      var r = key.radio;
      summary.textContent = r ? (r.name + ' · ' + X10.t('WEB_RADIO_URIS_N', { n: r.uris.length }) +
        (r.quality ? ' · ' + r.quality : '') + (r.format ? ' · ' + r.format : '')) : X10.t('WEB_RADIO_NOT_SET');
      summary.classList.toggle('warn', !r);
    }
    function open(isNew) {
      X10.radioDialog(key.radio, { profileId: opts.profileId, keyId: key.id }, function (radio) {
        key.radio = radio;
        update();
        if (opts.onChange) opts.onChange();
      }, function () {
        if (isNew && !key.radio && opts.onCancelNew) opts.onCancelNew();
        update();
      });
    }
    btn.addEventListener('click', function () { open(false); });
    return { node: node, update: update, open: open };
  };

  /** Dialog "Radiosender": Vorlage, Name, bis zu 3 URIs (Failover), Anzeige-Daten, Pruefung, curl-Vorschau. */
  X10.radioDialog = function (radio, ctx, onOk, onCancel) {
    var el = X10.el;
    var r = radio ? JSON.parse(JSON.stringify(radio)) : { name: '', uris: [], logo: null, quality: '', format: '' };
    var field = function (label, input, help) {
      return el('label', { class: 'field' }, [el('span', { text: X10.t(label) }), input, help ? el('div', { class: 'muted small', text: X10.t(help) }) : null]);
    };
    var preset = el('select', null, [el('option', { value: '', text: X10.t('WEB_RADIO_PRESET_CHOOSE') })]);
    var presetInfo = el('div', { class: 'muted small' });
    var name = el('input', { type: 'text', maxlength: '100', value: r.name, placeholder: X10.t('WEB_RADIO_NAME_PH') });
    var uris = [0, 1, 2].map(function (i) {
      return el('input', { type: 'url', maxlength: '2000', value: r.uris[i] || '', placeholder: i ? X10.t('WEB_RADIO_URI_FALLBACK_PH') : 'http://…', spellcheck: 'false' });
    });
    var quality = el('input', { type: 'text', maxlength: '40', value: r.quality || '', placeholder: X10.t('WEB_RADIO_QUALITY_PH') });
    var format = el('input', { type: 'text', maxlength: '40', value: r.format || '', placeholder: X10.t('WEB_RADIO_FORMAT_PH') });
    var logoImg = el('img', { class: 'radiologo', alt: '' });
    var logoEmpty = el('span', { class: 'muted', text: X10.t('WEB_RADIO_LOGO_NONE') });
    var logoInput = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    var logoAdd = el('button', { class: 'small', type: 'button', text: X10.t('WEB_RADIO_LOGO_UPLOAD') });
    var logoDel = el('button', { class: 'small danger', type: 'button', text: X10.t('WEB_IMAGE_DELETE') });
    var check = el('input', { type: 'checkbox', checked: true });
    var results = el('div', { class: 'radioresults' });
    var curl = el('textarea', { class: 'mono curl', readonly: 'readonly', rows: '3', spellcheck: 'false' });
    var runBtn = el('button', { type: 'button', text: X10.t('WEB_RADIO_CHECK_NOW') });
    var cancel = el('button', { type: 'button', text: X10.t('WEB_CANCEL') });
    var ok = el('button', { class: 'primary', type: 'button', text: X10.t('WEB_RADIO_APPLY') });
    var presets = [];

    function showLogo() {
      var src = r.logo_data || (r.logo && ctx.profileId ? 'logo/' + encodeURIComponent(ctx.profileId) + '/' + r.logo : '');
      logoImg.classList.toggle('hidden', !src);
      logoEmpty.classList.toggle('hidden', !!src);
      logoDel.classList.toggle('hidden', !src);
      if (src) logoImg.src = src;
    }
    function values() {
      return { name: name.value.trim(), uris: uris.map(function (u) { return u.value.trim(); }).filter(Boolean),
        quality: quality.value.trim(), format: format.value.trim() };
    }
    function refreshCurl() {
      var v = values();
      curl.value = X10.radioCurl(v.name, v.uris[0] || '') + '\n# ' + X10.t('WEB_RADIO_CURL_NOTE', { id: (ctx.profileId || '<profile>') + '/' + (ctx.keyId || '<key>') });
    }
    function showResults(list) {
      results.textContent = '';
      list.forEach(function (x, i) {
        results.appendChild(el('div', { class: 'res ' + (x.ok ? 'ok' : 'bad') }, [
          el('span', { class: 'led ' + (x.ok ? 'on' : 'off') }), ' ',
          el('b', { text: (i + 1) + '. ' }), el('span', { class: 'mono', text: x.uri }), ' – ',
          el('span', { text: x.ok ? ('HTTP ' + x.status + (x.type ? ', ' + x.type : '') + (x.bitrate ? ', ' + x.bitrate + ' kbit/s' : '') + ', ' + x.ms + ' ms')
            : X10.t('WEB_RADIO_UNREACHABLE', { error: x.error + (x.status ? ' (HTTP ' + x.status + ')' : '') }) })
        ]));
        if (x.ok && x.bitrate && !quality.value.trim()) quality.value = x.bitrate + 'k';
      });
    }
    function runCheck() {
      var v = values();
      if (!v.uris.length) { X10.toast(X10.t('ERR_RADIO_URI_REQUIRED'), 'warn'); return Promise.resolve(null); }
      runBtn.disabled = ok.disabled = true;
      results.textContent = X10.t('WEB_RADIO_CHECKING');
      return X10.api('POST', 'api/radio/check', { uris: v.uris }).then(function (res) {
        showResults(res.results);
        return res.results;
      }).catch(function (e) {
        results.textContent = '';
        X10.toast(X10.errText(e), 'err');
        return null;
      }).then(function (x) { runBtn.disabled = ok.disabled = false; return x; });
    }
    function apply() {
      var v = values();
      if (!v.name) { X10.toast(X10.t('ERR_RADIO_NAME_REQUIRED'), 'warn'); name.focus(); return; }
      if (!v.uris.length) { X10.toast(X10.t('ERR_RADIO_URI_REQUIRED'), 'warn'); uris[0].focus(); return; }
      var bad = v.uris.filter(function (u) { return !/^https?:\/\/[^\s"<>\\^`{|}]+$/i.test(u); });
      if (bad.length) { X10.toast(X10.t('ERR_RADIO_URI_INVALID') + ' (' + bad[0] + ')', 'warn'); return; }
      var go = function () {
        var out = { name: v.name, uris: v.uris, quality: v.quality, format: v.format, logo: r.logo || null };
        if (r.logo_data !== undefined) out.logo_data = r.logo_data;
        close();
        onOk(out);
      };
      if (!check.checked) { go(); return; }
      runCheck().then(function (list) {
        if (!list) return;
        if (list.some(function (x) { return x.ok; })) go();
        else if (confirm(X10.t('WEB_RADIO_NONE_REACHABLE'))) go();
      });
    }
    function close() {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); if (onCancel) onCancel(); }
    }

    preset.addEventListener('change', function () {
      var p = presets[Number(preset.value)];
      if (!p) return;
      name.value = p.name;
      uris.forEach(function (u, i) { u.value = p.uris[i] || ''; });
      if (p.quality) quality.value = p.quality;
      if (p.format) format.value = p.format;
      results.textContent = '';
      refreshCurl();
    });
    [name].concat(uris).forEach(function (i) { i.addEventListener('input', refreshCurl); });
    logoAdd.addEventListener('click', function () { logoInput.click(); });
    logoInput.addEventListener('change', function () {
      var f = logoInput.files && logoInput.files[0];
      logoInput.value = '';
      if (!f) return;
      X10.shrinkImage(f, 256, true).then(function (data) { r.logo_data = data; showLogo(); })
        .catch(function (e) { X10.toast(X10.errText(e), 'err'); });
    });
    logoDel.addEventListener('click', function () { r.logo_data = ''; r.logo = null; showLogo(); });
    runBtn.addEventListener('click', runCheck);
    ok.addEventListener('click', apply);
    cancel.addEventListener('click', function () { close(); if (onCancel) onCancel(); });

    var back = el('div', { class: 'dlg-back top', role: 'dialog', 'aria-modal': 'true' }, [el('div', { class: 'dlg wide' }, [
      el('h3', { text: X10.t('WEB_RADIO_TITLE') }),
      el('p', { class: 'muted', text: X10.t('WEB_RADIO_HELP') }),
      field('WEB_RADIO_PRESET', preset), presetInfo,
      field('WEB_RADIO_NAME', name),
      field('WEB_RADIO_URI1', uris[0]), field('WEB_RADIO_URI2', uris[1]), field('WEB_RADIO_URI3', uris[2], 'WEB_RADIO_FAILOVER_HELP'),
      el('h4', { text: X10.t('WEB_RADIO_DISPLAY') }),
      el('p', { class: 'muted small', text: X10.t('WEB_RADIO_DISPLAY_HELP') }),
      el('div', { class: 'field' }, [el('span', { text: X10.t('WEB_RADIO_LOGO') }),
        el('div', { class: 'row' }, [logoImg, logoEmpty, el('span', { class: 'spacer' }), logoAdd, logoDel, logoInput])]),
      el('div', { class: 'grid2' }, [field('WEB_RADIO_QUALITY', quality), field('WEB_RADIO_FORMAT', format)]),
      el('label', { class: 'check' }, [check, ' ', X10.t('WEB_RADIO_CHECK_BEFORE')]),
      results,
      el('div', { class: 'field' }, [el('span', { text: X10.t('WEB_RADIO_CURL') }), curl]),
      el('div', { class: 'actions' }, [runBtn, el('span', { class: 'spacer' }), cancel, ok])
    ])]);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    showLogo();
    refreshCurl();
    name.focus();
    X10.api('GET', 'api/radio/presets').then(function (res) {
      presets = res.stations || [];
      presets.forEach(function (p, i) {
        preset.appendChild(el('option', { value: String(i), text: p.name + (p.uris.length > 1 ? '  (' + p.uris.length + ' URIs)' : '') }));
      });
      presetInfo.textContent = X10.t('WEB_RADIO_PRESET_FILE', { file: res.file }) +
        (res.warnings && res.warnings.length ? ' – ' + X10.t('WEB_RADIO_PRESET_WARN', { n: res.warnings.length }) : '');
    }).catch(function () { presetInfo.textContent = ''; });
  };

  /** Kurzname eines Empfaengers fuer Listen. */
  X10.receiverLabel = function (r) {
    return (r.name || r.device) + (r.rf433 ? ' · 433 MHz' : '');
  };

  // ----------------------------------------------------------------- Bilder
  /**
   * Bildplaetze eines Profils (Profilseite und Assistent). profile: { id, images, updated } wird aktualisiert.
   */
  X10.imageSlots = function (box, profile, kind) {
    var el = X10.el;
    var api = kind === 'receiver' ? 'api/receiver/image' : 'api/profile/image';
    var base = kind === 'receiver' ? 'rimg/' : 'img/';
    var slots = (X10.info() && X10.info().image_slots) || 6;
    function render() {
      box.textContent = '';
      for (var i = 1; i <= slots; i++) slot(i);
    }
    function upload(n, getData, btn) {
      btn.disabled = true;
      return getData().then(function (data) {
        if (!data) { render(); return; }
        btn.textContent = X10.t('WEB_UPLOADING');
        return X10.api('POST', api, { id: profile.id, slot: n, data: data }).then(function (res) {
          profile.images = res.images;
          profile.updated = String(Date.now());
          render();
          X10.toast(X10.t('WEB_IMAGE_SAVED'));
        });
      }).catch(function (e) {
        X10.toast(X10.errText(e), 'err');
        render();
      });
    }
    function slot(n) {
      var file = (profile.images || [])[n - 1];
      var src = base + encodeURIComponent(profile.id) + '/' + n + '?v=' + encodeURIComponent(profile.updated || '');
      var input = el('input', { type: 'file', accept: 'image/*', onchange: function () {
        var f = input.files && input.files[0];
        input.value = '';
        if (f) upload(n, function () { return X10.shrinkImage(f); }, add);
      } });
      var add = el('button', { class: 'small', type: 'button', text: X10.t(file ? 'WEB_IMAGE_REPLACE' : 'WEB_IMAGE_ADD'),
        onclick: function () { input.click(); } });
      var camera = el('button', { class: 'small', type: 'button', text: X10.t('WEB_CAMERA_BTN'),
        onclick: function () { upload(n, X10.takePhoto, camera); } });
      var remove = file ? el('button', { class: 'small danger', type: 'button', text: X10.t('WEB_IMAGE_DELETE'), onclick: function () {
        if (!confirm(X10.t('WEB_IMAGE_DELETE_CONFIRM'))) return;
        X10.api('POST', api + '/delete', { id: profile.id, slot: n }).then(function (res) {
          profile.images = res.images;
          render();
        }).catch(function (e) { X10.toast(X10.errText(e), 'err'); });
      } }) : null;
      box.appendChild(el('div', { class: 'slot' }, [
        file ? el('a', { href: src, target: '_blank', rel: 'noopener', title: X10.t('WEB_IMAGE_FULL') },
          [el('img', { alt: X10.t('WEB_IMAGE_N', { n: n }), src: src })])
          : el('div', { class: 'empty', text: X10.t('WEB_IMAGE_EMPTY', { n: n }) }),
        el('div', { class: 'row' }, [add, camera, remove, input])
      ]));
    }
    render();
    return { render: render };
  };

  // ----------------------------------------------------------------- Kamera
  /**
   * Foto aufnehmen. Liefert eine JPEG-data-URL (max. 1600 px) oder null bei Abbruch.
   * Livebild nur in sicherem Kontext (HTTPS/localhost) moeglich; sonst oeffnet ein Dateifeld mit
   * capture="environment" auf Handys direkt die Kamera-App (auf dem PC: Dateiauswahl).
   */
  X10.takePhoto = function () {
    if (window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return livePhoto().catch(function () { return capturePhoto(); });
    }
    return capturePhoto();
  };

  function capturePhoto() {
    return new Promise(function (resolve, reject) {
      var input = X10.el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
      var done = false;
      var finish = function (f) {
        if (done) return;
        done = true;
        input.remove();
        if (!f) { resolve(null); return; }
        X10.shrinkImage(f).then(resolve, reject);
      };
      input.addEventListener('change', function () { finish(input.files && input.files[0]); });
      input.addEventListener('cancel', function () { finish(null); });
      // Fallback fuer Browser ohne "cancel"-Ereignis: nach Rueckkehr ins Fenster ohne Auswahl abbrechen
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        setTimeout(function () { if (!(input.files && input.files.length)) finish(null); }, 1500);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function livePhoto() {
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false })
      .then(function (stream) {
        return new Promise(function (resolve) {
          var video = X10.el('video', { autoplay: true, playsinline: true, muted: true, class: 'camview' });
          video.srcObject = stream;
          var shot = X10.el('button', { class: 'primary', type: 'button', text: X10.t('WEB_CAMERA_SHOOT') });
          var cancel = X10.el('button', { type: 'button', text: X10.t('WEB_CANCEL') });
          var back = X10.el('div', { class: 'dlg-back', role: 'dialog', 'aria-modal': 'true' }, [X10.el('div', { class: 'dlg' }, [
            X10.el('h3', { text: X10.t('WEB_CAMERA_TITLE') }), video, X10.el('div', { class: 'actions' }, [cancel, shot])])]);
          var finish = function (result) {
            stream.getTracks().forEach(function (t) { t.stop(); });
            back.remove();
            resolve(result);
          };
          cancel.addEventListener('click', function () { finish(null); });
          shot.addEventListener('click', function () {
            var w = video.videoWidth;
            var h = video.videoHeight;
            if (!w || !h) return;
            var scale = Math.min(1, 1600 / Math.max(w, h));
            var c = document.createElement('canvas');
            c.width = Math.round(w * scale);
            c.height = Math.round(h * scale);
            c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
            finish(c.toDataURL('image/jpeg', 0.85));
          });
          document.body.appendChild(back);
        });
      });
  }

  // ----------------------------------------------------------------- Bilder
  /** Bild verkleinern (max. 1600 px) und als JPEG-data-URL liefern. */
  X10.shrinkImage = function (file, max, png) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(Object.assign(new Error('image'), { code: 'image_invalid' })); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        max = max || 1600;
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var h = Math.max(1, Math.round(img.naturalHeight * scale));
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var ctx = c.getContext('2d');
        if (!png) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(Object.assign(new Error('image'), { code: 'image_invalid' }));
      };
      img.src = url;
    });
  };
})();

/* Dialog "Taste konfigurieren" (Tastentest) */
(function () {
  'use strict';
  var X10 = window.X10;
  var el = X10.el;

  function actionText(type, action, command, target) {
    if (action === 'custom') return command || X10.t('ACTION_CUSTOM');
    if (action === 'tkey') return X10.t('WEB_TKEY_AS', { key: target || '?' });
    if (action === 'none' && type === 'scan') return X10.t('ACTION_NONE');
    return X10.actionLabel(type, action);
  }

  function noteText(n, type) {
    if (n.code === 'replace_profile') return X10.t('WEB_NOTE_REPLACE_PROFILE', { profile: n.profile, name: n.old.name, action: actionText(type, n.old.action, n.old.command, n.old.target) });
    if (n.code === 'replace_audio') return X10.t('WEB_NOTE_REPLACE_AUDIO', { cmd: n.commands.join(' · ') });
    if (n.code === 'double_audio') return X10.t('WEB_NOTE_DOUBLE_AUDIO', { key: n.key, cmd: n.commands.join(' · ') });
    if (n.code === 'conflict') return X10.t('WEB_NOTE_CONFLICT', { profile: n.profile, name: n.old.name, action: actionText(type, n.old.action, n.old.command, n.old.target) });
    return n.code;
  }

  /**
   * Oeffnet den Dialog fuer eine Taste.
   * ev: { device, type, code, key_name?, scan? }   done: Rueckruf nach dem Speichern
   */
  X10.configureKey = function (ev, done) {
    var info = X10.info() || { actions: { scan: [], key: [] }, allow_shell: false };
    var q = 'api/key?device=' + encodeURIComponent(ev.device) + '&type=' + encodeURIComponent(ev.type) +
      '&code=' + encodeURIComponent(ev.code) + '&key_name=' + encodeURIComponent(ev.key_name || '');
    Promise.all([X10.api('GET', q), X10.api('GET', 'api/audioconf')]).then(function (r) { open(r[0], r[1] || {}); })
      .catch(function (e) { X10.toast(X10.errText(e), 'err'); });

    function open(k, audioconf) {
      var src = X10.source({ type: k.type, code: k.code, key_name: k.key_name }) +
        (k.type === 'key' && ev.scan !== undefined && ev.scan !== null ? '  (Scan ' + X10.hex(ev.scan) + ')' : '');
      var cur = k.entries.filter(function (e) { return e.active; })[0] || k.entries[0] || null;
      var acts = k.type === 'key' ? info.actions.key : info.actions.scan;

      // ---------- aktuelle Konfiguration
      var current = el('dl', { class: 'kv' });
      var add = function (label, value) { current.appendChild(el('dt', { text: label })); current.appendChild(el('dd', { class: 'mono', text: value })); };
      add(X10.t('WEB_CFG_SIGNAL'), src);
      add(X10.t('WEB_CFG_DEVICE'), (k.device_name ? k.device_name + ' · ' : '') + k.device);
      if (cur) {
        add(X10.t('WEB_CFG_PROFILE'), cur.profile_name + (cur.active ? '' : ' (' + X10.t('WEB_INACTIVE') + ')'));
        add(X10.t('WEB_COL_NAME'), cur.key.name);
        if (cur.key.remote_label) add(X10.t('WEB_REMOTE_LABEL'), cur.key.remote_label);
        add(X10.t('WEB_COL_ACTION'), actionText(k.type, cur.key.action, cur.key.command, cur.key.target));
        if (cur.key.description) add(X10.t('WEB_KEY_DESCRIPTION'), cur.key.description);
        var curThd = cur.key.thd_key || (cur.key.action === 'tkey' ? cur.key.target : '');
        if (k.type === 'scan') add(X10.t('WEB_CFG_THD'), (curThd || (k.mapping && k.mapping.key) || '–') + (curThd ? '' : ' (' + X10.t('WEB_THD_AUTO_SHORT') + ')'));
        if (k.type === 'scan' && (curThd || (k.mapping && k.mapping.key))) add('audio.conf', X10.audioText(curThd || k.mapping.key, audioconf) || '–');
        if (['custom', 'none', 'default', 'tkey'].indexOf(cur.key.action) === -1) add(X10.t('WEB_CFG_COMMAND'), '/usr/local/bin/x10remote-action ' + cur.key.action);
      } else {
        add(X10.t('WEB_CFG_PROFILE'), X10.t('WEB_CFG_NOT_CONFIGURED'));
      }
      if (k.type === 'scan') add(X10.t('WEB_CFG_DRIVER'), X10.t('WEB_CFG_SCAN_ONLY'));
      if (k.type === 'key') add('audio.conf', k.audio.length ? k.audio.map(function (a) { return (a.file === 'audio.conf' ? '' : a.file + ': ') + a.command; }).join(' · ') : '–');
      if (k.entries.length > 1) add(X10.t('WEB_CFG_ALSO_IN'), k.entries.filter(function (e) { return e !== cur; }).map(function (e) { return e.profile_name; }).join(', '));

      // ---------- neue Konfiguration
      var profSel = el('select', null, k.profiles.map(function (p) {
        return el('option', { value: p.id, text: p.name + (p.active ? '' : ' (' + X10.t('WEB_INACTIVE') + ')') });
      }).concat([el('option', { value: '', text: X10.t('WEB_CFG_NEW_PROFILE') })]));
      profSel.value = cur ? cur.profile : (k.profiles.filter(function (p) { return p.active; })[0] || k.profiles[0] || { id: '' }).id;
      var newName = el('input', { type: 'text', maxlength: '80', value: k.device_name || k.device });
      var newNameField = el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_PROFILE_NAME') }), newName]);
      var name = el('input', { type: 'text', maxlength: '60', value: cur ? cur.key.name : (k.key_name ? X10.prettyKeyName(k.key_name) : '') });
      var remoteLabel = el('input', { type: 'text', maxlength: '40', value: cur ? cur.key.remote_label || '' : '', placeholder: X10.t('WEB_REMOTE_LABEL_PH') });
      var description = el('input', { type: 'text', maxlength: '200', value: cur ? cur.key.description || '' : '', placeholder: X10.t('WEB_KEY_DESCRIPTION_PH') });
      var action = el('select', null, acts.map(function (a) {
        return el('option', { value: a, text: X10.actionLabel(k.type, a) });
      }));
      action.value = cur ? (cur.key.action === 'tkey' ? 'none' : cur.key.action) : (k.type === 'key' ? 'default' : 'none');
      if (action.value !== (cur ? cur.key.action : action.value)) action.value = acts[0];
      var command = X10.commandInput(cur ? cur.key.command || '' : '');
      var commandField = el('div', { class: 'field' }, [el('span', { text: X10.t('WEB_CFG_COMMAND') }), X10.cmdLine(command)]);
      var autoKey = k.mapping && k.mapping.virtual ? k.mapping.key : '';
      var curThdKey = cur ? (cur.key.thd_key || (cur.key.action === 'tkey' ? cur.key.target : '')) : '';
      var targetSel = X10.thdSelect(curThdKey, autoKey, audioconf, function () { update(); });
      var targetField = el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_THD_KEY') }), targetSel]);
      if (k.type !== 'scan') targetField = el('div', { class: 'vkey', text: X10.t('WEB_THD_KEY_FIXED', { key: k.key_name || ('Key ' + k.code) }) });
      var shell = X10.shellNotice(function () { update(); });
      var repeat = el('input', { type: 'checkbox', checked: cur ? !!cur.key.repeat : false });
      var activate = el('input', { type: 'checkbox', checked: true });
      var activateLabel = el('label', { class: 'check' }, [activate, X10.t('WEB_CFG_ACTIVATE')]);
      var hint = el('div', { class: 'muted' });
      var notesBox = el('div', { class: 'note warn hidden' });
      var save = el('button', { class: 'primary', type: 'button', text: X10.t('WEB_SAVE') });
      var cancel = el('button', { type: 'button', text: X10.t('WEB_CANCEL') });
      var confirmed = false;

      function update() {
        var p = k.profiles.filter(function (x) { return x.id === profSel.value; })[0];
        newNameField.classList.toggle('hidden', profSel.value !== '');
        activateLabel.classList.toggle('hidden', !!(p && p.active));
        commandField.classList.toggle('hidden', action.value !== 'custom');
        shell.update(action.value === 'custom');
        hint.textContent = X10.keyHint(k.type, action.value, k.key_name, targetSel.value || autoKey, audioconf, !targetSel.value).text;
        confirmed = false;
        notesBox.classList.add('hidden');
        save.textContent = X10.t('WEB_SAVE');
      }
      action.addEventListener('change', function () {
        if (action.value === 'custom' && !command.value.trim()) {
          var pre = X10.audioCommand(k.type === 'key' ? k.key_name : targetSel.value, audioconf);
          if (pre) command.value = pre;
        }
        if (action.value === 'custom') setTimeout(command.grow, 0);
      });
      [profSel, action].forEach(function (n) { n.addEventListener('change', update); });
      [name, command, newName, remoteLabel, description].forEach(function (n) { n.addEventListener('input', function () { confirmed = false; notesBox.classList.add('hidden'); save.textContent = X10.t('WEB_SAVE'); }); });
      repeat.addEventListener('change', function () { confirmed = false; });

      var back = el('div', { class: 'dlg-back', role: 'dialog', 'aria-modal': 'true' }, [el('div', { class: 'dlg' }, [
        el('h3', { text: X10.t('WEB_CFG_TITLE') }),
        el('h4', { text: X10.t('WEB_CFG_CURRENT') }), current,
        el('h4', { text: X10.t('WEB_CFG_NEW') }),
        el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_CFG_PROFILE') }), profSel]), newNameField,
        el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_COL_NAME') }), name]),
        el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_REMOTE_LABEL') }), remoteLabel]),
        targetField,
        el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_COL_ACTION') }), action]), commandField, shell.node,
        el('label', { class: 'field' }, [el('span', { text: X10.t('WEB_KEY_DESCRIPTION') }), description]),
        el('div', { class: 'row' }, [el('label', { class: 'check' }, [repeat, X10.t('WEB_REPEAT')]), activateLabel]),
        hint, notesBox,
        el('div', { class: 'actions' }, [cancel, save])
      ])]);
      function close() { back.remove(); document.removeEventListener('keydown', onKey); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      cancel.addEventListener('click', close);
      back.addEventListener('click', function (e) { if (e.target === back) close(); });
      document.addEventListener('keydown', onKey);

      save.addEventListener('click', function () {
        if (!name.value.trim()) { X10.toast(X10.t('ERR_NAME_REQUIRED'), 'warn'); return; }
        save.disabled = true;
        X10.api('POST', 'api/key/configure', {
          device: k.device, type: k.type, code: k.code, scan: ev.scan === undefined ? null : ev.scan, key_name: k.key_name,
          profile: profSel.value || null, new_profile_name: newName.value.trim(), name: name.value.trim(),
          action: action.value, command: action.value === 'custom' ? command.value.trim() : '', repeat: repeat.checked,
          thd_key: k.type === 'scan' ? targetSel.value : null, remote_label: remoteLabel.value.trim(), description: description.value.trim(),
          activate: activate.checked, confirm: confirmed
        }).then(function (res) {
          if (res.needs_confirm) {
            confirmed = true;
            notesBox.textContent = '';
            notesBox.appendChild(el('b', { text: X10.t('WEB_CFG_CONFIRM') }));
            res.notes.forEach(function (n) { notesBox.appendChild(el('div', { text: '• ' + noteText(n, k.type) })); });
            notesBox.classList.remove('hidden');
            save.textContent = X10.t('WEB_CFG_REPLACE_SAVE');
            return;
          }
          close();
          var msg = X10.t(res.active ? 'WEB_SAVED_ACTIVE' : 'WEB_CFG_SAVED_INACTIVE');
          if (res.problems && res.problems.length) {
            var p = res.problems[0];
            X10.toast(X10.t('WEB_PROBLEM_' + String(p.code).toUpperCase(), { key: p.key || '', other: p.other || '', profile: p.profile || '' }), 'warn');
          } else {
            X10.toast(msg);
          }
          if (done) done(res);
        }).catch(function (e) { X10.toast(X10.errText(e), 'err'); })
          .then(function () { save.disabled = false; });
      });

      update();
      document.body.appendChild(back);
      name.focus();
    }
  };
})();
