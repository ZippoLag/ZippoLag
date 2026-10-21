/* ============================================================================
   home — runtime
   Progressive enhancement only. Without this file the page is a static
   document in the default language with every section visible (<noscript>).
   No dependencies, no third-party requests, no DOM mutation during transitions.
   ========================================================================= */

(function () {
  "use strict";

  var cfgEl = document.getElementById("site-config");
  var cfg = null;
  try {
    cfg = JSON.parse(cfgEl.textContent);
  } catch (e) {
    cfg = null;
  }
  if (!cfg) return;

  var root = document.documentElement;
  var ui = cfg.ui || {};
  var codes = cfg.codes;
  var def = cfg.defaultLanguage;
  var live = document.getElementById("live");
  var note = document.getElementById("lang-note");
  var bar = document.querySelector(".bar");
  var picker = document.querySelector(".picker");
  var themeBtn = document.getElementById("theme-toggle");
  var themeWord = null;

  var state = { mode: root.dataset.mode === "single" ? "single" : "multi", lang: root.dataset.lang || "multi", open: null };

  /* D13.1–D13.5: one settings object, read from localStorage before anything
     else so every handler sees the same values the boot script painted with. */
  var SETTING_DEFAULTS = {
    grow: true,
    bold: true,
    wave: false,
    waveDelay: 200,
    duration: 400,
    reserve: true,
    scale: 2,
    fontscroll: false,
    fonts: null,
    font: "mono",
  };
  var settings = readSettings();

  /* ----------------------------------------------------------------- helpers */

  function t(key, lang) {
    var entry = ui[key];
    if (!entry) return "";
    return entry[lang] || entry[def] || "";
  }

  function template(text, values) {
    return String(text).replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
    });
  }

  function announce(text) {
    if (!live || !text) return;
    live.textContent = "";
    // Force a fresh announcement when the same text is produced twice.
    window.setTimeout(function () {
      live.textContent = text;
    }, 30);
  }

  function sectionOf(id) {
    for (var i = 0; i < cfg.sections.length; i += 1) if (cfg.sections[i].id === id) return cfg.sections[i];
    return null;
  }

  function rawLang() {
    var match = location.search.match(/[?&]lang=([^&]*)/);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1].replace(/\+/g, " "));
    } catch (e) {
      return match[1];
    }
  }

  /** §7.2: trim, lowercase, resolve aliases; anything unknown falls back to multi. */
  function normalize(raw) {
    var value = raw == null ? "" : String(raw).trim().toLowerCase();
    if (value === "") return { kind: "multi" };
    if (value === "all" || codes.indexOf(value) > -1) {
      return value === "all" ? { kind: "multi" } : { kind: "single", code: value };
    }
    for (var key in cfg.aliases || {}) {
      if ((cfg.aliases[key] || []).indexOf(value) > -1) {
        return key === "all" ? { kind: "multi" } : { kind: "single", code: key };
      }
    }
    return { kind: "unknown", raw: raw };
  }

  function showNote(text) {
    if (!note) return;
    if (text) {
      note.textContent = text;
      note.hidden = false;
    } else {
      note.textContent = "";
      note.hidden = true;
    }
  }

  /* ---------------------------------------------------------------- language */

  function applyLanguage(result, options) {
    options = options || {};
    var lang = result.kind === "single" ? result.code : "multi";
    state.mode = result.kind === "single" ? "single" : "multi";
    state.lang = lang;
    root.dataset.mode = state.mode;
    root.dataset.lang = lang;
    root.lang = state.mode === "single" ? lang : def;
    closeSection({ silent: true });

    // D11.4: in single-language mode the widget draws the 2×2 title but is not an
    // interactive control (the lines are hidden), so it leaves the a11y tree; the
    // localized <h2> inside the section is its accessible name.
    Array.prototype.forEach.call(document.querySelectorAll(".widget"), function (widget) {
      if (state.mode === "single") widget.setAttribute("aria-hidden", "true");
      else widget.removeAttribute("aria-hidden");
    });
    // In single-language mode the line buttons are hidden, so a body's name has
    // to come from the localized <h2> instead (the widget is display-only).
    Array.prototype.forEach.call(document.querySelectorAll(".body"), function (body) {
      var prefix = state.mode === "single" ? "h-" : "l-";
      body.setAttribute("aria-labelledby", prefix + body.dataset.section + "-" + body.dataset.language);
    });

    var active = state.mode === "single" ? lang : "all";
    Array.prototype.forEach.call(document.querySelectorAll(".pick"), function (btn) {
      if (btn.dataset.lang === active) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    });

    // The control labels follow the visible language (only the short codes keep
    // their own lang attribute).
    var labelLang = state.mode === "single" ? lang : def;
    var groupLabel = document.getElementById("picker-label");
    if (groupLabel) groupLabel.textContent = t("langGroupLabel", labelLang);
    var all = picker && picker.querySelector('[data-lang="all"] [data-role="all-label"]');
    if (all) all.textContent = t("allLabel", labelLang);
    // D15.1: the settings labels themselves are switched by CSS, but the
    // aria-labels of chrome controls are not text nodes, so update them here.
    Array.prototype.forEach.call(document.querySelectorAll("[data-ui-label]"), function (button) {
      var key = button.dataset.uiLabel;
      if (!ui[key]) return;
      button.setAttribute("aria-label", t(key, labelLang));
      button.setAttribute("lang", labelLang);
    });
    updateThemeButton();

    if (result.kind === "unknown") {
      showNote(template(t("unknownLanguage", def), { raw: result.raw }));
    } else {
      showNote("");
    }

    if (options.announce) {
      announce(
        state.mode === "single"
          ? template(t("announceLanguage", lang), { language: cfg.names[lang] })
          : t("announceAllLanguages", def),
      );
    }
    if (options.push) pushUrl(active);
  }

  function pushUrl(active) {
    var params;
    try {
      params = new URLSearchParams(location.search);
    } catch (e) {
      return;
    }
    if (active === "all") params.delete("lang");
    else params.set("lang", active);
    var query = params.toString();
    var url = location.pathname + (query ? "?" + query : "") + location.hash;
    try {
      history.pushState({ lang: active }, "", url);
    } catch (e) {
      /* file:// and other opaque origins refuse pushState: the state still
         changes, only the address bar keeps the old parameter. */
    }
  }

  /* --------------------------------------------------------------- accordion */

  function bodies() {
    return document.querySelectorAll(".body");
  }

  function lines() {
    return document.querySelectorAll(".line");
  }

  function closeSection(options) {
    options = options || {};
    Array.prototype.forEach.call(bodies(), function (body) {
      body.dataset.active = "false";
    });
    Array.prototype.forEach.call(lines(), function (line) {
      line.setAttribute("aria-expanded", "false");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".widget"), function (widget) {
      widget.removeAttribute("data-selected");
    });
    var wasOpen = state.open;
    state.open = null;
    if (wasOpen && options.announce) {
      announce(
        template(t("announceClosed", wasOpen.lang), {
          title: (sectionOf(wasOpen.section) || { titles: {} }).titles[wasOpen.lang] || "",
          language: cfg.names[wasOpen.lang] || wasOpen.lang,
        }),
      );
    }
  }

  function openSection(sectionId, lang, options) {
    options = options || {};
    if (state.mode !== "multi") return;
    if (!options.force && state.open && state.open.section === sectionId && state.open.lang === lang) {
      closeSection({ announce: true });
      return;
    }
    var body = document.getElementById("b-" + sectionId + "-" + lang);
    if (!body) return;

    Array.prototype.forEach.call(bodies(), function (other) {
      other.dataset.active = other === body ? "true" : "false";
    });
    Array.prototype.forEach.call(lines(), function (line) {
      var on = line.dataset.section === sectionId && line.dataset.language === lang;
      line.setAttribute("aria-expanded", on ? "true" : "false");
      if (on) line.tabIndex = 0;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".widget"), function (widget) {
      var match = widget.querySelector('.line[data-language="' + lang + '"][data-section="' + sectionId + '"]');
      if (match) widget.dataset.selected = lang;
      else widget.removeAttribute("data-selected");
    });
    state.open = { section: sectionId, lang: lang };
    // Focus deliberately stays on the title (roving focus); the live region is
    // what tells screen-reader users what happened (§7.6.1).
    if (!options.silent) {
      var section = sectionOf(sectionId);
      announce(
        template(t("announceOpened", lang), {
          title: section ? section.titles[lang] : "",
          language: cfg.names[lang] || lang,
        }),
      );
    }
  }

  /* ------------------------------------------------------------ widget state */

  function setWidgetState(widget, value) {
    if (widget.dataset.state !== value) widget.dataset.state = value;
  }

  function widgetLines(widget) {
    return Array.prototype.slice.call(widget.querySelectorAll(".line"));
  }

  Array.prototype.forEach.call(document.querySelectorAll(".widget"), function (widget) {
    // §8.7: the transition belongs to the *text*, not to the widget's box. The box
    // is only the area the stacked view reserves, so entering its empty rows, its
    // gaps or the fused block's padding must leave the widget fused — the pointer
    // has to reach a glyph box. Leaving the widget altogether is what fuses it
    // again, so once the text is touched it stays stacked across the whole
    // reserved area (and the hovered line is the one that grows).
    var hoverEffects = function (target, clientX) {
      if (!target || !target.closest) return;
      var box = target.closest(".box");
      var line = target.closest(".line");
      var lang = box ? box.dataset.l : line ? line.dataset.language : null;
      if (!lang) return;
      var origin = box || nearestBox(widget, lang, clientX);
      if (!origin) return;
      waveAt(widget, box || line, clientX);
      if (settings.fontscroll) {
        var key = lang + ":" + boxesOfLine(widget, lang).indexOf(origin);
        if (widget._fontKey !== key) {
          widget._fontKey = key;
          startFontScroll(widget, lang, origin);
        }
      }
    };

    widget.addEventListener("mouseover", function (event) {
      var target = event.target;
      if (target && target.closest && target.closest(".box")) setWidgetState(widget, "stacked");
      hoverEffects(target, event.clientX);
    });

    // Once stacked, a line button covers the row, so the wave's origin comes from
    // the pointer's x against the line's own boxes (D13.2). `waveAt` and the font
    // start both no-op when their key has not changed, so this is cheap.
    widget.addEventListener("pointermove", function (event) {
      hoverEffects(event.target, event.clientX);
    });

    widget.addEventListener("mouseleave", function () {
      widget._fontKey = "";
      stopFontScroll();
      if (!widget.contains(document.activeElement)) setWidgetState(widget, "fused");
      // Let the un-hover wave play, then drop the inline delays so the next
      // hover starts from a clean state.
      window.setTimeout(function () {
        if (!widget.matches(":hover")) clearWaveDelays(widget);
      }, settings.duration + settings.waveDelay * 12);
    });

    widget.addEventListener("focusin", function (event) {
      setWidgetState(widget, "stacked");
      var line = event.target.closest ? event.target.closest(".line") : null;
      var lang = line ? line.dataset.language : null;
      if (lang) {
        var first = boxesOfLine(widget, lang)[0];
        if (first) waveLine(widget, lang, first);
        if (settings.fontscroll && first) startFontScroll(widget, lang, first);
      }
    });

    widget.addEventListener("focusout", function () {
      if (!widget.contains(document.activeElement) && !widget.matches(":hover")) {
        setWidgetState(widget, "fused");
      }
    });

    // Touch: the first tap only stacks, the second tap on a line opens (§8.7).
    // A mouse never needs this: entering the widget already stacked it.
    var stackedByTap = false;
    widget.addEventListener("pointerdown", function (event) {
      if (widget.dataset.state !== "fused") return;
      setWidgetState(widget, "stacked");
      stackedByTap = event.pointerType === "touch";
    });

    widget.addEventListener("click", function (event) {
      if (stackedByTap) {
        stackedByTap = false;
        var first = widgetLines(widget)[0];
        if (first) first.focus();
        return;
      }
      var target = event.target;
      var line = target && target.closest ? target.closest(".line") : null;
      if (!line && target && target.closest) {
        // §8.7: the glyph boxes are what the pointer reaches in a fused widget,
        // so a click on a glyph is a click on its own line.
        var box = target.closest(".box");
        if (box) line = widget.querySelector('.line[data-language="' + box.dataset.l + '"]');
      }
      if (!line) return;
      widgetLines(widget).forEach(function (other) {
        other.tabIndex = other === line ? 0 : -1;
      });
      openSection(line.dataset.section, line.dataset.language);
    });

    widget.addEventListener("keydown", function (event) {
      var list = widgetLines(widget);
      var index = list.indexOf(document.activeElement);
      if (index < 0) return;
      var next = -1;
      if (event.key === "ArrowDown") next = (index + 1) % list.length;
      else if (event.key === "ArrowUp") next = (index - 1 + list.length) % list.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      else if (event.key === "Escape") {
        setWidgetState(widget, "fused");
        return;
      } else return;
      event.preventDefault();
      list[index].tabIndex = -1;
      list[next].tabIndex = 0;
      list[next].focus();
    });
  });

  document.addEventListener("pointerdown", function (event) {
    if (event.pointerType !== "touch") return;
    Array.prototype.forEach.call(document.querySelectorAll(".widget"), function (widget) {
      if (!widget.contains(event.target)) setWidgetState(widget, "fused");
    });
  });

  /* -------------------------------------------------------------------- theme */

  function prefersDark() {
    return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function applyTheme() {
    var choice = root.dataset.themeChoice || "auto";
    root.dataset.theme = choice === "dark" || (choice === "auto" && prefersDark()) ? "dark" : "light";
  }

  function updateThemeButton() {
    if (!themeBtn) return;
    var labelLang = state.mode === "single" ? state.lang : def;
    var choice = root.dataset.themeChoice || "auto";
    var word = choice === "light" ? t("themeLight", labelLang) : choice === "dark" ? t("themeDark", labelLang) : t("themeAuto", labelLang);
    void themeWord; // the state is shown by the icon; the word lives in the label
    themeBtn.setAttribute("aria-pressed", choice === "auto" ? "false" : "true");
    themeBtn.setAttribute("aria-label", t("themeToggle", labelLang) + " — " + word);
    themeBtn.setAttribute("lang", labelLang);
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var order = ["light", "dark", "auto"];
      var current = root.dataset.themeChoice || "auto";
      var next = order[(order.indexOf(current) + 1) % order.length];
      root.dataset.themeChoice = next;
      try {
        if (next === "auto") localStorage.removeItem("home.theme");
        else localStorage.setItem("home.theme", next);
      } catch (e) {
        /* private mode: the choice simply does not persist */
      }
      applyTheme();
      updateThemeButton();
    });
  }

  if (window.matchMedia) {
    var query = matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () {
      if ((root.dataset.themeChoice || "auto") === "auto") applyTheme();
    };
    if (query.addEventListener) query.addEventListener("change", onChange);
    else if (query.addListener) query.addListener(onChange);
  }

  /* ------------------------------------------------------------------- dialog */

  var returnFocus = null;

  /* Locks the page behind the dialog without shifting it (the scrollbar width
     is given back as padding). */
  function lockScroll(lock) {
    var html = document.documentElement;
    if (lock) {
      var gap = window.innerWidth - html.clientWidth;
      document.body.style.paddingInlineEnd = gap > 0 ? gap + "px" : "";
      html.style.overflow = "hidden";
    } else {
      html.style.overflow = "";
      document.body.style.paddingInlineEnd = "";
    }
  }

  function openDialog(dialog, lang, invoker) {
    // D11.3: a section dialog shows exactly the language that was opened. The
    // settings dialog has one language-independent pane and no `data-language`.
    // D13.1: a modal freezes the page behind it at its resting 1×1 state.
    root.dataset.modal = "1";
    stopFontScroll();
    var isSettings = dialog.classList.contains("settings-dialog");
    // D13.5: the first time the panel is opened (a user gesture, which the Local
    // Font Access API requires) ask the platform for the real font list. On a
    // browser or an origin that does not expose it, the fallback list stays and
    // the note says so; the Scan button re-asks later.
    if (isSettings) scanFonts(false);
    var inner = isSettings
      ? dialog.querySelector(".dlg-inner")
      : dialog.querySelector('.dlg-inner[data-language="' + lang + '"]');
    Array.prototype.forEach.call(dialog.querySelectorAll(".dlg-inner"), function (pane) {
      pane.dataset.active = pane === inner ? "true" : "false";
    });
    if (!inner) return;
    if (!isSettings) {
      dialog.lang = lang;
      var labelled = inner.querySelector(".dlg-title");
      if (labelled) dialog.setAttribute("aria-labelledby", labelled.id);
    }
    var title = inner.querySelector(".dlg-title");
    returnFocus = invoker || null;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    lockScroll(true);
    if (title) {
      title.tabIndex = -1;
      title.focus();
    }
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      afterDialogClosed(dialog);
    }
  }

  function afterDialogClosed(dialog) {
    delete root.dataset.modal;
    if (dialog && dialog.classList && dialog.classList.contains("settings-dialog")) syncSettings();
    lockScroll(false);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
    void dialog;
  }

  document.addEventListener("click", function (event) {
    var expand = event.target.closest ? event.target.closest("[data-dialog]") : null;
    if (expand) {
      var dialog = document.getElementById(expand.dataset.dialog);
      if (dialog) openDialog(dialog, expand.dataset.language, expand);
      return;
    }
    var close = event.target.closest ? event.target.closest(".dlg-close") : null;
    if (close) {
      var owner = close.closest("dialog");
      if (owner) closeDialog(owner);
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll("dialog.dialog"), function (dialog) {
    dialog.addEventListener("close", function () {
      afterDialogClosed(dialog);
    });
    dialog.addEventListener("cancel", function (event) {
      // Native Esc: let it close, then restore scroll and focus.
      if (typeof dialog.close !== "function") {
        event.preventDefault();
        closeDialog(dialog);
      }
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeDialog(dialog); // backdrop
    });
    dialog.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && typeof dialog.close !== "function") closeDialog(dialog);
    });
  });

  /* ---------------------------------------------------------------- hash (§7.5) */

  function hashTarget() {
    var raw = location.hash.replace(/^#/, "");
    if (!raw) return null;
    var anchor;
    try {
      anchor = decodeURIComponent(raw);
    } catch (e) {
      anchor = raw;
    }
    anchor = anchor.toLowerCase();
    var fallback = null;
    for (var i = 0; i < cfg.sections.length; i += 1) {
      var section = cfg.sections[i];
      for (var j = 0; j < codes.length; j += 1) {
        if (section.anchors[codes[j]] !== anchor) continue;
        var hit = { section: section.id, lang: codes[j] };
        if (codes[j] === def) return hit; // collisions resolve to the source language
        if (!fallback) fallback = hit;
      }
    }
    return fallback;
  }

  function scrollToSection(sectionId) {
    var target = document.querySelector('section[data-section="' + sectionId + '"]');
    if (target) target.scrollIntoView({ block: "start" });
  }

  function applyHash(options) {
    options = options || {};
    var hit = hashTarget();
    if (!hit) return;
    if (state.mode === "single") {
      if (options.scroll) scrollToSection(hit.section);
      return;
    }
    openSection(hit.section, hit.lang, { force: true, silent: !options.announce });
    if (options.scroll) scrollToSection(hit.section);
  }

  window.addEventListener("hashchange", function () {
    applyHash({ scroll: true, announce: true });
  });

  window.addEventListener("popstate", function () {
    applyLanguage(normalize(rawLang()), { announce: true });
    applyHash({ scroll: true });
  });

  /* --------------------------------------------------------------- picker */

  if (picker) {
    picker.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest(".pick") : null;
      if (!button) return;
      var value = button.dataset.lang;
      if (value === "all") applyLanguage({ kind: "multi" }, { announce: true, push: true });
      else applyLanguage({ kind: "single", code: value }, { announce: true, push: true });
    });
  }

  /* --------------------------------------------------------------- settings */

  /** §7.3-style sanitising: never trust a stored object, never throw on one. */
  function readSettings() {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem("home.settings"));
    } catch (e) {
      saved = null;
    }
    var next = {};
    for (var key in SETTING_DEFAULTS) next[key] = SETTING_DEFAULTS[key];
    if (saved && typeof saved === "object") {
      if (saved.grow === false) next.grow = false;
      if (saved.bold === false) next.bold = false;
      if (saved.wave === true) next.wave = true;
      if (saved.reserve === false) next.reserve = false;
      if (saved.fontscroll === true) next.fontscroll = true;
      if (Number.isFinite(saved.waveDelay)) next.waveDelay = saved.waveDelay;
      if (Number.isFinite(saved.duration)) next.duration = saved.duration;
      if (Number.isFinite(saved.scale)) next.scale = saved.scale;
      if (Array.isArray(saved.fonts)) next.fonts = saved.fonts.filter(function (name) { return typeof name === "string" && name.length; });
      if (saved.font === "prop" || saved.font === "serif") next.font = saved.font;
    }
    return sanitizeSettings(next);
  }

  function clampNumber(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function sanitizeSettings(next) {
    return {
      grow: next.grow !== false,
      bold: next.bold !== false,
      wave: next.wave === true,
      waveDelay: Math.round(clampNumber(next.waveDelay, 0, 2000, 200) / 10) * 10,
      duration: Math.round(clampNumber(next.duration, 0, 2000, 400) / 10) * 10,
      reserve: next.reserve !== false,
      scale: Math.round(clampNumber(next.scale, 1.25, 3, 2) * 4) / 4,
      fontscroll: next.fontscroll === true,
      fonts: Array.isArray(next.fonts) ? next.fonts.slice() : null,
      font: next.font === "prop" || next.font === "serif" ? next.font : "mono",
    };
  }

  function syncSettings() {
    var values = [
      ["setting-grow", "grow"],
      ["setting-bold", "bold"],
      ["setting-wave", "wave"],
      ["setting-reserve", "reserve"],
      ["setting-fontscroll", "fontscroll"],
    ];
    values.forEach(function (pair) {
      var input = document.getElementById(pair[0]);
      if (input) input.checked = settings[pair[1]];
    });
    var numbers = [
      ["setting-wave-delay", "waveDelay"],
      ["setting-duration", "duration"],
      ["setting-scale", "scale"],
    ];
    numbers.forEach(function (pair) {
      var input = document.getElementById(pair[0]);
      if (input) input.value = String(settings[pair[1]]);
    });
    var delay = document.getElementById("setting-wave-delay");
    if (delay) delay.disabled = !settings.wave;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="typeface"]'), function (input) {
      input.checked = input.value === settings.font;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-font-choice]"), function (input) {
      input.checked = settings.fonts === null || settings.fonts.indexOf(input.value) > -1;
    });
  }

  function persistSettings() {
    try {
      localStorage.setItem("home.settings", JSON.stringify(settings));
    } catch (e) {
      /* private mode: the choice simply does not persist */
    }
  }

  /** Applies the whole object to the document; `persist` for a user change only. */
  function applySettings(next, options) {
    settings = sanitizeSettings(next);
    root.dataset.hoverGrow = settings.grow ? "1" : "0";
    root.dataset.hoverBold = settings.bold ? "1" : "0";
    root.dataset.wave = settings.wave ? "1" : "0";
    root.dataset.hoverReserve = settings.reserve ? "1" : "0";
    root.dataset.fontscroll = settings.fontscroll ? "1" : "0";
    root.dataset.font = settings.font === "prop" || settings.font === "serif" ? settings.font : "mono";
    root.style.setProperty("--dur-user", settings.duration + "ms");
    root.style.setProperty("--wave-step", settings.waveDelay + "ms");
    applyScale();
    if (!settings.wave) clearWaveDelays();
    if (!settings.fontscroll) stopFontScroll();
    if (options && options.persist) persistSettings();
  }

  /**
   * D13.4: the configured factor is honoured only as far as the viewport can
   * hold the hot row. The row starts at the grid origin and is `spaces +
   * letters × scale` cells wide, so
   *   (content − gridLeft) / cell  =  content/(2·cell) + C/2
   * is the number of cells available from that origin. At the 13px floor a 3×
   * row cannot fit a 320–390px phone, so the effective scale is capped instead
   * of letting the page scroll sideways. The cell budget already assumes the
   * requested factor, so this can only shrink the row, never overflow it.
   */
  function applyScale() {
    var cs = getComputedStyle(root);
    var cell = parseFloat(cs.getPropertyValue("--cell"));
    var cols = parseFloat(cs.getPropertyValue("--grid-cols")) || 21;
    var letters = parseFloat(cs.getPropertyValue("--hot-letters")) || 0;
    var spaces = parseFloat(cs.getPropertyValue("--hot-spaces")) || 0;
    var content = document.documentElement.clientWidth;
    var fit = settings.scale;
    if (cell > 0 && letters > 0 && content > 0) {
      fit = (content / (2 * cell) + cols / 2 - spaces) / letters;
    }
    var effective = Math.max(1, Math.min(settings.scale, fit));
    root.style.setProperty("--hover-scale", String(Math.round(effective * 100) / 100));
  }

  window.addEventListener("resize", applyScale);

  function settingLabel(input) {
    if (input.id) {
      var label = document.querySelector('label[for="' + input.id + '"]');
      if (label) return label.textContent.trim();
    }
    var wrapper = input.closest ? input.closest("label") : null;
    return wrapper ? wrapper.textContent.trim() : input.getAttribute("aria-label") || "";
  }

  document.addEventListener("change", function (event) {
    var input = event.target.closest ? event.target.closest("[data-setting]") : null;
    if (!input) return;
    var key = input.dataset.setting;
    var next = {};
    for (var name in settings) next[name] = settings[name];
    if (key === "font") next.font = input.value === "prop" || input.value === "serif" ? input.value : "mono";
    else if (input.type === "checkbox") next[key] = input.checked;
    else if (input.type === "number") {
      var value = Number(input.value);
      if (!Number.isFinite(value)) {
        syncSettings();
        return;
      }
      next[key] = value;
    } else return;
    applySettings(next, { persist: true });
    syncSettings();
    var label = settingLabel(input);
    var spoken = input.type === "checkbox" ? (input.checked ? " — on" : " — off") : " — " + input.value;
    announce(label + spoken);
    if (key === "wave" || key === "fontscroll") applyWaveAndFonts();
  });

  /* ------------------------------------------------------- wave (D13.2) */

  /** D13.2: motion preferences win over the wave and the font cycle. */
  function reducedMotion() {
    return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function boxesOfLine(widget, lang) {
    return Array.prototype.slice.call(widget.querySelectorAll('.box[data-l="' + lang + '"]'));
  }

  function clearWaveDelays(widget) {
    var scope = widget || document;
    Array.prototype.forEach.call(scope.querySelectorAll(".box"), function (box) {
      box.style.removeProperty("--box-delay");
    });
    if (scope.querySelectorAll) {
      Array.prototype.forEach.call(scope.querySelectorAll(".widget"), function (node) {
        node._waveKey = "";
      });
    }
  }

  function nearestBox(widget, lang, clientX) {
    var boxes = boxesOfLine(widget, lang);
    var best = boxes[0] || null;
    var bestDistance = Infinity;
    boxes.forEach(function (box) {
      var rect = box.getBoundingClientRect();
      var distance = Math.abs(rect.left + rect.width / 2 - clientX);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = box;
      }
    });
    return best;
  }

  /** Applies the stagger for one line; `origin` is a box of that line. */
  function waveLine(widget, lang, origin) {
    if (!settings.wave) return;
    var boxes = boxesOfLine(widget, lang);
    if (!boxes.length) return;
    if (reducedMotion()) {
      clearWaveDelays(widget);
      return;
    }
    var index = Math.max(0, boxes.indexOf(origin));
    boxes.forEach(function (box, i) {
      box.style.setProperty("--box-delay", String(Math.abs(i - index) * settings.waveDelay) + "ms");
    });
  }

  function waveAt(widget, target, clientX) {
    if (!settings.wave || !target || !target.closest) return;
    var box = target.closest(".box");
    var line = target.closest(".line");
    var lang = box ? box.dataset.l : line ? line.dataset.language : null;
    if (!lang) return;
    var origin = box || nearestBox(widget, lang, clientX);
    if (!origin) return;
    var boxes = boxesOfLine(widget, lang);
    var key = lang + ":" + boxes.indexOf(origin);
    if (widget._waveKey === key) return;
    widget._waveKey = key;
    Array.prototype.forEach.call(widget.querySelectorAll(".box"), function (node) {
      if (node.dataset.l !== lang) node.style.removeProperty("--box-delay");
    });
    waveLine(widget, lang, origin);
  }

  /* ------------------------------------------------- fontscroll (D13.5) */

  var FALLBACK_FONTS = [
    "ui-monospace",
    "monospace",
    "system-ui",
    "sans-serif",
    "serif",
    "Georgia",
    "Courier New",
    "Menlo",
    "Consolas",
    "Arial",
    "Helvetica",
    "Verdana",
    "Times New Roman",
  ];
  var availableFonts = FALLBACK_FONTS.slice();
  var fontTimers = [];
  var fontsScanned = false;

  function fontPool() {
    var pool = settings.fonts === null ? availableFonts.slice() : settings.fonts.slice();
    return pool.filter(function (name) {
      return !/emoji|symbola|color/i.test(name);
    });
  }

  function stopFontScroll() {
    fontTimers.forEach(function (timer) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    });
    fontTimers = [];
    Array.prototype.forEach.call(document.querySelectorAll(".gl"), function (glyph) {
      glyph.style.removeProperty("font-family");
    });
  }

  /** Cycles the hovered line's glyphs through the selected fonts, then settles. */
  function startFontScroll(widget, lang, origin) {
    if (!settings.fontscroll || reducedMotion()) return;
    var pool = fontPool();
    if (!pool.length) return;
    stopFontScroll();
    var boxes = boxesOfLine(widget, lang);
    var index = Math.max(0, boxes.indexOf(origin));
    boxes.forEach(function (box, i) {
      var glyph = box.querySelector(".gl");
      if (!glyph) return;
      var delay = settings.wave ? Math.abs(i - index) * settings.waveDelay : 0;
      var start = window.setTimeout(function () {
        var step = i;
        var timer = window.setInterval(function () {
          var family = pool[step % pool.length].replace(/"/g, "");
          glyph.style.fontFamily = '"' + family + '"';
          step += 1;
        }, 70);
        fontTimers.push(timer);
        fontTimers.push(
          window.setTimeout(function () {
            window.clearInterval(timer);
            glyph.style.removeProperty("font-family");
          }, settings.duration),
        );
      }, delay);
      fontTimers.push(start);
    });
  }

  /** The font list: every family on the machine (or the fallback), all checked. */
  function renderFontList() {
    var list = document.getElementById("font-list");
    if (!list) return;
    list.textContent = "";
    availableFonts.forEach(function (family) {
      var label = document.createElement("label");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = family;
      input.setAttribute("data-font-choice", "");
      input.checked = settings.fonts === null || settings.fonts.indexOf(family) > -1;
      var span = document.createElement("span");
      span.textContent = family;
      span.style.fontFamily = '"' + family.replace(/"/g, "") + '"';
      label.appendChild(input);
      label.appendChild(span);
      list.appendChild(label);
    });
  }

  function scanFonts(force) {
    if (fontsScanned && !force) return;
    fontsScanned = true;
    var note = document.getElementById("font-note");
    var labelLang = state.mode === "single" ? state.lang : def;
    if (!navigator.queryLocalFonts) {
      if (note) note.textContent = t("fontsFallback", labelLang);
      return;
    }
    var request;
    try {
      request = navigator.queryLocalFonts();
    } catch (e) {
      if (note) note.textContent = t("fontsFallback", labelLang);
      return;
    }
    request.then(
      function (fonts) {
        var families = [];
        fonts.forEach(function (font) {
          var family = font && font.family;
          if (!family || /emoji|symbola|color/i.test(family)) return;
          if (families.indexOf(family) < 0) families.push(family);
        });
        families.sort(function (a, b) {
          return a.localeCompare(b);
        });
        availableFonts = families.length ? families : FALLBACK_FONTS.slice();
        var missing = settings.fonts === null ? [] : settings.fonts.filter(function (name) {
          return availableFonts.indexOf(name) < 0;
        });
        settings.fonts = settings.fonts === null ? null : settings.fonts.concat(missing);
        renderFontList();
        persistSettings();
        announce(t("fontsScan", labelLang) + " — " + availableFonts.length);
      },
      function () {
        if (note) note.textContent = t("fontsFallback", labelLang);
      },
    );
  }

  function applyWaveAndFonts() {
    if (!settings.wave) clearWaveDelays();
    if (!settings.fontscroll) stopFontScroll();
  }

  var fontList = document.getElementById("font-list");
  if (fontList) {
    fontList.addEventListener("change", function (event) {
      var input = event.target.closest ? event.target.closest("[data-font-choice]") : null;
      if (!input) return;
      var all = Array.prototype.slice.call(fontList.querySelectorAll("[data-font-choice]"));
      var picked = all.filter(function (node) { return node.checked; }).map(function (node) { return node.value; });
      settings = sanitizeSettings(Object.assign({}, settings, { fonts: picked.length === all.length ? null : picked }));
      persistSettings();
      announce(input.value + (input.checked ? " — on" : " — off"));
    });
  }
  var fontScan = document.getElementById("font-scan");
  if (fontScan)
    fontScan.addEventListener("click", function () {
      scanFonts(true);
    });

  /* ------------------------------------------------------------------- boot */

  applySettings(settings, {});
  syncSettings();
  renderFontList();
  applyTheme();
  applyLanguage(normalize(rawLang()), { announce: false });
  applyHash({ scroll: false });
  void bar;
})();
