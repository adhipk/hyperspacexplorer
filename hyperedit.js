// @ts-check

/*
  HyperEdit

  Include in any HTML page:
  <script src="/hyperedit.js" data-save-url="/your-save-endpoint"></script>

  The optional data-save-url hook is backend-agnostic. When it is present, the
  Save button POSTs { pathname, title, html, source, updatedAt } to that URL.
*/

/**
 * @typedef {"select" | "highlight" | "comment"} ActiveTool
 */

/**
 * @typedef {"edit" | "save" | "undo" | "annotations" | "sample" | ActiveTool} ToolbarTool
 */

/**
 * @typedef {Object} EditorOptions
 * @property {string} rootSelector
 * @property {boolean} autoStart
 * @property {string} saveUrl
 * @property {string} storageKey
 */

/**
 * @typedef {Object} EditorColor
 * @property {string} name
 * @property {string} solid
 * @property {string} pale
 */

/**
 * @typedef {Object} CommentDrag
 * @property {HTMLElement} box
 * @property {number} pointerId
 * @property {number} startX
 * @property {number} startY
 * @property {number} startLeft
 * @property {number} startTop
 * @property {boolean} moved
 * @property {boolean} snapshotTaken
 */

/**
 * @typedef {Object} EditorState
 * @property {boolean} editing
 * @property {ActiveTool} tool
 * @property {number} colorIndex
 * @property {boolean} dirty
 * @property {HTMLElement[]} editables
 * @property {HTMLElement | null} activeElement
 * @property {boolean} sampling
 * @property {number} saveTimer
 * @property {string[]} undoStack
 * @property {number} maxUndo
 * @property {string} lastSavedRootHtml
 * @property {string} previousSavedRootHtml
 * @property {CommentDrag | null} commentDrag
 */

/**
 * @typedef {Object} ToolbarRefs
 * @property {HTMLElement | null} rail
 * @property {HTMLElement | null} status
 * @property {HTMLElement | null} highlightsPanel
 * @property {HTMLElement | null} highlightsList
 * @property {HTMLButtonElement[]} buttons
 * @property {HTMLButtonElement[]} swatches
 */

/**
 * @typedef {Object} SavePayload
 * @property {string} pathname
 * @property {string} title
 * @property {string} html
 * @property {"hyperedit"} source
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} HyperEditApi
 * @property {() => void} destroy
 * @property {() => void} enable
 * @property {() => void} disable
 * @property {() => Promise<boolean>} save
 * @property {() => void} undo
 * @property {() => string} serialize
 * @property {() => void} refresh
 * @property {(nextOptions?: Partial<EditorOptions>) => void} configure
 */

/**
 * @typedef {Object} EyeDropperResult
 * @property {string} sRGBHex
 */

/**
 * @typedef {Object} EyeDropperInstance
 * @property {() => Promise<EyeDropperResult>} open
 */

/**
 * @typedef {new () => EyeDropperInstance} EyeDropperConstructor
 */

/**
 * @typedef {Window & typeof globalThis & {
 *   HyperEdit?: HyperEditApi,
 *   EyeDropper?: EyeDropperConstructor
 * }} EditorWindow
 */

/**
 * @typedef {Object} CssRgbColor
 * @property {number} red
 * @property {number} green
 * @property {number} blue
 * @property {number} alpha
 */
(function () {
  "use strict";

  /** @type {EditorWindow} */
  var editorWindow = window;

  if (editorWindow.HyperEdit) {
    return;
  }

  /** @type {HTMLScriptElement | null} */
  var script =
    document.currentScript instanceof HTMLScriptElement
      ? document.currentScript
      : null;
  /** @type {EditorOptions} */
  var options = {
    rootSelector: (script && script.dataset.root) || "body",
    autoStart: !!(script && script.dataset.autostart === "true"),
    saveUrl: (script && script.dataset.saveUrl) || "",
    storageKey:
      (script && script.dataset.storageKey) ||
      "hyperedit:" + location.origin + location.pathname,
  };

  /** @type {EditorColor[]} */
  var colors = [
    { name: "red", solid: "#e03131", pale: "rgba(224, 49, 49, 0.13)" },
    { name: "blue", solid: "#228be6", pale: "rgba(34, 139, 230, 0.13)" },
    { name: "ink", solid: "#1e1e1e", pale: "rgba(30, 30, 30, 0.1)" },
  ];

  /** @type {EditorState} */
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

  /** @type {HTMLElement | null} */
  var host = null;
  /** @type {ShadowRoot | null} */
  var shadow = null;
  /** @type {ToolbarRefs} */
  var toolbar = {
    rail: null,
    status: null,
    highlightsPanel: null,
    highlightsList: null,
    buttons: [],
    swatches: [],
  };
  /** @type {HTMLStyleElement | null} */
  var globalStyle = null;
  /** @type {MutationObserver | null} */
  var observer = null;
  var highlightSelector = "mark[data-hx-highlight]";
  var commentAnchorSelector = "[data-hx-comment-anchor]";
  var annotationSelector = highlightSelector + ", " + commentAnchorSelector;
  var commentBoxSelector = "[data-hx-comment-box]";
  var editorRuntimeSelector = "[data-hx-editor-ui], #hyperedit-page-style";
  var editableTargetSelector =
    "p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption, pre";
  var editableClass = "hx-editor-editable";
  var activeClass = "hx-editor-active";
  var commentDraggingClass = "hx-comment-dragging";
  var editableCloneSelector = "." + editableClass;
  var panelRowSelector = "[data-highlight-id]";
  var panelFocusAttribute = "data-highlight-focus";
  var panelCommentAttribute = "data-highlight-comment";
  var panelDeleteAttribute = "data-highlight-delete";
  var panelFocusSelector = "[" + panelFocusAttribute + "]";
  var panelCommentSelector = "[" + panelCommentAttribute + "]";
  var panelDeleteSelector = "[" + panelDeleteAttribute + "]";

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
    var existingStyle = document.getElementById("hyperedit-page-style");
    if (existingStyle instanceof HTMLStyleElement) {
      globalStyle = existingStyle;
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
        var tool = button.dataset.tool;
        if (isToolbarTool(tool)) {
          handleTool(tool);
        }
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

  /**
   * @param {ToolbarTool} tool
   * @param {string} label
   * @param {string} icon
   */
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

  /**
   * @param {string | undefined} tool
   * @returns {tool is ToolbarTool}
   */
  function isToolbarTool(tool) {
    return (
      tool === "edit" ||
      tool === "save" ||
      tool === "undo" ||
      tool === "annotations" ||
      tool === "sample" ||
      tool === "select" ||
      tool === "highlight" ||
      tool === "comment"
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

  /**
   * @param {ToolbarTool} tool
   */
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

    if (tool === "select" || tool === "highlight" || tool === "comment") {
      state.tool = tool;
    }
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

  /**
   * @param {MouseEvent} event
   */
  function handleDoubleClick(event) {
    if (!state.editing || isToolbarEvent(event)) {
      return;
    }

    var editable = findEditableTarget(event.target);
    if (!editable) {
      return;
    }

    state.tool = "select";
    focusEditable(editable);
    updateToolbar();
  }

  /**
   * @param {FocusEvent} event
   */
  function handleFocusIn(event) {
    var editable = findEditable(event.target);
    if (!editable) {
      return;
    }

    setActiveElement(editable);
  }

  /**
   * @param {FocusEvent} event
   */
  function handleFocusOut(event) {
    if (event.target === state.activeElement) {
      setActiveElement(null);
    }
  }

  /**
   * @param {InputEvent} event
   */
  function handleBeforeInput(event) {
    if (!shouldRecordInputHistory(event)) {
      return;
    }

    pushUndoSnapshot();
  }

  /**
   * @param {Event} event
   */
  function handleInput(event) {
    if (!shouldHandleEditableInput(event)) {
      return;
    }

    syncAllCommentBoxesToAnchors();
    markDirty();
    renderHighlightsPanel();
  }

  /**
   * @param {InputEvent} event
   */
  function shouldRecordInputHistory(event) {
    return state.editing && isUndoableInputTarget(event.target);
  }

  /**
   * @param {Event} event
   */
  function shouldHandleEditableInput(event) {
    return state.editing && isEditableInputTarget(event.target);
  }

  /**
   * @param {EventTarget | null} target
   */
  function isUndoableInputTarget(target) {
    return !!(findEditable(target) || findCommentBox(target));
  }

  /**
   * @param {EventTarget | null} target
   */
  function isEditableInputTarget(target) {
    return (
      isUndoableInputTarget(target) ||
      !!closestHTMLElement(target, annotationSelector)
    );
  }

  /**
   * @param {MouseEvent} event
   */
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

  /**
   * @param {PointerEvent} event
   */
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

  /**
   * @param {PointerEvent} event
   */
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

  /**
   * @param {PointerEvent} event
   */
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

  /**
   * @param {MouseEvent} event
   */
  function handleDocumentClick(event) {
    if (isToolbarEvent(event)) {
      return;
    }

    if (state.sampling) {
      event.preventDefault();
      event.stopPropagation();
      if (event.target instanceof Element) {
        sampleColor(event.target);
      }
      return;
    }

    if (!state.editing) {
      return;
    }

    var annotation = closestHTMLElement(event.target, annotationSelector);
    if (annotation) {
      var annotationId = annotation.dataset.hxId;
      if (
        isCommentAnchor(annotation) ||
        state.tool === "comment" ||
        (annotationId && findCommentBoxById(annotationId))
      ) {
        openCommentPopover(annotation);
      }
      return;
    }

  }

  /**
   * @param {KeyboardEvent} event
   */
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

  /**
   * @param {Event} event
   */
  function isToolbarEvent(event) {
    return event.composedPath && event.composedPath().indexOf(host) !== -1;
  }

  /**
   * @param {EventTarget | null} target
   * @param {string} selector
   * @returns {HTMLElement | null}
   */
  function closestHTMLElement(target, selector) {
    if (!(target instanceof Element)) {
      return null;
    }

    var element = target.closest(selector);
    return element instanceof HTMLElement ? element : null;
  }

  /**
   * @param {ParentNode} root
   * @param {string} selector
   * @returns {HTMLElement | null}
   */
  function queryHTMLElement(root, selector) {
    var element = root.querySelector(selector);
    return element instanceof HTMLElement ? element : null;
  }

  /**
   * @param {HTMLElement} element
   */
  function isCommentAnchor(element) {
    return element.matches(commentAnchorSelector);
  }

  /**
   * @param {string} id
   */
  function getCommentBoxSelectorById(id) {
    return commentBoxSelector + "[data-hx-id='" + cssEscape(id) + "']";
  }

  /**
   * @param {string} id
   */
  function getAnnotationSelectorById(id) {
    var escapedId = cssEscape(id);
    return (
      highlightSelector +
      "[data-hx-id='" +
      escapedId +
      "'], " +
      commentAnchorSelector +
      "[data-hx-id='" +
      escapedId +
      "']"
    );
  }

  /**
   * @param {HTMLElement} button
   * @returns {HTMLElement | null}
   */
  function findPanelRow(button) {
    return closestHTMLElement(button, panelRowSelector);
  }

  /**
   * @param {HTMLElement} button
   * @returns {HTMLElement | null}
   */
  function findPanelAnnotation(button) {
    var row = findPanelRow(button);
    return row ? findAnnotationById(row.dataset.highlightId) : null;
  }

  function refreshEditables() {
    state.editables =
      state.activeElement && getRoot().contains(state.activeElement)
        ? [state.activeElement]
        : [];

    if (state.editing) {
      state.editables.forEach(enableEditable);
    }
  }

  /**
   * @param {EventTarget | null} target
   * @returns {HTMLElement | null}
   */
  function findEditable(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    var editable = target.closest(editableCloneSelector);
    if (!(editable instanceof HTMLElement) || !getRoot().contains(editable)) {
      return null;
    }

    return editable;
  }

  /**
   * @param {EventTarget | null} target
   * @returns {HTMLElement | null}
   */
  function findEditableTarget(target) {
    if (!(target instanceof Element) || findCommentBox(target)) {
      return null;
    }

    var editable = target.closest(editableTargetSelector);
    if (!(editable instanceof HTMLElement) || !getRoot().contains(editable)) {
      return null;
    }

    if (editable.closest("[data-hx-ignore]")) {
      return null;
    }

    return editable;
  }

  /**
   * @param {boolean} nextEditing
   */
  function setEditing(nextEditing) {
    state.editing = !!nextEditing;
    state.tool = state.editing ? "select" : "select";
    closeCommentPopover();
    closeHighlightsPanel();
    stopSampling();
    document.documentElement.classList.toggle("hx-editor-on", state.editing);

    if (state.editing) {
      refreshEditables();
      setCommentBoxesEditable(true);
    } else {
      cleanupEditorState();
      setActiveElement(null);
      state.editables = [];
      setCommentBoxesEditable(false);
    }

    updateToolbar();
  }

  function cleanupEditorState() {
    state.editables.forEach(disableEditable);
  }

  /**
   * @param {HTMLElement} element
   */
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

  /**
   * @param {HTMLElement} element
   */
  function disableEditable(element) {
    element.classList.remove("hx-editor-editable", "hx-editor-active");
    restoreAttribute(element, "contenteditable", element.dataset.hxPrevContenteditable);
    restoreAttribute(element, "spellcheck", element.dataset.hxPrevSpellcheck);
    delete element.dataset.hxPrevContenteditable;
    delete element.dataset.hxPrevSpellcheck;
  }

  /**
   * @param {boolean} enabled
   */
  function setCommentBoxesEditable(enabled) {
    Array.prototype.forEach.call(
      getRoot().querySelectorAll(commentBoxSelector),
      function (/** @type {Element} */ box) {
        if (!(box instanceof HTMLElement)) {
          return;
        }

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

  /**
   * @param {HTMLElement} element
   * @param {string} attribute
   * @param {string | undefined} value
   */
  function restoreAttribute(element, attribute, value) {
    if (value === undefined || value === "__missing__") {
      element.removeAttribute(attribute);
      return;
    }

    element.setAttribute(attribute, value);
  }

  /**
   * @param {HTMLElement} element
   */
  function focusEditable(element) {
    state.editables.forEach(function (editable) {
      if (editable !== element) {
        disableEditable(editable);
      }
    });

    enableEditable(element);
    state.editables = [element];
    element.focus({ preventScroll: true });
    setActiveElement(element);
  }

  /**
   * @param {HTMLElement | null} element
   */
  function setActiveElement(element) {
    if (state.activeElement) {
      state.activeElement.classList.remove("hx-editor-active");
    }

    state.activeElement = element;

    if (state.activeElement) {
      state.activeElement.classList.add("hx-editor-active");
    }
  }

  /**
   * @param {boolean} shouldComment
   */
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

  /**
   * @param {HTMLElement} annotation
   */
  function openCommentPopover(annotation) {
    createOrFocusCommentBox(annotation);
  }

  function closeCommentPopover() {
  }

  /**
   * @param {HTMLElement} annotation
   */
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

  /**
   * @param {HTMLElement} box
   * @param {HTMLElement} annotation
   */
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

  /**
   * @param {EventTarget | null} target
   * @returns {HTMLElement | null}
   */
  function findCommentBox(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return closestHTMLElement(target, commentBoxSelector);
  }

  /**
   * @param {string} id
   * @returns {HTMLElement | null}
   */
  function findCommentBoxById(id) {
    return queryHTMLElement(getRoot(), getCommentBoxSelectorById(id));
  }

  /**
   * @param {Element} box
   */
  function syncCommentBoxToAnchor(box) {
    if (!(box instanceof HTMLElement)) {
      return;
    }

    var annotation = findAnnotationById(box.dataset.hxId);
    if (!annotation) {
      return;
    }

    annotation.dataset.hxComment = box.textContent;
  }

  function syncAllCommentBoxesToAnchors() {
    Array.prototype.forEach.call(
      getRoot().querySelectorAll(commentBoxSelector),
      syncCommentBoxToAnchor
    );
  }

  /**
   * @param {HTMLElement} element
   */
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
      renderEmptyHighlightsPanel(toolbar.highlightsList);
      return;
    }

    renderAnnotationRows(toolbar.highlightsList, annotations);
    bindAnnotationPanelActions(toolbar.highlightsList);
  }

  /**
   * @param {HTMLElement} list
   */
  function renderEmptyHighlightsPanel(list) {
    list.innerHTML = "<p class='empty-state'>No annotations in this document.</p>";
  }

  /**
   * @param {HTMLElement} list
   * @param {HTMLElement[]} annotations
   */
  function renderAnnotationRows(list, annotations) {
    list.innerHTML = annotations.map(renderAnnotationRow).join("");
  }

  /**
   * @param {HTMLElement} annotation
   */
  function renderAnnotationRow(annotation) {
    var id = ensureAnnotationId(annotation);
    var color = getAnnotationColor(annotation);
    var comment = annotation.dataset.hxComment || "";
    var typeLabel = isCommentAnchor(annotation) ? "Comment" : "Highlight";
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
      renderAnnotationComment(comment) +
      "</div>" +
      "<div class='row-actions'>" +
      renderPanelActionButton(
        panelFocusAttribute,
        "Find highlight",
        iconLocate()
      ) +
      renderPanelActionButton(panelCommentAttribute, "Comment", iconPen()) +
      renderPanelActionButton(
        panelDeleteAttribute,
        "Remove highlight",
        iconTrash()
      ) +
      "</div>" +
      "</div>"
    );
  }

  /**
   * @param {string} comment
   */
  function renderAnnotationComment(comment) {
    return comment
      ? "<p class='highlight-comment'>" +
          escapeHtml(trimSnippet(comment, 96)) +
          "</p>"
      : "";
  }

  /**
   * @param {string} attribute
   * @param {string} label
   * @param {string} icon
   */
  function renderPanelActionButton(attribute, label, icon) {
    return (
      "<button type='button' " +
      attribute +
      " title='" +
      label +
      "' aria-label='" +
      label +
      "'>" +
      icon +
      "</button>"
    );
  }

  /**
   * @param {HTMLElement} list
   */
  function bindAnnotationPanelActions(list) {
    bindAnnotationAction(list, panelFocusSelector, focusAnnotation);
    bindAnnotationAction(list, panelCommentSelector, openCommentPopover);
    bindAnnotationAction(list, panelDeleteSelector, removeAnnotation);
  }

  /**
   * @param {HTMLElement} list
   * @param {string} selector
   * @param {(annotation: HTMLElement) => void} action
   */
  function bindAnnotationAction(list, selector, action) {
    Array.prototype.forEach.call(
      list.querySelectorAll(selector),
      function (/** @type {Element} */ element) {
        if (!(element instanceof HTMLElement)) {
          return;
        }

        element.addEventListener("click", function () {
          var annotation = findPanelAnnotation(element);
          if (annotation) {
            action(annotation);
          }
        });
      }
    );
  }

  function getHighlights() {
    return Array.prototype.slice.call(
      getRoot().querySelectorAll(highlightSelector)
    );
  }

  function getAnnotations() {
    return Array.prototype.slice.call(
      getRoot().querySelectorAll(annotationSelector)
    );
  }

  /**
   * @param {HTMLElement} annotation
   */
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

  /**
   * @param {string} id
   * @returns {HTMLElement | null}
   */
  function findAnnotationById(id) {
    return queryHTMLElement(getRoot(), getAnnotationSelectorById(id));
  }

  /**
   * @param {HTMLElement} annotation
   */
  function focusAnnotation(annotation) {
    annotation.scrollIntoView({ block: "center", behavior: "smooth" });
    openCommentPopover(annotation);
  }

  /**
   * @param {HTMLElement} annotation
   */
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
    annotations.forEach(function (/** @type {HTMLElement} */ annotation) {
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

  /**
   * @param {HTMLElement} annotation
   * @returns {{ solid: string, pale?: string }}
   */
  function getAnnotationColor(annotation) {
    if (isCommentAnchor(annotation)) {
      return { solid: "#15aabf" };
    }

    var name = annotation.dataset.hxHighlight;
    return (
      colors.find(function (color) {
        return color.name === name;
      }) || { solid: annotation.style.background || "#15aabf" }
    );
  }

  /**
   * @param {unknown} value
   * @param {number} length
   */
  function trimSnippet(value, length) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= length) {
      return text;
    }

    return text.slice(0, Math.max(0, length - 1)).trim() + "…";
  }

  /**
   * @param {unknown} value
   */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * @param {string} value
   */
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
    if (editorWindow.EyeDropper) {
      var eyeDropper = new editorWindow.EyeDropper();
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

  /**
   * @param {Element} target
   */
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

  /**
   * @param {string} hex
   */
  function setSampledColor(hex) {
    colors[state.colorIndex] = {
      name: "sampled",
      solid: hex,
      pale: hexToRgba(hex, 0.13),
    };

    copyText(hex);
    updateToolbar();
  }

  /**
   * @param {string} value
   */
  function rgbaToHex(value) {
    var color = parseCssRgbColor(value);
    if (!color) {
      return "";
    }

    return "#" + [color.red, color.green, color.blue].map(toHexByte).join("");
  }

  /**
   * @param {string} hex
   * @param {number} alpha
   */
  function hexToRgba(hex, alpha) {
    var normalized = normalizeHexBody(hex);

    var red = parseInt(normalized.slice(0, 2), 16);
    var green = parseInt(normalized.slice(2, 4), 16);
    var blue = parseInt(normalized.slice(4, 6), 16);
    return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
  }

  /**
   * @param {string} value
   * @returns {CssRgbColor | null}
   */
  function parseCssRgbColor(value) {
    var match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) {
      return null;
    }

    var parts = match[1].split(",").map(function (part) {
      return part.trim();
    });
    var alpha = parts[3] === undefined ? 1 : Number(parts[3]);
    if (alpha === 0) {
      return null;
    }

    return {
      red: clampColorChannel(parts[0]),
      green: clampColorChannel(parts[1]),
      blue: clampColorChannel(parts[2]),
      alpha: alpha,
    };
  }

  /**
   * @param {string | undefined} value
   */
  function clampColorChannel(value) {
    return Math.max(0, Math.min(255, parseInt(String(value), 10)));
  }

  /**
   * @param {number} value
   */
  function toHexByte(value) {
    return value.toString(16).padStart(2, "0");
  }

  /**
   * @param {string} hex
   */
  function normalizeHexBody(hex) {
    var normalized = String(hex).replace("#", "");
    if (normalized.length === 3) {
      return normalized
        .split("")
        .map(function (part) {
          return part + part;
        })
        .join("");
    }

    return normalized;
  }

  /**
   * @param {string} text
   */
  function copyText(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    navigator.clipboard.writeText(text).catch(function () {});
  }

  function pushUndoSnapshot() {
    var html = captureRootHtmlSnapshot();
    if (html === null || isDuplicateUndoSnapshot(html)) {
      return;
    }

    pushUndoEntry(html);
    updateToolbar();
  }

  function undoLastChange() {
    var previous = popUndoEntry();

    if (previous === undefined || !restoreRootHtmlSnapshot(previous)) {
      return;
    }

    closeCommentPopover();
    renderHighlightsPanel();
    markDirty();
  }

  /**
   * @returns {string | null}
   */
  function captureRootHtmlSnapshot() {
    var root = getRoot();
    return root instanceof HTMLElement ? root.innerHTML : null;
  }

  /**
   * @param {string} html
   */
  function isDuplicateUndoSnapshot(html) {
    return state.undoStack[state.undoStack.length - 1] === html;
  }

  /**
   * @param {string} html
   */
  function pushUndoEntry(html) {
    state.undoStack.push(html);
    trimUndoStack();
  }

  function trimUndoStack() {
    if (state.undoStack.length > state.maxUndo) {
      state.undoStack.shift();
    }
  }

  function popUndoEntry() {
    var previous = state.undoStack.pop();
    if (previous !== undefined) {
      return previous;
    }

    return consumePreviousSavedRootHtml();
  }

  function consumePreviousSavedRootHtml() {
    if (!state.previousSavedRootHtml) {
      return undefined;
    }

    var html = state.previousSavedRootHtml;
    state.previousSavedRootHtml = "";
    return html;
  }

  /**
   * @param {string} html
   */
  function restoreRootHtmlSnapshot(html) {
    var root = getRoot();
    if (!(root instanceof HTMLElement)) {
      return false;
    }

    root.innerHTML = html;
    return true;
  }

  function hasUndoHistory() {
    return state.undoStack.length > 0 || !!state.previousSavedRootHtml;
  }

  function markDirty() {
    state.dirty = true;
    updateToolbar();
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveDraft, 450);
  }

  /**
   * @param {string=} html
   */
  function saveDraft(html) {
    persistLocalDraft(html || serializeDocument());
  }

  /**
   * @param {string} nextHtml
   */
  function persistLocalDraft(nextHtml) {
    try {
      var draftKey = getDraftStorageKey();
      rememberPreviousDraft(draftKey, nextHtml);
      localStorage.setItem(draftKey, nextHtml);
    } catch (error) {}
  }

  function getDraftStorageKey() {
    return options.storageKey + ":draft";
  }

  function getPreviousDraftStorageKey() {
    return options.storageKey + ":previous-draft";
  }

  /**
   * @param {string} draftKey
   * @param {string} nextHtml
   */
  function rememberPreviousDraft(draftKey, nextHtml) {
    var previousDraft = localStorage.getItem(draftKey);
    if (previousDraft && previousDraft !== nextHtml) {
      localStorage.setItem(getPreviousDraftStorageKey(), previousDraft);
    }
  }

  function saveNow() {
    var html = serializeDocument();
    var savedRootHtml = getRoot().innerHTML;
    var previousSavedRootHtml = state.lastSavedRootHtml;
    var payload = buildSavePayload(html);

    if (!dispatchBeforeSave(payload)) {
      return Promise.resolve(false);
    }

    updateStatus("dirty", "Saving");

    return persistSave(payload)
      .then(function () {
        markSaveSuccessful(payload, savedRootHtml, previousSavedRootHtml);
        return true;
      })
      .catch(function (error) {
        markSaveFailed(error, payload);
        return false;
      });
  }

  /**
   * @param {string} html
   * @returns {SavePayload}
   */
  function buildSavePayload(html) {
    return {
      pathname: location.pathname,
      title: document.title,
      html: html,
      source: "hyperedit",
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * @param {SavePayload} payload
   */
  function dispatchBeforeSave(payload) {
    return document.dispatchEvent(
      new CustomEvent("hyperedit:before-save", {
        cancelable: true,
        detail: payload,
      })
    );
  }

  /**
   * @param {SavePayload} payload
   * @returns {Promise<Response | void>}
   */
  function persistSave(payload) {
    return options.saveUrl
      ? postSavePayload(payload)
      : Promise.resolve(saveDraft(payload.html));
  }

  /**
   * @param {SavePayload} payload
   * @returns {Promise<Response>}
   */
  function postSavePayload(payload) {
    return fetch(options.saveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Save failed: " + response.status);
      }

      return response;
    });
  }

  /**
   * @param {SavePayload} payload
   * @param {string} savedRootHtml
   * @param {string} previousSavedRootHtml
   */
  function markSaveSuccessful(payload, savedRootHtml, previousSavedRootHtml) {
    if (previousSavedRootHtml !== savedRootHtml) {
      state.previousSavedRootHtml = previousSavedRootHtml;
    }
    state.lastSavedRootHtml = savedRootHtml;
    state.dirty = false;
    updateToolbar();
    updateStatus("saved", "Saved");
    dispatchSave(payload);
    window.setTimeout(updateToolbar, 900);
  }

  /**
   * @param {unknown} error
   * @param {SavePayload} payload
   */
  function markSaveFailed(error, payload) {
    updateStatus("dirty", getErrorMessage(error, "Save failed"));
    dispatchSaveError(error, payload);
  }

  /**
   * @param {SavePayload} payload
   */
  function dispatchSave(payload) {
    document.dispatchEvent(new CustomEvent("hyperedit:save", { detail: payload }));
  }

  /**
   * @param {unknown} error
   * @param {SavePayload} payload
   */
  function dispatchSaveError(error, payload) {
    document.dispatchEvent(
      new CustomEvent("hyperedit:save-error", {
        detail: { error: error, payload: payload },
      })
    );
  }

  /**
   * @param {unknown} error
   * @param {string} fallback
   */
  function getErrorMessage(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  /**
   * @returns {string}
   */
  function serializeDocument() {
    return getDoctype() + createSerializableDocumentClone().outerHTML;
  }

  /**
   * @returns {HTMLElement}
   */
  function createSerializableDocumentClone() {
    var clone = cloneDocumentElement();
    clone.classList.remove("hx-editor-on", "hx-editor-sampling");
    removeEmptyClassAttribute(clone);
    removeEditorRuntimeFromClone(clone);
    restoreEditableCloneState(clone);
    cleanCommentBoxClones(clone);
    return clone;
  }

  /**
   * @returns {HTMLElement}
   */
  function cloneDocumentElement() {
    return /** @type {HTMLElement} */ (document.documentElement.cloneNode(true));
  }

  /**
   * @param {HTMLElement} clone
   */
  function removeEditorRuntimeFromClone(clone) {
    Array.prototype.forEach.call(
      clone.querySelectorAll(editorRuntimeSelector),
      function (/** @type {Element} */ element) {
        element.remove();
      }
    );
  }

  /**
   * @param {HTMLElement} clone
   */
  function restoreEditableCloneState(clone) {
    Array.prototype.forEach.call(
      clone.querySelectorAll(editableCloneSelector),
      function (/** @type {Element} */ element) {
        if (element instanceof HTMLElement) {
          restoreEditableCloneElement(element);
        }
      }
    );
  }

  /**
   * @param {HTMLElement} element
   */
  function restoreEditableCloneElement(element) {
    var wasActivated = element.classList.contains(editableClass);
    element.classList.remove(editableClass, activeClass);

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

    removeEmptyClassAttribute(element);
  }

  /**
   * @param {HTMLElement} clone
   */
  function cleanCommentBoxClones(clone) {
    Array.prototype.forEach.call(
      clone.querySelectorAll(commentBoxSelector),
      function (/** @type {Element} */ box) {
        if (box instanceof HTMLElement) {
          cleanCommentBoxClone(box);
        }
      }
    );
  }

  /**
   * @param {HTMLElement} box
   */
  function cleanCommentBoxClone(box) {
    box.removeAttribute("contenteditable");
    box.removeAttribute("spellcheck");
    box.classList.remove(commentDraggingClass);
    removeEmptyClassAttribute(box);
  }

  /**
   * @param {HTMLElement} element
   */
  function removeEmptyClassAttribute(element) {
    if (!element.getAttribute("class")) {
      element.removeAttribute("class");
    }
  }

  /**
   * @param {HTMLElement} element
   * @param {string} attribute
   * @param {string | undefined} value
   */
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
        tool === state.tool ||
        (tool === "sample" && state.sampling) ||
        (tool === "annotations" &&
          toolbar.highlightsPanel &&
          !toolbar.highlightsPanel.hidden);
      button.setAttribute("aria-pressed", String(pressed));

      if (tool !== "edit" && tool !== "save") {
        button.disabled = !state.editing;
      }

      if (tool === "undo") {
        button.disabled = !state.editing || !hasUndoHistory();
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

  /**
   * @param {"off" | "ready" | "dirty" | "saved"} status
   * @param {string} label
   */
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

  editorWindow.HyperEdit = {
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
