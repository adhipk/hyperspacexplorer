/*
  HyperEdit

  Include in any HTML page:
  <script src="/hyperedit.js" data-save-url="/your-save-endpoint"></script>

  The optional data-save-url hook is backend-agnostic. When it is present, the
  Save button POSTs { pathname, title, html, source, updatedAt } to that URL.
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
    sampling: false,
    saveTimer: 0,
    undoStack: [],
    maxUndo: 40,
    lastSavedRootHtml: "",
    previousSavedRootHtml: "",
    commentDrag: null,
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
    state.lastSavedRootHtml = getRoot().innerHTML;
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
      "  position: relative;",
      "  outline: none !important;",
      "  outline-offset: 4px;",
      "  caret-color: #0b7285;",
      "  transition: outline-color 140ms ease, background-color 140ms ease;",
      "}",
      ".hx-editor-editable:focus,",
      ".hx-editor-editable:focus-visible {",
      "  outline: none !important;",
      "  box-shadow: none !important;",
      "}",
      "html.hx-editor-on .hx-editor-editable:hover {",
      "  outline-color: transparent;",
      "  background-color: transparent;",
      "}",
      "html.hx-editor-on .hx-editor-active {",
      "  outline-color: transparent;",
      "  background-color: transparent;",
      "}",
      "html.hx-editor-on mark[data-hx-highlight] {",
      "  border-radius: 0.22em;",
      "  box-decoration-break: clone;",
      "  -webkit-box-decoration-break: clone;",
      "  padding: 0.02em 0.12em;",
      "}",
      "html.hx-editor-on [data-hx-comment-anchor] {",
      "  border-bottom: 2px solid rgba(21, 170, 191, 0.72);",
      "  box-shadow: inset 0 -0.38em rgba(21, 170, 191, 0.1);",
      "  cursor: pointer;",
      "}",
      "[data-hx-comment-box] {",
      "  position: absolute;",
      "  z-index: 2147483000;",
      "  min-width: 180px;",
      "  max-width: min(320px, calc(100vw - 32px));",
      "  min-height: 28px;",
      "  padding: 4px 6px;",
      "  color: #0b7285;",
      "  background: transparent;",
      "  border: 1px solid transparent;",
      "  border-radius: 3px;",
      "  font: 16px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
      "  letter-spacing: 0;",
      "  white-space: pre-wrap;",
      "  overflow-wrap: anywhere;",
      "  outline: none;",
      "}",
      "html.hx-editor-on [data-hx-comment-box] {",
      "  cursor: text;",
      "}",
      "html.hx-editor-on [data-hx-comment-box]:hover,",
      "html.hx-editor-on [data-hx-comment-box]:focus {",
      "  border-color: rgba(21, 170, 191, 0.45);",
      "  background: rgba(246, 247, 244, 0.82);",
      "}",
      "html.hx-editor-on [data-hx-comment-box].hx-comment-dragging {",
      "  cursor: move;",
      "  user-select: none;",
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
      ".note-panel {",
      "  position: fixed;",
      "  z-index: 2147483647;",
      "  width: min(340px, calc(100vw - 28px));",
      "  padding: 14px 14px 12px 18px;",
      "  box-sizing: border-box;",
      "  border: 1px solid rgba(19, 32, 37, 0.14);",
      "  border-left: 3px solid #15aabf;",
      "  border-radius: 5px;",
      "  background: linear-gradient(#fffdf7, #fffdf7), repeating-linear-gradient(to bottom, transparent 0, transparent 27px, rgba(21, 170, 191, 0.08) 28px);",
      "  box-shadow: 0 16px 38px rgba(30, 30, 30, 0.12);",
      "}",
      ".note-panel[hidden] { display: none; }",
      ".panel-title-row {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  gap: 12px;",
      "}",
      ".panel-title {",
      "  margin: 0;",
      "  color: #0b7285;",
      "  font-size: 12px;",
      "  font-weight: 800;",
      "  letter-spacing: 0;",
      "  text-transform: uppercase;",
      "}",
      ".selection-preview {",
      "  margin: 10px 0 0;",
      "  color: rgba(30, 30, 30, 0.74);",
      "  font-size: 13px;",
      "  line-height: 1.35;",
      "}",
      ".highlight-list {",
      "  display: grid;",
      "  gap: 0;",
      "  max-height: min(420px, calc(100vh - 180px));",
      "  overflow: auto;",
      "  margin-top: 10px;",
      "}",
      ".highlight-row {",
      "  display: grid;",
      "  grid-template-columns: 12px minmax(0, 1fr) auto;",
      "  gap: 10px;",
      "  align-items: start;",
      "  padding: 10px 0;",
      "  border-top: 1px solid rgba(19, 32, 37, 0.1);",
      "}",
      ".highlight-dot {",
      "  width: 10px;",
      "  height: 10px;",
      "  margin-top: 4px;",
      "  border-radius: 3px;",
      "}",
      ".highlight-text {",
      "  margin: 0;",
      "  color: #1e1e1e;",
      "  font-size: 13px;",
      "  line-height: 1.35;",
      "}",
      ".highlight-comment {",
      "  margin: 4px 0 0;",
      "  color: #0b7285;",
      "  font-size: 12px;",
      "  line-height: 1.35;",
      "}",
      ".row-actions { display: flex; gap: 6px; }",
      ".row-actions button, .panel-icon-button {",
      "  width: 28px;",
      "  height: 28px;",
      "  display: grid;",
      "  place-items: center;",
      "  border: 1px solid rgba(30, 30, 30, 0.12);",
      "  border-radius: 999px;",
      "  background: rgba(255, 255, 255, 0.82);",
      "  color: #1e1e1e;",
      "  cursor: pointer;",
      "}",
      ".row-actions svg, .panel-icon-button svg { width: 15px; height: 15px; }",
      ".empty-state {",
      "  margin: 12px 0 0;",
      "  color: rgba(30, 30, 30, 0.64);",
      "  font-size: 13px;",
      "}",
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
      buttonHtml("comment", "Comment", iconComment()),
      buttonHtml("annotations", "Annotations", iconList()),
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
      buttonHtml("undo", "Undo last change", iconUndo()),
      buttonHtml("save", "Save", iconSave()),
      "    <div class='status' data-status title='Off'></div>",
      "  </div>",
      "</div>",
      "<div class='highlights-panel note-panel' data-highlights-panel hidden>",
      "  <div class='panel-title-row'>",
      "    <p class='panel-title'>Annotations</p>",
      "    <div class='row-actions'>",
      "    <button type='button' data-highlights-clear title='Remove all annotations' aria-label='Remove all annotations'>",
      iconTrash(),
      "    </button>",
      "    <button class='panel-icon-button' type='button' data-highlights-close title='Close' aria-label='Close'>",
      iconCheck(),
      "    </button>",
      "    </div>",
      "  </div>",
      "  <div class='highlight-list' data-highlights-list></div>",
      "</div>",
    ].join("");

    toolbar.rail = shadow.querySelector(".rail");
    toolbar.status = shadow.querySelector("[data-status]");
    toolbar.highlightsPanel = shadow.querySelector("[data-highlights-panel]");
    toolbar.highlightsList = shadow.querySelector("[data-highlights-list]");
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

    shadow
      .querySelector("[data-highlights-close]")
      .addEventListener("click", closeHighlightsPanel);

    shadow
      .querySelector("[data-highlights-clear]")
      .addEventListener("click", removeAllAnnotations);
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

  function iconComment() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z'></path></svg>"
    );
  }

  function iconPipette() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='m12 9-8.4 8.4A2 2 0 0 0 3 18.8V20a1 1 0 0 0 1 1h1.2a2 2 0 0 0 1.4-.6L15 12'></path><path d='m18 9 .4.4a1 1 0 0 1 0 1.4l-2.6 2.6a1 1 0 0 1-1.4 0l-3.8-3.8a1 1 0 0 1 0-1.4l2.6-2.6a1 1 0 0 1 1.4 0l.4.4 3.4-3.4a1 1 0 1 1 3 3Z'></path></svg>"
    );
  }

  function iconList() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='M8 6h13'></path><path d='M8 12h13'></path><path d='M8 18h13'></path><path d='M3 6h.01'></path><path d='M3 12h.01'></path><path d='M3 18h.01'></path></svg>"
    );
  }

  function iconUndo() {
    return (
      "<svg" +
      iconAttrs() +
      "><path d='M3 7v6h6'></path><path d='M21 17a9 9 0 0 0-15-6.7L3 13'></path></svg>"
    );
  }

  function iconLocate() {
    return (
      "<svg" +
      iconAttrs() +
      "><circle cx='12' cy='12' r='3'></circle><path d='M12 2v3'></path><path d='M12 19v3'></path><path d='M2 12h3'></path><path d='M19 12h3'></path></svg>"
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

    if (tool === "undo") {
      undoLastChange();
      return;
    }

    if (!state.editing) {
      return;
    }

    if (tool === "annotations") {
      toggleHighlightsPanel();
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
    document.addEventListener("beforeinput", handleBeforeInput, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", repositionOverlays);
    window.addEventListener("scroll", repositionOverlays, true);
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

  function handleBeforeInput(event) {
    if (
      !state.editing ||
      (!findEditable(event.target) && !findCommentBox(event.target))
    ) {
      return;
    }

    pushUndoSnapshot();
  }

  function handleInput(event) {
    if (!state.editing) {
      return;
    }

    if (
      findEditable(event.target) ||
      findCommentBox(event.target) ||
      (event.target instanceof Element &&
        event.target.closest(
          "mark[data-hx-highlight], [data-hx-comment-anchor]"
        ))
    ) {
      syncAllCommentBoxesToAnchors();
      markDirty();
      renderHighlightsPanel();
    }
  }

  function handleMouseUp(event) {
    if (
      !state.editing ||
      (state.tool !== "highlight" && state.tool !== "comment") ||
      isToolbarEvent(event)
    ) {
      return;
    }

    var shouldComment = event.shiftKey;
    window.setTimeout(function () {
      if (state.tool === "comment") {
        applySelectionComment();
      } else {
        applySelectionHighlight(shouldComment);
      }
    }, 0);
  }

  function handlePointerDown(event) {
    if (!state.editing || isToolbarEvent(event)) {
      return;
    }

    var box = findCommentBox(event.target);
    if (!box || event.button !== 0) {
      return;
    }

    var startLeft = parseFloat(box.style.left || "0");
    var startTop = parseFloat(box.style.top || "0");
    state.commentDrag = {
      box: box,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: startLeft,
      startTop: startTop,
      moved: false,
      snapshotTaken: false,
    };

    window.addEventListener("pointermove", handleCommentDragMove, true);
    window.addEventListener("pointerup", handleCommentDragEnd, true);
  }

  function handleCommentDragMove(event) {
    var drag = state.commentDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) {
      return;
    }

    if (!drag.snapshotTaken) {
      pushUndoSnapshot();
      drag.snapshotTaken = true;
    }

    drag.moved = true;
    drag.box.classList.add("hx-comment-dragging");
    drag.box.style.left = Math.max(0, drag.startLeft + dx) + "px";
    drag.box.style.top = Math.max(0, drag.startTop + dy) + "px";
    event.preventDefault();
  }

  function handleCommentDragEnd(event) {
    var drag = state.commentDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    window.removeEventListener("pointermove", handleCommentDragMove, true);
    window.removeEventListener("pointerup", handleCommentDragEnd, true);
    drag.box.classList.remove("hx-comment-dragging");

    if (drag.moved) {
      markDirty();
    }

    state.commentDrag = null;
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

    var annotation =
      event.target.closest &&
      event.target.closest("mark[data-hx-highlight], [data-hx-comment-anchor]");
    if (annotation) {
      var annotationId = annotation.dataset.hxId;
      if (
        annotation.matches("[data-hx-comment-anchor]") ||
        state.tool === "comment" ||
        (annotationId && findCommentBoxById(annotationId))
      ) {
        openCommentPopover(annotation);
      }
      return;
    }

  }

  function handleKeydown(event) {
    var activeCommentBox = findCommentBox(document.activeElement);
    if (
      activeCommentBox &&
      event.key === "Backspace" &&
      !activeCommentBox.textContent.trim()
    ) {
      var annotation = findAnnotationById(activeCommentBox.dataset.hxId);
      if (annotation) {
        event.preventDefault();
        removeAnnotation(annotation);
        return;
      }
    }

    if (event.key === "Escape") {
      if (activeCommentBox) {
        activeCommentBox.blur();
      }
      closeCommentPopover();
      closeHighlightsPanel();
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
    closeHighlightsPanel();
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
    setCommentBoxesEditable(true);
  }

  function disableEditable(element) {
    element.classList.remove("hx-editor-editable", "hx-editor-active");
    restoreAttribute(element, "contenteditable", element.dataset.hxPrevContenteditable);
    restoreAttribute(element, "spellcheck", element.dataset.hxPrevSpellcheck);
    delete element.dataset.hxPrevContenteditable;
    delete element.dataset.hxPrevSpellcheck;
    setCommentBoxesEditable(false);
  }

  function setCommentBoxesEditable(enabled) {
    Array.prototype.forEach.call(
      getRoot().querySelectorAll("[data-hx-comment-box]"),
      function (box) {
        if (enabled) {
          box.setAttribute("contenteditable", "true");
          box.setAttribute("spellcheck", "true");
        } else {
          box.removeAttribute("contenteditable");
          box.removeAttribute("spellcheck");
        }
      }
    );
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
    mark.dataset.hxId = createHighlightId();
    mark.style.background = color.pale;
    mark.style.color = "inherit";

    try {
      pushUndoSnapshot();
      var fragment = range.extractContents();
      mark.appendChild(fragment);
      range.insertNode(mark);
      selection.removeAllRanges();
      markDirty();
      renderHighlightsPanel();

      if (shouldComment) {
        createOrFocusCommentBox(mark);
      }
    } catch (error) {
      document.execCommand("HiliteColor", false, color.pale);
      selection.removeAllRanges();
      markDirty();
      renderHighlightsPanel();
    }
  }

  function applySelectionComment() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    var range = selection.getRangeAt(0);
    if (!getRoot().contains(range.commonAncestorContainer)) {
      return;
    }

    var anchor = document.createElement("span");
    anchor.dataset.hxCommentAnchor = "";
    anchor.dataset.hxId = createHighlightId();
    anchor.dataset.hxComment = "";

    try {
      pushUndoSnapshot();
      var fragment = range.extractContents();
      anchor.appendChild(fragment);
      range.insertNode(anchor);
      selection.removeAllRanges();
      createOrFocusCommentBox(anchor);
      markDirty();
      renderHighlightsPanel();
    } catch (error) {}
  }

  function openCommentPopover(annotation) {
    createOrFocusCommentBox(annotation);
  }

  function closeCommentPopover() {
  }

  function createOrFocusCommentBox(annotation) {
    var id = ensureAnnotationId(annotation);
    var box = findCommentBoxById(id);
    if (!box) {
      pushUndoSnapshot();
      box = document.createElement("div");
      box.dataset.hxCommentBox = "";
      box.dataset.hxId = id;
      box.setAttribute("contenteditable", "true");
      box.setAttribute("spellcheck", "true");
      box.textContent = annotation.dataset.hxComment || "";
      positionNewCommentBox(box, annotation);
      getRoot().appendChild(box);
    }

    annotation.dataset.hxComment = box.textContent;
    closeHighlightsPanel();
    window.setTimeout(function () {
      box.focus({ preventScroll: true });
      placeCaretAtEnd(box);
    }, 0);
    markDirty();
    renderHighlightsPanel();
  }

  function positionNewCommentBox(box, annotation) {
    var rootRect = getRoot().getBoundingClientRect();
    var rect = annotation.getBoundingClientRect();
    var left = rect.right - rootRect.left + 14;
    var top = rect.top - rootRect.top - 4;

    if (left + 320 > rootRect.width) {
      left = Math.max(0, rect.left - rootRect.left);
      top = rect.bottom - rootRect.top + 10;
    }

    box.style.left = Math.max(0, left) + "px";
    box.style.top = Math.max(0, top) + "px";
  }

  function findCommentBox(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest("[data-hx-comment-box]");
  }

  function findCommentBoxById(id) {
    return getRoot().querySelector(
      "[data-hx-comment-box][data-hx-id='" + cssEscape(id) + "']"
    );
  }

  function syncCommentBoxToAnchor(box) {
    var annotation = findAnnotationById(box.dataset.hxId);
    if (!annotation) {
      return;
    }

    annotation.dataset.hxComment = box.textContent;
  }

  function syncAllCommentBoxesToAnchors() {
    Array.prototype.forEach.call(
      getRoot().querySelectorAll("[data-hx-comment-box]"),
      syncCommentBoxToAnchor
    );
  }

  function placeCaretAtEnd(element) {
    var range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function toggleHighlightsPanel() {
    if (toolbar.highlightsPanel.hidden) {
      openHighlightsPanel();
    } else {
      closeHighlightsPanel();
    }
  }

  function openHighlightsPanel() {
    closeCommentPopover();
    renderHighlightsPanel();
    toolbar.highlightsPanel.hidden = false;
    positionHighlightsPanel();
    updateToolbar();
  }

  function closeHighlightsPanel() {
    if (!toolbar.highlightsPanel) {
      return;
    }

    toolbar.highlightsPanel.hidden = true;
    updateToolbar();
  }

  function positionHighlightsPanel() {
    if (!toolbar.highlightsPanel || toolbar.highlightsPanel.hidden) {
      return;
    }

    var width = Math.min(340, window.innerWidth - 28);
    var left = Math.max(14, window.innerWidth - width - 36);
    var top = Math.max(14, Math.min(96, window.innerHeight - 140));
    toolbar.highlightsPanel.style.left = left + "px";
    toolbar.highlightsPanel.style.top = top + "px";
  }

  function renderHighlightsPanel() {
    if (!toolbar.highlightsList) {
      return;
    }

    var annotations = getAnnotations();
    if (!annotations.length) {
      toolbar.highlightsList.innerHTML =
        "<p class='empty-state'>No annotations in this document.</p>";
      return;
    }

    toolbar.highlightsList.innerHTML = annotations
      .map(function (annotation) {
        var id = ensureAnnotationId(annotation);
        var color = getAnnotationColor(annotation);
        var comment = annotation.dataset.hxComment || "";
        var typeLabel = annotation.matches("[data-hx-comment-anchor]")
          ? "Comment"
          : "Highlight";
        return (
          "<div class='highlight-row' data-highlight-id='" +
          escapeHtml(id) +
          "'>" +
          "<span class='highlight-dot' style='background:" +
          escapeHtml(color.solid) +
          "'></span>" +
          "<div>" +
          "<p class='highlight-text'>" +
          escapeHtml(typeLabel + ": " + trimSnippet(annotation.textContent, 84)) +
          "</p>" +
          (comment
            ? "<p class='highlight-comment'>" +
              escapeHtml(trimSnippet(comment, 96)) +
              "</p>"
            : "") +
          "</div>" +
          "<div class='row-actions'>" +
          "<button type='button' data-highlight-focus title='Find highlight' aria-label='Find highlight'>" +
          iconLocate() +
          "</button>" +
          "<button type='button' data-highlight-comment title='Comment' aria-label='Comment'>" +
          iconPen() +
          "</button>" +
          "<button type='button' data-highlight-delete title='Remove highlight' aria-label='Remove highlight'>" +
          iconTrash() +
          "</button>" +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    Array.prototype.forEach.call(
      toolbar.highlightsList.querySelectorAll("[data-highlight-focus]"),
      function (button) {
        button.addEventListener("click", function () {
          var annotation = findAnnotationById(button.closest("[data-highlight-id]").dataset.highlightId);
          if (annotation) {
            focusAnnotation(annotation);
          }
        });
      }
    );

    Array.prototype.forEach.call(
      toolbar.highlightsList.querySelectorAll("[data-highlight-comment]"),
      function (button) {
        button.addEventListener("click", function () {
          var annotation = findAnnotationById(button.closest("[data-highlight-id]").dataset.highlightId);
          if (annotation) {
            openCommentPopover(annotation);
          }
        });
      }
    );

    Array.prototype.forEach.call(
      toolbar.highlightsList.querySelectorAll("[data-highlight-delete]"),
      function (button) {
        button.addEventListener("click", function () {
          var annotation = findAnnotationById(button.closest("[data-highlight-id]").dataset.highlightId);
          if (annotation) {
            removeAnnotation(annotation);
          }
        });
      }
    );
  }

  function getHighlights() {
    return Array.prototype.slice.call(
      getRoot().querySelectorAll("mark[data-hx-highlight]")
    );
  }

  function getAnnotations() {
    return Array.prototype.slice.call(
      getRoot().querySelectorAll(
        "mark[data-hx-highlight], [data-hx-comment-anchor]"
      )
    );
  }

  function ensureAnnotationId(annotation) {
    if (!annotation.dataset.hxId) {
      annotation.dataset.hxId = createHighlightId();
    }

    return annotation.dataset.hxId;
  }

  function createHighlightId() {
    return (
      "hx-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function findAnnotationById(id) {
    return getRoot().querySelector(
      "mark[data-hx-highlight][data-hx-id='" +
        cssEscape(id) +
        "'], [data-hx-comment-anchor][data-hx-id='" +
        cssEscape(id) +
        "']"
    );
  }

  function focusAnnotation(annotation) {
    annotation.scrollIntoView({ block: "center", behavior: "smooth" });
    openCommentPopover(annotation);
  }

  function removeAnnotation(annotation) {
    pushUndoSnapshot();
    var box = findCommentBoxById(annotation.dataset.hxId);
    if (box) {
      box.remove();
    }

    var parent = annotation.parentNode;
    while (annotation.firstChild) {
      parent.insertBefore(annotation.firstChild, annotation);
    }
    parent.removeChild(annotation);
    parent.normalize();
    closeCommentPopover();
    markDirty();
    renderHighlightsPanel();
  }

  function removeAllAnnotations() {
    var annotations = getAnnotations();
    if (!annotations.length) {
      return;
    }

    pushUndoSnapshot();
    annotations.forEach(function (annotation) {
      var box = findCommentBoxById(annotation.dataset.hxId);
      if (box) {
        box.remove();
      }

      var parent = annotation.parentNode;
      while (annotation.firstChild) {
        parent.insertBefore(annotation.firstChild, annotation);
      }
      parent.removeChild(annotation);
      parent.normalize();
    });

    closeCommentPopover();
    markDirty();
    renderHighlightsPanel();
  }

  function getAnnotationColor(annotation) {
    if (annotation.matches("[data-hx-comment-anchor]")) {
      return { solid: "#15aabf" };
    }

    var name = annotation.dataset.hxHighlight;
    return (
      colors.find(function (color) {
        return color.name === name;
      }) || { solid: annotation.style.background || "#15aabf" }
    );
  }

  function trimSnippet(value, length) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= length) {
      return text;
    }

    return text.slice(0, Math.max(0, length - 1)).trim() + "…";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) {
      return window.CSS.escape(value);
    }

    return String(value).replace(/'/g, "\\'");
  }

  function repositionOverlays() {
    positionHighlightsPanel();
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

  function pushUndoSnapshot() {
    var root = getRoot();
    if (!(root instanceof HTMLElement)) {
      return;
    }

    var html = root.innerHTML;
    if (state.undoStack[state.undoStack.length - 1] === html) {
      return;
    }

    state.undoStack.push(html);
    if (state.undoStack.length > state.maxUndo) {
      state.undoStack.shift();
    }

    updateToolbar();
  }

  function undoLastChange() {
    var root = getRoot();
    var previous = state.undoStack.pop();

    if (previous === undefined && state.previousSavedRootHtml) {
      previous = state.previousSavedRootHtml;
      state.previousSavedRootHtml = "";
    }

    if (previous === undefined || !(root instanceof HTMLElement)) {
      return;
    }

    root.innerHTML = previous;
    closeCommentPopover();
    renderHighlightsPanel();
    markDirty();
  }

  function markDirty() {
    state.dirty = true;
    updateToolbar();
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveDraft, 450);
  }

  function saveDraft(html) {
    try {
      var nextHtml = html || serializeDocument();
      var draftKey = options.storageKey + ":draft";
      var previousDraft = localStorage.getItem(draftKey);
      if (previousDraft && previousDraft !== nextHtml) {
        localStorage.setItem(options.storageKey + ":previous-draft", previousDraft);
      }
      localStorage.setItem(draftKey, nextHtml);
    } catch (error) {}
  }

  function saveNow() {
    var html = serializeDocument();
    var savedRootHtml = getRoot().innerHTML;
    var previousSavedRootHtml = state.lastSavedRootHtml;
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
      : Promise.resolve(saveDraft(html));

    return savePromise
      .then(function () {
        if (previousSavedRootHtml !== savedRootHtml) {
          state.previousSavedRootHtml = previousSavedRootHtml;
        }
        state.lastSavedRootHtml = savedRootHtml;
        state.dirty = false;
        updateToolbar();
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

    Array.prototype.forEach.call(
      clone.querySelectorAll("[data-hx-comment-box]"),
      function (box) {
        box.removeAttribute("contenteditable");
        box.removeAttribute("spellcheck");
        box.classList.remove("hx-comment-dragging");
        if (!box.getAttribute("class")) {
          box.removeAttribute("class");
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
        (tool === "sample" && state.sampling) ||
        (tool === "annotations" &&
          toolbar.highlightsPanel &&
          !toolbar.highlightsPanel.hidden);
      button.setAttribute("aria-pressed", String(pressed));

      if (tool !== "edit" && tool !== "save") {
        button.disabled = !state.editing;
      }

      if (tool === "undo") {
        button.disabled =
          !state.editing ||
          !state.undoStack.length &&
          !state.previousSavedRootHtml;
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
    document.removeEventListener("beforeinput", handleBeforeInput, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("mouseup", handleMouseUp, true);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("click", handleDocumentClick, true);
    document.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("pointermove", handleCommentDragMove, true);
    window.removeEventListener("pointerup", handleCommentDragEnd, true);
    window.removeEventListener("resize", repositionOverlays);
    window.removeEventListener("scroll", repositionOverlays, true);

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
    undo: undoLastChange,
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
