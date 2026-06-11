const { expect, test } = require("@playwright/test");

function editButton(page) {
  return page.getByRole("button", { name: "Toggle editing" });
}

async function enableEditing(page) {
  await editButton(page).click();
  await expect(page.locator("html")).toHaveClass(/hx-editor-on/);
  await expect(page.locator("main")).not.toHaveAttribute(
    "contenteditable",
    "true"
  );
}

async function activateEditableTarget(page, selector) {
  await page.locator(selector).dblclick();
  await expect(page.locator(selector)).toHaveAttribute(
    "contenteditable",
    "true"
  );
}

async function highlightText(page, selector, start, end, shiftKey = false) {
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await page.evaluate(
    ({ selector, start, end, shiftKey }) => {
      const element = document.querySelector(selector);
      const textNode = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      );
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, shiftKey })
      );
    },
    { selector, start, end, shiftKey }
  );
}

async function commentText(page, selector, start, end) {
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.evaluate(
    ({ selector, start, end }) => {
      const element = document.querySelector(selector);
      const textNode = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      );
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { selector, start, end }
  );
}

test("project documentation pages load with the editor toolbar", async ({ page }) => {
  const pages = [
    { path: "/", heading: "Drop-in editing" },
    { path: "/current-state.html", heading: "What hyperedit.js does today" },
    { path: "/phase2.html", heading: "Save edited HTML" },
    { path: "/plan.html", heading: "Progress and next work" },
    {
      path: "/comment-isolation.html",
      heading: "Durable annotations without corrupting page text",
    },
  ];

  for (const docsPage of pages) {
    await page.goto(docsPage.path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      docsPage.heading
    );
    await expect(editButton(page)).toBeVisible();
    await expect(page.locator("script[src$='hyperedit.js']")).toHaveAttribute(
      "data-save-url",
      "/__hyperedit/save"
    );
  }
});

test("edit toggle enables targeted contenteditable blocks", async ({
  page,
}) => {
  await page.goto("/");

  const root = page.locator("main");
  await expect(root).not.toHaveAttribute("contenteditable", "true");

  await enableEditing(page);
  await expect(root).not.toHaveAttribute("contenteditable", "true");

  await activateEditableTarget(page, "h1");
  await expect(page.locator(".lede").first()).not.toHaveAttribute(
    "contenteditable",
    "true"
  );

  await editButton(page).click();
  await expect(root).not.toHaveAttribute("contenteditable", "true");
  await expect(page.locator("h1")).not.toHaveAttribute(
    "contenteditable",
    "true"
  );
});

test("edit toggle does not shift document layout", async ({ page }) => {
  await page.goto("/");

  const before = await page.locator("h1").boundingBox();
  await enableEditing(page);
  const after = await page.locator("h1").boundingBox();

  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
});

test("serialized html strips temporary editor state", async ({ page }) => {
  await page.goto("/");
  await enableEditing(page);

  const html = await page.evaluate(() => window.HyperEdit.serialize());

  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("Drop-in editing for ordinary HTML pages.");
  expect(html).not.toContain("hx-editor-on");
  expect(html).not.toContain("hx-editor-editable");
  expect(html).not.toContain("data-hx-prev-contenteditable");
  expect(html).not.toContain('contenteditable="true"');
});

test("save without backend stores a cleaned local draft", async ({ page }) => {
  await page.goto("/");
  await enableEditing(page);

  await page.evaluate(() => {
    window.HyperEdit.configure({ saveUrl: "" });
    return window.HyperEdit.save();
  });

  const draft = await page.evaluate(() =>
    localStorage.getItem(`hyperedit:${location.origin}${location.pathname}:draft`)
  );

  expect(draft).toContain("Drop-in editing for ordinary HTML pages.");
  expect(draft).not.toContain("hx-editor-editable");
});

test("save hook posts serialized html to a configured backend URL", async ({
  page,
}) => {
  let payload;

  await page.route("**/generic-save", async (route, request) => {
    payload = request.postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/");
  await enableEditing(page);
  await page.evaluate(() => {
    window.HyperEdit.configure({ saveUrl: "/generic-save" });
    document.querySelector("h1").textContent = "Generic save hook.";
  });

  await page.evaluate(() => window.HyperEdit.save());

  expect(payload.pathname).toBe("/");
  expect(payload.source).toBe("hyperedit");
  expect(payload.html).toContain("Generic save hook.");
  expect(payload.html).toContain("<!DOCTYPE html>");
  expect(payload.html).not.toContain("hx-editor-editable");
});

test("comment notes are saved into the html payload", async ({ page }) => {
  let payload;

  await page.route("**/__hyperedit/save", async (route, request) => {
    payload = request.postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/comment-isolation.html");
  await enableEditing(page);
  await commentText(page, "h1", 0, 8);
  await page.locator("[data-hx-comment-box]").fill("Durable editor note.");

  await page.evaluate(() => window.HyperEdit.save());

  expect(payload.pathname).toBe("/comment-isolation.html");
  expect(payload.html).toContain("Durable editor note.");
  expect(payload.html).toContain("data-hx-comment-anchor");
  expect(payload.html).toContain("data-hx-comment-box");
  expect(payload.html).not.toContain('data-hx-comment-box="" contenteditable="true"');
});

test("comment tool creates an inline floating comment box", async ({ page }) => {
  await page.goto("/");
  await enableEditing(page);
  await commentText(page, "h1", 0, 6);

  await expect(page.locator("[data-hx-comment-anchor]")).toHaveCount(1);
  await expect(page.locator("[data-hx-comment-box]")).toHaveCount(1);
  await expect(page.locator("[data-comment-popover]")).toHaveCount(0);

  await page.locator("[data-hx-comment-box]").fill("Clarify this phrase");

  await expect(page.locator("[data-hx-comment-anchor]")).toHaveAttribute(
    "data-hx-comment",
    "Clarify this phrase"
  );
  await expect(page.locator("[data-hx-comment-anchor]")).not.toHaveAttribute(
    "title",
    "Clarify this phrase"
  );

  const html = await page.evaluate(() => window.HyperEdit.serialize());
  expect(html).toContain("Clarify this phrase");
  expect(html).toContain("data-hx-comment-box");
  expect(html).not.toContain('data-hx-comment-box="" contenteditable="true"');
});

test("existing highlights can receive comments with the comment tool", async ({
  page,
}) => {
  await page.goto("/");
  await enableEditing(page);
  await highlightText(page, "h1", 0, 6);

  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.locator("mark[data-hx-highlight]").click();
  await page.locator("[data-hx-comment-box]").fill("Clarify this phrase");

  await expect(page.locator("mark[data-hx-highlight]")).toHaveAttribute(
    "data-hx-comment",
    "Clarify this phrase"
  );
  await expect(page.locator("mark[data-hx-highlight]")).not.toHaveAttribute(
    "title",
    "Clarify this phrase"
  );
});

test("annotations panel handles multiple annotations and deletion", async ({
  page,
}) => {
  await page.goto("/");
  await enableEditing(page);
  await highlightText(page, "h1", 0, 6);
  await commentText(page, ".lede", 0, 9);

  await page.getByRole("button", { name: "Annotations" }).click();
  await expect(page.locator(".highlight-row")).toHaveCount(2);

  await page.locator(".highlight-row [data-highlight-delete]").first().click();
  await expect(
    page.locator("mark[data-hx-highlight], [data-hx-comment-anchor]")
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Remove all annotations" }).click();
  await expect(page.locator("mark[data-hx-highlight]")).toHaveCount(0);
  await expect(page.locator("[data-hx-comment-anchor]")).toHaveCount(0);
  await expect(page.locator("[data-hx-comment-box]")).toHaveCount(0);
});

test("floating comment boxes can be moved", async ({ page }) => {
  await page.goto("/");
  await enableEditing(page);
  await commentText(page, "h1", 0, 6);
  await page.locator("[data-hx-comment-box]").fill("Move this note");

  const box = page.locator("[data-hx-comment-box]");
  const before = await box.boundingBox();
  await page.mouse.move(before.x + 8, before.y + 8);
  await page.mouse.down();
  await page.mouse.move(before.x + 88, before.y + 48);
  await page.mouse.up();
  const after = await box.boundingBox();

  expect(after.x).toBeGreaterThan(before.x + 40);
  expect(after.y).toBeGreaterThan(before.y + 20);
});

test("undo restores native contenteditable input before save", async ({
  page,
}) => {
  await page.goto("/");
  await enableEditing(page);

  const heading = page.locator("h1");
  const originalHeading = await heading.textContent();
  await activateEditableTarget(page, "h1");
  await page.evaluate(() => {
    const heading = document.querySelector("h1");
    const textNode = Array.from(heading.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    const range = document.createRange();
    heading.focus();
    range.setStart(textNode, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  await page.keyboard.type("X");
  await expect(heading).toHaveText(`X${originalHeading}`);

  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(heading).toHaveText(originalHeading);
});

test("undo restores the previous document after save", async ({ page }) => {
  await page.route("**/__hyperedit/save", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/");
  await enableEditing(page);

  const originalHeading = await page.locator("h1").textContent();
  await page.evaluate(() => {
    document.querySelector("h1").textContent = "Changed saved heading.";
  });

  await page.evaluate(() => window.HyperEdit.save());
  await page.getByRole("button", { name: "Undo last change" }).click();

  await expect(page.locator("h1")).toHaveText(originalHeading);
});
