// Static-page i18n loader. Mirrors the SPA's cookie/localStorage detection so
// signed-out marketing/legal pages stay in the user's chosen language across
// the boundary into /projects.
//
// Usage in HTML:
//   <span data-i18n="hero.title">Default English fallback</span>
//   <a data-i18n-attr="aria-label:nav.home" href="/">Home</a>
//   <input placeholder="Search" data-i18n-attr="placeholder:search.placeholder" />
//
// Multiple attributes:
//   data-i18n-attr="aria-label:hero.cta;title:hero.cta"
//
// The element's existing text/attributes serve as English fallback when the
// dictionary lacks a key (so a missing translation never blanks the UI).

(function () {
  var SUPPORTED = ['en','zh','ja','ru','pl','es','it','pt','ca','de','fr','nl','tr','sv','da','ko','ar','hi','th','vi'];
  var NAMES = {
    en: 'English', zh: '中文', ja: '日本語', ru: 'Русский',
    pl: 'Polski', es: 'Español', it: 'Italiano', pt: 'Português', ca: 'Català',
    de: 'Deutsch', fr: 'Français', nl: 'Nederlands', tr: 'Türkçe', sv: 'Svenska', da: 'Dansk',
    ko: '한국어', ar: 'العربية', hi: 'हिन्दी', th: 'ไทย', vi: 'Tiếng Việt'
  };
  var RTL = ['ar'];
  var COOKIE = 'adits-lang';
  var LS = 'i18nextLng';

  function readCookie(name) {
    var m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? m[2] : null;
  }
  function writeCookie(name, value) {
    var attrs = '; path=/; SameSite=Lax; max-age=' + (60 * 60 * 24 * 365);
    if (location.hostname && location.hostname.indexOf('.') !== -1 && location.hostname !== 'localhost') {
      attrs += '; domain=.adits.app';
    }
    document.cookie = name + '=' + encodeURIComponent(value) + attrs;
  }

  function pickLang() {
    var c = readCookie(COOKIE);
    if (c && SUPPORTED.indexOf(c) !== -1) return c;
    try {
      var ls = localStorage.getItem(LS);
      if (ls) {
        var base = ls.split('-')[0];
        if (SUPPORTED.indexOf(base) !== -1) return base;
      }
    } catch (_) {}
    var nav = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
    return SUPPORTED.indexOf(nav) !== -1 ? nav : 'en';
  }

  function applyDirection(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.indexOf(lang) !== -1 ? 'rtl' : 'ltr';
  }

  function lookup(dict, dotted) {
    var parts = dotted.split('.');
    var cur = dict;
    for (var i = 0; i < parts.length; i++) {
      if (cur && typeof cur === 'object' && parts[i] in cur) cur = cur[parts[i]];
      else return null;
    }
    return typeof cur === 'string' ? cur : null;
  }

  function applyDict(dict) {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n');
      var v = lookup(dict, key);
      if (v != null) el.textContent = v;
    }
    // data-i18n-html is for paragraphs whose translated copy needs to retain
    // inline emphasis (<strong>/<em>/<code>/<a>). We trust our own
    // dictionary content — it's authored alongside the source HTML.
    var htmlNodes = document.querySelectorAll('[data-i18n-html]');
    for (var h = 0; h < htmlNodes.length; h++) {
      var elH = htmlNodes[h];
      var keyH = elH.getAttribute('data-i18n-html');
      var vH = lookup(dict, keyH);
      if (vH != null) elH.innerHTML = vH;
    }
    var attrNodes = document.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j++) {
      var elA = attrNodes[j];
      var spec = elA.getAttribute('data-i18n-attr');
      var pairs = spec.split(';');
      for (var k = 0; k < pairs.length; k++) {
        var pair = pairs[k].split(':');
        if (pair.length !== 2) continue;
        var attr = pair[0].trim();
        var keyA = pair[1].trim();
        var vA = lookup(dict, keyA);
        if (vA != null) elA.setAttribute(attr, vA);
      }
    }
  }

  function load(lang) {
    return fetch('/js/static-locales/' + lang + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }

  function buildSwitcher(current) {
    if (document.querySelector('.lang-switcher')) return; // page already has one
    var wrap = document.createElement('div');
    wrap.className = 'lang-switcher lang-switcher--floating';
    var sel = document.createElement('select');
    sel.className = 'lang-switcher-select';
    sel.setAttribute('aria-label', current === 'zh' ? '切换语言' : 'Change language');
    for (var i = 0; i < SUPPORTED.length; i++) {
      var opt = document.createElement('option');
      opt.value = SUPPORTED[i];
      opt.textContent = NAMES[SUPPORTED[i]];
      if (SUPPORTED[i] === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function (e) {
      var next = e.target.value;
      writeCookie(COOKIE, next);
      try { localStorage.setItem(LS, next); } catch (_) {}
      window.location.reload();
    });
    wrap.appendChild(sel);
    document.body.appendChild(wrap);
  }

  var lang = pickLang();
  applyDirection(lang);

  // Expose a tiny synchronous-after-load t() so inline scripts on the
  // same page can localize dynamic text (e.g. speaker-notes popup).
  window.aditsI18n = {
    lang: lang,
    dict: {},
    t: function (key, fallback) {
      var v = lookup(this.dict, key);
      return v != null ? v : (fallback != null ? fallback : key);
    },
    onReady: function (cb) { (this._ready || (this._ready = [])).push(cb); },
  };

  load(lang).then(function (dict) {
    window.aditsI18n.dict = dict;
    applyDict(dict);
    buildSwitcher(lang);
    var cbs = window.aditsI18n._ready || [];
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](window.aditsI18n); } catch (_) {}
    }
  });
})();
