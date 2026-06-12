#!/usr/bin/env bun

const { spawn } = require("node:child_process");
const { mkdtemp, mkdir, writeFile, readFile, rm } = require("node:fs/promises");
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
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Could not allocate a test port."));
        }
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
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError || new Error("Timed out waiting for distribution smoke server.");
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1000);
  });
}

async function main() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "hyperspace-smoke-"));
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}/index.html`;
  let server;
  let logs = "";

  try {
    await mkdir(path.join(projectRoot, "docs"), { recursive: true });
    await writeFile(path.join(projectRoot, "noop-hyperclay.js"), "export {};\n", "utf8");
    await writeFile(
      path.join(projectRoot, "index.html"),
      [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        "<title>Hyperspace Smoke</title>",
        "</head>",
        '<body data-hs-comment-host>',
        "<main>",
        '<section data-hs-comment-host>',
        "<h1>Review artifact</h1>",
        "<p>Original copy.</p>",
        "<ol><li>First item</li><li>Second item</li></ol>",
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
        HYPERSPACE_ROOT: projectRoot,
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

    const injected = await waitForServer(url);
    const injectedHtml = await injected.text();

    assert(injectedHtml.includes("/hyperspace.js"), "Runtime script was not injected.");
    assert(injectedHtml.includes("/hyperspace.css"), "Runtime stylesheet was not injected.");
    assert(injectedHtml.includes("/noop-hyperclay.js"), "Hyperclay runtime URL was not injected.");

    const saveHtml = [
      "<!DOCTYPE html>",
      '<html lang="en" editmode="true" savestatus="saved">',
      "<head>",
      '<meta charset="utf-8">',
      "<title>Hyperspace Smoke</title>",
      '<link rel="stylesheet" href="/hyperspace.css" save-remove data-hs-runtime>',
      "</head>",
      "<body data-hs-comment-host>",
      '<div class="hs-toolbar" data-hs-runtime save-remove></div>',
      "<main>",
      '<section data-hs-comment-host>',
      "<h1>Review artifact</h1>",
      '<p contenteditable="true">Edited copy.</p>',
      '<ol><li data-hs-list-selected tabindex="0">First item</li><li>Second item</li></ol>',
      '<aside data-hs-comment data-hs-selected tabindex="0" movable style="transform: translate(12px, 24px); width: 200px; height: 100px;"><p contenteditable="true">Ship this note.</p></aside>',
      "</section>",
      "</main>",
      '<script type="module" src="/hyperspace.js" save-remove data-hs-runtime></script>',
      "</body>",
      "</html>",
    ].join("");

    const saveResponse = await fetch(`http://127.0.0.1:${port}/_/save`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Page-URL": url,
      },
      body: saveHtml,
    });

    assert(saveResponse.ok, `Save failed with status ${saveResponse.status}.`);

    const saved = await readFile(path.join(projectRoot, "index.html"), "utf8");

    assert(saved.includes("Edited copy."), "Edited document text was not saved.");
    assert(saved.includes("data-hs-comment"), "Durable comment was not saved.");
    assert(saved.includes("Ship this note."), "Comment text was not saved.");
    assert(!saved.includes("data-hs-editable-list"), "Legacy editable list marker leaked into saved HTML.");
    assert(!saved.includes("hs-toolbar"), "Runtime toolbar leaked into saved HTML.");
    assert(!saved.includes("hyperspace.js"), "Runtime script leaked into saved HTML.");
    assert(!saved.includes('contenteditable="true"'), "Transient contenteditable leaked into saved HTML.");
    assert(!saved.includes("data-hs-selected"), "Transient selection state leaked into saved HTML.");
    assert(!saved.includes("width: 200px"), "Fixed comment width leaked into saved HTML.");

    console.log(`Distribution smoke passed at ${url}`);
  } catch (error) {
    if (logs.trim()) {
      console.error(logs.trim());
    }

    throw error;
  } finally {
    if (server) {
      await stopServer(server);
    }

    await rm(projectRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
