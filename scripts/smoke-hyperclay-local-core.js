#!/usr/bin/env bun

const { chromium } = require("playwright");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
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

function stripSystemRouteMarker(pathname) {
  return pathname.startsWith("/_/") ? pathname.slice(2) : pathname;
}

function resolveResourceFromHref(href) {
  let pathname;

  try {
    pathname = new URL(href).pathname;
  } catch {
    pathname = href;
  }

  if (pathname === "/") {
    return "index.html";
  }

  const relativePath = pathname.replace(/^\/+/, "");
  const htmlMatch = relativePath.match(/^(.*?\.html(?:clay)?)/);

  return path.normalize(htmlMatch ? htmlMatch[1] : relativePath);
}

function validateLocalCorePath(name, baseDir) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 255 ||
    name.includes("..") ||
    name.includes("\\") ||
    name.startsWith(".") ||
    name.startsWith("/") ||
    (!name.endsWith(".html") && !name.endsWith(".htmlclay")) ||
    path.isAbsolute(name) ||
    !/^[\w/.-]+$/.test(name) ||
    name.split("/").some((segment) => segment.startsWith(".") || segment.length === 0)
  ) {
    return null;
  }

  const baseName = name.split("/").pop();
  if (!/^[a-z0-9_-]+\.(html|htmlclay)$/.test(baseName)) {
    return null;
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, name);

  if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
    return null;
  }

  return resolvedPath;
}

async function readRequestBody(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = await request.json();
    return typeof payload?.content === "string" ? payload.content : null;
  }

  return request.text();
}

function withLocalCookies(response) {
  response.headers.append(
    "Set-Cookie",
    "isAdminOfCurrentResource=true; Path=/; SameSite=Lax"
  );
  response.headers.append("Set-Cookie", "isLoggedIn=true; Path=/; SameSite=Lax");
  return response;
}

async function startCoreLikeServer(rootDir, port) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const pathname = stripSystemRouteMarker(url.pathname);

      if (pathname === "/save") {
        const pageUrl = request.headers.get("Page-URL");
        const relativePath = pageUrl ? resolveResourceFromHref(pageUrl) : null;
        const filePath = relativePath
          ? validateLocalCorePath(relativePath, rootDir)
          : null;

        if (!filePath) {
          return withLocalCookies(
            Response.json({ msg: "Invalid file path", msgType: "error" }, { status: 400 })
          );
        }

        const content = await readRequestBody(request);

        if (typeof content !== "string") {
          return withLocalCookies(
            Response.json(
              { msg: "Invalid request body. Plain text HTML content expected.", msgType: "error" },
              { status: 400 }
            )
          );
        }

        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf8");
        return withLocalCookies(Response.json({ msg: "Saved", msgType: "success" }));
      }

      const filePath =
        pathname === "/hyperspace.js" || pathname === "/hyperspace.css"
          ? path.join(repoRoot, pathname.slice(1))
          : path.join(rootDir, pathname === "/" ? "index.html" : pathname.slice(1));

      const resolvedBase =
        pathname === "/hyperspace.js" || pathname === "/hyperspace.css"
          ? repoRoot
          : rootDir;
      const resolvedPath = path.resolve(filePath);

      if (!resolvedPath.startsWith(path.resolve(resolvedBase) + path.sep)) {
        return withLocalCookies(new Response("Access denied", { status: 403 }));
      }

      const file = Bun.file(resolvedPath);

      if (!(await file.exists())) {
        return withLocalCookies(new Response("File not found", { status: 404 }));
      }

      const headers = new Headers();

      if (resolvedPath.endsWith(".html")) {
        headers.set("Content-Type", "text/html; charset=utf-8");
      } else if (resolvedPath.endsWith(".css")) {
        headers.set("Content-Type", "text/css; charset=utf-8");
      } else if (resolvedPath.endsWith(".js")) {
        headers.set("Content-Type", "text/javascript; charset=utf-8");
      }

      return withLocalCookies(new Response(file, { headers }));
    },
  });

  return server;
}

async function main() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "hyperspace-core-"));
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}/index.html`;
  let browser;
  let server;

  try {
    await writeFile(path.join(rootDir, "noop-hyperclay.js"), "export {};\n", "utf8");
    await writeFile(
      path.join(rootDir, "index.html"),
      [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        "<title>Hyperclay Core Contract</title>",
        '<link rel="stylesheet" href="/hyperspace.css" save-remove data-hs-runtime>',
        '<script type="module" src="/noop-hyperclay.js" save-remove data-hs-runtime></script>',
        '<script type="module" src="/hyperspace.js" save-remove data-hs-runtime></script>',
        "</head>",
        '<body data-hs-comment-host>',
        "<main>",
        '<section data-hs-comment-host>',
        "<h1>Core contract artifact</h1>",
        "<p>Original core copy.</p>",
        "</section>",
        "</main>",
        "</body>",
        "</html>",
      ].join("\n"),
      "utf8"
    );

    server = await startCoreLikeServer(rootDir, port);
    browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(url);
    await page.locator("[data-hs-tool='edit']").click();
    await page.locator("p").first().dblclick();
    await page.locator("p").first().fill("Edited through core contract.");
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
      element.textContent = "Core-compatible nearby comment.";
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      element.blur();
    });
    await page.evaluate(() => window.Hyperspace.save({ silent: true }));

    const saved = await readFile(path.join(rootDir, "index.html"), "utf8");

    assert(saved.includes("Edited through core contract."), "Edited text was not saved.");
    assert(saved.includes("Core-compatible nearby comment."), "Comment was not saved.");
    assert(saved.includes("data-hs-comment"), "Durable comment markup was not saved.");
    assert(!saved.includes("hyperspace.js"), "Runtime script leaked into saved HTML.");
    assert(!saved.includes("hs-toolbar"), "Runtime toolbar leaked into saved HTML.");

    const jsonResponse = await fetch(`http://127.0.0.1:${port}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Page-URL": url,
      },
      body: JSON.stringify({
        content: saved.replace("Edited through core contract.", "Saved through JSON core route."),
        snapshotHtml: saved,
      }),
    });

    assert(jsonResponse.ok, "JSON /save route did not accept content payload.");

    const jsonSaved = await readFile(path.join(rootDir, "index.html"), "utf8");
    assert(jsonSaved.includes("Saved through JSON core route."), "JSON content was not saved.");

    console.log("Hyperclay Local core contract smoke passed.");
  } finally {
    if (browser) {
      await browser.close();
    }

    if (server) {
      server.stop(true);
    }

    await rm(rootDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
