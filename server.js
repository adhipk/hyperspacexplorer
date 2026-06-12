#!/usr/bin/env bun

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const rootDir = path.resolve(process.env.HYPERSPACE_ROOT || process.cwd());
const runtimeDir = __dirname;
const port = Number(process.env.PORT || 5173);
const hostname = process.env.HOST || "127.0.0.1";
const hyperclayUrl =
  process.env.HYPERCLAY_URL ||
  "https://cdn.jsdelivr.net/npm/hyperclayjs@1/src/hyperclay.js?preset=smooth-sailing";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htmlclay": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function json(body, status = 200) {
  return withLocalCookies(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  );
}

function withLocalCookies(response) {
  response.headers.append(
    "Set-Cookie",
    "isAdminOfCurrentResource=true; Path=/; SameSite=Lax"
  );
  response.headers.append("Set-Cookie", "isLoggedIn=true; Path=/; SameSite=Lax");
  return response;
}

function stripSystemRouteMarker(pathname) {
  if (pathname.startsWith("/_/")) {
    return pathname.slice(2);
  }
  return pathname;
}

function resolveResourceFromHref(href) {
  let pathname;

  try {
    pathname = new URL(href, "http://localhost").pathname;
  } catch (error) {
    return null;
  }

  if (pathname === "/") {
    return "index.html";
  }

  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const htmlMatch = relativePath.match(/^(.*?\.html(?:clay)?)(?:\/.*)?$/);

  if (!htmlMatch) {
    return null;
  }

  return path.normalize(htmlMatch[1]);
}

function validateWritableHtml(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 255 ||
    relativePath.includes("\\") ||
    relativePath.includes("..") ||
    relativePath.startsWith("/") ||
    path.isAbsolute(relativePath) ||
    !/^[\w./-]+$/.test(relativePath) ||
    !/\.(html|htmlclay)$/.test(relativePath) ||
    relativePath.split("/").some((segment) => !segment || segment.startsWith("."))
  ) {
    return { error: "Invalid file path." };
  }

  const filePath = path.resolve(rootDir, relativePath);

  if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
    return { error: "Path escapes project root." };
  }

  return { filePath };
}

function resolveProjectPath(pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(
      new URL(pathname || "/", "http://localhost").pathname
    );
  } catch (error) {
    return null;
  }

  const relativePath =
    decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(rootDir, path.normalize(relativePath));

  if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
    return null;
  }

  return filePath;
}

async function resolveStaticFile(pathname) {
  const filePath = resolveProjectPath(pathname);

  if (filePath) {
    try {
      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        return path.join(filePath, "index.html");
      }

      if (stat.isFile()) {
        return filePath;
      }
    } catch (error) {}
  }

  if (pathname === "/hyperspace.js" || pathname === "/hyperspace.css") {
    const runtimePath = path.join(runtimeDir, pathname.slice(1));

    try {
      const stat = await fs.stat(runtimePath);

      if (stat.isFile()) {
        return runtimePath;
      }
    } catch (error) {
      return null;
    }
  }

  return null;
}

function runtimeSnippet() {
  return [
    '<link rel="stylesheet" href="/hyperspace.css" save-remove data-hs-runtime>',
    `<script type="module" src="${hyperclayUrl}" save-remove data-hs-runtime></script>`,
    '<script type="module" src="/hyperspace.js" save-remove data-hs-runtime></script>',
  ].join("\n");
}

function injectRuntime(html) {
  if (
    html.includes("data-hs-no-inject") ||
    html.includes("/hyperspace.js") ||
    html.includes('src="./hyperspace.js"')
  ) {
    return html;
  }

  const snippet = "\n" + runtimeSnippet() + "\n";

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, snippet + "</body>");
  }

  return html + snippet;
}

function stripRuntime(html) {
  let cleaned = html
    .replace(/\s*<link\b[^>]*\bdata-hs-runtime\b[^>]*>\s*/gi, "\n")
    .replace(
      /\s*<script\b[^>]*\bdata-hs-runtime\b[^>]*>\s*<\/script>\s*/gi,
      "\n"
    )
    .replace(
      /\s*<script\b[^>]*\bsrc=["'][^"']*hyperspace\.js[^"']*["'][^>]*>\s*<\/script>\s*/gi,
      "\n"
    )
    .replace(
      /\s*<script\b[^>]*\bsrc=["'][^"']*hyperclayjs[^"']*["'][^>]*>\s*<\/script>\s*/gi,
      "\n"
    )
    .replace(
      /\s*<link\b[^>]*\bhref=["'][^"']*hyperspace\.css[^"']*["'][^>]*>\s*/gi,
      "\n"
    )
    .replace(
      /\s*<style\b[^>]*\bdata-name=["']option-visibility["'][^>]*>\s*<\/style>\s*/gi,
      "\n"
    )
    .replace(
      /\s(?:contenteditable|inert-contenteditable)(?:=(["'])[^"']*\1)?/gi,
      ""
    )
    .replace(/\s(?:editmode|pageowner|savestatus)=(["'])[^"']*\1/gi, "")
    .replace(
      /(<li\b(?=[^>]*\bdata-hs-list-selected\b)[^>]*?)\stabindex=(["'])0\2/gi,
      "$1"
    )
    .replace(
      /\sdata-hs-(?:selected|draft|dragging|resizing|inline-editing|commit-bound|list-selected)(?:=(["'])[^"']*\1)?/gi,
      ""
    )
    .replace(/\smovable-dragging(?:=(["'])[^"']*\1)?/gi, "")
    .replace(
      /(<aside\b[^>]*\bdata-hs-comment\b[^>]*)\sdata-hs-color=(["'])[^"']*\2/gi,
      "$1"
    )
    .replace(/(<aside\b[^>]*\bdata-hs-comment\b[^>]*)\stabindex=(["'])0\2/gi, "$1");

  cleaned = cleaned.replace(
    /(<aside\b(?=[^>]*\bdata-hs-comment\b)[^>]*?)\sstyle=(["'])([^"']*)\2([^>]*>)/gi,
    (_, before, quote, style, after) => {
      const cleanedStyle = style
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part && !/^(width|height|resize|overflow)\s*:/i.test(part))
        .join("; ");

      return cleanedStyle
        ? `${before} style=${quote}${cleanedStyle}${quote}${after}`
        : `${before}${after}`;
    }
  );

  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(
      /\s*<([a-z][\w:-]*)\b[^>]*\bsave-remove\b[^>]*>[\s\S]*?<\/\1>\s*/gi,
      "\n"
    );
  } while (cleaned !== previous);

  cleaned = cleaned.replace(/\s*<[^>]+\bsave-remove\b[^>]*>\s*/gi, "\n");
  return cleaned;
}

async function readSaveContent(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = await request.json();

    if (payload && typeof payload.content === "string") {
      return payload.content;
    }

    if (payload && typeof payload.html === "string") {
      return payload.html;
    }

    return null;
  }

  return request.text();
}

function timestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
    String(now.getMilliseconds()).padStart(3, "0"),
  ];

  return parts.slice(0, 3).join("-") + "-" + parts.slice(3).join("-");
}

async function backupExistingFile(relativePath, filePath) {
  let existing;

  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return null;
  }

  const backupName = relativePath.replace(/\.(html|htmlclay)$/, "");
  const backupDir = path.join(rootDir, "sites-versions", backupName);
  const backupPath = path.join(backupDir, timestamp() + ".html");

  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(backupPath, existing, "utf8");
  return backupPath;
}

async function handleSave(request) {
  const pageUrl = request.headers.get("Page-URL");

  if (!pageUrl) {
    return json({ msg: "Page-URL header required.", msgType: "error" }, 400);
  }

  const relativePath = resolveResourceFromHref(pageUrl);

  if (!relativePath) {
    return json({ msg: "Could not resolve HTML file.", msgType: "error" }, 400);
  }

  const validated = validateWritableHtml(relativePath);

  if (validated.error) {
    return json({ msg: validated.error, msgType: "error" }, 400);
  }

  let content;

  try {
    content = await readSaveContent(request);
  } catch (error) {
    return json({ msg: "Invalid save body.", msgType: "error" }, 400);
  }

  if (typeof content !== "string" || !content.trim()) {
    return json({ msg: "HTML content required.", msgType: "error" }, 400);
  }

  const cleaned = stripRuntime(content);
  const filePath = validated.filePath;
  const tempPath =
    filePath + "." + process.pid + "." + crypto.randomUUID() + ".tmp";

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await backupExistingFile(relativePath, filePath);
    await fs.writeFile(tempPath, cleaned, "utf8");
    await fs.rename(tempPath, filePath);

    return json({ msg: "Saved", msgType: "success" });
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch (unlinkError) {}

    return json(
      { msg: error.message || "Server error saving file.", msgType: "error" },
      500
    );
  }
}

async function serveStaticFile(request, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const headers = new Headers();
  const type = mimeTypes[ext];

  if (type) {
    headers.set("Content-Type", type);
  }

  if (ext === ".html" || ext === ".htmlclay") {
    const html = await fs.readFile(filePath, "utf8");
    return withLocalCookies(
      new Response(request.method === "HEAD" ? null : injectRuntime(html), {
        headers,
      })
    );
  }

  return withLocalCookies(
    new Response(request.method === "HEAD" ? null : Bun.file(filePath), {
      headers,
    })
  );
}

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = stripSystemRouteMarker(url.pathname);

    if (pathname === "/save") {
      if (request.method !== "POST") {
        return json({ msg: "Method not allowed.", msgType: "error" }, 405);
      }

      return handleSave(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return withLocalCookies(new Response("Method not allowed", { status: 405 }));
    }

    const filePath = await resolveStaticFile(url.pathname);

    if (!filePath) {
      return withLocalCookies(new Response("Not found", { status: 404 }));
    }

    return serveStaticFile(request, filePath);
  },
  error(error) {
    return json({ msg: error.message || "Server error.", msgType: "error" }, 500);
  },
});

console.log(`Serving ${rootDir} at http://${server.hostname}:${server.port}`);
console.log("Hyperclay-compatible save endpoint: /_/save");
