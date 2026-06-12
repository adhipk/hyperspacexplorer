const { expect, test } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const tempSaveFile = path.join(rootDir, "tmp-hyperspace-save.html");
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
  const target = host.locator("p[editmode\\:contenteditable]").first();

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
  await fs.rm(tempBackupDir, { recursive: true, force: true });
});

test("documentation pages load with injected Hyperspace runtime", async ({
  page,
}) => {
  const pages = [
    { path: "/", heading: "HTML documents that can be marked up" },
    { path: "/current-state.html", heading: "The prototype is retired" },
    { path: "/phase2.html", heading: "Serve ordinary HTML" },
    { path: "/plan.html", heading: "Build on Hyperclay" },
    { path: "/comment-isolation.html", heading: "Comments are nearby HTML" },
    {
      path: "/hyperclay-local-server.html",
      heading: "What Hyperclay Local's server does",
    },
    {
      path: "/distributables.html",
      heading: "What Hyperspace should ship",
    },
  ];

  for (const docsPage of pages) {
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

test("editable regions use pencil badges instead of a global edit mode", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  const heading = page.locator("h1");
  const badges = page.locator(".hs-edit-badge");

  await expect(page.locator("[data-hs-tool='select']")).toHaveCount(0);
  await expect(page.locator("[data-hs-tool='edit']")).toHaveCount(0);
  await expect(page.locator("main")).not.toHaveAttribute(
    "contenteditable",
    "true"
  );
  await expect(heading).not.toHaveAttribute(
    "contenteditable",
    "true"
  );
  await expect(page.locator("html")).not.toHaveAttribute("editmode", "true");

  await expect.poll(async () => await badges.count()).toBeGreaterThan(0);
  await expect(badges.first()).toBeVisible();
  await expect(badges.first().locator("svg")).toHaveAttribute(
    "data-lucide",
    "pencil"
  );

  const badgeSize = await badges.first().evaluate((badge) => {
    const badgeRect = badge.getBoundingClientRect();
    const iconRect = badge.querySelector("svg").getBoundingClientRect();

    return {
      badgeHeight: badgeRect.height,
      badgeWidth: badgeRect.width,
      iconHeight: iconRect.height,
      iconWidth: iconRect.width,
    };
  });

  expect(badgeSize.badgeWidth).toBe(24);
  expect(badgeSize.badgeHeight).toBe(24);
  expect(badgeSize.iconWidth).toBe(14);
  expect(badgeSize.iconHeight).toBe(14);

  const badgePlacement = await page.evaluate(() => {
    const heading = document.querySelector("h1");
    const badge = document.querySelector(".hs-edit-badge");
    const headingRect = heading.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();

    return {
      badgeLeft: badgeRect.left,
      badgeRight: badgeRect.right,
      badgeTop: badgeRect.top,
      badgeBottom: badgeRect.bottom,
      headingLeft: headingRect.left,
      headingRight: headingRect.right,
      headingTop: headingRect.top,
      headingBottom: headingRect.bottom,
    };
  });

  expect(
    badgePlacement.badgeLeft >= badgePlacement.headingRight ||
      badgePlacement.badgeRight <= badgePlacement.headingLeft
  ).toBe(true);
  expect(badgePlacement.badgeTop).toBeLessThanOrEqual(
    badgePlacement.headingBottom
  );
  expect(badgePlacement.badgeBottom).toBeGreaterThanOrEqual(
    badgePlacement.headingTop
  );

  await badges.first().click();
  await expect(heading).toHaveAttribute("contenteditable", "true");
  await expect(badges.first()).toBeHidden();
  await expect(page.locator("main")).not.toHaveAttribute(
    "contenteditable",
    "true"
  );

  await page.mouse.click(24, 24);
  await expect(heading).not.toHaveAttribute("contenteditable", "true");
});

test("edit badges stay anchored during document scroll", async ({ page }) => {
  await page.goto("/");

  const badge = page.locator(".hs-edit-badge").first();
  await expect(badge).toBeVisible();

  const before = await badge.evaluate((element) => ({
    left: element.style.left,
    top: element.style.top,
  }));

  await page.evaluate(() => window.scrollTo(0, 320));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const after = await badge.evaluate((element) => ({
    left: element.style.left,
    top: element.style.top,
  }));

  expect(after).toEqual(before);
});

test("toolbar uses named Lucide icons", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("[data-hs-tool='select']")).toHaveCount(0);
  await expect(page.locator("[data-hs-tool='edit']")).toHaveCount(0);
  await expect(page.locator("[data-hs-tool='comment'] svg")).toHaveAttribute(
    "data-lucide",
    "message-square-plus"
  );
  await expect(
    page.locator(".hs-edit-badge").first().locator("svg")
  ).toHaveAttribute("data-lucide", "pencil");
  await expect(page.locator("[data-hs-tool='save'] svg")).toHaveAttribute(
    "data-lucide",
    "save"
  );
});

test("double click edits an explicit element without whole-page editing", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  const heading = page.locator("h1");

  await expect(page.locator("html")).not.toHaveAttribute("editmode", "true");
  await heading.dblclick();

  await expect(heading).toHaveAttribute("contenteditable", "true");
  await expect(page.locator("main")).not.toHaveAttribute(
    "contenteditable",
    "true"
  );

  await page.mouse.click(24, 24);
  await expect(heading).not.toHaveAttribute("contenteditable", "true");
});

test("comment tool creates nearby durable HTML after clickaway", async ({
  page,
}) => {
  await stubPageSaves(page);
  await page.goto("/");

  const { comment, text } = await placeComment(page, "");

  await expect(comment).toHaveAttribute("save-remove", "");
  await expect(text).toBeFocused();

  await page.keyboard.type("Tighten this section.");
  await page.mouse.click(24, 24);

  await expect(comment).not.toHaveAttribute("save-remove", "");
  await expect(comment).toHaveAttribute("movable", "");
  await expect(text).toHaveText("Tighten this section.");
  await expect(text).toHaveAttribute("editmode:contenteditable", "");
  await expect(text).not.toHaveAttribute("contenteditable", "true");
});

test("comment tool stays armed after committing a comment", async ({ page }) => {
  await stubPageSaves(page);
  await page.goto("/");

  const host = page.locator(".section.split[data-hs-comment-host]").first();
  const target = host.locator("p[editmode\\:contenteditable]").first();
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
    comment.innerHTML =
      '<p editmode:contenteditable>Short automatic comment</p>';
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
  expect(html).toContain("editmode:contenteditable");
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
  expect(html).not.toContain("data-hs-draft");
  expect(html).not.toContain("data-hs-resizing");
  expect(html).not.toContain("movable-dragging");
  expect(html).not.toContain('contenteditable="true"');
  expect(html).not.toContain("inert-contenteditable");
  expect(html).not.toContain('editmode="true"');
  expect(html).not.toContain("option-visibility");
  expect(html).not.toContain("hyperspace.js");
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

  const heading = page.locator("h1");

  await heading.dblclick();
  await heading.fill("Autosaved review artifact");
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

  expect(pageUrl).toContain("http://localhost");
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
      '<section data-hs-comment-host><aside data-hs-comment movable movable-dragging data-hs-color="red" tabindex="0" data-hs-selected data-hs-draft data-hs-resizing style="transform: translate(12px, 24px); width: 111px; height: 222px; resize: both; overflow: hidden;"><p editmode:contenteditable inert-contenteditable="null" contenteditable="true" data-hs-inline-editing data-hs-commit-bound>After</p></aside></section>',
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
  expect(saved).not.toContain("hyperspace.js");
  expect(saved).not.toContain("data-hs-comment-controls");
  expect(saved).not.toContain("data-hs-color");
  expect(saved).not.toContain("tabindex");
  expect(saved).not.toContain("data-hs-selected");
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
