// @ts-check

(function () {
  var runtimeWindow = /** @type {any} */ (window);

  if (runtimeWindow.Hyperspace) {
    return;
  }

  /**
   * @typedef {"comment"} ToolType
   * @typedef {"idle" | "editingComment" | "editingText" | "draggingComment"} InteractionType
   * @typedef {{
   *   activeTool: { type: ToolType | null, locked: boolean, lastActiveTool: ToolType | null },
   *   interaction: {
   *     type: InteractionType,
   *     commentId: string | null,
   *     editableId: string | null,
   *     pointerStart: { x: number, y: number } | null,
   *     origin: { x: number, y: number } | null
   *   },
   *   selection: { commentId: string | null, editableId: string | null }
   * }} AppState
   * @typedef {{
   *   type: string,
   *   tool?: ToolType | null,
   *   commentId?: string | null,
   *   editableId?: string | null,
   *   point?: { x: number, y: number },
   *   origin?: { x: number, y: number },
   *   size?: { width: number, height: number }
   * }} StoreEvent
   */

  /** @type {WeakMap<Element, string>} */
  var idsByElement = new WeakMap();
  /** @type {Map<string, Element>} */
  var elementsById = new Map();
  var nextElementId = 1;
  /** @type {Map<HTMLElement, HTMLButtonElement>} */
  var editBadges = new Map();
  /** @type {number | null} */
  var editBadgeFrame = null;
  /** @type {MutationObserver | null} */
  var editBadgeObserver = null;

  /** @type {AppState} */
  var state = {
    activeTool: { type: null, locked: false, lastActiveTool: null },
    interaction: {
      type: "idle",
      commentId: null,
      editableId: null,
      pointerStart: null,
      origin: null,
    },
    selection: { commentId: null, editableId: null },
  };

  /** @type {number | null} */
  var autosaveTimer = null;
  var saveInFlight = false;
  var saveAgain = false;
  var suppressNextCommentPlacement = false;
  var commentInsetX = 0;
  var commentInsetY = 0;

  /**
   * @param {Element} element
   * @returns {string}
   */
  function idForElement(element) {
    var existing = idsByElement.get(element);

    if (existing) {
      return existing;
    }

    var id = "hs-" + nextElementId++;
    idsByElement.set(element, id);
    elementsById.set(id, element);
    return id;
  }

  /**
   * @param {string | null | undefined} id
   * @returns {Element | null}
   */
  function elementForId(id) {
    if (!id) {
      return null;
    }

    var element = elementsById.get(id) || null;

    if (element && !element.isConnected) {
      elementsById.delete(id);
      return null;
    }

    return element;
  }

  /**
   * @param {string | null | undefined} id
   * @returns {HTMLElement | null}
   */
  function commentForId(id) {
    var element = elementForId(id);
    return element instanceof HTMLElement && element.matches("[data-hs-comment]")
      ? element
      : null;
  }

  /**
   * @param {string | null | undefined} id
   * @returns {HTMLElement | null}
   */
  function editableForId(id) {
    var element = elementForId(id);
    return element instanceof HTMLElement &&
      element.matches("[editmode\\:contenteditable]")
      ? element
      : null;
  }

  /**
   * @param {AppState} current
   * @param {ToolType} tool
   * @returns {AppState}
   */
  function nextToolState(current, tool) {
    /** @type {ToolType | null} */
    var nextTool = current.activeTool.type === tool ? null : tool;

    return {
      ...current,
      activeTool: {
        type: nextTool,
        locked: nextTool === "comment",
        lastActiveTool:
          current.activeTool.type === nextTool
            ? current.activeTool.lastActiveTool
            : current.activeTool.type,
      },
      interaction: idleInteraction(),
    };
  }

  /**
   * @returns {AppState["interaction"]}
   */
  function idleInteraction() {
    return {
      type: "idle",
      commentId: null,
      editableId: null,
      pointerStart: null,
      origin: null,
    };
  }

  /**
   * @param {AppState} current
   * @param {StoreEvent} event
   * @returns {AppState}
   */
  function transition(current, event) {
    switch (event.type) {
      case "tool.selected":
        return event.tool ? nextToolState(current, event.tool) : current;

      case "comment.selected":
        return {
          ...current,
          interaction: idleInteraction(),
          selection: { commentId: event.commentId || null, editableId: null },
        };

      case "selection.cleared":
        return {
          ...current,
          selection: { commentId: null, editableId: null },
        };

      case "comment.edit.started":
        return {
          ...current,
          interaction: {
            ...idleInteraction(),
            type: "editingComment",
            commentId: event.commentId || null,
          },
          selection: { commentId: event.commentId || null, editableId: null },
        };

      case "inline.edit.started":
        return {
          ...current,
          interaction: {
            ...idleInteraction(),
            type: "editingText",
            editableId: event.editableId || null,
          },
          selection: { commentId: null, editableId: event.editableId || null },
        };

      case "comment.drag.started":
        return {
          ...current,
          interaction: {
            ...idleInteraction(),
            type: "draggingComment",
            commentId: event.commentId || null,
            pointerStart: event.point || null,
            origin: event.origin || null,
          },
          selection: { commentId: event.commentId || null, editableId: null },
        };

      case "interaction.finished":
        return {
          ...current,
          interaction: idleInteraction(),
        };

      case "escape.pressed":
        return {
          activeTool: { type: null, locked: false, lastActiveTool: current.activeTool.type },
          interaction: idleInteraction(),
          selection: { commentId: null, editableId: null },
        };

      default:
        return current;
    }
  }

  /**
   * @param {StoreEvent} event
   */
  function send(event) {
    var previous = state;
    var next = transition(previous, event);

    if (next === previous) {
      return;
    }

    state = next;
    applyState(previous, next);
  }

  /**
   * @param {AppState} previous
   * @param {AppState} next
   */
  function applyState(previous, next) {
    if (previous.selection.commentId !== next.selection.commentId) {
      commentForId(previous.selection.commentId)?.removeAttribute("data-hs-selected");
      commentForId(next.selection.commentId)?.setAttribute("data-hs-selected", "");
    }

    if (previous.interaction.commentId !== next.interaction.commentId) {
      commentForId(previous.interaction.commentId)?.removeAttribute("data-hs-dragging");
    }

    updateToolbarState();
  }

  function toggleEditMode() {
    hydrateEditableBadges();
  }

  /** @param {ToolType} tool */
  function setTool(tool) {
    send({ type: "tool.selected", tool: tool });
  }

  function updateToolbarState() {
    var toolbar = document.querySelector(".hs-toolbar");

    if (!toolbar) {
      return;
    }

    toolbar
      .querySelector("[data-hs-tool='comment']")
      ?.setAttribute("aria-pressed", String(state.activeTool.type === "comment"));
  }

  /** @param {"edit" | "comment" | "save"} name */
  function icon(name) {
    var icons = {
      edit: {
        lucide: "pencil",
        paths:
          '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path>',
      },
      comment: {
        lucide: "message-square-plus",
        paths:
          '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M12 7v6"></path><path d="M9 10h6"></path>',
      },
      save: {
        lucide: "save",
        paths:
          '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"></path><path d="M7 3v4a1 1 0 0 0 1 1h7"></path>',
      },
    };
    var iconData = icons[name];

    return (
      '<svg aria-hidden="true" data-lucide="' +
      iconData.lucide +
      '" viewBox="0 0 24 24">' +
      iconData.paths +
      "</svg>"
    );
  }

  function createToolbar() {
    if (document.querySelector(".hs-toolbar")) {
      return;
    }

    var toolbar = document.createElement("div");
    toolbar.className = "hs-toolbar";
    toolbar.setAttribute("data-hs-runtime", "");
    toolbar.setAttribute("save-remove", "");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Hyperspace tools");
    toolbar.innerHTML = [
      '<div class="hs-toolbar-group" role="group" aria-label="Tools">',
      '<button type="button" data-hs-tool="comment" aria-label="Comment" title="Comment" aria-pressed="false">' +
        icon("comment") +
        "</button>",
      '<button type="button" data-hs-tool="save" aria-label="Save" title="Save">' +
        icon("save") +
        "</button>",
      "</div>",
    ].join("");

    document.body.append(toolbar);
  }

  /** @param {HTMLElement} element */
  function shouldBadgeEditable(element) {
    return !element.closest("[data-hs-comment], [data-hs-runtime]");
  }

  /** @param {HTMLElement} editable */
  function createEditBadge(editable) {
    var badge = document.createElement("button");

    badge.type = "button";
    badge.className = "hs-edit-badge";
    badge.setAttribute("data-hs-runtime", "");
    badge.setAttribute("save-remove", "");
    badge.setAttribute("aria-label", "Edit text");
    badge.setAttribute("title", "Edit text");
    badge.innerHTML = icon("edit");

    badge.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    badge.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      beginInlineEdit(editable);
    });

    document.body.append(badge);
    editBadges.set(editable, badge);
    return badge;
  }

  function hydrateEditableBadges() {
    /** @type {Set<HTMLElement>} */
    var currentEditables = new Set();

    document
      .querySelectorAll("[editmode\\:contenteditable]")
      .forEach(function (element) {
        if (element instanceof HTMLElement && shouldBadgeEditable(element)) {
          currentEditables.add(element);

          if (!editBadges.has(element)) {
            createEditBadge(element);
          }
        }
      });

    editBadges.forEach(function (badge, editable) {
      if (!editable.isConnected || !currentEditables.has(editable)) {
        badge.remove();
        editBadges.delete(editable);
      }
    });

    queueEditBadgePositioning();
  }

  function observeEditableBadges() {
    if (editBadgeObserver || typeof MutationObserver === "undefined") {
      return;
    }

    editBadgeObserver = new MutationObserver(function () {
      hydrateEditableBadges();
    });
    editBadgeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["editmode:contenteditable"],
      childList: true,
      subtree: true,
    });
  }

  function queueEditBadgePositioning() {
    if (editBadgeFrame !== null) {
      window.cancelAnimationFrame(editBadgeFrame);
    }

    editBadgeFrame = window.requestAnimationFrame(positionEditBadges);
  }

  function positionEditBadges() {
    editBadgeFrame = null;

    editBadges.forEach(function (badge, editable) {
      if (!editable.isConnected) {
        badge.remove();
        editBadges.delete(editable);
        return;
      }

      if (editable.hasAttribute("data-hs-inline-editing")) {
        badge.hidden = true;
        return;
      }

      var rect = editable.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        badge.hidden = true;
        return;
      }

      var badgeSize = 24;
      var inset = 4;
      var gap = 6;
      var viewportLeft = window.scrollX;
      var viewportRight = window.scrollX + window.innerWidth;
      var rightSide = rect.right + window.scrollX + gap;
      var leftSide = rect.left + window.scrollX - badgeSize - gap;
      var left =
        rightSide + badgeSize <= viewportRight - inset
          ? rightSide
          : leftSide >= viewportLeft + inset
            ? leftSide
            : Math.max(viewportLeft + inset, viewportRight - badgeSize - inset);
      var top = rect.top + window.scrollY + Math.max(0, (rect.height - badgeSize) / 2);

      badge.hidden = false;
      badge.style.left = Math.round(left) + "px";
      badge.style.top = Math.round(Math.max(top, inset)) + "px";
    });
  }

  /** @param {Event} event */
  function getClickTarget(event) {
    return event.target instanceof Element ? event.target : null;
  }

  /** @param {Element | null} target */
  function shouldIgnorePlacementClick(target) {
    return Boolean(
      !target ||
        target.closest("[data-hs-runtime]") ||
        target.closest("[data-hs-comment]")
    );
  }

  /** @param {Element} target */
  function findCommentHost(target) {
    var explicit = target.closest("[data-hs-comment-host]");

    if (explicit instanceof HTMLElement) {
      return explicit;
    }

    var hyperclayNearest =
      target &&
      /** @type {any} */ (target).nearest &&
      /** @type {any} */ (target).nearest.hsCommentHost;

    if (hyperclayNearest instanceof HTMLElement) {
      return hyperclayNearest;
    }

    var host = target.closest("section, article, li, figure, blockquote, main");

    if (host instanceof HTMLElement) {
      host.setAttribute("data-hs-comment-host", "");
      return host;
    }

    document.body.setAttribute("data-hs-comment-host", "");
    return document.body;
  }

  /**
   * @param {MouseEvent} event
   * @param {HTMLElement} host
   */
  function positionForEvent(event, host) {
    var rect = host.getBoundingClientRect();

    return {
      x: Math.max(
        0,
        event.clientX - rect.left + host.scrollLeft - commentInsetX
      ),
      y: Math.max(
        0,
        event.clientY - rect.top + host.scrollTop - commentInsetY
      ),
    };
  }

  /**
   * @param {HTMLElement} element
   * @param {number} clientX
   * @param {number} clientY
   * @returns {boolean}
   */
  function placeCaretFromPoint(element, clientX, clientY) {
    var range = null;
    var documentWithCaret = /** @type {any} */ (document);

    if (typeof documentWithCaret.caretPositionFromPoint === "function") {
      var position = documentWithCaret.caretPositionFromPoint(clientX, clientY);

      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    } else if (typeof documentWithCaret.caretRangeFromPoint === "function") {
      range = documentWithCaret.caretRangeFromPoint(clientX, clientY);
    }

    if (!range) {
      return false;
    }

    var container =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;

    if (!container || !element.contains(container)) {
      return false;
    }

    element.focus();

    var selection = window.getSelection();
    if (!selection) {
      return false;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  /**
   * @param {HTMLElement} element
   * @param {{selectAll?: boolean, clientX?: number, clientY?: number}=} options
   */
  function focusEditableText(element, options) {
    if (
      typeof options?.clientX === "number" &&
      typeof options.clientY === "number" &&
      placeCaretFromPoint(element, options.clientX, options.clientY)
    ) {
      return;
    }

    element.focus();

    var range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);

    var selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /**
   * @param {HTMLElement | null} comment
   */
  function selectComment(comment) {
    send({
      type: comment ? "comment.selected" : "selection.cleared",
      commentId: comment ? idForElement(comment) : null,
    });
  }

  function clearSelectedComment() {
    selectComment(null);
  }

  /** @param {HTMLElement} comment */
  function getCommentText(comment) {
    var text = comment.querySelector("[editmode\\:contenteditable]");
    return text instanceof HTMLElement ? text : null;
  }

  function queueAutosave() {
    if (autosaveTimer) {
      window.clearTimeout(autosaveTimer);
    }

    autosaveTimer = window.setTimeout(runAutosave, 120);
  }

  async function runAutosave() {
    autosaveTimer = null;

    if (saveInFlight) {
      saveAgain = true;
      return;
    }

    saveInFlight = true;

    try {
      await save({ silent: true });
    } catch (error) {
      console.error("Hyperspace autosave failed", error);
    } finally {
      saveInFlight = false;

      if (saveAgain) {
        saveAgain = false;
        queueAutosave();
      }
    }
  }

  /**
   * @param {string} transform
   * @returns {{x: number, y: number}}
   */
  function parseTranslate(transform) {
    var match = transform.match(
      /translate\(\s*(-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/
    );

    return match
      ? { x: parseFloat(match[1]), y: parseFloat(match[2]) }
      : { x: 0, y: 0 };
  }

  /** @param {HTMLElement} comment */
  function normalizeCommentPosition(comment) {
    if (!comment.style.transform || comment.style.transform === "none") {
      var x = parseFloat(comment.style.getPropertyValue("--hs-x")) || 0;
      var y = parseFloat(comment.style.getPropertyValue("--hs-y")) || 0;
      comment.style.transform =
        "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
    }

    comment.style.removeProperty("--hs-x");
    comment.style.removeProperty("--hs-y");
  }

  /** @param {HTMLElement} comment */
  function enableCommentMovement(comment) {
    if (getCommentText(comment)?.hasAttribute("data-hs-inline-editing")) {
      return;
    }

    normalizeCommentPosition(comment);
    comment.setAttribute("movable", "");
  }

  /** @param {HTMLElement} comment */
  function disableCommentMovement(comment) {
    comment.removeAttribute("movable");
    comment.removeAttribute("movable-dragging");
  }

  function syncCommentEditability() {
    document
      .querySelectorAll("[data-hs-comment]")
      .forEach(function (comment) {
        if (!(comment instanceof HTMLElement)) {
          return;
        }

        var text = getCommentText(comment);

        if (text && !text.hasAttribute("data-hs-inline-editing")) {
          text.removeAttribute("contenteditable");
          enableCommentMovement(comment);
        }
      });
  }

  /**
   * @param {HTMLElement} comment
   * @returns {boolean}
   */
  function commitComment(comment) {
    var text = getCommentText(comment);

    if (!text || !text.textContent || !text.textContent.trim()) {
      comment.remove();

      if (state.selection.commentId === idsByElement.get(comment)) {
        send({ type: "selection.cleared" });
      }

      return false;
    }

    text.removeAttribute("contenteditable");
    text.removeAttribute("data-hs-inline-editing");
    comment.removeAttribute("save-remove");
    comment.removeAttribute("data-hs-draft");
    enableCommentMovement(comment);
    return true;
  }

  /**
   * @param {HTMLElement} comment
   * @param {{selectAll?: boolean, clientX?: number, clientY?: number}=} options
   */
  function beginCommentEdit(comment, options) {
    var text = getCommentText(comment);

    if (!text) {
      return;
    }

    disableCommentMovement(comment);
    send({ type: "comment.edit.started", commentId: idForElement(comment) });
    text.setAttribute("contenteditable", "true");
    text.setAttribute("data-hs-inline-editing", "");
    focusEditableText(text, options);

    if (options?.selectAll) {
      var selection = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(text);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    if (!text.hasAttribute("data-hs-commit-bound")) {
      text.setAttribute("data-hs-commit-bound", "");
      text.addEventListener(
        "blur",
        function () {
          text.removeAttribute("data-hs-commit-bound");

          if (state.activeTool.type === "comment") {
            suppressNextCommentPlacement = true;
          }

          commitComment(comment);
          send({ type: "interaction.finished" });
          queueAutosave();
        },
        { once: true }
      );
    }
  }

  /** @param {Document | Element=} root */
  function hydrateComments(root) {
    (root || document)
      .querySelectorAll("[data-hs-comment]")
      .forEach(function (comment) {
        if (comment instanceof HTMLElement) {
          idForElement(comment);
          comment.setAttribute("tabindex", "0");
          enableCommentMovement(comment);
        }
      });
  }

  /**
   * @param {HTMLElement} element
   * @param {{selectAll?: boolean, clientX?: number, clientY?: number}=} options
   */
  function beginInlineEdit(element, options) {
    send({ type: "inline.edit.started", editableId: idForElement(element) });
    element.setAttribute("contenteditable", "true");
    element.setAttribute("data-hs-inline-editing", "");
    queueEditBadgePositioning();
    focusEditableText(element, options);

    if (options?.selectAll) {
      var selection = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    if (!element.hasAttribute("data-hs-commit-bound")) {
      element.setAttribute("data-hs-commit-bound", "");
      element.addEventListener(
        "blur",
        function () {
          element.removeAttribute("contenteditable");
          element.removeAttribute("data-hs-inline-editing");
          element.removeAttribute("data-hs-commit-bound");
          queueEditBadgePositioning();
          send({ type: "interaction.finished" });
          queueAutosave();
        },
        { once: true }
      );
    }
  }

  /**
   * @param {HTMLElement} host
   * @param {MouseEvent} event
   */
  function createComment(host, event) {
    var position = positionForEvent(event, host);
    var comment = document.createElement("aside");
    var text = document.createElement("p");

    comment.setAttribute("data-hs-comment", "");
    comment.setAttribute("data-hs-draft", "");
    comment.setAttribute("save-remove", "");
    comment.setAttribute("tabindex", "0");
    comment.style.transform =
      "translate(" + Math.round(position.x) + "px, " + Math.round(position.y) + "px)";

    text.setAttribute("editmode:contenteditable", "");
    comment.append(text);
    host.append(comment);
    idForElement(comment);
    beginCommentEdit(comment);

    return comment;
  }

  /** @param {MouseEvent} event */
  function handleDocumentClick(event) {
    var target = getClickTarget(event);
    var toolButton = target?.closest("[data-hs-tool]");

    if (toolButton instanceof HTMLElement) {
      suppressNextCommentPlacement = false;

      if (toolButton.matches("[data-hs-tool='comment']")) {
        setTool("comment");
        return;
      }

      if (toolButton.matches("[data-hs-tool='save']")) {
        save();
        return;
      }
    }

    var clickedComment = target?.closest("[data-hs-comment]");

    if (clickedComment instanceof HTMLElement) {
      suppressNextCommentPlacement = false;
      selectComment(clickedComment);
      clickedComment.focus({ preventScroll: true });
      return;
    }

    if (state.activeTool.type !== "comment" || !target || shouldIgnorePlacementClick(target)) {
      clearSelectedComment();
      return;
    }

    if (suppressNextCommentPlacement) {
      suppressNextCommentPlacement = false;
      clearSelectedComment();
      return;
    }

    event.preventDefault();
    createComment(findCommentHost(target), event);
  }

  /** @param {MouseEvent} event */
  function handleDocumentDoubleClick(event) {
    var target = getClickTarget(event);

    if (!target || target.closest("[data-hs-runtime]")) {
      return;
    }

    var comment = target.closest("[data-hs-comment]");

    if (comment instanceof HTMLElement) {
      beginCommentEdit(comment, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return;
    }

    var editable = target.closest("[editmode\\:contenteditable]");

    if (editable instanceof HTMLElement) {
      beginInlineEdit(editable, {
        selectAll: false,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
  }

  /** @param {KeyboardEvent} event */
  function handleDocumentKeyDown(event) {
    var target = event.target instanceof Element ? event.target : null;
    var isEditingText = Boolean(
      target?.closest("[contenteditable='true'], input, textarea")
    );

    if (event.key === "Escape") {
      if (target instanceof HTMLElement && target.matches("[contenteditable='true']")) {
        target.blur();
      }

      send({ type: "escape.pressed" });
      event.preventDefault();
      return;
    }

    var selectedComment = commentForId(state.selection.commentId);

    if (
      selectedComment &&
      !isEditingText &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      selectedComment.remove();
      send({ type: "selection.cleared" });
      queueAutosave();
      event.preventDefault();
    }
  }

  /** @param {PointerEvent} event */
  function handlePointerDown(event) {
    var target = getClickTarget(event);
    var clickedComment = target?.closest("[data-hs-comment]");

    if (!(clickedComment instanceof HTMLElement)) {
      return;
    }

    selectComment(clickedComment);
    clickedComment.focus({ preventScroll: true });

    if (target?.closest("[contenteditable='true']")) {
      return;
    }

    var origin = parseTranslate(clickedComment.style.transform || "");

    send({
      type: "comment.drag.started",
      commentId: idForElement(clickedComment),
      point: { x: event.clientX, y: event.clientY },
      origin: origin,
    });
  }

  /** @param {PointerEvent} event */
  function handlePointerMove(event) {
    if (state.interaction.type !== "draggingComment") {
      return;
    }

    var comment = commentForId(state.interaction.commentId);

    if (
      !comment ||
      comment.hasAttribute("movable-dragging") ||
      !state.interaction.pointerStart ||
      !state.interaction.origin
    ) {
      return;
    }

    var deltaX = event.clientX - state.interaction.pointerStart.x;
    var deltaY = event.clientY - state.interaction.pointerStart.y;

    if (Math.hypot(deltaX, deltaY) < 4) {
      return;
    }

    comment.setAttribute("data-hs-dragging", "");
    comment.style.transform =
      "translate(" +
      Math.max(0, Math.round(state.interaction.origin.x + deltaX)) +
      "px, " +
      Math.max(0, Math.round(state.interaction.origin.y + deltaY)) +
      "px)";
  }

  function handlePointerUp() {
    if (state.interaction.type === "draggingComment") {
      var dragged = commentForId(state.interaction.commentId);

      if (dragged) {
        dragged.removeAttribute("data-hs-dragging");

        var current = parseTranslate(dragged.style.transform || "");
        var origin = state.interaction.origin;

        if (!origin || current.x !== origin.x || current.y !== origin.y) {
          queueAutosave();
        }
      }

      send({ type: "interaction.finished" });
    }
  }

  /** @param {FocusEvent} event */
  function handleEditableFocusOut(event) {
    var target = event.target;

    if (
      target instanceof HTMLElement &&
      target.matches("[editmode\\:contenteditable]")
    ) {
      window.setTimeout(queueAutosave, 0);
    }
  }

  /** @param {HTMLElement} clone */
  function stripRuntimeFromClone(clone) {
    clone
      .querySelectorAll("[data-hs-runtime], [save-remove]")
      .forEach(function (element) {
        element.remove();
      });

    clone.removeAttribute("editmode");
    clone.removeAttribute("pageowner");
    clone.removeAttribute("savestatus");

    clone
      .querySelectorAll("style[data-name='option-visibility'][mutations-ignore]")
      .forEach(function (element) {
        element.remove();
      });

    clone
      .querySelectorAll("[contenteditable], [inert-contenteditable]")
      .forEach(function (element) {
        element.removeAttribute("contenteditable");
        element.removeAttribute("inert-contenteditable");
        element.removeAttribute("data-hs-inline-editing");
        element.removeAttribute("data-hs-commit-bound");
      });

    clone
      .querySelectorAll(
        "[data-hs-selected], [data-hs-draft], [data-hs-dragging], [data-hs-resizing], [movable-dragging]"
      )
      .forEach(function (element) {
        element.removeAttribute("data-hs-selected");
        element.removeAttribute("data-hs-draft");
        element.removeAttribute("data-hs-dragging");
        element.removeAttribute("data-hs-resizing");
        element.removeAttribute("movable-dragging");
      });

    clone.querySelectorAll("[data-hs-comment]").forEach(function (element) {
      element.removeAttribute("tabindex");
      element.removeAttribute("data-hs-color");
      element.setAttribute("movable", "");

      if (element instanceof HTMLElement) {
        element.style.removeProperty("width");
        element.style.removeProperty("height");
        element.style.removeProperty("resize");
        element.style.removeProperty("overflow");
      }
    });
  }

  function serialize() {
    var clone = document.documentElement.cloneNode(true);

    if (!(clone instanceof HTMLElement)) {
      return "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    }

    stripRuntimeFromClone(clone);
    return "<!DOCTYPE html>\n" + clone.outerHTML;
  }

  async function postSerializedSave() {
    var response = await fetch("/_/save", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Page-URL": window.location.href,
      },
      body: serialize(),
    });

    if (!response.ok) {
      throw new Error("Save failed");
    }

    return response.json();
  }

  /** @param {{silent?: boolean}=} options */
  async function save(options) {
    if (
      !options?.silent &&
      runtimeWindow.hyperclay &&
      typeof runtimeWindow.hyperclay.savePage === "function"
    ) {
      return runtimeWindow.hyperclay.savePage();
    }

    return postSerializedSave();
  }

  function init() {
    createToolbar();
    hydrateComments();
    syncCommentEditability();
    hydrateEditableBadges();
    observeEditableBadges();
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("dblclick", handleDocumentDoubleClick);
    document.addEventListener("keydown", handleDocumentKeyDown);
    document.addEventListener("focusout", handleEditableFocusOut);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("scroll", queueEditBadgePositioning, true);
    window.addEventListener("resize", queueEditBadgePositioning);
    updateToolbarState();
  }

  runtimeWindow.Hyperspace = {
    save: save,
    serialize: serialize,
    setTool: setTool,
    toggleEditMode: toggleEditMode,
    getState: function () {
      return JSON.parse(JSON.stringify(state));
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
