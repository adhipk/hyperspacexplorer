#!/usr/bin/env bun

const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const net = require("node:net");

const repoRoot = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;

      server.close(() => {
        port ? resolve(port) : reject(new Error("Could not allocate test port."));
      });
    });
  });
}

async function waitForServer(url) {
  let lastError;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError || new Error("Timed out waiting for dogfood server.");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1000);
  });
}

function reconcileDogfoodFeedback(html) {
  assert(html.includes("Dogfood review comment."), "Agent could not read saved comment.");
  assert(html.includes("Reviewed dogfood copy."), "Agent could not read saved edit.");

  return html
    .replace("Needs dogfood status.", "Dogfood status is explicit.")
    .replace(
      /\s*<aside\b[^>]*\bdata-hs-comment\b[^>]*>[\s\S]*?Dogfood review comment\.[\s\S]*?<\/aside>\s*/i,
      "\n"
    );
}

async function main() {
  const skill = await readFile(
    path.join(repoRoot, "skills/hyperspace-html-artifacts/SKILL.md"),
    "utf8"
  );

  assert(skill.includes("data-hs-comment"), "Skill does not cover durable comments.");
  assert(skill.includes("Reconciling Reviews"), "Skill does not cover review reconciliation.");

  const rootDir = await mkdtemp(path.join(tmpdir(), "hyperspace-dogfood-"));
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}/dogfood.html`;
  const artifactPath = path.join(rootDir, "dogfood.html");
  let browser;
  let server;
  let logs = "";

  try {
    await writeFile(path.join(rootDir, "noop-hyperclay.js"), "export {};\n", "utf8");
    await writeFile(
      artifactPath,
      [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        "<title>Hyperspace Dogfood</title>",
        "</head>",
        "<body>",
        '<main data-hs-comment-host>',
        "<section>",
        "<h1>Dogfood review artifact</h1>",
        "<p>Original dogfood copy.</p>",
        "<p>Needs dogfood status.</p>",
        "</section>",
        "</main>",
        "</body>",
        "</html>",
      ].join("\n"),
      "utf8"
    );

    server = spawn("bun", ["server.js"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        HYPERSPACE_ROOT: rootDir,
        HYPERCLAY_URL: "/noop-hyperclay.js",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => {
      logs += chunk.toString();
    });
    server.stderr.on("data", (chunk) => {
      logs += chunk.toString();
    });

    await waitForServer(url);

    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url);

    const editable = page.locator("p").first();
    await page.locator("[data-hs-tool='edit']").click();
    await editable.dblclick();
    await editable.fill("Reviewed dogfood copy.");
    await page.mouse.click(12, 12);

    await page.evaluate(() => window.Hyperspace.setTool("comment"));
    await page.evaluate(() => {
      const target = document.querySelector("p");
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 24,
          clientY: rect.top + 18,
        })
      );
    });
    const commentText = page.locator("[data-hs-comment] p").first();
    await commentText.waitFor({ state: "attached" });
    await commentText.evaluate((element) => {
      element.textContent = "Dogfood review comment.";
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      element.blur();
    });
    await page.evaluate(() => window.Hyperspace.save({ silent: true }));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    const reviewedHtml = await readFile(artifactPath, "utf8");
    assert(reviewedHtml.includes("Reviewed dogfood copy."), "Saved text edit missing.");
    assert(reviewedHtml.includes("Dogfood review comment."), "Saved comment missing.");

    const reconciled = reconcileDogfoodFeedback(reviewedHtml);
    await writeFile(artifactPath, reconciled, "utf8");

    const finalHtml = await readFile(artifactPath, "utf8");
    assert(finalHtml.includes("Dogfood status is explicit."), "Agent reconciliation missing.");
    assert(!finalHtml.includes("Dogfood review comment."), "Resolved comment was not cleared.");

    console.log("Hyperspace skill dogfood review loop passed.");
  } catch (error) {
    if (logs.trim()) {
      console.error(logs.trim());
    }

    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }

    await stopChild(server);
    await rm(rootDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
