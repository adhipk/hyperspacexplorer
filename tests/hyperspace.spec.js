const { expect, test } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const tempSaveFile = path.join(rootDir, "tmp-hyperspace-save.html");
const tempArbitraryFile = path.join(rootDir, "tmp-hyperspace-arbitrary.html");
const tempBackupDir = path.join(rootDir, "sites-versions", "tmp-hyperspace-save");

function commentButton(page) {
  return page.locator("[data-hs-tool='comment']");
}

async function stubPageSaves(page) {
  const saves = [];

  await page.route("**/_/save", async (route, request) => {
    saves.push({
      body: request.postData(),
      pageUrl: request.headers()["page-url"],
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ msg: "Saved", msgType: "success" }),
    });
  });

  return saves;
}

async function placeComment(page, text) {
  const host = page.locator(".section.split[data-hs-comment-host]").first();
  const target = host.locator("p").first();

  await commentButton(page).click();
  await target.click({ position: { x: 24, y: 18 } });

  const comment = host.locator("[data-hs-comment]");
  const commentText = comment.locator("p");

  await expect(comment).toHaveCount(1);

  if (text) {
    await page.keyboard.type(text);
    await page.mouse.click(24, 24);
    await expect(comment).not.toHaveAttribute("save-remove", "");
  }

  return { host, comment, text: commentText };
}

test.afterEach(async () => {
  await fs.rm(tempSaveFile, { force: true });
  await fs.rm(tempArbitraryFile, { force: true });
  await fs.rm(tempBackupDir, { recursive: true, force: true });
});

test("served HTML pages load with external Hyperspace runtime assets", async ({
  page,
  request,
}) => {
  await fs.writeFile(
    tempArbitraryFile,
    [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      "<title>Arbitrary HTML</title>",
      "</head>",
      "<body>",
      "<main data-hs-comment-host>",
      "<h1>Arbitrary external page</h1>",
      "<p>This file was not authored as a Hyperspace doc.</p>",
      "</main>",
      "</body>",
      "</html>",
    ].join("\n"),
    "utf8"
  );

  const pages = [
    { path: "/", heading: "Review any HTML file" },
    { path: "/tmp-hyperspace-arbitrary.html", heading: "Arbitrary external page" },
  ];

  for (const docsPage of pages) {
    const response = await request.get(docsPage.path);
    const servedHtml = await response.text();

    expect(response.ok()).toBe(true);
    expect(servedHtml).toContain('<link rel="stylesheet" href="/hyperspace.css"');
    expect(servedHtml).toContain('src="/hyperspace.js"');
    expect(servedHtml).not.toContain("hs-toolbar");

    await page.goto(docsPage.path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      docsPage.heading
    );
    await expect(page.locator(".hs-toolbar")).toBeVisible();
    await expect(page.locator("script[src='/hyperspace.js']")).toHaveAttribute(
      "save-remove",
      ""
    );
    await expect(page.locator("link[href='/hyperspace.css']")).toHaveAttribute(
      "save-remove",
      ""
    );
  }
});

test("edit toolbar toggle controls item editing without badges", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  const editButton = page.locator("[data-hs-tool='edit']");
  const heading = page.getByRole("heading", { level: 1 });

  await expect(page.locator("[data-hs-tool='select']")).toHaveCount(0);
  await expect(editButton).toHaveAttribute("aria-pressed", "false");
  await expect(editButton).toHaveAttribute("data-hs-edit-state", "off");
  await expect(editButton.locator("svg")).toHaveAttribute(
    "data-lucide",
    "pencil-off"
  );
  await expect(page.locator(".hs-edit-badge")).toHaveCount(0);
  await expect(page.locator("main")).not.toHaveAttribute(
    "contenteditable",
    "true"
  );
  await expect(page.locator("html")).not.toHaveAttribute("editmode", "true");

  await heading.click();
  await expect(page.locator("[contenteditable='true']")).toHaveCount(0);

  await editButton.click();
  await expect(editButton).toHaveAttribute("aria-pressed", "true");
  await expect(editButton).toHaveAttribute("data-hs-edit-state", "on");
  await expect(editButton.locator("svg")).toHaveAttribute("data-lucide", "pencil");
  await expect(page.locator("html")).toHaveAttribute("data-hs-active-tool", "edit");

  await heading.click();
  await expect(heading).toHaveAttribute("contenteditable", "true");
  await expect(page.locator("main")).not.toHaveAttribute(
    "contenteditable",
    "true"
  );

  await heading.fill("Edited through toolbar mode.");
  await editButton.click();
  await expect(editButton).toHaveAttribute("aria-pressed", "false");
  await expect(editButton).toHaveAttribute("data-hs-edit-state", "off");
  await expect(editButton.locator("svg")).toHaveAttribute(
    "data-lucide",
    "pencil-off"
  );
  await expect(page.locator("[contenteditable='true']")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-hs-active-tool",
    "edit"
  );

  await page.getByText("Hyperspace adds an external review layer").click();
  await expect(page.locator("[contenteditable='true']")).toHaveCount(0);
});

test("demo page exposes editable content and checklist state", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1 });
  const firstCheckbox = page.locator("input[type='checkbox']").first();
  const firstChecklistItem = page.locator("tbody tr").first().locator("td").nth(1);
  const editButton = page.locator("[data-hs-tool='edit']");

  await expect(firstCheckbox).toBeEnabled();
  await expect(firstCheckbox).toHaveAttribute("checked", "");
  await expect(page.locator(".hs-edit-badge")).toHaveCount(0);

  await heading.click();
  await expect(page.locator("[contenteditable='true']")).toHaveCount(0);

  await firstCheckbox.click();
  await expect(firstCheckbox).not.toHaveAttribute("checked", "");

  await editButton.click();
  await expect(editButton).toHaveAttribute("aria-pressed", "true");

  await heading.click();
  await expect(heading).toHaveAttribute("contenteditable", "true");
  await heading.fill("Review pages stay editable.");
  await page.mouse.click(24, 24);

  await firstChecklistItem.click();
  await expect(firstChecklistItem).toHaveAttribute("contenteditable", "true");
  await firstChecklistItem.fill("Toolbar state remains user-editable.");
  await page.mouse.click(24, 24);

  const html = await page.evaluate(() => window.Hyperspace.serialize());

  expect(html).not.toContain("data-hs-editable-document");
  expect(html).not.toContain("data-hs-active-tool");
  expect(html).toContain("Review pages stay editable.");
  expect(html).toContain("Toolbar state remains user-editable.");
  expect(html).not.toContain("disabled");
});

test("comment tool works on editable checklist documents", async ({ page }) => {
  await stubPageSaves(page);
  await page.goto("/");

  const main = page.locator("main");
  const target = page.locator("tbody tr").first().locator("td").nth(1);

  await commentButton(page).click();
  await target.click({ position: { x: 20, y: 18 } });

  const comment = main.locator("[data-hs-comment]").first();
  const text = comment.locator("p");

  await expect(comment).toBeVisible();
  await expect(text).toBeFocused();

  await page.keyboard.type("Checklist comment still works.");
  await page.mouse.click(24, 24);

  await expect(comment).not.toHaveAttribute("save-remove", "");
  await expect(text).toHaveText("Checklist comment still works.");
});

test("editable lists use structured controls", async ({ page }) => {
  await stubPageSaves(page);
  await page.goto("/");

  await page.evaluate(() => {
    const shell = document.querySelector(".shell");

    if (shell instanceof HTMLElement) {
      shell.hidden = true;
    }

    const fixture = document.createElement("section");
    fixture.innerHTML = [
      '<ol id="list-control-fixture">',
      "<li>Prepare the package.</li>",
      "<li>Test the Hyperspace client.</li>",
      "<li>Publish the artifact.</li>",
      "</ol>",
    ].join("");
    document.body.append(fixture);
  });

  const list = page.locator("#list-control-fixture");
  const items = list.locator("li");
  const controls = page.locator(".hs-list-controls:visible").first();
  const editButton = page.locator("[data-hs-tool='edit']");

  await expect(items).toHaveCount(3);
  await expect(page.locator(".hs-edit-badge")).toHaveCount(0);
  await expect(page.locator(".hs-list-controls")).toHaveCount(0);

  await editButton.click();
  await expect(controls).toBeVisible();
  await expect(
    controls.locator("[data-hs-list-action='add'] svg")
  ).toHaveAttribute("data-lucide", "plus");
  await expect(
    controls.locator("[data-hs-list-action='up'] svg")
  ).toHaveAttribute("data-lucide", "arrow-up");
  await expect(
    controls.locator("[data-hs-list-action='down'] svg")
  ).toHaveAttribute("data-lucide", "arrow-down");
  await expect(
    controls.locator("[data-hs-list-action='delete'] svg")
  ).toHaveAttribute("data-lucide", "trash-2");

  await items.nth(1).click();
  await expect(items.nth(1)).toHaveAttribute("data-hs-list-selected", "");

  await controls.locator("[data-hs-list-action='up']").click();
  await expect(items.first()).toContainText("Test the Hyperspace client");

  await controls.locator("[data-hs-list-action='add']").click();
  await expect(items).toHaveCount(4);
  await expect(items.nth(1)).toHaveAttribute("contenteditable", "true");

  await items.nth(1).fill("New distributable package.");
  await items.nth(1).evaluate((element) => element.blur());
  await expect(items.nth(1)).toContainText("New distributable package.");

  await items.nth(1).click();
  await expect(items.nth(1)).toHaveAttribute("data-hs-list-selected", "");
  await controls.locator("[data-hs-list-action='delete']").click();
  await expect(items).toHaveCount(3);
  await expect(list).not.toContainText("New distributable package.");
});

test("toolbar uses named Lucide icons", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("[data-hs-tool='select']")).toHaveCount(0);
  await expect(page.locator("[data-hs-tool='edit'] svg")).toHaveAttribute(
    "data-lucide",
    "pencil-off"
  );
  await expect(page.locator("[data-hs-tool='comment'] svg")).toHaveAttribute(
    "data-lucide",
    "message-square-plus"
  );
  await expect(page.locator("[data-hs-tool='save'] svg")).toHaveAttribute(
    "data-lucide",
    "save"
  );
  await expect(page.locator(".hs-edit-badge")).toHaveCount(0);
});

test("save toasts use hard drive download icon", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const container = document.createElement("div");
    container.className = "toast-container";
    container.setAttribute("data-toast-theme", "");
    container.innerHTML = [
      '<div class="toast"><svg data-lucide="check"></svg>Saved</div>',
      '<div class="toast"><svg data-lucide="alert-circle"></svg>Error</div>',
    ].join("");
    document.body.append(container);
  });

  await expect(
    page.locator(".toast").filter({ hasText: "Saved" }).locator("svg")
  ).toHaveAttribute("data-lucide", "hard-drive-download");
  await expect(
    page.locator(".toast").filter({ hasText: "Error" }).locator("svg")
  ).toHaveAttribute("data-lucide", "alert-circle");
});

test("double click edits an item without whole-page editing", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  const editable = page.locator("details[open] p").first();
  const editButton = page.locator("[data-hs-tool='edit']");

  await expect(page.locator("html")).not.toHaveAttribute("editmode", "true");
  await editable.dblclick();
  await expect(page.locator("[contenteditable='true']")).toHaveCount(0);

  await editButton.click();
  await expect(editButton).toHaveAttribute("aria-pressed", "true");
  await editable.dblclick();

  await expect(editable).toHaveAttribute("contenteditable", "true");
  await expect(page.locator("main")).not.toHaveAttribute(
    "contenteditable",
    "true"
  );

  await page.mouse.click(24, 24);
  await expect(editable).not.toHaveAttribute("contenteditable", "true");
});

test("comment tool creates nearby durable HTML after clickaway", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  const { comment, text } = await placeComment(page, "");
  const draftAffordance = await text.evaluate((element) => {
    const textStyle = getComputedStyle(element);
    const beforeStyle = getComputedStyle(element, "::before");

    return {
      activeTool: document.documentElement.getAttribute("data-hs-active-tool"),
      bodyCursor: getComputedStyle(document.body).cursor,
      caretColor: textStyle.caretColor,
      textCursor: textStyle.cursor,
      beforeContent: beforeStyle.content,
      beforeWidth: beforeStyle.width,
      beforeBackground: beforeStyle.backgroundColor,
    };
  });

  await expect(comment).toHaveAttribute("save-remove", "");
  await expect(text).toBeFocused();
  expect(draftAffordance.activeTool).toBe("comment");
  expect(draftAffordance.bodyCursor).toBe("crosshair");
  expect(draftAffordance.textCursor).toBe("text");
  expect(draftAffordance.caretColor).toBe("rgb(224, 49, 49)");
  expect(draftAffordance.beforeContent).toBe('""');
  expect(draftAffordance.beforeWidth).toBe("2px");
  expect(draftAffordance.beforeBackground).toBe("rgb(224, 49, 49)");

  await page.keyboard.type("Tighten this section.");
  await page.mouse.click(24, 24);

  await expect(comment).not.toHaveAttribute("save-remove", "");
  await expect(comment).toHaveAttribute("movable", "");
  await expect(text).toHaveText("Tighten this section.");
  await expect(text).not.toHaveAttribute("editmode:contenteditable", "");
  await expect(text).not.toHaveAttribute("contenteditable", "true");
});

test("comment tool stays armed after committing a comment", async ({ page }) => {
  await stubPageSaves(page);
  await page.goto("/");

  const host = page.locator(".section.split[data-hs-comment-host]").first();
  const target = host.locator("p").first();
  const { comment } = await placeComment(page, "First comment.");

  await expect(commentButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(host.locator("[data-hs-comment]")).toHaveCount(1);

  const targetBox = await target.boundingBox();
  await page.mouse.click(
    targetBox.x + targetBox.width - 24,
    targetBox.y + targetBox.height - 18
  );
  await expect(host.locator("[data-hs-comment]")).toHaveCount(2);
});

test("basic comments are movable through Hyperclay movable transform state", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  const { comment } = await placeComment(page, "Move me.");
  const before = await comment.evaluate((element) => element.style.transform);
  const box = await comment.boundingBox();

  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 92, box.y + 52);
  await page.mouse.up();

  const after = await comment.evaluate((element) => element.style.transform);

  expect(after).not.toBe(before);
});

test("comments can be edited by double clicking", async ({ page }) => {
  await stubPageSaves(page);
  await page.goto("/");

  const { comment, text } = await placeComment(page, "Original comment.");

  await comment.dblclick();
  await expect(text).toHaveAttribute("contenteditable", "true");
  await expect(comment).not.toHaveAttribute("movable", "");

  await text.fill("Updated comment.");
  await page.mouse.click(24, 24);

  await expect(text).toHaveText("Updated comment.");
  await expect(text).not.toHaveAttribute("contenteditable", "true");
  await expect(comment).toHaveAttribute("movable", "");
});

test("comments render as plain red autosized text", async ({ page }) => {
  await stubPageSaves(page);
  await page.goto("/");

  const styles = await page.evaluate(() => {
    const comment = document.createElement("aside");
    comment.setAttribute("data-hs-comment", "");
    comment.setAttribute(
      "style",
      "transform: translate(0px, 0px); width: 159px; height: 525px; resize: both; overflow: hidden;"
    );
    comment.innerHTML = "<p>Short automatic comment</p>";
    document.body.append(comment);

    const computed = window.getComputedStyle(comment);

    return {
      color: computed.color,
      height: parseFloat(computed.height),
      resize: computed.resize,
      textShadow: computed.textShadow,
    };
  });

  expect(styles.color).toBe("rgb(224, 49, 49)");
  expect(styles.resize).toBe("none");
  expect(styles.textShadow).toBe("none");
  expect(styles.height).toBeLessThan(80);
});

test("selected comments can be deleted from the keyboard", async ({ page }) => {
  await stubPageSaves(page);
  await page.goto("/");

  const { comment } = await placeComment(page, "Remove me.");

  await comment.click();
  await expect(comment).toHaveAttribute("data-hs-selected", "");
  await page.keyboard.press("Backspace");
  await expect(comment).toHaveCount(0);
});

test("serialization strips runtime and preserves semantic comments", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  await placeComment(page, "Persist this comment.");
  await page.evaluate(() => {
    const comment = document.querySelector(".section.split [data-hs-comment]");

    if (comment instanceof HTMLElement) {
      comment.style.width = "111px";
      comment.style.height = "222px";
    }
  });

  const html = await page.evaluate(() => window.Hyperspace.serialize());

  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("data-hs-comment");
  expect(html).toContain("Persist this comment.");
  expect(html).toContain("movable");
  expect(html).toContain("transform: translate");
  expect(html).not.toContain("width: 111px");
  expect(html).not.toContain("height: 222px");
  expect(html).not.toContain("hs-toolbar");
  expect(html).not.toContain("data-hs-runtime");
  expect(html).not.toContain("data-hs-comment-controls");
  expect(html).not.toContain("Move comment");
  expect(html).not.toContain("tabindex");
  expect(html).not.toContain("data-hs-selected");
  expect(html).not.toContain("data-hs-list-selected");
  expect(html).not.toContain("data-hs-draft");
  expect(html).not.toContain("data-hs-resizing");
  expect(html).not.toContain("movable-dragging");
  expect(html).not.toContain('contenteditable="true"');
  expect(html).not.toContain("inert-contenteditable");
  expect(html).not.toContain('editmode="true"');
  expect(html).not.toContain("option-visibility");
  expect(html).not.toMatch(/<script\b[^>]*\bhyperspace\.js\b/i);
  expect(html).not.toMatch(/<link\b[^>]*\bhyperspace\.css\b/i);
});

test("focus loss autosaves text changes without Hyperclay toast path", async ({
  page,
}) => {
  const saves = await stubPageSaves(page);

  await page.goto("/");
  await page.evaluate(() => {
    window.hyperclay = {
      savePage() {
        throw new Error("manual save path should not run for autosave");
      },
    };
  });

  const editable = page.locator("details[open] p").first();

  await page.locator("[data-hs-tool='edit']").click();
  await editable.dblclick();
  await editable.fill("Autosaved review artifact");
  await page.mouse.click(24, 24);

  await expect
    .poll(() => saves.length, { timeout: 3000 })
    .toBeGreaterThan(0);
  expect(saves.at(-1).body).toContain("Autosaved review artifact");
});

test("fallback save posts Hyperclay-compatible plain HTML", async ({ page }) => {
  let body;
  let pageUrl;

  await page.route("**/_/save", async (route, request) => {
    body = request.postData();
    pageUrl = request.headers()["page-url"];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ msg: "Saved", msgType: "success" }),
    });
  });

  await page.goto("/");
  await page.evaluate(() => {
    window.hyperclay = null;
  });

  await page.evaluate(() => window.Hyperspace.save());

  expect(pageUrl).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):/);
  expect(body).toContain("<!DOCTYPE html>");
  expect(body).not.toContain("hs-toolbar");
});

test("server save endpoint writes clean html and creates a backup", async ({
  request,
}) => {
  await fs.writeFile(
    tempSaveFile,
    "<!DOCTYPE html><html><body><p>Before</p></body></html>",
    "utf8"
  );

  const response = await request.post("/_/save", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Page-URL": "http://localhost:5173/tmp-hyperspace-save.html",
    },
    data: [
      "<!DOCTYPE html>",
      '<html editmode="true" pageowner="false" savestatus="saved">',
      "<head>",
      '<link rel="stylesheet" href="/hyperspace.css" save-remove data-hs-runtime>',
      '<style data-name="option-visibility" mutations-ignore=""></style>',
      "</head>",
      "<body>",
      '<div class="hs-toolbar" data-hs-runtime save-remove></div>',
      '<div class="hs-list-controls" data-hs-runtime save-remove></div>',
      '<ol><li data-hs-list-selected tabindex="0">First</li><li>Second</li></ol>',
      '<section data-hs-comment-host><aside data-hs-comment movable movable-dragging data-hs-color="red" tabindex="0" data-hs-selected data-hs-draft data-hs-resizing style="transform: translate(12px, 24px); width: 111px; height: 222px; resize: both; overflow: hidden;"><p inert-contenteditable="null" contenteditable="true" data-hs-inline-editing data-hs-commit-bound>After</p></aside></section>',
      '<script type="module" src="/hyperspace.js" save-remove data-hs-runtime></script>',
      "</body>",
      "</html>",
    ].join(""),
  });

  expect(response.ok()).toBe(true);
  await expect(response).toBeOK();

  const saved = await fs.readFile(tempSaveFile, "utf8");
  const backups = await fs.readdir(tempBackupDir);

  expect(saved).toContain("After");
  expect(saved).toContain("data-hs-comment");
  expect(saved).toContain("movable");
  expect(saved).toContain("transform: translate(12px, 24px)");
  expect(saved).not.toContain("width: 111px");
  expect(saved).not.toContain("height: 222px");
  expect(saved).not.toContain("resize: both");
  expect(saved).not.toContain("overflow: hidden");
  expect(saved).not.toContain("hs-toolbar");
  expect(saved).not.toContain("hs-list-controls");
  expect(saved).not.toContain("hyperspace.js");
  expect(saved).not.toContain("data-hs-comment-controls");
  expect(saved).not.toContain("data-hs-color");
  expect(saved).not.toContain("tabindex");
  expect(saved).not.toContain("data-hs-selected");
  expect(saved).not.toContain("data-hs-list-selected");
  expect(saved).not.toContain("data-hs-editable-list");
  expect(saved).not.toContain("data-hs-draft");
  expect(saved).not.toContain("data-hs-resizing");
  expect(saved).not.toContain("movable-dragging");
  expect(saved).not.toContain("data-hs-inline-editing");
  expect(saved).not.toContain("data-hs-commit-bound");
  expect(saved).not.toContain('contenteditable="true"');
  expect(saved).not.toContain("inert-contenteditable");
  expect(saved).not.toContain('editmode="true"');
  expect(saved).not.toContain("option-visibility");
  expect(backups.length).toBeGreaterThan(0);
});
