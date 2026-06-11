const { expect, test } = require("@playwright/test");

function editButton(page) {
  return page.getByRole("button", { name: "Toggle editing" });
}

test("project documentation pages load with the editor toolbar", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Single script editing"
  );
  await expect(editButton(page)).toBeVisible();

  await page.goto("/phase2.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Save edited HTML"
  );
  await expect(editButton(page)).toBeVisible();
});

test("edit toggle uses native contenteditable on the document root", async ({
  page,
}) => {
  await page.goto("/");

  const root = page.locator("main");
  await expect(root).not.toHaveAttribute("contenteditable", "true");

  await editButton(page).click();
  await expect(root).toHaveAttribute("contenteditable", "true");

  await editButton(page).click();
  await expect(root).not.toHaveAttribute("contenteditable", "true");
});

test("edit toggle does not shift document layout", async ({ page }) => {
  await page.goto("/");

  const before = await page.locator("h1").boundingBox();
  await editButton(page).click();
  const after = await page.locator("h1").boundingBox();

  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
});

test("serialized html strips temporary editor state", async ({ page }) => {
  await page.goto("/");
  await editButton(page).click();

  const html = await page.evaluate(() => window.HyperEdit.serialize());

  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("Single script editing for ordinary HTML pages.");
  expect(html).not.toContain("hx-editor-on");
  expect(html).not.toContain("hx-editor-editable");
  expect(html).not.toContain("data-hx-prev-contenteditable");
  expect(html).not.toContain('contenteditable="true"');
});

test("save without backend stores a cleaned local draft", async ({ page }) => {
  await page.goto("/");
  await editButton(page).click();

  await page.evaluate(() => window.HyperEdit.save());

  const draft = await page.evaluate(() =>
    localStorage.getItem(`hyperedit:${location.origin}${location.pathname}:draft`)
  );

  expect(draft).toContain("Single script editing for ordinary HTML pages.");
  expect(draft).not.toContain("hx-editor-editable");
});
