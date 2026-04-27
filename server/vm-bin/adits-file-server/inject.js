(function () {
  if (window.__adits_iframe) {
    try { window.parent.postMessage({ __adits_iframe: { type: 'ready', version: 1 } }, '*'); } catch (_) {}
    return;
  }
  window.__adits_iframe = { version: 1, ready: true };

  var currentMode = 'off';           // 'off' | 'edit' | 'comment'
  var presentMode = 'off';           // 'off' | 'tab' | 'fullscreen'
  var editRefCounter = 0;
  var commentRefCounter = 0;
  var clickHandler = null;
  var scrollHandler = null;
  var resizeHandler = null;
  var outline = null;
  var currentTarget = null;          // edit-mode live-outline target
  var commentPinnedTarget = null;
  var commentPinnedOffset = null;
  var tapAdvanceHandler = null;      // present: click → synth ArrowRight
  var notesObserver = null;          // present: MutationObserver for #speaker-notes
  /** Tri-state dedupe token for speaker-notes posts:
   *    undefined — never posted (force an initial frame)
   *    null      — posted "no notes" (tag absent)
   *    string    — posted the raw JSON text (tag present)
   *  So the first parseSpeakerNotes() call always emits something
   *  (even `notes:null`), letting the host know detection ran. */
  var lastNotesJson;

  var STYLE_KEYS = [
    'fontFamily', 'fontSize', 'color', 'lineHeight',
    'fontWeight', 'textAlign', 'letterSpacing',
    'width', 'height',
    'opacity', 'padding', 'margin', 'borderRadius',
    'backgroundColor',
  ];

  function post(msg) {
    try { window.parent.postMessage({ __adits_iframe: msg }, '*'); } catch (_) {}
  }

  function inOverlaySubtree(el) {
    for (var n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (n.hasAttribute && n.hasAttribute('data-dm-overlay')) return true;
    }
    return false;
  }

  function computeSelector(el) {
    var parts = [];
    var n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) {
        parts.unshift('#' + CSS.escape(n.id));
        break;
      }
      var tag = n.tagName.toLowerCase();
      var parent = n.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      var idx = 1;
      var sib = parent.firstElementChild;
      while (sib && sib !== n) { idx++; sib = sib.nextElementSibling; }
      parts.unshift(tag + ':nth-child(' + idx + ')');
      n = parent;
    }
    return parts.join(' > ');
  }

  function buildDomPath(el) {
    var parts = [];
    var n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      var tag = n.tagName.toLowerCase();
      var label = n.getAttribute && n.getAttribute('data-screen-label');
      parts.unshift(label ? tag + '[data-screen-label="' + label + '"]' : tag);
      n = n.parentElement;
    }
    return parts.join(' > ');
  }

  function describeEditSelection(el) {
    var rect = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var styles = {};
    for (var i = 0; i < STYLE_KEYS.length; i++) styles[STYLE_KEYS[i]] = cs[STYLE_KEYS[i]];
    var display = cs.display;
    var inline = display === 'inline' || display === 'ruby' || display === 'inline list-item';
    return {
      selector: computeSelector(el),
      tag: el.tagName.toLowerCase(),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      inline: inline,
      styles: styles,
    };
  }

  function describeCommentSelection(el, e) {
    var rect = el.getBoundingClientRect();
    var ccId;
    if (el.hasAttribute('data-cc-id')) {
      ccId = el.getAttribute('data-cc-id');
    } else {
      ccId = 'cc-' + (++commentRefCounter);
      el.setAttribute('data-cc-id', ccId);
    }
    return {
      selector: computeSelector(el),
      tag: el.tagName.toLowerCase(),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      anchor: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      clickViewport: { x: e.clientX, y: e.clientY },
      ccId: ccId,
      dom: buildDomPath(el),
    };
  }

  function ensureOutline() {
    if (outline) return outline;
    outline = document.createElement('div');
    outline.setAttribute('data-dm-overlay', '');
    var s = outline.style;
    s.position = 'absolute';
    s.pointerEvents = 'none';
    s.zIndex = '2147483647';
    s.border = '2px solid #5b5bd6';
    s.borderRadius = '2px';
    s.display = 'none';
    document.body.appendChild(outline);
    return outline;
  }

  function updateOutline() {
    if (!outline || !currentTarget || !currentTarget.isConnected) {
      if (outline) outline.style.display = 'none';
      return;
    }
    var r = currentTarget.getBoundingClientRect();
    var scrollX = window.scrollX, scrollY = window.scrollY;
    outline.style.left = (r.left + scrollX - 2) + 'px';
    outline.style.top = (r.top + scrollY - 2) + 'px';
    outline.style.width = r.width + 'px';
    outline.style.height = r.height + 'px';
    outline.style.display = 'block';
  }

  function hideOutline() {
    currentTarget = null;
    if (outline) outline.style.display = 'none';
  }

  function removeOutline() {
    currentTarget = null;
    if (outline && outline.parentNode) outline.parentNode.removeChild(outline);
    outline = null;
  }

  function onClick(e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    if (inOverlaySubtree(target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    if (currentMode === 'edit') {
      if (!target.hasAttribute('data-dm-ref')) {
        target.setAttribute('data-dm-ref', String(++editRefCounter));
      }
      currentTarget = target;
      ensureOutline();
      updateOutline();
      post(Object.assign({ type: 'select', mode: 'edit' }, describeEditSelection(target)));
    } else if (currentMode === 'comment') {
      var pin = describeCommentSelection(target, e);
      post(Object.assign({ type: 'select', mode: 'comment' }, pin));
      teardownClickHandler();
      if (document.body) document.body.style.cursor = '';
      commentPinnedTarget = target;
      commentPinnedOffset = pin.anchor;
      currentTarget = target;
      ensureOutline();
      updateOutline();
      scrollHandler = onCommentScrollOrResize;
      resizeHandler = onCommentScrollOrResize;
      window.addEventListener('scroll', scrollHandler, true);
      window.addEventListener('resize', resizeHandler);
    }
  }

  function onCommentScrollOrResize() {
    if (!commentPinnedTarget || !commentPinnedTarget.isConnected || !commentPinnedOffset) return;
    var r = commentPinnedTarget.getBoundingClientRect();
    post({
      type: 'reanchor',
      clickViewport: { x: r.left + commentPinnedOffset.x, y: r.top + commentPinnedOffset.y },
    });
    updateOutline();
  }

  function teardownClickHandler() {
    if (clickHandler) document.removeEventListener('click', clickHandler, true);
    clickHandler = null;
  }

  function stripStamps(mode) {
    var attr = mode === 'edit' ? 'data-dm-ref' : 'data-cc-id';
    var marked = document.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(attr);
  }

  function enter(mode) {
    if (clickHandler) document.removeEventListener('click', clickHandler, true);
    clickHandler = onClick;
    document.addEventListener('click', clickHandler, true);

    if (mode === 'edit') {
      scrollHandler = function () { if (currentTarget) updateOutline(); };
      resizeHandler = function () { if (currentTarget) updateOutline(); };
      window.addEventListener('scroll', scrollHandler, true);
      window.addEventListener('resize', resizeHandler);
    } else if (mode === 'comment') {
      if (document.body) document.body.style.cursor = 'crosshair';
    }
    currentMode = mode;
  }

  function teardownListeners() {
    teardownClickHandler();
    if (scrollHandler) window.removeEventListener('scroll', scrollHandler, true);
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    scrollHandler = null;
    resizeHandler = null;
    if (document.body) document.body.style.cursor = '';
    commentPinnedTarget = null;
    commentPinnedOffset = null;
  }

  function exit() {
    teardownListeners();
    removeOutline();
    if (currentMode !== 'off') stripStamps(currentMode);
    currentMode = 'off';
    post({ type: 'deselect' });
  }

  function setStyle(selector, prop, value) {
    var el;
    try { el = document.querySelector(selector); } catch (_) { el = null; }
    if (!el) { hideOutline(); post({ type: 'deselect' }); return; }
    el.style.setProperty(prop, value);
    currentTarget = el;
    updateOutline();
    post(Object.assign({ type: 'select', mode: 'edit' }, describeEditSelection(el)));
  }

  /* ---------- Present mode ---------- */

  function isInteractive(el) {
    if (!(el instanceof Element)) return false;
    var tag = el.tagName;
    if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'LABEL') return true;
    if (el.getAttribute && el.getAttribute('role') === 'button') return true;
    if (el.isContentEditable) return true;
    // Walk ancestors a few steps — the click often lands on a child of
    // the interactive element (e.g. <span> inside <button>).
    var p = el.parentElement;
    for (var i = 0; p && i < 3; i++, p = p.parentElement) {
      var pt = p.tagName;
      if (pt === 'A' || pt === 'BUTTON') return true;
      if (p.getAttribute && p.getAttribute('role') === 'button') return true;
    }
    return false;
  }

  function onTapAdvance(e) {
    if (isInteractive(e.target)) return;
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true,
    }));
  }

  function presentEnter(mode) {
    presentMode = mode === 'fullscreen' ? 'fullscreen' : 'tab';
    document.__omPresent = 1;
    document.__omPresentActive = 1;
    if (!tapAdvanceHandler) {
      tapAdvanceHandler = onTapAdvance;
      document.addEventListener('click', tapAdvanceHandler, false);
    }
  }

  function presentExit() {
    presentMode = 'off';
    try { delete document.__omPresent; } catch (_) { document.__omPresent = undefined; }
    try { delete document.__omPresentActive; } catch (_) { document.__omPresentActive = undefined; }
    if (tapAdvanceHandler) {
      document.removeEventListener('click', tapAdvanceHandler, false);
      tapAdvanceHandler = null;
    }
  }

  function forwardKeydown(msg) {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: msg.key, code: msg.code,
        ctrlKey: !!msg.ctrlKey, altKey: !!msg.altKey,
        shiftKey: !!msg.shiftKey, metaKey: !!msg.metaKey,
        bubbles: true, cancelable: true,
      }));
    } catch (_) {}
  }

  function parseSpeakerNotes() {
    var tag = document.getElementById('speaker-notes');
    if (!tag) {
      if (lastNotesJson !== null) {
        lastNotesJson = null;
        post({ type: 'speaker-notes', notes: null });
      }
      return;
    }
    var raw = tag.textContent || '';
    if (raw === lastNotesJson) return;
    lastNotesJson = raw;
    var notes = null;
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        notes = parsed.map(function (x) { return typeof x === 'string' ? x : String(x == null ? '' : x); });
      }
    } catch (_) { notes = null; }
    post({ type: 'speaker-notes', notes: notes });
  }


  function installNotesObserver() {
    if (notesObserver) return;
    // Watch the whole document so we catch the tag wherever the deck
    // mounts it (head, body, inside a wrapper). Subtree + childList +
    // characterData covers tag-appearance, tag-removal, and edits to
    // the JSON text itself.
    notesObserver = new MutationObserver(function () { parseSpeakerNotes(); });
    notesObserver.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
    });
  }

  /* Rebroadcast the deck's bare {slideIndexChanged: N} postMessage
   * (canonical contract from system.md). Unlike the host↔iframe
   * envelope, this one is NOT namespaced — the deck code posts it on
   * its own window and our inject is in the same window. */
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;          // only self-posts (deck → us)
    var d = e.data;
    if (d && typeof d === 'object' && typeof d.slideIndexChanged === 'number') {
      post({ type: 'slide-index', index: d.slideIndexChanged });
    }
  });

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var msg = e.data && e.data.__adits_iframe;
    if (!msg || !msg.type) return;
    if (msg.type === 'enter') enter(msg.mode === 'comment' ? 'comment' : 'edit');
    else if (msg.type === 'exit') exit();
    else if (msg.type === 'setStyle') setStyle(msg.selector, msg.prop, msg.value);
    else if (msg.type === 'present-enter') presentEnter(msg.mode);
    else if (msg.type === 'present-exit') presentExit();
    else if (msg.type === 'forward-keydown') forwardKeydown(msg);
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && (currentMode !== 'off' || presentMode !== 'off')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      post({ type: 'escape' });
      return;
    }
    // ⌘\ / Ctrl+\ exits present mode even if focus is inside the iframe.
    if (presentMode !== 'off' && e.key === '\\' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      post({ type: 'escape' });
    }
  }, true);

  parseSpeakerNotes();
  installNotesObserver();

  post({ type: 'ready', version: 1 });
})();
