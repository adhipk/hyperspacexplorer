/*
  HyperEdit phase 1

  Include in any HTML page:
  <script src="/hyperedit.js" data-save-url="/__hyperedit/save"></script>

  The optional data-save-url hook is intentionally small for phase 2. When it is
  present, the Save button POSTs { pathname, title, html, source, updatedAt }.
*/
(function () {
  "use strict";

  if (window.HyperEdit && window.HyperEdit.destroy) {
    return;
  }

  var script = document.currentScript;
  var options = {
    rootSelector: (script && script.dataset.root) || "body",
    autoStart: !!(script && script.dataset.autostart === "true"),
    saveUrl: (script && script.dataset.saveUrl) || "",
    storageKey:
      (script && script.dataset.storageKey) ||
      "hyperedit:" + location.origin + location.pathname,
  };

  var colors = [
    { name: "red", solid: "#e03131", pale: "rgba(224, 49, 49, 0.13)" },
    { name: "blue", solid: "#228be6", pale: "rgba(34, 139, 230, 0.13)" },
    { name: "ink", solid: "#1e1e1e", pale: "rgba(30, 30, 30, 0.1)" },
  ];

  var state = {
    editing: false,
    tool: "select",
    colorIndex: 0,
    dirty: false,
    editables: [],
    activeElement: null,
    commentTarget: null,
    sampling: false,
    saveTimer: 0,
  };

  var host = null;
  var shadow = null;
  var toolbar = {};
  var globalStyle = null;
  var observer = null;

  function init() {
    injectPageStyle();
    mountToolbar();
    bindDocumentEvents();
    refreshEditables();
    updateToolbar();

    observer = new MutationObserver(function () {
      if (!state.editing) {
        return;
      }

      refreshEditables();
    });
    observer.observe(getRoot(), { childList: true, subtree: true });

    if (options.autoStart) {
      setEditing(true);
    }
  }

  function getRoot() {
    return document.querySelector(options.rootSelector) || document.body;
  }

  function injectPageStyle() {
    if (document.getElementById("hyperedit-page-style")) {
      globalStyle = document.getElementById("hyperedit-page-style");
      return;
    }

    globalStyle = document.createElement("style");
    globalStyle.id = "hyperedit-page-style";
    globalStyle.textContent = [
      ".hx-editor-editable {",
      "  outline: 1px solid transparent;",
      "  outline-offset: 4px;",
      "  transition: outline-color 140ms ease, background-color 140ms ease;",
      "}",
      "html.hx-editor-on .hx-editor-editable:hover {",
      "  outline-color: rgba(151, 117, 250, 0.48);",
      "  background-color: rgba(208, 204, 254, 0.08);",
      "}",
      "html.hx-editor-on .hx-editor-active {",
      "  outline-color: rgba(21, 170, 191, 0.82);",
      "  background-color: rgba(21, 170, 191, 0.06);",
      "}",
      "html.hx-editor-on mark[data-hx-highlight] {",
      "  border-radius: 0.22em;",
      "  box-decoration-break: clone;",
      "  -webkit-box-decoration-break: clone;",
      "  padding: 0.02em 0.12em;",
      "}",
      "html.hx-editor-sampling * { cursor: crosshair !important; }",
    ].join("\n");
    document.head.appendChild(globalStyle);
  }

  function mountToolbar() {
    host = document.createElement("div");
    host.id = "hyperedit-root";
    host.setAttribute("data-hx-editor-ui", "");
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = [
      "<style>",
      ":host {",
      "  all: initial;",
      "  color-scheme: light;",
      "  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
      "}",
      "button, input, textarea { font: inherit; }",
      ".rail {",
      "  position: fixed;",
      "  z-index: 2147483646;",
      "  left: 36px;",
      "  top: 72px;",
      "  width: 56px;",
      "  min-height: 292px;",
      "  box-sizing: border-box;",
      "  padding: 12px 8px;",
      "  display: grid;",
      "  gap: 10px;",
      "  align-content: start;",
      "  border: 1px solid rgba(151, 117, 250, 0.2);",
      "  border-radius: 28px;",
      "  background: rgba(208, 204, 254, 0.36);",
      "  box-shadow: 0 18px 44px rgba(30, 30, 30, 0.08);",
      "  backdrop-filter: blur(18px);",
      "  -webkit-backdrop-filter: blur(18px);",
      "}",
      ".group {",
      "  display: grid;",
      "  gap: 8px;",
      "  justify-items: center;",
      "}",
      ".divider {",
      "  width: 24px;",
      "  height: 1px;",
      "  margin: 2px auto;",
      "  background: rgba(151, 117, 250, 0.24);",
      "}",
      ".icon-button {",
      "  width: 38px;",
      "  height: 38px;",
      "  display: grid;",
      "  place-items: center;",
      "  color: #1e1e1e;",
      "  border: 1px solid rgba(151, 117, 250, 0.18);",
      "  border-radius: 999px;",
      "  background: rgba(246, 247, 244, 0.82);",
      "  box-shadow: 0 7px 18px rgba(30, 30, 30, 0.08);",
      "  cursor: pointer;",
      "  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease, opacity 120ms ease;",
      "}",
      ".icon-button svg { width: 19px; height: 19px; }",
      ".icon-button:hover {",
      "  transform: translateY(-1px);",
      "  border-color: rgba(151, 117, 250, 0.5);",
      "  background: #ffffff;",
      "}",
      ".icon-button[aria-pressed='true'] {",
      "  color: #9775fa;",
      "  border-color: rgba(151, 117, 250, 0.72);",
      "  background: #f6f7f4;",
      "}",
      ".icon-button:disabled {",
      "  opacity: 0.36;",
      "  cursor: default;",
      "  transform: none;",
      "}",
      ".swatches {",
      "  display: grid;",
      "  grid-template-columns: repeat(3, 1fr);",
      "  gap: 5px;",
      "  width: 38px;",
      "}",
      ".swatch {",
      "  width: 10px;",
      "  height: 10px;",
      "  border: 0;",
      "  border-radius: 3px;",
      "  padding: 0;",
      "  cursor: pointer;",
      "  box-shadow: 0 0 0 1px rgba(246, 247, 244, 0.9), 0 0 0 2px transparent;",
      "}",
      ".swatch[aria-pressed='true'] { box-shadow: 0 0 0 1px #f6f7f4, 0 0 0 3px rgba(151, 117, 250, 0.82); }",
      ".status {",
      "  width: 8px;",
      "  height: 8px;",
      "  justify-self: center;",
      "  border-radius: 999px;",
      "  background: rgba(30, 30, 30, 0.28);",
      "}",
      ".status[data-state='ready'] { background: #15aabf; }",
      ".status[data-state='dirty'] { background: #e03131; }",
      ".status[data-state='saved'] { background: #2f9e44; }",
      ".comment-popover {",
      "  position: fixed;",
      "  z-index: 2147483647;",
      "  width: min(280px, calc(100vw - 28px));",
      "  padding: 10px;",
      "  box-sizing: border-box;",
      "  border: 1px solid rgba(151, 117, 250, 0.26);",
      "  border-radius: 12px;",
      "  background: rgba(246, 247, 244, 0.96);",
      "  box-shadow: 0 18px 48px rgba(30, 30, 30, 0.14);",
      "  backdrop-filter: blur(16px);",
      "  -webkit-backdrop-filter: blur(16px);",
      "}",
      ".comment-popover[hidden] { display: none; }",
      ".comment-popover textarea {",
      "  width: 100%;",
      "  min-height: 86px;",
      "  resize: vertical;",
      "  box-sizing: border-box;",
      "  padding: 9px 10px;",
      "  border: 1px solid rgba(30, 30, 30, 0.12);",
      "  border-radius: 8px;",
      "  outline: none;",
      "  color: #1e1e1e;",
      "  background: #ffffff;",
      "}",
      ".comment-popover textarea:focus { border-color: rgba(21, 170, 191, 0.7); }",
      ".comment-actions {",
      "  display: flex;",
      "  justify-content: flex-end;",
      "  gap: 8px;",
      "  margin-top: 8px;",
      "}",
      ".comment-actions button {",
      "  width: 30px;",
      "  height: 30px;",
      "  display: grid;",
      "  place-items: center;",
      "  border: 1px solid rgba(30, 30, 30, 0.12);",
      "  border-radius: 999px;",
      "  background: #ffffff;",
      "  color: #1e1e1e;",
      "  cursor: pointer;",
      "}",
      ".comment-actions svg { width: 16px; height: 16px; }",
      "@media (max-width: 720px) {",
      "  .rail {",
      "    left: 50%;",
      "    top: auto;",
      "    bottom: 14px;",
      "    width: auto;",
      "    min-height: 0;",
      "    grid-auto-flow: column;",
      "    align-items: center;",
      "    transform: translateX(-50%);",
      "    padding: 8px 10px;",
      "    border-radius: 999px;",
      "  }",
      "  .group { grid-auto-flow: column; }",
      "  .divider { width: 1px; height: 24px; margin: auto 1px; }",
      "  .swatches { grid-auto-flow: column; grid-template-columns: none; }",
      "}",
      "</style>",
      "<div class='rail' part='toolbar'>",
      "  <div class='group'>",
      buttonHtml("edit", "Toggle editing", iconPen()),
      "  </div>",
      "  <div class='divider'></div>",
      "  <div class='group'>",
      buttonHtml("select", "Select", iconCursor()),
      buttonHtml("highlight", "Highlight", iconHighlighter()),
      buttonHtml("sample", "Copy color", iconPipette()),
      "  </div>",
      "  <div class='swatches' aria-label='Colors'>",
      colors
        .map(function (color, index) {
          return (
            "<button class='swatch' type='button' data-color='" +
            index +
            "' title='" +
            color.name +
            "' aria-label='" +
            color.name +
            "' style='background:" +
            color.solid +
            "'></button>"
          );
        })
        .join(""),
      "  </div>",
      "  <div class='divider'></div>",
      "  <div class='group'>",
      buttonHtml("save", "Save", iconSave()),
      "    <div class='status' data-status title='Off'></div>",
      "  </div>",
      "</div>",
      "<div class='comment-popover' data-comment-popover hidden>",
      "  <textarea data-comment-input placeholder='Comment'></textarea>",
      "  <div class='comment-actions'>",
      "    <button type='button' data-comment-clear title='Clear comment' aria-label='Clear comment'>",
      iconTrash(),
      "    </button>",
      "    <button type='button' data-comment-close title='Done' aria-label='Done'>",
      iconCheck(),
      "    </button>",
      "  </div>",
      "</div>",
    ].join("");

    toolbar.rail = shadow.querySelector(".rail");
    toolbar.status = shadow.querySelector("[data-status]");
    toolbar.commentPopover = shadow.querySelector("[data-comment-popover]");
    toolbar.commentInput = shadow.querySelector("[data-comment-input]");
    toolbar.buttons = Array.prototype.slice.call(
      shadow.querySelectorAll("[data-tool]")
    );
    toolbar.swatches = Array.prototype.slice.call(
      shadow.querySelectorAll("[data-color]")
    );

    toolbar.buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        handleTool(button.dataset.tool);
      });
    });

    toolbar.swatches.forEach(function (button) {
      button.addEventListener("click", function () {
        state.colorIndex = Number(button.dataset.color);
        updateToolbar();
      });
    });

    toolbar.commentInput.addEventListener("input", function () {
      if (!state.commentTarget) {
        return;
      }

      state.commentTarget.dataset.hxComment = toolbar.commentInput.value;
      state.commentTarget.title = toolbar.commentInput.value;
      markDirty();
    });

    shadow
      .querySelector("[data-comment-close]")
      .addEventListener("click", closeCommentPopover);

    shadow
      .querySelector("[data-comment-clear]")
      .addEventListener("click", function () {
        if (!state.commentTarget) {
          return;
        }

        delete state.commentTarget.dataset.hxComment;
        state.commentTarget.removeAttribute("title");
        toolbar.commentInput.value = "";
        markDirty();
        closeCommentPopover();
      });
  }

  function buttonHtml(tool, label, icon) {
    return (
      "<button class='icon-button' type='button' data-tool='" +
      tool +
      "' title='" +
      label +
      "' aria-label='" +
      label +
      "'>" +
      icon +
      "</button>"
    );
  }

  function iconAttrs() {
    return " viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'";
  }

  function iconPen() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z'></path><path d='m15 5 4 4'></path></svg>"
    );
  }

  function iconCursor() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='m4 4 7.5 16 2.2-6.3L20 11.5Z'></path></svg>"
    );
  }

  function iconHighlighter() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='m9 11-6 6v3h9l3-3'></path><path d='m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'></path></svg>"
    );
  }

  function iconPipette() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='m12 9-8.4 8.4A2 2 0 0 0 3 18.8V20a1 1 0 0 0 1 1h1.2a2 2 0 0 0 1.4-.6L15 12'></path><path d='m18 9 .4.4a1 1 0 0 1 0 1.4l-2.6 2.6a1 1 0 0 1-1.4 0l-3.8-3.8a1 1 0 0 1 0-1.4l2.6-2.6a1 1 0 0 1 1.4 0l.4.4 3.4-3.4a1 1 0 1 1 3 3Z'></path></svg>"
    );
  }

  function iconSave() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z'></path><path d='M17 21v-8H7v8'></path><path d='M7 3v5h8'></path></svg>"
    );
  }

  function iconTrash() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='M3 6h18'></path><path d='M8 6V4h8v2'></path><path d='M19 6l-1 14H6L5 6'></path></svg>"
    );
  }

  function iconCheck() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='M20 6 9 17l-5-5'></path></svg>"
    );
  }

  function handleTool(tool) {
    if (tool === "edit") {
      setEditing(!state.editing);
      return;
    }

    if (tool === "save") {
      saveNow();
      return;
    }

    if (!state.editing) {
      return;
    }

    if (tool === "sample") {
      startSampling();
      return;
    }

    state.tool = tool;
    updateToolbar();
  }

  function bindDocumentEvents() {
    document.addEventListener("dblclick", handleDoubleClick, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", repositionCommentPopover);
    window.addEventListener("scroll", repositionCommentPopover, true);
  }

  function handleDoubleClick(event) {
    if (!state.editing || isToolbarEvent(event)) {
      return;
    }

    var editable = findEditable(event.target);
    if (!editable) {
      return;
    }

    state.tool = "select";
    focusEditable(editable);
    updateToolbar();
  }

  function handleFocusIn(event) {
    var editable = findEditable(event.target);
    if (!editable) {
      return;
    }

    setActiveElement(editable);
  }

  function handleFocusOut(event) {
    if (event.target === state.activeElement) {
      setActiveElement(null);
    }
  }

  function handleInput(event) {
    if (!state.editing) {
      return;
    }

    if (
      findEditable(event.target) ||
      (event.target instanceof Element &&
        event.target.closest("mark[data-hx-highlight]"))
    ) {
      markDirty();
    }
  }

  function handleMouseUp(event) {
    if (!state.editing || state.tool !== "highlight" || isToolbarEvent(event)) {
      return;
    }

    var shouldComment = event.shiftKey;
    window.setTimeout(function () {
      applySelectionHighlight(shouldComment);
    }, 0);
  }

  function handleDocumentClick(event) {
    if (isToolbarEvent(event)) {
      return;
    }

    if (state.sampling) {
      event.preventDefault();
      event.stopPropagation();
      sampleColor(event.target);
      return;
    }

    if (!state.editing) {
      return;
    }

    var mark = event.target.closest && event.target.closest("mark[data-hx-highlight]");
    if (mark && mark.dataset.hxComment !== undefined) {
      openCommentPopover(mark);
      return;
    }

    if (!toolbar.commentPopover.hidden && !mark) {
      closeCommentPopover();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closeCommentPopover();
      stopSampling();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveNow();
    }
  }

  function isToolbarEvent(event) {
    return event.composedPath && event.composedPath().indexOf(host) !== -1;
  }

  function refreshEditables() {
    var root = getRoot();
    state.editables = root instanceof HTMLElement ? [root] : [];

    if (state.editing) {
      state.editables.forEach(enableEditable);
    }
  }

  function findEditable(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    var editable = target.closest(".hx-editor-editable");
    if (!editable || !getRoot().contains(editable)) {
      return null;
    }

    return editable;
  }

  function setEditing(nextEditing) {
    state.editing = !!nextEditing;
    state.tool = state.editing ? "select" : "select";
    closeCommentPopover();
    stopSampling();
    refreshEditables();

    document.documentElement.classList.toggle("hx-editor-on", state.editing);

    if (state.editing) {
      state.editables.forEach(enableEditable);
    } else {
      cleanupEditorState();
      setActiveElement(null);
    }

    updateToolbar();
  }

  function cleanupEditorState() {
    state.editables.forEach(disableEditable);
  }

  function enableEditable(element) {
    if (element.dataset.hxPrevContenteditable === undefined) {
      element.dataset.hxPrevContenteditable = element.hasAttribute("contenteditable")
        ? element.getAttribute("contenteditable")
        : "__missing__";
    }

    if (element.dataset.hxPrevSpellcheck === undefined) {
      element.dataset.hxPrevSpellcheck = element.hasAttribute("spellcheck")
        ? element.getAttribute("spellcheck")
        : "__missing__";
    }

    element.classList.add("hx-editor-editable");
    element.setAttribute("contenteditable", "true");
    element.setAttribute("spellcheck", "true");
  }

  function disableEditable(element) {
    element.classList.remove("hx-editor-editable", "hx-editor-active");
    restoreAttribute(element, "contenteditable", element.dataset.hxPrevContenteditable);
    restoreAttribute(element, "spellcheck", element.dataset.hxPrevSpellcheck);
    delete element.dataset.hxPrevContenteditable;
    delete element.dataset.hxPrevSpellcheck;
  }

  function restoreAttribute(element, attribute, value) {
    if (value === undefined || value === "__missing__") {
      element.removeAttribute(attribute);
      return;
    }

    element.setAttribute(attribute, value);
  }

  function focusEditable(element) {
    enableEditable(element);
    element.focus({ preventScroll: true });
    setActiveElement(element);
  }

  function setActiveElement(element) {
    if (state.activeElement) {
      state.activeElement.classList.remove("hx-editor-active");
    }

    state.activeElement = element;

    if (state.activeElement) {
      state.activeElement.classList.add("hx-editor-active");
    }
  }

  function applySelectionHighlight(shouldComment) {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    var range = selection.getRangeAt(0);
    if (!getRoot().contains(range.commonAncestorContainer)) {
      return;
    }

    var color = colors[state.colorIndex];
    var mark = document.createElement("mark");
    mark.dataset.hxHighlight = color.name;
    mark.style.background = color.pale;
    mark.style.color = "inherit";

    try {
      var fragment = range.extractContents();
      mark.appendChild(fragment);
      range.insertNode(mark);
      selection.removeAllRanges();
      markDirty();

      if (shouldComment) {
        mark.dataset.hxComment = "";
        openCommentPopover(mark);
      }
    } catch (error) {
      document.execCommand("HiliteColor", false, color.pale);
      selection.removeAllRanges();
      markDirty();
    }
  }

  function openCommentPopover(mark) {
    state.commentTarget = mark;
    toolbar.commentInput.value = mark.dataset.hxComment || "";
    toolbar.commentPopover.hidden = false;
    repositionCommentPopover();
    window.setTimeout(function () {
      toolbar.commentInput.focus();
    }, 0);
  }

  function closeCommentPopover() {
    if (!toolbar.commentPopover) {
      return;
    }

    toolbar.commentPopover.hidden = true;
    state.commentTarget = null;
  }

  function repositionCommentPopover() {
    if (
      !toolbar.commentPopover ||
      toolbar.commentPopover.hidden ||
      !state.commentTarget
    ) {
      return;
    }

    var rect = state.commentTarget.getBoundingClientRect();
    var width = Math.min(280, window.innerWidth - 28);
    var left = Math.min(Math.max(14, rect.left), window.innerWidth - width - 14);
    var top = rect.bottom + 10;

    if (top + 150 > window.innerHeight) {
      top = Math.max(14, rect.top - 150);
    }

    toolbar.commentPopover.style.left = left + "px";
    toolbar.commentPopover.style.top = top + "px";
  }

  function startSampling() {
    if (window.EyeDropper) {
      var eyeDropper = new window.EyeDropper();
      eyeDropper
        .open()
        .then(function (result) {
          setSampledColor(result.sRGBHex);
        })
        .catch(function () {
          stopSampling();
        });
      return;
    }

    state.sampling = true;
    document.documentElement.classList.add("hx-editor-sampling");
    updateToolbar();
  }

  function stopSampling() {
    state.sampling = false;
    document.documentElement.classList.remove("hx-editor-sampling");
    updateToolbar();
  }

  function sampleColor(target) {
    var styles = window.getComputedStyle(target);
    var sampled = rgbaToHex(styles.backgroundColor);

    if (!sampled) {
      sampled = rgbaToHex(styles.color);
    }

    if (sampled) {
      setSampledColor(sampled);
    }

    stopSampling();
  }

  function setSampledColor(hex) {
    colors[state.colorIndex] = {
      name: "sampled",
      solid: hex,
      pale: hexToRgba(hex, 0.13),
    };

    copyText(hex);
    updateToolbar();
  }

  function rgbaToHex(value) {
    var match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) {
      return "";
    }

    var parts = match[1].split(",").map(function (part) {
      return part.trim();
    });
    var alpha = parts[3] === undefined ? 1 : Number(parts[3]);
    if (alpha === 0) {
      return "";
    }

    return (
      "#" +
      parts
        .slice(0, 3)
        .map(function (part) {
          var number = Math.max(0, Math.min(255, parseInt(part, 10)));
          return number.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  function hexToRgba(hex, alpha) {
    var normalized = String(hex).replace("#", "");
    if (normalized.length === 3) {
      normalized = normalized
        .split("")
        .map(function (part) {
          return part + part;
        })
        .join("");
    }

    var red = parseInt(normalized.slice(0, 2), 16);
    var green = parseInt(normalized.slice(2, 4), 16);
    var blue = parseInt(normalized.slice(4, 6), 16);
    return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
  }

  function copyText(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    navigator.clipboard.writeText(text).catch(function () {});
  }

  function markDirty() {
    state.dirty = true;
    updateToolbar();
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveDraft, 450);
  }

  function saveDraft() {
    try {
      localStorage.setItem(options.storageKey + ":draft", serializeDocument());
    } catch (error) {}
  }

  function saveNow() {
    var html = serializeDocument();
    var payload = {
      pathname: location.pathname,
      title: document.title,
      html: html,
      source: "hyperedit",
      updatedAt: new Date().toISOString(),
    };

    var beforeEvent = new CustomEvent("hyperedit:before-save", {
      cancelable: true,
      detail: payload,
    });

    if (!document.dispatchEvent(beforeEvent)) {
      return Promise.resolve(false);
    }

    updateStatus("dirty", "Saving");

    var savePromise = options.saveUrl
      ? fetch(options.saveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(function (response) {
          if (!response.ok) {
            throw new Error("Save failed: " + response.status);
          }

          return response;
        })
      : Promise.resolve(saveDraft());

    return savePromise
      .then(function () {
        state.dirty = false;
        updateStatus("saved", "Saved");
        document.dispatchEvent(
          new CustomEvent("hyperedit:save", { detail: payload })
        );
        window.setTimeout(updateToolbar, 900);
        return true;
      })
      .catch(function (error) {
        updateStatus("dirty", error.message || "Save failed");
        document.dispatchEvent(
          new CustomEvent("hyperedit:save-error", {
            detail: { error: error, payload: payload },
          })
        );
        return false;
      });
  }

  function serializeDocument() {
    var clone = document.documentElement.cloneNode(true);
    clone.classList.remove("hx-editor-on", "hx-editor-sampling");

    if (!clone.getAttribute("class")) {
      clone.removeAttribute("class");
    }

    Array.prototype.forEach.call(
      clone.querySelectorAll("[data-hx-editor-ui], #hyperedit-page-style"),
      function (element) {
        element.remove();
      }
    );

    Array.prototype.forEach.call(
      clone.querySelectorAll(".hx-editor-editable"),
      function (element) {
        var wasActivated = element.classList.contains("hx-editor-editable");
        element.classList.remove(
          "hx-editor-editable",
          "hx-editor-active"
        );

        if (wasActivated) {
          restoreCloneAttribute(
            element,
            "contenteditable",
            element.dataset.hxPrevContenteditable
          );
          restoreCloneAttribute(
            element,
            "spellcheck",
            element.dataset.hxPrevSpellcheck
          );
          delete element.dataset.hxPrevContenteditable;
          delete element.dataset.hxPrevSpellcheck;
        }

        if (!element.getAttribute("class")) {
          element.removeAttribute("class");
        }
      }
    );

    return getDoctype() + clone.outerHTML;
  }

  function restoreCloneAttribute(element, attribute, value) {
    if (value === undefined || value === "__missing__") {
      element.removeAttribute(attribute);
      return;
    }

    element.setAttribute(attribute, value);
  }

  function getDoctype() {
    var doctype = document.doctype;
    if (!doctype) {
      return "";
    }

    return (
      "<!DOCTYPE " +
      doctype.name +
      (doctype.publicId ? ' PUBLIC "' + doctype.publicId + '"' : "") +
      (doctype.systemId ? ' "' + doctype.systemId + '"' : "") +
      ">\n"
    );
  }

  function updateToolbar() {
    toolbar.buttons.forEach(function (button) {
      var tool = button.dataset.tool;
      var pressed =
        (tool === "edit" && state.editing) ||
        (tool === state.tool && tool !== "save") ||
        (tool === "sample" && state.sampling);
      button.setAttribute("aria-pressed", String(pressed));

      if (tool !== "edit" && tool !== "save") {
        button.disabled = !state.editing;
      }
    });

    toolbar.swatches.forEach(function (button, index) {
      button.setAttribute("aria-pressed", String(index === state.colorIndex));
      button.style.background = colors[index].solid;
      button.title = colors[index].solid;
      button.setAttribute("aria-label", colors[index].solid);
      button.disabled = !state.editing;
    });

    if (!state.editing) {
      updateStatus("off", "Off");
    } else if (state.dirty) {
      updateStatus("dirty", "Unsaved");
    } else {
      updateStatus("ready", "Ready");
    }
  }

  function updateStatus(status, label) {
    toolbar.status.dataset.state = status;
    toolbar.status.title = label;
  }

  function destroy() {
    setEditing(false);
    closeCommentPopover();
    window.clearTimeout(state.saveTimer);

    if (observer) {
      observer.disconnect();
    }

    document.removeEventListener("dblclick", handleDoubleClick, true);
    document.removeEventListener("focusin", handleFocusIn, true);
    document.removeEventListener("focusout", handleFocusOut, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("mouseup", handleMouseUp, true);
    document.removeEventListener("click", handleDocumentClick, true);
    document.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("resize", repositionCommentPopover);
    window.removeEventListener("scroll", repositionCommentPopover, true);

    if (host) {
      host.remove();
    }

    document.documentElement.classList.remove(
      "hx-editor-on",
      "hx-editor-sampling"
    );
  }

  window.HyperEdit = {
    destroy: destroy,
    enable: function () {
      setEditing(true);
    },
    disable: function () {
      setEditing(false);
    },
    save: saveNow,
    serialize: serializeDocument,
    refresh: refreshEditables,
    configure: function (nextOptions) {
      options = Object.assign({}, options, nextOptions || {});
      refreshEditables();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
