const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const rootDir = __dirname;
const port = Number(process.env.PORT || 5173);
const hostname = process.env.HOST || "127.0.0.1";
const savePath = process.env.HYPEREDIT_SAVE_PATH || "/__hyperedit/save";

/*
  Minimal Bun implementation of the HyperEdit save contract.
  The frontend only needs a POST URL that accepts its serialized HTML payload.
*/

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function resolveProjectPath(pathname) {
  let urlPath;

  try {
    urlPath = new URL(pathname || "/", "http://localhost").pathname;
  } catch (error) {
    return null;
  }

  let decodedPath;

  try {
    decodedPath = decodeURIComponent(urlPath);
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

  if (!filePath) {
    return null;
  }

  try {
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      return path.join(filePath, "index.html");
    }

    if (stat.isFile()) {
      return filePath;
    }
  } catch (error) {
    return null;
  }

  return null;
}

async function handleSave(request) {
  let payload;

  try {
    payload = await request.json();
  } catch (error) {
    return json({ ok: false, error: "Expected JSON request body." }, 400);
  }

  if (!payload || typeof payload !== "object") {
    return json({ ok: false, error: "Expected save payload." }, 400);
  }

  if (typeof payload.html !== "string" || !payload.html.trim()) {
    return json({ ok: false, error: "Missing HTML payload." }, 400);
  }

  const filePath = resolveProjectPath(payload.pathname);

  if (!filePath || path.extname(filePath).toLowerCase() !== ".html") {
    return json({ ok: false, error: "Save target must be an HTML file." }, 400);
  }

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath =
      filePath + "." + process.pid + "." + crypto.randomUUID() + ".tmp";

    await fs.writeFile(tempPath, payload.html, "utf8");
    await fs.rename(tempPath, filePath);

    return json({
      ok: true,
      pathname: payload.pathname || "/",
      bytes: Buffer.byteLength(payload.html, "utf8"),
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "Save failed." }, 500);
  }
}

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === savePath) {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      return handleSave(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const filePath = await resolveStaticFile(url.pathname);

    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(filePath);
    const headers = new Headers();
    const type = mimeTypes[path.extname(filePath).toLowerCase()];

    if (type) {
      headers.set("Content-Type", type);
    }

    return new Response(request.method === "HEAD" ? null : file, { headers });
  },
  error(error) {
    return json({ ok: false, error: error.message || "Server error." }, 500);
  },
});

console.log(`Serving ${rootDir} at http://${server.hostname}:${server.port}`);
console.log(`HyperEdit example save endpoint: ${savePath}`);
