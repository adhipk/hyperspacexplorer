#!/usr/bin/env bun

const { spawn } = require("node:child_process");
const { cp, mkdtemp, readdir, rm, stat } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const net = require("node:net");

const repoRoot = path.resolve(__dirname, "..");

function shouldSkip(relativePath) {
  return (
    relativePath === ".git" ||
    relativePath === "node_modules" ||
    relativePath === "test-results" ||
    relativePath === "playwright-report" ||
    relativePath === "sites-versions" ||
    relativePath.startsWith(".git/") ||
    relativePath.startsWith("node_modules/") ||
    relativePath.startsWith("test-results/") ||
    relativePath.startsWith("playwright-report/") ||
    relativePath.startsWith("sites-versions/") ||
    /^hyperspace-html-review-.*\.tgz$/.test(path.basename(relativePath)) ||
    /^tmp-hyperspace-.*\.html$/.test(path.basename(relativePath))
  );
}

async function copyWorkingTree(sourceDir, targetDir, prefix = "") {
  const entries = await readdir(sourceDir);

  for (const entry of entries) {
    const relativePath = prefix ? path.join(prefix, entry) : entry;

    if (shouldSkip(relativePath)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(targetDir, entry);
    const stats = await stat(sourcePath);

    if (stats.isDirectory()) {
      await cp(sourcePath, targetPath, {
        recursive: true,
        filter(source) {
          const childRelative = path.relative(repoRoot, source);
          return !shouldSkip(childRelative);
        },
      });
    } else if (stats.isFile()) {
      await cp(sourcePath, targetPath);
    }
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function main() {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), "hyperspace-release-"));
  const testPort = await getFreePort();

  try {
    await copyWorkingTree(repoRoot, releaseRoot);
    await run("bun", ["install", "--frozen-lockfile"], { cwd: releaseRoot });
    await run("bun", ["run", "check"], { cwd: releaseRoot });
    await run("bun", ["run", "test"], {
      cwd: releaseRoot,
      env: { HOST: "127.0.0.1", PORT: String(testPort) },
    });
    await run("bun", ["run", "smoke:distribution"], { cwd: releaseRoot });
    await run("bun", ["run", "smoke:hyperclay-core"], { cwd: releaseRoot });
    await run("bun", ["run", "dogfood:skill"], { cwd: releaseRoot });
    await run("bun", ["run", "pack:dry"], { cwd: releaseRoot });

    console.log("Clean release verification passed.");
  } finally {
    await rm(releaseRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
